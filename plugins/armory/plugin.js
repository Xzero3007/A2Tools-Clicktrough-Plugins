// Armory: your character as NC's AION 2 character pages show it (gear,
// stats, skills, Daevanion, titles), read through the meter (a2.web.get,
// a2.web.image), every value on the page without hovering; the soul
// bindings you want on each piece and the chance of a new binding giving
// them; target levels for the skills you raise and the way there; the
// offensive Daevanion nodes still closed and the cheapest way to them;
// reference builds to compare with; the cheapest enhancing to a target gear
// score with its cost in Kinah and materials; and the character's history.
// Suggestions come from what the strongest players of the class keep.
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
  let settings = { tab: "overview", current: null, chars: {}, goalGs: null, region: null, daevSide: "pve" };
  let playing = null; // { name, serverId, cp, gs } from the meter
  let snap = null; // the character shown
  let history = [];
  /** The references: { active, list }; `reference` is the active one. */
  let refs = { active: 0, list: [] };
  let reference = null;
  /** What you aim at, per character: { soul: { slot: [property names] },
   *  skills: { skill name: level } }. Kept apart from the references, so
   *  another reference leaves them as they are. */
  let targets = { soul: {}, skills: {} };
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
  const targetKey = (key) => `t${key}`;

  async function loadTargets(key) {
    const t = key ? await a2.storage.get(targetKey(key)).catch(() => null) : null;
    targets = { soul: t?.soul || {}, skills: t?.skills || {} };
  }
  const targetTimers = {};
  function saveTargets() {
    const key = settings.current;
    if (!key) return;
    const value = targets;
    clearTimeout(targetTimers[key]);
    targetTimers[key] = setTimeout(() => a2.storage.set(targetKey(key), value).catch(() => {}), 300);
  }

  function setActiveReference() {
    refs.active = Math.max(0, Math.min(refs.active || 0, refs.list.length - 1));
    reference = refs.list[refs.active] || null;
  }
  async function saveReferences() {
    setActiveReference();
    await a2.storage.set("references", refs).catch(() => {});
  }

  /** A second press of the same button within 3 s does it (a sandboxed page
   *  has no confirm()). */
  function confirmTwice(what, text) {
    const now = Date.now();
    if (confirmTwice.what === what && now - confirmTwice.at < 3000) { confirmTwice.what = null; return true; }
    confirmTwice.what = what;
    confirmTwice.at = now;
    setStatus(text);
    return false;
  }

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
      if (settings.current !== key) await loadTargets(key);
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
    await loadTargets(key);
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

    pane.append(el("div", { class: "cols" }, gsBox, boardsBox, titleBox, other));
  }

  // ---- stats and what they do ---------------------------------------------
  let allStats = false;
  function renderStats() {
    const pane = $('[data-pane="stats"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet.")); return; }
    const stats = snap.stats || {};
    const refDeity = reference?.deity || {};
    const statList = el("div", { class: "kv" });
    for (const k of [...BASE, ...DEITY]) {
      const s = stats[k];
      if (!s) continue;
      statList.append(el("span", {}, el("span", {}, s.name), s.effects?.length ? el("span", { class: "sub" }, ` · ${s.effects.join(", ")}`) : null), el("b", {}, fmt(s.value)));
    }
    pane.append(el("div", { class: "cols" },
      el("div", { class: "box" }, el("h3", {}, "Base and deity stats"), deityWheel(stats, refDeity),
        Object.keys(refDeity).length ? el("p", { class: "note" }, `Gold: the reference (${reference.name || "build"}) where it differs.`) : null),
      el("div", { class: "box" }, el("h3", {}, "What each point gives"), statList,
        el("p", { class: "note" }, "Each point of a base or deity stat gives 0.1 % of what it names, the same for every point."))));

    // Every stat the character has, in the game's own words.
    const mine = C.characterStats(snap);
    const list = allStats
      ? (globalThis.ARMORY_DATA.glossary || []).map(([name, key]) => ({ name, entry: C.explainStat(name, key), from: mine.find((m) => m.name === name)?.from || [] }))
        .filter((x) => x.entry)
        .sort((a, b) => (C.STAT_GROUPS.indexOf(a.entry.group) + 100) % 100 - (C.STAT_GROUPS.indexOf(b.entry.group) + 100) % 100)
      : mine;
    pane.append(el("div", { class: "refhead" }, el("h3", { style: { margin: "14px 0 6px" } }, allStats ? "What every stat does" : "What your stats do"),
      el("span", { class: "grow" }),
      el("label", { class: "muted" }, el("input", { type: "checkbox", checked: allStats, onchange: (e) => { allStats = e.target.checked; renderStats(); } }), " every stat the game has")));
    pane.append(el("div", { class: "box", style: { marginBottom: "8px" } }, el("h3", {}, "In short"),
      el("ul", { class: "short" },
        el("li", {}, el("b", {}, "Bonus or increase: "), "a Bonus adds a flat amount (Attack Bonus +30); an increase multiplies the total (Attack increase +5.6 %)."),
        el("li", {}, el("b", {}, "Chance, Resist, Penetration: "), "your Perfect and Double Chance are lowered by the target's Perfect and Double Resist; a target's Regeneration and Endurance by your Regeneration and Endurance Penetration; Block by Block Penetration."),
        el("li", {}, el("b", {}, "Perfect: "), "a hit that deals more damage, from the weapon's Max Attack. ", el("b", {}, "Double: "), "a hit with greatly increased damage, from the final damage. ",
          el("b", {}, "Multi-hit: "), "up to 4 more hits, by Attack. ", el("b", {}, "Endurance: "), "halves the damage taken. ", el("b", {}, "Regeneration: "), "heals a part of the damage."),
        el("li", {}, el("b", {}, "Boost and Tolerance: "), "a Damage Boost (also Critical, Weapon, PvE, Boss, PvP) is weakened by the target's Tolerance of the same kind; Attack and Defense against monsters, bosses or characters count only against those."),
        el("li", {}, el("b", {}, "Caps the game states: "), "Critical Hit rate 50 % (less the target's Critical Hit Resist), Evasion 30 %, Cooldown and MP cost reduction 60 %, Move Speed 150 %, Defense never below 0."))));
    pane.append(el("p", { class: "note" }, "The game's own descriptions of its stats (its files, as Aion2Data lists them), with where yours come from."));
    let group = null;
    const box = el("div", { class: "gloss" });
    for (const x of list) {
      const g = x.entry?.group || "Other";
      if (g !== group) { group = g; box.append(el("div", { class: "ghead" }, g === "Other stats" ? "Base and deity stats, bonuses and increases" : g)); }
      box.append(el("div", { class: "gitem" },
        el("div", { class: "gname2" }, x.name, x.from.length ? el("span", { class: "sub" }, ` · from ${x.from.join(", ")}`) : null),
        el("div", { class: "gdesc" }, x.entry ? x.entry.desc : "The game describes it nowhere.")));
    }
    pane.append(box);
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

  // ---- soul binding -------------------------------------------------------
  const chances = new Map();
  function chanceOf(pool, id, wanted) {
    if (!pool || !wanted?.length) return null;
    const key = `${id}|${pool.count}|${wanted.join("|")}`;
    if (!chances.has(key)) chances.set(key, C.soulChance(pool, wanted));
    return chances.get(key);
  }
  const chanceText = (p) => (p == null ? "" : p <= 0 ? "never (more than the piece takes, or one it can't get)"
    : p >= 0.995 ? "certain" : p >= 0.1 ? `${fmt(p * 100, 0)} %` : p >= 0.01 ? `${fmt(p * 100, 1)} %, about 1 in ${fmt(Math.round(1 / p))}`
      : `about 1 in ${fmt(Math.round(1 / p))}`);
  const rangeText = (o) => (o.kind === "skill" ? (o.top > 1 ? `+1 to +${o.top}` : "+1")
    : `${fmt(o.min, 2)}–${fmt(o.max, 2)}${o.pct ? " %" : ""}`);

  function qualityBar(q) {
    if (q == null) return el("span", { class: "q none" });
    return el("span", { class: `q${q >= 0.9 ? " hi" : ""}`, title: `${Math.round(q * 100)} % of the way from the lowest to the highest roll` },
      el("i", { style: { width: `${Math.max(4, Math.round(q * 100))}%` } }));
  }

  let soulOpen = null; // the slot whose list of properties is open
  function setWanted(slot, list) {
    if (list?.length) targets.soul[slot] = list;
    else delete targets.soul[slot];
    saveTargets();
    renderSoul();
  }

  /** The pieces with a soul binding: the worn one's (or, where the game data
   *  lacks it, the reference's piece in that slot). */
  function soulPieces() {
    const cls = snap.profile?.className || "";
    const refBySlot = new Map((reference?.gear || []).map((g) => [g.slot, g]));
    const out = [], none = [];
    for (const slot of C.SLOT_ORDER) {
      const it = (snap.items || []).find((x) => x.slot === slot);
      if (!it) continue;
      const ref = refBySlot.get(slot);
      const other = ref?.id && ref.id !== it.id ? ref : null;
      const own = C.soulPool(it.id, cls);
      const refPool = other ? C.soulPool(other.id, cls) : null;
      if (own || refPool) out.push({ it, slot, pool: own || refPool, own: !!own, ref: other, refPool });
      else none.push(it);
    }
    return { cls, out, none };
  }

  function renderSoul() {
    const pane = $('[data-pane="soul"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet.")); return; }
    const { cls, out, none } = soulPieces();
    const top = C.topOf(cls);
    let wantedN = 0, hits = 0;
    for (const x of out) {
      const w = C.soulCompare(x.it, targets.soul[x.slot], x.pool).wanted;
      wantedN += w.length;
      hits += w.filter((y) => y.have).length;
    }
    pane.append(el("p", { class: "note" },
      "What each piece's soul binding has, and the properties you want on it: pick them from what the piece can get (Pick …). They stay when you change the reference. A new binding picks its properties one after another, never one twice: the stats share 80 % of each pick by their weights, your class's skill effects 20 %. ",
      top ? `“Top”: how many of the ${top.n} strongest ${cls}s (Shugo.GG's leaderboard of Global, ${short(top.cp[0])} to ${short(top.cp[2])} combat power) have it on that piece.` : "No strongest players counted for this class yet."));
    pane.append(el("div", { class: "refhead" },
      el("span", {}, wantedN ? el("b", {}, `${hits} of ${wantedN} wanted properties are on your pieces`) : "No properties picked yet."),
      el("span", { class: "grow" }),
      top ? el("button", { type: "button", class: "gold", title: "On every piece without picks: what the strongest players have on it most", onclick: () => {
        for (const x of out) {
          if (targets.soul[x.slot]?.length) continue;
          const p = C.topPicks(cls, x.slot, x.pool, x.it.arcana ? x.it.category : null);
          if (p.length) targets.soul[x.slot] = p;
        }
        saveTargets(); renderSoul();
      } }, "Top players' picks where none are picked") : null,
      wantedN ? el("button", { type: "button", onclick: () => { if (confirmTwice("soul", "Press Clear again to clear every piece's picks")) { targets.soul = {}; saveTargets(); renderSoul(); } } }, "Clear all") : null));
    for (const [name, slots] of GROUPS) {
      const list = out.filter((x) => slots.includes(x.slot));
      if (list.length) pane.append(el("h3", {}, name), el("div", { class: "cards soul" }, list.map((x) => soulCard(x, cls))));
    }
    if (none.length) pane.append(el("p", { class: "note" }, `No soul binding in the game's item data: ${none.map((it) => it.name).join(", ")}.`));
  }

  function soulCard(x, cls) {
    const { it, slot, pool } = x;
    const wanted = targets.soul[slot] || [];
    const cmp = C.soulCompare(it, wanted, pool);
    const t = C.topSlot(cls, slot, it.arcana ? it.category : null);
    const share = new Map([...(t?.stats || []), ...(t?.skills || [])].map(([n, sh]) => [n.toLowerCase(), sh]));
    const topText = (name) => {
      const sh = share.get(name.toLowerCase());
      return sh ? el("span", { class: "tp" }, `top ${Math.round(sh * 100)} %`) : el("span", { class: "tp" });
    };
    const rows = [];
    for (const w of cmp.wanted) {
      rows.push(el("div", { class: `prow ${w.have ? "ok" : "miss"}` },
        el("span", { class: "mk" }, w.have ? "✓" : w.prop ? "✗" : "!"),
        el("span", { class: "pn" }, w.name),
        el("span", { class: "pv" }, w.have ? w.value : w.prop ? rangeText(w.prop) : "not on this piece"),
        w.have ? qualityBar(w.quality) : el("span", { class: "q none" }),
        topText(w.name)));
    }
    for (const h of cmp.extra) {
      rows.push(el("div", { class: `prow ${wanted.length ? "extra" : "has"}` },
        el("span", { class: "mk" }, "·"),
        el("span", { class: "pn" }, h.name),
        el("span", { class: "pv" }, h.value),
        qualityBar(h.quality),
        topText(h.name)));
    }
    const p = wanted.length && cmp.wanted.some((w) => !w.have) ? chanceOf(pool, x.own ? it.id : x.ref.id, wanted) : null;
    const pRef = p != null && x.own && x.refPool && x.refPool.count !== pool.count ? chanceOf(x.refPool, x.ref.id, wanted) : null;
    const open = soulOpen === slot;
    const card = el("div", { class: `card soulcard g-${it.grade}${open ? " open" : ""}` },
      el("div", { class: "head" }, picture(it.icon, "ico s", it.grade),
        el("div", { class: "t" },
          el("div", { class: "nm gname", title: it.name }, it.name),
          el("div", { class: "lv" }, `${C.SLOT_LABEL[slot] || slot} · ${pool.count} properties`,
            x.own ? "" : ` on the reference's ${x.ref.name}`,
            x.own && x.ref && x.refPool && (x.ref.name !== it.name || x.refPool.count !== pool.count) ? ` · reference: ${x.ref.name} (${x.refPool.count})` : "")),
        el("div", { class: "btns" },
          el("button", { type: "button", class: open ? "on" : "", onclick: () => { soulOpen = open ? null : slot; renderSoul(); } }, open ? "Done" : "Pick …"))),
      rows.length ? el("div", { class: "props" }, rows) : el("div", { class: "sub" }, "Nothing on it yet."),
      wanted.length ? el("div", { class: "chance" },
        cmp.wanted.every((w) => w.have) ? el("span", { class: "good" }, "✓ Every wanted property is on it.")
          : [`A new binding gives all ${wanted.length} wanted: `, el("b", {}, chanceText(p)),
            pRef != null ? el("span", { class: "sub" }, ` · on the reference's piece (${x.refPool.count} properties): ${chanceText(pRef)}`) : null]) : null,
      open ? soulPicker(x, cls, wanted, share) : null);
    return card;
  }

  function soulPicker(x, cls, wanted, share) {
    const { it, slot, pool } = x;
    const isOn = (name) => wanted.some((w) => w.toLowerCase() === name.toLowerCase());
    const full = wanted.length >= pool.count;
    const option = (o) => {
      const on = isOn(o.name);
      const sh = share.get(o.name.toLowerCase());
      return el("label", { class: `opt${on ? " on" : ""}${!on && full ? " off" : ""}` },
        el("input", { type: "checkbox", checked: on, disabled: !on && full, onchange: (e) => {
          setWanted(slot, e.target.checked ? [...wanted, o.name] : wanted.filter((w) => w.toLowerCase() !== o.name.toLowerCase()));
        } }),
        el("span", { class: "pn" }, o.name),
        el("span", { class: "sub" }, rangeText(o)),
        el("span", { class: "sub", title: "The chance to be a binding's first pick" }, `${fmt(o.first * 100, o.first < 0.01 ? 2 : 1)} %`),
        el("span", { class: sh ? "tp" : "tp none" }, sh ? `top ${Math.round(sh * 100)} %` : ""));
    };
    const order = (list) => list.slice().sort((a, b) => (share.get(b.name.toLowerCase()) || 0) - (share.get(a.name.toLowerCase()) || 0) || b.first - a.first);
    const picks = C.topPicks(cls, slot, pool, it.arcana ? it.category : null);
    return el("div", { class: "picker" },
      el("div", { class: "phead" }, el("span", {}, `Up to ${pool.count}: ${wanted.length} picked`),
        el("span", { class: "grow" }),
        picks.length ? el("button", { type: "button", class: "gold", onclick: () => setWanted(slot, picks) }, "Top players' picks") : null,
        wanted.length ? el("button", { type: "button", onclick: () => setWanted(slot, []) }, "None") : null),
      el("div", { class: "olist" },
        pool.stats.length ? [el("div", { class: "og" }, "Stats", el("span", { class: "sub" }, " · range · first pick · top")), order(pool.stats).map(option)] : null,
        pool.skills.length ? [el("div", { class: "og" }, `${cls} skill effects`, el("span", { class: "sub" }, " · level · first pick · top")), order(pool.skills).map(option)] : null));
  }

  // ---- skills -----------------------------------------------------------
  /** Where a level comes from, on a scale of 0 to `scale`: skill points,
   *  Daevanion, gear and Arcana; a gold mark at the target, a white one at
   *  the reference's level. */
  function skillBar(s, scale, target) {
    const w = (v) => (100 * Math.max(0, Math.min(v, scale))) / scale;
    const a = s.base, b = a + s.fromDaev, c = b + s.fromGear;
    return el("span", { class: "skbar", title: `${s.base} skill points · ${s.fromDaev} Daevanion · ${s.fromGear} gear and Arcana` },
      el("span", { class: "base", style: { left: 0, width: `${w(a)}%` } }),
      el("span", { class: "daev", style: { left: `${w(a)}%`, width: `${w(b) - w(a)}%` } }),
      el("span", { class: "gear", style: { left: `${w(b)}%`, width: `${w(c) - w(b)}%` } }),
      [10, 14, 20].filter((m) => m < scale).map((m) => el("span", { class: "mark", style: { left: `${w(m)}%` } })),
      s.refLevel != null ? el("span", { class: "ref", style: { left: `${w(s.refLevel)}%` } }) : null,
      target != null ? el("span", { class: "tgt", style: { left: `${w(target)}%` } }) : null);
  }

  /** "Arcana: Parchment" → "Parchment", "Rings" stays, "MainHand" → "Weapon". */
  const sourceName = (w) => (w.startsWith("Arcana: ") ? `${w.slice(8)} (Arcana)` : C.SLOT_LABEL[w] || w);

  function skillHint(s, target, top) {
    if (target == null) return "";
    if (s.level >= target) return el("span", { class: "good" }, "✓ At the target.");
    if (s.category === "Dp") return `${target - s.level} to go: Stigma levels come from Stigma Shards.`;
    const way = C.skillWay(s, target);
    const parts = [];
    if (way.points) parts.push(`${way.points} from skill points (to 10)`);
    if (way.daevanion.length) {
      parts.push(`${way.daevanion.reduce((a, n) => a + n.gives, 0)} from Daevanion: ${way.daevanion.map((n) => `${n.board} (${n.grade}, ${n.points} pt)`).join(", ")}`);
    }
    if (way.gear) {
      const from = (top?.sources || []).slice(0, 3).map(([w]) => sourceName(w));
      parts.push(`${way.gear} from extra skill levels on gear and Arcana${from.length ? ` (the top players have theirs from ${from.join(", ")})` : ""}`);
    }
    return `To ${target}: ${parts.join("; ")}.`;
  }

  function setSkillTarget(name, level) {
    if (level > 0) targets.skills[name] = level;
    else delete targets.skills[name];
    saveTargets();
    renderSkills();
  }

  function targetSelect(s) {
    const cur = targets.skills[s.name] ?? null;
    const levels = s.category === "Dp" ? Array.from({ length: 20 }, (_, i) => i + 1) : Array.from({ length: 21 }, (_, i) => i + 10);
    if (cur != null && !levels.includes(cur)) levels.push(cur);
    return el("select", { class: "tsel", title: "The level you aim at", onchange: (e) => setSkillTarget(s.name, Number(e.target.value)) },
      el("option", { value: "" }, "—"),
      levels.sort((a, b) => a - b).map((v) => el("option", { value: v, selected: v === cur }, v)));
  }

  function skillRow(s, cat, scale, topLevels) {
    const target = targets.skills[s.name] ?? null;
    const top = topLevels[s.name];
    return el("tr", { class: target != null && s.level >= target ? "reached" : "" },
      el("td", {}, el("div", { class: "cell" }, picture(s.icon, "ico s"), el("span", { class: "txt" }, s.name, s.equipped && cat !== "Passive" ? el("span", { class: "sub" }, " · in use") : null))),
      el("td", {}, el("span", { class: `lvl${target != null && s.level >= target ? " max" : ""}` }, s.level),
        s.refLevel != null ? el("div", { class: s.refLevel > s.level ? "sub gold-t" : "sub" }, `ref ${s.refLevel}`) : null),
      el("td", {}, targetSelect(s), top?.median > 0 ? el("div", { class: "sub", title: `${Math.round(top.at20 * 100)} % of them at 20 or more, ${Math.round(top.at16 * 100)} % at 16 or more` }, `top ${fmt(top.median, 1)}`) : null),
      el("td", { class: "l" }, cat === "Dp" ? null : [skillBar(s, scale, target), el("div", { class: "sub" }, `${s.base} + ${s.fromDaev} + ${s.fromGear}`)]),
      el("td", { class: "l wrap sub" }, skillHint(s, target, top),
        s.gear.length ? el("div", {}, `Now from: ${s.gear.map((g) => `${g.item} +${g.level}`).join(", ")}`) : null));
  }

  function skillTable(rows) {
    return el("table", { class: "fixed skills" },
      el("colgroup", {}, el("col", { style: { width: "190px" } }), el("col", { style: { width: "52px" } }), el("col", { style: { width: "66px" } }),
        el("col", { style: { width: "150px" } }), el("col", {})),
      el("thead", {}, el("tr", {}, el("th", {}, "Skill"), el("th", {}, "Level"), el("th", {}, "Target"), el("th", { class: "l" }, "Points + Daev. + gear"), el("th", { class: "l" }, "The way to the target"))),
      el("tbody", {}, rows));
  }

  let showUntracked = null; // { category: true } folded open by hand
  function renderSkills() {
    const pane = $('[data-pane="skills"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet.")); return; }
    const cls = snap.profile?.className || "";
    const top = C.topOf(cls);
    const topLevels = C.topSkillLevels(cls);
    const all = C.compareSkills(C.skillSources(snap), reference);
    const learnt = all.filter((s) => s.acquired || s.level > 0);
    const tracked = learnt.filter((s) => targets.skills[s.name] != null);
    const reached = tracked.filter((s) => s.level >= targets.skills[s.name]).length;
    pane.append(el("p", { class: "note" },
      tracked.length ? `${reached} of ${tracked.length} skills at their target. ` : "Pick a target level for the skills you raise (the list in each row): the others fold away. ",
      "A skill reaches 10 with skill points, up to 14 with the Daevanion boards (one node on each of the first four), and more with extra skill levels on gear and Arcana."));
    const fromRef = (reference?.skills || []).length;
    pane.append(el("div", { class: "refhead" },
      el("span", { class: "muted" }, "Targets:"),
      fromRef ? el("button", { type: "button", onclick: () => {
        for (const s of learnt) if (s.refLevel != null && s.category !== "Dp") targets.skills[s.name] = s.refLevel;
        saveTargets(); renderSkills();
      } }, `The reference's levels`) : null,
      top ? el("button", { type: "button", class: "gold", title: `The median level of the ${top.n} strongest ${cls}s, for the skills most of them raise to 10 or more`, onclick: () => {
        for (const s of learnt) {
          const t = topLevels[s.name];
          if (t && t.median >= 10) targets.skills[s.name] = Math.round(t.median);
        }
        saveTargets(); renderSkills();
      } }, `The top ${cls}s' levels`) : null,
      tracked.length ? el("button", { type: "button", onclick: () => { if (confirmTwice("skills", "Press Clear again to clear every skill target")) { targets.skills = {}; saveTargets(); renderSkills(); } } }, "Clear") : null));
    pane.append(el("div", { class: "sklegend" },
      el("span", {}, el("i", { style: { background: "rgba(255,255,255,.5)" } }), "skill points"),
      el("span", {}, el("i", { style: { background: "#c39bff" } }), "Daevanion"),
      el("span", {}, el("i", { style: { background: "#f2c46b" } }), "gear and Arcana"),
      el("span", {}, el("i", { style: { background: "#f2c46b", width: "3px", height: "12px" } }), "your target"),
      reference ? el("span", {}, el("i", { style: { background: "#fff", width: "3px", height: "12px" } }), "the reference's level") : null,
      el("span", {}, "marks at 10, 14, 20"),
      top ? el("span", {}, `“top”: the median of the ${top.n} strongest ${cls}s`) : null));
    const scale = Math.max(20, ...learnt.map((s) => s.level), ...Object.values(targets.skills));
    const groups = [["Active", "Active skills"], ["Passive", "Passive skills"], ["Dp", "Stigmas"]];
    for (const [cat, title] of groups) {
      const list = learnt.filter((s) => s.category === cat).sort((a, b) => (b.equipped - a.equipped) || (b.level - a.level));
      if (!list.length) continue;
      const on = list.filter((s) => targets.skills[s.name] != null);
      const off = list.filter((s) => targets.skills[s.name] == null);
      pane.append(el("h3", {}, title));
      if (on.length) pane.append(skillTable(on.map((s) => skillRow(s, cat, scale, topLevels))));
      if (off.length) {
        const open = showUntracked?.[cat] ?? !on.length;
        const d = el("details", { class: "untracked", open },
          el("summary", {}, on.length ? `${off.length} more without a target` : `${off.length} skills without a target`),
          skillTable(off.map((s) => skillRow(s, cat, scale, topLevels))));
        d.addEventListener("toggle", () => { showUntracked = { ...(showUntracked || {}), [cat]: d.open }; });
        pane.append(d);
      }
    }
    pane.append(el("p", { class: "note" }, "Extra skill levels on gear and Arcana are rolls of the soul binding: its tab shows the chance of a new binding giving the ones you want."));
  }

  // ---- Daevanion: the offensive nodes still closed ------------------------
  let daevBoard = null; // the board shown
  let daevPick = null; // the node picked on it
  let daevAll = false; // every closed offensive node listed, not the nearest only
  const SIDES = [["pve", "PvE and bosses"], ["pvp", "PvP"], ["all", "Both"]];
  const val = (v, pct) => `+${fmt(v, 2)}${pct ? " %" : ""}`;

  function renderDaevanion() {
    const pane = $('[data-pane="daevanion"]');
    pane.textContent = "";
    if (!snap) { pane.append(el("p", { class: "empty" }, "Nothing read yet.")); return; }
    const boards = (snap.boards || []).filter((b) => b.nodes?.length);
    if (!boards.length) { pane.append(el("p", { class: "empty" }, "No Daevanion board read: Update reads them again.")); return; }
    const side = SIDES.some(([k]) => k === settings.daevSide) ? settings.daevSide : "pve";
    const rows = C.boardOffense(boards, side);
    const closed = rows.filter((r) => r.nodes);
    const offOf = (b) => C.boardWays(b).filter((n) => !n.open && C.nodeOffense(n, side).length);
    const allOff = boards.flatMap(offOf);
    const nodes = allOff.length, points = allOff.reduce((a, n) => a + n.points, 0);

    pane.append(el("div", { class: "refhead" },
      el("span", {}, closed.length ? el("b", {}, `${closed.length} offensive stats still have closed nodes: ${nodes} nodes, ${points} points`) : el("b", { class: "good" }, "✓ Every offensive node is open.")),
      el("span", { class: "grow" }),
      el("span", { class: "seg" }, SIDES.map(([k, label]) => el("button", { type: "button", class: k === side ? "on" : "",
        onclick: () => { settings.daevSide = k; saveSettings(); renderDaevanion(); } }, label)))));
    pane.append(el("p", { class: "note" }, "Offensive: what makes your hits land, hit harder or come faster (Attack, Accuracy, Critical Hit, Combat Speed, Cooldown, Penetration, Boosts, Multi-hit, Perfect and Double). “PvE and bosses” leaves out what counts against characters only."));

    // Every offensive stat: open, still closed, and on which board.
    const withClosed = boards.filter((b) => closed.some((r) => r.boards[b.name]));
    const tbody = el("tbody");
    for (const r of rows) {
      tbody.append(el("tr", { class: r.nodes ? "" : "done" },
        el("td", {}, r.name),
        el("td", {}, r.have ? val(r.have, r.pct) : el("span", { class: "faint" }, "—")),
        el("td", { class: r.nodes ? "gold-t" : "" }, r.nodes ? val(r.closed, r.pct) : el("span", { class: "good" }, "✓ all open")),
        el("td", {}, r.nodes || ""),
        el("td", {}, r.points || ""),
        el("td", {}, r.cheapest != null ? `${r.cheapest} pt` : ""),
        withClosed.map((b) => el("td", { class: "sub" }, r.boards[b.name] ? val(r.boards[b.name], r.pct) : ""))));
    }
    pane.append(el("table", { class: "dsum" },
      el("thead", {}, el("tr", {}, el("th", {}, "Stat"), el("th", {}, "Open"), el("th", {}, "Still closed"), el("th", {}, "Nodes"), el("th", {}, "Points"),
        el("th", { title: "The points to the nearest one: every closed node on the way, that one included" }, "Nearest"),
        withClosed.map((b) => el("th", {}, b.name)))),
      tbody));

    // One board: its map and its closed offensive nodes, nearest first.
    if (!boards.some((b) => b.name === daevBoard)) {
      daevBoard = [...boards].sort((a, b) => offOf(b).reduce((s, n) => s + n.points, 0) - offOf(a).reduce((s, n) => s + n.points, 0))[0].name;
      daevPick = null;
    }
    pane.append(el("div", { class: "chips boardchips" }, boards.map((b) => {
      const n = offOf(b).length;
      return el("button", { type: "button", class: `chip${b.name === daevBoard ? " on" : ""}`, onclick: () => { daevBoard = b.name; daevPick = null; renderDaevanion(); } },
        `${b.name} ${b.points}/${b.maxPoints}`, n ? el("span", { class: "gold-t" }, ` · ${n} offensive`) : null);
    })));
    const board = boards.find((b) => b.name === daevBoard);
    const ways = C.boardWays(board);
    const off = offOf(board).sort((a, b) => a.cost - b.cost || b.points - a.points);
    const picked = ways.find((n) => n.id === daevPick) || null;
    const byId = new Map(ways.map((n) => [n.id, n]));

    const side_ = el("div", { class: "dside" });
    if (picked) {
      const path = picked.path.map((id) => byId.get(id)).reverse();
      side_.append(el("div", { class: "box dpick" },
        el("div", {}, el("b", {}, nodeText(picked, side)), el("span", { class: "sub" }, ` · ${picked.grade} node, ${picked.points} pt`)),
        picked.open ? el("div", { class: "good" }, "✓ Open.")
          : el("div", {}, path.length === 1 ? "Next to an open one." : `The way from what is open: ${path.length} nodes, ${picked.cost} points.`),
        !picked.open && path.length > 1 ? el("ul", { class: "short" }, path.map((n) => el("li", { class: n.offensive ? "gold-t" : n.skill ? "purple-t" : "" }, `${nodeText(n)} (${n.points} pt)`))) : null));
    }
    side_.append(el("h3", {}, off.length ? `${board.name}: offensive nodes still closed` : `${board.name}: every offensive node open`));
    const list = el("div", { class: "dlist" });
    const shown = daevAll ? off : off.slice(0, 14);
    for (const n of shown) {
      list.append(el("button", { type: "button", class: `drow${n.id === daevPick ? " on" : ""}`, onclick: () => { daevPick = n.id; renderDaevanion(); } },
        el("span", {}, nodeText(n, side)),
        el("span", { class: "sub" }, `${n.grade} · ${n.points} pt`),
        el("span", { class: "sub" }, n.path.length > 1 ? `way ${n.cost} pt, ${n.path.length} nodes` : "next to an open one")));
    }
    side_.append(list);
    if (off.length > shown.length || daevAll) {
      side_.append(el("button", { type: "button", class: "more", onclick: () => { daevAll = !daevAll; renderDaevanion(); } },
        daevAll ? "Show the nearest only" : `Show all ${off.length}`));
    }
    const skills = ways.filter((n) => n.skill && !n.open);
    if (skills.length) {
      side_.append(el("h3", {}, "Skill levels still closed"), el("div", { class: "dlist" }, skills.sort((a, b) => a.cost - b.cost).map((n) => {
        const t = targets.skills[n.skill.name];
        return el("button", { type: "button", class: `drow${n.id === daevPick ? " on" : ""}`, onclick: () => { daevPick = n.id; renderDaevanion(); } },
          el("span", { class: "purple-t" }, nodeText(n)),
          el("span", { class: "sub" }, `${n.grade} · ${n.points} pt`),
          el("span", { class: t ? "sub gold-t" : "sub" }, t ? `your target ${t}` : n.path.length > 1 ? `way ${n.cost} pt` : "next to an open one"));
      })));
    }
    const map = boardMap(ways, side, picked);
    pane.append(el("div", { class: "dwrap" }, el("div", { style: { width: `${map.getAttribute("width")}px` } }, map, mapLegend()), side_));
    pane.append(el("p", { class: "note" }, "A node opens next to an open one, side by side. The way's points are every closed node on the cheapest way from what is open, the node itself included; the nodes on the way give their stats too."));
  }

  /** A node's effects in words; with `side`, its offensive ones in gold. */
  function nodeText(n, side) {
    if (n.type === "Start") return "Start";
    if (n.skill) return `${n.skill.name} +${n.skill.gives}`;
    if (!side || !n.stats?.length) return (n.effects || []).join(", ") || n.name || "?";
    const off = new Set(C.nodeOffense(n, side));
    return el("span", {}, n.stats.map((e, i) => [i ? ", " : "", el("span", { class: off.has(e) ? "gold-t" : "muted" }, (n.effects || [])[i])]));
  }

  function boardMap(ways, side, picked) {
    const cell = 24, pad = 2;
    const rows = ways.map((n) => n.row), cols = ways.map((n) => n.col);
    const r0 = Math.min(...rows), c0 = Math.min(...cols);
    const W = (Math.max(...cols) - c0 + 1) * cell + 2 * pad, H = (Math.max(...rows) - r0 + 1) * cell + 2 * pad;
    const s = svg("svg", { class: "dmap", viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const onWay = new Set(picked && !picked.open ? picked.path : []);
    for (const n of ways) {
      const kind = n.type === "Start" ? "start" : n.skill ? "skill" : C.nodeOffense(n, side).length ? "off" : "other";
      const g = svg("g", { class: `nd ${kind}${n.open ? " open" : ""}${onWay.has(n.id) ? " way" : ""}${picked?.id === n.id ? " pick" : ""}`,
        transform: `translate(${pad + (n.col - c0) * cell},${pad + (n.row - r0) * cell})` });
      g.append(svg("rect", { x: 2, y: 2, width: cell - 4, height: cell - 4, rx: n.type === "Start" ? 10 : 3 }));
      if (!n.open) g.append(svg("text", { x: cell / 2, y: cell / 2 + 3.5, "text-anchor": "middle" }, n.points));
      g.append(svg("title", {}, `${nodeText(n)} · ${n.grade} · ${n.open ? "open" : `closed, way ${n.cost} pt`}`));
      g.addEventListener("click", () => { daevPick = n.id; renderDaevanion(); });
      s.append(g);
    }
    return s;
  }

  const mapLegend = () => el("div", { class: "sklegend" },
    el("span", {}, el("i", { class: "lg off" }), "offensive"),
    el("span", {}, el("i", { class: "lg skill" }), "skill level"),
    el("span", {}, el("i", { class: "lg other" }), "other"),
    el("span", {}, "filled: open · a number: closed, its points"),
    el("span", {}, el("i", { class: "lg way" }), "the way to the node picked"));

  // ---- reference --------------------------------------------------------
  const CATS_OF_SLOT = {
    MainHand: ["Greatsword", "Longsword", "Dagger", "Bow", "Spellbook", "Orb", "Mace", "Staff"], SubHand: ["Guard"],
    Helmet: ["Helm"], Shoulder: ["Pauldrons"], Torso: ["Top"], Pants: ["Legs"], Gloves: ["Gloves"], Boots: ["Shoes"], Cape: ["Cloak"],
    Belt: ["Belt"], Necklace: ["Necklace"], Earring1: ["Earrings"], Earring2: ["Earrings"], Ring1: ["Ring"], Ring2: ["Ring"],
    Bracelet1: ["Bracelet"], Bracelet2: ["Bracelet"], Amulet: ["Amulet"], Rune1: ["Rune"], Rune2: ["Rune"],
  };

  /** A build read: added to the one of the same name (its other tabs saved
   *  apart add up), or kept as a new reference; it becomes the active one. */
  async function addReference(ref) {
    const at = refs.list.findIndex((r) => r.name && r.name === ref.name);
    if (at >= 0) {
      refs.list[at] = { ...C.mergeReference(ref, refs.list[at]), id: refs.list[at].id };
      refs.active = at;
    } else {
      refs.list.push({ ...ref, id: Date.now() });
      refs.active = refs.list.length - 1;
    }
    await saveReferences();
    render();
    return refs.list[refs.active];
  }
  async function removeReference() {
    refs.list.splice(refs.active, 1);
    refs.active = Math.max(0, refs.active - 1);
    await saveReferences();
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
    editRef = false;
    addReference(ref).then((r) => setStatus(`Reference: ${r.name || "build"} (${r.gear.length} pieces, ${r.skills.length} skills, ${r.boards.length} boards)`));
  }

  function importBox() {
    const file = el("input", { type: "file", accept: ".html,.htm,text/html", multiple: true,
      onchange: (e) => { if (e.target.files?.length) importFiles([...e.target.files]); } });
    const area = el("textarea", { placeholder: "… or paste a saved page's HTML, or a reference code, here" });
    return el("div", { class: "import" },
      el("p", { class: "note" }, "A build to compare with and aim at: open a character build on questlog.gg in your browser, save the page (Ctrl+S, “Web page, complete” or “HTML only”), once on its Equipment tab and, for skills and Daevanion, once on those tabs, then pick the saved files here. A page of a build already here adds to it; another build becomes a new reference. Nothing is sent anywhere: the files are read here."),
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
    const which = el("select", { class: "refpick", title: "The reference the other tabs compare with", onchange: (e) => {
      refs.active = Number(e.target.value); editRef = false; saveReferences().then(render);
    } }, refs.list.map((r, i) => el("option", { value: i, selected: i === refs.active }, r.name || `Reference ${i + 1}`)));
    pane.append(el("div", { class: "refhead" },
      refs.list.length > 1 ? which : el("span", { class: "nm" }, reference.name || "Reference"),
      el("span", { class: "muted" }, reference.source ? `from ${reference.source}` : ""),
      el("span", { class: "grow" }),
      reference.gearScore ? el("span", {}, "Gear score ", el("b", { class: "gold-t" }, fmt(reference.gearScore)), mineGs ? el("span", { class: "muted" }, ` · yours ${fmt(mineGs)} (${plusMinus(mineGs - reference.gearScore)})`) : null) : null,
      el("button", { type: "button", onclick: () => { editRef = !editRef; renderReference(); } }, editRef ? "Done" : "Edit"),
      el("button", { type: "button", onclick: () => { const box = $(".refcode"); box.hidden = !box.hidden; } }, "Code"),
      el("button", { type: "button", onclick: () => { if (confirmTwice("ref", "Press Remove again to remove this reference")) removeReference(); } }, "Remove")));
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
    pane.append(el("h3", {}, "Add a reference, or a tab of this one"), importBox());
  }

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
      refs.list[refs.active] = reference;
      a2.storage.set("references", refs).catch(() => {});
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
  const RENDER = { overview: renderOverview, stats: renderStats, gear: renderGear, soul: renderSoul, skills: renderSkills, daevanion: renderDaevanion,
    reference: renderReference, goals: renderGoals, history: renderHistory };
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
    const saved = await a2.storage.get("references").catch(() => null);
    if (saved && Array.isArray(saved.list)) refs = { active: saved.active || 0, list: saved.list };
    else {
      // Before there were several: the one reference.
      const one = await a2.storage.get("reference").catch(() => null);
      if (one && typeof one === "object") {
        refs = { active: 0, list: [{ ...one, id: Date.now() }] };
        await a2.storage.set("references", refs).catch(() => {});
      }
    }
    setActiveReference();
    if (settings.current) await openCharacter(settings.current);
    else render();
  })();
})();
