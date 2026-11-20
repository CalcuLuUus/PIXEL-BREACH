const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PB_PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.PB_TEST_URL || 'http://127.0.0.1:8000/';
const name = process.env.PB_BROWSER || 'chromium';
const engine = { chromium, firefox, webkit }[name];
const swift = name === 'chromium' && process.env.PB_SWIFTSHADER === '1';

async function checkPage(browser, query, work, inject) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const faults = [];
  page.on('pageerror', error => faults.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /WebGL.*(INVALID_|incomplete framebuffer)/i.test(message.text())) {
      faults.push(message.text());
    }
  });
  page.on('response', response => {
    if (response.status() >= 400) faults.push(response.status() + ' ' + response.url());
  });
  const origin = new URL(base).origin;
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push('Unexpected network request: ' + route.request().url());
    await route.abort();
  });
  if (inject) await page.addInitScript(inject);
  try {
    await page.goto(base + query, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => window.__PB_MISSION__ || !document.getElementById('fatal').hidden,
      {}, { polling: 250, timeout: 120000 });
    if (inject === undefined) {
      assert.equal(await page.locator('#fatal').isVisible(), false,
        await page.locator('#fatalText').textContent());
    }
    await work(page);
    assert.deepEqual(faults, [], query);
  } finally {
    await page.close();
  }
}

const render = page => page.evaluate(() => window.__PB_RENDERING__.snapshot());
const snapshot = page => page.evaluate(() => window.__PB_MISSION__.snapshot());
const step = (page, ticks, draw = false) => page.evaluate(([n, present]) => window.__PB_QA__.step(n, present), [ticks, draw]);
const place = (page, x, z, height = 0) => page.evaluate(args => window.__PB_QA__.place(...args), [x, z, height]);
const aim = (page, x, y, z) => page.evaluate(args => window.__PB_QA__.aim(...args), [x, y, z]);
const armor = (page, amount) => page.evaluate(amount => window.__PB_QA__.damageBoss(amount), amount);
const damagePlayer = (page, amount) => page.evaluate(amount => window.__PB_QA__.damagePlayer(amount), amount);
const effects = page => page.evaluate(() => window.__PB_CINEMATIC_FX__.snapshot());

async function hold(page, key, ticks) {
  await page.keyboard.down(key);
  const result = await step(page, ticks);
  await page.keyboard.up(key);
  return result;
}

async function fire(page, ticks = 1) {
  await page.locator('#scene').dispatchEvent('mousedown', { button: 0, bubbles: true });
  const result = await step(page, ticks);
  await page.locator('#scene').dispatchEvent('mouseup', { button: 0, bubbles: true });
  return result;
}

async function until(page, predicate, max = 900, stride = 6) {
  let state;
  for (let t = 0; t < max; t += stride) {
    state = await step(page, stride);
    if (predicate(state)) return state;
    if (state.mode !== 'playing') break;
  }
  assert.fail('Expected mission state was not reached: ' + JSON.stringify(state));
}

async function clearWave(page) {
  await page.evaluate(() => {
    const count = window.__PB_MISSION__.snapshot().enemies.length;
    for (let i = count - 1; i >= 0; i--) window.__PB_QA__.damageEnemy(i, 1000);
  });
}

async function assertGL(page, profile, width, height) {
  const report = await render(page);
  assert.equal(report.build, 'V8');
  assert.equal(report.selectedProfile, profile);
  assert.deepEqual(report.backbuffer, { width, height });
  assert.ok(report.resources.drawCalls > 0);
  assert.ok(report.resources.visibleTriangles > 0);
  assert.equal(report.features.pbr, profile !== 'fallback');
  assert.equal(report.features.normalMapping, profile !== 'fallback');
  assert.equal(report.features.realShadowMap, profile !== 'fallback');
  assert.equal(report.features.postProcessBloom, profile !== 'fallback');
  assert.equal(report.features.ssao, profile !== 'fallback');
  assert.ok(report.resources.reflectionPasses <= 1);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('scene')).imageRendering), 'auto');
  const glError = await page.evaluate(backend => document.getElementById('scene')
    .getContext(backend === 'webgl1' ? 'webgl' : 'webgl2').getError(), report.contextType);
  assert.equal(glError, 0, 'WebGL error after presenting ' + profile);
  return report;
}

async function checkMission(page) {
  assert.equal((await snapshot(page)).mode, 'menu');
  await page.click('#ovBtn');
  await page.waitForFunction(() => {
    const input = window.__PB_MISSION__.snapshot().input;
    return input.pointerLocked || input.fallbackLook;
  }, {}, { polling: 100, timeout: 5000 });
  const first = await snapshot(page);
  assert.equal(first.mode, 'playing');
  assert.equal(first.node, 'entrance');
  assert.equal(first.player.z, 12.6);
  assert.deepEqual(first.weapons.map(weapon => [weapon.mag, weapon.reserve]), [[30, 120], [8, 48], [0, 0]]);
  assert.equal(first.supply.stations.length, 2);

  await page.keyboard.press('Space');
  let state = await step(page, 6);
  assert.ok(state.player.y > 2 && !state.player.grounded);
  await page.keyboard.press('KeyQ');
  state = await step(page, 7);
  assert.ok(state.player.airDashUsed && state.player.dash > 2.5);
  await step(page, 60);
  state = await snapshot(page);
  assert.ok(state.player.grounded && !state.player.airDashUsed);

  await place(page, 10.38, 5.15);
  state = await hold(page, 'KeyW', 34);
  assert.ok(state.player.y > 2.90, 'Observation platform should be reachable on foot');
  state = await until(page, s => s.enemies.length === 4, 120);
  assert.equal(state.wave, 1);
  assert.ok(state.enemies.every(e => e.type === 'sentinel'));
  assert.ok(state.world.gateOpen);

  await page.keyboard.press('Digit2');
  state = await fire(page);
  assert.equal(state.weapons[1].mag, 7);
  assert.equal((await effects(page)).tracers, 5);
  await page.keyboard.press('Digit3');
  state = await fire(page, 6);
  assert.ok(state.player.slash > 0.23);
  await step(page, 27);
  await page.keyboard.press('Digit1');
  state = await fire(page, 25);
  assert.ok(state.weapons[0].mag <= 27, 'Rifle should fire more than once while held');
  await page.keyboard.press('KeyR');
  assert.ok((await snapshot(page)).weapons[0].reload > 0);
  state = await step(page, 80);
  assert.equal(state.weapons[0].mag, 30);
  assert.ok(state.weapons[0].reserve < 120);
  await page.keyboard.press('KeyI');
  assert.ok((await step(page, 2)).player.inspection > 0);

  await place(page, -8.1, 16.25);
  await damagePlayer(page, 45);
  const damaged = (await snapshot(page)).player.hp;
  await page.keyboard.down('KeyE');
  state = await step(page, 15);
  assert.ok(state.supply.active && state.supply.progress > 0);
  await page.keyboard.down('KeyS');
  state = await step(page, 3);
  assert.equal(state.supply.active, false);
  await page.keyboard.up('KeyS');
  await page.keyboard.up('KeyE');
  await place(page, -8.1, 16.25);
  state = await hold(page, 'KeyE', 57);
  assert.equal(state.player.hp, damaged + 40);
  assert.equal(state.weapons[0].reserve, 120);
  assert.ok(state.supply.stations[0].cooldown > 34 && state.supply.stations[1].cooldown === 0);
  await page.keyboard.press('KeyF');
  state = await step(page, 2);
  assert.ok(state.player.pulse > 7.8);
  await clearWave(page);

  state = await until(page, s => s.node === 'transit', 180);
  assert.equal(state.enemies.length, 0);
  await place(page, 10.0, -10);
  state = await until(page, s => s.enemies.length === 6, 180);
  assert.equal(state.wave, 2);
  assert.equal(state.enemies.filter(e => e.type === 'turret').length, 2);
  assert.equal(state.enemies.filter(e => e.type === 'sentinel').length, 4);

  await place(page, 14.0, -14.95, 0.62);
  await damagePlayer(page, 35);
  state = await hold(page, 'KeyE', 56);
  assert.ok(state.supply.stations[1].cooldown > 34);
  await place(page, 5.44, -15.45);
  const oldX = state.world.hoistX;
  await page.keyboard.press('KeyE');
  assert.ok((await step(page, 24)).world.hoistX > oldX);
  await place(page, -2.5, -11.0);
  await aim(page, -2.5, .31, -14.35);
  await fire(page, 18);
  assert.ok((await snapshot(page)).world.intact < 2, 'The crate collider should be destructible');
  assert.ok((await effects(page)).impactMarks > 0);
  await clearWave(page);
  await until(page, s => s.node === 'approach', 180);

  await place(page, 3.75, -23.6);
  state = await step(page, 2);
  assert.equal(state.node, 'arrival');
  assert.equal(state.cinematic.current, 'arrival');
  await page.keyboard.press('KeyX');
  assert.equal((await snapshot(page)).cinematic.current, '');
  assert.equal((await snapshot(page)).node, 'arrival');
  await place(page, 6, 12.5);
  state = await until(page, s => !!s.boss, 145);
  assert.equal(state.boss.hp, 500);
  assert.equal(state.boss.phase, 1);
  await until(page, s => s.boss?.attack === 'volley');
  await armor(page, 170);
  state = await snapshot(page);
  assert.equal(state.boss.phase, 2);
  assert.equal(state.boss.hp, 330);
  await until(page, s => s.boss?.attack === 'laser');
  await until(page, s => s.boss?.shield > 0, 500);
  await armor(page, 20);
  assert.equal((await snapshot(page)).boss.hp, 330);
  state = await until(page, s => s.boss?.exposed > 0 && s.boss.shield === 0, 240, 3);
  assert.ok(state.boss.exposed <= 1.7);
  await armor(page, 90);
  state = await snapshot(page);
  assert.equal(state.boss.hp, 150);
  assert.equal(state.boss.phase, 3);
  assert.equal(state.boss.enraged, true);
  await until(page, s => s.boss?.attack === 'missiles', 1200, 12);
  await step(page, 26);
  await until(page, s => s.boss?.attack === 'shockwave', 1200, 12);
  await step(page, 44);
  assert.ok((await effects(page)).shockwaves >= 2);
  await armor(page, 500);
  state = await snapshot(page);
  if (!state.exit) {
    await until(page, s => s.boss?.shield === 0, 240);
    await armor(page, 500);
    state = await snapshot(page);
  }
  assert.equal(state.exit, true);
  assert.equal(state.node, 'extract');
  assert.equal((await effects(page)).bossWreck, true);
  await place(page, 0, -44.5);
  await page.keyboard.press('KeyE');
  state = await snapshot(page);
  assert.equal(state.mode, 'won');
  assert.equal(state.records.clears, 1);
  assert.ok(state.records.bestTime > 0 && state.records.bestKills >= 10);
  await step(page, 125, true);
  assert.equal((await effects(page)).bossWreck, false);

  await page.click('#ovBtn');
  await page.keyboard.press('Escape');
  state = await snapshot(page);
  assert.equal(state.mode, 'paused');
  assert.equal((await step(page, 60)).time, state.time);
  await page.click('#ovBtn');
  assert.equal((await snapshot(page)).mode, 'playing');
  await damagePlayer(page, 999);
  assert.equal((await snapshot(page)).mode, 'lost');
  await page.click('#ovBtn');
  state = await snapshot(page);
  assert.equal(state.player.hp, 100);
  assert.equal(state.node, 'entrance');
  assert.equal(state.records.clears, 1);
  assert.deepEqual(state.supply.stations.map(station => station.cooldown), [0, 0]);
  assert.equal(state.world.intact, 2);
  assert.equal(state.exit, false);
  const oldTime = state.time;
  await page.evaluate(() => document.getElementById('scene').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.locator('#fatal').waitFor({ state: 'visible' });
  assert.equal((await render(page)).contextLost, true);
  assert.equal((await step(page, 30)).time, oldTime);
}

async function checkSettings(page) {
  await page.click('#menuView');
  assert.match(await page.locator('#menuLocation').textContent(), /集装箱/);
  await page.click('#settingsOpen');
  await page.locator('[name=reducedMotion]').check();
  await page.locator('[name=contrast]').check();
  await page.locator('[name=post]').uncheck();
  await page.locator('[name=reflections]').selectOption('off');
  await page.locator('[name=dynamic]').uncheck();
  await page.locator('[name=scale]').fill('0.6');
  await page.locator('[name=fov]').fill('86');
  await page.locator('[name=vol-master]').fill('0.25');
  await page.getByRole('button', { name: '重新分配跳跃' }).click();
  await page.keyboard.press('KeyJ');
  assert.equal((await snapshot(page)).settings.bindings.jump, 'KeyJ');
  await page.click('#settingsClose');
  await page.evaluate(() => window.__PB_QA__.draw());
  const report = await render(page);
  assert.deepEqual(report.backbuffer, { width: 960, height: 540 });
  assert.equal(report.features.fxaa, false);
  assert.equal(report.features.postProcessBloom, false);
  assert.equal(report.features.ssao, false);
  assert.equal(report.resources.postPasses, 1);
  assert.equal(report.resources.reflectionPasses, 0);
  assert.equal(report.features.seaReflection, false);
  await page.reload();
  await page.waitForFunction(() => window.__PB_QA__, {}, { polling: 250, timeout: 120000 });
  let state = await snapshot(page);
  assert.equal(state.settings.fov, 86);
  assert.equal(state.settings.volumes.master, .25);
  assert.equal(state.settings.reducedMotion, true);
  await page.click('#ovBtn');
  await page.waitForFunction(() => window.__PB_MISSION__.snapshot().audio.status === 'running', {}, { polling: 100 });
  await page.keyboard.press('KeyJ');
  state = await step(page, 8);
  assert.equal(state.player.grounded, false);
  assert.ok(state.player.fov > 83);
  await fire(page, 8);
  state = await snapshot(page);
  assert.ok(state.audio.eventsPlayed > 0 && state.audio.cachedBuffers > 30);
  assert.ok(state.audio.activeVoices <= state.audio.poolSize);
}

(async () => {
  const vulkan = name === 'chromium' && process.env.PB_ANGLE_VULKAN === '1';
  const args = swift ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : vulkan ? ['--use-angle=vulkan', '--disable-software-rasterizer', '--ignore-gpu-blocklist'] : [];
  const browser = await engine.launch({
    args, headless: process.env.PB_HEADFUL !== '1',
    firefoxUserPrefs: name === 'firefox' ? { 'webgl.force-enabled': true, 'network.proxy.type': 0 } : undefined
  });
  try {
    const compatibility = process.env.PB_COMPAT_ONLY;
    if (compatibility) {
      await checkPage(browser, '?qa=1&quality=fallback&renderScale=.5', async page => {
        const state = await assertGL(page, 'fallback', 480, 270);
        console.log(name, 'Fallback', state.contextType, state.capability.renderer);
        await page.click('#ovBtn');
        const playing = await hold(page, 'KeyW', 55);
        assert.equal(playing.node, 'wave1');
      });
      if (compatibility !== 'fallback') {
        await checkPage(browser, '?qa=1&quality=high&renderScale=.5', async page => {
          const state = await assertGL(page, 'high', 960, 540);
          console.log(name, 'High', state.contextType, state.capability.renderer);
        });
      }
      console.log(name + ' profile compatibility checks passed');
      return;
    }
    // The manual clock shows the real shader and collision behavior without tying
    // simulated minutes to the throughput of the test machine's GL backend.
    await checkPage(browser, '', async page => {
      await page.waitForFunction(() => window.__PB_RENDERING__.snapshot().resources.drawCalls > 0, {},
        { polling: 250, timeout: 120000 });
      const status = await render(page);
      assert.equal(status.selectedProfile, 'high');
      assert.equal(status.features.dynamicResolution, true);
    });
    await checkPage(browser, '?qa=1&quality=high', async page => {
      const report = await assertGL(page, 'high', 1920, 1080);
      console.log('High', report.capability.renderer, report.resources.visibleTriangles, 'visible triangles');
      await page.setViewportSize({ width: 1069, height: 820 });
      assert.equal((await render(page)).backbuffer.width, 1920);
    });
    await checkPage(browser, '?qa=1&quality=balanced', async page => {
      await assertGL(page, 'balanced', 1600, 900);
    });
    await checkPage(browser, '?qa=1&quality=fallback&renderScale=.5', async page => {
      await assertGL(page, 'fallback', 480, 270);
      await checkMission(page);
    });
    await checkPage(browser, '?qa=1&quality=balanced', checkSettings);
    await checkPage(browser, '?qa=1&quality=fallback', async page => {
      await page.click('#ovBtn');
      const state = await step(page, 2);
      assert.equal(state.mode, 'playing');
      assert.match(state.audio.error, /Web Audio/);
    }, () => { window.AudioContext = undefined; window.webkitAudioContext = undefined; });
    await checkPage(browser, '?qa=1&quality=balanced&renderScale=.5', async page => {
      const r = await assertGL(page, 'balanced', 800, 450);
      assert.equal(r.features.hdr, false);
      assert.equal(r.resources.sceneColorFormat, 'RGBA8');
    }, () => {
      const extension = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (name) {
        return name === 'EXT_color_buffer_float' ? null : extension.call(this, name);
      };
    });
    await checkPage(browser, '?qa=1&quality=high', async page => {
      const report = await assertGL(page, 'fallback', 960, 540);
      assert.equal(report.contextType, 'webgl1');
      assert.equal(report.degraded, true);
      await page.click('#ovBtn');
      await page.waitForFunction(() => window.__PB_MISSION__.snapshot().input.fallbackLook, {}, { polling: 100 });
      const before = await snapshot(page);
      await page.locator('#scene').dispatchEvent('mousemove', { movementX: 21, movementY: -14, bubbles: true });
      const after = await snapshot(page);
      assert.notEqual(after.player.yaw, before.player.yaw);
    }, () => {
      const context = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (name, ...args) {
        return name === 'webgl2' ? null : context.call(this, name, ...args);
      };
      HTMLCanvasElement.prototype.requestPointerLock = () => undefined;
    });
    await checkPage(browser, '', async page => {
      const failure = await page.locator('#fatalText').textContent();
      assert.match(failure, /WebGL/);
      assert.equal(await page.locator('#reloadGame').isVisible(), true);
    }, () => {
      const context = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (name, ...args) {
        return name.includes('webgl') ? null : context.call(this, name, ...args);
      };
      // Initialization errors use the visible fatal panel in this test.
      console.error = () => {};
    });
    await checkPage(browser, '?benchmark=1&quality=fallback&renderScale=.5', async page => {
      const data = await page.evaluate(() => window.__PB_BENCHMARK__.sample(10));
      assert.equal(data.frames, 10);
      assert.ok(data.peakDrawCalls > 0 && data.maxMs >= data.meanMs);
    });
    console.log('V8 browser checks passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
