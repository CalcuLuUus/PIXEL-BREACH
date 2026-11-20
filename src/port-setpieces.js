(function (root) {
  'use strict';

  function build({ batch, sign, shape, floor, high }) {
    const steel = 'steelDark';
    const iron = 'casting';
    const coat = 'craneIvory';
    const exterior = high ? coat : 'steel2';
    const safety = high ? 'cranePaint' : 'hazard';

    function box(key, x, y, z, sx, sy, sz, yaw = 0) {
      batch(key)?.box(x, y, z, sx, sy, sz, yaw);
    }

    function pipe(key, a, b, radius) {
      batch(key)?.pipe(...a, ...b, radius, high ? 10 : 6);
    }

    function beam(key, a, b, thickness) {
      pipe(key, a, b, thickness);
    }

    // Customs building behind the spawn and a glazed, suspended inspection office.
    function entrance() {
      for (const x of [-17.0, -10.2, -3.4, 3.4, 10.2, 17.0]) {
        box(exterior, x, 4.4, 19.78, 4.8, 2.42, 0.13);
        box(steel, x, 4.55, 19.68, 4.46, 1.43, 0.11);
        for (let bay = -2; bay <= 2; bay++) {
          box(high ? 'cabGlass' : 'steel2', x + bay * 0.88, 4.55, 19.60, 0.80, 1.22, 0.04);
        }
        box(steel, x, 5.48, 19.54, 5.1, 0.14, 0.46);
        box(iron, x, 3.66, 19.54, 5.1, 0.09, 0.37);
      }
      for (const side of [-1, 1]) {
        const x = side * 7.8;
        shape('turret', exterior, x, 5.58, 8.1, 5.8, 2.6, 4.9);
        box(steel, x, 5.8, 10.34, 5.28, 1.36, 0.21);
        for (let i = -2; i <= 2; i++) box(high ? 'cabGlass' : 'steel2', x + i, 5.81, 10.47, 0.9, 1.11, 0.06);
        box(exterior, x, 6.93, 8.2, 6, 0.19, 5.04);
        beam(steel, [side * 9.4, 3.2, 9.7], [side * 5.3, 4.47, 8.5], 0.12);
      }
      floor('white', -4.8, 12.8, 'CHECK IN', 0.14);
    }

    // Straddle crane with an elevated box that visually closes the sightline.
    function freight() {
      const z = -4.4;
      for (const side of [-1, 1]) {
        const x = side * 24;
        box(safety, x, 5.3, z, 1.11, 10.6, 1.04);
        box(steel, x, 1.1, z, 1.64, 2.2, 2.4);
        beam(safety, [x, 6.5, z], [side * 19.1, 10.52, z], 0.22);
        for (let i = 0; i < 5; i++) box(steel, x - side * 0.58, 2.2 + 1.27 * i, z, 0.33, 0.11, 1.19);
      }
      box(safety, 0, 10.62, z, 48, 0.66, 1.46);
      box(steel, 0, 11.43, z, 48, 0.31, 1.21);
      for (let i = -11; i < 12; i++) {
        beam(steel, [i * 2, 10.67, z + .40], [(i + 1) * 2, 11.46, z + .40], 0.095);
      }
      const x = -12.8;
      box(steel, x, 10.1, z, 3.2, 0.40, 2.9);
      for (const sign of [-1, 1]) pipe('cable', [x + sign * 2.13, 9.99, z], [x + sign * 2.32, 6.64, z], 0.037);
      box('containerOrange', x, 5.56, z, 5.4, 1.88, 2.34);
      box(steel, x, 6.49, z, 5.63, 0.16, 2.48);
      for (let i = -7; i <= 7; i++) box('containerOrange', x + i * .34, 5.61, z + 1.19, .14, 1.64, .10);
      sign(x, 5.53, z + 1.28, 0, 2.75, 0.56, 'TRANSIT 08', 'white');
    }

    // Repair bridge with pipework and a visible overhead service trolley.
    function repair() {
      const x = 14.0, z = -18;
      for (const side of [-1, 1]) {
        const railX = x + side * 4.3;
        box(steel, railX, 5.53, z, 0.35, 0.42, 11.9);
        box(exterior, railX, 6.01, z, 0.31, 0.26, 11.9);
        pipe('steel2', [railX + 0.2, 5.09, z + 5], [railX + 0.2, 5.09, z - 5.5], 0.08);
        for (const a of [-3.4, 2.5]) pipe('rust', [railX, 5.09, z + a], [x, 5.09, z + a], .055);
      }
      for (const d of [-5.2, -.8, 3.7]) {
        box(exterior, x, 6.03, z + d, 9.7, 0.19, 0.23);
        box(steel, x, 5.82, z + d, 9.3, 0.19, 0.11);
      }
      shape('scatter', safety, 15.65, 5.29, -16.7, 3.82, 0.61, 1.71);
      shape('turret', steel, 15.65, 4.94, -16.72, 1.35, 0.74, 1.1);
      pipe('cable', [15.65, 4.61, -16.72], [15.65, 3.38, -16.72], 0.035);
      box('lampWarm', 15.65, 4.66, -16.5, 0.8, 0.08, 0.1);
      floor('white', 7.6, -11.15, 'SERVICE', 0.14);
    }

    // Dry-dock crane, flood gates, and warning hardware remain outside traversal.
    function basin() {
      for (const side of [-1, 1]) {
        const x = side * 24.25;
        for (const z of [-35.9, -41.6]) {
          box(steel, x, 4.9, z, 1.39, 9.8, 1.08);
          box(iron, x, 1.01, z, 1.88, 2.02, 2.28);
          beam(steel, [x, 2.2, z], [x, 8.9, z - 4.2], 0.19);
        }
        for (let i = 0; i < 5; i++) {
          const z = -34.2 - i * 2.09;
          pipe(steel, [x + side * .1, .08, z], [x + side * .1, 1.69, z], 0.42);
          pipe(safety, [x + side * .1, 1.63, z], [x + side * .1, 1.78, z], 0.46);
        }
      }
      box(steel, 0, 9.03, -41.6, 49.8, 0.53, 1.75);
      box(safety, 0, 9.66, -41.6, 49.4, 0.36, 1.26);
      for (let i = -10; i < 10; i++) beam(iron, [i * 2.36, 9.01, -40.99], [(i + 1) * 2.36, 9.66, -40.99], .094);
      for (const side of [-1, 1]) {
        const x = side * 8.7;
        shape('turret', steel, x, 8.49, -41.62, 3.38, 0.77, 1.82);
        box('lampWarm', x, 8.1, -41.09, 2.65, .07, 0.15);
      }
      sign(0, 8.46, -40.61, 0, 6.35, 0.7, 'DRY DOCK', 'white');
    }

    function extraction() {
      for (const side of [-1, 1]) {
        const x = side * 6.2;
        box(exterior, x, 2.7, -47.48, .61, 5.4, .66);
        pipe('cable', [x, 5.13, -47.4], [side * 1.8, 4.47, -47.4], .037);
        box('lampWarm', x, 5.14, -47.13, .25, .17, .20);
      }
      box(steel, 0, 5.06, -47.48, 12.8, .38, .88);
      box(exterior, 0, 5.37, -47.48, 12.9, .10, .96);
      sign(0, 4.77, -46.94, 0, 4.9, .57, 'BERTH 07', 'white');
    }

    return { entrance, freight, repair, basin, extraction };
  }

  root.PBPortSetpieces = { build };
})(window);
