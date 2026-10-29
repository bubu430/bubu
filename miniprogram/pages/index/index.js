const Game = require('../../shared/game')
const platform = require('../../services/platform')
const KEY = 'yayawalk.save.v1'

Page({
  data: { tab: 'home', view: null, syncing: false, located: false, location: null,
    privacyDialog: false, privacyContractName: '《芽芽漫步隐私保护指引》',
    tabs: [{ id: 'home', name: '我的花园', icon: 'home' }, { id: 'explore', name: '去散步', icon: 'map' }, { id: 'collection', name: '小伙伴', icon: 'leaf' }, { id: 'profile', name: '我的', icon: 'user' }] },
  onLoad() {
    this._privacyActive = true
    this._privacyResolvers = []
    this.bindPrivacyAuthorization()
    try { this.state = Game.normalizeState(wx.getStorageSync(KEY) || Game.createState()) }
    catch (e) { this.state = Game.createState(); wx.showToast({ title: '存档暂不可用，已进入新花园', icon: 'none' }) }
    this.refresh()
  },
  onShow() { if (this.state) this.refresh() },
  onUnload() {
    this._privacyActive = false
    this.finishPrivacyAuthorization(false)
  },
  bindPrivacyAuthorization() {
    if (typeof wx.onNeedPrivacyAuthorization !== 'function') return
    wx.onNeedPrivacyAuthorization((resolve) => {
      if (!this._privacyActive) {
        resolve({ event: 'disagree' })
        return
      }
      // 多个隐私接口同时等待时，用户的一次明确选择完成全部待决请求。
      this._privacyResolvers.push(resolve)
      this.setData({ privacyDialog: true })
      if (typeof wx.getPrivacySetting === 'function') {
        wx.getPrivacySetting({ success: result => {
          if (this._privacyActive && this.data.privacyDialog && result.privacyContractName) {
            this.setData({ privacyContractName: result.privacyContractName })
          }
        } })
      }
      resolve({ event: 'exposureAuthorization' })
    })
  },
  finishPrivacyAuthorization(agreed) {
    const pending = this._privacyResolvers || []
    this._privacyResolvers = []
    if (this._privacyActive) this.setData({ privacyDialog: false })
    pending.forEach(resolve => resolve(agreed
      ? { event: 'agree', buttonId: 'yaya-privacy-agree' }
      : { event: 'disagree' }))
  },
  agreePrivacyAuthorization() { this.finishPrivacyAuthorization(true) },
  declinePrivacyAuthorization() { this.finishPrivacyAuthorization(false) },
  preventPrivacyScroll() {},
  openPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showToast({ title: '请更新微信后查看隐私指引', icon: 'none' })
      return
    }
    wx.openPrivacyContract({ fail: () => {
      wx.showToast({ title: '暂未打开，请检查后台隐私配置', icon: 'none' })
    } })
  },
  refresh() { this.state = Game.normalizeState(this.state); this.setData({ view: Game.getView(this.state) }) },
  dispatch(action) {
    const result = Game.act(this.state, action)
    this.state = result.state
    this.refresh()
    try { wx.setStorageSync(KEY, this.state) } catch (e) { wx.showToast({ title: '保存失败，请检查设备空间', icon: 'none' }); return }
    if (result.message) wx.showToast({ title: result.message, icon: 'none', duration: 2200 })
  },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); wx.pageScrollTo({ scrollTop: 0, duration: 150 }) },
  explore() { this.setData({ tab: 'explore' }); wx.pageScrollTo({ scrollTop: 0, duration: 150 }) },
  addSteps() { this.dispatch({ type: 'ADD_STEPS', amount: 500 }) },
  plant(e) {
    const slotId = e.currentTarget.dataset.slot
    const seeds = this.data.view.seedTypes
    wx.showActionSheet({ itemList: seeds.map(seed => `${seed.name} · 剩余 ${this.data.view.inventory[seed.id]} 颗`),
      success: result => this.dispatch({ type: 'PLANT', slotId, seedType: seeds[result.tapIndex].id }) })
  },
  harvest(e) { this.dispatch({ type: 'HARVEST', slotId: e.currentTarget.dataset.slot }) },
  feed(e) { this.dispatch({ type: 'FEED', petId: e.currentTarget.dataset.pet || this.data.view.selectedPet.id }) },
  selectPet(e) { this.dispatch({ type: 'SELECT_PET', petId: e.currentTarget.dataset.pet }) },
  claim(e) { this.dispatch({ type: 'CLAIM_TASK', taskId: e.currentTarget.dataset.task }) },
  buy(e) { this.dispatch({ type: 'BUY_SEED', seedType: e.currentTarget.dataset.seed }) },
  toggleWalk() { this.dispatch({ type: this.data.view.walking ? 'STOP_WALK' : 'START_WALK' }) },
  advanceWalk() { this.dispatch({ type: 'TICK_WALK', seconds: 60 }) },
  async syncSteps() {
    if (this.data.syncing) return
    if (!platform.hasCloudConfig()) {
      wx.showModal({ title: '连接微信运动', content: '当前是可独立体验的演示版。请在开发者工具中填写自己的 AppID 和 config.js 的 cloudEnv，部署 syncSteps 云函数，并完成微信运动及隐私配置后使用。演示数据不会上传。', showCancel: false }); return
    }
    this.setData({ syncing: true })
    try { const data = await platform.syncWeRunSteps(); this.dispatch({ type: 'SYNC_STEPS', ...data }) }
    catch (error) { wx.showModal({ title: '暂未同步', content: error.message || '请稍后重试', showCancel: false }) }
    finally { this.setData({ syncing: false }) }
  },
  async locate() {
    try { const location = await platform.getCurrentLocation(); this.setData({ located: true, location }); wx.showToast({ title: '已定位，不会记录你的轨迹', icon: 'none' }) }
    catch (error) { wx.showModal({ title: '暂未获取位置', content: error.message || '你仍可体验模拟花园', showCancel: false }) }
  },
  about() { wx.showModal({ title: '关于芽芽漫步', content: '原创步行养成原型 v0.1.0。演示散步不代表真实轨迹或步数；当前存档保存在本机。无支付、无陌生人位置分享。微信真实步数需云开发配置。', showCancel: false }) },
  privacy() { wx.showModal({ title: '你的花园，由你掌握', content: '仅点击同步时请求运动数据，仅点击定位时请求一次位置。位置不会上传或持续追踪。游戏存档保存在本机，清理缓存后可能丢失。部署云函数后微信运动开放数据由云端校验，仅向客户端返回当日步数。本原型不跨设备同步资产。', showCancel: false }) },
  reset() {
    wx.showModal({ title: '重新种一座花园？', content: '将清除本机的演示与微信游戏进度，不会删除微信运动数据。', confirmText: '重新开始', confirmColor: '#bd6c43',
      success: result => { if (result.confirm) { this.state = Game.createState(); this.refresh(); wx.setStorageSync(KEY, this.state) } } })
  },
  onShareAppMessage() { return { title: '芽芽漫步 · 把今天的脚步，种成小小的快乐', path: '/pages/index/index' } }
})
