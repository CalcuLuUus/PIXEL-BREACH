/* ==========================================================================
   PIXEL//BREACH — 断层突围
   A 3D realistic first-person dockyard breach demo.

   Rendering : High 1920x1080 / Balanced 1600x900 / Fallback 960x540
               internal backbuffer (16:9) with bounded dynamic resolution,
               presented smoothly to the viewport; WebGL1 picks a
               uniform-budget-safe forward shader and light count at startup
   Assets    : local procedural meshes, surface layers, decals and Web Audio
   Network   : none. vendor/three.min.js is a local offline build.
   ========================================================================== */

(function () {
  'use strict';

  var VENDOR_SRC = 'vendor/three.min.js';
  // Actual values are assigned from the selected quality profile in start().
  // They are never larger than the backend's reported viewport limits.
  var RES_W = 960;
  var RES_H = 540;

  function byId(id) {
    return document.getElementById(id);
  }

  function fatal(message) {
    var box = byId('fatal');
    var text = byId('fatalText');
    if (text && message) text.textContent = message;
    if (box) box.hidden = false;
    byId('loadingStatus').hidden = true;
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
    byId('reloadGame').addEventListener('click', function () { window.location.reload(); });
    loadVendor().then(start).catch(function (err) {
      console.error('[PIXEL//BREACH]', err);
      fatal('本地资源或 3D 初始化失败：' + (err?.message || String(err)));
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
      sectorTag: byId('sectorTag'),
      waveLabel: byId('waveLabel'),
      enemyCount: byId('enemyCount'),
      supplyPanel: byId('supplyPanel'),
      supplyName: byId('supplyName'),
      supplyFill: byId('supplyFill'),
      supplyState: byId('supplyState'),
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
      moveState: byId('moveState'),
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

    var params = new URLSearchParams(window.location.search);
    var settings = PBSettings.load();
    var events = PBEvents.create();
    // Every generated mesh, material, texture and audio system is local, but it
    // still needs an accountable owner.  The registry makes those resources
    // inspectable without changing the renderer's allocation strategy.
    var assets = window.PBAssets ? PBAssets.create() : null;
    var toolsMode = PBBenchmark.options(params);
    var seed = toolsMode.seed;
    var gameplayRandom = seed === null ? Math.random : PBEvents.rng(seed);
    var visualRandom = seed === null ? Math.random : PBEvents.rng(seed ^ 0xa53d19);
    var qualityOverride = (params.get('quality') || '').toLowerCase();
    var hasQualityOverride = Object.prototype.hasOwnProperty.call(PBQuality.profiles, qualityOverride);
    var qualityRequested = hasQualityOverride ? qualityOverride : settings.quality;

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        quality: qualityRequested,
        shadowQuality: settings.shadows,
        reflectionMode: settings.reflections
      });
    } catch (err) {
      console.error('[PIXEL//BREACH] renderer', err);
      fatal('无法初始化 WebGL 渲染器：' + (err && err.message ? err.message : String(err)));
      return;
    }

    var qualitySelection;
    try {
      qualitySelection = PBQuality.configure(renderer, qualityRequested);
    } catch (error) {
      fatal('渲染目标不可用：' + error.message);
      return;
    }
    var selectedProfile = qualitySelection.profile;
    var qualityHud = byId('qualityHud');
    var qualityNames = { high: '高', balanced: '均衡', fallback: '兼容' };
    qualityHud.dataset.profile = renderer.quality;
    qualityHud.hidden = false;
    function updateQualityHud() {
      qualityHud.textContent = '画质 · ' + qualityNames[renderer.quality] + ' · ' + RES_H + 'p';
      qualityHud.title = renderer.quality === qualityRequested
        ? '当前渲染分辨率 ' + RES_W + '×' + RES_H
        : '已自动降档。' + qualitySelection.reason;
    }
    var exposureOverride = params.has('exposure') ? Number(params.get('exposure')) : NaN;
    RES_W = qualitySelection.size.width;
    RES_H = qualitySelection.size.height;
    updateQualityHud();

    var dynamicResolution = PBResolution.create(selectedProfile.scaleMin, 1, settings.dynamic && !toolsMode.fixed,
      function (scale) {
        var size = PBQuality.resolution(renderer, selectedProfile, scale);
        if (!renderer.setSize(size.width, size.height)) return false;
        RES_W = size.width;
        RES_H = size.height;
        updateQualityHud();
        return true;
      });
    dynamicResolution.configure(settings.dynamic && !toolsMode.fixed, toolsMode.scale ?? settings.scale);

    var highVisuals = renderer.profile.highVisuals;
    try {
      if (document.body) document.body.classList.add('render-' + selectedProfile.name);
      if (canvas) canvas.setAttribute('data-quality', selectedProfile.name);
    } catch (errClass) { /* presentation class is optional */ }

    var QUALITY = {
      requested: qualityRequested,
      name: selectedProfile.name,
      backend: renderer.backend,
      width: RES_W,
      height: RES_H,
      baseWidth: selectedProfile.width,
      baseHeight: selectedProfile.height,
      renderScaleMin: selectedProfile.scaleMin,
      renderScaleMax: selectedProfile.scaleMax,
      reason: qualitySelection.reason,
      degraded: selectedProfile.name !== qualityRequested,
      shaderVariant: renderer.profile.shaderVariant || 'full',
      maxLocalLights: Math.min(renderer.maxLocalLights, selectedProfile.maxLocalLights),
      visualDetail: selectedProfile.visualDetail,
      textureMix: selectedProfile.textureMix,
      extraDetail: selectedProfile.extraDetail,
      contactShadows: selectedProfile.contactShadows
    };

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1228);
    scene.fog = new THREE.Fog(0x744353, 22, 92);

    var camera = new THREE.PerspectiveCamera(settings.fov, RES_W / RES_H, 0.06, 160);
    scene.add(camera);

    // Natural dusk fill: cool enough to separate shadowed steel, but not the
    // saturated blue/purple wash that made the previous pass look synthetic.
    var duskFill = highVisuals ? 0x52606b : 0x46545f;
    var ambientLight = new THREE.AmbientLight(duskFill, highVisuals ? 0.88 : 0.94);
    scene.add(ambientLight);
    var ambientTint = {
      target: new THREE.Color(duskFill),
      baseHex: duskFill
    };
    var sun = new THREE.DirectionalLight(highVisuals ? 0xe1a16f : 0xd39468, highVisuals ? 2.35 : 1.30);
    sun.position.set(-0.50, 0.245, -0.86);
    scene.add(sun);

    /* ------------------------------------------------------------- palette */

    var C = {
      cyan: 0x79c8cf,
      cyanDim: 0x315b63,
      magenta: 0xb75a7e,
      violet: 0x766b9b,
      amber: 0xd2a15d,
      red: 0xc9575e,
      green: 0x79b99a,
      sunset: 0xd98450,
      horizon: 0xb96c5e,
      dusk: 0x5d596d,
      water: 0x203444,
      floor: 0x343536,
      wall: 0x3c4143,
      wallDark: 0x272d30,
      steel: 0x59636a,
      gun: 0x8b9ca4
    };

    // Shared 4x2 surface-atlas slots.  Every material points at one of these;
    // the atlas itself is one Canvas2D image uploaded once by the renderer.
    var DETAIL_TILE = {
      metal: 0,
      rust: 1,
      concrete: 2,
      wood: 3,
      paint: 4,
      chips: 5,
      water: 6,
      grime: 7
    };

    function matBasic(hex, opts) {
      var o = opts ? Object.assign({}, opts) : {};
      o.color = hex;
      return new THREE.MeshBasicMaterial(o);
    }

    function matLambert(hex, opts) {
      var o = opts ? Object.assign({}, opts) : {};
      o.color = hex;
      // V7 uses the renderer's metallic-roughness material class.  The High
      // path shades it with a GGX/Smith/Schlick BRDF inside linear space;
      // WebGL1 keeps the compatible forward path.
      return new THREE.MeshStandardMaterial(o);
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

    var MODELS = PBModelKit.create(THREE);
    if (assets) {
      assets.register('models', 'dockyard-kit', MODELS, { type: 'procedural-models', local: true });
    }
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
     * Industrial dockyard kit (V7 realistic proportions)
     *
     * The local renderer is the project's Three.js-compatible subset.  Surface
     * patterns are generated into tiny local Canvas2D atlases.  Sparse patterns
     * are baked into merged low-poly "pixel chips"; V5.1 additionally uploads
     * one shared surface atlas for real triplanar sampler detail.  Both paths
     * stay fully offline and deterministic.
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
      steel: matLambert(0x56636e, { specular: 0.56, roughness: 0.32, specularColor: 0xffd9b8 }),
      steel2: matLambert(0x74808a, { specular: 0.68, roughness: 0.26, specularColor: 0xffe2c4 }),
      steelDark: matLambert(0x343d45, { specular: 0.38, roughness: 0.42, specularColor: 0xffc9a0 }),
      steelDeep: matLambert(0x20272e, { specular: 0.24, roughness: 0.54, specularColor: 0xffc090 }),
      concrete: matLambert(0x6a6b62, { specular: 0.08, roughness: 0.88, specularColor: 0xffd0a8 }),
      concrete2: matLambert(0x7a7b72, { specular: 0.1, roughness: 0.84, specularColor: 0xffd0a8 }),
      concreteDark: matLambert(0x4a4c46, { specular: 0.07, roughness: 0.9, specularColor: 0xffc89c }),
      concreteLight: matLambert(0x8a8a80, { specular: 0.13, roughness: 0.8, specularColor: 0xffd8b0 }),
      rust: matLambert(0x8b4c30, { specular: 0.2, roughness: 0.72, specularColor: 0xffbb80 }),
      rustDark: matLambert(0x583226, { specular: 0.14, roughness: 0.8, specularColor: 0xffa070 }),
      rustLight: matLambert(0xad663d, { specular: 0.26, roughness: 0.66, specularColor: 0xffcf9a }),
      copper: matLambert(0x9a6d3f, { specular: 0.72, roughness: 0.28, specularColor: 0xffd6a0 }),
      brass: matLambert(0xa98b4a, { specular: 0.68, roughness: 0.3, specularColor: 0xffe3b0 }),
      black: matLambert(0x101518, { specular: 0.12, roughness: 0.58 }),
      cable: matLambert(0x171c20, { specular: 0.18, roughness: 0.55 }),
      oil: matLambert(0x1e2321, { specular: 0.3, roughness: 0.28 }),
      // Safety paint is weathered ochre rather than UI-yellow; energy colours
      // remain reserved for gameplay-critical devices and combat feedback.
      hazard: matBasic(0xb38d3c),
      hazardDark: matBasic(0x262722),
      white: matBasic(0xc8c7bd),
      redPaint: matBasic(0x87453e),
      greenPaint: matBasic(0x4d6956),
      screen: matBasic(0x4d9690),
      lampCool: matBasic(0xb6c9c5),
      lampWarm: matBasic(0xe0bd86),
      lampRed: matBasic(0xb95f54),
      fxLine: matBasic(0x5aa6ad),
      fxPylon: matBasic(0x4b9ca1),
      fxAlarm: matBasic(0xc25a4f),

      // Outdoor dockyard palette.  Container paint is deliberately muted so
      // the low sun and blue dusk fill still carry the colour, while the
      // silhouettes stay readable at every internal resolution.
      // Desaturated mineral colours let the sunset and work lamps provide the
      // contrast; props no longer read as individually emissive toy blocks.
      asphalt: matLambert(0x292c30, { specular: 0.14, roughness: 0.82, specularColor: 0xc5b39a }),
      asphaltWarm: matLambert(0x363331, { specular: 0.16, roughness: 0.78, specularColor: 0xc0a68b }),
      quay: matLambert(0x55544f, { specular: 0.07, roughness: 0.92, specularColor: 0xc8c0ae }),
      containerRed: matLambert(0x713c38, { specular: 0.18, roughness: 0.68, specularColor: 0xbcae9d }),
      containerBlue: matLambert(0x294b5b, { specular: 0.19, roughness: 0.67, specularColor: 0xbcae9d }),
      containerGreen: matLambert(0x354f42, { specular: 0.16, roughness: 0.71, specularColor: 0xbcae9d }),
      containerOrange: matLambert(0x785031, { specular: 0.19, roughness: 0.66, specularColor: 0xbcae9d }),
      containerPurple: matLambert(0x51495a, { specular: 0.16, roughness: 0.71, specularColor: 0xbcae9d }),
      containerTeal: matLambert(0x315455, { specular: 0.18, roughness: 0.68, specularColor: 0xbcae9d }),
      water: matLambert(0x142c3b, { specular: 0.66, roughness: 0.26, specularColor: 0xb9ae9b }),
      waterGlint: matBasic(0xd5a071, {
        transparent: true, opacity: 0.075, blending: 'additive', depthWrite: false, fog: false
      }),
      fenceDark: matLambert(0x2b2f33, { specular: 0.34, roughness: 0.5 }),

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
      glowWarm: matBasic(0xd08b55, {
        transparent: true, opacity: 0.026, blending: 'additive', depthWrite: false, fog: false
      }),
      glowWarmCore: matBasic(0xe0b783, {
        transparent: true, opacity: 0.052, blending: 'additive', depthWrite: false, fog: false
      }),
      glowRust: matBasic(0xb45d42, {
        transparent: true, opacity: 0.024, blending: 'additive', depthWrite: false, fog: false
      }),
      glowRustCore: matBasic(0xc28b6f, {
        transparent: true, opacity: 0.046, blending: 'additive', depthWrite: false, fog: false
      }),
      glowCool: matBasic(0x4e8f98, {
        transparent: true, opacity: 0.022, blending: 'additive', depthWrite: false, fog: false
      }),
      glowCoolCore: matBasic(0x8bb7b4, {
        transparent: true, opacity: 0.045, blending: 'additive', depthWrite: false, fog: false
      }),

      // Pseudo-reflections: long, directional additive slivers baked on the
      // floor and walls.  They read like blurred source colour bouncing off
      // wet metal, but they are ordinary merged geometry, not SSR/RT.
      reflectWarm: matBasic(0xffa95c, {
        transparent: true, opacity: 0.075, blending: 'additive', depthWrite: false, fog: false
      }),
      reflectCool: matBasic(0x79b9bb, {
        transparent: true, opacity: 0.032, blending: 'additive', depthWrite: false, fog: false
      }),
      reflectRust: matBasic(0xff6a3d, {
        transparent: true, opacity: 0.07, blending: 'additive', depthWrite: false, fog: false
      }),
      reflectBoss: matBasic(0xb75a7e, {
        transparent: true, opacity: 0.04, blending: 'additive', depthWrite: false, fog: false
      }),
      reflectExit: matBasic(0xff4d6d, {
        transparent: true, opacity: 0.07, blending: 'additive', depthWrite: false, fog: false
      })
    };

    // V7 surface tuning.  Every value is a shared material property, set once
    // before the scene is built.  AO attenuates indirect fill, metalness drives
    // the F0/Fresnel response and `detail` is now a very faint micro-variation
    // instead of a visible pixel grain.
    function tuneSurface(mat, ao, metalness, detail) {
      if (!mat) return;
      mat.ao = ao;
      mat.metalness = metalness;
      mat.detail = detail * 0.3;
    }

    // Tags a shared material with an atlas slot + surface tiling.  The
    // per-quality texture mix is applied here at startup; no material or
    // texture object is created later.
    function tuneTexture(mat, tile, scale, mix) {
      if (!mat) return;
      mat.textureTile = tile;
      // Slightly finer world-space tiling reads as material detail at 1080p
      // instead of chunky texels; mipmapping and anisotropic filtering keep it
      // stable with distance.
      mat.textureScale = scale * 1.3;
      mat.textureMix = Math.max(0, Math.min(1,
        mix * (QUALITY.textureMix === undefined ? 1 : QUALITY.textureMix)));
    }
    tuneSurface(IM.steel, 0.94, 0.68, 0.32);
    tuneSurface(IM.steel2, 0.96, 0.82, 0.28);
    tuneSurface(IM.steelDark, 0.9, 0.55, 0.4);
    tuneSurface(IM.steelDeep, 0.84, 0.45, 0.36);
    tuneSurface(IM.concrete, 0.88, 0.02, 0.72);
    tuneSurface(IM.concrete2, 0.9, 0.02, 0.68);
    tuneSurface(IM.concreteDark, 0.84, 0.02, 0.78);
    tuneSurface(IM.concreteLight, 0.92, 0.03, 0.62);
    tuneSurface(IM.rust, 0.86, 0.16, 0.82);
    tuneSurface(IM.rustDark, 0.82, 0.12, 0.86);
    tuneSurface(IM.rustLight, 0.86, 0.18, 0.76);
    tuneSurface(IM.copper, 0.92, 0.9, 0.24);
    tuneSurface(IM.brass, 0.9, 0.86, 0.22);
    tuneSurface(IM.black, 0.78, 0.2, 0.42);
    tuneSurface(IM.cable, 0.8, 0.15, 0.5);
    tuneSurface(IM.oil, 0.72, 0.38, 0.34);
    tuneSurface(IM.asphalt, 0.9, 0.08, 0.78);
    tuneSurface(IM.asphaltWarm, 0.9, 0.1, 0.74);
    tuneSurface(IM.quay, 0.88, 0.04, 0.66);
    tuneSurface(IM.containerRed, 0.9, 0.34, 0.6);
    tuneSurface(IM.containerBlue, 0.9, 0.36, 0.58);
    tuneSurface(IM.containerGreen, 0.9, 0.32, 0.62);
    tuneSurface(IM.containerOrange, 0.9, 0.34, 0.64);
    tuneSurface(IM.containerPurple, 0.9, 0.32, 0.6);
    tuneSurface(IM.containerTeal, 0.9, 0.34, 0.58);
    tuneSurface(IM.water, 0.72, 0.42, 0.18);
    tuneSurface(IM.fenceDark, 0.86, 0.45, 0.42);
    tuneSurface(MAT.wall, 0.9, 0.18, 0.5);
    tuneSurface(MAT.wallDark, 0.86, 0.15, 0.52);
    tuneSurface(MAT.floor, 0.88, 0.24, 0.6);
    tuneSurface(MAT.ceiling, 0.7, 0.08, 0.3);
    tuneSurface(MAT.cover, 0.86, 0.4, 0.38);

    // V5.1 sampler assignments.  These are shared material tags, not extra
    // textures: the renderer binds one atlas and each draw selects a tile.
    tuneTexture(IM.steel, DETAIL_TILE.metal, 0.55, 0.85);
    tuneTexture(IM.steel2, DETAIL_TILE.metal, 0.62, 0.9);
    tuneTexture(IM.steelDark, DETAIL_TILE.metal, 0.58, 0.8);
    tuneTexture(IM.steelDeep, DETAIL_TILE.metal, 0.66, 0.7);
    tuneTexture(IM.concrete, DETAIL_TILE.concrete, 0.28, 0.85);
    tuneTexture(IM.concrete2, DETAIL_TILE.concrete, 0.25, 0.8);
    tuneTexture(IM.concreteDark, DETAIL_TILE.concrete, 0.31, 0.9);
    tuneTexture(IM.concreteLight, DETAIL_TILE.concrete, 0.23, 0.75);
    tuneTexture(IM.rust, DETAIL_TILE.rust, 0.66, 0.9);
    tuneTexture(IM.rustDark, DETAIL_TILE.rust, 0.72, 0.9);
    // rustLight is the shared warm-brown material used by pallet planks and
    // timber trim, so it carries the wood tile; the darker rust materials keep
    // the pitted-metal tile.
    tuneTexture(IM.rustLight, DETAIL_TILE.wood, 0.62, 0.72);
    tuneTexture(IM.copper, DETAIL_TILE.metal, 0.78, 0.6);
    tuneTexture(IM.brass, DETAIL_TILE.metal, 0.74, 0.6);
    tuneTexture(IM.black, DETAIL_TILE.chips, 0.9, 0.4);
    tuneTexture(IM.cable, DETAIL_TILE.grime, 1.0, 0.4);
    tuneTexture(IM.oil, DETAIL_TILE.grime, 0.7, 0.5);
    tuneTexture(IM.asphalt, DETAIL_TILE.concrete, 0.33, 0.9);
    tuneTexture(IM.asphaltWarm, DETAIL_TILE.concrete, 0.3, 0.85);
    tuneTexture(IM.quay, DETAIL_TILE.concrete, 0.42, 0.8);
    tuneTexture(IM.containerRed, DETAIL_TILE.paint, 0.42, 0.8);
    tuneTexture(IM.containerBlue, DETAIL_TILE.paint, 0.42, 0.8);
    tuneTexture(IM.containerGreen, DETAIL_TILE.paint, 0.42, 0.8);
    tuneTexture(IM.containerOrange, DETAIL_TILE.paint, 0.42, 0.8);
    tuneTexture(IM.containerPurple, DETAIL_TILE.paint, 0.42, 0.8);
    tuneTexture(IM.containerTeal, DETAIL_TILE.paint, 0.42, 0.8);
    tuneTexture(IM.water, DETAIL_TILE.water, 0.18, 0.75);
    tuneTexture(IM.fenceDark, DETAIL_TILE.metal, 0.7, 0.7);
    tuneTexture(MAT.wall, DETAIL_TILE.concrete, 0.36, 0.7);
    tuneTexture(MAT.wallDark, DETAIL_TILE.concrete, 0.4, 0.6);
    tuneTexture(MAT.floor, DETAIL_TILE.concrete, 0.38, 0.85);
    tuneTexture(MAT.ceiling, DETAIL_TILE.metal, 0.55, 0.35);
    tuneTexture(MAT.cover, DETAIL_TILE.metal, 0.45, 0.6);

    {
      IM.cranePaint = matLambert(0x856b3b, { roughness: 0.62, specular: 0.32, metalness: 0.28, ao: 0.94 });
      IM.craneIvory = matLambert(0x9b9b8c, { roughness: 0.58, specular: 0.30, metalness: 0.12 });
      IM.casting = matLambert(0x7f8987, { roughness: 0.42, specular: 0.42, metalness: 0.56 });
      IM.cabGlass = matLambert(0x25424a, { roughness: 0.22, specular: 0.74, metalness: 0.02, surfaceType: 3 });
      IM.wet = matLambert(0x20292e, { roughness: 0.20, specular: 0.58, ao: 0.88, bump: 0.45, surfaceType: 1 });
      IM.track = matLambert(0x24282a, { roughness: 0.94, specular: 0.04, ao: 0.91 });
      IM.stencil = matLambert(0xb5b1a2, { roughness: 0.88, specular: 0.08, bump: 0.4 });
      IM.railPaint = matLambert(0x9d823f, { roughness: 0.78, specular: 0.17, bump: 0.55 });
      IM.water.surfaceType = 2;
      IM.lampWarm.radiance = 1.8;
      IM.lampCool.radiance = 1.6;
      IM.lampRed.radiance = 1.9;
      IM.screen.radiance = 0.82;
      IM.fxLine.radiance = 1.15;
      IM.fxPylon.radiance = 1.45;
      IM.fxAlarm.radiance = 1.35;
      MAT.portalOpen.radiance = 1.45;
      MAT.portalLocked.radiance = 1.2;
      IM.containerRed.color.setHex(0x7c4945);
      IM.containerBlue.color.setHex(0x365968);
      IM.containerGreen.color.setHex(0x466052);
      IM.containerOrange.color.setHex(0x815d3c);
      IM.containerPurple.color.setHex(0x62596a);
      IM.containerTeal.color.setHex(0x3d6463);
      IM.asphalt.color.setHex(0x4b4d50);
      IM.asphaltWarm.color.setHex(0x57524c);
      IM.quay.color.setHex(0x6c6a63);
      IM.black.roughness = 0.94;
      IM.rustLight.roughness = 0.84;
      tuneTexture(IM.cranePaint, DETAIL_TILE.paint, 0.46, 0.94);
      tuneTexture(IM.craneIvory, DETAIL_TILE.paint, 0.52, 0.8);
      tuneTexture(IM.casting, DETAIL_TILE.chips, 0.84, 0.83);
      tuneTexture(IM.track, DETAIL_TILE.grime, 0.82, 0.88);
      tuneTexture(IM.stencil, DETAIL_TILE.paint, 0.76, 0.73);
      tuneTexture(IM.railPaint, DETAIL_TILE.paint, 0.55, 0.9);
      tuneTexture(IM.wet, DETAIL_TILE.water, 0.45, 0.81);
    }

    // V7 material library.  These names group the shared materials by the
    // physical surface they represent; the renderer resolves each group to a
    // different metallic/roughness/F0 response, so steel, concrete, timber,
    // rubber, glass and water are distinguishable under the same sunset light.
    var MATERIAL_LIBRARY = {
      wetSteel: [IM.steel2, IM.steel, highVisuals ? IM.wet : IM.asphaltWarm],
      paintedSteel: [IM.containerRed, IM.containerBlue, IM.containerGreen,
        IM.containerOrange, IM.containerPurple, IM.containerTeal,
        highVisuals ? IM.cranePaint : IM.steel],
      rustedSteel: [IM.rust, IM.rustDark, IM.rustLight],
      castIron: [IM.steelDark, IM.steelDeep, highVisuals ? IM.casting : IM.steelDark],
      concrete: [IM.concrete, IM.concrete2, IM.concreteDark, IM.concreteLight],
      asphalt: [IM.asphalt, IM.asphaltWarm],
      wood: [IM.rustLight],
      rubber: [IM.cable, IM.black],
      glass: [highVisuals ? IM.cabGlass : IM.steel2],
      water: [IM.water],
      energyCore: [IM.fxPylon, IM.fxLine],
      weaponFinish: [],
      enemyArmor: []
    };
    if (assets) {
      assets.register('materials', 'dockyard-surfaces', MATERIAL_LIBRARY,
        { type: 'procedural-material-library', quality: QUALITY.name, local: true });
    }

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

    function makePixelTexture(seed, palette, mode, sizeOverride) {
      var size = sizeOverride || 16;
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
      } else if (mode === 'sparse') {
        // Sparse "decal atlas": most texels use the last palette entry as a
        // transparency sentinel, so a shared atlas can add panel seams, rust
        // blooms and wear without repainting the whole surface.
        var skipEntry = palette[palette.length - 1];
        ctx.fillStyle = skipEntry.hex;
        ctx.fillRect(0, 0, size, size);
        for (x = 0; x < size; x += 8) {
          ctx.fillStyle = palette[1].hex;
          ctx.fillRect(x, 0, 1, size);
        }
        for (y = 0; y < size; y += 9) {
          ctx.fillStyle = palette[2].hex;
          ctx.fillRect(0, y, size, 1);
        }
        for (i = 0; i < 18; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * size);
          ctx.fillStyle = palette[i % 4 === 0 ? 4 : 0].hex;
          ctx.fillRect(x, y, 1 + Math.floor(rng() * 4), 1);
        }
        for (i = 0; i < 8; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * size);
          ctx.fillStyle = palette[3].hex;
          ctx.fillRect(x, y, 1 + Math.floor(rng() * 3), 1 + Math.floor(rng() * 2));
        }
        for (i = 0; i < 5; i++) {
          x = Math.floor(rng() * size);
          y = Math.floor(rng() * 8);
          ctx.fillStyle = palette[5].hex;
          ctx.fillRect(x, y, 1, 3 + Math.floor(rng() * 7));
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
      ], 'plate'),
      // V5 shared decal atlases.  These are painted sparsely over existing
      // surfaces; the last palette entry is a skip sentinel, so the atlas adds
      // seams, oil, rust blooms and chipped paint without replacing albedo.
      containerDetail: makePixelTexture(ART_SEED + 67, [
        { hex: '#343d45', key: 'steelDark' },
        { hex: '#20272e', key: 'steelDeep' },
        { hex: '#8b4c30', key: 'rust' },
        { hex: '#583226', key: 'rustDark' },
        { hex: '#1e2321', key: 'oil' },
        { hex: '#74808a', key: 'steel2' },
        { hex: '#ff00ff', key: null, skip: true }
      ], 'sparse', 32),
      dockDetail: makePixelTexture(ART_SEED + 79, [
        { hex: '#1e2321', key: 'oil' },
        { hex: '#20272e', key: 'steelDeep' },
        { hex: '#583226', key: 'rustDark' },
        { hex: '#8b4c30', key: 'rust' },
        { hex: '#56636e', key: 'steel' },
        { hex: '#74808a', key: 'steel2' },
        { hex: '#ff00ff', key: null, skip: true }
      ], 'sparse', 32),
      woodDetail: makePixelTexture(ART_SEED + 83, [
        { hex: '#ad663d', key: 'rustLight' },
        { hex: '#583226', key: 'rustDark' },
        { hex: '#8b4c30', key: 'rust' },
        { hex: '#74808a', key: 'steel2' },
        { hex: '#1e2321', key: 'oil' },
        { hex: '#ad663d', key: 'rustLight' },
        { hex: '#ff00ff', key: null, skip: true }
      ], 'sparse', 16)
    };
    if (assets) {
      assets.register('textures', 'dockyard-decals', TEX,
        { type: 'procedural-texture-set', local: true });
    }

    // V5.1 shared surface sampler.  A single 256x128 Canvas2D atlas holds eight
    // 64x64 tiles.  R is micro contrast, G is the metal/rough mask and B is the
    // grime/AO mask; the renderer samples it in world-space triplanar coordinates,
    // so arbitrary procedural boxes get real texel detail without UV attributes.
    // All noise octaves use an exact whole number of cells across a 64 px tile,
    // which keeps the patterns seamless and deterministic.
    // V7 shared surface sampler.  A single procedural texture array holds eight
    // 512x512 layers.  R stores the tangent-space normal X, G the normal Y,
    // B the roughness and A the baked AO/contact mask; the High shader samples
    // it with explicit gradients in world space, so arbitrary procedural
    // geometry gets normal, roughness and AO detail without UV attributes.
    // Every noise octave uses a whole number of cells across the tile, keeping
    // the layers seamless and deterministic; mipmaps plus anisotropic
    // filtering prevent the near-field detail from shimmering.
    function periodicNoise(x, y, period, seed) {
      var gx = Math.floor(x);
      var gy = Math.floor(y);
      var fx = x - gx;
      var fy = y - gy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      function cell(ix, iy) {
        var wx = ((ix % period) + period) % period;
        var wy = ((iy % period) + period) % period;
        return hash2(wx + seed * 17.13, wy + seed * 9.71);
      }
      var x0 = gx;
      var x1 = gx + 1;
      var y0 = gy;
      var y1 = gy + 1;
      var a = cell(x0, y0);
      var b = cell(x1, y0);
      var c = cell(x0, y1);
      var d = cell(x1, y1);
      var ab = a + (b - a) * fx;
      var cd = c + (d - c) * fx;
      return ab + (cd - ab) * fy;
    }

    function makeSurfaceDetailAtlas(width) {
      var tile = width / 4;
      var frequency = 64 / tile;
      var cols = 4;
      var rows = 2;
      var canvas = document.createElement('canvas');
      canvas.width = tile * cols;
      canvas.height = tile * rows;
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;
      var img = ctx.createImageData(canvas.width, canvas.height);
      var data = img.data;
      var styles = ['metal', 'rust', 'concrete', 'wood', 'paint', 'chips', 'water', 'grime'];
      function byte(v) { return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); }
      for (var idx = 0; idx < styles.length; idx++) {
        var style = styles[idx];
        var ox = (idx % cols) * tile;
        var oy = Math.floor(idx / cols) * tile;
        for (var y = 0; y < tile; y++) {
          for (var x = 0; x < tile; x++) {
            var n1 = periodicNoise(x * frequency / 8, y * frequency / 8, 8, idx + 1);
            var n2 = periodicNoise(x * frequency / 4, y * frequency / 4, 16, idx + 11);
            var n3 = periodicNoise(x * frequency / 16, y * frequency / 16, 4, idx + 23);
            var r = 128;
            var g = 128;
            var b = 128;
            if (style === 'metal') {
              var brush = Math.sin((y * 6 + x * 2) * 0.09817477 + n1 * 4.2);
              r = 128 + brush * 15 + (n2 - 0.5) * 18;
              g = 136 + brush * 13 + (n1 - 0.5) * 14;
              b = 206 + (n3 - 0.5) * 18 - Math.abs(brush) * 6;
            } else if (style === 'rust') {
              var rust = Math.max(0, Math.min(1, (n1 - 0.52) / 0.22));
              rust = rust * rust * (3 - 2 * rust);
              r = 112 + (n2 - 0.5) * 54 + rust * 24;
              g = 94 + (n2 - 0.5) * 38 + rust * 10;
              b = 150 + (n1 - 0.5) * 90 - rust * 34;
            } else if (style === 'concrete') {
              r = 126 + (n2 - 0.5) * 34 + (n3 - 0.5) * 14;
              g = 116 + (n1 - 0.5) * 24 + (n3 - 0.5) * 10;
              b = 188 + (n1 - 0.5) * 34;
            } else if (style === 'wood') {
              var grain = Math.sin(x * 11 * 0.09817477 + n1 * 3.4 + n2 * 1.7);
              r = 136 + grain * 24 + (n2 - 0.5) * 16;
              g = 108 + grain * 8;
              b = 176 + (n1 - 0.5) * 26;
            } else if (style === 'paint') {
              var rib = (x % 8) < 2 ? -12 : 5;
              var scratch = n2 > 0.72 ? -22 : 0;
              r = 128 + rib + scratch + (n1 - 0.5) * 14;
              g = 128 + rib * 0.7 + scratch * 0.7;
              b = 198 + (n1 - 0.5) * 18;
            } else if (style === 'chips') {
              var chip = n1 > 0.63 ? -26 : 0;
              r = 126 + (n2 - 0.5) * 26 + chip;
              g = 120 + (n2 - 0.5) * 18 + chip * 0.7;
              b = 188 + (n1 - 0.5) * 30;
            } else if (style === 'water') {
              var streak = Math.sin(y * 12 * 0.09817477 + n1 * 2.6);
              r = 118 + streak * 16;
              g = 154 + streak * 18;
              b = 208 + streak * 10;
            } else {
              var stain = Math.max(0, Math.min(1, (n1 - 0.45) / 0.55));
              r = 124 + (n2 - 0.5) * 20 - stain * 20;
              g = 116 + (n2 - 0.5) * 16 - stain * 12;
              b = 196 - stain * 64 + (n3 - 0.5) * 18;
            }
            var di = ((oy + y) * canvas.width + (ox + x)) * 4;
            data[di] = byte(r);
            data[di + 1] = byte(g);
            data[di + 2] = byte(b);
            data[di + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas;
    }

    // The compatibility shader used by very low WebGL1 uniform budgets has no
    // sampler uniforms, so avoid generating and uploading an unused atlas.
    var surfaceSamplingEnabled = !renderer.profile ||
      renderer.profile.textureSampling !== false;
    byId('loadingStatus').textContent = '正在生成材质与船坞…';
    var surfaceSize = settings.textures === 'low' ? 512 : 1024;
    var surfaceLayers = highVisuals ? PBDockArt.makeSurfaceLayers(renderer, periodicNoise, hash2, DETAIL_TILE, surfaceSize) : null;
    var surfaceAtlasCanvas = surfaceSamplingEnabled && !highVisuals
      ? makeSurfaceDetailAtlas(settings.textures === 'low' ? 512 : 1024)
      : null;
    var surfaceDetailTexture = (surfaceAtlasCanvas && THREE.Texture)
      ? new THREE.Texture(surfaceAtlasCanvas, { flipY: false })
      : null;
    if (surfaceDetailTexture && renderer.setDetailTexture) {
      renderer.setDetailTexture(surfaceDetailTexture);
    }

    /* ----------------------------------------------------- merged pixel batch */

    var BATCH_VERT_CAP = 64000;
    var ART_VERT_CAP = highVisuals ? 270000 : 230000;
    var V5_DETAIL_LIMIT = QUALITY.name === 'high' ? 40000 :
      (QUALITY.name === 'balanced' ? 30000 : 16000);
    var v5DetailVerts = 0;
    var artVerts = 0;
    var batches = Object.create(null);
    var batchList = [];
    var batchZone = 0;
    var floorGlows = [];
    var valveWheels = [];
    var valveWheelMat = matLambert(0xb2472e);
    var energyRings = [];
    var arenaMood = null;

    // All V5 surface detail is optional, shared-resource geometry created during
    // the single startup build.  The budget keeps the extra grooving/rust/stencil
    // work from displacing later core zone geometry if the scene grows again.
    function v5Box(key, x, y, z, sx, sy, sz, yaw) {
      if (v5DetailVerts + 24 > V5_DETAIL_LIMIT) return null;
      var b = getBatch(key);
      if (!b) return null;
      if (!b.box(x, y, z, sx, sy, sz, yaw)) return null;
      v5DetailVerts += 24;
      return b;
    }

    function PixelBatch(key, material) {
      this.key = key;
      this.material = material;
      this.p = [];
      this.n = [];
      this.idx = [];
      this.verts = 0;
      this.mesh = null;
      this.shadowCaster = /^(container|crane|cabGlass|casting|concrete|quay|steel|black|rustLight|fenceDark)/.test(key);
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
      if (!this.reserve(24)) return false;
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
      return true;
    };

    PixelBatch.prototype.quad = function (a, b, c, d) {
      if (!this.reserve(4)) return;
      var abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      var acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
      var nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      var len = Math.hypot(nx, ny, nz) || 1;
      var start = this.p.length / 3;
      this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      for (var i = 0; i < 4; i++) this.n.push(nx / len, ny / len, nz / len);
      this.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    };

    PixelBatch.prototype.patch = function (x, y, z, rx, rz, yaw, seed) {
      var sides = 24;
      if (!this.reserve(sides + 1)) return;
      var base = this.p.length / 3;
      this.p.push(x, y, z);
      this.n.push(0, 1, 0);
      for (var i = 0; i < sides; i++) {
        var a = i / sides * Math.PI * 2;
        var ring = 0.79 + 0.16 * Math.sin(a * 3 + seed) + hash2(i, seed) * 0.16;
        var p = localXZ(x, z, Math.cos(a) * rx * ring, -Math.sin(a) * rz * ring, yaw);
        this.p.push(p[0], y, p[1]);
        this.n.push(0, 1, 0);
        this.idx.push(base, base + 1 + i, base + 1 + (i + 1) % sides);
      }
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
        ind.push(a, b, c, b, d, c);
      }
    };

    PixelBatch.prototype.flush = function () {
      if (!this.verts) return;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', { array: new Float32Array(this.p), itemSize: 3 });
      geo.setAttribute('normal', { array: new Float32Array(this.n), itemSize: 3 });
      geo.setIndex(new Uint16Array(this.idx));
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.name = 'dock-batch-' + this.key;
      var bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (var i = 0; i < this.p.length; i += 3) {
        for (var axis = 0; axis < 3; axis++) {
          bounds[axis] = Math.min(bounds[axis], this.p[i + axis]);
          bounds[axis + 3] = Math.max(bounds[axis + 3], this.p[i + axis]);
        }
      }
      this.mesh.worldBounds = bounds;
      this.mesh.detailDistance = this.detailDistance;
      this.mesh.staticShadow = true;
      this.mesh.castShadow = highVisuals && this.shadowCaster && !this.detailDistance;
      if (!this.shadowCaster && this.material.transparent) this.mesh.reflectionSkip = true;
      // Keep the baked contact darkening underneath the additive fake lights.
      if (this.key === 'aoSoft') this.mesh.renderOrder = -3;
      else if (this.key === 'ao') this.mesh.renderOrder = -2;
      scene.add(this.mesh);
      this.p = null;
      this.n = null;
      this.idx = null;
    };

    function paintTopSurface(texture, x, y, z, w, d, cols, rows, budgeted, yaw) {
      if (!texture) return;
      cols = cols || 5;
      rows = rows || 3;
      yaw = yaw || 0;
      var cw = w / cols, cd = d / rows;
      for (var pz = 0; pz < rows; pz++) {
        for (var px = 0; px < cols; px++) {
          var texX = Math.floor(px / cols * texture.w);
          var texY = Math.floor(pz / rows * texture.h);
          var entry = texture.palette[texture.data[texY * texture.w + texX]];
          if (!entry || entry.skip) continue;
          var b = getBatch(entry.key);
          if (!b) continue;
          if (budgeted && v5DetailVerts + 24 > V5_DETAIL_LIMIT) return;
          var p = localXZ(x, z,
            -w / 2 + (px + 0.5) * cw,
            -d / 2 + (pz + 0.5) * cd, yaw);
          if (b.box(
            p[0], y, p[1],
            cw * 1.02, 0.008, cd * 1.02, yaw
          ) && budgeted) {
            v5DetailVerts += 24;
          }
        }
      }
    }

    function getBatch(key, tile, distance) {
      if (!IM[key]) return null;
      var id = batchZone + ':' + key + (tile ? ':' + tile : '');
      if (!batches[id]) {
        batches[id] = new PixelBatch(key, IM[key]);
        batches[id].detailDistance = distance;
        batchList.push(batches[id]);
      }
      return batches[id];
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

    function panelPoint(x, z, lx, y, lz, yaw) {
      var p = localXZ(x, z, lx, lz, yaw);
      return [p[0], y, p[1]];
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

    var placeSign = PBDockArt.signage(THREE, scene, G.plane, IM);

    function drawStencil(key, x, y, z, yaw, text, cell, normalOffset) {
      var position = localXZ(x, z, 0, normalOffset, yaw);
      placeSign(key, position[0], y, position[1], text, cell * 5, yaw, false);
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
      drawStencil(textKey || 'white', x, y, z, yaw, text, Math.max(0.038, cell), 0.055);
    }

    function drawFloorText(key, x, z, text, cell) {
      placeSign(key, x, 0.046, z, text, cell * 5, 0, true);
    }

    /* ---------------------------------------------------------- surface paint */

    function paintPixelSurface(texture, x, y, z, yaw, w, h, cols, rows, normalOffset, budgeted) {
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
          if (!entry || entry.skip) continue;
          var b = getBatch(entry.key);
          if (!b) continue;
          if (budgeted && v5DetailVerts + 24 > V5_DETAIL_LIMIT) return;
          var lx = -w / 2 + (px + 0.5) * cw;
          var ly = h / 2 - (py + 0.5) * ch;
          if (b.box(
            x + lx * c + off * s,
            y + ly,
            z - lx * s + off * c,
            cw * 1.02, ch * 1.02, 0.01, yaw
          ) && budgeted) {
            v5DetailVerts += 24;
          }
        }
      }
    }

    function paintFloorSurface(texture, x, z, w, d, cols, rows, budgeted, yaw) {
      if (!texture) return;
      cols = cols || 6;
      rows = rows || 6;
      yaw = yaw || 0;
      var cw = w / cols, cd = d / rows;
      for (var pz = 0; pz < rows; pz++) {
        for (var px = 0; px < cols; px++) {
          var texX = Math.floor(px / cols * texture.w);
          var texY = Math.floor(pz / rows * texture.h);
          var entry = texture.palette[texture.data[texY * texture.w + texX]];
          if (!entry || entry.skip) continue;
          var b = getBatch(entry.key);
          if (!b) continue;
          if (budgeted && v5DetailVerts + 24 > V5_DETAIL_LIMIT) return;
          var p = localXZ(x, z,
            -w / 2 + (px + 0.5) * cw,
            -d / 2 + (pz + 0.5) * cd, yaw);
          if (b.box(
            p[0], 0.035, p[1],
            cw * 1.02, 0.006, cd * 1.02, yaw
          ) && budgeted) {
            v5DetailVerts += 24;
          }
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
      if (outer && highVisuals) outer.patch(x, 0.049, z, sx * 0.58, sz * 0.57, yaw, 3);
      else if (outer) outer.box(x, 0.058, z, sx, 0.006, sz, yaw || 0);
      if (softOnly) return;
      var core = getBatch('ao');
      if (core && highVisuals) core.patch(x, 0.052, z, sx * 0.42, sz * 0.42, yaw, 3);
      else if (core) core.box(x, 0.06, z, sx * 0.68, 0.006, sz * 0.68, yaw || 0);
    }

    function addWallAO(x, y, z, sx, sy, sz, yaw, softOnly) {
      var outer = getBatch('aoSoft');
      if (outer) outer.box(x, y, z, sx, sy, sz, yaw || 0);
      if (softOnly) return;
      var core = getBatch('ao');
      if (core) core.box(x, y, z, sx * 0.62, sy * 0.82, sz * 1.4, yaw || 0);
    }

    // V5 sunset cast-shadow approximation.  These are long, soft dark quads
    // baked into the shared AO batches, aligned with the low directional light.
    // They are not a shadow map and do not occlude per-pixel; they restore the
    // long directional read that flat ambient occlusion alone cannot provide.
    function addSunShadow(x, z, width, height, groundY, yaw) {
      if (highVisuals) return;
      if (!isFinite(SHADOW_DIR_X) || !isFinite(SHADOW_DIR_Z)) return;
      var h = height === undefined ? 2.4 : height;
      if (h < 0.2) return;
      var len = Math.min(h * 2.35, 7.2);
      var cx = x + SHADOW_DIR_X * len * 0.5;
      var cz = z + SHADOW_DIR_Z * len * 0.5;
      if (cx > 22.2 || cx < -22.2 || cz < -43.2 || cz > 19.2) return;
      var gy = (groundY === undefined ? 0 : groundY) + 0.043;
      var yawS = Math.atan2(SHADOW_DIR_X, SHADOW_DIR_Z);
      var outer = getBatch('aoSoft');
      var core = getBatch('ao');
      if (outer) {
        outer.box(cx - SHADOW_DIR_X * 0.12, gy, cz - SHADOW_DIR_Z * 0.12,
          width * 1.12, 0.006, len, yawS);
      }
      if (core) {
        core.box(cx + SHADOW_DIR_X * 0.1, gy + 0.002, cz + SHADOW_DIR_Z * 0.1,
          width * 0.58, 0.006, len * 0.9, yawS);
      }
      void yaw;
    }

    // Two low-opacity additive slabs per region.  They are merged into the
    // static art batches, so region colour is almost free at runtime.
    function addZoneLightPool(x, z, radius, key) {
      if (highVisuals) return;
      var outer = getBatch('glow' + key);
      var core = getBatch('glow' + key + 'Core');
      if (outer) outer.box(x, 0.062, z, radius * 2, 0.005, radius * 2, 0);
      if (core) core.box(x, 0.064, z, radius * 1.06, 0.005, radius * 1.06, 0);
    }

    function addFloorGlow(x, z, radius, hex, opacity) {
      if (floorGlows.length >= 20) return null;
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
      if (highVisuals) return;
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

    /* ---------------------------------------------------- dockyard kit ---- */

    var CONTAINER_KEYS = [
      'containerRed', 'containerBlue', 'containerGreen',
      'containerOrange', 'containerPurple', 'containerTeal'
    ];

    function containerKeyFor(i) {
      return CONTAINER_KEYS[Math.abs(i) % CONTAINER_KEYS.length];
    }

    function addCorrugatedContainer(x, z, w, h, d, yaw, key, baseY, opts) {
      // Lay the ribs along the longest dimension, including the short cover units.
      if (d > w) {
        var depth = d;
        d = w;
        w = depth;
        yaw += Math.PI / 2;
      }
      var paint = getBatch(key);
      var frame = getBatch('steelDark');
      var wear = getBatch('casting');
      var recess = getBatch('steelDeep');
      var tile = Math.floor(x / 8) + ',' + Math.floor(z / 8);
      var oxide = getBatch('rustDark', tile, 23);
      var hardware = getBatch('casting', tile, 37);
      var stencil = getBatch('stencil');
      var amber = getBatch('railPaint');
      var code = opts.code || ('DKY-' + (Math.abs(Math.floor(x * 3 + z * 7)) % 89 + 10));
      var halfW = w * 0.5, halfD = d * 0.5;
      var rail = Math.min(0.14, h * 0.17);
      var yLo = baseY + rail, yHi = baseY + h - rail;
      var middle = baseY + h * 0.5;

      function part(batch, lx, y, lz, sx, sy, sz, faceYaw) {
        var p = localXZ(x, z, lx, lz, faceYaw);
        batch.box(p[0], y, p[1], sx, sy, sz, faceYaw);
      }

      if (baseY < 0.05) addContactAO(x, z, w * 1.08, d * 1.12, yaw);
      paint.box(x, middle, z, w - 0.24, h - 0.06, d - 0.24, yaw);
      for (var edge = -1; edge <= 1; edge += 2) {
        var faceYaw = edge > 0 ? yaw : yaw + Math.PI;
        for (var r = -1; r <= 1; r += 2) {
          part(frame, 0, middle + r * (h - rail) * 0.5, halfD - 0.06, w - 0.18, rail, 0.12, faceYaw);
          part(wear, 0, middle + r * (h - rail) * 0.5 + rail * 0.28, halfD + 0.005,
            w - 0.37, 0.021, 0.024, faceYaw);
        }
        part(frame, halfW - 0.10, middle, halfD - 0.078, 0.20, h - 0.05, 0.156, faceYaw);
        part(frame, halfW - 0.10, middle, -halfD + 0.078, 0.20, h - 0.05, 0.156, faceYaw);
        for (var end = -1; end <= 1; end += 2) {
          for (var level = -1; level <= 1; level += 2) {
            var y = middle + level * (h * 0.5 - rail * 0.71);
            part(wear, end * (halfW - 0.12), y, halfD - 0.068, 0.25, rail * 1.40, 0.16, faceYaw);
            part(recess, end * (halfW - 0.12), y, halfD + 0.019, 0.095, rail * 0.51, 0.018, faceYaw);
          }
        }

        var panels = Math.max(6, Math.round(w / 0.31));
        var step = (w - 0.39) / panels;
        var foot = halfD - 0.096, peak = halfD - 0.009;
        for (var k = 0; k < panels; k++) {
          var a = -halfW + 0.195 + k * step;
          var stations = [a, a + step * 0.15, a + step * 0.33, a + step * 0.69,
            a + step * 0.87, a + step];
          var dent = hash2(k + x, z + edge) > 0.88 ? 0.031 : 0;
          var profile = [foot, foot, peak, peak - dent, foot, foot];
          for (var f = 0; f < profile.length - 1; f++) {
            paint.quad(
              panelPoint(x, z, stations[f], yLo, profile[f], faceYaw),
              panelPoint(x, z, stations[f + 1], yLo, profile[f + 1], faceYaw),
              panelPoint(x, z, stations[f + 1], yHi, profile[f + 1], faceYaw),
              panelPoint(x, z, stations[f], yHi, profile[f], faceYaw));
          }
          if (hash2(k + edge, w + x) > 0.83) {
            part(oxide, a + step * 0.48, yLo + h * 0.09, peak + 0.004, step * 0.29, h * 0.19, 0.009, faceYaw);
          }
        }
        var idP = localXZ(x, z, -w * 0.21, halfD + 0.005, faceYaw);
        var cell = Math.min(h * 0.065, w / (code.length * 10));
        part(recess, -w * 0.21, baseY + h * 0.65, halfD + 0.005, code.length * cell * 4.2, cell * 6.2, 0.017, faceYaw);
        drawStencil('stencil', idP[0], baseY + h * 0.65, idP[1], faceYaw, code, cell, 0.015);
        if (opts.topTrim !== false) {
          part(amber, w * 0.29, baseY + h * 0.26, halfD + 0.004, w * 0.15, h * 0.06, 0.016, faceYaw);
          part(stencil, w * 0.29, baseY + h * 0.35, halfD + 0.004, w * 0.09, 0.028, 0.016, faceYaw);
        }
      }

      // Recessed double doors, gasket, hinges and four continuous locking rods.
      for (var e = -1; e <= 1; e += 2) {
        var doorYaw = yaw + e * Math.PI / 2;
        part(recess, 0, middle, halfW - 0.036, d - 0.13, h - 0.15, 0.07, doorYaw);
        for (var leaf = -1; leaf <= 1; leaf += 2) {
          var hinge = leaf * (halfD - 0.18);
          var plate = localXZ(x, z, leaf * d * 0.22, halfW + 0.014, doorYaw);
          drawStencil('stencil', plate[0], baseY + h * 0.73, plate[1], doorYaw,
            leaf < 0 ? 'MAX GROSS' : 'INSPECTED', Math.min(0.020, d * 0.008), 0.019);
          part(paint, leaf * (d * 0.25 - 0.023), middle, halfW - 0.012, halfD - 0.11, h - rail * 2.10, 0.043, doorYaw);
          for (var seam = 1; seam < 4; seam++) {
            part(frame, leaf * (d * 0.25 - 0.023), yLo + (yHi - yLo) * seam * 0.25,
              halfW + 0.008, halfD - 0.17, 0.031, 0.027, doorYaw);
          }
          for (var rod = 1; rod <= 2; rod++) {
            var rx = leaf * (halfD * (0.19 + 0.26 * rod));
            var rp = localXZ(x, z, rx, halfW + 0.030, doorYaw);
            wear.pipe(rp[0], yLo + 0.008, rp[1], rp[0], yHi - 0.008, rp[1], 0.024, 7);
            for (var bolt = -1; bolt <= 1; bolt += 2) {
              part(hardware, rx, middle + bolt * (h - rail * 2) * 0.4, halfW + 0.027, 0.107, 0.060, 0.064, doorYaw);
            }
            part(wear, rx - leaf * 0.067, baseY + h * 0.39, halfW + 0.047, 0.15, 0.024, 0.04, doorYaw);
          }
          for (var joint = 1; joint < 4; joint++) {
            part(wear, hinge, yLo + (yHi - yLo) * joint * 0.25, halfW + 0.022, 0.14, 0.081, 0.078, doorYaw);
          }
        }
      }
      for (var roof = -halfD + 0.22; roof < halfD - 0.12; roof += 0.27) {
        part(paint, 0, baseY + h - 0.027, roof, w - 0.36, 0.048, 0.09, yaw);
      }
    }

    // One container body, readable corner castings and corrugation.  Only the
    // low props passed with standable:true enter the traversal whitelist.
    function addContainer(x, z, w, h, d, yaw, key, baseY, opts) {
      opts = opts || {};
      baseY = baseY || 0;
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      addCollider(x, z,
        Math.abs(w * c) + Math.abs(d * s),
        Math.abs(w * s) + Math.abs(d * c), baseY, baseY + h,
        key === 'containerOrange' || key === 'containerRed' ? 'rust' : 'paintedSteel');
      if (opts.standable) {
        addStandable(x, z,
          Math.abs(w * c) + Math.abs(d * s),
          Math.abs(w * s) + Math.abs(d * c), baseY + h, opts.code || 'CONTAINER');
      }
      key = key || containerKeyFor(Math.floor(x + z));
      if (highVisuals) {
        addCorrugatedContainer(x, z, w, h, d, yaw || 0, key, baseY, opts);
        return;
      }
      var body = getBatch(key);
      var edge = getBatch('steelDark');
      var trim = getBatch('steel2');
      var rust = getBatch('rust');
      if (!body) return;
      if (baseY < 0.05) addContactAO(x, z, w * 1.22, d * 1.22, yaw);
      body.box(x, baseY + h / 2, z, w, h, d, yaw);
      var lx, lz, p;
      if (edge) {
        edge.box(x, baseY + h * 0.5, z, w + 0.055, 0.12, d + 0.055, yaw);
        edge.box(x, baseY + 0.075, z, w + 0.06, 0.15, d + 0.06, yaw);
        edge.box(x, baseY + h - 0.075, z, w + 0.06, 0.15, d + 0.06, yaw);
        for (var sx = -1; sx <= 1; sx += 2) {
          for (var sz = -1; sz <= 1; sz += 2) {
            p = localXZ(x, z, sx * (w / 2 - 0.07), sz * (d / 2 - 0.07), yaw);
            edge.box(p[0], baseY + h / 2, p[1], 0.13, h, 0.13, yaw);
          }
        }
        // Vertical corrugation ribs on the long faces.
        for (var r = -3; r <= 3; r++) {
          if (r === 0) continue;
          lx = r * w / 8.2;
          p = localXZ(x, z, lx, d / 2 + 0.018, yaw);
          edge.box(p[0], baseY + h / 2, p[1], 0.055, h * 0.82, 0.03, yaw);
          p = localXZ(x, z, lx, -d / 2 - 0.018, yaw);
          edge.box(p[0], baseY + h / 2, p[1], 0.055, h * 0.82, 0.03, yaw);
        }
        // Door seam and lock bars on the near end.
        p = localXZ(x, z, 0, d / 2 + 0.024, yaw);
        edge.box(p[0], baseY + h / 2, p[1], 0.045, h * 0.86, 0.035, yaw);
        for (var b = -1; b <= 1; b += 2) {
          p = localXZ(x, z, b * w * 0.22, d / 2 + 0.03, yaw);
          trim.box(p[0], baseY + h * 0.52, p[1], 0.06, h * 0.58, 0.035, yaw);
        }
      }
      if (trim) {
        p = localXZ(x, z, 0, d / 2 + 0.035, yaw);
        drawStencil('white', p[0], baseY + h * 0.62, p[1] + 0.01, yaw,
          opts.code || ('DKY-' + (Math.abs(Math.floor(x * 3 + z * 7)) % 89 + 10)),
          Math.min(0.085, h * 0.05), 0.04);
      }
      if (rust && h > 1.2) {
        p = localXZ(x, z, -w * 0.23, d / 2 + 0.04, yaw);
        rust.box(p[0], baseY + h * 0.3, p[1], w * 0.18, h * 0.24, 0.03, yaw);
        p = localXZ(x, z, w * 0.31, -d / 2 - 0.04, yaw);
        rust.box(p[0], baseY + h * 0.45, p[1], w * 0.12, h * 0.3, 0.03, yaw);
      }
      // V5 surface pass: real panel grooves, door hardware, warning decals and
      // sparse atlas grime sit on top of the V4 corrugation.  All boxes share the
      // existing material batches and the fixed startup detail budget.
      if (QUALITY.extraDetail) {
        var sideZ, g, hb, rr, hg, tc;
        for (sideZ = -1; sideZ <= 1; sideZ += 2) {
          for (g = -1; g <= 1; g++) {
            p = localXZ(x, z, g * w * 0.27, sideZ * (d / 2 + 0.035), yaw);
            v5Box('steelDeep', p[0], baseY + h * 0.52, p[1],
              0.03, h * 0.78, 0.014, yaw);
          }
          for (hb = -1; hb <= 1; hb += 2) {
            p = localXZ(x, z, 0, sideZ * (d / 2 + 0.034), yaw);
            v5Box('steelDark', p[0], baseY + h * (hb > 0 ? 0.79 : 0.23), p[1],
              w * 0.88, 0.025, 0.014, yaw);
          }
          for (rr = 0; rr < 2; rr++) {
            p = localXZ(x, z, (hash2(x + rr, z + sideZ) - 0.5) * w * 0.72,
              sideZ * (d / 2 + 0.05), yaw);
            v5Box(rr ? 'rustDark' : 'rust',
              p[0], baseY + h * (0.38 + hash2(sideZ, rr) * 0.34), p[1],
              0.05 + hash2(rr, x) * 0.08, h * (0.12 + hash2(z, rr) * 0.16),
              0.012, yaw);
          }
        }
        for (g = -1; g <= 1; g += 2) {
          p = localXZ(x, z, g * w * 0.38, d / 2 + 0.045, yaw);
          v5Box('steel2', p[0], baseY + h * 0.5, p[1], 0.045, h * 0.72, 0.02, yaw);
        }
        for (hg = 0; hg < 4; hg++) {
          p = localXZ(x, z, (hg < 2 ? -1 : 1) * (w / 2 - 0.13), d / 2 + 0.05, yaw);
          v5Box('steel2', p[0], baseY + h * (0.18 + hg * 0.2), p[1],
            0.11, 0.07, 0.03, yaw);
        }
        p = localXZ(x, z, 0, d / 2 + 0.055, yaw);
        v5Box('hazard', p[0], baseY + h * 0.18, p[1], w * 0.26, 0.16, 0.016, yaw);
        p = localXZ(x, z, 0, d / 2 + 0.052, yaw);
        v5Box('white', p[0], baseY + h * 0.1, p[1], w * 0.18, 0.05, 0.014, yaw);
        for (tc = -1; tc <= 1; tc++) {
          p = localXZ(x, z, 0, tc * d * 0.25, yaw);
          v5Box('steelDark', p[0], baseY + h + 0.015, p[1],
            w * 0.88, 0.025, 0.05, yaw);
        }
        if (QUALITY.name === 'high' || Math.abs(Math.floor(x + z)) % 2 === 0) {
          var atlasCols = QUALITY.name === 'high' ? 6 : 4;
          var atlasRows = QUALITY.name === 'high' ? 3 : 2;
          for (sideZ = -1; sideZ <= 1; sideZ += 2) {
            p = localXZ(x, z, 0, sideZ * (d / 2 + 0.032), yaw);
            paintPixelSurface(TEX.containerDetail, p[0], baseY + h * 0.32, p[1],
              yaw, w * 0.9, h * 0.5, atlasCols, atlasRows, 0.002, true);
          }
        }
        addSunShadow(x, z, Math.min(w, d) * 1.25, h, 0, yaw);
      }
      if (opts.topTrim !== false) {
        var rail = getBatch('hazard');
        if (rail && h < 1.6) {
          p = localXZ(x, z, 0, d / 2 + 0.045, yaw);
          rail.box(p[0], baseY + h * 0.5, p[1], w * 0.34, 0.09, 0.025, yaw);
        }
      }
    }

    function addPallet(x, z, yaw, baseY) {
      baseY = baseY || 0;
      var wood = getBatch('rustLight');
      var dark = getBatch('rustDark');
      var band = getBatch('steel2');
      if (!wood || !dark) return;
      var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
      for (var i = -1; i <= 1; i++) {
        wood.box(x + i * 0.32 * s, baseY + 0.055, z + i * 0.32 * c, 1.15, 0.09, 0.22, yaw);
        dark.box(x + i * 0.32 * s, baseY + 0.145, z + i * 0.32 * c, 1.06, 0.07, 0.18, yaw);
      }
      wood.box(x, baseY + 0.11, z, 0.2, 0.2, 0.96, yaw);
      if (band) {
        band.box(x, baseY + 0.2, z, 0.09, 0.05, 0.92, yaw);
      }
      if (QUALITY.extraDetail) {
        for (var pl = -1; pl <= 1; pl++) {
          var px = x + pl * 0.32 * s;
          var pz = z + pl * 0.32 * c;
          v5Box('rustDark', px, baseY + 0.190, pz, 1.02, 0.008, 0.028, yaw);
          v5Box('rustDark', px, baseY + 0.192, pz, 0.96, 0.006, 0.022, yaw);
          for (var nl = -1; nl <= 1; nl += 2) {
            var np = localXZ(px, pz, nl * 0.42, 0.01, yaw);
            v5Box('steel2', np[0], baseY + 0.232, np[1], 0.026, 0.012, 0.026, yaw);
            v5Box('rust', np[0], baseY + 0.194, np[1],
              0.05 + hash2(pl, nl) * 0.06, 0.008, 0.04, yaw);
          }
        }
        paintTopSurface(TEX.woodDetail, x, baseY + 0.183, z, 1.0, 0.86, 6, 2, true, yaw);
        addSunShadow(x, z, 0.9, 0.3, 0, yaw);
      }
      addContactAO(x, z, 1.55, 1.4, yaw);
      addCollider(x, z, 1.2, 1.05, baseY, baseY + 0.2, 'wood');
      addStandable(x, z, 1.2, 1.05, baseY + 0.2, 'PALLET');
    }

    function addDockLamp(x, z, height, glowHex, lampHex) {
      var pole = getBatch('steelDark');
      var head = getBatch(lampHex || 'lampWarm');
      var cage = getBatch('steel2');
      var h = height || 5.2;
      if (!pole) return;
      pole.pipe(x, 0.05, z, x, h, z, 0.075, 6);
      pole.box(x, 0.1, z, 0.34, 0.2, 0.34, 0);
      if (cage) {
        cage.box(x, h, z, 0.24, 0.14, 0.58, 0);
        cage.box(x, h - 0.2, z, 0.7, 0.08, 0.26, 0);
      }
      if (head) head.box(x, h - 0.16, z, 0.52, 0.07, 0.34, 0);
      var halo = getBatch(glowHex === 0xffb153 ? 'glowWarm' : 'glowCool');
      var haloCore = getBatch(glowHex === 0xffb153 ? 'glowWarmCore' : 'glowCoolCore');
      if (halo) halo.box(x, h - 0.18, z, 1.4, 0.34, 0.9, 0);
      if (haloCore) haloCore.box(x, h - 0.17, z, 0.7, 0.16, 0.42, 0);
      addZoneLightPool(x, z, 3.4, glowHex === 0xffb153 ? 'Warm' : 'Cool');
      addFloorGlow(x, z, 2.6, glowHex, 0.045);
    }

    function addFenceLine(x0, z0, x1, z1, height) {
      var dx = x1 - x0, dz = z1 - z0;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.5) return;
      var posts = Math.max(2, Math.ceil(len / 4.2) + 1);
      var post = getBatch('fenceDark');
      var wire = getBatch('steelDeep');
      var h = height || 2.35;
      for (var i = 0; i < posts; i++) {
        var t = i / (posts - 1);
        var x = x0 + dx * t, z = z0 + dz * t;
        if (post) {
          post.box(x, h / 2, z, 0.09, h, 0.09, 0);
          post.box(x, 0.07, z, 0.26, 0.14, 0.26, 0);
        }
      }
      for (var r = 1; r <= 3; r++) {
        beamXZ('fenceDark', x0, z0, x1, z1, h * (0.32 + r * 0.2), 0.045, 0.045);
      }
      // Sparse diagonal bracing keeps the chain-link read without a texture.
      for (var d = 0; d < posts - 1; d++) {
        var ax = x0 + dx * d / (posts - 1);
        var az = z0 + dz * d / (posts - 1);
        var bx = x0 + dx * (d + 1) / (posts - 1);
        var bz = z0 + dz * (d + 1) / (posts - 1);
        if (wire) wire.pipe(ax, h * 0.25, az, bx, h * 0.92, bz, 0.014, 4);
      }
    }

    function addPortalCrane(x, z) {
      var paint = getBatch('cranePaint');
      var steel = getBatch('steelDark');
      var frame = getBatch('steel2');
      var cast = getBatch('casting');
      var glass = getBatch('cabGlass');
      var light = getBatch('lampWarm');
      var red = getBatch('lampRed');
      var lx = 18.6, lz = 4.6;
      var lower = 8.65, upper = 10.52;

      for (var side = -1; side <= 1; side += 2) {
        var xLeg = x + side * lx;
        var zEnd = z + side * lz;
        for (var end = -1; end <= 1; end += 2) {
          var zLeg = z + end * lz;
          addCollider(xLeg, zLeg, 0.76, 0.76, 0, 9.4);
          addContactAO(xLeg, zLeg, 1.7, 1.7, 0);
          paint.box(xLeg, lower / 2, zLeg, 0.59, lower, 0.61, 0);
          steel.box(xLeg, 0.27, zLeg, 1.24, 0.54, 1.09, 0);
          addRustStreak(xLeg + 0.17, 1.25, zLeg + 0.317, 0, 0.10, 0.64);
          getBatch('oil').patch(xLeg + 0.38, 0.034, zLeg - 0.33, 0.48, 0.33, 0.47, 11);
          cast.box(xLeg, 0.56, zLeg, 0.78, 0.11, 0.78, 0);
          for (var band = 0; band < 3; band++) {
            steel.box(xLeg, 0.97 + band * 0.37, zLeg, 0.61, 0.12, 0.63, 0);
          }
          for (var gusset = -1; gusset <= 1; gusset += 2) {
            paint.pipe(xLeg, 6.38, zLeg, xLeg + gusset * 2.32, lower, zLeg, 0.17, 6);
          }
          red.box(xLeg, upper + 0.15, zLeg, 0.12, 0.16, 0.12, 0);
        }
        paint.pipe(xLeg, 3.4, z - lz, xLeg, lower, z + lz, 0.15, 6);
        paint.pipe(xLeg, lower, z - lz, xLeg, 3.4, z + lz, 0.15, 6);
        beamXZ('steelDark', xLeg, z - lz, xLeg, z + lz, lower, 0.39, 0.24);
        beamXZ('cranePaint', x - lx - 0.35, zEnd, x + lx + 0.35, zEnd, lower, 0.52, 0.34);
        beamXZ('cranePaint', x - lx - 0.35, zEnd, x + lx + 0.35, zEnd, upper, 0.37, 0.29);
        beamXZ('casting', x - lx, zEnd, x + lx, zEnd, lower - 0.225, 0.29, 0.10);

        for (var cell = 0; cell < 12; cell++) {
          var a = x - lx + cell * lx / 6;
          var b = x - lx + (cell + 1) * lx / 6;
          paint.pipe(a, cell % 2 ? upper : lower, zEnd,
            b, cell % 2 ? lower : upper, zEnd, 0.137, 6);
          if (cell % 2 === 0) {
            paint.box(a, (lower + upper) * 0.5, zEnd, 0.15, upper - lower, 0.18, 0);
            steel.box(a, lower + 0.13, zEnd, 0.43, 0.20, 0.40, 0);
            cast.box(a - 0.12, lower + 0.13, zEnd + 0.215, 0.06, 0.075, 0.035, 0);
            cast.box(a + 0.12, lower + 0.13, zEnd + 0.215, 0.06, 0.075, 0.035, 0);
            beamXZ('steelDark', a, z - lz, a, z + lz, lower, 0.23, 0.23);
          }
        }
      }

      // The enclosed cab hangs clear of the lanes. The hoist runs on the
      // lower rail, with double sheaves and a spreader over the stack.
      var cabX = x - 10.1;
      var cabZ = z - lz - 0.15;
      steel.box(cabX, 7.46, cabZ, 2.48, 1.68, 1.61, 0);
      paint.box(cabX, 6.63, cabZ, 2.74, 0.28, 1.94, 0);
      paint.box(cabX, 8.38, cabZ, 2.78, 0.18, 1.93, 0);
      for (var win = -1; win <= 1; win++) {
        glass.box(cabX + win * 0.78, 7.63, cabZ + 0.825, 0.67, 0.82, 0.065, 0);
      }
      glass.box(cabX + 1.245, 7.54, cabZ, 0.062, 0.80, 1.37, 0);
      light.box(cabX + 0.94, 6.72, cabZ + 1.01, 0.30, 0.11, 0.11, 0);
      var trolleyX = x + 5.4;
      paint.box(trolleyX, 8.63, z, 2.6, 0.52, 9.7, 0);
      steel.box(trolleyX, 8.04, z, 2.28, 0.72, 2.65, 0);
      for (var cord = -1; cord <= 1; cord += 2) {
        var cx = trolleyX + cord * 1.20;
        for (var end of [-1, 1]) {
          frame.pipe(cx - 0.09, 8.09, z + end * 0.82, cx + 0.09, 8.09, z + end * 0.82, 0.22, 12);
          cast.pipe(cx - 0.12, 8.09, z + end * 0.82, cx + 0.12, 8.09, z + end * 0.82, 0.097, 10);
        }
        frame.pipe(cx, 8.03, z - 0.82, cx, 4.25, z - 1.0, 0.027, 5);
        frame.pipe(cx, 8.03, z + 0.82, cx, 4.25, z + 1.0, 0.027, 5);
        paint.box(cx, 4.13, z, 0.30, 0.27, 2.57, 0);
        light.box(cx, 4.00, z + 0.88, 0.16, 0.08, 0.37, 0);
      }
      paint.box(trolleyX, 4.10, z, 3.25, 0.26, 0.66, 0);
      for (var latch = -1; latch <= 1; latch += 2) {
        steel.box(trolleyX + latch * 1.52, 3.93, z + 1.12, 0.21, 0.28, 0.36, 0);
        steel.box(trolleyX + latch * 1.52, 3.93, z - 1.12, 0.21, 0.28, 0.36, 0);
      }
      addSignPanel(x - 2.4, 9.41, z - lz + 0.29, 0, 6.0, 0.94, 'DOCK CRANE 04', 'hazard');
    }

    function buildEntryCanopy() {
      var paint = getBatch('cranePaint');
      var frame = getBatch('steelDark');
      var lights = getBatch('lampWarm');
      var frontZ = 9.7, rearZ = 7.1;
      beamXZ('steelDark', -9.4, rearZ, 9.4, rearZ, 4.36, 0.28, 0.39);
      beamXZ('cranePaint', -9.4, rearZ, 9.4, rearZ, 5.35, 0.31, 0.28);
      beamXZ('cranePaint', -9.4, frontZ, 9.4, frontZ, 5.35, 0.31, 0.28);
      for (var i = 0; i < 8; i++) {
        var x = -9.4 + i * 2.35;
        var next = x + 2.35;
        paint.pipe(x, i % 2 ? 4.37 : 5.35, rearZ, next, i % 2 ? 5.35 : 4.37, rearZ, 0.095, 6);
        frame.pipe(x, 4.48, frontZ, x, 4.37, rearZ, 0.085, 6);
        if (i % 2 === 0) {
          frame.box(x + 1.15, 4.29, rearZ, 0.89, 0.16, 0.27, 0);
          lights.box(x + 1.15, 4.194, rearZ + 0.055, 0.76, 0.064, 0.19, 0);
        }
      }
      addSignPanel(0, 3.88, rearZ + 0.25, 0, 5.5, 0.82, 'ENTRY 07', 'white');
      addSignPanel(0, 3.14, rearZ + 0.25, 0, 5.6, 0.47, 'SUNSET SHIFT // 18:40', 'hazard');
    }

    function buildRepairGantry(x, z) {
      var ivory = getBatch('craneIvory');
      var steel = getBatch('steelDark');
      var blue = getBatch('containerTeal');
      var hazard = getBatch('railPaint');
      var light = getBatch('lampCool');
      var lampZ = z - 0.47;
      for (var s = -1; s <= 1; s += 2) {
        var leg = x + s * 3.2;
        ivory.box(leg, 3.2, z, 0.42, 4.98, 0.42, 0);
        blue.box(leg, 1.60, z, 0.52, 1.7, 0.53, 0);
        steel.box(leg, 0.85, z, 0.73, 0.32, 0.68, 0);
        ivory.pipe(leg, 4.06, z, leg - s * 1.6, 5.30, z, 0.16, 6);
        hazard.box(leg, 2.5, z, 0.53, 0.11, 0.53, 0);
        hazard.box(leg, 2.24, z, 0.53, 0.11, 0.53, 0);
        for (var fastener = 0; fastener < 3; fastener++) {
          steel.box(leg, 3.5 + 0.30 * fastener, z + 0.219, 0.123, 0.083, 0.025, 0);
        }
        steel.box(x + s * 1.68, 5.27, lampZ, 1.05, 0.37, 0.76, 0);
        light.box(x + s * 1.68, 5.20, lampZ + 0.39, 0.87, 0.16, 0.055, 0);
      }
      ivory.box(x, 5.60, z, 7.30, 0.53, 0.71, 0);
      blue.box(x, 5.58, z + 0.364, 6.94, 0.28, 0.045, 0);
      steel.box(x, 5.045, z, 0.92, 0.72, 0.65, 0);
      steel.pipe(x, 5.0, z, x, 3.57, z, 0.036, 6);
      hazard.box(x, 3.66, z, 0.32, 0.25, 0.28, 0);
      addSignPanel(x, 5.91, z + 0.45, 0, 4.52, 0.69, 'REPAIR 04', 'white');

      // Layered concrete and steel deck edge, grated toe strip and work bays.
      var deck = getBatch('quay');
      var track = getBatch('track');
      for (var t = 0; t < 12; t++) {
        var deckZ = z + 8.4 - t * 0.82;
        deck.box(x - 6.55, 0.32, deckZ, 0.16, 0.54, 0.71, 0);
        steel.box(x - 6.65, 0.32, deckZ, 0.09, 0.25, 0.55, 0);
        var px = x - 5.97 + Math.floor(t / 6) * 11.94;
        track.box(px, 0.718, z + 6.76 - (t % 6) * 1.41, 0.45, 0.012, 1.38, 0);
        for (var slot = 0; slot < 6; slot++) {
          steel.box(px, 0.726, z + 7.34 - (t % 6) * 1.41 - slot * 0.235, 0.39, 0.013, 0.040, 0);
        }
      }
      for (var mark = -1; mark <= 1; mark += 2) {
        hazard.box(x + mark * 2.02, 0.721, z + 4.17, 0.11, 0.013, 3.64, 0);
      }
      hazard.box(x, 0.721, z + 5.99, 4.13, 0.013, 0.11, 0);
    }

    function addWetDeckDetails() {
      var track = getBatch('track');
      var wet = getBatch('wet');
      var dark = getBatch('steelDeep');
      var strip = getBatch('casting');
      var paint = getBatch('railPaint');
      var stencil = getBatch('stencil');
      dark.box(0, -0.21, -13.1, 46, 0.39, 66.8, 0);

      for (var side = -1; side <= 1; side += 2) {
        var laneX = side * 4.62;
        dark.box(laneX, 0.027, -10.7, 0.25, 0.017, 57.5, 0);
        strip.box(laneX + side * 0.034, 0.039, -10.7, 0.052, 0.018, 57.5, 0);
        for (var tie = 0; tie < 35; tie++) {
          var tieZ = 17.1 - tie * 1.63;
          dark.box(laneX, 0.037, tieZ, 0.55, 0.019, 0.24, 0);
          strip.box(laneX - side * 0.137, 0.053, tieZ, 0.055, 0.016, 0.058, 0);
          strip.box(laneX + side * 0.126, 0.051, tieZ, 0.048, 0.014, 0.05, 0);
          if (tie % 3 === 1) {
            paint.box(side * 3.9, 0.041, tieZ, 0.090, 0.012, 1.25, 0);
          }
        }
      }

      var puddles = [
        [-2.85, 10.7, 1.29, 1.37, 0.25], [1.45, 8.3, 1.61, 1.19, -0.20],
        [0.5, 2.2, 2.35, 1.50, 0.30], [-7.5, 4.6, 1.72, 0.96, -0.31],
        [-2.5, -6.1, 1.4, 1.75, 0.43], [2.6, -10.8, 1.05, 2.7, 0.19],
        [8.6, -12.4, 2.3, 1.7, -0.16], [14.4, -14.3, 2.1, 1.39, 0.17],
        [-3.9, -21.2, 2.5, 1.7, 0.18], [8.4, -26.5, 2.8, 1.13, 0.30],
        [-5.8, -38.7, 2.4, 1.51, 0.50], [5.0, -41.6, 1.2, 0.9, 0.16]
      ];
      for (var p = 0; p < puddles.length; p++) {
        var v = puddles[p];
        var y = p === 7 ? 0.719 : 0.032;
        track.patch(v[0], y - 0.003, v[1], v[2] * 1.24, v[3] * 1.23, v[4], p + 2);
        wet.patch(v[0], y, v[1], v[2], v[3], v[4], p + 2);
        wet.patch(v[0] - v[2] * 0.83, y + 0.001, v[1] + v[3] * 0.63,
          v[2] * 0.28, v[3] * 0.34, v[4], p + 19);
      }

      for (var j = 0; j < 18; j++) {
        var x = Math.sin(j * 0.49) * 1.16;
        var z = 11.7 - j * 0.99;
        var a = -Math.cos(j * 0.49) * 0.42;
        track.box(x - 1.05, 0.039, z, 0.17, 0.009, 0.92, a);
        track.box(x + 1.05, 0.039, z, 0.17, 0.009, 0.92, a);
        if (j % 3 === 0) {
          stencil.box(-2.4, 0.043, z, 0.073, 0.010, 0.36, 0);
          stencil.box(2.4, 0.043, z, 0.073, 0.010, 0.36, 0);
        }
      }
      drawFloorText('stencil', -3.0, 8.33, '07', 0.25);
      drawFloorText('stencil', 2.36, -9.25, 'LOAD 04', 0.18);
    }

    function buildCargoShip(x, z, size, yaw) {
      var ship = new THREE.Group();
      ship.position.set(x, -0.18, z);
      ship.rotation.y = yaw;
      ship.scale.setScalar(size);
      modelPart(ship, MODELS.ship, IM.harborBlack, 0, 1.04, 0, 8.8, 4.1, 34);
      modelPart(ship, MODELS.ship, IM.harborNear, 0, 2.91, 0, 8.4, 0.56, 33);
      modelPart(ship, MODELS.ship, IM.harborFar, 0, 3.25, -8.7, 6.9, 0.55, 11.8);
      modelPart(ship, MODELS.turret, IM.harborFar, 0, 5.28, -11, 6.9, 4.0, 5.2);
      modelPart(ship, G.box, IM.harborBlack, 0, 6.15, -8.65, 4.5, 0.61, 0.26);
      modelPart(ship, MODELS.tube, IM.harborBlack, 0, 7.7, -12.4, 0.74, 2.9, 0.74);
      modelPart(ship, MODELS.tube, IM.harborNear, 0, 9.2, -12.4, 0.83, 0.22, 0.83);
      for (var deck = 0; deck < 4; deck++) {
        for (var side of [-1, 1]) {
          modelPart(ship, MODELS.rifle, (deck + Math.sign(side)) % 2 ? IM.harborNear : IM.harborFar,
            side * 1.71, 3.8 + (deck % 2) * 1.12, -5 + deck * 3.35, 2.95, 1.43, 3.9);
        }
      }
      for (var mast of [-7.5, 10.2]) {
        modelPart(ship, MODELS.tube, IM.harborBlack, 0, 5.34, mast, 0.11, 5.05, 0.11);
        modelPart(ship, G.box, IM.harborNear, 0, 7.45, mast, 2.85, 0.078, 0.22);
      }
      PBModelKit.bake(THREE, ship, scene);
    }

    function buildHighHarbor() {
      IM.harborNear = matBasic(0x4c4451, { fog: false });
      IM.harborFar = matBasic(0x6f5967, { fog: false });
      IM.harborBlack = matBasic(0x342839, { fog: false });
      var middle = getBatch('harborNear');
      var distant = getBatch('harborFar');
      var silhouette = getBatch('harborBlack');
      for (var i = 0; i < 22; i++) {
        var x = -112 + i * 10.6;
        var z = -83 - hash2(i, 43) * 25;
        var h = 1.7 + hash2(i, 66) * 5.8;
        var bw = 4.8 + hash2(i, 81) * 10;
        distant.box(x, h / 2 - 0.35, z, bw, h, 4.8, 0);
        if (i % 4 === 0) {
          middle.box(x, h + 1.5, z, 1.9, 3.2, 1.8, 0);
          middle.box(x, h + 3.16, z, 2.2, 0.26, 2.1, 0);
        }
      }
      for (var j = 0; j < 4; j++) {
        var cx = [-67, -29, 19, 56][j];
        var cz = [-73, -84, -65, -81][j];
        var top = [18, 11, 15, 20][j];
        var extent = [16, 20, 18, 21][j];
        middle.box(cx + extent * 0.13, -0.25, cz, extent * 1.47, 1.6, 4.9, 0);
        silhouette.box(cx, top * 0.5, cz, 0.87, top, 1.3, 0);
        silhouette.box(cx + 1.8, top * 0.56, cz + 1.6, 0.70, top * 1.10, 0.67, 0);
        silhouette.pipe(cx - 5.5, top - 1.5, cz, cx + extent, top + 2.8, cz, 0.25, 6);
        silhouette.pipe(cx - 5.5, top - 1.19, cz, cx + extent, top + 3.55, cz, 0.16, 6);
        silhouette.pipe(cx, top + 4.9, cz, cx + extent, top + 3.3, cz, 0.063, 5);
        silhouette.pipe(cx, top + 4.9, cz, cx - 5.5, top - 1.19, cz, 0.065, 5);
        silhouette.pipe(cx + extent - 3.5, top + 2.4, cz, cx + extent - 3.5, top * 0.49, cz, 0.037, 4);
        silhouette.box(cx + extent - 3.5, top * 0.48, cz, 0.95, 0.26, 0.36, 0);
        for (var brace = 0; brace < 5; brace++) {
          var x0 = cx + brace * 0.345;
          var y = 1.6 + brace * (top - 2.3) / 5;
          silhouette.pipe(x0, y, cz, x0 + 1.48, y + 2.5, cz + 1.6, 0.092, 5);
        }
      }

      var tankFarm = new THREE.Group();
      for (var tank = 0; tank < 5; tank++) {
        var tx = -17 + tank * 7.35, tz = -83 - (tank % 2) * 6.8;
        modelPart(tankFarm, MODELS.tube, IM.harborFar, tx, 2.67, tz, 2.9, 6.1, 2.9);
        modelPart(tankFarm, MODELS.lens, IM.harborNear, tx, 5.63, tz, 2.9, 0.92, 2.9);
        modelPart(tankFarm, MODELS.tube, IM.harborBlack, tx + 1.14, 7.12, tz, 0.21, 2.6, 0.21);
      }
      PBModelKit.bake(THREE, tankFarm, scene);
      buildCargoShip(-44, -63, 0.54, 1.52);
      buildCargoShip(43, -79, 0.79, 1.38);
      var water = new THREE.Mesh(G.plane, IM.water);
      water.position.set(0, -0.63, -46);
      water.rotation.x = -Math.PI / 2;
      water.scale.set(286, 220, 1);
      scene.add(water);
    }

    function addDockCrane(x, z) {
      if (highVisuals) {
        addPortalCrane(x, z);
        return;
      }
      var steelDark = getBatch('steelDark');
      var steel2 = getBatch('steel2');
      var hazard = getBatch('hazard');
      var rust = getBatch('rust');
      if (!steelDark) return;
      var legX = 18.6;
      var legZ = 4.6;
      var top = 9.4;
      for (var sx = -1; sx <= 1; sx += 2) {
        for (var sz = -1; sz <= 1; sz += 2) {
          var px = x + sx * legX;
          var pz = z + sz * legZ;
          steelDark.box(px, top / 2, pz, 0.62, top, 0.62, 0);
          steelDark.box(px, 0.22, pz, 1.1, 0.44, 1.1, 0);
          addCollider(px, pz, 0.76, 0.76, 0, top);
          addContactAO(px, pz, 1.7, 1.7, 0);
          if (hazard) hazard.box(px, 1.2, pz, 0.7, 0.5, 0.7, 0);
        }
      }
      // Main girder and lower chord.
      beamXZ('steelDark', x - legX, z - legZ, x + legX, z - legZ, top, 0.48, 0.72);
      beamXZ('steelDark', x - legX, z + legZ, x + legX, z + legZ, top, 0.48, 0.72);
      beamXZ('steel2', x - legX, z - legZ, x + legX, z - legZ, top + 0.45, 0.1, 0.12);
      beamXZ('steel2', x - legX, z + legZ, x + legX, z + legZ, top + 0.45, 0.1, 0.12);
      for (var t = -legX + 2; t < legX; t += 3.1) {
        steelDark.box(x + t, top - 0.55, z, 0.11, 1.1, 0.11, 0);
        steel2.box(x + t, top - 1.05, z, 0.08, 0.08, 2 * legZ, 0);
      }
      // Trolley and hanging spreader over the container lane.
      var tx = x + 5.4;
      steelDark.box(tx, top - 1.0, z, 2.6, 1.0, 2.1, 0);
      steel2.box(tx, top - 0.55, z, 1.2, 0.3, 1.3, 0);
      for (var c = -1; c <= 1; c += 2) {
        steel2.pipe(tx + c * 0.9, top - 1.2, z, tx + c * 0.9, 4.1, z, 0.035, 4);
      }
      steelDark.box(tx, 3.55, z, 3.4, 0.5, 3.0, 0);
      if (hazard) {
        for (var hz = -2; hz <= 2; hz++) {
          hazard.box(tx, 3.84, z + hz * 0.55, 3.0, 0.08, 0.2, 0);
        }
      }
      if (rust) {
        rust.box(x - legX + 0.34, 3.2, z - legZ + 0.34, 0.3, 1.4, 0.02, 0);
        rust.box(x + legX - 0.34, 4.3, z + legZ - 0.34, 0.24, 1.1, 0.02, 0);
      }
      if (QUALITY.extraDetail) {
        for (var cs = -1; cs <= 1; cs += 2) {
          for (var cl = -1; cl <= 1; cl += 2) {
            var cxp = x + cs * legX;
            var czp = z + cl * legZ;
            for (var cb = 0; cb < 3; cb++) {
              v5Box('hazard', cxp, 1.3 + cb * 0.5, czp,
                0.7, 0.11, 0.7, 0);
            }
            for (var cr = 0; cr < 5; cr++) {
              v5Box('steel2', cxp - 0.34, 0.9 + cr * 0.72, czp,
                0.1, 0.03, 0.34, 0);
            }
            addSunShadow(cxp, czp, 0.9, top, 0, 0);
          }
        }
        for (var tr = -1; tr <= 1; tr++) {
          var trp = x + 5.4 + tr * 0.72;
          for (var sh = 0; sh < 4; sh++) {
            v5Box('steel2', trp, top - 0.2 - sh * 0.28, z + 1.08,
              0.16, 0.08, 0.06, 0);
          }
        }
        v5Box('rust', x - legX + 0.33, 2.2, z - legZ + 0.33,
          0.24, 1.1, 0.018, 0);
      }
      // Overhead sign reads from the entrance approach.
      addSignPanel(x, top + 1.15, z + legZ + 0.1, 0, 5.4, 1.05, 'DOCK CRANE 04', 'hazard');
      addSignPanel(x, top + 2.15, z + legZ + 0.1, 0, 3.6, 0.62, 'CAP 32T', 'white');
    }

    function addForklift(x, z, yaw) {
      var body = getBatch('containerOrange') || getBatch('steel');
      var dark = getBatch('steelDeep');
      var trim = getBatch('steel2');
      var hazard = getBatch('hazard');
      var rubber = getBatch('cable');
      if (!body || !dark) return;
      addContactAO(x, z, 3.1, 2.0, yaw);
      if (highVisuals) {
        var chassis = modelPart(scene, MODELS.scatter, body.material, x, 0.57, z, 1.69, 0.81, 1.08, yaw);
        chassis.castShadow = true;
        chassis.staticShadow = true;
        var counterweight = localXZ(x, z, 0, -0.33, yaw);
        modelPart(scene, MODELS.turret, IM.steelDark, counterweight[0], 0.44, counterweight[1],
          1.33, 0.53, 0.54, yaw);
      } else {
        body.box(x, 0.55, z, 1.7, 0.8, 1.05, yaw);
      }
      body.box(x, 1.15, z + 0.05, 0.9, 0.42, 0.9, yaw);
      dark.box(x, 0.18, z, 1.8, 0.22, 1.1, yaw);
      var p = localXZ(x, z, 0.35, 0.05, yaw);
      dark.box(p[0], 1.5, p[1], 0.08, 1.2, 0.08, yaw);
      if (trim) {
        trim.box(p[0], 2.08, p[1], 0.08, 0.08, 0.9, yaw);
        trim.box(x, 0.8, z + 0.58, 0.12, 0.12, 1.5, yaw);
        for (var w = -1; w <= 1; w += 2) {
          var wp = localXZ(x, z, w * 0.7, 0.72, yaw);
          trim.box(wp[0], 0.35, wp[1], 0.28, 0.52, 0.28, yaw);
        }
      }
      if (rubber && trim) {
        for (var axle of [-0.58, 0.58]) {
          for (var side of [-1, 1]) {
            var inner = localXZ(x, z, axle, side * 0.43, yaw);
            var outer = localXZ(x, z, axle, side * 0.62, yaw);
            rubber.pipe(inner[0], 0.27, inner[1], outer[0], 0.27, outer[1], 0.26, 12);
            var hub = localXZ(x, z, axle, side * 0.64, yaw);
            trim.pipe(inner[0], 0.27, inner[1], hub[0], 0.27, hub[1], 0.16, 12);
            dark.box(hub[0], 0.27, hub[1], 0.18, 0.18, 0.035, yaw);
          }
        }
        for (var fork of [-1, 1]) {
          var tine = localXZ(x, z, fork * 0.32, 0.91, yaw);
          dark.box(tine[0], 0.11, tine[1], 0.12, 0.08, 0.72, yaw);
        }
      }
      if (hazard) hazard.box(x, 0.48, z - 0.54, 1.2, 0.14, 0.03, yaw);
      if (QUALITY.extraDetail) {
        var fp = localXZ(x, z, 0, 0.56, yaw);
        for (var fg = 0; fg < 4; fg++) {
          v5Box('steelDeep', fp[0], 0.82 + fg * 0.11, fp[1], 0.72, 0.035, 0.02, yaw);
        }
        v5Box('lampWarm', fp[0], 1.02, fp[1], 0.12, 0.08, 0.02, yaw);
        var mp = localXZ(x, z, -0.35, 0.05, yaw);
        v5Box('steel2', mp[0], 1.35, mp[1], 0.035, 1.1, 0.035, yaw);
        v5Box('steel2', mp[0], 2.06, mp[1], 0.08, 0.05, 0.68, yaw);
        v5Box('hazard', mp[0], 0.52, mp[1], 0.04, 0.24, 0.04, yaw);
        v5Box('steelDeep', x, 1.42, z, 0.46, 0.08, 0.44, yaw);
        var rp = localXZ(x, z, 0, 0.58, yaw);
        v5Box('rust', rp[0], 0.55, rp[1], 0.22, 0.3, 0.014, yaw);
        addSunShadow(x, z, 1.4, 1.7, 0, yaw);
      }
      var forkliftHull = addCollider(x, z, 1.9, 1.2, 0, 1.65, 'paintedSteel');
      forkliftHull.tireBand = true;
    }

    function addBollard(x, z, scale) {
      var b = getBatch('steelDark');
      var cap = getBatch('hazard');
      if (!b) return;
      var r = 0.18 * (scale || 1);
      var h = 0.72 * (scale || 1);
      b.pipe(x, 0, z, x, h, z, r, 6);
      b.box(x, 0.08, z, r * 3.2, 0.16, r * 3.2, 0);
      if (cap) cap.box(x, h, z, r * 2.5, 0.1, r * 2.5, 0);
      if (QUALITY.extraDetail) {
        v5Box('steel2', x, h * 0.56, z, r * 2.08, 0.035, r * 2.08, 0);
        var rp = localXZ(x, z, 0, r * 1.01, 0);
        v5Box('rust', rp[0], h * 0.32, rp[1], r * 0.35, h * 0.34, 0.012, 0);
        addSunShadow(x, z, r * 2.0, h, 0, 0);
      }
      addCollider(x, z, r * 2.2, r * 2.2, 0, h);
    }

    function addPipeBollard(x, z) {
      var b = getBatch('rubber') || getBatch('steelDeep');
      if (!b) return;
      b.box(x, 0.44, z, 0.42, 0.88, 0.42, 0);
      var hz = getBatch('hazard');
      if (hz) hz.box(x, 0.66, z, 0.44, 0.14, 0.44, 0);
      addCollider(x, z, 0.46, 0.46, 0, 0.88);
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
          var p = localXZ(x, z, i * width * 0.32, width * 0.44, yaw);
          accent.box(p[0], 0.2, p[1], 0.06, 0.06, 0.06, yaw);
        }
      }
      if (rust) {
        var rp = localXZ(x, z, 0, width * 0.44, yaw);
        rust.box(rp[0], 0.75, rp[1], width * 0.25, 0.55, 0.025, yaw);
      }
      if (QUALITY.extraDetail) {
        var lp = localXZ(x, z, 0, -width * 0.58, yaw);
        for (var rung = 0; rung < 6; rung++) {
          v5Box('steel2', lp[0], 0.55 + rung * (h - 0.9) / 5, lp[1],
            width * 0.52, 0.035, 0.035, yaw);
        }
        var seam = localXZ(x, z, 0, width * 0.44, yaw);
        for (var sb = 0; sb < 3; sb++) {
          v5Box('steel2', seam[0], h * (0.2 + sb * 0.28), seam[1],
            width * 0.62, 0.05, 0.045, yaw);
        }
        addSunShadow(x, z, width * 1.5, h, 0, yaw);
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
      if (QUALITY.extraDetail) {
        for (var cg = -1; cg <= 1; cg += 2) {
          var cp = localXZ(x, z, cg * sx * 0.44, sz / 2 + 0.012, yaw);
          v5Box('steelDark', cp[0], y + sy * 0.5, cp[1], 0.07, sy * 0.78, 0.02, yaw);
          v5Box('steelDark', cp[0], y + sy * 0.86, cp[1], sx * 0.2, 0.05, 0.018, yaw);
        }
        var sp = localXZ(x, z, 0, sz / 2 + 0.026, yaw);
        v5Box('white', sp[0], y + sy * 0.38, sp[1], sx * 0.3, 0.06, 0.012, yaw);
        v5Box(tag === 'danger' ? 'redPaint' : 'hazard',
          sp[0], y + sy * 0.28, sp[1], sx * 0.22, 0.07, 0.012, yaw);
        addSunShadow(x, z, Math.min(sx, sz) * 1.1, sy + y, 0, yaw);
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
      if (QUALITY.extraDetail) {
        for (var br = 0; br < 2; br++) {
          var a = hash2(br, x) * Math.PI * 2;
          var bx = x + Math.cos(a) * r * 0.98;
          var bz = z + Math.sin(a) * r * 0.98;
          v5Box(br ? 'rustDark' : 'rust', bx, h * (0.38 + br * 0.16), bz,
            0.04 + hash2(x, br) * 0.05, h * 0.34, 0.012, -a);
        }
        var lp = localXZ(x, z, 0, r * 1.01, 0);
        v5Box(key === 'greenPaint' ? 'white' : 'hazard',
          lp[0], h * 0.58, lp[1], r * 0.9, h * 0.2, 0.014, 0);
        v5Box('steel2', lp[0], h * 0.42, lp[1], r * 0.68, 0.025, 0.012, 0);
        addSunShadow(x, z, r * 2.1, h, 0, 0);
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
      var stain = getBatch('oil');
      if (highVisuals && stain) {
        stain.patch(x - w * 0.18, 0.031, z - d * 0.18, w * 0.61, d * 0.66, 0.24, 13);
      }
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

    var ARENA_WEATHER = [
      [0.09, 0.12, 0.16, 0.32], [0.16, 0.07, 0.22, 0.48], [0.30, 0.12, 0.30, 0.69],
      [0.90, 0.061, 0.048, 1], [0.065, 0.40, 0.28, 0.55]
    ];

    var dockFog = new THREE.Color(0x6b3c4e);
    var targetFog = dockFog.clone();
    var phaseFog = dockFog.clone();

    function setArenaPhase(phase) {
      if (!arenaMood) return;
      arenaMood.phase = phase;
      var line = 0x58ddff;
      var pylon = 0x3ec8dd;
      var beacon = 0x58ddff;
      var reflect = 0xff4fb8;
      var fog = 0x6b3c4e;
      var near = 21;
      var far = 82;
      var fence = 0x4bb8c9;
      var fenceOpacity = 0;
      var barrier = false;
      var narrow = false;

      if (phase === 1) {
        line = 0x58ddff;
        pylon = 0x3ec8dd;
        beacon = 0x58ddff;
        fog = 0x6b3c4e;
        near = 21;
        far = 82;
      } else if (phase === 2) {
        line = 0x8ff4ff;
        pylon = 0x67e4ef;
        beacon = 0xffc45a;
        reflect = 0x9b6bff;
        fog = 0x4d2b4a;
        near = 19;
        far = 74;
        fence = 0xffc45a;
        fenceOpacity = 0.2;
        barrier = true;
      } else if (phase === 3) {
        line = 0xff584f;
        pylon = 0xff6b55;
        beacon = 0xff3d32;
        reflect = 0xff3d32;
        fog = 0x3a1418;
        near = 15;
        far = 62;
        fence = 0xff4a3f;
        fenceOpacity = 0.35;
        barrier = true;
        narrow = true;
      } else if (phase === 4) {
        line = 0x6dffb0;
        pylon = 0x6dffb0;
        beacon = 0x6dffb0;
        reflect = 0x6dffb0;
        fog = 0x123a3c;
        near = 20;
        far = 80;
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
      phaseFog.setHex(fog);
      var weather = ARENA_WEATHER[phase];
      renderer.setWeather(weather[0], weather[1], weather[2], weather[3]);
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
      var pulse = settings.reducedMotion ? 0.5 :
        0.5 + 0.5 * Math.sin(worldClock * (m.phase === 3 ? 8 : 3.2));
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
            m.sparkT = 0.9 + visualRandom() * 1.5;
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


    // The dockyard runs linearly from the entrance yard at +Z toward the
    // extraction pier at -Z.  46 x 67 walkable metres is roughly twice the
    // footprint of the previous indoor arena while keeping the same scale.
    var ARENA = { minX: -23, maxX: 23, minZ: -47.2, maxZ: 20 };
    var BOSS_ARENA = { minX: -20.5, maxX: 20.5, minZ: -43.2, maxZ: -24 };
    var EYE = 1.62;
    var PLAYER_HEIGHT = 1.78;
    var STEP_HEIGHT = 0.36;
    var GRAVITY = 16.5;
    var JUMP_SPEED = 7.6;
    var colliders = [];
    // Explicit whitelist of climbable top surfaces.  Visual props never
    // implicitly become standable: only entries registered here are used by
    // the vertical solver.
    var standables = [];

    function addStandable(cx, cz, sx, sz, top, label) {
      standables.push({
        minX: cx - sx / 2,
        maxX: cx + sx / 2,
        minZ: cz - sz / 2,
        maxZ: cz + sz / 2,
        top: top,
        label: label || 'SURFACE'
      });
    }

    function addCollider(cx, cz, sx, sz, y0, y1, surface) {
      colliders.push({
        minX: cx - sx / 2,
        maxX: cx + sx / 2,
        minZ: cz - sz / 2,
        maxZ: cz + sz / 2,
        y0: y0 === undefined ? 0 : y0,
        y1: y1 === undefined ? 4 : y1,
        surface: surface || 'steel',
        disabled: false,
        prop: null
      });
      return colliders[colliders.length - 1];
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

    /* ================================================================== *
     * SUNSET DOCKYARD — outdoor replacement for the indoor block
     *
     * Layout, from the player spawn toward the extraction pier:
     *   entrance yard -> container yard -> loading platform -> boss dock
     *   -> extraction exit.
     * All detail is merged procedural geometry except the small backdrop and
     * the fixed supply / boss FX groups.  No textures, no network.
     * ================================================================== */

    var skyBackdrop = null;

    function buildSkyBackdrop() {
      if (highVisuals) {
        buildHighHarbor();
        return;
      }
      PBDockArt.fallbackSky(THREE, scene, G.plane, matBasic(0xffffff, { fog: false }));

      var sunDisc = new THREE.Mesh(G.circle, matBasic(0xffd49a, {
        transparent: true, opacity: 0.92, blending: 'additive',
        depthWrite: false, fog: false
      }));
      sunDisc.position.set(-44, 15.5, -112);
      sunDisc.rotation.x = Math.PI / 2;
      sunDisc.scale.set(7.4, 7.4, 7.4);
      scene.add(sunDisc);

      var sunHalo = new THREE.Mesh(G.circle, matBasic(0xff7a4a, {
        transparent: true, opacity: 0.2, blending: 'additive',
        depthWrite: false, fog: false
      }));
      sunHalo.position.set(-44, 15.5, -112.5);
      sunHalo.rotation.x = Math.PI / 2;
      sunHalo.scale.set(19, 19, 19);
      scene.add(sunHalo);

      // Baked anamorphic flare streaks around the sun.  This is layered additive
      // geometry, not a post-process bloom buffer; it keeps the pixel language
      // and costs no extra pass.
      var flareMat = matBasic(0xffb066, {
        transparent: true, opacity: 0.13, blending: 'additive',
        depthWrite: false, fog: false
      });
      var flareH = new THREE.Mesh(G.box, flareMat);
      flareH.position.set(-44, 15.5, -111.8);
      flareH.scale.set(44, 0.22, 0.01);
      scene.add(flareH);
      var flareV = new THREE.Mesh(G.box, flareMat);
      flareV.position.set(-44, 15.5, -111.8);
      flareV.scale.set(0.22, 7.2, 0.01);
      scene.add(flareV);
      var flareD = new THREE.Mesh(G.box, flareMat);
      flareD.position.set(-44, 15.5, -111.8);
      flareD.rotation.z = Math.PI / 4;
      flareD.scale.set(18, 0.12, 0.01);
      scene.add(flareD);

      var cloudMat = matBasic(0x6d3c57, {
        transparent: true, opacity: 0.42, depthWrite: false, fog: false
      });
      for (var i = 0; i < 9; i++) {
        var cloud = new THREE.Mesh(G.box, cloudMat);
        cloud.position.set(-58 + i * 16, 18 + (i % 3) * 3.4, -113);
        cloud.scale.set(9 + (i % 4) * 5, 0.55 + (i % 2) * 0.35, 0.5);
        scene.add(cloud);
      }

      // Fogged skyline and far gantry silhouettes.  fog:false keeps the
      // silhouette from disappearing entirely into the orange haze.
      var cityMat = matBasic(0x2a2038, { fog: false });
      var cityLit = matBasic(0x7a5366, { fog: false });
      for (var b = 0; b < 26; b++) {
        var bx = -96 + b * 7.7;
        var bh = 3.5 + hash2(b, 7) * 17;
        var bz = -74 - hash2(b, 3) * 16;
        var block = new THREE.Mesh(G.box, b > 6 && b < 20 ? cityLit : cityMat);
        block.position.set(bx, bh / 2 - 0.3, bz);
        block.scale.set(3.8 + hash2(b, 11) * 3.2, bh, 4.2);
        scene.add(block);
      }
      for (var c = 0; c < 4; c++) {
        var cx = -70 + c * 46;
        var crane = new THREE.Mesh(G.box, cityMat);
        crane.position.set(cx, 9, -88);
        crane.scale.set(1.2, 18, 1.2);
        scene.add(crane);
        var arm = new THREE.Mesh(G.box, cityMat);
        arm.position.set(cx + 8, 17.5, -88);
        arm.scale.set(19, 0.7, 0.7);
        scene.add(arm);
        var arm2 = new THREE.Mesh(G.box, cityMat);
        arm2.position.set(cx + 14, 11.5, -88);
        arm2.scale.set(0.45, 12, 0.45);
        scene.add(arm2);
      }

      var water = new THREE.Mesh(G.plane, IM.water);
      water.position.set(0, -0.63, -46);
      water.rotation.x = -Math.PI / 2;
      water.scale.set(256, 193, 1);
      scene.add(water);

      // Long sunset glints on the water, merged into one additive batch.
      for (var g = 0; g < 34; g++) {
        var gx = -54 + hash2(g, 5) * 108;
        var gz = -47 - hash2(g, 9) * 63;
        var gw = 1.2 + hash2(g, 13) * 5.6;
        var glint = getBatch('waterGlint');
        if (glint) {
          glint.box(gx, -0.53, gz, gw, 0.012, 0.06 + hash2(g, 17) * 0.12, 0);
        }
      }
      // A coherent glitter path under the sun reads as a real reflection lane
      // instead of isolated random sparkles.  Still a procedural additive fake.
      for (var sg = 0; sg < 22; sg++) {
        var st = sg / 21;
        var sx = -44 + (hash2(sg, 23) - 0.5) * (2.2 + st * 22);
        var sz = -47.5 - st * 58;
        var sw = 0.35 + st * 2.4 + hash2(sg, 29) * 1.1;
        var sp = getBatch('waterGlint');
        if (sp) sp.box(sx, -0.525, sz, sw, 0.012, 0.035 + st * 0.09, 0);
        if (sp && sg % 4 === 0) {
          sp.box(sx + 1.2, -0.524, sz + 0.6, sw * 0.55, 0.012, 0.03, 0);
        }
      }
      skyBackdrop = { sunDisc: sunDisc, sunHalo: sunHalo };
    }

    function buildDockFloor() {
      var ix, iz, x, z, i, key;
      var bolt = getBatch('steel2');
      var fasteners = [[], [], [], []];
      var seam = getBatch('steelDeep');
      for (ix = 0; ix < 18; ix++) {
        for (iz = 0; iz < 27; iz++) {
          x = -21.25 + ix * 2.5;
          z = 18.75 - iz * 2.5;
          var zone = z > 9.5 ? 0 : (z > -8.5 ? 1 : (z > -22.5 ? 2 : 3));
          var h = hash2(ix + 2, iz + 5);
          if (zone === 0) {
            key = h < 0.28 ? 'quay' : (h < 0.62 ? 'asphaltWarm' : 'asphalt');
          } else if (zone === 1) {
            key = h < 0.2 ? 'quay' : (h < 0.58 ? 'asphalt' : 'asphaltWarm');
          } else if (zone === 2) {
            key = h < 0.34 ? 'quay' : (h < 0.72 ? 'asphalt' : 'asphaltWarm');
          } else {
            key = h < 0.3 ? 'asphaltWarm' : (h < 0.68 ? 'asphalt' : 'quay');
          }
          var b = getBatch(key);
          if (b) b.box(x, 0.012, z, 2.42, 0.018, 2.42, 0);
          if (hash2(iz, ix) > 0.48 && bolt) {
            for (i = -1; i <= 1; i += 2) {
              if (highVisuals) {
                fasteners[zone].push(x + i * 1.02, 0.026, z - 1.02, x + i * 1.02, 0.026, z + 1.02);
              } else {
                bolt.box(x + i * 1.02, 0.026, z - 1.02, 0.055, 0.014, 0.055, 0);
                bolt.box(x + i * 1.02, 0.026, z + 1.02, 0.055, 0.014, 0.055, 0);
              }
            }
          }
          if (seam && (ix % 3 === 0 || iz % 4 === 0)) {
            seam.box(x, 0.028, z, 2.46, 0.012, 0.035, 0);
          }
        }
      }

      for (var offsets of fasteners) {
        if (!offsets.length) continue;
        var deckBolts = new THREE.Mesh(G.box, IM.steel2);
        deckBolts.instanceOffsets = new Float32Array(offsets);
        deckBolts.scale.set(0.055, 0.014, 0.055);
        var minZ = Infinity, maxZ = -Infinity;
        for (var i = 2; i < offsets.length; i += 3) {
          minZ = Math.min(minZ, offsets[i]);
          maxZ = Math.max(maxZ, offsets[i]);
        }
        deckBolts.worldBounds = [-23, 0.015, minZ - 0.06, 23, 0.04, maxZ + 0.06];
        deckBolts.detailDistance = 31;
        scene.add(deckBolts);
      }

      // Oil, puddles and scrap: a handful of merged decals keeps the huge
      // deck from reading as a flat empty plane.
      for (i = 0; i < 34; i++) {
        x = arand(-21, 21);
        z = arand(-45, 18);
        if (z < -22.5 && Math.abs(x) < 10 && Math.abs(z + 34) < 7) continue;
        for (var k = 0; k < 3; k++) {
          var ob = getBatch(k === 0 ? 'oil' : 'steelDeep');
          if (ob) {
            ob.box(x + arand(-0.5, 0.5), 0.034, z + arand(-0.4, 0.4),
              arand(0.18, 0.8), 0.008, arand(0.06, 0.3), arand(-0.7, 0.7));
          }
        }
      }
      for (i = 0; i < 74; i++) {
        var sb = getBatch(i % 4 === 0 ? 'rust' : 'steel2');
        if (sb) {
          sb.box(arand(-22, 22), 0.035, arand(-46, 19),
            arand(0.1, 1.1), 0.007, 0.018, arand(0, 3.14));
        }
      }

      // Zone thresholds and walk lanes.
      hazardBandX(9.55, -22.2, 22.2, 0.3);
      hazardBandX(-8.5, -22.2, 22.2, 0.42);
      hazardBandX(-22.45, -22.2, 22.2, 0.44);
      hazardBandX(-43.55, -22.2, 22.2, 0.3);
      if (!highVisuals) {
        for (i = -2; i <= 2; i++) {
          var lane = getBatch(i % 2 ? 'hazard' : 'hazardDark');
          if (lane) {
            lane.box(0, 0.038, 5.5, 0.16, 0.01, 35.0, 0);
            lane.box(0, 0.038, -31.5, 0.16, 0.01, 22.0, 0);
          }
        }
      }
      var glowLine = getBatch('screen');
      if (glowLine) {
        for (var zz = 14; zz >= -42; zz -= 2.4) {
          glowLine.box(-4.9, 0.039, zz, 0.035, 0.008, 1.1, 0);
          glowLine.box(4.9, 0.039, zz, 0.035, 0.008, 1.1, 0);
        }
      }
      drawFloorText('hazard', 0, 15.2, '07', 0.48);
      drawFloorText('hazardDark', 0, 14.95, '07', 0.48);
      drawFloorText('hazard', 0, -6.0, 'BAY A', 0.3);
      drawFloorText('white', 14.0, -12.0, 'LOAD 04', 0.24);
      drawFloorText('hazard', 0, -31.0, 'DOCK 4', 0.4);

      // V5 deck pass: expansion joints, wet/oil patches with a sparse shared
      // atlas, tyre scuffs and readable lane chevrons.  These are all merged
      // startup geometry; the atlas contributes wear, not a new texture unit.
      if (QUALITY.extraDetail && !highVisuals) {
        var jointZ = [12.6, 0.6, -11.8, -24.2, -39.6];
        for (i = 0; i < jointZ.length; i++) {
          v5Box('steelDeep', 0, 0.031, jointZ[i], 43.4, 0.012, 0.055, 0);
          v5Box('steel2', 8.5, 0.032, jointZ[i], 0.08, 0.012, 0.12, 0);
        }
        for (i = 0; i < 12; i++) {
          x = -18.5 + (i * 7.3 + hash2(i, 4) * 5.1) % 37;
          z = 15.2 - i * 4.7 - hash2(i, 9) * 2.2;
          var pw = 0.9 + hash2(i, 2) * 1.8;
          var pd = 0.55 + hash2(i, 7) * 1.0;
          v5Box('oil', x, 0.030, z, pw, 0.008, pd, hash2(i, 3) * 1.5);
          paintFloorSurface(TEX.dockDetail, x, z, pw * 1.12, pd * 1.12, 5, 3, true, hash2(i, 3) * 1.5);
          if (i % 3 === 0) {
            v5Box('waterGlint', x, 0.041, z, pw * 0.46, 0.006, 0.035,
              hash2(i, 6) * 1.5);
          }
        }
        for (i = 0; i < 18; i++) {
          x = arand(-19, 19);
          z = arand(-41, 17);
          var ty = hash2(i, x) * 0.8 - 0.4;
          v5Box('oil', x, 0.036, z, 0.9 + hash2(i, z) * 1.3, 0.006, 0.07, ty);
          v5Box('oil', x + 0.7, 0.036, z + 0.24, 0.7 + hash2(z, i) * 1.1, 0.006, 0.06, ty);
        }
        var arrowZ = [12.0, 3.6, -4.8, -28.0, -40.5];
        for (i = 0; i < arrowZ.length; i++) {
          var ax = i % 2 ? 2.6 : -2.6;
          v5Box('hazard', ax, 0.042, arrowZ[i], 0.14, 0.01, 1.15, 0);
          v5Box('hazard', ax - 0.3, 0.042, arrowZ[i] - 0.48, 0.14, 0.01, 0.52, 0.72);
          v5Box('hazard', ax + 0.3, 0.042, arrowZ[i] - 0.48, 0.14, 0.01, 0.52, -0.72);
        }
        for (i = 0; i < 9; i++) {
          var rz = 14 - i * 6.2;
          v5Box(i % 2 ? 'reflectWarm' : 'reflectCool', i % 2 ? -16.2 : 16.2,
            0.053, rz, 0.9, 0.006, 2.8, 0);
        }
      }

      if (highVisuals) {
        addWetDeckDetails();
        var crack = getBatch('steelDeep');
        for (var j = 0; j < 18; j++) {
          var startX = (hash2(j, 81) - 0.5) * 42;
          var startZ = 18 - hash2(j, 93) * 61;
          for (var k = 0; k < 3; k++) {
            var endX = startX + 0.12 + hash2(j, k + 101) * 0.52;
            var endZ = startZ + (hash2(j, k + 99) - 0.5) * 0.49;
            var dx = endX - startX, dz = endZ - startZ;
            crack.box((startX + endX) / 2, 0.024, (startZ + endZ) / 2,
              Math.hypot(dx, dz), 0.004, 0.009, -Math.atan2(dz, dx));
            startX = endX;
            startZ = endZ;
          }
        }
      }

      // The boss deck keeps a wide hazard ring and a clear central lane.
      for (i = 0; i < 40; i++) {
        var a = i / 40 * Math.PI * 2;
        var ring = getBatch(i % 2 ? 'hazardDark' : 'hazard');
        if (ring) {
          ring.box(Math.cos(a) * 7.2, 0.041, -34 + Math.sin(a) * 7.2,
            0.44, 0.01, 0.16, -a);
        }
      }
      addContactAO(0, -34, 18, 16, 0, true);
    }

    function buildDockPerimeter() {
      var i, x, z;
      var wall = getBatch('concreteDark');
      var wall2 = getBatch('concrete');
      var trim = getBatch('steelDark');
      var roof = getBatch('steelDeep');
      var bolt = getBatch('steel2');

      // Entrance warehouse behind the spawn.  Its facade reads as a solid
      // industrial backdrop and closes the +Z side of the yard.
      for (i = 0; i < 7; i++) {
        x = -20.4 + i * 6.8;
        if (wall) wall.box(x, 3.4, 21.2, 6.5, 6.8, 2.2, 0);
        if (wall2) wall2.box(x, 3.5, 20.05, 5.7, 5.6, 0.16, 0);
        if (trim) {
          trim.box(x, 6.9, 21.0, 6.7, 0.22, 2.4, 0);
          trim.box(x, 0.35, 20.0, 5.8, 0.32, 0.24, 0);
        }
        if (bolt) {
          bolt.box(x - 2.6, 0.55, 20.02, 0.09, 0.09, 0.12, 0);
          bolt.box(x + 2.6, 0.55, 20.02, 0.09, 0.09, 0.12, 0);
        }
      }
      addSignPanel(0, 5.2, 19.92, 0, 10.5, 1.25, 'SUNSET DOCKYARD 07', 'hazard');
      addSignPanel(0, 3.7, 19.92, 0, 6.4, 0.8, 'BERTH 07 // EXTRACTION', 'white');
      for (i = -2; i <= 2; i++) {
        var door = getBatch('steelDeep');
        if (door) door.box(i * 7.2, 2.1, 19.95, 3.2, 3.6, 0.12, 0);
      }

      // Long quay edges: visible drop to water plus a thin safety rail.  The
      // player clamp sits just inside the rail so there is no accidental swim.
      for (var side = -1; side <= 1; side += 2) {
        x = side * 23.25;
        for (z = 18; z >= -44; z -= 4.2) {
          if (wall) wall.box(x, 0.1, z, 0.9, 1.4, 4.3, 0);
          if (trim) trim.box(x, 0.78, z, 0.24, 0.1, 4.2, 0);
        }
        addGuardRail(side * 22.8, -8.0, side * 22.8, -43.4);
        addFenceLine(side * 22.8, -7.8, side * 22.8, 8.8, 2.1);
      }

      // Dock edge at the boss arena, with a central extraction opening.
      for (var ex = -1; ex <= 1; ex += 2) {
        for (i = 0; i < 5; i++) {
          x = ex * (5.6 + i * 3.8);
          if (wall) wall.box(x, 0.12, -44.1, 3.6, 1.5, 0.9, 0);
          addCollider(x, -44.1, 3.6, 0.9, 0, 1.0);
        }
        addGuardRail(ex * 5.2, -43.8, ex * 22.6, -43.8);
      }
      // Bollards line the edge but leave the exit lane clear.
      for (i = -3; i <= 3; i++) {
        if (i === 0) continue;
        addBollard(i * 5.9, -43.2, 1.15);
      }
      addBollard(-10.2, -43.2, 1.0);
      addBollard(10.2, -43.2, 1.0);

      // Low maintenance shed on the east side of the entrance.
      if (wall) wall.box(19.4, 1.7, 15.8, 5.4, 3.4, 5.8, 0);
      if (roof) roof.box(19.4, 3.48, 15.8, 5.9, 0.2, 6.3, 0);
      if (trim) trim.box(19.4, 2.6, 12.86, 5.5, 0.16, 0.14, 0);
      addCollider(19.4, 15.8, 5.4, 5.8, 0, 3.5);
      addSignPanel(16.62, 2.35, 14.5, -Math.PI / 2, 2.0, 0.55, 'MAINT', 'white');
      addContactAO(19.4, 15.8, 6.4, 6.8, 0);

      // Distant breakwater and channel marker silhouettes.
      var marker = getBatch('hazard');
      for (i = 0; i < 4; i++) {
        if (marker) {
          marker.box(-30 - i * 13, 1.2, -49 - i * 4, 0.5, 2.4, 0.5, 0);
          marker.box(30 + i * 13, 1.2, -49 - i * 4, 0.5, 2.4, 0.5, 0);
        }
      }
    }

    function buildEntranceYard() {
      var i;
      // Entry gate: two braced posts and a readable header.
      for (var side = -1; side <= 1; side += 2) {
        addIBeam(side * 9.4, 9.7, 4.9, 0.85, 0);
        addCollider(side * 9.4, 9.7, 0.9, 0.9, 0, 4.9);
      }
      beamXZ('steelDark', -9.4, 9.7, 9.4, 9.7, 4.55, 0.34, 0.48);
      beamXZ('steel2', -9.4, 9.7, 9.4, 9.7, 4.9, 0.1, 0.12);
      if (highVisuals) {
        buildEntryCanopy();
      } else {
        addSignPanel(0, 4.1, 9.78, 0, 6.6, 0.9, 'ENTRY 07', 'hazard');
        addSignPanel(0, 3.35, 9.78, 0, 5.2, 0.45, 'SUNSET SHIFT // 18:40', 'white');
      }

      // Spawn-side props.  The low crates are explicit jump/step surfaces.
      var c1 = getBatch('containerTeal');
      if (c1) c1.box(-6.2, 0.31, 15.4, 1.5, 0.62, 1.1, 0.05);
      addCollider(-6.2, 15.4, 1.5, 1.1, 0, 0.62);
      addStandable(-6.2, 15.4, 1.5, 1.1, 0.62, 'ENTRY CRATE');
      addCrate(-6.2, 0.62, 15.35, 0.9, 0.5, 0.8, -0.06, '');
      addCollider(-6.2, 15.35, 0.9, 0.8, 0.62, 1.12, 'wood');
      addStandable(-6.2, 15.35, 0.9, 0.8, 1.12, 'ENTRY CRATE');

      addCrate(6.4, 0, 16.2, 1.7, 0.85, 1.1, -0.04, 'danger');
      addCollider(6.4, 16.2, 1.7, 1.1, 0, 0.85, 'wood');
      addStandable(6.4, 16.2, 1.7, 1.1, 0.85, 'ENTRY CRATE');
      addCrate(6.3, 0.85, 16.1, 0.9, 0.45, 0.75, 0.1, '');
      addCollider(6.3, 16.1, 0.9, 0.75, 0.85, 1.3, 'wood');
      addStandable(6.3, 16.1, 0.9, 0.75, 1.3, 'ENTRY CRATE');

      addContainer(-15.5, 16.4, 3.2, 1.35, 2.3, 0, 'containerOrange', 0, {
        standable: true, code: 'LOW-1'
      });
      addPallet(10.6, 15.1, 0.08);
      addPallet(10.6, 13.7, 0.02);
      addPallet(-12.4, 14.0, -0.1);
      addBarrelCluster(-19.6, 17.2, 4);
      addCollider(-19.6, 17.2, 1.4, 1.4, 0, 0.95);
      addBarrelCluster(20.2, 18.2, 3);
      addCollider(20.2, 18.2, 1.3, 1.3, 0, 0.95);
      addControlCabinet(14.5, 18.6, Math.PI, 1.2, 1.6);
      addCollider(14.5, 18.6, 1.25, 0.62, 0, 1.6);
      addCrate(12.4, 0, 18.4, 1.1, 0.7, 0.8, 0.04, '');
      addCollider(12.4, 18.4, 1.1, 0.8, 0, 0.7, 'wood');
      addStandable(12.4, 18.4, 1.1, 0.8, 0.7, 'ENTRY CRATE');

      addFloorGrate(-13.6, 12.0, 1.8, 1.1);
      addFloorGrate(13.4, 12.3, 1.6, 1.0);
      addZoneLightPool(0, 14.8, 6.4, 'Warm');
      addZoneLightPool(-8.2, 12.0, 2.8, 'Warm');
      addZoneLightPool(8.2, 12.0, 2.8, 'Warm');
      addReflectionFloor('reflectWarm', 0, 17.0, 0, 5.4, 0.3);
      addReflectionFloor('reflectWarm', -8.2, 12.0, 0, 3.2, 0.16);
      addReflectionFloor('reflectWarm', 8.2, 12.0, 0, 3.2, 0.16);
      var barrier = getBatch('hazard');
      if (barrier) {
        for (i = -3; i <= 3; i++) {
          if (Math.abs(i) < 2) continue;
          barrier.box(i * 2.4, 0.62, 10.3, 1.3, 0.12, 0.12, 0);
        }
      }
    }

    function buildContainerYard() {
      var i;
      // Stacked ISO containers frame a clear central lane.  Heights vary and
      // the palette rotates so the yard reads as a working terminal.
      var left = [
        [-14.9, 7.0, 6.0, 2.6, 2.45, 'containerBlue'],
        [-15.1, 3.6, 6.2, 2.6, 2.45, 'containerRed'],
        [-15.0, 0.0, 5.6, 2.0, 2.45, 'containerGreen'],
        [-15.4, -4.0, 6.4, 2.6, 2.45, 'containerOrange'],
        [-15.2, -7.4, 4.6, 1.35, 2.2, 'containerTeal']
      ];
      var right = [
        [14.9, 8.2, 6.0, 2.0, 2.45, 'containerGreen'],
        [15.0, 4.8, 5.6, 2.6, 2.45, 'containerPurple'],
        [15.2, 1.2, 6.2, 2.6, 2.45, 'containerOrange'],
        [14.8, -2.8, 5.4, 2.0, 2.45, 'containerBlue'],
        [15.0, -6.6, 5.8, 2.6, 2.45, 'containerRed']
      ];
      for (i = 0; i < left.length; i++) {
        var L = left[i];
        addContainer(L[0], L[1], L[2], L[3], L[4], 0, L[5]);
        if (i === 0 || i === 3) {
          addContainer(L[0] - 0.2, L[1], L[2] * 0.92, 2.2, L[4], 0,
            i === 0 ? 'containerRed' : 'containerTeal', L[3]);
        }
      }
      for (i = 0; i < right.length; i++) {
        var R = right[i];
        addContainer(R[0], R[1], R[2], R[3], R[4], 0, R[5]);
        if (i === 1 || i === 4) {
          addContainer(R[0] + 0.15, R[1], R[2] * 0.9, 2.1, R[4], 0,
            i === 1 ? 'containerBlue' : 'containerOrange', R[3]);
        }
      }

      // Low standable boxes and pallets create the optional traversal route.
      addContainer(-7.4, 3.4, 3.1, 1.35, 2.2, 0, 'containerTeal', 0, {
        standable: true, code: 'LOW-2'
      });
      addContainer(7.3, -3.9, 3.3, 1.2, 2.25, 0, 'containerRed', 0, {
        standable: true, code: 'LOW-3'
      });
      addContainer(6.8, 6.2, 2.4, 0.9, 1.6, 0.06, 'containerBlue', 0, {
        standable: true, code: 'STEP-4'
      });
      addPallet(-6.9, -5.2, -0.06);
      addPallet(-6.9, -3.7, 0.02);
      addCrate(8.6, 0, 8.2, 1.35, 0.95, 1.0, 0.04, 'danger');
      addCollider(8.6, 8.2, 1.35, 1.0, 0, 0.95, 'wood');
      addStandable(8.6, 8.2, 1.35, 1.0, 0.95, 'YARD CRATE');
      addBarrelCluster(-20.2, 4.2, 4);
      addCollider(-20.2, 4.2, 1.5, 1.5, 0, 0.95);
      addBarrelCluster(20.0, -0.8, 4);
      addCollider(20.0, -0.8, 1.5, 1.5, 0, 0.95);
      addForklift(-9.7, 9.0, 0.35);
      addFloorGrate(0, 6.4, 2.2, 1.3);
      addFloorGrate(0, -1.2, 2.2, 1.3);

      addSignPanel(-11.85, 2.4, 7.0, Math.PI / 2, 3.4, 0.75, 'BAY A', 'hazard');
      addSignPanel(11.85, 2.2, 4.8, -Math.PI / 2, 3.4, 0.75, 'BAY B', 'hazard');
      if (highVisuals) {
        addSignPanel(-12.62, 4.11, -4.0, Math.PI / 2, 2.06, 0.52, 'DKY 441', 'white');
        addSignPanel(12.50, 3.88, -6.6, -Math.PI / 2, 2.06, 0.52, 'DKY 208', 'white');
      } else {
        addSignPanel(-11.9, 4.55, -7.4, Math.PI / 2, 2.8, 0.6, 'DKY 441', 'white');
        addSignPanel(11.9, 3.4, -6.6, -Math.PI / 2, 2.8, 0.6, 'DKY 208', 'white');
      }

      addDockCrane(0, 1.4);
      addZoneLightPool(0, 1.4, 5.2, 'Warm');
      addReflectionFloor('reflectWarm', 0, 4.0, 0, 7.0, 0.42);
      addReflectionFloor('reflectWarm', -7.4, 3.4, Math.PI / 2, 4.0, 0.2);
      addReflectionFloor('reflectWarm', 7.3, -3.9, Math.PI / 2, 4.0, 0.2);
    }

    function buildLoadingPlatform() {
      var p = getBatch('quay');
      var edge = getBatch('steelDark');
      var trim = getBatch('steel2');
      var hazard = getBatch('hazard');
      var px = 14.0, pz = -16.0, pw = 13.0, pd = 11.0, ph = 0.62;
      if (p) {
        p.box(px, ph / 2, pz, pw, ph, pd, 0);
        p.box(px, ph + 0.08, pz + pd / 2, pw, 0.18, 0.24, 0);
        p.box(px, ph + 0.08, pz - pd / 2, pw, 0.18, 0.24, 0);
        p.box(px + pw / 2, ph + 0.08, pz, 0.24, 0.18, pd, 0);
      }
      if (edge) {
        edge.box(px, ph + 0.04, pz, pw + 0.12, 0.1, pd + 0.12, 0);
      }
      if (hazard) {
        hazard.box(px, ph + 0.1, pz + pd / 2 - 0.35, pw - 0.4, 0.05, 0.18, 0);
        hazard.box(px, ph + 0.1, pz - pd / 2 + 0.35, pw - 0.4, 0.05, 0.18, 0);
      }
      addCollider(px, pz, pw, pd, 0, ph, 'concrete');
      addStandable(px, pz, pw, pd, ph, 'LOADING PLATFORM');
      addContactAO(px, pz, pw * 1.12, pd * 1.12, 0);
      // Step pallet so the platform can be entered without a huge jump.
      addPallet(px, pz + pd / 2 + 0.75, 0, 0.0);
      var step = getBatch('quay');
      if (step) step.box(px, 0.17, pz + pd / 2 + 0.72, 2.2, 0.34, 1.3, 0);
      addCollider(px, pz + pd / 2 + 0.72, 2.2, 1.3, 0, 0.34, 'concrete');
      addStandable(px, pz + pd / 2 + 0.72, 2.2, 1.3, 0.34, 'LOADING STEP');

      // Repair gantry / welding frame on the platform.
      for (var side = -1; side <= 1; side += 2) {
        addIBeam(px + side * 3.2, pz - 3.4, 3.4, 0.55, 0);
        addCollider(px + side * 3.2, pz - 3.4, 0.6, 0.6, 0, 3.4);
      }
      beamXZ('steelDark', px - 3.2, pz - 3.4, px + 3.2, pz - 3.4, 3.3, 0.24, 0.3);
      if (highVisuals) buildRepairGantry(px, pz - 3.4);
      else addSignPanel(px, 2.75, pz - 3.32, 0, 3.6, 0.62, 'REPAIR 04', 'hazard');
      addControlCabinet(5.6, -16.8, Math.PI, 1.15, 1.55);
      addCollider(5.6, -16.8, 1.2, 0.6, 0, 1.55);
      addCrate(px - 3.8, ph, pz + 1.0, 1.2, 0.8, 0.9, 0.04, 'danger');
      addCollider(px - 3.8, pz + 1.0, 1.2, 0.9, ph, ph + 0.8, 'wood');
      addStandable(px - 3.8, pz + 1.0, 1.2, 0.9, ph + 0.8, 'REPAIR CRATE');
      addBarrelCluster(5.8, -20.8, 3);
      addCollider(5.8, -20.8, 1.3, 1.3, 0, 0.95);

      addContainer(14.0, -19.0, 4.2, 1.1, 2.2, 0.04, 'containerGreen', ph, {
        standable: true, code: 'REPAIR-1'
      });
      // Two fixed turret pedestals for wave 2.  Their tops are not in the
      // traversal whitelist; the turrets sit on them instead.
      for (var tp = -1; tp <= 1; tp += 2) {
        var tpx = tp * 19.5;
        var tpz = tp < 0 ? -18.5 : -8.5;
        var ped = getBatch('concreteDark');
        if (ped) ped.box(tpx, 0.8, tpz, 2.3, 1.6, 2.3, 0);
        addCollider(tpx, tpz, 2.3, 2.3, 0, 1.6, 'concrete');
        var pedGlow = getBatch('hazard');
        if (pedGlow) pedGlow.box(tpx, 1.5, tpz + 1.17, 1.6, 0.16, 0.03, 0);
      }
      addCrate(8.4, 0, -8.6, 1.5, 0.9, 1.0, -0.05, '');
      addCollider(8.4, -8.6, 1.5, 1.0, 0, 0.9, 'wood');
      addStandable(8.4, -8.6, 1.5, 1.0, 0.9, 'LOAD CRATE');
      addForklift(5.4, -13.1, -0.3);
      addBarrelCluster(-20.5, -14.5, 4);
      var reelFrame = getBatch('steelDark');
      var cable = getBatch('cable');
      reelFrame.pipe(19.18, 1.06, -18.9, 19.28, 1.06, -18.9, 0.40, 14);
      cable.pipe(19.28, 1.06, -18.9, 19.71, 1.06, -18.9, 0.31, 14);
      reelFrame.pipe(19.71, 1.06, -18.9, 19.80, 1.06, -18.9, 0.40, 14);
      addSignPanel(17.6, 0.89, -18.38, 0, 0.68, 0.16, 'TOOLS', 'white');
      getBatch('containerOrange').box(17.6, 0.81, -18.56, 0.68, 0.21, 0.35, 0);
      addCollider(-20.5, -14.5, 1.5, 1.5, 0, 0.95);

      addZoneLightPool(px, pz, 5.0, 'Warm');
      addReflectionFloor('reflectWarm', px, pz + 4.0, 0, 6.0, 0.34);
      addReflectionFloor('reflectWarm', 14.0, -19.0, 0, 3.3, 0.18);
    }

    function buildBossDock() {
      var i;
      var hazard = getBatch('hazard');
      var dark = getBatch('steelDark');
      var trim = getBatch('steel2');
      var rust = getBatch('rust');
      var corners = [
        [-19.1, -25.6, 0x3ec8dd],
        [19.1, -25.6, 0x3ec8dd],
        [-19.1, -41.8, 0x3ec8dd],
        [19.1, -41.8, 0x3ec8dd]
      ];
      for (i = 0; i < corners.length; i++) {
        addBossPylon(corners[i][0], corners[i][1]);
        addCollider(corners[i][0], corners[i][1], 1.15, 1.15, 0, 4.3);
      }
      for (i = 0; i < 4; i++) {
        var a = i / 4 * Math.PI * 2;
        var ring = new THREE.Mesh(G.ring, IM.fxPylon);
        ring.position.set(Math.cos(a) * 4.1, 0.06, -34 + Math.sin(a) * 4.1);
        ring.scale.set(0.56, 1, 0.56);
        ring.rotation.z = 0.12;
        scene.add(ring);
        energyRings.push({ mesh: ring, speed: 0.35 + i * 0.1, axis: 'flat', base: 0.12 });
      }
      var inside = new THREE.Mesh(G.ring, IM.fxLine);
      inside.position.set(0, 0.07, -34);
      inside.scale.set(4.6, 1, 4.6);
      inside.rotation.z = 0.05;
      scene.add(inside);
      energyRings.push({ mesh: inside, speed: 0.14, axis: 'flat', base: 0.05 });

      // Boss gateway frame sits behind the arena, not over the combat lane.
      for (var s = -1; s <= 1; s += 2) {
        if (dark) dark.box(s * 21.4, 3.0, -24.2, 0.6, 6.0, 0.6, 0);
        addCollider(s * 21.4, -24.2, 0.65, 0.65, 0, 6.0);
      }
      beamXZ('steelDark', -21.4, -24.2, 21.4, -24.2, 5.9, 0.4, 0.55);
      beamXZ('steel2', -21.4, -24.2, 21.4, -24.2, 6.25, 0.1, 0.12);
      addSignPanel(0, 5.2, -24.05, 0, 7.2, 0.95, 'GATEKEEPER ZERO', 'hazard');
      addSignPanel(0, 4.35, -24.05, 0, 5.0, 0.5, 'AUTHORIZED BREACH ONLY', 'white');

      // Side cover: containers at the edge, deliberately not standable, so
      // the open arena cannot be turned into a high camping spot.
      addContainer(-21.0, -30.0, 3.2, 2.6, 7.2, Math.PI / 2, 'containerRed');
      addContainer(-21.0, -38.0, 3.2, 2.0, 6.0, Math.PI / 2, 'containerBlue');
      addContainer(21.0, -30.0, 3.2, 2.6, 7.2, -Math.PI / 2, 'containerGreen');
      addContainer(21.0, -38.0, 3.2, 2.0, 6.0, -Math.PI / 2, 'containerOrange');
      addBarrelCluster(-17.2, -42.4, 3);
      addBarrelCluster(17.2, -42.4, 3);
      addCollider(-17.2, -42.4, 1.3, 1.3, 0, 0.95);
      addCollider(17.2, -42.4, 1.3, 1.3, 0, 0.95);

      // Broken gantry and service cables overhead add depth without cover.
      beamXZ('steelDark', -12.0, -26.0, 12.0, -26.0, 6.8, 0.2, 0.26);
      if (rust) {
        rust.box(-11.8, 6.4, -26.0, 0.3, 0.7, 0.06, 0);
        rust.box(11.6, 6.3, -26.0, 0.25, 0.8, 0.06, 0);
      }
      var cable = getBatch('cable');
      if (cable) {
        cable.pipe(-21.0, 5.4, -27.0, -15.0, 4.6, -31.0, 0.045, 5);
        cable.pipe(-15.0, 4.6, -31.0, -18.5, 3.9, -36.0, 0.04, 5);
        cable.pipe(21.0, 5.2, -28.0, 16.0, 4.4, -33.0, 0.045, 5);
      }

      addReflectionFloor('reflectBoss', 0, -34.0, 0, 6.4, 0.72);
      addReflectionFloor('reflectBoss', -3.4, -34.0, Math.PI / 2, 4.6, 0.32);
      addReflectionFloor('reflectBoss', 3.4, -34.0, Math.PI / 2, 4.6, 0.32);
      addReflectionWall('reflectBoss', -22.6, 1.6, -34.0, Math.PI / 2, 8.0, 2.6);
      addReflectionWall('reflectBoss', 22.6, 1.6, -34.0, -Math.PI / 2, 8.0, 2.6);
      addReflectionFloor('reflectExit', 0, -44.6, 0, 4.2, 0.42);
      addReflectionFloor('reflectExit', 0, -45.9, 0, 0.24, 4.3);

      var arenaGlowMat = matBasic(0x58ddff, {
        transparent: true, opacity: 0.04, blending: 'additive',
        depthWrite: false, fog: false
      });
      var arenaGlowCoreMat = matBasic(0x9ff2ff, {
        transparent: true, opacity: 0.07, blending: 'additive',
        depthWrite: false, fog: false
      });
      var arenaGlow = new THREE.Mesh(G.circle, arenaGlowMat);
      arenaGlow.position.set(0, 0.066, -34);
      arenaGlow.scale.set(7.2, 1, 7.2);
      scene.add(arenaGlow);
      var arenaCore = new THREE.Mesh(G.circle, arenaGlowCoreMat);
      arenaCore.position.set(0, 0.068, -34);
      arenaCore.scale.set(2.8, 1, 2.8);
      scene.add(arenaCore);
      for (var pg = -1; pg <= 1; pg += 2) {
        var pylonGlow = new THREE.Mesh(G.circle, arenaGlowMat);
        pylonGlow.position.set(pg * 19.1, 0.067, -25.6);
        pylonGlow.scale.set(2.5, 1, 2.5);
        scene.add(pylonGlow);
        var pylonColumn = new THREE.Mesh(G.box, arenaGlowCoreMat);
        pylonColumn.position.set(pg * 19.1, 2.1, -25.6);
        pylonColumn.scale.set(0.46, 4.1, 0.46);
        scene.add(pylonColumn);
      }

      var beaconMat = matBasic(0x58ddff, {
        transparent: true, opacity: 0.75, blending: 'additive', depthWrite: false, fog: false
      });
      var beacons = [];
      var beaconPos = [
        [-18.4, -25.0], [18.4, -25.0], [-18.4, -42.2], [18.4, -42.2]
      ];
      for (i = 0; i < beaconPos.length; i++) {
        var beacon = new THREE.Mesh(G.box, beaconMat);
        beacon.position.set(beaconPos[i][0], 4.0, beaconPos[i][1]);
        beacon.scale.set(0.11, 0.42, 0.11);
        scene.add(beacon);
        beacons.push(beacon);
      }

      var fenceMat = matBasic(0x4bb8c9, {
        transparent: true, opacity: 0.18, blending: 'additive', depthWrite: false, fog: false
      });
      var barrierGroup = new THREE.Group();
      addFenceAssembly(barrierGroup, fenceMat, -20.1, -34.0, 17.0, 3.6, Math.PI / 2);
      addFenceAssembly(barrierGroup, fenceMat, 20.1, -34.0, 17.0, 3.6, -Math.PI / 2);
      barrierGroup.visible = false;
      scene.add(barrierGroup);

      var narrowMat = matBasic(0xff4a3f, {
        transparent: true, opacity: 0.25, blending: 'additive', depthWrite: false, fog: false
      });
      var narrowGroup = new THREE.Group();
      addFenceAssembly(narrowGroup, narrowMat, -16.4, -34.0, 15.0, 3.5, Math.PI / 2);
      addFenceAssembly(narrowGroup, narrowMat, 16.4, -34.0, 15.0, 3.5, -Math.PI / 2);
      narrowGroup.visible = false;
      scene.add(narrowGroup);

      addWallVent(-22.8, 3.0, -31.0, Math.PI / 2, 2.2, 1.2);
      addWallVent(22.8, 3.0, -31.0, -Math.PI / 2, 2.2, 1.2);

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
        near: 21,
        far: 82,
        sparkPoint: new THREE.Vector3(21.0, 4.0, -31.0),
        sparkT: 1.4
      };
    }

    function buildDockLamps() {
      addDockLamp(-8.2, 12.0, 4.5, 0xffb153, 'lampWarm');
      addDockLamp(8.2, 12.0, 4.5, 0xffb153, 'lampWarm');
      addDockLamp(-21.0, 8.4, 6.0, 0xffb153, 'lampWarm');
      addDockLamp(21.0, 8.4, 6.0, 0xffb153, 'lampWarm');
      addDockLamp(-21.0, -5.0, 6.0, 0xffb153, 'lampWarm');
      addDockLamp(21.0, -5.0, 6.0, 0xffb153, 'lampWarm');
      addDockLamp(20.8, -12.4, 6.2, 0xffb153, 'lampWarm');
      addDockLamp(-20.8, -21.0, 5.8, 0xffb153, 'lampWarm');
      addDockLamp(-19.5, -43.0, 5.2, 0x8fe6ff, 'lampCool');
      addDockLamp(19.5, -43.0, 5.2, 0x8fe6ff, 'lampCool');
    }

    function buildSupplyStations() {
      for (var i = 0; i < supplyStations.length; i++) {
        var st = supplyStations[i];
        var group = new THREE.Group();
        group.position.set(st.x, st.baseY, st.z);
        // Both panels face the lane the player arrives from.
        group.rotation.y = st.id === 'repair' ? Math.PI : 0;
        scene.add(group);

        var bodyMat = matLambert(0x3a3f46, { specular: 0.38, roughness: 0.42 });
        tuneSurface(bodyMat, 0.9, 0.52, 0.38);
        tuneTexture(bodyMat, DETAIL_TILE.metal, 0.62, 0.7);
        var trimMat = matLambert(0x8a6a3a, { specular: 0.5, roughness: 0.3 });
        tuneSurface(trimMat, 0.9, 0.68, 0.26);
        tuneTexture(trimMat, DETAIL_TILE.metal, 0.72, 0.6);
        var panelMat = matBasic(0x281a0e);
        var base = new THREE.Mesh(G.box, bodyMat);
        base.position.set(0, 0.22, 0);
        base.scale.set(1.5, 0.44, 1.0);
        group.add(base);
        var top = new THREE.Mesh(G.box, trimMat);
        top.position.set(0, 0.47, 0);
        top.scale.set(1.6, 0.08, 1.08);
        group.add(top);
        var panel = new THREE.Mesh(G.box, panelMat);
        panel.position.set(0, 0.72, -0.18);
        panel.scale.set(0.7, 0.42, 0.08);
        group.add(panel);

        st.lampMat = matBasic(C.amber, {
          transparent: true, opacity: 0.72, blending: 'additive',
          depthWrite: false, fog: false
        });
        var lamp = new THREE.Mesh(G.box, st.lampMat);
        lamp.position.set(0, 0.76, -0.14);
        lamp.scale.set(0.5, 0.09, 0.04);
        group.add(lamp);
        st.lamp = lamp;

        st.ringMat = matBasic(C.amber, {
          transparent: true, opacity: 0.5, blending: 'additive',
          depthWrite: false, fog: false
        });
        var ring = new THREE.Mesh(G.ring, st.ringMat);
        ring.position.set(0, 0.56, 0);
        ring.scale.set(0.82, 0.82, 0.82);
        group.add(ring);
        st.ring = ring;

        var coreMat = matBasic(C.amber, {
          transparent: true, opacity: 0.16, blending: 'additive',
          depthWrite: false, fog: false
        });
        var core = new THREE.Mesh(G.circle, coreMat);
        core.position.set(0, 0.06, 0);
        core.scale.set(1.35, 1.35, 1.35);
        group.add(core);
        st.core = core;
        st.coreMat = coreMat;

        // Two canisters make the station read as a resupply cache from afar.
        var canMat = matLambert(0x6b4a2a, { specular: 0.42, roughness: 0.4 });
        tuneSurface(canMat, 0.86, 0.4, 0.34);
        tuneTexture(canMat, DETAIL_TILE.metal, 0.68, 0.62);
        for (var c = -1; c <= 1; c += 2) {
          var can = new THREE.Mesh(G.cylinder, canMat);
          can.position.set(c * 0.46, 0.32, 0.34);
          can.scale.set(0.16, 0.42, 0.16);
          group.add(can);
        }
        var post = new THREE.Mesh(G.box, trimMat);
        post.position.set(0.66, 1.15, 0.12);
        post.scale.set(0.07, 1.5, 0.07);
        group.add(post);
        var sign = new THREE.Mesh(G.box, st.lampMat);
        sign.position.set(0.66, 1.82, 0.12);
        sign.scale.set(0.44, 0.3, 0.06);
        group.add(sign);

        st.group = group;
        addCollider(st.x, st.z, 1.55, 1.05, st.baseY, st.baseY + 0.52);
        addStandable(st.x, st.z, 1.55, 1.05, st.baseY + 0.52, 'SUPPLY CACHE');
        addFloorGlow(st.x, st.z, 1.75, C.amber, 0.05);
      }
    }

    function nearestSupply(range) {
      var best = null;
      var bestD = range;
      for (var i = 0; i < supplyStations.length; i++) {
        var st = supplyStations[i];
        var d = dist2D(player.pos, st);
        if (d < bestD) {
          bestD = d;
          best = st;
        }
      }
      return best;
    }

    function supplyNeeded() {
      return player.hp < player.maxHp - 0.01 ||
        weapons[0].reserve < WEAPON_DEFS[0].reserveMax ||
        weapons[1].reserve < WEAPON_DEFS[1].reserveMax;
    }

    function canResupply(st) {
      return !!st && st.cooldown <= 0 && supplyNeeded();
    }

    function cancelSupply() {
      supply.active = false;
      supply.station = null;
      supply.progress = 0;
      supply.startX = player.pos.x;
      supply.startZ = player.pos.z;
    }

    function finishSupply(st) {
      if (!canResupply(st)) {
        cancelSupply();
        return;
      }
      player.hp = Math.min(player.maxHp, player.hp + 40);
      weapons[0].reserve = Math.min(WEAPON_DEFS[0].reserveMax, weapons[0].reserve + 50);
      weapons[1].reserve = Math.min(WEAPON_DEFS[1].reserveMax, weapons[1].reserve + 16);
      st.cooldown = SUPPLY_COOLDOWN;
      events.emit('supply.complete', { station: st.id });
      addToast('补给完成 // +40 HP / 步枪 +50 / 散射 +16', 'good');
      flashScreen(0x5affb0, false);
      spawnRingFx(new THREE.Vector3(st.x, st.baseY + 0.12, st.z),
        2.6, 0x5affb0, 0.45, st.baseY + 0.12);
      spawnParticles(new THREE.Vector3(st.x, st.baseY + 0.9, st.z),
        0xffc861, 12, 3.6, 0.35, 0.04);
      cancelSupply();
      updateHud();
    }

    function tryStartSupply() {
      if (mode !== 'playing' || supply.active || player.slashT > 0 ||
        !player.grounded || player.dashT > 0) return false;
      var st = nearestSupply(SUPPLY_RANGE);
      if (!st || !canResupply(st)) return false;
      events.emit('supply.start', { station: st.id });
      supply.active = true;
      supply.station = st;
      supply.progress = 0;
      supply.startX = player.pos.x;
      supply.startZ = player.pos.z;
      input.fireHeld = false;
      input.fireQueued = false;
      return true;
    }

    function updateSupply(dt) {
      if (mode !== 'playing') {
        if (supply.active) cancelSupply();
        updateSupplyHud();
        return;
      }
      for (var i = 0; i < supplyStations.length; i++) {
        supplyStations[i].cooldown = Math.max(0, supplyStations[i].cooldown - dt);
      }
      supply.near = nearestSupply(SUPPLY_RANGE);
      var moveHeld = held('forward') || held('left') || held('back') || held('right');

      if (supply.active) {
        var moved = Math.abs(player.pos.x - supply.startX) +
          Math.abs(player.pos.z - supply.startZ);
        if (!supply.near || supply.near !== supply.station ||
          !held('interact') || !player.grounded || moved > 0.22 || moveHeld) {
          cancelSupply();
          addToast('补给中断 // 保持静止并按住 E', 'warn');
        } else {
          supply.progress += dt;
          if (supply.progress >= SUPPLY_TIME) {
            finishSupply(supply.station);
          }
        }
      }

      if (!supply.active && supply.near && held('interact') && !moveHeld &&
        player.grounded && player.dashT <= 0 && canResupply(supply.near) &&
        player.slashT <= 0) {
        tryStartSupply();
      }

      updateSupplyVisuals();
      updateSupplyHud();
    }

    function updateSupplyVisuals() {
      var pulse = 0.5 + 0.5 * Math.sin(worldClock * 3.4);
      for (var i = 0; i < supplyStations.length; i++) {
        var st = supplyStations[i];
        if (!st.group) continue;
        var active = supply.active && supply.station === st;
        var cooling = st.cooldown > 0;
        var full = !cooling && !supplyNeeded();
        var col = active ? C.cyan : (full ? C.green : (cooling ? 0x6f8ba6 : C.amber));
        if (st.lampMat) {
          st.lampMat.color.setHex(col);
          st.lampMat.opacity = active ? 0.9 : (cooling ? 0.22 : 0.55 + pulse * 0.25);
        }
        if (st.ringMat) {
          st.ringMat.color.setHex(col);
          st.ringMat.opacity = active ? 0.8 : (cooling ? 0.08 : 0.22 + pulse * 0.18);
        }
        if (st.coreMat) st.coreMat.color.setHex(col);
        if (st.ring) st.ring.rotation.y += 0.009 + (active ? 0.02 : 0);
        if (st.lamp) st.lamp.scale.y = 0.07 + pulse * 0.04;
      }
    }

    function updateSupplyHud() {
      if (!ui.supplyPanel) return;
      var st = supply.active ? supply.station : supply.near;
      if (!st || mode !== 'playing') {
        ui.supplyPanel.hidden = true;
        return;
      }
      ui.supplyPanel.hidden = false;
      setText(ui.supplyName, st.name);
      var cls = ui.supplyPanel.classList;
      cls.remove('is-cooling', 'is-full', 'is-active');
      if (supply.active && supply.station === st) {
        cls.add('is-active');
        setText(ui.supplyState, 'SUPPLYING // ' + Math.round(supply.progress / SUPPLY_TIME * 100) + '%');
        ui.supplyFill.style.width = (supply.progress / SUPPLY_TIME * 100).toFixed(1) + '%';
      } else if (st.cooldown > 0) {
        cls.add('is-cooling');
        setText(ui.supplyState, 'COOLDOWN // ' + st.cooldown.toFixed(1) + 's');
        ui.supplyFill.style.width = ((1 - st.cooldown / SUPPLY_COOLDOWN) * 100).toFixed(1) + '%';
      } else if (!supplyNeeded()) {
        cls.add('is-full');
        setText(ui.supplyState, 'FULL // HP 与备弹已满');
        ui.supplyFill.style.width = '100%';
      } else {
        setText(ui.supplyState, 'READY // 按住 E 补给');
        ui.supplyFill.style.width = '0%';
      }
    }

    function repeatDockPart(key, offsets, width, height, depth) {
      if (!offsets.length) return;
      if (!highVisuals) {
        var batch = getBatch(key);
        for (var i = 0; i < offsets.length; i += 3) {
          batch.box(offsets[i], offsets[i + 1], offsets[i + 2], width, height, depth, 0);
        }
        return;
      }
      var mesh = new THREE.Mesh(G.box, IM[key]);
      mesh.instanceOffsets = new Float32Array(offsets);
      mesh.scale.set(width, height, depth);
      var bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (var i = 0; i < offsets.length; i += 3) {
        for (var axis = 0; axis < 3; axis++) {
          bounds[axis] = Math.min(bounds[axis], offsets[i + axis]);
          bounds[axis + 3] = Math.max(bounds[axis + 3], offsets[i + axis]);
        }
      }
      for (var axis = 0; axis < 3; axis++) {
        var pad = (axis === 0 ? width : axis === 1 ? height : depth) * 0.5;
        bounds[axis] -= pad;
        bounds[axis + 3] += pad;
      }
      mesh.worldBounds = bounds;
      scene.add(mesh);
    }

    function buildArena() {
      var landmarks = new THREE.Group();
      var set = PBPortSetpieces.build({
        batch: getBatch, sign: addSignPanel, floor: drawFloorText, high: highVisuals,
        shape: function (model, finish, x, y, z, w, h, d) {
          modelPart(landmarks, MODELS[model], IM[finish] || IM.steel2, x, y, z, w, h, d);
        }
      });
      // Outdoor sunset dockyard, linear from the entrance at +Z to the
      // extraction pier at -Z.  The former indoor shell is intentionally gone.
      buildSkyBackdrop();
      buildDockFloor();
      buildDockPerimeter();
      batchZone = 1;
      buildEntranceYard();
      set.entrance();
      batchZone = 2;
      buildContainerYard();
      set.freight();
      batchZone = 3;
      buildLoadingPlatform();
      set.repair();
      batchZone = 5;
      PBSectors.backgroundPier(getBatch, repeatDockPart);
      PBSectors.layout({
        batch: getBatch, standable: addStandable, collider: addCollider, floor: drawFloorText,
        pipe: addPipeRun,
        sign: function (x, y, z, width, height, label) { addSignPanel(x, y, z, 0, width, height, label, 'white'); }
      });
      batchZone = 4;
      buildBossDock();
      set.basin();
      set.extraction();
      PBModelKit.bake(THREE, landmarks, scene, highVisuals);
      batchZone = 0;
      buildDockLamps();
      buildSupplyStations();
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
      buildSlashPool();
      buildEnemyPools();
      setArenaPhase(0);
    }

    var exit = {
      unlocked: false,
      pos: new THREE.Vector3(0, 1.5, -45.35),
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
      tuneSurface(frameMat, 0.9, 0.6, 0.32);
      tuneTexture(frameMat, DETAIL_TILE.metal, 0.7, 0.65);
      var top = new THREE.Mesh(MODELS.turret, frameMat);
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
      exit.glowMat.decal = PBDockArt.scorchDecal(THREE);
      var glow = new THREE.Mesh(G.plane, exit.glowMat);
      glow.scale.set(2.9, 2.9, 1);
      glow.position.set(0, 0.5, -0.03);
      group.add(glow);

      for (var post of [-2.10, 2.10]) {
        modelPart(group, MODELS.seal, IM.steel2, post, 0.50, 0.34, 0.12, 1.35, 0.15, Math.PI / 2);
        var conduit = modelPart(group, MODELS.tube, frameMat, post * 0.90, 0.53, 0.38, 0.058, 2.55, 0.058);
        conduit.castShadow = true;
        conduit.staticShadow = true;
      }

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
    // Eight fixed candidate emitters.  Quality decides how many are enabled:
    // High may use all eight, Balanced five, Fallback four.  Every PointLight is
    // built once here; the frame path only moves/retunes existing objects.
    var LOCAL_LIGHT_CANDIDATES = 9;
    var localLights = [];
    var localRig = {
      entry: null, lamp: null, pipe: null, core: null,
      boss: null, exit: null, supplyEntry: null, supplyRepair: null
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
      // Warm gate light, cool container spill, amber loading lamp, boss
      // approach fill, boss core, exit, and two supply-cache fills.  Quality
      // decides how many of the eight candidates may be active.
      registerLocalLight('entry', {
        x: 0, y: 3.7, z: 10.4, hex: 0xff9a4a,
        intensity: 1.05, range: 10.2, priority: 1.7
      });
      registerLocalLight('lamp', {
        x: 6.8, y: 3.6, z: 4.6, hex: 0x7fc8e8,
        intensity: 0.8, range: 9.2, priority: 1.15
      });
      registerLocalLight('pipe', {
        x: 13.5, y: 3.0, z: -16.0, hex: 0xffa95c,
        intensity: 0.95, range: 9.6, priority: 1.45
      });
      registerLocalLight('core', {
        x: 0, y: 3.0, z: -25.8, hex: 0x58ddff,
        intensity: 0.95, range: 10.0, priority: 1.8
      });
      // Boss core light is created once and follows the active core.
      registerLocalLight('boss', {
        x: 0, y: 2.5, z: -34, hex: 0xff4fb8,
        intensity: 0, range: 10.2, priority: 3.0, enabled: false
      });
      // Exit gate is red while locked and green once the boss is down.
      registerLocalLight('exit', {
        x: 0, y: 2.35, z: -45.15, hex: 0xff4d6d,
        intensity: 0.85, range: 7.2, priority: 2.0
      });
      // Supply caches get low-priority local fills so their state colour reads
      // on nearby crates and deck plates, not just on the emissive station mesh.
      registerLocalLight('supplyEntry', {
        x: -9.2, y: 1.0, z: 16.3, hex: 0xffa94d,
        intensity: 0.55, range: 5.2, priority: 0.95
      });
      registerLocalLight('muzzle', {
        x: 0, y: 1.5, z: 0, hex: 0xffc278,
        intensity: 2.5, range: 3.4, priority: 4, enabled: false
      });
      registerLocalLight('supplyRepair', {
        x: 14.0, y: 1.6, z: -16.0, hex: 0xffa94d,
        intensity: 0.6, range: 5.6, priority: 1.0
      });
    }

    function updateLocalLightRig() {
      var i, entry;
      var max = Math.min(QUALITY.maxLocalLights, localLights.length);
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
      // strong source-to-surface colour pollution without adding a ninth
      // candidate light or exceeding the active local-light slots.
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

      for (i = 0; i < 2; i++) {
        entry = i === 0 ? localRig.supplyEntry : localRig.supplyRepair;
        if (!entry) continue;
        var station = supplyStations[i];
        var ready = station.cooldown <= 0 && supplyNeeded();
        var active = supply.active && supply.station === station;
        entry.light.color.setHex(active ? 0x6dffb0 :
          (station.cooldown > 0 ? 0xff6f7d : (ready ? 0xffb153 : 0x7f9bb8)));
        entry.enabled = true;
        entry.light.intensity = (active ? 1.0 : (ready ? 0.7 : 0.35)) +
          Math.sin(worldClock * 1.6 + entry.phase) * 0.05;
      }

      var muzzleEntry = localRig.muzzle;
      if (muzzleEntry) {
        muzzleEntry.enabled = mode === 'playing' && muzzleT > 0;
        if (muzzleEntry.enabled) {
          muzzleWorldPos(muzzleEntry.light.position);
          muzzleEntry.light.intensity = muzzleEntry.baseIntensity * (muzzleT / 0.06);
        }
      }

      // Score = priority falloff by distance.  Sorting this eight-element array
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

      var geo = opts.shape === 'box' ? G.lowSphere : (opts.shape === 'cylinder' ? G.cylinder : G.cone);
      var outerMat = volumeMaterial(opts.hex, opts.opacity);
      var coreMat = volumeMaterial(opts.coreHex === undefined ? 0xffffff : opts.coreHex,
        opts.coreOpacity === undefined ? opts.opacity * 0.7 : opts.coreOpacity);
      outerMat.softVolume = coreMat.softVolume = true;
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
        baseOuter: opts.opacity * 0.32,
        baseCore: (opts.coreOpacity === undefined ? opts.opacity * 0.7 : opts.coreOpacity) * 0.36,
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
        [-8.2, 12.0, 0xffb153, 0xffefd0],
        [8.2, 12.0, 0xffb153, 0xffefd0],
        [-21.0, 8.4, 0xffb153, 0xffefd0],
        [21.0, 8.4, 0xffb153, 0xffefd0],
        [-21.0, -5.0, 0xffb153, 0xffefd0],
        [21.0, -5.0, 0xffb153, 0xffefd0],
        [20.8, -12.4, 0xffb153, 0xffefd0],
        [-20.8, -21.0, 0xffb153, 0xffefd0]
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

      // Amber quay-light contamination at the loading edge.
      volumeFx.pipeBeams.push(addVolumeBeam({
        shape: 'cone', x: 13.5, y: 1.9, z: -16.0,
        radius: 1.25, coreRadius: 0.52, height: 3.8,
        hex: 0xff8a3e, coreHex: 0xffc39a,
        opacity: 0.045, coreOpacity: 0.07, speed: 0.55, kind: 'pipe'
      }));
      volumeFx.pipeBeams.push(addVolumeBeam({
        shape: 'cone', x: -20.8, y: 1.9, z: -21.0,
        radius: 1.05, coreRadius: 0.44, height: 3.8,
        hex: 0xff8a3e, coreHex: 0xffc39a,
        opacity: 0.04, coreOpacity: 0.06, speed: 0.48, kind: 'pipe'
      }));

      // Warm threshold curtain at the entry gate.
      volumeFx.entryBeam = addVolumeBeam({
        shape: 'box', x: 0, y: 1.7, z: 9.75,
        width: 9.6, height: 3.4, depth: 0.3,
        hex: 0xff9a4a, coreHex: 0xffeed0,
        opacity: 0.03, coreOpacity: 0.045, speed: 1.1, kind: 'entry'
      });

      // Cool fill column at the boss approach.
      volumeFx.coreBeam = addVolumeBeam({
        shape: 'cylinder', x: 0, y: 2.2, z: -25.8,
        radius: 0.62, coreRadius: 0.24, height: 4.4,
        hex: 0x4fd8ff, coreHex: 0xd6fbff,
        opacity: 0.055, coreOpacity: 0.1, speed: 2.0, kind: 'core'
      });

      // Boss pylon columns; colour is driven by the arena phase.
      for (i = -1; i <= 1; i += 2) {
        var pylonBeam = addVolumeBeam({
          shape: 'cylinder', x: i * 19.1, y: 2.1, z: -25.6,
          radius: 0.56, coreRadius: 0.22, height: 4.2,
          hex: 0x3ec8dd, coreHex: 0xd9ffff,
          opacity: 0.06, coreOpacity: 0.1, speed: 2.6, kind: 'pylon'
        });
        if (pylonBeam) volumeFx.bossPylons.push(pylonBeam);
      }

      // A floor-anchored column that follows the active boss core horizontally.
      volumeFx.bossCore = addVolumeBeam({
        shape: 'cylinder', x: 0, y: 2.1, z: -34,
        radius: 1.48, coreRadius: 0.56, height: 4.2,
        hex: 0xff4fb8, coreHex: 0xffe3f4,
        opacity: 0.045, coreOpacity: 0.08,
        speed: 3.2, kind: 'bossCore', pulseScale: 1
      });
      if (volumeFx.bossCore) volumeFx.bossCore.group.visible = false;

      // Exit portal volume plus a cone of spill into the arena.
      volumeFx.exitBeam = addVolumeBeam({
        shape: 'box', x: 0, y: 1.52, z: -45.0,
        width: 3.5, height: 2.85, depth: 0.18,
        hex: 0xff4d6d, coreHex: 0xffd9de,
        opacity: 0.05, coreOpacity: 0.09, speed: 1.8, kind: 'exit'
      });
      volumeFx.exitSpill = addVolumeBeam({
        shape: 'cone', x: 0, y: 1.55, z: -43.8, rotationX: -Math.PI / 2,
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
      addReflectionStrip(-1.12, -43.9, 0, 0.16, 3.8, exitHex, 0.055 + pulse * 0.045);
      addReflectionStrip(0, -43.6, 0, 0.2, 4.4, exitHex, 0.07 + pulse * 0.055);
      addReflectionStrip(1.12, -43.9, 0, 0.16, 3.8, exitHex, 0.055 + pulse * 0.045);
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
          arand(-22, 22),
          arand(0.5, 6.8),
          arand(-46, 19)
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
    // The low sun sits at (-0.72, 0.38, 0.52), so ground shadows stretch
    // toward +x/-z and read much longer than the old indoor rig.
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
      var limit = Math.min(QUALITY.contactShadows, contactShadows.length);
      for (var i = 0; i < contactShadows.length; i++) {
        var s = contactShadows[i];
        if (i >= limit) {
          if (s.soft.visible) s.soft.visible = false;
          if (s.core.visible) s.core.visible = false;
          continue;
        }
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
      transparent: true, opacity: 0.98, blending: 'additive', viewModel: true, radiance: 4.6,
      depthTest: false, depthWrite: false
    });
    var muzzleHaloMat = matBasic(0xffc46a, {
      transparent: true, opacity: 0.22, blending: 'additive', viewModel: true, radiance: 1.8,
      depthTest: false, depthWrite: false
    });
    var muzzleStarMat = matBasic(0xfff0c0, {
      transparent: true, opacity: 0.85, blending: 'additive', viewModel: true, radiance: 2.7,
      depthTest: false, depthWrite: false
    });
    var muzzleRingMat = matBasic(0xffd27a, {
      transparent: true, opacity: 0.38, blending: 'additive', viewModel: true, radiance: 2.1,
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
      return matBasic(hex, { depthTest: false, depthWrite: false, viewModel: true });
    }

    function vmFinish(hex, roughness) {
      var material = vmMat(hex);
      material.unlit = !highVisuals;
      material.specular = 0.68;
      material.roughness = roughness;
      return material;
    }

    var gunBody = vmFinish(0x9db4ca, 0.4);
    var gunLight = vmFinish(0xc9dceb, 0.33);
    var gunMid = vmFinish(0x60788f, 0.52);
    var gunDark = vmFinish(0x2c3a4c, 0.62);
    var gunDeep = vmFinish(0x151f2b, 0.69);
    var gunGlow = vmMat(C.cyan);
    var gunGlowSoft = vmMat(0xc9fbff);
    var gunPink = vmMat(C.magenta);
    var gunPinkSoft = vmMat(0xffb4e2);
    var gunViolet = vmMat(C.violet);
    var gunVioletDeep = vmFinish(0x4a2a86, 0.31);
    var gunVioletSoft = vmMat(0xe4d4ff);
    var gunWhite = vmFinish(0xf4edff, 0.29);
    var gunAmber = vmMat(C.amber);
    var gloveMat = vmFinish(0x24434a, 0.83);
    var gloveLight = vmFinish(0x47707a, 0.73);
    var gloveDark = vmFinish(0x12262c, 0.91);
    var bladeAuraMat = matBasic(C.violet, {
      transparent: true,
      opacity: 0.22,
      blending: 'additive',
      viewModel: true,
      depthTest: false,
      depthWrite: false
    });

    // Camera-relative PBR lights reveal the viewmodel finish. Energy trim stays emissive.
    tuneSurface(gunBody, 1.0, 0.45, 0.72);
    tuneSurface(gunLight, 1.0, 0.5, 0.78);
    tuneSurface(gunMid, 1.0, 0.4, 0.7);
    tuneSurface(gunDark, 1.0, 0.35, 0.62);
    tuneSurface(gunDeep, 1.0, 0.3, 0.52);
    tuneSurface(gunWhite, 1.0, 0.5, 0.8);
    tuneSurface(gunVioletDeep, 1.0, 0.35, 0.5);
    tuneSurface(gloveMat, 1.0, 0.2, 0.58);
    tuneSurface(gloveLight, 1.0, 0.25, 0.64);
    tuneSurface(gloveDark, 1.0, 0.2, 0.52);
    MATERIAL_LIBRARY.weaponFinish.push(gunBody, gunLight, gunMid, gunDark, gunDeep, gunWhite);
    MATERIAL_LIBRARY.rubber.push(gloveMat, gloveDark);
    // Use the same surface library in object space on held weapons.
    tuneTexture(gunBody, DETAIL_TILE.metal, 1.0, 0.46);
    tuneTexture(gunLight, DETAIL_TILE.metal, 1.0, 0.4);
    tuneTexture(gunMid, DETAIL_TILE.chips, 1.0, 0.44);
    tuneTexture(gunDark, DETAIL_TILE.chips, 1.0, 0.42);
    tuneTexture(gunDeep, DETAIL_TILE.chips, 1.0, 0.34);
    tuneTexture(gunWhite, DETAIL_TILE.paint, 1.0, 0.3);
    tuneTexture(gunVioletDeep, DETAIL_TILE.paint, 1.0, 0.32);
    tuneTexture(gloveMat, DETAIL_TILE.grime, 1.0, 0.28);
    tuneTexture(gloveLight, DETAIL_TILE.grime, 1.0, 0.24);
    tuneTexture(gloveDark, DETAIL_TILE.grime, 1.0, 0.26);

    if (highVisuals) {
      var metalParts = [gunBody, gunLight, gunMid, gunDark, gunDeep, gunVioletDeep];
      for (var mp = 0; mp < metalParts.length; mp++) {
        var metalMat = metalParts[mp];
        metalMat.unlit = false;
        metalMat.specular = mp < 3 ? 0.59 : 0.36;
        metalMat.roughness = mp < 3 ? 0.28 : 0.46;
        metalMat.textureScale = 2.4;
        metalMat.textureMix = mp < 3 ? 0.34 : 0.27;
      }
      var gloves = [gloveMat, gloveLight, gloveDark];
      for (var glv = 0; glv < gloves.length; glv++) {
        gloves[glv].unlit = false;
        gloves[glv].specular = 0.09;
        gloves[glv].roughness = 0.87;
        gloves[glv].textureScale = 2.3;
        gloves[glv].textureMix = 0.70;
      }
      gunBody.color.setHex(0xabaeab);
      gunMid.color.setHex(0x5f665f);
      gunDark.color.setHex(0x313939);
      gunDeep.color.setHex(0x242832);
      gunGlow.radiance = 2.9;
      gunGlowSoft.radiance = 1.6;
      gunPink.radiance = 2.35;
      gunPinkSoft.radiance = 2.1;
      gunViolet.radiance = 1.45;
      gunVioletSoft.radiance = 2.2;
      gunWhite.radiance = 2.85;
    }

    // Flat-faced octagonal sections create shared cast housings and blades.
    // Sections run from the muzzle/tip toward the rear along local Z.
    function sculptHull(sections, bevel) {
      var pos = [], normals = [], indices = [];
      var rings = sections.map(function (section) {
        var z = section[0], w = section[1] * 0.5, h = section[2] * 0.5, y = section[3] || 0;
        var a = w * (1 - bevel), b = h * (1 - bevel);
        return [[-a, y - h, z], [a, y - h, z], [w, y - b, z], [w, y + b, z],
          [a, y + h, z], [-a, y + h, z], [-w, y + b, z], [-w, y - b, z]];
      });

      function face(vertices) {
        var a = vertices[0], b = vertices[1], c = vertices[2];
        var ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        var ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        var n = ab.cross(ac).normalize();
        var start = pos.length / 3;
        for (var i = 0; i < vertices.length; i++) {
          pos.push(vertices[i][0], vertices[i][1], vertices[i][2]);
          normals.push(n.x, n.y, n.z);
        }
        for (var t = 1; t < vertices.length - 1; t++) indices.push(start, start + t, start + t + 1);
      }

      for (var s = 0; s < rings.length - 1; s++) {
        for (var r = 0; r < 8; r++) {
          var next = (r + 1) % 8;
          face([rings[s][r], rings[s][next], rings[s + 1][next], rings[s + 1][r]]);
        }
      }
      face(rings[0].slice().reverse());
      face(rings[rings.length - 1]);
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', { array: new Float32Array(pos), itemSize: 3 });
      geo.setAttribute('normal', { array: new Float32Array(normals), itemSize: 3 });
      geo.setIndex(new Uint16Array(indices));
      return geo;
    }

    var HULL = {
      housing: sculptHull([[-0.5, 0.72, 0.68], [-0.34, 1, 1], [0.33, 1, 1], [0.5, 0.77, 0.70]], 0.28),
      cowl: sculptHull([[-0.5, 0.55, 0.50, -0.09], [-0.27, 0.92, 0.92],
        [0.24, 1, 1], [0.5, 0.68, 0.68]], 0.34),
      shield: sculptHull([[-0.5, 0.52, 0.68], [-0.27, 0.88, 0.95],
        [0.21, 1.0, 1.0], [0.5, 0.78, 0.72]], 0.39)
    };

    function modelPart(parent, geometry, material, x, y, z, sx, sy, sz, ry, rz) {
      var part = new THREE.Mesh(geometry, material);
      part.position.set(x, y, z);
      part.scale.set(sx, sy, sz);
      if (ry || rz) part.rotation.set(0, ry || 0, rz || 0);
      parent.add(part);
      return part;
    }

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

    function vmHull(parent, geo, mat, x, y, z, sx, sy, sz, order, ry, rz) {
      var part = modelPart(parent, geo, mat, x, y, z, sx, sy, sz, ry, rz);
      part.renderOrder = order === undefined ? 950 : order;
      return part;
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
      rifleMag: null,
      rifleMagY: 0,
      rifleMagZ: 0,
      scatterDrum: null,
      scatterGate: null,
      scatterShells: [],
      bladeGroup: null,
      bladeCore: null,
      bladeCoreBase: null,
      bladeAura: null,
      bladeAuraBase: null
    };

    var weaponGroups = [];
    var viewSwayYaw = 0, viewSwayPitch = 0;
    var lastViewYaw = 0, lastViewPitch = 0;

    function buildPulseRifle() {
      var rifle = new THREE.Group();
      var oxide = vmFinish(0x5b3938, 0.48);
      var carbon = vmFinish(0x271f25, 0.88);
      tuneTexture(oxide, DETAIL_TILE.metal, 3.1, 0.60);
      tuneTexture(carbon, DETAIL_TILE.rust, 3.4, 0.52);
      vmRing(rifle, oxide, 0, 0.03, -0.675, 0.031, 'z', 952);
      vmRing(rifle, carbon, 0, 0.03, -0.700, 0.032, 'z', 952);
      var graphite = vmFinish(0x303539, 0.54);
      var ceramic = vmFinish(0xa29786, 0.49);
      tuneSurface(ceramic, 0.96, 0.16, 0.46);
      tuneTexture(ceramic, DETAIL_TILE.paint, 2.15, 0.62);
      tuneTexture(graphite, DETAIL_TILE.metal, 3.2, 0.42);
      vmBox(rifle, graphite, -0.04, 0.068, 0.246, 0.035, 0.012, 0.139, 952);
      for (var slot = 0; slot < 5; slot++) {
        vmBox(rifle, gunDeep, -0.041, 0.075, 0.192 + slot * 0.025, 0.028, 0.004, 0.007, 953);
      }

      // Layered stock and butt pad, readable from the rear of the viewmodel.
      vmHull(rifle, MODELS.rifle, graphite, 0, 0.012, 0.235, 0.090, 0.096, 0.23);
      vmBox(rifle, gunDark, 0, 0.012, 0.33, 0.082, 0.105, 0.038);
      vmBox(rifle, gunDeep, 0, 0.012, 0.351, 0.058, 0.09, 0.006, 951);
      vmHull(rifle, MODELS.rifle, ceramic, 0, 0.058, 0.245, 0.072, 0.036, 0.165);
      vmBox(rifle, gunDark, 0, -0.035, 0.235, 0.078, 0.038, 0.11);
      vmBox(rifle, gunDeep, -0.038, 0.012, 0.235, 0.006, 0.05, 0.13, 951);
      vmBox(rifle, gunMid, 0, 0.012, 0.14, 0.09, 0.085, 0.05);
      vmBox(rifle, gunDeep, 0, 0.025, 0.19, 0.045, 0.03, 0.08);
      vmBox(rifle, gunGlow, -0.035, 0.045, 0.25, 0.006, 0.008, 0.045, 951);
      vmBox(rifle, gunLight, 0, 0.04, 0.352, 0.065, 0.007, 0.004, 951);
      vmBox(rifle, gunLight, 0, -0.02, 0.352, 0.055, 0.007, 0.004, 951);

      // Receiver: dark chassis, pale upper, side armour and seam bolts.
      if (highVisuals) {
        vmHull(rifle, HULL.housing, gunDark, 0, -0.008, -0.06, 0.144, 0.133, 0.43);
        vmHull(rifle, MODELS.rifle, ceramic, 0, 0.074, -0.112, 0.162, 0.100, 0.451);
        vmHull(rifle, MODELS.rifle, gunDark, -0.047, 0.09, -0.121, 0.095, 0.040, 0.39, 951);
        vmHull(rifle, MODELS.rifle, gunMid, 0, 0.053, 0.229, 0.086, 0.079, 0.23);
        vmHull(rifle, HULL.shield, gunMid, 0, 0.04, 0.20, 0.104, 0.108, 0.204);
        vmBox(rifle, gunDeep, -0.074, 0.018, -0.08, 0.011, 0.052, 0.154, 951);
        vmCyl(rifle, gunGlowSoft, -0.080, 0.018, -0.105, 0.011, 0.107, 'z', 951);
        for (var charge = 0; charge < 4; charge++) {
          vmRing(rifle, gunLight, -0.080, 0.018, -0.151 + charge * 0.031, 0.013, 'z', 951);
        }
        vmHull(rifle, HULL.cowl, gunBody, 0, 0.047, -0.423, 0.13, 0.106, 0.228);
        for (var vent = 0; vent < 5; vent++) {
          vmBox(rifle, gunDeep, -0.056, 0.072, -0.346 - vent * 0.035,
            0.028, 0.018, 0.011, 951, 0, 0, 0.49);
        }
      } else {
        vmBox(rifle, gunDark, 0, -0.005, -0.03, 0.13, 0.118, 0.38);
        vmBox(rifle, gunBody, 0, 0.065, -0.085, 0.118, 0.06, 0.31);
      }
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

      // V5 receiver wear: etched unit mark, chipped paint and exposed metal.  All
      // startup viewmodel geometry; the render order keeps it above the casing.
      vmBox(rifle, gunLight, -0.0755, -0.012, -0.10, 0.003, 0.026, 0.058, 952);
      vmBox(rifle, gunDeep, -0.0762, -0.012, -0.10, 0.002, 0.006, 0.046, 952);
      vmBox(rifle, gunAmber, -0.0762, -0.048, -0.072, 0.002, 0.008, 0.018, 952);
      for (var wc = 0; wc < 4; wc++) {
        vmBox(rifle, wc % 2 ? gunLight : gunMid, -0.075,
          0.026 + hash2(wc, 3) * 0.045, -0.15 + wc * 0.026,
          0.002, 0.006 + hash2(wc, 5) * 0.012, 0.01, 952);
      }
      vmBox(rifle, gunLight, -0.0415, 0.038, 0.20, 0.002, 0.008, 0.03, 952);
      vmBox(rifle, gunDeep, -0.0422, 0.036, 0.20, 0.002, 0.003, 0.025, 952);

      // Top rail, rear aperture and front post.
      vmBox(rifle, gunDeep, 0, 0.11, -0.12, 0.055, 0.012, 0.33);
      for (i = 0; i < 6; i++) {
        vmBox(rifle, gunMid, 0, 0.119, -0.25 + i * 0.052, 0.062, 0.012, 0.024);
      }
      if (highVisuals) {
        vmHull(rifle, MODELS.optic, graphite, 0, 0.161, 0.022, 0.052, 0.041, 0.141);
        vmHull(rifle, MODELS.seal, gunMid, 0, 0.161, 0.041, 0.043, 0.037, 0.036, 952);
        vmHull(rifle, MODELS.joint, gunDark, -0.045, 0.17, 0.036, 0.016, 0.016, 0.023, 952, Math.PI / 2);
        vmHull(rifle, MODELS.scatter, ceramic, 0, 0.205, 0.014, 0.071, 0.019, 0.098, 953);
        vmHull(rifle, MODELS.lens, gunGlow, 0, 0.166, 0.094, 0.020, 0.017, 0.003, 953);
        vmRing(rifle, gunMid, 0, 0.166, 0.082, 0.035, 'z');
        vmRing(rifle, gunLight, 0, 0.166, 0.094, 0.028, 'z', 951);
        vmCyl(rifle, gunGlow, 0, 0.166, 0.092, 0.018, 0.006, 'z', 951);
        vmCyl(rifle, gunAmber, -0.049, 0.164, 0.038, 0.013, 0.014, 'x', 951);
      } else {
        vmBox(rifle, gunDark, 0, 0.152, 0.035, 0.078, 0.052, 0.075);
        vmBox(rifle, gunDeep, 0, 0.156, 0.068, 0.052, 0.032, 0.012, 951);
        vmBox(rifle, gunGlow, 0, 0.157, 0.075, 0.022, 0.012, 0.006, 951);
      }
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
      vmHull(rifle, MODELS.optic, graphite, 0, 0.03, -0.688, 0.032, 0.034, 0.08, 952);
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
      // Detachable box magazine: the whole group drops and tilts during the
      // reload animation, then seats with a visible charge stage.
      var mag = new THREE.Group();
      mag.position.set(0, -0.055, -0.055);
      rifle.add(mag);
      vmBox(mag, gunDeep, 0, -0.12, 0, 0.078, 0.22, 0.105, 949);
      vmBox(mag, gunMid, 0, -0.145, 0.058, 0.066, 0.16, 0.035, 949);
      vmBox(mag, gunLight, 0, -0.21, 0.062, 0.052, 0.028, 0.02, 951);
      vmBox(mag, gunGlow, 0, -0.075, 0.062, 0.018, 0.05, 0.012, 951);
      addGlove(rifle, 0, -0.14, 0.065, 0.16);

      rifle.visible = true;
      weaponGroups.push(rifle);
      viewRoot.add(rifle);

      vmRefs.rifleBolt = bolt;
      vmRefs.rifleBoltZ = bolt.position.z;
      vmRefs.rifleCell = cellGlow;
      vmRefs.rifleCellBase = { x: cellGlow.scale.x, y: cellGlow.scale.y, z: cellGlow.scale.z };
      vmRefs.rifleMag = mag;
      vmRefs.rifleMagY = mag.position.y;
      vmRefs.rifleMagZ = mag.position.z;
    }

    function buildRiftScatter() {
      var scatter = new THREE.Group();
      var tempered = vmFinish(0x674841, 0.56);
      var casing = vmFinish(0x674437, 0.48);
      tuneSurface(casing, 0.94, 0.39, 0.43);
      tuneTexture(casing, DETAIL_TILE.paint, 2.14, 0.61);
      tuneTexture(tempered, DETAIL_TILE.metal, 3.6, 0.58);
      for (var brace = 0; brace < 3; brace++) {
        vmBox(scatter, gunDark, -0.112, 0.057, -0.323 - brace * 0.052, 0.018, 0.047, 0.013, 951, 0, 0, 0.25);
      }

      // Squat receiver with a pale upper shell and dark side armour.
      if (highVisuals) {
        vmHull(scatter, HULL.housing, gunDark, 0, 0.008, -0.065, 0.228, 0.168, 0.42);
        vmHull(scatter, MODELS.scatter, casing, 0, 0.086, -0.075, 0.248, 0.142, 0.375);
        vmHull(scatter, MODELS.scatter, gunDeep, -0.065, 0.128, -0.075, 0.11, 0.058, 0.30, 951);
        vmHull(scatter, MODELS.scatter, casing, 0, 0.017, -0.411, 0.242, 0.131, 0.28);
        vmBox(scatter, gunDeep, -0.113, 0.024, -0.089, 0.013, 0.040, 0.177, 951);
        for (var shellCell = 0; shellCell < 3; shellCell++) {
          vmBox(scatter, gunPink, -0.121, 0.024, -0.147 + shellCell * 0.057, 0.006, 0.021, 0.026, 951);
        }
      } else {
        vmBox(scatter, gunDark, 0, 0.005, -0.06, 0.21, 0.16, 0.34);
        vmBox(scatter, gunBody, 0, 0.095, -0.09, 0.19, 0.055, 0.27);
      }
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

      // V5 scuffed side plate and tiny ammunition stencil.
      vmBox(scatter, gunLight, -0.1135, 0.012, 0.015, 0.003, 0.03, 0.052, 952);
      vmBox(scatter, gunDeep, -0.1142, 0.012, 0.015, 0.002, 0.007, 0.042, 952);
      vmBox(scatter, gunAmber, -0.1140, -0.028, 0.045, 0.002, 0.009, 0.016, 952);
      for (i = 0; i < 4; i++) {
        vmBox(scatter, i % 2 ? gunMid : gunLight, -0.1145,
          -0.012 + hash2(i, 8) * 0.03, -0.02 + i * 0.026,
          0.002, 0.005 + hash2(i, 2) * 0.008, 0.008, 952);
      }

      // Breech gate with five visible shell cells; it lifts during reload.
      var gate = new THREE.Group();
      scatter.add(gate);
      vmBox(gate, gunMid, 0, 0.14, 0.015, 0.15, 0.025, 0.13);
      vmBox(gate, gunDeep, 0, 0.153, -0.015, 0.11, 0.008, 0.08, 951);
      for (i = 0; i < 5; i++) {
        var shell = vmBox(gate, gunPink, -0.056 + i * 0.028, 0.157, 0.02,
          0.017, 0.01, 0.05, 951);
        vmBox(gate, gunAmber, -0.056 + i * 0.028, 0.162, 0.045,
          0.017, 0.006, 0.008, 951);
        vmRefs.scatterShells.push(shell);
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
      vmHull(scatter, MODELS.scatter, gunDark, 0, 0.035, -0.557, 0.224, 0.084, 0.052, 951);
      vmHull(scatter, MODELS.joint, casing, 0, 0.099, -0.57, 0.026, 0.026, 0.068, 952);
      for (var channel = 0; channel < 4; channel++) {
        vmHull(scatter, MODELS.seal, tempered, -0.10, 0.10, -0.30 - channel * 0.043,
          0.013, 0.013, 0.024, 952, Math.PI / 2);
      }
      vmBox(scatter, gunAmber, -0.095, 0.035, -0.525, 0.008, 0.045, 0.02, 951);
      for (i = 0; i < barrelXs.length; i++) {
        vmCyl(scatter, gunDark, barrelXs[i], 0.035, -0.635, 0.0185, 0.17, 'z', 951);
        vmRing(scatter, tempered, barrelXs[i], 0.035, -0.688, 0.020, 'z', 952);
        vmCyl(scatter, gunPink, barrelXs[i], 0.035, -0.66, 0.024, 0.016, 'z', 951);
        vmCyl(scatter, gunPinkSoft, barrelXs[i], 0.035, -0.706, 0.011, 0.012, 'z', 951);
      }

      // Large energy drum: coil bands plus a lit outer face plate.
      var drum = new THREE.Group();
      drum.position.set(0, -0.15, -0.02);
      scatter.add(drum);
      vmHull(drum, MODELS.joint, gunDeep, 0, 0, 0, 0.104, 0.110, 0.18, 950, Math.PI / 2);
      vmCyl(drum, gunPink, -0.064, 0, 0, 0.108, 0.016, 'x', 951);
      vmCyl(drum, gunMid, -0.022, 0, 0, 0.11, 0.016, 'x', 951);
      vmCyl(drum, gunPink, 0.022, 0, 0, 0.108, 0.016, 'x', 951);
      vmCyl(drum, gunMid, 0.064, 0, 0, 0.11, 0.016, 'x', 951);
      vmCyl(drum, gunBody, -0.098, 0, 0, 0.072, 0.016, 'x', 951);
      vmCyl(drum, gunPink, -0.108, 0, 0, 0.046, 0.008, 'x', 951);
      vmCyl(drum, gunVioletSoft, -0.114, 0, 0, 0.016, 0.006, 'x', 951);
      if (highVisuals) {
        vmRing(drum, gunLight, -0.111, 0, 0, 0.076, 'x', 951);
        for (var rotor = 0; rotor < 6; rotor++) {
          var rotorAngle = rotor / 6 * Math.PI * 2;
          var ry = Math.cos(rotorAngle), rz = Math.sin(rotorAngle);
          vmBox(drum, gunMid, -0.103, ry * 0.091, rz * 0.091, 0.062, 0.033, 0.041,
            951, rotorAngle);
          vmCyl(drum, gunAmber, -0.130, ry * 0.084, rz * 0.084, 0.007, 0.009, 'x', 951);
        }
      }
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
      var spine = vmFinish(0x31374a, 0.41);
      tuneSurface(spine, 0.94, 0.64, 0.44);
      tuneTexture(spine, DETAIL_TILE.metal, 2.4, 0.58);
      for (var vent = 0; vent < 3; vent++) {
        vmBox(blade, gunWhite, 0, 0.042, -0.063 - vent * 0.022, 0.048, 0.005, 0.007, 953);
      }

      // Substantial stacked grip and lit pommel.
      vmCyl(blade, gunDeep, 0, 0, 0.065, 0.03, 0.21, 'z');
      for (var i = 0; i < 6; i++) {
        vmCyl(blade, i % 2 ? gunMid : gunDark, 0, 0, 0.145 - i * 0.034, 0.036, 0.018, 'z', 951);
      }
      vmBox(blade, gunVioletDeep, -0.033, 0, 0.06, 0.006, 0.018, 0.14, 951);
      vmHull(blade, MODELS.joint, gunMid, 0, 0, 0.183, 0.041, 0.041, 0.047, 951);
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
      var aura;
      if (highVisuals) {
        aura = vmHull(blade, MODELS.blade, bladeAuraMat, 0, 0.02, -0.348, 0.069, 0.155, 0.52, 949);
        vmHull(blade, MODELS.blade, gunVioletDeep, 0, 0.023, -0.34, 0.058, 0.13, 0.49);
        vmHull(blade, MODELS.blade, gunViolet, -0.021, 0.005, -0.344, 0.035, 0.103, 0.483, 951);
        vmHull(blade, MODELS.blade, gunVioletSoft, -0.033, 0.005, -0.348, 0.010, 0.051, 0.475, 951);
        vmHull(blade, MODELS.blade, gunWhite, 0, -0.037, -0.352, 0.019, 0.019, 0.485, 951);
        vmHull(blade, HULL.shield, gunBody, 0, 0.006, -0.076, 0.174, 0.083, 0.114);
        vmHull(blade, MODELS.blade, spine, 0, 0.075, -0.33, 0.046, 0.052, 0.47, 952);
        for (var stud = 0; stud < 4; stud++) {
          vmHull(blade, MODELS.lens, gunWhite, -0.016, 0.080, -0.144 - stud * 0.064,
            0.005, 0.008, 0.009, 953);
        }
      } else {
        aura = vmBox(blade, bladeAuraMat, 0, 0.018, -0.33, 0.056, 0.13, 0.39, 949);
        vmBox(blade, gunVioletDeep, 0, 0.02, -0.32, 0.05, 0.115, 0.39);
        vmBox(blade, gunViolet, 0, 0.018, -0.33, 0.032, 0.088, 0.37, 951);
        vmBox(blade, gunVioletSoft, 0, 0.015, -0.34, 0.012, 0.04, 0.31, 951);
        vmBox(blade, gunDark, 0, 0.078, -0.31, 0.036, 0.028, 0.35, 951);
        vmBox(blade, gunMid, 0, 0.088, -0.30, 0.02, 0.012, 0.30, 951);
        vmBox(blade, gunVioletSoft, 0, -0.035, -0.33, 0.018, 0.012, 0.37, 951);
        vmBox(blade, gunWhite, 0, -0.042, -0.33, 0.008, 0.006, 0.34, 951);
        // V5 field wear: three edge nicks and a grip-wrap seam.
        for (var bn = 0; bn < 3; bn++) {
          vmBox(blade, gunDark, 0, -0.042, -0.22 - bn * 0.074,
            0.012 + bn * 0.002, 0.007, 0.022, 952);
        }
        vmBox(blade, gunLight, 0.0265, 0.018, -0.30, 0.003, 0.012, 0.20, 952);
        vmBox(blade, gunVioletDeep, -0.0305, 0.004, 0.095, 0.003, 0.04, 0.006, 952);
        vmBox(blade, gunMid, 0, 0.02, -0.14, 0.056, 0.10, 0.06);
        vmBox(blade, gunViolet, -0.028, 0.02, -0.16, 0.008, 0.07, 0.02, 951);
        vmCone(blade, gunViolet, 0, 0.02, -0.545, 0.026, 0.17, 0.045, 951);
        vmCone(blade, gunVioletSoft, 0, 0.02, -0.565, 0.013, 0.14, 0.022, 951);
      }
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
      var rk = 0;
      if (w.reloading > 0 && w.def.reloadTime) {
        rk = Math.max(0, Math.min(1, 1 - w.reloading / w.def.reloadTime));
      }
      var rifle = weaponGroups[0];
      var scatter = weaponGroups[1];
      var blade = weaponGroups[2];

      if (rifle) {
        rifle.position.set(0, 0, 0);
        rifle.rotation.set(0, 0, 0);
        if (currentWeapon === 0 && rk > 0) {
          var lower = Math.sin(Math.min(1, rk / 0.24) * Math.PI / 2);
          if (rk > 0.78) lower *= Math.max(0, (1 - rk) / 0.22);
          var tilt = Math.sin(rk * Math.PI);
          rifle.position.set(-tilt * 0.03, -lower * 0.16, lower * 0.045);
          rifle.rotation.set(tilt * 0.16, tilt * 0.1, tilt * 0.48);
        }
      }

      if (vmRefs.rifleBolt) {
        var charge = rk > 0.74 ? Math.sin(Math.max(0, Math.min(1, (rk - 0.74) / 0.22)) * Math.PI) : 0;
        vmRefs.rifleBolt.position.z = vmRefs.rifleBoltZ + player.recoil * 0.02 - charge * 0.03;
      }
      if (vmRefs.rifleCell) {
        vmRefs.rifleCell.scale.y =
          vmRefs.rifleCellBase.y * (0.92 + Math.sin(t * 7.5) * 0.08);
      }
      if (vmRefs.rifleMag) {
        var magOut = 0;
        if (currentWeapon === 0 && rk > 0.2 && rk < 0.64) {
          magOut = Math.sin((rk - 0.2) / 0.44 * Math.PI);
        }
        vmRefs.rifleMag.position.y = vmRefs.rifleMagY - magOut * 0.17;
        vmRefs.rifleMag.position.z = vmRefs.rifleMagZ + magOut * 0.045;
        vmRefs.rifleMag.rotation.x = magOut * 0.55;
      }

      if (scatter) {
        scatter.position.set(0, 0, 0);
        scatter.rotation.set(0, 0, 0);
        if (currentWeapon === 1 && rk > 0) {
          var sl = Math.sin(Math.min(1, rk / 0.25) * Math.PI / 2);
          if (rk > 0.76) sl *= Math.max(0, (1 - rk) / 0.24);
          var st = Math.sin(rk * Math.PI);
          scatter.position.set(0, -sl * 0.15, sl * 0.04);
          scatter.rotation.set(st * 0.24, 0, st * 0.4);
        }
      }
      if (vmRefs.scatterDrum) {
        vmRefs.scatterDrum.rotation.x += dt * (w.reloading > 0 && currentWeapon === 1 ? 17 : 0.5);
      }
      if (vmRefs.scatterGate) {
        var gateOpen = 0;
        if (currentWeapon === 1 && rk > 0) {
          gateOpen = Math.sin(Math.min(1, rk / 0.3) * Math.PI / 2);
          if (rk > 0.7) gateOpen *= Math.max(0, (1 - rk) / 0.3);
        }
        vmRefs.scatterGate.position.y = gateOpen * 0.1;
        vmRefs.scatterGate.rotation.x = -gateOpen * 0.55;
      }
      for (var si = 0; si < vmRefs.scatterShells.length; si++) {
        var shell = vmRefs.scatterShells[si];
        var shellPop = 0;
        if (currentWeapon === 1 && rk > 0.3 && rk < 0.68) {
          var sk = (rk - 0.3) / 0.38 * 5 - si;
          shellPop = Math.max(0, Math.sin(Math.max(0, Math.min(1, sk)) * Math.PI)) * 0.022;
        }
        shell.position.y = 0.157 + shellPop;
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
      if (blade) {
        if (player.slashT > 0 && currentWeapon === 2) {
          var dur = WEAPON_DEFS[2].slashTime;
          var k = 1 - player.slashT / dur;
          var wind = Math.min(1, k / 0.28);
          var sweep = k < 0.28 ? 0 : Math.sin((k - 0.28) / 0.72 * Math.PI);
          blade.rotation.x = 0.26 + (1 - sweep) * wind * 0.52 - sweep * 0.18;
          blade.rotation.y = -0.72 + sweep * 1.62;
          blade.rotation.z = -0.26 + sweep * 1.18;
          blade.position.set(-sweep * 0.12, sweep * 0.05, -sweep * 0.12);
        } else {
          blade.rotation.set(0.26, 0, 0);
          blade.position.set(0, 0, 0);
        }
      }
      if (dt > 0 && !settings.reducedMotion) {
        var blend = 1 - Math.exp(-dt * 11);
        var yawTarget = clamp(angleWrap(player.yaw - lastViewYaw) * -2.9, -0.18, 0.18);
        var pitchTarget = clamp((player.pitch - lastViewPitch) * 2.3, -0.14, 0.14);
        viewSwayYaw += (yawTarget - viewSwayYaw) * blend;
        viewSwayPitch += (pitchTarget - viewSwayPitch) * blend;
        lastViewYaw = player.yaw;
        lastViewPitch = player.pitch;
        viewRoot.rotation.y += viewSwayYaw;
        viewRoot.rotation.x += viewSwayPitch;
        viewRoot.rotation.z = viewSwayYaw * -0.38;
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
      flashT: 0,
      velocityY: 0,
      grounded: true,
      airDashUsed: false,
      slashT: 0,
      slashHitDone: false,
      slashSurface: false,
      slashId: 0,
      supplyBlock: 0
    };

    var WEAPON_DEFS = PBMission.weapons;

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

    // Exactly two fixed supply points: one at the entrance, one at the repair
    // area before the boss dock.  Each owns an independent 35 s cooldown.
    var SUPPLY_COOLDOWN = 35;
    var SUPPLY_TIME = 0.9;
    var SUPPLY_RANGE = 2.9;
    var supplyStations = [
      {
        id: 'entry', name: '入口补给点', x: -9.2, z: 16.3, baseY: 0,
        cooldown: 0, group: null, lampMat: null, ringMat: null,
        ring: null, core: null, lamp: null
      },
      {
        id: 'repair', name: '维修区补给点', x: 14.0, z: -16.0, baseY: 0.62,
        cooldown: 0, group: null, lampMat: null, ringMat: null,
        ring: null, core: null, lamp: null
      }
    ];
    var supply = {
      near: null,
      active: false,
      station: null,
      progress: 0,
      startX: 0,
      startZ: 0
    };

    var input = {
      keys: Object.create(null),
      fireHeld: false,
      fireQueued: false
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
    // Combat entities are built once during boot.  Spawn/kill/recycle paths only
    // toggle visibility and reset state, so update-time combat never allocates
    // Mesh/Material/Geometry.
    var SENTINEL_POOL_SIZE = 8;
    var TURRET_POOL_SIZE = 4;
    var sentinelPool = [];
    var turretPool = [];
    var bossPool = null;
    var bullets = [];
    var deflects = [];
    var missiles = [];
    var particles = [];
    var telegraphs = [];
    var shockwaves = [];
    var lasers = [];
    var pending = [];

    var boss = null;
    var bossWreck = null;
    var bossEverSpawned = false;

    var flow = PBMission.create(events);
    var enemyDirector = PBEnemyDirector.create(events, hasLineOfSight, resolveCircle);
    var sound = PBAudio.create(events, settings.volumes, !toolsMode.silent);
    var reportedAudioError = '';
    sound.bind();
    var cinematics = PBCinematics.create(THREE, events, camera, stage, byId('sceneShot'));
    var caption = byId('radioCaption');
    var damageDirection = byId('damageDirection');
    var alertState = byId('alertState');
    var bossWarning = byId('bossWarning');
    var captionT = 0;
    var warningT = 0;
    var encounterAlertT = 0;
    var settingsDialog = byId('settingsPanel');
    var sectorEffects = PBSectors.create(THREE, renderer, scene, IM, G.plane, assets);
    var worldObjects;
    var impactMarks;
    var inspection = 0;
    var sprintPose = 0;
    var landingKick = 0;
    var stepDistance = 0;
    var aimIdle = 0;
    var cameraFov = settings.fov;
    var lookStress = 0;
    var shouldWarn = !!(highVisuals && !surfaceLayers || surfaceSamplingEnabled && !highVisuals && !surfaceDetailTexture?._glTexture);

    function bound(name) { return settings.bindings[name]; }
    function held(name) {
      var code = bound(name);
      return input.keys[code] || (code === 'ShiftLeft' && input.keys.ShiftRight);
    }
    function keyName(name) { return PBSettings.keyLabel(bound(name)); }


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
    function rnd(a, b) { return a + gameplayRandom() * (b - a); }
    function fxRandom(a, b) { return a + visualRandom() * (b - a); }
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

    function resolveCircle(pos, radius, feetY) {
      var feet = feetY === undefined ? 0 : feetY;
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < colliders.length; i++) {
          var c = colliders[i];
          if (c.disabled) continue;
          // Low surfaces can be stepped onto; anything whose top is already
          // below the boots no longer blocks horizontal movement.
          if (c.y1 <= feet + STEP_HEIGHT + 0.02) continue;
          // Overhead structures (crane girders) never block the body.
          if (c.y0 >= feet + PLAYER_HEIGHT) continue;
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
        resolveCircle(player.pos, player.radius, player.pos.y - EYE);
      }
    }

    function insideStandable(s, x, z, pad) {
      var p = pad || 0;
      return x >= s.minX - p && x <= s.maxX + p && z >= s.minZ - p && z <= s.maxZ + p;
    }

    // Highest whitelisted top within [minTop, maxTop] under the player's
    // centre.  Ground plane 0 is always implicit.
    function standableTopAt(x, z, minTop, maxTop) {
      var best = null;
      if (minTop <= 0 && maxTop >= 0) best = 0;
      for (var i = 0; i < standables.length; i++) {
        var s = standables[i];
        if (s.top < minTop - 0.02 || s.top > maxTop + 0.02) continue;
        if (!insideStandable(s, x, z, 0.12)) continue;
        if (best === null || s.top > best) best = s.top;
      }
      return best;
    }

    function landingTopAt(x, z, oldFeet, nextFeet) {
      var best = null;
      for (var i = 0; i < standables.length; i++) {
        var s = standables[i];
        if (s.top > oldFeet + 0.04 || s.top < nextFeet - 0.04) continue;
        if (!insideStandable(s, x, z, 0.12)) continue;
        if (best === null || s.top > best) best = s.top;
      }
      if (oldFeet >= -0.02 && nextFeet <= 0) {
        if (best === null || best < 0) best = 0;
      }
      return best;
    }

    function updateVertical(dt) {
      var feet = player.pos.y - EYE;
      if (player.grounded) {
        // Walking (or stepping) onto a whitelisted low top snaps up by one
        // step.  Larger ledges still require Space.
        var stepTop = standableTopAt(player.pos.x, player.pos.z,
          feet - 0.16, feet + STEP_HEIGHT);
        if (stepTop !== null && stepTop >= feet - 0.16) {
          feet = stepTop;
          player.velocityY = 0;
          player.airDashUsed = false;
        } else {
          player.grounded = false;
        }
      }

      if (!player.grounded) {
        player.velocityY -= GRAVITY * dt;
        var nextFeet = feet + player.velocityY * dt;
        var landed = null;
        if (player.velocityY <= 0) {
          landed = landingTopAt(player.pos.x, player.pos.z, feet, nextFeet);
        }
        if (landed !== null) {
          feet = landed;
          player.velocityY = 0;
          player.grounded = true;
          player.airDashUsed = false;
        } else {
          feet = nextFeet;
          if (feet < -2.5) {
            // Safety net only; the dock bounds prevent normal falls.
            feet = 0;
            player.velocityY = 0;
            player.grounded = true;
          }
        }
      }
      player.pos.y = feet + EYE;
    }

    function tryJump() {
      if (mode !== 'playing' || !player.grounded) return;
      player.grounded = false;
      player.velocityY = JUMP_SPEED;
      player.airDashUsed = false;
      player.shake = Math.max(player.shake, 0.08);
      spawnParticles(new THREE.Vector3(player.pos.x, player.pos.y - EYE + 0.05, player.pos.z),
        0xd8c8b0, 4, 1.4, 0.2, 0.03);
    }

    function rayBox(ox, oy, oz, dx, dy, dz, box) {
      var tmin = 0;
      var tmax = Infinity;
      for (var axis = 0; axis < 3; axis++) {
        var o = axis === 0 ? ox : axis === 1 ? oy : oz;
        var d = axis === 0 ? dx : axis === 1 ? dy : dz;
        var lo = axis === 0 ? box.minX : axis === 1 ? box.y0 : box.minZ;
        var hi = axis === 0 ? box.maxX : axis === 1 ? box.y1 : box.maxZ;
        if (Math.abs(d) < 1e-8) {
          if (o < lo || o > hi) return -1;
          continue;
        }
        var first = (lo - o) / d;
        var last = (hi - o) / d;
        tmin = Math.max(tmin, Math.min(first, last));
        tmax = Math.min(tmax, Math.max(first, last));
        if (tmin > tmax) return -1;
      }
      return tmin > 0 ? tmin : (tmax > 0 ? tmax : -1);
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

    function wallHitDistance(ox, oy, oz, dx, dy, dz, maxT, impact) {
      var best = maxT;
      if (impact) {
        impact.surface = '';
        impact.collider = null;
      }
      for (var i = 0; i < colliders.length; i++) {
        var collider = colliders[i];
        if (collider.disabled) continue;
        var t = rayBox(ox, oy, oz, dx, dy, dz, collider);
        if (t > 0 && t < best) {
          best = t;
          if (impact) {
            impact.surface = collider.tireBand && oy + t * dy < 0.48 ? 'rubber' : collider.surface;
            impact.collider = collider;
          }
        }
      }
      if (dy < -1e-6) {
        var tFloor = -oy / dy;
        if (tFloor > 0 && tFloor < best) {
          best = tFloor;
          if (impact) {
            var x = ox + tFloor * dx;
            var z = oz + tFloor * dz;
            impact.surface = Math.abs(x) > 16 || z < -22 ? 'concrete' : 'asphalt';
            impact.collider = null;
          }
        }
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
    var muzzleSmokeT = 0;
    var muzzleSmoke = [];
    var scorch = null;

    function buildMuzzleSmoke() {
      for (var i = 0; i < 3; i++) {
        var material = matBasic(0x99a5af, {
          transparent: true, opacity: 0, depthTest: false, depthWrite: false, viewModel: true
        });
        material.softVolume = true;
        var puff = new THREE.Mesh(G.lowSphere, material);
        puff.visible = false;
        puff.renderOrder = 300;
        viewRoot.add(puff);
        muzzleSmoke.push(puff);
      }
    }

    function buildScorch() {
      var material = matBasic(0x210c12, { transparent: true, opacity: 0.48, depthWrite: false });
      material.decal = PBDockArt.scorchDecal(THREE);
      scorch = new THREE.Mesh(G.plane, material);
      scorch.rotation.x = -Math.PI / 2;
      scorch.scale.set(5.4, 3.1, 1);
      scorch.visible = false;
      scorch.renderOrder = 1;
      scene.add(scorch);
    }

    function emitMuzzleSmoke() { muzzleSmokeT = 0.22; }

    function updateMuzzleSmoke(dt) {
      muzzleSmokeT = Math.max(0, muzzleSmokeT - dt);
      var age = 0.22 - muzzleSmokeT;
      for (var i = 0; i < muzzleSmoke.length; i++) {
        var puff = muzzleSmoke[i];
        var t = age - i * 0.023;
        puff.visible = muzzleSmokeT > 0 && t >= 0;
        if (!puff.visible) continue;
        puff.position.set(-0.02 + i * 0.021, 0.05 + t * 0.63, -1.06 - t * 0.60);
        puff.scale.set(0.017 + t * 0.18, 0.022 + t * 0.25, 0.016 + t * 0.18);
        puff.material.opacity = Math.min(0.23, t * 8) * muzzleSmokeT / 0.22;
      }
    }
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

    function fxAdditive(hex, opacity, radiance) {
      return matBasic(hex, {
        transparent: true, opacity: opacity, blending: 'additive',
        depthWrite: false, fog: false, radiance: radiance
      });
    }

    var impactFlashes = [];

    function buildImpactFlashPool() {
      var texture = PBDockArt.scorchDecal(THREE);
      for (var i = 0; i < 10; i++) {
        var material = fxAdditive(0xffffff, 0, 2.1);
        material.decal = texture;
        var mesh = new THREE.Mesh(G.plane, material);
        mesh.visible = false;
        mesh.renderOrder = 20;
        scene.add(mesh);
        impactFlashes.push({ mesh: mesh, life: 0, size: 0, time: 0 });
      }
    }

    function flashImpact(point, direction, color, size) {
      for (var flash of impactFlashes) {
        if (flash.life > 0) continue;
        flash.life = 0.092;
        flash.time = 0;
        flash.size = size;
        flash.mesh.visible = true;
        flash.mesh.position.copy(point).addScaledVector(direction, -0.075);
        flash.mesh.material.color.setHex(color);
        flash.mesh.material.opacity = 0.72;
        flash.mesh.quaternion.copy(camera.quaternion);
        flash.mesh.scale.set(size, size, 1);
        return;
      }
    }

    function updateImpactFlashes(dt) {
      for (var flash of impactFlashes) {
        if (flash.life <= 0) continue;
        flash.life -= dt;
        flash.time += dt;
        flash.mesh.visible = flash.life > 0;
        if (!flash.mesh.visible) continue;
        var t = flash.time / 0.092;
        flash.mesh.quaternion.copy(camera.quaternion);
        flash.mesh.scale.set(flash.size * (0.75 + 1.3 * t), flash.size * (0.54 + t), 1);
        flash.mesh.material.opacity = 0.72 * (1 - t) * (1 - t);
      }
    }

    function makeParticleMesh() {
      var mesh = new THREE.Mesh(MODELS.shard, fxAdditive(0xffffff, 1));
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
      var dustMap = PBDockArt.scorchDecal(THREE);
      renderer._texture(dustMap);
      for (var i = 0; i < MAX.particles; i++) {
        var mesh = makeParticleMesh();
        var dust = matBasic(0xa09b91, { transparent: true, opacity: 0, depthWrite: false });
        dust.decal = dustMap;
        var shard = matLambert(0x80817c, { transparent: true, opacity: 0, depthWrite: false, roughness: 0.65 });
        particles.push({
          mesh: mesh,
          energy: mesh.material,
          dust: dust,
          shard: shard,
          kind: 'energy',
          alive: false,
          vel: new THREE.Vector3(),
          ttl: 0,
          max: 1,
          size: 0.03
        });
      }
    }

    function spawnParticles(pos, color, count, speed, life, size, kind) {
      if (mode === 'playing' && kind !== 'energy') {
        var distance = camera.position.distanceToSquared(pos);
        if (distance > 60 * 60) return;
        if (distance > 30 * 30) count = Math.ceil(count * 0.45);
      }
      for (var i = 0; i < count; i++) {
        var slot = null;
        for (var j = 0; j < particles.length; j++) {
          if (!particles[j].alive) { slot = particles[j]; break; }
        }
        // The pool is prewarmed to MAX.particles, so a full pool simply drops
        // the extra spark instead of constructing anything inside the loop.
        if (!slot) return;
        slot.alive = true;
        slot.ttl = slot.max = life * fxRandom(0.65, 1.25);
        slot.size = size * fxRandom(0.55, 1.25);
        slot.kind = kind || 'energy';
        slot.mesh.material = slot.kind === 'dust' ? slot.dust : slot.kind === 'fragment' ? slot.shard : slot.energy;
        slot.mesh.geometry = slot.kind === 'dust' ? G.plane : MODELS.shard;
        slot.mesh.rotation.set(0, 0, 0);
        slot.mesh.visible = true;
        slot.mesh.position.copy(pos);
        slot.mesh.material.color.setHex(color);
        slot.mesh.material.opacity = 1;
        slot.mesh.scale.setScalar(slot.size);
        slot.vel.set(fxRandom(-1, 1), fxRandom(-0.25, 1), fxRandom(-1, 1));
        if (slot.vel.lengthSq() < 1e-5) slot.vel.set(0, 1, 0);
        slot.vel.normalize().multiplyScalar(speed * fxRandom(0.35, 1));
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
        p.vel.y += (p.kind === 'dust' ? 0.42 : -6.5) * dt;
        p.vel.multiplyScalar(Math.max(0, 1 - 1.6 * dt));
        p.mesh.position.addScaledVector(p.vel, dt);
        var k = p.ttl / p.max;
        if (p.kind === 'dust') {
          var progress = 1 - k;
          p.mesh.quaternion.copy(camera.quaternion);
          p.mesh.material.opacity = Math.min(0.34, progress * 2.2) * k * k;
          p.mesh.scale.setScalar(p.size * (0.55 + progress * 2));
        } else {
          p.mesh.material.opacity = k;
          p.mesh.rotation.y += dt * 12;
          p.mesh.rotation.z += dt * 7;
          p.mesh.scale.setScalar(p.size * (0.35 + 0.65 * k));
        }
      }
    }

    /* --------------------------------------------------------- hit sparks */

    function buildSparkPool() {
      for (var i = 0; i < SPARK_LIMIT; i++) {
        var mat = fxAdditive(0xffffff, 1, 2.1);
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
        slot.ttl = slot.max = fxRandom(0.18, 0.38);
        slot.size = fxRandom(0.012, 0.028) * (0.8 + power * 0.25);
        slot.mesh.visible = true;
        slot.mesh.position.copy(pos);
        slot.mesh.material.color.setHex(color);
        slot.mesh.material.opacity = 1;
        slot.mesh.scale.set(slot.size, slot.size, slot.size * fxRandom(1.5, 3.4));
        slot.vel.set(fxRandom(-1, 1), fxRandom(-0.2, 1.35), fxRandom(-1, 1));
        if (slot.vel.lengthSq() < 1e-5) slot.vel.set(0, 1, 0);
        slot.vel.normalize().multiplyScalar(speed * fxRandom(0.45, 1.2));
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
        s.mesh.scale.set(s.size, s.size, s.size * (1.8 + s.vel.length() * 0.33));
      }
    }

    function spawnImpactFx(point, color, power) {
      var p = power || 1;
      spawnSparks(point, color, 2 + Math.floor(p * 3), 2.6 + p * 2.2, p);
      if (p > 0.9) spawnRingFx(point, 0.55 + p * 0.45, color, 0.2 + p * 0.05, point.y);
    }

    /* ------------------------------------------------------- blade slash FX */
    // Six prebuilt arc meshes.  The blade animation only retunes transforms
    // and material opacity; no Mesh/Material is constructed during combat.
    var SLASH_FX_LIMIT = 6;
    var slashFxPool = [];

    function buildSlashPool() {
      for (var i = 0; i < SLASH_FX_LIMIT; i++) {
        var mat = fxAdditive(0xc9a2ff, 0.9);
        var mesh = new THREE.Mesh(MODELS.slash, mat);
        mesh.visible = false;
        mesh.renderOrder = 9;
        scene.add(mesh);
        slashFxPool.push({
          mesh: mesh, mat: mat, alive: false,
          ttl: 0, max: 0.3, yaw: 0
        });
      }
    }

    function spawnSlashArc() {
      var slot = null;
      for (var i = 0; i < slashFxPool.length; i++) {
        if (!slashFxPool[i].alive) { slot = slashFxPool[i]; break; }
      }
      if (!slot) return;
      slot.alive = true;
      slot.ttl = slot.max = 0.38;
      slot.yaw = player.yaw;
      slot.mat.opacity = 0.9;
      slot.mesh.visible = true;
      var fwd = flatForward(new THREE.Vector3());
      slot.mesh.position.set(
        player.pos.x + fwd.x * 1.75,
        player.pos.y - 0.24,
        player.pos.z + fwd.z * 1.75
      );
      // Keep the arc plane facing the player so the swing reads in first person.
      slot.mesh.rotation.set(Math.PI / 2, slot.yaw + Math.PI, -0.15);
      slot.mesh.scale.set(1.0, 1.0, 1.0);
    }

    function updateSlashFx(dt) {
      for (var i = 0; i < slashFxPool.length; i++) {
        var s = slashFxPool[i];
        if (!s.alive) continue;
        s.ttl -= dt;
        if (s.ttl <= 0) {
          s.alive = false;
          s.mesh.visible = false;
          continue;
        }
        var k = 1 - s.ttl / s.max;
        s.mat.opacity = 0.82 * (1 - k);
        var r = 1.0 + k * 0.65;
        s.mesh.scale.set(r, 1, r);
        s.mesh.rotation.z = -0.15 - k * 0.95;
      }
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
        var coreMat = fxAdditive(0xffffff, 0.95, 2.8);
        var midMat = fxAdditive(0xffffff, 0.6, 1.4);
        var haloMat = fxAdditive(0xffffff, 0.2);
        var tipMat = fxAdditive(0xffffff, 0.9, 2.5);
        var core = new THREE.Mesh(MODELS.projectile, coreMat);
        var mid = new THREE.Mesh(MODELS.projectile, midMat);
        var halo = new THREE.Mesh(MODELS.projectile, haloMat);
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
        var coreMat = fxAdditive(0xffffff, 0.95, 2.6);
        var haloMat = fxAdditive(0xffffff, 0.28);
        var core = new THREE.Mesh(MODELS.projectile, coreMat);
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
      if (!ui.screenFlash || settings.reducedMotion) return;
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

    function damagePlayer(amount, from) {
      if (mode !== 'playing') return;
      if (player.invuln > 0 || player.dashT > 0) return;
      player.hp -= amount;
      events.emit('player.damage', { amount });
      if (from) {
        var bearing = Math.atan2(from.x - player.pos.x, player.pos.z - from.z) + player.yaw;
        damageDirection.style.setProperty('--damage-angle', bearing + 'rad');
        damageDirection.hidden = false;
      }
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
        if (!c.disabled && p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.y0 && p.y < c.y1) {
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

    var shotImpact = { surface: '', collider: null };
    var shotOrigin = new THREE.Vector3();
    var shotForward = new THREE.Vector3();
    var shotDirection = new THREE.Vector3();
    var shotEnd = new THREE.Vector3();
    var shotMuzzle = new THREE.Vector3();

    function materialImpact(surface, point, direction, collider) {
      events.emit('combat.impact', { surface, point, level: 0.78 });
      if (surface !== 'water' && surface !== 'energyCore' && surface !== 'enemyArmor' && surface !== 'shield') {
        impactMarks.place(surface, point, direction, collider);
      } else if (surface === 'water') {
        renderer.addWaterRipple(point.x, point.z, worldClock);
      }
      PBCombatVisuals.impactFx(surface, point, spawnSparks, spawnParticles, spawnRingFx);
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

      var wallT = wallHitDistance(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, shotImpact);
      if (wallT < best) {
        best = wallT;
        hitEnemy = null;
        hitBoss = false;
        hitMissile = null;
      }

      var waterImpact = false;
      var floorDist = dir.y < -0.001 ? -origin.y / dir.y : Infinity;
      if (!hitEnemy && !hitBoss && !hitMissile && dir.y < -0.001 &&
          (Math.abs(wallT - floorDist) < 0.0001 || wallT === range)) {
        // Water is visual only. A solid obstruction still wins the gameplay ray.
        var waterDist = (-0.63 - origin.y) / dir.y;
        var wx = origin.x + waterDist * dir.x;
        var wz = origin.z + waterDist * dir.z;
        if (waterDist > 0 && waterDist <= range &&
            (Math.abs(wx) > 23.7 || wz < -46.5 || wz > 21)) {
          best = waterDist;
          waterImpact = true;
        }
      }
      var point = shotEnd.copy(origin).addScaledVector(dir, best);

      if (hitEnemy) {
        var wasAlive = !hitEnemy.dead;
        damageEnemy(hitEnemy, dmg, color, point);
        materialImpact('enemyArmor', point, dir);
        flashImpact(point, dir, 0xb3c3ff, 0.44);
        if (wasAlive) registerHit(hitEnemy.dead);
      } else if (hitBoss) {
        var shielded = boss.invuln > 0 || boss.shield > 0;
        damageBoss(dmg, color, point);
        materialImpact(shielded ? 'shield' : 'energyCore', point, dir);
        flashImpact(point, dir, boss && boss.shield > 0 ? C.cyan : 0xffc0eb, 0.67);
        registerHit(false);
      } else if (hitMissile) {
        var mi = missiles.indexOf(hitMissile);
        if (mi >= 0) killMissileAt(mi);
        spawnImpactFx(point, C.amber, 1.2);
        registerHit(false);
      } else if (waterImpact || shotImpact.surface) {
        if (shotImpact.surface === 'steel') flashImpact(point, dir, 0xffc788, 0.29);
        materialImpact(waterImpact ? 'water' : shotImpact.surface, point, dir, shotImpact.collider);
        if (!waterImpact && shotImpact.collider?.prop) {
          worldObjects.damage(shotImpact.collider.prop, dmg, point);
        }
      }

      return point;
    }

    function fireWeapon() {
      if (mode !== 'playing') return;
      if (supply.active || player.supplyBlock > 0) return;
      var w = currentGun();
      var d = w.def;
      if (w.reloading > 0 || w.cool > 0) return;
      if (player.slashT > 0) return;
      inspection = 0;

      if (!d.melee && w.mag <= 0) {
        w.cool = 0.2;
        events.emit('weapon.dry');
        if (w.reserve > 0) {
          startReload();
        } else if (gameTime - lastDryToast > 1.4) {
          lastDryToast = gameTime;
          addToast('弹匣与备弹已空 // 寻找补给点', 'warn');
        }
        return;
      }

      events.emit('weapon.fire', { weapon: d.id });
      if (d.melee) {
        startBladeSwing();
        w.cool = d.interval;
        player.recoil = Math.max(player.recoil, 0.75);
        return;
      }

      w.mag--;
      w.cool = d.interval;

      player.recoil = Math.min(1, player.recoil + (d.id === 'scatter' ? 0.85 : 0.32));
      player.shake = Math.max(player.shake, d.id === 'scatter' ? 0.3 : 0.1);
      muzzleT = 0.06;

      var origin = shotOrigin.copy(player.pos);
      var baseDir = forwardVec(shotForward);
      // The renderer updates the scene graph after simulation, so take the
      // current player and weapon transforms before sampling the muzzle.
      camera.updateMatrixWorld();
      var tracerFrom = muzzleWorldPos(shotMuzzle);
      emitMuzzleSmoke();

      for (var p = 0; p < d.pellets; p++) {
        var dir = shotDirection.copy(baseDir);
        dir.x += rnd(-d.spread, d.spread);
        dir.y += rnd(-d.spread, d.spread);
        dir.z += rnd(-d.spread, d.spread);
        dir.normalize();
        var point = traceShot(origin, dir, d.range, d.dmg, d.color);
        spawnTracer(tracerFrom, point, d.color);
      }

      if (d.id === 'scatter') {
        spawnParticles(tracerFrom, C.magenta, 4, 3, 0.18, 0.04);
      }
      spawnSparks(tracerFrom, d.color, 3, 2.8, 0.9);
    }

    function startBladeSwing() {
      var def = WEAPON_DEFS[2];
      if (player.slashT > 0) return;
      player.slashT = def.slashTime;
      player.slashHitDone = false;
      player.slashSurface = false;
      player.slashId++;
      player.shake = Math.max(player.shake, 0.18);
      spawnSlashArc();
      var fwd = flatForward(new THREE.Vector3());
      var slashPos = player.pos.clone().addScaledVector(fwd, 1.5);
      slashPos.y = player.pos.y - 0.5;
      spawnRingFx(slashPos, 2.4, C.violet, 0.24, slashPos.y);
    }

    // Runs every frame inside the short hit window.  A per-swing id stamps each
    // target, so a target can only take damage once per swing even if it stays
    // in the arc for multiple frames.
    function resolveBladeHit() {
      var def = WEAPON_DEFS[2];
      var fwd = flatForward(new THREE.Vector3());
      var origin = player.pos.clone();
      var hitAnything = false;
      var swingId = player.slashId;

      for (var i = enemies.length - 1; i >= 0; i--) {
        var e = enemies[i];
        if (e.dead || e.slashMark === swingId) continue;
        var to = new THREE.Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
        var dist = to.length();
        if (dist < def.range + e.radius && dist > 0.001) {
          to.multiplyScalar(1 / dist);
          if (to.dot(fwd) > def.arc) {
            e.slashMark = swingId;
            damageEnemy(e, def.dmg, C.violet, e.pos);
            materialImpact('enemyArmor', e.pos);
            e.knock.addScaledVector(fwd, 9);
            hitAnything = true;
          }
        }
      }

      if (boss && boss.alive && boss.slashMark !== swingId) {
        var bto = new THREE.Vector3(boss.pos.x - origin.x, 0, boss.pos.z - origin.z);
        var bdist = bto.length();
        if (bdist < 4.2 && bdist > 0.001) {
          bto.multiplyScalar(1 / bdist);
          if (bto.dot(fwd) > 0.3) {
            boss.slashMark = swingId;
            materialImpact(boss.invuln > 0 || boss.shield > 0 ? 'shield' : 'energyCore', boss.pos);
            damageBoss(42, C.violet, boss.pos);
            hitAnything = true;
          }
        }
      }

      for (var mi = missiles.length - 1; mi >= 0; mi--) {
        var m = missiles[mi];
        if (m.slashMark === swingId) continue;
        if (m.pos.distanceTo(origin) < 3.6) {
          m.slashMark = swingId;
          killMissileAt(mi);
          hitAnything = true;
        }
      }

      // Clear / deflect nearby hostile projectiles once per frame.
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

      if (!hitAnything && !player.slashSurface) {
        var swipe = forwardVec(shotDirection);
        var wall = wallHitDistance(origin.x, origin.y, origin.z, swipe.x, swipe.y, swipe.z, def.range, shotImpact);
        if (shotImpact.surface) {
          player.slashSurface = true;
          var contact = shotEnd.copy(origin).addScaledVector(swipe, wall);
          materialImpact(shotImpact.surface, contact, swipe, shotImpact.collider);
        }
      }
      if (hitAnything) {
        var hitPos = origin.clone().addScaledVector(fwd, 1.5);
        hitPos.y = player.pos.y - 0.5;
        spawnParticles(hitPos, C.violet, 6, 5, 0.25, 0.04);
        registerHit(false);
      }
    }

    function updateBladeSwing(dt) {
      if (player.slashT <= 0) return;
      var def = WEAPON_DEFS[2];
      player.slashT = Math.max(0, player.slashT - dt);
      var elapsed = def.slashTime - player.slashT;
      if (elapsed >= def.slashHitStart && elapsed <= def.slashHitEnd && !player.slashHitDone) {
        resolveBladeHit();
      }
      if (elapsed >= def.slashHitEnd) player.slashHitDone = true;
      if (player.slashT <= 0) player.slashHitDone = false;
    }

    function startReload() {
      if (mode !== 'playing') return;
      if (supply.active) return;
      var w = currentGun();
      var d = w.def;
      if (d.melee || w.reloading > 0 || w.mag >= d.magSize || w.reserve <= 0) return;
      inspection = 0;
      w.reloading = d.reloadTime;
      events.emit('weapon.reload', { weapon: d.id, complete: false });
    }

    function switchWeapon(index) {
      if (mode !== 'playing') return;
      if (index < 0 || index >= weapons.length || index === currentWeapon) return;
      weapons[currentWeapon].reloading = 0;
      player.slashT = 0;
      player.slashHitDone = false;
      currentWeapon = index;
      inspection = 0;
      events.emit('weapon.switch');
      muzzleT = 0;
      muzzleFlash.visible = false;
      player.recoil = 0.5;
      syncWeaponVisuals();
      updateHud();
    }

    function updateWeapons(dt) {
      var w = currentGun();
      if (w.cool > 0) w.cool = Math.max(0, w.cool - dt);

      updateBladeSwing(dt);

      if (w.reloading > 0) {
        w.reloading -= dt;
        if (w.reloading <= 0) {
          w.reloading = 0;
          var need = w.def.magSize - w.mag;
          var take = Math.min(need, w.reserve);
          w.mag += take;
          w.reserve -= take;
          events.emit('weapon.reload', { weapon: w.def.id, complete: true });
        }
      }

      // Auto-reload an empty ranged weapon when reserve remains.
      if (!w.def.melee && w.mag <= 0 && w.reserve > 0 &&
        w.reloading <= 0 && mode === 'playing' && !supply.active) {
        startReload();
      }

      if (input.fireHeld) {
        if (w.def.auto) fireWeapon();
        else if (input.fireQueued) fireWeapon();
      }
      input.fireQueued = false;

      muzzleT = Math.max(0, muzzleT - dt);
      updateMuzzleSmoke(dt);
      muzzleFlash.visible = muzzleT > 0;
      if (muzzleT > 0) {
        var s = highVisuals ? 0.38 + visualRandom() * 0.13 : 0.1 + visualRandom() * 0.08;
        muzzleFlash.scale.set(s, s, s);
        muzzleFlash.rotation.z += dt * 22;
        muzzleHaloMat.opacity = 0.16 + visualRandom() * 0.16;
        muzzleRingMat.opacity = 0.2 + visualRandom() * 0.28;
      }

      updateViewmodel(dt);
    }

    /* ------------------------------------------------------------- abilities */

    function tryDash() {
      if (mode !== 'playing' || player.dashCd > 0) return;
      if (!player.grounded && player.airDashUsed) return;
      var f = (held('forward') ? 1 : 0) - (held('back') ? 1 : 0);
      var s = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      var dir = new THREE.Vector3();
      if (f !== 0 || s !== 0) {
        var fwd = flatForward(new THREE.Vector3());
        var right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
        dir.addScaledVector(fwd, f).addScaledVector(right, s).normalize();
      } else {
        flatForward(dir);
      }
      if (!player.grounded) player.airDashUsed = true;
      player.dashT = 0.16;
      events.emit('player.dash');
      player.dashCd = 3.0;
      player.invuln = Math.max(player.invuln, 0.36);
      player.dashDir.copy(dir);
      player.shake = Math.max(player.shake, 0.24);
      spawnRingFx(player.pos, 3.4, C.violet, 0.4, 1.0);
      spawnParticles(player.pos, C.violet, 10, 4.5, 0.3, 0.05);
    }

    function tryPulse() {
      if (mode !== 'playing' || player.pulseCd > 0) return;
      if (supply.active || player.supplyBlock > 0) return;
      player.pulseCd = 8.0;
      events.emit('player.pulse');
      impactMarks.disturb(player.pos, worldClock);
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

    var moveForward = new THREE.Vector3();
    var moveRight = new THREE.Vector3();
    var moveVector = new THREE.Vector3();

    function updatePlayer(dt) {
      player.dashCd = Math.max(0, player.dashCd - dt);
      player.pulseCd = Math.max(0, player.pulseCd - dt);
      player.invuln = Math.max(0, player.invuln - dt);
      player.recoil = Math.max(0, player.recoil - dt * 5.5);
      player.flashT = Math.max(0, player.flashT - dt * 2.2);
      ui.damage.style.opacity = (player.flashT * (settings.reducedMotion ? 0.33 : 0.68)).toFixed(3);
      if (player.flashT < 0.03) damageDirection.hidden = true;

      var f = (held('forward') ? 1 : 0) - (held('back') ? 1 : 0);
      var s = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      var sprint = !!held('sprint');
      var moving = f !== 0 || s !== 0;
      var oldX = player.pos.x;
      var oldZ = player.pos.z;

      if (player.dashT > 0) {
        player.dashT -= dt;
        movePlayer(player.dashDir.x * 26 * dt, player.dashDir.z * 26 * dt);
        player.invuln = Math.max(player.invuln, 0.22);
        if (visualRandom() < 0.85) spawnParticles(player.pos, C.violet, 2, 1.6, 0.22, 0.045);
      } else if (moving) {
        var speed = sprint ? 9.4 : 6.1;
        var fwd = flatForward(moveForward);
        var right = moveRight.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
        var mv = moveVector.set(0, 0, 0);
        mv.addScaledVector(fwd, f).addScaledVector(right, s);
        if (mv.lengthSq() > 0.0001) mv.normalize().multiplyScalar(speed);
        movePlayer(mv.x * dt, mv.z * dt);
      }

      var wasGrounded = player.grounded;
      var landingVelocity = player.velocityY;
      updateVertical(dt);
      if (!wasGrounded && player.grounded && landingVelocity < -1) {
        landingKick = Math.min(0.08, -landingVelocity * 0.01);
        events.emit('player.land', { level: Math.min(.9, -landingVelocity * .12) });
      }
      if (player.grounded && player.dashT <= 0) {
        stepDistance += Math.hypot(player.pos.x - oldX, player.pos.z - oldZ);
        var stride = sprint ? 2.35 : 1.82;
        if (stepDistance >= stride) {
          stepDistance -= stride;
          events.emit('player.step', { metal: player.pos.y - EYE > 0.25, level: sprint ? 0.38 : 0.23 });
        }
      }
      landingKick *= Math.exp(-dt * 12);
      aimIdle -= dt;
      lookStress = Math.max(0, lookStress - dt);
      var motion = settings.reducedMotion ? 0 : settings.shake;

      player.bob += dt * (moving ? (sprint ? 12 : 8.5) : 2.2);
      var bobY = Math.sin(player.bob) * (moving ? 0.045 : 0.008);
      var bobX = Math.cos(player.bob * 0.5) * (moving ? 0.018 : 0.004);

      player.shake = Math.max(0, player.shake - dt * 2.0);
      var shx = (visualRandom() * 2 - 1) * player.shake * 0.045;
      var shy = (visualRandom() * 2 - 1) * player.shake * 0.045;

      camera.position.set(player.pos.x + (bobX * 0.3 + shx) * motion,
        player.pos.y + (bobY + shy - landingKick) * motion, player.pos.z);
      tmpEuler.set(player.pitch, player.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(tmpEuler);

      var targetFov = settings.fov + (settings.reducedMotion ? 0 :
        (sprint && moving ? 4.5 : 0) + (player.dashT > 0 ? 6 : 0));
      cameraFov = lerp(cameraFov, targetFov, 1 - Math.exp(-dt * 9));
      camera.fov = cameraFov;
      camera.updateProjectionMatrix();
      cinematics.update(dt, player.yaw, player.pitch, true, cameraFov, aimIdle > 0 || input.fireHeld);

      var sway = Math.sin(player.bob * 0.5) * (moving ? 0.012 : 0.003) * motion;
      viewRoot.position.set(
        0.33 + sway,
        -0.27 + Math.abs(Math.sin(player.bob)) * (moving ? 0.01 : 0.0025) * motion - player.recoil * 0.012,
        -0.66 + player.recoil * 0.055
      );
      sprintPose = lerp(sprintPose, (sprint && moving && !input.fireHeld) ? 1 : 0, 1 - Math.exp(-dt * 10));
      var pose = sprintPose * (settings.reducedMotion ? 0.28 : 1);
      viewRoot.position.y -= pose * 0.077 + landingKick * motion * 0.75;
      viewRoot.position.x += pose * 0.054;
      viewRoot.rotation.set(player.recoil * 0.16 - pose * 0.24, sway * 0.7 + pose * 0.18, pose * -0.20);
      inspection = Math.max(0, inspection - dt);
      if (inspection > 0 && !settings.reducedMotion) {
        var inspectPose = Math.sin(Math.PI * inspection / 1.6) ** 2;
        viewRoot.position.x -= 0.13 * inspectPose;
        viewRoot.rotation.y += 0.58 * inspectPose;
        viewRoot.rotation.x -= 0.24 * inspectPose;
      }

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
        source: pos.clone(),
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
        var width = b.radius * (1.0 + pulse * 0.14);
        b.fx.core.scale.set(width, width, width * 3.6);
        fxTmpDir.copy(b.vel).normalize();
        if (fxTmpDir.lengthSq() > 0) b.fx.group.quaternion.setFromUnitVectors(ZAXIS, fxTmpDir);
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

        if (b.pos.y < 0.05 || b.pos.y > 10.5 ||
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
          if (player.invuln <= 0 && player.dashT <= 0) damagePlayer(b.dmg, b.source);
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

        if (visualRandom() < 0.4) spawnParticles(d.pos, C.cyan, 1, 0.6, 0.18, 0.025);

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
          damagePlayer(m.dmg, m.pos);
          killMissileAt(i);
        }
      }
    }

    /* --------------------------------------------------------------- enemies */

    function buildSentinelMesh() {
      var group = new THREE.Group();
      var sensor = new THREE.Group();
      group.add(sensor);
      var shellMat = matLambert(0x18243a, { emissive: 0x091524 });
      tuneSurface(shellMat, 0.9, 0.72, 0.28);
      tuneTexture(shellMat, DETAIL_TILE.metal, 0.8, 0.65);
      var coreMat = matBasic(C.magenta, { radiance: 2.85 });
      var ringMat = matBasic(C.cyanDim, { transparent: true, opacity: 0.9 });
      var glowMat = matBasic(C.magenta, {
        transparent: true, opacity: 0.16, blending: 'additive',
        depthWrite: false, fog: false
      });

      var glow = new THREE.Mesh(G.lowSphere, glowMat);
      glow.scale.setScalar(0.62);
      group.add(glow);

      {
        var hull = modelPart(group, MODELS.sentinel, IM.craneIvory, 0, 0.055, -0.07, 0.87, 0.53, 1.16);
        hull.castShadow = true;
        modelPart(group, HULL.housing, shellMat, 0, -0.12, 0.056, 0.67, 0.34, 0.89);
        modelPart(sensor, HULL.cowl, IM.black, 0, 0.024, 0.416, 0.51, 0.24, 0.24);
        modelPart(sensor, MODELS.turret, IM.steelDeep, 0, 0.033, 0.456, 0.56, 0.265, 0.24);
        modelPart(sensor, MODELS.lens, coreMat, 0, 0.024, 0.558, 0.177, 0.074, 0.031);
        var retina = matBasic(0xffd9f2, { radiance: 2.0 });
        modelPart(sensor, MODELS.optic, IM.casting, 0, 0.027, 0.537, 0.168, 0.082, 0.079);
        modelPart(sensor, MODELS.lens, retina, 0, 0.027, 0.574, 0.107, 0.034, 0.013);
        for (var mountSide of [-1, 1]) {
          modelPart(group, MODELS.joint, IM.casting, mountSide * 0.448, -0.11, -0.23,
            0.144, 0.145, 0.28, Math.PI / 2);
        }
        for (var nacelle = -1; nacelle <= 1; nacelle += 2) {
          var wing = modelPart(group, MODELS.sentinel, IM.steel, nacelle * 0.51, -0.085, -0.10,
            0.33, 0.23, 0.67, nacelle * 0.17, nacelle * 0.19);
          wing.castShadow = true;
          modelPart(group, HULL.cowl, IM.craneIvory, nacelle * 0.54, 0.036, -0.07,
            0.29, 0.12, 0.52, nacelle * 0.29, nacelle * 0.28);
          modelPart(group, G.box, IM.lampRed, nacelle * 0.56, -0.035, 0.24, 0.087, 0.037, 0.035);
          modelPart(group, HULL.housing, IM.railPaint, nacelle * 0.436, -0.18, 0.15, 0.129, 0.12, 0.28);
          var rotor = modelPart(group, G.torus, IM.casting, nacelle * 0.40, -0.185, -0.045, 0.16, 0.16, 0.16);
          rotor.rotation.x = Math.PI / 2;
          modelPart(group, MODELS.turret, shellMat, nacelle * 0.64, -0.043, -0.13,
            0.16, 0.18, 0.73, nacelle * -0.22, nacelle * 0.17);
        }
      }

      var detail = new THREE.Group();
      for (var child of group.children.slice()) if (child !== glow) detail.add(child);
      group.add(detail);
      var low = new THREE.Group();
      var outline = modelPart(low, HULL.housing, shellMat, 0, 0.035, -0.05, 1.19, 0.45, 0.94);
      outline.castShadow = true;
      modelPart(low, G.box, coreMat, 0, 0.027, 0.45, 0.32, 0.095, 0.06);
      for (var side of [-1, 1]) modelPart(low, HULL.cowl, IM.craneIvory, side * 0.49, 0.04, -0.13, .36, .21, .65);
      low.visible = false;
      group.add(low);

      var ring = new THREE.Mesh(G.torus, ringMat);
      ring.rotation.x = 0.42;
      ring.scale.set(0.66, 0.66, 0.66);
      group.add(ring);
      var vents = new THREE.Group();
      for (var sign of [-1, 1]) {
        modelPart(vents, G.box, IM.lampWarm, sign * .51, -.13, -.32, .06, .036, .24);
        modelPart(vents, G.lowSphere, coreMat, sign * .5, -.14, -.51, .095, .06, .10);
      }
      detail.add(vents);
      var warning = actorWarning(group, .82, 0xffc861);

      return {
        group: group, detail: detail, low: low, vents: vents, warning: warning,
        sensor: sensor,
        armor: shellMat,
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
      tuneSurface(mountMat, 0.9, 0.68, 0.3);
      tuneTexture(mountMat, DETAIL_TILE.metal, 0.75, 0.65);
      var glowMat = matBasic(C.amber, { radiance: 2.6 });
      var auraMat = matBasic(C.amber, {
        transparent: true, opacity: 0.14, blending: 'additive',
        depthWrite: false, fog: false
      });

      var aura = new THREE.Mesh(G.lowSphere, auraMat);
      aura.position.set(0, 0, 0.16);
      aura.scale.set(0.9, 0.62, 0.82);
      group.add(aura);

      var head = new THREE.Group();
      var barrels = new THREE.Group();
      head.add(barrels);
      {
        var pedestal = modelPart(group, G.cylinder, IM.steelDark, 0, -0.42, -0.2, 0.49, 0.29, 0.49);
        pedestal.castShadow = true;
        modelPart(group, MODELS.tube, IM.casting, 0, -0.306, -0.20, 0.51, 0.072, 0.51);
        modelPart(group, MODELS.turret, IM.steelDeep, 0, -0.16, -0.21, 0.88, 0.31, 0.83);
        modelPart(group, HULL.shield, mountMat, 0, -0.085, -0.28, 0.87, 0.63, 0.64);
        var headArmor = modelPart(head, MODELS.turret, IM.cranePaint, 0, 0.125, -0.01, 1.15, 0.57, 0.94);
        headArmor.castShadow = true;
        modelPart(head, HULL.housing, IM.steelDeep, 0, -0.075, 0.164, 0.86, 0.29, 0.57);
        modelPart(head, G.box, glowMat, 0, 0.16, 0.382, 0.34, 0.062, 0.045);
        for (var cannon = -1; cannon <= 1; cannon += 2) {
          var tube = modelPart(barrels, G.cylinder, IM.casting, cannon * 0.235, -0.025, 0.58, 0.112, 0.68, 0.112);
          tube.rotation.x = Math.PI / 2;
          modelPart(barrels, HULL.housing, IM.steelDark, cannon * 0.235, -0.025, 0.855, 0.24, 0.23, 0.24);
          var muzzleLip = modelPart(barrels, G.torus, IM.casting, cannon * 0.235, -0.025, 0.976, 0.072, 0.072, 0.072);
          muzzleLip.rotation.x = Math.PI / 2;
          modelPart(barrels, G.box, glowMat, cannon * 0.235, -0.025, 0.975, 0.09, 0.069, 0.013);
        }
      }
      var halo = new THREE.Mesh(G.torus, glowMat);
      halo.rotation.x = Math.PI / 2;
      halo.scale.set(0.42, 0.42, 0.42);
      halo.position.set(0, -0.24, 0.05);
      head.add(halo);
      group.add(head);
      var detail = new THREE.Group();
      for (var child of group.children.slice()) if (child !== aura) detail.add(child);
      group.add(detail);
      var low = new THREE.Group();
      modelPart(low, HULL.shield, mountMat, 0, -.21, -.13, .96, .62, .72);
      var lowHead = new THREE.Group();
      modelPart(lowHead, HULL.cowl, IM.cranePaint, 0, .12, 0, .98, .46, .83);
      modelPart(lowHead, G.box, glowMat, 0, .16, .45, .38, .058, .07);
      modelPart(lowHead, G.box, IM.casting, 0, 0, .58, .38, .15, .64);
      low.add(lowHead);
      low.visible = false;
      group.add(low);
      var warning = actorWarning(group, 1.04, C.amber);
      return {
        group: group, detail: detail, low: low, lowHead: lowHead, warning: warning,
        head: head,
        barrels: barrels,
        armor: mountMat,
        coreMat: glowMat,
        auraMat: auraMat,
        aura: aura,
        auraBase: { x: 0.9, y: 0.62, z: 0.82 }
      };
    }

    function actorWarning(group, height, hex) {
      var mat = matBasic(hex, { radiance: 1.65, transparent: true, depthWrite: false, blending: 'additive' });
      var mesh = new THREE.Mesh(G.torus, mat);
      mesh.position.set(0, height, 0.14);
      mesh.scale.setScalar(0.25);
      mesh.rotation.z = Math.PI / 4;
      mesh.visible = false;
      group.add(mesh);
      return mesh;
    }

    function makeSentinelEntity(built) {
      built.group.visible = false;
      scene.add(built.group);
      return {
        active: false,
        type: 'sentinel',
        group: built.group,
        detail: built.detail,
        low: built.low,
        warning: built.warning,
        ai: PBEnemyDirector.createActor(),
        vents: built.vents,
        sensor: built.sensor,
        armor: built.armor,
        coreMat: built.coreMat,
        ringMat: built.ringMat,
        ring: built.ring,
        glowMat: built.glowMat,
        glow: built.glow,
        glowBase: built.glowBase,
        shadow: null,
        pos: new THREE.Vector3(),
        hp: 46,
        maxHp: 46,
        radius: 0.62,
        speed: 3.1,
        fireCd: 0,
        bobPhase: 0,
        slow: 0,
        flash: 0,
        dead: false,
        knock: new THREE.Vector3()
      };
    }

    function makeTurretEntity(built) {
      built.group.visible = false;
      scene.add(built.group);
      return {
        active: false,
        type: 'turret',
        group: built.group,
        detail: built.detail,
        low: built.low,
        warning: built.warning,
        ai: PBEnemyDirector.createActor(),
        lowHead: built.lowHead,
        head: built.head,
        barrels: built.barrels,
        armor: built.armor,
        coreMat: built.coreMat,
        ringMat: built.coreMat,
        ring: null,
        auraMat: built.auraMat,
        aura: built.aura,
        auraBase: built.auraBase,
        shadow: null,
        pos: new THREE.Vector3(),
        hp: 80,
        maxHp: 80,
        radius: 0.8,
        speed: 0,
        fireCd: 0,
        burst: 0,
        burstT: 0,
        bobPhase: 0,
        slow: 0,
        flash: 0,
        dead: false,
        knock: new THREE.Vector3()
      };
    }

    function buildEnemyPools() {
      var i;
      for (i = 0; i < SENTINEL_POOL_SIZE; i++) {
        sentinelPool.push(makeSentinelEntity(buildSentinelMesh()));
      }
      for (i = 0; i < TURRET_POOL_SIZE; i++) {
        turretPool.push(makeTurretEntity(buildTurretMesh()));
      }
      buildBossPool();
    }

    function releaseEnemySlot(e) {
      if (!e) return;
      releaseContactShadow(e.shadow);
      e.shadow = null;
      e.dead = true;
      e.active = false;
      if (e.group) e.group.visible = false;
    }

    function spawnSentinel(x, z) {
      var e = null;
      for (var i = 0; i < sentinelPool.length; i++) {
        if (!sentinelPool[i].active) { e = sentinelPool[i]; break; }
      }
      if (!e) return null;

      e.active = true;
      e.dead = false;
      e.pos.set(x, 1.55, z);
      resolveCircle(e.pos, e.radius);
      resetActor(e);
      e.hp = e.maxHp;
      e.speed = PBMission.enemies.sentinel.speed;
      e.fireCd = rnd(1.2, 2.4);
      e.bobPhase = rnd(0, Math.PI * 2);
      e.slow = 0;
      e.flash = 0;
      e.knock.set(0, 0, 0);
      e.coreMat.color.setHex(C.magenta);
      e.ringMat.color.setHex(C.cyanDim);
      e.glowMat.color.setHex(C.magenta);
      e.glowMat.opacity = 0.18;
      e.glow.scale.set(e.glowBase.x, e.glowBase.y, e.glowBase.z);
      e.ring.rotation.set(0.42, 0, 0);
      e.group.rotation.set(0, 0, 0);
      e.group.position.copy(e.pos);
      e.group.visible = true;
      e.shadow = acquireContactShadow(e, 1.08, 0.27);
      enemies.push(e);
      spawnRingFx(e.pos, 2.2, C.magenta, 0.45, 0.1);
      spawnParticles(e.pos, C.magenta, 10, 5, 0.4, 0.05);
      return e;
    }

    function spawnTurret(x, z, y) {
      var e = null;
      for (var i = 0; i < turretPool.length; i++) {
        if (!turretPool[i].active) { e = turretPool[i]; break; }
      }
      if (!e) return null;

      e.active = true;
      e.dead = false;
      e.pos.set(x, y === undefined ? 2.15 : y, z);
      resetActor(e);
      e.hp = e.maxHp;
      e.fireCd = rnd(1.2, 2.0);
      e.burst = 0;
      e.burstT = 0;
      e.slow = 0;
      e.flash = 0;
      e.knock.set(0, 0, 0);
      e.head.rotation.set(0, 0, 0);
      e.coreMat.color.setHex(C.amber);
      e.auraMat.color.setHex(C.amber);
      e.auraMat.opacity = 0.14;
      e.aura.scale.set(e.auraBase.x, e.auraBase.y, e.auraBase.z);
      e.group.rotation.set(0, 0, 0);
      e.group.position.copy(e.pos);
      e.group.visible = true;
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
      enemyDirector.alert(e, true);
      events.emit('enemy.hit', { type: e.type, hp: Math.max(0, e.hp), point: point || e.pos });
      spawnParticles(point || e.pos, color || C.cyan, 4, 3.2, 0.28, 0.045);
      if (e.hp <= 0) killEnemy(e);
    }

    function killEnemy(e) {
      if (!e || e.dead) return;
      e.dead = true;
      kills++;
      spawnParticles(e.pos, e.type === 'turret' ? C.amber : C.magenta, 22, 7.5, 0.55, 0.07);
      spawnRingFx(e.pos, 2.6, e.type === 'turret' ? C.amber : C.magenta, 0.45, Math.max(0.1, e.pos.y - 0.5));
      e.ai.death = e.type === 'turret' ? 0.84 : 0.71;
      e.warning.visible = false;
      releaseContactShadow(e.shadow);
      e.shadow = null;
      events.emit('enemy.destroy', { type: e.type, point: e.pos });
      var idx = enemies.indexOf(e);
      if (idx >= 0) enemies.splice(idx, 1);
      registerHit(true);
      player.shake = Math.max(player.shake, 0.14);
    }

    function resetActor(e) {
      PBEnemyDirector.reset(e.ai, e.pos.x, e.pos.z, e.pos.x < 0 ? -1 : 1);
      e.group.scale.setScalar(0.72);
      e.detail.visible = true;
      e.low.visible = false;
      e.warning.visible = false;
    }

    function updateWrecks(pool, dt) {
      for (var enemy of pool) {
        if (!enemy.active || !enemy.dead) continue;
        var actor = enemy.ai;
        actor.death -= dt;
        PBEnemyDirector.transition(actor, 'dead', dt);
        if (actor.death <= 0) {
          releaseEnemySlot(enemy);
          continue;
        }
        enemy.group.rotation.z += dt * (enemy.type === 'sentinel' ? 1.8 : 0.64);
        if (enemy.type === 'sentinel') enemy.group.position.y -= dt * (1.15 + (1 - actor.death) * 1.3);
        if (actor.age > 0.29 && actor.age - dt < 0.29) {
          spawnParticles(enemy.group.position, 0xffbf6d, 8, 4, .36, .045, 'fragment');
        }
        enemy.coreMat.color.setHex(actor.death > 0.36 ? 0xd67458 : 0x301820);
      }
    }

    function clearEnemies() {
      var i;
      for (i = 0; i < enemies.length; i++) {
        releaseEnemySlot(enemies[i]);
      }
      for (i = 0; i < sentinelPool.length; i++) {
        if (sentinelPool[i].active) releaseEnemySlot(sentinelPool[i]);
      }
      for (i = 0; i < turretPool.length; i++) {
        if (turretPool[i].active) releaseEnemySlot(turretPool[i]);
      }
      enemies.length = 0;
    }

    var enemyOrigin = new THREE.Vector3();
    var enemyShot = new THREE.Vector3();

    function shootEnemy(e, spec, turret) {
      enemyOrigin.set(e.pos.x, e.pos.y + (turret ? 0 : 0.08), e.pos.z);
      enemyShot.copy(player.pos).sub(enemyOrigin);
      enemyShot.y -= turret ? 0.10 : 0.08;
      enemyShot.normalize();
      var spread = turret ? 0.03 : 0.022;
      enemyShot.x += rnd(-spread, spread);
      if (!turret) enemyShot.y += rnd(-0.018, 0.018);
      enemyShot.z += rnd(-spread, spread);
      var hue = turret ? C.amber : C.magenta;
      spawnBullet(enemyOrigin, enemyShot.normalize(), turret ? 13 : 10.5, spec.damage, hue, turret ? 0.16 : 0.19, 0);
      spawnParticles(enemyOrigin, hue, turret ? 2 : 3, turret ? 2 : 2.4, 0.22, 0.04);
      events.emit('enemy.attack', { point: enemyOrigin, turret: turret });
    }

    function updateSentinel(e, dt, slowF) {
      var initialRange = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
      enemyDirector.sense(e, player.pos, enemies, initialRange, dt);
      var movement = enemyDirector.move(e, player.pos, enemies, gameTime, slowF, dt);
      var dx = player.pos.x - e.pos.x;
      var dz = player.pos.z - e.pos.z;
      var range = Math.hypot(dx, dz) || 1;
      var ai = e.ai;
      var angle = ai.alert ? Math.atan2(dx, dz) : Math.atan2(ai.vx, ai.vz);
      e.group.rotation.y += angleWrap(angle - e.group.rotation.y) * (1 - Math.exp(-dt * 12));
      PBCombatVisuals.trackSensor(e.sensor, player.pos.y - e.pos.y, range);

      var spec = PBMission.enemies.sentinel;
      if (enemyDirector.fireReady(e, range, slowF, dt)) {
        e.fireCd = rnd(spec.fireMin, spec.fireMax);
        shootEnemy(e, spec, false);
      }
      var state = e.flash > 0 ? 'hit' : ai.charge > 0 ? 'charge' : ai.attack > 0 ? 'attack' : movement;
      PBEnemyDirector.transition(ai, state, dt);
      e.group.rotation.z = ai.lean * (ai.vx - Math.sin(e.bobPhase) * 0.35);
      e.group.rotation.x = -ai.lean * (ai.vz * .42 + .1);
      e.vents.visible = e.hp < e.maxHp * .48;
      e.vents.scale.y = .84 + .16 * Math.sin(gameTime * 12 + e.bobPhase);
    }

    function updateTurret(e, dt, slowF) {
      var dx = player.pos.x - e.pos.x;
      var dz = player.pos.z - e.pos.z;
      var range = Math.hypot(dx, dz) || 1;
      var spec = PBMission.enemies.turret;
      var ai = e.ai;
      enemyDirector.sense(e, player.pos, enemies, range, dt);
      var angle = ai.alert ? Math.atan2(dx, dz) : Math.sin(gameTime * .69 + e.bobPhase) * .7;
      e.head.rotation.y += angleWrap(angle - e.head.rotation.y) * (1 - Math.exp(-dt * 15));
      e.lowHead.rotation.y = e.head.rotation.y;
      PBCombatVisuals.trackSensor(e.barrels, player.pos.y - e.pos.y, range);
      e.barrels.position.z *= Math.exp(-dt * 20);

      if (e.burst === 0 && enemyDirector.fireReady(e, range, slowF, dt)) {
        e.burst = spec.burst;
        e.burstT = 0;
        e.fireCd = rnd(spec.fireMin, spec.fireMax);
      }
      if (e.burst > 0) {
        e.burstT -= dt * slowF;
        if (e.burstT <= 0) {
          e.burstT = 0.14;
          e.burst--;
          e.barrels.position.z = -0.09;
          ai.attack = 0.35;
          shootEnemy(e, spec, true);
        }
      }
      var state = e.flash > 0 ? 'hit' : e.slow > 0 ? 'stagger' : ai.charge > 0 ? 'charge' :
        ai.attack > 0 ? 'attack' : ai.alert ? 'alert' : 'idle';
      PBEnemyDirector.transition(ai, state, dt);
      e.head.rotation.z = Math.sin(gameTime * 41) * ai.lean * 0.16;
      e.coreMat.radiance = 1.18 + ai.energy * 1.62 + (e.hp < e.maxHp * .36 ? 0.35 * Math.sin(gameTime * 19) : 0);
    }

    function updateEnemies(dt) {
      for (var i = enemies.length - 1; i >= 0; i--) {
        var e = enemies[i];
        if (e.dead) {
          releaseEnemySlot(e);
          enemies.splice(i, 1);
          continue;
        }

        var ai = e.ai;
        ai.spawn = Math.max(0, ai.spawn - dt);
        ai.attack = Math.max(0, ai.attack - dt);
        var distance = dist2D(e.pos, player.pos);
        ai.far = distance > (ai.far ? 29 : 34);
        e.detail.visible = !ai.far;
        e.low.visible = ai.far;
        e.group.scale.setScalar(1 - .28 * (ai.spawn / .38) ** 2);
        e.flash = Math.max(0, e.flash - dt);
        var wear = Math.max(0, 1 - e.hp / e.maxHp);
        PBCombatVisuals.updateArmor(e.armor, e.flash * 5 + Math.max(0, wear - 0.5) * 0.7, wear);
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

        e.warning.visible = ai.charge > 0;
        if (e.warning.visible) {
          var charge = 1 - ai.charge / PBMission.enemies[e.type].charge;
          e.warning.material.opacity = 0.32 + charge * 0.60;
          e.warning.scale.setScalar(0.22 + charge * 0.18);
        }

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
        emissive: 0xff3a9a, specular: 0.62, roughness: 0.24, radiance: 1.78
      });
      tuneSurface(coreMat, 0.86, 0.55, 0.34);
      tuneTexture(coreMat, DETAIL_TILE.water, 0.9, 0.5);
      var core = new THREE.Mesh(G.sphere, coreMat);
      core.scale.setScalar(0.92);
      group.add(core);

      var eyeMat = matBasic(0xffe3f4, { radiance: 3.5 });
      if (highVisuals) {
        var lensSeat = modelPart(group, MODELS.boss, IM.steelDark, 0, 0.04, 0.82, 0.82, 0.52, 0.26);
        lensSeat.castShadow = true;
        var lensRing = modelPart(group, G.torus, IM.casting, 0, 0.04, 0.97, 0.22, 0.19, 0.22);
        lensRing.rotation.x = Math.PI / 2;
        modelPart(group, MODELS.lens, eyeMat, 0, 0.04, 0.995, 0.19, 0.16, 0.10);
        for (var optic = -1; optic <= 1; optic += 2) {
          modelPart(group, HULL.cowl, IM.craneIvory, optic * 0.42, 0.19, 0.73,
            0.36, 0.29, 0.31, optic * 0.56, optic * 0.22);
          modelPart(group, G.box, IM.lampRed, optic * 0.36, -0.1, 0.91, 0.13, 0.032, 0.035);
        }
      } else {
        modelPart(group, G.lowSphere, eyeMat, 0, 0, 0.74, 0.34, 0.34, 0.34);
      }

      var plateGeo = MODELS.boss;
      var plateMat = matLambert(highVisuals ? 0x435769 : 0x1c2940, {
        emissive: 0x0b1424, specular: 0.55, roughness: 0.3
      });
      tuneSurface(plateMat, 0.94, 0.78, 0.42);
      tuneTexture(plateMat, DETAIL_TILE.metal, 0.72, 0.75);
      var plates = [];
      for (var i = 0; i < 3; i++) {
        var angle = i * Math.PI * 2 / 3;
        var plate = new THREE.Group();
        plate.position.set(Math.cos(angle) * 1.15, 0, Math.sin(angle) * 1.15);
        plate.rotation.y = -angle + Math.PI / 2;
        group.add(plate);
        plates.push({ mesh: plate, angle: angle });
      }

      var ringMat = matBasic(0xff5fc8, {
        transparent: true, opacity: 0.9, blending: 'additive',
        depthWrite: false, fog: false, radiance: 1.68
      });
      var ringGeo = new THREE.TorusGeometry(1.95, 0.05, 4, 32);
      ringGeo._owned = true;
      var ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = 0.42;
      group.add(ring);

      var ring2Mat = matBasic(C.violet, {
        transparent: true, opacity: 0.7, blending: 'additive',
        depthWrite: false, fog: false, radiance: 1.62
      });
      var ring2Geo = new THREE.TorusGeometry(1.7, 0.035, 4, 28);
      ring2Geo._owned = true;
      var ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
      ring2.rotation.x = 1.3;
      ring2.rotation.z = 0.5;
      group.add(ring2);

      // V5 boss armour detail: shared materials and primitive geometry, built
      // once with the boss pool.  The trim material is tinted by the enrage
      // phase so the extra plates read as part of the same armour system.
      var bossTrimMat = matLambert(highVisuals ? 0x899ba4 : 0x4d6184, {
        emissive: 0x101b2c, specular: 0.72, roughness: 0.24, metalness: 0.78, detail: 0.3
      });
      tuneTexture(bossTrimMat, DETAIL_TILE.metal, 0.8, 0.7);
      var bossVentMat = matLambert(0x07040a, {
        emissive: 0x000000, specular: 0.08, roughness: 0.85, metalness: 0.2, detail: 0.15
      });
      tuneTexture(bossVentMat, DETAIL_TILE.chips, 1.1, 0.45);
      var pi;
      var hotMetal = matBasic(0xff764c, { radiance: 2.0 });
      var condenser = matBasic(0x7de1ee, { radiance: 1.65 });
      for (pi = 0; pi < plates.length; pi++) {
        var segment = plates[pi];
        var mount = segment.mesh;
        var shieldShell = modelPart(mount, plateGeo, plateMat, 0, 0, 0, 1.89, .79, .86);
        shieldShell.castShadow = true;
        modelPart(mount, MODELS.boss, bossTrimMat, 0, .245, .056, 1.49, .27, .79);
        modelPart(mount, HULL.housing, bossVentMat, 0, -.014, .378, 1.47, .32, .073);
        modelPart(mount, G.box, coreMat, 0, .036, .428, 1.26, .041, .026);
        segment.piston = modelPart(mount, MODELS.tube, bossTrimMat, 0, -.34, -.20, .19, .42, .19);
        segment.piston.rotation.x = Math.PI / 2;
        segment.sink = new THREE.Group();
        segment.sink.position.set(0, .31, .11);
        mount.add(segment.sink);
        segment.sink.detailDistance = 45;
        for (var fin = -2; fin <= 2; fin++) {
          modelPart(segment.sink, HULL.cowl, bossTrimMat, fin * .238, 0, 0, .14, .29, .64);
        }
        segment.fracture = new THREE.Group();
        var shard = modelPart(segment.fracture, HULL.shield, plateMat, .57, -.30, .07, .52, .39, .58, .26, -.32);
        shard.castShadow = true;
        modelPart(segment.fracture, G.box, hotMetal, .37, -.245, .345, .13, .036, .018, 0, -.89);
        modelPart(segment.fracture, G.box, hotMetal, .31, -.18, .345, .08, .022, .016, 0, .39);
        mount.add(segment.fracture);
        segment.emitter = modelPart(mount, MODELS.optic, condenser, 0, -.21, .48, .26, .12, .11);
        for (var latch of [-.65, .65]) {
          var hinge = modelPart(mount, MODELS.joint, bossTrimMat, latch, -.205, .17, .17, .165, .53, .22);
          hinge.detailDistance = 38;
        }
      }
      for (pi = 0; pi < 6; pi++) {
        var ra = pi / 6 * Math.PI * 2;
        var rib = new THREE.Mesh(G.box, bossTrimMat);
        rib.position.set(
          Math.cos(ra) * 1.0,
          pi % 2 ? 0.62 : -0.62,
          Math.sin(ra) * 1.0
        );
        rib.rotation.y = -ra;
        rib.scale.set(0.5, 0.075, 0.16);
        group.add(rib);
      }
      for (pi = -1; pi <= 1; pi += 2) {
        var coreBand = new THREE.Mesh(G.torus, bossTrimMat);
        coreBand.rotation.x = Math.PI / 2;
        coreBand.position.y = pi * 0.2;
        coreBand.scale.setScalar(1.01);
        group.add(coreBand);
      }
      var ventPlumes = [];
      for (pi = 0; pi < 3; pi++) {
        var va = pi / 3 * Math.PI * 2 + 0.3;
        var exh = new THREE.Mesh(G.box, bossVentMat);
        exh.position.set(Math.cos(va) * 0.72, -0.92, Math.sin(va) * 0.72);
        exh.rotation.y = -va;
        exh.scale.set(0.3, 0.18, 0.2);
        group.add(exh);
        var exhaust = volumeMaterial(0xd77b5d, 0);
        exhaust.softVolume = true;
        var plume = modelPart(group, G.lowSphere, exhaust,
          Math.cos(va) * 0.78, -1.31, Math.sin(va) * 0.78, 0.22, 0.78, 0.22, va);
        plume.visible = false;
        ventPlumes.push(plume);
      }

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
      shieldMat.rimOpacity = 0.94;
      var shield = new THREE.Mesh(MODELS.lens, shieldMat);
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
        plateMat: plateMat,
        bossTrimMat: bossTrimMat,
        bossVentMat: bossVentMat,
        ventPlumes: ventPlumes,
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

    function buildBossPool() {
      if (bossPool) return;
      var built = buildBossMesh();
      built.group.visible = false;
      scene.add(built.group);
      MATERIAL_LIBRARY.enemyArmor.push(built.plateMat, built.coreMat);
      bossPool = {
        active: false,
        group: built.group,
        core: built.core,
        coreMat: built.coreMat,
        eyeMat: built.eyeMat,
        plates: built.plates,
        plateMat: built.plateMat,
        bossTrimMat: built.bossTrimMat,
        bossVentMat: built.bossVentMat,
        ventPlumes: built.ventPlumes,
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
        pos: new THREE.Vector3(0, 2.5, -34),
        hp: 500,
        maxHp: 500,
        phase: 1,
        alive: false,
        enraged: false,
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
        anchor: new THREE.Vector3(0, 2.5, -34),
        anchorT: 3.5,
        summonCd: 16,
        contactCd: 0,
        deadT: 0
      };
    }

    function spawnBoss() {
      if (boss || !bossPool || bossPool.active) return;
      var b = bossPool;
      b.active = true;
      b.alive = true;
      b.enraged = false;
      b.hp = b.maxHp;
      b.phase = 1;
      b.t = 0;
      b.invuln = 1.4;
      b.shield = 0;
      b.shieldCd = 7.5;
      b.exposed = 0;
      b.plateOpen = 0;
      b.flash = 0;
      b.action = null;
      b.actionCd = 1.8;
      b.alt = 0;
      b.anchorT = 3.5;
      b.summonCd = 16;
      b.contactCd = 0;
      b.deadT = 0;
      b.pos.set(0, 2.5, -34);
      b.anchor.set(0, 2.5, -34);
      b.group.position.copy(b.pos);
      b.group.scale.setScalar(.72);
      b.group.quaternion.identity();
      b.group.visible = true;
      b.core.scale.setScalar(0.92);
      b.coreMat.color.setHex(0x2a0a1e);
      b.coreMat.emissive.setHex(0xff3a9a);
      b.eyeMat.color.setHex(0xffe3f4);
      b.plateMat.color.setHex(highVisuals ? 0x435769 : 0x1c2940);
      b.plateMat.emissive.setHex(0x0b1424);
      if (b.bossTrimMat) {
        b.bossTrimMat.color.setHex(highVisuals ? 0x899ba4 : 0x4d6184);
        b.bossTrimMat.emissive.setHex(0x101b2c);
      }
      for (var p = 0; p < b.plates.length; p++) {
        var plate = b.plates[p];
        plate.mesh.position.set(Math.cos(plate.angle) * 1.15, 0, Math.sin(plate.angle) * 1.15);
        plate.mesh.rotation.set(0, -plate.angle + Math.PI / 2, 0);
        plate.sink.rotation.x = 0;
        plate.fracture.rotation.z = 0;
        plate.fracture.position.set(0, 0, 0);
        plate.emitter.visible = false;
      }
      b.ring.rotation.set(0.42, 0, 0);
      b.ring2.rotation.set(1.3, 0, 0.5);
      b.ringMat.opacity = 0.9;
      b.ringMat.color.setHex(0xff5fc8);
      b.ring2Mat.opacity = 0.7;
      b.ring2Mat.color.setHex(C.violet);
      b.aura.scale.setScalar(1.62);
      b.auraMat.color.setHex(0xff4fb8);
      b.auraMat.opacity = 0.08;
      b.auraCore.scale.setScalar(1.06);
      b.auraCoreMat.color.setHex(0xff8fd6);
      b.auraCoreMat.opacity = 0.16;
      b.auraHex = 0;
      b.floorGlow.visible = true;
      b.floorCore.visible = true;
      b.floorGlow.position.set(0, -2.4, 0);
      b.floorGlowMat.color.setHex(0xff4fb8);
      b.floorGlowMat.opacity = 0.09;
      b.floorCore.position.set(0, -2.39, 0);
      b.floorCoreMat.color.setHex(0xff9ad8);
      b.floorCoreMat.opacity = 0.13;
      b.shieldGroup.visible = false;
      b.shieldGroup.rotation.set(0, 0, 0);
      b.shieldMat.color.setHex(C.cyan);
      b.shieldMat.opacity = 0.1;
      b.shadow = acquireContactShadow(b, 3.05, 0.32);

      boss = b;
      bossEverSpawned = true;
      bossDefeated = false;
      flow.bossActive = true;
      events.emit('boss.phaseChange', { phase: 1, point: b.pos });
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

      if (boss.phase === 1 && boss.hp > 0 && boss.hp <= 150) boss.hp = 151;
      if (boss.hp <= 0) {
        // A large burst may cross a phase boundary but can never skip one.
        if (boss.phase < 3) {
          var threshold = boss.phase === 1 ? 330 : 150;
          boss.hp = boss.hp <= 0 ? threshold : Math.min(boss.hp, threshold);
          enterBossPhase(boss.phase + 1);
          return;
        }
        defeatBoss();
        return;
      }

      // Explicit HP bands: 500-331 phase 1, 330-151 phase 2, <=150 enraged.
      var targetPhase = boss.hp > 330 ? 1 : (boss.hp > 150 ? 2 : 3);
      // Advance one phase per hit so a high-damage burst cannot skip a phase.
      if (targetPhase > boss.phase) enterBossPhase(boss.phase + 1);
    }

    function enterBossPhase(phase) {
      if (!boss) return;
      boss.phase = phase;
      boss.invuln = 1.35;
      boss.action = null;
      boss.actionCd = phase === 3 ? 1.65 : 1.0;
      boss.shield = 0;
      boss.shieldCd = phase === 3 ? 6.0 : 5.0;
      boss.exposed = 0;
      events.emit('boss.phaseChange', { phase: phase, point: boss.pos });
      spawnRingFx(boss.pos, 9, C.magenta, 0.8, 1.4);
      spawnRingFx(boss.pos, 6, C.violet, 0.6, 1.0);
      spawnParticles(boss.pos, C.magenta, 40, 12, 0.9, 0.09);
      boss.flash = Math.max(boss.flash, 0.22);
      player.shake = Math.max(player.shake, 0.5);
      if (phase === 3 && !boss.enraged) {
        boss.enraged = true;
        events.emit('boss.enrage', { point: boss.pos });
        boss.summonCd = 12;
        if (boss.plateMat) {
          boss.plateMat.color.setHex(0x160307);
          boss.plateMat.emissive.setHex(0x3d0505);
        }
        if (boss.bossTrimMat) {
          boss.bossTrimMat.color.setHex(0x5c1518);
          boss.bossTrimMat.emissive.setHex(0x2a0404);
        }
        flashScreen(0xff2d2d, true);
        // One radial burst marks the transition, then never repeats.
        var burstOrigin = new THREE.Vector3(boss.pos.x, 1.25, boss.pos.z);
        for (var b = 0; b < 12; b++) {
          var ang = b / 12 * Math.PI * 2;
          spawnBullet(burstOrigin.clone(), new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)),
            9.5, 8, 0xff3d32, 0.22, 0);
        }
        spawnRingFx(boss.pos, 11, 0xff3d32, 0.7, 1.2);
        player.shake = Math.max(player.shake, 0.7);
        if (enemies.length < 3) summonSentinels(2);
      }
      if (phase === 2) flashScreen(0x9b6bff, true);
    }

    function defeatBoss() {
      if (!boss) return;
      boss.alive = false;
      boss.hp = 0;
      boss.shield = 0;
      boss.exposed = 0;
      boss.action = null;

      var pos = boss.pos.clone();
      scorch.position.set(pos.x, 0.074, pos.z);
      scorch.visible = true;
      spawnParticles(pos, 0x733a35, 20, 8, 0.92, 0.11);
      releaseContactShadow(boss.shadow);
      boss.shadow = null;
      boss.shieldGroup.visible = false;
      boss.deadT = 1.85;
      bossWreck = boss;
      events.emit('boss.defeat', { point: pos });
      boss = null;

      spawnParticles(pos, C.magenta, 60, 14, 1.1, 0.1);
      spawnParticles(pos, C.cyan, 40, 10, 1.0, 0.08);
      spawnRingFx(pos, 13, C.magenta, 0.9, 1.6);
      spawnRingFx(pos, 9, C.cyan, 0.75, 1.2);

      clearBullets();
      clearEnemies();
      pending.length = 0;
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
      bossDefeated = true;
      flow.bossActive = false;

      exit.unlocked = true;
      events.emit('exit.unlock', { point: exit.pos });
      player.shake = 0.9;
      flashScreen(0xff4fb8, true);
      addToast('零号守门者解体 // 出口已解锁', 'good');
      updateObjective();
    }

    function summonSentinels(count) {
      if (!boss) return;
      for (var i = 0; i < count; i++) {
        var ang = i * Math.PI + gameplayRandom() * 0.6;
        var x = clamp(boss.pos.x + Math.cos(ang) * rnd(4.5, 7), BOSS_ARENA.minX + 1.5, BOSS_ARENA.maxX - 1.5);
        var z = clamp(boss.pos.z + Math.sin(ang) * rnd(4.5, 7), BOSS_ARENA.minZ + 1.5, BOSS_ARENA.maxZ - 1.5);
        spawnTelegraph(x, z, 1.04, .58, C.red);
        queueWaveSpawn({ x: x, z: z, delay: .58 });
      }
      addToast('守门者增援 · 留意红色降落标记', 'warn');
    }

    function updateBossWreck(dt) {
      if (!bossWreck) return;
      var b = bossWreck;
      var last = b.deadT;
      b.deadT -= dt;
      var age = 1.85 - b.deadT;
      b.group.position.y = b.pos.y - Math.min(1.7, age * age * .9);
      b.group.rotation.z = Math.min(.48, age * .28);
      b.core.scale.setScalar(Math.max(.08, 1.1 - age * .55));
      b.ring.rotation.y += dt * (1 + age * 2);
      b.ring2.rotation.x -= dt * (1.5 + age);
      b.shieldGroup.visible = false;
      b.floorGlow.visible = false;
      b.floorCore.visible = false;
      for (var plate of b.plates) {
        var radius = 2 + age * age * .92;
        plate.mesh.position.set(Math.cos(plate.angle) * radius,
          Math.sin(age * 2.4 + plate.angle) * age * .48, Math.sin(plate.angle) * radius);
        plate.mesh.rotation.z += dt * (1.4 + plate.angle * .37);
        plate.mesh.rotation.x += dt * .8;
      }
      if (last > 1.18 && b.deadT <= 1.18) {
        spawnParticles(b.group.position, 0xff924c, 24, 7, .82, .085, 'fragment');
      }
      if (last > 0.62 && b.deadT <= 0.62) {
        spawnRingFx(b.pos, 8.3, C.amber, .63, .11);
        spawnParticles(b.group.position, 0x67616a, 11, 1.4, .93, .48, 'dust');
        renderer.addWaterRipple(b.pos.x, b.pos.z, worldClock);
      }
      if (b.deadT <= 0) {
        b.group.visible = false;
        b.active = false;
        bossWreck = null;
      }
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
        axis: gameplayRandom() < 0.5 ? 'x' : 'z'
      };
      boss.actionCd = PBMission.bossPhases[boss.phase].interval;
      events.emit('boss.attack', { attack: type, point: boss.pos });
      if (type === 'missiles' || type === 'shockwave') spawnRingFx(boss.pos, 3.6, C.red, .35, 0.12);
    }

    function endBossAction() {
      if (boss) boss.action = null;
    }

    function nextBossAction() {
      if (!boss) return 'volley';
      var list = PBMission.bossPhases[boss.phase].attacks;
      var type = list[boss.alt % list.length];
      boss.alt++;
      return type;
    }

    function updateBossAction(dt) {
      if (!boss || !boss.action) return;
      var a = boss.action;
      a.t += dt;

      if (a.type === 'volley') {
        if (a.step === 0) {
          a.step = 1;
          if (boss.phase === 3) {
            spawnTelegraph(player.pos.x, player.pos.z, 1.5, 0.5, C.red);
          }
        }
        if (a.step === 1 && a.t >= 0.5) {
          a.step = 2;
          var base = bossAimDir();
          var origin = boss.pos.clone().addScaledVector(base, 1.5);
          var fan = boss.phase === 3 ? 0.24 : 0.14;
          for (var i = -1; i <= 1; i++) {
            var d = rotateYDir(base, i * fan);
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
              damagePlayer(16, boss.pos);
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
          var count = boss.phase === 3 ? 3 : 2;
          var ttl = boss.phase === 3 ? 4.2 : 5.0;
          for (var m = 0; m < count; m++) {
            var off = (m - (count - 1) / 2) * 0.3;
            spawnMissile(morigin, rotateYDir(mbase, off),
              boss.phase === 3 ? 9.5 : 8.2, 1.9, ttl, 14);
          }
        }
        if (a.t >= 1.15) endBossAction();
        return;
      }

      if (a.type === 'shockwave') {
        if (a.step === 0 && a.t >= 0.3) {
          a.step = 1;
          var phase3 = boss.phase === 3;
          var gapHalf = phase3 ? 0.24 : 0.4;
          var baseAng = gameplayRandom() * Math.PI * 2;
          a.baseAng = baseAng;
          var gaps = [];
          for (var g = 0; g < 3; g++) gaps.push(baseAng + g * Math.PI * 2 / 3);
          spawnShockwave(boss.pos, gaps, gapHalf, phase3 ? 12 : 9.5);
        }
        if (a.step === 1 && boss.phase === 3 && a.t >= 0.7) {
          a.step = 2;
          // Offset second ring: a different gap alignment and slower speed,
          // so the two waves leave a readable moving safe lane.
          var gaps2 = [];
          for (var g2 = 0; g2 < 3; g2++) {
            gaps2.push(a.baseAng + 0.45 + g2 * Math.PI * 2 / 3);
          }
          spawnShockwave(boss.pos, gaps2, 0.26, 8.4);
          spawnRingFx(boss.pos, 4.2, C.red, 0.4, 1.1);
        }
        if (a.t >= (boss.phase === 3 ? 1.55 : 1.2)) endBossAction();
        return;
      }

      if (a.type === 'expose') {
        if (a.step === 0) {
          a.step = 1;
          boss.exposed = PBMission.bossPhases[boss.phase].exposure;
          addToast('核心暴露 // 伤害翻倍 ' + boss.exposed.toFixed(2) + 's', 'good');
        }
        if (a.t >= (boss.phase === 3 ? 1.55 : 1.95)) endBossAction();
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
          boss.exposed = Math.max(boss.exposed, PBMission.bossPhases[boss.phase].exposure);
          events.emit('boss.shield', { active: false, point: boss.pos });
          addToast('护盾过载 // 攻击窗口开启', 'good');
        }
      } else if (boss.phase >= 2 && boss.invuln <= 0) {
        boss.shieldCd -= dt;
        if (boss.shieldCd <= 0) {
          boss.shield = 2.8;
          boss.shieldCd = rnd(8, 10);
          events.emit('boss.shield', { active: true, point: boss.pos });
          addToast('环形护盾展开 // 等待过载', 'warn');
        }
      }

      boss.anchorT -= dt;
      if (boss.anchorT <= 0) {
        boss.anchorT = PBMission.bossPhases[boss.phase].anchorTime;
        var anchors = PBMission.anchors;
        var pick = anchors[Math.floor(gameplayRandom() * anchors.length)];
        boss.anchor.set(pick[0], 2.5, pick[1]);
        spawnParticles(boss.pos, C.violet, 8, 4, 0.35, 0.05);
      }

      var mk = 1 - Math.exp(-dt * (boss.phase === 3 ? 1.55 : 1.3));
      boss.pos.x = lerp(boss.pos.x, boss.anchor.x, mk);
      boss.pos.z = lerp(boss.pos.z, boss.anchor.z, mk);
      boss.pos.y = 2.5 + Math.sin(boss.t * 1.4) * 0.16;

      var dx = player.pos.x - boss.pos.x;
      var dz = player.pos.z - boss.pos.z;
      boss.group.quaternion.setFromAxisAngle(UP, Math.atan2(dx, dz));
      boss.group.position.copy(boss.pos);
      boss.group.scale.setScalar(.72 + .28 * Math.min(1, boss.t / .93));

      if (boss.flash > 0) boss.coreMat.emissive.setHex(0xffffff);
      else boss.coreMat.emissive.setHex(boss.enraged ? 0xff1a0a : 0xff3a9a);

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
      boss.auraMat.opacity = 0.022 + auraPulse * 0.018;
      boss.auraCoreMat.opacity = 0.047 + auraPulse * 0.025;
      boss.floorGlow.position.y = 0.07 - boss.pos.y;
      boss.floorCore.position.y = 0.075 - boss.pos.y;
      var floorPulse = 0.82 + 0.18 * Math.sin(boss.t * 2.6);
      boss.floorGlowMat.opacity = (boss.exposed > 0 ? 0.11 : 0.065) * floorPulse;
      boss.floorCoreMat.opacity = (boss.exposed > 0 ? 0.15 : 0.095) * floorPulse;

      boss.ring.rotation.z += dt * (boss.enraged ? 2.3 : 1.08);
      boss.ring2.rotation.z -= dt * 2.1;

      // V7 phase structure: the armour shell itself changes with the phase.
      // Phase 1 is sealed, phase 2 cracks open to reveal the ring and heat
      // sinks, and phase 3 vents with a wider, hotter gap.  Core exposure adds
      // the final full opening, so this is geometry motion, not a colour swap.
      var phaseOpen = boss.phase === 3 ? 0.44 : (boss.phase === 2 ? 0.18 : 0);
      var targetOpen = boss.exposed > 0 ? 1 : phaseOpen;
      boss.plateOpen = lerp(boss.plateOpen, targetOpen, 1 - Math.exp(-dt * 9));
      if (boss.plateMat) {
        var heat = (boss.enraged ? 0.42 : (boss.phase === 2 ? 0.14 : 0.025)) +
          (1 - boss.hp / boss.maxHp) * 0.22 + (boss.shield > 0 ? 0.05 : 0);
        boss.plateMat.emissive.setRGB(heat * 0.62, heat * 0.14, heat * 0.17);
        boss.plateMat.wear = 1 - boss.hp / boss.maxHp;
        if (boss.bossVentMat) {
          boss.bossVentMat.color.setHex(boss.enraged ? 0xd24e28 : (boss.phase === 2 ? 0x6e8193 : 0x302e35));
          boss.bossVentMat.radiance = 0.65 + heat * (1.6 + Math.sin(boss.t * 11) * 0.3);
        }
        for (var vent of boss.ventPlumes) {
          vent.visible = boss.enraged || boss.exposed > 0;
          vent.material.opacity = (boss.enraged ? 0.22 : 0.09) * (0.67 + 0.33 * Math.sin(boss.t * 8 + vent.rotation.y));
        }
      }
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
        plate.sink.rotation.x = -boss.plateOpen * 1.08;
        plate.piston.scale.y = .42 + boss.plateOpen * .48;
        var fracture = boss.enraged ? Math.min(1, 0.06 + (150 - boss.hp) / 155) : 0;
        plate.fracture.position.x = fracture * .22;
        plate.fracture.position.y = -fracture * .14;
        plate.fracture.rotation.z = fracture * .37;
        var charging = boss.action && (boss.action.type === 'laser' || boss.action.type === 'missiles');
        plate.emitter.visible = boss.phase > 1 && (boss.exposed > 0 || !!charging);
        plate.emitter.scale.y = .11 + (charging ? Math.min(.105, boss.action.t * .13) : .04);
      }

      boss.shieldGroup.visible = boss.shield > 0;
      if (boss.shield > 0) {
        boss.shieldGroup.rotation.y += dt * 1.2;
        boss.shieldMat.color.setHex(boss.enraged ? 0xff3d32 : C.cyan);
        boss.shieldMat.opacity = 0.1 + 0.05 * (0.5 + 0.5 * Math.sin(boss.t * 8));
      }

      if (boss.contactCd <= 0 && dist2D(boss.pos, player.pos) < 1.9) {
        damagePlayer(8, boss.pos);
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
          beamMid: fxAdditive(0xff4d6d, 0.65, 1.9),
          beamCore: fxAdditive(0xffffff, 0.95, 3.4),
          impact: fxAdditive(0xffffff, 0.8, 2.7),
          surge: fxAdditive(0xffffff, 0.9, 2.2)
        };
        var parts = {};
        parts.warnFloor = new THREE.Mesh(G.box, mats.warnFloor);
        parts.warnFloor.position.y = -1.389;
        parts.warnOuter = new THREE.Mesh(MODELS.beam, mats.warnOuter);
        parts.warnCore = new THREE.Mesh(MODELS.beam, mats.warnCore);
        parts.chargeOuter = new THREE.Mesh(MODELS.beam, mats.chargeOuter);
        parts.chargeCore = new THREE.Mesh(MODELS.beam, mats.chargeCore);
        parts.beamHalo = new THREE.Mesh(MODELS.beam, mats.beamHalo);
        parts.beamMid = new THREE.Mesh(MODELS.beam, mats.beamMid);
        parts.beamCore = new THREE.Mesh(MODELS.beam, mats.beamCore);
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
      var len = axis === 'x' ? 46 : 67;
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
      slot.group.position.set(
        axis === 'x' ? 0 : coord,
        1.45,
        axis === 'x' ? coord : (ARENA.minZ + ARENA.maxZ) * 0.5
      );
      slot.group.rotation.y = axis === 'x' ? 0 : Math.PI / 2;

      var p = slot.parts;
      p.warnFloor.scale.set(len, 0.008, 0.46);
      p.warnOuter.scale.set(len, 0.14, 0.34);
      p.warnCore.scale.set(len, 0.034, 0.07);
      p.chargeOuter.scale.set(len * 0.1, 0.42, 0.42);
      p.chargeCore.scale.set(len * 0.1, 0.09, 0.11);
      p.beamHalo.scale.set(len, 0.48, 0.50);
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
          var stroke = settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(l.t * 40);
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
              damagePlayer(9, boss ? boss.pos : null);
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
              damagePlayer(18, w.group.position);
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

    function addToast(text, tone) {
      if (!ui.toasts) return;
      var el = document.createElement('div');
      el.className = 'toast' + (tone ? ' is-' + tone : '');
      el.textContent = text;
      ui.toasts.appendChild(el);
      while (ui.toasts.children.length > 4) {
        ui.toasts.removeChild(ui.toasts.firstChild);
      }
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 2400);
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

    function updateZoneTag() {
      var zone = PBMission.zoneAt(player.pos.z);
      setText(ui.sectorTag, 'SECTOR 07  /  ' + zone.label);
    }

    function updateObjective() {
      updateZoneTag();
    }

    function bindMissionEvents() {
      events.on('mission.objectiveChange', function (detail) {
        setText(ui.objective, detail.objective);
        ui.objective.classList.remove('objective-change');
        if (!settings.reducedMotion) {
          void ui.objective.offsetWidth;
          ui.objective.classList.add('objective-change');
        }
        if (detail.caption && settings.subtitles) {
          caption.textContent = '船坞调度  /  ' + detail.caption;
          captionT = 4.4;
          caption.hidden = false;
        }
        if (detail.node === 'transit' || detail.node === 'approach') {
          showBanner('区域清除', 1400);
        }
      });
      events.on('enemy.alert', function () { encounterAlertT = 3.2; });
      events.on('boss.attack', function (detail) {
        setText(bossWarning, PBMission.attackNames[detail.attack]);
        warningT = detail.attack === 'laser' ? 2.1 : 1.7;
      });
      events.on('boss.phaseChange', function (detail) {
        setArenaPhase(detail.phase);
        flow.setNode('boss' + detail.phase);
        warningT = 0;
      });
      events.on('exit.unlock', function () {
        updateExitVisuals();
        setArenaPhase(4);
        flow.setNode('extract');
        warningT = 0;
      });
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
      flow.setNode('wave' + n);
      encounterAlertT = 2.2;
      showBanner(n === 1 ? '第一波 · 集装箱区封锁' : '第二波 · 装卸平台封锁', 1900);
      for (var spawn of PBMission.waves[n]) {
        queueWaveSpawn(spawn);
      }
      PBSettings.record(n, runTime, kills, false);
      updateObjective();
      updateHud();
    }

    function queueWaveSpawn(spawn) {
      var kind = spawn.y === undefined ? spawnSentinel : spawnTurret;
      queueSpawn(spawn.delay, function () { kind(spawn.x, spawn.z, spawn.y); });
    }

    function beginBoss() {
      flow.wave = 3;
      flow.clearT = -1;
      flow.bossActive = true;
      flow.setNode('arrival');
      setText(ui.waveLabel, 'BOSS');
      showBanner('GATEKEEPER ZERO  /  零号守门者', 2100);
      events.emit('boss.arrival', { point: bossPool.pos });
      queueSpawn(2.0, spawnBoss);
      PBSettings.record(3, runTime, kills, false);
    }

    function updateFlow(dt) {
      if (mode !== 'playing' || bossDefeated) return;
      flow.update(dt, player.pos.z, enemies.length + pending.length, beginWave, beginBoss);
    }

    /* ---------------------------------------------------------------- run */

    function clearSceneEntities() {
      var i;
      clearEnemies();
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
      for (var flash of impactFlashes) {
        flash.life = 0;
        flash.mesh.visible = false;
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
      for (i = 0; i < slashFxPool.length; i++) {
        slashFxPool[i].alive = false;
        slashFxPool[i].mesh.visible = false;
      }
      resetReflectionStrips();
      pending.length = 0;

      if (boss || (bossPool && bossPool.active)) {
        var activeBoss = boss || bossPool;
        releaseContactShadow(activeBoss.shadow);
        activeBoss.shadow = null;
        if (activeBoss.group) activeBoss.group.visible = false;
        activeBoss.active = false;
        activeBoss.alive = false;
      }
      releaseAllContactShadows();
      boss = null;
      bossWreck = null;
    }

    function resetRunState() {
      clearInput();

      player.pos.set(0, EYE, 12.6);
      player.yaw = 0;
      player.pitch = 0;
      viewSwayYaw = viewSwayPitch = lastViewYaw = lastViewPitch = 0;
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
      player.velocityY = 0;
      player.grounded = true;
      player.airDashUsed = false;
      player.slashT = 0;
      player.slashHitDone = false;
      player.slashId = 0;
      player.supplyBlock = 0;

      for (var si = 0; si < supplyStations.length; si++) {
        supplyStations[si].cooldown = 0;
      }
      cancelSupply();
      for (var sf = 0; sf < slashFxPool.length; sf++) {
        slashFxPool[sf].alive = false;
        slashFxPool[sf].mesh.visible = false;
      }

      gameTime = 0;
      runTime = 0;
      kills = 0;
      bossEverSpawned = false;
      bossDefeated = false;
      muzzleT = muzzleSmokeT = 0;
      if (scorch) scorch.visible = false;
      updateMuzzleSmoke(0);
      lastDryToast = -10;
      if (muzzleFlash) muzzleFlash.visible = false;

      flow.reset();
      cinematics.skip();
      caption.hidden = true;
      damageDirection.hidden = true;
      bossWarning.hidden = true;
      encounterAlertT = captionT = warningT = 0;
      inspection = sprintPose = landingKick = lookStress = aimIdle = stepDistance = 0;
      cameraFov = settings.fov;
      worldObjects.reset();
      impactMarks.reset();
      renderer.clearWaterRipples();
      if (seed !== null) {
        gameplayRandom = PBEvents.rng(seed);
        visualRandom = PBEvents.rng(seed ^ 0xa53d19);
      }

      exit.unlocked = false;
      updateExitVisuals();
      setArenaPhase(0);

      ui.bossBar.hidden = true;
      ui.bossBar.classList.remove('is-shielded', 'is-exposed', 'is-enraged');
      ui.hint.hidden = true;
      ui.supplyPanel.hidden = true;
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = 0;
      ui.banner.hidden = true;
      if (ui.toasts) ui.toasts.replaceChildren();
      reportedAudioError = '';
      ui.damage.style.opacity = '0';
      ui.screenFlash.classList.remove('on', 'is-hard');
      screenFlashToken++;
      ui.hitmarker.classList.remove('show', 'kill');

      resetWeapons();
      updateSupplyVisuals();
      updateHud();
    }

    function startRun() {
      clearSceneEntities();
      resetRunState();

      mode = 'playing';
      viewRoot.visible = true;
      sound.unlock();
      sound.setMode(mode);
      overlay.hidden = true;
      canvas.focus({ preventScroll: true });
      hud.classList.remove('is-hidden');
      lastTs = performance.now();

      updateObjective();
      updateHud();
      requestLock();
      addToast('突入开始 // 保持移动', 'good');
    }

    function pauseGame() {
      if (mode !== 'playing') return;
      mode = 'paused';
      sound.setMode(mode);
      clearInput();
      cancelSupply();
      weapons[currentWeapon].reloading = 0;
      player.slashT = 0;
      player.slashHitDone = false;
      if (ui.supplyPanel) ui.supplyPanel.hidden = true;
      releaseLock();
      showOverlay('paused');
      ui.ovBtn.focus({ preventScroll: true });
    }

    function resumeGame() {
      if (renderingLost) return;
      if (mode !== 'paused') return;
      mode = 'playing';
      viewRoot.visible = true;
      sound.unlock();
      sound.setMode(mode);
      overlay.hidden = true;
      clearInput();
      lastTs = performance.now();
      canvas.focus({ preventScroll: true });
      requestLock();
    }

    function failRun() {
      if (mode !== 'playing') return;
      mode = 'lost';
      sound.setMode(mode);
      events.emit('run.lost', { point: player.pos });
      PBSettings.record(Math.max(0, flow.wave), runTime, kills, false);
      clearInput();
      cancelSupply();
      weapons[currentWeapon].reloading = 0;
      player.slashT = 0;
      player.slashHitDone = false;
      releaseLock();
      hud.classList.add('is-hidden');
      showOverlay('lost');
      ui.ovBtn.focus({ preventScroll: true });
    }

    function winRun() {
      if (mode !== 'playing') return;
      mode = 'won';
      sound.setMode(mode);
      events.emit('run.won', { point: exit.pos });
      flow.setNode('complete');
      PBSettings.record(4, runTime, kills, true);
      clearInput();
      releaseLock();
      hud.classList.add('is-hidden');
      spawnRingFx(player.pos, 7, C.cyan, 0.9, 1.0);
      flashScreen(0x6bffb0, true);
      addToast('断层突破 // 出口接入完成', 'good');
      showOverlay('won');
      ui.ovBtn.focus({ preventScroll: true });
    }

    function fmtTime(sec) {
      var s = Math.max(0, Math.floor(sec));
      var m = Math.floor(s / 60);
      var r = s % 60;
      return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }

    function progressText() {
      if (bossDefeated) return '出口';
      if (flow.bossActive) return '守门者';
      if (flow.wave > 0) return 'WAVE 0' + flow.wave;
      return '安检区';
    }

    function statCell(label, value, cls) {
      return '<div class="stat ' + (cls || '') + '"><span>' + label + '</span><strong>' +
        value + '</strong></div>';
    }

    function showOverlay(kind) {
      overlay.hidden = false;
      overlay.classList.toggle('is-menu', kind === 'menu');
      viewRoot.visible = kind === 'paused';
      byId('menuView').hidden = kind !== 'menu';
      panel.style.animation = 'none';
      void panel.offsetWidth;
      panel.style.animation = '';

      var stats = statCell('用时 / TIME', fmtTime(runTime)) +
        statCell('击杀 / KILLS', String(kills).padStart(2, '0')) +
        statCell('进度 / PROGRESS', progressText(), bossDefeated ? 'is-good' : 'is-accent');

      var records = PBSettings.records();
      byId('audioPreview').hidden = kind !== 'menu' || sound.snapshot().status === 'running';
      ui.ovControls.hidden = kind !== 'menu';
      ui.ovStats.hidden = kind === 'menu';
      ui.ovStats.innerHTML = stats;
      ui.ovBtn.className = 'panel-btn';

      if (kind === 'menu') {
        ui.ovKicker.textContent = 'BREACH PROTOCOL // 断层级指令';
        ui.ovTitle.innerHTML = 'PIXEL<span>//</span>BREACH';
        ui.ovSub.textContent = '断 层 突 围';
        ui.ovDesc.textContent = '落日船坞已失守。穿过集装箱区和装卸平台，击败零号守门者，从七号泊位撤离。';
        ui.ovBtn.innerHTML = '开始突入 <kbd>ENTER</kbd>';
        ui.ovFoot.textContent = records.clears
          ? '最快撤离 ' + fmtTime(records.bestTime) + ' · 最高击杀 ' + records.bestKills
          : '点击开始 · 浏览器会锁定鼠标指针';
      } else if (kind === 'paused') {
        ui.ovKicker.textContent = 'LINK FROZEN // 链路冻结';
        ui.ovTitle.textContent = '任务暂停';
        ui.ovSub.textContent = '链 路 冻 结';
        ui.ovDesc.textContent = '鼠标已释放，模拟暂停。按 Enter 或点击按钮继续突入。';
        ui.ovBtn.innerHTML = '继续突入 <kbd>ENTER</kbd>';
        ui.ovFoot.textContent = 'Esc 释放指针 · 重载画质会重置当前任务';
      } else if (kind === 'won') {
        ui.ovKicker.textContent = 'BREACH COMPLETE // 断层已突破';
        ui.ovTitle.textContent = '撤离成功';
        ui.ovSub.textContent = '断 层 已 突 破';
        ui.ovDesc.textContent = '零号守门者已解体，出口链路恢复。你的信号离开了落日船坞。';
        ui.ovBtn.innerHTML = '再次突入 <kbd>ENTER</kbd>';
        ui.ovBtn.classList.add('is-ready');
        ui.ovFoot.textContent = '最快撤离 ' + fmtTime(records.bestTime) + ' · 最高击杀 ' + records.bestKills;
      } else {
        ui.ovKicker.textContent = 'SIGNAL LOST // 作战失败';
        ui.ovTitle.textContent = '信号中断';
        ui.ovSub.textContent = '信 号 中 断';
        ui.ovDesc.textContent = '生命体征归零，船坞重新封锁。检查武器、跳跃与技能冷却，再试一次。';
        ui.ovBtn.innerHTML = '重新连接 <kbd>ENTER</kbd>';
        ui.ovBtn.classList.add('is-danger');
        ui.ovFoot.textContent = 'Enter 重新突入 // 进度将重置';
      }
    }

    /* ----------------------------------------------------------------- hud */

    function updateHud() {
      if (!ui || !ui.hpText) return;
      updateZoneTag();

      var count = flow.bossActive ? enemies.length : enemies.length + pending.length;
      var alerted = 0;
      var charging = 0;
      for (var unit of enemies) {
        if (unit.ai.alert) alerted++;
        if (unit.ai.charge > 0) charging++;
      }
      alertState.hidden = !count || bossDefeated;
      setText(alertState, charging ? '△ 敌方武器充能' :
        alerted || encounterAlertT > 0 ? '警戒中 · ' + alerted + ' 个目标' : '巡逻中');
      bossWarning.hidden = !flow.bossActive || warningT <= 0;
      setText(ui.enemyCount, '敌人 ' + String(count).padStart(2, '0'));

      if (flow.bossActive || bossEverSpawned) {
        setText(ui.waveLabel, bossDefeated ? '撤离' : '守门者');
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

      if (ui.moveState) {
        var airText;
        if (player.grounded) airText = '地面  /  ' + keyName('jump') + ' 跳跃';
        else if (player.airDashUsed) airText = '空中  /  突进已用';
        else airText = '空中  /  ' + keyName('dash') + ' 突进可用';
        setText(ui.moveState, airText);
        ui.moveState.classList.toggle('is-air', !player.grounded);
        ui.moveState.classList.toggle('is-spent', !player.grounded && player.airDashUsed);
      }

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
      var lowAmmo = !d.melee && w.mag <= Math.ceil(d.magSize * 0.25);
      ui.reloadTag.hidden = w.reloading <= 0 && !lowAmmo;
      if (lowAmmo && w.reloading <= 0) setText(ui.reloadTag, w.mag || w.reserve ? '弹药不足' : '弹药耗尽');
      var spread = Math.round(24 + (d.id === 'scatter' ? 13 : 0) + player.recoil * 12 +
        (held('sprint') || player.dashT > 0 ? 8 : 0));
      if (ui.crosshair.__spread !== spread) {
        ui.crosshair.__spread = spread;
        ui.crosshair.style.setProperty('--crosshair-size', spread + 'px');
      }
      if (w.reloading > 0) {
        setText(ui.reloadTag, 'RELOADING ' +
          Math.round((1 - w.reloading / d.reloadTime) * 100) + '%');
      }

      for (var s = 0; s < ui.slots.length; s++) {
        ui.slots[s].classList.toggle('active', s === currentWeapon);
      }

      var showBoss = bossEverSpawned;
      ui.bossBar.hidden = !showBoss;
      if (showBoss) {
        var bhp = boss ? Math.max(0, boss.hp) : 0;
        ui.bossFill.style.width = ((bhp / 500) * 100).toFixed(1) + '%';
        setText(ui.bossHpText, Math.ceil(bhp) + ' / 500');
        if (boss) {
          setText(ui.bossPhase, 'PHASE ' + boss.phase);
          var state = '核心在线';
          if (boss.invuln > 0) state = '装甲重构';
          else if (boss.shield > 0) state = '护盾开启';
          else if (boss.exposed > 0) state = '核心暴露 · 伤害 ×2';
          setText(ui.bossState, (boss.enraged ? '狂暴  /  ' : '') + state);
          ui.bossBar.classList.toggle('is-shielded', boss.shield > 0);
          ui.bossBar.classList.toggle('is-exposed', boss.exposed > 0);
          ui.bossBar.classList.toggle('is-enraged', !!boss.enraged);
        } else {
          setText(ui.bossPhase, 'CORE OFFLINE');
          setText(ui.bossState, 'SECTOR CLEAR');
          ui.bossBar.classList.remove('is-shielded', 'is-exposed', 'is-enraged');
        }
      }

      var hint = '';
      if (mode === 'playing') {
        if (dist2D(player.pos, exit.pos) < 4.3) {
          hint = exit.unlocked ? '接入出口' : '出口锁定 · 击败守门者';
        } else hint = worldObjects.hint();
      }
      ui.hint.hidden = !hint;
      if (hint) setText(ui.hint, keyName('interact') + '  ·  ' + hint);
    }

    /* ---------------------------------------------------------------- input */

    function clearInput() {
      input.keys = Object.create(null);
      input.fireHeld = false;
      input.fireQueued = false;
    }

    function requestLock() {
      pointerLocked = document.pointerLockElement === canvas;
      if (pointerLocked) return;
      if (lockPending) return;
      if (!canvas.requestPointerLock) {
        useFreeLook();
        return;
      }
      lockPending = true;
      try {
        var request = canvas.requestPointerLock();
        if (request && typeof request.catch === 'function') request.catch(useFreeLook);
      } catch (err) {
        useFreeLook();
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
      if (dist2D(player.pos, exit.pos) >= 4.3) return;
      if (!exit.unlocked) {
        addToast('出口锁定 // 击败零号守门者', 'warn');
        return;
      }
      winRun();
    }

    function onKeyDown(e) {
      if (renderingLost || settingsDialog.hasAttribute('open') || toolsMode.capture) return;
      var code = e.code;

      if (code === 'KeyX') { cinematics.skip(); return; }
      if (code === 'Escape') {
        if (mode === 'playing') {
          e.preventDefault();
          pauseGame();
        }
        return;
      }

      if (code === 'Enter') {
        if (e.target?.tagName === 'BUTTON') return;
        e.preventDefault();
        if (mode === 'menu' || mode === 'won' || mode === 'lost') startRun();
        else if (mode === 'paused') resumeGame();
        return;
      }

      if (mode !== 'playing') return;
      if (code === 'Tab') { e.preventDefault(); return; }

      input.keys[code] = true;
      if (code === bound('jump') || code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;

      if (code === bound('reload')) startReload();
      else if (code === bound('dash')) tryDash();
      else if (code === bound('pulse')) tryPulse();
      else if (code === bound('jump')) tryJump();
      else if (code === bound('interact')) {
        if (!tryStartSupply() && !worldObjects.interact()) interactExit();
      } else if (code === bound('rifle') || code === 'Numpad1' && bound('rifle') === 'Digit1') switchWeapon(0);
      else if (code === bound('scatter') || code === 'Numpad2' && bound('scatter') === 'Digit2') switchWeapon(1);
      else if (code === bound('blade') || code === 'Numpad3' && bound('blade') === 'Digit3') switchWeapon(2);
      else if (code === 'KeyI' && currentGun().reloading <= 0 && player.slashT <= 0 && !input.fireHeld) inspection = 1.6;
    }

    function onKeyUp(e) { delete input.keys[e.code]; }

    function onMouseMove(e) {
      if (mode !== 'playing') return;
      if (!pointerLocked && (!fallbackLook || !(e.target instanceof Node) || !stage.contains(e.target))) return;
      var mx = e.movementX || 0;
      var my = e.movementY || 0;
      if (Math.abs(mx) > 180) mx = 0;
      if (Math.abs(my) > 180) my = 0;
      if (mx || my) aimIdle = 0.22;
      if (Math.abs(mx) + Math.abs(my) > 42) lookStress = 0.35;
      player.yaw -= mx * SENS * settings.sensitivity;
      player.pitch = clamp(player.pitch - my * SENS * settings.sensitivity, -1.35, 1.35);
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      if (mode === 'playing' && (pointerLocked || e.target instanceof Node && stage.contains(e.target))) {
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

    function useFreeLook() {
      lockPending = false;
      if (!fallbackLook && mode === 'playing') {
        addToast('指针锁定失败 · 在画面中移动鼠标以转向', 'warn');
      }
      fallbackLook = true;
    }

    function onPointerLockError() { useFreeLook(); }

    /* --------------------------------------------------------------- menu */

    var currentExposure = Number.isFinite(exposureOverride) ? exposureOverride : 1.08;
    var menuT = 0;
    var menuLook = new THREE.Vector3(0, 2.0, -32);
    var worldClock = 0;

    var captureView = toolsMode.capture ? PBBenchmark.views[toolsMode.capture] : null;
    var menuViews = Object.values(PBBenchmark.views);
    var menuViewIndex = 0;

    function updateMenu(dt) {
      var view = captureView || menuViews[menuViewIndex];
      if (!settings.reducedMotion && !toolsMode.fixed) menuT += dt;
      var sway = captureView ? 0 : Math.sin(menuT * 0.12) * 2.0;
      camera.position.set(view.eye[0] + sway, view.eye[1] + sway * 0.13, view.eye[2]);
      menuLook.set(...view.aim);
      aimCameraAt(menuLook);
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
    }

    // Conservative region bounce: keep the ambient intensity stable and only
    // nudge its hue so the additive pools read as local colour instead of
    // fighting a globally blue fill.  One shared Color instance, no per-frame
    // allocation.
    function updateRegionAmbient(dt) {
      var hex = ambientTint.baseHex;
      var intensity = 1.05;
      var pz = camera.position.z;
      var phase = arenaMood ? arenaMood.phase : 0;
      var nearExit = dist2D(camera.position, exit.pos) < 4.8;

      if (nearExit) {
        hex = exit.unlocked ? 0x466d5c : 0x5c4650;
        intensity = 1.04;
      } else if (pz > 9.5) {
        // Warm gate fill against the blue dusk.
        hex = 0x6a4a56;
        intensity = 1.02;
      } else if (pz > -8.5) {
        // Container yard: cool blue-purple shade between warm pools.
        hex = 0x4a587a;
        intensity = 1.04;
      } else if (pz > -22.5) {
        hex = 0x6a5044;
        intensity = 1.02;
      } else if (pz < -22.5) {
        if (phase === 3) hex = 0x6a3b3b;
        else if (phase === 4) hex = 0x456d5c;
        else hex = 0x4a5a82;
        intensity = 1.03;
      } else {
        hex = 0x486b86;
        intensity = 1.05;
      }

      ambientTint.target.setHex(hex);
      var k = 1 - Math.exp(-Math.max(0, dt) * 1.8);
      ambientLight.color.lerp(ambientTint.target, k);
      ambientLight.intensity += (intensity - ambientLight.intensity) * k;
      var basinMix = clamp((-pz - 16) / 10, 0, 1);
      if (scene.fog) {
        targetFog.copy(dockFog).lerp(phaseFog, basinMix);
        scene.fog.color.lerp(targetFog, k);
        scene.fog.near = lerp(scene.fog.near, lerp(21, arenaMood.near, basinMix), k);
        scene.fog.far = lerp(scene.fog.far, lerp(85, arenaMood.far, basinMix), k);
      }
      var exposure = Number.isFinite(exposureOverride) ? exposureOverride :
        PBMission.zoneAt(pz).exposure - (phase === 3 && pz < -22 ? 0.045 : 0);
      currentExposure = lerp(currentExposure, exposure, k);
      renderer.setExposure(currentExposure);
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

    var renderingLost = false;
    var frameEnabled = !toolsMode.manual;
    var frameHandle = 0;
    var benchmark = PBBenchmark.create(function () { return window.__PB_RENDERING__.snapshot(); });

    function updateFrame(dt) {
      if (!captureView) worldClock += dt;
      if (mode === 'playing') {
        gameTime += dt;
        runTime += dt;
        captionT = Math.max(0, captionT - dt);
        warningT = Math.max(0, warningT - dt);
        encounterAlertT = Math.max(0, encounterAlertT - dt);
        caption.hidden = !settings.subtitles || captionT <= 0;

        updatePending(dt);
        worldObjects.update(dt);
        updatePlayer(dt);
        updateSupply(dt);
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
        updateWrecks(sentinelPool, dt);
        updateWrecks(turretPool, dt);
        updateBossWreck(dt);
        impactMarks.update(dt);
        updateHud();
      } else if (mode === 'menu') {
        updateMenu(dt);
        if (!settings.reducedMotion) worldObjects.preview(worldClock);
        updateRings(dt);
        updateParticles(dt);
      } else if (mode === 'won' || mode === 'lost') {
        cinematics.update(dt, player.yaw, player.pitch, false, camera.fov, false);
        updateRings(dt);
        updateParticles(dt);
        updateBossWreck(dt);
      }
      var activeZone = PBMission.zoneAt(mode === 'menu' ? camera.position.z : player.pos.z).id;
      sectorEffects.update(activeZone);
      sound.update(dt, mode === 'menu' ? camera.position : player.pos, player.yaw, activeZone);
      if (sound.error && reportedAudioError !== sound.error) {
        reportedAudioError = sound.error;
        addToast('声音不可用 · ' + sound.error, 'warn');
      }
      if (mode !== 'paused') {
        updateSparks(dt);
        updateImpactFlashes(dt);
        updateSlashFx(dt);
        updateBulletTrails(dt);
        updateAmbient(dt);
      }
    }

    function renderFrame() {
      var blur = settings.motionBlur && !settings.reducedMotion && mode === 'playing' && player.dashT > 0
        ? Math.min(1, player.dashT / 0.16) : 0;
      renderer.render(scene, camera, worldClock, mode === 'menu' && !captureView, blur);
    }

    function frame(ts) {
      if (renderingLost || !frameEnabled) return;
      frameHandle = requestAnimationFrame(frame);
      var ms = Math.max(0, ts - lastTs);
      lastTs = ts;
      if (document.hidden) return;
      dynamicResolution.update(ms, lookStress > 0 || lasers.length > 0 || missiles.length > 1);
      renderer.renderUnderLoad = dynamicResolution.averageFrameMs > 20;
      // Keep aim and gameplay responsive during a transient slow frame with
      // bounded substeps. The simulation never advances in a background tab.
      var remaining = Math.min(ms / 1000, .10);
      do {
        var dt = Math.min(remaining, 1 / 45);
        updateFrame(dt);
        remaining -= dt;
      } while (remaining > 0.000001 && mode === 'playing');
      renderFrame();
      if (benchmark.active) {
        var aliveParticles = 0;
        for (var particle of particles) if (particle.alive) aliveParticles++;
        benchmark.sample(ms, renderer.stats, renderer.stats.reflectionPasses, aliveParticles, impactMarks.snapshot().active);
      }
    }

    function applySettings(next) {
      settings = next;
      document.body.classList.toggle('reduced-motion', settings.reducedMotion);
      document.body.classList.toggle('accessible-colors', settings.contrast);
      renderer.configureEffects(settings);
      dynamicResolution.configure(next.dynamic && !toolsMode.fixed, toolsMode.scale ?? next.scale);
      sound.configure(next.volumes);
      cinematics.configure(next.reducedMotion);
      if (!next.subtitles) caption.hidden = true;
      for (var label of document.querySelectorAll('[data-binding]')) label.textContent = keyName(label.dataset.binding);
      byId('walkKeys').textContent = ['forward', 'left', 'back', 'right'].map(keyName).join(' ');
      byId('weaponKeys').textContent = ['rifle', 'scatter', 'blade'].map(keyName).join(' ');
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
      sound.mutePage(document.hidden);
      lastTs = performance.now();
      if (document.hidden) {
        clearInput();
        if (mode === 'playing') pauseGame();
      }
    });
    window.addEventListener('contextmenu', function (e) {
      if (e.target === canvas || (stage && stage.contains(e.target))) e.preventDefault();
    });
    stage.addEventListener('click', function () {
      if (mode === 'playing' && !pointerLocked && !fallbackLook && !settingsDialog.open) requestLock();
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
        renderingLost = true;
        cancelAnimationFrame(frameHandle);
        sectorEffects.stop();
        if (settingsDialog.open) settingsDialog.close();
        benchmark.stop('WebGL context lost');
        sound.mutePage(true);
        clearInput();
        if (mode === 'playing') pauseGame();
        releaseLock();
        fatal('WebGL 上下文已丢失。重新加载以恢复渲染。');
        byId('reloadGame').focus({ preventScroll: true });
      });
    }

    /* ---------------------------------------------------------------- boot */

    // Read-only development hook used for smoke checks.  It allocates only when
    // snapshot() is called and never touches the HUD or gameplay state.
    window.__PB_LIGHTING__ = {
      maxLocalLights: renderer.maxLocalLights,
      activeLimit: QUALITY.maxLocalLights,
      get quality() { return renderer.quality; },
      shadowSlots: CONTACT_SHADOW_LIMIT,
      snapshot: function () {
        var out = [];
        for (var i = 0; i < localLights.length; i++) {
          var e = localLights[i];
          out.push({
            key: e.key,
            visible: e.light.visible,
            quality: renderer.quality,
            activeLimit: QUALITY.maxLocalLights,
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

    // Read-only inspection of the active pipeline and allocated resources.
    window.__PB_RENDERING__ = {
      version: 8,
      build: 'V8',
      backend: renderer.backend,
      get quality() { return renderer.quality; },
      snapshot: function () {
        var active = 0;
        for (var i = 0; i < localLights.length; i++) {
          if (localLights[i].light.visible) active++;
        }
        var caps = renderer.capabilities || {};
        var high = renderingLost ? null : renderer._high;
        var hasAtlas = !!(surfaceDetailTexture && surfaceDetailTexture._glTexture);
        var cssW = canvas ? canvas.clientWidth : 0;
        var scaleState = dynamicResolution.snapshot();
        var cssH = canvas ? canvas.clientHeight : 0;
        return {
          version: 8,
          build: 'V8',
          backend: renderer.backend,
          contextType: renderer.backend,
          webgl2: renderer.isWebGL2,
          requestedQuality: QUALITY.requested,
          quality: renderer.quality,
          selectedProfile: QUALITY.name,
          degraded: QUALITY.degraded,
          profileReason: QUALITY.reason,
          shaderVariant: renderer.profile.shaderVariant || 'full',
          reducedShader: (renderer.profile.shaderVariant || 'full') === 'compat',
          uniformBudget: renderer.uniformBudget || 0,
          detailScale: renderer._detailScale,
          internalResolution: { width: RES_W, height: RES_H },
          baseResolution: { width: QUALITY.baseWidth, height: QUALITY.baseHeight },
          renderScale: dynamicResolution.scale,
          renderScaleRange: { min: dynamicResolution.min, max: dynamicResolution.max },
          dynamicResolution: { ...scaleState, enabled: !renderingLost && scaleState.enabled },
          backbuffer: {
            width: canvas ? canvas.width : 0,
            height: canvas ? canvas.height : 0
          },
          displayCssResolution: { width: cssW, height: cssH },
          aspect: '16:9',
          contextLost: renderingLost,
          cssScaling: 'smooth bilinear (image-rendering: auto)',
          pixelated: false,
          antialias: high ? (high.msaa ? '4× world MSAA' : 'No world MSAA') +
            (renderer.profile.fxaa ? ' + FXAA' : '') : (renderer.gl.getContextAttributes()?.antialias ? 'MSAA' : 'none'),
          maxLocalLights: renderer.maxLocalLights,
          maxRenderResolution: {
            width: renderer.maxRenderWidth || 0,
            height: renderer.maxRenderHeight || 0
          },
          activeLocalLimit: QUALITY.maxLocalLights,
          activeLocalLights: active,
          localLightCandidates: localLights.length,
          capability: {
            webglVersion: caps.webglVersion || '',
            glslVersion: caps.glslVersion || '',
            maxTextureSize: caps.maxTextureSize || 0,
            maxRenderbufferSize: caps.maxRenderbufferSize || 0,
            maxFragmentUniformVectors: caps.maxFragmentUniformVectors || 0,
            maxSamples: caps.maxSamples || 0,
            anisotropy: caps.anisotropy || 0,
            vendor: caps.vendor || '',
            renderer: caps.renderer || ''
          },
          features: {
            proceduralAtlas: !!(surfaceLayers || hasAtlas),
            // The atlas packs generated colour, normal, roughness and AO detail;
            // it is a real sampled surface path, but not an imported texture set.
            proceduralPbrDetail: !!(surfaceLayers || hasAtlas),
            bakedPixelDetail: false,
            pbr: !!high,
            pbrModel: high ? 'GGX metallic-roughness + Smith-Schlick visibility + Schlick Fresnel' :
              'Lambert diffuse + smooth Blinn-Phong highlight',
            pbrLite: !renderer.profile || renderer.profile.pbrLite !== false,
            steppedSpecular: false,
            worldSpaceDetailGrain: !high && renderer.profile.pbrLite,
            directionalSunShadows: !!high,
            dynamicContactShadows: true,
            bakedGlowStreaks: true,
            geometryVolumetricBeams: true,
            // Beams are layered geometry with soft additive edges, not a
            // screen-space volumetric scattering pass.
            volumetricBeamApproximation: true,
            textureSampling: !!surfaceLayers || hasAtlas,
            textureSampler: surfaceLayers ? 'two ' + surfaceLayers.size + 'px texture arrays with eight surface layers each' :
              (hasAtlas ? 'shared ' + surfaceAtlasCanvas.width + '×' + surfaceAtlasCanvas.height + ' Canvas2D atlas' : 'disabled'),
            textureProjection: high ? 'dominant-axis world projection and object-space viewmodels' :
              (hasAtlas ? 'triplanar world projection and object-space unlit viewmodels' : 'disabled'),
            textureFiltering: high ? 'linear, mipmapped' + (caps.anisotropy ? ', anisotropic ' + Math.min(8, caps.anisotropy) + '×' : '') :
              (hasAtlas ? 'linear with distance fade' : 'disabled'),
            unlitObjectSpaceSampling: hasAtlas,
            normalMapping: !!(high && high.surfaceReady),
            roughnessAndAOMaps: !!(high && high.surfaceReady),
            surfaceFallbackReason: high && !high.surfaceReady ? 'surface texture upload failed' : '',
            realShadowMap: !!high,
            postProcessBloom: !!high && renderer.profile.postProcessBloom,
            fxaa: !!high && renderer.profile.fxaa,
            dynamicResolution: !renderingLost && dynamicResolution.enabled && !dynamicResolution.failed,
            roughness: !!high || (!renderingLost && renderer.profile.pbrLite),
            wetnessMask: !!high,
            waterRipples: !!high,
            dashBlur: !!high && settings.post && settings.motionBlur && !settings.reducedMotion,
            tonemapping: high ? 'ACES fitted + sRGB transfer' : 'forward highlight compression',
            exposure: high ? high.exposure : 1,
            hdr: !!(high && high.hdr),
            proceduralSky: !!high,
            // The renderer has explicit planar targets for the valid passes;
            // the remaining sky/wet-surface colour is a bounded approximation.
            skyReflections: false,
            skyReflectionApproximation: !!high || (!renderingLost && renderer.profile.shaderVariant === 'full'),
            reflectionMode: high ? renderer.reflectionMode : 'approximation',
            viewmodelDepth: !!high,
            ssao: !!(high && high.contact && high.postEnabled),
            menuDepthOfField: !!(high && high.menuDefocus),
            ssr: false,
            reflectionFallbackReason: high ? high.reflections.filter(pass => !pass.target).map(pass =>
              (pass.height < 0 ? 'sea' : pass.height > 0.55 ? 'raised deck' : 'deck') + ' target unavailable').join('; ') : '',
            seaReflection: !!(high && high.reflections[0]?.valid),
            deckReflection: !!(high && high.reflections[1]?.valid),
            elevatedDeckReflection: !!(high && high.reflections[2]?.valid),
            zonedShadows: !!(high && high.nearStatic && high.nearCombined),
            softVolumeEdges: !!(high || renderer.profile.shaderVariant === 'full'),
            globalIllumination: false,
            rayTracing: false,
            // No participating-media integration exists in the local renderer;
            // contact/AO and beam geometry must not be reported as scattering.
            volumetricScattering: false,
            volumetricScatteringApproximation: true
          },
          resources: {
            batches: batchList.length,
            staticArtVerts: artVerts,
            v5DetailVerts: v5DetailVerts,
            atlasTextures: Object.keys(TEX).filter(function (key) { return !!TEX[key]; }).length,
            surfaceDetailAtlas: hasAtlas,
            surfaceAtlasTiles: hasAtlas ? 8 : 0,
            surfaceAtlasBytes: surfaceAtlasCanvas ? surfaceAtlasCanvas.width * surfaceAtlasCanvas.height * 4 : 0,
            surfaceArrayLayers: surfaceLayers ? surfaceLayers.count : 0,
            surfaceArrayBytes: surfaceLayers ? surfaceLayers.bytes : 0,
            shadowMapSize: high ? high.shadowSize : 0,
            movingShadowCasters: high ? high.movingCasters.length : 0,
            lastShadowDraws: high ? high.shadowDraws : 0,
            reflectionDraws: high ? high.reflectionDraws : 0,
            drawCalls: renderer.stats.drawCalls,
            triangles: renderer.stats.triangles,
            renderedInstances: renderer.stats.instances,
            visibleTriangles: renderer.stats.visibleTriangles,
            lodDetailCulled: renderer.stats.detailCulled,
            actorLodFar: enemies.filter(enemy => enemy.ai.far).length,
            reflectionUpdates: high ? high.totalReflectionUpdates : 0,
            reflectionPasses: renderer.stats.reflectionPasses,
            postPasses: renderer.stats.postPasses,
            gpuCache: renderer.resourceCounts(),
            sectors: sectorEffects.snapshot(),
            textureBytesWithMips: surfaceLayers ? Math.round(surfaceLayers.bytes * 4 / 3) : 0,
            bloomResolution: high ? { width: high.bloomWidth, height: high.bloomHeight } : null,
            sceneColorFormat: high ? (high.hdr ? 'RGBA16F' : 'RGBA8') : 'default framebuffer',
            renderTargets: high ? high.targets.length + (high.msaa ? 1 : 0) : 0,
            worldMsaaSamples: high && high.msaa ? 4 : 0,
            ldrTarget: !!(high && high.ldr),
            fxaaPass: !!high && renderer.profile.fxaa,
            exposure: high ? high.exposure : 1,
            materialClasses: Object.keys(MATERIAL_LIBRARY),
            sentinelPool: SENTINEL_POOL_SIZE,
            turretPool: TURRET_POOL_SIZE,
            bossPool: bossPool ? 1 : 0,
            contactShadowSlots: CONTACT_SHADOW_LIMIT,
            activeContactShadowLimit: Math.min(QUALITY.contactShadows, CONTACT_SHADOW_LIMIT)
          },
          qualityProfiles: PBQuality.profiles,
          assets: assets ? assets.snapshot() : { unavailable: true }

        };
      }
    };

    // Read-only development snapshot for the V3 cinematic FX layer.  It never
    // exposes a gameplay toggle and only allocates when a reviewer calls it.
    window.__PB_CINEMATIC_FX__ = {
      version: 8,
      caps: {
        bulletVisuals: MAX.bullets,
        bulletTrails: BULLET_TRAIL_LIMIT,
        tracers: MAX.tracers,
        hitSparks: SPARK_LIMIT,
        get impactFlashes() { return impactFlashes.length; },
        get impactMarks() { return impactMarks.snapshot().limit; },
        rings: MAX.rings,
        telegraphs: MAX.telegraphs,
        lasers: MAX.lasers,
        shockwaves: MAX.shockwaves,
        volumetricBeams: VOLUME_BEAM_LIMIT,
        reflectionStrips: REFLECTION_STRIP_LIMIT,
        slashArcs: SLASH_FX_LIMIT,
        particles: MAX.particles,
        sentinels: SENTINEL_POOL_SIZE,
        turrets: TURRET_POOL_SIZE,
        get bosses() { return bossPool ? 1 : 0; },
        localLights: renderer.maxLocalLights,
        shadowSlots: CONTACT_SHADOW_LIMIT
      },
      snapshot: function () {
        var activeSentinels = 0;
        var activeTurrets = 0;
        var activeSparks = 0;
        var activeTrails = 0;
        var activeVolumes = 0;
        var activeStrips = 0;
        var activeTracers = 0;
        var activeRings = 0;
        var activeSlashes = 0;
        var i;
        for (i = 0; i < sentinelPool.length; i++) if (sentinelPool[i].active) activeSentinels++;
        for (i = 0; i < turretPool.length; i++) if (turretPool[i].active) activeTurrets++;
        for (i = 0; i < sparkFxPool.length; i++) if (sparkFxPool[i].alive) activeSparks++;
        for (i = 0; i < bulletTrailPool.length; i++) if (bulletTrailPool[i].owner) activeTrails++;
        for (i = 0; i < tracerFxPool.length; i++) if (tracerFxPool[i].alive) activeTracers++;
        for (i = 0; i < ringFxPool.length; i++) if (ringFxPool[i].alive) activeRings++;
        for (i = 0; i < slashFxPool.length; i++) if (slashFxPool[i].alive) activeSlashes++;
        for (i = 0; i < volumetricBeams.length; i++) if (volumetricBeams[i].group.visible) activeVolumes++;
        for (i = 0; i < reflectionStrips.length; i++) if (reflectionStrips[i].mesh.visible) activeStrips++;
        return {
          mode: mode,
          bullets: bullets.length,
          tracers: activeTracers,
          sparks: activeSparks,
          impactMarks: impactMarks.snapshot().active,
          particles: particles.filter(particle => particle.alive).length,
          bossWreck: !!bossWreck,
          bulletTrails: activeTrails,
          rings: activeRings,
          slashArcs: activeSlashes,
          standables: standables.length,
          sentinels: activeSentinels,
          turrets: activeTurrets,
          bossActive: !!(boss && boss.alive),
          supplyCooldowns: supplyStations.map(function (s) {
            return Math.round(s.cooldown * 10) / 10;
          }),
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

    function missionSnapshot() {
      return {
        mode, node: flow.node, wave: flow.wave, zone: PBMission.zoneAt(player.pos.z).id,
        player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch,
          hp: player.hp, grounded: player.grounded, dash: player.dashCd, pulse: player.pulseCd,
          airDashUsed: player.airDashUsed, slash: player.slashT, inspection, fov: camera.fov },
        input: { pointerLocked, fallbackLook },
        weapon: currentWeapon, weapons: weapons.map(gun => ({ mag: gun.mag, reserve: gun.reserve, reload: gun.reloading })),
        enemies: enemies.map(enemy => ({ type: enemy.type, hp: enemy.hp, x: enemy.pos.x, y: enemy.pos.y,
          z: enemy.pos.z, state: enemy.ai.state, far: enemy.ai.far })),
        pending: pending.length, time: runTime, kills,
        boss: boss && { hp: boss.hp, phase: boss.phase, enraged: boss.enraged, shield: boss.shield, exposed: boss.exposed,
          x: boss.pos.x, y: boss.pos.y, z: boss.pos.z, attack: boss.action?.type, armorOpen: boss.plateOpen },
        exit: exit.unlocked,
        supply: { active: supply.active, progress: supply.progress, stations: supplyStations.map(
          station => ({ id: station.id, x: station.x, z: station.z, cooldown: station.cooldown })) },
        world: worldObjects.snapshot(), cinematic: cinematics.snapshot(), settings: PBSettings.normalize(settings),
        audio: sound.snapshot(), assets: assets ? assets.snapshot() : { unavailable: true }, records: PBSettings.records()
      };
    }

    function setupTools() {
      window.__PB_MISSION__ = { snapshot: missionSnapshot };
      if (toolsMode.benchmark) window.__PB_BENCHMARK__ = { sample: benchmark.begin };
      if (toolsMode.manual) {
        window.__PB_QA__ = Object.freeze({
          step(ticks = 1, draw = false) {
            if (renderingLost) return missionSnapshot();
            for (var i = 0; i < Math.max(1, Math.min(1200, ticks)); i++) updateFrame(1 / 60);
            if (draw) renderFrame();
            return missionSnapshot();
          },
          draw() { if (!renderingLost) renderFrame(); },
          live(enabled) {
            if (renderingLost || frameEnabled === Boolean(enabled)) return;
            frameEnabled = Boolean(enabled);
            cancelAnimationFrame(frameHandle);
            if (frameEnabled) {
              lastTs = performance.now();
              frameHandle = requestAnimationFrame(frame);
            }
          },
          place(x, z, elevation = 0) {
            player.pos.set(x, EYE + elevation, z);
            player.velocityY = 0;
            player.grounded = true;
          },
          aim(x, y, z) {
            var dx = x - player.pos.x, dz = z - player.pos.z;
            player.yaw = Math.atan2(-dx, -dz);
            player.pitch = Math.atan2(y - player.pos.y, Math.hypot(dx, dz));
          },
          damagePlayer,
          damageEnemy(index, amount) {
            if (enemies[index]) damageEnemy(enemies[index], amount, C.cyan, enemies[index].pos);
          },
          damageBoss(amount) { if (boss) damageBoss(amount, C.cyan, boss.pos); }
        });
      }
    }

    buildArena();
    buildMuzzleSmoke();
    buildImpactFlashPool();
    buildScorch();
    worldObjects = PBInteractions.create({
      THREE, scene, geometries: G, materials: IM, player, events, collider: addCollider,
      particles: spawnParticles, blast: spawnImpactFx, notify: function (notice) { addToast(notice, 'good'); }
    });
    impactMarks = PBCombatVisuals.createMarks({
      THREE, scene, plane: G.plane, makeMaterial: matBasic, ripple: renderer.addWaterRipple.bind(renderer),
      limit: QUALITY.extraDetail ? 40 : 24
    });
    bindMissionEvents();
    PBSettings.attach(settings, applySettings, function () {
      var url = new URL(window.location.href);
      url.searchParams.delete('quality');
      window.location.replace(url);
    });
    applySettings(settings);
    byId('menuView').addEventListener('click', function () {
      menuViewIndex = (menuViewIndex + 1) % menuViews.length;
      menuT = 0;
      updateMenu(0);
      setText(byId('menuLocation'), PBMission.zoneAt(camera.position.z).label);
    });
    byId('audioPreview').addEventListener('click', function () {
      sound.unlock();
      var status = sound.snapshot();
      byId('audioPreview').hidden = !status.error;
      if (status.error) setText(ui.ovFoot, '声音无法启用 · ' + status.error);
    });
    renderer.prepare(scene);
    resetRunState();
    hud.classList.add('is-hidden');
    showOverlay('menu');
    updateMenu(0);
    updateAmbient(0);
    sectorEffects.update(PBMission.zoneAt(camera.position.z).id);
    byId('loadingStatus').hidden = true;
    ui.ovBtn.disabled = false;
    if (shouldWarn) setText(ui.ovFoot, '材质纹理上传失败。当前使用基础材质。');
    setupTools();
    if (toolsMode.capture) document.body.classList.add('capture-mode');
    lastTs = performance.now();
    if (toolsMode.manual) renderFrame();
    else frameHandle = requestAnimationFrame(frame);
  }
})();
