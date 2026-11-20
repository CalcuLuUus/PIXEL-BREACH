(function (root) {
  'use strict';

  const route = [
    { id: 'entrance', z: 13, board: [-6.45, 1.50, 10.55], title: 'CUSTOMS / 07', lines: ['SHIFT 18:40', 'RELEASE ON SCAN'] },
    { id: 'containers', z: 1, board: [11.31, 2.25, 3.04], title: 'INSPECTION WALK', lines: ['A / IMPORTS', 'EAST / SERVICE'] },
    { id: 'loading', z: -16, board: [17.95, 1.74, -18.55], title: 'REPAIR 04', lines: ['HOIST OFFLINE', 'CREW TO BERTH 07'] },
    { id: 'boss', z: -33, board: [-10.55, 1.44, -29.0], title: 'DRY DOCK', lines: ['PRESSURE FAULT', 'DO NOT ENERGIZE'] },
    { id: 'extraction', z: -44, board: [4.1, 1.65, -45.0], title: 'BERTH 07', lines: ['EMERGENCY LANE', 'KEEP CLEAR'] }
  ];

  function layout({ batch, standable, collider, floor, sign, pipe }) {
    const steel = batch('steelDark');
    const paint = batch('hazard');
    const deck = batch('concreteDark');
    const trim = batch('steel2');

    // Two access stairs allow scouts to cross the stack at eye level or stay
    // in the main vehicle lane. Only the actual treads are walkable.
    const x = 10.38;
    const center = 0.1;
    const top = 1.32;
    deck.box(x, top - 0.14, center, 2.05, 0.28, 5.9, 0);
    collider(x, center, 2.05, 5.9, 0, top, 'paintedSteel');
    standable(x, center, 2.05, 5.9, top, 'OBSERVATION CATWALK');
    for (const side of [-1, 1]) {
      for (let step = 1; step <= 4; step++) {
        const h = step * 0.33;
        const z = center + side * (2.95 + (4.5 - step) * 0.47);
        deck.box(x, h / 2, z, 2.05, h, 0.47, 0);
        trim.box(x, h + 0.009, z, 2.05, 0.022, 0.47, 0);
        paint.box(x, h + 0.024, z + side * 0.18, 1.97, 0.014, 0.073, 0);
        collider(x, z, 2.05, 0.47, 0, h, 'paintedSteel');
        standable(x, z, 2.05, 0.47, h, 'OBSERVATION STAIR');
      }
    }
    for (const z of [-2.70, -1.30, 0.10, 1.50, 2.90]) {
      steel.box(x + 0.97, 1.80, z, 0.07, 0.96, 0.078, 0);
      steel.box(x - 0.87, 0.55, z, 0.15, 1.10, 0.15, 0);
    }
    trim.box(x + 0.97, 2.22, center, 0.10, 0.065, 5.86, 0);
    trim.box(x + 0.97, 1.76, center, 0.065, 0.065, 5.86, 0);
    collider(x + 0.97, center, 0.10, 5.9, top, 2.3, 'steel');
    floor('hazard', 8.9, 3.42, 'LOOKOUT', 0.095);
    floor('white', 10.1, -5.84, 'SERVICE / 04', 0.11);

    for (const sector of route) {
      const [bx, by, bz] = sector.board;
      steel.box(bx, by / 2, bz - 0.04, 0.092, by, 0.09);
      steel.box(bx, by, bz - 0.042, 1.59, .79, .07);
    }

    // Overhead inspection lane and clearance lanes use the same structural
    // kit as the loading bay. Their paint directs players in both directions.
    for (const side of [-1, 1]) {
      const gateX = side * 2.70;
      steel.box(gateX, 1.61, 9.70, .17, 3.22, .21, 0);
      paint.box(gateX, .65, 9.87, .18, .59, .12, 0);
      collider(gateX, 9.70, .20, .26, 0, 3.22, 'paintedSteel');
    }
    steel.box(0, 3.19, 9.70, 5.55, .15, .24, 0);
    sign(0, 2.95, 9.83, 2.52, .4, 'SECURITY / 07');
    floor('hazard', 0, 10.9, 'STOP / SCAN', 0.112);

    // An abandoned hose repair station and an emergency bulkhead corridor.
    steel.box(17.85, 1.05, -18.83, 1.9, .13, .62, 0);
    for (const a of [17.07, 18.68]) steel.box(a, .84, -18.83, .085, .43, .50, 0);
    trim.box(17.45, 1.15, -18.83, .27, .08, .20, .25);
    paint.box(18.35, 1.19, -18.83, .38, .19, .29, 0.15);
    pipe(17.15, .72, -18.60, 17.20, .69, -17.72, .038);
    pipe(17.20, .69, -17.72, 17.65, .65, -17.13, .038);
    sign(5.5, 1.50, -16.45, 1.04, .33, 'HOIST');
    floor('white', 4.0, -21.28, 'DRY DOCK', 0.14);
    floor('hazard', -5.7, -41.54, 'BERTH 07', 0.13);
  }

  function backgroundPier(batch, repeat) {
    const pier = batch('quay');
    const rail = batch('steel2');
    pier.box(37.5, -.46, -37.5, 13, .82, 39, 0);
    rail.box(32.0, .03, -37.5, .11, .08, 39, 0);
    rail.box(34.2, .03, -37.5, .11, .08, 39, 0);
    const boxes = { containerBlue: [], containerOrange: [], containerGreen: [] };
    const legs = [], poles = [], railings = [], lights = [];
    const finishes = Object.keys(boxes);
    for (let index = 0; index < 7; index++) {
      const z = -55 + index * 5.5;
      for (let column = 0; column < 2; column++) {
        const x = 37.0 + column * 4.7;
        boxes[finishes[(index + column * 2) % finishes.length]].push(x, 1.14, z);
        if (index % 3 !== column) boxes[finishes[(index + column + 1) % finishes.length]].push(x, 3.44, z);
      }
      legs.push(31.35, .55, z);
      railings.push(31.35, 1.02, z + 2.75);
      if (index % 2 === 0) {
        poles.push(43.4, 3.30, z);
        lights.push(43.26, 6.54, z);
      }
    }
    for (const [finish, offsets] of Object.entries(boxes)) repeat(finish, offsets, 4.15, 2.26, 4.85);
    repeat('steelDark', legs, .14, 1.10, .14);
    repeat('steel2', railings, .10, .085, 5.48);
    repeat('steelDark', poles, .22, 6.60, .22);
    repeat('lampWarm', lights, .54, .12, .25);
  }

  function create(THREE, renderer, scene, materials, plane, assets) {
    const active = new Map();
    const errors = new Map();
    let selected = '';
    let wanted = [];
    let queued = 0;
    let uploads = 0;
    let releases = 0;
    let updateId = null;
    let stopped = false;
    const defer = root.requestIdleCallback
      ? work => root.requestIdleCallback(work, { timeout: 200 })
      : work => setTimeout(work, 0);

    function kit(sector) {
      const group = new THREE.Group();
      group.position.set(...sector.board);
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法生成区域标识纹理');
      ctx.fillStyle = '#292e2c';
      ctx.fillRect(4, 4, 248, 120);
      ctx.strokeStyle = '#d1b377';
      ctx.lineWidth = 3;
      ctx.strokeRect(8, 8, 240, 112);
      ctx.fillStyle = '#f2d39a';
      ctx.font = 'bold 23px monospace';
      ctx.fillText(sector.title, 16, 39);
      ctx.font = '17px monospace';
      ctx.fillStyle = '#dcd6bd';
      sector.lines.forEach((line, i) => ctx.fillText(line, 16, 68 + 23 * i));
      const texture = new THREE.Texture(canvas, { flipY: true });
      texture.mipmaps = true;
      const mat = materials.white.clone();
      mat.decal = texture;
      mat.decalColor = true;
      mat.transparent = true;
      mat.depthWrite = false;
      const mesh = new THREE.Mesh(plane, mat);
      mesh.scale.set(1.55, .77, 1);
      mesh.detailDistance = 21;
      mesh.reflectionSkip = true;
      group.add(mesh);
      renderer.prepare(group);
      if (!texture._glTexture) throw new Error('区域标识纹理上传失败');
      scene.add(group);
      if (assets) assets.register('sector-signage', sector.id, { group, texture },
        { type: 'streamed-signage', zone: sector.id, local: true });
      uploads++;
      return { group, texture, assetId: sector.id };
    }

    function reconcile() {
      updateId = null;
      queued = 0;
      if (stopped) return;
      for (const [id, kit] of active) {
        if (wanted.includes(id)) continue;
        scene.remove(kit.group);
        renderer.releaseTexture(kit.texture);
        if (assets) assets.release('sector-signage', kit.assetId);
        active.delete(id);
        releases++;
      }
      for (const id of wanted) {
        if (active.has(id) || errors.has(id)) continue;
        try {
          active.set(id, kit(route.find(sector => sector.id === id)));
        } catch (error) {
          errors.set(id, error.message);
        }
        break;
      }
      if (wanted.some(id => !active.has(id) && !errors.has(id))) schedule();
    }

    function schedule() {
      if (stopped || updateId !== null) return;
      queued = 1;
      updateId = defer(reconcile);
    }

    function update(id) {
      if (selected === id) return;
      selected = id;
      const index = route.findIndex(sector => sector.id === id);
      wanted = route.slice(Math.max(0, index - 1), index + 2).map(sector => sector.id);
      schedule();
    }

    return {
      update,
      stop() { stopped = true; queued = 0; },
      snapshot() {
        return { current: selected, resident: [...active.keys()], pending: queued, uploads, releases, limit: 3, failures: Object.fromEntries(errors) };
      }
    };
  }

  root.PBSectors = { create, layout, backgroundPier };
})(window);
