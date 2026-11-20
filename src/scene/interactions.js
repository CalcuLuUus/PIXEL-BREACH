(function (root) {
  'use strict';

  function create({ THREE, scene, geometries, materials, player, events, collider, particles, blast, notify }) {
    function part(parent, material, x, y, z, w, h, d, shadow = false) {
      const mesh = new THREE.Mesh(geometries.box, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      mesh.castShadow = shadow;
      parent.add(mesh);
      return mesh;
    }
    function groupAt(x, y, z) {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      scene.add(group);
      return group;
    }
    function nearby(x, z, range) { return Math.hypot(player.pos.x - x, player.pos.z - z) < range; }

    const gate = groupAt(0, 0, 9.7);
    const signal = part(scene, materials.lampRed.clone(), 0, 3.31, 9.86, .42, .13, .19);
    part(gate, materials.steelDark, 0, .83, 0, 5.12, .19, .15, true);
    for (const side of [-1, 1]) part(gate, materials.steel2, side * 2.46, .53, 0, .14, .58, .12);
    for (let i = -7; i <= 7; i++) part(gate, i % 2 ? materials.black : materials.hazard, i * .32, .84, .086, .31, .12, .035);
    const gateBox = collider(0, 9.7, 5.12, .15, .66, 1.03, 'paintedSteel');

    const cart = groupAt(13.4, 4.73, -16.65);
    part(cart, materials.steelDark, 0, 0, 0, .87, .26, .92, true);
    part(cart, materials.hazard, 0, -.19, 0, .67, .18, .69);
    part(cart, materials.cable, 0, -.54, 0, .04, .66, .04);
    part(cart, materials.steel2, 0, -.91, .04, .18, .19, .13);
    part(cart, materials.lampWarm, .23, -.2, .38, .11, .095, .025);

    const workLamp = groupAt(-5.10, 0, -15.55);
    part(workLamp, materials.steel2, 0, .65, 0, .09, 1.30, .09);
    part(workLamp, materials.steelDark, 0, .045, 0, .55, .09, .48);
    const shade = part(workLamp, materials.casting, 0, 1.31, 0, .35, .25, .27);
    const pane = part(workLamp, materials.lampWarm, 0, 1.30, .137, .29, .16, .02);
    const lightBox = collider(-5.10, -15.55, .35, .275, 1.19, 1.44, 'glass');

    const crate = groupAt(-2.50, 0, -14.35);
    part(crate, materials.rustLight, 0, .27, 0, .85, .54, .68, true);
    for (const x of [-.30, .30]) {
      part(crate, materials.steel2, x, .27, .348, .065, .50, .045);
      part(crate, materials.steel2, x, .547, 0, .065, .024, .69);
    }
    const crateBox = collider(-2.50, -14.35, .85, .68, 0, .54, 'wood');
    const breakables = [
      { box: lightBox, max: 16, mesh: pane, tone: 0xffbf74, surface: 'glass', light: true },
      { box: crateBox, max: 30, mesh: crate, tone: 0xbf8751, surface: 'wood', light: false }
    ];
    for (const item of breakables) item.box.prop = item;

    let open = false;
    let travel = 0;
    let cartGoal = false;
    let lightOut = false;

    function authorize() {
      if (open) return;
      open = true;
      signal.material.color.setHex(0x8ff4ca);
      events.emit('world.gate', { point: gate.position });
    }

    function hint() {
      if (!open && nearby(0, 10.55, 3.0)) return '确认安检放行';
      if (nearby(5.5, -16.3, 2.05)) return '移动维修吊具';
      return '';
    }

    function interact() {
      if (!open && nearby(0, 10.55, 3.0)) { authorize(); return true; }
      if (nearby(5.5, -16.3, 2.05)) {
        cartGoal = !cartGoal;
        events.emit('world.gate', { point: cart.position });
        notify(cartGoal ? '维修吊具 · 向东移位' : '维修吊具 · 返回检修位');
        return true;
      }
      return false;
    }

    function update(dt) {
      if (!open && (player.pos.z < 11.25 || nearby(0, 10.7, 2))) authorize();
      const target = open ? 1 : 0;
      travel = Math.min(target, travel + dt * 2.2);
      gate.position.y = travel * travel * (3 - 2 * travel) * 2.33;
      gateBox.y0 = .66 + gate.position.y;
      gateBox.y1 = 1.03 + gate.position.y;
      gateBox.disabled = travel >= .99;
      cart.position.x += ((cartGoal ? 18.0 : 13.40) - cart.position.x) * (1 - Math.exp(-dt * 0.72));
      workLamp.rotation.z = lightOut ? .08 : 0;
    }

    function damage(item, amount, point) {
      if (item.hp <= 0) return;
      item.hp -= amount;
      if (item.hp > 0) return;
      item.box.disabled = true;
      item.mesh.visible = false;
      if (item.light) {
        lightOut = true;
        shade.material = materials.black;
      }
      particles(point, item.tone, item.light ? 10 : 16, 4.3, .38, .067, 'fragment');
      blast(point, item.tone, item.light ? .55 : .8);
      events.emit('world.break', { surface: item.surface, point });
    }

    function reset() {
      open = false;
      travel = 0;
      lightOut = false;
      gate.position.y = 0;
      gateBox.y0 = .66;
      gateBox.y1 = 1.03;
      gateBox.disabled = false;
      cartGoal = false;
      cart.position.x = 13.40;
      signal.material.color.setHex(0xff5a47);
      shade.material = materials.casting;
      for (const item of breakables) {
        item.hp = item.max;
        item.box.disabled = false;
        item.mesh.visible = true;
      }
    }

    return {
      update, interact, hint, reset, damage,
      preview(time) { cart.position.x = 13.8 + Math.sin(time * .24) * .7; },
      snapshot() { return { gateOpen: open, gateHeight: gate.position.y, hoistX: cart.position.x, intact: breakables.filter(item => item.hp > 0).length }; }
    };
  }

  root.PBInteractions = { create };
})(window);
