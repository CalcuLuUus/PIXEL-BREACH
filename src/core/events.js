(function (root) {
  'use strict';

  function create() {
    const channels = new Map();

    return {
      on(type, listener) {
        if (!channels.has(type)) channels.set(type, new Set());
        const listeners = channels.get(type);
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit(type, detail) {
        const listeners = channels.get(type);
        if (!listeners) return;
        for (const listener of listeners) listener(detail, type);
      }
    };
  }

  // Independent generators let a change in decorative particles leave the
  // seeded attack patterns and weapon spread reproducible.
  function rng(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  root.PBEvents = { create, rng };
})(window);
