// A stand-in for the meter's plugin SDK (/_sdk/a2.js) to look at a plugin's
// page in a browser without the meter: every call answers, nothing reaches
// out. Events are emitted by hand: a2.emit("character", {...}, meta).
// What a plugin did is kept for checks: window.__shares (a2.share),
// window.__notes (a2.notify), window.__opened (links), window.__store.
(() => {
  const handlers = {};
  // Optional answers set before the page (shot.mjs: WEB_FIXTURES, STORE):
  // window.__preset = { web: { "<url or its start>": answer }, store: {...} }.
  const preset = window.__preset || {};
  const store = (window.__store = { ...(preset.store || {}) });
  const webAnswer = (url) => {
    const web = preset.web || {};
    if (url in web) return structuredClone(web[url]);
    const key = Object.keys(web).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    return key ? structuredClone(web[key]) : null;
  };
  // A grey square for any picture (the harness reaches no image server).
  const GREY = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#3a3f47"/></svg>');
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
    web: { get: async (url) => webAnswer(url), image: async () => GREY },
    bossTimers: async () => null,
    abyssSiege: async () => null,
    followBosses: async () => { throw new Error("not in this build"); },
    window: { show: ok, hide: ok, fit: ok, size: ok },
    // The widgets opened and what was sent to them: window.__widgets.
    widgets: {
      open: async (name) => { (window.__widgets ||= {})[name] = { open: true, sent: [] }; },
      close: async (name) => { if (window.__widgets?.[name]) window.__widgets[name].open = false; },
      send: async (name, data) => { window.__widgets?.[name]?.sent.push(data); },
      lock: ok, locked: async () => false, place: ok, list: async () => [],
    },
    // A widget page's own calls (PAGE=widget.html): what it posts is kept in window.__posts.
    widget: { resize: ok, area: ok, drag: ok, post: async (m) => { (window.__posts ||= []).push(m); } },
    watchFps: ok,
  };
  window.open = (u) => { window.__opened.push(u); };
})();
