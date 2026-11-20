(function (root) {
  'use strict';

  const impact = {
    steel: [0xffcb95, 6, 0x8d8490, 3, 4.3, 0.31, 0.027],
    paintedSteel: [0xffd3a2, 4, 0x687886, 5, 3.6, 0.30, 0.033],
    rust: [0xea9b63, 3, 0x9a6242, 8, 3.1, 0.36, 0.040],
    asphalt: [0xdab799, 1, 0x3f4450, 7, 2.4, 0.38, 0.040],
    rubber: [0xcab6a1, 0, 0x323643, 4, 1.5, 0.29, 0.041],
    glass: [0xc7f5ff, 2, 0x8fc9e8, 9, 3.3, 0.48, 0.033],
    shield: [0xbaf8ff, 8, 0x5bc3ff, 5, 5, 0.32, 0.028],
    concrete: [0xd2c5b8, 2, 0x9b9ba4, 8, 2.1, 0.38, 0.055],
    wood: [0xfac189, 1, 0xad8052, 9, 3.1, 0.33, 0.040],
    water: [0xd6f4ff, 0, 0xb8dcf4, 10, 2.9, 0.42, 0.045],
    enemyArmor: [0x9bafff, 7, 0x556383, 7, 4.5, 0.33, 0.035],
    energyCore: [0xffbddc, 9, 0xb773ff, 7, 5.2, 0.36, 0.040]
  };

  function impactFx(kind, point, sparks, particles, ring) {
    const [sparkColor, sparkCount, color, count, speed, life, size] = impact[kind] || impact.steel;
    if (sparkCount) sparks(point, sparkColor, sparkCount, speed, 1);
    const surface = kind === 'energyCore' || kind === 'shield' ? 'energy' : 'fragment';
    particles(point, color, count, speed, life, size, surface);
    if (kind === 'concrete' || kind === 'wood' || kind === 'asphalt' || kind === 'rust') {
      particles(point, kind === 'concrete' ? 0xa4a09a : 0xb19068, 3, 0.75, 0.47, 0.31, 'dust');
    }
    if (kind === 'water' || kind === 'energyCore' || kind === 'shield') {
      ring(point, kind === 'water' ? 0.74 : 0.92, color, 0.34, point.y + 0.016);
    }
  }

  function trackSensor(sensor, vertical, distance) {
    sensor.rotation.x = -Math.atan2(vertical, distance);
  }

  function updateArmor(material, heat, wear) {
    material.wear = wear;
    material.emissive.setRGB(heat * 0.46, heat * 0.13, heat * 0.10);
  }

  const marks = {
    steel: [0x393639, 0.13], paintedSteel: [0x5d544b, 0.12], rust: [0x5b3e2c, 0.16],
    asphalt: [0x1d2329, 0.21], concrete: [0x464650, 0.19],
    rubber: [0x181d23, 0.11], wood: [0x755136, 0.19], glass: [0xcbd8e4, 0.11]
  };

  function createMarks({ THREE, scene, plane, makeMaterial, ripple, limit }) {
    const normal = new THREE.Vector3();
    const front = new THREE.Vector3(0, 0, 1);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const fade = ctx.createRadialGradient(32, 32, 4, 32, 32, 29);
      fade.addColorStop(0, 'rgba(255,255,255,1)');
      fade.addColorStop(.42, 'rgba(255,255,255,.82)');
      fade.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fade;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const radius = i % 2 ? 18 + i % 3 : 30 - i % 5;
        const angle = i * Math.PI / 9;
        ctx.lineTo(32 + Math.cos(angle) * radius, 32 + Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fill();
    }
    const texture = ctx ? new THREE.Texture(canvas) : null;
    const materials = Object.fromEntries(Object.entries(marks).map(([surface, [color]]) => {
      const mat = makeMaterial(color, { transparent: true, depthWrite: false, opacity: .83 });
      mat.decal = texture;
      return [surface, mat];
    }));
    const pool = Array.from({ length: limit }, () => {
      const mesh = new THREE.Mesh(plane, materials.steel);
      mesh.visible = false;
      mesh.reflectionSkip = true;
      mesh.detailDistance = 32;
      mesh.renderOrder = 1;
      scene.add(mesh);
      return { mesh, remaining: 0, collider: null };
    });
    let cursor = 0;

    function setNormal(point, direction, box) {
      if (!box) return normal.set(0, 1, 0);
      const x0 = Math.abs(point.x - box.minX), x1 = Math.abs(point.x - box.maxX);
      const y0 = Math.abs(point.y - box.y0), y1 = Math.abs(point.y - box.y1);
      const z0 = Math.abs(point.z - box.minZ), z1 = Math.abs(point.z - box.maxZ);
      const edge = Math.min(x0, x1, y0, y1, z0, z1);
      if (edge === x0 || edge === x1) return normal.set(direction.x > 0 ? -1 : 1, 0, 0);
      if (edge === y0 || edge === y1) return normal.set(0, direction.y > 0 ? -1 : 1, 0);
      return normal.set(0, 0, direction.z > 0 ? -1 : 1);
    }

    return {
      place(surface, point, direction, collider) {
        if (!texture || !materials[surface]) return;
        const mark = pool[cursor];
        cursor = (cursor + 1) % pool.length;
        const n = setNormal(point, direction, collider);
        mark.mesh.material = materials[surface];
        mark.mesh.position.copy(point).addScaledVector(n, collider ? .011 : .054);
        mark.mesh.quaternion.setFromUnitVectors(front, n);
        const size = marks[surface][1];
        mark.mesh.scale.set(size, size * 0.85, 1);
        mark.mesh.visible = true;
        mark.collider = collider || null;
        mark.remaining = 24;
      },
      disturb(position, time) {
        ripple(position.x, position.z, time);
      },
      update(dt) {
        for (const mark of pool) {
          if (!mark.mesh.visible) continue;
          mark.remaining -= dt;
          if (mark.remaining <= 0 || mark.collider?.disabled) mark.mesh.visible = false;
        }
      },
      reset() {
        for (const mark of pool) {
          mark.mesh.visible = false;
          mark.collider = null;
        }
        cursor = 0;
      },
      snapshot() {
        return { active: pool.filter(mark => mark.mesh.visible).length, limit, available: !!texture };
      }
    };
  }

  root.PBCombatVisuals = { impactFx, trackSensor, updateArmor, createMarks };
})(window);
