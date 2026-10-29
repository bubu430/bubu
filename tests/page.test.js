'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Game = require('../miniprogram/shared/game');

const NOW = '2026-10-29T04:00:00Z';
const PAGE_PATH = path.resolve(__dirname, '../miniprogram/pages/index');
const SAVE_KEY = 'yayawalk.save.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const event = dataset => ({ currentTarget: { dataset: dataset || {} } });
const clockedGame = {
  createState: () => Game.createState(NOW),
  normalizeState: state => Game.normalizeState(state, NOW),
  getView: state => Game.getView(state, NOW),
  act: (state, action) => Game.act(state, action, NOW),
};

function launch(options = {}) {
  const storage = options.storage || new Map();
  const calls = { writes: [], toasts: [], modals: [], actionSheets: [], scrolls: [] };
  const controls = { selectedSeed: 0, confirmModal: undefined };
  const platform = Object.assign({
    hasCloudConfig: () => false,
    syncWeRunSteps: async () => { throw new Error('尚未配置云开发'); },
    getCurrentLocation: async () => ({ latitude: 31.2304, longitude: 121.4737, accuracy: 25 }),
  }, options.platform);
  const wx = {
    getStorageSync(key) { return storage.has(key) ? clone(storage.get(key)) : undefined; },
    setStorageSync(key, value) {
      const saved = clone(value);
      storage.set(key, saved);
      calls.writes.push({ key, value: saved });
    },
    showToast(data) { calls.toasts.push(data); },
    showModal(data) {
      calls.modals.push(data);
      if (data.success && controls.confirmModal !== undefined) data.success({ confirm: controls.confirmModal, cancel: !controls.confirmModal });
    },
    showActionSheet(data) {
      calls.actionSheets.push(data);
      if (controls.selectedSeed !== null && data.success) data.success({ tapIndex: controls.selectedSeed });
    },
    pageScrollTo(data) { calls.scrolls.push(data); },
    // Privacy hooks are deliberately optional in this harness, as on older base libraries.
  };
  let definition;
  const context = {
    Page(value) { definition = value; },
    wx,
    require(request) {
      if (request === '../../shared/game') return clockedGame;
      if (request === '../../services/platform') return platform;
      throw new Error('Unexpected page dependency: ' + request);
    },
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(PAGE_PATH, 'index.js'), 'utf8'), context, { filename: 'miniprogram/pages/index/index.js' });
  assert.ok(definition, 'the native entry must register a Page');
  const page = Object.assign({}, definition, {
    data: clone(definition.data),
    setData(patch) { Object.assign(this.data, clone(patch)); },
  });
  page.onLoad();
  return { page, storage, calls, controls, platform, definition };
}

test('native page plays a complete garden loop and restores the same assets after reopening', () => {
  const { page, storage, calls, controls } = launch();
  assert.equal(page.data.view.steps, 3280);
  assert.equal(page.data.view.slots[0].status, 'growing');
  page.addSteps();
  assert.equal(page.data.view.steps, 3780);
  assert.equal(page.data.view.slots[0].status, 'ready');
  page.harvest(event({ slot: 'slot-1' }));
  assert.equal(page.data.view.totalPets, 2);
  assert.equal(page.data.view.slots[0].status, 'empty');
  const newPetId = page.data.view.selectedPet.id;
  assert.notEqual(newPetId, 'pet-1');

  controls.selectedSeed = 1; // Player explicitly picks a peach seed in the native action sheet.
  page.plant(event({ slot: 'slot-2' }));
  assert.equal(calls.actionSheets.length, 1);
  assert.match(calls.actionSheets[0].itemList[1], /蜜桃/);
  assert.equal(page.data.view.slots[1].type, 'peach');
  assert.equal(page.data.view.slots[1].grownSteps, 0);
  assert.equal(page.data.view.inventory.peach, 0);

  const dewBeforeFeed = page.data.view.dew;
  page.feed(event());
  assert.equal(page.data.view.selectedPet.id, newPetId);
  assert.equal(page.data.view.selectedPet.friendship, 10);
  assert.equal(page.data.view.dew, dewBeforeFeed - 5);
  page.claim(event({ task: 'feed-one' }));
  assert.equal(page.data.view.dew, dewBeforeFeed);
  page.claim(event({ task: 'feed-one' }));
  assert.equal(page.data.view.dew, dewBeforeFeed, 'a repeated native tap cannot double-claim');
  assert.ok(storage.has(SAVE_KEY));

  const reopened = launch({ storage });
  assert.deepEqual(reopened.page.data.view, page.data.view);
  assert.equal(reopened.calls.writes.length, 0, 'opening a save must not re-award or rewrite assets');
});

test('cancelling the seed picker does not consume or save a seed', () => {
  const { page, calls, controls } = launch();
  const snapshot = clone(page.data.view);
  controls.selectedSeed = null;
  page.plant(event({ slot: 'slot-2' }));
  assert.deepEqual(page.data.view, snapshot);
  assert.equal(calls.writes.length, 0);
});

test('a failed WeRun sync leaves both the saved garden and visible assets unchanged', async () => {
  const { page, storage, calls } = launch({ platform: {
    hasCloudConfig: () => true,
    syncWeRunSteps: async () => { throw new Error('用户没有同意微信运动授权'); },
  } });
  page.addSteps();
  const beforeSave = clone(storage.get(SAVE_KEY));
  const beforeView = clone(page.data.view);
  const beforeWrites = calls.writes.length;
  const pending = page.syncSteps();
  assert.equal(page.data.syncing, true);
  await pending;
  assert.equal(page.data.syncing, false);
  assert.deepEqual(page.data.view, beforeView);
  assert.deepEqual(storage.get(SAVE_KEY), beforeSave);
  assert.equal(calls.writes.length, beforeWrites);
  assert.equal(calls.modals.at(-1).title, '暂未同步');
  assert.match(calls.modals.at(-1).content, /授权/);
});

test('unconfigured WeRun explains setup without requesting data or changing progress', async () => {
  let requested = false;
  const { page, calls } = launch({ platform: {
    hasCloudConfig: () => false,
    syncWeRunSteps: async () => { requested = true; return { total: 9999, source: 'werun' }; },
  } });
  const before = clone(page.data.view);
  await page.syncSteps();
  assert.equal(requested, false);
  assert.equal(page.data.syncing, false);
  assert.deepEqual(page.data.view, before);
  assert.equal(calls.writes.length, 0);
  assert.match(calls.modals.at(-1).content, /AppID/);
});

test('successful native WeRun sync shows real totals without merging demo rewards', async () => {
  const { page, storage } = launch({ platform: {
    hasCloudConfig: () => true,
    syncWeRunSteps: async () => ({ total: 900, date: '2026-10-29', source: 'werun' }),
  } });
  page.claim(event({ task: 'steps-1000' }));
  const demoDew = page.data.view.dew;
  await page.syncSteps();
  assert.equal(page.data.view.isDemo, false);
  assert.equal(page.data.view.steps, 900);
  assert.equal(page.data.view.dew, 20);
  assert.equal(page.data.view.tasks.some(task => task.id === 'walk-five'), false);
  const firstSave = clone(storage.get(SAVE_KEY));
  await page.syncSteps();
  assert.deepEqual(storage.get(SAVE_KEY), firstSave, 'repeat sync must remain idempotent through the native page');
  page.addSteps();
  assert.equal(page.data.view.isDemo, true);
  assert.equal(page.data.view.steps, 3780);
  assert.equal(page.data.view.dew, demoDew);
});

test('one-shot location is transient and never enters a later game save', async () => {
  const { page, storage, calls } = launch();
  page.addSteps();
  const before = clone(storage.get(SAVE_KEY));
  const writes = calls.writes.length;
  await page.locate();
  assert.equal(page.data.located, true);
  assert.equal(page.data.location.latitude, 31.2304);
  assert.equal(page.data.location.longitude, 121.4737);
  assert.deepEqual(storage.get(SAVE_KEY), before);
  assert.equal(calls.writes.length, writes);
  page.addSteps();
  const saved = JSON.stringify(storage.get(SAVE_KEY));
  assert.doesNotMatch(saved, /latitude|longitude|31\.2304|121\.4737/);
  const reopened = launch({ storage });
  assert.equal(reopened.page.data.located, false);
  assert.equal(reopened.page.data.location, null);
});

test('denied location preserves the garden and does not show a real map', async () => {
  const { page, calls } = launch({ platform: {
    getCurrentLocation: async () => { throw new Error('定位未获授权'); },
  } });
  const before = clone(page.data.view);
  await page.locate();
  assert.equal(page.data.located, false);
  assert.equal(page.data.location, null);
  assert.deepEqual(page.data.view, before);
  assert.equal(calls.writes.length, 0);
  assert.match(calls.modals.at(-1).content, /授权/);
});

test('native walk controls persist only explicit simulated advances', () => {
  const { page, storage } = launch();
  page.explore();
  assert.equal(page.data.tab, 'explore');
  page.toggleWalk();
  assert.equal(page.data.view.walking, true);
  assert.equal(page.data.view.walk.steps, 0);
  page.advanceWalk();
  assert.equal(page.data.view.walk.minutes, 1);
  assert.equal(page.data.view.walk.steps, 96);
  page.toggleWalk();
  const steps = page.data.view.steps;
  page.advanceWalk();
  assert.equal(page.data.view.steps, steps);
  assert.equal(page.data.view.walking, false);
  assert.equal(launch({ storage }).page.data.view.walk.steps, 96);
});

function openingTags(markup) {
  const tags = [];
  let start = -1;
  let quote = '';
  for (let i = 0; i < markup.length; i++) {
    const char = markup[i];
    if (start === -1) {
      if (markup.startsWith('<!--', i)) { i = markup.indexOf('-->', i + 4) + 2; continue; }
      if (char === '<') start = i;
    } else if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') { tags.push(markup.slice(start, i + 1)); start = -1; }
  }
  assert.equal(start, -1, 'WXML must not have an unterminated tag');
  return tags;
}

test('WXML tags balance and every declared handler and top-level view field exists', () => {
  const { page, definition } = launch();
  const markup = fs.readFileSync(path.join(PAGE_PATH, 'index.wxml'), 'utf8');
  const stack = [];
  for (const tag of openingTags(markup)) {
    const match = tag.match(/^<(\/?)([\w:-]+)/);
    if (!match) continue;
    const closing = match[1] === '/';
    const name = match[2];
    if (closing) assert.equal(stack.pop(), name, 'WXML closing tag must match its opening tag: ' + tag);
    else if (!/\/\s*>$/.test(tag)) stack.push(name);
    for (const binding of tag.matchAll(/\b(?:bind|catch)(?::)?[\w-]+\s*=\s*["']([^"']+)["']/g)) {
      assert.equal(typeof definition[binding[1]], 'function', 'missing native event handler: ' + binding[1]);
    }
  }
  assert.deepEqual(stack, [], 'WXML must close all native components');
  for (const binding of markup.matchAll(/\bview\.([A-Za-z_$][\w$]*)/g)) {
    assert.ok(Object.hasOwn(page.data.view, binding[1]), 'missing game view field: ' + binding[1]);
  }
});
