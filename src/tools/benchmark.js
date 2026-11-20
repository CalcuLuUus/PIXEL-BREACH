(function (root) {
  'use strict';

  const views = {
    // The entrance camera is deliberately low and level: it shows the deck,
    // gate structure, container lane and distant harbor instead of filling the
    // frame with the overhead canopy.
    entrance: { eye: [4.6, 1.85, 16.4], aim: [0, 1.55, -9.5], fov: 72 },
    yard: { eye: [8.6, 2.9, 7.5], aim: [0, 3.15, -8.9], fov: 70 },
    loading: { eye: [4.0, 2.7, -10.1], aim: [14.9, 3.0, -21.8], fov: 72 },
    boss: { eye: [2.4, 2.35, -24.7], aim: [0, 2.85, -36], fov: 67 },
    extraction: { eye: [-4.7, 2.85, -37.4], aim: [1, 3.25, -46.3], fov: 64 }
  };

  function options(params) {
    const view = params.get('capture');
    const capture = Object.prototype.hasOwnProperty.call(views, view) ? view : '';
    const manual = params.get('qa') === '1';
    const benchmark = params.get('benchmark') === '1';
    const fixed = manual || !!capture;
    const hex = params.get('seed');
    const value = hex !== null && /^\d{1,10}$/.test(hex) ? Number(hex) : null;
    const scaleParam = params.get('renderScale');
    const scale = scaleParam !== null && Number.isFinite(Number(scaleParam))
      ? Math.max(.5, Math.min(1, Number(scaleParam))) : null;
    return {
      capture, manual, benchmark, fixed, scale,
      silent: !!capture || params.get('silent') === '1',
      seed: value ?? (fixed || benchmark ? 8027 : null)
    };
  }

  function create(readRender) {
    let job = null;

    function begin(frames = 180) {
      if (job) return Promise.reject(new Error('已有采样正在进行'));
      const count = Number.isFinite(frames) ? Math.max(10, Math.min(600, Math.round(frames))) : 180;
      return new Promise(resolve => {
        job = {
          resolve, durations: new Float32Array(count), size: count, used: 0,
          passes: 0, slowFrames: 0, maxDraws: 0, maxTriangles: 0, maxParticles: 0, maxDecals: 0
        };
      });
    }

    function sample(ms, stats, reflections, particles, decals) {
      if (!job || !(ms > 0 && ms < 1000)) return;
      job.durations[job.used++] = ms;
      if (ms > 25) job.slowFrames++;
      job.maxDraws = Math.max(job.maxDraws, stats.drawCalls);
      job.maxTriangles = Math.max(job.maxTriangles, stats.visibleTriangles);
      job.maxParticles = Math.max(job.maxParticles, particles);
      job.maxDecals = Math.max(job.maxDecals, decals);
      job.passes += reflections;
      if (job.used < job.size) return;
      const task = job;
      job = null;
      const sorted = task.durations.slice().sort();
      const mean = sorted.reduce((sum, value) => sum + value, 0) / task.size;
      task.resolve({
        frames: task.size, meanMs: +mean.toFixed(2), p95Ms: +sorted[Math.floor((task.size - 1) * 0.95)].toFixed(2),
        maxMs: +sorted[task.size - 1].toFixed(2), minimumFps: +(1000 / sorted[task.size - 1]).toFixed(1),
        framesOver25Ms: task.slowFrames, peakDrawCalls: task.maxDraws, peakVisibleTriangles: task.maxTriangles,
        peakParticles: task.maxParticles, peakImpactMarks: task.maxDecals,
        reflectionUpdates: task.passes, renderer: readRender()
      });
    }

    function stop(reason) {
      if (!job) return;
      const task = job;
      job = null;
      task.resolve({ stopped: reason, frames: task.used, renderer: readRender() });
    }

    return { begin, sample, stop, get active() { return !!job; } };
  }

  root.PBBenchmark = { options, create, views };
})(window);
