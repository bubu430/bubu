'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Game = require('../miniprogram/shared/game');
const NOW = '2026-10-29T04:00:00Z';
const NEXT_DAY = '2026-10-30T04:00:00Z';
const view = (state, now = NOW) => Game.getView(state, now);
const action = (state, data, now = NOW) => Game.act(state, data, now);

test('first demo walk matures a seedling and harvest is never duplicated', () => {
  const initial = Game.createState(NOW);
  const snapshot = JSON.stringify(initial);
  assert.equal(view(initial).slots[0].remaining, 400);
  const moved = action(initial, { type: 'ADD_STEPS', amount: 500 });
  assert.equal(JSON.stringify(initial), snapshot, 'reducers must not mutate persisted input');
  assert.equal(view(moved.state).slots[0].status, 'ready');
  const harvested = action(moved.state, { type: 'HARVEST', slotId: 'slot-1' });
  assert.equal(view(harvested.state).totalPets, 2);
  assert.equal(view(harvested.state).slots[0].status, 'empty');
  const repeated = action(harvested.state, { type: 'HARVEST', slotId: 'slot-1' });
  assert.equal(view(repeated.state).totalPets, 2);
  assert.equal(view(repeated.state).dew, view(harvested.state).dew);
});

test('planting consumes one seed and only future steps grow it', () => {
  let state = Game.createState(NOW);
  const before = view(state).inventory.peach;
  state = action(state, { type: 'PLANT', slotId: 'slot-2', seedType: 'peach' }).state;
  assert.equal(view(state).inventory.peach, before - 1);
  assert.equal(view(state).slots[1].remaining, 3000);
  const repeated = action(state, { type: 'PLANT', slotId: 'slot-2', seedType: 'peach' });
  assert.equal(view(repeated.state).inventory.peach, before - 1);
  state = action(state, { type: 'ADD_STEPS', amount: 500 }).state;
  assert.equal(view(state).slots[1].remaining, 2500);
  const premature = action(state, { type: 'HARVEST', slotId: 'slot-2' });
  assert.equal(view(premature.state).totalPets, 1);
});

test('demo and WeRun assets are independent and source totals are not added', () => {
  let state = Game.createState(NOW);
  state = action(state, { type: 'CLAIM_TASK', taskId: 'steps-1000' }).state;
  assert.equal(view(state).dew, 42);
  state = action(state, { type: 'SYNC_STEPS', total: 500, source: 'werun' }).state;
  assert.equal(view(state).mode, 'werun');
  assert.equal(view(state).steps, 500);
  assert.equal(view(state).dew, 20);
  assert.equal(view(state).slots[0].grownSteps, 500);
  state = action(state, { type: 'ADD_STEPS', amount: 500 }).state;
  assert.equal(view(state).mode, 'demo');
  assert.equal(view(state).steps, 3780);
  assert.equal(view(state).dew, 42);
});

test('WeRun sync credits only unseen steps, including lower and repeated updates', () => {
  let state = Game.createState(NOW);
  state = action(state, { type: 'SYNC_STEPS', total: 1200, source: 'werun' }).state;
  const snapshot = JSON.stringify(state.worlds.werun);
  state = action(state, { type: 'SYNC_STEPS', total: 1200, source: 'werun' }).state;
  assert.equal(JSON.stringify(state.worlds.werun), snapshot);
  state = action(state, { type: 'SYNC_STEPS', total: 900, source: 'werun' }).state;
  assert.equal(view(state).steps, 1200);
  assert.equal(view(state).slots[0].grownSteps, 1200);
  state = action(state, { type: 'SYNC_STEPS', total: 1500, source: 'werun' }).state;
  assert.equal(view(state).steps, 1500);
  assert.equal(view(state).slots[0].status, 'ready');
});

test('completed daily task rewards can only be claimed once', () => {
  const initial = Game.createState(NOW);
  const claimed = action(initial, { type: 'CLAIM_TASK', taskId: 'steps-3000' });
  assert.equal(view(claimed.state).dew, 52);
  const duplicate = action(claimed.state, { type: 'CLAIM_TASK', taskId: 'steps-3000' });
  assert.equal(view(duplicate.state).dew, 52);
  assert.equal(view(duplicate.state).tasks.find(t => t.id === 'steps-3000').claimed, true);
  const unfinished = action(initial, { type: 'CLAIM_TASK', taskId: 'walk-five' });
  assert.equal(view(unfinished.state).dew, 32);
});

test('new day resets daily goals but preserves pets, seedlings, inventory, and earned currency', () => {
  let state = Game.createState(NOW);
  state = action(state, { type: 'CLAIM_TASK', taskId: 'steps-1000' }).state;
  state = action(state, { type: 'PLANT', slotId: 'slot-2', seedType: 'mushroom' }).state;
  const next = Game.normalizeState(state, NEXT_DAY);
  assert.equal(view(next, NEXT_DAY).steps, 0);
  assert.equal(view(next, NEXT_DAY).dew, 42);
  assert.equal(view(next, NEXT_DAY).slots[0].grownSteps, 1100);
  assert.equal(view(next, NEXT_DAY).slots[1].type, 'mushroom');
  assert.equal(view(next, NEXT_DAY).inventory.mushroom, 0);
  assert.equal(view(next, NEXT_DAY).tasks.find(t => t.id === 'steps-1000').claimed, false);
  const moved = action(next, { type: 'ADD_STEPS', amount: 500 }, NEXT_DAY).state;
  assert.equal(view(moved, NEXT_DAY).streak, 4);
});

test('day accounting uses Shanghai midnight and retains old claims on clock rollback', () => {
  let state = Game.createState('2026-10-29T15:59:00Z');
  state = action(state, { type: 'CLAIM_TASK', taskId: 'steps-1000' }, '2026-10-29T15:59:00Z').state;
  assert.equal(view(state, '2026-10-29T16:01:00Z').steps, 0);
  state = Game.normalizeState(state, '2026-10-29T16:01:00Z');
  const rollback = action(state, { type: 'CLAIM_TASK', taskId: 'steps-1000' }, '2026-10-29T15:59:00Z');
  assert.equal(view(rollback.state, '2026-10-29T15:59:00Z').dew, 42);
});

test('WeRun old-day and malformed data cannot award progress or switch source', () => {
  const initial = Game.createState(NOW);
  for (const total of [-1, NaN, Infinity, 200001, '500']) {
    const rejected = action(initial, { type: 'SYNC_STEPS', total, source: 'werun' });
    assert.equal(rejected.kind, 'error');
    assert.equal(view(rejected.state).mode, 'demo');
  }
  const stale = action(initial, { type: 'SYNC_STEPS', total: 1000, date: '2026-10-28', source: 'werun' });
  assert.equal(view(stale.state).mode, 'demo');
  assert.equal(stale.state.worlds.werun.lifetimeSteps, 0);
});

test('simulation advances only while walking and does not pretend to collect GPS', () => {
  let state = Game.createState(NOW);
  state = action(state, { type: 'TICK_WALK', seconds: 60 }).state;
  assert.equal(view(state).steps, 3280);
  state = action(state, { type: 'START_WALK' }).state;
  state = action(state, { type: 'TICK_WALK', seconds: 300 }).state;
  assert.equal(view(state).walk.steps, 480);
  assert.equal(view(state).walk.minutes, 5);
  assert.equal(view(state).walk.flowers, 19);
  assert.equal(view(state).flowers, 105);
  assert.equal(view(state).tasks.find(t => t.id === 'walk-five').claimable, true);
  state = action(state, { type: 'STOP_WALK' }).state;
  const stoppedSteps = view(state).steps;
  state = action(state, { type: 'TICK_WALK', seconds: 60 }).state;
  assert.equal(view(state).steps, stoppedSteps);
  assert.equal(view(state).walking, false);
  assert.equal('coordinates' in view(state).walk, false);
});

test('real mode cannot generate simulated walking rewards', () => {
  let state = action(Game.createState(NOW), { type: 'SYNC_STEPS', total: 1000, source: 'werun' }).state;
  state = action(state, { type: 'START_WALK' }).state;
  state = action(state, { type: 'TICK_WALK', seconds: 600 }).state;
  assert.equal(view(state).walking, false);
  assert.equal(view(state).steps, 1000);
  assert.equal(view(state).flowers, 0);
  assert.equal(view(state).tasks.some(task => task.id === 'walk-five'), false, 'real players must not see an impossible demo-only task');
  const claimed = action(state, { type: 'CLAIM_TASK', taskId: 'walk-five' });
  assert.equal(view(claimed.state).dew, view(state).dew);
});

test('feeding, buying, and malformed storage cannot produce negative resources', () => {
  let state = Game.createState(NOW);
  for (let i = 0; i < 20; i++) state = action(state, { type: 'BUY_SEED', seedType: 'mushroom' }).state;
  assert.equal(view(state).dew, 4);
  const petBefore = view(state).pets[0].friendship;
  state = action(state, { type: 'FEED', petId: 'pet-1' }).state;
  assert.equal(view(state).dew, 4);
  assert.equal(view(state).pets[0].friendship, petBefore);
  state.worlds.demo.dew = -99;
  state.worlds.demo.inventory.sprout = -1;
  state = Game.normalizeState(state, NOW);
  assert.equal(view(state).dew, 0);
  assert.equal(view(state).inventory.sprout, 0);
});

test('JSON persistence round-trips assets and browser and WeChat exports use the same engine', () => {
  let state = Game.createState(NOW);
  state = action(state, { type: 'FEED', petId: 'pet-1' }).state;
  state = action(state, { type: 'START_WALK' }).state;
  assert.deepEqual(view(JSON.parse(JSON.stringify(state))), view(state));
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/shared/game'), 'utf8'), browser);
  assert.equal(typeof browser.window.SproutGame.act, 'function');
  assert.equal(browser.window.SproutGame.getView(browser.window.SproutGame.createState(NOW), NOW).steps, 3280);
});
