const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(readFileSync(path.join(__dirname, '../src/quality.js'), 'utf8'), { window });
const { configure, resolution, profiles } = window.PBQuality;

function renderer({ webgl2 = true, failures = [], maxSize = 4096 } = {}) {
  return {
    isWebGL2: webgl2,
    maxRenderWidth: maxSize,
    maxRenderHeight: maxSize,
    capabilities: { maxTextureSize: maxSize },
    attempts: [],
    setQuality(name) { this.quality = name; },
    setSize(width, height) {
      this.attempts.push([this.quality, width, height]);
      this.highError = 'incomplete render target';
      return !failures.includes(this.quality);
    }
  };
}

test('each quality starts at its advertised exact 16:9 resolution', () => {
  for (const [name, width, height] of [['high', 1920, 1080], ['balanced', 1600, 900], ['fallback', 960, 540]]) {
    const result = configure(renderer(), name);
    assert.equal(result.profile.name, name);
    assert.deepEqual([result.size.width, result.size.height], [width, height]);
  }
});

test('startup retries smaller viable profiles and reports actual allocation failures', () => {
  const testRenderer = renderer({ failures: ['high', 'balanced'] });
  const result = configure(testRenderer, 'high');
  assert.equal(result.profile.name, 'fallback');
  assert.match(result.reason, /high: incomplete render target; balanced: incomplete render target/);
  assert.deepEqual(testRenderer.attempts.map(attempt => attempt[0]), ['high', 'balanced', 'fallback']);
});

test('WebGL1 selects Fallback regardless of the requested quality', () => {
  const testRenderer = renderer({ webgl2: false });
  assert.equal(configure(testRenderer, 'high').profile.name, 'fallback');
  assert.deepEqual(testRenderer.attempts, [['fallback', 960, 540]]);
});

test('fractional scales and viewport limits keep the backing store at exact 16:9', () => {
  const limited = renderer({ maxSize: 855 });
  for (const profile of Object.values(profiles)) {
    for (const scale of [0.75, 0.85, 0.97, 1]) {
      const size = resolution(limited, profile, scale);
      assert.equal(size.width * 9, size.height * 16);
      assert.ok(size.width <= 855 && size.height <= 855);
    }
  }
});
