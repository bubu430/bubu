const config = require('../config')

let cloudInitialized = false

function platformError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function hasCloudConfig() {
  return typeof wx !== 'undefined' && !!wx.cloud &&
    typeof config.cloudEnv === 'string' && config.cloudEnv.trim().length > 0
}

function callWx(method, options) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx[method] !== 'function') {
      reject(platformError('UNSUPPORTED', '请在微信真机中体验此功能'))
      return
    }
    wx[method](Object.assign({}, options || {}, { success: resolve, fail: reject }))
  })
}

async function ensurePrivacyAuthorization() {
  // 不支持该接口的旧基础库仍由对应数据接口执行系统授权。
  if (typeof wx !== 'undefined' && typeof wx.requirePrivacyAuthorize === 'function') {
    await callWx('requirePrivacyAuthorize')
  }
}

function describeFailure(error, subject) {
  if (error && error.code && error.message) return error
  const text = String(error && (error.errMsg || error.message) || '')
  if (/deny|denied|cancel|auth|privacy/i.test(text)) {
    return platformError('PERMISSION_DENIED', subject + '未获授权，你仍可继续演示体验')
  }
  return platformError('PLATFORM_ERROR', subject + '暂时不可用，请检查权限或稍后重试')
}

async function syncWeRunSteps() {
  if (!hasCloudConfig()) {
    throw platformError('CLOUD_NOT_CONFIGURED', '请先配置云开发环境，当前可使用演示步数')
  }
  try {
    await ensurePrivacyAuthorization()
    if (!cloudInitialized) {
      wx.cloud.init({ env: config.cloudEnv, traceUser: false })
      cloudInitialized = true
    }
    // 登录只建立微信登录态；不在客户端读取或保存 session_key。
    await callWx('login')
    const runData = await callWx('getWeRunData')
    if (!runData.cloudID || typeof runData.cloudID !== 'string') {
      throw platformError('CLOUD_ID_MISSING', '未取得微信运动云数据，请检查云开发开通情况并在真机重试')
    }
    const response = await wx.cloud.callFunction({
      name: 'syncSteps',
      config: { env: config.cloudEnv },
      data: { cloudID: runData.cloudID },
    })
    const result = response && response.result
    if (!result || result.ok !== true) {
      const failure = result && result.error
      throw platformError(failure && failure.code || 'SYNC_FAILED',
        failure && failure.message || '微信运动同步失败，请稍后重试')
    }
    if (!Number.isSafeInteger(result.total) || result.total < 0 || result.total > 200000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(result.date || '')) {
      throw platformError('INVALID_RESPONSE', '步数服务返回的数据无效，请稍后重试')
    }
    return { total: result.total, date: result.date, source: 'werun' }
  } catch (error) {
    throw describeFailure(error, '微信运动')
  }
}

async function getCurrentLocation() {
  try {
    await ensurePrivacyAuthorization()
    const location = await callWx('getLocation', { type: 'gcj02', isHighAccuracy: false })
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
      throw platformError('INVALID_LOCATION', '暂时无法获取有效位置，请稍后重试')
    }
    // 只返回给本次地图交互，不写入存储，也不上传云端。
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: Number.isFinite(location.accuracy) ? location.accuracy : null,
    }
  } catch (error) {
    throw describeFailure(error, '定位')
  }
}

module.exports = { hasCloudConfig, syncWeRunSteps, getCurrentLocation }
