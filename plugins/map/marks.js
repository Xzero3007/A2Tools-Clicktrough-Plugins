// What the map shows, from the world around the player (a2.on("world")), the
// pets other plugins track (a2.on("shared")) and the layers picked: the marks,
// the next pet to go for and the counts. The map window and its overlay both
// build their marks here.
(() => {
  const D = globalThis.MAP_DATA;
  const K = globalThis.MapKit;
  const RANK = { pinned: 3, farming: 2, needed: 1 };
  // A pet's genus colour (the game's categories), as Pet Finder's list shows
  // it: Cogni, Fera, Natura, Varian.
  const GENUS = {
    Intellect: { name: "Cogni", color: "#b99bff" },
    Feral: { name: "Fera", color: "#ff9f66" },
    Nature: { name: "Natura", color: "#74d99a" },
    Trans: { name: "Varian", color: "#5cc9e6" },
  };
  const genusOf = (pet) => GENUS[D.pets[pet]?.category] || null;
  const cubes = new Set(D.cubes.map(String));

  // ---------- spots the meter has seen (learnt) ----------
  // The data knows only the gathering spots and pet monster spawns players'
  // meters happened to report to SkeeveAN (Asvata: 3 in Altgard). What this
  // player's meter sees is added: { key: { g: { env: [x, y, ...] }, s: { npc:
  // [x, y, ...] }, c: [x, y, ...] } } (gathering spots, pet monsters' spawn
  // points, Hidden Cubes), kept by the plugin.
  let learned = {};
  const LEARN_CAP = 25000; // points per map (a stored value may be 1 MB)
  const setLearned = (value) => { learned = value && typeof value === "object" ? value : {}; };
  const count = (lk) => (lk ? Object.values(lk.g || {}).reduce((n, a) => n + a.length / 2, 0)
    + Object.values(lk.s || {}).reduce((n, a) => n + a.length / 2, 0) + (lk.c || []).length / 2 : 0);
  const both = (a, b) => (b && b.length ? (a && a.length ? a.concat(b) : b) : a || []);
  /** A map's gathering spots, the data's and the learnt: { env: [x, y, ...] }. */
  function gatherPoints(key) {
    const data = D.gather.points[key] || {};
    const mine = learned[key]?.g;
    if (!mine) return data;
    const out = { ...data };
    for (const [env, pts] of Object.entries(mine)) out[env] = both(out[env], pts);
    return out;
  }
  /** A map's pet monster spawn points, the data's and the learnt. */
  function spawnPoints(key) {
    const data = D.spawns[key] || {};
    const mine = learned[key]?.s;
    if (!mine) return data;
    const out = { ...data };
    for (const [npc, pts] of Object.entries(mine)) out[npc] = both(out[npc], pts);
    return out;
  }
  const cubeSpotPoints = (key) => both(D.cubeSpots?.[key], learned[key]?.c);
  const near = (pts, x, y, cm) => {
    for (let i = 0; i < (pts || []).length; i += 2) if ((pts[i] - x) ** 2 + (pts[i + 1] - y) ** 2 <= cm * cm) return true;
    return false;
  };
  const sameName = new Map(); // env -> every env of that object's name
  for (const [env, o] of Object.entries(D.gather.objects)) {
    const all = Object.entries(D.gather.objects).filter(([, x]) => x.name === o.name && x.kind === o.kind).map(([e]) => e);
    sameName.set(env, all);
  }

  /**
   * What the world shows that the map doesn't know yet, added to `store`
   * (the learnt spots, as setLearned takes them) for map `key`: gathering
   * spots (8 m from any known one of its name), pet monsters (20 m from any
   * known spawn point of theirs; they walk about) and Hidden Cubes. Returns
   * how many it added.
   */
  function learnFrom(store, key, world) {
    if (!key || !D.maps[key] || !world) return 0;
    const lk = (store[key] ||= { g: {}, s: {}, c: [] });
    lk.g ||= {};
    lk.s ||= {};
    lk.c ||= [];
    let added = 0;
    let room = LEARN_CAP - count(lk);
    for (const [, env, x, y] of world.objects || []) {
      if (room <= 0) break;
      const id = String(env);
      if (cubes.has(id)) {
        if (near(D.cubeSpots?.[key], x, y, 800) || near(lk.c, x, y, 800)) continue;
        lk.c.push(Math.round(x), Math.round(y));
      } else if (D.gather.objects[id]) {
        const kin = sameName.get(id) || [id];
        if (kin.some((e) => near(D.gather.points[key]?.[e], x, y, 800) || near(lk.g[e], x, y, 800))) continue;
        (lk.g[id] ||= []).push(Math.round(x), Math.round(y));
      } else continue;
      added++;
      room--;
    }
    for (const [, npc, x, y] of world.npcs || []) {
      if (room <= 0) break;
      const id = String(npc);
      if (D.npcPets[id] == null) continue;
      if (near(D.spawns[key]?.[id], x, y, 2000) || near(lk.s[id], x, y, 2000)) continue;
      (lk.s[id] ||= []).push(Math.round(x), Math.round(y));
      added++;
      room--;
    }
    return added;
  }

  // ---------- where the player is, steadier ----------
  // The game reports the player's own place only now and then (an action, an
  // effect, a teleport); in between the meter takes the middle of what moves
  // around him, which jumps about by 10 to 15 m (SkeeveAN's measurements: the
  // last exact report is off by 0.5 m at once, 5 m after 1 to 2.5 s, 14 m
  // after 2.5 to 5 s; the middle by 11 to 15 m). The client's own movement
  // to the server is encrypted, so there is nothing better to read. So: the
  // last exact report and the middle weighed by how far each is likely off,
  // and the shown place moving toward that smoothly, at most as fast as one
  // runs, instead of jumping.
  const AROUND_OFF_M = 13;
  const fixOff = (ageS) => 0.5 + 5 * ageS;
  /**
   * The place to show: { x, y, exact, acc (metres it may be off), at } from
   * the world's me and fix, moving on from `prev` (the last shown).
   */
  function steady(prev, w, now = Date.now()) {
    const me = w?.me;
    if (!me) return null;
    const fix = w.fix;
    const age = fix && Number.isFinite(fix.at) ? Math.max(0, (now - fix.at) / 1000) : Infinity;
    let tx = me.x;
    let ty = me.y;
    let acc;
    if (me.exact && age < 1.5) {
      return { x: me.x, y: me.y, exact: true, acc: 1, at: now };
    }
    if (!me.exact && me.from === "around" && fix && age < 30) {
      const wf = 1 / fixOff(age) ** 2;
      const wa = 1 / AROUND_OFF_M ** 2;
      tx = (fix.x * wf + me.x * wa) / (wf + wa);
      ty = (fix.y * wf + me.y * wa) / (wf + wa);
      acc = 1 / Math.sqrt(wf + wa);
    } else {
      acc = me.from === "around" ? AROUND_OFF_M : Math.min(40, fixOff(age));
    }
    const target = { x: tx, y: ty, exact: false, acc, at: now };
    // Nothing shown yet, or a jump no one runs (a teleport): there at once.
    if (!prev || Math.hypot(tx - prev.x, ty - prev.y) > 15000) return target;
    const dt = Math.min(2, Math.max(0, (now - prev.at) / 1000));
    const k = 1 - Math.exp(-dt / 0.8);
    let dx = (tx - prev.x) * k;
    let dy = (ty - prev.y) * k;
    const most = 1200 * dt + 150; // 12 m/s, and a little
    const step = Math.hypot(dx, dy);
    if (step > most) {
      dx *= most / step;
      dy *= most / step;
    }
    return { x: prev.x + dx, y: prev.y + dy, exact: false, acc, at: now };
  }

  // ---------- the way to a place ----------
  // A teleport (to a Kibelisk) is worth about this much walking: its loading
  // and its Kina.
  const TELEPORT_M = 250;
  /**
   * The best way from `me` to the cheapest of `targets` ([[x, y], ...]) on
   * map `key`: walk, or teleport to the Kibelisk nearest the target and walk
   * from there, whichever is shorter. { to, from, walk, kib: [name, x, y] |
   * null, metres (walking after the teleport, or all of it) }. Without `me`,
   * the Kibelisk nearest the only target.
   */
  function routeTo(key, me, targets) {
    const kibs = D.kibelisks[key] || [];
    if (!targets.length) return null;
    const nearestKib = (x, y) => {
      let best = null;
      for (const k of kibs) {
        const d = K.metres(k[1], k[2], x, y);
        if (!best || d < best[0]) best = [d, k];
      }
      return best;
    };
    if (!me) {
      if (targets.length !== 1) return null;
      const [x, y] = targets[0];
      const nk = nearestKib(x, y);
      return nk ? { to: [x, y], from: [nk[1][1], nk[1][2]], walk: null, kib: nk[1], metres: nk[0] } : null;
    }
    let best = null;
    for (const [x, y] of targets) {
      const walk = K.metres(me.x, me.y, x, y);
      const nk = nearestKib(x, y);
      const tele = nk ? nk[0] + TELEPORT_M : Infinity;
      const cost = Math.min(walk, tele);
      if (!best || cost < best.cost) {
        const viaKib = tele < walk && nk;
        best = { cost, to: [x, y], walk, kib: viaKib ? nk[1] : null, metres: viaKib ? nk[0] : walk,
          from: viaKib ? [nk[1][1], nk[1][2]] : [me.x, me.y] };
      }
    }
    delete best.cost;
    return best;
  }

  /** The pets not at level 3 yet, as Pet Finder shares them once it has read
   *  the pet list (ids as strings); null when not known. */
  function neededOf(shared) {
    const list = shared?.["pet-finder"]?.needed;
    return Array.isArray(list) ? new Set(list.map(String)) : null;
  }

  /** The souls each pet still needs to level 3, as Pet Finder shares them
   *  (id -> count); null when not known. */
  function soulsOf(shared) {
    const souls = shared?.["pet-finder"]?.souls;
    return souls && typeof souls === "object" ? souls : null;
  }

  /** The pets the other plugins track, merged: id -> { mark, name }. Pet
   *  Finder's alone once it shares (it holds the Pet Soul Tracker's list
   *  now: one list of favourites, not two). */
  function mergeTracked(shared) {
    const out = new Map();
    const from = shared?.["pet-finder"] ? { "pet-finder": shared["pet-finder"] } : shared || {};
    for (const value of Object.values(from)) {
      for (const p of Array.isArray(value?.pets) ? value.pets : []) {
        const id = String(p?.id ?? "");
        if (!id) continue;
        const mark = RANK[p.mark] ? p.mark : "needed";
        const prev = out.get(id);
        if (!prev || RANK[mark] > RANK[prev.mark]) out.set(id, { mark, name: p.name || prev?.name || null });
        else if (!prev.name && p.name) prev.name = p.name;
      }
    }
    return out;
  }

  /**
   * The nearest kinds of monster that drop souls for a pet not at level 3
   * (with `needed` unknown: the pets followed): up to `max` of them, the
   * nearest first: { npc, name, level, count, metres, bearing, pet, petName,
   * souls, live }. The ones in range; with none, the nearest spawn points of
   * the map.
   */
  function nearestKinds({ key, world, tracked, needed, souls, max = 4 }) {
    const me = world?.me;
    if (!me || !D.maps[key]) return [];
    const wantedPet = (pet) => (needed ? needed.has(String(pet)) : tracked.has(String(pet)));
    const kinds = new Map();
    const add = (npc, x, y, live) => {
      const pet = D.npcPets[npc];
      if (pet == null || !wantedPet(pet)) return;
      const metres = K.metres(me.x, me.y, x, y);
      const k = kinds.get(String(npc));
      if (!k) {
        kinds.set(String(npc), {
          npc: String(npc), name: npcName(npc), level: D.npcLevels?.[npc] ?? null, count: 1, metres,
          bearing: K.bearing(me.x, me.y, x, y), pet: String(pet), petName: petName(pet, tracked),
          souls: souls?.[pet] ?? null, genus: genusOf(pet), live,
        });
      } else {
        k.count++;
        if (metres < k.metres) Object.assign(k, { metres, bearing: K.bearing(me.x, me.y, x, y) });
      }
    };
    for (const [, npc, x, y] of world?.npcs || []) add(npc, x, y, true);
    if (!kinds.size) {
      for (const [npc, pts] of Object.entries(spawnPoints(key))) {
        for (let i = 0; i < pts.length; i += 2) add(npc, pts[i], pts[i + 1], false);
      }
    }
    return [...kinds.values()].sort((a, b) => a.metres - b.metres).slice(0, max);
  }

  /** Metres from `me` to each pet's nearest spawn point on the map (id ->
   *  metres), for the pets given (all with none). */
  function nearestByPet(key, me, pets = null) {
    const out = {};
    if (!me || !D.maps[key]) return out;
    for (const [npc, pts] of Object.entries(spawnPoints(key))) {
      const pet = D.npcPets[npc];
      if (pet == null || (pets && !pets.has(String(pet)))) continue;
      let best = Infinity;
      for (let i = 0; i < pts.length; i += 2) best = Math.min(best, K.metres(me.x, me.y, pts[i], pts[i + 1]));
      if (best < (out[pet] ?? Infinity)) out[pet] = Math.round(best);
    }
    return out;
  }

  const petName = (id, tracked) => tracked.get(String(id))?.name || D.pets[id]?.name || `Pet ${id}`;
  const npcName = (npc) => D.npcNames[npc] || `Monster ${npc}`;

  // The gathering kinds as the map names them, and what each holds (the names
  // the game gives its gathering spots).
  const KIND_ORDER = ["Herb", "Ore", "Wood", "Cotton", "Food", "Gemstone", "Od", "Fragment"];
  const KIND_LABELS = {
    Herb: "Herbs", Ore: "Ore", Wood: "Wood", Cotton: "Fibers", Food: "Cooking", Gemstone: "Gemstones",
    Od: "Odyle", Fragment: "Empyrean Traces", Cube: "Hidden Cube",
  };
  const kindItems = {};
  for (const o of Object.values(D.gather.objects)) {
    (kindItems[o.kind] ||= new Set()).add(o.name);
  }
  const kindLabel = (k) => KIND_LABELS[k] || k;
  // The places of the AION2 Interactive Map, by kind.
  const PLACE_LABELS = { seal: "Sealed dungeon", battlefield: "Battlefield", occupation: "Outpost", village: "Village" };
  const placeLabel = (k) => PLACE_LABELS[k] || k;
  const kindTitle = (k) => `${kindLabel(k)}: ${[...(kindItems[k] || [])].join(", ")}`;

  // ---------- what the search and other plugins ask for ("focus") ----------
  // { type: "gather" | "pet" | "npc" | "kibelisk" | "cube" | "monolith"
  //   | "place" | "region", ids: [...], label }
  // cube: ids ["spots"] (where one is known to stand) or ["all"] (every place
  // the game may put one); place: ids ["<kind>:<name>"] or ["<kind>:*"].

  /** The places of a focus on a map: [[x, y], ...] (spawn and gathering
   *  points, camps; not what is around right now). */
  function focusPoints(focus, key) {
    const out = [];
    if (!focus || !D.maps[key]) return out;
    const ids = new Set((focus.ids || []).map(String));
    if (focus.type === "gather") {
      for (const [env, pts] of Object.entries(gatherPoints(key))) {
        if (!ids.has(env)) continue;
        for (let i = 0; i < pts.length; i += 2) out.push([pts[i], pts[i + 1]]);
      }
    } else if (focus.type === "boss") {
      for (const [npc, , x, y] of D.bosses?.[key] || []) if (ids.has(String(npc))) out.push([x, y]);
    } else if (focus.type === "pet" || focus.type === "npc") {
      for (const [npc, pts] of Object.entries(spawnPoints(key))) {
        const hit = focus.type === "npc" ? ids.has(npc) : ids.has(String(D.npcPets[npc]));
        if (!hit) continue;
        for (let i = 0; i < pts.length; i += 2) out.push([pts[i], pts[i + 1]]);
      }
    } else if (focus.type === "kibelisk") {
      for (const [name, x, y] of D.kibelisks[key] || []) if (ids.has(name)) out.push([x, y]);
    } else if (focus.type === "cube" || focus.type === "monolith") {
      const pts = focus.type === "monolith" ? D.monoliths?.[key]
        : ids.has("all") ? D.gather.points[key]?.cube : cubeSpotPoints(key);
      for (let i = 0; i < (pts || []).length; i += 2) out.push([pts[i], pts[i + 1]]);
    } else if (focus.type === "place") {
      for (const [kind, name, x, y] of D.places?.[key] || []) {
        if (ids.has(`${kind}:*`) || ids.has(`${kind}:${name}`)) out.push([x, y]);
      }
    } else if (focus.type === "region") {
      for (const [name, x, y] of D.regions?.[key] || []) if (ids.has(name)) out.push([x, y]);
    }
    return out;
  }

  /** How many places a focus has on each map: { key: count }, most first. */
  function focusMaps(focus) {
    const out = {};
    for (const key of Object.keys(D.maps)) {
      const n = focusPoints(focus, key).length;
      if (n) out[key] = n;
    }
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
  }

  /** Whether something around right now is what the focus asks for. */
  function focusLive(focus, kind, id) {
    if (!focus) return false;
    const ids = (focus.ids || []).map(String);
    if (focus.type === "gather") return kind === "object" && ids.includes(String(id));
    if (focus.type === "npc" || focus.type === "boss") return kind === "npc" && ids.includes(String(id));
    if (focus.type === "pet") return kind === "npc" && ids.includes(String(D.npcPets[id]));
    if (focus.type === "cube") return kind === "object" && cubes.has(String(id));
    return false;
  }

  /** The gathering spots a material comes from, by its name (as the Market
   *  plugin names it: "Pure Asvata Log", "Fresh Aria", "Fine Odyle"): the
   *  objects whose name is in it, the longest such name. A focus, or null. */
  function gatherFor(itemName) {
    const words = ` ${fold(itemName)} `;
    let best = null;
    for (const [env, o] of Object.entries(D.gather.objects)) {
      if (o.kind === "Cube" || o.kind === "Fragment") continue;
      const n = fold(o.name);
      if (!words.includes(` ${n} `)) continue;
      if (!best || n.length > best.n.length) best = { n, name: o.name, ids: [env] };
      else if (n === best.n) best.ids.push(env);
    }
    return best ? { type: "gather", ids: best.ids, label: best.name } : null;
  }

  // ---------- the search ----------
  const fold = (t) => String(t).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  let index = null;
  function buildIndex() {
    const entries = [];
    // Gathering spots, by name (all the object ids of that name).
    const byName = new Map();
    for (const [env, o] of Object.entries(D.gather.objects)) {
      if (o.kind === "Cube") continue;
      const k = `${o.name}\u0000${o.kind}`;
      if (!byName.has(k)) byName.set(k, { name: o.name, kind: o.kind, ids: [] });
      byName.get(k).ids.push(env);
    }
    for (const g of byName.values()) {
      entries.push({ label: g.name, sub: kindLabel(g.kind), focus: { type: "gather", ids: g.ids, label: g.name }, gather: g.kind });
    }
    // Pets with spawn points, and the monsters that drop them.
    const spawned = new Set();
    for (const per of Object.values(D.spawns)) for (const npc of Object.keys(per)) spawned.add(npc);
    const petsWith = new Set([...spawned].map((n) => D.npcPets[n]).filter((p) => p != null).map(String));
    for (const pet of petsWith) {
      const name = D.pets[pet]?.name;
      if (name) entries.push({ label: name, sub: "Pet", focus: { type: "pet", ids: [pet], label: name } });
    }
    const npcsByName = new Map();
    for (const npc of spawned) {
      const name = D.npcNames[npc];
      if (!name) continue;
      if (!npcsByName.has(name)) npcsByName.set(name, []);
      npcsByName.get(name).push(npc);
    }
    for (const [name, npcs] of npcsByName) {
      const pets = [...new Set(npcs.map((n) => D.pets[D.npcPets[n]]?.name).filter(Boolean))];
      entries.push({ label: name, sub: pets.length ? `Monster · ${pets.join(", ")}` : "Monster", focus: { type: "npc", ids: npcs, label: name } });
    }
    // Field bosses, by name.
    const bossNames = new Map();
    for (const list of Object.values(D.bosses || {})) {
      for (const [npc, name] of list) {
        if (!name) continue;
        if (!bossNames.has(name)) bossNames.set(name, []);
        bossNames.get(name).push(String(npc));
      }
    }
    for (const [name, npcs] of bossNames) entries.push({ label: name, sub: "Field boss", focus: { type: "boss", ids: npcs, label: name }, extra: "boss world" });
    // Kibelisk camps.
    const camps = new Set();
    for (const list of Object.values(D.kibelisks)) for (const [name] of list) camps.add(name);
    for (const name of camps) entries.push({ label: name, sub: "Kibelisk", focus: { type: "kibelisk", ids: [name], label: name } });
    // Hidden Cubes: where one is known to stand (AION2 Interactive Map), and
    // every place the game may put one (the client's own list, many more).
    entries.push({ label: "Hidden Cube", sub: "Known spots", focus: { type: "cube", ids: ["spots"], label: "Hidden Cube" }, extra: "cubes hidden box" });
    entries.push({ label: "Hidden Cube", sub: "Every place one can appear", focus: { type: "cube", ids: ["all"], label: "Hidden Cube (every place)" }, extra: "cubes hidden box all possible", after: 1 });
    entries.push({ label: "Monolith", sub: "Monolith pieces to collect", focus: { type: "monolith", ids: [], label: "Monolith" }, extra: "monoliths material collectible" });
    // Sealed dungeons, battlefields, outposts, villages: each kind, and each
    // by its name.
    const placeKinds = new Set();
    const placeNames = new Map();
    for (const list of Object.values(D.places || {})) {
      for (const [kind, name] of list) {
        placeKinds.add(kind);
        if (name) placeNames.set(`${kind}:${name}`, [kind, name]);
      }
    }
    for (const kind of placeKinds) {
      const label = `${placeLabel(kind)}s`;
      entries.push({ label, sub: "All of them", focus: { type: "place", ids: [`${kind}:*`], label } });
    }
    for (const [id, [kind, name]] of placeNames) {
      entries.push({ label: name, sub: placeLabel(kind), focus: { type: "place", ids: [id], label: name } });
    }
    // Regions, by name.
    const regionNames = new Set();
    for (const list of Object.values(D.regions || {})) for (const [name] of list) regionNames.add(name);
    for (const name of regionNames) entries.push({ label: name, sub: "Region", focus: { type: "region", ids: [name], label: name } });
    for (const e of entries) e.key = fold(`${e.label} ${e.sub} ${e.extra || ""}`);
    return entries;
  }

  /** What matches every word of `query`: [{ label, sub, focus, maps }],
   *  names starting with the query first. */
  function search(query, limit = 30) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length || fold(query).trim().length < 2) return [];
    index ||= buildIndex();
    const q = fold(query).trim();
    const hits = index.filter((e) => words.every((w) => e.key.includes(w)));
    const scored = hits.map((e) => {
      const maps = focusMaps(e.focus);
      const total = Object.values(maps).reduce((a, b) => a + b, 0);
      const label = fold(e.label);
      const rank = label === q ? 0 : label.startsWith(q) ? 1 : 2;
      return { ...e, maps, total, rank };
    }).filter((e) => e.total > 0);
    scored.sort((a, b) => a.rank - b.rank || (a.after || 0) - (b.after || 0) || b.total - a.total || a.label.localeCompare(b.label));
    return scored.slice(0, limit);
  }

  /**
   * state: { key, world, tracked (Map), heading, layers, gatherKinds, petsMode, focus, nextFor }
   * -> { marks, next, petsHere, around, hits: [x, y, ...], route }
   * route: with a focus, the way to its cheapest place (routeTo); next then
   * names the Kibelisk to teleport to (next.via) where that is shorter.
   */
  function build({ key, world, tracked, heading, layers, gatherKinds, petsMode, focus, nextFor = "all", needed = null }) {
    const marks = [];
    const map = D.maps[key];
    if (!map) return { marks, next: null, petsHere: 0, around: 0, hits: [], route: null };
    const me = world?.me || null;
    // petsMode "tracked": Pet Finder's favourites and the pet being farmed
    // (with none followed, all); "needed": those and every pet not at level
    // 3 yet (all while Pet Finder hasn't read the pet list); "all".
    const all = petsMode === "all" || (petsMode !== "needed" && tracked.size === 0) || (petsMode === "needed" && !needed);
    const wanted = (pet) => all || tracked.has(String(pet)) || (petsMode === "needed" && !!needed?.has(String(pet)));
    // How a pet looks (render.js pet()): a favourite a gold star, the one
    // being farmed red in a thick white ring, one not at level 3 yet red in a
    // white ring, one at level 3 small and grey; levels not known: small and
    // white. The size of its spawn points and their order (z).
    // A pet not at level 3 is filled in its genus colour.
    const isNeeded = (pet) => (needed ? needed.has(String(pet)) : null);
    const style = (pet) => {
      const t = tracked.get(String(pet));
      const g = genusOf(pet);
      const color = g?.color;
      const genus = g ? ` · ${g.name}` : "";
      if (t?.mark === "pinned") return { look: "fav", r: 4.5, z: 3, color, text: `★ favourite${genus}` };
      if (t?.mark === "farming") return { look: "farm", r: 4, z: 3, color, text: `being farmed${genus}` };
      const n = isNeeded(pet);
      if (n === true || (n === null && t)) return { look: "need", r: 3.5, z: 2, color, text: `not at level 3 yet${genus}` };
      if (n === false) return { look: "max", r: 2.5, z: 1, text: "level 3" };
      return { look: "plain", r: 2.5, z: 1, text: "" };
    };

    // The next pet to go for: a pinned one before one being farmed, that
    // before one only still needed (Pet Finder shares every pet not at rank 3
    // yet, so many); among them one that is there right now, then the
    // nearest. nextFor "chosen": only pinned and farmed ones; "off": none.
    let next = null;
    const consider = (pet, x, y, live) => {
      if (!me || !tracked.size || nextFor === "off") return;
      const t = tracked.get(String(pet));
      if (!t) return;
      const rank = RANK[t.mark] || 1;
      if (nextFor === "chosen" && rank < RANK.farming) return;
      const d = K.metres(me.x, me.y, x, y);
      if (!next || rank > next.rank || (rank === next.rank && ((live && !next.live) || (live === next.live && d < next.metres)))) {
        next = { pet, name: petName(pet, tracked), metres: d, bearing: K.bearing(me.x, me.y, x, y), live, mark: t.mark, rank };
      }
    };

    const petsHere = new Set();
    if (layers.pets) {
      for (const [npc, pts] of Object.entries(spawnPoints(key))) {
        const pet = D.npcPets[npc];
        if (pet == null) continue;
        if (!wanted(pet)) continue;
        petsHere.add(String(pet));
        const s = style(pet);
        const label = `${petName(pet, tracked)} · ${npcName(npc)}${s.text ? ` · ${s.text}` : ""}`;
        for (let i = 0; i < pts.length; i += 2) {
          marks.push({ kind: "petSpawn", x: pts[i], y: pts[i + 1], r: s.r, look: s.look, color: s.color, label, z: s.z });
          consider(pet, pts[i], pts[i + 1], false);
        }
      }
    }

    let around = 0;
    // A pet monster there now: the ones followed, and every one not at level
    // 3 yet (so what is still worth killing near you stands out).
    for (const [, npc, x, y] of world?.npcs || []) {
      const pet = D.npcPets[npc];
      if (pet != null && layers.pets && (wanted(pet) || isNeeded(pet))) {
        around++;
        const s = style(pet);
        const d = me ? ` · ${Math.round(K.metres(me.x, me.y, x, y))} m` : "";
        marks.push({ kind: "petLive", x, y, r: s.look === "max" ? 4 : 6, look: s.look, color: s.color, label: `${petName(pet, tracked)} · ${npcName(npc)}${s.text ? ` · ${s.text}` : ""}${d}`, z: s.look === "max" ? 7 : 8 });
        consider(pet, x, y, true);
      } else if (layers.monsters) {
        marks.push({ kind: "monster", x, y, r: 2.5, label: npcName(npc), z: 4 });
      }
    }

    if (layers.gather) {
      for (const [env, pts] of Object.entries(gatherPoints(key))) {
        const o = D.gather.objects[env];
        if (!o || o.kind === "Cube" || gatherKinds[o.kind] === false) continue;
        for (let i = 0; i < pts.length; i += 2) {
          marks.push({ kind: "gather", gather: o.kind, x: pts[i], y: pts[i + 1], r: 3, label: `${o.name} (${kindLabel(o.kind)})`, z: 2 });
        }
      }
    }
    for (const [, env, x, y] of world?.objects || []) {
      if (cubes.has(String(env))) {
        if (layers.cubes) marks.push({ kind: "cube", x, y, r: 6, label: "Hidden Cube", z: 9 });
        continue;
      }
      const o = D.gather.objects[env];
      if (o && layers.gather && gatherKinds[o.kind] !== false) {
        marks.push({ kind: "gather", gather: o.kind, live: true, x, y, r: 5, label: `${o.name} (${kindLabel(o.kind)}) · there now`, z: 7 });
      }
    }

    if (layers.kibelisks) {
      for (const [name, x, y] of D.kibelisks[key] || []) {
        marks.push({ kind: "kibelisk", x, y, r: 5, label: `Kibelisk: ${name}`, text: name, z: 5 });
      }
    }
    if (layers.cubes) {
      const pts = cubeSpotPoints(key);
      for (let i = 0; i < pts.length; i += 2) {
        marks.push({ kind: "cubeSpot", x: pts[i], y: pts[i + 1], r: 3.5, label: "Hidden Cube (known spot)", z: 3 });
      }
    }
    if (layers.monoliths) {
      const pts = D.monoliths?.[key] || [];
      for (let i = 0; i < pts.length; i += 2) {
        marks.push({ kind: "monolith", x: pts[i], y: pts[i + 1], r: 3, label: "Monolith piece", z: 2 });
      }
    }
    if (layers.places) {
      for (const [kind, name, x, y] of D.places?.[key] || []) {
        marks.push({ kind: "place", place: kind, x, y, r: 5, label: name ? `${name} (${placeLabel(kind)})` : placeLabel(kind), text: name || null, z: 4 });
      }
      for (const [name, x, y] of D.regions?.[key] || []) marks.push({ kind: "region", x, y, text: name, z: 0 });
      for (const [, name, x, y] of D.bosses?.[key] || []) marks.push({ kind: "boss", x, y, r: 5, label: `${name} (field boss)`, text: name, z: 6 });
    }

    // The focus: its places with a gold ring, and the nearest one is next
    // (one that is there right now first).
    const hits = [];
    let route = null;
    if (focus) {
      let best = null;
      const near = (x, y, live) => {
        if (!me) return;
        const d = K.metres(me.x, me.y, x, y);
        if (!best || (live && !best.live) || (live === best.live && d < best.metres)) {
          best = { name: focus.label, metres: d, bearing: K.bearing(me.x, me.y, x, y), live, focus: true };
        }
      };
      const all = (focus.ids || []).includes("all");
      const placeOf = new Map((D.places?.[key] || []).map(([kind, name, x, y]) => [`${x},${y}`, [kind, name]]));
      const STYLES = {
        gather: (x, y) => ({ kind: "gather", gather: D.gather.objects[focus.ids[0]]?.kind, x, y, r: 4 }),
        kibelisk: (x, y) => ({ kind: "kibelisk", x, y, r: 6, text: focus.label }),
        cube: (x, y) => ({ kind: "cubeSpot", all, x, y, r: all ? 2.5 : 4.5 }),
        monolith: (x, y) => ({ kind: "monolith", x, y, r: 3.5 }),
        place: (x, y) => {
          const [kind, name] = placeOf.get(`${x},${y}`) || [];
          return { kind: "place", place: kind, x, y, r: 5.5, text: name || null, label: name ? `${name} (${placeLabel(kind)})` : focus.label };
        },
        region: (x, y) => ({ kind: "place", place: "village", x, y, r: 5, text: focus.label }),
        boss: (x, y) => ({ kind: "boss", x, y, r: 6, text: focus.label }),
      };
      const style = STYLES[focus.type] || ((x, y) => ({ kind: "petSpawn", x, y, r: 4.5, look: "need" }));
      for (const [x, y] of focusPoints(focus, key)) {
        hits.push(x, y);
        // Every place a cube may appear: many, so no gold ring each.
        marks.push({ label: focus.label, ...style(x, y), hit: !all, z: 50 });
        near(x, y, false);
      }
      for (const [, npc, x, y] of world?.npcs || []) {
        if (!focusLive(focus, "npc", npc)) continue;
        marks.push({ kind: "petLive", x, y, r: 6, look: "need", hit: true, label: `${focus.label} · there now`, z: 60 });
        near(x, y, true);
      }
      for (const [, env, x, y] of world?.objects || []) {
        if (!focusLive(focus, "object", env)) continue;
        marks.push(focus.type === "cube"
          ? { kind: "cube", x, y, r: 6, hit: true, label: "Hidden Cube · there now", z: 60 }
          : { kind: "gather", gather: D.gather.objects[env]?.kind, live: true, x, y, r: 5, hit: true, label: `${focus.label} · there now`, z: 60 });
        near(x, y, true);
      }
      // The way there: to one that is there right now, walking; else to the
      // cheapest of its places, by teleport to a Kibelisk where that is
      // shorter (not to every place a cube may appear: too many).
      if (best?.live) next = best;
      else if (!all && hits.length) {
        const targets = [];
        for (let i = 0; i < hits.length; i += 2) targets.push([hits[i], hits[i + 1]]);
        route = routeTo(key, me, targets);
        if (route) {
          const [tx, ty] = route.to;
          if (route.kib) {
            const [kn, kx, ky] = route.kib;
            marks.push({ kind: "teleport", x: kx, y: ky, r: 7, label: `Teleport to Kibelisk ${kn}, then ${Math.round(route.metres)} m`, text: `Teleport: ${kn}`, z: 55 });
          }
          marks.push({ kind: "route", x: tx, y: ty, from: route.from, z: 30 });
          if (me) {
            next = {
              name: focus.label, focus: true, live: false,
              metres: route.walk, bearing: K.bearing(me.x, me.y, tx, ty),
              via: route.kib ? { name: route.kib[0], metres: route.metres, bearing: K.bearing(me.x, me.y, route.kib[1], route.kib[2]) } : null,
            };
          }
        } else if (best) next = best;
      } else if (best) next = best;
    }

    if (me) marks.push({ kind: "me", x: me.x, y: me.y, exact: !!me.exact, acc: me.acc, heading: heading ?? 0, r: 6, label: me.exact ? "You" : `You (about here, ±${Math.round(me.acc || 10)} m)`, z: 100 });
    return { marks, next, petsHere: petsHere.size, around, hits, route };
  }

  /** The map the player is on: the zone's, else the one the pet monsters,
   *  gathering spots and Hidden Cubes around him stand on, else none. */
  function mapOf(world) {
    const byZone = world?.zone != null ? D.zones[String(world.zone)] : null;
    const around = world?.npcs?.length || world?.objects?.length ? K.mapVotes(world.npcs, world.objects) : {};
    const [best, count] = Object.entries(around).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    // What is around wins over a zone that is clearly out of date: the meter
    // hears the zone only with a loading screen, and one it missed (going
    // over to the Elyos side, 2026-10-27) left the map on Altgard while the
    // player stood in Verteron. Clearly: 3 or more around for another map,
    // and more than for the zone's.
    if (byZone) return best && best !== byZone && count >= MIN_AROUND && count > (around[byZone] || 0) ? best : byZone;
    return best;
  }
  const MIN_AROUND = 3;

  /** The region of a map a place lies in (AION2 Interactive Map), or null. */
  function regionAt(key, x, y) {
    for (const [name, , , rings] of D.regions?.[key] || []) {
      let inside = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
          const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      if (inside) return name;
    }
    return null;
  }

  /** Why a pet is followed, as the next one says it. */
  const MARK_TEXT = { pinned: "a favourite (Pet Finder ★)", farming: "being farmed", needed: "not at level 3 yet" };
  const markText = (mark) => MARK_TEXT[mark] || MARK_TEXT.needed;

  /** The compass arrow for a bearing (0 = up). */
  const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const arrow = (deg) => ARROWS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  globalThis.MapMarks = Object.freeze({
    build, mergeTracked, neededOf, soulsOf, nearestKinds, nearestByPet, GENUS, genusOf, mapOf, regionAt, arrow, markText, petName, setLearned, learnFrom, routeTo, gatherFor, TELEPORT_M, steady, search, focusMaps, focusPoints, KIND_ORDER, kindLabel, kindTitle, placeLabel,
  });
})();
