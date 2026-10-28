// Pet Finder's logic, without any page: what the decoders' numbers mean, the
// collection, the pets near you and the search. Loaded by the page and by the
// tests (node). The checks follow PetTracker's (GPLv3) GameProtocol.cs and
// CollectionWire.cs, so a frame of the same type that is something else is
// dropped rather than read as pets.
(() => {
  /** Souls each rank's counter needs before the next (PetTracker PetStages.cs). */
  const GOALS = { 0: 5, 1: 25, 2: 75 };
  const TO_MAX = { 0: 105, 1: 100, 2: 75, 3: 0 };

  function index(data) {
    const pets = new Map(data.pets.map((p) => [p.id, p]));
    const npcs = new Map(Object.entries(data.npcs).map(([npc, pet]) => [Number(npc), pet]));
    const npcNames = new Map(Object.entries(data.npcNames || {}).map(([npc, name]) => [Number(npc), name]));
    const catalog = new Set(data.catalog);
    const market = new Map(Object.entries(data.market || {}).map(([item, pet]) => [Number(item), pet]));
    return { pets, npcs, npcNames, catalog, market, list: data.pets };
  }

  // ---------- collection frames ----------

  /** 00 90 at login: { equipped, ranks: {pet: rank}, souls: {pet: counter} }, or null. */
  function collectionFrom(d, catalog) {
    if (!d || !Array.isArray(d.ranks) || !Array.isArray(d.souls)) return null;
    if (d.equipped !== 0 && !catalog.has(d.equipped)) return null;
    const ranks = {};
    for (const r of d.ranks) {
      if (!catalog.has(r.pet) || r.dup !== r.pet || !(r.rank >= 1 && r.rank <= 3) || r.pet in ranks) return null;
      ranks[r.pet] = r.rank;
    }
    if (d.equipped !== 0 && !(d.equipped in ranks)) return null;
    const souls = {};
    for (const s of d.souls) {
      const rank = ranks[s.pet] || 0;
      const cap = rank === 1 || rank === 2 ? GOALS[rank] : Infinity;
      if (!catalog.has(s.pet) || !(s.souls >= 0) || s.souls > cap || s.pet in souls) return null;
      souls[s.pet] = s.souls;
    }
    return { equipped: d.equipped, ranks, souls };
  }

  /** 0D 90 / 0E 90: [{pet, amount}], or null. */
  function batchFrom(d, catalog) {
    if (!d || !Array.isArray(d.items) || d.items.length === 0) return null;
    const seen = new Set();
    for (const i of d.items) {
      if (!catalog.has(i.pet) || seen.has(i.pet) || !(i.amount >= 1 && i.amount <= 75)) return null;
      seen.add(i.pet);
    }
    return d.items.map((i) => ({ pet: i.pet, amount: i.amount }));
  }

  /** 14 90: {pet, rank}, or null. */
  function rankFrom(d, catalog) {
    if (!d || d.status !== 0 || !catalog.has(d.pet) || !(d.rank >= 1 && d.rank <= 3)) return null;
    return { pet: d.pet, rank: d.rank };
  }

  /** The collection of one character, kept between sessions. */
  class Collection {
    constructor(saved) {
      this.ranks = { ...(saved?.ranks || {}) };
      this.souls = { ...(saved?.souls || {}) };
      this.syncedAt = saved?.syncedAt || 0;
      // Changes since the last sync, so the page can say the numbers are live.
      this.changedAt = saved?.changedAt || 0;
    }
    get synced() {
      return this.syncedAt > 0;
    }
    snapshot(c, at) {
      this.ranks = { ...c.ranks };
      this.souls = { ...c.souls };
      this.syncedAt = at;
      this.changedAt = at;
    }
    gain(pet, amount, at) {
      this.souls[pet] = (this.souls[pet] || 0) + amount;
      this.changedAt = at;
    }
    spend(pet, amount, at) {
      this.souls[pet] = Math.max(0, (this.souls[pet] || 0) - amount);
      this.changedAt = at;
    }
    rank(pet, rank, at) {
      this.ranks[pet] = rank;
      this.changedAt = at;
    }
    /** {rank, souls, goal (null at max), toMax} of a pet; rank null when not synced. */
    progress(pet) {
      if (!this.synced) return { rank: null, souls: null, goal: null, toMax: null };
      const rank = this.ranks[pet] || 0;
      const souls = this.souls[pet] || 0;
      const goal = GOALS[rank] ?? null;
      return { rank, souls, goal, toMax: Math.max(0, TO_MAX[rank] - souls) };
    }
    toJSON() {
      return { ranks: this.ranks, souls: this.souls, syncedAt: this.syncedAt, changedAt: this.changedAt };
    }
  }

  // ---------- NPC frames ----------

  /** An NPC appearance's {entity, npc}, or null (a summon, another layout). */
  function spawnFrom(d) {
    if (!d || !(d.entity > 0)) return null;
    if ((d.kind & 0x1f) === 0x1f) return null; // a summon
    if (!(d.npc >= 1000000 && d.npc <= 10000000) || d.marker !== 2) return null;
    return { entity: d.entity, npc: d.npc };
  }

  /**
   * Turns the decoders' events, in the order the meter sends them, into
   * spawns and removals. A frame's decoders run in manifest order, so one
   * appearance arrives as npc-spawn-XXa (when long enough) then -XXb; a
   * removal as npc-removed, then npc-removed-more only when the frame was
   * longer than a removal (then it was none). Call `flush` a moment after
   * the last event, or a removal waits for the next one.
   */
  class Frames {
    constructor({ spawn, remove }) {
      this.onSpawn = spawn;
      this.onRemove = remove;
      this.lastA = null; // the a-variant just read: {op, entity, valid}
      this.pending = null; // a removal that may still turn out longer
    }
    push(name, d) {
      if (this.pending && !(name === "npc-removed-more" && d?.entity === this.pending.entity)) this.flush();
      const spawnMatch = /^npc-spawn-(\d\d)([ab])$/.exec(name);
      if (spawnMatch) {
        const [, op, variant] = spawnMatch;
        const s = spawnFrom(d);
        if (variant === "a") {
          this.lastA = { op, entity: d?.entity, valid: !!s };
          if (s) this.onSpawn(s);
          return;
        }
        // b: the same frame as an a just read, which wins when it was valid.
        const sameFrame = this.lastA && this.lastA.op === op && this.lastA.entity === d?.entity;
        const aWon = sameFrame && this.lastA.valid;
        this.lastA = null;
        if (s && !aWon) this.onSpawn(s);
        return;
      }
      this.lastA = null;
      if (name === "npc-removed") {
        if (d && d.entity > 0 && d.zero === 0) this.pending = { entity: d.entity, reason: d.reason };
        return;
      }
      if (name === "npc-removed-more") {
        if (this.pending && this.pending.entity === d?.entity) this.pending = null;
      }
    }
    flush() {
      const p = this.pending;
      this.pending = null;
      if (p) this.onRemove(p);
    }
  }

  /** The pet mobs the game has shown you and not taken away again. */
  class Nearby {
    constructor(ix, capacity = 2048) {
      this.ix = ix;
      this.capacity = capacity;
      this.entities = new Map(); // entity -> {pet, npc, seen}
    }
    spawn(entity, npc, now) {
      const pet = this.ix.npcs.get(npc);
      if (pet === undefined || !this.ix.pets.has(pet)) {
        this.entities.delete(entity); // the id now names something else
        return null;
      }
      if (!this.entities.has(entity) && this.entities.size >= this.capacity) {
        let oldest = null;
        for (const [id, e] of this.entities) if (!oldest || e.seen < oldest[1].seen) oldest = [id, e];
        this.entities.delete(oldest[0]);
      }
      const isNew = !this.entities.has(entity);
      this.entities.set(entity, { pet, npc, seen: now });
      return isNew ? pet : null;
    }
    remove(entity) {
      return this.entities.delete(entity);
    }
    clear() {
      this.entities.clear();
    }
    /** Drop what was seen longer ago than `maxAgeMs` (0: keep all). */
    prune(now, maxAgeMs) {
      if (!maxAgeMs) return;
      for (const [id, e] of this.entities) if (now - e.seen > maxAgeMs) this.entities.delete(id);
    }
    /** Grouped by pet, newest first: [{pet, mobs: [{name, count}], count, seen}]. */
    view() {
      const groups = new Map();
      for (const e of this.entities.values()) {
        let g = groups.get(e.pet);
        if (!g) groups.set(e.pet, (g = { pet: e.pet, mobs: new Map(), count: 0, seen: 0 }));
        const name = this.ix.npcNames.get(e.npc) || `NPC #${e.npc}`;
        g.mobs.set(name, (g.mobs.get(name) || 0) + 1);
        g.count++;
        g.seen = Math.max(g.seen, e.seen);
      }
      return [...groups.values()]
        .map((g) => ({ ...g, mobs: [...g.mobs].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => b.seen - a.seen);
    }
  }

  // ---------- search ----------

  const fold = (s) => String(s).toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

  /**
   * Pets matching every word of `query` in their name, a mob, a region or a
   * source (PetFinder.Search). Hidden unless the game has them somewhere
   * known to you (a map, a source) or you have progress on them.
   */
  function search(ix, query, collection, { family = "", hideMaxed = false, pinned = new Set() } = {}) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const out = [];
    for (const p of ix.list) {
      const prog = collection ? collection.progress(p.id) : { rank: null };
      const known = p.maps.length > 0 || !!p.acq || (prog.rank !== null && (prog.rank > 0 || prog.souls > 0));
      if (!known && !pinned.has(p.id)) continue;
      if (family && p.family !== family) continue;
      if (hideMaxed && prog.rank === 3) continue;
      if (words.length) {
        const hay = [p.name, ...p.mobs, ...p.regions, ...p.maps.map((m) => m.region), ...(p.acq ? [p.acq.kind, ...p.acq.aliases] : [])].map(fold);
        if (!words.every((w) => hay.some((h) => h.includes(w)))) continue;
      }
      out.push(p);
    }
    // Pinned first, then by name (the data comes sorted by name).
    return out.sort((a, b) => (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0));
  }

  /**
   * Totals over the pets of the Global game: those with a Global map or a
   * known source (PetTracker's discovery set, 208 in October 2026), and any
   * other you have progress on. The catalog also holds pets of the Asian
   * release, which counted 105 souls each though no one can get them here.
   */
  function totals(ix, collection) {
    let toMax = 0, notMax = 0, all = 0;
    for (const p of ix.list) {
      const prog = collection.progress(p.id);
      if (prog.rank === null) return null;
      if (!(p.maps.length || p.acq || prog.rank > 0 || prog.souls > 0)) continue;
      all++;
      if (prog.rank < 3) notMax++;
      toMax += prog.toMax;
    }
    return { notMax, toMax, all };
  }

  // ---------- Black Cloud Merchant ----------

  /** Discount codes in an offer (BlackMarket.Decode): code -> percent paid. */
  const DISCOUNT = { 0: 90, 1: 80, 2: 70, 3: 50 };
  const KINA = 0x5d;
  // The shop's tabs: 101/104 on the US servers (PetTracker's captures),
  // 201/204 on Europe (2026-10-20). The region is the hundreds.
  const TAB_NAMES = { 1: "Special", 4: "Pets" };
  const tabName = (tab) => (tab >= 100 ? TAB_NAMES[tab % 100] : undefined);

  /**
   * Puts a stock frame's three parts back together: market-a, -b, -c arrive
   * in that order for one frame; market-more only when the frame was longer
   * than a stock response (then it is none). Call `flush` a moment after.
   */
  class MarketFrames {
    constructor(onStock) {
      this.onStock = onStock;
      this.parts = null;
    }
    push(name, d, at) {
      if (name === "market-a") {
        this.flush();
        this.parts = { a: d, b: null, c: null, at };
      } else if (name === "market-b" && this.parts && !this.parts.b) this.parts.b = d;
      else if (name === "market-c" && this.parts?.b && !this.parts.c) this.parts.c = d;
      else if (name === "market-more") this.parts = null;
    }
    flush() {
      const p = this.parts;
      this.parts = null;
      if (p?.a && p.b && p.c) this.onStock(p);
    }
  }

  /**
   * A merchant tab's stock from the three parts, checked as PetTracker
   * checks it: anything off fails the whole response rather than guessing.
   * {tab, tabName, seen, refresh, offers: [{offer, item, pet, price, original, discount}]}
   */
  function stockFrom({ a, b, c }, now, ix) {
    if (!tabName(a.tab) || a.count !== 10 || a.m36 !== 0x55 || b.m173 !== 0x55 || c.m310 !== 5 || c.tail !== 0) return null;
    if (!(c.refresh > now && c.refresh <= now + 2 * 3600 * 1000)) return null;
    const parts = [a, a, a, a, b, b, b, b, c, c];
    const ids = new Set();
    const offers = [];
    for (let n = 0; n < 10; n++) {
      const e = (k) => parts[n][`e${n}_${k}`];
      const paid = DISCOUNT[e("disc")];
      const original = e("orig"), price = e("price");
      if (!(e("offer") > 0) || !(e("item") > 0) || ids.has(e("offer")) || e("qty") !== 1 || e("cur") !== KINA || !paid) return null;
      if (!(original > 0 && original <= 1e9) || !(price > 0) || price !== Math.floor((original * paid) / 100)) return null;
      ids.add(e("offer"));
      const pet = ix.market.get(e("item"));
      if (pet !== undefined) offers.push({ offer: e("offer"), item: e("item"), pet, price, original, discount: 100 - paid });
    }
    return { tab: a.tab, tabName: tabName(a.tab), seen: now, refresh: c.refresh, offers };
  }

  /** Stock is what the shop showed a moment ago, not an inventory (MarketStock.Fresh). */
  function freshStock(stock, now) {
    return now >= stock.seen && now - stock.seen < 2 * 60 * 1000 && now < stock.refresh;
  }

  /**
   * Offers worth buying: a pet only the merchants and chests give, not yet at
   * rank 3, against a collection read this session. The cheapest per pet.
   */
  function recommendations(stocks, collection, now, ix, { farmable = false } = {}) {
    if (!collection.synced) return [];
    const best = new Map();
    for (const stock of stocks) {
      if (!freshStock(stock, now)) continue;
      for (const o of stock.offers) {
        const pet = ix.pets.get(o.pet);
        // PetTracker's list: pets only chests and merchants give. With
        // `farmable`: the others you still need, which mobs also drop.
        if (!pet || !!pet.watch === farmable) continue;
        const rank = collection.progress(o.pet).rank;
        if (rank === null || rank >= 3) continue;
        const prior = best.get(o.pet);
        if (!prior || o.price < prior.price || (o.price === prior.price && stock.tab < prior.stock.tab)) best.set(o.pet, { ...o, stock });
      }
    }
    return [...best.values()].sort((x, y) => ix.pets.get(x.pet).name.localeCompare(ix.pets.get(y.pet).name));
  }

  /** Pets to look out for at the merchants: only they and chests give them. */
  function watchlist(ix, collection) {
    return ix.list.filter((p) => p.watch && collection.progress(p.id).rank !== 3);
  }

  /** A storage key for a character (letters, digits, '-' and '_' only). */
  function characterKey(c) {
    if (!c || !c.name) return "c_unknown";
    let h = 0x811c9dc5;
    for (const ch of new TextEncoder().encode(String(c.name))) h = Math.imul(h ^ ch, 0x01000193) >>> 0;
    return `c_${Number(c.serverId) || 0}_${h.toString(16)}`;
  }

  const api = { GOALS, index, collectionFrom, batchFrom, rankFrom, Collection, spawnFrom, Frames, Nearby, search, totals,
    MarketFrames, stockFrom, freshStock, recommendations, watchlist, characterKey };
  globalThis.PetLogic = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
