// Boss Notes: the window. Your sheets (notes, phases, alerts) per boss, the
// fight now as the cheat sheet shows it, the recorded fights, and the
// overlay over the game (widget.html), sent what to show four times a second
// while a fight goes on.
(() => {
  const D = window.BOSS_CALLOUTS;
  const L = window.BossNotes;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const DEFAULTS = { tab: "now", overlay: false, size: 20, showNext: true, showNotes: true, showIdle: false, keep: 10, slots: [null, null, null], width: 340, height: 170, opacity: 0.86, picked: null, onlyMine: false };
  let settings = { ...DEFAULTS };
  let sheets = {}; // key -> { name?, notes, entries } (your own; a starter sheet until changed)
  let fights = []; // recorded fights, newest first
  let lang = "en";
  let starters = L.starters(D, lang);
  let openFight = null; // id of the fight shown in Fights
  let lastBoss = null; // the last fight's boss, for the overlay between fights

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k);
    return n;
  };
  const fill = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const T = (i) => (i == null ? "" : (D.texts[i] && (D.texts[i][lang] || D.texts[i].en)) || "");
  const fmt = L.fmtTime;
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ---------- storage ----------
  let saveTimer = 0;
  const saveSettings = () => a2.storage.set("settings", settings).catch(() => {});
  const saveSheets = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => a2.storage.set("sheets", sheets).catch(() => {}), 400);
  };
  const saveFights = () => a2.storage.set("fights", fights).catch(() => {});

  function sheetOf(key) {
    return sheets[key] || starters[key] || null;
  }
  // Your own copy of a sheet, made when you first change it.
  function own(key, name) {
    if (!sheets[key]) {
      const s = starters[key];
      sheets[key] = s ? JSON.parse(JSON.stringify({ notes: s.notes, entries: s.entries })) : { notes: "", entries: [] };
    }
    if (name && key.startsWith("npc-") && !sheets[key].name) sheets[key].name = name;
    return sheets[key];
  }
  function bossName(key) {
    const b = D.bosses[key];
    if (b) return T(b.n);
    return (sheets[key] && sheets[key].name) || fights.find((f) => f.key === key)?.name || key;
  }
  function groupName(key) {
    const b = D.bosses[key];
    const g = b && D.groups[b.g];
    return g ? T(g.n) : "Other bosses";
  }

  // ---------- the engine ----------
  const engine = L.create(D, {
    now: () => Date.now(),
    sheet: sheetOf,
    allEntries: () => [...Object.values(sheets), ...Object.values(starters)].flatMap((s) => s.entries || []),
    done(record) {
      lastBoss = record.key;
      if (record.events.length < 2 && record.end - record.start < 5000) return; // a stray hit
      fights.unshift(record);
      fights = fights.slice(0, settings.keep || 10);
      saveFights();
      if (settings.tab === "fights") renderFights();
    },
    changed() { dirty = true; },
  });
  let dirty = true;

  const atOf = (meta) => (meta && typeof meta.at === "number" ? meta.at : Date.now());
  a2.on("combat", (ev) => engine.combat(ev));
  a2.on("decoded:cast", (d, meta) => engine.cast(d, atOf(meta)));
  a2.on("decoded:skill", (d, meta) => engine.skill(d, atOf(meta)));
  a2.on("decoded:buff-added", (d, meta) => engine.added(d, atOf(meta)));
  a2.on("decoded:buff-removed", (d, meta) => engine.removed(d, atOf(meta)));
  a2.on("language", (code) => {
    const c = String(code || "en");
    lang = D.langs.includes(c) ? c : D.langs.includes(c.split("-")[0]) ? c.split("-")[0] : "en";
    starters = L.starters(D, lang);
    render();
  });

  // ---------- what the cheat sheet shows ----------
  function view() {
    const s = engine.state(lang);
    if (s.fight) {
      lastBoss = s.fight.key;
      return { ...s, idle: false };
    }
    if (settings.showIdle && lastBoss) {
      const sh = sheetOf(lastBoss) || { notes: "", entries: [] };
      const first = (sh.entries || []).find((e) => e.kind !== "alert");
      return { fight: { key: lastBoss, name: bossName(lastBoss), hp: null, elapsed: 0 }, idle: true, notes: sh.notes || "", phase: null, next: first ? { name: first.name, when: L.describe(first.when) } : null, alerts: [], hasSheet: !!(sh.entries?.length || sh.notes) };
    }
    return { fight: null, idle: true, alerts: [] };
  }

  function renderNow() {
    const v = view();
    const box = $(".live");
    if (!v.fight) {
      fill(box, el("p", { class: "note", text: "No boss fight now. When you fight a boss, its phase and what to do show here and in the overlay. Write your notes for a boss in Sheets; every fight is recorded in Fights." }));
      return;
    }
    const f = v.fight;
    const hp = f.hp == null ? "" : `${f.hp.toFixed(f.hp < 10 ? 1 : 0)} %`;
    fill(box,
      el("div", { class: "liveHead" },
        el("strong", { class: "liveName", text: f.name || bossName(f.key) }),
        el("span", { class: "muted", text: v.idle ? "last boss" : [hp, fmt(f.elapsed)].filter(Boolean).join(" · ") }),
        el("span", { class: "grow" }),
        el("button", { type: "button", text: "Edit sheet", onclick: () => openSheet(f.key, f.name) }),
      ),
      f.hp != null ? el("div", { class: "hpBar" }, el("i", { style: `width:${f.hp}%` })) : null,
      ...v.alerts.map((a) => el("div", { class: "alert" }, el("div", { class: "aName", text: `${a.name}${a.left ? ` — ${Math.ceil(a.left / 1000)} s` : ""}` }), a.text ? el("div", { class: "aText", text: a.text }) : null)),
      v.phase
        ? el("div", { class: "phase" }, el("div", { class: "pName", text: v.phase.name || "Phase" }), v.phase.text ? el("div", { class: "pText", text: v.phase.text }) : null)
        : v.hasSheet && !v.hasPhases ? null : el("div", { class: "phase none" }, el("div", { class: "pText", text: v.hasSheet ? "No phase started yet." : "No notes for this boss yet: add them in Sheets, or from this fight's recording in Fights." })),
      v.next ? el("div", { class: "nextLine" }, el("span", { class: "muted", text: "Next: " }), `${v.next.name || "Phase"} · ${v.next.when}`) : null,
      v.notes ? el("div", { class: "notes", text: v.notes }) : null,
    );
  }

  // ---------- the overlay ----------
  let widgetOpen = false;
  let lastSent = "";
  const size = () => ({ width: Math.max(200, Math.min(900, settings.width || 340)), height: Math.max(90, Math.min(900, settings.height || 170)) });
  async function applyOverlay() {
    try {
      if (settings.overlay) {
        await a2.widgets.open("sheet", size());
        await a2.widgets.lock(false);
        widgetOpen = true;
        lastSent = "";
        send();
      } else {
        widgetOpen = false;
        await a2.widgets.close("sheet");
      }
    } catch (e) {
      console.error(e);
    }
  }
  function send() {
    if (!widgetOpen) return;
    const v = view();
    const msg = {
      look: { size: settings.size, opacity: settings.opacity, showNext: settings.showNext, showNotes: settings.showNotes },
      slots: (settings.slots || []).map(Boolean),
      view: v.fight
        ? { name: v.fight.name || bossName(v.fight.key), hp: v.fight.hp, elapsed: v.idle ? null : v.fight.elapsed, idle: v.idle, phase: v.phase, next: v.next, notes: v.notes, alerts: v.alerts, hasSheet: v.hasSheet }
        : null,
    };
    const text = JSON.stringify(msg);
    if (text === lastSent) return;
    lastSent = text;
    a2.widgets.send("sheet", msg).catch(() => {});
  }
  a2.on("widget-message", ({ name, data }) => {
    if (name !== "sheet" || !data) return;
    if (data.type === "ready") {
      lastSent = "";
      send();
    } else if (data.type === "close") {
      settings.overlay = false;
      saveSettings();
      applyOverlay();
      $(".overlayOn").checked = false;
    } else if (data.type === "opacity" && Number.isFinite(data.value)) {
      settings.opacity = Math.max(0.2, Math.min(1, data.value));
      saveSettings();
    } else if (data.type === "resized" && Number.isFinite(data.width)) {
      settings.width = Math.round(data.width);
      settings.height = Math.round(data.height);
      saveSettings();
    } else if (data.type === "slot" && Number.isInteger(data.slot)) {
      goToSlot(data.slot);
    } else if (data.type === "slot-save" && Number.isInteger(data.slot)) {
      saveSlot(data.slot);
    } else if (data.type === "edit") {
      a2.window.show().catch(() => {});
      const v = view();
      if (v.fight) openSheet(v.fight.key, v.fight.name);
    }
  });
  async function saveSlot(n) {
    let at = null;
    try { at = await a2.widgets.where("sheet"); } catch {}
    if (!at || !Number.isFinite(at.x)) return;
    const slots = [...(settings.slots || [null, null, null])];
    slots[n] = { x: Math.round(at.x), y: Math.round(at.y), width: settings.width, height: settings.height };
    settings.slots = slots;
    saveSettings();
    lastSent = "";
    send();
  }
  async function goToSlot(n) {
    const slot = settings.slots?.[n];
    if (!slot) return;
    if (Number.isFinite(slot.width)) settings.width = slot.width;
    if (Number.isFinite(slot.height)) settings.height = slot.height;
    saveSettings();
    try {
      await a2.widgets.place("sheet", { x: slot.x, y: slot.y });
      if (widgetOpen) await a2.widgets.open("sheet", size());
    } catch {}
  }
  a2.on("overlay", (data) => {
    settings.overlay = !!data?.show;
    $(".overlayOn").checked = settings.overlay;
    saveSettings();
    applyOverlay();
  });
  $(".overlayOn").addEventListener("change", (e) => {
    settings.overlay = e.target.checked;
    saveSettings();
    applyOverlay();
  });

  // ---------- Sheets ----------
  function bossKeys() {
    const keys = new Set(Object.keys(D.bosses));
    for (const k of Object.keys(sheets)) keys.add(k);
    for (const f of fights) keys.add(f.key);
    return [...keys];
  }
  function renderBossList() {
    const q = L.norm($(".find").value);
    const mine = settings.onlyMine;
    const has = (k) => {
      const s = sheetOf(k);
      return !!(s && ((s.entries && s.entries.length) || s.notes));
    };
    const rows = bossKeys()
      .map((k) => ({ k, name: bossName(k), group: groupName(k) }))
      .filter((r) => (!q || L.norm(r.name).includes(q) || L.norm(r.group).includes(q)) && (!mine || has(r.k)))
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    const out = [];
    let group = null;
    for (const r of rows) {
      if (r.group !== group) {
        group = r.group;
        out.push(el("li", { class: "sep", text: group }));
      }
      const n = sheetOf(r.k)?.entries?.length || 0;
      out.push(
        el("li", { class: `boss${settings.picked === r.k ? " on" : ""}${has(r.k) ? " has" : ""}`, onclick: () => { settings.picked = r.k; saveSettings(); renderSheets(); } },
          el("span", { class: "bn", text: r.name }),
          n ? el("span", { class: "cnt", text: String(n) }) : null),
      );
    }
    fill($(".bossList"), ...(out.length ? out : [el("li", { class: "empty muted", text: "No boss matches." })]));
  }

  const KIND_TEXT = { phase: "Phase", alert: "Alert" };
  const WHEN_TEXT = { start: "At the pull", hp: "HP at or under %", time: "Seconds into the fight", cast: "Boss casts skill", skill: "Boss uses skill", buff: "Buff lands on boss", buffEnd: "Buff on boss ends" };

  function renderEditor() {
    const key = settings.picked;
    const box = $(".editor");
    if (!key) {
      fill(box, el("p", { class: "note", text: "Pick a boss on the left. A sheet holds your general notes and the phases and alerts of the fight: a phase stays until the next one, an alert shows for a while with a countdown." }));
      return;
    }
    const sh = sheetOf(key) || { notes: "", entries: [] };
    const starter = !sheets[key] && !!starters[key];
    const entries = sh.entries || [];
    const change = (fn) => {
      const s = own(key, bossName(key));
      fn(s);
      saveSheets();
    };
    const lines = (D.calls || []).filter((c) => c.b === key);
    const row = (e, i) => {
      const valueInput = el("input", { class: "val", type: "number", value: e.when.value ?? "", title: "The percent, seconds, or the skill's or buff's id (from a recorded fight)" });
      const ms = el("input", { class: "ms", type: "number", min: "0", step: "0.5", value: e.kind === "alert" && e.ms ? String(e.ms / 1000) : "", placeholder: e.when.type === "buff" ? "buff" : "8", title: "How many seconds the alert shows (empty: the buff's time, else 8)" });
      const kind = el("select", { class: "kind" }, ...Object.entries(KIND_TEXT).map(([v, t]) => el("option", { value: v, text: t, selected: e.kind === v || (v === "phase" && e.kind !== "alert") })));
      const when = el("select", { class: "when" }, ...L.TRIGGERS.map((v) => el("option", { value: v, text: WHEN_TEXT[v], selected: e.when.type === v })));
      const name = el("input", { class: "name", type: "text", value: e.name || "", placeholder: "Name (shown big)" });
      const text = el("textarea", { class: "text", rows: "2", placeholder: "What to do" });
      text.value = e.text || "";
      const set = (fn) => change((s) => { fn(s.entries[i]); });
      kind.addEventListener("change", () => { set((x) => (x.kind = kind.value)); renderEditor(); });
      when.addEventListener("change", () => { set((x) => (x.when = { type: when.value, value: when.value === "start" ? null : Number(valueInput.value) || null })); renderEditor(); });
      valueInput.addEventListener("input", () => set((x) => (x.when.value = valueInput.value === "" ? null : Number(valueInput.value))));
      ms.addEventListener("input", () => set((x) => (x.ms = ms.value === "" ? 0 : Math.round(Number(ms.value) * 1000))));
      name.addEventListener("input", () => set((x) => (x.name = name.value)));
      text.addEventListener("input", () => set((x) => (x.text = text.value)));
      const move = (d) => change((s) => { const j = i + d; if (j < 0 || j >= s.entries.length) return; [s.entries[i], s.entries[j]] = [s.entries[j], s.entries[i]]; });
      const line = engine.lineOf(e.when.type === "buffEnd" ? "buff" : e.when.type, e.when.value, lang);
      return el("li", { class: `entry ${e.kind === "alert" ? "isAlert" : "isPhase"}` },
        el("div", { class: "eTop" },
          kind, when,
          e.when.type === "start" ? null : valueInput,
          e.kind === "alert" ? el("label", { class: "msL" }, ms, " s") : null,
          el("span", { class: "grow" }),
          el("button", { type: "button", class: "mini", title: "Up", onclick: () => { move(-1); renderEditor(); } }, "↑"),
          el("button", { type: "button", class: "mini", title: "Down", onclick: () => { move(1); renderEditor(); } }, "↓"),
          el("button", { type: "button", class: "mini del", title: "Remove", onclick: () => { change((s) => s.entries.splice(i, 1)); renderEditor(); renderBossList(); } }, "×")),
        line ? el("div", { class: "gameLine muted", text: `The game: “${line}”` }) : null,
        name, text);
    };
    const notes = el("textarea", { class: "notesIn", rows: "3", placeholder: "General notes for this boss (shown under the phase)" });
    notes.value = sh.notes || "";
    notes.addEventListener("input", () => change((s) => (s.notes = notes.value)));
    const add = (kind, when, extra = {}) => {
      change((s) => s.entries.push({ id: uid(), kind, name: "", text: "", when, ms: 0, ...extra }));
      renderEditor();
      renderBossList();
      $(".editor .entries li:last-child .name")?.focus();
    };
    fill(box,
      el("div", { class: "edHead" },
        el("strong", { text: bossName(key) }),
        el("span", { class: "muted", text: groupName(key) }),
        el("span", { class: "grow" }),
        starter ? el("span", { class: "tag", title: "From Enhanced Boss Telegraph's hand-checked mechanics; yours once you change it", text: "starter" }) : null,
        sheets[key] && starters[key] ? el("button", { type: "button", class: "mini", title: "Back to the starter sheet", onclick: () => { delete sheets[key]; saveSheets(); renderSheets(); } }, "Reset") : null),
      notes,
      el("ol", { class: "entries" }, ...entries.map(row)),
      el("div", { class: "row" },
        el("button", { type: "button", onclick: () => add("phase", entries.some((e) => e.kind !== "alert") ? { type: "hp", value: 50 } : { type: "start", value: null }) }, "+ Phase"),
        el("button", { type: "button", onclick: () => add("alert", { type: "cast", value: null }) }, "+ Alert"),
        el("span", { class: "muted", text: "Ids come from a recorded fight (Fights)." })),
      lines.length
        ? el("div", { class: "lines" },
            el("h3", { text: "What the game shows for this boss" }),
            el("ul", {}, ...lines.map((c) => {
              const kind = c.t === "use" ? "skill" : c.t === "abnormal" ? "buff" : c.t;
              const used = entries.some((e) => e.when.type === kind && Number(e.when.value) === c.id);
              return el("li", {},
                el("span", { class: "lk muted", text: `${WHEN_TEXT[kind]} ${c.id}` }),
                el("span", { class: "lt", text: T(c.line) || T(c.act) || "(no line)" }),
                el("button", { type: "button", class: "mini", disabled: used, title: used ? "Already on the sheet" : "Add an alert for it", onclick: () => add("alert", { type: kind, value: c.id }, { name: T(c.act) || "", text: "" }) }, used ? "✓" : "+ Alert"));
            })))
        : null,
    );
  }
  function renderSheets() {
    $(".onlyMine").checked = !!settings.onlyMine;
    renderBossList();
    renderEditor();
  }
  function openSheet(key, name) {
    if (key.startsWith("npc-") && name && !sheets[key]) own(key, name);
    settings.picked = key;
    settings.tab = "sheets";
    saveSettings();
    render();
  }
  $(".find").addEventListener("input", renderBossList);
  $(".onlyMine").addEventListener("change", (e) => { settings.onlyMine = e.target.checked; saveSettings(); renderBossList(); });

  // ---------- Fights ----------
  function renderFights() {
    const list = fights.map((f) =>
      el("li", { class: `fight${openFight === f.id ? " on" : ""}`, onclick: () => { openFight = f.id; renderFights(); } },
        el("span", { class: "bn", text: f.name || bossName(f.key) }),
        el("span", { class: "muted", text: `${new Date(f.start).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${fmt(f.end - f.start)}${f.low != null ? ` · to ${Math.round(f.low)} %` : ""}` })));
    fill($(".fightList"), ...(list.length ? list : [el("li", { class: "empty muted", text: "No fight recorded yet. Fight a boss: what it does is kept here." })]));
    const f = fights.find((x) => x.id === openFight) || null;
    const box = $(".fightView");
    if (!f) {
      fill(box, el("p", { class: "note", text: "Pick a fight. You see what the boss did, when first and how often, and its HP over time; + Phase or + Alert puts that moment on its sheet." }));
      return;
    }
    const sum = L.summary(f, D, lang);
    const add = (kind, when, extra = {}) => {
      const s = own(f.key, f.name);
      s.entries.push({ id: uid(), kind, name: "", text: "", when, ms: 0, ...extra });
      saveSheets();
      openSheet(f.key, f.name);
      setTimeout(() => $(".editor .entries li:last-child .name")?.focus(), 0);
    };
    const onSheet = (kind, id) => (sheetOf(f.key)?.entries || []).some((e) => e.when.type === kind && Number(e.when.value) === id);
    fill(box,
      el("div", { class: "edHead" },
        el("strong", { text: f.name || bossName(f.key) }),
        el("span", { class: "muted", text: `${fmt(f.end - f.start)}${f.low != null ? ` · down to ${Math.round(f.low)} %` : ""}` }),
        el("span", { class: "grow" }),
        el("button", { type: "button", class: "mini", onclick: () => openSheet(f.key, f.name) }, "Sheet"),
        el("button", { type: "button", class: "mini del", title: "Remove this recording", onclick: () => { fights = fights.filter((x) => x !== f); openFight = null; saveFights(); renderFights(); } }, "×")),
      sum.marks.length
        ? el("div", { class: "marks" },
            el("h3", { text: "HP over time" }),
            el("div", { class: "markRow" }, ...sum.marks.map((m) => el("button", { type: "button", class: "mark", title: `Add a phase at ${m.hp} %`, onclick: () => add("phase", { type: "hp", value: Math.ceil(m.hp / 5) * 5 }) }, `${fmt(m.t)} ${m.hp} %`))))
        : null,
      el("h3", { text: "What the boss did" }),
      sum.list.length
        ? el("table", { class: "did" },
            el("thead", {}, el("tr", {}, el("th", { text: "First" }), el("th", { text: "HP" }), el("th", { text: "What" }), el("th", { text: "×" }), el("th", {}))),
            el("tbody", {}, ...sum.list.map((g) => {
              const kindName = { cast: "Cast", skill: "Skill", buff: "Buff", buffEnd: "Buff ends" }[g.kind];
              const used = onSheet(g.kind, g.id);
              const times = g.times.slice(0, 12).map(fmt).join(", ") + (g.count > 12 ? " …" : "");
              return el("tr", { class: g.line ? "known" : "" },
                el("td", { class: "num", text: fmt(g.first) }),
                el("td", { class: "num", text: g.firstHp != null ? `${g.firstHp} %` : "" }),
                el("td", { title: `At ${times}` },
                  el("span", { class: "muted", text: `${kindName} ${g.id}` }),
                  g.length ? el("span", { class: "muted", text: ` · ${(g.length / 1000).toFixed(1)} s` }) : null,
                  g.line ? el("div", { class: "lt", text: `“${g.line}”` }) : null),
                el("td", { class: "num", text: String(g.count) }),
                el("td", { class: "acts" },
                  used ? el("span", { class: "muted", text: "✓" }) : null,
                  el("button", { type: "button", class: "mini", title: "A phase that starts with it", onclick: () => add("phase", { type: g.kind, value: g.id }) }, "+ Phase"),
                  el("button", { type: "button", class: "mini", title: "An alert for it", onclick: () => add("alert", { type: g.kind, value: g.id }) }, "+ Alert")));
            })))
        : el("p", { class: "note", text: "Nothing the boss cast was heard in this fight." }),
    );
  }

  // ---------- Settings ----------
  function renderSettings() {
    $(".size").value = String(settings.size);
    $(".sizeVal").textContent = `${settings.size} px`;
    $(".showNext").checked = !!settings.showNext;
    $(".showNotes").checked = !!settings.showNotes;
    $(".showIdle").checked = !!settings.showIdle;
    $(".keep").value = String(settings.keep);
  }
  $(".size").addEventListener("input", (e) => { settings.size = Number(e.target.value); $(".sizeVal").textContent = `${settings.size} px`; saveSettings(); send(); });
  for (const k of ["showNext", "showNotes", "showIdle"]) $(`.${k}`).addEventListener("change", (e) => { settings[k] = e.target.checked; saveSettings(); send(); });
  $(".keep").addEventListener("change", (e) => { settings.keep = Number(e.target.value); fights = fights.slice(0, settings.keep); saveSettings(); saveFights(); });
  $(".export").addEventListener("click", async () => {
    const text = JSON.stringify({ bossNotes: 1, sheets }, null, 1);
    const ta = $(".ioText");
    ta.hidden = false;
    ta.value = text;
    ta.select();
    $(".ioRow").hidden = true;
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch {}
    if (!copied) try { copied = document.execCommand("copy"); } catch {}
    $(".ioState").textContent = copied ? `${Object.keys(sheets).length} sheets copied.` : "Selected below: copy it with Ctrl+C.";
  });
  $(".import").addEventListener("click", () => {
    const ta = $(".ioText");
    ta.hidden = false;
    ta.value = "";
    ta.focus();
    $(".ioRow").hidden = false;
    $(".ioState").textContent = "";
  });
  $(".ioCancel").addEventListener("click", () => { $(".ioText").hidden = true; $(".ioRow").hidden = true; });
  $(".ioAdd").addEventListener("click", () => {
    try {
      const got = JSON.parse($(".ioText").value);
      const add = got && got.sheets && typeof got.sheets === "object" ? got.sheets : null;
      if (!add) throw new Error("no sheets");
      let n = 0;
      for (const [k, s] of Object.entries(add)) {
        if (!s || !Array.isArray(s.entries) || !/^[\w-]{1,80}$/.test(k)) continue;
        sheets[k] = {
          ...(typeof s.name === "string" ? { name: s.name.slice(0, 80) } : {}),
          notes: String(s.notes || "").slice(0, 4000),
          entries: s.entries.slice(0, 60).filter((e) => e && e.when && L.TRIGGERS.includes(e.when.type)).map((e) => ({
            id: uid(),
            kind: e.kind === "alert" ? "alert" : "phase",
            name: String(e.name || "").slice(0, 120),
            text: String(e.text || "").slice(0, 2000),
            when: { type: e.when.type, value: e.when.value == null ? null : Number(e.when.value) },
            ms: Number(e.ms) > 0 ? Math.min(600000, Number(e.ms)) : 0,
          })),
        };
        n++;
      }
      saveSheets();
      $(".ioState").textContent = `${n} sheets added.`;
      $(".ioText").hidden = true;
      $(".ioRow").hidden = true;
    } catch {
      $(".ioState").textContent = "That isn't text copied from Boss Notes.";
    }
  });

  // ---------- tabs ----------
  for (const b of $$(".tabs button[data-tab]")) {
    b.addEventListener("click", () => { settings.tab = b.dataset.tab; saveSettings(); render(); });
  }
  function render() {
    for (const b of $$(".tabs button[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === settings.tab));
    for (const v of $$(".view")) v.hidden = v.dataset.view !== settings.tab;
    $(".overlayOn").checked = !!settings.overlay;
    if (settings.tab === "now") renderNow();
    else if (settings.tab === "sheets") renderSheets();
    else if (settings.tab === "fights") renderFights();
    else renderSettings();
  }

  // Four times a second: the overlay, and the Now tab while a fight goes on.
  setInterval(() => {
    engine.tick(Date.now());
    send();
    if (settings.tab === "now" && (dirty || engine.fights.size)) {
      dirty = false;
      renderNow();
    }
  }, 250);

  (async () => {
    const [st, sh, fi] = await Promise.all(["settings", "sheets", "fights"].map((k) => a2.storage.get(k).catch(() => null)));
    if (st && typeof st === "object") settings = { ...DEFAULTS, ...st };
    if (sh && typeof sh === "object") sheets = sh;
    if (Array.isArray(fi)) fights = fi;
    render();
    if (settings.overlay) applyOverlay();
    a2.ready();
  })();
})();
