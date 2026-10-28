// The Armory plugin's sums: a character's gear score from its parts, what
// enhancing costs (the game's own tables, data.js), the cheapest way to a
// target gear score, where each skill's level comes from and what is left to
// 16 and 20, a comparison with a reference build, and a saved questlog.gg
// build page read back. No page here: the window (plugin.js) and the tests
// use it.
(() => {
  const D = globalThis.ARMORY_DATA;

  // ---- gear score -------------------------------------------------------
  // The game's Item Level, from the parts NC's character pages show; found
  // on 24 characters, exact for every one (2026-10-28):
  //   each worn piece (Arcana too): its item level + its enhance level
  //   each Amplify level (+16 and on): 5
  //   each Manastone: Common 1, Rare 2, Legend 3, Unique 4
  //   each Theostone (godstone): Rare 3, Legend 5 (Common 1, Unique 7 by
  //     the same steps; not seen yet)
  //   each Daevanion point spent (a node: Common 1, Rare 2, Legend 3, Unique 4)
  // Titles do not count.
  const GRADE_POINTS = { Common: 1, Rare: 2, Legend: 3, Unique: 4 };
  const THEOSTONE_POINTS = { Common: 1, Rare: 3, Legend: 5, Unique: 7 };
  const AMPLIFY_POINTS = 5;

  /** The gear score of a snapshot (see nc.js) and its parts. */
  function gearScore(snap) {
    const parts = { level: 0, enchant: 0, amplify: 0, manastones: 0, theostones: 0, daevanion: 0 };
    for (const it of snap?.items || []) {
      parts.level += it.il || 0;
      parts.enchant += it.enchant || 0;
      parts.amplify += AMPLIFY_POINTS * (it.amplify || 0);
      for (const s of it.stones || []) parts.manastones += GRADE_POINTS[s.grade] || 0;
      for (const g of it.theostones || []) parts.theostones += THEOSTONE_POINTS[g.grade] || 0;
    }
    for (const b of snap?.boards || []) parts.daevanion += b.points || 0;
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return { total, parts };
  }

  /** Daevanion points of a node, by its grade. */
  const nodePoints = (grade) => GRADE_POINTS[grade] || 0;

  // ---- items and their tables ------------------------------------------
  const ITEMS = D.items;
  /** [name, grade, category, item level, icon, enchant table, effect table, amplify table] */
  const itemRow = (id) => ITEMS[String(id)] || null;
  const itemName = (id) => itemRow(id)?.[0] || `Item ${id}`;

  /** An icon's file name as both sites spell it, for matching:
   *  "Icon_Equip_AR_L_Idris_01_Torso.webp" and "Icon_GM_Idris_01_Torso" both
   *  "idris_01_torso"; "Icon_Acc_Rune_R_002" and "Icon_Equip_ACC_Rune_R_002"
   *  both "acc_rune_r_002". */
  function iconKey(icon) {
    let k = String(icon || "").split(/[/\\]/).pop().replace(/\.[a-z0-9]+$/i, "").toLowerCase();
    k = k.replace(/^icon_/, "").replace(/^equip_/, "").replace(/^ar_[a-z]_/, "").replace(/^gm_/, "");
    return k;
  }
  let ICON_INDEX = null;
  function itemsByIcon(icon) {
    if (!ICON_INDEX) {
      ICON_INDEX = new Map();
      for (const [id, r] of Object.entries(ITEMS)) {
        const k = iconKey(r[4]);
        if (!ICON_INDEX.has(k)) ICON_INDEX.set(k, []);
        ICON_INDEX.get(k).push(Number(id));
      }
    }
    return ICON_INDEX.get(iconKey(icon)) || [];
  }

  /** Items whose name has all the words of `query` (for the reference editor). */
  function searchItems(query, category, limit = 12) {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const [id, r] of Object.entries(ITEMS)) {
      if (category && r[2] !== category) continue;
      const name = r[0].toLowerCase();
      if (words.every((w) => name.includes(w))) out.push(Number(id));
    }
    out.sort((a, b) => (itemRow(b)[3] - itemRow(a)[3]) || itemName(a).localeCompare(itemName(b)));
    return out.slice(0, limit);
  }

  // ---- what enhancing costs ---------------------------------------------
  // A table step: [chance /10000, chance added per failure /10000, levels lost
  // on failure (0 or -1), Kinah per try, [[material, count], ...] per try].

  /** Tries for one step, its chance rising after every failure: the
   *  average, the try by which it is certain (Infinity if never), and the
   *  try by which it succeeded 9 times in 10. */
  function stepTries(p10000, corr10000) {
    const p = p10000 / 10000;
    const c = corr10000 / 10000;
    let expected = 0;
    let fail = 1; // the chance all tries so far failed
    let p90 = null;
    let certain = Infinity;
    for (let k = 0; k < 2000 && fail > 1e-12; k++) {
      expected += fail;
      const chance = Math.min(1, p + k * c);
      if (chance >= 1 && certain === Infinity) certain = k + 1;
      fail *= 1 - chance;
      if (p90 == null && fail <= 0.1) p90 = k + 1;
    }
    return { expected, certain, p90: p90 ?? certain };
  }

  /** The cost of climbing a table from level `from` to `to`: each step
   *  (chance, tries, Kinah and materials, average and 9-in-10), and the sums.
   *  A step that loses a level on failure (Clash Rune) counts the climb back
   *  (T(n) = (1 + (1 − p)·T(n−1)) / p). */
  function climb(table, from, to) {
    const steps = [];
    const sum = { tries: 0, kinah: 0, kinahP90: 0, mats: {}, matsP90: {} };
    if (!Array.isArray(table)) return { steps, sum, known: false };
    let backTries = 0; // average tries to get back to this level after a loss
    const backMats = {};
    let backKinah = 0;
    for (let lv = 0; lv < Math.min(to, table.length); lv++) {
      const [p, corr, pen, kinah, mats] = table[lv];
      if (!(p > 0)) break;
      let tries, p90, certain;
      let stepKinah, stepMats;
      if (pen < 0) {
        const q = p / 10000;
        tries = (1 + (1 - q) * backTries) / q;
        const t = stepTries(p, 0);
        p90 = t.p90; certain = t.certain;
        stepKinah = (kinah + (1 - q) * backKinah) / q;
        stepMats = {};
        for (const [m, n] of mats) stepMats[m] = (n + (1 - q) * (backMats[m] || 0)) / q;
        for (const [m, v] of Object.entries(backMats)) if (!(m in stepMats)) stepMats[m] = ((1 - q) * v) / q;
      } else {
        const t = stepTries(p, corr);
        tries = t.expected; p90 = t.p90; certain = t.certain;
        stepKinah = tries * kinah;
        stepMats = Object.fromEntries(mats.map(([m, n]) => [m, tries * n]));
      }
      // What this level costs to regain, for the next step's losses.
      backTries = tries; backKinah = stepKinah;
      for (const k of Object.keys(backMats)) delete backMats[k];
      Object.assign(backMats, stepMats);
      if (lv < from) continue;
      const step = { level: lv + 1, chance: p / 10000, perFail: corr / 10000, loses: pen < 0, tries, p90, certain,
        kinahPerTry: kinah, matsPerTry: Object.fromEntries(mats), kinah: stepKinah, mats: stepMats,
        kinahP90: p90 * kinah, matsP90: Object.fromEntries(mats.map(([m, n]) => [m, p90 * n])) };
      steps.push(step);
      sum.tries += tries;
      sum.kinah += stepKinah;
      sum.kinahP90 += step.kinahP90;
      for (const [m, v] of Object.entries(stepMats)) sum.mats[m] = (sum.mats[m] || 0) + v;
      for (const [m, v] of Object.entries(step.matsP90)) sum.matsP90[m] = (sum.matsP90[m] || 0) + v;
    }
    return { steps, sum, known: true };
  }

  /** The enhance table of an item (by id), or by grade and item level when
   *  the item isn't in the data (the game's tables go by both). */
  function enchantTable(item) {
    const row = itemRow(item?.id);
    if (row && D.enchant[row[5]]) return D.enchant[row[5]];
    if (item?.grade && item?.il) {
      const key = `Enchant_${item.grade}_${item.il}`;
      if (D.enchant[key]) return D.enchant[key];
    }
    return null;
  }
  function amplifyTable(item) {
    const row = itemRow(item?.id);
    return row && row[7] && D.amplify[row[7]] ? D.amplify[row[7]] : null;
  }
  /** The highest Amplify level an item's table reaches. */
  const amplifyTop = (item) => {
    const t = amplifyTable(item);
    return t ? t.filter((s) => s[0] > 0).length : 0;
  };

  /** Material key -> { name, id, bound }. */
  const material = (key) => D.mats[key] || { name: key, id: null, bound: false };

  /** Kinah a material costs on the market (prices: Map id -> price), or null. */
  function materialPrice(key, prices) {
    const m = material(key);
    if (m.bound || !m.id || !prices) return null;
    const v = prices.get ? prices.get(String(m.id)) : prices[String(m.id)];
    const price = typeof v === "number" ? v : v?.price;
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  /** Kinah plus what the materials would cost on the market (those with a
   *  price); `unpriced` lists the rest. */
  function kinahWorth(kinah, mats, prices) {
    let total = kinah;
    const unpriced = {};
    for (const [m, n] of Object.entries(mats || {})) {
      const price = materialPrice(m, prices);
      if (price != null) total += n * price;
      else unpriced[m] = n;
    }
    return { total, unpriced };
  }

  // ---- the way to a target gear score ------------------------------------
  /** The next steps every worn piece can take: its next enhance level (+1
   *  gear score) while below its top, then its next Amplify level (+5). */
  function nextSteps(item, state) {
    const out = [];
    const et = enchantTable(item);
    const top = Math.min(item.maxEnchant || (et ? et.filter((s) => s[0] > 0).length : 0), et ? et.length : 0);
    if (et && state.enchant < top) {
      const c = climb(et, state.enchant, state.enchant + 1);
      if (c.steps.length) out.push({ kind: "enchant", gain: 1, level: state.enchant + 1, step: c.steps[0] });
      return out;
    }
    const at = amplifyTable(item);
    const atop = Math.min(item.maxAmplify ?? 99, at ? at.filter((s) => s[0] > 0).length : 0);
    if (at && state.amplify < atop && state.enchant >= top) {
      const c = climb(at, state.amplify, state.amplify + 1);
      if (c.steps.length) out.push({ kind: "amplify", gain: AMPLIFY_POINTS, level: state.amplify + 1, step: c.steps[0] });
    }
    return out;
  }

  /** The cheapest enhance and Amplify steps on the worn gear to reach
   *  `target` gear score from `current`, cheapest per point first (Kinah
   *  plus the market price of tradable materials; bound ones and unpriced
   *  stones count by their Kinah only). Per piece: from → to, the points,
   *  the average and the 9-in-10 cost. `only` limits it to some slots. */
  function planGearScore(snap, current, target, prices, only = null) {
    const items = (snap?.items || []).filter((it) => !it.arcana && (!only || only.has(it.slot)));
    const state = new Map(items.map((it) => [it.slot, { enchant: it.enchant || 0, amplify: it.amplify || 0 }]));
    let gs = current;
    const chosen = [];
    for (let guard = 0; gs < target && guard < 2000; guard++) {
      let best = null;
      for (const it of items) {
        for (const s of nextSteps(it, state.get(it.slot))) {
          const worth = kinahWorth(s.step.kinah, s.step.mats, prices).total / s.gain;
          if (!best || worth < best.worth) best = { it, s, worth };
        }
      }
      if (!best) break;
      const st = state.get(best.it.slot);
      if (best.s.kind === "enchant") st.enchant = best.s.level;
      else st.amplify = best.s.level;
      gs += best.s.gain;
      chosen.push({ slot: best.it.slot, kind: best.s.kind, level: best.s.level, gain: best.s.gain, step: best.s.step });
    }
    // Per piece and kind, in the order first chosen.
    const groups = new Map();
    for (const c of chosen) {
      const key = `${c.slot}:${c.kind}`;
      if (!groups.has(key)) {
        const it = items.find((i) => i.slot === c.slot);
        groups.set(key, { slot: c.slot, item: it, kind: c.kind, from: c.level - 1, to: c.level, gain: 0,
          kinah: 0, kinahP90: 0, mats: {}, matsP90: {}, tries: 0 });
      }
      const g = groups.get(key);
      g.to = c.level;
      g.gain += c.gain;
      g.kinah += c.step.kinah;
      g.kinahP90 += c.step.kinahP90;
      g.tries += c.step.tries;
      for (const [m, v] of Object.entries(c.step.mats)) g.mats[m] = (g.mats[m] || 0) + v;
      for (const [m, v] of Object.entries(c.step.matsP90)) g.matsP90[m] = (g.matsP90[m] || 0) + v;
    }
    const pieces = [...groups.values()];
    const total = { gain: gs - current, kinah: 0, kinahP90: 0, mats: {}, matsP90: {} };
    for (const g of pieces) {
      total.kinah += g.kinah;
      total.kinahP90 += g.kinahP90;
      for (const [m, v] of Object.entries(g.mats)) total.mats[m] = (total.mats[m] || 0) + v;
      for (const [m, v] of Object.entries(g.matsP90)) total.matsP90[m] = (total.matsP90[m] || 0) + v;
    }
    total.worth = kinahWorth(total.kinah, total.mats, prices);
    return { reached: gs >= target, gs, pieces, total };
  }

  /** What the gear can still give at all: every piece at its enhance top
   *  and its Amplify top. */
  function gearRoom(snap) {
    let points = 0;
    for (const it of snap?.items || []) {
      if (it.arcana) continue;
      const et = enchantTable(it);
      const top = Math.min(it.maxEnchant || 0, et ? et.length : 0);
      points += Math.max(0, top - (it.enchant || 0));
      const atop = Math.min(it.maxAmplify ?? 99, amplifyTop(it));
      points += AMPLIFY_POINTS * Math.max(0, atop - (it.amplify || 0));
    }
    return points;
  }

  // ---- combat power (an estimate) ----------------------------------------
  /** Combat power gained per gear score point: from the character's own
   *  history once it has three rises of 5 points or more (the median of
   *  their combat power a point; combat power rises with skills, titles and
   *  stigmas too, so small steps say little), else from 24 EU characters of
   *  all strengths (2026-10-28: about 52 a point). Kept within 20 and 150. */
  const CP_PER_GS_SAMPLE = 52;
  const MIN_GS_STEP = 5;
  function cpPerGearScore(history) {
    const rates = [];
    const h = (history || []).filter((e) => e && Number.isFinite(e.cp) && Number.isFinite(e.gs));
    let from = h[0];
    for (let i = 1; i < h.length; i++) {
      const dgs = h[i].gs - from.gs;
      if (dgs < 0) { from = h[i]; continue; }
      if (dgs < MIN_GS_STEP) continue;
      const dcp = h[i].cp - from.cp;
      if (dcp > 0) rates.push(dcp / dgs);
      from = h[i];
    }
    if (rates.length < 3) return { rate: CP_PER_GS_SAMPLE, own: false, samples: rates.length };
    rates.sort((a, b) => a - b);
    const rate = Math.min(150, Math.max(20, rates[Math.floor(rates.length / 2)]));
    return { rate, own: true, samples: rates.length };
  }

  // ---- skills -----------------------------------------------------------
  /** Where each skill's level comes from: up to 10 from skill points, up to
   *  4 from the Daevanion boards (one node on each of the first four), and
   *  the rest from gear and Arcana (their extra skill levels). With what is
   *  missing to 16 and to 20, and the Daevanion nodes still closed for it. */
  function skillSources(snap) {
    const daev = new Map();
    const daevMax = new Map();
    const closed = new Map();
    for (const b of snap?.boards || []) {
      for (const n of b.nodes || []) {
        if (n.type !== "SkillLevel") continue;
        for (const e of n.effects || []) {
          const m = /^(.*)\s\+(\d+)$/.exec(e);
          if (!m) continue;
          const [, name, v] = m;
          daevMax.set(name, (daevMax.get(name) || 0) + Number(v));
          if (n.open) daev.set(name, (daev.get(name) || 0) + Number(v));
          else {
            if (!closed.has(name)) closed.set(name, []);
            closed.get(name).push({ board: b.name, grade: n.grade, points: nodePoints(n.grade), gives: Number(v) });
          }
        }
      }
    }
    const gear = new Map();
    for (const it of snap?.items || []) {
      for (const s of it.subSkills || []) {
        if (!gear.has(s.name)) gear.set(s.name, []);
        gear.get(s.name).push({ item: it.name, slot: it.slot, arcana: !!it.arcana, level: s.level || 0 });
      }
    }
    return (snap?.skills || []).map((s) => {
      const fromDaev = daev.get(s.name) || 0;
      const fromGear = (gear.get(s.name) || []).reduce((a, g) => a + g.level, 0);
      const base = Math.max(0, (s.level || 0) - fromDaev - fromGear);
      const level = s.level || 0;
      return {
        ...s, base, fromDaev, fromGear, gear: gear.get(s.name) || [],
        daevMax: daevMax.get(s.name) || 0, closedNodes: closed.get(s.name) || [],
        to16: Math.max(0, 16 - level), to20: Math.max(0, 20 - level),
        baseRoom: s.category === "Dp" ? 0 : Math.max(0, 10 - base),
        // After skill points to 10 and every Daevanion node: what gear and
        // Arcana must still give for 20.
        gearFor20: s.category === "Dp" ? null : Math.max(0, 20 - 10 - (daevMax.get(s.name) || 0) - fromGear),
      };
    });
  }

  // ---- the reference ----------------------------------------------------
  const SLOT_OF_CATEGORY = {
    Helm: ["Helmet"], Pauldrons: ["Shoulder"], Top: ["Torso"], Belt: ["Belt"], Legs: ["Pants"], Gloves: ["Gloves"],
    Cloak: ["Cape"], Shoes: ["Boots"], Guard: ["SubHand"], Earrings: ["Earring1", "Earring2"], Necklace: ["Necklace"],
    Ring: ["Ring1", "Ring2"], Bracelet: ["Bracelet1", "Bracelet2"], Amulet: ["Amulet"], Rune: ["Rune1", "Rune2"],
  };
  const WEAPONS = new Set(["Greatsword", "Longsword", "Dagger", "Bow", "Spellbook", "Orb", "Mace", "Staff"]);
  /** The slot names, in the order the pages show them. */
  const SLOT_ORDER = ["MainHand", "SubHand", "Helmet", "Shoulder", "Torso", "Pants", "Gloves", "Boots", "Cape", "Belt",
    "Necklace", "Earring1", "Earring2", "Ring1", "Ring2", "Bracelet1", "Bracelet2", "Amulet", "Rune1", "Rune2",
    "Arcana1", "Arcana2", "Arcana3", "Arcana4", "Arcana5"];
  const SLOT_LABEL = { MainHand: "Weapon", SubHand: "Off-hand", Helmet: "Helmet", Shoulder: "Shoulders", Torso: "Chest",
    Pants: "Legs", Gloves: "Gloves", Boots: "Boots", Cape: "Cloak", Belt: "Belt", Necklace: "Necklace",
    Earring1: "Earring", Earring2: "Earring", Ring1: "Ring", Ring2: "Ring", Bracelet1: "Bracelet", Bracelet2: "Bracelet",
    Amulet: "Amulet", Rune1: "Rune", Rune2: "Rune", Arcana1: "Arcana", Arcana2: "Arcana", Arcana3: "Arcana",
    Arcana4: "Arcana", Arcana5: "Arcana" };
  const slotsFor = (category) => (WEAPONS.has(category) ? ["MainHand"] : SLOT_OF_CATEGORY[category] || []);

  /** A shown level ("+20") as enhance and Amplify for an item: up to its
   *  enhance top, the rest Amplify. */
  function splitLevel(id, shown) {
    const row = itemRow(id);
    const et = row ? D.enchant[row[5]] : null;
    const top = et ? et.filter((s) => s[0] > 0).length : shown;
    const enchant = Math.min(shown, top);
    const at = row && row[7] ? D.amplify[row[7]] : null;
    const atop = at ? at.filter((s) => s[0] > 0).length : 0;
    return { enchant, amplify: Math.min(Math.max(0, shown - top), atop) };
  }

  /** The item an icon names in a build, among those with that icon: one
   *  sharing the most words with `hint` (the build's weapon), else the
   *  highest item level. */
  function pickByIcon(icon, hint, named = "") {
    const ids = itemsByIcon(icon);
    if (!ids.length) return null;
    // The page's own name for it (an image's alt text), where it gives one.
    const exact = ids.filter((id) => named && itemName(id) === named);
    if (exact.length) return Math.max(...exact);
    const words = new Set(String(hint || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const score = (id) => itemName(id).toLowerCase().split(/\s+/).filter((w) => words.has(w)).length;
    return [...ids].sort((a, b) => score(b) - score(a) || itemRow(b)[3] - itemRow(a)[3] || a - b)[0];
  }

  // ---- a saved questlog.gg build page ------------------------------------
  /** The page as a list of text pieces and images (no scripts or styles). */
  function tokens(html) {
    const out = [];
    const re = /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<svg\b[\s\S]*?<\/svg>|<img\b[^>]*>|<title>([\s\S]*?)<\/title>|<[^>]+>|[^<]+/gi;
    const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
    let m;
    while ((m = re.exec(html))) {
      const t = m[0];
      if (m[1] != null) { out.push({ title: decode(m[1]).trim() }); continue; }
      if (/^<img\b/i.test(t)) {
        const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(t)?.[1] || "";
        const alt = /\balt\s*=\s*"([^"]*)"/i.exec(t)?.[1] || "";
        out.push({ img: src.split(/[/\\]/).pop().replace(/\?.*$/, ""), alt: decode(alt) });
      } else if (t[0] !== "<") {
        const text = decode(t).trim();
        if (text) out.push({ text });
      }
    }
    return out;
  }

  /** "3107", "1.028" or "19,571" (thousands), "55,8" (a decimal): a number,
   *  or null for anything else. */
  const num = (s) => {
    const text = String(s ?? "").trim();
    if (!/^-?\d[\d.,]*$/.test(text)) return null;
    const v = Number(text.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(v) ? v : null;
  };

  /** A questlog.gg character build page saved from the browser (any of its
   *  tabs: Equipment, Skills, Daevanion), read into a reference:
   *  { name, gearScore, gear: [{ slot, id, name, shown, enchant, amplify,
   *  icon, guessed }], skills: [{ icon, level }], stigmas: [icon],
   *  boards: [{ name, points, total }], deity: { Justice: 51, ... } }.
   *  Several saved tabs of one build merge (mergeReference). */
  function readQuestlogPage(html) {
    const t = tokens(String(html || ""));
    const ref = { name: "", gearScore: null, gear: [], skills: [], stigmas: [], boards: [], deity: {}, source: "questlog.gg" };
    const title = t.find((x) => x.title)?.title || "";
    ref.name = title.split("|")[0].trim();
    const texts = (i) => (t[i] && t[i].text) || "";
    for (let i = 0; i < t.length; i++) {
      if (texts(i) === "Gear Score" && num(texts(i + 1)) != null) ref.gearScore = num(texts(i + 1));
    }
    // The gear grid: "+", level, the grade frame, the item's icon, 20 times,
    // after "Create New Build".
    const start = t.findIndex((x) => x.text === "Create New Build");
    if (start >= 0) {
      const found = [];
      for (let i = start + 1; i < t.length - 3; i++) {
        if (t[i].text === "Equipment") break;
        if (t[i].text === "+" && num(texts(i + 1)) != null) {
          let j = i + 2;
          let grade = null;
          if (t[j]?.img && /SlotGrade_/i.test(t[j].img)) { grade = /SlotGrade_([A-Za-z]+)/i.exec(t[j].img)[1]; j++; }
          if (t[j]?.img) { found.push({ shown: num(texts(i + 1)), grade, icon: t[j].img }); i = j; }
        }
      }
      // Names the page gives an icon (the build list's images have them).
      const named = new Map();
      for (const x of t) if (x.img && x.alt && !named.has(iconKey(x.img))) named.set(iconKey(x.img), x.alt);
      // The weapon's name names the set the others most likely come from.
      const weaponId = found.length ? pickByIcon(found[0].icon, "", named.get(iconKey(found[0].icon))) : null;
      const hint = weaponId ? itemName(weaponId) : "";
      const used = new Map();
      for (const g of found) {
        const candidates = itemsByIcon(g.icon);
        const name = named.get(iconKey(g.icon)) || "";
        const id = pickByIcon(g.icon, hint, name);
        const row = id ? itemRow(id) : null;
        const slots = row ? slotsFor(row[2]) : [];
        const n = row ? (used.get(row[2]) || 0) : 0;
        if (row) used.set(row[2], n + 1);
        const slot = slots[Math.min(n, slots.length - 1)] || null;
        const lv = id ? splitLevel(id, g.shown) : { enchant: g.shown, amplify: 0 };
        ref.gear.push({ slot, id, name: id ? itemName(id) : "", shown: g.shown, enchant: lv.enchant, amplify: lv.amplify,
          icon: g.icon, grade: row ? row[1] : g.grade, il: row ? row[3] : null,
          guessed: candidates.length > 1 && !(id && itemName(id) === name) && new Set(candidates.map(itemName)).size > 1 });
      }
    }
    // Skills: after "Skills" and "Active", each icon and its level (none at
    // the top level, 20); the chosen Stigmas after "Stigma".
    const sk = t.findIndex((x, i) => x.text === "Skills" && texts(i + 1) === "Active");
    if (sk >= 0) {
      let i = sk + 2;
      for (; i < t.length && t[i].text !== "Stigma"; i++) {
        if (t[i].img && /SKILL/i.test(t[i].img)) {
          const lv = num(texts(i + 1));
          ref.skills.push({ icon: t[i].img, level: lv != null && lv >= 1 && lv <= 20 ? lv : 20 });
        }
      }
      const active = new Set(ref.skills.map((s) => iconKey(s.icon)));
      for (i++; i < t.length && t[i].img && /SKILL/i.test(t[i].img); i++) {
        if (active.has(iconKey(t[i].img)) || num(texts(i + 1)) != null) break;
        ref.stigmas.push(t[i].img);
      }
    }
    // Daevanion: "Board Points", then each board's name and "spent / all".
    const bp = t.findIndex((x) => x.text === "Board Points");
    if (bp >= 0) {
      for (let i = bp + 1; i < t.length - 1; i++) {
        const m = /^(\d+)\s*\/\s*(\d+)$/.exec(texts(i + 1));
        if (!t[i].text || !m) break;
        ref.boards.push({ name: t[i].text, points: Number(m[1]), total: Number(m[2]) });
        i++;
      }
    }
    // Deity stats: "Justice [Nezekan]" and its value.
    for (let i = 0; i < t.length - 1; i++) {
      const m = /^([A-Za-z]+) \[([A-Za-z]+)\]$/.exec(texts(i));
      if (m && num(texts(i + 1)) != null && !(m[1] in ref.deity)) ref.deity[m[1]] = num(texts(i + 1));
    }
    return ref;
  }

  /** Two readings of one build (its Equipment and Skills tabs saved apart)
   *  as one: what one lacks the other gives. */
  function mergeReference(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      name: a.name || b.name, source: a.source || b.source,
      gearScore: a.gearScore ?? b.gearScore,
      gear: a.gear.length ? a.gear : b.gear,
      skills: a.skills.length ? a.skills : b.skills,
      stigmas: a.stigmas.length ? a.stigmas : b.stigmas,
      boards: a.boards.length ? a.boards : b.boards,
      deity: Object.keys(a.deity).length ? a.deity : b.deity,
    };
  }

  /** A reference's gear score from its parts, where they are known (the
   *  items and levels; Manastones, Theostones and Arcana it may not say). */
  function referenceGearScore(ref) {
    let points = 0;
    for (const g of ref?.gear || []) points += (g.il || 0) + (g.enchant || 0) + AMPLIFY_POINTS * (g.amplify || 0);
    for (const b of ref?.boards || []) points += b.points || 0;
    return points;
  }

  /** Slot by slot, you against the reference: the same item or another, and
   *  the levels to go. */
  function compareGear(snap, ref) {
    const mine = new Map((snap?.items || []).map((it) => [it.slot, it]));
    const theirs = new Map((ref?.gear || []).filter((g) => g.slot).map((g) => [g.slot, g]));
    const slots = SLOT_ORDER.filter((s) => mine.has(s) || theirs.has(s));
    return slots.map((slot) => {
      const a = mine.get(slot) || null;
      const b = theirs.get(slot) || null;
      const same = !!(a && b && (a.id === b.id || (a.name && a.name === b.name)));
      const level = (x) => (x ? (x.enchant || 0) + (x.amplify || 0) : 0);
      return { slot, mine: a, ref: b, same, levelsToGo: b ? Math.max(0, level(b) - level(a)) : 0,
        status: !b ? "none" : !a ? "missing" : !same ? "other" : level(a) >= level(b) ? "done" : "levels" };
    });
  }

  /** Skills against the reference's levels, matched by icon. */
  function compareSkills(skills, ref) {
    const want = new Map((ref?.skills || []).map((s) => [iconKey(s.icon), s.level]));
    return skills.map((s) => ({ ...s, refLevel: want.get(iconKey(s.icon)) ?? null }));
  }

  // ---- history ----------------------------------------------------------
  /** One history entry from a snapshot: what is tracked. */
  function historyEntry(snap, gs) {
    const enchant = {};
    for (const it of snap.items || []) enchant[it.slot] = [it.id, it.enchant || 0, it.amplify || 0];
    const skills = {};
    for (const s of snap.skills || []) skills[s.name] = s.level || 0;
    return { at: snap.at, cp: snap.profile?.cp ?? null, gs: snap.profile?.gs ?? gs, level: snap.profile?.level ?? null,
      daev: (snap.boards || []).reduce((a, b) => a + (b.points || 0), 0), titles: snap.titles?.owned ?? null, enchant, skills };
  }

  /** Adds an entry unless nothing tracked changed since the last one (then
   *  the last one's time moves on). At most `max` entries. */
  function addHistory(history, entry, max = 400) {
    const h = Array.isArray(history) ? history.slice() : [];
    const last = h[h.length - 1];
    const same = last && JSON.stringify({ ...last, at: 0, seen: 0 }) === JSON.stringify({ ...entry, at: 0, seen: 0 });
    if (same) h[h.length - 1] = { ...last, seen: entry.at };
    else h.push(entry);
    return h.slice(-max);
  }

  /** What changed between two entries, in words. */
  function historyChanges(a, b) {
    const out = [];
    if (!a || !b) return out;
    for (const [slot, [id, e, x]] of Object.entries(b.enchant || {})) {
      const old = a.enchant?.[slot];
      if (!old) out.push(`${SLOT_LABEL[slot] || slot}: ${itemName(id)} +${e}${x ? ` (+${x} Amplify)` : ""}`);
      else if (old[0] !== id) out.push(`${SLOT_LABEL[slot] || slot}: ${itemName(old[0])} → ${itemName(id)} +${e}`);
      else if (old[1] !== e || old[2] !== x) {
        out.push(`${itemName(id)} +${old[1]}${old[2] ? `/A${old[2]}` : ""} → +${e}${x ? `/A${x}` : ""}`);
      }
    }
    for (const [name, lv] of Object.entries(b.skills || {})) {
      const old = a.skills?.[name];
      if (old != null && old !== lv) out.push(`${name} ${old} → ${lv}`);
    }
    if (a.daev !== b.daev) out.push(`Daevanion ${a.daev} → ${b.daev} points`);
    if (a.titles != null && b.titles != null && a.titles !== b.titles) out.push(`Titles ${a.titles} → ${b.titles}`);
    return out;
  }

  // ---- what the stats do ----------------------------------------------------
  // The game's own descriptions of its stats (data.js: [name, key, group,
  // description]); the key is the one NC's pages give an item's stats.
  let GLOSS = null;
  function glossIndex() {
    if (!GLOSS) {
      GLOSS = { byName: new Map(), byKey: new Map() };
      for (const [name, key, group, text] of D.glossary || []) {
        // Some descriptions begin with the stat's own name: once is enough.
        const lines = String(text || "").split("\n");
        const desc = (lines[0].trim() === name ? lines.slice(1) : lines).join("\n");
        const e = { name, key, group, desc };
        if (!GLOSS.byName.has(name.toLowerCase())) GLOSS.byName.set(name.toLowerCase(), e);
        if (key && !GLOSS.byKey.has(key)) GLOSS.byKey.set(key, e);
      }
    }
    return GLOSS;
  }
  /** "Combat Speed +7.4%", "MP +30", "Cooldown -4.8%" → the stat's name. */
  const statName = (text) => String(text || "").replace(/\s*[+\-−]\s*[\d.,]+%?\s*$/, "").replace(/:\s*$/, "").trim();
  /** What a stat does, in the game's words: by its key, else its name. */
  function explainStat(name, key) {
    const g = glossIndex();
    return (key && g.byKey.get(key)) || g.byName.get(statName(name).toLowerCase()) || null;
  }
  /** The groups of the character window, in its order. */
  const STAT_GROUPS = ["Main Ability", "Other stats", "Combat", "Hit Detection", "PvE", "PvP", "Status Effects", "Genus", "Elements", "Resources", "Special"];
  /** Every stat the character has, explained, with where it comes from:
   *  [{ name, entry, from: ["Time [Siel]", "Gear", ...] }], by group. */
  function characterStats(snap) {
    const found = new Map();
    const add = (name, key, from) => {
      const e = explainStat(name, key);
      const n = e ? e.name : statName(name);
      if (!n) return;
      if (!found.has(n)) found.set(n, { name: n, entry: e, from: new Set() });
      found.get(n).from.add(from);
    };
    for (const s of Object.values(snap?.stats || {})) {
      add(s.name, null, "Your stats");
      for (const e of s.effects || []) add(e, null, s.name);
    }
    for (const it of snap?.items || []) {
      for (const m of it.main || []) add(m.name, m.id, it.arcana ? "Arcana" : "Gear");
      for (const m of it.sub || []) add(m.name, m.id, it.arcana ? "Arcana" : "Gear");
      for (const m of it.stones || []) add(m.name, null, "Manastones");
    }
    for (const t of snap?.titles?.list || []) for (const d of [...(t.stats || []), ...(t.equipStats || [])]) add(d, null, "Titles");
    for (const b of snap?.boards || []) for (const n of b.nodes || []) if (n.type === "Stat" && n.open) for (const e of n.effects || []) add(e, null, "Daevanion");
    const order = (g) => { const i = STAT_GROUPS.indexOf(g); return i < 0 ? 99 : i; };
    return [...found.values()].map((x) => ({ ...x, from: [...x.from] }))
      .sort((a, b) => order(a.entry?.group) - order(b.entry?.group) || a.name.localeCompare(b.name));
  }

  // ---- soul binding -------------------------------------------------------
  // What a piece's soul binding can give (data.js "soul": the game's item data
  // as questlog.gg's item database holds it): how many properties, which
  // stats in which range and by which weight, which skill effects of each
  // class. NC's pages show what a worn piece has (its sub stats and extra
  // skill levels).
  const SOUL = D.soul || null;
  const classKey = (className) => String(className || "").toLowerCase();

  /** { count, stats: [{ kind, name, min, max, pct, weight, first }], skills:
   *  [{ kind, name, weight, top, first }] } of an item for a class, or null.
   *  first: the chance to be a binding's first pick. A binding picks its
   *  properties one after another, never one twice: the stats share 80 % of
   *  a pick by their weights and the class's skill effects 20 % (when the
   *  piece can have both), as Aion2Data reads NCSOFT's probability notice. */
  function soulPool(itemId, className) {
    const it = SOUL?.items?.[String(itemId)];
    if (!it) return null;
    const [poolIndex, count, group] = it;
    const stats = poolIndex >= 0 ? SOUL.pools[poolIndex].map(([i, min, max, weight]) => {
      const pct = SOUL.pct.includes(i);
      return { kind: "stat", name: SOUL.stats[i], min: pct ? min / 100 : min, max: pct ? max / 100 : max, pct, weight };
    }) : [];
    const skills = ((SOUL.skills[group] || {})[classKey(className)] || []).map(([name, weight, top]) => ({ kind: "skill", name, weight, top }));
    if (!stats.length && !skills.length) return null;
    const statSum = stats.reduce((a, p) => a + p.weight, 0);
    const skillSum = skills.reduce((a, p) => a + p.weight, 0);
    const statShare = statSum && skillSum ? 0.8 : statSum ? 1 : 0;
    for (const p of stats) p.first = statSum ? (statShare * p.weight) / statSum : 0;
    for (const p of skills) p.first = skillSum ? ((1 - statShare) * p.weight) / skillSum : 0;
    return { count, group, stats, skills };
  }

  /** "12.3%" → 12.3, "+75" → 75. */
  const valueOf = (v) => {
    const n = Number(String(v ?? "").replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  /** A worn piece's soul binding as NC's page shows it. */
  function soulOf(item) {
    return [
      ...(item?.sub || []).map((m) => ({ kind: "stat", name: m.name, value: m.value })),
      ...(item?.subSkills || []).map((k) => ({ kind: "skill", name: k.name, value: `+${k.level}`, level: k.level })),
    ];
  }

  /** How good a rolled value is within its range: 0 the lowest, 1 the top. */
  function rollQuality(value, prop) {
    const v = valueOf(value);
    if (v == null || !prop) return null;
    if (prop.kind === "skill") return prop.top > 1 ? Math.max(0, Math.min(1, (v - 1) / (prop.top - 1))) : null;
    if (!(prop.max > prop.min)) return null;
    return Math.max(0, Math.min(1, (v - prop.min) / (prop.max - prop.min)));
  }

  /** The wanted properties against what the piece has: { wanted: [{ name,
   *  kind, have, value, quality, prop }], extra: [what it has, not wanted] }. */
  function soulCompare(item, wanted, pool) {
    const has = soulOf(item);
    const byName = new Map(has.map((h) => [h.name.toLowerCase(), h]));
    const props = new Map([...(pool?.stats || []), ...(pool?.skills || [])].map((p) => [p.name.toLowerCase(), p]));
    const want = (wanted || []).map((name) => {
      const h = byName.get(name.toLowerCase());
      const prop = props.get(name.toLowerCase()) || null;
      return { name, kind: prop?.kind || h?.kind || "stat", have: !!h, value: h?.value ?? null, quality: h ? rollQuality(h.value, prop) : null, prop };
    });
    const wantSet = new Set((wanted || []).map((n) => n.toLowerCase()));
    const extra = has.filter((h) => !wantSet.has(h.name.toLowerCase()))
      .map((h) => ({ ...h, quality: rollQuality(h.value, props.get(h.name.toLowerCase())), prop: props.get(h.name.toLowerCase()) || null }));
    return { wanted: want, extra };
  }

  /** The chance a new soul binding gives every wanted property (whatever
   *  else it gives besides), counted exactly over the order of the picks.
   *  The properties not wanted count by their weight only: those of one
   *  weight are alike. */
  function soulChance(pool, wanted) {
    if (!pool || !wanted?.length) return null;
    const props = [...pool.stats, ...pool.skills];
    const want = [...new Set(wanted.map((n) => props.findIndex((p) => p.name.toLowerCase() === String(n).toLowerCase())))];
    if (want.some((i) => i < 0) || want.length > pool.count) return 0;
    const ww = want.map((i) => props[i].first);
    const classes = new Map();
    props.forEach((p, i) => {
      if (want.includes(i) || !p.first) return;
      const k = p.first.toPrecision(12);
      classes.set(k, { w: p.first, n: (classes.get(k)?.n || 0) + 1 });
    });
    const cw = [...classes.values()].map((c) => c.w);
    const memo = new Map();
    const go = (pick, mask, counts, total) => {
      if (!mask) return 1;
      let left = 0;
      for (let m = mask; m; m &= m - 1) left++;
      if (pool.count - pick < left || total <= 1e-15) return 0;
      const key = `${pick}|${mask}|${counts.join(",")}`;
      if (memo.has(key)) return memo.get(key);
      let sum = 0;
      for (let i = 0; i < ww.length; i++) {
        if (mask & (1 << i)) sum += (ww[i] / total) * go(pick + 1, mask & ~(1 << i), counts, total - ww[i]);
      }
      // With as many picks left as wanted ones, only a wanted one helps.
      if (pool.count - pick > left) {
        for (let c = 0; c < counts.length; c++) {
          if (!counts[c]) continue;
          const next = counts.slice();
          next[c]--;
          sum += ((counts[c] * cw[c]) / total) * go(pick + 1, mask, next, total - cw[c]);
        }
      }
      memo.set(key, sum);
      return sum;
    };
    const total = props.reduce((a, p) => a + (p.first || 0), 0);
    return go(0, (1 << want.length) - 1, [...classes.values()].map((c) => c.n), total);
  }

  // ---- what the strongest players keep -----------------------------------
  // data.js "top": counted from the strongest players of a class (Shugo.GG's
  // combat power leaderboard, their pages on NC's site), no names.
  const TOP = D.top || null;
  const SLOT_GROUP = { Earring1: "Earrings", Earring2: "Earrings", Ring1: "Rings", Ring2: "Rings",
    Bracelet1: "Bracelets", Bracelet2: "Bracelets", Rune1: "Runes", Rune2: "Runes" };
  const topOf = (className) => TOP?.classes?.[classKey(className)] || null;

  /** What the top players keep on a slot (or an Arcana card): { items, stats,
   *  skills } with each one's share, or null. */
  function topSlot(className, slot, card) {
    const t = topOf(className);
    if (!t) return null;
    if (card) return t.arcana?.[card] || null;
    return t.slots?.[SLOT_GROUP[slot] || slot] || null;
  }

  /** The properties the top players keep most on a slot, as many as the
   *  piece takes and only ones its soul binding can give. */
  function topPicks(className, slot, pool, card) {
    const t = topSlot(className, slot, card);
    if (!t || !pool) return [];
    const can = new Set([...pool.stats, ...pool.skills].map((p) => p.name.toLowerCase()));
    return [...(t.stats || []).map(([name, share]) => ({ name, share })), ...(t.skills || []).map(([name, share]) => ({ name, share }))]
      .filter((x) => can.has(x.name.toLowerCase()) && x.share >= 0.2)
      .sort((a, b) => b.share - a.share)
      .slice(0, pool.count)
      .map((x) => x.name);
  }

  // ---- skill targets -------------------------------------------------------
  const TARGET_LEVELS = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
  /** A level as a target: the even level at or below it, from 10 on. */
  const asTarget = (v) => (v >= 10 ? Math.min(30, Math.floor(v / 2) * 2) : null);

  /** What the top players reach: { name: { median, at20, at16, sources } }. */
  function topSkillLevels(className) {
    const t = topOf(className);
    const out = {};
    for (const [name, [category, median, at20, at16, sources]] of Object.entries(t?.skills || {})) {
      out[name] = { category, median, at20, at16, sources };
    }
    return out;
  }

  /** The way from a skill's level to a target: { left, points, daevanion:
   *  [closed nodes], gear } (gear: levels gear and Arcana must still give). */
  function skillWay(s, target) {
    const left = Math.max(0, (target || 0) - (s.level || 0));
    if (!left) return { left: 0, points: 0, daevanion: [], gear: 0 };
    const points = Math.min(left, s.baseRoom || 0);
    let rest = left - points;
    const nodes = [];
    for (const n of [...(s.closedNodes || [])].sort((a, b) => a.points - b.points)) {
      if (rest <= 0) break;
      nodes.push(n);
      rest -= n.gives;
    }
    return { left, points, daevanion: nodes, gear: Math.max(0, rest) };
  }

  // ---- the Daevanion boards ----------------------------------------------
  /** "Critical Hit +5" → { name, value, pct }. */
  function effectParts(text) {
    const m = /^(.*?)\s*([+\-−])\s*([\d.,]+)\s*(%?)\s*$/.exec(String(text || ""));
    if (!m) return { name: String(text || ""), value: null, pct: false };
    return { name: m[1].trim(), value: (m[2] === "+" ? 1 : -1) * Number(m[3].replace(",", ".")), pct: m[4] === "%" };
  }
  /** Whether a stat makes your hits land, hit harder or come faster. */
  function isOffensive(name) {
    const n = String(name || "").toLowerCase();
    if (/resist|tolerance|defen[cs]e|evasion|block|endurance|regen|incoming|\bhp\b|\bmp\b|stamina|flight|move speed|status effect/.test(n)) return false;
    return /attack|accuracy|critical|combat speed|cooldown|penetration|boost|multi-hit|perfect|double|might|precision/.test(n);
  }
  /** "pvp" for a stat that counts against characters only, "pve" against
   *  monsters or bosses only, "all" for both. */
  const statSide = (name) => (/^pvp\b/i.test(name) ? "pvp" : /^(pve|boss)\b/i.test(name) ? "pve" : "all");

  /** One board's nodes with what it takes to open each: the points of every
   *  closed node on the cheapest way there from the open ones (a node opens
   *  next to an open one, side by side, not corner to corner). */
  function boardWays(board) {
    const nodes = (board?.nodes || []).filter((n) => n.type && n.type !== "None");
    const at = new Map(nodes.map((n) => [`${n.row},${n.col}`, n]));
    const isOpen = (n) => n.open || n.type === "Start";
    const cost = new Map(), prev = new Map();
    const queue = [];
    for (const n of nodes) if (isOpen(n)) { cost.set(n, 0); queue.push(n); }
    while (queue.length) {
      queue.sort((a, b) => cost.get(a) - cost.get(b));
      const n = queue.shift();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const m = at.get(`${n.row + dr},${n.col + dc}`);
        if (!m) continue;
        const c = cost.get(n) + (isOpen(m) ? 0 : nodePoints(m.grade));
        if (!cost.has(m) || c < cost.get(m)) { cost.set(m, c); prev.set(m, n); queue.push(m); }
      }
    }
    return nodes.map((n) => {
      // A node gives one stat or two (a Rare one on the later boards).
      const stats = n.type === "Stat" ? (n.effects || []).map(effectParts).filter((e) => e.name) : [];
      const path = [];
      for (let p = n; p && !isOpen(p); p = prev.get(p)) path.push(p.id);
      const skill = n.type === "SkillLevel" ? /^(.*)\s\+(\d+)$/.exec(n.effects?.[0] || "") : null;
      return { ...n, open: isOpen(n), points: nodePoints(n.grade), cost: cost.get(n) ?? null, path, stats,
        skill: skill ? { name: skill[1], gives: Number(skill[2]) } : null,
        offensive: stats.some((e) => isOffensive(e.name)) };
    });
  }

  /** A node's offensive stats; side "pve" leaves out what counts against
   *  characters only, "pvp" what counts against monsters or bosses only. */
  const nodeOffense = (n, side) => (n.stats || []).filter((e) => isOffensive(e.name)
    && !(side === "pve" && statSide(e.name) === "pvp") && !(side === "pvp" && statSide(e.name) === "pve"));

  /** Every offensive stat of the boards, summed: what is open and what is
   *  still closed, by board. side: "pve" leaves PvP-only stats out, "pvp"
   *  PvE- and boss-only ones, anything else keeps all.
   *  [{ name, pct, have, closed, nodes, points, cheapest, boards: { name:
   *  closed value } }], the most still closed first. */
  function boardOffense(boards, side) {
    const by = new Map();
    for (const b of boards || []) {
      for (const n of boardWays(b)) {
        for (const e of nodeOffense(n, side)) {
          const k = e.name;
          if (!by.has(k)) by.set(k, { name: k, pct: e.pct, side: statSide(k), have: 0, closed: 0, nodes: 0, points: 0, cheapest: null, boards: {} });
          const x = by.get(k);
          if (n.open) { x.have += e.value || 0; continue; }
          x.closed += e.value || 0;
          x.nodes++;
          x.points += n.points;
          x.boards[b.name] = (x.boards[b.name] || 0) + (e.value || 0);
          if (n.cost != null && (x.cheapest == null || n.cost < x.cheapest)) x.cheapest = n.cost;
        }
      }
    }
    const round = (v) => Math.round(v * 100) / 100;
    return [...by.values()].map((x) => ({ ...x, have: round(x.have), closed: round(x.closed) }))
      .sort((a, b) => (b.nodes > 0) - (a.nodes > 0) || b.points - a.points || a.name.localeCompare(b.name));
  }

  // ---- numbers ------------------------------------------------------------
  const fmt = (v, digits = 0) => (v == null || !Number.isFinite(v) ? "—"
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
  /** 12,600,000 as "12.6M", 160,752 as "161k". */
  function short(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e4) return `${Math.round(v / 1e3)}k`;
    return fmt(v);
  }

  globalThis.ArmoryCalc = Object.freeze({
    GRADE_POINTS, THEOSTONE_POINTS, AMPLIFY_POINTS, SLOT_ORDER, SLOT_LABEL, CP_PER_GS_SAMPLE,
    gearScore, nodePoints, itemRow, itemName, iconKey, itemsByIcon, searchItems, stepTries, climb, enchantTable,
    amplifyTable, amplifyTop, material, materialPrice, kinahWorth, planGearScore, gearRoom, cpPerGearScore,
    skillSources, slotsFor, splitLevel, pickByIcon, tokens, readQuestlogPage, mergeReference, referenceGearScore,
    compareGear, compareSkills, historyEntry, addHistory, historyChanges, fmt, short,
    STAT_GROUPS, statName, explainStat, characterStats,
    soulPool, soulOf, rollQuality, soulCompare, soulChance, topOf, topSlot, topPicks, SLOT_GROUP,
    TARGET_LEVELS, asTarget, topSkillLevels, skillWay, effectParts, isOffensive, statSide, boardWays, nodeOffense, boardOffense,
  });
})();
