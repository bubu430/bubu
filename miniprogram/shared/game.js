(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SproutGame = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var VERSION = 1;
  var MAX_STEPS = 200000;
  var SEEDS = [
    { id: 'sprout', name: '小芽种子', petName: '芽芽', required: 1500, cost: 12, color: '#80ac79', description: '一片嫩叶，一点小小的勇气。' },
    { id: 'peach', name: '蜜桃种子', petName: '桃桃', required: 3000, cost: 20, color: '#e8a18c', description: '把今天的阳光，酿成甜甜的桃子。' },
    { id: 'mushroom', name: '蘑菇种子', petName: '菇菇', required: 5000, cost: 28, color: '#bd967a', description: '森林里的慢性子，正等着认识你。' }
  ];
  var TASKS = [
    { id: 'steps-1000', title: '轻轻走一走', description: '今天累计走 1,000 步', metric: 'steps', goal: 1000, reward: 10 },
    { id: 'steps-3000', title: '今天也在发芽', description: '今天累计走 3,000 步', metric: 'steps', goal: 3000, reward: 20 },
    { id: 'plant-one', title: '种下一点期待', description: '在花园种下一颗种子', metric: 'planted', goal: 1, reward: 8 },
    { id: 'feed-one', title: '给伙伴一滴甜', description: '喂养一次小伙伴', metric: 'fed', goal: 1, reward: 5 },
    { id: 'walk-five', title: '和风散个步', description: '体验 5 分钟模拟散步', metric: 'walkSeconds', goal: 300, reward: 15, mode: 'demo' }
  ];

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function integer(value, fallback, max) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(max === undefined ? 100000000 : max, Math.floor(number)));
  }
  function dateValue(now) {
    var date = now === undefined ? new Date() : new Date(now);
    return Number.isFinite(date.getTime()) ? date : new Date();
  }
  // Mainland launch prototype: all daily accounting uses Asia/Shanghai, not device timezone.
  function dayKey(now) { return new Date(dateValue(now).getTime() + 8 * 3600000).toISOString().slice(0, 10); }
  function validDay(value) { return typeof value === 'string' && /^20\d\d-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')); }
  function daysApart(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000); }
  function seedFor(type) { return SEEDS.find(function (seed) { return seed.id === type; }); }
  function emptyDay() { return { steps: 0, planted: 0, fed: 0, walkSeconds: 0, claimedTasks: [] }; }
  function currentDay(world, day) {
    if (!world.days[day]) world.days[day] = emptyDay();
    return world.days[day];
  }

  function makeWorld(mode, day) {
    var demo = mode === 'demo';
    var daily = emptyDay();
    daily.steps = demo ? 3280 : 0;
    var days = {};
    days[day] = daily;
    return {
      days: days,
      lifetimeSteps: demo ? 3280 : 0,
      dew: demo ? 32 : 20,
      flowers: demo ? 86 : 0,
      inventory: { sprout: 3, peach: 1, mushroom: 1 },
      slots: [
        { id: 'slot-1', type: 'sprout', grownSteps: demo ? 1100 : 0 },
        { id: 'slot-2', type: null, grownSteps: 0 },
        { id: 'slot-3', type: null, grownSteps: 0 }
      ],
      pets: [{ id: 'pet-1', name: '芽芽', species: 'sprout', friendship: 20 }],
      selectedPetId: 'pet-1',
      nextPetId: 2,
      streak: demo ? 3 : 0,
      lastActivityDay: demo ? day : null,
      walk: { active: false, seconds: 0, steps: 0, flowers: 0 }
    };
  }

  function createState(now) {
    var day = dayKey(now);
    return { version: VERSION, mode: 'demo', worlds: { demo: makeWorld('demo', day), werun: makeWorld('werun', day) } };
  }

  function normalizeWorld(raw, mode, day) {
    var world = makeWorld(mode, day);
    if (!raw || typeof raw !== 'object') return world;
    world.days = {};
    Object.keys(raw.days || {}).filter(validDay).sort().slice(-40).forEach(function (key) {
      var source = raw.days[key] || {};
      world.days[key] = {
        steps: integer(source.steps, 0, MAX_STEPS),
        planted: integer(source.planted, 0),
        fed: integer(source.fed, 0),
        walkSeconds: integer(source.walkSeconds, 0),
        claimedTasks: Array.isArray(source.claimedTasks) ? TASKS.filter(function (task) { return source.claimedTasks.indexOf(task.id) !== -1; }).map(function (task) { return task.id; }) : []
      };
    });
    currentDay(world, day);
    world.lifetimeSteps = integer(raw.lifetimeSteps, 0);
    world.dew = integer(raw.dew, 0);
    world.flowers = integer(raw.flowers, 0);
    SEEDS.forEach(function (seed) { world.inventory[seed.id] = integer(raw.inventory && raw.inventory[seed.id], 0, 999); });
    world.slots = ['slot-1', 'slot-2', 'slot-3'].map(function (id) {
      var source = Array.isArray(raw.slots) ? raw.slots.find(function (slot) { return slot && slot.id === id; }) : null;
      var seed = source && seedFor(source.type);
      return { id: id, type: seed ? seed.id : null, grownSteps: seed ? integer(source.grownSteps, 0, seed.required) : 0 };
    });
    var seen = {};
    world.pets = (Array.isArray(raw.pets) ? raw.pets : []).filter(function (pet) {
      if (!pet || !seedFor(pet.species) || typeof pet.id !== 'string' || seen[pet.id]) return false;
      seen[pet.id] = true;
      return true;
    }).slice(0, 1000).map(function (pet) {
      return { id: pet.id, name: typeof pet.name === 'string' ? pet.name.slice(0, 24) : seedFor(pet.species).petName, species: pet.species, friendship: integer(pet.friendship, 0, 100) };
    });
    if (!world.pets.length) world.pets = makeWorld(mode, day).pets;
    world.selectedPetId = world.pets.some(function (pet) { return pet.id === raw.selectedPetId; }) ? raw.selectedPetId : world.pets[0].id;
    world.nextPetId = Math.max(integer(raw.nextPetId, 2), world.pets.reduce(function (max, pet) { return Math.max(max, integer(pet.id.replace('pet-', ''), 0) + 1); }, 2));
    world.streak = integer(raw.streak, 0);
    world.lastActivityDay = validDay(raw.lastActivityDay) ? raw.lastActivityDay : null;
    var walk = raw.walk || {};
    world.walk = { active: mode === 'demo' && walk.active === true, seconds: integer(walk.seconds, 0), steps: integer(walk.steps, 0), flowers: integer(walk.flowers, 0) };
    return world;
  }

  function normalizeState(state, now) {
    if (!state || state.version !== VERSION || !state.worlds) return createState(now);
    var day = dayKey(now);
    return {
      version: VERSION,
      mode: state.mode === 'werun' ? 'werun' : 'demo',
      worlds: { demo: normalizeWorld(state.worlds.demo, 'demo', day), werun: normalizeWorld(state.worlds.werun, 'werun', day) }
    };
  }

  function taskViews(world, day, mode) {
    var daily = currentDay(world, day);
    return TASKS.filter(function (task) { return !task.mode || task.mode === mode; }).map(function (task) {
      var progress = Math.min(task.goal, daily[task.metric]);
      var claimed = daily.claimedTasks.indexOf(task.id) !== -1;
      return { id: task.id, title: task.title, description: task.description, progress: progress, goal: task.goal, progressPercent: Math.min(100, Math.round(progress / task.goal * 100)), reward: task.reward, rewardLabel: task.reward + ' 露珠', claimable: progress >= task.goal && !claimed, claimed: claimed };
    });
  }

  function getView(state, now) {
    var clean = normalizeState(state, now);
    var world = clean.worlds[clean.mode];
    var day = dayKey(now);
    var daily = currentDay(world, day);
    var pets = world.pets.map(function (pet) {
      return { id: pet.id, name: pet.name, species: pet.species, image: pet.species, friendship: pet.friendship, selected: pet.id === world.selectedPetId, mood: pet.friendship >= 80 ? '最喜欢和你一起了' : pet.friendship >= 40 ? '今天也很喜欢你' : '想和你一起散步' };
    });
    return {
      mode: clean.mode,
      isDemo: clean.mode === 'demo',
      date: day,
      steps: daily.steps,
      stepGoal: 6000,
      stepProgress: Math.min(100, Math.round(daily.steps / 6000 * 100)),
      dew: world.dew,
      flowers: world.flowers,
      level: 1 + Math.floor(world.lifetimeSteps / 5000),
      streak: world.lastActivityDay && daysApart(day, world.lastActivityDay) <= 1 ? world.streak : 0,
      pets: pets,
      selectedPet: pets.find(function (pet) { return pet.selected; }),
      slots: world.slots.map(function (slot) {
        var seed = seedFor(slot.type);
        return { id: slot.id, type: slot.type, status: !seed ? 'empty' : slot.grownSteps >= seed.required ? 'ready' : 'growing', title: seed ? seed.name : '种下一点期待', image: seed ? seed.id : 'sprout', progress: seed ? Math.min(100, Math.round(slot.grownSteps / seed.required * 100)) : 0, remaining: seed ? Math.max(0, seed.required - slot.grownSteps) : 0, required: seed ? seed.required : 0, grownSteps: slot.grownSteps };
      }),
      tasks: taskViews(world, day, clean.mode),
      inventory: copy(world.inventory),
      walking: world.walk.active,
      walk: { seconds: world.walk.seconds, steps: world.walk.steps, flowers: world.walk.flowers, minutes: Math.floor(world.walk.seconds / 60), distanceKm: (world.walk.steps * 0.00065).toFixed(2) },
      collections: SEEDS.filter(function (seed) { return pets.some(function (pet) { return pet.species === seed.id; }); }).length,
      collectionTotal: SEEDS.length,
      totalPets: pets.length,
      seedTypes: SEEDS.map(function (seed) { return { id: seed.id, type: seed.id, name: seed.name, title: seed.name, description: seed.description, image: seed.id, required: seed.required, steps: seed.required, cost: seed.cost, color: seed.color, owned: world.inventory[seed.id] }; })
    };
  }

  function creditSteps(world, day, amount) {
    var daily = currentDay(world, day);
    var delta = Math.max(0, Math.min(MAX_STEPS - daily.steps, amount));
    if (!delta) return 0;
    daily.steps += delta;
    world.lifetimeSteps += delta;
    world.slots.forEach(function (slot) {
      var seed = seedFor(slot.type);
      if (seed) slot.grownSteps = Math.min(seed.required, slot.grownSteps + delta);
    });
    if (world.lastActivityDay !== day) {
      world.streak = world.lastActivityDay && daysApart(day, world.lastActivityDay) === 1 ? world.streak + 1 : 1;
      world.lastActivityDay = day;
    }
    return delta;
  }

  function act(input, action, now) {
    var state = normalizeState(input, now);
    var day = dayKey(now);
    action = action || {};
    function result(message, kind) { return { state: state, message: message, kind: kind || 'success' }; }
    if (action.type === 'ADD_STEPS') state.mode = 'demo';
    if (action.type === 'SYNC_STEPS') {
      if (action.source && action.source !== 'werun') return result('请通过微信运动同步真实步数', 'error');
      if (action.date && action.date !== day) return result('当前仅结算今天的微信运动步数', 'info');
      if (!Number.isFinite(action.total) || action.total < 0 || action.total > MAX_STEPS) return result('步数数据不完整，请稍后重试', 'error');
      state.mode = 'werun';
      var realWorld = state.worlds.werun;
      var realDaily = currentDay(realWorld, day);
      var added = creditSteps(realWorld, day, Math.max(0, Math.floor(action.total) - realDaily.steps));
      return result(added ? '微信运动已同步，新增 ' + added + ' 步' : '今天的微信运动步数已是最新', added ? 'success' : 'info');
    }
    var world = state.worlds[state.mode];
    var daily = currentDay(world, day);
    var slot;
    var seed;
    var pet;
    switch (action.type) {
      case 'ADD_STEPS': {
        var amount = action.amount === undefined ? 500 : action.amount;
        if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) return result('每次体验可增加 1–10,000 模拟步', 'error');
        var delta = creditSteps(world, day, Math.floor(amount));
        return result(delta ? '模拟走了 ' + delta + ' 步，小种子长大啦' : '今天的模拟步数已达到上限', delta ? 'success' : 'info');
      }
      case 'PLANT':
        slot = world.slots.find(function (item) { return item.id === action.slotId; });
        seed = seedFor(action.seedType || 'sprout');
        if (!slot || !seed) return result('请选择一个空花盆和种子', 'error');
        if (slot.type) return result('这盆小种子已经在努力长大啦', 'info');
        if (!world.inventory[seed.id]) return result('这种种子用完啦，去种子小铺看看吧', 'info');
        world.inventory[seed.id] -= 1;
        slot.type = seed.id;
        slot.grownSteps = 0;
        daily.planted += 1;
        return result('种下了' + seed.name + '，一起走走吧');
      case 'HARVEST':
        slot = world.slots.find(function (item) { return item.id === action.slotId; });
        seed = slot && seedFor(slot.type);
        if (!seed) return result('这只花盆还空着呢', 'info');
        if (slot.grownSteps < seed.required) return result('再走 ' + (seed.required - slot.grownSteps) + ' 步，就能见到新伙伴', 'info');
        var sameSpecies = world.pets.filter(function (item) { return item.species === seed.id; }).length;
        pet = { id: 'pet-' + world.nextPetId, name: seed.petName + (sameSpecies ? ' ' + (sameSpecies + 1) : ''), species: seed.id, friendship: 0 };
        world.nextPetId += 1;
        world.pets.push(pet);
        world.selectedPetId = pet.id;
        slot.type = null;
        slot.grownSteps = 0;
        world.dew += 8;
        return result('你好呀，' + pet.name + '！收获新伙伴和 8 露珠');
      case 'FEED':
        pet = world.pets.find(function (item) { return item.id === (action.petId || world.selectedPetId); });
        if (!pet) return result('还没有找到这位小伙伴', 'error');
        if (pet.friendship >= 100) return result(pet.name + '已经吃得饱饱的啦', 'info');
        if (world.dew < 5) return result('喂养需要 5 露珠，完成今日小事就能获得', 'info');
        world.dew -= 5;
        pet.friendship = Math.min(100, pet.friendship + 10);
        daily.fed += 1;
        return result(pet.name + '开心地晃了晃，亲密度 +10');
      case 'SELECT_PET':
        pet = world.pets.find(function (item) { return item.id === action.petId; });
        if (!pet) return result('还没有找到这位小伙伴', 'error');
        world.selectedPetId = pet.id;
        return result('今天就和' + pet.name + '一起出发');
      case 'BUY_SEED':
        seed = seedFor(action.seedType);
        if (!seed) return result('请选择一种种子', 'error');
        if (world.inventory[seed.id] >= 999) return result('种子口袋满啦，先种下一颗吧', 'info');
        if (world.dew < seed.cost) return result('还差 ' + (seed.cost - world.dew) + ' 露珠，做点今日小事吧', 'info');
        world.dew -= seed.cost;
        world.inventory[seed.id] += 1;
        return result('收到一颗' + seed.name);
      case 'CLAIM_TASK': {
        var task = taskViews(world, day, state.mode).find(function (item) { return item.id === action.taskId; });
        if (!task) return result('没有找到这件今日小事', 'error');
        if (task.claimed) return result('这份露珠已经收好啦', 'info');
        if (!task.claimable) return result('再努力一点点，就能领取露珠啦', 'info');
        daily.claimedTasks.push(task.id);
        world.dew += task.reward;
        return result('小事完成！收好 ' + task.reward + ' 露珠');
      }
      case 'START_WALK':
        if (state.mode !== 'demo') return result('散步地图目前为模拟体验，请切换体验模式后出发', 'info');
        if (world.walk.active) return result('正在散步中，慢慢走就好', 'info');
        world.walk = { active: true, seconds: 0, steps: 0, flowers: 0 };
        return result('模拟散步开始啦，一起把小路种满花');
      case 'STOP_WALK':
        if (!world.walk.active) return result('还没有开始散步哦', 'info');
        world.walk.active = false;
        return result('散步结束，留下了 ' + world.walk.flowers + ' 朵模拟小花');
      case 'TICK_WALK':
        if (state.mode !== 'demo' || !world.walk.active) return result('先开启一次模拟散步吧', 'info');
        var seconds = action.seconds === undefined ? 60 : action.seconds;
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) return result('散步时间有点不对，请重新试试', 'error');
        seconds = Math.floor(seconds);
        var walkSteps = creditSteps(world, day, Math.round(seconds * 1.6));
        world.walk.seconds += seconds;
        world.walk.steps += walkSteps;
        daily.walkSeconds += seconds;
        var totalFlowers = Math.floor(world.walk.steps / 25);
        world.flowers += Math.max(0, totalFlowers - world.walk.flowers);
        world.walk.flowers = totalFlowers;
        return result('风带来了 ' + walkSteps + ' 模拟步，还有路边的小花');
      default:
        return result('这项小惊喜还在准备中', 'info');
    }
  }

  return { createState: createState, normalizeState: normalizeState, getView: getView, act: act };
}));
