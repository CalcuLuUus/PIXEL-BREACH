(function (root) {
  'use strict';

  const poses = {
    idle: [0, 0], patrol: [0.06, 0], suspicious: [0.05, 0.12], alert: [0, 0.6],
    move: [0.1, 0.25], seek_cover: [0.16, 0.12], flank: [0.14, 0.25], retreat: [-0.09, 0.23],
    charge: [-0.05, 1], attack: [-0.12, 0.8], hit: [0.20, 0.65],
    stagger: [0.27, 0.1], enraged: [0.12, 1], dead: [0.38, 0]
  };

  const coverPoints = [
    [-7.4, 4.85], [-7.4, 1.95], [-5.42, 3.4], [7.3, -2.35], [7.3, -5.55], [5.2, -3.9],
    [-11, -14], [5.75, -19.5], [9.3, -11.4], [11.5, -24.5], [-12.5, -25], [12, -37], [-12, -38]
  ];

  function createActor() {
    return {
      state: 'idle', age: 0, lean: 0, energy: 0, notice: 0, hold: 0, senseTimer: 0,
      visible: false, alert: false, charge: 0, attack: 0, death: 0, spawn: 0, cooldown: 0,
      cover: null, flank: 1, far: false, originX: 0, originZ: 0,
      vx: 0, vz: 0
    };
  }

  function reset(actor, x, z, side) {
    Object.assign(actor, createActor(), { originX: x, originZ: z, spawn: 0.38, flank: side });
  }

  function transition(actor, next, dt) {
    if (actor.state !== next) {
      actor.age = 0;
      actor.state = next;
    }
    actor.age += dt;
    const [lean, energy] = poses[next];
    const blend = 1 - Math.exp(-dt * 11);
    actor.lean += (lean - actor.lean) * blend;
    actor.energy += (energy - actor.energy) * blend;
  }

  function create(events, canSee, resolve) {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 0, y: 0, z: 0 };

    function alert(enemy, signal) {
      if (enemy.ai.alert) return;
      enemy.ai.alert = true;
      enemy.ai.notice = 1;
      if (signal) events.emit('enemy.alert', { point: enemy.pos, type: enemy.type });
    }

    function sense(enemy, player, others, range, dt) {
      const actor = enemy.ai;
      const spec = PBMission.enemies[enemy.type];
      actor.senseTimer -= dt;
      if (actor.senseTimer > 0) return;
      actor.senseTimer = 0.12;
      from.x = enemy.pos.x;
      from.y = enemy.pos.y + 0.08;
      from.z = enemy.pos.z;
      actor.visible = range < spec.awareness && canSee(from, player);
      if (actor.visible) actor.notice += 0.12;
      else actor.notice = Math.max(0, actor.notice - 0.12);
      if (!actor.alert && (actor.notice >= 0.24 || enemy.flash > 0)) {
        alert(enemy, true);
        for (const other of others) {
          if (!other.dead && other !== enemy && Math.hypot(enemy.pos.x - other.pos.x, enemy.pos.z - other.pos.z) < 13) {
            alert(other, false);
          }
        }
      }
    }

    function pickCover(enemy, player) {
      let best = null;
      let score = 8;
      from.x = player.x;
      from.y = player.y;
      from.z = player.z;
      to.y = enemy.pos.y;
      for (const point of coverPoints) {
        const dist = Math.hypot(point[0] - enemy.pos.x, point[1] - enemy.pos.z);
        if (dist >= score || Math.hypot(point[0] - player.x, point[1] - player.z) < 4) continue;
        to.x = point[0];
        to.z = point[1];
        if (canSee(from, to) || !canSee(enemy.pos, to)) continue;
        best = point;
        score = dist;
      }
      return best;
    }

    function move(enemy, player, others, time, slowF, dt) {
      const actor = enemy.ai;
      const pos = enemy.pos;
      const dx = player.x - pos.x;
      const dz = player.z - pos.z;
      const range = Math.hypot(dx, dz) || 1;
      const ax = dx / range;
      const az = dz / range;
      let state = 'move';
      let vx = 0;
      let vz = 0;
      actor.cooldown = Math.max(0, actor.cooldown - dt);

      if (!actor.alert) {
        state = actor.notice > 0 ? 'suspicious' : 'patrol';
        vx = (actor.originX + Math.sin(time * 0.65 + enemy.bobPhase) * 1.45 - pos.x) * 0.5;
        vz = (actor.originZ + Math.cos(time * 0.65 + enemy.bobPhase) * 1.45 - pos.z) * 0.5;
      } else if (enemy.slow > 0) {
        state = 'stagger';
        vx = ax * -0.25;
        vz = az * -0.25;
      } else if (actor.charge > 0 || actor.attack > 0) {
        state = actor.charge > 0 ? 'charge' : 'attack';
        vx = -az * actor.flank * 0.2;
        vz = ax * actor.flank * 0.2;
      } else {
        if (enemy.hp < enemy.maxHp * 0.48 && actor.cooldown === 0 && actor.visible) {
          actor.cover = pickCover(enemy, player);
          actor.hold = actor.cover ? 1.3 : 0;
          actor.cooldown = 4.3;
        }
        if (actor.hold > 0) {
          actor.hold -= dt;
          state = 'seek_cover';
          vx = actor.cover[0] - pos.x;
          vz = actor.cover[1] - pos.z;
        } else if (!actor.visible) {
          state = 'flank';
          vx = ax * 0.60 - az * actor.flank * 0.95;
          vz = az * 0.60 + ax * actor.flank * 0.95;
        } else {
          const retreat = range < 6.5 || (range < 9 && enemy.hp < enemy.maxHp * 0.36);
          const radial = range > 11.5 ? 1 : retreat ? -0.78 : 0;
          state = retreat ? 'retreat' : 'move';
          const strafe = Math.sin(time * 0.9 + enemy.bobPhase) * 0.81;
          vx = ax * radial - az * strafe;
          vz = az * radial + ax * strafe;
        }
      }

      // Separation is bounded by the existing actor pool; obstruction steering
      // uses collision resolution and a side change instead of a map search.
      for (const other of others) {
        if (other === enemy || other.dead) continue;
        const x = pos.x - other.pos.x;
        const z = pos.z - other.pos.z;
        const distance = Math.hypot(x, z);
        if (distance >= 2.15 || distance < 0.01) continue;
        const push = (2.15 - distance) * 0.72 / distance;
        vx += x * push;
        vz += z * push;
      }
      const norm = Math.max(1, Math.hypot(vx, vz));
      const blend = 1 - Math.exp(-dt * 9);
      actor.vx += (vx / norm - actor.vx) * blend;
      actor.vz += (vz / norm - actor.vz) * blend;
      const oldX = pos.x;
      const oldZ = pos.z;
      const step = enemy.speed * slowF * dt;
      pos.x += actor.vx * step;
      pos.z += actor.vz * step;
      resolve(pos, enemy.radius);
      if (state === 'flank' && actor.cooldown <= 0 &&
          Math.hypot(pos.x - oldX, pos.z - oldZ) < step * 0.22) {
        actor.flank *= -1;
        actor.cooldown = 0.85;
      }
      return state;
    }

    function fireReady(enemy, range, slowF, dt) {
      const actor = enemy.ai;
      const spec = PBMission.enemies[enemy.type];
      if (actor.charge > 0) {
        actor.charge = Math.max(0, actor.charge - dt * slowF);
        if (actor.charge > 0) return false;
        if (!actor.visible || enemy.slow > 0) {
          enemy.fireCd = 0.42;
          return false;
        }
        actor.attack = 0.25;
        return true;
      }
      enemy.fireCd -= dt * slowF;
      if (actor.spawn <= 0 && enemy.fireCd <= 0 && actor.visible && actor.alert &&
          range < spec.awareness && actor.hold <= 0 && enemy.slow <= 0) {
        actor.charge = spec.charge;
      }
      return false;
    }

    return { sense, move, fireReady, alert };
  }

  root.PBEnemyDirector = { create, createActor, reset, transition };
})(window);
