(function (root) {
  'use strict';

  function makeSurfaceLayers(renderer, periodicNoise, hash2, DETAIL_TILE, size) {
    var count = 8;
    var albedo = new Uint8ClampedArray(size * size * 4 * count);
    var finish = new Uint8ClampedArray(albedo.length);
    var height = new Float32Array(size * size);
    var wrap = size - 1;
    var frequency = 1024 / size;
    for (var layer = 0; layer < count; layer++) {
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var broad = periodicNoise(x * frequency / 64, y * frequency / 64, 8, layer + 2);
          var chips = periodicNoise(x * frequency / 32, y * frequency / 32, 32, layer + 19);
          var grain = hash2(x + layer * 251, y + layer * 797);
          var grainLine = periodicNoise(x * frequency / 8, y * frequency / 32, 128, layer + 9);
          var value, warmth, relief, rough, contact;
          switch (layer) {
            case DETAIL_TILE.metal: {
              var brush = Math.max(0, Math.sin(y * Math.PI / 4 + broad) * 0.4 + grain * 0.6 - 0.43);
              value = 141 + 21 * broad + brush * 24 - chips * 15;
              warmth = -5;
              relief = brush * 0.12 + 0.19 * chips;
              rough = 97 + 76 * chips + brush * 58;
              contact = 218 + 34 * broad;
              break;
            }
            case DETAIL_TILE.rust:
              value = 89 + broad * 56 + chips * 49 + grain * 12;
              warmth = 42 * (0.2 + chips);
              relief = 0.48 * chips + 0.18 * grain;
              rough = 158 + 80 * chips;
              contact = 155 + 79 * broad;
              break;
            case DETAIL_TILE.concrete: {
              var pore = grain > 0.91 ? (grain - 0.91) * 8 : 0;
              value = 126 + broad * 32 + chips * 32 + grain * 12 - pore * 55;
              warmth = 3 + broad * 8;
              relief = 0.34 * chips + 0.18 * grain - pore * 0.49;
              rough = 166 + 43 * broad;
              contact = 208 + 34 * chips - pore * 55;
              break;
            }
            case DETAIL_TILE.wood: {
              var fiber = Math.sin(2 * Math.PI * y * 21 / size + broad * 5.2 + chips * 0.8);
              var knot = Math.max(0, fiber - 0.52);
              value = 127 + broad * 27 + fiber * 32 - knot * grain * 49;
              warmth = 24;
              relief = fiber * 0.21 + broad * 0.24;
              rough = 165 + 44 * chips;
              contact = 216 + fiber * 19;
              break;
            }
            case DETAIL_TILE.paint: {
              var peel = Math.max(0, (chips * 0.68 + grainLine * 0.25 + broad * 0.25 - 0.76) * 4.1);
              value = 148 + broad * 19 + grain * 6 - 58 * peel - grainLine * 10;
              warmth = 4 + peel * 48;
              relief = chips * 0.12 - peel * 0.48;
              rough = 96 + broad * 54 + peel * 80;
              contact = 246 - peel * 104;
              break;
            }
            case DETAIL_TILE.chips:
              value = 135 + broad * 22 + chips * 24 + (grain > 0.98 ? 35 : grain * 10);
              warmth = -4;
              relief = 0.33 * chips + 0.15 * grain;
              rough = 110 + 90 * chips;
              contact = 180 + chips * 66;
              break;
            case DETAIL_TILE.water:
              value = 137 + 35 * broad; warmth = -12;
              relief = chips * 0.14;
              rough = 78 + 32 * chips;
              contact = 250;
              break;
            default:
              value = 104 + broad * 39 + chips * 25 + 20 * grain;
              warmth = 1;
              relief = chips * 0.20 + grain * 0.32;
              rough = 176 + broad * 61;
              contact = 192 + broad * 52;
          }
          var index = (layer * size * size + y * size + x) * 4;
          albedo[index] = value + warmth * 0.56;
          albedo[index + 1] = value;
          albedo[index + 2] = value - warmth;
          albedo[index + 3] = layer === DETAIL_TILE.paint || layer === DETAIL_TILE.metal
            ? Math.max(0, chips * 0.68 + broad * 0.32 - 0.52) * 420
            : 0;
          height[y * size + x] = relief;
          finish[index + 2] = rough;
          finish[index + 3] = contact;
        }
      }
      for (var v = 0; v < size; v++) {
        for (var u = 0; u < size; u++) {
          var i = (layer * size * size + v * size + u) * 4;
          // Wrap central differences so normals tile with the color.
          finish[i] = 128 + (height[v * size + ((u - 1) & wrap)] - height[v * size + ((u + 1) & wrap)]) * 225;
          finish[i + 1] = 128 + (height[((v - 1) & wrap) * size + u] - height[((v + 1) & wrap) * size + u]) * 225;
        }
      }
    }
    if (!renderer.setSurfaceLayers(size, count, albedo, finish)) return null;
    return { size, count, bytes: albedo.byteLength + finish.byteLength };
  }

  function signage(THREE, scene, plane, materials) {
    const textures = new Map();
    return function (key, x, y, z, text, height, yaw, floor) {
      if (!text || !materials[key]) return;
      const label = String(text).toUpperCase();
      const heightPx = height < 0.24 ? 64 : 128;
      const scale = heightPx / 128;
      const cacheKey = label + ':' + heightPx;
      let texture = textures.get(cacheKey);
      if (!texture) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(2048 * scale, 2 ** Math.ceil(Math.log2((label.length * 72 + 32) * scale)));
        canvas.height = heightPx;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.font = 'bold ' + 92 * scale + 'px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(label, canvas.width / 2, heightPx / 2, canvas.width - 24 * scale);
        texture = new THREE.Texture(canvas, { flipY: true });
        texture.mipmaps = true;
        textures.set(cacheKey, texture);
      }
      const material = materials[key].clone();
      material.unlit = true;
      material.transparent = true;
      material.depthWrite = false;
      material.decal = texture;
      const mesh = new THREE.Mesh(plane, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(floor ? -Math.PI / 2 : 0, yaw, 0);
      mesh.scale.set(height * label.length * 0.79, height * 1.45, 1);
      mesh.detailDistance = height < 0.24 ? 24 : 65;
      mesh.renderOrder = 1;
      scene.add(mesh);
    };
  }

  function fallbackSky(THREE, scene, plane, material) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, '#243450');
    sky.addColorStop(0.55, '#726181');
    sky.addColorStop(0.73, '#c18a86');
    sky.addColorStop(0.84, '#f5b174');
    sky.addColorStop(1, '#755368');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 512, 256);
    material.decal = new THREE.Texture(canvas, { flipY: true });
    material.decalColor = true;
    const mesh = new THREE.Mesh(plane, material);
    mesh.position.set(0, 30, -118);
    mesh.scale.set(330, 84, 1);
    scene.add(mesh);
  }

  function scorchDecal(THREE) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const fade = ctx.createRadialGradient(64, 64, 8, 64, 64, 63);
    fade.addColorStop(0, 'rgba(255,255,255,0.95)');
    fade.addColorStop(0.38, 'rgba(255,255,255,0.65)');
    fade.addColorStop(0.67, 'rgba(255,255,255,0.22)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.Texture(canvas);
    texture.mipmaps = true;
    return texture;
  }

  root.PBDockArt = { makeSurfaceLayers, signage, fallbackSky, scorchDecal };
})(window);
