const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function makeAssets() {
  const window = {};
  vm.runInNewContext(readFileSync(path.join(__dirname, '../src/core/assets.js'), 'utf8'), { window });
  return window.PBAssets.create();
}

test('registers assets in namespaces and returns the same value on duplicate registration', () => {
  const assets = makeAssets();
  const first = { kind: 'texture' };
  let loads = 0;
  assert.equal(assets.register('materials', 'steel', () => { loads++; return first; }), first);
  assert.equal(assets.register('materials', 'steel', () => { loads++; return { kind: 'other' }; }), first);
  assert.equal(loads, 1);
  assert.equal(assets.get('materials', 'steel'), first);
  assert.equal(assets.get('steel'), undefined);
  assert.equal(assets.has('materials', 'steel'), true);
  assert.equal(assets.has('steel'), false);
  const record = assets.manifest('materials').materials.steel;
  assert.equal(record.namespace, 'materials');
  assert.equal(record.id, 'steel');
  assert.equal(record.status, 'ready');
  assert.equal(record.reuses, 1);
  assert.equal(record.refCount, 2);
  const firstSnapshot = assets.snapshot();
  assert.equal(firstSnapshot.namespaces, 1);
  assert.equal(firstSnapshot.assets, 1);
  assert.equal(firstSnapshot.ready, 1);
  assert.equal(firstSnapshot.reuses, 1);
  assert.equal(firstSnapshot.errors.length, 0);
  assert.equal(assets.release('materials', 'steel'), false);
  assert.equal(assets.has('materials', 'steel'), true);
  assert.equal(assets.release('materials', 'steel'), true);
  assert.equal(assets.has('materials', 'steel'), false);
});

test('supports core namespace shorthand and preserves metadata in the manifest', () => {
  const assets = makeAssets();
  const value = { id: 7 };
  assert.equal(assets.register('mission', value, { type: 'json' }), value);
  assert.equal(assets.get('mission'), value);
  assert.equal(assets.get('missing', 'fallback'), 'fallback');
  assert.equal(assets.manifest().core.mission.metadata.type, 'json');
});

test('records synchronous and asynchronous loader failures without throwing', async () => {
  const assets = makeAssets();
  assert.equal(assets.register('broken', () => { throw new Error('file missing'); }), undefined);
  const pending = assets.register('pending', Promise.reject(new Error('decode failed')));
  assert.equal(typeof pending.then, 'function');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(assets.get('broken', 'fallback'), 'fallback');
  assert.equal(assets.get('pending', 'fallback'), 'fallback');
  const snapshot = assets.snapshot();
  assert.equal(snapshot.failed, 2);
  assert.equal(snapshot.errors.length, 2);
  assert.match(snapshot.errors[0].message, /file missing/);
  assert.match(snapshot.errors[1].message, /decode failed/);
  assert.equal(assets.manifest().core.broken.status, 'failed');
});

test('rejects missing ids and values and clears one namespace or the whole registry', () => {
  const assets = makeAssets();
  assert.equal(assets.register('', 'value'), undefined);
  assert.equal(assets.register('empty'), undefined);
  assets.register('world', 'dock', { section: 7 });
  assets.register('ui', 'hud', { layer: 2 });
  assert.equal(assets.clear('world'), 1);
  assert.equal(assets.has('world', 'dock'), false);
  assert.equal(assets.snapshot().assets, 1);
  assert.equal(assets.clear(), 1);
  const cleared = assets.snapshot();
  assert.equal(cleared.namespaces, 0);
  assert.equal(cleared.assets, 0);
  assert.equal(cleared.ready, 0);
  assert.equal(cleared.failed, 0);
  assert.equal(cleared.reuses, 0);
  assert.equal(cleared.errors.length, 2);
  assert.equal(assets.clear(), 0);
});
