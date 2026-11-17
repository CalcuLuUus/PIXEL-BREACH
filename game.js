/* ==========================================================================
   PIXEL//BREACH — 断层突围
   A 3D pixel-styled first-person breach demo.

   Rendering : 640x360 WebGL backbuffer, nearest-neighbour upscale (CSS)
   Assets    : none — procedural geometry, materials and lights only
   Network   : none. vendor/three.min.js is a local offline build.
   ========================================================================== */

(function () {
  'use strict';

  var VENDOR_SRC = 'vendor/three.min.js';
  var RES_W = 640;
  var RES_H = 360;

  function byId(id) {
    return document.getElementById(id);
  }

  function fatal(message) {
    var box = byId('fatal');
    var text = byId('fatalText');
    if (text && message) text.textContent = message;
    if (box) box.hidden = false;
  }

  function loadVendor() {
    return new Promise(function (resolve, reject) {
      if (window.THREE && window.THREE.REVISION === 'pb-1' && window.THREE.WebGLRenderer) {
        resolve(window.THREE);
        return;
      }
      var script = document.createElement('script');
      // Local relative reference only — never a CDN / remote URL.
      script.src = VENDOR_SRC;
      script.async = false;
      script.onload = function () {
        if (window.THREE && window.THREE.WebGLRenderer) resolve(window.THREE);
        else reject(new Error('vendor loaded without THREE'));
      };
      script.onerror = function () {
        reject(new Error('cannot load ' + VENDOR_SRC));
      };
      document.head.appendChild(script);
    });
  }

  function init() {
    loadVendor().then(start).catch(function (err) {
      console.error('[PIXEL//BREACH]', err);
      fatal('本地 3D 依赖加载失败：' + (err && err.message ? err.message : String(err)) +
        '。请确认 games/pixel-breach/vendor/three.min.js 存在。');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  /* ====================================================================== *
   * Game
   * ====================================================================== */

  function start(THREE) {
    var canvas = byId('scene');
    var stage = byId('stage');
    var overlay = byId('overlay');
    var panel = byId('panel');
    var hud = byId('hud');
    var bossBar = byId('bossBar');
    var fatalBox = byId('fatal');

    var ui = {
      objective: byId('objective'),
      waveLabel: byId('waveLabel'),
      enemyCount: byId('enemyCount'),
      bossBar: bossBar,
      bossFill: byId('bossFill'),
      bossPhase: byId('bossPhase'),
      bossHpText: byId('bossHpText'),
      bossState: byId('bossState'),
      hpText: byId('hpText'),
      hpFill: byId('hpFill'),
      dashAbility: byId('dashAbility'),
      dashFill: byId('dashFill'),
      dashCd: byId('dashCd'),
      pulseAbility: byId('pulseAbility'),
      pulseFill: byId('pulseFill'),
      pulseCd: byId('pulseCd'),
      weaponSlot: byId('weaponSlot'),
      weaponName: byId('weaponName'),
      weaponEn: byId('weaponEn'),
      ammoMag: byId('ammoMag'),
      ammoReserve: byId('ammoReserve'),
      reloadTag: byId('reloadTag'),
      slots: Array.prototype.slice.call(document.querySelectorAll('#weaponSlots .slot')),
      crosshair: byId('crosshair'),
      hitmarker: byId('hitmarker'),
      hint: byId('hint'),
      banner: byId('banner'),
      toasts: byId('toasts'),
      damage: byId('damageFlash'),
      screenFlash: byId('screenFlash'),
      ovKicker: byId('ovKicker'),
      ovTitle: byId('ovTitle'),
      ovSub: byId('ovSub'),
      ovDesc: byId('ovDesc'),
      ovStats: byId('ovStats'),
      ovControls: byId('ovControls'),
      ovBtn: byId('ovBtn'),
      ovFoot: byId('ovFoot')
    };

    /* ------------------------------------------------------------ renderer */

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false });
    } catch (err) {
      console.error('[PIXEL//BREACH] renderer', err);
      fatal('无法创建 WebGL 上下文：' + (err && err.message ? err.message : String(err)));
      return;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(RES_W, RES_H);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060c);
    scene.fog = new THREE.Fog(0x03060c, 15, 47);

    var camera = new THREE.PerspectiveCamera(74, RES_W / RES_H, 0.06, 120);
    scene.add(camera);

    var ambientLight = new THREE.AmbientLight(0x4d6d94, 1.05);
    scene.add(ambientLight);
    var ambientTint = {
      target: new THREE.Color(0x4d6d94),
      baseHex: 0x4d6d94
    };
    var sun = new THREE.DirectionalLight(0xe2f1ff, 1.12);
    sun.position.set(-0.45, 1, 0.3);
    scene.add(sun);

    /* ------------------------------------------------------------- palette */

    var C = {
      cyan: 0x57f2ff,
      cyanDim: 0x1b6177,
      magenta: 0xff4fb8,
      violet: 0x9b6bff,
      amber: 0xffc861,
      red: 0xff4d6d,
      green: 0x6bffb0,
      floor: 0x0a111d,
      wall: 0x0f1a2c,
      wallDark: 0x0a1220,
      steel: 0x27354b,
      gun: 0x8ea6bd
    };

    function matBasic(hex, opts) {
      var o = opts ? Object.assign({}, opts) : {};
      o.color = hex;
      return new THREE.MeshBasicMaterial(o);
    }

    function matLambert(hex, opts) {
      var o = opts ? Object.assign({}, opts) : {};
      o.color = hex;
      return new THREE.MeshLambertMaterial(o);
    }

    var MAT = {
      // V3 pushes the stepped specular response harder so local lights read as
      // wet/dusty industrial metal instead of a flat unlit pixel fill.
      floor: matLambert(C.floor, { specular: 0.46, roughness: 0.32 }),
      ceiling: matLambert(0x05090f, { specular: 0.04, roughness: 0.9 }),
      wall: matLambert(C.wall, { specular: 0.18, roughness: 0.62 }),
      wallDark: matLambert(C.wallDark, { specular: 0.12, roughness: 0.7 }),
      steel: matLambert(C.steel, { specular: 0.56, roughness: 0.3 }),
      grid: matBasic(0x16455c, { transparent: true, opacity: 0.62 }),
      trim: matBasic(0x2c8ba8),
      trimPink: matBasic(0x8a2d63),
      cover: matLambert(0x16233a, { specular: 0.24, roughness: 0.46 }),
      coverTrim: matBasic(0x2a6f8c),
      lamp: matBasic(0xa9f8ff),
      portalLocked: matBasic(C.red, { transparent: true, opacity: 0.55, blending: 'additive', depthWrite: false }),
      portalOpen: matBasic(C.cyan, { transparent: true, opacity: 0.7, blending: 'additive', depthWrite: false })
    };

    var G = {
      box: new THREE.BoxGeometry(1, 1, 1),
      plane: new THREE.PlaneGeometry(1, 1),
      sphere: new THREE.SphereGeometry(1, 10, 7),
      lowSphere: new THREE.SphereGeometry(1, 6, 4),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
      cone: new THREE.ConeGeometry(1, 1, 6),
      torus: new THREE.TorusGeometry(1, 0.055, 5, 22),
      ring: new THREE.TorusGeometry(1, 0.03, 4, 26),
      circle: new THREE.CircleGeometry(1, 24)
    };

    /* ================================================================== *
     * Industrial pixel-art kit
     *
     * The local renderer is the project's Three.js-compatible subset; it has
     * no sampler/Texture class.  Instead of pretending otherwise, surface
     * patterns are generated into a tiny local Canvas2D atlas and then baked
     * into merged low-poly "pixel chips".  That keeps the nearest-neighbour
     * look, stays fully offline, and yields stable deterministic detail.
     * ====================================================================== */

    var ART_SEED = 0x07b5ea1;

    function makeRng(seed) {
      var s = seed >>> 0;
      return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    var artRng = makeRng(ART_SEED);
    function arand(a, b) { return a + artRng() * (b - a); }
    function hash2(x, y) {
      var n = Math.sin(x * 127.1 + y * 311.7 + 17.31) * 43758.5453123;
      return n - Math.floor(n);
    }

    // Shared industrial palette.  Lambert materials carry the form, the
    // unlit entries are paint / signage / phosphor that must stay readable.
    var IM = {
      steel: matLambert(0x56636e, { specular: 0.56, roughness: 0.32 }),
      steel2: matLambert(0x74808a, { specular: 0.68, roughness: 0.26 }),
      steelDark: matLambert(0x343d45, { specular: 0.38, roughness: 0.42 }),
      steelDeep: matLambert(0x20272e, { specular: 0.24, roughness: 0.54 }),
      concrete: matLambert(0x6a6b62, { specular: 0.08, roughness: 0.88 }),
      concrete2: matLambert(0x7a7b72, { specular: 0.1, roughness: 0.84 }),
      concreteDark: matLambert(0x4a4c46, { specular: 0.07, roughness: 0.9 }),
      concreteLight: matLambert(0x8a8a80, { specular: 0.13, roughness: 0.8 }),
      rust: matLambert(0x8b4c30, { specular: 0.2, roughness: 0.72, specularColor: 0xffbb80 }),
      rustDark: matLambert(0x583226, { specular: 0.14, roughness: 0.8, specularColor: 0xffa070 }),
      rustLight: matLambert(0xad663d, { specular: 0.26, roughness: 0.66, specularColor: 0xffcf9a }),
      copper: matLambert(0x9a6d3f, { specular: 0.72, roughness: 0.28, specularColor: 0xffd6a0 }),
      brass: matLambert(0xa98b4a, { specular: 0.68, roughness: 0.3, specularColor: 0xffe3b0 }),
      black: matLambert(0x101518, { specular: 0.12, roughness: 0.58 }),
      cable: matLambert(0x171c20, { specular: 0.18, roughness: 0.55 }),
      oil: matLambert(0x1e2321, { specular: 0.3, roughness: 0.28 }),
      hazard: matBasic(0xd1a82f),
      hazardDark: matBasic(0x1c1d18),
      white: matBasic(0xdfe3dc),
      redPaint: matBasic(0xb84537),
      greenPaint: matBasic(0x5aa86a),
      screen: matBasic(0x6de6d8),
      lampCool: matBasic(0xb8f7ff),
      lampWarm: matBasic(0xffd59a),
      lampRed: matBasic(0xff675c),
      fxLine: matBasic(0x58ddff),
      fxPylon: matBasic(0x3ec8dd),
      fxAlarm: matBasic(0xff584f),

      // Conservative pseudo-lighting: unlit layered decals.  AO is a normal
      // black blend; light pools/halos use additive blending.  Every entry is
      // a single merged batch, so the whole scene still costs a handful of
      // draw calls and nothing is allocated per frame.
      ao: matBasic(0x000000, {
        transparent: true, opacity: 0.15, depthWrite: false, fog: false
      }),
      aoSoft: matBasic(0x000000, {
        transparent: true, opacity: 0.07, depthWrite: false, fog: false
      }),
      glowWarm: matBasic(0xff9a4a, {
        transparent: true, opacity: 0.05, blending: 'additive', depthWrite: false, fog: false
      }),
      glowWarmCore: matBasic(0xffd18a, {
        transparent: true, opacity: 0.09, blending: 'additive', depthWrite: false, fog: false
      }),
      glowRust: matBasic(0xff6a3d, {
        transparent: true, opacity: 0.045, blending: 'additive', depthWrite: false, fog: false
      }),
      glowRustCore: matBasic(0xffb27a, {
        transparent: true, opacity: 0.08, blending: 'additive', depthWrite: false, fog: false
      }),
      glowCool: matBasic(0x4fdcff, {
        transparent: true, opacity: 0.05, blending: 'additive', depthWrite: false, fog: false
      }),
      glowCoolCore: matBasic(0xaef7ff, {
        transparent: true, opacity: 0.09, blending: 'additive', depthWrite: false, fog: false
      }),

      // Pseudo-reflections: long, directional additive slivers baked on the
      // floor and walls.  They read like blurred source colour bouncing off
      // wet metal, but they are ordinary merged geometry, not SSR/RT.
      reflectWarm: matBasic(0xffa95c, {
        transparent: true, opacity: 0.075, blending: 'additive', depthWrite: false, fog: false
      }),
      reflectCool: matBasic(0x63e8ff, {
        transparent: true, opacity: 0.07, blending: 'additive', depthWrite: false, fog: false
      }),
      reflectRust: matBasic(0xff6a3d, {
        transparent: true, opacity: 0.07, blending: 'additive', depthWrite: false, fog: false
      }),
      reflectBoss: matBasic(0xff4fb8, {
        transparent: true, opacity: 0.085, blending: 'additive', depthWrite: false, fog: false
      }),
      reflectExit: matBasic(0xff4d6d, {
        transparent: true, opacity: 0.07, blending: 'additive', depthWrite: false, fog: false
      })
    };

    var zoneGlowMats = [
      { mat: IM.glowWarm, base: 0.05, speed: 0.7, phase: 0.4 },
      { mat: IM.glowWarmCore, base: 0.09, speed: 0.9, phase: 1.7 },
      { mat: IM.glowRust, base: 0.045, speed: 0.55, phase: 2.6 },
      { mat: IM.glowRustCore, base: 0.08, speed: 0.75, phase: 4.1 },
      { mat: IM.glowCool, base: 0.05, speed: 0.8, phase: 3.2 },
      { mat: IM.glowCoolCore, base: 0.09, speed: 1.05, phase: 5.3 },
      { mat: IM.reflectWarm, base: 0.075, speed: 0.62, phase: 0.9 },
      { mat: IM.reflectCool, base: 0.07, speed: 0.74, phase: 2.2 },
      { mat: IM.reflectRust, base: 0.07, speed: 0.52, phase: 3.7 },
      { mat: IM.reflectBoss, base: 0.085, speed: 2.3, phase: 1.1 },
      { mat: IM.reflectExit, base: 0.07, speed: 1.7, phase: 4.6 }
    ];

    /* -------------------------------------------------- local pixel patterns */

    function makePixelTexture(seed, palette, mode) {
      var size = 16;
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;
      var rng = makeRng(seed);
      var x, y, i, j;
      ctx.fillStyle = palette[0].hex;
      ctx.fillRect(0, 0, size, size);

      if (mode === 'rust') {
        for (i = 0; i < 22; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * size);
          ctx.fillStyle = palette[2 + Math.floor(rng() * 2)].hex;
          ctx.fillRect(x, y, 1 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 5));
        }
        for (i = 0; i < 7; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * 10);
          ctx.fillStyle = palette[4].hex;
          ctx.fillRect(x, 0, 1, y + 2);
        }
        for (i = 0; i < 10; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * size);
          ctx.fillStyle = palette[3].hex;
          ctx.fillRect(x, y, 1 + Math.floor(rng() * 3), 1);
        }
      } else if (mode === 'concrete') {
        for (i = 0; i < 84; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * size);
          ctx.fillStyle = palette[1 + Math.floor(rng() * 4)].hex;
          ctx.fillRect(x, y, 1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
        }
        for (i = 0; i < 3; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * 4);
          ctx.fillStyle = palette[4].hex;
          for (j = 0; j < 9; j++) {
            ctx.fillRect(x, y + j, 1, 1);
            x += rng() < 0.5 ? -1 : 1;
            x = Math.max(0, Math.min(size - 1, x));
            if (rng() < 0.35) y++;
          }
        }
      } else if (mode === 'hazard') {
        for (y = 0; y < size; y++) {
          for (x = 0; x < size; x++) {
            var band = ((x + y) % 8) < 4;
            ctx.fillStyle = palette[band ? 1 : 0].hex;
            ctx.fillRect(x, y, 1, 1);
          }
        }
        for (i = 0; i < 16; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * size);
          ctx.fillStyle = palette[2 + Math.floor(rng() * 2)].hex;
          ctx.fillRect(x, y, 1 + Math.floor(rng() * 3), 1);
        }
      } else if (mode === 'grate') {
        for (x = 0; x < size; x++) {
          ctx.fillStyle = (x % 4) < 2 ? palette[1].hex : palette[0].hex;
          ctx.fillRect(x, 0, 1, size);
        }
        for (y = 2; y < size; y += 6) {
          ctx.fillStyle = palette[2].hex;
          ctx.fillRect(0, y, size, 1);
        }
      } else {
        ctx.strokeStyle = palette[1].hex;
        ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
        for (i = 0; i < 22; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * size);
          ctx.fillStyle = palette[2 + Math.floor(rng() * 2)].hex;
          ctx.fillRect(x, y, 1 + Math.floor(rng() * 2), 1);
        }
        ctx.fillStyle = palette[3].hex;
        ctx.fillRect(2, 2, 1, 1);
        ctx.fillRect(size - 3, 2, 1, 1);
        ctx.fillRect(2, size - 3, 1, 1);
        ctx.fillRect(size - 3, size - 3, 1, 1);
        ctx.fillStyle = palette[4].hex;
        for (i = 0; i < 5; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * size);
          ctx.fillRect(x, y, 2 + Math.floor(rng() * 4), 1);
        }
      }

      var img = ctx.getImageData(0, 0, size, size).data;
      var nr = [], ng = [], nb = [];
      for (j = 0; j < palette.length; j++) {
        var n = parseInt(palette[j].hex.slice(1), 16);
        nr.push((n >> 16) & 255);
        ng.push((n >> 8) & 255);
        nb.push(n & 255);
      }
      var data = new Uint8Array(size * size);
      for (i = 0; i < size * size; i++) {
        var r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2];
        var best = 0, bestD = Infinity;
        for (j = 0; j < palette.length; j++) {
          var dr = r - nr[j], dg = g - ng[j], db = b - nb[j];
          var d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; best = j; }
        }
        data[i] = best;
      }
      return { w: size, h: size, data: data, palette: palette, canvas: canvas };
    }

    var TEX = {
      rust: makePixelTexture(ART_SEED + 11, [
        { hex: '#59646e', key: 'steel' },
        { hex: '#343d45', key: 'steelDark' },
        { hex: '#8b4c30', key: 'rust' },
        { hex: '#ad663d', key: 'rustLight' },
        { hex: '#1e2321', key: 'oil' }
      ], 'rust'),
      concrete: makePixelTexture(ART_SEED + 23, [
        { hex: '#6a6b62', key: 'concrete' },
        { hex: '#4a4c46', key: 'concreteDark' },
        { hex: '#7a7b72', key: 'concrete2' },
        { hex: '#8a8a80', key: 'concreteLight' },
        { hex: '#313431', key: 'steelDeep' }
      ], 'concrete'),
      hazard: makePixelTexture(ART_SEED + 37, [
        { hex: '#d1a82f', key: 'hazard' },
        { hex: '#1c1d18', key: 'hazardDark' },
        { hex: '#8b4c30', key: 'rust' },
        { hex: '#583226', key: 'rustDark' }
      ], 'hazard'),
      grate: makePixelTexture(ART_SEED + 41, [
        { hex: '#56636e', key: 'steel' },
        { hex: '#101518', key: 'black' },
        { hex: '#74808a', key: 'steel2' }
      ], 'grate'),
      plate: makePixelTexture(ART_SEED + 53, [
        { hex: '#4a545e', key: 'steel' },
        { hex: '#20272e', key: 'steelDeep' },
        { hex: '#56636e', key: 'steel2' },
        { hex: '#74808a', key: 'steel2' },
        { hex: '#8b4c30', key: 'rust' }
      ], 'plate')
    };

    /* ----------------------------------------------------- merged pixel batch */

    var BATCH_VERT_CAP = 56000;
    var ART_VERT_CAP = 190000;
    var artVerts = 0;
    var batches = Object.create(null);
    var batchList = [];
    var floorGlows = [];
    var valveWheels = [];
    var valveWheelMat = matLambert(0xb2472e);
    var energyRings = [];
    var arenaMood = null;

    function PixelBatch(key, material) {
      this.key = key;
      this.material = material;
      this.p = [];
      this.n = [];
      this.idx = [];
      this.verts = 0;
      this.mesh = null;
    }

    PixelBatch.prototype.reserve = function (n) {
      if (this.verts + n > BATCH_VERT_CAP) return false;
      if (artVerts + n > ART_VERT_CAP) return false;
      this.verts += n;
      artVerts += n;
      return true;
    };

    // Six flat-shaded faces per box.  yaw is enough for panels, crates,
    // floor plates and warning chevrons.
    PixelBatch.prototype.box = function (x, y, z, sx, sy, sz, yaw) {
      if (!this.reserve(24)) return;
      var c = Math.cos(yaw || 0);
      var s = Math.sin(yaw || 0);
      var hx = Math.abs(sx) / 2, hy = Math.abs(sy) / 2, hz = Math.abs(sz) / 2;
      var p = this.p, nr = this.n, ind = this.idx;
      function v(lx, ly, lz, nx, ny, nz) {
        p.push(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
        nr.push(nx * c + nz * s, ny, -nx * s + nz * c);
      }
      function face(a, b, d, e, nx, ny, nz) {
        var base = p.length / 3;
        v(a[0], a[1], a[2], nx, ny, nz);
        v(b[0], b[1], b[2], nx, ny, nz);
        v(d[0], d[1], d[2], nx, ny, nz);
        v(e[0], e[1], e[2], nx, ny, nz);
        ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      face([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], 0, 0, 1);
      face([hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], 0, 0, -1);
      face([hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], 1, 0, 0);
      face([-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], -1, 0, 0);
      face([-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], 0, 1, 0);
      face([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], 0, -1, 0);
    };

    // Low-poly capped-looking pipe segment.  Flanges are separate short
    // wider segments, so the cylinder itself only needs side walls.
    PixelBatch.prototype.pipe = function (ax, ay, az, bx, by, bz, r, segments) {
      var dx = bx - ax, dy = by - ay, dz = bz - az;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-5) return;
      dx /= len; dy /= len; dz /= len;
      var seg = Math.max(4, segments || 8);
      var row = seg + 1;
      if (!this.reserve(row * 2)) return;
      var ux, uy, uz;
      if (Math.abs(dy) < 0.9) {
        ux = -dz; uy = 0; uz = dx;
      } else {
        ux = 0; uy = dz; uz = -dy;
      }
      var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      var vx = dy * uz - dz * uy;
      var vy = dz * ux - dx * uz;
      var vz = dx * uy - dy * ux;
      var p = this.p, nr = this.n, ind = this.idx;
      var start = p.length / 3;
      var centers = [[ax, ay, az], [bx, by, bz]];
      var e, k, co, si, nx, ny, nz;
      for (e = 0; e < 2; e++) {
        for (k = 0; k <= seg; k++) {
          var t = k / seg * Math.PI * 2;
          co = Math.cos(t); si = Math.sin(t);
          nx = ux * co + vx * si;
          ny = uy * co + vy * si;
          nz = uz * co + vz * si;
          p.push(centers[e][0] + nx * r, centers[e][1] + ny * r, centers[e][2] + nz * r);
          nr.push(nx, ny, nz);
        }
      }
      for (k = 0; k < seg; k++) {
        var a = start + k;
        var b = a + 1;
        var c = start + row + k;
        var d = c + 1;
        ind.push(a, c, b, b, c, d);
      }
    };

    PixelBatch.prototype.flush = function () {
      if (!this.verts) return;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', { array: new Float32Array(this.p), itemSize: 3 });
      geo.setAttribute('normal', { array: new Float32Array(this.n), itemSize: 3 });
      geo.setIndex(new Uint16Array(this.idx));
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.name = 'pixel-batch-' + this.key;
      // Keep the baked contact darkening underneath the additive fake lights.
      if (this.key === 'aoSoft') this.mesh.renderOrder = -3;
      else if (this.key === 'ao') this.mesh.renderOrder = -2;
      scene.add(this.mesh);
      this.p = null;
      this.n = null;
      this.idx = null;
    };

    function getBatch(key) {
      if (!IM[key]) return null;
      if (!batches[key]) {
        if (batchList.length >= 48) return null;
        batches[key] = new PixelBatch(key, IM[key]);
        batchList.push(batches[key]);
      }
      return batches[key];
    }

    function commitArt() {
      for (var i = 0; i < batchList.length; i++) batchList[i].flush();
    }

    /* ------------------------------------------------------------ primitives */

    function localXZ(x, z, lx, lz, yaw) {
      var c = Math.cos(yaw || 0);
      var s = Math.sin(yaw || 0);
      return [x + lx * c + lz * s, z - lx * s + lz * c];
    }

    function beamXZ(key, x0, z0, x1, z1, y, thick, height) {
      var b = getBatch(key);
      if (!b) return;
      var dx = x1 - x0, dz = z1 - z0;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-4) return;
      b.box((x0 + x1) / 2, y, (z0 + z1) / 2, thick, height, len, Math.atan2(dx, dz));
    }

    function pipeBasis(dx, dy, dz) {
      var ux, uy, uz;
      if (Math.abs(dy) < 0.9) {
        ux = -dz; uy = 0; uz = dx;
      } else {
        ux = 0; uy = dz; uz = -dy;
      }
      var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      return {
        ux: ux, uy: uy, uz: uz,
        vx: dy * uz - dz * uy,
        vy: dz * ux - dx * uz,
        vz: dx * uy - dy * ux
      };
    }

    function addFlangeAt(x, y, z, dx, dy, dz, r, width) {
      var b = getBatch('steelDark');
      if (!b) return;
      var h = width / 2;
      b.pipe(x - dx * h, y - dy * h, z - dz * h,
        x + dx * h, y + dy * h, z + dz * h, r, 8);
      // A thin occlusion ring on the upstream side seats the flange into the
      // pipe run instead of letting it float as a bright collar.
      var ao = getBatch('aoSoft');
      if (ao && r > 0.05) {
        ao.pipe(x - dx * (h + 0.026), y - dy * (h + 0.026), z - dz * (h + 0.026),
          x - dx * (h + 0.004), y - dy * (h + 0.004), z - dz * (h + 0.004),
          r * 1.06, 8);
      }
    }

    function addBoltRing(cx, cy, cz, dx, dy, dz, radius, count, size) {
      var b = getBatch('steel2');
      if (!b) return;
      var basis = pipeBasis(dx, dy, dz);
      for (var i = 0; i < count; i++) {
        var a = i / count * Math.PI * 2;
        var co = Math.cos(a), si = Math.sin(a);
        b.box(
          cx + (basis.ux * co + basis.vx * si) * radius,
          cy + (basis.uy * co + basis.vy * si) * radius,
          cz + (basis.uz * co + basis.vz * si) * radius,
          size, size, size, 0
        );
      }
    }

    function addPipeRun(ax, ay, az, bx, by, bz, r, opts) {
      opts = opts || {};
      var dx = bx - ax, dy = by - ay, dz = bz - az;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 0.02) return;
      dx /= len; dy /= len; dz /= len;
      var b = getBatch(opts.material || 'steel');
      if (!b) return;
      b.pipe(ax, ay, az, bx, by, bz, r, opts.segments || 8);

      var flangeR = r * (opts.flangeScale || 1.55);
      var spacing = opts.flangeSpacing || 3.1;
      var t = 0.08;
      for (; t < len - 0.08; t += spacing) {
        addFlangeAt(ax + dx * t, ay + dy * t, az + dz * t,
          dx, dy, dz, flangeR, opts.flangeWidth || 0.09);
      }
      addFlangeAt(bx - dx * 0.04, by - dy * 0.04, bz - dz * 0.04,
        dx, dy, dz, flangeR, 0.1);
      if (opts.bolts !== false) {
        addBoltRing(ax + dx * 0.08, ay + dy * 0.08, az + dz * 0.08,
          dx, dy, dz, flangeR * 1.28, 6, 0.055);
      }
      if (opts.clamps) {
        var cd = opts.clampGap || 3.4;
        for (var ct = 1.4; ct < len; ct += cd) {
          var cx = ax + dx * ct, cy = ay + dy * ct, cz = az + dz * ct;
          var cb = getBatch('steelDeep');
          if (cb) {
            cb.pipe(cx - dx * 0.05, cy - dy * 0.05, cz - dz * 0.05,
              cx + dx * 0.05, cy + dy * 0.05, cz + dz * 0.05, r * 1.2, 8);
            var lb = getBatch('steel2');
            if (lb) {
              lb.box(cx, cy, cz, r * 2.5, 0.055, 0.055, 0);
              lb.box(cx, cy, cz, 0.055, r * 2.5, 0.055, 0);
            }
          }
        }
      }
    }

    function addCableRun(points, radius, strands, key) {
      if (!points || points.length < 2) return;
      var b = getBatch(key || 'cable');
      if (!b) return;
      for (var s = 0; s < strands; s++) {
        var off = (s - (strands - 1) / 2) * 0.085;
        for (var i = 0; i < points.length - 1; i++) {
          var p0 = points[i], p1 = points[i + 1];
          b.pipe(
            p0.x + off, p0.y + off * 0.65, p0.z + off,
            p1.x + off, p1.y + off * 0.65, p1.z + off,
            radius, 6
          );
        }
      }
    }

    /* ------------------------------------------------------------- signage */

    var FONT = {
      ' ': ['000', '000', '000', '000', '000'],
      'A': ['010', '101', '111', '101', '101'],
      'B': ['110', '101', '110', '101', '110'],
      'C': ['011', '100', '100', '100', '011'],
      'D': ['110', '101', '101', '101', '110'],
      'E': ['111', '100', '110', '100', '111'],
      'G': ['011', '100', '101', '101', '011'],
      'H': ['101', '101', '111', '101', '101'],
      'I': ['111', '010', '010', '010', '111'],
      'K': ['101', '101', '110', '101', '101'],
      'L': ['100', '100', '100', '100', '111'],
      'M': ['101', '111', '111', '101', '101'],
      'N': ['101', '111', '111', '111', '101'],
      'O': ['111', '101', '101', '101', '111'],
      'P': ['110', '101', '110', '100', '100'],
      'R': ['110', '101', '110', '101', '101'],
      'S': ['011', '100', '010', '001', '110'],
      'T': ['111', '010', '010', '010', '010'],
      'U': ['101', '101', '101', '101', '111'],
      'V': ['101', '101', '101', '101', '010'],
      'W': ['101', '101', '111', '111', '101'],
      'X': ['101', '101', '010', '101', '101'],
      'Y': ['101', '101', '010', '010', '010'],
      'Z': ['111', '001', '010', '100', '111'],
      '0': ['111', '101', '101', '101', '111'],
      '1': ['010', '110', '010', '010', '111'],
      '2': ['110', '001', '010', '100', '111'],
      '3': ['110', '001', '010', '001', '110'],
      '4': ['101', '101', '111', '001', '001'],
      '5': ['111', '100', '110', '001', '110'],
      '6': ['011', '100', '111', '101', '111'],
      '7': ['111', '001', '010', '010', '010'],
      '8': ['111', '101', '111', '101', '111'],
      '9': ['111', '101', '111', '001', '110'],
      '-': ['000', '000', '111', '000', '000'],
      '/': ['001', '001', '010', '100', '100'],
      '+': ['000', '010', '111', '010', '000'],
      ':': ['000', '010', '000', '010', '000']
    };

    function drawPixelText(key, x, y, z, yaw, text, cell, normalOffset) {
      var b = getBatch(key);
      if (!b) return;
      text = String(text || '').toUpperCase();
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      var total = text.length * 4 - 1;
      for (var i = 0; i < text.length; i++) {
        var glyph = FONT[text.charAt(i)] || FONT[' '];
        for (var row = 0; row < 5; row++) {
          for (var col = 0; col < 3; col++) {
            if (glyph[row].charAt(col) !== '1') continue;
            var lx = -total * cell / 2 + i * 4 * cell + col * cell + cell / 2;
            var ly = (2 - row) * cell;
            b.box(
              x + lx * c + normalOffset * s,
              y + ly,
              z - lx * s + normalOffset * c,
              cell * 0.92, cell * 0.92, 0.014, yaw
            );
          }
        }
      }
    }

    function addSignPanel(x, y, z, yaw, w, h, text, textKey, opts) {
      opts = opts || {};
      var back = getBatch('black');
      var frame = getBatch(opts.frame || 'steel2');
      if (!back || !frame) return;
      back.box(x, y, z, w, h, 0.055, yaw);
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      var nOff = 0.04;
      frame.box(x + nOff * s, y + h / 2 - 0.035, z + nOff * c, w, 0.06, 0.06, yaw);
      frame.box(x + nOff * s, y - h / 2 + 0.035, z + nOff * c, w, 0.06, 0.06, yaw);
      var fl = localXZ(x, z, -w / 2 + 0.035, nOff, yaw);
      var fr = localXZ(x, z, w / 2 - 0.035, nOff, yaw);
      frame.box(fl[0], y, fl[1], 0.06, h, 0.06, yaw);
      frame.box(fr[0], y, fr[1], 0.06, h, 0.06, yaw);
      var bolt = getBatch('steelDark');
      if (bolt) {
        for (var bx = -1; bx <= 1; bx += 2) {
          for (var by = -1; by <= 1; by += 2) {
            var p = localXZ(x, z, bx * (w / 2 - 0.08), nOff, yaw);
            bolt.box(p[0], y + by * (h / 2 - 0.08), p[1], 0.055, 0.055, 0.055, yaw);
          }
        }
      }
      var cell = Math.min(h * 0.115, w / (text.length * 4.3));
      drawPixelText(textKey || 'white', x, y, z, yaw, text, Math.max(0.038, cell), 0.055);
    }

    function drawFloorText(key, x, z, text, cell) {
      var b = getBatch(key);
      if (!b) return;
      text = String(text || '').toUpperCase();
      var total = text.length * 4 - 1;
      for (var i = 0; i < text.length; i++) {
        var glyph = FONT[text.charAt(i)] || FONT[' '];
        for (var row = 0; row < 5; row++) {
          for (var col = 0; col < 3; col++) {
            if (glyph[row].charAt(col) !== '1') continue;
            b.box(
              x + (-total * cell / 2 + i * 4 * cell + col * cell + cell / 2),
              0.034,
              z + (row - 2) * cell,
              cell * 0.88, 0.012, cell * 0.88, 0
            );
          }
        }
      }
    }

    /* ---------------------------------------------------------- surface paint */

    function paintPixelSurface(texture, x, y, z, yaw, w, h, cols, rows, normalOffset) {
      if (!texture) return;
      cols = cols || 6;
      rows = rows || 5;
      var cw = w / cols, ch = h / rows;
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      var off = normalOffset === undefined ? 0.062 : normalOffset;
      for (var py = 0; py < rows; py++) {
        for (var px = 0; px < cols; px++) {
          var texX = Math.floor(px / cols * texture.w);
          var texY = Math.floor(py / rows * texture.h);
          var entry = texture.palette[texture.data[texY * texture.w + texX]];
          if (!entry) continue;
          var b = getBatch(entry.key);
          if (!b) continue;
          var lx = -w / 2 + (px + 0.5) * cw;
          var ly = h / 2 - (py + 0.5) * ch;
          b.box(
            x + lx * c + off * s,
            y + ly,
            z - lx * s + off * c,
            cw * 1.02, ch * 1.02, 0.01, yaw
          );
        }
      }
    }

    function paintFloorSurface(texture, x, z, w, d, cols, rows) {
      if (!texture) return;
      cols = cols || 6;
      rows = rows || 6;
      var cw = w / cols, cd = d / rows;
      for (var pz = 0; pz < rows; pz++) {
        for (var px = 0; px < cols; px++) {
          var texX = Math.floor(px / cols * texture.w);
          var texY = Math.floor(pz / rows * texture.h);
          var entry = texture.palette[texture.data[texY * texture.w + texX]];
          if (!entry) continue;
          var b = getBatch(entry.key);
          if (!b) continue;
          b.box(
            x - w / 2 + (px + 0.5) * cw,
            0.033,
            z - d / 2 + (pz + 0.5) * cd,
            cw * 1.02, 0.008, cd * 1.02, 0
          );
        }
      }
    }

    /* ---------------------------------------------------------- misc props */

    function addRustStreak(x, y, z, yaw, w, h) {
      var b = getBatch(hash2(x, z) > 0.5 ? 'rust' : 'rustDark');
      if (!b) return;
      b.box(x, y - h / 2, z, w, h, 0.018, yaw);
      for (var i = 0; i < 3; i++) {
        var p = localXZ(x, z, (hash2(i, x) - 0.5) * w, 0.015, yaw);
        b.box(p[0], y - h * (0.15 + hash2(z, i) * 0.5), p[1],
          w * (0.18 + hash2(x, i) * 0.25), h * 0.42, 0.02, yaw);
      }
    }

    function addContactAO(x, z, sx, sz, yaw, softOnly) {
      var outer = getBatch('aoSoft');
      if (outer) outer.box(x, 0.058, z, sx, 0.006, sz, yaw || 0);
      if (softOnly) return;
      var core = getBatch('ao');
      if (core) core.box(x, 0.06, z, sx * 0.68, 0.006, sz * 0.68, yaw || 0);
    }

    function addWallAO(x, y, z, sx, sy, sz, yaw, softOnly) {
      var outer = getBatch('aoSoft');
      if (outer) outer.box(x, y, z, sx, sy, sz, yaw || 0);
      if (softOnly) return;
      var core = getBatch('ao');
      if (core) core.box(x, y, z, sx * 0.62, sy * 0.82, sz * 1.4, yaw || 0);
    }

    // Two low-opacity additive slabs per region.  They are merged into the
    // static art batches, so region colour is almost free at runtime.
    function addZoneLightPool(x, z, radius, key) {
      var outer = getBatch('glow' + key);
      var core = getBatch('glow' + key + 'Core');
      if (outer) outer.box(x, 0.062, z, radius * 2, 0.005, radius * 2, 0);
      if (core) core.box(x, 0.064, z, radius * 1.06, 0.005, radius * 1.06, 0);
    }

    function addFloorGlow(x, z, radius, hex, opacity) {
      if (floorGlows.length >= 14) return null;
      var mat = matBasic(hex, {
        transparent: true,
        opacity: opacity * 1.25,
        blending: 'additive',
        depthWrite: false,
        fog: false
      });
      var mesh = new THREE.Mesh(G.circle, mat);
      mesh.position.set(x, 0.055, z);
      mesh.scale.set(radius, 1, radius);
      scene.add(mesh);
      floorGlows.push({
        mesh: mesh,
        mat: mat,
        base: opacity * 1.25,
        phase: arand(0, Math.PI * 2),
        speed: arand(0.7, 1.5)
      });
      return mat;
    }

    // Directional colour strips baked into the static batches.  These are the
    // cheap "ray-traced" read: a source colour dragged across the floor toward
    // the viewer instead of a flat circle around the emitter.
    function addReflectionFloor(key, x, z, yaw, length, width) {
      var b = getBatch(key);
      if (b) b.box(x, 0.072, z, width, 0.006, length, yaw || 0);
    }

    function addReflectionWall(key, x, y, z, yaw, width, height) {
      var b = getBatch(key);
      if (b) b.box(x, y, z, width, height, 0.012, yaw || 0);
    }

    function addLamp(x, z, colorKey, glowHex) {
      var housing = getBatch('steelDark');
      var tube = getBatch(colorKey);
      var cage = getBatch('steel2');
      if (housing) housing.box(x, 4.2, z, 2.55, 0.14, 0.5, 0);
      if (tube) tube.box(x, 4.1, z, 2.0, 0.05, 0.2, 0);
      if (cage) {
        for (var i = -1; i <= 1; i++) {
          cage.box(x + i * 0.64, 4.02, z, 0.045, 0.18, 0.46, 0);
        }
        cage.box(x, 3.97, z, 2.15, 0.035, 0.035, 0);
        cage.box(x - 1.05, 4.34, z, 0.045, 0.22, 0.045, 0);
        cage.box(x + 1.05, 4.34, z, 0.045, 0.22, 0.045, 0);
      }
      // Layered bloom around the tube: wide warm/cool spill plus a hot core.
      var warm = glowHex === 0xffb153;
      var halo = getBatch(warm ? 'glowWarm' : 'glowCool');
      var haloCore = getBatch(warm ? 'glowWarmCore' : 'glowCoolCore');
      if (halo) halo.box(x, 4.02, z, 3.0, 0.5, 0.82, 0);
      if (haloCore) haloCore.box(x, 4.04, z, 1.45, 0.22, 0.46, 0);
      addFloorGlow(x, z, 2.7, glowHex, 0.055);

      // Reflected colour streaks under the fixture, biased toward the middle
      // of the arena so the floor reads as a brushed metal surface.
      var refl = warm ? 'reflectWarm' : 'reflectCool';
      var towardCenter = z >= 0 ? -1 : 1;
      addReflectionFloor(refl, x, z + towardCenter * 1.55, 0, 3.2, 0.3);
      addReflectionFloor(refl, x - 0.56, z + towardCenter * 1.1, 0, 2.35, 0.12);
      addReflectionFloor(refl, x + 0.56, z + towardCenter * 1.1, 0, 2.35, 0.12);
    }

    function addIBeam(x, z, h, width, yaw) {
      var b = getBatch('steelDark');
      var accent = getBatch('steel2');
      var rust = getBatch('rust');
      if (!b) return;
      yaw = yaw || 0;
      addContactAO(x, z, width * 2.45, width * 2.45, yaw);
      b.box(x, h / 2, z, width * 0.22, h, width * 0.22, yaw);
      var pt = localXZ(x, z, 0, width * 0.38, yaw);
      b.box(pt[0], h / 2, pt[1], width, h, 0.11, yaw);
      pt = localXZ(x, z, 0, -width * 0.38, yaw);
      b.box(pt[0], h / 2, pt[1], width, h, 0.11, yaw);
      b.box(x, 0.09, z, width * 1.75, 0.18, width * 1.75, yaw);
      if (accent) {
        for (var i = -1; i <= 1; i += 2) {
          var p = localXZ(x, z, i * width * 0.48, 0, yaw);
          accent.box(p[0], 0.2, p[1], 0.06, 0.06, 0.06, yaw);
        }
      }
      if (rust) {
        var rp = localXZ(x, z, width * 0.4, 0, yaw);
        rust.box(rp[0], 0.75, rp[1], 0.12, 0.55, 0.025, yaw);
      }
    }

    function addCrate(x, y, z, sx, sy, sz, yaw, tag) {
      var body = getBatch(hash2(x, z) > 0.58 ? 'steelDark' : 'steel');
      var edge = getBatch('steel2');
      var rust = getBatch('rust');
      var stripe = getBatch(tag === 'danger' ? 'redPaint' : 'hazard');
      if (!body || !edge) return;
      if (y < 0.05) addContactAO(x, z, sx * 1.5, sz * 1.5, yaw);
      body.box(x, y + sy / 2, z, sx, sy, sz, yaw);
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      edge.box(x, y + sy - 0.05, z, sx * 1.03, 0.1, sz * 1.03, yaw);
      edge.box(x, y + 0.06, z, sx * 1.03, 0.09, sz * 1.03, yaw);
      for (var sxSign = -1; sxSign <= 1; sxSign += 2) {
        for (var szSign = -1; szSign <= 1; szSign += 2) {
          var p = localXZ(x, z, sxSign * sx * 0.43, szSign * sz * 0.43, yaw);
          edge.box(p[0], y + sy * 0.5, p[1], 0.09, sy * 0.92, 0.09, yaw);
        }
      }
      stripe.box(x + s * (sz / 2 + 0.012), y + sy * 0.5, z + c * (sz / 2 + 0.012),
        sx * 0.42, 0.07, 0.02, yaw);
      if (rust) {
        rust.box(x - s * (sz / 2 + 0.014), y + sy * 0.72, z - c * (sz / 2 + 0.014),
          sx * 0.3, sy * 0.22, 0.018, yaw);
      }
    }

    function addBarrel(x, z, scale, key) {
      var b = getBatch(key || 'rust');
      var hoop = getBatch('steelDark');
      var top = getBatch('steel2');
      if (!b || !hoop) return;
      var r = 0.3 * scale, h = 0.82 * scale;
      addContactAO(x, z, r * 3.1, r * 3.1, 0);
      b.pipe(x, 0.02, z, x, h, z, r, 8);
      hoop.pipe(x, h * 0.25, z, x, h * 0.25 + 0.045, z, r * 1.05, 8);
      hoop.pipe(x, h * 0.7, z, x, h * 0.7 + 0.045, z, r * 1.05, 8);
      if (top) {
        top.box(x, h + 0.012, z, r * 1.78, 0.035, r * 1.78, 0);
        top.box(x + r * 0.42, h + 0.038, z, 0.09, 0.035, 0.09, 0);
      }
    }

    function addValve(x, y, z, axis, scale) {
      scale = scale || 1;
      var dir = axis === 'x' ? [1, 0, 0] : (axis === 'z' ? [0, 0, 1] : [0, 1, 0]);
      var body = getBatch('steelDark');
      var stem = getBatch('steel2');
      if (!body || !stem) return;
      var midX = x + dir[0] * 0.34 * scale;
      var midY = y + dir[1] * 0.34 * scale;
      var midZ = z + dir[2] * 0.34 * scale;
      body.pipe(x, y, z, midX, midY, midZ, 0.24 * scale, 8);
      addFlangeAt(x, y, z, dir[0], dir[1], dir[2], 0.34 * scale, 0.08);
      addFlangeAt(midX, midY, midZ, dir[0], dir[1], dir[2], 0.3 * scale, 0.07);
      var bonnetY = midY + (axis === 'y' ? 0.03 : 0.17) * scale;
      stem.box(midX, bonnetY, midZ, 0.16 * scale, 0.24 * scale, 0.16 * scale, 0);
      stem.pipe(midX, bonnetY, midZ, midX, midY + 0.34 * scale, midZ,
        0.035 * scale, 5);
      var wheel = new THREE.Mesh(G.torus, valveWheelMat);
      wheel.scale.setScalar(0.52 * scale);
      wheel.position.set(midX, midY + 0.38 * scale, midZ);
      scene.add(wheel);
      valveWheels.push(wheel);
    }

    function addElbow(cx, cy, cz, ax, ay, az, bx, by, bz, arm, r, material) {
      var e1 = [cx + ax * arm, cy + ay * arm, cz + az * arm];
      var e2 = [cx + bx * arm, cy + by * arm, cz + bz * arm];
      addPipeRun(cx, cy, cz, e1[0], e1[1], e1[2], r, {
        material: material || 'steel', flangeSpacing: 9, bolts: false
      });
      addPipeRun(cx, cy, cz, e2[0], e2[1], e2[2], r, {
        material: material || 'steel', flangeSpacing: 9, bolts: false
      });
      var joint = getBatch('steelDark');
      if (joint) joint.box(cx, cy, cz, r * 3.1, r * 3.1, r * 3.1, 0);
      addFlangeAt(e1[0], e1[1], e1[2], ax, ay, az, r * 1.6, 0.085);
      addFlangeAt(e2[0], e2[1], e2[2], bx, by, bz, r * 1.6, 0.085);
    }

    function addGuardRail(x0, z0, x1, z1) {
      var dx = x1 - x0, dz = z1 - z0;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.4) return;
      var count = Math.max(2, Math.ceil(len / 2.0) + 1);
      var post = getBatch('steelDark');
      var rail = getBatch('steel2');
      var paint = getBatch('hazard');
      for (var i = 0; i < count; i++) {
        var t = i / (count - 1);
        var x = x0 + dx * t, z = z0 + dz * t;
        if (post) {
          post.box(x, 0.52, z, 0.085, 1.04, 0.085, 0);
          post.box(x, 0.04, z, 0.24, 0.08, 0.24, 0);
        }
        if (paint && i % 2 === 0) paint.box(x, 0.76, z, 0.1, 0.18, 0.1, 0);
      }
      beamXZ('steel2', x0, z0, x1, z1, 1.03, 0.065, 0.065);
      beamXZ('steel2', x0, z0, x1, z1, 0.62, 0.055, 0.055);
      void rail;
    }

    function addBrokenServiceBay(x, z, yaw) {
      var back = getBatch('black');
      var plate = getBatch('rust');
      var trim = getBatch('steelDark');
      var wire = getBatch('cable');
      if (!back || !plate || !trim) return;
      back.box(x, 1.94, z, 1.9, 1.55, 0.06, yaw);
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      plate.box(x - 0.42 * c + 0.09 * s, 1.64, z + 0.42 * s + 0.09 * c,
        0.85, 1.04, 0.045, yaw + 0.14);
      trim.box(x, 2.73, z, 2.05, 0.08, 0.09, yaw);
      trim.box(x, 1.15, z, 2.05, 0.08, 0.09, yaw);
      for (var i = -1; i <= 1; i++) {
        var p = localXZ(x, z, i * 0.28, 0.05, yaw);
        if (wire) {
          wire.pipe(p[0], 2.55, p[1], p[0] + 0.06 * s, 1.55 + i * 0.18, p[1] + 0.06 * c, 0.018, 5);
        }
      }
    }

    function addWallVent(x, y, z, yaw, w, h) {
      var back = getBatch('black');
      var frame = getBatch('steelDark');
      var slat = getBatch('steel2');
      if (!back || !frame || !slat) return;
      back.box(x, y, z, w, h, 0.06, yaw);
      frame.box(x, y + h / 2 - 0.04, z, w + 0.1, 0.08, 0.08, yaw);
      frame.box(x, y - h / 2 + 0.04, z, w + 0.1, 0.08, 0.08, yaw);
      var vl = localXZ(x, z, -w / 2 + 0.04, 0.04, yaw);
      var vr = localXZ(x, z, w / 2 - 0.04, 0.04, yaw);
      frame.box(vl[0], y, vl[1], 0.08, h, 0.08, yaw);
      frame.box(vr[0], y, vr[1], 0.08, h, 0.08, yaw);
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      for (var i = 0; i < 6; i++) {
        var ly = -h / 2 + 0.13 + i * (h - 0.22) / 5;
        slat.box(x + 0.04 * s, y + ly, z + 0.04 * c, w * 0.8, 0.045, 0.035, yaw);
      }
      for (var b = -1; b <= 1; b += 2) {
        var p = localXZ(x, z, b * (w / 2 - 0.12), 0.045, yaw);
        slat.box(p[0], y + b * (h / 2 - 0.12), p[1], 0.055, 0.055, 0.055, yaw);
      }
    }

    function addFloorGrate(x, z, w, d) {
      var back = getBatch('black');
      var slat = getBatch('steel2');
      var edge = getBatch('steelDark');
      if (!back || !slat || !edge) return;
      back.box(x, 0.02, z, w, 0.035, d, 0);
      edge.box(x, 0.035, z + d / 2, w + 0.08, 0.06, 0.08, 0);
      edge.box(x, 0.035, z - d / 2, w + 0.08, 0.06, 0.08, 0);
      edge.box(x - w / 2, 0.035, z, 0.08, 0.06, d, 0);
      edge.box(x + w / 2, 0.035, z, 0.08, 0.06, d, 0);
      for (var i = 0; i < 7; i++) {
        slat.box(x - w / 2 + 0.15 + i * (w - 0.3) / 6, 0.045, z, 0.055, 0.025, d * 0.82, 0);
      }
    }

    function addCrateStack(x, z, spanX, spanZ, baseY, tag) {
      addCrate(x, baseY, z, spanX * 0.72, 0.8, spanZ * 0.62, 0, tag);
      addCrate(x + spanX * 0.11, baseY + 0.8, z - spanZ * 0.04,
        spanX * 0.48, 0.62, spanZ * 0.4, 0.12, tag);
      addCrate(x - spanX * 0.38, baseY, z + spanZ * 0.21,
        spanX * 0.3, 0.5, spanZ * 0.28, -0.08, '');
      addCrate(x + spanX * 0.41, baseY, z + spanZ * 0.24,
        spanX * 0.24, 0.42, spanZ * 0.22, 0.06, '');
    }

    function addBarrelCluster(x, z, count) {
      for (var i = 0; i < count; i++) {
        var a = i / Math.max(1, count) * Math.PI * 2;
        addBarrel(
          x + Math.cos(a) * (0.42 + (i % 2) * 0.18),
          z + Math.sin(a) * (0.42 + (i % 2) * 0.18),
          0.82 + hash2(i, x) * 0.18,
          i % 3 === 0 ? 'rustDark' : (i % 3 === 1 ? 'greenPaint' : 'rust')
        );
      }
    }

    function addControlCabinet(x, z, yaw, w, h) {
      var body = getBatch('steelDark');
      var face = getBatch('black');
      var trim = getBatch('steel2');
      if (!body || !face || !trim) return;
      addContactAO(x, z, w * 1.7, 1.15, yaw);
      body.box(x, h / 2, z, w, h, 0.55, yaw);
      var p = localXZ(x, z, 0, 0.29, yaw);
      face.box(p[0], h * 0.62, p[1], w * 0.72, h * 0.3, 0.035, yaw);
      var scr = getBatch('screen');
      if (scr) scr.box(p[0], h * 0.62, p[1], w * 0.5, h * 0.17, 0.022, yaw);
      for (var i = 0; i < 3; i++) {
        var q = localXZ(x, z, (i - 1) * w * 0.18, 0.3, yaw);
        trim.box(q[0], h * 0.27, q[1], 0.075, 0.075, 0.035, yaw);
      }
      trim.box(p[0], h * 0.86, p[1], w * 0.82, 0.05, 0.05, yaw);
      var lip = localXZ(x, z, 0, 0.3, yaw);
      trim.box(lip[0], h * 0.08, lip[1], w * 0.84, 0.08, 0.05, yaw);
    }

    function addGeneratorSkid(x, z, yaw) {
      var body = getBatch('steelDark');
      var shell = getBatch('steel');
      var pipe = getBatch('copper');
      var trim = getBatch('steel2');
      var danger = getBatch('hazard');
      if (!body || !shell) return;
      addContactAO(x, z, 5.1, 2.3, yaw);
      body.box(x, 0.3, z, 4.12, 0.55, 1.46, yaw);
      shell.box(x, 1.15, z, 3.72, 1.3, 1.36, yaw);
      body.box(x, 1.84, z, 3.5, 0.1, 1.28, yaw);
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      var p = localXZ(x, z, 0, 0.7, yaw);
      if (trim) {
        trim.box(p[0], 1.05, p[1], 2.8, 0.07, 0.04, yaw);
        trim.box(p[0], 0.75, p[1], 2.8, 0.04, 0.04, yaw);
      }
      if (danger) {
        for (var i = 0; i < 5; i++) {
          var q = localXZ(x, z, -1.45 + i * 0.72, 0.695, yaw);
          danger.box(q[0], 0.48, q[1], 0.34, 0.2, 0.025, yaw);
        }
      }
      if (pipe) {
        pipe.pipe(x - 0.9, 1.7, z, x - 0.9, 3.8, z, 0.11, 7);
        pipe.pipe(x + 0.85, 1.7, z, x + 0.85, 3.5, z, 0.085, 7);
        addFlangeAt(x - 0.9, 3.1, z, 0, 1, 0, 0.17, 0.08);
      }
      var vents = getBatch('black');
      if (vents) {
        for (var v = -1; v <= 1; v += 2) {
          var vp = localXZ(x, z, v * 1.1, 0.69, yaw);
          vents.box(vp[0], 0.95, vp[1], 0.75, 0.48, 0.03, yaw);
          for (var k = 0; k < 4; k++) {
            trim.box(vp[0] + 0.024 * s, 0.77 + k * 0.12, vp[1] + 0.024 * c,
              0.64, 0.035, 0.02, yaw);
          }
        }
      }
    }

    function addBossPylon(x, z) {
      addIBeam(x, z, 4.15, 0.72, 0);
      addContactAO(x, z, 2.1, 2.1, 0);
      var trim = getBatch('steel2');
      var glow = getBatch('fxPylon');
      if (trim) {
        trim.box(x, 0.32, z, 1.2, 0.24, 1.2, 0);
        trim.box(x, 3.9, z, 1.0, 0.18, 1.0, 0);
      }
      if (glow) {
        glow.box(x, 2.15, z, 0.16, 2.2, 0.16, 0);
        glow.box(x, 1.25, z, 0.55, 0.09, 0.55, 0);
      }
      for (var i = 0; i < 2; i++) {
        var ring = new THREE.Mesh(G.torus, IM.fxPylon);
        ring.position.set(x, 1.7 + i * 0.88, z);
        ring.scale.setScalar(0.62 - i * 0.08);
        scene.add(ring);
        energyRings.push({ mesh: ring, speed: 0.7 + i * 0.25, axis: 'flat', base: 0 });
      }
    }

    /* ------------------------------------------------------- boss mood system */

    function setArenaPhase(phase) {
      if (!arenaMood) return;
      arenaMood.phase = phase;
      var line = 0x58ddff;
      var pylon = 0x3ec8dd;
      var beacon = 0x58ddff;
      var reflect = 0xff4fb8;
      var fog = 0x03060c;
      var near = 15;
      var far = 47;
      var fence = 0x4bb8c9;
      var fenceOpacity = 0;
      var barrier = false;
      var narrow = false;

      if (phase === 1) {
        line = 0x58ddff;
        pylon = 0x3ec8dd;
        beacon = 0x58ddff;
        fog = 0x03070e;
        near = 14;
        far = 46;
      } else if (phase === 2) {
        line = 0x8ff4ff;
        pylon = 0x67e4ef;
        beacon = 0xffc45a;
        reflect = 0x9b6bff;
        fog = 0x080b12;
        near = 13;
        far = 42;
        fence = 0xffc45a;
        fenceOpacity = 0.2;
        barrier = true;
      } else if (phase === 3) {
        line = 0xff584f;
        pylon = 0xff6b55;
        beacon = 0xff3d32;
        reflect = 0xff3d32;
        fog = 0x170507;
        near = 10;
        far = 34;
        fence = 0xff4a3f;
        fenceOpacity = 0.35;
        barrier = true;
        narrow = true;
      } else if (phase === 4) {
        line = 0x6dffb0;
        pylon = 0x6dffb0;
        beacon = 0x6dffb0;
        reflect = 0x6dffb0;
        fog = 0x030a0b;
        near = 15;
        far = 47;
      }

      arenaMood.lineMat.color.setHex(line);
      arenaMood.pylonMat.color.setHex(pylon);
      arenaMood.beaconMat.color.setHex(beacon);
      IM.reflectBoss.color.setHex(reflect);
      if (arenaMood.arenaGlowMat) arenaMood.arenaGlowMat.color.setHex(pylon);
      if (arenaMood.arenaGlowCoreMat) arenaMood.arenaGlowCoreMat.color.setHex(beacon);
      arenaMood.fenceMat.color.setHex(fence);
      arenaMood.fenceMat.opacity = fenceOpacity;
      arenaMood.barrierGroup.visible = barrier;
      arenaMood.narrowGroup.visible = narrow;
      if (scene.fog) {
        scene.fog.color.setHex(fog);
        scene.fog.near = near;
        scene.fog.far = far;
      }
      if (scene.background) scene.background.setHex(fog);
      arenaMood.near = near;
      arenaMood.far = far;
      arenaMood.lastPhase = phase;
    }

    function updateArenaFx(dt) {
      var i;
      for (i = 0; i < floorGlows.length; i++) {
        var g = floorGlows[i];
        g.mat.opacity = g.base * (0.78 + 0.22 * (0.5 + 0.5 * Math.sin(worldClock * g.speed + g.phase)));
      }
      for (i = 0; i < energyRings.length; i++) {
        var er = energyRings[i];
        if (er.axis === 'flat' || er.axis === 'tilt') {
          var sway = er.axis === 'flat' ? 0.04 : 0.16;
          var rate = er.axis === 'flat' ? 0.7 : 0.38;
          er.mesh.rotation.z = (er.base || 0) + Math.sin(worldClock * rate + er.speed) * sway;
        } else if (er.axis === 'x') {
          er.mesh.rotation.y += dt * er.speed;
        } else {
          er.mesh.rotation.z += dt * er.speed;
        }
      }
      if (!arenaMood) return;
      var m = arenaMood;
      var pulse = 0.5 + 0.5 * Math.sin(worldClock * (m.phase === 3 ? 8 : 3.2));
      if (m.arenaGlowMat) m.arenaGlowMat.opacity = 0.026 + pulse * 0.02;
      if (m.arenaGlowCoreMat) m.arenaGlowCoreMat.opacity = 0.042 + pulse * 0.033;
      if (m.phase === 2) {
        m.fenceMat.opacity = 0.14 + pulse * 0.12;
        m.beaconMat.opacity = 0.55 + pulse * 0.35;
      } else if (m.phase === 3) {
        m.fenceMat.opacity = 0.24 + pulse * 0.18;
        m.narrowMat.opacity = 0.16 + pulse * 0.17;
        m.beaconMat.opacity = 0.6 + pulse * 0.4;
        m.lineMat.color.setRGB(0.72 + pulse * 0.28, 0.14 + pulse * 0.16, 0.1 + pulse * 0.08);
        if (mode === 'playing') {
          m.sparkT -= dt;
          if (m.sparkT <= 0) {
            m.sparkT = 0.9 + Math.random() * 1.5;
            spawnParticles(m.sparkPoint, 0xffb24f, 2, 1.5, 0.32, 0.022);
          }
        }
      } else {
        m.beaconMat.opacity = 0.5 + pulse * 0.22;
      }
      for (i = 0; i < m.beacons.length; i++) {
        var b = m.beacons[i];
        b.rotation.y = worldClock * (0.6 + i * 0.09) + i;
        b.scale.y = 0.38 + (m.phase === 3 ? 0.22 : 0.08) * pulse;
      }
    }


    var ARENA = { minX: -21, maxX: 21, minZ: -17, maxZ: 17 };
    var EYE = 1.62;
    var colliders = [];

    function addCollider(cx, cz, sx, sz, y0, y1) {
      colliders.push({
        minX: cx - sx / 2,
        maxX: cx + sx / 2,
        minZ: cz - sz / 2,
        maxZ: cz + sz / 2,
        y0: y0 === undefined ? 0 : y0,
        y1: y1 === undefined ? 4 : y1
      });
    }

    function addBox(x, y, z, sx, sy, sz, material, collide) {
      var mesh = new THREE.Mesh(G.box, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      scene.add(mesh);
      if (collide) addCollider(x, z, sx, sz, Math.max(0, y - sy / 2), y + sy / 2);
      return mesh;
    }

    /* --------------------------------------------------------- zone builders */

    function hazardBandX(z, x0, x1, depth) {
      var i = 0;
      for (var x = x0; x < x1; x += 0.7, i++) {
        var b = getBatch(i % 2 ? 'hazardDark' : 'hazard');
        if (!b) continue;
        b.box(x + 0.35, 0.045, z, 0.66, 0.014, depth, 0);
      }
    }

    function hazardBandZ(x, z0, z1, width) {
      var i = 0;
      for (var z = z0; z < z1; z += 0.7, i++) {
        var b = getBatch(i % 2 ? 'hazardDark' : 'hazard');
        if (!b) continue;
        b.box(x, 0.045, z + 0.35, width, 0.014, 0.66, 0);
      }
    }

    function buildFloorPlates() {
      var ix, iz, i, k, x, z, h, key;
      var bolt = getBatch('steel2');
      for (ix = 0; ix < 16; ix++) {
        for (iz = 0; iz < 13; iz++) {
          x = -18.75 + ix * 2.5;
          z = -15 + iz * 2.5;
          h = hash2(ix + 1, iz + 3);
          if (z < -10.2) {
            key = h < 0.36 ? 'steelDark' : (h < 0.72 ? 'steel' : 'concreteDark');
          } else if (z > 10.4) {
            key = h < 0.42 ? 'steelDark' : (h < 0.78 ? 'concreteDark' : 'steel');
          } else {
            key = h < 0.22 ? 'steelDark' : (h < 0.52 ? 'steel' : (h < 0.8 ? 'concreteDark' : 'steel2'));
          }
          var b = getBatch(key);
          if (b) b.box(x, 0.012, z, 2.32, 0.018, 2.32, 0);
          if (hash2(iz, ix) > 0.42 && bolt) {
            for (k = -1; k <= 1; k += 2) {
              bolt.box(x + k * 1.0, 0.026, z - 1.0, 0.06, 0.014, 0.06, 0);
              bolt.box(x + k * 1.0, 0.026, z + 1.0, 0.06, 0.014, 0.06, 0);
            }
          }
          if ((ix * 5 + iz * 7) % 23 === 0) {
            paintFloorSurface(TEX.plate, x, z, 2.1, 2.1, 6, 6);
          }
        }
      }

      for (i = 0; i < 20; i++) {
        x = arand(-18, 18);
        z = arand(-14.5, 14.5);
        if (Math.abs(x) < 3 && Math.abs(z + 2.5) < 2.2) continue;
        for (k = 0; k < 4; k++) {
          var ob = getBatch(k === 0 ? 'oil' : 'steelDeep');
          if (ob) {
            ob.box(x + arand(-0.45, 0.45), 0.034, z + arand(-0.32, 0.32),
              arand(0.12, 0.55), 0.008, arand(0.04, 0.22), arand(-0.6, 0.6));
          }
        }
      }
      for (i = 0; i < 52; i++) {
        var sb = getBatch(i % 4 === 0 ? 'rust' : 'steel2');
        if (sb) {
          x = arand(-19, 19);
          z = arand(-16, 16);
          sb.box(x, 0.035, z, arand(0.12, 0.9), 0.007, 0.018, arand(0, 3.14));
        }
      }

      hazardBandX(10.75, -19.5, 19.5, 0.34);
      hazardBandX(-10.55, -19.5, 19.5, 0.42);
      hazardBandZ(-19.9, -16, 16, 0.34);
      hazardBandZ(19.9, -16, 16, 0.34);
      drawFloorText('hazard', 0, 7.2, '07', 0.46);
      drawFloorText('hazardDark', 0, 6.95, '07', 0.46);

      for (z = -8.8; z <= 9; z += 1.8) {
        var tube = getBatch('screen');
        if (tube) {
          tube.box(-1.55, 0.036, z, 0.035, 0.008, 1.15, 0);
          tube.box(1.55, 0.036, z, 0.035, 0.008, 1.15, 0);
        }
      }
    }

    function buildIndustrialWalls() {
      var i, u, side, yaw, cy, h, w, key, px, pz;
      var nz, nx;
      var seam = getBatch('steelDeep');
      var trim = getBatch('steelDark');
      var bolt = getBatch('steel2');
      var hazard = getBatch('hazard');

      for (side = -1; side <= 1; side += 2) {
        yaw = side < 0 ? 0 : Math.PI;
        nz = side < 0 ? 1 : -1;
        var z = side * 16.93 + nz * 0.045;
        for (i = 0; i < 11; i++) {
          u = -19.0 + i * 3.8;
          w = 3.7;
          h = 2.15 + hash2(i, side) * 1.3;
          cy = 0.38 + h / 2;
          key = hash2(side + 4, i) < 0.34 ? 'concrete' :
            (hash2(i + 9, side) < 0.66 ? 'concreteDark' : 'steelDark');
          var b = getBatch(key);
          if (b) b.box(u, cy, z, w, h, 0.1, yaw);
          if (seam) seam.box(u - w / 2, cy, z + nz * 0.055, 0.07, h + 0.04, 0.06, yaw);
          if (trim) {
            trim.box(u, 0.28, z + nz * 0.07, w, 0.11, 0.07, yaw);
            trim.box(u, 3.92, z + nz * 0.07, w, 0.1, 0.08, yaw);
          }
          if (bolt) {
            bolt.box(u - w * 0.43, 0.47, z + nz * 0.1, 0.06, 0.06, 0.045, yaw);
            bolt.box(u + w * 0.43, 0.47, z + nz * 0.1, 0.06, 0.06, 0.045, yaw);
            if (hash2(i, side + 7) > 0.45) {
              bolt.box(u - w * 0.43, 3.52, z + nz * 0.1, 0.06, 0.06, 0.045, yaw);
              bolt.box(u + w * 0.43, 3.52, z + nz * 0.1, 0.06, 0.06, 0.045, yaw);
            }
          }
          if ((i + (side > 0 ? 1 : 0)) % 3 === 0) {
            paintPixelSurface(i % 2 ? TEX.rust : TEX.concrete,
              u, cy, z, yaw, w * 0.9, h * 0.88, 6, 5);
          }
          if (hash2(i, side + 11) > 0.58) {
            addRustStreak(u + w * 0.3, cy + h * 0.25, z + nz * 0.06, yaw,
              0.12 + hash2(i, i) * 0.22, 0.5 + hash2(side, i) * 1.4);
          }
          if (hazard && i % 4 === 1) {
            hazard.box(u - w * 0.25, 0.52, z + nz * 0.1, 0.55, 0.16, 0.04, yaw);
            hazard.box(u + w * 0.25, 0.52, z + nz * 0.1, 0.55, 0.16, 0.04, yaw);
          }
        }
        if (trim) {
          for (var rib = -18; rib <= 18; rib += 6) {
            trim.box(rib, 2.14, z + nz * 0.09, 0.34, 4.3, 0.3, yaw);
            if (bolt) {
              bolt.box(rib, 0.2, z + nz * 0.27, 0.1, 0.1, 0.08, yaw);
              bolt.box(rib, 4.2, z + nz * 0.27, 0.1, 0.1, 0.08, yaw);
            }
          }
        }
      }

      for (side = -1; side <= 1; side += 2) {
        yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        nx = side > 0 ? -1 : 1;
        var x = side * 20.93 + nx * 0.045;
        for (i = 0; i < 8; i++) {
          u = -15.6 + i * 4.36;
          w = 4.08;
          h = 2.25 + hash2(i + 20, side) * 1.25;
          cy = 0.38 + h / 2;
          key = hash2(side, i + 4) < 0.38 ? 'concreteDark' :
            (h > 3.1 ? 'steelDark' : 'concrete');
          var b2 = getBatch(key);
          if (b2) b2.box(x, cy, u, w, h, 0.1, yaw);
          if (seam) seam.box(x + nx * 0.055, cy, u - w / 2, 0.06, h + 0.04, 0.07, yaw);
          if (trim) {
            trim.box(x + nx * 0.07, 0.28, u, 0.07, 0.11, w, yaw);
            trim.box(x + nx * 0.07, 3.92, u, 0.08, 0.1, w, yaw);
          }
          if ((i + (side > 0 ? 2 : 0)) % 3 === 1) {
            paintPixelSurface(i % 2 ? TEX.concrete : TEX.rust,
              x, cy, u, yaw, w * 0.88, h * 0.86, 6, 5);
          }
          if (hash2(i, side + 21) > 0.52) {
            addRustStreak(x + nx * 0.06, cy + h * 0.2, u + w * 0.18, yaw,
              0.1 + hash2(side, i) * 0.18, 0.45 + hash2(i, side) * 1.25);
          }
        }
        if (trim) {
          for (var ry = -12; ry <= 12; ry += 8) {
            trim.box(x + nx * 0.09, 2.14, ry, 0.3, 4.3, 0.34, yaw);
          }
        }
      }

      // Wall-mounted service details.
      addWallVent(20.82, 2.62, -4.2, -Math.PI / 2, 2.5, 1.45);
      addWallVent(-20.82, 2.5, 7.1, Math.PI / 2, 2.2, 1.3);
      addWallVent(0, 2.55, 16.82, Math.PI, 3.0, 1.5);
      addSignPanel(-20.82, 2.7, -9.2, Math.PI / 2, 3.0, 0.82, 'COOLANT 07', 'white');
      addSignPanel(20.82, 2.55, 9.8, -Math.PI / 2, 2.7, 0.78, 'PIPE BAY', 'hazard');
      addSignPanel(13.8, 3.45, 16.82, Math.PI, 2.4, 0.66, 'N-07', 'white');
      addSignPanel(-13.8, 3.45, 16.82, Math.PI, 2.4, 0.66, 'M-04', 'white');
      addSignPanel(0, 3.42, 16.82, Math.PI, 4.8, 0.82, 'MAINTENANCE', 'white');

      // Wall/floor contact darkening.  Two merged strips per wall keep the
      // corners and panel bases seated without adding per-frame work.
      addWallAO(0, 0.62, 16.7, 41.6, 1.16, 0.07, 0);
      addWallAO(0, 0.62, -16.7, 41.6, 1.16, 0.07, 0);
      addWallAO(20.7, 0.62, 0, 0.07, 1.16, 33.6, 0);
      addWallAO(-20.7, 0.62, 0, 0.07, 1.16, 33.6, 0);
      addWallAO(20.35, 1.9, 16.35, 0.55, 3.8, 0.55, 0);
      addWallAO(-20.35, 1.9, 16.35, 0.55, 3.8, 0.55, 0);
      addWallAO(20.35, 1.9, -16.35, 0.55, 3.8, 0.55, 0);
      addWallAO(-20.35, 1.9, -16.35, 0.55, 3.8, 0.55, 0);
    }

    function buildEntryZone() {
      addIBeam(-8.6, 10.2, 3.65, 1.0, 0);
      addIBeam(8.6, 10.2, 3.65, 1.0, 0);
      addCollider(-8.6, 10.2, 1.0, 1.0, 0, 3.65);
      addCollider(8.6, 10.2, 1.0, 1.0, 0, 3.65);
      beamXZ('steelDark', -8.6, 10.2, 8.6, 10.2, 3.58, 0.26, 0.34);
      beamXZ('steel2', -8.6, 10.2, 8.6, 10.2, 3.82, 0.08, 0.1);
      beamXZ('steelDark', -8.6, 10.2, -6.8, 10.2, 3.32, 0.09, 0.09);
      beamXZ('steelDark', 6.8, 10.2, 8.6, 10.2, 3.32, 0.09, 0.09);
      addSignPanel(0, 3.3, 10.38, 0, 4.1, 0.62, 'ENTRY 07', 'hazard');

      var lamp = getBatch('lampWarm');
      if (lamp) {
        lamp.box(-6.9, 3.34, 10.25, 0.18, 0.12, 0.18, 0);
        lamp.box(6.9, 3.34, 10.25, 0.18, 0.12, 0.18, 0);
      }

      // Maintenance benches and storage are at the very edge, well away from
      // the player's spawn and the enemy spawn ring.
      addCollider(10.2, 16.18, 4.8, 0.9, 0, 1.6);
      addControlCabinet(8.6, 16.12, Math.PI, 1.25, 1.65);
      addCrate(11.65, 0, 16.15, 1.0, 0.72, 0.72, 0.04, 'danger');
      addCrate(12.55, 0, 16.18, 0.62, 0.48, 0.56, -0.05, '');
      addBarrel(13.15, 16.05, 0.85, 'greenPaint');

      addCollider(-11.4, 16.2, 4.2, 0.9, 0, 1.5);
      addCrate(-10.1, 0, 16.15, 1.1, 0.7, 0.68, 0.02, '');
      addCrate(-11.1, 0, 16.1, 0.7, 0.5, 0.62, -0.04, 'danger');
      addBarrel(-12.35, 16.0, 0.9, 'rust');

      addFloorGrate(12.1, 13.65, 1.8, 1.05);
      addFloorGrate(-12.2, 13.8, 1.6, 1.0);
      addBarrelCluster(-19.55, 13.05, 4);
      addBarrelCluster(19.5, 13.0, 3);
      addCollider(-19.55, 13.05, 1.7, 1.7, 0, 0.95);
      addCollider(19.5, 13.0, 1.5, 1.5, 0, 0.95);
      addGuardRail(-18.8, 10.9, -18.8, 14.9);
      addGuardRail(18.8, 10.9, 18.8, 14.9);
      addFloorGlow(0, 9.2, 3.7, 0xffb153, 0.085);
      addFloorGlow(-10.5, 13.5, 2.2, 0xffb153, 0.045);
      addFloorGlow(10.5, 13.5, 2.2, 0xffb153, 0.04);
      addZoneLightPool(0, 13.1, 5.3, 'Warm');
      addZoneLightPool(0, 8.2, 3.4, 'Warm');
      addZoneLightPool(-12.6, 13.4, 2.5, 'Warm');
      addZoneLightPool(12.6, 13.4, 2.5, 'Warm');

      // Cold threshold line and warm bounce streaks make the entry read as a
      // lit, polished approach instead of a flat floor plane.
      addReflectionFloor('reflectCool', 0, 10.45, 0, 0.26, 11.8);
      addReflectionFloor('reflectWarm', -6.9, 9.2, 0, 2.5, 0.16);
      addReflectionFloor('reflectWarm', 6.9, 9.2, 0, 2.5, 0.16);
      addReflectionFloor('reflectCool', -10.5, 12.1, 0, 2.4, 0.12);
      addReflectionFloor('reflectCool', 10.5, 12.1, 0, 2.4, 0.12);
    }

    function buildPipeCorridor() {
      var side, i, x, z;
      for (side = -1; side <= 1; side += 2) {
        x = side * 19.55;
        addPipeRun(x, 3.23, -13.4, x, 3.23, 13.6, 0.18, {
          material: 'steel', flangeSpacing: 3.0, clamps: true, clampGap: 3.8, bolts: true
        });
        addPipeRun(x - side * 0.34, 2.78, -12.2, x - side * 0.34, 2.78, 12.4, 0.105, {
          material: 'steelDark', flangeSpacing: 3.7, clamps: true, clampGap: 4.2, bolts: false
        });
        addPipeRun(x + side * 0.18, 3.61, -12.8, x + side * 0.18, 3.61, 13.1, 0.075, {
          material: 'copper', flangeSpacing: 4.4, bolts: false
        });
        for (i = -12; i <= 12; i += 4) {
          var p0 = localXZ(side * 20.78, i, 0, 0, 0);
          var bracket = getBatch('steelDark');
          if (bracket) bracket.pipe(p0[0], 3.23, p0[1], side * 19.55, 3.23, i, 0.038, 5);
          beamXZ('steelDark', side * 20.72, i, side * 19.75, i, 3.48, 0.08, 0.1);
        }
        addValve(side * 19.32, 3.23, side > 0 ? 2.2 : -3.4, 'z', 0.9);
        addValve(side * 19.32, 2.78, side > 0 ? -9.2 : 9.4, 'z', 0.7);
        var elbowZ = side > 0 ? -13.4 : 13.6;
        var elbowDir = side > 0 ? 1 : -1;
        addElbow(x, 3.23, elbowZ, 0, 1, 0, 0, 0, elbowDir, 0.52, 0.18, 'steel');
        addPipeRun(x, 3.75, elbowZ, x, 4.36, elbowZ, 0.18, {
          material: 'steel', flangeSpacing: 9, bolts: false
        });
      }
      addGuardRail(-19.2, 4.1, -19.2, 8.7);
      addGuardRail(19.2, 1.3, 19.2, 5.8);
      addBrokenServiceBay(-20.82, 5.4, Math.PI / 2);

      // Overhead cable tray and a sagging bundle on the west side.
      beamXZ('steelDark', -20.42, -14.8, -20.42, 14.8, 3.68, 0.62, 0.08);
      beamXZ('steel2', -20.78, -14.8, -20.78, 14.8, 3.76, 0.06, 0.12);
      beamXZ('steel2', -20.06, -14.8, -20.06, 14.8, 3.76, 0.06, 0.12);
      for (i = -12; i <= 12; i += 4) {
        var tray = getBatch('steel2');
        if (tray) {
          tray.box(-20.6, 3.82, i, 0.52, 0.06, 0.06, 0);
          tray.box(-20.6, 4.15, i, 0.05, 0.66, 0.05, 0);
        }
      }
      var cablePts = [];
      for (i = 0; i <= 14; i++) {
        cablePts.push({
          x: -20.42 + (i % 2) * 0.04,
          y: 3.79 - (i % 2) * 0.05,
          z: -14.5 + i * 2.08
        });
      }
      addCableRun(cablePts, 0.035, 3, 'cable');

      var dropPts = [
        { x: 18.85, y: 4.0, z: 4.7 },
        { x: 18.3, y: 3.9, z: 4.8 },
        { x: 18.05, y: 3.35, z: 4.9 },
        { x: 17.95, y: 3.02, z: 5.0 }
      ];
      addCableRun(dropPts, 0.028, 2, 'cable');
      var copper = getBatch('copper');
      if (copper) copper.box(17.95, 2.98, 5.0, 0.055, 0.14, 0.055, 0);
      addCableRun([
        { x: -6.4, y: 3.85, z: 14.8 },
        { x: -5.6, y: 3.55, z: 13.8 },
        { x: -5.3, y: 3.2, z: 12.8 }
      ], 0.034, 2, 'cable');

      // Long ceiling runs keep the upper frame busy without blocking a lane.
      addPipeRun(-12.7, 4.1, -14.2, -12.7, 4.1, 14.2, 0.12, {
        material: 'steelDark', flangeSpacing: 4.2, bolts: false
      });
      addPipeRun(12.7, 4.12, -14.2, 12.7, 4.12, 14.2, 0.1, {
        material: 'copper', flangeSpacing: 4.6, bolts: false
      });
      addCableRun([
        { x: 9.2, y: 4.16, z: -14.0 },
        { x: 9.6, y: 4.08, z: -4.0 },
        { x: 9.25, y: 4.14, z: 6.0 },
        { x: 9.5, y: 4.1, z: 14.0 }
      ], 0.03, 2, 'cable');

      // Rusted pipe gallery: warm oxidised bounce under the cool service
      // lamps, strongest where the flanges cluster along the side walls.
      addZoneLightPool(-18.1, -1.6, 2.7, 'Rust');
      addZoneLightPool(18.1, 2.2, 2.7, 'Rust');
      addZoneLightPool(-18.1, 8.2, 2.3, 'Rust');
      addZoneLightPool(18.1, -8.4, 2.3, 'Rust');

      // Long directional rust reflections on the deck and side walls.
      addReflectionFloor('reflectRust', -18.2, -1.6, 0, 4.4, 0.28);
      addReflectionFloor('reflectRust', 18.2, 2.2, 0, 4.4, 0.28);
      addReflectionFloor('reflectRust', -18.2, 8.2, 0, 3.3, 0.18);
      addReflectionFloor('reflectRust', 18.2, -8.4, 0, 3.3, 0.18);
      addReflectionWall('reflectRust', -20.62, 1.65, -1.6, Math.PI / 2, 4.2, 2.6);
      addReflectionWall('reflectRust', 20.62, 1.65, 2.2, -Math.PI / 2, 4.2, 2.6);
      addReflectionWall('reflectRust', -20.62, 1.9, 8.2, Math.PI / 2, 3.1, 2.2);
      addReflectionWall('reflectRust', 20.62, 1.9, -8.4, -Math.PI / 2, 3.1, 2.2);
    }

    function buildEnergyHall() {
      addGeneratorSkid(0, -2.5, 0);
      var core = getBatch('fxLine');
      if (core) {
        core.box(0, 1.9, -2.5, 0.1, 0.35, 0.1, 0);
        core.box(0, 3.12, -2.5, 0.75, 0.07, 0.75, 0);
      }
      var trim = getBatch('steel2');
      if (trim) {
        trim.box(0, 1.83, -2.5, 2.25, 0.08, 0.08, 0);
        trim.box(0, 2.02, -2.5, 2.25, 0.05, 0.05, 0);
      }
      for (var r = 0; r < 2; r++) {
        var ring = new THREE.Mesh(G.ring, IM.fxLine);
        ring.position.set(0, 3.16 + r * 0.16, -2.5);
        ring.rotation.z = 0.18 - r * 0.2;
        ring.scale.set(2.4 - r * 0.75, 1, 2.4 - r * 0.75);
        scene.add(ring);
        energyRings.push({ mesh: ring, speed: 0.22 + r * 0.12, axis: 'tilt', base: 0.18 - r * 0.2 });
      }
      for (var i = 0; i < 22; i++) {
        var a = i / 22 * Math.PI * 2;
        var c = getBatch(i % 2 ? 'hazardDark' : 'hazard');
        if (c) c.box(Math.cos(a) * 3.35, 0.042, -2.5 + Math.sin(a) * 3.35,
          0.46, 0.012, 0.18, -a);
      }
      for (var z = -8.7; z <= 6.8; z += 1.7) {
        var c2 = getBatch('screen');
        if (c2) {
          c2.box(-3.35, 0.038, z, 0.035, 0.008, 1.1, 0);
          c2.box(3.35, 0.038, z, 0.035, 0.008, 1.1, 0);
        }
      }
      addFloorGlow(0, -2.5, 4.4, 0x57ddff, 0.115);
      addSignPanel(0, 1.25, -1.71, 0, 1.45, 0.42, 'CORE', 'white');
      addSignPanel(-20.82, 2.8, 1.7, Math.PI / 2, 2.7, 0.74, 'ENERGY HALL', 'hazard');
      addSignPanel(20.82, 2.82, -0.9, -Math.PI / 2, 2.7, 0.74, 'CORE LINK', 'white');
      addZoneLightPool(0, -2.5, 4.8, 'Cool');
      addZoneLightPool(0, -8.8, 2.8, 'Cool');

      // Four radial cool streaks around the core, plus a broad reflected wash
      // on the deck.  These align with the generator foot and read as bounce.
      addReflectionFloor('reflectCool', 0, 0.4, 0, 3.4, 0.42);
      addReflectionFloor('reflectCool', 0, -5.4, 0, 3.4, 0.42);
      addReflectionFloor('reflectCool', 3.15, -2.5, Math.PI / 2, 3.4, 0.34);
      addReflectionFloor('reflectCool', -3.15, -2.5, Math.PI / 2, 3.4, 0.34);
      addReflectionFloor('reflectCool', 0, -2.5, 0, 1.3, 0.95);
      addReflectionWall('reflectCool', -20.6, 1.45, -2.5, Math.PI / 2, 3.2, 2.1);
      addReflectionWall('reflectCool', 20.6, 1.45, -2.5, -Math.PI / 2, 3.2, 2.1);
    }

    function buildCoverProps() {
      var covers = [
        [-11.5, -7.5, 4.8, 2.6, 2.7],
        [11.5, -7.5, 4.8, 2.6, 2.7],
        [-11.5, 7.5, 4.8, 2.6, 2.7],
        [11.5, 7.5, 4.8, 2.6, 2.7],
        [0, -2.5, 4.2, 1.5, 2.0],
        [-4.5, 11.5, 2.4, 2.4, 1.8],
        [4.5, -12.5, 2.4, 2.4, 1.8]
      ];
      var i;
      for (i = 0; i < covers.length; i++) {
        var s = covers[i];
        var x = s[0], z = s[1], sx = s[2], sz = s[3], h = s[4];
        addContactAO(x, z, sx * 1.45, sz * 1.45, 0);
        if (i === 4) {
          // The generator skid supplies the visual body; keep the original
          // full-height cover volume so shots still stop at the console.
          addCollider(x, z, sx, sz, 0, 2.0);
          buildEnergyHallCore();
          continue;
        }
        addBox(x, h / 2, z, sx, h, sz, IM.steelDark, true);
        addBox(x, h + 0.025, z, sx + 0.08, 0.06, sz + 0.08, IM.steel2, false);
        addBox(x, h * 0.52, z + sz / 2 + 0.018, sx * 0.64, 0.075, 0.025, IM.hazard, false);
        var rust = getBatch('rust');
        if (rust) {
          rust.box(x - sx * 0.28, h * 0.72, z + sz / 2 + 0.03,
            sx * 0.26, h * 0.2, 0.02, 0);
          rust.box(x + sx * 0.35, h * 0.38, z + sz / 2 + 0.03,
            sx * 0.13, h * 0.16, 0.02, 0);
        }
        paintPixelSurface(i % 2 ? TEX.rust : TEX.concrete,
          x, h * 0.62, z + sz / 2 - 0.006, 0, sx * 0.56, h * 0.5, 6, 5, 0.012);

        addCrate(x - sx * 0.14, h + 0.06, z + 0.1, sx * 0.3, 0.56, sz * 0.44, 0.03, '');
        addCrate(x + sx * 0.2, h + 0.06, z - 0.12, sx * 0.2, 0.44, sz * 0.34, -0.07, 'danger');
        var postMat = getBatch('steel2');
        for (var b = -1; b <= 1; b += 2) {
          var p = localXZ(x, z, b * sx * 0.43, 0, 0);
          if (postMat) postMat.box(p[0], h + 0.17, p[1], 0.07, 0.26, 0.07, 0);
        }
        if (i === 0) {
          addBarrelCluster(x + 1.0, z - 1.9, 2);
          addCollider(x + 1.0, z - 1.9, 1.35, 1.35, 0, 0.95);
        }
      }

      // Small forward crates keep their original cover footprints.
      addCrate(-4.5, 0, 11.5, 1.45, 0.92, 1.1, 0.05, 'danger');
      addCrate(-4.25, 0.92, 11.35, 0.85, 0.56, 0.76, -0.08, '');
      addCrate(4.5, 0, -12.5, 1.5, 0.85, 1.15, -0.04, 'danger');
      addCrate(4.38, 0.85, -12.35, 0.78, 0.52, 0.7, 0.12, '');
      addFloorGrate(4.5, -12.5, 0.9, 0.55);

      // Corner columns with rust collars and service labels.
      var columns = [[-18.5, -14.5], [18.5, -14.5], [-18.5, 14.5], [18.5, 14.5]];
      for (var c = 0; c < columns.length; c++) {
        var col = new THREE.Mesh(G.cylinder, IM.steel);
        col.position.set(columns[c][0], 2.25, columns[c][1]);
        col.scale.set(0.75, 4.5, 0.75);
        scene.add(col);
        addCollider(columns[c][0], columns[c][1], 1.5, 1.5, 0, 4.5);
        addContactAO(columns[c][0], columns[c][1], 2.05, 2.05, 0);
        var crown = new THREE.Mesh(G.torus, matBasic(C.cyanDim));
        crown.position.set(columns[c][0], 4.1, columns[c][1]);
        crown.scale.set(0.8, 0.8, 0.8);
        scene.add(crown);
        var base = getBatch('steelDark');
        if (base) {
          base.box(columns[c][0], 0.18, columns[c][1], 1.55, 0.34, 1.55, 0);
          base.box(columns[c][0], 1.2, columns[c][1], 1.25, 0.15, 1.25, 0);
        }
        var hazard = getBatch('hazard');
        if (hazard) hazard.box(columns[c][0], 1.36, columns[c][1], 0.88, 0.22, 0.88, 0);
        addRustStreak(columns[c][0] + 0.5, 3.2, columns[c][1] + 0.58, 0, 0.14, 1.6);
      }
    }

    function buildEnergyHallCore() {
      // Called from the central skid branch; the generator itself occupies the
      // collider footprint, while this adds the tall service pipe and header.
      var pipe = getBatch('steelDark');
      var trim = getBatch('steel2');
      if (pipe) {
        pipe.pipe(-1.45, 0.35, -2.5, -1.45, 3.95, -2.5, 0.12, 7);
        pipe.pipe(1.45, 0.35, -2.5, 1.45, 3.75, -2.5, 0.09, 7);
        addFlangeAt(-1.45, 3.55, -2.5, 0, 1, 0, 0.18, 0.07);
      }
      if (trim) {
        trim.box(0, 2.5, -2.5, 3.1, 0.08, 0.08, 0);
        trim.box(0, 2.72, -2.5, 3.1, 0.06, 0.06, 0);
      }
    }

    function addFenceAssembly(group, material, x, z, width, height, yaw) {
      var panel = new THREE.Mesh(G.plane, material);
      panel.position.set(x, height / 2 + 0.05, z);
      panel.rotation.y = yaw;
      panel.scale.set(width, height, 1);
      group.add(panel);
      for (var i = 0; i < 3; i++) {
        var bar = new THREE.Mesh(G.box, material);
        bar.position.set(x, 0.35 + i * (height - 0.4) / 2, z);
        bar.rotation.y = yaw;
        bar.scale.set(width, 0.035, 0.035);
        group.add(bar);
      }
    }

    function buildBossArena() {
      var i, x;
      hazardBandX(-10.5, -19.7, 19.7, 0.9);
      hazardBandZ(-19.85, -16.6, -10.4, 0.32);
      hazardBandZ(19.85, -16.6, -10.4, 0.32);

      for (i = 0; i < 4; i++) {
        var a = i / 4 * Math.PI * 2;
        var ring = new THREE.Mesh(G.ring, IM.fxPylon);
        ring.position.set(Math.cos(a) * 3.62, 0.06, -13.15 + Math.sin(a) * 3.62);
        ring.scale.set(0.56, 1, 0.56);
        ring.rotation.z = 0.12;
        scene.add(ring);
        energyRings.push({ mesh: ring, speed: 0.35 + i * 0.1, axis: 'flat', base: 0.12 });
      }
      var inside = new THREE.Mesh(G.ring, IM.fxLine);
      inside.position.set(0, 0.07, -13.0);
      inside.scale.set(3.9, 1, 3.9);
      inside.rotation.z = 0.05;
      scene.add(inside);
      energyRings.push({ mesh: inside, speed: 0.14, axis: 'flat', base: 0.05 });

      addBossPylon(-18.85, -10.8);
      addBossPylon(18.85, -10.8);
      addCollider(-18.85, -10.8, 1.1, 1.1, 0, 4.3);
      addCollider(18.85, -10.8, 1.1, 1.1, 0, 4.3);

      // Overhead containment gantry.
      beamXZ('steelDark', -19.4, -11.55, 19.4, -11.55, 3.82, 0.24, 0.32);
      beamXZ('steel2', -19.4, -11.55, 19.4, -11.55, 4.03, 0.08, 0.08);
      var hanger = getBatch('steelDark');
      for (i = -18; i <= 18; i += 3) {
        if (hanger) hanger.box(i, 4.21, -11.55, 0.12, 0.44, 0.18, 0);
      }
      addSignPanel(0, 3.26, -11.42, 0, 4.6, 0.7, 'GATEKEEPER', 'hazard');
      addSignPanel(0, 3.7, -16.82, 0, 5.8, 0.58, 'ZERO CONTAINMENT', 'hazard');
      addSignPanel(4.8, 1.82, -16.82, 0, 3.0, 0.7, 'EXIT LINK', 'white');
      paintPixelSurface(TEX.hazard, 0, 3.82, -11.44, 0, 7.8, 0.3, 26, 2);
      addPipeRun(-19.2, 3.48, -13.7, 19.2, 3.48, -13.7, 0.16, {
        material: 'steelDark', flangeSpacing: 3.6, clamps: true, clampGap: 4.0, bolts: true
      });
      addValve(-6.2, 3.48, -13.54, 'x', 0.8);

      var beaconMat = matBasic(0x58ddff, {
        transparent: true, opacity: 0.75, blending: 'additive', depthWrite: false, fog: false
      });
      var beacons = [];
      var beaconPos = [
        [-17.7, -10.65], [17.7, -10.65], [-17.7, -15.75], [17.7, -15.75]
      ];
      for (i = 0; i < beaconPos.length; i++) {
        var beacon = new THREE.Mesh(G.box, beaconMat);
        beacon.position.set(beaconPos[i][0], 3.72, beaconPos[i][1]);
        beacon.scale.set(0.11, 0.4, 0.11);
        scene.add(beacon);
        beacons.push(beacon);
      }

      var fenceMat = matBasic(0x4bb8c9, {
        transparent: true, opacity: 0.18, blending: 'additive', depthWrite: false, fog: false
      });
      var barrierGroup = new THREE.Group();
      addFenceAssembly(barrierGroup, fenceMat, -18.15, -13.25, 6.5, 3.6, Math.PI / 2);
      addFenceAssembly(barrierGroup, fenceMat, 18.15, -13.25, 6.5, 3.6, -Math.PI / 2);
      barrierGroup.visible = false;
      scene.add(barrierGroup);

      var narrowMat = matBasic(0xff4a3f, {
        transparent: true, opacity: 0.25, blending: 'additive', depthWrite: false, fog: false
      });
      var narrowGroup = new THREE.Group();
      addFenceAssembly(narrowGroup, narrowMat, -15.35, -13.25, 6.4, 3.5, Math.PI / 2);
      addFenceAssembly(narrowGroup, narrowMat, 15.35, -13.25, 6.4, 3.5, -Math.PI / 2);
      narrowGroup.visible = false;
      scene.add(narrowGroup);

      addFloorGlow(0, -12.8, 5.6, 0x3f9bd8, 0.09);
      addFloorGlow(0, -15.3, 2.2, 0x6a6b62, 0.035);
      addWallVent(-20.82, 3.18, -13.2, Math.PI / 2, 2.2, 1.15);
      addWallVent(20.82, 3.18, -13.2, -Math.PI / 2, 2.2, 1.15);

      // Phase-tinted directional bounce across the boss deck and side walls.
      // The material colour is retuned by setArenaPhase, so these strips track
      // cyan -> amber -> red without extra draw calls.
      addReflectionFloor('reflectBoss', 0, -13.1, 0, 5.6, 0.62);
      addReflectionFloor('reflectBoss', -2.8, -13.1, Math.PI / 2, 4.3, 0.3);
      addReflectionFloor('reflectBoss', 2.8, -13.1, Math.PI / 2, 4.3, 0.3);
      addReflectionFloor('reflectBoss', 0, -10.2, 0, 4.6, 0.2);
      addReflectionWall('reflectBoss', -20.6, 1.5, -13.1, Math.PI / 2, 6.0, 2.4);
      addReflectionWall('reflectBoss', 20.6, 1.5, -13.1, -Math.PI / 2, 6.0, 2.4);

      // Exit bounce spilling back into the arena.  reflectExit is recoloured
      // red/green together with the door materials.
      addReflectionFloor('reflectExit', 0, -14.2, 0, 3.5, 0.36);
      addReflectionFloor('reflectExit', -1.28, -14.1, 0, 2.9, 0.13);
      addReflectionFloor('reflectExit', 1.28, -14.1, 0, 2.9, 0.13);
      addReflectionFloor('reflectExit', 0, -15.9, 0, 0.24, 4.15);

      // Boss-region colour light.  These meshes are phase-recoloured by
      // setArenaPhase; the geometry is created once with the arena.
      var arenaGlowMat = matBasic(0x58ddff, {
        transparent: true, opacity: 0.04, blending: 'additive',
        depthWrite: false, fog: false
      });
      var arenaGlowCoreMat = matBasic(0x9ff2ff, {
        transparent: true, opacity: 0.07, blending: 'additive',
        depthWrite: false, fog: false
      });
      var arenaGlow = new THREE.Mesh(G.circle, arenaGlowMat);
      arenaGlow.position.set(0, 0.066, -13.1);
      arenaGlow.scale.set(5.9, 1, 5.9);
      scene.add(arenaGlow);
      var arenaCore = new THREE.Mesh(G.circle, arenaGlowCoreMat);
      arenaCore.position.set(0, 0.068, -13.1);
      arenaCore.scale.set(2.3, 1, 2.3);
      scene.add(arenaCore);
      for (var pg = -1; pg <= 1; pg += 2) {
        var pylonGlow = new THREE.Mesh(G.circle, arenaGlowMat);
        pylonGlow.position.set(pg * 18.85, 0.067, -10.8);
        pylonGlow.scale.set(2.4, 1, 2.4);
        scene.add(pylonGlow);
        var pylonColumn = new THREE.Mesh(G.box, arenaGlowCoreMat);
        pylonColumn.position.set(pg * 18.85, 2.1, -10.8);
        pylonColumn.scale.set(0.46, 4.1, 0.46);
        scene.add(pylonColumn);
      }

      var broken = getBatch('cable');
      if (broken) {
        broken.pipe(20.65, 3.9, -8.8, 18.0, 3.7, -8.5, 0.035, 6);
        broken.pipe(18.0, 3.7, -8.5, 17.7, 3.15, -8.35, 0.032, 6);
      }
      var copper = getBatch('copper');
      if (copper) copper.box(17.7, 3.12, -8.35, 0.06, 0.16, 0.06, 0);

      arenaMood = {
        phase: 0,
        lastPhase: 0,
        lineMat: IM.fxLine,
        pylonMat: IM.fxPylon,
        beaconMat: beaconMat,
        fenceMat: fenceMat,
        barrierGroup: barrierGroup,
        narrowGroup: narrowGroup,
        narrowMat: narrowMat,
        arenaGlowMat: arenaGlowMat,
        arenaGlowCoreMat: arenaGlowCoreMat,
        beacons: beacons,
        near: 15,
        far: 47,
        sparkPoint: new THREE.Vector3(17.7, 3.02, -8.35),
        sparkT: 1.4
      };
    }

    function buildServiceLights() {
      addLamp(-14, -12.6, 'lampCool', 0x57ddff);
      addLamp(14, -12.6, 'lampCool', 0x57ddff);
      addLamp(-14, 1.8, 'lampCool', 0x8defff);
      addLamp(14, 1.8, 'lampCool', 0x8defff);
      addLamp(0, 12.8, 'lampWarm', 0xffb153);
      addLamp(0, 5.2, 'lampCool', 0x57ddff);
      addLamp(-13.5, 12.7, 'lampWarm', 0xffb153);
      addLamp(13.5, 12.7, 'lampWarm', 0xffb153);

      for (var z = -12; z <= 12; z += 8) {
        beamXZ('steelDark', -20.2, z, 20.2, z, 4.18, 0.2, 0.24);
        for (var x = -18; x <= 18; x += 6) {
          beamXZ('steel2', x, z, x, z, 4.12, 0.06, 0.3);
        }
      }
      beamXZ('steelDark', -10.2, -16, -10.2, 16, 4.22, 0.18, 0.2);
      beamXZ('steelDark', 10.2, -16, 10.2, 16, 4.22, 0.18, 0.2);
    }

    function buildArena() {
      var floor = new THREE.Mesh(G.plane, matLambert(0x161b21));
      floor.position.set(0, 0, 0);
      floor.rotation.x = -Math.PI / 2;
      floor.scale.set(44, 36, 1);
      scene.add(floor);

      var ceiling = new THREE.Mesh(G.plane, matLambert(0x090d12));
      ceiling.position.set(0, 4.5, 0);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.scale.set(44, 36, 1);
      scene.add(ceiling);

      // Perimeter walls keep their original collision volumes.
      addBox(0, 2.25, -17.6, 44, 4.5, 1.2, IM.concreteDark, true);
      addBox(0, 2.25, 17.6, 44, 4.5, 1.2, IM.concreteDark, true);
      addBox(-21.6, 2.25, 0, 1.2, 4.5, 36, IM.concreteDark, true);
      addBox(21.6, 2.25, 0, 1.2, 4.5, 36, IM.concreteDark, true);

      buildFloorPlates();
      buildIndustrialWalls();
      buildCoverProps();
      buildEntryZone();
      buildPipeCorridor();
      buildEnergyHall();
      buildServiceLights();
      buildBossArena();
      commitArt();
      buildContactShadowPool();
      buildExit();
      buildLocalLightRig();
      buildAmbientMotes();
      buildCinematicVolumes();
      buildReflectionStripPool();
      buildParticlePool();
      buildRingPool();
      buildTracerPool();
      buildBulletFxPool();
      buildBulletTrailPool();
      buildDeflectFxPool();
      buildMissileFxPool();
      buildTelegraphPool();
      buildLaserPool();
      buildShockwavePool();
      buildSparkPool();
      setArenaPhase(0);
    }

    var exit = {
      unlocked: false,
      pos: new THREE.Vector3(0, 1.5, -16.25),
      group: null,
      ring: null,
      glow: null,
      halo: null,
      floorGlow: null,
      ringMat: null,
      glowMat: null,
      haloMat: null,
      floorMat: null,
      lightMat: null
    };

    function buildExit() {
      var group = new THREE.Group();
      group.position.copy(exit.pos);
      scene.add(group);

      // Static contact shadow beneath the frame (created once with the exit).
      var exitShadowMat = matBasic(0x000000, {
        transparent: true, opacity: 0.18, depthWrite: false, fog: false
      });
      var exitShadow = new THREE.Mesh(G.circle, exitShadowMat);
      exitShadow.position.set(0, -1.435, 0);
      exitShadow.scale.set(3.05, 1, 2.15);
      group.add(exitShadow);

      var frameMat = matLambert(0x1d2b42, { specular: 0.38, roughness: 0.36 });
      var top = new THREE.Mesh(G.box, frameMat);
      top.position.set(0, 2.05, 0);
      top.scale.set(4.6, 0.4, 0.7);
      group.add(top);
      var left = new THREE.Mesh(G.box, frameMat);
      left.position.set(-2.1, 0.45, 0);
      left.scale.set(0.4, 3.6, 0.7);
      group.add(left);
      var right = new THREE.Mesh(G.box, frameMat);
      right.position.set(2.1, 0.45, 0);
      right.scale.set(0.4, 3.6, 0.7);
      group.add(right);
      var base = new THREE.Mesh(G.box, frameMat);
      base.position.set(0, -1.42, 0);
      base.scale.set(4.6, 0.2, 0.7);
      group.add(base);

      exit.ringMat = matBasic(C.red, {
        transparent: true, opacity: 0.55, blending: 'additive', depthWrite: false
      });
      var ring = new THREE.Mesh(G.torus, exit.ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(1.55, 1.55, 1.55);
      ring.position.set(0, 0.5, 0.02);
      group.add(ring);

      exit.haloMat = matBasic(C.red, {
        transparent: true, opacity: 0.16, blending: 'additive', depthWrite: false, fog: false
      });
      var halo = new THREE.Mesh(G.ring, exit.haloMat);
      halo.rotation.x = Math.PI / 2;
      halo.scale.set(2.15, 2.15, 2.15);
      halo.position.set(0, 0.5, 0.01);
      group.add(halo);

      exit.floorMat = matBasic(C.red, {
        transparent: true, opacity: 0.1, blending: 'additive', depthWrite: false, fog: false
      });
      var floorGlow = new THREE.Mesh(G.circle, exit.floorMat);
      floorGlow.position.set(0, -1.43, 0);
      floorGlow.scale.set(3.15, 1, 2.4);
      group.add(floorGlow);

      exit.glowMat = matBasic(C.red, {
        transparent: true, opacity: 0.14, blending: 'additive', depthWrite: false
      });
      var glow = new THREE.Mesh(G.circle, exit.glowMat);
      glow.rotation.x = Math.PI / 2;
      glow.scale.set(1.45, 1.45, 1.45);
      glow.position.set(0, 0.5, -0.03);
      group.add(glow);

      exit.lightMat = matBasic(C.red, {
        transparent: true, opacity: 0.5, blending: 'additive', depthWrite: false
      });
      var bar = new THREE.Mesh(G.box, exit.lightMat);
      bar.position.set(0, 1.9, 0.1);
      bar.scale.set(3.4, 0.06, 0.06);
      group.add(bar);

      exit.group = group;
      exit.ring = ring;
      exit.glow = glow;
      exit.halo = halo;
      exit.floorGlow = floorGlow;
      updateExitVisuals();
    }

    function updateExitVisuals() {
      if (!exit.ringMat) return;
      var col = exit.unlocked ? C.green : C.red;
      exit.ringMat.color.setHex(col);
      exit.ringMat.opacity = exit.unlocked ? 0.85 : 0.5;
      exit.glowMat.color.setHex(col);
      exit.glowMat.opacity = exit.unlocked ? 0.26 : 0.1;
      exit.lightMat.color.setHex(col);
      exit.haloMat.color.setHex(col);
      exit.haloMat.opacity = exit.unlocked ? 0.24 : 0.1;
      exit.floorMat.color.setHex(col);
      exit.floorMat.opacity = exit.unlocked ? 0.16 : 0.055;
      IM.reflectExit.color.setHex(col);
    }

    /* ------------------------------------------------------- local light rig */
    // Six fixed candidate emitters.  The renderer exposes five local-light
    // slots, so the manager enables only the highest scoring five each frame.
    // Every PointLight is built once here; the frame path only moves/retunes
    // the existing objects and never allocates.
    var LOCAL_LIGHT_CANDIDATES = 6;
    var localLights = [];
    var localRig = {
      entry: null, lamp: null, pipe: null, core: null, boss: null, exit: null
    };

    function localLightScore(a, b) { return b.score - a.score; }

    function registerLocalLight(key, opts) {
      if (localLights.length >= LOCAL_LIGHT_CANDIDATES) return null;
      var light = new THREE.PointLight(opts.hex, 0, opts.range);
      light.position.set(opts.x, opts.y, opts.z);
      light.visible = false;
      scene.add(light);
      var entry = {
        key: key,
        light: light,
        baseIntensity: opts.intensity,
        baseRange: opts.range,
        priority: opts.priority || 1,
        enabled: opts.enabled !== false,
        score: 0,
        phase: arand(0, Math.PI * 2)
      };
      localLights.push(entry);
      localRig[key] = entry;
      return entry;
    }

    function buildLocalLightRig() {
      // Entry is keyed cold cyan; the warm maintenance lamps remain as warm
      // accents, so the threshold reads cold without losing the V1 fixtures.
      registerLocalLight('entry', {
        x: 0, y: 3.55, z: 9.8, hex: 0x8fe6ff,
        intensity: 1.0, range: 8.6, priority: 1.6
      });
      registerLocalLight('lamp', {
        x: 0, y: 3.65, z: 12.7, hex: 0xffa95c,
        intensity: 0.85, range: 7.5, priority: 1.15
      });
      // Oxidised pipe bay: warm orange spill against the cold corridor.
      registerLocalLight('pipe', {
        x: 18.2, y: 2.5, z: 1.6, hex: 0xff5f2e,
        intensity: 0.9, range: 7.4, priority: 1.45
      });
      // Central energy core, always on and gently pulsing.
      registerLocalLight('core', {
        x: 0, y: 2.55, z: -2.5, hex: 0x4fd8ff,
        intensity: 1.1, range: 8.4, priority: 1.85
      });
      // Boss core light is created once and follows the active core.
      registerLocalLight('boss', {
        x: 0, y: 2.5, z: -9, hex: 0xff4fb8,
        intensity: 0, range: 10.2, priority: 3.0, enabled: false
      });
      // Exit gate is red while locked and green once the boss is down.
      registerLocalLight('exit', {
        x: 0, y: 2.35, z: -16.05, hex: 0xff4d6d,
        intensity: 0.85, range: 7.2, priority: 2.0
      });
    }

    function updateLocalLightRig() {
      var i, entry;
      var max = Math.min(THREE.MAX_LOCAL_LIGHTS || 5, localLights.length);
      var px = camera.position.x;
      var py = camera.position.y;
      var pz = camera.position.z;

      entry = localRig.entry;
      if (entry) {
        entry.light.intensity = entry.baseIntensity *
          (0.9 + 0.1 * Math.sin(worldClock * 1.1 + entry.phase));
      }
      entry = localRig.lamp;
      if (entry) {
        entry.light.intensity = entry.baseIntensity *
          (0.86 + 0.14 * Math.sin(worldClock * 0.8 + entry.phase));
      }
      entry = localRig.pipe;
      if (entry) {
        entry.light.intensity = entry.baseIntensity *
          (0.82 + 0.18 * Math.sin(worldClock * 0.65 + entry.phase));
      }
      entry = localRig.core;
      if (entry) {
        var coreAlert = arenaMood && arenaMood.phase === 3;
        entry.light.color.setHex(coreAlert ? 0xff6a55 : 0x4fd8ff);
        entry.light.intensity = entry.baseIntensity *
          (0.9 + 0.1 * Math.sin(worldClock * 2.0)) * (coreAlert ? 1.15 : 1);
      }

      var bossEntry = localRig.boss;
      // While a boss laser is charging/firing, its own light is borrowed as a
      // travelling bounce on the nearest point of the beam.  This produces
      // strong source-to-surface colour pollution without adding a seventh
      // candidate light or exceeding the five active local-light slots.
      var beamHex = 0;
      var beamX = 0;
      var beamY = 1.45;
      var beamZ = 0;
      var beamIntensity = 0;
      for (i = 0; i < lasers.length; i++) {
        var beam = lasers[i];
        if (beam.t < beam.warn * 0.55 || beam.t >= beam.warn + beam.active) continue;
        var charge = beam.t < beam.warn
          ? (beam.t - beam.warn * 0.55) / (beam.warn * 0.45)
          : 1.35;
        if (beam.axis === 'x') {
          beamX = clamp(player.pos.x, ARENA.minX + 1, ARENA.maxX - 1);
          beamZ = beam.coord;
        } else {
          beamX = beam.coord;
          beamZ = clamp(player.pos.z, ARENA.minZ + 1, ARENA.maxZ - 1);
        }
        beamHex = laserPaletteHex(beam.phase);
        beamIntensity = 1.15 + charge * 0.75;
        break;
      }

      if (bossEntry) {
        if (beamHex) {
          bossEntry.enabled = true;
          bossEntry.light.position.set(beamX, beamY, beamZ);
          bossEntry.light.color.setHex(beamHex);
          bossEntry.light.distance = 11.2;
          bossEntry.light.intensity = beamIntensity;
        } else if (boss && boss.alive) {
          bossEntry.enabled = true;
          bossEntry.light.position.copy(boss.pos);
          var bossHex = boss.phase === 3 ? 0xff5048 :
            (boss.phase === 2 ? 0x9b6bff : 0xff4fb8);
          if (boss.shield > 0) bossHex = C.cyan;
          if (boss.flash > 0) bossHex = 0xffffff;
          bossEntry.light.color.setHex(bossHex);
          bossEntry.light.distance = boss.phase === 3 ? 11.5 : 10.2;
          bossEntry.light.intensity = 1.2 + (boss.phase === 3 ? 0.25 : 0) +
            (boss.exposed > 0 ? 0.3 : 0) + (boss.flash > 0 ? 0.25 : 0);
        } else {
          bossEntry.enabled = false;
          bossEntry.light.intensity = 0;
        }
      }

      var exitEntry = localRig.exit;
      if (exitEntry) {
        exitEntry.light.color.setHex(exit.unlocked ? C.green : C.red);
        exitEntry.enabled = true;
        exitEntry.light.intensity = (exit.unlocked ? 1.15 : 0.8) +
          Math.sin(worldClock * 2.3) * 0.08;
      }

      // Score = priority falloff by distance.  Sorting this six-element array
      // in place keeps the pool bounded and allocation-free.
      for (i = 0; i < localLights.length; i++) {
        entry = localLights[i];
        if (!entry.enabled) {
          entry.score = -Infinity;
          entry.light.visible = false;
          continue;
        }
        var dx = entry.light.position.x - px;
        var dy = entry.light.position.y - py;
        var dz = entry.light.position.z - pz;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        entry.score = entry.priority * 2.4 / (d + 2.0);
      }
      localLights.sort(localLightScore);
      for (i = 0; i < localLights.length; i++) {
        localLights[i].light.visible = i < max && localLights[i].enabled;
      }
    }

    /* ------------------------------------------------- cinematic volumes */
    // Volumetric-looking shafts are ordinary low-poly additive geometry.  Each
    // entry owns an outer, wide layer and a hot inner layer; the pools are
    // built once here and only opacity/colour/transform change per frame.
    var VOLUME_BEAM_LIMIT = 20;
    var volumetricBeams = [];
    var volumeFx = {
      lampBeams: [],
      pipeBeams: [],
      entryBeam: null,
      coreBeam: null,
      bossCore: null,
      bossPylons: [],
      exitBeam: null,
      exitSpill: null
    };

    function volumeMaterial(hex, opacity) {
      return matBasic(hex, {
        transparent: true,
        opacity: opacity,
        blending: 'additive',
        depthWrite: false,
        fog: false
      });
    }

    function addVolumeBeam(opts) {
      if (volumetricBeams.length >= VOLUME_BEAM_LIMIT) return null;
      var group = new THREE.Group();
      group.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
      if (opts.rotationX) group.rotation.x = opts.rotationX;
      if (opts.rotationY) group.rotation.y = opts.rotationY;
      if (opts.rotationZ) group.rotation.z = opts.rotationZ;

      var geo = opts.shape === 'box' ? G.box : (opts.shape === 'cylinder' ? G.cylinder : G.cone);
      var outerMat = volumeMaterial(opts.hex, opts.opacity);
      var coreMat = volumeMaterial(opts.coreHex === undefined ? 0xffffff : opts.coreHex,
        opts.coreOpacity === undefined ? opts.opacity * 0.7 : opts.coreOpacity);
      var outer = new THREE.Mesh(geo, outerMat);
      var core = new THREE.Mesh(geo, coreMat);
      var radius = opts.radius || 1;
      var coreRadius = opts.coreRadius === undefined ? radius * 0.5 : opts.coreRadius;
      var height = opts.height || 4;

      if (opts.shape === 'box') {
        outer.scale.set(opts.width || 1, height, opts.depth || 0.2);
        core.scale.set((opts.width || 1) * 0.78, height * 0.94, (opts.depth || 0.2) * 1.6);
      } else {
        outer.scale.set(radius, height, radius);
        core.scale.set(coreRadius, height * 0.98, coreRadius);
      }
      outer.renderOrder = opts.order || 2;
      core.renderOrder = (opts.order || 2) + 1;
      group.add(outer);
      group.add(core);
      scene.add(group);

      var entry = {
        group: group,
        outer: outer,
        core: core,
        outerMat: outerMat,
        coreMat: coreMat,
        baseOuter: opts.opacity,
        baseCore: opts.coreOpacity === undefined ? opts.opacity * 0.7 : opts.coreOpacity,
        phase: arand(0, Math.PI * 2),
        speed: opts.speed || 1.2,
        kind: opts.kind || 'static',
        pulseScale: opts.pulseScale || 0
      };
      volumetricBeams.push(entry);
      return entry;
    }

    function buildCinematicVolumes() {
      var lamps = [
        [-14, -12.6, 0x57ddff, 0xd6fbff],
        [14, -12.6, 0x57ddff, 0xd6fbff],
        [-14, 1.8, 0x8defff, 0xe3ffff],
        [14, 1.8, 0x8defff, 0xe3ffff],
        [0, 12.8, 0xffb153, 0xffefd0],
        [0, 5.2, 0x57ddff, 0xd6fbff],
        [-13.5, 12.7, 0xffb153, 0xffefd0],
        [13.5, 12.7, 0xffb153, 0xffefd0]
      ];
      var i;
      for (i = 0; i < lamps.length; i++) {
        var lampBeam = addVolumeBeam({
          shape: 'cone', x: lamps[i][0], y: 2.02, z: lamps[i][1],
          radius: 1.42, coreRadius: 0.6, height: 4.04,
          hex: lamps[i][2], coreHex: lamps[i][3],
          opacity: 0.055, coreOpacity: 0.085,
          speed: 0.7 + i * 0.07, kind: 'lamp'
        });
        if (lampBeam) volumeFx.lampBeams.push(lampBeam);
      }

      // Oxidised pipe-bay contamination.
      volumeFx.pipeBeams.push(addVolumeBeam({
        shape: 'cone', x: 18.2, y: 1.9, z: 1.6,
        radius: 1.2, coreRadius: 0.5, height: 3.8,
        hex: 0xff5f2e, coreHex: 0xffc39a,
        opacity: 0.045, coreOpacity: 0.07, speed: 0.55, kind: 'pipe'
      }));
      volumeFx.pipeBeams.push(addVolumeBeam({
        shape: 'cone', x: -18.2, y: 1.9, z: 8.2,
        radius: 1.05, coreRadius: 0.44, height: 3.8,
        hex: 0xff5f2e, coreHex: 0xffc39a,
        opacity: 0.04, coreOpacity: 0.06, speed: 0.48, kind: 'pipe'
      }));

      // Cold threshold curtain at the entry.
      volumeFx.entryBeam = addVolumeBeam({
        shape: 'box', x: 0, y: 1.7, z: 10.12,
        width: 9.6, height: 3.4, depth: 0.3,
        hex: 0x8fe6ff, coreHex: 0xe8ffff,
        opacity: 0.03, coreOpacity: 0.045, speed: 1.1, kind: 'entry'
      });

      // Central energy column.
      volumeFx.coreBeam = addVolumeBeam({
        shape: 'cylinder', x: 0, y: 2.2, z: -2.5,
        radius: 0.62, coreRadius: 0.24, height: 4.4,
        hex: 0x4fd8ff, coreHex: 0xd6fbff,
        opacity: 0.055, coreOpacity: 0.1, speed: 2.0, kind: 'core'
      });

      // Boss pylon columns; colour is driven by the arena phase.
      for (i = -1; i <= 1; i += 2) {
        var pylonBeam = addVolumeBeam({
          shape: 'cylinder', x: i * 18.85, y: 2.1, z: -10.8,
          radius: 0.56, coreRadius: 0.22, height: 4.2,
          hex: 0x3ec8dd, coreHex: 0xd9ffff,
          opacity: 0.06, coreOpacity: 0.1, speed: 2.6, kind: 'pylon'
        });
        if (pylonBeam) volumeFx.bossPylons.push(pylonBeam);
      }

      // A floor-anchored column that follows the active boss core horizontally.
      volumeFx.bossCore = addVolumeBeam({
        shape: 'cylinder', x: 0, y: 2.1, z: -9,
        radius: 1.48, coreRadius: 0.56, height: 4.2,
        hex: 0xff4fb8, coreHex: 0xffe3f4,
        opacity: 0.045, coreOpacity: 0.08,
        speed: 3.2, kind: 'bossCore', pulseScale: 1
      });
      if (volumeFx.bossCore) volumeFx.bossCore.group.visible = false;

      // Exit portal volume plus a cone of spill into the arena.
      volumeFx.exitBeam = addVolumeBeam({
        shape: 'box', x: 0, y: 1.52, z: -15.86,
        width: 3.5, height: 2.85, depth: 0.18,
        hex: 0xff4d6d, coreHex: 0xffd9de,
        opacity: 0.05, coreOpacity: 0.09, speed: 1.8, kind: 'exit'
      });
      volumeFx.exitSpill = addVolumeBeam({
        shape: 'cone', x: 0, y: 1.55, z: -14.6, rotationX: -Math.PI / 2,
        radius: 1.5, coreRadius: 0.6, height: 2.6,
        hex: 0xff4d6d, coreHex: 0xffd9de,
        opacity: 0.032, coreOpacity: 0.055, speed: 1.6, kind: 'exit'
      });
    }

    function updateCinematicVolumes() {
      var i, e, pulse;
      for (i = 0; i < volumetricBeams.length; i++) {
        e = volumetricBeams[i];
        pulse = 0.5 + 0.5 * Math.sin(worldClock * e.speed + e.phase);
        e.outerMat.opacity = e.baseOuter * (0.78 + 0.22 * pulse);
        e.coreMat.opacity = e.baseCore * (0.82 + 0.18 * pulse);

        if (e.kind === 'pylon' && arenaMood) {
          e.outerMat.color.copy(arenaMood.pylonMat.color);
          e.coreMat.color.copy(arenaMood.beaconMat.color);
        } else if (e.kind === 'exit') {
          var exitHex = exit.unlocked ? C.green : C.red;
          e.outerMat.color.setHex(exitHex);
          e.coreMat.color.setHex(exit.unlocked ? 0xd8ffe9 : 0xffd9de);
        } else if (e.kind === 'core') {
          var coreAlert = arenaMood && arenaMood.phase === 3;
          e.outerMat.color.setHex(coreAlert ? 0xff6a55 : 0x4fd8ff);
          e.coreMat.color.setHex(coreAlert ? 0xffd0c2 : 0xd6fbff);
        } else if (e.kind === 'bossCore') {
          if (boss && boss.alive) {
            e.group.visible = true;
            e.group.position.x = boss.pos.x;
            e.group.position.z = boss.pos.z;
            var bossHex = boss.phase === 3 ? 0xff4d6d :
              (boss.phase === 2 ? 0x9b6bff : 0xff4fb8);
            if (boss.shield > 0) bossHex = C.cyan;
            if (boss.flash > 0) bossHex = 0xffffff;
            e.outerMat.color.setHex(bossHex);
            e.coreMat.color.setHex(boss.phase === 3 ? 0xffd9d4 : 0xffe3f4);
            var bossPulse = 1 + (e.pulseScale ? (pulse - 0.5) * 0.08 : 0);
            e.group.scale.set(bossPulse, 1, bossPulse);
          } else {
            e.group.visible = false;
          }
        }
      }
    }

    /* ---------------------------------------- dynamic pseudo-reflection pool */
    var REFLECTION_STRIP_LIMIT = 16;
    var reflectionStrips = [];

    function buildReflectionStripPool() {
      for (var i = 0; i < REFLECTION_STRIP_LIMIT; i++) {
        var mat = matBasic(0xffffff, {
          transparent: true, opacity: 0, blending: 'additive',
          depthWrite: false, fog: false
        });
        var mesh = new THREE.Mesh(G.box, mat);
        mesh.position.y = 0.074;
        mesh.visible = false;
        mesh.renderOrder = 8;
        scene.add(mesh);
        reflectionStrips.push({ mesh: mesh, mat: mat });
      }
    }

    function resetReflectionStrips() {
      for (var i = 0; i < reflectionStrips.length; i++) {
        reflectionStrips[i].mesh.visible = false;
      }
    }

    function addReflectionStrip(x, z, yaw, width, length, hex, opacity) {
      for (var i = 0; i < reflectionStrips.length; i++) {
        var s = reflectionStrips[i];
        if (s.mesh.visible) continue;
        s.mesh.visible = true;
        s.mesh.position.set(x, 0.074, z);
        s.mesh.rotation.y = yaw;
        s.mesh.scale.set(width, 0.006, length);
        s.mat.color.setHex(hex);
        s.mat.opacity = opacity;
        return;
      }
    }

    function laserPaletteHex(phase) {
      return phase === 3 ? 0xff3d32 : (phase === 2 ? 0xff4fb8 : 0xff4d6d);
    }

    function updateReflectionStrips() {
      resetReflectionStrips();
      var pulse = 0.5 + 0.5 * Math.sin(worldClock * 3.6);
      var i, k, ang, len, x, z;

      if (boss && boss.alive) {
        var bossHex = boss.phase === 3 ? 0xff4d6d :
          (boss.phase === 2 ? 0x9b6bff : 0xff4fb8);
        if (boss.shield > 0) bossHex = C.cyan;
        for (k = 0; k < 4; k++) {
          ang = k * Math.PI / 2 + boss.t * 0.08;
          len = 5.2 + pulse * 1.6;
          x = boss.pos.x + Math.sin(ang) * (len * 0.5 + 0.9);
          z = boss.pos.z + Math.cos(ang) * (len * 0.5 + 0.9);
          addReflectionStrip(x, z, ang, 0.42 + pulse * 0.12, len,
            bossHex, 0.06 + pulse * 0.07);
        }
      }

      for (i = 0; i < lasers.length; i++) {
        var l = lasers[i];
        if (l.t < l.warn * 0.55) continue;
        var hex = laserPaletteHex(l.phase);
        var baseX = player.pos.x;
        var baseZ = player.pos.z;
        for (k = -1; k <= 1; k++) {
          if (l.axis === 'x') {
            addReflectionStrip(clamp(baseX + k * 0.4, ARENA.minX + 1, ARENA.maxX - 1),
              l.coord + k * 0.55, Math.PI / 2, 0.2 + pulse * 0.1, 10.5,
              hex, 0.08 + pulse * 0.1);
          } else {
            addReflectionStrip(l.coord + k * 0.55,
              clamp(baseZ + k * 0.4, ARENA.minZ + 1, ARENA.maxZ - 1),
              0, 0.2 + pulse * 0.1, 10.5,
              hex, 0.08 + pulse * 0.1);
          }
        }
      }

      var exitHex = exit.unlocked ? C.green : C.red;
      addReflectionStrip(-1.12, -14.0, 0, 0.16, 3.8, exitHex, 0.055 + pulse * 0.045);
      addReflectionStrip(0, -13.7, 0, 0.2, 4.4, exitHex, 0.07 + pulse * 0.055);
      addReflectionStrip(1.12, -14.0, 0, 0.16, 3.8, exitHex, 0.055 + pulse * 0.045);
    }

    /* ------------------------------------------------------------ ambient */
    var motes = [];
    function buildAmbientMotes() {
      var moteGeo = new THREE.BoxGeometry(1, 1, 1);
      for (var i = 0; i < 34; i++) {
        var m = new THREE.Mesh(moteGeo, matBasic(i % 5 === 0 ? C.magenta : C.cyan, {
          transparent: true,
          opacity: 0.16 + arand(0, 0.22),
          blending: 'additive',
          depthWrite: false
        }));
        m.position.set(
          arand(-19, 19),
          arand(0.5, 3.7),
          arand(-15, 15)
        );
        var s = arand(0.02, 0.065);
        m.scale.set(s, s, s);
        scene.add(m);
        motes.push({
          mesh: m,
          baseX: m.position.x,
          baseY: m.position.y,
          baseZ: m.position.z,
          phase: arand(0, Math.PI * 2),
          speed: arand(0.15, 0.45),
          amp: arand(0.4, 1.6)
        });
      }
    }

    /* ------------------------------------------------- dynamic contact shadows */
    // A fixed, shared-geometry pool grounds the mobile threats.  Each slot owns
    // two reused discs: a broad soft footprint and a darker directional core
    // offset away from the directional light.  Slots are acquired on spawn and
    // released on kill/reset; nothing is constructed in the frame loop.
    var CONTACT_SHADOW_LIMIT = 12;
    var contactShadows = [];
    // The sun sits at (-0.45, 1, 0.3), so ground shadows stretch toward +x/-z.
    var shadowFlat = Math.sqrt(sun.position.x * sun.position.x + sun.position.z * sun.position.z) || 1;
    var SHADOW_DIR_X = -sun.position.x / shadowFlat;
    var SHADOW_DIR_Z = -sun.position.z / shadowFlat;
    var SHADOW_YAW = Math.atan2(SHADOW_DIR_X, SHADOW_DIR_Z);

    function buildContactShadowPool() {
      for (var i = 0; i < CONTACT_SHADOW_LIMIT; i++) {
        var softMat = matBasic(0x000000, {
          transparent: true, opacity: 0.18, depthWrite: false, fog: false
        });
        var coreMat = matBasic(0x000000, {
          transparent: true, opacity: 0.26, depthWrite: false, fog: false
        });
        var soft = new THREE.Mesh(G.circle, softMat);
        soft.position.set(0, 0.057, 0);
        soft.rotation.y = SHADOW_YAW;
        soft.visible = false;
        soft.renderOrder = 6;
        scene.add(soft);
        var core = new THREE.Mesh(G.circle, coreMat);
        core.position.set(0, 0.059, 0);
        core.rotation.y = SHADOW_YAW;
        core.visible = false;
        core.renderOrder = 7;
        scene.add(core);
        contactShadows.push({
          soft: soft,
          softMat: softMat,
          core: core,
          coreMat: coreMat,
          owner: null,
          radius: 1,
          base: 0.24,
          phase: i * 0.7
        });
      }
    }

    function acquireContactShadow(owner, radius, opacity) {
      var slot = null;
      for (var i = 0; i < contactShadows.length; i++) {
        if (!contactShadows[i].owner) { slot = contactShadows[i]; break; }
      }
      if (!slot) {
        slot = contactShadows[0];
        if (slot.owner && slot.owner.shadow === slot) slot.owner.shadow = null;
      }
      slot.owner = owner;
      slot.radius = radius;
      slot.base = opacity;
      slot.soft.visible = true;
      slot.core.visible = true;
      slot.soft.scale.set(radius, 1, radius);
      slot.core.scale.set(radius, 1, radius);
      slot.softMat.opacity = opacity * 0.75;
      slot.coreMat.opacity = opacity;
      return slot;
    }

    function releaseContactShadow(shadow) {
      if (!shadow) return;
      shadow.owner = null;
      shadow.soft.visible = false;
      shadow.core.visible = false;
    }

    function releaseAllContactShadows() {
      for (var i = 0; i < contactShadows.length; i++) {
        contactShadows[i].owner = null;
        contactShadows[i].soft.visible = false;
        contactShadows[i].core.visible = false;
      }
    }

    function updateContactShadows() {
      for (var i = 0; i < contactShadows.length; i++) {
        var s = contactShadows[i];
        var o = s.owner;
        if (!o || o.dead || !o.pos) {
          if (s.soft.visible) s.soft.visible = false;
          if (s.core.visible) s.core.visible = false;
          s.owner = null;
          continue;
        }
        var height = o.pos.y;
        var lift = o.isBoss ? 1.05 : (o.type === 'sentinel' ? 0.86 : 1);
        var breathe = 0.94 + 0.06 * Math.sin(worldClock * 2.2 + s.phase);
        var r = s.radius * lift * breathe;
        var opacity = s.base * Math.max(0.55, 1 - height * 0.08);

        // Broad footprint directly under the body.
        s.soft.position.set(o.pos.x, 0.057, o.pos.z);
        s.soft.scale.set(r * 1.18, 1, r * 1.02);
        s.softMat.opacity = opacity * 0.72;

        // Darker offset core, elongated along the shadow direction.
        s.core.position.set(
          o.pos.x + SHADOW_DIR_X * r * 0.26,
          0.059,
          o.pos.z + SHADOW_DIR_Z * r * 0.26
        );
        s.core.scale.set(r * 0.8, 1, r * 1.08);
        s.coreMat.opacity = opacity * 1.12;
      }
    }

    /* ------------------------------------------------------------ viewmodel */

    var viewRoot = new THREE.Group();
    viewRoot.position.set(0.33, -0.27, -0.66);
    camera.add(viewRoot);

    var muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.03, -0.72);
    viewRoot.add(muzzle);

    // Layered first-person muzzle burst: white-hot core, warm halo, crossed
    // star flare and a camera-facing ring.  Built once; only scale/visibility
    // changes while firing.
    var muzzleFlash = new THREE.Group();
    muzzleFlash.position.copy(muzzle.position);
    muzzleFlash.visible = false;
    viewRoot.add(muzzleFlash);

    var muzzleCoreMat = matBasic(0xffffff, {
      transparent: true, opacity: 0.98, blending: 'additive',
      depthTest: false, depthWrite: false
    });
    var muzzleHaloMat = matBasic(0xffc46a, {
      transparent: true, opacity: 0.22, blending: 'additive',
      depthTest: false, depthWrite: false
    });
    var muzzleStarMat = matBasic(0xfff0c0, {
      transparent: true, opacity: 0.85, blending: 'additive',
      depthTest: false, depthWrite: false
    });
    var muzzleRingMat = matBasic(0xffd27a, {
      transparent: true, opacity: 0.38, blending: 'additive',
      depthTest: false, depthWrite: false
    });
    var muzzleCore = new THREE.Mesh(G.lowSphere, muzzleCoreMat);
    muzzleCore.scale.setScalar(0.1);
    var muzzleHalo = new THREE.Mesh(G.sphere, muzzleHaloMat);
    muzzleHalo.scale.setScalar(0.24);
    var muzzleStarH = new THREE.Mesh(G.box, muzzleStarMat);
    muzzleStarH.scale.set(0.46, 0.032, 0.032);
    muzzleStarH.rotation.z = Math.PI / 4;
    var muzzleStarV = new THREE.Mesh(G.box, muzzleStarMat);
    muzzleStarV.scale.set(0.032, 0.46, 0.032);
    muzzleStarV.rotation.z = -Math.PI / 4;
    var muzzleRing = new THREE.Mesh(G.torus, muzzleRingMat);
    muzzleRing.scale.setScalar(0.2);
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleCore.renderOrder = 962;
    muzzleHalo.renderOrder = 961;
    muzzleStarH.renderOrder = 963;
    muzzleStarV.renderOrder = 963;
    muzzleRing.renderOrder = 960;
    muzzleFlash.add(muzzleCore);
    muzzleFlash.add(muzzleHalo);
    muzzleFlash.add(muzzleStarH);
    muzzleFlash.add(muzzleStarV);
    muzzleFlash.add(muzzleRing);

    function vmMat(hex) {
      return matBasic(hex, { depthTest: false, depthWrite: false });
    }

    var gunBody = vmMat(0x9db4ca);
    var gunLight = vmMat(0xc9dceb);
    var gunMid = vmMat(0x60788f);
    var gunDark = vmMat(0x2c3a4c);
    var gunDeep = vmMat(0x151f2b);
    var gunGlow = vmMat(C.cyan);
    var gunGlowSoft = vmMat(0xc9fbff);
    var gunPink = vmMat(C.magenta);
    var gunPinkSoft = vmMat(0xffb4e2);
    var gunViolet = vmMat(C.violet);
    var gunVioletDeep = vmMat(0x4a2a86);
    var gunVioletSoft = vmMat(0xe4d4ff);
    var gunWhite = vmMat(0xf4edff);
    var gunAmber = vmMat(C.amber);
    var gloveMat = vmMat(0x24434a);
    var gloveLight = vmMat(0x47707a);
    var gloveDark = vmMat(0x12262c);
    var bladeAuraMat = matBasic(C.violet, {
      transparent: true,
      opacity: 0.22,
      blending: 'additive',
      depthTest: false,
      depthWrite: false
    });

    var VM_GEO = {
      ring: new THREE.TorusGeometry(1, 0.13, 5, 18),
      bladeTip: new THREE.ConeGeometry(1, 1, 4)
    };

    /* Every viewmodel part is a shared-material mesh.  Details are inserted
       after their base plate so the painter-order renderer keeps the layers
       readable; palms sit at 949, gun bodies at 950 and highlights at 951. */
    function vmBox(parent, mat, x, y, z, sx, sy, sz, order, rx, ry, rz) {
      var m = new THREE.Mesh(G.box, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      m.renderOrder = order === undefined ? 950 : order;
      parent.add(m);
      return m;
    }

    function vmCyl(parent, mat, x, y, z, radius, length, axis, order) {
      var m = new THREE.Mesh(G.cylinder, mat);
      m.position.set(x, y, z);
      m.scale.set(radius, length, radius);
      if (axis === 'x') m.rotation.z = Math.PI / 2;
      else if (axis === 'z') m.rotation.x = Math.PI / 2;
      m.renderOrder = order === undefined ? 950 : order;
      parent.add(m);
      return m;
    }

    function vmRing(parent, mat, x, y, z, radius, axis, order) {
      var m = new THREE.Mesh(VM_GEO.ring, mat);
      m.position.set(x, y, z);
      m.scale.set(radius, radius, radius);
      // The vendored torus lies in XZ with its hole along +Y.
      if (axis === 'x') m.rotation.z = Math.PI / 2;
      else if (axis === 'z') m.rotation.x = Math.PI / 2;
      m.renderOrder = order === undefined ? 950 : order;
      parent.add(m);
      return m;
    }

    function vmCone(parent, mat, x, y, z, rx, length, ry, order) {
      var m = new THREE.Mesh(VM_GEO.bladeTip, mat);
      m.position.set(x, y, z);
      m.scale.set(rx, length, ry);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = order === undefined ? 950 : order;
      parent.add(m);
      return m;
    }

    function addGlove(parent, x, y, z, tilt) {
      var g = new THREE.Group();
      g.position.set(x, y, z);
      if (tilt) g.rotation.x = tilt;
      parent.add(g);

      // Palm and cuff sit behind the grip; the gun then paints over them.
      vmBox(g, gloveMat, 0, -0.006, 0.072, 0.088, 0.078, 0.10, 949);
      vmBox(g, gloveDark, 0, -0.01, 0.14, 0.084, 0.07, 0.055, 949);
      vmBox(g, gloveLight, 0, 0.037, 0.135, 0.078, 0.012, 0.035, 951);
      for (var i = 0; i < 4; i++) {
        vmBox(
          g,
          i % 2 === 0 ? gloveLight : gloveMat,
          -0.006,
          0.033 - i * 0.021,
          0.012,
          0.082,
          0.018,
          0.058,
          951
        );
      }
      // Thumb along the near face and a wrist status diode.
      vmBox(g, gloveLight, -0.047, 0.005, 0.045, 0.022, 0.045, 0.03, 951);
      vmBox(g, gloveDark, 0.046, -0.008, 0.07, 0.018, 0.04, 0.05, 949);
      vmBox(g, gunGlow, -0.045, 0.015, 0.16, 0.006, 0.008, 0.014, 951);
      return g;
    }

    function addHiltGlove(parent, x, y, z) {
      var g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);

      vmBox(g, gloveMat, 0, -0.055, 0.05, 0.08, 0.055, 0.115, 949);
      for (var i = 0; i < 4; i++) {
        vmBox(
          g,
          i % 2 === 0 ? gloveLight : gloveMat,
          -0.024,
          -0.002,
          0.085 - i * 0.028,
          0.05,
          0.045,
          0.022,
          951
        );
      }
      vmBox(g, gloveLight, -0.012, 0.032, 0.095, 0.034, 0.022, 0.065, 951);
      vmBox(g, gloveDark, 0, -0.055, 0.15, 0.085, 0.06, 0.06, 949);
      vmBox(g, gunVioletSoft, -0.038, -0.05, 0.158, 0.008, 0.012, 0.018, 951);
      return g;
    }

    var vmRefs = {
      rifleBolt: null,
      rifleBoltZ: 0,
      rifleCell: null,
      rifleCellBase: null,
      scatterDrum: null,
      scatterGate: null,
      bladeGroup: null,
      bladeCore: null,
      bladeCoreBase: null,
      bladeAura: null,
      bladeAuraBase: null
    };

    var weaponGroups = [];

    function buildPulseRifle() {
      var rifle = new THREE.Group();

      // Layered stock and butt pad, readable from the rear of the viewmodel.
      vmBox(rifle, gunMid, 0, 0.012, 0.235, 0.072, 0.078, 0.19);
      vmBox(rifle, gunDark, 0, 0.012, 0.33, 0.082, 0.105, 0.038);
      vmBox(rifle, gunDeep, 0, 0.012, 0.351, 0.058, 0.09, 0.006, 951);
      vmBox(rifle, gunLight, 0, 0.058, 0.245, 0.056, 0.02, 0.15);
      vmBox(rifle, gunDark, 0, -0.035, 0.235, 0.078, 0.038, 0.11);
      vmBox(rifle, gunDeep, -0.038, 0.012, 0.235, 0.006, 0.05, 0.13, 951);
      vmBox(rifle, gunMid, 0, 0.012, 0.14, 0.09, 0.085, 0.05);
      vmBox(rifle, gunDeep, 0, 0.025, 0.19, 0.045, 0.03, 0.08);
      vmBox(rifle, gunGlow, -0.035, 0.045, 0.25, 0.006, 0.008, 0.045, 951);
      vmBox(rifle, gunLight, 0, 0.04, 0.352, 0.065, 0.007, 0.004, 951);
      vmBox(rifle, gunLight, 0, -0.02, 0.352, 0.055, 0.007, 0.004, 951);

      // Receiver: dark chassis, pale upper, side armour and seam bolts.
      vmBox(rifle, gunDark, 0, -0.005, -0.03, 0.13, 0.118, 0.38);
      vmBox(rifle, gunBody, 0, 0.065, -0.085, 0.118, 0.06, 0.31);
      vmBox(rifle, gunMid, 0, 0.097, -0.10, 0.10, 0.014, 0.27);
      vmBox(rifle, gunMid, 0, 0, -0.275, 0.116, 0.11, 0.08);
      vmBox(rifle, gunDeep, 0, -0.058, -0.08, 0.122, 0.012, 0.30, 951);
      vmBox(rifle, gunMid, -0.069, 0.012, -0.07, 0.008, 0.075, 0.19, 951);
      vmBox(rifle, gunDeep, -0.061, 0.062, -0.15, 0.006, 0.03, 0.13, 951);
      vmBox(rifle, gunGlow, -0.065, 0.062, -0.15, 0.004, 0.018, 0.10, 951);
      vmBox(rifle, gunGlowSoft, -0.067, 0.062, -0.15, 0.002, 0.008, 0.08, 951);
      for (var tick = 0; tick < 3; tick++) {
        vmBox(rifle, gunDeep, -0.068, 0.062, -0.19 + tick * 0.04, 0.004, 0.022, 0.006, 951);
      }
      vmBox(rifle, gunDeep, -0.074, -0.03, -0.09, 0.004, 0.007, 0.17, 951);
      vmBox(rifle, gunDeep, -0.074, 0.052, -0.144, 0.004, 0.007, 0.06, 951);
      for (var i = 0; i < 3; i++) {
        vmBox(rifle, gunLight, -0.074, 0.047, -0.18 + i * 0.07, 0.006, 0.012, 0.012, 951);
      }
      // Amber hazard chevrons on the front block.
      vmBox(rifle, gunAmber, -0.062, -0.028, -0.245, 0.005, 0.016, 0.055, 951, 0.55, 0, 0);
      vmBox(rifle, gunAmber, -0.062, -0.028, -0.295, 0.005, 0.016, 0.055, 951, -0.55, 0, 0);

      // Top rail, rear aperture and front post.
      vmBox(rifle, gunDeep, 0, 0.11, -0.12, 0.055, 0.012, 0.33);
      for (i = 0; i < 6; i++) {
        vmBox(rifle, gunMid, 0, 0.119, -0.25 + i * 0.052, 0.062, 0.012, 0.024);
      }
      vmBox(rifle, gunDark, 0, 0.152, 0.035, 0.078, 0.052, 0.075);
      vmBox(rifle, gunDeep, 0, 0.156, 0.068, 0.052, 0.032, 0.012, 951);
      vmBox(rifle, gunGlow, 0, 0.157, 0.075, 0.022, 0.012, 0.006, 951);
      vmBox(rifle, gunLight, -0.038, 0.17, 0.035, 0.012, 0.025, 0.05, 951);
      vmBox(rifle, gunLight, 0.038, 0.17, 0.035, 0.012, 0.025, 0.05, 951);
      vmBox(rifle, gunAmber, -0.042, 0.158, 0.05, 0.009, 0.012, 0.02, 951);
      vmBox(rifle, gunDark, 0, 0.12, -0.31, 0.03, 0.055, 0.03);
      vmBox(rifle, gunDark, 0, 0.145, -0.31, 0.05, 0.032, 0.032);
      vmBox(rifle, gunGlow, 0, 0.166, -0.31, 0.01, 0.012, 0.01, 951);

      // Shrouded barrel with collars, cooling slots and a live energy spine.
      vmCyl(rifle, gunDeep, 0, 0.03, -0.43, 0.055, 0.25, 'z');
      vmRing(rifle, gunDark, 0, 0.03, -0.315, 0.062, 'z', 951);
      vmRing(rifle, gunDark, 0, 0.03, -0.405, 0.062, 'z', 951);
      vmRing(rifle, gunDark, 0, 0.03, -0.505, 0.058, 'z', 951);
      vmBox(rifle, gunMid, 0, 0.085, -0.43, 0.075, 0.022, 0.21);
      vmBox(rifle, gunDeep, 0, 0.099, -0.43, 0.048, 0.008, 0.19, 951);
      vmBox(rifle, gunGlow, 0, 0.104, -0.45, 0.014, 0.006, 0.14, 951);
      for (i = 0; i < 3; i++) {
        vmBox(rifle, gunDeep, -0.056, 0.018, -0.355 - i * 0.06, 0.006, 0.034, 0.012, 951);
      }
      vmBox(rifle, gunDeep, 0, -0.035, -0.35, 0.04, 0.022, 0.20);
      vmBox(rifle, gunMid, 0, -0.045, -0.31, 0.03, 0.018, 0.10, 951);

      // Muzzle stack: collars, brake block and a visible cyan core.
      vmCyl(rifle, gunMid, 0, 0.03, -0.575, 0.028, 0.16, 'z');
      vmCyl(rifle, gunDeep, 0, 0.03, -0.63, 0.042, 0.035, 'z', 951);
      vmRing(rifle, gunLight, 0, 0.03, -0.605, 0.045, 'z', 951);
      vmRing(rifle, gunDark, 0, 0.03, -0.65, 0.038, 'z', 951);
      vmCyl(rifle, gunDark, 0, 0.03, -0.688, 0.03, 0.05, 'z', 951);
      vmBox(rifle, gunDeep, -0.031, 0.03, -0.688, 0.01, 0.014, 0.03, 951);
      vmBox(rifle, gunDeep, 0.031, 0.03, -0.688, 0.01, 0.014, 0.03, 951);
      vmCyl(rifle, gunGlow, 0, 0.03, -0.712, 0.016, 0.012, 'z', 951);

      // Readable energy cell with a glowing side window and charge ticks.
      vmBox(rifle, gunDeep, 0, -0.165, -0.11, 0.078, 0.19, 0.11, 950, 0.12, 0, 0);
      vmBox(rifle, gunMid, 0, -0.15, -0.11, 0.086, 0.055, 0.105, 951, 0.12, 0, 0);
      var cellGlow = vmBox(rifle, gunGlow, -0.045, -0.16, -0.11, 0.006, 0.07, 0.065, 951, 0.12, 0, 0);
      vmBox(rifle, gunGlowSoft, -0.049, -0.16, -0.11, 0.003, 0.05, 0.04, 951, 0.12, 0, 0);
      vmBox(rifle, gunLight, -0.045, -0.245, -0.11, 0.012, 0.012, 0.07, 951);
      for (i = 0; i < 3; i++) {
        vmBox(rifle, gunAmber, -0.052, -0.20 + i * 0.02, -0.11, 0.004, 0.005, 0.035, 951, 0.12, 0, 0);
      }

      // Forward grip and trigger group.
      vmBox(rifle, gunDark, 0, -0.135, -0.29, 0.058, 0.16, 0.08, 950, -0.18, 0, 0);
      vmBox(rifle, gunMid, -0.033, -0.13, -0.29, 0.008, 0.11, 0.055, 951, -0.18, 0, 0);
      for (i = 0; i < 3; i++) {
        vmBox(rifle, gunDeep, -0.038, -0.10 - i * 0.03, -0.275, 0.006, 0.012, 0.045, 951, -0.18, 0, 0);
      }
      vmBox(rifle, gunDeep, 0, -0.085, -0.005, 0.018, 0.012, 0.09);
      vmBox(rifle, gunDeep, 0, -0.12, 0.035, 0.018, 0.012, 0.08);
      vmBox(rifle, gunDeep, 0, -0.105, 0.072, 0.018, 0.045, 0.012);
      vmBox(rifle, gunLight, 0, -0.083, 0.018, 0.012, 0.035, 0.012, 951);

      // Pistol grip, charging handle and glove.
      vmBox(rifle, gunDeep, 0, -0.14, 0.065, 0.06, 0.18, 0.095, 950, 0.16, 0, 0);
      vmBox(rifle, gunMid, -0.032, -0.13, 0.06, 0.007, 0.12, 0.06, 951, 0.16, 0, 0);
      for (i = 0; i < 3; i++) {
        vmBox(rifle, gunLight, -0.036, -0.09 - i * 0.035, 0.055, 0.006, 0.008, 0.055, 951, 0.16, 0, 0);
      }
      var bolt = vmBox(rifle, gunLight, -0.073, 0.048, 0.018, 0.018, 0.022, 0.055, 951);
      vmBox(rifle, gunDeep, -0.075, 0.048, -0.035, 0.006, 0.012, 0.085, 951);
      vmBox(rifle, gunGlow, -0.07, 0.078, 0.035, 0.006, 0.012, 0.03, 951);
      addGlove(rifle, 0, -0.14, 0.065, 0.16);

      rifle.visible = true;
      weaponGroups.push(rifle);
      viewRoot.add(rifle);

      vmRefs.rifleBolt = bolt;
      vmRefs.rifleBoltZ = bolt.position.z;
      vmRefs.rifleCell = cellGlow;
      vmRefs.rifleCellBase = { x: cellGlow.scale.x, y: cellGlow.scale.y, z: cellGlow.scale.z };
    }

    function buildRiftScatter() {
      var scatter = new THREE.Group();

      // Squat receiver with a pale upper shell and dark side armour.
      vmBox(scatter, gunDark, 0, 0.005, -0.06, 0.21, 0.16, 0.34);
      vmBox(scatter, gunBody, 0, 0.095, -0.09, 0.19, 0.055, 0.27);
      vmBox(scatter, gunMid, 0, 0.015, -0.255, 0.225, 0.14, 0.09);
      vmBox(scatter, gunDeep, 0, -0.055, -0.10, 0.20, 0.012, 0.26, 951);
      vmBox(scatter, gunMid, -0.108, 0.015, -0.09, 0.008, 0.10, 0.20, 951);
      vmBox(scatter, gunDeep, -0.113, -0.035, -0.09, 0.004, 0.007, 0.18, 951);
      vmBox(scatter, gunPink, -0.113, 0.055, -0.16, 0.005, 0.012, 0.11, 951);
      for (var i = 0; i < 3; i++) {
        vmBox(scatter, gunDeep, -0.112, 0.005, -0.18 + i * 0.05, 0.006, 0.026, 0.014, 951);
      }
      for (i = 0; i < 4; i++) {
        vmBox(scatter, gunLight, -0.113, 0.075, -0.22 + i * 0.06, 0.006, 0.012, 0.012, 951);
      }

      // Breech gate with five visible shell cells; it lifts during reload.
      var gate = new THREE.Group();
      scatter.add(gate);
      vmBox(gate, gunMid, 0, 0.14, 0.015, 0.15, 0.025, 0.13);
      vmBox(gate, gunDeep, 0, 0.153, -0.015, 0.11, 0.008, 0.08, 951);
      for (i = 0; i < 5; i++) {
        vmBox(gate, gunPink, -0.056 + i * 0.028, 0.157, 0.02, 0.017, 0.01, 0.05, 951);
        vmBox(gate, gunAmber, -0.056 + i * 0.028, 0.162, 0.045, 0.017, 0.006, 0.008, 951);
      }
      vmCyl(scatter, gunDark, 0, 0.135, -0.055, 0.014, 0.15, 'x', 951);

      // Five-barrel cluster runs through a heavy front collar.
      var barrelXs = [-0.08, -0.04, 0, 0.04, 0.08];
      for (i = 0; i < barrelXs.length; i++) {
        vmCyl(scatter, gunDeep, barrelXs[i], 0.035, -0.40, 0.019, 0.30, 'z');
      }
      vmBox(scatter, gunMid, 0, 0.0, -0.40, 0.20, 0.034, 0.23);
      vmBox(scatter, gunDeep, 0, 0.065, -0.40, 0.20, 0.014, 0.22);
      vmBox(scatter, gunMid, 0, 0.075, -0.30, 0.07, 0.055, 0.12);
      vmBox(scatter, gunBody, 0, 0.035, -0.525, 0.225, 0.10, 0.06);
      vmBox(scatter, gunDark, 0, 0.035, -0.557, 0.215, 0.07, 0.012, 951);
      vmBox(scatter, gunAmber, -0.095, 0.035, -0.525, 0.008, 0.045, 0.02, 951);
      for (i = 0; i < barrelXs.length; i++) {
        vmCyl(scatter, gunDark, barrelXs[i], 0.035, -0.635, 0.0185, 0.17, 'z', 951);
        vmCyl(scatter, gunPink, barrelXs[i], 0.035, -0.66, 0.024, 0.016, 'z', 951);
        vmCyl(scatter, gunPinkSoft, barrelXs[i], 0.035, -0.706, 0.011, 0.012, 'z', 951);
      }

      // Large energy drum: coil bands plus a lit outer face plate.
      var drum = new THREE.Group();
      drum.position.set(0, -0.15, -0.02);
      scatter.add(drum);
      vmCyl(drum, gunDeep, 0, 0, 0, 0.105, 0.18, 'x');
      vmCyl(drum, gunPink, -0.064, 0, 0, 0.108, 0.016, 'x', 951);
      vmCyl(drum, gunMid, -0.022, 0, 0, 0.11, 0.016, 'x', 951);
      vmCyl(drum, gunPink, 0.022, 0, 0, 0.108, 0.016, 'x', 951);
      vmCyl(drum, gunMid, 0.064, 0, 0, 0.11, 0.016, 'x', 951);
      vmCyl(drum, gunBody, -0.098, 0, 0, 0.072, 0.016, 'x', 951);
      vmCyl(drum, gunPink, -0.108, 0, 0, 0.046, 0.008, 'x', 951);
      vmCyl(drum, gunVioletSoft, -0.114, 0, 0, 0.016, 0.006, 'x', 951);
      vmBox(drum, gunLight, -0.112, 0.05, 0, 0.008, 0.012, 0.012, 951);
      vmBox(drum, gunLight, -0.112, -0.04, 0.03, 0.008, 0.01, 0.01, 951);
      vmBox(scatter, gunPink, -0.075, -0.06, -0.16, 0.02, 0.12, 0.025, 951);
      vmBox(scatter, gunDark, -0.075, -0.06, -0.16, 0.03, 0.09, 0.012, 951);

      // Pistol grip, trigger guard, folded rear brace and hand.
      vmBox(scatter, gunDeep, 0, -0.17, 0.13, 0.062, 0.185, 0.10, 950, 0.15, 0, 0);
      vmBox(scatter, gunMid, -0.033, -0.16, 0.125, 0.007, 0.12, 0.06, 951, 0.15, 0, 0);
      for (i = 0; i < 3; i++) {
        vmBox(scatter, gunLight, -0.037, -0.115 - i * 0.035, 0.12, 0.006, 0.008, 0.05, 951, 0.15, 0, 0);
      }
      vmBox(scatter, gunDeep, 0, -0.10, 0.045, 0.02, 0.012, 0.09);
      vmBox(scatter, gunDeep, 0, -0.135, 0.09, 0.02, 0.012, 0.075);
      vmBox(scatter, gunDeep, 0, -0.122, 0.125, 0.02, 0.04, 0.012);
      vmBox(scatter, gunLight, 0, -0.10, 0.075, 0.012, 0.032, 0.012, 951);
      vmBox(scatter, gunMid, 0, 0.02, 0.155, 0.15, 0.10, 0.09);
      vmBox(scatter, gunDeep, 0, 0.02, 0.205, 0.11, 0.07, 0.03);
      vmBox(scatter, gunDark, 0, 0.06, 0.185, 0.06, 0.03, 0.10);
      vmBox(scatter, gunPink, -0.112, 0.095, 0.015, 0.008, 0.018, 0.05, 951);
      vmBox(scatter, gunLight, -0.116, 0.095, 0.04, 0.006, 0.012, 0.014, 951);
      addGlove(scatter, 0, -0.17, 0.13, 0.15);

      scatter.visible = false;
      weaponGroups.push(scatter);
      viewRoot.add(scatter);

      vmRefs.scatterDrum = drum;
      vmRefs.scatterGate = gate;
    }

    function buildPhaseBlade() {
      var blade = new THREE.Group();

      // Substantial stacked grip and lit pommel.
      vmCyl(blade, gunDeep, 0, 0, 0.065, 0.03, 0.21, 'z');
      for (var i = 0; i < 6; i++) {
        vmCyl(blade, i % 2 ? gunMid : gunDark, 0, 0, 0.145 - i * 0.034, 0.036, 0.018, 'z', 951);
      }
      vmBox(blade, gunVioletDeep, -0.033, 0, 0.06, 0.006, 0.018, 0.14, 951);
      vmCyl(blade, gunMid, 0, 0, 0.183, 0.042, 0.045, 'z');
      vmRing(blade, gunViolet, 0, 0, 0.198, 0.04, 'z', 951);
      vmCyl(blade, gunVioletSoft, 0, 0, 0.208, 0.018, 0.008, 'z', 951);
      vmRing(blade, gunDark, 0.04, 0, 0.18, 0.022, 'z', 951);

      // Guard wings and emitter housing.
      vmBox(blade, gunDark, 0, 0, -0.05, 0.075, 0.07, 0.07);
      vmBox(blade, gunMid, 0, 0, -0.055, 0.055, 0.082, 0.05, 951);
      vmBox(blade, gunMid, -0.052, 0, -0.035, 0.058, 0.028, 0.05, 950, 0, -0.22, 0);
      vmBox(blade, gunMid, 0.052, 0, -0.035, 0.058, 0.028, 0.05, 950, 0, 0.22, 0);
      vmBox(blade, gunViolet, -0.081, 0, -0.055, 0.014, 0.05, 0.05, 951, 0, -0.22, 0);
      vmBox(blade, gunViolet, 0.081, 0, -0.055, 0.014, 0.05, 0.05, 951, 0, 0.22, 0);
      vmBox(blade, gunDeep, 0, 0.005, -0.105, 0.065, 0.06, 0.075);
      vmBox(blade, gunMid, 0, 0.035, -0.11, 0.05, 0.02, 0.06, 951);
      var core = vmBox(blade, gunViolet, 0, 0.008, -0.135, 0.038, 0.04, 0.04, 951);
      vmBox(blade, gunVioletSoft, 0, 0.008, -0.15, 0.018, 0.022, 0.02, 951);
      vmBox(blade, gunMid, -0.045, 0.005, -0.12, 0.018, 0.05, 0.09, 950, 0, 0.1, 0);
      vmBox(blade, gunMid, 0.045, 0.005, -0.12, 0.018, 0.05, 0.09, 950, 0, -0.1, 0);
      vmBox(blade, gunViolet, -0.054, 0.005, -0.15, 0.008, 0.03, 0.03, 951);
      vmBox(blade, gunViolet, 0.054, 0.005, -0.15, 0.008, 0.03, 0.03, 951);
      vmBox(blade, gunDark, 0, -0.045, 0.02, 0.02, 0.02, 0.06);
      vmBox(blade, gunVioletSoft, -0.012, -0.05, 0.02, 0.008, 0.008, 0.03, 951);

      // Phase aura, layered blade, dark back-spine and pale cutting edge.
      var aura = vmBox(blade, bladeAuraMat, 0, 0.018, -0.33, 0.056, 0.13, 0.39, 949);
      vmBox(blade, gunVioletDeep, 0, 0.02, -0.32, 0.05, 0.115, 0.39);
      vmBox(blade, gunViolet, 0, 0.018, -0.33, 0.032, 0.088, 0.37, 951);
      vmBox(blade, gunVioletSoft, 0, 0.015, -0.34, 0.012, 0.04, 0.31, 951);
      vmBox(blade, gunDark, 0, 0.078, -0.31, 0.036, 0.028, 0.35, 951);
      vmBox(blade, gunMid, 0, 0.088, -0.30, 0.02, 0.012, 0.30, 951);
      vmBox(blade, gunVioletSoft, 0, -0.035, -0.33, 0.018, 0.012, 0.37, 951);
      vmBox(blade, gunWhite, 0, -0.042, -0.33, 0.008, 0.006, 0.34, 951);
      vmBox(blade, gunMid, 0, 0.02, -0.14, 0.056, 0.10, 0.06);
      vmBox(blade, gunViolet, -0.028, 0.02, -0.16, 0.008, 0.07, 0.02, 951);
      vmCone(blade, gunViolet, 0, 0.02, -0.545, 0.026, 0.17, 0.045, 951);
      vmCone(blade, gunVioletSoft, 0, 0.02, -0.565, 0.013, 0.14, 0.022, 951);
      addHiltGlove(blade, 0, -0.005, 0.055);
      // Angle the sword up so its length reads instead of foreshortening flat.
      blade.rotation.x = 0.26;

      blade.visible = false;
      weaponGroups.push(blade);
      viewRoot.add(blade);

      vmRefs.bladeGroup = blade;
      vmRefs.bladeCore = core;
      vmRefs.bladeCoreBase = { x: core.scale.x, y: core.scale.y, z: core.scale.z };
      vmRefs.bladeAura = aura;
      vmRefs.bladeAuraBase = { x: aura.scale.x, y: aura.scale.y, z: aura.scale.z };
    }

    function buildWeaponModels() {
      buildPulseRifle();
      buildRiftScatter();
      buildPhaseBlade();
    }

    buildWeaponModels();

    // Reuses only existing recoil/reload state; no meshes or vectors allocated.
    function updateViewmodel(dt) {
      var w = currentGun();
      var t = gameTime;

      if (vmRefs.rifleBolt) {
        vmRefs.rifleBolt.position.z = vmRefs.rifleBoltZ + player.recoil * 0.02;
      }
      if (vmRefs.rifleCell) {
        vmRefs.rifleCell.scale.y =
          vmRefs.rifleCellBase.y * (0.92 + Math.sin(t * 7.5) * 0.08);
      }
      if (vmRefs.scatterDrum) {
        vmRefs.scatterDrum.rotation.x += dt * (w.reloading > 0 ? 15 : 0.5);
      }
      if (vmRefs.scatterGate) {
        var gateLift = 0;
        if (w.reloading > 0 && w.def.reloadTime) {
          var reloadK = 1 - w.reloading / w.def.reloadTime;
          gateLift = Math.sin(Math.max(0, Math.min(1, reloadK)) * Math.PI) * 0.024;
        }
        vmRefs.scatterGate.position.y = gateLift;
      }
      if (vmRefs.bladeCore) {
        var corePulse = 0.92 + Math.sin(t * 9.3) * 0.08;
        vmRefs.bladeCore.scale.set(
          vmRefs.bladeCoreBase.x * corePulse,
          vmRefs.bladeCoreBase.y,
          vmRefs.bladeCoreBase.z * corePulse
        );
      }
      if (vmRefs.bladeAura) {
        var auraPulse = 0.96 + Math.sin(t * 5.1 + 1.7) * 0.04;
        vmRefs.bladeAura.scale.set(
          vmRefs.bladeAuraBase.x * auraPulse,
          vmRefs.bladeAuraBase.y * auraPulse,
          vmRefs.bladeAuraBase.z
        );
      }
      if (vmRefs.bladeGroup) {
        var swing = currentWeapon === 2 ? player.recoil : 0;
        vmRefs.bladeGroup.rotation.x = 0.26;
        vmRefs.bladeGroup.rotation.z = -swing * 0.18;
        vmRefs.bladeGroup.rotation.y = swing * 0.38;
        vmRefs.bladeGroup.position.x = -swing * 0.02;
      }
    }

    /* --------------------------------------------------------------- state */

    var player = {
      pos: new THREE.Vector3(0, EYE, 12.6),
      yaw: 0,
      pitch: 0,
      radius: 0.42,
      hp: 100,
      maxHp: 100,
      invuln: 0,
      dashT: 0,
      dashCd: 0,
      dashDir: new THREE.Vector3(0, 0, -1),
      pulseCd: 0,
      lastHit: -999,
      shake: 0,
      bob: 0,
      recoil: 0,
      flashT: 0
    };

    var WEAPON_DEFS = [
      {
        id: 'rifle', slot: '01', name: '脉冲步枪', en: 'PULSE RIFLE',
        auto: true, magSize: 30, reserveMax: 120,
        dmg: 20, interval: 0.105, reloadTime: 1.1,
        spread: 0.014, pellets: 1, range: 55, color: C.cyan
      },
      {
        id: 'scatter', slot: '02', name: '裂能散射器', en: 'RIFT SCATTER',
        auto: false, magSize: 8, reserveMax: 48,
        dmg: 12, interval: 0.62, reloadTime: 1.35,
        spread: 0.075, pellets: 5, range: 32, color: C.magenta
      },
      {
        id: 'blade', slot: '03', name: '相位刃', en: 'PHASE BLADE',
        melee: true, interval: 0.42, range: 3.0, arc: 0.58, dmg: 56, color: C.violet
      }
    ];

    var weapons = WEAPON_DEFS.map(function (def) {
      return {
        def: def,
        mag: def.magSize || 0,
        reserve: def.reserveMax || 0,
        cool: 0,
        reloading: 0
      };
    });

    var currentWeapon = 0;

    var input = {
      keys: Object.create(null),
      fireHeld: false,
      fireQueued: false,
      sprint: false
    };

    var mode = 'menu';
    var pointerLocked = false;
    var fallbackLook = false;
    var lockPending = false;

    var gameTime = 0;
    var runTime = 0;
    var kills = 0;
    var lastTs = 0;

    var enemies = [];
    var bullets = [];
    var deflects = [];
    var missiles = [];
    var particles = [];
    var telegraphs = [];
    var shockwaves = [];
    var lasers = [];
    var pending = [];

    var boss = null;
    var bossEverSpawned = false;

    var flow = {
      wave: 0,
      clearT: 0,
      bossActive: false
    };

    var MAX = {
      bullets: 90,
      deflects: 24,
      missiles: 8,
      tracers: 28,
      particles: 190,
      telegraphs: 12,
      shockwaves: 4,
      lasers: 3,
      rings: 10
    };

    var tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    var UP = new THREE.Vector3(0, 1, 0);
    var ZAXIS = new THREE.Vector3(0, 0, 1);

    var SENS = 0.0023;

    /* ------------------------------------------------------------- helpers */

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function dist2D(a, b) {
      var dx = a.x - b.x, dz = a.z - b.z;
      return Math.sqrt(dx * dx + dz * dz);
    }
    function angleWrap(a) {
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    }
    function setText(el, value) {
      if (!el) return;
      if (el.__text !== value) {
        el.__text = value;
        el.textContent = value;
      }
    }

    function forwardVec(target) {
      var cp = Math.cos(player.pitch);
      target.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);
      return target;
    }

    function flatForward(target) {
      target.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      return target;
    }

    function aimCameraAt(target) {
      var dx = target.x - camera.position.x;
      var dy = target.y - camera.position.y;
      var dz = target.z - camera.position.z;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var yaw = Math.atan2(-dx / len, -dz / len);
      var pitch = Math.asin(clamp(dy / len, -1, 1));
      tmpEuler.set(pitch, yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(tmpEuler);
    }

    /* ----------------------------------------------------------- collisions */

    function resolveCircle(pos, radius) {
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < colliders.length; i++) {
          var c = colliders[i];
          var cx = clamp(pos.x, c.minX, c.maxX);
          var cz = clamp(pos.z, c.minZ, c.maxZ);
          var dx = pos.x - cx;
          var dz = pos.z - cz;
          var d2 = dx * dx + dz * dz;
          if (d2 < radius * radius) {
            if (d2 > 1e-8) {
              var d = Math.sqrt(d2);
              var push = (radius - d) / d;
              pos.x += dx * push;
              pos.z += dz * push;
            } else {
              var left = pos.x - c.minX;
              var right = c.maxX - pos.x;
              var near = pos.z - c.minZ;
              var far = c.maxZ - pos.z;
              var m = Math.min(left, right, near, far);
              if (m === left) pos.x = c.minX - radius;
              else if (m === right) pos.x = c.maxX + radius;
              else if (m === near) pos.z = c.minZ - radius;
              else pos.z = c.maxZ + radius;
            }
          }
        }
        pos.x = clamp(pos.x, ARENA.minX + 0.55, ARENA.maxX - 0.55);
        pos.z = clamp(pos.z, ARENA.minZ + 0.55, ARENA.maxZ - 0.55);
      }
      return pos;
    }

    function movePlayer(dx, dz) {
      var steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.22));
      for (var i = 0; i < steps; i++) {
        player.pos.x += dx / steps;
        player.pos.z += dz / steps;
        resolveCircle(player.pos, player.radius);
      }
      player.pos.y = EYE;
    }

    function rayBox(ox, oy, oz, dx, dy, dz, box) {
      var tmin = 0;
      var tmax = Infinity;
      var o = [ox, oy, oz];
      var d = [dx, dy, dz];
      var lo = [box.minX, box.y0, box.minZ];
      var hi = [box.maxX, box.y1, box.maxZ];
      for (var a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-8) {
          if (o[a] < lo[a] || o[a] > hi[a]) return -1;
        } else {
          var t1 = (lo[a] - o[a]) / d[a];
          var t2 = (hi[a] - o[a]) / d[a];
          if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) return -1;
        }
      }
      return tmin > 0 ? tmin : -1;
    }

    function raySphere(ox, oy, oz, dx, dy, dz, center, radius) {
      var cx = ox - center.x;
      var cy = oy - center.y;
      var cz = oz - center.z;
      var b = cx * dx + cy * dy + cz * dz;
      var c = cx * cx + cy * cy + cz * cz - radius * radius;
      var disc = b * b - c;
      if (disc < 0) return -1;
      var sq = Math.sqrt(disc);
      var t = -b - sq;
      if (t < 0) t = -b + sq;
      return t > 0 ? t : -1;
    }

    function wallHitDistance(ox, oy, oz, dx, dy, dz, maxT) {
      var best = maxT;
      for (var i = 0; i < colliders.length; i++) {
        var t = rayBox(ox, oy, oz, dx, dy, dz, colliders[i]);
        if (t > 0 && t < best) best = t;
      }
      if (dy < -1e-6) {
        var tFloor = -oy / dy;
        if (tFloor > 0 && tFloor < best) best = tFloor;
      }
      return best;
    }

    function hasLineOfSight(from, to) {
      var dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= len; dy /= len; dz /= len;
      var hit = wallHitDistance(from.x, from.y, from.z, dx, dy, dz, len - 0.2);
      return hit >= len - 0.25;
    }

    /* -------------------------------------------------------------- weapons */

    function currentGun() { return weapons[currentWeapon]; }

    function syncWeaponVisuals() {
      for (var i = 0; i < weaponGroups.length; i++) {
        weaponGroups[i].visible = i === currentWeapon;
      }
      var melee = !!WEAPON_DEFS[currentWeapon].melee;
      ui.crosshair.classList.toggle('is-melee', melee);
    }

    function resetWeapons() {
      for (var i = 0; i < weapons.length; i++) {
        weapons[i].mag = WEAPON_DEFS[i].magSize || 0;
        weapons[i].reserve = WEAPON_DEFS[i].reserveMax || 0;
        weapons[i].cool = 0;
        weapons[i].reloading = 0;
      }
      currentWeapon = 0;
      syncWeaponVisuals();
    }

    /* ------------------------------------------------------------------ fx */

    var muzzleT = 0;
    var lastDryToast = -10;
    var bossDefeated = false;

    var BULLET_TRAIL_LIMIT = 32;
    var SPARK_LIMIT = 48;

    var ringFxPool = [];
    var tracerFxPool = [];
    var bulletFxPool = [];
    var bulletTrailPool = [];
    var deflectFxPool = [];
    var missileFxPool = [];
    var telegraphFxPool = [];
    var laserFxPool = [];
    var shockwaveFxPool = [];
    var sparkFxPool = [];

    var fxTmpDir = new THREE.Vector3();
    var fxTmpVec = new THREE.Vector3();

    function fxAdditive(hex, opacity) {
      return matBasic(hex, {
        transparent: true, opacity: opacity, blending: 'additive',
        depthWrite: false, fog: false
      });
    }

    function makeParticleMesh() {
      var mesh = new THREE.Mesh(G.box, fxAdditive(0xffffff, 1));
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    }

    // Release only geometry allocated for a transient object; shared arena
    // geometry is never tagged, so it survives run resets.
    function disposeOwned(root) {
      if (!root) return;
      root.traverse(function (o) {
        if (o.isMesh && o.geometry && o.geometry._owned) o.geometry.dispose();
      });
    }

    function buildParticlePool() {
      for (var i = 0; i < MAX.particles; i++) {
        particles.push({
          mesh: makeParticleMesh(),
          alive: false,
          vel: new THREE.Vector3(),
          ttl: 0,
          max: 1,
          size: 0.03
        });
      }
    }

    function spawnParticles(pos, color, count, speed, life, size) {
      for (var i = 0; i < count; i++) {
        var slot = null;
        for (var j = 0; j < particles.length; j++) {
          if (!particles[j].alive) { slot = particles[j]; break; }
        }
        // The pool is prewarmed to MAX.particles, so a full pool simply drops
        // the extra spark instead of constructing anything inside the loop.
        if (!slot) return;
        slot.alive = true;
        slot.ttl = slot.max = life * rnd(0.65, 1.25);
        slot.size = size * rnd(0.55, 1.25);
        slot.mesh.visible = true;
        slot.mesh.position.copy(pos);
        slot.mesh.material.color.setHex(color);
        slot.mesh.material.opacity = 1;
        slot.mesh.scale.setScalar(slot.size);
        slot.vel.set(rnd(-1, 1), rnd(-0.25, 1), rnd(-1, 1));
        if (slot.vel.lengthSq() < 1e-5) slot.vel.set(0, 1, 0);
        slot.vel.normalize().multiplyScalar(speed * rnd(0.35, 1));
      }
    }

    function updateParticles(dt) {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (!p.alive) continue;
        p.ttl -= dt;
        if (p.ttl <= 0) {
          p.alive = false;
          p.mesh.visible = false;
          continue;
        }
        p.vel.y -= 6.5 * dt;
        p.vel.multiplyScalar(Math.max(0, 1 - 1.6 * dt));
        p.mesh.position.addScaledVector(p.vel, dt);
        var k = p.ttl / p.max;
        p.mesh.material.opacity = k;
        p.mesh.scale.setScalar(p.size * (0.35 + 0.65 * k));
      }
    }

    /* --------------------------------------------------------- hit sparks */

    function buildSparkPool() {
      for (var i = 0; i < SPARK_LIMIT; i++) {
        var mat = fxAdditive(0xffffff, 1);
        var mesh = new THREE.Mesh(G.box, mat);
        mesh.visible = false;
        mesh.renderOrder = 952;
        scene.add(mesh);
        sparkFxPool.push({
          mesh: mesh,
          mat: mat,
          alive: false,
          vel: new THREE.Vector3(),
          ttl: 0,
          max: 1,
          size: 0.02
        });
      }
    }

    function spawnSparks(pos, color, count, speed, power) {
      for (var i = 0; i < count; i++) {
        var slot = null;
        for (var j = 0; j < sparkFxPool.length; j++) {
          if (!sparkFxPool[j].alive) { slot = sparkFxPool[j]; break; }
        }
        if (!slot) return;
        slot.alive = true;
        slot.ttl = slot.max = rnd(0.18, 0.38);
        slot.size = rnd(0.012, 0.028) * (0.8 + power * 0.25);
        slot.mesh.visible = true;
        slot.mesh.position.copy(pos);
        slot.mesh.material.color.setHex(color);
        slot.mesh.material.opacity = 1;
        slot.mesh.scale.set(slot.size, slot.size, slot.size * rnd(1.5, 3.4));
        slot.vel.set(rnd(-1, 1), rnd(-0.2, 1.35), rnd(-1, 1));
        if (slot.vel.lengthSq() < 1e-5) slot.vel.set(0, 1, 0);
        slot.vel.normalize().multiplyScalar(speed * rnd(0.45, 1.2));
      }
    }

    function updateSparks(dt) {
      for (var i = 0; i < sparkFxPool.length; i++) {
        var s = sparkFxPool[i];
        if (!s.alive) continue;
        s.ttl -= dt;
        if (s.ttl <= 0) {
          s.alive = false;
          s.mesh.visible = false;
          continue;
        }
        s.vel.y -= 7.5 * dt;
        s.vel.multiplyScalar(Math.max(0, 1 - 2.4 * dt));
        s.mesh.position.addScaledVector(s.vel, dt);
        fxTmpDir.copy(s.vel);
        if (fxTmpDir.lengthSq() > 1e-5) {
          fxTmpDir.normalize();
          s.mesh.quaternion.setFromUnitVectors(ZAXIS, fxTmpDir);
        }
        var k = s.ttl / s.max;
        s.mat.opacity = Math.min(1, k * 1.4);
        s.mesh.scale.set(s.size, s.size, s.size * (1.4 + s.vel.length() * 0.05));
      }
    }

    function spawnImpactFx(point, color, power) {
      var p = power || 1;
      spawnSparks(point, color, 2 + Math.floor(p * 3), 2.6 + p * 2.2, p);
      if (p > 0.9) spawnRingFx(point, 0.55 + p * 0.45, color, 0.2 + p * 0.05, point.y);
    }

    /* --------------------------------------------------------------- rings */

    function buildRingPool() {
      for (var i = 0; i < MAX.rings; i++) {
        var mat = fxAdditive(0xffffff, 0.9);
        var mesh = new THREE.Mesh(G.ring, mat);
        mesh.visible = false;
        mesh.renderOrder = 6;
        scene.add(mesh);
        ringFxPool.push({ mesh: mesh, mat: mat, alive: false, t: 0, dur: 1, maxR: 1 });
      }
    }

    function spawnRingFx(pos, maxR, color, duration, y) {
      var slot = null;
      for (var i = 0; i < ringFxPool.length; i++) {
        if (!ringFxPool[i].alive) { slot = ringFxPool[i]; break; }
      }
      if (!slot) return;
      slot.alive = true;
      slot.t = 0;
      slot.dur = duration;
      slot.maxR = maxR;
      slot.mat.color.setHex(color);
      slot.mat.opacity = 0.9;
      slot.mesh.visible = true;
      slot.mesh.position.set(pos.x, y === undefined ? 0.06 : y, pos.z);
      slot.mesh.rotation.set(0, 0, 0);
      slot.mesh.scale.set(0.3, 1, 0.3);
    }

    function updateRings(dt) {
      for (var i = 0; i < ringFxPool.length; i++) {
        var r = ringFxPool[i];
        if (!r.alive) continue;
        r.t += dt;
        var k = clamp(r.t / r.dur, 0, 1);
        var radius = 0.4 + (r.maxR - 0.4) * (1 - Math.pow(1 - k, 2));
        r.mesh.scale.set(radius, 1, radius);
        r.mat.opacity = (1 - k) * 0.85;
        if (k >= 1) {
          r.alive = false;
          r.mesh.visible = false;
        }
      }
    }

    /* ---------------------------------------------------------- telegraphs */

    function buildTelegraphPool() {
      for (var i = 0; i < MAX.telegraphs; i++) {
        var group = new THREE.Group();
        var groundMat = fxAdditive(0xffffff, 0.3);
        var ringMat = fxAdditive(0xffffff, 0.45);
        var columnMat = fxAdditive(0xffffff, 0.1);
        var ground = new THREE.Mesh(G.circle, groundMat);
        ground.position.y = 0.045;
        ground.renderOrder = 7;
        var ring = new THREE.Mesh(G.ring, ringMat);
        ring.position.y = 0.07;
        ring.renderOrder = 8;
        var column = new THREE.Mesh(G.cylinder, columnMat);
        column.position.y = 2.0;
        column.scale.set(0.09, 4.0, 0.09);
        column.renderOrder = 5;
        group.add(ground);
        group.add(ring);
        group.add(column);
        group.visible = false;
        scene.add(group);
        telegraphFxPool.push({
          group: group,
          ground: ground,
          groundMat: groundMat,
          ring: ring,
          ringMat: ringMat,
          column: column,
          columnMat: columnMat,
          active: false,
          x: 0, z: 0, radius: 1, t: 0, delay: 1
        });
      }
    }

    function spawnTelegraph(x, z, radius, delay, color) {
      var slot = null;
      for (var i = 0; i < telegraphFxPool.length; i++) {
        if (!telegraphFxPool[i].active) { slot = telegraphFxPool[i]; break; }
      }
      if (!slot) return null;
      slot.active = true;
      slot.x = x;
      slot.z = z;
      slot.radius = radius;
      slot.t = 0;
      slot.delay = delay;
      slot.group.visible = true;
      slot.group.position.set(x, 0, z);
      slot.groundMat.color.setHex(color);
      slot.ringMat.color.setHex(color);
      slot.columnMat.color.setHex(color);
      slot.ground.scale.set(radius, 1, radius);
      slot.ring.scale.set(radius * 0.84, 1, radius * 0.84);
      telegraphs.push(slot);
      return slot;
    }

    function updateTelegraphs(dt) {
      for (var i = telegraphs.length - 1; i >= 0; i--) {
        var t = telegraphs[i];
        t.t += dt;
        var pulse = 0.5 + 0.5 * Math.sin(t.t * 16);
        t.groundMat.opacity = 0.18 + 0.24 * pulse;
        t.ringMat.opacity = 0.35 + 0.3 * pulse;
        t.columnMat.opacity = 0.05 + 0.09 * pulse;
        var s = t.radius * (0.96 + Math.sin(t.t * 16) * 0.03);
        t.ground.scale.set(s, 1, s);
        t.ring.scale.set(s * 0.84, 1, s * 0.84);
        t.column.scale.set(0.09 + pulse * 0.03, 4.0, 0.09 + pulse * 0.03);
        if (t.t >= t.delay) {
          t.active = false;
          t.group.visible = false;
          telegraphs.splice(i, 1);
        }
      }
    }

    /* -------------------------------------------------------------- tracers */

    function buildTracerPool() {
      for (var i = 0; i < MAX.tracers; i++) {
        var group = new THREE.Group();
        var coreMat = fxAdditive(0xffffff, 0.95);
        var midMat = fxAdditive(0xffffff, 0.6);
        var haloMat = fxAdditive(0xffffff, 0.2);
        var tipMat = fxAdditive(0xffffff, 0.9);
        var core = new THREE.Mesh(G.box, coreMat);
        var mid = new THREE.Mesh(G.box, midMat);
        var halo = new THREE.Mesh(G.box, haloMat);
        var tip = new THREE.Mesh(G.lowSphere, tipMat);
        core.renderOrder = 953;
        mid.renderOrder = 952;
        halo.renderOrder = 951;
        tip.renderOrder = 954;
        group.add(core);
        group.add(mid);
        group.add(halo);
        group.add(tip);
        group.visible = false;
        scene.add(group);
        tracerFxPool.push({
          group: group,
          core: core,
          mid: mid,
          halo: halo,
          tip: tip,
          coreMat: coreMat,
          midMat: midMat,
          haloMat: haloMat,
          tipMat: tipMat,
          alive: false,
          ttl: 0,
          max: 0.09
        });
      }
    }

    function spawnTracer(from, to, color) {
      var slot = null;
      for (var i = 0; i < tracerFxPool.length; i++) {
        if (!tracerFxPool[i].alive) { slot = tracerFxPool[i]; break; }
      }
      if (!slot) return;
      fxTmpVec.copy(to).sub(from);
      var len = fxTmpVec.length();
      if (len < 0.02) return;
      fxTmpVec.multiplyScalar(1 / len);
      slot.alive = true;
      slot.ttl = slot.max = 0.09;
      slot.coreMat.color.setHex(0xffffff);
      slot.midMat.color.setHex(color);
      slot.haloMat.color.setHex(color);
      slot.tipMat.color.setHex(0xffffff);
      slot.coreMat.opacity = 0.95;
      slot.midMat.opacity = 0.6;
      slot.haloMat.opacity = 0.2;
      slot.tipMat.opacity = 0.9;
      slot.group.visible = true;
      slot.group.position.copy(from).addScaledVector(fxTmpVec, len * 0.5);
      slot.group.quaternion.setFromUnitVectors(ZAXIS, fxTmpVec);
      slot.core.scale.set(0.014, 0.014, len);
      slot.mid.scale.set(0.05, 0.05, len);
      slot.halo.scale.set(0.15, 0.15, len);
      slot.tip.position.z = len * 0.5;
      slot.tip.scale.setScalar(0.11);
    }

    function updateTracers(dt) {
      for (var i = 0; i < tracerFxPool.length; i++) {
        var t = tracerFxPool[i];
        if (!t.alive) continue;
        t.ttl -= dt;
        if (t.ttl <= 0) {
          t.alive = false;
          t.group.visible = false;
          continue;
        }
        var k = t.ttl / t.max;
        var expand = 1 + (1 - k) * 2.6;
        t.coreMat.opacity = k * 0.95;
        t.midMat.opacity = k * 0.6;
        t.haloMat.opacity = k * 0.22;
        t.tipMat.opacity = k * 0.9;
        t.core.scale.x = 0.014 * expand;
        t.core.scale.y = 0.014 * expand;
        t.mid.scale.x = 0.05 * expand;
        t.mid.scale.y = 0.05 * expand;
        t.halo.scale.x = 0.15 * expand;
        t.halo.scale.y = 0.15 * expand;
        t.tip.scale.setScalar(0.11 + (1 - k) * 0.1);
      }
    }

    /* --------------------------------------------------------------- bullets */

    function buildBulletFxPool() {
      for (var i = 0; i < MAX.bullets; i++) {
        var group = new THREE.Group();
        var coreMat = fxAdditive(0xffffff, 0.95);
        var haloMat = fxAdditive(0xffffff, 0.28);
        var core = new THREE.Mesh(G.lowSphere, coreMat);
        var halo = new THREE.Mesh(G.lowSphere, haloMat);
        core.renderOrder = 953;
        halo.renderOrder = 952;
        group.add(core);
        group.add(halo);
        group.visible = false;
        scene.add(group);
        bulletFxPool.push({
          group: group,
          core: core,
          halo: halo,
          coreMat: coreMat,
          haloMat: haloMat,
          owner: null,
          radius: 0.2,
          phase: arand(0, Math.PI * 2)
        });
      }
    }

    function acquireBulletFx(color, radius) {
      for (var i = 0; i < bulletFxPool.length; i++) {
        var slot = bulletFxPool[i];
        if (slot.owner) continue;
        slot.owner = true;
        slot.radius = radius;
        slot.group.visible = true;
        slot.haloMat.color.setHex(color);
        slot.haloMat.opacity = 0.28;
        slot.core.scale.setScalar(radius * 1.05);
        slot.halo.scale.setScalar(radius * 2.5);
        return slot;
      }
      return null;
    }

    function releaseBulletFx(slot) {
      if (!slot) return;
      slot.owner = null;
      slot.group.visible = false;
    }

    function buildBulletTrailPool() {
      for (var i = 0; i < BULLET_TRAIL_LIMIT; i++) {
        var mat = fxAdditive(0xffffff, 0.5);
        var mesh = new THREE.Mesh(G.box, mat);
        mesh.visible = false;
        mesh.renderOrder = 950;
        scene.add(mesh);
        bulletTrailPool.push({
          mesh: mesh,
          mat: mat,
          owner: null,
          ttl: 0,
          max: 0.16
        });
      }
    }

    function acquireBulletTrail(color, width) {
      var i, slot = null;
      for (i = 0; i < bulletTrailPool.length; i++) {
        if (!bulletTrailPool[i].owner && bulletTrailPool[i].ttl <= 0) {
          slot = bulletTrailPool[i];
          break;
        }
      }
      if (!slot) return null;
      slot.owner = true;
      slot.ttl = slot.max = 0.16;
      slot.mesh.visible = true;
      slot.mat.color.setHex(color);
      slot.mat.opacity = 0.5;
      slot.mesh.scale.set(width, width, 1);
      return slot;
    }

    function releaseBulletTrail(slot) {
      if (!slot) return;
      slot.owner = null;
      slot.ttl = slot.max = 0.16;
    }

    function updateBulletTrails(dt) {
      for (var i = 0; i < bulletTrailPool.length; i++) {
        var t = bulletTrailPool[i];
        if (t.owner) continue;
        if (t.ttl <= 0) {
          if (t.mesh.visible) t.mesh.visible = false;
          continue;
        }
        t.ttl -= dt;
        if (t.ttl <= 0) {
          t.mesh.visible = false;
          continue;
        }
        t.mat.opacity = (t.ttl / t.max) * 0.5;
      }
    }

    /* -------------------------------------------------------------- deflects */

    function buildDeflectFxPool() {
      for (var i = 0; i < MAX.deflects; i++) {
        var group = new THREE.Group();
        var coreMat = fxAdditive(0xffffff, 0.95);
        var haloMat = fxAdditive(C.cyan, 0.3);
        var core = new THREE.Mesh(G.lowSphere, coreMat);
        var halo = new THREE.Mesh(G.lowSphere, haloMat);
        core.renderOrder = 953;
        halo.renderOrder = 952;
        core.scale.setScalar(0.11);
        halo.scale.setScalar(0.26);
        group.add(core);
        group.add(halo);
        group.visible = false;
        scene.add(group);
        deflectFxPool.push({
          group: group,
          core: core,
          halo: halo,
          coreMat: coreMat,
          haloMat: haloMat,
          owner: null,
          phase: arand(0, Math.PI * 2)
        });
      }
    }

    function acquireDeflectFx() {
      for (var i = 0; i < deflectFxPool.length; i++) {
        if (!deflectFxPool[i].owner) {
          deflectFxPool[i].owner = true;
          deflectFxPool[i].group.visible = true;
          return deflectFxPool[i];
        }
      }
      return null;
    }

    function releaseDeflectFx(slot) {
      if (!slot) return;
      slot.owner = null;
      slot.group.visible = false;
    }

    /* --------------------------------------------------------------- missiles */

    function buildMissileFxPool() {
      for (var i = 0; i < MAX.missiles; i++) {
        var group = new THREE.Group();
        var coreMat = fxAdditive(0xffe6b0, 0.95);
        var haloMat = fxAdditive(C.amber, 0.3);
        var glowMat = fxAdditive(0xffd68a, 0.4);
        var core = new THREE.Mesh(G.cone, coreMat);
        var halo = new THREE.Mesh(G.cone, haloMat);
        var glow = new THREE.Mesh(G.lowSphere, glowMat);
        core.scale.set(0.22, 0.55, 0.22);
        halo.scale.set(0.46, 0.72, 0.46);
        glow.scale.setScalar(0.3);
        core.renderOrder = 953;
        halo.renderOrder = 952;
        glow.renderOrder = 951;
        group.add(core);
        group.add(halo);
        group.add(glow);
        group.visible = false;
        scene.add(group);
        missileFxPool.push({
          group: group,
          core: core,
          halo: halo,
          glow: glow,
          coreMat: coreMat,
          haloMat: haloMat,
          glowMat: glowMat,
          owner: null,
          phase: arand(0, Math.PI * 2)
        });
      }
    }

    function acquireMissileFx() {
      for (var i = 0; i < missileFxPool.length; i++) {
        if (!missileFxPool[i].owner) {
          missileFxPool[i].owner = true;
          missileFxPool[i].group.visible = true;
          return missileFxPool[i];
        }
      }
      return null;
    }

    function releaseMissileFx(slot) {
      if (!slot) return;
      slot.owner = null;
      slot.group.visible = false;
    }

    function muzzleWorldPos(target) {
      muzzle.getWorldPosition(target);
      return target;
    }

    var screenFlashToken = 0;

    function flashScreen(hex, strong) {
      if (!ui.screenFlash) return;
      var s = (hex === undefined ? 0x57f2ff : hex).toString(16);
      while (s.length < 6) s = '0' + s;
      ui.screenFlash.style.setProperty('--flash-color', '#' + s);
      ui.screenFlash.classList.toggle('is-hard', !!strong);
      ui.screenFlash.classList.add('on');
      var token = ++screenFlashToken;
      setTimeout(function () {
        if (token !== screenFlashToken) return;
        ui.screenFlash.classList.remove('on', 'is-hard');
      }, strong ? 110 : 70);
    }

    function registerHit(kill) {
      ui.hitmarker.classList.remove('show', 'kill');
      // force animation restart
      void ui.hitmarker.offsetWidth;
      ui.hitmarker.classList.add('show');
      if (kill) ui.hitmarker.classList.add('kill');
    }

    /* --------------------------------------------------------------- damage */

    function damagePlayer(amount) {
      if (mode !== 'playing') return;
      if (player.invuln > 0 || player.dashT > 0) return;
      player.hp -= amount;
      player.lastHit = gameTime;
      player.flashT = Math.min(1, player.flashT + 0.55 + amount * 0.012);
      player.shake = Math.max(player.shake, 0.18 + Math.min(0.5, amount * 0.02));
      if (player.hp <= 0) {
        player.hp = 0;
        failRun();
      }
    }

    function clearBullets() {
      for (var i = 0; i < bullets.length; i++) {
        releaseBulletFx(bullets[i].fx);
        releaseBulletTrail(bullets[i].trail);
      }
      bullets.length = 0;
    }

    function pointInColliders(p) {
      for (var i = 0; i < colliders.length; i++) {
        var c = colliders[i];
        if (p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.y0 && p.y < c.y1) {
          return true;
        }
      }
      return false;
    }

    /* --------------------------------------------------------------- combat */

    function rotateYDir(dir, angle) {
      var c = Math.cos(angle), s = Math.sin(angle);
      return new THREE.Vector3(dir.x * c + dir.z * s, dir.y, -dir.x * s + dir.z * c);
    }

    function traceShot(origin, dir, range, dmg, color) {
      var best = range;
      var hitEnemy = null;
      var hitBoss = false;
      var hitMissile = null;

      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.dead) continue;
        var te = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, e.pos, e.radius + 0.04);
        if (te > 0 && te < best) {
          best = te; hitEnemy = e; hitBoss = false; hitMissile = null;
        }
      }
      if (boss && boss.alive) {
        var tb = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, boss.pos, 1.6);
        if (tb > 0 && tb < best) {
          best = tb; hitBoss = true; hitEnemy = null; hitMissile = null;
        }
      }
      for (var m = 0; m < missiles.length; m++) {
        var tm = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, missiles[m].pos, 0.34);
        if (tm > 0 && tm < best) {
          best = tm; hitMissile = missiles[m]; hitEnemy = null; hitBoss = false;
        }
      }

      var wallT = wallHitDistance(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
      if (wallT < best) {
        best = wallT;
        hitEnemy = null;
        hitBoss = false;
        hitMissile = null;
      }

      var point = new THREE.Vector3().copy(origin).addScaledVector(dir, best);
      var hit = false;

      if (hitEnemy) {
        var wasAlive = !hitEnemy.dead;
        damageEnemy(hitEnemy, dmg, color, point);
        spawnImpactFx(point, color, 1.25);
        hit = true;
        if (wasAlive) registerHit(hitEnemy.dead);
      } else if (hitBoss) {
        damageBoss(dmg, color, point);
        spawnImpactFx(point, color, 1.5);
        registerHit(false);
        hit = true;
      } else if (hitMissile) {
        var mi = missiles.indexOf(hitMissile);
        if (mi >= 0) killMissileAt(mi);
        spawnImpactFx(point, C.amber, 1.2);
        registerHit(false);
        hit = true;
      } else {
        spawnParticles(point, 0xb9d4e4, 3, 2.2, 0.22, 0.035);
        spawnSparks(point, 0xc9e6f2, 4, 3.0, 0.9);
      }

      return { point: point, dist: best, hit: hit };
    }

    function fireWeapon() {
      if (mode !== 'playing') return;
      var w = currentGun();
      var d = w.def;
      if (w.reloading > 0 || w.cool > 0) return;

      if (!d.melee && w.mag <= 0) {
        w.cool = 0.2;
        if (gameTime - lastDryToast > 1.4) {
          lastDryToast = gameTime;
          addToast('弹匣已空 // 按 R 换弹', 'warn');
        }
        return;
      }

      if (d.melee) {
        meleeStrike();
        w.cool = d.interval;
        player.recoil = Math.max(player.recoil, 0.75);
        return;
      }

      w.mag--;
      w.cool = d.interval;

      player.recoil = Math.min(1, player.recoil + (d.id === 'scatter' ? 0.85 : 0.32));
      player.shake = Math.max(player.shake, d.id === 'scatter' ? 0.3 : 0.1);
      muzzleT = 0.06;

      var origin = new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z);
      var baseDir = forwardVec(new THREE.Vector3());
      var tracerFrom = muzzleWorldPos(new THREE.Vector3());

      for (var p = 0; p < d.pellets; p++) {
        var dir = baseDir.clone();
        dir.x += rnd(-d.spread, d.spread);
        dir.y += rnd(-d.spread, d.spread);
        dir.z += rnd(-d.spread, d.spread);
        dir.normalize();
        var result = traceShot(origin, dir, d.range, d.dmg, d.color);
        spawnTracer(tracerFrom, result.point, d.color);
      }

      if (d.id === 'scatter') {
        spawnParticles(tracerFrom, C.magenta, 4, 3, 0.18, 0.04);
      }
      spawnSparks(tracerFrom, d.color, 3, 2.8, 0.9);
    }

    function meleeStrike() {
      var def = currentGun().def;
      var fwd = flatForward(new THREE.Vector3());
      var origin = player.pos.clone();
      var hitAnything = false;

      for (var i = enemies.length - 1; i >= 0; i--) {
        var e = enemies[i];
        if (e.dead) continue;
        var to = new THREE.Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
        var dist = to.length();
        if (dist < def.range + e.radius && dist > 0.001) {
          to.multiplyScalar(1 / dist);
          if (to.dot(fwd) > def.arc) {
            damageEnemy(e, def.dmg, C.violet, e.pos);
            e.knock.addScaledVector(fwd, 9);
            hitAnything = true;
          }
        }
      }

      if (boss && boss.alive) {
        var bto = new THREE.Vector3(boss.pos.x - origin.x, 0, boss.pos.z - origin.z);
        var bdist = bto.length();
        if (bdist < 4.2 && bdist > 0.001) {
          bto.multiplyScalar(1 / bdist);
          if (bto.dot(fwd) > 0.3) {
            damageBoss(42, C.violet, boss.pos);
            hitAnything = true;
          }
        }
      }

      for (var mi = missiles.length - 1; mi >= 0; mi--) {
        var m = missiles[mi];
        if (m.pos.distanceTo(origin) < 3.6) {
          killMissileAt(mi);
          hitAnything = true;
        }
      }

      // Clear / deflect nearby hostile projectiles.
      var deflected = 0;
      for (var bi = bullets.length - 1; bi >= 0; bi--) {
        var b = bullets[bi];
        var bbt = new THREE.Vector3(b.pos.x - origin.x, 0, b.pos.z - origin.z);
        var bd = bbt.length();
        if (bd < 3.8 && bd > 0.001) {
          bbt.multiplyScalar(1 / bd);
          if (bbt.dot(fwd) > 0.05) {
            if (deflected < 3) {
              deflected++;
              spawnDeflect(b.pos.clone(), rotateYDir(fwd, rnd(-0.1, 0.1)));
            }
            spawnParticles(b.pos, C.violet, 3, 3.5, 0.25, 0.04);
            removeBulletAt(bi);
            hitAnything = true;
          }
        }
      }

      var slashPos = origin.clone().addScaledVector(fwd, 1.5);
      slashPos.y = 1.25;
      spawnRingFx(slashPos, 2.4, C.violet, 0.24, 1.2);
      spawnParticles(slashPos, C.violet, 8, 5, 0.25, 0.04);

      if (hitAnything) registerHit(false);
      player.shake = Math.max(player.shake, 0.2);
    }

    function startReload() {
      if (mode !== 'playing') return;
      var w = currentGun();
      var d = w.def;
      if (d.melee || w.reloading > 0 || w.mag >= d.magSize || w.reserve <= 0) return;
      w.reloading = d.reloadTime;
    }

    function switchWeapon(index) {
      if (mode !== 'playing') return;
      if (index < 0 || index >= weapons.length || index === currentWeapon) return;
      weapons[currentWeapon].reloading = 0;
      currentWeapon = index;
      muzzleT = 0;
      muzzleFlash.visible = false;
      player.recoil = 0.5;
      syncWeaponVisuals();
      updateHud();
    }

    function updateWeapons(dt) {
      var w = currentGun();
      if (w.cool > 0) w.cool = Math.max(0, w.cool - dt);

      if (w.reloading > 0) {
        w.reloading -= dt;
        if (w.reloading <= 0) {
          w.reloading = 0;
          var need = w.def.magSize - w.mag;
          var take = Math.min(need, w.reserve);
          w.mag += take;
          w.reserve -= take;
        }
      }

      if (input.fireHeld) {
        if (w.def.auto) fireWeapon();
        else if (input.fireQueued) fireWeapon();
      }
      input.fireQueued = false;

      muzzleT = Math.max(0, muzzleT - dt);
      muzzleFlash.visible = muzzleT > 0;
      if (muzzleT > 0) {
        var s = 0.1 + Math.random() * 0.08;
        muzzleFlash.scale.set(s, s, s);
        muzzleFlash.rotation.z += dt * 22;
        muzzleHaloMat.opacity = 0.16 + Math.random() * 0.16;
        muzzleRingMat.opacity = 0.2 + Math.random() * 0.28;
      }

      updateViewmodel(dt);
    }

    /* ------------------------------------------------------------- abilities */

    function tryDash() {
      if (mode !== 'playing' || player.dashCd > 0) return;
      var f = (input.keys.KeyW ? 1 : 0) - (input.keys.KeyS ? 1 : 0);
      var s = (input.keys.KeyD ? 1 : 0) - (input.keys.KeyA ? 1 : 0);
      var dir = new THREE.Vector3();
      if (f !== 0 || s !== 0) {
        var fwd = flatForward(new THREE.Vector3());
        var right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
        dir.addScaledVector(fwd, f).addScaledVector(right, s).normalize();
      } else {
        flatForward(dir);
      }
      player.dashT = 0.16;
      player.dashCd = 3.0;
      player.invuln = Math.max(player.invuln, 0.36);
      player.dashDir.copy(dir);
      player.shake = Math.max(player.shake, 0.24);
      spawnRingFx(player.pos, 3.4, C.violet, 0.4, 1.0);
      spawnParticles(player.pos, C.violet, 10, 4.5, 0.3, 0.05);
    }

    function tryPulse() {
      if (mode !== 'playing' || player.pulseCd > 0) return;
      player.pulseCd = 8.0;
      spawnRingFx(player.pos, 6.2, C.cyan, 0.55, 0.9);
      spawnRingFx(player.pos, 4.4, C.magenta, 0.42, 1.35);
      spawnParticles(player.pos, C.cyan, 28, 9, 0.6, 0.07);
      flashScreen();
      player.shake = Math.max(player.shake, 0.45);

      for (var i = bullets.length - 1; i >= 0; i--) {
        if (bullets[i].pos.distanceTo(player.pos) <= 6) {
          spawnParticles(bullets[i].pos, C.cyan, 2, 2, 0.22, 0.035);
          removeBulletAt(i);
        }
      }

      for (var e = enemies.length - 1; e >= 0; e--) {
        var en = enemies[e];
        if (en.dead) continue;
        if (dist2D(en.pos, player.pos) <= 6) {
          damageEnemy(en, 35, C.cyan, en.pos);
          if (!en.dead) {
            en.slow = 2.5;
            var push = new THREE.Vector3(en.pos.x - player.pos.x, 0, en.pos.z - player.pos.z);
            if (push.lengthSq() > 0.001) {
              push.normalize();
              en.knock.addScaledVector(push, 6);
            }
          }
        }
      }

      for (var m = missiles.length - 1; m >= 0; m--) {
        if (missiles[m].pos.distanceTo(player.pos) <= 6) killMissileAt(m);
      }

      // Boss damage is deliberately capped at 12 so the pulse can never delete it.
      if (boss && boss.alive && boss.pos.distanceTo(player.pos) < 7.5) {
        damageBoss(12, C.cyan, boss.pos);
      }
      addToast('过载脉冲 // 范围清弹', 'good');
    }

    /* ---------------------------------------------------------------- player */

    function updatePlayer(dt) {
      player.dashCd = Math.max(0, player.dashCd - dt);
      player.pulseCd = Math.max(0, player.pulseCd - dt);
      player.invuln = Math.max(0, player.invuln - dt);
      player.recoil = Math.max(0, player.recoil - dt * 5.5);
      player.flashT = Math.max(0, player.flashT - dt * 2.2);
      ui.damage.style.opacity = (player.flashT * 0.9).toFixed(3);

      var f = (input.keys.KeyW ? 1 : 0) - (input.keys.KeyS ? 1 : 0);
      var s = (input.keys.KeyD ? 1 : 0) - (input.keys.KeyA ? 1 : 0);
      var sprint = !!(input.keys.ShiftLeft || input.keys.ShiftRight);
      var moving = f !== 0 || s !== 0;

      if (player.dashT > 0) {
        player.dashT -= dt;
        movePlayer(player.dashDir.x * 26 * dt, player.dashDir.z * 26 * dt);
        player.invuln = Math.max(player.invuln, 0.22);
        if (Math.random() < 0.85) spawnParticles(player.pos, C.violet, 2, 1.6, 0.22, 0.045);
      } else if (moving) {
        var speed = sprint ? 9.4 : 6.1;
        var fwd = flatForward(new THREE.Vector3());
        var right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
        var mv = new THREE.Vector3();
        mv.addScaledVector(fwd, f).addScaledVector(right, s);
        if (mv.lengthSq() > 0.0001) mv.normalize().multiplyScalar(speed);
        movePlayer(mv.x * dt, mv.z * dt);
      }

      player.bob += dt * (moving ? (sprint ? 12 : 8.5) : 2.2);
      var bobY = Math.sin(player.bob) * (moving ? 0.045 : 0.008);
      var bobX = Math.cos(player.bob * 0.5) * (moving ? 0.018 : 0.004);

      player.shake = Math.max(0, player.shake - dt * 2.0);
      var shx = (Math.random() * 2 - 1) * player.shake * 0.055;
      var shy = (Math.random() * 2 - 1) * player.shake * 0.055;

      camera.position.set(player.pos.x + bobX * 0.3 + shx, EYE + bobY + shy, player.pos.z);
      tmpEuler.set(player.pitch, player.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(tmpEuler);

      var targetFov = 74 + (sprint && moving ? 3.5 : 0) + (player.dashT > 0 ? 6 : 0);
      camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-dt * 9));
      camera.updateProjectionMatrix();

      var sway = Math.sin(player.bob * 0.5) * (moving ? 0.012 : 0.003);
      viewRoot.position.set(
        0.33 + sway,
        -0.27 + Math.abs(Math.sin(player.bob)) * (moving ? 0.01 : 0.0025) - player.recoil * 0.012,
        -0.66 + player.recoil * 0.055
      );
      viewRoot.rotation.set(player.recoil * 0.16, sway * 0.7, 0);

      if (player.hp < player.maxHp && gameTime - player.lastHit > 6.5) {
        player.hp = Math.min(player.maxHp, player.hp + 4.5 * dt);
      }
    }

    /* ----------------------------------------------------------- projectiles */


    function spawnBullet(pos, dir, speed, dmg, color, radius, homing) {
      if (bullets.length >= MAX.bullets) return null;
      var fx = acquireBulletFx(color, radius);
      if (!fx) return null;
      var b = {
        fx: fx,
        trail: acquireBulletTrail(color, radius * 1.7),
        pos: pos.clone(),
        vel: dir.clone().normalize().multiplyScalar(speed),
        speed: speed,
        dmg: dmg,
        radius: radius,
        ttl: 7,
        homing: homing || 0,
        color: color,
        trailT: 0.08
      };
      fx.group.position.copy(pos);
      if (b.trail) {
        fxTmpDir.copy(b.vel);
        if (fxTmpDir.lengthSq() > 1e-5) {
          fxTmpDir.normalize();
          b.trail.mesh.position.copy(pos).addScaledVector(fxTmpDir, -0.45);
          b.trail.mesh.quaternion.setFromUnitVectors(ZAXIS, fxTmpDir);
        }
      }
      bullets.push(b);
      return b;
    }

    function removeBulletAt(i) {
      var b = bullets[i];
      if (!b) return;
      releaseBulletFx(b.fx);
      releaseBulletTrail(b.trail);
      bullets.splice(i, 1);
    }

    function updateBullets(dt) {
      for (var i = bullets.length - 1; i >= 0; i--) {
        var b = bullets[i];
        b.ttl -= dt;
        if (b.ttl <= 0) { removeBulletAt(i); continue; }

        if (b.homing > 0) {
          fxTmpVec.copy(player.pos).sub(b.pos);
          fxTmpVec.y -= 0.05;
          if (fxTmpVec.lengthSq() > 0.0001) {
            fxTmpVec.normalize().multiplyScalar(b.speed);
            b.vel.lerp(fxTmpVec, Math.min(1, b.homing * dt));
          }
        }

        b.pos.addScaledVector(b.vel, dt);
        var pulse = 0.5 + 0.5 * Math.sin(gameTime * 18 + b.fx.phase);
        b.fx.group.position.copy(b.pos);
        b.fx.core.scale.setScalar(b.radius * (1.0 + pulse * 0.14));
        b.fx.halo.scale.setScalar(b.radius * (2.2 + pulse * 0.55));
        b.fx.haloMat.opacity = 0.18 + pulse * 0.18;

        if (b.trail) {
          fxTmpDir.copy(b.vel);
          if (fxTmpDir.lengthSq() > 1e-5) {
            var speedNow = fxTmpDir.length();
            fxTmpDir.multiplyScalar(1 / speedNow);
            var trailLen = clamp(0.55 + speedNow * 0.055, 0.7, 1.9);
            b.trail.mesh.position.copy(b.pos).addScaledVector(fxTmpDir, -trailLen * 0.5);
            b.trail.mesh.quaternion.setFromUnitVectors(ZAXIS, fxTmpDir);
            b.trail.mesh.scale.set(b.radius * 1.65, b.radius * 1.65, trailLen);
            b.trail.mat.opacity = 0.36 + pulse * 0.2;
          }
        }

        b.trailT -= dt;
        if (b.trailT <= 0) {
          b.trailT = 0.13;
          spawnParticles(b.pos, b.color, 1, 0.5, 0.2, 0.028);
        }

        if (b.pos.y < 0.05 || b.pos.y > 4.4 ||
          b.pos.x < ARENA.minX || b.pos.x > ARENA.maxX ||
          b.pos.z < ARENA.minZ || b.pos.z > ARENA.maxZ) {
          removeBulletAt(i);
          continue;
        }
        if (pointInColliders(b.pos)) {
          spawnParticles(b.pos, b.color, 3, 2.6, 0.24, 0.035);
          spawnSparks(b.pos, b.color, 5, 3.2, 1.0);
          spawnRingFx(b.pos, 0.55, b.color, 0.18, b.pos.y);
          removeBulletAt(i);
          continue;
        }
        if (b.pos.distanceTo(player.pos) < b.radius + 0.42) {
          if (player.invuln <= 0 && player.dashT <= 0) damagePlayer(b.dmg);
          spawnParticles(b.pos, b.color, 4, 3, 0.3, 0.04);
          spawnSparks(b.pos, b.color, 6, 4.2, 1.2);
          spawnRingFx(b.pos, 0.8, b.color, 0.2, b.pos.y);
          removeBulletAt(i);
          continue;
        }
      }
    }

    function spawnDeflect(pos, dir) {
      if (deflects.length >= MAX.deflects) return;
      var fx = acquireDeflectFx();
      if (!fx) return;
      fx.group.position.copy(pos);
      deflects.push({
        fx: fx,
        pos: pos.clone(),
        vel: dir.clone().normalize().multiplyScalar(26),
        ttl: 1.2,
        dmg: 14
      });
    }

    function updateDeflects(dt) {
      for (var i = deflects.length - 1; i >= 0; i--) {
        var d = deflects[i];
        d.ttl -= dt;
        if (d.ttl <= 0) {
          releaseDeflectFx(d.fx);
          deflects.splice(i, 1);
          continue;
        }
        d.pos.addScaledVector(d.vel, dt);
        var pulse = 0.5 + 0.5 * Math.sin(gameTime * 20 + d.fx.phase);
        d.fx.group.position.copy(d.pos);
        d.fx.core.scale.setScalar(0.1 + pulse * 0.035);
        d.fx.halo.scale.setScalar(0.24 + pulse * 0.09);
        d.fx.haloMat.opacity = 0.2 + pulse * 0.16;

        if (Math.random() < 0.4) spawnParticles(d.pos, C.cyan, 1, 0.6, 0.18, 0.025);

        var hit = false;
        for (var e = 0; e < enemies.length; e++) {
          if (!enemies[e].dead && d.pos.distanceTo(enemies[e].pos) < enemies[e].radius + 0.12) {
            damageEnemy(enemies[e], d.dmg, C.cyan, d.pos);
            hit = true;
            break;
          }
        }
        if (!hit && boss && boss.alive && d.pos.distanceTo(boss.pos) < 1.65) {
          damageBoss(d.dmg, C.cyan, d.pos);
          hit = true;
        }
        if (!hit) {
          for (var m = 0; m < missiles.length; m++) {
            if (d.pos.distanceTo(missiles[m].pos) < 0.4) {
              killMissileAt(m);
              hit = true;
              break;
            }
          }
        }
        if (!hit && (d.pos.y < 0.05 || pointInColliders(d.pos) ||
          d.pos.x < ARENA.minX || d.pos.x > ARENA.maxX ||
          d.pos.z < ARENA.minZ || d.pos.z > ARENA.maxZ)) {
          hit = true;
        }
        if (hit) {
          spawnParticles(d.pos, C.cyan, 3, 3, 0.24, 0.035);
          spawnSparks(d.pos, C.cyan, 5, 3.5, 1.0);
          releaseDeflectFx(d.fx);
          deflects.splice(i, 1);
        }
      }
    }

    /* -------------------------------------------------------------- missiles */

    function spawnMissile(pos, dir, speed, turn, ttl, dmg) {
      if (missiles.length >= MAX.missiles) return null;
      var fx = acquireMissileFx();
      if (!fx) return null;
      fx.group.position.copy(pos);
      fx.group.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
      var m = {
        fx: fx,
        pos: pos.clone(),
        vel: dir.clone().normalize().multiplyScalar(speed),
        speed: speed,
        turn: turn,
        ttl: ttl,
        dmg: dmg,
        trailT: 0
      };
      missiles.push(m);
      return m;
    }

    function killMissileAt(i) {
      var m = missiles[i];
      if (!m) return;
      spawnParticles(m.pos, C.amber, 12, 6, 0.42, 0.055);
      spawnSparks(m.pos, C.amber, 8, 5.5, 1.3);
      spawnRingFx(m.pos, 2.0, C.amber, 0.3, m.pos.y);
      releaseMissileFx(m.fx);
      missiles.splice(i, 1);
    }

    function updateMissiles(dt) {
      for (var i = missiles.length - 1; i >= 0; i--) {
        var m = missiles[i];
        m.ttl -= dt;
        if (m.ttl <= 0) { killMissileAt(i); continue; }

        fxTmpVec.copy(player.pos).sub(m.pos);
        if (fxTmpVec.lengthSq() > 0.001) {
          fxTmpVec.normalize().multiplyScalar(m.speed);
          m.vel.lerp(fxTmpVec, Math.min(1, m.turn * dt));
        }
        m.pos.addScaledVector(m.vel, dt);
        m.fx.group.position.copy(m.pos);
        fxTmpDir.copy(m.vel);
        if (fxTmpDir.lengthSq() > 1e-5) {
          fxTmpDir.normalize();
          m.fx.group.quaternion.setFromUnitVectors(UP, fxTmpDir);
        }
        var pulse = 0.5 + 0.5 * Math.sin(gameTime * 22 + m.fx.phase);
        m.fx.core.scale.set(0.22 + pulse * 0.035, 0.55, 0.22 + pulse * 0.035);
        m.fx.halo.scale.set(0.46 + pulse * 0.08, 0.72, 0.46 + pulse * 0.08);
        m.fx.glow.scale.setScalar(0.28 + pulse * 0.1);
        m.fx.glowMat.opacity = 0.3 + pulse * 0.22;

        m.trailT -= dt;
        if (m.trailT <= 0) {
          m.trailT = 0.05;
          spawnParticles(m.pos, C.amber, 1, 0.8, 0.3, 0.04);
        }

        if (pointInColliders(m.pos) || m.pos.y < 0.1 ||
          m.pos.x < ARENA.minX || m.pos.x > ARENA.maxX ||
          m.pos.z < ARENA.minZ || m.pos.z > ARENA.maxZ) {
          killMissileAt(i);
          continue;
        }
        if (m.pos.distanceTo(player.pos) < 0.65) {
          damagePlayer(m.dmg);
          killMissileAt(i);
        }
      }
    }

    /* --------------------------------------------------------------- enemies */

    function buildSentinelMesh() {
      var group = new THREE.Group();
      var shellMat = matLambert(0x18243a, { emissive: 0x091524 });
      var coreMat = matBasic(C.magenta);
      var ringMat = matBasic(C.cyanDim, { transparent: true, opacity: 0.9 });
      var glowMat = matBasic(C.magenta, {
        transparent: true, opacity: 0.16, blending: 'additive',
        depthWrite: false, fog: false
      });

      var glow = new THREE.Mesh(G.lowSphere, glowMat);
      glow.scale.setScalar(0.62);
      group.add(glow);

      var core = new THREE.Mesh(G.sphere, coreMat);
      core.scale.setScalar(0.34);
      group.add(core);

      var eye = new THREE.Mesh(G.box, matBasic(0xffd9f2));
      eye.position.set(0, 0, 0.34);
      eye.scale.set(0.16, 0.06, 0.05);
      group.add(eye);

      for (var s = -1; s <= 1; s += 2) {
        var shell = new THREE.Mesh(G.box, shellMat);
        shell.position.set(s * 0.44, 0.02, 0);
        shell.rotation.z = s * 0.42;
        shell.scale.set(0.46, 0.14, 0.62);
        group.add(shell);
        var fin = new THREE.Mesh(G.box, shellMat);
        fin.position.set(s * 0.58, 0.18, -0.1);
        fin.rotation.z = s * 0.6;
        fin.scale.set(0.2, 0.06, 0.3);
        group.add(fin);
      }

      var ring = new THREE.Mesh(G.torus, ringMat);
      ring.rotation.x = 0.42;
      ring.scale.set(0.66, 0.66, 0.66);
      group.add(ring);

      return {
        group: group,
        coreMat: coreMat,
        ringMat: ringMat,
        ring: ring,
        glowMat: glowMat,
        glow: glow,
        glowBase: { x: 0.62, y: 0.62, z: 0.62 }
      };
    }

    function buildTurretMesh() {
      var group = new THREE.Group();
      var mountMat = matLambert(0x1b2740, { emissive: 0x070d18 });
      var glowMat = matBasic(C.amber);
      var auraMat = matBasic(C.amber, {
        transparent: true, opacity: 0.14, blending: 'additive',
        depthWrite: false, fog: false
      });

      var aura = new THREE.Mesh(G.lowSphere, auraMat);
      aura.position.set(0, 0, 0.16);
      aura.scale.set(0.9, 0.62, 0.82);
      group.add(aura);

      var back = new THREE.Mesh(G.box, mountMat);
      back.position.set(0, 0, -0.32);
      back.scale.set(0.9, 0.9, 0.36);
      group.add(back);

      var head = new THREE.Group();
      var housing = new THREE.Mesh(G.box, mountMat);
      housing.scale.set(0.62, 0.4, 0.5);
      head.add(housing);
      var barrel = new THREE.Mesh(G.box, matBasic(0x9db4ca));
      barrel.position.set(0, 0, 0.5);
      barrel.scale.set(0.14, 0.14, 0.8);
      head.add(barrel);
      var muzzleGlow = new THREE.Mesh(G.box, glowMat);
      muzzleGlow.position.set(0, 0, 0.92);
      muzzleGlow.scale.set(0.2, 0.2, 0.08);
      head.add(muzzleGlow);
      var halo = new THREE.Mesh(G.torus, glowMat);
      halo.rotation.x = Math.PI / 2;
      halo.scale.set(0.42, 0.42, 0.42);
      halo.position.set(0, -0.24, 0.05);
      head.add(halo);
      group.add(head);

      return {
        group: group,
        head: head,
        coreMat: glowMat,
        auraMat: auraMat,
        aura: aura,
        auraBase: { x: 0.9, y: 0.62, z: 0.82 }
      };
    }

    function spawnSentinel(x, z) {
      var built = buildSentinelMesh();
      var e = {
        type: 'sentinel',
        group: built.group,
        coreMat: built.coreMat,
        ringMat: built.ringMat,
        ring: built.ring,
        glowMat: built.glowMat,
        glow: built.glow,
        glowBase: built.glowBase,
        shadow: null,
        pos: new THREE.Vector3(x, 1.55, z),
        hp: 46,
        maxHp: 46,
        radius: 0.62,
        speed: 3.1,
        fireCd: rnd(1.2, 2.4),
        bobPhase: rnd(0, Math.PI * 2),
        slow: 0,
        flash: 0,
        dead: false,
        knock: new THREE.Vector3()
      };
      e.group.position.copy(e.pos);
      scene.add(e.group);
      e.shadow = acquireContactShadow(e, 1.08, 0.27);
      enemies.push(e);
      spawnRingFx(e.pos, 2.2, C.magenta, 0.45, 0.1);
      spawnParticles(e.pos, C.magenta, 10, 5, 0.4, 0.05);
      return e;
    }

    function spawnTurret(x, z) {
      var built = buildTurretMesh();
      var e = {
        type: 'turret',
        group: built.group,
        head: built.head,
        coreMat: built.coreMat,
        ringMat: built.coreMat,
        ring: null,
        auraMat: built.auraMat,
        aura: built.aura,
        auraBase: built.auraBase,
        shadow: null,
        pos: new THREE.Vector3(x, 2.15, z),
        hp: 80,
        maxHp: 80,
        radius: 0.8,
        speed: 0,
        fireCd: rnd(1.2, 2.0),
        burst: 0,
        burstT: 0,
        bobPhase: 0,
        slow: 0,
        flash: 0,
        dead: false,
        knock: new THREE.Vector3()
      };
      e.group.position.copy(e.pos);
      scene.add(e.group);
      e.shadow = acquireContactShadow(e, 1.22, 0.23);
      enemies.push(e);
      spawnRingFx(e.pos, 2.0, C.amber, 0.4, e.pos.y);
      spawnParticles(e.pos, C.amber, 8, 4, 0.35, 0.045);
      return e;
    }

    function damageEnemy(e, dmg, color, point) {
      if (!e || e.dead) return;
      e.hp -= dmg;
      e.flash = 0.09;
      spawnParticles(point || e.pos, color || C.cyan, 4, 3.2, 0.28, 0.045);
      if (e.hp <= 0) killEnemy(e);
    }

    function killEnemy(e) {
      if (!e || e.dead) return;
      e.dead = true;
      kills++;
      releaseContactShadow(e.shadow);
      spawnParticles(e.pos, e.type === 'turret' ? C.amber : C.magenta, 22, 7.5, 0.55, 0.07);
      spawnRingFx(e.pos, 2.6, e.type === 'turret' ? C.amber : C.magenta, 0.45, Math.max(0.1, e.pos.y - 0.5));
      if (e.group.parent) scene.remove(e.group);
      var idx = enemies.indexOf(e);
      if (idx >= 0) enemies.splice(idx, 1);
      registerHit(true);
      player.shake = Math.max(player.shake, 0.14);
      if (Math.random() < 0.3) addToast('宿主清除 // +1', 'good');
    }

    function clearEnemies() {
      for (var i = 0; i < enemies.length; i++) {
        releaseContactShadow(enemies[i].shadow);
        if (enemies[i].group && enemies[i].group.parent) scene.remove(enemies[i].group);
      }
      enemies.length = 0;
    }

    function updateSentinel(e, dt, slowF) {
      var dx = player.pos.x - e.pos.x;
      var dz = player.pos.z - e.pos.z;
      var range = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= range;
      dz /= range;

      var radial = range > 11.5 ? 1 : (range < 6.5 ? -1 : 0);
      var strafe = Math.sin(gameTime * 0.9 + e.bobPhase) * 0.95;
      var vx = (dx * radial - dz * strafe) * e.speed * slowF;
      var vz = (dz * radial + dx * strafe) * e.speed * slowF;

      e.pos.x += vx * dt;
      e.pos.z += vz * dt;
      resolveCircle(e.pos, e.radius);

      e.group.rotation.y = Math.atan2(dx, dz);

      e.fireCd -= dt * slowF;
      if (e.fireCd <= 0 && range < 30) {
        var from = new THREE.Vector3(e.pos.x, e.pos.y + 0.08, e.pos.z);
        if (hasLineOfSight(from, player.pos)) {
          e.fireCd = rnd(1.7, 2.5);
          var dir = new THREE.Vector3(
            player.pos.x - from.x,
            player.pos.y - 0.08 - from.y,
            player.pos.z - from.z
          ).normalize();
          dir.x += rnd(-0.022, 0.022);
          dir.y += rnd(-0.018, 0.018);
          dir.z += rnd(-0.022, 0.022);
          spawnBullet(from, dir.normalize(), 10.5, 8, C.magenta, 0.19, 0);
          spawnParticles(from, C.magenta, 3, 2.4, 0.22, 0.04);
        } else {
          e.fireCd = 0.55;
        }
      }
    }

    function updateTurret(e, dt, slowF) {
      var dx = player.pos.x - e.pos.x;
      var dz = player.pos.z - e.pos.z;
      var range = Math.sqrt(dx * dx + dz * dz) || 1;
      e.head.rotation.y = Math.atan2(dx, dz);

      if (e.burst > 0) {
        e.burstT -= dt * slowF;
        if (e.burstT <= 0) {
          e.burstT = 0.14;
          e.burst--;
          var from = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
          var dir = new THREE.Vector3(
            player.pos.x - from.x,
            player.pos.y - 0.1 - from.y,
            player.pos.z - from.z
          ).normalize();
          dir.x += rnd(-0.03, 0.03);
          dir.z += rnd(-0.03, 0.03);
          spawnBullet(from, dir.normalize(), 13, 7, C.amber, 0.16, 0);
          spawnParticles(from, C.amber, 2, 2, 0.2, 0.035);
        }
      } else {
        e.fireCd -= dt * slowF;
        if (e.fireCd <= 0 && range < 36) {
          var from2 = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
          if (hasLineOfSight(from2, player.pos)) {
            e.burst = 3;
            e.burstT = 0;
            e.fireCd = 2.7 + Math.random() * 0.9;
          } else {
            e.fireCd = 0.8;
          }
        }
      }
    }

    function updateEnemies(dt) {
      for (var i = enemies.length - 1; i >= 0; i--) {
        var e = enemies[i];
        if (e.dead) { enemies.splice(i, 1); continue; }

        e.flash = Math.max(0, e.flash - dt);
        e.slow = Math.max(0, e.slow - dt);
        var slowF = e.slow > 0 ? 0.42 : 1;

        if (e.coreMat) {
          if (e.flash > 0) e.coreMat.color.setHex(0xffffff);
          else e.coreMat.color.setHex(e.type === 'turret' ? C.amber : C.magenta);
        }
        if (e.glowMat) {
          var glowPulse = 0.82 + 0.18 * Math.sin(worldClock * 5.2 + e.bobPhase);
          e.glowMat.opacity = (e.type === 'turret' ? 0.16 : 0.18) * glowPulse;
          e.glowMat.color.setHex(e.flash > 0 ? 0xffffff : (e.type === 'turret' ? C.amber : C.magenta));
          if (e.glow && e.glowBase) {
            e.glow.scale.set(
              e.glowBase.x * glowPulse,
              e.glowBase.y * glowPulse,
              e.glowBase.z * glowPulse
            );
          }
        }
        if (e.auraMat && e.aura && e.auraBase) {
          var auraPulse = 0.9 + 0.1 * Math.sin(worldClock * 4.1 + e.bobPhase);
          e.auraMat.opacity = 0.11 + 0.05 * (0.5 + 0.5 * Math.sin(worldClock * 6.3));
          e.auraMat.color.setHex(e.flash > 0 ? 0xffffff : C.amber);
          e.aura.scale.set(
            e.auraBase.x * auraPulse,
            e.auraBase.y * auraPulse,
            e.auraBase.z * auraPulse
          );
        }

        if (e.type === 'sentinel') updateSentinel(e, dt, slowF);
        else updateTurret(e, dt, slowF);

        if (e.knock.lengthSq() > 0.001) {
          e.pos.x += e.knock.x * dt;
          e.pos.z += e.knock.z * dt;
          e.knock.multiplyScalar(Math.max(0, 1 - 7 * dt));
          resolveCircle(e.pos, e.radius);
        }

        var bob = e.type === 'sentinel' ? Math.sin(gameTime * 1.8 + e.bobPhase) * 0.13 : 0;
        e.group.position.set(e.pos.x, e.pos.y + bob, e.pos.z);
        if (e.ring) e.ring.rotation.z += dt * 1.8;
      }
    }

    /* ------------------------------------------------------------------ boss */

    function buildBossMesh() {
      var group = new THREE.Group();

      var auraMat = matBasic(0xff4fb8, {
        transparent: true, opacity: 0.08, blending: 'additive',
        depthWrite: false, fog: false
      });
      var aura = new THREE.Mesh(G.lowSphere, auraMat);
      aura.scale.setScalar(1.62);
      group.add(aura);

      var auraCoreMat = matBasic(0xff8fd6, {
        transparent: true, opacity: 0.16, blending: 'additive',
        depthWrite: false, fog: false
      });
      var auraCore = new THREE.Mesh(G.lowSphere, auraCoreMat);
      auraCore.scale.setScalar(1.06);
      group.add(auraCore);

      var coreMat = matLambert(0x2a0a1e, {
        emissive: 0xff3a9a, specular: 0.62, roughness: 0.24
      });
      var core = new THREE.Mesh(G.sphere, coreMat);
      core.scale.setScalar(0.92);
      group.add(core);

      var eyeMat = matBasic(0xffe3f4);
      var eye = new THREE.Mesh(G.lowSphere, eyeMat);
      eye.scale.setScalar(0.34);
      eye.position.set(0, 0, 0.74);
      group.add(eye);

      var plateGeo = new THREE.BoxGeometry(1.8, 0.5, 0.82);
      plateGeo._owned = true;
      var plateMat = matLambert(0x1c2940, {
        emissive: 0x0b1424, specular: 0.55, roughness: 0.3
      });
      var plates = [];
      for (var i = 0; i < 3; i++) {
        var angle = i * Math.PI * 2 / 3;
        var plate = new THREE.Mesh(plateGeo, plateMat);
        plate.position.set(Math.cos(angle) * 1.15, 0, Math.sin(angle) * 1.15);
        plate.rotation.y = -angle + Math.PI / 2;
        group.add(plate);
        plates.push({ mesh: plate, angle: angle });
      }

      var ringMat = matBasic(0xff5fc8, {
        transparent: true, opacity: 0.9, blending: 'additive',
        depthWrite: false, fog: false
      });
      var ringGeo = new THREE.TorusGeometry(1.95, 0.05, 4, 32);
      ringGeo._owned = true;
      var ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = 0.42;
      group.add(ring);

      var ring2Mat = matBasic(C.violet, {
        transparent: true, opacity: 0.7, blending: 'additive',
        depthWrite: false, fog: false
      });
      var ring2Geo = new THREE.TorusGeometry(1.7, 0.035, 4, 28);
      ring2Geo._owned = true;
      var ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
      ring2.rotation.x = 1.3;
      ring2.rotation.z = 0.5;
      group.add(ring2);

      // Grounded phase light: two additive pools that follow the core while
      // staying on the arena floor (their local Y is corrected each frame).
      var floorGlowMat = matBasic(0xff4fb8, {
        transparent: true, opacity: 0.09, blending: 'additive',
        depthWrite: false, fog: false
      });
      var floorGlow = new THREE.Mesh(G.circle, floorGlowMat);
      floorGlow.scale.set(3.7, 1, 3.7);
      floorGlow.position.set(0, -2.4, 0);
      group.add(floorGlow);
      var floorCoreMat = matBasic(0xff9ad8, {
        transparent: true, opacity: 0.13, blending: 'additive',
        depthWrite: false, fog: false
      });
      var floorCore = new THREE.Mesh(G.circle, floorCoreMat);
      floorCore.scale.set(1.85, 1, 1.85);
      floorCore.position.set(0, -2.39, 0);
      group.add(floorCore);

      var shieldGroup = new THREE.Group();
      var shieldMat = matBasic(C.cyan, {
        transparent: true, opacity: 0.1, blending: 'additive',
        depthWrite: false, fog: false
      });
      var shield = new THREE.Mesh(G.sphere, shieldMat);
      shield.scale.setScalar(2.55);
      shieldGroup.add(shield);
      var shieldRingMat = matBasic(C.cyan, {
        transparent: true, opacity: 0.7, blending: 'additive',
        depthWrite: false, fog: false
      });
      var shieldRingGeo = new THREE.TorusGeometry(2.5, 0.04, 4, 32);
      shieldRingGeo._owned = true;
      var shieldRing = new THREE.Mesh(shieldRingGeo, shieldRingMat);
      shieldRing.rotation.x = Math.PI / 2;
      shieldGroup.add(shieldRing);
      shieldGroup.visible = false;
      group.add(shieldGroup);

      return {
        group: group,
        core: core,
        coreMat: coreMat,
        eyeMat: eyeMat,
        plates: plates,
        ring: ring,
        ring2: ring2,
        aura: aura,
        auraMat: auraMat,
        auraCore: auraCore,
        auraCoreMat: auraCoreMat,
        floorGlow: floorGlow,
        floorGlowMat: floorGlowMat,
        floorCore: floorCore,
        floorCoreMat: floorCoreMat,
        shieldGroup: shieldGroup,
        shieldMat: shieldMat,
        ringMat: ringMat,
        ring2Mat: ring2Mat
      };
    }

    function spawnBoss() {
      if (boss) return;
      var built = buildBossMesh();
      var group = built.group;
      group.position.set(0, 2.5, -9);
      scene.add(group);

      boss = {
        group: group,
        core: built.core,
        coreMat: built.coreMat,
        eyeMat: built.eyeMat,
        plates: built.plates,
        ring: built.ring,
        ring2: built.ring2,
        aura: built.aura,
        auraMat: built.auraMat,
        auraCore: built.auraCore,
        auraCoreMat: built.auraCoreMat,
        floorGlow: built.floorGlow,
        floorGlowMat: built.floorGlowMat,
        floorCore: built.floorCore,
        floorCoreMat: built.floorCoreMat,
        auraHex: 0,
        isBoss: true,
        shadow: null,
        shieldGroup: built.shieldGroup,
        shieldMat: built.shieldMat,
        ringMat: built.ringMat,
        ring2Mat: built.ring2Mat,
        pos: new THREE.Vector3(0, 2.5, -9),
        hp: 160,
        maxHp: 160,
        phase: 1,
        alive: true,
        t: 0,
        invuln: 1.4,
        shield: 0,
        shieldCd: 7.5,
        exposed: 0,
        plateOpen: 0,
        flash: 0,
        action: null,
        actionCd: 1.8,
        alt: 0,
        anchor: new THREE.Vector3(0, 2.5, -9),
        anchorT: 3.5,
        summonCd: 16,
        contactCd: 0,
        deadT: 0
      };
      boss.shadow = acquireContactShadow(boss, 3.05, 0.32);

      bossEverSpawned = true;
      bossDefeated = false;
      flow.bossActive = true;
      setArenaPhase(1);
      ui.bossBar.hidden = false;
      addToast('警告 // 零号守门者 GATEKEEPER ZERO 上线', 'boss');
      player.shake = Math.max(player.shake, 0.55);
      updateObjective();
    }

    function damageBoss(amount, color, point) {
      if (!boss || !boss.alive) return;
      if (boss.invuln > 0 || boss.shield > 0) {
        spawnParticles(point || boss.pos, C.cyan, 3, 2.6, 0.24, 0.04);
        return;
      }
      var mult = boss.exposed > 0 ? 2 : 1;
      boss.hp -= amount * mult;
      boss.flash = 0.09;
      spawnParticles(point || boss.pos, color || C.magenta, 4, 4, 0.3, 0.05);

      if (boss.hp <= 0) {
        // Never let a single burst skip a phase: gate lethal damage at 1 HP
        // until the boss has shown all three phases.
        if (boss.phase < 3) {
          boss.hp = 1;
          enterBossPhase(boss.phase + 1);
          return;
        }
        defeatBoss();
        return;
      }

      var ratio = boss.hp / boss.maxHp;
      var targetPhase = ratio > 0.66 ? 1 : (ratio > 0.33 ? 2 : 3);
      // Advance one phase per hit so a high-damage burst cannot skip a phase.
      if (targetPhase > boss.phase) enterBossPhase(boss.phase + 1);
    }

    function enterBossPhase(phase) {
      if (!boss) return;
      boss.phase = phase;
      boss.invuln = 1.35;
      boss.action = null;
      boss.actionCd = 1.0;
      boss.shield = 0;
      boss.shieldCd = 5.0;
      boss.exposed = 0;
      setArenaPhase(phase);
      spawnRingFx(boss.pos, 9, C.magenta, 0.8, 1.4);
      spawnRingFx(boss.pos, 6, C.violet, 0.6, 1.0);
      spawnParticles(boss.pos, C.magenta, 40, 12, 0.9, 0.09);
      boss.flash = Math.max(boss.flash, 0.22);
      player.shake = Math.max(player.shake, 0.5);
      flashScreen(phase === 3 ? 0xff3d32 : 0x9b6bff, true);
      addToast('守门者进入第 ' + phase + ' 阶段', 'boss');
      if (phase === 3) {
        boss.summonCd = 15;
        summonSentinels(2);
        addToast('核心暴露协议 // 安全区收窄', 'warn');
      }
    }

    function defeatBoss() {
      if (!boss) return;
      boss.alive = false;
      boss.hp = 0;
      boss.shield = 0;
      boss.exposed = 0;
      boss.action = null;

      var pos = boss.pos.clone();
      releaseContactShadow(boss.shadow);
      if (boss.group) {
        disposeOwned(boss.group);
        if (boss.group.parent) scene.remove(boss.group);
      }
      boss.group = null;

      spawnParticles(pos, C.magenta, 60, 14, 1.1, 0.1);
      spawnParticles(pos, C.cyan, 40, 10, 1.0, 0.08);
      spawnRingFx(pos, 13, C.magenta, 0.9, 1.6);
      spawnRingFx(pos, 9, C.cyan, 0.75, 1.2);

      clearBullets();
      clearEnemies();
      for (var mi = 0; mi < missiles.length; mi++) {
        releaseMissileFx(missiles[mi].fx);
      }
      missiles.length = 0;
      for (var li = 0; li < lasers.length; li++) {
        lasers[li].running = false;
        lasers[li].group.visible = false;
      }
      lasers.length = 0;
      for (var wi = 0; wi < shockwaves.length; wi++) {
        shockwaves[wi].running = false;
        shockwaves[wi].group.visible = false;
      }
      shockwaves.length = 0;
      for (var ti = 0; ti < telegraphs.length; ti++) {
        telegraphs[ti].active = false;
        telegraphs[ti].group.visible = false;
      }
      telegraphs.length = 0;
      boss = null;
      bossDefeated = true;
      flow.bossActive = false;

      exit.unlocked = true;
      updateExitVisuals();
      setArenaPhase(4);
      player.shake = 0.9;
      flashScreen(0xff4fb8, true);
      addToast('零号守门者解体 // 出口已解锁', 'good');
      updateObjective();
    }

    function summonSentinels(count) {
      if (!boss) return;
      for (var i = 0; i < count; i++) {
        var ang = i * Math.PI + Math.random() * 0.6;
        var x = clamp(boss.pos.x + Math.cos(ang) * rnd(4.5, 7), ARENA.minX + 2.5, ARENA.maxX - 2.5);
        var z = clamp(boss.pos.z + Math.sin(ang) * rnd(4.5, 7), ARENA.minZ + 2.5, ARENA.maxZ - 2.5);
        spawnSentinel(x, z);
      }
      addToast('守门者召唤增援 // ' + count + ' 个漂移哨兵', 'warn');
    }

    function bossAimDir() {
      var from = boss.pos;
      var target = player.pos.clone();
      target.y -= 0.12;
      return target.sub(from).normalize();
    }

    function startBossAction(type) {
      if (!boss) return;
      boss.action = {
        type: type,
        t: 0,
        step: 0,
        points: [],
        axis: Math.random() < 0.5 ? 'x' : 'z'
      };
      boss.actionCd = boss.phase === 3 ? 1.85 : (boss.phase === 2 ? 2.35 : 2.8);
    }

    function endBossAction() {
      if (boss) boss.action = null;
    }

    function nextBossAction() {
      var list;
      if (!boss) return 'volley';
      if (boss.phase === 1) list = ['volley', 'strike', 'volley', 'strike'];
      else if (boss.phase === 2) list = ['laser', 'volley', 'laser', 'strike'];
      else list = ['missiles', 'shockwave', 'laser', 'expose', 'volley', 'shockwave'];
      var type = list[boss.alt % list.length];
      boss.alt++;
      return type;
    }

    function updateBossAction(dt) {
      if (!boss || !boss.action) return;
      var a = boss.action;
      a.t += dt;

      if (a.type === 'volley') {
        if (a.step === 0 && a.t >= 0.5) {
          a.step = 1;
          var base = bossAimDir();
          var origin = boss.pos.clone().addScaledVector(base, 1.5);
          for (var i = -1; i <= 1; i++) {
            var d = rotateYDir(base, i * 0.14);
            spawnBullet(origin, d, boss.phase === 3 ? 14 : 12, 11, C.magenta, 0.24, boss.phase === 3 ? 0.7 : 0);
          }
          spawnParticles(origin, C.magenta, 8, 5, 0.3, 0.06);
          player.shake = Math.max(player.shake, 0.18);
        }
        if (a.t >= 1.05) endBossAction();
        return;
      }

      if (a.type === 'strike') {
        if (a.step === 0) {
          a.step = 1;
          for (var s = 0; s < 3; s++) {
            var px = clamp(player.pos.x + rnd(-3.6, 3.6), ARENA.minX + 2, ARENA.maxX - 2);
            var pz = clamp(player.pos.z + rnd(-3.6, 3.6), ARENA.minZ + 2, ARENA.maxZ - 2);
            a.points.push({ x: px, z: pz });
            spawnTelegraph(px, pz, 1.8, 1.15, C.amber);
          }
        }
        if (a.step === 1 && a.t >= 1.15) {
          a.step = 2;
          for (var p = 0; p < a.points.length; p++) {
            var pt = a.points[p];
            spawnParticles(new THREE.Vector3(pt.x, 0.2, pt.z), C.amber, 18, 9, 0.55, 0.075);
            spawnRingFx(new THREE.Vector3(pt.x, 0, pt.z), 2.2, C.amber, 0.35, 0.06);
            if (Math.hypot(player.pos.x - pt.x, player.pos.z - pt.z) < 1.9) {
              damagePlayer(16);
            }
          }
          player.shake = Math.max(player.shake, 0.35);
        }
        if (a.t >= 1.75) endBossAction();
        return;
      }

      if (a.type === 'laser') {
        if (a.step === 0) {
          a.step = 1;
          if (a.axis === 'x') {
            spawnBossLaser('x', clamp(player.pos.z, ARENA.minZ + 2, ARENA.maxZ - 2));
          } else {
            spawnBossLaser('z', clamp(player.pos.x, ARENA.minX + 2, ARENA.maxX - 2));
          }
        }
        if (a.t >= 2.4) endBossAction();
        return;
      }

      if (a.type === 'missiles') {
        if (a.step === 0 && a.t >= 0.35) {
          a.step = 1;
          var mbase = bossAimDir();
          var morigin = boss.pos.clone().addScaledVector(mbase, 1.4);
          for (var m = -1; m <= 1; m++) {
            spawnMissile(morigin, rotateYDir(mbase, m * 0.32), boss.phase === 3 ? 9.5 : 8.2, 1.9, 6, 14);
          }
          addToast('追踪弹发射 // 可被击落', 'warn');
        }
        if (a.t >= 1.15) endBossAction();
        return;
      }

      if (a.type === 'shockwave') {
        if (a.step === 0 && a.t >= 0.3) {
          a.step = 1;
          var phase3 = boss.phase === 3;
          var gapHalf = phase3 ? 0.24 : 0.4;
          var baseAng = Math.random() * Math.PI * 2;
          var gaps = [];
          for (var g = 0; g < 3; g++) gaps.push(baseAng + g * Math.PI * 2 / 3);
          spawnShockwave(boss.pos, gaps, gapHalf, phase3 ? 12 : 9.5);
          addToast('冲击波 // 站进缺口', 'danger');
        }
        if (a.t >= 1.2) endBossAction();
        return;
      }

      if (a.type === 'expose') {
        if (a.step === 0) {
          a.step = 1;
          boss.exposed = 2.0;
          addToast('核心暴露 // 伤害翻倍 2.0s', 'good');
        }
        if (a.t >= 2.2) endBossAction();
        return;
      }

      endBossAction();
    }

    function updateBoss(dt) {
      if (!boss || !boss.alive) return;

      boss.t += dt;
      boss.invuln = Math.max(0, boss.invuln - dt);
      boss.exposed = Math.max(0, boss.exposed - dt);
      boss.flash = Math.max(0, boss.flash - dt);
      boss.contactCd = Math.max(0, boss.contactCd - dt);

      if (boss.shield > 0) {
        boss.shield -= dt;
        if (boss.shield <= 0) {
          boss.shield = 0;
          addToast('护盾过载 // 攻击窗口开启', 'good');
        }
      } else if (boss.phase >= 2 && boss.invuln <= 0) {
        boss.shieldCd -= dt;
        if (boss.shieldCd <= 0) {
          boss.shield = 2.8;
          boss.shieldCd = rnd(8, 10);
          addToast('环形护盾展开 // 等待过载', 'warn');
        }
      }

      boss.anchorT -= dt;
      if (boss.anchorT <= 0) {
        boss.anchorT = boss.phase === 3 ? 2.2 : 3.4;
        var anchors = [[0, -9], [-13, -2], [13, 2], [0, 8], [-13, 10], [13, -10]];
        var pick = anchors[Math.floor(Math.random() * anchors.length)];
        boss.anchor.set(pick[0], 2.5, pick[1]);
        spawnParticles(boss.pos, C.violet, 8, 4, 0.35, 0.05);
      }

      var mk = 1 - Math.exp(-dt * 1.3);
      boss.pos.x = lerp(boss.pos.x, boss.anchor.x, mk);
      boss.pos.z = lerp(boss.pos.z, boss.anchor.z, mk);
      boss.pos.y = 2.5 + Math.sin(boss.t * 1.4) * 0.16;

      var dx = player.pos.x - boss.pos.x;
      var dz = player.pos.z - boss.pos.z;
      boss.group.quaternion.setFromAxisAngle(UP, Math.atan2(dx, dz));
      boss.group.position.copy(boss.pos);

      if (boss.flash > 0) boss.coreMat.emissive.setHex(0xffffff);
      else boss.coreMat.emissive.setHex(0xff3a9a);

      boss.eyeMat.color.setHex(boss.exposed > 0 ? C.amber : 0xffe3f4);
      var coreScale = 0.92 + Math.sin(boss.t * 3.2) * 0.03 + (boss.exposed > 0 ? 0.16 : 0);
      boss.core.scale.setScalar(coreScale);

      // Phase-coded layered core glow and a grounded light pool.  Only colour
      // and opacity change here; the meshes/materials were built on spawn.
      var auraHex = boss.phase === 3 ? 0xff4d6d : (boss.phase === 2 ? 0xffc45a : 0xff4fb8);
      if (boss.auraHex !== auraHex) {
        boss.auraHex = auraHex;
        boss.auraMat.color.setHex(auraHex);
        boss.auraCoreMat.color.setHex(auraHex);
        boss.floorGlowMat.color.setHex(auraHex);
        boss.floorCoreMat.color.setHex(auraHex);
      }
      var auraPulse = 0.5 + 0.5 * Math.sin(boss.t * (boss.phase === 3 ? 7 : 3.4));
      boss.aura.scale.setScalar(1.52 + auraPulse * 0.18 + (boss.exposed > 0 ? 0.2 : 0));
      boss.auraCore.scale.setScalar(0.98 + auraPulse * 0.14);
      boss.auraMat.opacity = 0.04 + auraPulse * 0.03;
      boss.auraCoreMat.opacity = 0.08 + auraPulse * 0.05;
      boss.floorGlow.position.y = 0.07 - boss.pos.y;
      boss.floorCore.position.y = 0.075 - boss.pos.y;
      var floorPulse = 0.82 + 0.18 * Math.sin(boss.t * 2.6);
      boss.floorGlowMat.opacity = (boss.exposed > 0 ? 0.11 : 0.065) * floorPulse;
      boss.floorCoreMat.opacity = (boss.exposed > 0 ? 0.15 : 0.095) * floorPulse;

      boss.ring.rotation.z += dt * 1.5;
      boss.ring2.rotation.z -= dt * 2.1;

      var targetOpen = boss.exposed > 0 ? 1 : 0;
      boss.plateOpen = lerp(boss.plateOpen, targetOpen, 1 - Math.exp(-dt * 9));
      for (var p = 0; p < boss.plates.length; p++) {
        var plate = boss.plates[p];
        var radius = 1.15 + boss.plateOpen * 0.95;
        plate.mesh.position.set(
          Math.cos(plate.angle) * radius,
          boss.plateOpen * 0.6,
          Math.sin(plate.angle) * radius
        );
        plate.mesh.rotation.y = -plate.angle + Math.PI / 2;
        plate.mesh.rotation.z = boss.plateOpen * 0.4;
      }

      boss.shieldGroup.visible = boss.shield > 0;
      if (boss.shield > 0) {
        boss.shieldGroup.rotation.y += dt * 1.2;
        boss.shieldMat.opacity = 0.1 + 0.05 * (0.5 + 0.5 * Math.sin(boss.t * 8));
      }

      if (boss.contactCd <= 0 && dist2D(boss.pos, player.pos) < 1.9) {
        damagePlayer(8);
        boss.contactCd = 0.7;
      }

      if (boss.phase === 3) {
        boss.summonCd -= dt;
        if (boss.summonCd <= 0) {
          boss.summonCd = 16;
          if (enemies.length < 3) summonSentinels(2);
        }
      }

      if (boss.invuln > 0) return;

      if (boss.action) {
        updateBossAction(dt);
      } else if (boss.shield <= 0) {
        boss.actionCd -= dt;
        if (boss.actionCd <= 0) startBossAction(nextBossAction());
      }
    }

    /* --------------------------------------------------------------- lasers */

    function buildLaserPool() {
      for (var i = 0; i < MAX.lasers; i++) {
        var group = new THREE.Group();
        var mats = {
          warnFloor: fxAdditive(0xff4d6d, 0.1),
          warnOuter: fxAdditive(0xff4d6d, 0.14),
          warnCore: fxAdditive(0xffffff, 0.5),
          chargeOuter: fxAdditive(0xff4d6d, 0.1),
          chargeCore: fxAdditive(0xffffff, 0.5),
          beamHalo: fxAdditive(0xff4d6d, 0.2),
          beamMid: fxAdditive(0xff4d6d, 0.65),
          beamCore: fxAdditive(0xffffff, 0.95),
          impact: fxAdditive(0xffffff, 0.8),
          surge: fxAdditive(0xffffff, 0.9)
        };
        var parts = {};
        parts.warnFloor = new THREE.Mesh(G.box, mats.warnFloor);
        parts.warnFloor.position.y = -1.389;
        parts.warnOuter = new THREE.Mesh(G.box, mats.warnOuter);
        parts.warnCore = new THREE.Mesh(G.box, mats.warnCore);
        parts.chargeOuter = new THREE.Mesh(G.box, mats.chargeOuter);
        parts.chargeCore = new THREE.Mesh(G.box, mats.chargeCore);
        parts.beamHalo = new THREE.Mesh(G.box, mats.beamHalo);
        parts.beamMid = new THREE.Mesh(G.box, mats.beamMid);
        parts.beamCore = new THREE.Mesh(G.box, mats.beamCore);
        parts.impactA = new THREE.Mesh(G.lowSphere, mats.impact);
        parts.impactB = new THREE.Mesh(G.lowSphere, mats.impact);
        parts.surgeA = new THREE.Mesh(G.box, mats.surge);
        parts.surgeB = new THREE.Mesh(G.box, mats.surge);
        parts.warnFloor.renderOrder = 6;
        parts.warnOuter.renderOrder = 7;
        parts.warnCore.renderOrder = 8;
        parts.chargeOuter.renderOrder = 8;
        parts.chargeCore.renderOrder = 9;
        parts.beamHalo.renderOrder = 8;
        parts.beamMid.renderOrder = 9;
        parts.beamCore.renderOrder = 10;
        parts.impactA.renderOrder = 10;
        parts.impactB.renderOrder = 10;
        parts.surgeA.renderOrder = 11;
        parts.surgeB.renderOrder = 11;
        var keys = Object.keys(parts);
        for (var k = 0; k < keys.length; k++) group.add(parts[keys[k]]);
        group.visible = false;
        scene.add(group);
        laserFxPool.push({
          group: group,
          mats: mats,
          parts: parts,
          running: false,
          axis: 'x',
          coord: 0,
          len: 42,
          t: 0,
          warn: 0.9,
          active: 1.25,
          tick: 0,
          fired: false,
          phase: 2,
          sparkT: 0
        });
      }
    }

    function applyLaserColors(l) {
      var mid, halo, core;
      if (l.phase === 3) {
        mid = 0xff3d32;
        halo = 0xff2a20;
        core = 0xffffff;
      } else if (l.phase === 2) {
        mid = 0xff4fb8;
        halo = 0x9b6bff;
        core = 0xffffff;
      } else {
        mid = 0xff4d6d;
        halo = 0xff2a3d;
        core = 0xffffff;
      }
      l.mats.warnFloor.color.setHex(mid);
      l.mats.warnOuter.color.setHex(mid);
      l.mats.warnCore.color.setHex(core);
      l.mats.chargeOuter.color.setHex(mid);
      l.mats.chargeCore.color.setHex(core);
      l.mats.beamHalo.color.setHex(halo);
      l.mats.beamMid.color.setHex(mid);
      l.mats.beamCore.color.setHex(core);
      l.mats.impact.color.setHex(core);
      l.mats.surge.color.setHex(core);
    }

    function setLaserWarnVisible(l, warning) {
      var p = l.parts;
      p.warnFloor.visible = warning;
      p.warnOuter.visible = warning;
      p.warnCore.visible = warning;
      p.chargeOuter.visible = warning;
      p.chargeCore.visible = warning;
      p.beamHalo.visible = !warning;
      p.beamMid.visible = !warning;
      p.beamCore.visible = !warning;
      p.impactA.visible = !warning;
      p.impactB.visible = !warning;
      p.surgeA.visible = !warning;
      p.surgeB.visible = !warning;
    }

    function spawnBossLaser(axis, coord) {
      if (lasers.length >= MAX.lasers) return;
      var slot = null;
      for (var i = 0; i < laserFxPool.length; i++) {
        if (!laserFxPool[i].running) { slot = laserFxPool[i]; break; }
      }
      if (!slot) return;
      var len = axis === 'x' ? 42 : 34;
      slot.running = true;
      slot.axis = axis;
      slot.coord = coord;
      slot.len = len;
      slot.t = 0;
      slot.tick = 0;
      slot.fired = false;
      slot.sparkT = 0;
      slot.phase = boss && boss.phase ? boss.phase : 2;
      slot.group.visible = true;
      slot.group.position.set(axis === 'x' ? 0 : coord, 1.45, axis === 'x' ? coord : 0);
      slot.group.rotation.y = axis === 'x' ? 0 : Math.PI / 2;

      var p = slot.parts;
      p.warnFloor.scale.set(len, 0.008, 0.46);
      p.warnOuter.scale.set(len, 0.14, 0.34);
      p.warnCore.scale.set(len, 0.034, 0.07);
      p.chargeOuter.scale.set(len * 0.1, 0.42, 0.42);
      p.chargeCore.scale.set(len * 0.1, 0.09, 0.11);
      p.beamHalo.scale.set(len, 0.7, 0.7);
      p.beamMid.scale.set(len, 0.26, 0.26);
      p.beamCore.scale.set(len, 0.07, 0.07);
      p.impactA.position.set(-len * 0.5, 0, 0);
      p.impactB.position.set(len * 0.5, 0, 0);
      p.impactA.scale.setScalar(0.34);
      p.impactB.scale.setScalar(0.34);
      p.surgeA.position.set(-len * 0.3, 0, 0);
      p.surgeB.position.set(len * 0.3, 0, 0);
      p.surgeA.scale.set(1.4, 0.12, 0.12);
      p.surgeB.scale.set(1.4, 0.12, 0.12);
      applyLaserColors(slot);
      setLaserWarnVisible(slot, true);
      lasers.push(slot);
      addToast('激光预警 // 离开红线', 'danger');
    }

    function updateLasers(dt) {
      for (var i = lasers.length - 1; i >= 0; i--) {
        var l = lasers[i];
        l.t += dt;
        var p = l.parts;

        if (l.t < l.warn) {
          var charge = clamp((l.t - l.warn * 0.55) / (l.warn * 0.45), 0, 1);
          var pulse = 0.5 + 0.5 * Math.sin(l.t * 24);
          l.mats.warnFloor.opacity = 0.07 + 0.12 * pulse;
          l.mats.warnOuter.opacity = 0.1 + 0.12 * pulse;
          l.mats.warnCore.opacity = 0.3 + 0.35 * pulse;
          l.mats.chargeOuter.opacity = 0.04 + charge * 0.2;
          l.mats.chargeCore.opacity = 0.18 + charge * 0.78;
          p.chargeOuter.scale.x = l.len * (0.1 + 0.9 * charge);
          p.chargeCore.scale.x = l.len * (0.1 + 0.9 * charge);
          p.chargeOuter.scale.y = 0.3 + charge * 0.18;
          p.chargeOuter.scale.z = 0.3 + charge * 0.18;
          p.chargeCore.scale.y = 0.06 + charge * 0.05;
          p.chargeCore.scale.z = 0.08 + charge * 0.06;
        } else if (l.t < l.warn + l.active) {
          if (!l.fired) {
            l.fired = true;
            setLaserWarnVisible(l, false);
            flashScreen(laserPaletteHex(l.phase), true);
            player.shake = Math.max(player.shake, 0.46);
            fxTmpVec.set(
              l.axis === 'x' ? player.pos.x : l.coord,
              1.45,
              l.axis === 'x' ? l.coord : player.pos.z
            );
            spawnSparks(fxTmpVec, laserPaletteHex(l.phase), 8, 5.5, 1.4);
          }
          var stroke = 0.5 + 0.5 * Math.sin(l.t * 40);
          l.mats.beamHalo.opacity = 0.14 + stroke * 0.12;
          l.mats.beamMid.opacity = 0.55 + stroke * 0.22;
          l.mats.beamCore.opacity = 0.9 + stroke * 0.08;
          l.mats.impact.opacity = 0.55 + stroke * 0.4;
          l.mats.surge.opacity = 0.75 + stroke * 0.22;
          p.beamHalo.scale.y = 0.62 + stroke * 0.18;
          p.beamHalo.scale.z = 0.62 + stroke * 0.18;
          p.beamMid.scale.y = 0.24 + stroke * 0.06;
          p.beamMid.scale.z = 0.24 + stroke * 0.06;
          p.beamCore.scale.y = 0.065 + stroke * 0.02;
          p.beamCore.scale.z = 0.065 + stroke * 0.02;
          p.impactA.scale.setScalar(0.32 + stroke * 0.3);
          p.impactB.scale.setScalar(0.32 + stroke * 0.3);
          var travel = (l.t - l.warn) * 1.8;
          p.surgeA.position.x = -l.len * 0.5 + ((travel * 14) % l.len);
          p.surgeB.position.x = l.len * 0.5 - ((travel * 11 + 7) % l.len);

          l.sparkT -= dt;
          if (l.sparkT <= 0) {
            l.sparkT = 0.09;
            fxTmpVec.set(
              l.axis === 'x' ? clamp(player.pos.x + rnd(-3, 3), ARENA.minX, ARENA.maxX) : l.coord,
              1.45,
              l.axis === 'x' ? l.coord : clamp(player.pos.z + rnd(-3, 3), ARENA.minZ, ARENA.maxZ)
            );
            spawnSparks(fxTmpVec, laserPaletteHex(l.phase), 2, 3.4, 0.9);
          }

          var hitPlayer = l.axis === 'x'
            ? Math.abs(player.pos.z - l.coord) < 0.55
            : Math.abs(player.pos.x - l.coord) < 0.55;
          if (hitPlayer) {
            l.tick -= dt;
            if (l.tick <= 0) {
              l.tick = 0.3;
              damagePlayer(9);
            }
          } else {
            l.tick = 0;
          }
        } else {
          l.running = false;
          l.group.visible = false;
          lasers.splice(i, 1);
        }
      }
    }

    /* ------------------------------------------------------------ shockwave */

    var shockArcGeometries = null;

    function ensureShockArcGeometries() {
      if (shockArcGeometries) return;
      shockArcGeometries = [];
      var variants = [0.4, 0.24];
      for (var v = 0; v < variants.length; v++) {
        var gapHalf = variants[v];
        var arcLen = (Math.PI * 2 - 3 * gapHalf * 2) / 3;
        shockArcGeometries.push({
          gapHalf: gapHalf,
          core: new THREE.TorusGeometry(1, 0.055, 4, 14, arcLen),
          halo: new THREE.TorusGeometry(1, 0.15, 4, 14, arcLen)
        });
      }
    }

    function buildShockwavePool() {
      ensureShockArcGeometries();
      for (var i = 0; i < MAX.shockwaves; i++) {
        var group = new THREE.Group();
        var coreMat = fxAdditive(0xffffff, 0.85);
        var haloMat = fxAdditive(C.magenta, 0.22);
        var cores = [[], []];
        var halos = [[], []];
        for (var v = 0; v < 2; v++) {
          for (var k = 0; k < 3; k++) {
            var core = new THREE.Mesh(shockArcGeometries[v].core, coreMat);
            var halo = new THREE.Mesh(shockArcGeometries[v].halo, haloMat);
            core.renderOrder = 10;
            halo.renderOrder = 9;
            core.visible = false;
            halo.visible = false;
            group.add(core);
            group.add(halo);
            cores[v].push(core);
            halos[v].push(halo);
          }
        }
        group.visible = false;
        scene.add(group);
        shockwaveFxPool.push({
          group: group,
          coreMat: coreMat,
          haloMat: haloMat,
          cores: cores,
          halos: halos,
          running: false,
          gaps: [0, 0, 0],
          gapHalf: 0.4,
          r: 0.9,
          maxR: 26,
          speed: 0,
          hit: false
        });
      }
    }

    function spawnShockwave(origin, gaps, gapHalf, speed) {
      if (shockwaves.length >= MAX.shockwaves) return;
      var slot = null;
      for (var i = 0; i < shockwaveFxPool.length; i++) {
        if (!shockwaveFxPool[i].running) { slot = shockwaveFxPool[i]; break; }
      }
      if (!slot) return;
      var variant = gapHalf >= 0.32 ? 0 : 1;
      var v, k;
      slot.running = true;
      slot.x = origin.x;
      slot.z = origin.z;
      slot.r = 0.9;
      slot.maxR = 26;
      slot.speed = speed;
      slot.gapHalf = gapHalf;
      slot.hit = false;
      for (k = 0; k < 3; k++) slot.gaps[k] = gaps[k] || 0;
      slot.group.visible = true;
      slot.group.position.set(origin.x, 0.72, origin.z);
      slot.group.scale.set(slot.r, 1, slot.r);
      var phaseHex = boss && boss.phase === 3 ? 0xff4d6d : C.magenta;
      slot.coreMat.color.setHex(0xffffff);
      slot.haloMat.color.setHex(phaseHex);
      slot.coreMat.opacity = 0.85;
      slot.haloMat.opacity = 0.22;
      for (v = 0; v < 2; v++) {
        var show = v === variant;
        for (k = 0; k < 3; k++) {
          slot.cores[v][k].visible = show;
          slot.halos[v][k].visible = show;
          var rot = -(slot.gaps[k] + gapHalf);
          slot.cores[v][k].rotation.y = rot;
          slot.halos[v][k].rotation.y = rot;
        }
      }
      shockwaves.push(slot);
    }

    function updateShockwaves(dt) {
      for (var i = shockwaves.length - 1; i >= 0; i--) {
        var w = shockwaves[i];
        w.r += w.speed * dt;
        w.group.scale.set(w.r, 1, w.r);

        if (!w.hit) {
          var d = Math.hypot(player.pos.x - w.x, player.pos.z - w.z);
          if (Math.abs(d - w.r) < 1.0) {
            var ang = Math.atan2(player.pos.z - w.z, player.pos.x - w.x);
            var safe = false;
            for (var g = 0; g < w.gaps.length; g++) {
              if (Math.abs(angleWrap(ang - w.gaps[g])) < w.gapHalf) {
                safe = true;
                break;
              }
            }
            if (!safe) {
              damagePlayer(18);
              spawnSparks(player.pos, C.magenta, 8, 5.5, 1.5);
            }
            w.hit = true;
          }
        }

        if (w.r >= w.maxR) {
          w.running = false;
          w.group.visible = false;
          shockwaves.splice(i, 1);
        } else {
          var fade = 1 - w.r / w.maxR;
          w.coreMat.opacity = 0.35 + fade * 0.6;
          w.haloMat.opacity = 0.1 + fade * 0.28;
        }
      }
    }

    /* ----------------------------------------------------------------- flow */

    var bannerTimer = 0;
    var toastCount = 0;

    function addToast(text, tone) {
      if (!ui.toasts) return;
      var el = document.createElement('div');
      el.className = 'toast' + (tone ? ' is-' + tone : '');
      el.textContent = text;
      ui.toasts.appendChild(el);
      toastCount++;
      while (ui.toasts.children.length > 4) {
        ui.toasts.removeChild(ui.toasts.firstChild);
      }
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 2400);
      void toastCount;
    }

    function showBanner(text, ms) {
      if (!ui.banner) return;
      ui.banner.hidden = false;
      ui.banner.textContent = text;
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(function () {
        ui.banner.hidden = true;
        bannerTimer = 0;
      }, ms || 1700);
    }

    function updateObjective() {
      var text = '目标 // 等待突入';
      if (bossDefeated) text = '目标 // 抵达出口并按 E 撤离';
      else if (boss && boss.alive) text = '目标 // 击败零号守门者';
      else if (flow.wave === 1) text = '目标 // 清除第一波漂移哨兵';
      else if (flow.wave === 2) text = '目标 // 摧毁第二波封锁单位';
      else if (flow.bossActive) text = '目标 // 检测到高能信号';
      setText(ui.objective, text);
    }

    function queueSpawn(delay, fn) {
      pending.push({ t: delay, fn: fn });
    }

    function updatePending(dt) {
      for (var i = pending.length - 1; i >= 0; i--) {
        var p = pending[i];
        p.t -= dt;
        if (p.t <= 0) {
          pending.splice(i, 1);
          p.fn();
        }
      }
    }

    function beginWave(n) {
      flow.wave = n;
      flow.clearT = -1;
      flow.bossActive = false;

      if (n === 1) {
        setText(ui.waveLabel, 'WAVE 01');
        showBanner('WAVE 01 // 漂移哨兵', 1900);
        addToast('第一波 // 4 个漂移哨兵', 'danger');
        queueSpawn(0.5, function () { spawnSentinel(-16, -13); });
        queueSpawn(0.8, function () { spawnSentinel(16, -13); });
        queueSpawn(1.1, function () { spawnSentinel(-16, 12); });
        queueSpawn(1.4, function () { spawnSentinel(16, 12); });
      } else if (n === 2) {
        setText(ui.waveLabel, 'WAVE 02');
        showBanner('WAVE 02 // 墙面炮台已上线', 1900);
        addToast('第二波 // 4 哨兵 + 2 墙面炮台', 'danger');
        queueSpawn(0.4, function () { spawnSentinel(-17, -3); });
        queueSpawn(0.65, function () { spawnSentinel(17, 3); });
        queueSpawn(0.9, function () { spawnSentinel(-17, 12); });
        queueSpawn(1.15, function () { spawnSentinel(17, -12); });
        queueSpawn(1.5, function () { spawnTurret(-20.3, -7); });
        queueSpawn(1.8, function () { spawnTurret(20.3, 7); });
      }
      updateObjective();
      updateHud();
    }

    function beginBoss() {
      flow.wave = 3;
      flow.clearT = -1;
      flow.bossActive = true;
      setText(ui.waveLabel, 'BOSS');
      showBanner('GATEKEEPER ZERO // 零号守门者', 2400);
      addToast('高能信号逼近 // 守门者苏醒', 'boss');
      updateObjective();
      queueSpawn(2.0, spawnBoss);
    }

    function updateFlow(dt) {
      if (mode !== 'playing') return;
      if (bossDefeated) return;
      if (flow.bossActive) return;
      if (flow.wave < 1) return;

      if (enemies.length === 0 && pending.length === 0) {
        if (flow.clearT < 0) {
          flow.clearT = 2.1;
          addToast('区域清除 // 下一波接近', 'good');
          showBanner('SECTOR CLEAR', 1400);
        } else {
          flow.clearT -= dt;
          if (flow.clearT <= 0) {
            if (flow.wave === 1) beginWave(2);
            else if (flow.wave === 2) beginBoss();
          }
        }
      }
    }

    /* ---------------------------------------------------------------- run */

    function clearSceneEntities() {
      var i;
      for (i = 0; i < enemies.length; i++) {
        if (enemies[i].group && enemies[i].group.parent) scene.remove(enemies[i].group);
      }
      enemies.length = 0;
      clearBullets();

      for (i = 0; i < deflects.length; i++) {
        releaseDeflectFx(deflects[i].fx);
      }
      deflects.length = 0;

      for (i = 0; i < missiles.length; i++) {
        releaseMissileFx(missiles[i].fx);
      }
      missiles.length = 0;

      for (i = 0; i < tracerFxPool.length; i++) {
        tracerFxPool[i].alive = false;
        tracerFxPool[i].group.visible = false;
      }
      for (i = 0; i < bulletFxPool.length; i++) {
        bulletFxPool[i].owner = null;
        bulletFxPool[i].group.visible = false;
      }
      for (i = 0; i < deflectFxPool.length; i++) {
        deflectFxPool[i].owner = null;
        deflectFxPool[i].group.visible = false;
      }
      for (i = 0; i < missileFxPool.length; i++) {
        missileFxPool[i].owner = null;
        missileFxPool[i].group.visible = false;
      }
      for (i = 0; i < particles.length; i++) {
        particles[i].alive = false;
        particles[i].mesh.visible = false;
      }
      for (i = 0; i < sparkFxPool.length; i++) {
        sparkFxPool[i].alive = false;
        sparkFxPool[i].mesh.visible = false;
      }
      for (i = 0; i < bulletTrailPool.length; i++) {
        bulletTrailPool[i].owner = null;
        bulletTrailPool[i].ttl = 0;
        bulletTrailPool[i].mesh.visible = false;
      }
      for (i = 0; i < telegraphs.length; i++) {
        telegraphs[i].active = false;
        telegraphs[i].group.visible = false;
      }
      telegraphs.length = 0;
      for (i = 0; i < telegraphFxPool.length; i++) {
        telegraphFxPool[i].active = false;
        telegraphFxPool[i].group.visible = false;
      }

      for (i = 0; i < shockwaves.length; i++) {
        shockwaves[i].running = false;
        shockwaves[i].group.visible = false;
      }
      shockwaves.length = 0;
      for (i = 0; i < shockwaveFxPool.length; i++) {
        shockwaveFxPool[i].running = false;
        shockwaveFxPool[i].group.visible = false;
      }

      for (i = 0; i < lasers.length; i++) {
        lasers[i].running = false;
        lasers[i].group.visible = false;
      }
      lasers.length = 0;
      for (i = 0; i < laserFxPool.length; i++) {
        laserFxPool[i].running = false;
        laserFxPool[i].group.visible = false;
      }

      for (i = 0; i < ringFxPool.length; i++) {
        ringFxPool[i].alive = false;
        ringFxPool[i].mesh.visible = false;
      }
      resetReflectionStrips();
      pending.length = 0;

      if (boss && boss.group) {
        disposeOwned(boss.group);
        if (boss.group.parent) scene.remove(boss.group);
        releaseContactShadow(boss.shadow);
      }
      releaseAllContactShadows();
      boss = null;
    }

    function resetRunState() {
      clearInput();

      player.pos.set(0, EYE, 12.6);
      player.yaw = 0;
      player.pitch = 0;
      player.hp = player.maxHp;
      player.invuln = 0;
      player.dashT = 0;
      player.dashCd = 0;
      player.pulseCd = 0;
      player.lastHit = -999;
      player.shake = 0;
      player.bob = 0;
      player.recoil = 0;
      player.flashT = 0;

      gameTime = 0;
      runTime = 0;
      kills = 0;
      bossEverSpawned = false;
      bossDefeated = false;
      muzzleT = 0;
      lastDryToast = -10;
      if (muzzleFlash) muzzleFlash.visible = false;

      flow.wave = 0;
      flow.clearT = -1;
      flow.bossActive = false;

      exit.unlocked = false;
      updateExitVisuals();
      setArenaPhase(0);

      ui.bossBar.hidden = true;
      ui.bossBar.classList.remove('is-shielded', 'is-exposed');
      ui.hint.hidden = true;
      ui.banner.hidden = true;
      if (ui.toasts) ui.toasts.innerHTML = '';
      ui.damage.style.opacity = '0';
      ui.screenFlash.classList.remove('on', 'is-hard');
      screenFlashToken++;
      ui.hitmarker.classList.remove('show', 'kill');

      resetWeapons();
      updateHud();
    }

    function startRun() {
      clearSceneEntities();
      resetRunState();

      mode = 'playing';
      overlay.hidden = true;
      hud.classList.remove('is-hidden');
      lastTs = performance.now();

      updateObjective();
      updateHud();
      beginWave(1);
      requestLock();
      addToast('突入开始 // 保持移动', 'good');
    }

    function pauseGame() {
      if (mode !== 'playing') return;
      mode = 'paused';
      clearInput();
      releaseLock();
      showOverlay('paused');
    }

    function resumeGame() {
      if (mode !== 'paused') return;
      mode = 'playing';
      overlay.hidden = true;
      clearInput();
      lastTs = performance.now();
      requestLock();
    }

    function failRun() {
      if (mode === 'won' || mode === 'lost') return;
      mode = 'lost';
      clearInput();
      releaseLock();
      hud.classList.add('is-hidden');
      showOverlay('lost');
    }

    function winRun() {
      if (mode !== 'playing') return;
      mode = 'won';
      clearInput();
      releaseLock();
      hud.classList.add('is-hidden');
      spawnRingFx(player.pos, 7, C.cyan, 0.9, 1.0);
      flashScreen(0x6bffb0, true);
      addToast('断层突破 // 出口接入完成', 'good');
      showOverlay('won');
    }

    function fmtTime(sec) {
      var s = Math.max(0, Math.floor(sec));
      var m = Math.floor(s / 60);
      var r = s % 60;
      return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }

    function progressText() {
      if (bossDefeated) return '出口';
      if (flow.bossActive) return 'BOSS';
      if (flow.wave === 2) return 'WAVE 02';
      return 'WAVE 01';
    }

    function statCell(label, value, cls) {
      return '<div class="stat ' + (cls || '') + '"><span>' + label + '</span><strong>' +
        value + '</strong></div>';
    }

    function showOverlay(kind) {
      overlay.hidden = false;
      panel.style.animation = 'none';
      void panel.offsetWidth;
      panel.style.animation = '';

      var stats = statCell('用时 / TIME', fmtTime(runTime)) +
        statCell('击杀 / KILLS', String(kills).padStart(2, '0')) +
        statCell('进度 / PROGRESS', progressText(), bossDefeated ? 'is-good' : 'is-accent');

      ui.ovControls.hidden = kind !== 'menu';
      ui.ovStats.hidden = kind === 'menu';
      ui.ovStats.innerHTML = stats;
      ui.ovBtn.className = 'panel-btn';

      if (kind === 'menu') {
        ui.ovKicker.textContent = 'BREACH PROTOCOL // 断层级指令';
        ui.ovTitle.innerHTML = 'PIXEL<span>//</span>BREACH';
        ui.ovSub.textContent = '断 层 突 围';
        ui.ovDesc.textContent = '断层设施已失守。穿过两波封锁，拆掉零号守门者的核心，然后从出口撤离。鼠标会被锁定，WASD 移动，左键攻击。';
        ui.ovBtn.innerHTML = '开始突入 <kbd>ENTER</kbd>';
        ui.ovFoot.textContent = '点击开始 · 浏览器会锁定鼠标指针';
      } else if (kind === 'paused') {
        ui.ovKicker.textContent = 'LINK FROZEN // 链路冻结';
        ui.ovTitle.textContent = 'PAUSED';
        ui.ovSub.textContent = '链 路 冻 结';
        ui.ovDesc.textContent = '鼠标已释放，模拟暂停。按 Enter 或点击按钮继续突入。';
        ui.ovBtn.innerHTML = '继续突入 <kbd>ENTER</kbd>';
        ui.ovFoot.textContent = 'ESC 暂停并释放指针锁定';
      } else if (kind === 'won') {
        ui.ovKicker.textContent = 'BREACH COMPLETE // 断层已突破';
        ui.ovTitle.textContent = 'ESCAPED';
        ui.ovSub.textContent = '断 层 已 突 破';
        ui.ovDesc.textContent = '零号守门者已解体，出口链路恢复。你的信号离开了断层设施。';
        ui.ovBtn.innerHTML = '再次突入 <kbd>ENTER</kbd>';
        ui.ovBtn.classList.add('is-ready');
        ui.ovFoot.textContent = '数据回收完成 // 无异常残留';
      } else {
        ui.ovKicker.textContent = 'SIGNAL LOST // 作战失败';
        ui.ovTitle.textContent = 'FLATLINE';
        ui.ovSub.textContent = '信 号 中 断';
        ui.ovDesc.textContent = '生命体征归零，断层设施重新封闭。检查武器与技能冷却，再试一次。';
        ui.ovBtn.innerHTML = '重新连接 <kbd>ENTER</kbd>';
        ui.ovBtn.classList.add('is-danger');
        ui.ovFoot.textContent = 'Enter 重新突入 // 进度将重置';
      }
    }

    /* ----------------------------------------------------------------- hud */

    function updateHud() {
      if (!ui || !ui.hpText) return;

      var count = flow.bossActive ? enemies.length : enemies.length + pending.length;
      setText(ui.enemyCount, '敌人 ' + String(count).padStart(2, '0'));

      if (flow.bossActive || bossEverSpawned) {
        setText(ui.waveLabel, 'BOSS // 00');
      } else if (flow.wave > 0) {
        setText(ui.waveLabel, 'WAVE 0' + flow.wave);
      } else {
        setText(ui.waveLabel, 'STANDBY');
      }

      var hpPct = clamp(player.hp / player.maxHp, 0, 1) * 100;
      ui.hpFill.style.width = hpPct.toFixed(1) + '%';
      ui.hpFill.classList.toggle('is-low', hpPct <= 30);
      setText(ui.hpText, String(Math.ceil(player.hp)).padStart(3, '0'));

      var dashReady = player.dashCd <= 0;
      ui.dashAbility.classList.toggle('is-ready', dashReady);
      ui.dashAbility.classList.toggle('is-cooling', !dashReady);
      ui.dashFill.style.width = ((1 - player.dashCd / 3) * 100).toFixed(1) + '%';
      setText(ui.dashCd, dashReady ? '就绪' : player.dashCd.toFixed(1) + 's');

      var pulseReady = player.pulseCd <= 0;
      ui.pulseAbility.classList.toggle('is-ready', pulseReady);
      ui.pulseAbility.classList.toggle('is-cooling', !pulseReady);
      ui.pulseFill.style.width = ((1 - player.pulseCd / 8) * 100).toFixed(1) + '%';
      setText(ui.pulseCd, pulseReady ? '就绪' : player.pulseCd.toFixed(1) + 's');

      var w = currentGun();
      var d = w.def;
      setText(ui.weaponSlot, d.slot);
      setText(ui.weaponName, d.name);
      setText(ui.weaponEn, d.en);
      if (d.melee) {
        setText(ui.ammoMag, '∞');
        setText(ui.ammoReserve, '—');
        ui.ammoMag.classList.remove('is-low');
      } else {
        setText(ui.ammoMag, String(w.mag));
        setText(ui.ammoReserve, String(w.reserve));
        ui.ammoMag.classList.toggle('is-low', w.mag <= Math.ceil(d.magSize * 0.25));
      }
      ui.reloadTag.hidden = w.reloading <= 0;

      for (var s = 0; s < ui.slots.length; s++) {
        ui.slots[s].classList.toggle('active', s === currentWeapon);
      }

      var showBoss = bossEverSpawned;
      ui.bossBar.hidden = !showBoss;
      if (showBoss) {
        var bhp = boss ? Math.max(0, boss.hp) : 0;
        ui.bossFill.style.width = ((bhp / 160) * 100).toFixed(1) + '%';
        setText(ui.bossHpText, Math.ceil(bhp) + ' / 160');
        if (boss) {
          setText(ui.bossPhase, 'PHASE ' + boss.phase);
          var state = 'CORE ONLINE';
          if (boss.invuln > 0) state = 'REBOOTING';
          else if (boss.shield > 0) state = 'SHIELD ACTIVE';
          else if (boss.exposed > 0) state = 'CORE EXPOSED';
          setText(ui.bossState, state);
          ui.bossBar.classList.toggle('is-shielded', boss.shield > 0);
          ui.bossBar.classList.toggle('is-exposed', boss.exposed > 0);
        } else {
          setText(ui.bossPhase, 'CORE OFFLINE');
          setText(ui.bossState, 'SECTOR CLEAR');
          ui.bossBar.classList.remove('is-shielded', 'is-exposed');
        }
      }

      var nearExit = dist2D(player.pos, exit.pos) < 4.3;
      var canShowHint = mode === 'playing' && nearExit;
      ui.hint.hidden = !canShowHint;
      if (canShowHint) {
        var msg = exit.unlocked
          ? '<kbd>E</kbd> 接入出口'
          : '<kbd>E</kbd> 出口锁定 // 击败守门者';
        if (ui.hint.__msg !== msg) {
          ui.hint.__msg = msg;
          ui.hint.innerHTML = msg;
        }
      }
    }

    /* ---------------------------------------------------------------- input */

    function clearInput() {
      input.keys = Object.create(null);
      input.fireHeld = false;
      input.fireQueued = false;
      input.sprint = false;
    }

    function requestLock() {
      pointerLocked = document.pointerLockElement === canvas;
      if (pointerLocked) return;
      if (lockPending) return;
      if (!canvas.requestPointerLock) {
        fallbackLook = true;
        return;
      }
      lockPending = true;
      try {
        var request = canvas.requestPointerLock();
        if (request && typeof request.catch === 'function') {
          request.catch(function () { lockPending = false; fallbackLook = true; });
        }
      } catch (err) {
        lockPending = false;
        fallbackLook = true;
      }
      setTimeout(function () {
        lockPending = false;
        if (mode === 'playing' && document.pointerLockElement !== canvas) {
          if (!fallbackLook) addToast('指针锁定未生效 // 使用自由视角', 'warn');
          fallbackLook = true;
        }
      }, 700);
    }

    function releaseLock() {
      lockPending = false;
      if (document.pointerLockElement === canvas && document.exitPointerLock) {
        document.exitPointerLock();
      }
    }

    function interactExit() {
      if (mode !== 'playing') return;
      if (dist2D(player.pos, exit.pos) > 4.3) return;
      if (!exit.unlocked) {
        addToast('出口锁定 // 击败零号守门者', 'warn');
        return;
      }
      winRun();
    }

    function onKeyDown(e) {
      var code = e.code;

      if (code === 'Escape') {
        if (mode === 'playing') {
          e.preventDefault();
          pauseGame();
        }
        return;
      }

      if (code === 'Enter') {
        e.preventDefault();
        if (mode === 'menu' || mode === 'won' || mode === 'lost') startRun();
        else if (mode === 'paused') resumeGame();
        return;
      }

      if (mode !== 'playing') return;
      if (code === 'Tab') {
        e.preventDefault();
        return;
      }

      input.keys[code] = true;
      if (code === 'ShiftLeft' || code === 'ShiftRight') input.sprint = true;

      if (e.repeat) return;

      if (code === 'KeyR') startReload();
      else if (code === 'KeyQ') tryDash();
      else if (code === 'KeyF') tryPulse();
      else if (code === 'KeyE') interactExit();
      else if (code === 'Digit1' || code === 'Numpad1') switchWeapon(0);
      else if (code === 'Digit2' || code === 'Numpad2') switchWeapon(1);
      else if (code === 'Digit3' || code === 'Numpad3') switchWeapon(2);

      if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' || code === 'Space') {
        e.preventDefault();
      }
    }

    function onKeyUp(e) {
      var code = e.code;
      if (input.keys[code]) delete input.keys[code];
      if (code === 'ShiftLeft' || code === 'ShiftRight') input.sprint = false;
    }

    function onMouseMove(e) {
      if (mode !== 'playing') return;
      if (!pointerLocked && !fallbackLook) return;
      var mx = e.movementX || 0;
      var my = e.movementY || 0;
      if (Math.abs(mx) > 180) mx = 0;
      if (Math.abs(my) > 180) my = 0;
      player.yaw -= mx * SENS;
      player.pitch = clamp(player.pitch - my * SENS, -1.35, 1.35);
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      if (mode === 'playing') {
        if (!pointerLocked && !fallbackLook) requestLock();
        input.fireHeld = true;
        input.fireQueued = true;
        e.preventDefault();
      }
    }

    function onMouseUp(e) {
      if (e.button === 0) {
        input.fireHeld = false;
        input.fireQueued = false;
      }
    }

    function onPointerLockChange() {
      lockPending = false;
      pointerLocked = document.pointerLockElement === canvas;
      if (pointerLocked) fallbackLook = false;
      else if (mode === 'playing' && !fallbackLook) pauseGame();
    }

    function onPointerLockError() {
      lockPending = false;
      fallbackLook = true;
      if (mode === 'playing') addToast('指针锁定失败 // 使用自由视角', 'warn');
    }

    /* --------------------------------------------------------------- menu */

    var menuT = 0;
    var worldClock = 0;

    function updateMenu(dt) {
      menuT += dt;
      // Stay inside the room (ceiling is at y=4.5, walls at x=±21 / z=±17).
      var r = 13.6;
      camera.position.set(
        Math.sin(menuT * 0.09) * r,
        3.35 + Math.sin(menuT * 0.23) * 0.35,
        Math.cos(menuT * 0.09) * r
      );
      aimCameraAt(new THREE.Vector3(0, 1.7, 0));
      if (Math.abs(camera.fov - 66) > 0.01) {
        camera.fov = 66;
        camera.updateProjectionMatrix();
      }
    }

    // Conservative region bounce: keep the ambient intensity stable and only
    // nudge its hue so the additive pools read as local colour instead of
    // fighting a globally blue fill.  One shared Color instance, no per-frame
    // allocation.
    function updateRegionAmbient(dt) {
      var hex = ambientTint.baseHex;
      var intensity = 1.05;
      var px = camera.position.x;
      var pz = camera.position.z;
      var phase = arenaMood ? arenaMood.phase : 0;
      var nearExit = dist2D(camera.position, exit.pos) < 4.8;

      if (nearExit) {
        hex = exit.unlocked ? 0x466d5c : 0x5c4650;
        intensity = 1.04;
      } else if (pz > 7.5) {
        // Cold cyan entry fill; the warm maintenance lamps stay as accents.
        hex = 0x426f86;
        intensity = 1.04;
      } else if (Math.abs(px) > 14.5 && pz > -14.2) {
        hex = 0x655042;
        intensity = 1.02;
      } else if (pz < -6.5) {
        if (phase === 2) hex = 0x6a5a3f;
        else if (phase === 3) hex = 0x653b3b;
        else if (phase === 4) hex = 0x456d5c;
        else hex = 0x42607a;
        intensity = 1.03;
      } else {
        hex = 0x486b86;
        intensity = 1.05;
      }

      ambientTint.target.setHex(hex);
      var k = 1 - Math.exp(-Math.max(0, dt) * 1.8);
      ambientLight.color.lerp(ambientTint.target, k);
      ambientLight.intensity += (intensity - ambientLight.intensity) * k;
    }

    function updateAmbient(dt) {
      updateRegionAmbient(dt);
      for (var i = 0; i < motes.length; i++) {
        var m = motes[i];
        m.mesh.position.x = m.baseX + Math.sin(worldClock * m.speed * 0.3 + m.phase) * m.amp;
        m.mesh.position.y = m.baseY + Math.sin(worldClock * m.speed * 0.5 + m.phase) * 0.35;
        m.mesh.position.z = m.baseZ + Math.cos(worldClock * m.speed * 0.25 + m.phase) * m.amp;
      }
      for (i = 0; i < zoneGlowMats.length; i++) {
        var zg = zoneGlowMats[i];
        zg.mat.opacity = zg.base * (0.84 + 0.16 * (0.5 + 0.5 * Math.sin(worldClock * zg.speed + zg.phase)));
      }
      if (exit.ring) {
        exit.ring.rotation.z = Math.sin(worldClock * 0.9) * 0.12;
      }
      if (exit.glowMat) {
        exit.glowMat.opacity = (exit.unlocked ? 0.26 : 0.1) +
          Math.sin(worldClock * 2.2) * 0.035;
      }
      if (exit.haloMat) {
        exit.haloMat.opacity = (exit.unlocked ? 0.24 : 0.1) +
          Math.sin(worldClock * 2.6 + 0.8) * 0.025;
      }
      if (exit.floorMat) {
        exit.floorMat.opacity = (exit.unlocked ? 0.16 : 0.055) +
          Math.sin(worldClock * 2.4 + 1.4) * 0.02;
      }
      updateContactShadows();
      updateLocalLightRig();
      updateCinematicVolumes();
      updateReflectionStrips();
      updateArenaFx(dt);
    }

    /* ----------------------------------------------------------------- loop */

    function frame(ts) {
      requestAnimationFrame(frame);
      if (!lastTs) lastTs = ts;
      var dt = (ts - lastTs) / 1000;
      lastTs = ts;
      if (!isFinite(dt) || dt < 0) dt = 0;
      dt = Math.min(dt, 0.05);
      worldClock += dt;

      if (mode === 'playing') {
        gameTime += dt;
        runTime += dt;

        updatePending(dt);
        updatePlayer(dt);
        updateWeapons(dt);
        updateFlow(dt);
        updateEnemies(dt);
        updateBoss(dt);
        updateBullets(dt);
        updateDeflects(dt);
        updateMissiles(dt);
        updateLasers(dt);
        updateShockwaves(dt);
        updateTelegraphs(dt);
        updateParticles(dt);
        updateTracers(dt);
        updateRings(dt);
        updateHud();
      } else if (mode === 'menu') {
        updateMenu(dt);
        updateRings(dt);
        updateParticles(dt);
      } else if (mode === 'won' || mode === 'lost') {
        updateRings(dt);
        updateParticles(dt);
      }

      updateSparks(dt);
      updateBulletTrails(dt);
      updateAmbient(dt);
      renderer.render(scene, camera);
    }

    /* --------------------------------------------------------------- wiring */

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    window.addEventListener('blur', function () {
      clearInput();
      if (mode === 'playing') pauseGame();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        clearInput();
        if (mode === 'playing') pauseGame();
      }
    });
    window.addEventListener('contextmenu', function (e) {
      if (e.target === canvas || (stage && stage.contains(e.target))) e.preventDefault();
    });
    stage.addEventListener('click', function () {
      if (mode === 'playing' && !pointerLocked && !fallbackLook) requestLock();
    });
    ui.ovBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (mode === 'menu' || mode === 'won' || mode === 'lost') startRun();
      else if (mode === 'paused') resumeGame();
    });

    if (stage) stage.style.userSelect = 'none';
    if (fatalBox) fatalBox.hidden = true;
    if (canvas) {
      canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        fallbackLook = true;
        if (mode === 'playing') pauseGame();
        addToast('WebGL 上下文丢失 // 刷新重试', 'danger');
      });
    }

    /* ---------------------------------------------------------------- boot */

    // Read-only development hook used for smoke checks.  It allocates only when
    // snapshot() is called and never touches the HUD or gameplay state.
    window.__PB_LIGHTING__ = {
      maxLocalLights: THREE.MAX_LOCAL_LIGHTS || 5,
      shadowSlots: CONTACT_SHADOW_LIMIT,
      snapshot: function () {
        var out = [];
        for (var i = 0; i < localLights.length; i++) {
          var e = localLights[i];
          out.push({
            key: e.key,
            visible: e.light.visible,
            intensity: Math.round(e.light.intensity * 1000) / 1000,
            distance: e.light.distance,
            x: Math.round(e.light.position.x * 1000) / 1000,
            y: Math.round(e.light.position.y * 1000) / 1000,
            z: Math.round(e.light.position.z * 1000) / 1000
          });
        }
        return out;
      }
    };

    // Read-only development snapshot for the V3 cinematic FX layer.  It never
    // exposes a gameplay toggle and only allocates when a reviewer calls it.
    window.__PB_CINEMATIC_FX__ = {
      version: 3,
      caps: {
        bulletVisuals: MAX.bullets,
        bulletTrails: BULLET_TRAIL_LIMIT,
        tracers: MAX.tracers,
        hitSparks: SPARK_LIMIT,
        rings: MAX.rings,
        telegraphs: MAX.telegraphs,
        lasers: MAX.lasers,
        shockwaves: MAX.shockwaves,
        volumetricBeams: VOLUME_BEAM_LIMIT,
        reflectionStrips: REFLECTION_STRIP_LIMIT,
        particles: MAX.particles,
        localLights: THREE.MAX_LOCAL_LIGHTS || 5,
        shadowSlots: CONTACT_SHADOW_LIMIT
      },
      snapshot: function () {
        var activeSparks = 0;
        var activeTrails = 0;
        var activeVolumes = 0;
        var activeStrips = 0;
        var activeTracers = 0;
        var activeRings = 0;
        var i;
        for (i = 0; i < sparkFxPool.length; i++) if (sparkFxPool[i].alive) activeSparks++;
        for (i = 0; i < bulletTrailPool.length; i++) if (bulletTrailPool[i].owner) activeTrails++;
        for (i = 0; i < tracerFxPool.length; i++) if (tracerFxPool[i].alive) activeTracers++;
        for (i = 0; i < ringFxPool.length; i++) if (ringFxPool[i].alive) activeRings++;
        for (i = 0; i < volumetricBeams.length; i++) if (volumetricBeams[i].group.visible) activeVolumes++;
        for (i = 0; i < reflectionStrips.length; i++) if (reflectionStrips[i].mesh.visible) activeStrips++;
        return {
          mode: mode,
          bullets: bullets.length,
          tracers: activeTracers,
          sparks: activeSparks,
          bulletTrails: activeTrails,
          rings: activeRings,
          lasers: lasers.length,
          laserPhase: lasers.length ? lasers[0].phase : 0,
          shockwaves: shockwaves.length,
          telegraphs: telegraphs.length,
          volumetricBeams: activeVolumes,
          reflectionStrips: activeStrips,
          localLights: localLights.length,
          shadowSlots: CONTACT_SHADOW_LIMIT,
          batches: batchList.length,
          volumesBuilt: volumetricBeams.length,
          stripsBuilt: reflectionStrips.length
        };
      }
    };

    buildArena();
    resetRunState();
    hud.classList.add('is-hidden');
    showOverlay('menu');
    updateMenu(0);
    updateAmbient(0);
    lastTs = performance.now();
    requestAnimationFrame(frame);
  }
})();
