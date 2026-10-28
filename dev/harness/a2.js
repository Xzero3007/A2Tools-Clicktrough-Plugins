// A stand-in for the meter's plugin SDK (/_sdk/a2.js) to look at a plugin's
// page in a browser without the meter: every call answers, nothing reaches
// out. Events are emitted by hand: a2.emit("character", {...}, meta).
// What a plugin did is kept for checks: window.__shares (a2.share),
// window.__notes (a2.notify), window.__opened (links), window.__store.
(() => {
  const handlers = {};
  const store = (window.__store = {});
  window.__shares = [];
  window.__notes = [];
  window.__opened = [];
  const ok = async () => {};
  window.a2 = {
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    emit(ev, data, meta) { for (const fn of handlers[ev] || []) fn(data, meta); },
    ready: ok,
    notify: async (text) => { window.__notes.push(text); },
    storage: {
      get: async (k) => (k in store ? structuredClone(store[k]) : null),
      set: async (k, v) => { store[k] = structuredClone(v); },
      keys: async () => Object.keys(store),
      remove: async (k) => { delete store[k]; },
    },
    share: async (v) => { window.__shares.push(v); },
    file: async () => null,
    web: { get: async () => null },
    bossTimers: async () => null,
    abyssSiege: async () => null,
    followBosses: async () => { throw new Error("not in this build"); },
    window: { show: ok, hide: ok, fit: ok, size: ok },
    widgets: { open: ok, close: ok, send: ok, lock: ok, place: ok, list: async () => [] },
    widget: { resize: ok },
    watchFps: ok,
  };
  window.open = (u) => { window.__opened.push(u); };
})();
