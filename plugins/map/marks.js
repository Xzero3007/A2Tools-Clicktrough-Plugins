// What the map shows, from the world around the player (a2.on("world")), the
// pets other plugins track (a2.on("shared")) and the layers picked: the marks,
// the next pet to go for and the counts. The map window and its overlay both
// build their marks here.
(() => {
  const D = globalThis.MAP_DATA;
  const K = globalThis.MapKit;
  // Where the game itself puts each pet monster (areas.js, from the game's
  // tables): npc -> map -> [spawns, x, y, zones], the number of its spawn
  // points there, the middle one of them and the subzones they lie in.
  const A = globalThis.MAP_AREAS || {};
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
  // What this player's meter sees where the map has none of its kind yet is
  // added: { key: { g: { env: [x, y, ...] }, s: { npc: [x, y, ...] }, c: [x,
  // y, ...], f: [x, y, ...], o: { kind: [x, y, ...] } } } (gathering spots,
  // pet monsters' spawn points, Hidden Cubes, feathers, and the other objects
  // the data knows the ids of: Kibelisks, rifts, dungeon entrances ...),
  // kept by the plugin.
  let learned = {};
  const LEARN_CAP = 25000; // points per map (a stored value may be 1 MB)
  const setLearned = (value) => {
    learned = value && typeof value === "object" ? value : {};
    index = null;
    counts = null;
    spawnCache.clear();
    placeCache.clear();
  };
  // What depends on the learnt spots, per map, until they change.
  const spawnCache = new Map();
  const placeCache = new Map();
  const count = (lk) => (lk ? Object.values(lk.g || {}).reduce((n, a) => n + a.length / 2, 0)
    + Object.values(lk.s || {}).reduce((n, a) => n + a.length / 2, 0) + (lk.c || []).length / 2
    + (lk.f || []).length / 2 + Object.values(lk.o || {}).reduce((n, a) => n + a.length / 2, 0) : 0);
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
  /** The game's middle spawn point of each monster on map `key` the data
   *  doesn't already have (within 20 m): npc -> [x, y]. A real spawn point
   *  (areas.js), so a monster the data lacks still has one place. */
  const midCache = new Map();
  function gameMids(key) {
    if (midCache.has(key)) return midCache.get(key);
    const out = {};
    for (const [npc, per] of Object.entries(A)) {
      const a = per[key];
      if (a && !near(D.spawns[key]?.[npc], a[1], a[2], 2000)) out[npc] = [a[1], a[2]];
    }
    midCache.set(key, out);
    return out;
  }
  /** Whether x, y is a monster's middle spawn point from the game's tables. */
  const isGameMid = (key, npc, x, y) => {
    const m = gameMids(key)[npc];
    return !!m && m[0] === x && m[1] === y;
  };
  /** A map's pet monster spawn points: the data's, the game's middle one
   *  where the data lacks it, and the learnt. */
  function spawnPoints(key) {
    if (spawnCache.has(key)) return spawnCache.get(key);
    const data = D.spawns[key] || {};
    const mids = gameMids(key);
    const mine = learned[key]?.s;
    const out = { ...data };
    for (const [npc, xy] of Object.entries(mids)) out[npc] = both(out[npc], xy);
    for (const [npc, pts] of Object.entries(mine || {})) out[npc] = both(out[npc], pts);
    spawnCache.set(key, out);
    return out;
  }
  const cubeSpotPoints = (key) => both(D.cubeSpots?.[key], learned[key]?.c);
  /** Where every monster (D.monsters) or other NPC (D.npcs) stands on map
   *  `key`, as the game has them: npc -> [x, y, ...] in cm (the data keeps
   *  metres). */
  const cmCache = new Map();
  function inCm(what, key) {
    const id = `${what}:${key}`;
    if (cmCache.has(id)) return cmCache.get(id);
    const out = {};
    for (const [npc, pts] of Object.entries(D[what]?.[key] || {})) out[npc] = pts.map((v) => v * 100);
    cmCache.set(id, out);
    return out;
  }
  const monsterPoints = (key) => inCm("monsters", key);
  const npcPoints = (key) => inCm("npcs", key);
  /** A map's feathers (Monolith pieces): the data's and the learnt. */
  const featherPoints = (key) => both(D.monoliths?.[key], learned[key]?.f);
  const featherIds = new Set((D.featherIds || []).map(String));
  /** A map's Kibelisks: [name, x, y, side], the data's and the learnt. */
  function kibelisksOf(key) {
    const out = [...(D.kibelisks[key] || [])];
    const mine = learned[key]?.o?.kibelisk || [];
    for (let i = 0; i < mine.length; i += 2) out.push(["Kibelisk", mine[i], mine[i + 1], sideOf(key)]);
    return out;
  }
  /** A map's places: [kind, name, x, y, detail?], the data's and the learnt
   *  objects of a place's kind (no name: the kind's). */
  function placesOf(key) {
    if (placeCache.has(key)) return placeCache.get(key);
    const out = [...(D.places?.[key] || [])];
    for (const [kind, pts] of Object.entries(learned[key]?.o || {})) {
      if (kind === "kibelisk") continue;
      for (let i = 0; i < pts.length; i += 2) out.push([kind, "", pts[i], pts[i + 1]]);
    }
    placeCache.set(key, out);
    return out;
  }
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
    lk.f ||= [];
    lk.o ||= {};
    for (const [, env, x, y] of world.objects || []) {
      if (room <= 0) break;
      const id = String(env);
      const kind = D.objectKinds?.[id];
      if (cubes.has(id)) {
        if (near(D.cubeSpots?.[key], x, y, 800) || near(lk.c, x, y, 800)) continue;
        lk.c.push(Math.round(x), Math.round(y));
      } else if (featherIds.has(id)) {
        if (near(D.monoliths?.[key], x, y, 800) || near(lk.f, x, y, 800)) continue;
        lk.f.push(Math.round(x), Math.round(y));
      } else if (kind) {
        // A Kibelisk, rift, dungeon entrance ...: where the map has none of
        // its kind within 30 m.
        const known = kind === "kibelisk"
          ? (D.kibelisks[key] || []).flatMap(([, kx, ky]) => [kx, ky])
          : (D.places?.[key] || []).filter(([k]) => k === kind).flatMap(([, , px, py]) => [px, py]);
        if (near(known, x, y, 3000) || near(lk.o[kind], x, y, 3000)) continue;
        (lk.o[kind] ||= []).push(Math.round(x), Math.round(y));
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
      if (near(D.spawns[key]?.[id], x, y, 2000) || near(gameMids(key)[id], x, y, 2000) || near(lk.s[id], x, y, 2000)) continue;
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
  /** What the game's middle spawn point of a monster is, for its tooltip. */
  const midText = (key, npc) => {
    const a = A[npc]?.[key];
    return a ? `the middle one of the game's ${a[0]} spawn point${a[0] === 1 ? "" : "s"} here` : "a spawn point from the game's tables";
  };

  // The gathering kinds as the map names them, and what each holds (the names
  // the game gives its gathering spots).
  const KIND_ORDER = ["Herb", "Ore", "Wood", "Cotton", "Food", "Gemstone", "Od"];
  const KIND_LABELS = {
    Herb: "Herbs", Ore: "Ore", Wood: "Wood", Cotton: "Fibers", Food: "Cooking", Gemstone: "Gemstones",
    Od: "Odyle", Cube: "Hidden Cube",
  };
  // The game's minimap symbol of each gathering kind (icons/).
  const KIND_ICONS = {
    Herb: "gather_herb", Ore: "gatherl_metal", Wood: "gather_tree", Cotton: "gather_flower", Food: "gather_vegetable",
    Gemstone: "gatherl_jewelry", Od: "gather_od",
  };
  const kindIcon = (k) => KIND_ICONS[k] || "gather";
  const kindItems = {};
  for (const o of Object.values(D.gather.objects)) {
    (kindItems[o.kind] ||= new Set()).add(o.name);
  }
  const kindLabel = (k) => KIND_LABELS[k] || k;
  // The places of the AION2 Interactive Map, by kind.
  const PLACE_LABELS = {
    seal: "Sealed dungeon", battlefield: "Battlefield", occupation: "Outpost", village: "Village",
    dungeon: "Dungeon entrance", rift: "Spacetime Rift", flightring: "Flight circle", monolith: "Monolith",
    abyssartifact: "Abyss artifact", abysscore: "Abyss core", abysscorridor: "Abyss corridor", fieldevent: "Field event",
    door: "Passage", shop: "Merchant", storage: "Storage", alchemy: "Alchemy Table", blacksmith: "Blacksmithing Table",
    cook: "Cooking Table", jewelcraft: "Handicrafting Table", tailor: "Armorsmithing Table", npcteleport: "Teleport tower",
    heroquest: "Hero quest", districtquest: "District quest",
  };
  const placeLabel = (k) => PLACE_LABELS[k] || k;
  const PLURALS = { storage: "Storages", heroquest: "Hero quest givers", districtquest: "District quest givers" };
  const placePlural = (k) => PLURALS[k] || `${placeLabel(k)}s`;
  /** A place's name and kind for its tooltip ("Alchemy Table" alone, not
   *  "Alchemy Table (Alchemy Table)"). */
  const placeText = (kind, name) => {
    const what = placeLabel(kind);
    return !name ? what : fold(name) === fold(what) ? name : `${name} (${what})`;
  };
  // Which layer each kind of place is in: the merchants and crafting tables
  // ("Services"), the quest givers ("Quests"), the rest "Places".
  const SERVICES = new Set(["shop", "storage", "alchemy", "blacksmith", "cook", "jewelcraft", "tailor", "npcteleport"]);
  const QUESTS = new Set(["heroquest", "districtquest"]);
  const placeLayer = (k) => (SERVICES.has(k) ? "services" : QUESTS.has(k) ? "quests" : "places");
  // The Elyos side's maps draw the light Kibelisk and Monolith, the
  // Asmodian side's the dark ones.
  const DARK = new Set(["altgard", "morheim", "ishalgen"]);
  const sideOf = (key) => (DARK.has(key) ? "dark" : "light");
  // The game's minimap symbol of each kind of place (icons/).
  const placeIcon = (kind, key) => (kind === "monolith" ? `monolith_${key ? sideOf(key) : "light"}` : kind);
  const kindTitle = (k) => `${kindLabel(k)}: ${[...(kindItems[k] || [])].join(", ")}`;
  /** How many gathering spots of each kind map `key` has (the data's and
   *  the learnt): { kind: count }; with no key, all maps together. */
  function gatherCounts(key) {
    const out = {};
    for (const k of key ? [key] : Object.keys(D.maps)) {
      for (const [env, pts] of Object.entries(gatherPoints(k))) {
        const kind = D.gather.objects[env]?.kind;
        if (kind && kind !== "Cube") out[kind] = (out[kind] || 0) + pts.length / 2;
      }
    }
    return out;
  }

  // ---------- what the search and other plugins ask for ("focus") ----------
  // { type: "gather" | "pet" | "npc" (a monster) | "person" (another NPC)
  //   | "boss" | "kibelisk" | "cube" | "monolith" (feathers) | "place"
  //   | "region" | "label" (an area's name), ids: [...], label }
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
      // A pet monster: its spawn points as the pets layer has them (with the
      // learnt); any other monster: where the game has it, as the monsters
      // layer draws it.
      const pets = spawnPoints(key);
      const mobs = monsterPoints(key);
      const other = (npc) => D.npcPets[npc] == null && !!mobs[npc];
      for (const [npc, pts] of Object.entries(pets)) {
        const hit = focus.type === "npc" ? ids.has(npc) && !other(npc) : ids.has(String(D.npcPets[npc]));
        if (!hit) continue;
        for (let i = 0; i < pts.length; i += 2) out.push([pts[i], pts[i + 1]]);
      }
      if (focus.type === "npc") {
        for (const [npc, pts] of Object.entries(mobs)) {
          if (!ids.has(npc) || (pets[npc] && !other(npc))) continue;
          for (let i = 0; i < pts.length; i += 2) out.push([pts[i], pts[i + 1]]);
        }
      }
    } else if (focus.type === "person") {
      for (const [npc, pts] of Object.entries(npcPoints(key))) {
        if (!ids.has(npc)) continue;
        for (let i = 0; i < pts.length; i += 2) out.push([pts[i], pts[i + 1]]);
      }
    } else if (focus.type === "kibelisk") {
      for (const [name, x, y] of kibelisksOf(key)) if (ids.has("*") || ids.has(name)) out.push([x, y]);
    } else if (focus.type === "cube" || focus.type === "monolith") {
      const pts = focus.type === "monolith" ? featherPoints(key)
        : ids.has("all") ? D.gather.points[key]?.cube : cubeSpotPoints(key);
      for (let i = 0; i < (pts || []).length; i += 2) out.push([pts[i], pts[i + 1]]);
    } else if (focus.type === "place") {
      for (const [kind, name, x, y] of placesOf(key)) {
        if (ids.has(`${kind}:*`) || ids.has(`${kind}:${name}`)) out.push([x, y]);
      }
    } else if (focus.type === "region") {
      for (const [name, x, y] of D.regions?.[key] || []) if (ids.has(name)) out.push([x, y]);
    } else if (focus.type === "label") {
      for (const [name, , x, y] of D.labels?.[key] || []) if (ids.has(name)) out.push([x, y]);
    }
    return out;
  }

  /** How many places a focus has on each map, counted from its points:
   *  { key: count }, most first. */
  function focusMapsByPoints(focus) {
    const out = {};
    for (const key of Object.keys(D.maps)) {
      const n = focusPoints(focus, key).length;
      if (n) out[key] = n;
    }
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
  }

  // The same, from tables counted once (until the learnt spots change): the
  // search asks it for hundreds of names at a time.
  let counts = null;
  function countTables() {
    const t = { gather: {}, npc: {}, pet: {}, person: {}, boss: {}, kibelisk: {}, place: {}, region: {}, label: {} };
    const inc = (table, id, key, n) => {
      if (!n) return;
      const per = (table[id] ||= {});
      per[key] = (per[key] || 0) + n;
    };
    for (const key of Object.keys(D.maps)) {
      for (const [env, pts] of Object.entries(gatherPoints(key))) inc(t.gather, env, key, pts.length / 2);
      // As focusPoints counts them: a pet monster by its spawn points, any
      // other monster where the game has it.
      const pets = spawnPoints(key);
      const mobs = monsterPoints(key);
      const other = (npc) => D.npcPets[npc] == null && !!mobs[npc];
      for (const [npc, pts] of Object.entries(pets)) {
        if (!other(npc)) inc(t.npc, npc, key, pts.length / 2);
        if (D.npcPets[npc] != null) inc(t.pet, String(D.npcPets[npc]), key, pts.length / 2);
      }
      for (const [npc, pts] of Object.entries(mobs)) if (!pets[npc] || other(npc)) inc(t.npc, npc, key, pts.length / 2);
      for (const [npc, pts] of Object.entries(npcPoints(key))) inc(t.person, npc, key, pts.length / 2);
      for (const [npc] of D.bosses?.[key] || []) inc(t.boss, String(npc), key, 1);
      for (const [name] of kibelisksOf(key)) {
        inc(t.kibelisk, name, key, 1);
        inc(t.kibelisk, "*", key, 1);
      }
      for (const [kind, name] of placesOf(key)) {
        inc(t.place, `${kind}:*`, key, 1);
        inc(t.place, `${kind}:${name}`, key, 1);
      }
      for (const [name] of D.regions?.[key] || []) inc(t.region, name, key, 1);
      for (const [name] of D.labels?.[key] || []) inc(t.label, name, key, 1);
    }
    return t;
  }
  /** How many places a focus has on each map: { key: count }, most first. */
  function focusMaps(focus) {
    const ids = [...new Set((focus?.ids || []).map(String))];
    if (!focus || !(focus.type in TABLED) || ((focus.type === "place" || focus.type === "kibelisk") && ids.length !== 1)) return focusMapsByPoints(focus);
    counts ||= countTables();
    const table = counts[focus.type];
    const out = {};
    for (const key of Object.keys(D.maps)) {
      const n = ids.reduce((sum, id) => sum + (table[id]?.[key] || 0), 0);
      if (n) out[key] = n;
    }
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
  }
  const TABLED = { gather: 1, npc: 1, pet: 1, person: 1, boss: 1, kibelisk: 1, place: 1, region: 1, label: 1 };

  /**
   * For a monster or pet focus on map `key`, where the game itself puts it
   * (areas.js): { game, known, zones, rings, labels }: how many spawn points
   * the game has there and how many the map knows (the data's, the game's
   * middle one, the learnt), the subzones they lie in, and the outlines and
   * name places of those the map's regions know. Null for other focuses or
   * when the game has none there.
   */
  function focusArea(focus, key) {
    if (!focus || (focus.type !== "pet" && focus.type !== "npc") || !D.maps[key]) return null;
    const ids = new Set((focus.ids || []).map(String));
    const pts = spawnPoints(key);
    let game = 0;
    let known = 0;
    const zones = [];
    for (const [npc, per] of Object.entries(A)) {
      const a = per[key];
      if (!a) continue;
      if (focus.type === "npc" ? !ids.has(npc) : !ids.has(String(D.npcPets[npc]))) continue;
      game += a[0];
      known += Math.min(a[0], (pts[npc] || []).length / 2);
      for (const z of a[3] || []) if (!zones.includes(z)) zones.push(z);
    }
    if (!game) return null;
    const rings = [];
    const labels = [];
    for (const [name, lx, ly, rs] of D.regions?.[key] || []) {
      if (!zones.includes(name)) continue;
      rings.push(...rs);
      labels.push([name, lx, ly]);
    }
    return { game, known, zones, rings, labels };
  }

  /** The world points (x, y, ...) to frame a focus on map `key`: its places,
   *  and the outline of where the game puts what the map knows only in part. */
  function focusFit(focus, key) {
    const out = focusPoints(focus, key).flat();
    const area = focusArea(focus, key);
    if (area && area.known < area.game) for (const ring of area.rings) out.push(...ring);
    return out;
  }

  /** Whether something around right now is what the focus asks for. */
  function focusLive(focus, kind, id) {
    if (!focus) return false;
    const ids = (focus.ids || []).map(String);
    if (focus.type === "gather") return kind === "object" && ids.includes(String(id));
    if (focus.type === "npc" || focus.type === "boss" || focus.type === "person") return kind === "npc" && ids.includes(String(id));
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
    const add = (e) => entries.push(e);
    const group = (map, name, id) => {
      if (!map.has(name)) map.set(name, []);
      if (!map.get(name).includes(id)) map.get(name).push(id);
    };
    // Gathering spots, by name (all the object ids of that name).
    const byName = new Map();
    for (const [env, o] of Object.entries(D.gather.objects)) {
      if (o.kind === "Cube" || o.kind === "Fragment") continue;
      const k = `${o.name}\u0000${o.kind}`;
      if (!byName.has(k)) byName.set(k, { name: o.name, kind: o.kind, icon: o.icon || kindIcon(o.kind), ids: [] });
      byName.get(k).ids.push(env);
    }
    for (const g of byName.values()) {
      add({ label: g.name, sub: kindLabel(g.kind), focus: { type: "gather", ids: g.ids, label: g.name }, gather: g.kind, icon: g.icon, extra: "gathering" });
    }
    // Pets with spawn points, and the monsters that drop them (the data's,
    // and those only the game's tables place, areas.js); every other
    // monster where the game has it.
    const spawned = new Set();
    for (const per of Object.values(D.spawns)) for (const npc of Object.keys(per)) spawned.add(npc);
    for (const [npc, per] of Object.entries(A)) if (Object.keys(per).some((key) => D.maps[key])) spawned.add(npc);
    const petsWith = new Set([...spawned].map((n) => D.npcPets[n]).filter((p) => p != null).map(String));
    for (const pet of petsWith) {
      const name = D.pets[pet]?.name;
      if (name) add({ label: name, sub: "Pet", focus: { type: "pet", ids: [pet], label: name }, mark: "pet" });
    }
    // (A field boss is found as one, below.)
    const bossIds = new Set(Object.values(D.bosses || {}).flat().map(([npc]) => String(npc)));
    const npcsByName = new Map();
    for (const npc of spawned) if (D.npcNames[npc]) group(npcsByName, D.npcNames[npc], npc);
    for (const per of Object.values(D.monsters || {})) {
      for (const npc of Object.keys(per)) if (D.npcNames[npc] && !bossIds.has(npc)) group(npcsByName, D.npcNames[npc], npc);
    }
    for (const [name, npcs] of npcsByName) {
      const pets = [...new Set(npcs.map((n) => D.pets[D.npcPets[n]]?.name).filter(Boolean))];
      const lv = [...new Set(npcs.map((n) => D.monsterLevels?.[n] ?? D.npcLevels?.[n]).filter(Boolean))].sort((a, b) => a - b);
      const level = lv.length ? ` · Lv ${lv[0]}${lv.length > 1 ? `–${lv[lv.length - 1]}` : ""}` : "";
      add({ label: name, sub: `Monster${level}${pets.length ? ` · ${pets.join(", ")}` : ""}`, focus: { type: "npc", ids: npcs, label: name },
        mark: pets.length ? "pet" : "monster", extra: "monster mob" });
    }
    // Other NPCs (townsfolk, guards ...), by name.
    const peopleByName = new Map();
    for (const per of Object.values(D.npcs || {})) {
      for (const npc of Object.keys(per)) if (D.npcNames[npc]) group(peopleByName, D.npcNames[npc], npc);
    }
    for (const [name, npcs] of peopleByName) add({ label: name, sub: "NPC", focus: { type: "person", ids: npcs, label: name }, icon: "npc", extra: "npc" });
    // Field bosses, by name.
    const bossNames = new Map();
    for (const list of Object.values(D.bosses || {})) {
      for (const [npc, name] of list) if (name) group(bossNames, name, String(npc));
    }
    for (const [name, npcs] of bossNames) add({ label: name, sub: "Field boss", focus: { type: "boss", ids: npcs, label: name }, icon: "boss", extra: "boss world" });
    // Kibelisk camps, and all of them.
    const camps = new Set();
    for (const list of Object.values(D.kibelisks)) for (const [name] of list) camps.add(name);
    add({ label: "Kibelisks", sub: "All of them", focus: { type: "kibelisk", ids: ["*"], label: "Kibelisks" }, icon: "teleportartifact_light", extra: "kibelisk teleport", after: 1 });
    for (const name of camps) add({ label: name, sub: "Kibelisk", focus: { type: "kibelisk", ids: [name], label: name }, icon: "teleportartifact_light", extra: "teleport" });
    // Hidden Cubes: where one is known to stand, and every place the game may
    // put one (the client's own list, many more).
    add({ label: "Hidden Cube", sub: "Known spots", focus: { type: "cube", ids: ["spots"], label: "Hidden Cube" }, mark: "cube", extra: "cubes hidden box" });
    add({ label: "Hidden Cube", sub: "Every place one can appear", focus: { type: "cube", ids: ["all"], label: "Hidden Cube (every place)" }, mark: "cube", extra: "cubes hidden box all possible", after: 1 });
    // Feathers: the Monolith pieces to collect (the game's Empyrean Traces).
    add({ label: "Feathers", sub: "Monolith pieces to collect", focus: { type: "monolith", ids: [], label: "Feathers" }, icon: "feather", extra: "feather monolith monoliths pieces fragments empyrean traces collectible" });
    // Places, services and quest givers: each kind, each by its name, and
    // each quest by its name.
    const placeKinds = new Set();
    const placeNames = new Map();
    const quests = new Map();
    for (const list of Object.values(D.places || {})) {
      for (const [kind, name, , , detail] of list) {
        placeKinds.add(kind);
        if (name) placeNames.set(`${kind}:${name}`, [kind, name]);
        for (const q of detail ? String(detail).split("; ") : []) if (q) quests.set(`${q}\u0000${kind}:${name}`, [q, kind, name]);
      }
    }
    for (const kind of placeKinds) {
      const label = placePlural(kind);
      add({ label, sub: "All of them", focus: { type: "place", ids: [`${kind}:*`], label }, icon: placeIcon(kind, null), place: kind, after: 1 });
    }
    for (const [id, [kind, name]] of placeNames) {
      add({ label: name, sub: placeLabel(kind), focus: { type: "place", ids: [id], label: name }, icon: placeIcon(kind, null), place: kind });
    }
    for (const [q, kind, name] of quests.values()) {
      add({ label: q, sub: `${placeLabel(kind)} · ${name}`, focus: { type: "place", ids: [`${kind}:${name}`], label: name }, icon: placeIcon(kind, null), place: kind, extra: "quest" });
    }
    // Regions and the areas' names.
    const regionNames = new Set();
    for (const list of Object.values(D.regions || {})) for (const [name] of list) regionNames.add(name);
    for (const name of regionNames) add({ label: name, sub: "Region", focus: { type: "region", ids: [name], label: name }, extra: "area" });
    const labelNames = new Map();
    for (const list of Object.values(D.labels || {})) for (const [name, type] of list) if (!regionNames.has(name)) labelNames.set(name, type);
    for (const [name, type] of labelNames) {
      add({ label: name, sub: type === "village" ? "Village" : "Area", focus: { type: "label", ids: [name], label: name }, extra: "region area" });
    }
    for (const e of entries) e.key = fold(`${e.label} ${e.sub} ${e.extra || ""}`);
    return entries;
  }

  /** What matches every word of `query`: [{ label, sub, focus, maps, icon
   *  }], names starting with the query first. */
  function search(query, limit = 30) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length || fold(query).trim().length < 2) return [];
    index ||= buildIndex();
    const q = fold(query).trim();
    const hits = index.filter((e) => words.every((w) => e.key.includes(w)));
    const scored = hits.map((e) => {
      // On which maps, worked out once per entry (the index is built again
      // when the learnt spots change).
      e.maps ||= focusMaps(e.focus);
      e.total ??= Object.values(e.maps).reduce((a, b) => a + b, 0);
      const label = fold(e.label);
      const rank = label === q ? 0 : label.startsWith(q) ? 1 : 2;
      return { ...e, rank };
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
          const mid = isGameMid(key, npc, pts[i], pts[i + 1]) ? ` · ${midText(key, npc)}` : "";
          marks.push({ kind: "petSpawn", x: pts[i], y: pts[i + 1], r: s.r, look: s.look, color: s.color, label: label + mid, z: s.z,
            focus: { type: "npc", ids: [String(npc)], label: npcName(npc) } });
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
        marks.push({ kind: "petLive", x, y, r: s.look === "max" ? 4 : 6, look: s.look, color: s.color, label: `${petName(pet, tracked)} · ${npcName(npc)}${s.text ? ` · ${s.text}` : ""}${d}`, z: s.look === "max" ? 7 : 8,
          focus: { type: "npc", ids: [String(npc)], label: npcName(npc) } });
        consider(pet, x, y, true);
      } else if (layers.monsters) {
        const lv = D.monsterLevels?.[npc] ?? D.npcLevels?.[npc];
        marks.push({ kind: "monster", x, y, r: 2.5, label: `${npcName(npc)}${lv ? ` · Lv ${lv}` : ""}`, z: 4,
          focus: { type: "npc", ids: [String(npc)], label: npcName(npc) } });
      }
    }

    // Where every monster stands as the game has them (the pet monsters the
    // pets layer shows aside), small and grey; and the other NPCs.
    if (layers.monsters) {
      for (const [npc, pts] of Object.entries(monsterPoints(key))) {
        const pet = D.npcPets[npc];
        if (layers.pets && pet != null && wanted(pet)) continue;
        const lv = D.monsterLevels?.[npc] ?? D.npcLevels?.[npc];
        const label = `${npcName(npc)}${lv ? ` · Lv ${lv}` : ""}`;
        const focus = { type: "npc", ids: [String(npc)], label: npcName(npc) };
        for (let i = 0; i < pts.length; i += 2) marks.push({ kind: "monster", x: pts[i], y: pts[i + 1], r: 2, label, z: 1, focus });
      }
    }
    if (layers.npcs) {
      for (const [npc, pts] of Object.entries(npcPoints(key))) {
        const name = npcName(npc);
        const focus = { type: "person", ids: [String(npc)], label: name };
        for (let i = 0; i < pts.length; i += 2) marks.push({ kind: "npc", icon: "npc", x: pts[i], y: pts[i + 1], r: 3.5, label: `${name} (NPC)`, z: 3, focus });
      }
    }

    // Every mark can be clicked: it shows what it is everywhere on the map,
    // and the way to the nearest (its focus).
    const gatherFocus = (env, o) => ({ type: "gather", ids: sameName.get(env) || [env], label: o.name });
    if (layers.gather) {
      for (const [env, pts] of Object.entries(gatherPoints(key))) {
        const o = D.gather.objects[env];
        if (!o || o.kind === "Cube" || gatherKinds[o.kind] === false) continue;
        const focus = gatherFocus(env, o);
        for (let i = 0; i < pts.length; i += 2) {
          marks.push({ kind: "gather", gather: o.kind, icon: o.icon || kindIcon(o.kind), x: pts[i], y: pts[i + 1], r: 3, label: `${o.name} (${kindLabel(o.kind)})`, z: 2, focus });
        }
      }
    }
    for (const [, env, x, y] of world?.objects || []) {
      if (cubes.has(String(env))) {
        if (layers.cubes) marks.push({ kind: "cube", x, y, r: 6, label: "Hidden Cube", z: 9, focus: { type: "cube", ids: ["spots"], label: "Hidden Cube" } });
        continue;
      }
      const o = D.gather.objects[env];
      if (o && layers.gather && gatherKinds[o.kind] !== false) {
        marks.push({ kind: "gather", gather: o.kind, icon: o.icon || kindIcon(o.kind), live: true, x, y, r: 5, label: `${o.name} (${kindLabel(o.kind)}) · there now`, z: 7, focus: gatherFocus(String(env), o) });
      }
    }

    if (layers.kibelisks) {
      for (const [name, x, y, side] of kibelisksOf(key)) {
        marks.push({ kind: "kibelisk", icon: `teleportartifact_${side || sideOf(key)}`, x, y, r: 5, label: `Kibelisk: ${name}`, text: name, z: 5,
          focus: { type: "kibelisk", ids: [name], label: name } });
      }
    }
    if (layers.cubes) {
      const pts = cubeSpotPoints(key);
      for (let i = 0; i < pts.length; i += 2) {
        marks.push({ kind: "cubeSpot", x: pts[i], y: pts[i + 1], r: 3.5, label: "Hidden Cube (known spot)", z: 3, focus: { type: "cube", ids: ["spots"], label: "Hidden Cube" } });
      }
    }
    if (layers.monoliths) {
      const pts = featherPoints(key);
      for (let i = 0; i < pts.length; i += 2) {
        marks.push({ kind: "feather", icon: "feather", x: pts[i], y: pts[i + 1], r: 3, label: "Feather (Monolith piece)", z: 2, focus: { type: "monolith", ids: [], label: "Feathers" } });
      }
    }
    for (const [kind, name, x, y, detail] of placesOf(key)) {
      if (!layers[placeLayer(kind)]) continue;
      marks.push({ kind: "place", place: kind, icon: placeIcon(kind, key), x, y, r: 5,
        label: `${placeText(kind, name)}${detail ? ` · ${detail}` : ""}`, text: name || null, z: 4,
        focus: { type: "place", ids: [name ? `${kind}:${name}` : `${kind}:*`], label: name || placePlural(kind) } });
    }
    if (layers.places) {
      for (const [name, x, y] of D.regions?.[key] || []) {
        marks.push({ kind: "region", x, y, text: name, label: name, z: 0, focus: { type: "region", ids: [name], label: name } });
      }
      for (const [name, , x, y] of D.labels?.[key] || []) {
        marks.push({ kind: "region", x, y, text: name, label: name, z: 0, focus: { type: "label", ids: [name], label: name } });
      }
      for (const [npc, name, x, y] of D.bosses?.[key] || []) {
        marks.push({ kind: "boss", icon: "boss", x, y, r: 5, label: `${name} (field boss)`, text: name, z: 6, focus: { type: "boss", ids: [String(npc)], label: name } });
      }
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
      const placeOf = new Map(placesOf(key).map(([kind, name, x, y, detail]) => [`${x},${y}`, [kind, name, detail]]));
      const g0 = D.gather.objects[focus.ids?.[0]];
      const STYLES = {
        gather: (x, y) => ({ kind: "gather", gather: g0?.kind, icon: g0?.icon || kindIcon(g0?.kind), x, y, r: 4 }),
        kibelisk: (x, y) => ({ kind: "kibelisk", icon: `teleportartifact_${sideOf(key)}`, x, y, r: 6, text: focus.label }),
        cube: (x, y) => ({ kind: "cubeSpot", all, x, y, r: all ? 2.5 : 4.5 }),
        monolith: (x, y) => ({ kind: "feather", icon: "feather", x, y, r: 3.5 }),
        place: (x, y) => {
          const [kind, name, detail] = placeOf.get(`${x},${y}`) || [];
          return { kind: "place", place: kind, icon: kind && placeIcon(kind, key), x, y, r: 5.5, text: name || null,
            label: `${kind ? placeText(kind, name) : focus.label}${detail ? ` · ${detail}` : ""}` };
        },
        region: (x, y) => ({ kind: "place", place: "village", icon: "village", x, y, r: 5, text: focus.label }),
        label: (x, y) => ({ kind: "place", place: "village", icon: "village", x, y, r: 5, text: focus.label }),
        boss: (x, y) => ({ kind: "boss", icon: "boss", x, y, r: 6, text: focus.label }),
        person: (x, y) => ({ kind: "npc", icon: "npc", x, y, r: 4.5 }),
        npc: (x, y) => (focusPets ? { kind: "petSpawn", x, y, r: 4.5, look: "need" } : { kind: "monster", x, y, r: 3.5 }),
      };
      const focusPets = focus.type !== "npc" || (focus.ids || []).some((n) => D.npcPets[n] != null);
      const style = STYLES[focus.type] || ((x, y) => ({ kind: "petSpawn", x, y, r: 4.5, look: "need" }));
      // Where the game puts what the map knows only in part: its subzones'
      // outlines, beneath everything.
      const area = focusArea(focus, key);
      if (area && area.known < area.game && area.rings.length) {
        marks.push({ kind: "area", rings: area.rings, labels: area.labels, x: area.labels[0][1], y: area.labels[0][2], z: -10 });
      }
      const mids = focus.type === "pet" || focus.type === "npc" ? gameMids(key) : {};
      const midOf = new Map(Object.entries(mids).map(([npc, [x, y]]) => [`${x},${y}`, npc]));
      for (const [x, y] of focusPoints(focus, key)) {
        hits.push(x, y);
        const midNpc = midOf.get(`${x},${y}`);
        const label = midNpc ? `${focus.label} · ${midText(key, midNpc)}` : focus.label;
        // Every place a cube may appear: many, so no gold ring each.
        marks.push({ label, ...style(x, y), hit: !all, z: 50, focus });
        near(x, y, false);
      }
      for (const [, npc, x, y] of world?.npcs || []) {
        if (!focusLive(focus, "npc", npc)) continue;
        marks.push({ kind: "petLive", x, y, r: 6, look: "need", hit: true, label: `${focus.label} · there now`, z: 60, focus });
        near(x, y, true);
      }
      for (const [, env, x, y] of world?.objects || []) {
        if (!focusLive(focus, "object", env)) continue;
        const o = D.gather.objects[env];
        marks.push(focus.type === "cube"
          ? { kind: "cube", x, y, r: 6, hit: true, label: "Hidden Cube · there now", z: 60, focus }
          : { kind: "gather", gather: o?.kind, icon: o?.icon || kindIcon(o?.kind), live: true, x, y, r: 5, hit: true, label: `${focus.label} · there now`, z: 60, focus });
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

  // ---------- the map picker's groups ----------
  // The world maps in the game now (Global: Verteron, Altgard and the
  // Abyss's lower layer, where pets' souls drop), those to come (in the
  // client, not open yet: no pet's souls drop there), the starting areas,
  // and the instances. A map to come that the meter has seen you on
  // (`played`) is in the game.
  const STARTERS = new Set(["poeta", "ishalgen"]);
  const LATER = new Set(["eltnen", "morheim", "abyss_middle", "abyss_upper"]);
  // The Elyos side, the Asmodian side, then the Abyss's layers.
  const WORLD_ORDER = ["verteron", "eltnen", "altgard", "morheim", "abyss", "abyss_middle", "abyss_upper", "poeta", "ishalgen"];
  /** { inGame, later, instances, starters }: map keys, in order. */
  function mapGroups(played = []) {
    const seen = new Set(played);
    const rank = (k) => (WORLD_ORDER.includes(k) ? WORLD_ORDER.indexOf(k) : WORLD_ORDER.length);
    const world = Object.keys(D.maps).filter((k) => !D.maps[k].instance).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return {
      inGame: world.filter((k) => !STARTERS.has(k) && (!LATER.has(k) || seen.has(k))),
      later: world.filter((k) => LATER.has(k) && !seen.has(k)),
      instances: Object.keys(D.maps).filter((k) => D.maps[k].instance).sort((a, b) => D.maps[a].title.localeCompare(D.maps[b].title)),
      starters: world.filter((k) => STARTERS.has(k)),
    };
  }
  const isLater = (k) => LATER.has(k);

  /** The compass arrow for a bearing (0 = up). */
  const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const arrow = (deg) => ARROWS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  globalThis.MapMarks = Object.freeze({
    build, mergeTracked, neededOf, soulsOf, nearestKinds, nearestByPet, GENUS, genusOf, mapOf, regionAt, arrow, markText, petName, setLearned, learnFrom, routeTo, gatherFor, TELEPORT_M, steady, search, focusMaps, focusMapsByPoints, focusPoints, focusArea, focusFit, KIND_ORDER, kindLabel, kindTitle, kindIcon, gatherCounts, mapGroups, isLater, placeLabel, placeLayer, placeIcon, sideOf,
  });
})();
