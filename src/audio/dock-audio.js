(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const VOICE_LIMIT = 24;
  // seconds, start Hz, end Hz, noise fraction, output level, waveform
  const sounds = {
    rifle: [0.16, 188, 46, 0.48, 0.68, 'hard'],
    scatter: [0.31, 127, 32, 0.62, 0.87, 'hard'],
    blade: [0.31, 110, 510, 0.38, 0.43, 'sweep'],
    dry: [0.085, 995, 390, 0.22, 0.23, 'hard'],
    scatterOpen: [0.30, 288, 120, 0.51, 0.43, 'click'],
    scatterLock: [0.26, 240, 89, 0.61, 0.48, 'hard'],
    reloadStart: [0.36, 410, 250, 0.61, 0.32, 'click'],
    reloadEnd: [0.28, 380, 110, 0.42, 0.42, 'click'],
    switch: [0.13, 420, 240, 0.52, 0.2, 'click'],
    steel: [0.22, 880, 710, 0.22, 0.27, 'metal'],
    paintedSteel: [0.19, 720, 510, 0.24, 0.27, 'metal'],
    rust: [0.13, 461, 320, 0.64, 0.24, 'metal'],
    concrete: [0.17, 134, 66, 0.64, 0.34, 'hard'],
    asphalt: [0.13, 144, 57, 0.75, 0.28, 'hard'],
    wood: [0.14, 248, 106, 0.49, 0.33, 'click'],
    rubber: [0.12, 172, 61, 0.17, 0.23, 'hard'],
    water: [0.29, 460, 140, 0.57, 0.24, 'sweep'],
    glass: [0.24, 1420, 522, 0.43, 0.3, 'metal'],
    enemyArmor: [0.16, 361, 227, 0.49, 0.31, 'metal'],
    energyCore: [0.27, 490, 740, 0.16, 0.32, 'sweep'],
    shield: [0.35, 252, 99, 0.16, 0.42, 'sweep'],
    damage: [0.29, 105, 51, 0.23, 0.48, 'hard'],
    footMetal: [0.13, 214, 113, 0.59, .40, 'metal'],
    footDeck: [0.13, 174, 51, 0.63, .39, 'hard'],
    land: [0.22, 137, 44, 0.51, 0.36, 'hard'],
    dash: [0.33, 360, 124, 0.43, 0.4, 'sweep'],
    pulse: [0.64, 179, 30, 0.33, 0.51, 'sweep'],
    alarm: [0.82, 920, 440, 0.08, 0.45, 'click'],
    alert: [0.35, 560, 480, 0.07, 0.26, 'click'],
    enemy: [0.18, 415, 96, 0.24, 0.34, 'sweep'],
    turret: [0.15, 241, 68, 0.48, 0.35, 'hard'],
    destruction: [0.54, 193, 44, 0.55, 0.48, 'metal'],
    arrival: [1.42, 43, 83, 0.24, 0.57, 'sweep'],
    laser: [0.91, 389, 103, 0.30, 0.51, 'sweep'],
    missiles: [0.73, 710, 124, 0.44, 0.45, 'sweep'],
    shockwave: [0.71, 86, 34, 0.54, 0.62, 'hard'],
    strike: [0.55, 258, 133, 0.35, 0.43, 'click'],
    defeat: [1.68, 146, 33, 0.54, 0.72, 'metal'],
    supply: [0.34, 390, 650, 0.08, 0.24, 'click'],
    gate: [0.79, 180, 459, 0.24, 0.37, 'click'],
    radio: [0.25, 671, 895, 0.17, 0.2, 'click'],
    creak: [1.34, 98, 176, 0.21, 0.17, 'metal'],
    drips: [0.63, 1020, 337, 0.17, 0.14, 'click'],
    complete: [1.15, 262, 523, 0.04, 0.33, 'sweep'],
    lost: [0.89, 196, 71, 0.13, 0.37, 'sweep']
  };

  const music = {
    menu: [0.25, 0, 0, 0], entrance: [0.31, 0, 0, 0],
    wave1: [0.22, 0.39, 0, 0], transit: [0.33, 0.13, 0, 0],
    wave2: [0.18, 0.58, 0.16, 0], approach: [0.22, 0.12, 0.11, 0.1],
    arrival: [0.13, 0.16, 0.25, 0.52], boss1: [0.12, 0.33, 0.54, 0.22],
    boss2: [0.10, 0.51, 0.63, 0.42], boss3: [0.06, 0.66, 0.76, 0.68],
    extract: [0.51, 0.14, 0.07, 0], complete: [0.44, 0.08, 0, 0], lost: [0.07, 0, 0, 0.15]
  };
  const loops = ['wind', 'surf', 'machinery', 'pad', 'beat', 'sequence', 'tension'];
  const profiles = {
    entrance: [0.32, 0.1, 0.16], containers: [0.17, 0.05, 0.26], loading: [0.24, 0.19, 0.37],
    boss: [0.20, 0.31, 0.28], extraction: [0.35, 0.42, 0.10]
  };
  const eventSounds = {
    'weapon.fire': detail => detail.weapon,
    'weapon.dry': 'dry', 'weapon.switch': 'switch', 'weapon.reload': detail => detail.weapon === 'scatter'
      ? (detail.complete ? 'scatterLock' : 'scatterOpen') : (detail.complete ? 'reloadEnd' : 'reloadStart'),
    'player.step': detail => detail.metal ? 'footMetal' : 'footDeck', 'player.land': 'land', 'player.damage': 'damage', 'player.dash': 'dash', 'player.pulse': 'pulse',
    'enemy.alert': 'alert', 'enemy.attack': detail => detail.turret ? 'turret' : 'enemy',
    'enemy.destroy': 'destruction', 'combat.impact': detail => detail.surface,
    'boss.attack': detail => detail.attack === 'volley' ? 'enemy' : detail.attack === 'expose' ? 'shield' : detail.attack,
    'boss.arrival': 'arrival', 'boss.phaseChange': 'shield', 'boss.shield': 'shield', 'boss.enrage': 'alarm', 'boss.defeat': 'defeat',
    'supply.start': 'supply', 'supply.complete': 'gate', 'exit.unlock': 'gate', 'world.gate': 'gate',
    'world.break': detail => detail.surface, 'run.won': 'complete', 'run.lost': 'lost'
  };

  function makeEffect(context, name) {
    const [duration, start, end, noise, level, style] = sounds[name];
    const rate = 24000;
    const buffer = context.createBuffer(1, Math.floor(duration * rate), rate);
    const data = buffer.getChannelData(0);
    const random = PBEvents.rng(name.length * 137 + Math.round(start));
    let phase = 0;
    let filtered = 0;
    for (let i = 0; i < data.length; i++) {
      const time = i / rate;
      const progress = time / duration;
      phase += TAU * (end + (start - end) * (1 - progress) ** 2) / rate;
      const white = random() * 2 - 1;
      filtered += (white - filtered) * (style === 'metal' ? 0.37 : 0.15);
      let tone = Math.sin(phase);
      if (style === 'metal') tone = (tone + Math.sin(phase * 1.66) * 0.32 + Math.sin(phase * 2.71) * 0.15) * 0.68;
      if (style === 'hard') tone = Math.tanh(tone * 2.2);
      let envelope = (1 - progress) ** 2.4 * Math.min(1, time * 350);
      if (style === 'click') envelope *= 0.2 + 0.8 * Math.max(0, Math.cos(progress * TAU * 2.4)) ** 4;
      if (style === 'sweep') envelope *= Math.min(1, time * 22) * (0.83 + 0.17 * Math.sin(phase * 0.12));
      data[i] = (tone * (1 - noise) + (white * 0.23 + filtered * 1.9) * noise) * level * envelope;
    }
    return buffer;
  }

  function makeLoop(context, name) {
    const rate = 24000;
    const length = 8;
    const buffer = context.createBuffer(1, rate * length, rate);
    const data = buffer.getChannelData(0);
    const random = PBEvents.rng(2028 + loops.indexOf(name));
    const score = [8, 12, 15, 19, 12, 10, 15, 19, 8, 12, 17, 20, 10, 15, 12, 5];
    let filtered = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      filtered += (random() * 2 - 1 - filtered) * 0.04;
      const bar = t % 2;
      const swell = Math.sin(TAU * t / length);
      let value = 0;
      if (name === 'wind') value = filtered * (0.66 + 0.3 * swell);
      if (name === 'surf') value = filtered * (0.25 + 0.7 * Math.sin(Math.PI * t / 4) ** 4) + 0.06 * swell;
      if (name === 'machinery') {
        value = Math.sin(TAU * 47 * t) * 0.17 + Math.sin(TAU * 94.25 * t) * (0.06 + 0.03 * swell) + filtered * 0.13;
      }
      if (name === 'pad') {
        value = (Math.sin(TAU * 55 * t) * 0.16 + Math.sin(TAU * 82.375 * t) * 0.073
          + Math.sin(TAU * 130.875 * t) * 0.067) * (0.77 + 0.23 * swell);
      }
      if (name === 'beat') {
        const tick = t % 0.5;
        value = (Math.sin(TAU * (51 * tick + 2 * (1 - Math.exp(-30 * tick)))) * 0.42 + filtered * 0.65)
          * Math.exp(-tick * 14) * Math.min(1, tick * 220);
      }
      if (name === 'sequence') {
        const tick = t % 0.5;
        const hz = 110 * 2 ** (score[Math.floor(2 * t)] / 12);
        value = (Math.sin(TAU * hz * tick) + 0.26 * Math.sin(TAU * hz * 2 * tick))
          * 0.23 * Math.exp(-8 * tick) * Math.min(1, tick * 120);
      }
      if (name === 'tension') {
        value = (Math.sin(TAU * 36.75 * t) + 0.4 * Math.sin(TAU * 73.625 * t)) * 0.25
          * (0.22 + 0.78 * Math.exp(-bar * 2.4) * Math.min(1, bar * 14));
      }
      // A short zero crossing around the seam keeps the noise beds click-free.
      data[i] = value * Math.min(1, i / 96, (data.length - 1 - i) / 96);
    }
    return buffer;
  }

  function create(events, initial, canPlay = true) {
    let ctx = null;
    let channels = null;
    let animMode = 'menu';
    let node = 'entrance';
    let zone = 'entrance';
    let volume = initial;
    let listener = null;
    let listenerYaw = 0;
    let nextDetail = 5;
    let error = '';
    let disposed = false;
    let played = 0;
    const cache = new Map();
    const beds = new Map();
    const voices = [];
    const lastPlayed = new Map();

    function change(target, value, tau = 0.1) {
      target.setTargetAtTime(value, ctx.currentTime, tau);
    }

    function mix() {
      if (!ctx || !channels) return;
      for (const name of Object.keys(channels)) {
        const duck = animMode === 'paused' && name !== 'ui' && name !== 'master' ? 0.17 : 1;
        change(channels[name].gain, volume[name] * duck);
      }
      const song = music[animMode === 'menu' || animMode === 'lost' ? animMode : node] || music.entrance;
      for (let i = 3; i < loops.length; i++) change(beds.get(loops[i]).gain, song[i - 3], 0.55);
      const bed = profiles[zone] || profiles.entrance;
      for (let i = 0; i < 3; i++) {
        let level = bed[i];
        if (i === 2 && node === 'boss3') level *= 1.65;
        if (i === 1 && node === 'extract') level *= 1.3;
        change(beds.get(loops[i]).gain, level, 0.45);
      }
    }

    function play(name, point, channel, strength = 1) {
      if (!ctx || ctx.state !== 'running' || !sounds[name] || animMode === 'paused' && channel !== 'ui') return;
      const now = ctx.currentTime;
      if (now - (lastPlayed.get(name) ?? -10) < 0.034) return;
      let gain = strength;
      let pan = 0;
      if (point && listener) {
        const dx = point.x - listener.x, dz = point.z - listener.z;
        const range = Math.hypot(dx, point.y - listener.y, dz);
        if (range > 75) return;
        gain /= 1 + (range / 12) ** 2;
        pan = range > 0.3 ? (dx * Math.cos(listenerYaw) - dz * Math.sin(listenerYaw)) / range : 0;
      }
      const voice = voices.find(slot => !slot.source);
      if (!voice) return;
      const source = ctx.createBufferSource();
      voice.source = source;
      source.buffer = cache.get(name);
      voice.level.gain.setValueAtTime(gain, now);
      if (voice.pan) voice.pan.pan.setValueAtTime(pan, now);
      voice.output.disconnect();
      voice.output.connect(channels[channel]);
      source.connect(voice.level);
      source.onended = () => {
        source.disconnect();
        if (voice.source === source) voice.source = null;
      };
      source.start();
      lastPlayed.set(name, now);
      played++;
    }

    function mutePage(hidden) {
      if (!ctx) return;
      const task = hidden ? ctx.suspend() : ctx.resume();
      task.catch(reason => { error = String(reason.message || reason); });
    }

    return {
      unlock() {
        if (!canPlay || disposed) return;
        try {
          if (!ctx) {
            const Audio = root.AudioContext || root.webkitAudioContext;
            if (!Audio) throw new Error('此浏览器不支持 Web Audio');
            ctx = new Audio({ latencyHint: 'interactive' });
            const compressor = ctx.createDynamicsCompressor();
            compressor.connect(ctx.destination);
            channels = Object.fromEntries(Object.keys(volume).map(name => [name, ctx.createGain()]));
            channels.master.connect(compressor);
            for (const name of Object.keys(channels)) if (name !== 'master') channels[name].connect(channels.master);
            for (const name of Object.keys(sounds)) cache.set(name, makeEffect(ctx, name));
            const start = ctx.currentTime + 0.08;
            for (const name of loops) {
              const source = ctx.createBufferSource();
              const gain = ctx.createGain();
              const buffer = makeLoop(ctx, name);
              cache.set(name, buffer);
              source.buffer = buffer;
              source.loop = true;
              gain.gain.value = 0;
              source.connect(gain).connect(channels[loops.indexOf(name) < 3 ? 'ambience' : 'music']);
              source.start(start);
              beds.set(name, gain);
            }
            for (let i = 0; i < VOICE_LIMIT; i++) {
              const level = ctx.createGain();
              const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
              if (pan) level.connect(pan);
              voices.push({ level, pan, output: pan || level, source: null });
            }
            mix();
          }
          mutePage(false);
        } catch (reason) {
          error = String(reason.message || reason);
          if (ctx) ctx.close().catch(() => {});
          ctx = null;
          disposed = true;
        }
      },
      configure(next) { volume = next; mix(); },
      setMode(next) { animMode = next; mix(); },
      setNode(next) { node = next; mix(); },
      bind() {
        for (const [type, sound] of Object.entries(eventSounds)) {
          events.on(type, detail => {
            const name = typeof sound === 'function' ? sound(detail) : sound;
            const channel = type.startsWith('run.') ? 'ui' : 'sfx';
            play(name, detail?.point, channel, detail?.level ?? 1);
          });
        }
        events.on('mission.objectiveChange', detail => {
          this.setNode(detail.node);
          if (detail.caption) play('radio', null, 'voice');
        });
      },
      update(dt, position, yaw, nextZone) {
        listener = position;
        listenerYaw = yaw;
        if (zone !== nextZone) {
          zone = nextZone;
          mix();
        }
        if (animMode !== 'paused' && ctx?.state === 'running') {
          nextDetail -= dt;
          if (nextDetail <= 0) {
            const source = zone === 'loading' ? { x: 18, y: 0.8, z: -17 }
              : { x: -13, y: 1.6, z: position.z - 8 };
            play(zone === 'loading' ? 'drips' : 'creak', source, 'ambience', 0.55);
            nextDetail = zone === 'loading' ? 4.9 : 8.6;
          }
        }
      },
      mutePage,
      get error() { return error; },
      snapshot() {
        return {
          status: ctx?.state || (canPlay ? 'locked' : 'disabled by benchmark'),
          error, cachedBuffers: cache.size, loopingBeds: beds.size, poolSize: voices.length,
          activeVoices: voices.filter(voice => voice.source).length, eventsPlayed: played, score: animMode === 'menu' ? 'menu' : node
        };
      }
    };
  }

  root.PBAudio = { create };
})(window);
