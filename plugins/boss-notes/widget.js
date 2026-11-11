// Boss Notes' overlay: the boss, its HP, the phase now and what to do, the
// alerts with their seconds, and the next phase, as the plugin's window sends
// them (plugin.js). Dragged by its head, sized from its lower corners; the
// slider sets how much of the game shows through.
(() => {
  const $ = (s) => document.querySelector(s);
  let locked = false;
  let opacityTouched = 0;
  let state = null;
  let got = 0;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  let lastKey = "";
  function draw() {
    const v = state?.view;
    const look = state?.look || {};
    document.body.style.setProperty("--s", `${Math.max(12, Math.min(40, look.size || 20))}px`);
    if (Date.now() - opacityTouched > 1500) applyOpacity(look.opacity ?? 0.86);
    for (const b of document.querySelectorAll(".slots button")) {
      const saved = !!state?.slots?.[Number(b.dataset.slot)];
      b.classList.toggle("saved", saved);
      b.title = saved ? `Go to place ${Number(b.dataset.slot) + 1} (right-click: keep this place there instead)` : `Right-click: keep this place as place ${Number(b.dataset.slot) + 1}`;
    }
    const since = Date.now() - got;
    $(".title").textContent = v ? v.name : "Boss Notes";
    $(".hp").textContent = v && v.hp != null ? `${v.hp.toFixed(v.hp < 10 ? 1 : 0)} %` : "";
    $(".time").textContent = v && v.elapsed != null && !v.idle ? clock(v.elapsed + since) : v?.idle ? "last boss" : "";
    $(".hpBar").hidden = !(v && v.hp != null);
    $(".hpBar > i").style.width = `${v?.hp ?? 0}%`;
    const alerts = (v?.alerts || []).map((a) => ({ ...a, left: a.left ? a.left - since : 0 })).filter((a) => !a.ms || a.left > 0);
    const key = JSON.stringify([v?.name, v?.phase, v?.next, v?.notes, alerts.map((a) => [a.id, a.name, a.text]), look.showNext, look.showNotes, v?.hasSheet]);
    if (key !== lastKey) {
      lastKey = key;
      const out = [];
      if (!v) {
        out.push(el("div", "empty", locked ? "" : "Boss Notes: waiting for a boss fight. Drag me where you want me."));
      } else {
        for (const a of alerts) {
          const box = el("div", "alert");
          const big = el("div", "big");
          big.append(document.createTextNode(a.name || "Alert"));
          if (a.ms) {
            big.append(document.createTextNode(" — "));
            big.append(el("span", "secs"));
          }
          box.append(big);
          if (a.text) box.append(el("div", "small", a.text));
          box.dataset.id = a.id;
          out.push(box);
        }
        if (v.phase) {
          const box = el("div", "phase");
          box.append(el("div", "big", v.phase.name || "Phase"));
          if (v.phase.text) box.append(el("div", "small", v.phase.text));
          out.push(box);
        } else if (!v.hasSheet && !v.idle) {
          out.push(el("div", "empty", "No notes for this boss yet (✎ to write them)."));
        }
        if (look.showNext !== false && v.next) out.push(el("div", "next", `Next: ${v.next.name || "Phase"} · ${v.next.when}`));
        if (look.showNotes !== false && v.notes) out.push(el("div", "notes", v.notes));
      }
      $(".body").replaceChildren(...out);
    }
    for (const box of document.querySelectorAll(".alert")) {
      const a = alerts.find((x) => x.id === box.dataset.id);
      const s = box.querySelector(".secs");
      if (a && s) s.textContent = a.left >= 10000 ? `${Math.ceil(a.left / 1000)} s` : `${(Math.max(0, a.left) / 1000).toFixed(1)} s`;
    }
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
  $(".edit").addEventListener("click", () => a2.widget.post({ type: "edit" }).catch(() => {}));
  for (const b of document.querySelectorAll(".slots button")) {
    b.addEventListener("click", () => a2.widget.post({ type: "slot", slot: Number(b.dataset.slot) }).catch(() => {}));
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      b.classList.add("kept");
      setTimeout(() => b.classList.remove("kept"), 600);
      a2.widget.post({ type: "slot-save", slot: Number(b.dataset.slot) }).catch(() => {});
    });
  }
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
  a2.on("widget", (data) => {
    state = data;
    got = Date.now();
    draw();
  });
  a2.on("locked", (on) => {
    locked = !!on;
    document.body.classList.toggle("locked", locked);
    lastKey = "";
    draw();
  });
  // The seconds count down here between the window's messages.
  setInterval(draw, 100);

  applyOpacity(0.86);
  claim();
  a2.ready().then(() => a2.widget.post({ type: "ready" }).catch(() => {}));
})();
