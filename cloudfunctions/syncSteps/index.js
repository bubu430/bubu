'use strict'

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const MAX_DAILY_STEPS = 200000
const DAY_MS = 86400000

function chinaDate(timestampMs) {
  return new Date(timestampMs + 8 * 3600000).toISOString().slice(0, 10)
}

function fail(code, message) {
  return { ok: false, error: { code, message } }
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  if (!context.OPENID || !context.APPID) {
    return fail('UNAUTHENTICATED', '请从已登录的小程序重新同步')
  }
  if (!event || typeof event.cloudID !== 'string' ||
    event.cloudID.length < 1 || event.cloudID.length > 1024) {
    return fail('INVALID_REQUEST', '缺少有效的微信运动云数据凭据')
  }

  try {
    // 数据通过平台获取。客户端的 total、date、openid 等字段一概不使用。
    const response = await cloud.getOpenData({ list: [event.cloudID] })
    const item = response && response.list && response.list[0]
    const data = item && (item.data || item)
    if (!data || !Array.isArray(data.stepInfoList) || data.stepInfoList.length > 32) {
      return fail('INVALID_OPEN_DATA', '微信未返回有效的运动记录')
    }
    const watermark = data.watermark
    const now = Date.now()
    if (!watermark || watermark.appid !== context.APPID ||
      !Number.isFinite(watermark.timestamp) ||
      watermark.timestamp * 1000 > now + 5 * 60000 ||
      watermark.timestamp * 1000 < now - 2 * DAY_MS) {
      return fail('EXPIRED_OPEN_DATA', '运动数据已失效，请重新授权同步')
    }
    // 部分平台返回调用者字段时，也校验一致性；不接受客户端提供的身份。
    if (data.openid && data.openid !== context.OPENID) {
      return fail('IDENTITY_MISMATCH', '运动记录与当前用户不一致')
    }

    const today = chinaDate(now)
    let total = null
    for (const row of data.stepInfoList) {
      if (!row || !Number.isSafeInteger(row.timestamp) || row.timestamp < 0 ||
        !Number.isSafeInteger(row.step) || row.step < 0 || row.step > MAX_DAILY_STEPS) {
        return fail('INVALID_STEPS', '运动记录格式异常，请稍后重试')
      }
      const timestampMs = row.timestamp * 1000
      if (timestampMs > now + 5 * 60000 || timestampMs < now - 32 * DAY_MS) {
        return fail('INVALID_DATE', '运动记录日期异常，请重新同步')
      }
      if (chinaDate(timestampMs) === today) {
        // 同一天存在多条记录时取最大值，避免累加重复记录。
        total = total === null ? row.step : Math.max(total, row.step)
      }
    }
    if (total === null) {
      return fail('NO_TODAY_DATA', '尚未取得今天的微信运动记录，请稍后再来')
    }
    // 此函数仅提供授权步数，不发放资产；正式版还需服务端资产账本与限流。
    return { ok: true, total, date: today, source: 'werun', asOf: now }
  } catch (error) {
    // 不把开放数据、cloudID、定位或原始平台错误写入日志/响应。
    return fail('OPEN_DATA_FAILED', '暂时无法读取微信运动，请检查云函数配置后重试')
  }
}
