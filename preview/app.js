/* Browser companion for the native WeChat project. Both use the exact same engine. */
'use strict'
const Game = window.SproutGame
const KEY = 'yayawalk.preview.v1'
const A = '/miniprogram/assets/'
const tabs = [{ id: 'home', title: '我的花园', icon: 'home' }, { id: 'explore', title: '去散步', icon: 'map' }, { id: 'collection', title: '小伙伴', icon: 'leaf' }, { id: 'profile', title: '我的', icon: 'user' }]
let state, tab = 'home', pendingSlot = null, toastTimer
try { state = Game.normalizeState(JSON.parse(localStorage.getItem(KEY)) || Game.createState()) } catch { state = Game.createState() }
const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const icon = (name, cls = '') => `<img class="${cls}" src="${A}icons/${name}.svg" alt="">`
const pet = (image, cls = '', alt = '') => `<img class="${cls}" src="${A}pet-${e(image)}.svg" alt="${e(alt)}">`
const format = n => Number(n).toLocaleString('en-US')
function toast(message) { const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 3000) }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { toast('浏览器暂不能保存进度，请检查存储空间') } }
function dispatch(action) { const result = Game.act(state, action); state = result.state; save(); render(); if (result.message) toast(result.message); return result }
function modal(content) { document.querySelector('#modal-body').innerHTML = content; const node = document.querySelector('#modal'); if (!node.open) node.showModal() }
function closeModal() { document.querySelector('#modal').close() }
function information(title, copy, image = 'sprout') { modal(`${pet(image, 'modal-art')}<h2 class="modal-title">${e(title)}</h2><p class="modal-copy">${e(copy)}</p><div class="modal-actions"><button class="primary" data-action="close-modal">知道啦</button></div>`) }
function taskList(tasks) {
  return tasks.map(task => `<div class="task"><span class="task-check ${task.claimed ? 'done' : ''}">${task.claimed ? '✓' : '✧'}</span><div class="task-label"><div>${e(task.title)}</div><small>${task.id === 'walk-five' ? Math.floor(task.progress / 60) + ' / 5 分钟' : format(task.progress) + ' / ' + format(task.goal)} · ${e(task.rewardLabel)}</small></div><button class="task-button ${task.claimable ? 'claimable' : ''}" ${!task.claimable ? 'disabled' : ''} data-action="claim" data-id="${e(task.id)}">${task.claimed ? '已领取' : task.claimable ? '领取' : '进行中'}</button></div>`).join('')
}
function slots(view) {
  return view.slots.map(slot => slot.status === 'empty'
    ? `<article class="seed-slot empty"><span class="empty-pot">＋</span><h3>等一颗新花苗</h3><p>把期待种下去</p><button class="outline" data-action="plant" data-id="${e(slot.id)}">种下花苗</button></article>`
    : `<article class="seed-slot ${e(slot.status)}"><span class="slot-pill">${slot.status === 'ready' ? '可以见面啦' : '努力发芽中'}</span><img class="seed-art" src="${A}seedling.svg" alt="花盆里的幼苗"><h3>${e(slot.title)}</h3><div class="slot-track"><i style="width:${slot.progress}%"></i></div><p class="slot-help">${slot.status === 'ready' ? '新伙伴正在等你' : '还差 <strong>' + format(slot.remaining) + '</strong> 步，就能见面啦'}</p>${slot.status === 'ready' ? `<button class="soft-button" data-action="harvest" data-id="${e(slot.id)}">迎接新伙伴</button>` : ''}</article>`).join('')
}
function home(view) {
  return `<section class="greeting"><div><h1>嗨，散步家 ${icon('sun')}</h1><p>今天也一起慢慢长大吧，${e(view.selectedPet.name)}在等你。</p></div><button class="mode-chip" data-action="sync"><i></i>${view.isDemo ? '正在体验演示花园' : '微信运动花园'} ${icon('chevron')}</button></section>
  <div class="dashboard"><div class="main-column">
    <section class="hero"><div class="eyebrow">${icon('leaf')} 每一小步，都有小美好</div><h2>把今天的脚步，<br>种成小小的快乐。</h2><p>带上你的好奇心，和${e(view.selectedPet.name)}一起出发吧。</p><button class="primary" data-action="explore">${icon('walk')}带${e(view.selectedPet.name)}去散步${icon('arrow', 'arrow')}</button>${pet(view.selectedPet.image, 'hero-pet', view.selectedPet.name)}<img class="hero-sprout" src="${A}seedling.svg" alt=""><span class="spark">✦</span><span class="spark small">✧</span><img class="hero-flower" src="${A}flower.svg" alt=""><span class="hero-tag">一起，慢慢长大</span></section>
    <div class="section-heading"><h2>我的育苗小屋 <small>PLANT & GROW</small></h2><span>走路就会长大</span></div><section class="nursery" aria-label="育苗槽">${slots(view)}</section>
    <div class="section-heading"><h2>附近的小美好 <small>A LITTLE ADVENTURE</small></h2><button data-action="explore">去逛逛 ${icon('chevron')}</button></div>
    <section class="map-card"><img src="${A}walk-map.svg" alt="原创手绘公园演示地图"><span class="map-chip"><i></i>想象中的漫步小世界 · 演示</span>${pet(view.selectedPet.image, 'map-mini-pet')}<div class="map-label"><h3>下一份惊喜，在路上</h3><p>风吹过的地方，会有小花开放</p></div><button class="map-arrow" data-action="explore" aria-label="探索演示地图">${icon('arrow')}</button></section>
  </div><aside class="right-column">
    <section class="card steps-card"><div class="card-title"><span>${icon('walk')} 今日步数</span><span class="tiny-tag">${view.isDemo ? '演示数据' : '微信运动'}</span></div><div class="step-count">${format(view.steps)}</div><div class="step-target">/ ${format(view.stepGoal)} 步，今天的小目标</div><div class="track"><i style="width:${view.stepProgress}%"></i></div><div class="step-message"><span>${view.stepProgress >= 100 ? '今日目标达成，你很棒！' : '慢慢走，花会开的'}</span><strong>${view.stepProgress}%</strong></div><div class="stat-row"><div>${icon('drop')}<strong>${view.dew}</strong><small>小露珠</small></div><div>${icon('flower')}<strong>${view.flowers}</strong><small>已种花朵</small></div><div>${icon('leaf')}<strong>${view.collections}<span style="font-size:10px;color:#b0b89e"> / 3</span></strong><small>伙伴图鉴</small></div></div><button class="demo-add" data-action="add-steps">＋ 体验走路 · 增加 500 演示步数</button></section>
    <section class="task-panel"><div class="section-heading"><h2>今天的小约定</h2><button data-action="tasks">全部任务 ${icon('chevron')}</button></div><div class="card tasks-card">${taskList(view.tasks.slice(0, 3))}</div></section>
    <section class="companion-card"><h3>给${e(view.selectedPet.name)}一点甜</h3><p>一滴露珠，一点亲近。<br>今天也被好好陪伴着。</p><button data-action="feed" data-id="${e(view.selectedPet.id)}">喂露珠 · 5 颗 ↗</button>${pet('peach', '', '蜜桃小伙伴')}</section><p class="small-tip">${icon('heart')} 不必走得很远，快乐也可以很近。</p>
  </aside></div>`
}
function explore(view) {
  return `<div class="subpage-intro"><h1>去散步吧</h1><p>世界很大，先从身边的一小步开始。</p></div><div class="notice">这里是演示地图与模拟散步，不代表真实地点、步数或轨迹。</div><div class="explore-layout"><section class="big-map"><img class="world" src="${A}walk-map.svg" alt="有草坪、池塘和步道的原创公园插画">${pet(view.selectedPet.image, 'map-mini-pet ' + (view.walking ? 'walking' : ''), '陪你散步的小伙伴')}<div class="map-caption">小芽公园 · 想象中的目的地</div></section><div><section class="card walk-card"><div class="eyebrow">${view.walking ? '小伙伴正在陪你漫步' : '给自己一段放松的时间'}</div><h2>${view.walking ? '一起慢慢走' : '开启一段小小冒险'}</h2><div class="walk-stats"><div>${view.walk.minutes}<small>演示分钟</small></div><div>${view.walk.steps}<small>演示步数</small></div><div>${view.walk.flowers}<small>种下花朵</small></div></div><button class="primary full" data-action="walk">${icon('walk')}${view.walking ? '结束演示散步' : '开始演示散步'}</button>${view.walking ? '<button class="outline full" data-action="advance">演示前进 1 分钟</button>' : ''}<p class="walk-note">点击前进体验种花，关闭页面不会自动增长。<br>不会写入微信运动数据。</p></section><section class="card location-info"><h3>走进真实的身边</h3><p>微信版本可在你主动点击后，获取一次位置并显示真实地图。当前浏览器仅用于体验画面与玩法。</p><button class="link-button" data-action="locate">了解定位功能 ↗</button></section></div></div>`
}
function collection(view) {
  const discovered = new Set(view.pets.map(p => p.species))
  return `<div class="subpage-intro"><h1>小小伙伴，大大陪伴</h1><p>每一次相遇，都值得好好收藏。</p></div><section class="pet-hero">${pet(view.selectedPet.image, '', view.selectedPet.name)}<div><h2>${e(view.selectedPet.name)}</h2><p>${e(view.selectedPet.mood)} · 亲密度 ${view.selectedPet.friendship}</p><button class="primary" data-action="feed" data-id="${e(view.selectedPet.id)}">${icon('drop')}喂露珠 · 5 颗</button></div><div class="collection-count"><strong>${view.collections} / 3</strong><small>已遇见的伙伴种类</small></div></section><div class="section-heading"><h2>我的伙伴 <small>${view.totalPets} FRIENDS</small></h2><span>选一个，陪你一起出发</span></div><section class="pet-grid">${view.pets.map(p => `<article class="pet-card ${p.selected ? 'selected' : ''}">${p.selected ? '<span class="selected-pill">正在陪伴</span>' : ''}<button class="select-pet" data-action="select-pet" data-id="${e(p.id)}" aria-label="选择${e(p.name)}">${pet(p.image, '', p.name)}<h3>${e(p.name)}</h3></button><p>亲密度 ${p.friendship}</p><button class="outline" data-action="feed" data-id="${e(p.id)}">喂露珠 · 5 颗</button></article>`).join('')}${view.seedTypes.filter(s => !discovered.has(s.id)).map(s => `<article class="pet-card locked">${pet(s.id)}<h3>还没见过的${s.id === 'peach' ? '桃桃' : '菇咕'}</h3><p>培育${e(s.name)}，等待一次相遇</p></article>`).join('')}</section><div class="section-heading"><h2>花苗小铺 <small>SEED SHOP</small></h2><span>用小露珠，换一份新期待</span></div><section class="shop-grid">${view.seedTypes.map(s => `<article class="card shop-item">${pet(s.id)}<div><h3>${e(s.name)}</h3><p>拥有 ${view.inventory[s.id]} 颗 · ${format(s.required)} 步长大</p></div><button class="outline" data-action="buy" data-id="${s.id}">${s.cost} 露珠</button></article>`).join('')}</section>`
}
function profile(view) {
  const settings = [{ action: 'sync', title: '连接微信运动' }, { action: 'privacy', title: '隐私与数据说明' }, { action: 'about', title: '关于芽芽漫步' }, { action: 'share', title: '邀请朋友看看花园' }, { action: 'reset', title: '重新开始本机花园' }]
  return `<div class="profile-layout"><section class="card profile-card">${pet('sprout', '', '芽芽')}<h1>你好，散步家</h1><p>Lv.${view.level} · 今天也在好好长大</p><div class="stat-row"><div><strong>${view.streak}</strong><small>连续漫步天</small></div><div><strong>${view.totalPets}</strong><small>相遇的小伙伴</small></div><div><strong>${view.flowers}</strong><small>留下的小花</small></div></div></section><section class="card settings">${settings.map(s => `<button data-action="${s.action}" class="${s.action === 'reset' ? 'danger' : ''}"><span>${s.title}</span>${icon('chevron')}</button>`).join('')}</section><p class="local-note">当前是浏览器演示，存档仅保存在本浏览器<br>微信版本请导入仓库中的 project.config.json<br>原创小小世界，感谢你来散步。</p></div>`
}
function render() {
  state = Game.normalizeState(state)
  const view = Game.getView(state)
  document.querySelector('#navigation').innerHTML = tabs.map(t => `<button class="nav-button ${tab === t.id ? 'active' : ''}" data-action="${t.id}">${icon(t.icon)}${t.title}</button>`).join('')
  document.querySelector('#mobile-navigation').innerHTML = tabs.map(t => `<button class="mobile-tab ${tab === t.id ? 'active' : ''}" data-action="${t.id}"><span>${icon(t.icon)}</span>${t.title}</button>`).join('')
  document.querySelector('#page-title').textContent = tabs.find(t => t.id === tab).title
  document.querySelector('#app').innerHTML = ({ home, explore, collection, profile })[tab](view)
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]')
  if (!button || button.disabled) return
  const { action, id } = button.dataset
  if (tabs.some(t => t.id === action)) { tab = action; render(); window.scrollTo({ top: 0, behavior: 'instant' }); return }
  if (action === 'close-modal') return closeModal()
  if (action === 'add-steps') return dispatch({ type: 'ADD_STEPS', amount: 500 })
  if (action === 'plant') {
    pendingSlot = id
    const view = Game.getView(state)
    return modal(`<h2 class="modal-title">种下一点新期待</h2><p class="modal-copy">选一颗花苗，让脚步陪它慢慢长大。</p>${view.seedTypes.map(s => `<div class="seed-option">${pet(s.id)}<div><h3>${e(s.name)}</h3><p>${format(s.required)} 步长大 · 拥有 ${view.inventory[s.id]} 颗</p></div><button class="outline" data-action="plant-seed" data-id="${s.id}" ${!view.inventory[s.id] ? 'disabled' : ''}>种下</button></div>`).join('')}`)
  }
  if (action === 'plant-seed') { dispatch({ type: 'PLANT', slotId: pendingSlot, seedType: id }); closeModal(); return }
  if (action === 'harvest') {
    const result = dispatch({ type: 'HARVEST', slotId: id })
    if (result.kind === 'success') { const view = Game.getView(state); const newest = view.pets[view.pets.length - 1]; information('你好呀，新伙伴！', `${newest.name}已经加入你的花园。到“小伙伴”里选它，就能一起去散步啦。`, newest.image) }
    return
  }
  if (action === 'claim') { dispatch({ type: 'CLAIM_TASK', taskId: id }); if (document.querySelector('#modal').open) modal(`<h2 class="modal-title">今天的小约定</h2>${taskList(Game.getView(state).tasks)}`); return }
  if (action === 'feed') return dispatch({ type: 'FEED', petId: id })
  if (action === 'select-pet') return dispatch({ type: 'SELECT_PET', petId: id })
  if (action === 'buy') return dispatch({ type: 'BUY_SEED', seedType: id })
  if (action === 'walk') return dispatch({ type: Game.getView(state).walking ? 'STOP_WALK' : 'START_WALK' })
  if (action === 'advance') return dispatch({ type: 'TICK_WALK', seconds: 60 })
  if (action === 'tasks') return modal(`<h2 class="modal-title">今天的小约定</h2>${taskList(Game.getView(state).tasks)}`)
  if (action === 'sync') return information('把脚步带进花园', '微信运动需在微信版本中连接。在开发者工具中填写你的 AppID、云环境 ID，部署 syncSteps 云函数并完成隐私配置，即可进入独立的微信步数花园。浏览器演示不会请求或伪造微信数据。')
  if (action === 'locate') return information('只在你愿意时，看看位置', '请在微信版本点击“获取一次当前位置”。只显示一次真实地图，不保存或上传行程。这里的手绘地图和散步进度均为演示。')
  if (action === 'privacy') return information('你的花园，由你掌握', '浏览器演示只在本机保存游戏进度，不请求位置和运动权限。清理浏览器数据可能丢失存档。微信版本在你主动点击时才申请对应权限；演示与微信资产分开，不上传位置或共享陌生人坐标。')
  if (action === 'about') return information('芽芽漫步 YAYA WALK', '一个原创的可爱步行养成原型。走一点路，养一株花苗，认识一位新伙伴。浏览器与微信版本共用同一套玩法引擎；当前不含支付、交易或后台轨迹采集。')
  if (action === 'reset') return modal(`${pet('sprout', 'modal-art')}<h2 class="modal-title">重新种一座花园？</h2><p class="modal-copy">这会清除本浏览器的游戏进度。<br>要和小芽重新认识一次吗？</p><div class="modal-actions"><button class="outline" data-action="close-modal">再想想</button><button class="primary" data-action="confirm-reset">重新开始</button></div>`)
  if (action === 'confirm-reset') { state = Game.createState(); save(); closeModal(); render(); toast('新花园准备好啦'); return }
  if (action === 'share') {
    try { if (navigator.share) await navigator.share({ title: '芽芽漫步', text: '每一小步，都有小美好', url: location.href }); else { await navigator.clipboard.writeText(location.href); toast('预览地址已复制，开发服务需保持运行') } }
    catch { toast('可以使用浏览器分享，或在微信版本转发小程序') }
  }
})
document.querySelector('#modal').addEventListener('click', event => { if (event.target.id === 'modal') { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal() } })
render()
