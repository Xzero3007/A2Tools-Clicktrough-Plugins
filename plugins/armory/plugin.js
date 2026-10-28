// Armory: your character as NC's AION 2 character pages show it (gear,
// stats, skills, Daevanion, titles), read through the meter (a2.web.get,
// a2.web.image), every value on the page without hovering; where each
// skill's level comes from and what is left to 20; a reference build to
// compare with; the cheapest enhancing to a target gear score with its cost
// in Kinah and materials; and the character's history.
(() => {
  const C = globalThis.ArmoryCalc;
  const NC = globalThis.ArmoryNC;
  const ICONS = "https://assets.playnccdn.com/static-aion2-gamedata/resources/";
  const COPY = "https://raw.githubusercontent.com/Xzero3007/A2Tools-DPS-Meter_Clicktrough/market-data";
  /** The character you play is read again by itself when its last reading
   *  is older than this. */
  const AUTO_EVERY = 6 * 3600 * 1000;

  const $ = (sel, root = document) => root.querySelector(sel);
  /** el("div", { class: "x", onclick }, child, "text", ...) */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (k === "html") n.innerHTML = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return n;
  }
  const svg = (tag, attrs, ...kids) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
    for (const k of kids.flat(Infinity)) if (k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  };
  const fmt = C.fmt;
  const short = C.short;
  const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  const plusMinus = (v) => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : "±0");

  // ---- state ------------------------------------------------------------
  let settings = { tab: "overview", current: null, chars: {}, goalGs: null, region: null };
  let playing = null; // { name, serverId, cp, gs } from the meter
  let snap = null; // the character shown
  let history = [];
  let reference = null;
  let prices = null; // Map item id -> lowest market price
  let pricesServer = null;
  let loading = false;
  let editRef = false;

  let saveTimer = null;
  const saveSettings = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => a2.storage.set("settings", settings).catch(() => {}), 300);
  };
  const histKey = (key) => `h${key}`;

  function setStatus(text, error = false) {
    const s = $(".status");
    s.textContent = text || "";
    s.classList.toggle("error", !!error);
  }

  // ---- pictures (the game's icon server, through the meter) -------------
  const images = new Map();
  function iconUrl(icon) {
    if (!icon) return null;
    if (/^https:\/\//.test(icon)) return icon;
    const name = String(icon).split(/[/\\]/).pop().replace(/\.(webp|png|jpg)$/i, "");
    return name ? `${ICONS}${name}.png` : null;
  }
  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (!images.has(url)) {
      const get = a2.web && typeof a2.web.image === "function" ? a2.web.image(url) : Promise.resolve(null);
      images.set(url, Promise.resolve(get).catch(() => null));
    }
    return images.get(url);
  }
  function picture(icon, cls = "ico", grade = null) {
    const img = el("img", { class: `${cls}${grade ? ` g-${grade}` : ""}`, alt: "" });
    loadImage(iconUrl(icon)).then((d) => { if (d) img.src = d; });
    return img;
  }

  // ---- reading a character from NC's pages -------------------------------
  async function loadCharacter(target) {
    if (loading || !target?.name || !target?.serverId) return;
    loading = true;
    $(".refresh").disabled = true;
    try {
      const ref = { serverId: Number(target.serverId), characterId: target.characterId || null };
      setStatus(`Looking up ${target.name} …`);
      if (!ref.characterId) {
        const found = NC.readSearch(await a2.web.get(NC.searchUrl(target.name, target.serverId)), target.name, target.serverId);
        if (!found) throw new Error(`${target.name} isn't on NC's character pages (yet): try again after logging out once`);
        ref.characterId = found.characterId;
      }
      setStatus("Reading the character …");
      const info = NC.readInfo(await a2.web.get(NC.infoUrl(ref)));
      if (!info) throw new Error("NC's character page gave no answer");
      const equipment = NC.readEquipment(await a2.web.get(NC.equipmentUrl(ref))) || { slots: [], skills: [] };
      const items = [];
      for (const [i, s] of equipment.slots.entries()) {
        setStatus(`Reading the gear ${i + 1}/${equipment.slots.length} …`);
        let detail = null;
        try { detail = await a2.web.get(NC.itemUrl(ref, s)); } catch { /* the piece keeps what the list said */ }
        items.push(NC.readItem(detail, s));
      }
      const boards = [];
      for (const [i, b] of info.boards.entries()) {
        setStatus(`Reading Daevanion ${i + 1}/${info.boards.length} …`);
        let detail = null;
        try { detail = await a2.web.get(NC.boardUrl(ref, b.id)); } catch { /* counted as unread */ }
        boards.push(detail ? NC.readBoard(detail, b) : { ...b, points: 0, maxPoints: 0, nodes: [], unread: true });
      }
      const s = NC.snapshotOf({ info, equipment, items, boards, at: Date.now() });
      const key = NC.keyOf(s.profile.serverId, s.profile.name);
      settings.chars[key] = { name: s.profile.name, serverId: s.profile.serverId, characterId: ref.characterId,
        className: s.profile.className, level: s.profile.level, serverName: s.profile.serverName };
      settings.current = key;
      saveSettings();
      snap = s;
      await a2.storage.set(key, s).catch(() => {});
      history = (await a2.storage.get(histKey(key)).catch(() => null)) || [];
      history = C.addHistory(history, C.historyEntry(s, C.gearScore(s).total), 300);
      await a2.storage.set(histKey(key), history).catch(() => {});
      setStatus(`Read ${when(s.at)}`);
      render();
      loadPrices(s.profile.serverId);
    } catch (e) {
      setStatus(String(e?.message || e), true);
    } finally {
      loading = false;
      $(".refresh").disabled = false;
    }
  }

  async function openCharacter(key) {
    settings.current = key;
    saveSettings();
    snap = await a2.storage.get(key).catch(() => null);
    history = (await a2.storage.get(histKey(key)).catch(() => null)) || [];
    render();
    if (snap) {
      setStatus(`Read ${when(snap.at)}`);
      loadPrices(snap.profile?.serverId);
    }
    return snap;
  }

  /** The market prices of the character's server (the fork's hourly copy of
   *  aion2.exchange): what Amplify Stones and the like cost in Kinah. */
  async function loadPrices(serverId) {
    if (!serverId || (pricesServer === serverId && prices)) return;
    try {
      const doc = await a2.web.get(`${COPY}/prices/${10000 + Number(serverId)}.json`);
      const map = new Map();
      for (const [id, row] of Object.entries(doc?.items || {})) {
        const p = Array.isArray(row) ? row[0] : null;
        if (typeof p === "number" && p > 0) map.set(id, p);
      }
      if (map.size) {
        prices = map;
        pricesServer = serverId;
        if (settings.tab === "goals") renderGoals();
      }
    } catch { /* the costs show without market prices */ }
  }

  // ---- the character line -----------------------------------------------
  function renderHeader() {
    const p = snap?.profile;
    $(".charName").textContent = p ? p.name : "Armory";
    $(".server").textContent = p ? `${p.serverName} · ${p.race || ""}` : "";
    $(".sub").textContent = p ? [p.className, `Level ${p.level}`, p.legion].filter(Boolean).join(" · ") : "Play a character, or look one up by name.";
    $(".titleLine").textContent = p?.title ? `“${p.title}”` : "";
    const gs = snap ? C.gearScore(snap).total : null;
    $(".cp .value").textContent = p ? fmt(p.cp) : "—";
    $(".gs .value").textContent = p ? fmt(p.gs ?? gs) : "—";
    const live = playing && p && playing.name === p.name && playing.serverId === p.serverId ? playing : null;
    // The game's own numbers, as the meter reads them, where NC's page is behind.
    $(".cp .live").textContent = live?.cp && live.cp !== p.cp ? `in the game ${fmt(live.cp)}` : "";
    $(".gs .live").textContent = live?.gs && live.gs !== p.gs ? `in the game ${fmt(live.gs)}` : "";
    const face = $(".face");
    face.hidden = true;
    if (p?.portrait) loadImage(p.portrait).then((d) => { if (d && snap?.profile === p) { face.src = d; face.hidden = false; } });
    // The character list: the one you play first, then the others read.
    const pick = $(".pick");
    pick.textContent = "";
    const keys = Object.keys(settings.chars);
    if (!keys.length) pick.append(el("option", { value: "" }, "No character yet"));
    for (const key of keys) {
      const c = settings.chars[key];
      const mine = playing && NC.keyOf(playing.serverId, playing.name) === key;
      pick.append(el("option", { value: key, selected: key === settings.current }, `${c.name} · ${c.serverName || c.serverId}${mine ? " (playing)" : ""}`));
    }
    const region = settings.region || Math.floor((p?.serverId || playing?.serverId || 2300) / 100) % 10;
    $(".lookRegion").value = String(region);
  }

  // ---- overview ---------------------------------------------------------
  const PART_COLORS = { level: "rgba(255,255,255,.55)", enchant: "#ffffff", amplify: "#f2c46b", manastones: "#7fdc9a",
    theostones: "#ff9a7a", daevanion: "#c39bff" };
  const PART_NAMES = { level: "Item levels", enchant: "Enhance levels", amplify: "Amplify (5 each)", manastones: "Manastones",
    theostones: "Theostones", daevanion: "Daevanion points" };
  const DEITY = ["Justice", "Freedom", "Illusion", "Life", "Time", "Destruction", "Death", "Wisdom", "Destiny", "Space"];
  const BASE = ["STR", "DEX", "INT", "CON", "AGI", "WIS"];

  function renderOverview() {
    const pane = $('[data-pane="overview"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet: play a character (it is read by itself), or look one up by name above.")); return; }
    const g = C.gearScore(snap);
    const total = g.total || 1;
    const gsBox = el("div", { class: "box" },
      el("h3", {}, "Gear score, piece by piece"),
      el("div", { class: "gsbar" }, Object.entries(g.parts).map(([k, v]) => el("span", { style: { width: `${(100 * v) / total}%`, background: PART_COLORS[k] }, title: PART_NAMES[k] }))),
      el("div", { class: "legend" }, Object.entries(g.parts).map(([k, v]) => el("div", {}, el("span", { class: "sw", style: { background: PART_COLORS[k] } }), PART_NAMES[k], el("b", {}, fmt(v))))),
      el("div", { class: "check" }, snap.profile?.gs == null ? `Sum ${fmt(g.total)}`
        : g.total === snap.profile.gs ? el("span", { class: "good" }, `= ${fmt(g.total)}, the game's own number`)
          : el("span", { class: "gold-t" }, `Sum ${fmt(g.total)}; the game says ${fmt(snap.profile.gs)} (${plusMinus(snap.profile.gs - g.total)}, a part not read)`)),
      el("p", { class: "note" }, "Each worn piece (Arcana too) counts its item level and enhance level; every Amplify level 5; Manastones 1 to 4 by grade (Common, Rare, Legend, Unique); Theostones 3 (Rare) or 5 (Legend); every Daevanion point spent 1. Titles don't count."));

    const stats = snap.stats || {};
    const refDeity = reference?.deity || {};
    const wheel = deityWheel(stats, refDeity);
    const statList = el("div", { class: "kv" });
    for (const k of [...BASE, ...DEITY]) {
      const s = stats[k];
      if (!s) continue;
      statList.append(el("span", {}, el("span", {}, s.name), s.effects?.length ? el("span", { class: "sub" }, ` · ${s.effects.join(", ")}`) : null), el("b", {}, fmt(s.value)));
    }
    const statBox = el("div", { class: "box" }, el("h3", {}, "Stats"), wheel,
      Object.keys(refDeity).length ? el("p", { class: "note" }, `Gold: the reference (${reference.name || "build"}) where it differs.`) : null,
      statList);

    const boardsBox = el("div", { class: "box boards" }, el("h3", {}, "Daevanion boards"));
    const refBoards = new Map((reference?.boards || []).map((b) => [b.name, b]));
    for (const b of snap.boards || []) {
      const r = refBoards.get(b.name);
      const max = b.maxPoints || r?.total || 1;
      boardsBox.append(el("div", { class: "b" }, el("span", {}, b.name),
        el("div", { class: "bar" }, el("span", { style: { width: `${(100 * b.points) / max}%` } }), r ? el("span", { class: "ref", style: { width: `${Math.min(100, (100 * r.points) / max)}%` } }) : null),
        el("span", { class: "num-t" }, `${b.points}/${max}`, r ? el("span", { class: "gold-t" }, ` ${r.points}`) : null)));
    }
    const pts = (snap.boards || []).reduce((a, b) => a + b.points, 0);
    const maxPts = (snap.boards || []).reduce((a, b) => a + b.maxPoints, 0);
    boardsBox.append(el("p", { class: "note" }, `${fmt(pts)} of ${fmt(maxPts)} points spent; each point is 1 gear score. A node costs 1 (Common), 2 (Rare), 3 (Legend) or 4 (Unique) points.`, refBoards.size ? " Gold: the reference." : ""));

    const t = snap.titles || {};
    const titleBox = el("div", { class: "box titles" }, el("h3", {}, `Titles · ${fmt(t.owned)} of ${fmt(t.total)}`),
      (t.list || []).map((x) => el("div", { class: `t g-${x.grade}` },
        el("div", {}, el("span", { class: "dot" }), el("span", { class: "gname" }, x.name), el("span", { class: "sub" }, ` · ${x.category} · ${x.owned}/${x.total} of its kind`)),
        x.equipStats?.length ? el("div", { class: "s" }, `Worn: ${x.equipStats.join(", ")}`) : null,
        x.stats?.length ? el("div", { class: "s" }, `Owned: ${x.stats.join(", ")}`) : null)),
      el("p", { class: "note" }, "Titles add stats (combat power), not gear score."));

    const other = el("div", { class: "box" }, el("h3", {}, "Pet and wings"),
      el("div", { class: "kv" },
        snap.pet ? [el("span", {}, `Pet: ${snap.pet.name}`), el("b", {}, `Level ${snap.pet.level}`)] : null,
        snap.wing ? [el("span", { class: `g-${snap.wing.grade}` }, "Wings: ", el("span", { class: "gname" }, snap.wing.name)), el("b", {}, `+${snap.wing.enchant}`)] : null,
        (snap.rankings || []).map((r) => [el("span", {}, r.name), el("b", {}, `#${fmt(r.rank)} ${r.grade}`)])));

    pane.append(el("div", { class: "cols" }, gsBox, statBox, boardsBox, titleBox, other));
  }

  /** The ten deity stats round a circle, the six base stats inside, every
   *  value written out (the reference's in gold where it differs). */
  function deityWheel(stats, ref) {
    const W = 380, H = 310, cx = W / 2, cy = H / 2, R = 124;
    const s = svg("svg", { class: "wheel", viewBox: `0 0 ${W} ${H}` });
    s.append(svg("circle", { cx, cy, r: R + 22, fill: "none", stroke: "rgba(255,255,255,.08)" }));
    s.append(svg("circle", { cx, cy, r: 72, fill: "rgba(255,255,255,.03)", stroke: "rgba(255,255,255,.08)" }));
    DEITY.forEach((k, i) => {
      const a = (-90 + i * 36) * (Math.PI / 180);
      const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      const st = stats[k];
      const label = (st?.name || k).replace(/\s*\[.*\]$/, "");
      s.append(svg("text", { x, y: y - 8, "text-anchor": "middle", class: "lbl" }, label));
      s.append(svg("text", { x, y: y + 9, "text-anchor": "middle", class: "v" }, st ? fmt(st.value) : "—"));
      if (ref[k] != null && st && ref[k] !== st.value) {
        s.append(svg("text", { x, y: y + 22, "text-anchor": "middle", class: "d", fill: "#f2c46b" }, `ref ${ref[k]}`));
      }
    });
    BASE.forEach((k, i) => {
      const st = stats[k];
      const col = i % 2, row = Math.floor(i / 2);
      const x = cx - 33 + col * 66, y = cy - 26 + row * 25;
      s.append(svg("text", { x, y, "text-anchor": "middle", class: "lbl s" }, st?.name || k));
      s.append(svg("text", { x, y: y + 11, "text-anchor": "middle" }, st ? fmt(st.value) : "—"));
    });
    return s;
  }

  // ---- gear -------------------------------------------------------------
  const GROUPS = [
    ["Weapons", ["MainHand", "SubHand"]],
    ["Armor", ["Helmet", "Shoulder", "Torso", "Pants", "Gloves", "Boots", "Cape", "Belt"]],
    ["Accessories", ["Necklace", "Earring1", "Earring2", "Ring1", "Ring2", "Bracelet1", "Bracelet2", "Amulet", "Rune1", "Rune2"]],
    ["Arcana", ["Arcana1", "Arcana2", "Arcana3", "Arcana4", "Arcana5"]],
  ];

  function nextLine(it) {
    if (it.arcana) return null;
    const et = C.enchantTable(it);
    const top = Math.min(it.maxEnchant || 0, et ? et.length : 0);
    if (et && it.enchant < top) {
      const c = C.climb(et, it.enchant, it.enchant + 1).steps[0];
      if (!c) return null;
      return `Next +${it.enchant + 1}: ${Math.round(c.chance * 100)}%${c.perFail ? ` (+${Math.round(c.perFail * 100)}% a failure)` : ""}${c.loses ? ", a failure loses a level" : ""} · ${c.kinahPerTry ? `${short(c.kinahPerTry)} Kinah + ` : ""}${matsText(c.matsPerTry)} a try · on average ${fmt(c.tries, 1)} tries${c.kinah ? `, ${short(c.kinah)} Kinah` : ""}`;
    }
    const at = C.amplifyTable(it);
    const atop = Math.min(it.maxAmplify ?? 99, C.amplifyTop(it));
    if (at && (it.amplify || 0) < atop) {
      const c = C.climb(at, it.amplify || 0, (it.amplify || 0) + 1).steps[0];
      if (!c) return null;
      return `Next Amplify ${(it.amplify || 0) + 1}: ${Math.round(c.chance * 100)}% (+${Math.round(c.perFail * 100)}% a failure) · ${short(c.kinahPerTry)} Kinah + ${matsText(c.matsPerTry)} a try · on average ${short(c.kinah)} Kinah`;
    }
    return top ? "At its top." : null;
  }
  const matsText = (mats) => Object.entries(mats || {}).map(([k, n]) => `${fmt(n)} ${C.material(k).name.replace(/ \(Bound\)$/, "")}`).join(" + ") || "nothing";

  function gearCard(it) {
    const amp = it.amplify ? el("span", { class: "amp" }, ` · Amplify ${it.amplify}`) : null;
    return el("div", { class: `card g-${it.grade}` },
      el("div", { class: "head" }, picture(it.icon, "ico", it.grade),
        el("div", { class: "t" },
          el("div", { class: "nm gname", title: it.name }, it.name),
          el("div", { class: "lv" }, el("span", { class: "plus" }, `+${it.enchant || 0}`), it.maxEnchant ? ` of ${it.maxEnchant}` : "", amp,
            it.il ? ` · IL ${it.il}` : "", ` · ${C.SLOT_LABEL[it.slot] || it.slot}`))),
      it.main?.length ? el("div", { class: "stats" }, it.main.map((m) => [el("span", {}, m.name),
        el("span", {}, m.min ? `${m.min}–${m.value}` : m.value, Number(m.extra) ? el("span", { class: "x" }, ` +${m.extra}`) : null)])) : null,
      it.sub?.length ? el("div", { class: "stats" }, it.sub.map((m) => [el("span", { class: "sub" }, m.name), el("span", { class: "sub" }, m.value)])) : null,
      (it.stones?.length || it.stoneSlots) ? el("div", { class: "chips" },
        (it.stones || []).map((s) => el("span", { class: `chip stone g-${s.grade}` }, el("span", { class: "dot" }), `${s.name} ${s.value}`)),
        Array.from({ length: Math.max(0, (it.stoneSlots || 0) - (it.stones?.length || 0)) }, () => el("span", { class: "chip empty" }, "empty slot"))) : null,
      it.subSkills?.length ? el("div", { class: "chips" }, it.subSkills.map((k) => el("span", { class: "chip skill" }, `${k.name} +${k.level}`))) : null,
      (it.theostones || []).map((g) => el("div", { class: `god g-${g.grade}` }, el("b", {}, g.name), `\n${g.desc}`)),
      nextLine(it) ? el("div", { class: "next" }, nextLine(it)) : null);
  }

  function renderGear() {
    const pane = $('[data-pane="gear"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet.")); return; }
    const bySlot = new Map((snap.items || []).map((it) => [it.slot, it]));
    for (const [name, slots] of GROUPS) {
      const list = slots.map((s) => bySlot.get(s)).filter(Boolean);
      if (!list.length) continue;
      pane.append(el("h3", {}, name), el("div", { class: "cards" }, list.map(gearCard)));
    }
    const rest = (snap.items || []).filter((it) => !GROUPS.some(([, s]) => s.includes(it.slot)));
    if (rest.length) pane.append(el("h3", {}, "Other"), el("div", { class: "cards" }, rest.map(gearCard)));
    pane.append(el("p", { class: "note" }, "Green after a stat: what its enhance level adds. Chances and costs are the game's enhance tables; a failure raises the next try's chance where the game does."));
  }

  // ---- skills -----------------------------------------------------------
  function skillBar(s) {
    const pc = (v) => `${(100 * v) / 20}%`;
    const base = Math.min(20, s.base), daev = Math.min(20 - base, s.fromDaev), gear = Math.min(20 - base - daev, s.fromGear);
    return el("span", { class: "skbar" },
      el("span", { class: "base", style: { left: 0, width: pc(base) } }),
      el("span", { class: "daev", style: { left: pc(base), width: pc(daev) } }),
      el("span", { class: "gear", style: { left: pc(base + daev), width: pc(gear) } }),
      [10, 14, 16].map((m) => el("span", { class: "mark", style: { left: pc(m) } })),
      s.refLevel != null ? el("span", { class: "ref", style: { left: pc(Math.min(20, s.refLevel)) }, title: `Reference: ${s.refLevel}` }) : null);
  }

  function skillHint(s) {
    if (s.category === "Dp") {
      if (s.level >= 20) return "At 20.";
      return s.level > 0 ? `${20 - s.level} to 20: Stigma levels come from Stigma Shards.` : "Not raised yet: Stigma levels come from Stigma Shards.";
    }
    if (s.level >= 20) return "At 20.";
    const parts = [];
    if (s.baseRoom > 0) parts.push(`${s.baseRoom} from skill points (to 10)`);
    if (s.closedNodes.length) {
      const pts = s.closedNodes.reduce((a, n) => a + n.points, 0);
      parts.push(`${s.closedNodes.reduce((a, n) => a + n.gives, 0)} from Daevanion: ${s.closedNodes.map((n) => `${n.board} (${n.grade}, ${n.points} pt)`).join(", ")} · ${pts} points`);
    }
    if (s.gearFor20 > 0) parts.push(`${s.gearFor20} more from gear and Arcana (extra skill levels)`);
    return parts.length ? `To 20: ${parts.join("; ")}.` : "";
  }

  function renderSkills() {
    const pane = $('[data-pane="skills"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet.")); return; }
    const all = C.compareSkills(C.skillSources(snap), reference);
    const learnt = all.filter((s) => s.acquired || s.level > 0);
    const at20 = learnt.filter((s) => s.category !== "Dp" && s.level >= 20).length;
    const at16 = learnt.filter((s) => s.category !== "Dp" && s.level >= 16).length;
    pane.append(el("p", { class: "note" },
      `${at16} skills at 16 or more, ${at20} at 20. A skill reaches 10 with skill points, 14 with the Daevanion boards (one node on each of the first four), and 20 with extra skill levels on gear and Arcana.`));
    pane.append(el("div", { class: "sklegend" },
      el("span", {}, el("i", { style: { background: "rgba(255,255,255,.5)" } }), "skill points"),
      el("span", {}, el("i", { style: { background: "#c39bff" } }), "Daevanion"),
      el("span", {}, el("i", { style: { background: "#f2c46b" } }), "gear and Arcana"),
      reference ? el("span", {}, el("i", { style: { background: "#fff", width: "3px" } }), "the reference's level") : null,
      el("span", {}, "marks at 10, 14, 16")));
    const groups = [["Active", "Active skills"], ["Passive", "Passive skills"], ["Dp", "Stigmas"]];
    for (const [cat, title] of groups) {
      const list = learnt.filter((s) => s.category === cat).sort((a, b) => (b.equipped - a.equipped) || (b.level - a.level));
      if (!list.length) continue;
      const tbody = el("tbody");
      for (const s of list) {
        tbody.append(el("tr", {},
          el("td", {}, el("div", { class: "cell" }, picture(s.icon, "ico s"), el("span", { class: "txt" }, s.name, s.equipped && cat !== "Passive" ? el("span", { class: "sub" }, " · in use") : null))),
          el("td", {}, el("span", { class: `lvl${s.level >= 20 ? " max" : ""}` }, s.level), s.refLevel != null ? el("span", { class: s.refLevel > s.level ? "sub gold-t" : "sub" }, ` / ${s.refLevel}`) : null),
          el("td", { class: "l" }, cat === "Dp" ? null : skillBar(s)),
          el("td", { class: "l sub", title: cat === "Dp" ? "" : `${s.base} skill points · ${s.fromDaev} Daevanion · ${s.fromGear} gear` },
            cat === "Dp" ? "" : `${s.base} + ${s.fromDaev} + ${s.fromGear}`),
          el("td", { class: "l wrap sub" }, skillHint(s),
            s.gear.length ? el("div", {}, `Now from: ${s.gear.map((g) => `${g.item} +${g.level}`).join(", ")}`) : null)));
      }
      pane.append(el("h3", {}, title), el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Skill"), el("th", {}, reference ? "Level / ref" : "Level"), el("th", { class: "l" }, "0 – 20"), el("th", { class: "l" }, "points + Daev. + gear"), el("th", { class: "l" }, "The way to 20"))),
        tbody));
    }
    pane.append(el("p", { class: "note" }, "Arcana's extra skill levels are random rolls on each card: its own planner comes later."));
  }

  // ---- reference --------------------------------------------------------
  const CATS_OF_SLOT = {
    MainHand: ["Greatsword", "Longsword", "Dagger", "Bow", "Spellbook", "Orb", "Mace", "Staff"], SubHand: ["Guard"],
    Helmet: ["Helm"], Shoulder: ["Pauldrons"], Torso: ["Top"], Pants: ["Legs"], Gloves: ["Gloves"], Boots: ["Shoes"], Cape: ["Cloak"],
    Belt: ["Belt"], Necklace: ["Necklace"], Earring1: ["Earrings"], Earring2: ["Earrings"], Ring1: ["Ring"], Ring2: ["Ring"],
    Bracelet1: ["Bracelet"], Bracelet2: ["Bracelet"], Amulet: ["Amulet"], Rune1: ["Rune"], Rune2: ["Rune"],
  };

  async function saveReference(ref) {
    reference = ref;
    await a2.storage.set("reference", ref).catch(() => {});
    render();
  }

  async function importFiles(files) {
    let ref = null;
    for (const f of files) {
      try { ref = C.mergeReference(ref, C.readQuestlogPage(await f.text())); } catch { /* not a page */ }
    }
    finishImport(ref);
  }
  function importText(text) {
    const t = String(text || "").trim();
    if (!t) return;
    if (t.startsWith("{")) {
      try { finishImport(JSON.parse(t)); } catch { setStatus("That code isn't a reference", true); }
      return;
    }
    finishImport(C.readQuestlogPage(t));
  }
  function finishImport(ref) {
    if (!ref || (!ref.gear?.length && !ref.skills?.length && !ref.boards?.length)) {
      setStatus("No build found in that: save a questlog.gg character build page (Equipment, Skills or Daevanion tab) from the browser", true);
      return;
    }
    // Several tabs saved one after the other add up.
    const merged = reference && reference.name === ref.name ? C.mergeReference(ref, reference) : ref;
    setStatus(`Reference: ${merged.name || "build"} (${merged.gear.length} pieces, ${merged.skills.length} skills, ${merged.boards.length} boards)`);
    editRef = false;
    saveReference(merged);
  }

  function importBox() {
    const file = el("input", { type: "file", accept: ".html,.htm,text/html", multiple: true,
      onchange: (e) => { if (e.target.files?.length) importFiles([...e.target.files]); } });
    const area = el("textarea", { placeholder: "… or paste a saved page's HTML, or a reference code, here" });
    return el("div", { class: "import" },
      el("p", { class: "note" }, "A build to compare with and aim at: open a character build on questlog.gg in your browser, save the page (Ctrl+S, “Web page, complete” or “HTML only”), once on its Equipment tab and, for skills and Daevanion, once on those tabs, then pick the saved files here. Nothing is sent anywhere: the files are read here."),
      el("div", {}, el("span", { class: "filebtn" }, el("button", { type: "button", class: "gold" }, "Pick saved pages …"), file)),
      area,
      el("div", {}, el("button", { type: "button", onclick: () => importText(area.value) }, "Read what is pasted")));
  }

  function renderReference() {
    const pane = $('[data-pane="reference"]');
    pane.textContent = "";
    if (!reference) {
      pane.append(el("h3", {}, "No reference yet"), importBox());
      return;
    }
    const mineGs = snap ? (snap.profile?.gs ?? C.gearScore(snap).total) : null;
    pane.append(el("div", { class: "refhead" },
      el("span", { class: "nm" }, reference.name || "Reference"),
      el("span", { class: "muted" }, reference.source ? `from ${reference.source}` : ""),
      el("span", { class: "grow" }),
      reference.gearScore ? el("span", {}, "Gear score ", el("b", { class: "gold-t" }, fmt(reference.gearScore)), mineGs ? el("span", { class: "muted" }, ` · yours ${fmt(mineGs)} (${plusMinus(mineGs - reference.gearScore)})`) : null) : null,
      el("button", { type: "button", onclick: () => { editRef = !editRef; renderReference(); } }, editRef ? "Done" : "Edit"),
      el("button", { type: "button", onclick: () => { const box = $(".refcode"); box.hidden = !box.hidden; } }, "Code"),
      el("button", { type: "button", onclick: () => { if (confirmRemove()) saveReference(null); } }, "Remove")));
    pane.append(el("textarea", { class: "refcode", hidden: true, readonly: true, style: { width: "100%", minHeight: "60px", fontSize: "11px" } }, JSON.stringify(reference)));

    // Gear, slot by slot.
    const rows = C.compareGear(snap, reference);
    const tbody = el("tbody");
    for (const r of rows) {
      const a = r.mine, b = r.ref;
      const lv = (x) => (x ? `+${x.enchant || 0}${x.amplify ? ` · A${x.amplify}` : ""}` : "");
      const status = { done: "✓ reached", levels: `${r.levelsToGo} levels to go`, other: "another item", missing: "not worn", none: "" }[r.status];
      tbody.append(el("tr", {},
        el("td", {}, C.SLOT_LABEL[r.slot] || r.slot),
        el("td", { class: "l" }, a ? el("div", { class: `cell g-${a.grade}` }, picture(a.icon, "ico s", a.grade),
          el("div", { class: "txt2" }, el("div", { class: "gname" }, a.name), el("div", { class: "sub" }, `${lv(a)}${a.il ? ` · IL ${a.il}` : ""}`))) : el("span", { class: "faint" }, "—")),
        el("td", { class: "l" }, editRef ? refEditor(r.slot, b) : b ? el("div", { class: `cell g-${b.grade}` }, picture(b.icon, "ico s", b.grade),
          el("div", { class: "txt2" }, el("div", { class: "gname" }, b.name || "?"),
            el("div", { class: "sub" }, `${lv(b)}${b.il ? ` · IL ${b.il}` : ""}`, b.guessed ? " · known by its picture only: one of several items with it (Edit to change)" : ""))) : el("span", { class: "faint" }, "—")),
        el("td", { class: `status-${r.status}` }, status)));
    }
    if (editRef) {
      const missing = Object.keys(CATS_OF_SLOT).filter((s) => !rows.some((r) => r.slot === s));
      for (const slot of missing) tbody.append(el("tr", {}, el("td", {}, C.SLOT_LABEL[slot]), el("td", {}, ""), el("td", { class: "l" }, refEditor(slot, null)), el("td", {}, "")));
    }
    pane.append(el("h3", {}, "Gear"), el("table", { class: "fixed" },
      el("colgroup", {}, el("col", { style: { width: "78px" } }), el("col", {}), el("col", {}), el("col", { style: { width: "112px" } })),
      el("thead", {}, el("tr", {}, el("th", {}, "Slot"), el("th", { class: "l" }, "Yours"), el("th", { class: "l" }, "Reference"), el("th", {}, ""))), tbody));

    // Skills, Daevanion, deity stats.
    if (reference.skills?.length && snap) {
      const named = C.compareSkills(snap.skills || [], reference).filter((s) => s.refLevel != null);
      pane.append(el("h3", {}, "Skills"), el("div", { class: "cards" }, named.map((s) => el("div", { class: "card" },
        el("div", { class: "head" }, picture(s.icon, "ico s"), el("div", { class: "t" }, el("div", { class: "nm" }, s.name),
          el("div", { class: "lv" }, "yours ", el("span", { class: "plus" }, s.level), " · reference ", el("span", { class: s.refLevel > s.level ? "amp" : "plus" }, s.refLevel))))))));
    }
    if (reference.stigmas?.length && snap) {
      const byIcon = new Map((snap.skills || []).map((s) => [C.iconKey(s.icon), s]));
      pane.append(el("h3", {}, "Stigmas"), el("div", { class: "chips" }, reference.stigmas.map((icon) => {
        const s = byIcon.get(C.iconKey(icon));
        return el("span", { class: "chip" }, s ? `${s.name} (yours ${s.level})` : icon.replace(/\.\w+$/, ""));
      })));
    }
    if (reference.boards?.length) {
      const mine = new Map((snap?.boards || []).map((b) => [b.name, b]));
      const box = el("div", { class: "boards" });
      for (const b of reference.boards) {
        const m = mine.get(b.name);
        box.append(el("div", { class: "b" }, el("span", {}, b.name),
          el("div", { class: "bar" }, m ? el("span", { style: { width: `${(100 * m.points) / b.total}%` } }) : null, el("span", { class: "ref", style: { width: `${(100 * b.points) / b.total}%` } })),
          el("span", { class: "num-t" }, m ? `${m.points}` : "—", el("span", { class: "gold-t" }, ` / ${b.points}`))));
      }
      const total = reference.boards.reduce((a, b) => a + b.points, 0);
      const mineTotal = (snap?.boards || []).reduce((a, b) => a + b.points, 0);
      pane.append(el("h3", {}, `Daevanion points · yours ${fmt(mineTotal)}, reference ${fmt(total)}`), box);
    }
    if (Object.keys(reference.deity || {}).length && snap) {
      const kv = el("div", { class: "kv" });
      for (const k of DEITY) {
        if (reference.deity[k] == null) continue;
        const v = snap.stats?.[k]?.value;
        kv.append(el("span", {}, (snap.stats?.[k]?.name || k)), el("b", {}, v != null ? `${v} ` : "— ", el("span", { class: reference.deity[k] > (v || 0) ? "gold-t" : "muted" }, `/ ${reference.deity[k]}`)));
      }
      pane.append(el("h3", {}, "Deity stats · yours / reference"), kv);
    }
    pane.append(el("h3", {}, "Replace the reference"), importBox());
  }

  const confirmRemove = () => {
    // A sandboxed page has no confirm(): a second press within 3 s removes.
    const now = Date.now();
    if (confirmRemove.at && now - confirmRemove.at < 3000) { confirmRemove.at = 0; return true; }
    confirmRemove.at = now;
    setStatus("Press Remove again to remove the reference");
    return false;
  };

  /** One reference slot, to change: the item (searched by name), its
   *  enhance and Amplify levels. */
  function refEditor(slot, cur) {
    const box = el("div", { class: "edit" });
    const name = el("input", { type: "text", value: cur?.name || "", placeholder: "Item name …" });
    const ench = el("input", { type: "number", min: 0, max: 15, value: cur?.enchant ?? 0, title: "Enhance level" });
    const amp = el("input", { type: "number", min: 0, max: 5, value: cur?.amplify ?? 0, title: "Amplify level" });
    const list = el("div", { class: "sugg", hidden: true });
    let chosen = cur?.id || null;
    const commit = () => {
      const gear = (reference.gear || []).filter((g) => g.slot !== slot);
      if (chosen) {
        const row = C.itemRow(chosen);
        gear.push({ slot, id: chosen, name: row[0], grade: row[1], il: row[3], icon: cur?.id === chosen ? cur.icon : row[4],
          enchant: Number(ench.value) || 0, amplify: Number(amp.value) || 0, shown: (Number(ench.value) || 0) + (Number(amp.value) || 0), guessed: false });
      }
      reference = { ...reference, gear };
      a2.storage.set("reference", reference).catch(() => {});
    };
    name.addEventListener("input", () => {
      list.textContent = "";
      const q = name.value.trim();
      if (q.length < 2) { list.hidden = true; if (!q) { chosen = null; commit(); } return; }
      const ids = (CATS_OF_SLOT[slot] || [null]).flatMap((cat) => C.searchItems(q, cat, 10)).slice(0, 14);
      for (const id of ids) {
        const r = C.itemRow(id);
        list.append(el("button", { type: "button", class: `g-${r[1]}`, onclick: () => { chosen = id; name.value = r[0]; list.hidden = true; commit(); } },
          el("span", { class: "gname" }, r[0]), el("span", { class: "sub" }, ` · ${r[1]} · IL ${r[3]}`)));
      }
      list.hidden = !ids.length;
    });
    ench.addEventListener("change", commit);
    amp.addEventListener("change", commit);
    box.append(name, el("span", { class: "sub" }, "+"), ench, el("span", { class: "sub" }, "A"), amp, list);
    return box;
  }

  // ---- goals ------------------------------------------------------------
  function renderGoals() {
    const pane = $('[data-pane="goals"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet.")); return; }
    const current = snap.profile?.gs ?? C.gearScore(snap).total;
    const cp = snap.profile?.cp || 0;
    const rate = C.cpPerGearScore(history);
    if (!(settings.goalGs > 0)) settings.goalGs = reference?.gearScore && reference.gearScore > current ? reference.gearScore : current + 50;
    const goal = settings.goalGs;
    const gsIn = el("input", { type: "number", min: 0, step: 10, value: goal });
    const cpIn = el("input", { type: "number", min: 0, step: 1000, value: Math.round(cp + (goal - current) * rate.rate), style: { width: "100px" } });
    const apply = (v) => { settings.goalGs = Math.max(0, Math.round(v)); saveSettings(); renderGoals(); };
    gsIn.addEventListener("change", () => apply(Number(gsIn.value)));
    cpIn.addEventListener("change", () => apply(current + (Number(cpIn.value) - cp) / rate.rate));
    pane.append(el("div", { class: "goalform" },
      el("label", {}, "Target gear score", gsIn),
      el("label", { title: rate.own ? `From your own history: ${fmt(rate.rate)} combat power a gear score point` : `About ${rate.rate} combat power a gear score point (24 characters, 2026-10-28) until your own history says better` }, "or combat power ≈", cpIn),
      reference?.gearScore ? el("button", { type: "button", class: "gold", onclick: () => apply(reference.gearScore) }, `The reference's ${fmt(reference.gearScore)}`) : null,
      el("button", { type: "button", onclick: () => apply(current + 50) }, "+50"),
      el("button", { type: "button", onclick: () => apply(current + 100) }, "+100")));

    const plan = C.planGearScore(snap, current, goal, prices);
    const room = C.gearRoom(snap);
    const need = Math.max(0, goal - current);
    const est = Math.round(plan.total.gain * rate.rate);
    pane.append(el("div", { class: "summary" },
      el("div", { class: "big" }, need === 0 ? `You are at ${fmt(current)}: the target is reached.` :
        plan.reached ? `${fmt(current)} → ${fmt(plan.gs)} by enhancing what you wear` : `${fmt(current)} → ${fmt(plan.gs)} at most with what you wear`),
      need > 0 ? el("div", { class: "muted" },
        `${plusMinus(plan.total.gain)} gear score · combat power ≈ ${plusMinus(est)} (${rate.own ? "your own history" : "estimate"}: ≈${fmt(rate.rate)} a point)`,
        !plan.reached ? el("div", { class: "gold-t" }, `The last ${fmt(goal - plan.gs)} need better pieces (or the free points below): your gear has ${fmt(room)} points of room left.`) : null) : null));
    if (!plan.pieces.length) { freePoints(pane, need - plan.total.gain); return; }

    // Totals.
    const mats = plan.total.mats;
    const matTotals = Object.entries(mats).sort((a, b) => b[1] - a[1]);
    pane.append(el("div", { class: "totals" },
      el("div", { class: "t" }, el("div", { class: "l" }, "Kinah, on average"), el("div", { class: "v" }, short(plan.total.kinah)), el("div", { class: "sub" }, `${fmt(plan.total.kinah)}`)),
      el("div", { class: "t" }, el("div", { class: "l" }, "Kinah, 9 times in 10"), el("div", { class: "v" }, short(plan.total.kinahP90)), el("div", { class: "sub" }, "each step by itself within")),
      matTotals.map(([k, n]) => {
        const price = C.materialPrice(k, prices);
        const m = C.material(k);
        return el("div", { class: "t" }, el("div", { class: "l" }, m.name), el("div", { class: "v" }, fmt(Math.ceil(n))),
          el("div", { class: "sub" }, price ? `≈ ${short(n * price)} Kinah at ${fmt(price)} each` : m.bound ? "bound: not on the market" : "no market price"));
      }),
      el("div", { class: "t" }, el("div", { class: "l" }, "All in Kinah"), el("div", { class: "v gold-t" }, short(plan.total.worth.total)),
        el("div", { class: "sub" }, Object.keys(plan.total.worth.unpriced).length ? "with priced materials; the rest by count" : "materials at market prices"))));

    // The steps, cheapest per point first.
    const tbody = el("tbody");
    for (const p of plan.pieces) {
      const it = p.item;
      tbody.append(el("tr", {},
        el("td", {}, el("div", { class: `cell g-${it.grade}` }, picture(it.icon, "ico xs", it.grade), el("span", { class: "txt gname" }, it.name))),
        el("td", { class: "l" }, p.kind === "enchant" ? `+${p.from} → +${p.to}` : `Amplify ${p.from} → ${p.to}`),
        el("td", {}, `+${p.gain}`),
        el("td", {}, short(p.kinah)),
        el("td", {}, short(p.kinahP90)),
        el("td", { class: "l wrap sub" }, matsText(Object.fromEntries(Object.entries(p.mats).map(([k, v]) => [k, Math.ceil(v)]))))));
    }
    pane.append(el("h3", {}, "Steps, cheapest per point first"),
      el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Piece"), el("th", { class: "l" }, "Step"), el("th", {}, "Points"), el("th", {}, "Kinah ⌀"), el("th", {}, "9 in 10"), el("th", { class: "l" }, "Materials ⌀"))), tbody),
      el("p", { class: "note" }, "From the game's enhance tables: each try's chance, the chance a failure adds, Kinah and materials a try. “⌀” is the average over many tries; “9 in 10” is what each step stays within nine times out of ten. Enhancement Supplements are not counted. Amplify starts once a piece is at its enhance top."));
    freePoints(pane, need - plan.total.gain);
  }

  /** Gear score that costs no Kinah to plan: Daevanion points, empty
   *  Manastone slots; and the reference's better pieces. */
  function freePoints(pane, short_) {
    const daev = (snap.boards || []).reduce((a, b) => a + Math.max(0, (b.maxPoints || 0) - (b.points || 0)), 0);
    const empty = (snap.items || []).reduce((a, it) => a + Math.max(0, (it.stoneSlots || 0) - (it.stones?.length || 0)), 0);
    const better = reference ? C.compareGear(snap, reference).filter((r) => r.ref && r.mine && !r.same && (r.ref.il || 0) > (r.mine.il || 0)) : [];
    pane.append(el("h3", {}, "Other ways to gear score"), el("div", { class: "kv" },
      el("span", {}, "Daevanion points still open (1 each)"), el("b", {}, `+${fmt(daev)}`),
      el("span", {}, "Empty Manastone slots (1 to 4 each, by grade)"), el("b", {}, empty ? `+${empty} to +${empty * 4}` : "none"),
      better.map((r) => [el("span", {}, `${C.SLOT_LABEL[r.slot]}: ${r.ref.name} (IL ${r.ref.il}) for ${r.mine.name} (IL ${r.mine.il})`), el("b", {}, `+${r.ref.il - r.mine.il} item level`)])));
    if (short_ > 0 && !better.length && !reference) pane.append(el("p", { class: "note" }, "A reference build (its tab) shows which better pieces to aim for."));
  }

  // ---- history ----------------------------------------------------------
  function renderHistory() {
    const pane = $('[data-pane="history"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet.")); return; }
    const h = history.filter((e) => e && e.at);
    pane.append(el("p", { class: "note" }, "Every reading of NC's page (Update, or by itself every 6 hours while you play) is kept when something changed: combat power, gear score, gear, skills, Daevanion, titles. While you play, the game's own combat power and gear score are noted as they change."));
    if (h.length) pane.append(historyChart(h));
    const tbody = el("tbody");
    for (let i = h.length - 1; i >= 0; i--) {
      const e = h[i], prev = h[i - 1];
      // What changed: against the last reading of NC's page (the game's
      // own readings carry only the two numbers).
      let full = null;
      for (let j = i - 1; j >= 0; j--) if (!h[j].live) { full = h[j]; break; }
      const changes = C.historyChanges(full, e);
      tbody.append(el("tr", {},
        el("td", {}, when(e.at), e.seen ? el("div", { class: "sub" }, `same until ${when(e.seen)}`) : null),
        el("td", {}, fmt(e.cp), prev && e.cp != null && prev.cp != null && e.cp !== prev.cp ? el("div", { class: e.cp > prev.cp ? "sub good" : "sub bad" }, plusMinus(e.cp - prev.cp)) : null),
        el("td", {}, fmt(e.gs), prev && e.gs !== prev.gs ? el("div", { class: e.gs > prev.gs ? "sub good" : "sub bad" }, plusMinus(e.gs - prev.gs)) : null),
        el("td", { class: "l changes" }, e.live ? "In the game (the meter's reading)" : full ? (changes.join(" · ") || "—") : "First reading of NC's page")));
    }
    pane.append(el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "When"), el("th", {}, "Combat power"), el("th", {}, "Gear score"), el("th", { class: "l" }, "What changed"))), tbody));
  }

  function historyChart(h) {
    const W = 640, H = 190, L = 54, R = 54, T = 12, B = 22;
    const s = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    const t0 = h[0].at, t1 = Math.max(h[h.length - 1].seen || h[h.length - 1].at, t0 + 1);
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const series = (key) => {
      const vals = h.map((e) => e[key]).filter((v) => Number.isFinite(v));
      if (!vals.length) return null;
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi === lo) { lo -= 1; hi += 1; }
      const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const pts = [];
      for (const e of h) if (Number.isFinite(e[key])) { pts.push(`${x(e.at)},${y(e[key])}`); if (e.seen) pts.push(`${x(e.seen)},${y(e[key])}`); }
      return { pts: pts.join(" "), lo, hi, y };
    };
    for (let i = 0; i <= 4; i++) s.append(svg("line", { class: "grid", x1: L, x2: W - R, y1: T + (i * (H - T - B)) / 4, y2: T + (i * (H - T - B)) / 4 }));
    const cp = series("cp"), gs = series("gs");
    if (cp) {
      s.append(svg("polyline", { class: "cp", points: cp.pts }));
      s.append(svg("text", { x: 4, y: T + 8 }, short(cp.hi)), svg("text", { x: 4, y: H - B }, short(cp.lo)), svg("text", { x: 4, y: H - 6 }, "Combat power"));
    }
    if (gs) {
      s.append(svg("polyline", { class: "gs", points: gs.pts }));
      s.append(svg("text", { x: W - 4, y: T + 8, "text-anchor": "end", fill: "#f2c46b" }, fmt(gs.hi)), svg("text", { x: W - 4, y: H - B, "text-anchor": "end", fill: "#f2c46b" }, fmt(gs.lo)),
        svg("text", { x: W - 4, y: H - 6, "text-anchor": "end", fill: "#f2c46b" }, "Gear score"));
    }
    if (h.length === 1) {
      if (cp) s.append(svg("circle", { cx: x(h[0].at), cy: cp.y(h[0].cp), r: 3, fill: "#fff" }));
      if (gs) s.append(svg("circle", { cx: x(h[0].at), cy: gs.y(h[0].gs), r: 3, fill: "#f2c46b" }));
    }
    return s;
  }

  // ---- tabs and rendering -------------------------------------------------
  const RENDER = { overview: renderOverview, gear: renderGear, skills: renderSkills, reference: renderReference, goals: renderGoals, history: renderHistory };
  function showTab(tab) {
    if (!RENDER[tab]) tab = "overview";
    settings.tab = tab;
    for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    for (const p of document.querySelectorAll(".pane")) p.classList.toggle("on", p.dataset.pane === tab);
    RENDER[tab]();
  }
  function render() {
    renderHeader();
    showTab(settings.tab);
  }

  for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => { showTab(b.dataset.tab); saveSettings(); });
  $(".refresh").addEventListener("click", () => {
    const c = settings.chars[settings.current];
    if (c) loadCharacter(c);
    else if (playing) loadCharacter(playing);
  });
  $(".pick").addEventListener("change", (e) => { if (e.target.value) openCharacter(e.target.value).then((s) => { if (!s) loadCharacter(settings.chars[e.target.value]); }); });

  // Looking someone up by name: NC's search in the shard picked.
  let lookTimer = null;
  const lookName = $(".lookName");
  const results = $(".lookResults");
  async function lookUp() {
    const q = lookName.value.trim();
    results.textContent = "";
    if (q.length < 2) { results.hidden = true; return; }
    settings.region = Number($(".lookRegion").value);
    saveSettings();
    try {
      const serverOfRegion = settings.region * 100 + 1; // any server of the shard picks its region
      const url = NC.searchUrl(q, serverOfRegion).replace(/&serverId=\d+/, "");
      const list = NC.readSearchList(await a2.web.get(url));
      for (const c of list.slice(0, 12)) {
        results.append(el("button", { type: "button", onclick: () => {
          results.hidden = true; lookName.value = "";
          loadCharacter({ name: c.name, serverId: c.serverId, characterId: c.characterId });
        } }, el("b", {}, c.name), el("span", { class: "sub" }, ` · ${c.serverName} · Level ${c.level}`)));
      }
      if (!list.length) results.append(el("div", { class: "sub" }, "No one by that name in this shard."));
      results.hidden = false;
    } catch (e) {
      setStatus(String(e?.message || e), true);
    }
  }
  lookName.addEventListener("input", () => { clearTimeout(lookTimer); lookTimer = setTimeout(lookUp, 500); });
  lookName.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(lookTimer); lookUp(); } if (e.key === "Escape") results.hidden = true; });
  $(".lookRegion").addEventListener("change", () => { if (lookName.value.trim()) lookUp(); });

  /** The game's own combat power and gear score (the meter reads them
   *  live) go into the history as they change, between NC's readings. */
  let liveTimer = null;
  function noteLive(key, p) {
    if (!(p.cp > 0) || !(p.gs > 0)) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      const h = key === settings.current ? history : (await a2.storage.get(histKey(key)).catch(() => null)) || [];
      const last = [...h].reverse().find((e) => e && Number.isFinite(e.cp));
      if (last && last.cp === p.cp && last.gs === p.gs) return;
      const next = C.addHistory(h, { at: Date.now(), cp: p.cp, gs: p.gs, live: true }, 300);
      if (key === settings.current) { history = next; if (settings.tab === "history") renderHistory(); }
      await a2.storage.set(histKey(key), next).catch(() => {});
    }, 5000);
  }

  // The character you play: shown and read by itself when its last reading
  // is old (or there is none).
  a2.on("character", async (c) => {
    if (!c?.name || !c?.serverId) return;
    const was = playing;
    playing = { name: c.name, serverId: Number(c.serverId), cp: c.combatPower ?? null, gs: c.gearScore ?? null };
    const key = NC.keyOf(playing.serverId, playing.name);
    if (!settings.chars[key]) { settings.chars[key] = { name: c.name, serverId: playing.serverId }; saveSettings(); }
    noteLive(key, playing);
    if (was && was.name === playing.name && was.serverId === playing.serverId) { renderHeader(); return; }
    if (settings.current !== key || !snap) await openCharacter(key);
    else renderHeader();
    if (!snap || Date.now() - (snap.at || 0) > AUTO_EVERY) loadCharacter(settings.chars[key]);
  });

  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") settings = { ...settings, ...s, chars: s.chars || {} };
    } catch { /* defaults */ }
    reference = await a2.storage.get("reference").catch(() => null);
    if (settings.current) await openCharacter(settings.current);
    else render();
  })();
})();
