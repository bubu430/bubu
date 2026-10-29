'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const fixedNow = Date.parse('2026-10-29T16:20:00Z') // 北京时间10月30日00:20
const timestamp = Math.floor(Date.parse('2026-10-29T16:00:00Z') / 1000)

function loadModule(relativePath, imports, extra) {
  const sandbox = Object.assign({
    module: { exports: {} },
    exports: {},
    require(name) {
      if (Object.prototype.hasOwnProperty.call(imports, name)) return imports[name]
      throw new Error('Unexpected import: ' + name)
    },
  }, extra || {})
  sandbox.exports = sandbox.module.exports
  vm.runInNewContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), sandbox)
  return sandbox.module.exports
}

function openData(overrides) {
  return Object.assign({
    stepInfoList: [{ timestamp, step: 3456 }],
    watermark: { timestamp: Math.floor(fixedNow / 1000), appid: 'wx-test-app' },
  }, overrides || {})
}

function cloudFunction(data, options) {
  const settings = options || {}
  const calls = []
  class TestDate extends Date {
    static now() { return fixedNow }
  }
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    getWXContext() {
      return settings.context || { OPENID: 'caller-openid', APPID: 'wx-test-app' }
    },
    async getOpenData(request) {
      calls.push(request)
      if (settings.error) throw settings.error
      return { list: [{ data }] }
    },
  }
  return {
    run: loadModule('cloudfunctions/syncSteps/index.js', { 'wx-server-sdk': sdk }, { Date: TestDate }).main,
    calls,
  }
}

test('云函数只从微信开放数据读取步数，忽略客户端自报身份、日期和总量', async () => {
  const { run, calls } = cloudFunction(openData())
  const result = await run({ cloudID: 'authorized-cloud-id', total: 999999, date: '2099-01-01', openid: 'forged' })
  assert.equal(result.ok, true)
  assert.equal(result.total, 3456)
  assert.equal(result.date, '2026-10-30')
  assert.equal(result.source, 'werun')
  assert.equal(calls[0].list[0], 'authorized-cloud-id')
})

test('中国时区跨日、同日重复记录和重复同步不会把步数相加', async () => {
  const { run } = cloudFunction(openData({ stepInfoList: [
    { timestamp: timestamp - 86400, step: 12000 },
    { timestamp, step: 2000 },
    { timestamp, step: 3456 },
  ] }))
  const first = await run({ cloudID: 'same-id' })
  const second = await run({ cloudID: 'same-id' })
  assert.equal(first.total, 3456)
  assert.equal(second.total, first.total)
  assert.equal(first.date, '2026-10-30')
})

test('云函数拒绝无微信调用者上下文与空cloudID', async () => {
  const unauthenticated = cloudFunction(openData(), { context: {} })
  assert.equal((await unauthenticated.run({ cloudID: 'id' })).error.code, 'UNAUTHENTICATED')
  assert.equal(unauthenticated.calls.length, 0)
  const authenticated = cloudFunction(openData())
  assert.equal((await authenticated.run({})).error.code, 'INVALID_REQUEST')
  assert.equal(authenticated.calls.length, 0)
})

test('云函数拒绝其他App水印、过期数据以及不匹配用户', async () => {
  const wrongApp = cloudFunction(openData({ watermark: { appid: 'another-app', timestamp: fixedNow / 1000 } }))
  assert.equal((await wrongApp.run({ cloudID: 'id' })).error.code, 'EXPIRED_OPEN_DATA')
  const stale = cloudFunction(openData({ watermark: { appid: 'wx-test-app', timestamp: fixedNow / 1000 - 3 * 86400 } }))
  assert.equal((await stale.run({ cloudID: 'id' })).error.code, 'EXPIRED_OPEN_DATA')
  const wrongUser = cloudFunction(openData({ openid: 'another-openid' }))
  assert.equal((await wrongUser.run({ cloudID: 'id' })).error.code, 'IDENTITY_MISMATCH')
})

test('缺少当天记录时不拿昨天的数据或伪造零步替代', async () => {
  const { run } = cloudFunction(openData({ stepInfoList: [{ timestamp: timestamp - 86400, step: 1000 }] }))
  const result = await run({ cloudID: 'id' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'NO_TODAY_DATA')
})

test('云函数拒绝异常步数与未来记录，不泄露原始平台错误', async () => {
  for (const step of [-1, 1.5, 200001, '3456']) {
    const { run } = cloudFunction(openData({ stepInfoList: [{ timestamp, step }] }))
    assert.equal((await run({ cloudID: 'id' })).error.code, 'INVALID_STEPS')
  }
  const future = cloudFunction(openData({ stepInfoList: [{ timestamp: fixedNow / 1000 + 86400, step: 10 }] }))
  assert.equal((await future.run({ cloudID: 'id' })).error.code, 'INVALID_DATE')
  const failure = cloudFunction(openData(), { error: new Error('sensitive-internal-detail') })
  assert.equal(JSON.stringify(await failure.run({ cloudID: 'id' })).includes('sensitive-internal-detail'), false)
})

function platform(config, wx) {
  return loadModule('miniprogram/services/platform.js', { '../config': config }, { wx })
}

test('无云配置不会请求权限、登录或偷偷回退到模拟数据', async () => {
  let called = false
  const service = platform({ cloudEnv: '' }, { cloud: {}, login() { called = true } })
  assert.equal(service.hasCloudConfig(), false)
  await assert.rejects(service.syncWeRunSteps(), { code: 'CLOUD_NOT_CONFIGURED' })
  assert.equal(called, false)
})

test('运动同步按用户操作授权，传cloudID而非客户端明文步数', async () => {
  const calls = []
  const service = platform({ cloudEnv: 'test-env' }, {
    requirePrivacyAuthorize(options) { calls.push('privacy'); options.success({}) },
    login(options) { calls.push('login'); options.success({ code: 'test-code' }) },
    getWeRunData(options) { calls.push('werun'); options.success({ cloudID: 'authorized-id', encryptedData: 'not-forwarded' }) },
    cloud: {
      init() { calls.push('init') },
      async callFunction(options) {
        calls.push('cloud')
        assert.equal(options.name, 'syncSteps')
        assert.equal(options.data.cloudID, 'authorized-id')
        assert.equal(Object.keys(options.data).length, 1)
        return { result: { ok: true, total: 3456, date: '2026-10-30' } }
      },
    },
  })
  assert.equal(calls.length, 0)
  assert.equal(service.hasCloudConfig(), true)
  const result = await service.syncWeRunSteps()
  assert.equal(result.total, 3456)
  assert.equal(result.source, 'werun')
  assert.deepEqual(calls, ['privacy', 'init', 'login', 'werun', 'cloud'])
})

test('定位只在调用时单次获取GCJ02，拒绝授权会返回可理解错误', async () => {
  let requests = 0
  const service = platform({}, {
    getLocation(options) {
      requests += 1
      assert.equal(options.type, 'gcj02')
      options.success({ latitude: 31.2, longitude: 121.5, accuracy: 12 })
    },
  })
  assert.equal(requests, 0)
  const location = await service.getCurrentLocation()
  assert.equal(requests, 1)
  assert.equal(location.latitude, 31.2)
  const denied = platform({}, { getLocation(options) { options.fail({ errMsg: 'getLocation:fail auth deny' }) } })
  await assert.rejects(denied.getCurrentLocation(), { code: 'PERMISSION_DENIED' })
})

function loadPage(service, overrides) {
  const game = require('../miniprogram/shared/game')
  let definition
  let privacyHandler
  const modals = []
  const wx = Object.assign({
    getStorageSync() { return '' },
    setStorageSync() {},
    showToast() {},
    showModal(options) { modals.push(options) },
    onNeedPrivacyAuthorization(handler) { privacyHandler = handler },
  }, overrides || {})
  loadModule('miniprogram/pages/index/index.js', {
    '../../shared/game': game,
    '../../services/platform': service || {},
  }, { wx, Page(value) { definition = value } })
  definition.setData = function (update) { Object.assign(this.data, update) }
  definition.onLoad()
  return { page: definition, modals, requestPrivacy: resolve => privacyHandler(resolve) }
}

test('页面初始化仅注册隐私监听，用户点击之前不查询或请求隐私授权', () => {
  let privacyQueries = 0
  const { page, requestPrivacy } = loadPage({}, {
    getPrivacySetting(options) {
      privacyQueries += 1
      options.success({ privacyContractName: '《测试隐私指引》' })
    },
  })
  assert.equal(privacyQueries, 0)
  assert.equal(page.data.privacyDialog, false)
  const resolutions = []
  requestPrivacy(result => resolutions.push(result))
  assert.equal(privacyQueries, 1)
  assert.equal(page.data.privacyDialog, true)
  assert.equal(page.data.privacyContractName, '《测试隐私指引》')
  assert.equal(resolutions[0].event, 'exposureAuthorization')
  page.agreePrivacyAuthorization()
  assert.equal(page.data.privacyDialog, false)
  assert.equal(resolutions[1].event, 'agree')
  assert.equal(resolutions[1].buttonId, 'yaya-privacy-agree')
})

test('拒绝隐私授权会完成所有等待请求，重复点击不会重复完成', () => {
  const { page, requestPrivacy } = loadPage()
  const first = []
  const second = []
  requestPrivacy(result => first.push(result.event))
  requestPrivacy(result => second.push(result.event))
  page.declinePrivacyAuthorization()
  page.declinePrivacyAuthorization()
  assert.deepEqual(first, ['exposureAuthorization', 'disagree'])
  assert.deepEqual(second, ['exposureAuthorization', 'disagree'])
  assert.equal(page.data.privacyDialog, false)
})

test('运动或定位授权失败不改变已保存游戏资产，也不写入假定位', async () => {
  const denied = () => Promise.reject(Object.assign(new Error('用户拒绝授权'), { code: 'PERMISSION_DENIED' }))
  const { page, modals } = loadPage({
    hasCloudConfig() { return true },
    syncWeRunSteps: denied,
    getCurrentLocation: denied,
  })
  const stateBefore = JSON.stringify(page.state)
  await page.syncSteps()
  await page.locate()
  assert.equal(JSON.stringify(page.state), stateBefore)
  assert.equal(page.data.syncing, false)
  assert.equal(page.data.located, false)
  assert.equal(page.data.location, null)
  assert.equal(modals.length, 2)
})

test('页面销毁时拒绝待决请求，晚到的隐私事件不重新打开弹窗', () => {
  const { page, requestPrivacy } = loadPage()
  const beforeUnload = []
  requestPrivacy(result => beforeUnload.push(result.event))
  page.onUnload()
  assert.deepEqual(beforeUnload, ['exposureAuthorization', 'disagree'])
  assert.equal(page._privacyResolvers.length, 0)
  const late = []
  requestPrivacy(result => late.push(result.event))
  assert.deepEqual(late, ['disagree'])
})
