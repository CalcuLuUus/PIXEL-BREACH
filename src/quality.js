(function (root) {
  'use strict';

  const profiles = {
    high: { name: 'high', width: 1920, height: 1080, scaleMin: 0.75, scaleMax: 1,
      maxLocalLights: 8, visualDetail: 1, textureMix: 1, extraDetail: true, contactShadows: 12 },
    balanced: { name: 'balanced', width: 1600, height: 900, scaleMin: 0.8, scaleMax: 1,
      maxLocalLights: 6, visualDetail: 0.9, textureMix: 0.9, extraDetail: true, contactShadows: 10 },
    fallback: { name: 'fallback', width: 960, height: 540, scaleMin: 0.75, scaleMax: 1,
      maxLocalLights: 4, visualDetail: 0.55, textureMix: 0.62, extraDetail: false, contactShadows: 6 }
  };

  Object.values(profiles).forEach(Object.freeze);
  Object.freeze(profiles);

  function resolution(renderer, profile, scale) {
    const units = Math.max(1, Math.min(Math.round(profile.width * scale / 16),
      Math.floor(renderer.maxRenderWidth / 16), Math.floor(renderer.maxRenderHeight / 9)));
    return { width: units * 16, height: units * 9 };
  }

  function configure(renderer, requested) {
    const choices = requested === 'high' ? ['high', 'balanced', 'fallback'] :
      requested === 'balanced' ? ['balanced', 'fallback'] : ['fallback'];
    const reasons = [];
    for (const name of choices) {
      const profile = profiles[name];
      const size = resolution(renderer, profile, 1);
      if (name !== 'fallback' && (!renderer.isWebGL2 || size.width !== profile.width ||
          renderer.capabilities.maxTextureSize < (name === 'high' ? 2048 : 1024))) {
        reasons.push(name + ' exceeds context limits');
        continue;
      }
      renderer.setQuality(name);
      if (renderer.setSize(size.width, size.height)) {
        return { profile, size, reason: reasons.join('; ') || name + ' selected' };
      }
      reasons.push(name + ': ' + renderer.highError);
    }
    throw new Error(reasons.join('; '));
  }

  root.PBQuality = { configure, resolution, profiles };
})(window);
