(function (root) {
  'use strict';

  const shots = {
    arrival: { label: '零号守门者启动', seconds: 1.45, fov: -5, pan: 0.11 },
    phase: { label: '守门者装甲重构', seconds: 1.12, fov: -2.2, pan: 0.02 },
    enrage: { label: '核心过载', seconds: 1.05, fov: -3.1, pan: 0.03 },
    extract: { label: '七号泊位开放', seconds: 1.45, fov: -4, pan: 0.08 },
    lost: { label: '', seconds: 0.95, fov: -7, pan: 0, roll: -0.08 },
    won: { label: '', seconds: 1.2, fov: -6, pan: 0.26 }
  };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function create(THREE, events, camera, stage, tag) {
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const point = new THREE.Vector3();
    let shot = null;
    let elapsed = 0;
    let reduced = false;
    let id = '';
    let sourceFov = 74;

    function finish() {
      shot = null;
      id = '';
      tag.hidden = true;
      stage.classList.remove('is-cinematic');
    }

    function begin(next, target) {
      if (reduced) return;
      shot = shots[next];
      id = next;
      elapsed = 0;
      sourceFov = camera.fov;
      if (target) point.copy(target);
      tag.textContent = shot.label ? shot.label + '  ·  X 跳过' : 'X 跳过镜头';
      tag.hidden = !shot.label;
      stage.classList.add('is-cinematic');
    }

    events.on('boss.arrival', detail => begin('arrival', detail.point));
    events.on('boss.phaseChange', detail => {
      if (detail.phase > 1) begin(detail.phase === 3 ? 'enrage' : 'phase', detail.point);
    });
    events.on('exit.unlock', detail => begin('extract', detail.point));
    events.on('run.lost', detail => begin('lost', detail.point));
    events.on('run.won', detail => begin('won', detail.point));

    return {
      configure(value) { reduced = value; if (value) finish(); },
      skip: finish,
      update(dt, yaw, pitch, inPlay, targetFov, aiming) {
        if (!shot) return;
        elapsed += dt;
        const progress = clamp(elapsed / shot.seconds, 0, 1);
        const blend = Math.sin(progress * Math.PI);
        if (shot.roll) camera.position.y -= dt * 0.32;
        const x = point.x - camera.position.x;
        const z = point.z - camera.position.z;
        const toYaw = Math.atan2(-x, -z);
        const toPitch = Math.atan2(point.y - camera.position.y, Math.hypot(x, z));
        const dz = Math.atan2(Math.sin(toYaw - yaw), Math.cos(toYaw - yaw));
        // Input always wins: only blend a small offset while the player is
        // already facing the subject and their mouse is idle.
        const pan = !aiming && Math.abs(dz) < (inPlay ? 0.75 : Math.PI) ? shot.pan * blend : 0;
        euler.set(pitch + clamp(toPitch - pitch, -0.16, 0.16) * pan,
          yaw + clamp(dz, -0.65, 0.65) * pan, (shot.roll || 0) * blend, 'YXZ');
        camera.quaternion.setFromEuler(euler);
        camera.fov = (inPlay ? targetFov : sourceFov) + shot.fov * blend;
        camera.updateProjectionMatrix();
        if (progress >= 1) finish();
      },
      snapshot() { return { current: id, elapsed, reduced }; }
    };
  }

  root.PBCinematics = { create };
})(window);
