const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PB_PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.PB_TEST_URL || 'http://127.0.0.1:8000/';
const captures = process.env.PB_CAPTURE_DIR;
const video = process.env.PB_VIDEO_DIR;
const frameCount = Number(process.env.PB_BENCH_FRAMES || 240);

async function step(page, ticks, draw = false) {
  return page.evaluate(([ticks, draw]) => window.__PB_QA__.step(ticks, draw), [ticks, draw]);
}

async function place(page, x, z, look) {
  await page.evaluate(([x, z, look]) => {
    window.__PB_QA__.place(x, z);
    window.__PB_QA__.aim(...look);
  }, [x, z, look]);
}

async function clear(page) {
  await page.evaluate(() => {
    const count = window.__PB_MISSION__.snapshot().enemies.length;
    for (let i = count - 1; i >= 0; i--) window.__PB_QA__.damageEnemy(i, 1000);
  });
}

async function hurtBoss(page, amount) {
  await page.evaluate(amount => window.__PB_QA__.damageBoss(amount), amount);
}

async function report(page, chapter) {
  const result = await page.evaluate(async count => {
    window.__PB_QA__.live(true);
    try {
      await window.__PB_BENCHMARK__.sample(45);
      const before = window.__PB_RENDERING__.snapshot().resources.gpuCache;
      const data = await window.__PB_BENCHMARK__.sample(count);
      return { ...data, before };
    } finally {
      window.__PB_QA__.live(false);
    }
  }, frameCount);
  const render = result.renderer;
  assert.equal(render.contextType, 'webgl2');
  assert.equal(render.selectedProfile, 'high');
  assert.equal(render.renderScale, 1);
  assert.doesNotMatch(render.capability.renderer, /SwiftShader|llvmpipe|software/i);
  assert.equal(result.frames, frameCount);
  return {
    chapter, renderer: render.capability.renderer, frames: result.frames, meanMs: result.meanMs, p95Ms: result.p95Ms,
    peakMs: result.maxMs, minimumFps: result.minimumFps, framesOver25Ms: result.framesOver25Ms,
    peakDrawCalls: result.peakDrawCalls,
    peakVisibleTriangles: result.peakVisibleTriangles, peakParticles: result.peakParticles,
    peakImpactMarks: result.peakImpactMarks, reflectionUpdates: result.reflectionUpdates,
    backbuffer: render.backbuffer, scale: render.renderScale, lights: render.activeLocalLights,
    shadowMap: render.resources.shadowMapSize, textures: render.resources.gpuCache.textures,
    geometries: render.resources.gpuCache.geometry,
    textureBytes: render.resources.gpuCache.textureBytes + render.resources.textureBytesWithMips,
    resourceDelta: {
      geometry: render.resources.gpuCache.geometry - result.before.geometry,
      textures: render.resources.gpuCache.textures - result.before.textures
    },
    sectors: render.resources.sectors
  };
}

(async () => {
  if (captures) await mkdir(captures, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-angle=vulkan', '--disable-software-rasterizer', '--ignore-gpu-blocklist']
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1200 },
      recordVideo: video ? { dir: video, size: { width: 1280, height: 800 } } : undefined
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '?qa=1&benchmark=1&silent=1&seed=8027');
    await page.waitForFunction(() => window.__PB_QA__, {}, { polling: 250, timeout: 120000 });
    if (captures) await page.screenshot({ path: path.join(captures, 'v8-menu.png') });
    await page.click('#ovBtn');
    await place(page, 1.5, 7.9, [0, .08, -8]);
    const wave = await step(page, 100, true);
    assert.equal(wave.enemies.length, 4);
    await page.locator('#scene').dispatchEvent('mousedown', { button: 0, bubbles: true });
    console.log(JSON.stringify(await report(page, 'wave 1'), null, 2));
    await page.locator('#scene').dispatchEvent('mouseup', { button: 0, bubbles: true });

    await clear(page);
    await step(page, 130);
    await place(page, 3.4, -12.0, [0, 1.6, -20]);
    assert.equal((await step(page, 116)).enemies.length, 6);
    await clear(page);
    await step(page, 130);
    await place(page, 2.8, -24.5, [0, 2.8, -34]);
    assert.equal((await step(page, 220, true)).boss.hp, 500);
    if (captures) await page.screenshot({ path: path.join(captures, 'v8-boss-1.png') });
    await hurtBoss(page, 170);
    await step(page, 100, true);
    if (captures) await page.screenshot({ path: path.join(captures, 'v8-boss-2.png') });
    await hurtBoss(page, 180);
    await page.keyboard.press('KeyX');
    const boss = await step(page, 110, true);
    assert.equal(boss.boss.phase, 3);
    if (captures) await page.screenshot({ path: path.join(captures, 'v8-boss-3.png') });
    console.log(JSON.stringify(await report(page, 'enraged'), null, 2));
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
