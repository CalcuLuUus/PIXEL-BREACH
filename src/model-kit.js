(function (root) {
  'use strict';

  // Section profiles run stern-to-bow in local Z. Facets intentionally catch
  // the key light along plate breaks and the bevel around each shoulder.
  function loft(THREE, sections, contour) {
    const vertices = [], normals = [], indices = [];
    const rings = sections.map(([z, width, height, lift = 0]) =>
      contour.map(([x, y]) => [x * width, lift + y * height, z]));
    function face(points) {
      const [a, b, c] = points;
      const u = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const v = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      u.cross(v).normalize();
      const first = vertices.length / 3;
      for (const point of points) {
        vertices.push(...point);
        normals.push(u.x, u.y, u.z);
      }
      for (let i = 1; i < points.length - 1; i++) indices.push(first, first + i, first + i + 1);
    }
    for (let i = 1; i < rings.length; i++) {
      for (let j = 0; j < contour.length; j++) {
        const k = (j + 1) % contour.length;
        face([rings[i - 1][j], rings[i - 1][k], rings[i][k], rings[i][j]]);
      }
    }
    face(rings[0].slice().reverse());
    face(rings.at(-1));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', { array: new Float32Array(vertices), itemSize: 3 });
    geometry.setAttribute('normal', { array: new Float32Array(normals), itemSize: 3 });
    geometry.setIndex(new Uint16Array(indices));
    return geometry;
  }

  function turnedPart(THREE, profile, segments = 32) {
    const positions = [], normals = [], indices = [];
    for (let ring = 0; ring < profile.length; ring++) {
      const [z, radius] = profile[ring];
      const previous = profile[Math.max(0, ring - 1)];
      const next = profile[Math.min(profile.length - 1, ring + 1)];
      const dz = next[0] - previous[0];
      const dr = next[1] - previous[1];
      const length = Math.hypot(dz, dr) || 1;
      for (let step = 0; step <= segments; step++) {
        const angle = step / segments * Math.PI * 2;
        const x = Math.cos(angle), y = Math.sin(angle);
        positions.push(x * radius, y * radius, z);
        normals.push(x * dz / length, y * dz / length, -dr / length);
        if (!ring || !step) continue;
        const d = ring * (segments + 1) + step;
        const b = d - segments - 1;
        indices.push(b - 1, b, d, b - 1, d, d - 1);
      }
    }
    return new THREE.BufferGeometry()
      .setAttribute('position', { array: new Float32Array(positions), itemSize: 3 })
      .setAttribute('normal', { array: new Float32Array(normals), itemSize: 3 })
      .setIndex(new Uint16Array(indices));
  }

  function slashRibbon(THREE) {
    const positions = [], normals = [], indices = [];
    const segments = 44;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * Math.PI * 1.18;
      const width = 0.009 + Math.sin(t * Math.PI) ** 0.85 * 0.105;
      const radius = 0.86 + t * 0.14;
      for (const offset of [-width, width]) {
        positions.push(Math.cos(angle) * (radius + offset), Math.sin(angle) * (radius + offset), 0);
        normals.push(0, 0, 1);
      }
      if (i) {
        const end = i * 2;
        indices.push(end - 2, end - 1, end, end - 1, end + 1, end);
      }
    }
    return new THREE.BufferGeometry()
      .setAttribute('position', { array: new Float32Array(positions), itemSize: 3 })
      .setAttribute('normal', { array: new Float32Array(normals), itemSize: 3 })
      .setIndex(new Uint16Array(indices));
  }

  // Static scenery assemblies share draws by finish. World bounds remain
  // available for both the main frustum and the reflection cameras.
  function bake(THREE, assembly, scene, castShadow = false) {
    const batches = new Map();
    const point = new THREE.Vector3(), normal = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    assembly.updateMatrixWorld();
    assembly.traverse(part => {
      if (!part.isMesh) return;
      let batch = batches.get(part.material);
      if (!batch) {
        batch = {
          positions: [], normals: [], indices: [],
          bounds: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
        };
        batches.set(part.material, batch);
      }
      const base = batch.positions.length / 3;
      const positions = part.geometry.attributes.position.array;
      const normals = part.geometry.attributes.normal.array;
      const m = normalMatrix.getNormalMatrix(part.matrixWorld).elements;
      for (let i = 0; i < positions.length; i += 3) {
        point.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(part.matrixWorld);
        batch.positions.push(point.x, point.y, point.z);
        batch.bounds[0] = Math.min(batch.bounds[0], point.x);
        batch.bounds[1] = Math.min(batch.bounds[1], point.y);
        batch.bounds[2] = Math.min(batch.bounds[2], point.z);
        batch.bounds[3] = Math.max(batch.bounds[3], point.x);
        batch.bounds[4] = Math.max(batch.bounds[4], point.y);
        batch.bounds[5] = Math.max(batch.bounds[5], point.z);
        const x = normals[i], y = normals[i + 1], z = normals[i + 2];
        normal.set(m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z,
          m[2] * x + m[5] * y + m[8] * z).normalize();
        batch.normals.push(normal.x, normal.y, normal.z);
      }
      for (const index of part.geometry.index) batch.indices.push(base + index);
    });
    for (const [material, batch] of batches) {
      const geometry = new THREE.BufferGeometry()
        .setAttribute('position', { array: new Float32Array(batch.positions), itemSize: 3 })
        .setAttribute('normal', { array: new Float32Array(batch.normals), itemSize: 3 })
        .setIndex(new Uint16Array(batch.indices));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.worldBounds = batch.bounds;
      mesh.castShadow = castShadow;
      mesh.staticShadow = castShadow;
      scene.add(mesh);
    }
  }

  function beamMesh(THREE) {
    const mesh = turnedPart(THREE, [[-.5,.06],[-.47,.42],[-.33,.50],[.33,.50],[.47,.42],[.5,.06]], 12);
    for (const attribute of Object.values(mesh.attributes)) {
      const values = attribute.array;
      for (let i = 0; i < values.length; i += 3) {
        const x = values[i];
        values[i] = values[i + 2];
        values[i + 2] = -x;
      }
    }
    return mesh;
  }

  function create(THREE) {
    const shell = [[-.34,-.5],[.34,-.5],[.5,-.25],[.5,.15],[.36,.43],[.22,.5],[-.22,.5],[-.36,.43],[-.5,.15],[-.5,-.25]];
    const cutter = [[0,-.5],[.40,-.16],[.5,.10],[.28,.5],[-.28,.5],[-.5,.10],[-.40,-.16]];
    const ship = [[-.31,-.5],[.31,-.5],[.47,-.25],[.5,.42],[.44,.5],[-.44,.5],[-.5,.42],[-.47,-.25]];
    return {
      ship: loft(THREE, [[-.5,.58,.70,.10],[-.39,.92,1],[-.19,1,1],[.27,1,1],[.44,.55,.95,.06],[.50,.065,.66,.21]], ship),
      rifle: loft(THREE, [[-.50,.58,.45,-.07],[-.39,.84,.75],[-.20,1,1],[.15,1,.90],[.40,.83,.79],[.50,.52,.60,-.05]], shell),
      scatter: loft(THREE, [[-.50,.79,.51],[-.36,1,1],[.00,.96,1],[.29,.91,.91],[.50,.66,.56]], shell),
      blade: loft(THREE, [[-.50,.018,.03,.44],[-.35,.35,.58,.15],[-.12,.71,.94],[.27,1,1],[.50,.75,.81,.07]], cutter),
      sentinel: loft(THREE, [[-.5,.61,.58],[-.26,.96,.82],[.07,1,1],[.31,.76,.76],[.5,.45,.52]], shell),
      turret: loft(THREE, [[-.5,.53,.73],[-.33,1,1],[.16,1,.92],[.42,.72,.66],[.5,.66,.62]], shell),
      boss: loft(THREE, [[-.5,.70,.39,-.10],[-.34,.99,.74],[.06,1,1],[.32,.82,.78],[.5,.40,.49,-.10]], shell),
      projectile: loft(THREE, [[-.5,.13,.13],[-.28,.47,.47],[.10,1,1],[.34,.59,.59],[.5,.12,.12]], shell),
      shard: loft(THREE, [[-.5,.11,.11],[-.18,.47,.6],[.06,1,.79],[.5,.08,.06]], cutter),
      slash: slashRibbon(THREE),
      beam: beamMesh(THREE),
      optic: turnedPart(THREE, [[-.5,.25],[-.5,.78],[-.43,.95],[-.29,1],[-.16,.86],[.28,.83],[.40,1],[.47,.96],[.5,.64],[.5,.26]]),
      joint: turnedPart(THREE, [[-.5,.22],[-.5,.69],[-.37,.93],[-.23,1],[-.12,.86],[.13,.86],[.23,1],[.37,.93],[.5,.69],[.5,.22]], 24),
      seal: turnedPart(THREE, [[-.5,.64],[-.42,.90],[-.29,1],[.28,1],[.43,.88],[.5,.64]], 24),
      tube: new THREE.CylinderGeometry(1, 1, 1, 24),
      lens: new THREE.SphereGeometry(1, 24, 12)
    };
  }

  root.PBModelKit = { create, bake };
})(window);
