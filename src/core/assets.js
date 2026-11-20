(function (root) {
  'use strict';

  const DEFAULT_NAMESPACE = 'core';

  function text(value, fallback) {
    const result = String(value == null ? '' : value).trim();
    return result || fallback;
  }

  function create() {
    const namespaces = new Map();
    const errors = [];
    let sequence = 0;
    let reuses = 0;

    function noteError(namespace, id, error, stage) {
      const message = error && error.message ? error.message : String(error);
      const entry = {
        namespace,
        id,
        stage: stage || 'register',
        message: message || '未知资产错误'
      };
      errors.push(entry);
      return entry;
    }

    function names(namespace) {
      const key = text(namespace, DEFAULT_NAMESPACE);
      let assets = namespaces.get(key);
      if (!assets) {
        assets = new Map();
        namespaces.set(key, assets);
      }
      return [key, assets];
    }

    function parse(namespace, id, source, metadata) {
      if (namespace && typeof namespace === 'object') {
        const spec = namespace;
        return {
          namespace: text(spec.namespace, DEFAULT_NAMESPACE),
          id: text(spec.id || spec.key || spec.name, ''),
          source: Object.prototype.hasOwnProperty.call(spec, 'source') ? spec.source : spec.value,
          metadata: spec.metadata || {}
        };
      }
      return {
        namespace: text(namespace, DEFAULT_NAMESPACE),
        id: text(id, ''),
        source,
        metadata: metadata || {}
      };
    }

    function register(namespace, id, source, metadata) {
      // Explicit form is register(namespace, id, value, metadata). A two- or
      // three-argument call with a non-string second argument is shorthand for
      // the core namespace: register(id, value[, metadata]).
      if (typeof namespace === 'string' && arguments.length < 4 &&
          (arguments.length === 2 || typeof id !== 'string')) {
        metadata = source;
        source = id;
        id = namespace;
        namespace = DEFAULT_NAMESPACE;
      }
      const spec = parse(namespace, id, source, metadata);
      if (!spec.id) {
        noteError(spec.namespace, spec.id || '<missing>',
          new TypeError('资产必须提供非空 id'), 'register');
        return undefined;
      }
      if (spec.source === undefined) {
        noteError(spec.namespace, spec.id, new TypeError('资产值不能为空'), 'register');
        return undefined;
      }
      const pair = names(spec.namespace);
      const assets = pair[1];
      const previous = assets.get(spec.id);
      if (previous) {
        previous.reuses++;
        previous.refCount++;
        reuses++;
        return previous.value;
      }

      const record = {
        namespace: spec.namespace,
        id: spec.id,
        metadata: Object.assign({}, spec.metadata),
        status: 'ready',
        value: undefined,
        error: '',
        reuses: 0,
        refCount: 1,
        sequence: ++sequence
      };
      assets.set(spec.id, record);

      try {
        // A function is a lazy local loader. It is evaluated exactly once and
        // its result is retained, so callers never create duplicate resources.
        record.value = typeof spec.source === 'function' ? spec.source() : spec.source;
        if (record.value && typeof record.value.then === 'function') {
          record.status = 'pending';
          record.value.then(value => {
            record.value = value;
            record.status = 'ready';
            return value;
          }).catch(error => {
            record.value = undefined;
            record.status = 'failed';
            record.error = noteError(record.namespace, record.id, error, 'load').message;
          });
        }
      } catch (error) {
        record.value = undefined;
        record.status = 'failed';
        record.error = noteError(record.namespace, record.id, error, 'load').message;
      }
      return record.value;
    }

    function find(namespace, id) {
      const ns = text(namespace, DEFAULT_NAMESPACE);
      const assets = namespaces.get(ns);
      return assets ? assets.get(text(id, '')) : undefined;
    }

    function get(namespace, id, fallback) {
      // `get(id)` and `get(id, fallback)` address the core namespace. With two
      // arguments, an already-known namespace selects the explicit form.
      if (arguments.length === 1 || arguments.length === 2 && !namespaces.has(text(namespace, DEFAULT_NAMESPACE))) {
        fallback = arguments.length === 2 ? id : undefined;
        id = namespace;
        namespace = DEFAULT_NAMESPACE;
      }
      const record = find(namespace, id);
      if (!record || record.status !== 'ready') return fallback;
      return record.value;
    }

    function has(namespace, id) {
      if (arguments.length < 2) {
        id = namespace;
        namespace = DEFAULT_NAMESPACE;
      }
      return Boolean(find(namespace, id));
    }

    function describe(record) {
      return {
        namespace: record.namespace,
        id: record.id,
        status: record.status,
        metadata: Object.assign({}, record.metadata),
        error: record.error,
        reuses: record.reuses,
        refCount: record.refCount,
        sequence: record.sequence
      };
    }

    function manifest(namespace) {
      const output = {};
      const selected = namespace == null
        ? Array.from(namespaces.entries())
        : [[text(namespace, DEFAULT_NAMESPACE), namespaces.get(text(namespace, DEFAULT_NAMESPACE))]];
      for (const pair of selected) {
        const ns = pair[0];
        const assets = pair[1];
        if (!assets) continue;
        output[ns] = {};
        for (const [id, record] of assets) output[ns][id] = describe(record);
      }
      return output;
    }

    function snapshot() {
      let total = 0;
      let ready = 0;
      let pending = 0;
      let failed = 0;
      for (const assets of namespaces.values()) {
        total += assets.size;
        for (const record of assets.values()) {
          if (record.status === 'ready') ready++;
          else if (record.status === 'pending') pending++;
          else if (record.status === 'failed') failed++;
        }
      }
      return {
        namespaces: namespaces.size,
        assets: total,
        ready,
        pending,
        failed,
        reuses,
        errors: errors.map(error => Object.assign({}, error))
      };
    }

    function release(namespace, id) {
      if (arguments.length < 2) {
        id = namespace;
        namespace = DEFAULT_NAMESPACE;
      }
      const key = text(namespace, DEFAULT_NAMESPACE);
      const assets = namespaces.get(key);
      const record = assets && assets.get(text(id, ''));
      if (!record) return false;
      record.refCount = Math.max(0, record.refCount - 1);
      if (record.refCount > 0) return false;
      assets.delete(record.id);
      if (!assets.size) namespaces.delete(key);
      return true;
    }

    function clear(namespace) {
      if (namespace == null) {
        const count = snapshot().assets;
        namespaces.clear();
        return count;
      }
      const key = text(namespace, DEFAULT_NAMESPACE);
      const assets = namespaces.get(key);
      if (!assets) return 0;
      const count = assets.size;
      namespaces.delete(key);
      return count;
    }

    return { register, get, has, manifest, snapshot, release, clear };
  }

  const api = create();
  api.create = create;
  root.PBAssets = api;
})(window);
