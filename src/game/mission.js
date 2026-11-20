(function (root) {
  'use strict';

  const zones = [
    { id: 'entrance', minZ: 9.5, label: '入口安检区', exposure: 1.10 },
    { id: 'containers', minZ: -8.5, label: '集装箱区', exposure: 1.05 },
    { id: 'loading', minZ: -22.5, label: '装卸维修区', exposure: 1.13 },
    { id: 'boss', minZ: -43.5, label: '开放船坞', exposure: 1.02 },
    { id: 'extraction', minZ: -Infinity, label: '撤离码头', exposure: 1.07 }
  ];

  const objective = {
    entrance: '穿过安检闸口，进入集装箱区',
    wave1: '清除集装箱区封锁',
    transit: '沿钢轨或东侧维修通道前往装卸平台',
    wave2: '摧毁装卸平台的哨兵与炮台',
    approach: '沿干船坞指示前往开放船坞',
    arrival: '警戒，零号守门者正在启动',
    boss1: '击败零号守门者，避开地面预警',
    boss2: '护盾开启时寻找掩护，核心暴露时输出',
    boss3: '跃过冲击波，避开追踪弹和扇形弹幕',
    extract: '前往绿色泊位信标，在出口按交互键撤离',
    complete: '撤离完成'
  };
  const radio = {
    wave1: '安检放行。箱区内探测到四架哨兵。',
    transit: '箱区已清空。东侧维修通道仍可通行。',
    wave2: '装卸区封锁已启动。小心两侧炮台。',
    approach: '装卸区已清空。干船坞出现高能信号。',
    arrival: '零号守门者正在启动。进入掩体。',
    boss2: '护盾循环启动。等待核心暴露。',
    boss3: '核心热量失控。准备避让冲击波。',
    extract: '守门者已解体。七号泊位开放。',
    complete: '撤离确认。船坞链路关闭。'
  };
  const waves = [
    [],
    [
      { delay: 0.5, x: -10, z: 6 }, { delay: 0.8, x: 10, z: 6 },
      { delay: 1.1, x: -10, z: -2 }, { delay: 1.4, x: 10, z: -2 }
    ],
    [
      { delay: 0.4, x: -12, z: -12 }, { delay: 0.65, x: -4, z: -18 },
      { delay: 0.9, x: 3, z: -12 }, { delay: 1.15, x: 2, z: -20 },
      { delay: 1.5, x: -19.5, z: -18.5, y: 1.95 },
      { delay: 1.8, x: 19.5, z: -8.5, y: 1.95 }
    ]
  ];

  // Existing weapon, wave and encounter balance is declared here so that
  // presentation code can subscribe to state changes without owning it.
  const weapons = [
    {
      id: 'rifle', slot: '01', name: '脉冲步枪', en: 'PULSE RIFLE',
      auto: true, magSize: 30, reserveMax: 120,
      dmg: 20, interval: 0.105, reloadTime: 1.25,
      spread: 0.014, pellets: 1, range: 55, color: 0x57f2ff
    },
    {
      id: 'scatter', slot: '02', name: '裂能散射器', en: 'RIFT SCATTER',
      auto: false, magSize: 8, reserveMax: 48,
      dmg: 12, interval: 0.62, reloadTime: 1.1,
      spread: 0.075, pellets: 5, range: 32, color: 0xff4fb8
    },
    {
      id: 'blade', slot: '03', name: '相位刃', en: 'PHASE BLADE',
      melee: true, interval: 0.48, range: 3.0, arc: 0.58, dmg: 56, color: 0x9b6bff,
      slashTime: 0.4, slashHitStart: 0.1, slashHitEnd: 0.23
    }
  ];

  const enemies = {
    sentinel: { awareness: 30, charge: 0.27, fireMin: 1.7, fireMax: 2.5, speed: 3.1, damage: 8 },
    turret: { awareness: 36, charge: 0.48, fireMin: 2.7, fireMax: 3.6, burst: 3, damage: 7 }
  };
  const bossPhases = [
    null,
    { interval: 2.8, anchorTime: 3.4, attacks: ['volley', 'strike', 'volley', 'strike'] },
    { interval: 2.2, anchorTime: 2.9, exposure: 1.7, attacks: ['laser', 'volley', 'laser', 'strike'] },
    { interval: 1.65, anchorTime: 1.85, exposure: 1.35, attacks: ['missiles', 'shockwave', 'laser', 'expose', 'volley', 'shockwave'] }
  ];
  const anchors = [[0, -34], [-13, -28.5], [13, -28.5], [-13.5, -39.5], [13.5, -39.5], [0, -26.5]];
  const attackNames = {
    volley: '△ 弹幕 · 横向移动', strike: '◎ 地面打击 · 离开标记',
    laser: '║ 激光 · 离开亮线', missiles: '◇ 追踪弹 · 走位或击落',
    shockwave: '≈ 冲击波 · 跳过波前', expose: '⊙ 核心暴露 · 集火'
  };

  function zoneAt(z) {
    for (const zone of zones) if (z > zone.minZ) return zone;
    return zones[zones.length - 1];
  }

  function create(events) {
    let node = 'entrance';
    const flow = {
      wave: 0,
      clearT: -1,
      bossActive: false,
      get node() { return node; },
      setNode(next, force = false) {
        if (node === next && !force) return;
        node = next;
        events.emit('mission.objectiveChange', { node, objective: objective[node], caption: radio[node] });
      },
      reset() {
        this.wave = 0;
        this.clearT = -1;
        this.bossActive = false;
        this.setNode('entrance', true);
      },
      update(dt, z, combatants, startWave, startBoss) {
        if (node === 'entrance' && z <= zones[0].minZ) {
          startWave(1);
        } else if ((node === 'wave1' || node === 'wave2') && combatants === 0) {
          if (this.clearT < 0) this.clearT = 2.1;
          this.clearT -= dt;
          if (this.clearT <= 0) this.setNode(this.wave === 1 ? 'transit' : 'approach');
        } else if (node === 'transit' && z <= zones[1].minZ) {
          startWave(2);
        } else if (node === 'approach' && z <= zones[2].minZ) {
          startBoss();
        }
      }
    };
    return flow;
  }

  root.PBMission = { create, zoneAt, zones, waves, weapons, enemies, bossPhases, anchors, attackNames };
})(window);
