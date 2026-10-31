// The Inventory plugin's floater: the limits and keys picked in its window
// (Kinah today, the week's Abyss Points, entry counts), each with its bar.
// It hears the plugin's window (plugin.js) when they change. Dragged by its
// head; a side dragged sets the width (the plugin fits the height); the
// slider sets how much of the game shows through.
(() => {
  const $ = (s) => document.querySelector(s);
  let locked = false;
  let opacityTouched = 0;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function draw(state) {
    const rows = Array.isArray(state?.rows) ? state.rows : [];
    $(".title").textContent = state?.who ? `Limits · ${state.who}` : "Limits";
    const list = rows.map((r) => {
      const li = el("li");
      const full = r.max && r.value >= r.max;
      if (full) li.classList.add("full");
      li.title = r.title || r.label;
      li.append(el("span", "lbl", r.label), el("span", "val", r.text));
      if (r.max) {
        const bar = el("span", "bar");
        const fill = el("i");
        fill.style.width = `${Math.max(0, Math.min(100, (r.value / r.max) * 100))}%`;
        bar.append(fill);
        li.append(bar);
      }
      return li;
    });
    $(".rows").replaceChildren(...(list.length ? list : [el("li", "empty", state?.empty || "Nothing to show yet")]));
    if (Date.now() - opacityTouched > 1500) applyOpacity(state?.opacity ?? 0.86);
  }

  function applyOpacity(value) {
    const v = Math.max(0.2, Math.min(1, Number(value) || 0.86));
    document.body.style.setProperty("--alpha", String(v));
    const slider = $(".opacity");
    if (document.activeElement !== slider) slider.value = String(Math.round(v * 100));
  }

  const claim = () => a2.widget.area({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }).catch(() => {});
  new ResizeObserver(claim).observe(document.body);

  $(".head").addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button, input") || locked) return;
    e.preventDefault();
    a2.widget.drag().catch(() => {});
  });
  $(".close").addEventListener("click", () => a2.widget.post({ type: "close" }).catch(() => {}));
  $(".opacity").addEventListener("input", () => {
    opacityTouched = Date.now();
    const v = Number($(".opacity").value) / 100;
    applyOpacity(v);
    a2.widget.post({ type: "opacity", value: v }).catch(() => {});
  });
  const canResize = typeof a2.widget.resize === "function";
  document.body.classList.toggle("noResize", !canResize);
  for (const c of document.querySelectorAll(".corner")) {
    c.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || locked || !canResize) return;
      e.preventDefault();
      e.stopPropagation();
      a2.widget.resize(c.dataset.edge).catch(() => {});
    });
  }
  a2.on("resized", (size) => {
    if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) {
      a2.widget.post({ type: "resized", width: size.width, height: size.height }).catch(() => {});
    }
  });
  a2.on("widget", (data) => draw(data));
  a2.on("locked", (on) => {
    locked = !!on;
    document.body.classList.toggle("locked", locked);
  });

  applyOpacity(0.86);
  claim();
  a2.ready().then(() => a2.widget.post({ type: "ready" }).catch(() => {}));
})();
