const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

function load(scripts, window = {}) {
  const scope = { window };
  for (const script of scripts) {
    runInNewContext(readFileSync(path.join(__dirname, '../src', script), 'utf8'), scope);
    Object.assign(scope, window);
  }
  return window;
}

test('resolution requires sustained load, records peaks and recovers without oscillation', () => {
  const { PBResolution } = load(['core/resolution.js']);
  const changes = [];
  const resolution = PBResolution.create(.75, 1, true, scale => (changes.push(scale), true));
  for (let i = 0; i < 120; i++) resolution.update(i % 6 === 0 ? 23 : 14, false);
  assert.deepEqual(changes, []);
  for (let i = 0; i < 150; i++) resolution.update(25, true);
  assert.ok(resolution.scale < 1 && resolution.scale >= .75);
  assert.equal(resolution.snapshot().peakFrameMs, 25);
  for (let i = 0; i < 500; i++) resolution.update(15.8, false);
  assert.equal(resolution.scale, 1);
  assert.equal(resolution.snapshot().degraded, false);
  resolution.configure(false, .65);
  assert.equal(resolution.scale, .65);
  for (let i = 0; i < 150; i++) resolution.update(40, false);
  assert.equal(resolution.scale, .65);
  assert.equal(resolution.snapshot().enabled, false);
});

test('resolution keeps the last allocated target after a failed resize', () => {
  const { PBResolution } = load(['core/resolution.js']);
  const resolution = PBResolution.create(.75, 1, true, () => false);
  resolution.configure(false, .7);
  assert.equal(resolution.scale, 1);
  assert.match(resolution.reason, /分配失败/);
  assert.equal(resolution.snapshot().enabled, false);
});

test('mission advances after combat clears and the player enters the next sector', () => {
  const { PBEvents, PBMission } = load(['core/events.js', 'game/mission.js']);
  const bus = PBEvents.create();
  const visited = [];
  bus.on('mission.objectiveChange', event => visited.push(event.node));
  const flow = PBMission.create(bus);
  const wave = n => {
    flow.wave = n;
    flow.clearT = -1;
    flow.setNode('wave' + n);
  };
  const boss = () => flow.setNode('arrival');
  flow.reset();
  flow.update(1, 10, 0, wave, boss);
  assert.equal(flow.wave, 0);
  flow.update(1, 9, 0, wave, boss);
  flow.update(3, -26, 4, wave, boss);
  assert.equal(flow.node, 'wave1');
  flow.update(2.11, 7, 0, wave, boss);
  flow.update(1, 2, 0, wave, boss);
  assert.equal(flow.node, 'transit');
  flow.update(1, -12, 0, wave, boss);
  flow.update(2.11, -15, 0, wave, boss);
  flow.update(1, -23, 0, wave, boss);
  assert.deepEqual(visited, ['entrance', 'wave1', 'transit', 'wave2', 'approach', 'arrival']);
  assert.equal(PBMission.waves[1].length, 4);
  assert.equal(PBMission.waves[2].length, 6);
  assert.equal(PBMission.weapons[1].pellets, 5);
});

test('local storage tolerates corruption, migrates profile and keeps the best records', () => {
  const stored = new Map([['pixel-breach.settings', 'incomplete JSON']]);
  const { PBSettings } = load(['ui/settings.js'], {
    localStorage: { getItem: name => stored.get(name), setItem: (name, value) => stored.set(name, value) }
  });
  assert.equal(PBSettings.load().quality, 'high');
  const migrated = PBSettings.normalize({
    profile: 'balanced', mouseSensitivity: 2, fov: 400, volumes: { master: -.2 },
    bindings: { forward: 'KeyJ', jump: 'KeyJ' }
  });
  assert.equal(migrated.version, 8);
  assert.equal(migrated.quality, 'balanced');
  assert.equal(migrated.sensitivity, 2);
  assert.equal(migrated.fov, 100);
  assert.equal(migrated.volumes.master, 0);
  assert.equal(migrated.bindings.jump, 'Space');
  PBSettings.record(4, 31.2, 11, true);
  PBSettings.record(3, 18, 8, false);
  PBSettings.record(4, 28.7, 10, true);
  const records = PBSettings.records();
  assert.equal(records.bestTime, 28.7);
  assert.equal(records.bestKills, 11);
  assert.equal(records.progress, 4);
  assert.equal(records.clears, 2);
});
