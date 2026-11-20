(function (root) {
  'use strict';

  function create(min, max, enabled, resize) {
    const samples = new Float32Array(90);
    let cursor = 0;
    let count = 0;
    let sum = 0;
    let above = 0;
    let below = 0;
    let cooldown = 1.5;

    const controller = {
      enabled, min, max, scale: max, targetFrameTime: 16.6,
      lastFrameMs: 0, averageFrameMs: 0, peakFrameMs: 0,
      changes: 0, reason: '起始渲染分辨率', failed: false,
      apply(scale, reason) {
        if (scale === this.scale) return;
        if (!resize(scale)) {
          this.failed = true;
          this.reason = '渲染目标分配失败，保留上一个有效分辨率';
          return;
        }
        this.scale = scale;
        this.reason = reason;
        this.failed = false;
        this.changes++;
        above = below = 0;
        cooldown = 1.5;
      },
      configure(automatic, ceiling) {
        this.enabled = automatic;
        this.max = ceiling;
        this.min = Math.min(min, ceiling);
        this.failed = false;
        if (!automatic || this.scale > ceiling) this.apply(ceiling, '手动画质设置');
      },
      update(ms, stressed) {
        // Ignore the artificial gap after a background tab, pause or debugger.
        if (!(ms > 0 && ms < 1000)) return;
        sum -= samples[cursor];
        samples[cursor] = ms;
        sum += samples[cursor];
        cursor = (cursor + 1) % samples.length;
        count = Math.min(count + 1, samples.length);
        this.lastFrameMs = ms;
        this.averageFrameMs = sum / count;
        this.peakFrameMs = 0;
        for (let i = 0; i < count; i++) this.peakFrameMs = Math.max(this.peakFrameMs, samples[i]);
        if (!this.enabled || this.failed || count < 20) return;
        const elapsed = Math.min(ms / 1000, 0.1);
        cooldown = Math.max(0, cooldown - elapsed);
        above = this.averageFrameMs > (stressed ? 18.8 : 20) ? above + elapsed : 0;
        below = !stressed && this.averageFrameMs < 17.3 ? below + elapsed : 0;
        if (cooldown > 0) return;
        if (above >= 0.6 && this.scale > this.min) {
          this.apply(Math.max(this.min, Math.round((this.scale - 0.05) * 100) / 100), '持续高于目标帧时间');
        } else if (below >= 1.8 && this.scale < this.max) {
          this.apply(Math.min(this.max, Math.round((this.scale + 0.05) * 100) / 100), '帧时间恢复，提升分辨率');
        }
      },
      snapshot() {
        return {
          enabled: this.enabled && !this.failed, targetFrameTime: this.targetFrameTime,
          scale: this.scale, lastFrameMs: +this.lastFrameMs.toFixed(2),
          averageFrameMs: +this.averageFrameMs.toFixed(2), peakFrameMs: +this.peakFrameMs.toFixed(2),
          changeCount: this.changes, degraded: this.scale < this.max, reason: this.reason
        };
      }
    };
    return controller;
  }

  root.PBResolution = { create };
})(window);
