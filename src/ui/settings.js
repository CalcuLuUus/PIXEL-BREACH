(function (root) {
  'use strict';

  const key = 'pixel-breach.settings';
  const recordKey = 'pixel-breach.records';
  const bindings = {
    forward: ['KeyW', '前进'], back: ['KeyS', '后退'], left: ['KeyA', '左移'], right: ['KeyD', '右移'],
    sprint: ['ShiftLeft', '冲刺'], jump: ['Space', '跳跃'], dash: ['KeyQ', '相位突进'], pulse: ['KeyF', '过载脉冲'],
    interact: ['KeyE', '交互'], reload: ['KeyR', '换弹'],
    rifle: ['Digit1', '步枪'], scatter: ['Digit2', '散射器'], blade: ['Digit3', '相位刃']
  };
  const volumes = { master: 0.65, music: 0.45, sfx: 0.85, voice: 0.8, ambience: 0.5, ui: 0.65 };
  const defaults = {
    version: 8, quality: 'high', dynamic: true, scale: 1, shadows: 'auto', textures: 'auto', reflections: 'auto',
    // Bloom is a restrained highlight accent, not a neon wash.
    post: true, bloom: 0.16, shake: 0.48, motionBlur: false, fov: 74, sensitivity: 1,
    subtitles: true, contrast: false, reducedMotion: !!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    volumes, bindings: Object.fromEntries(Object.entries(bindings).map(([name, value]) => [name, value[0]]))
  };

  function choice(value, options, fallback) { return options.includes(value) ? value : fallback; }
  function number(value, min, max, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }
  function bool(value, fallback) { return typeof value === 'boolean' ? value : fallback; }
  function validCode(code) {
    return typeof code === 'string' && /^(Key[A-HJ-WYZ]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Space|ShiftLeft|AltLeft|ControlLeft)$/.test(code);
  }

  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = { ...defaults, volumes: { ...volumes }, bindings: { ...defaults.bindings } };
    out.quality = choice(source.quality ?? source.profile, ['high', 'balanced', 'fallback'], defaults.quality);
    out.shadows = choice(source.shadows, ['auto', 'low'], defaults.shadows);
    out.textures = choice(source.textures, ['auto', 'low'], defaults.textures);
    out.reflections = choice(source.reflections, ['auto', 'sea', 'off'], defaults.reflections);
    for (const name of ['dynamic', 'post', 'motionBlur', 'subtitles', 'contrast', 'reducedMotion']) {
      out[name] = bool(source[name], defaults[name]);
    }
    out.scale = number(source.scale, 0.5, 1, defaults.scale);
    out.bloom = number(source.bloom, 0, 0.7, defaults.bloom);
    out.shake = number(source.shake, 0, 1, defaults.shake);
    out.fov = number(source.fov, 55, 100, defaults.fov);
    out.sensitivity = number(source.sensitivity ?? source.mouseSensitivity, 0.25, 3, defaults.sensitivity);
    for (const name of Object.keys(volumes)) out.volumes[name] = number(source.volumes?.[name], 0, 1, volumes[name]);
    const proposed = Object.keys(bindings).map(name => source.bindings?.[name] ?? defaults.bindings[name]);
    if (proposed.every(validCode) && new Set(proposed).size === proposed.length) {
      Object.keys(bindings).forEach((name, i) => { out.bindings[name] = proposed[i]; });
    }
    return out;
  }

  function read(name) {
    try { return JSON.parse(root.localStorage.getItem(name)); }
    catch (error) { return null; }
  }

  function write(name, value) {
    try { root.localStorage.setItem(name, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }

  function records() {
    const saved = read(recordKey);
    return {
      progress: number(saved?.progress, 0, 4, 0),
      clears: number(saved?.clears, 0, 999999, 0),
      bestTime: number(saved?.bestTime, 0, 86400, 0),
      bestKills: number(saved?.bestKills, 0, 999999, 0)
    };
  }

  function record(progress, time, kills, cleared) {
    const previous = records();
    previous.progress = Math.max(previous.progress, progress);
    previous.bestKills = Math.max(previous.bestKills, kills);
    if (cleared) {
      previous.clears++;
      previous.bestTime = previous.bestTime ? Math.min(previous.bestTime, time) : time;
    }
    write(recordKey, previous);
    return previous;
  }

  function keyLabel(code) {
    const special = { ShiftLeft: 'Shift', AltLeft: 'Alt', ControlLeft: 'Ctrl', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
    return special[code] || code.replace(/^Key|^Digit/, '');
  }

  function load() { return normalize(read(key)); }

  function attach(initial, onChange, onRebuild) {
    const dialog = document.getElementById('settingsPanel');
    const form = document.getElementById('settingsForm');
    const open = document.getElementById('settingsOpen');
    const status = document.getElementById('settingsStatus');
    const rebuild = document.getElementById('settingsRebuild');
    const keyGrid = document.getElementById('settingsKeys');
    const fields = [...form.elements].filter(element => element.name);
    let settings = initial;
    let binding = '';
    let saveSucceeded = true;
    const boot = { quality: initial.quality, shadows: initial.shadows, textures: initial.textures };
    const keyButtons = {};

    for (const [name, [, label]] of Object.entries(bindings)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'key-setting';
      button.addEventListener('click', () => {
        binding = binding === name ? '' : name;
        refresh();
      });
      button.setAttribute('aria-label', '重新分配' + label);
      keyButtons[name] = button;
      keyGrid.append(button);
    }

    function refresh() {
      for (const field of fields) {
        const value = field.name.startsWith('vol-') ? settings.volumes[field.name.slice(4)] : settings[field.name];
        if (field.type === 'checkbox') field.checked = value;
        else field.value = value;
        if (field.type === 'range') field.parentElement.querySelector('output').value =
          field.name === 'fov' ? value + '°' : Math.round(value * 100) + '%';
      }
      for (const name of Object.keys(bindings)) {
        keyButtons[name].textContent = bindings[name][1] + '  ' + (binding === name ? '按下新键…' : keyLabel(settings.bindings[name]));
        keyButtons[name].setAttribute('aria-pressed', String(binding === name));
      }
      rebuild.hidden = Object.keys(boot).every(name => boot[name] === settings[name]);
      rebuild.disabled = !saveSucceeded;
    }

    function commit(next) {
      settings = normalize(next);
      onChange(settings);
      saveSucceeded = write(key, settings);
      status.textContent = saveSucceeded ? '设置已保存到此浏览器。' : '浏览器禁止保存，设置仅在本页生效。';
      refresh();
    }

    form.addEventListener('input', event => {
      const field = event.target;
      if (!field.name) return;
      const value = field.type === 'checkbox' ? field.checked : field.type === 'range' ? field.valueAsNumber : field.value;
      if (field.name.startsWith('vol-')) {
        commit({ ...settings, volumes: { ...settings.volumes, [field.name.slice(4)]: value } });
      } else commit({ ...settings, [field.name]: value });
    });
    form.addEventListener('submit', event => event.preventDefault());
    open.addEventListener('click', () => {
      refresh();
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', '');
    });
    function close() {
      if (dialog.close) dialog.close();
      else dialog.removeAttribute('open');
      binding = '';
      open.focus();
    }
    document.getElementById('settingsClose').addEventListener('click', close);
    document.getElementById('settingsReset').addEventListener('click', () => commit(defaults));
    rebuild.addEventListener('click', () => onRebuild(settings));
    dialog.addEventListener('keydown', event => {
      if (!binding) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        binding = '';
        refresh();
        return;
      }
      if (!validCode(event.code)) {
        status.textContent = '请选择字母、数字、方向键或空格。I、X、Esc 和 Enter 用于界面与演出。';
        return;
      }
      const next = { ...settings.bindings };
      const previous = Object.keys(next).find(name => next[name] === event.code);
      if (previous) next[previous] = next[binding];
      next[binding] = event.code;
      binding = '';
      commit({ ...settings, bindings: next });
    });
    dialog.addEventListener('close', () => { binding = ''; });
    refresh();
    return dialog;
  }

  root.PBSettings = { load, normalize, attach, record, records, keyLabel };
})(window);
