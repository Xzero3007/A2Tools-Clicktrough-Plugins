// The Inventory plugin's arithmetic, without the page: items by id, what is
// where per character, what each is worth on the market, the drops of a
// session, and the limits (Kinah today, Abyss Points, the content tickets).
// Node loads it for the tests (dev/tests).
(() => {
  const D = globalThis.INVENTORY_DATA || { items: {}, tickets: {} };
  const KINA = 930100031;
  const ABYSS_POINTS = 930100003;
  const KINA_DAILY = 1_000_000;
  const GRADES = ["", "Common", "Rare", "Legend", "Unique", "Epic", "Mythic", "Special"];
  // The game's containers, as the meter names them (events:items).
  const INVENTORY = "1", CHARACTER = "15", ACCOUNT = "2";

  const row = (id) => D.items[String(id)] || null;
  const name = (id) => row(id)?.[0] || `Item ${id}`;
  const grade = (id) => row(id)?.[1] || 0;
  const icon = (id) => (row(id)?.[2] ? `Icon_${row(id)[2]}` : null);
  const bound = (id) => /\(Bound\)/.test(name(id));
  // Currencies (Kinah, Abyss Points, coins, medals) are items too, in the
  // inventory; they are never sold on the market.
  const currency = (id) => /^93[0-9]{7}$/.test(String(id));

  /** A container's slots ([[slot, item, count]]) as { item: count }. */
  function totals(slots) {
    const out = {};
    for (const s of Array.isArray(slots) ? slots : []) {
      const [, item, count] = s;
      if (!Number.isFinite(item) || !Number.isFinite(count) || count <= 0) continue;
      out[item] = (out[item] || 0) + count;
    }
    return out;
  }

  /** What a character holds after an items event (`it`): the stored copy
   *  (`kept`, { inv, char, acc, exactAt }) updated. A world entry seen by the
   *  meter makes its lists the truth; without one, the changes with a known
   *  count are added to the stored copy (the meter started after the login). */
  function apply(kept, it) {
    const out = { inv: { ...(kept?.inv || {}) }, char: { ...(kept?.char || {}) }, acc: { ...(kept?.acc || {}) }, exactAt: kept?.exactAt || null };
    if (!it) return out;
    const c = it.containers || {};
    if (it.snapshotAt) {
      out.inv = totals(c[INVENTORY]);
      out.char = totals(c[CHARACTER]);
      out.acc = totals(c[ACCOUNT]);
      out.exactAt = it.snapshotAt;
      return out;
    }
    const key = { [INVENTORY]: "inv", [CHARACTER]: "char", [ACCOUNT]: "acc" };
    for (const ch of Array.isArray(it.changes) ? it.changes : []) {
      const [, , container, item, delta] = ch;
      const k = key[String(container)];
      if (!k) continue;
      if (Number.isFinite(delta)) {
        const now = (out[k][item] || 0) + delta;
        if (now > 0) out[k][item] = now;
        else delete out[k][item];
      } else {
        // Not known how many there were before: at least what the meter sees now.
        const seen = totals(c[String(container)])[item] || 0;
        if (seen > (out[k][item] || 0)) out[k][item] = seen;
      }
    }
    return out;
  }

  /** aion2.exchange's servers (the fork's copy or its API) -> [{ id, game, name, region, faction }]. */
  function readServers(res) {
    const list = Array.isArray(res?.servers) ? res.servers : Array.isArray(res) ? res : [];
    const out = [];
    for (const s of list) {
      const id = Number(s?.server_id ?? s?.id);
      if (!s || !Number.isFinite(id) || id <= 0) continue;
      const game = Number(s.game_server_key ?? s.game);
      out.push({ id, game: Number.isFinite(game) ? game : id % 10000, name: String(s.name || `Server ${id}`), region: String(s.region_name || s.region || "Other"), faction: s.faction || null });
    }
    return out;
  }
  /** The player's server among them: the game's number is aion2.exchange's game_server_key, its id 10000 more. */
  const serverOf = (servers, gameServerId) => {
    const sid = Number(gameServerId);
    if (!Number.isFinite(sid) || sid <= 0) return null;
    return servers.find((s) => s.game === sid) || servers.find((s) => s.id - 10000 === sid) || null;
  };
  /** The fork's price copy ({ items: { id: [price, listings, sold, soldAvg, change, last] } }) -> Map. */
  function readCopy(doc) {
    if (!doc || typeof doc !== "object" || !doc.items || typeof doc.items !== "object") return null;
    const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const prices = new Map();
    for (const [id, r] of Object.entries(doc.items)) {
      if (!Array.isArray(r)) continue;
      const price = n(r[0]) > 0 ? n(r[0]) : null;
      prices.set(String(id), { price, listings: price == null ? 0 : n(r[1]) ?? 0, sold: n(r[2]), soldAvg: n(r[3]), last: n(r[5]) });
    }
    return prices.size ? { prices, snapshot: doc.snapshot || null, copied: doc.copied || null } : null;
  }
  /** aion2.exchange's own item rows (as the Market plugin reads them) -> the same Map. */
  function readRows(rows) {
    const prices = new Map();
    const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = r?.item_key ?? r?.id ?? r?.item_id;
      if (id == null) continue;
      const listed = r.listed !== false && num(r.price) > 0;
      prices.set(String(id), { price: listed ? num(r.price) : null, listings: listed ? num(r.listings) ?? 0 : 0, sold: num(r.units_sold), soldAvg: num(r.sold_avg_price), last: num(r.last_price) });
    }
    return prices;
  }

  /** What one item is worth: sellable (traded on the market and not bound),
   *  the unit price (the lowest listing, else the average sale, else the last
   *  seen), the total, and the total after the market's fee (in %). */
  function worth(item, count, prices, fee = 10) {
    const p = prices?.get(String(item)) || null;
    const sellable = !!p && !bound(item) && !currency(item);
    const unit = sellable ? p.price ?? p.soldAvg ?? p.last ?? null : null;
    const total = unit == null ? null : unit * count;
    return { sellable, unit, total, net: total == null ? null : Math.floor(total * (1 - fee / 100)), listings: p?.listings ?? 0, sold: p?.sold ?? null };
  }

  /** A list's rows, each with its worth; sorted ("value", "name", "count",
   *  "grade"), filtered by a search text and sellable only. */
  function list(counts, prices, { fee = 10, sort = "value", search = "", sellableOnly = false } = {}) {
    const q = String(search || "").trim().toLowerCase();
    const rows = [];
    for (const [id, count] of Object.entries(counts || {})) {
      const item = Number(id);
      if (q && !name(item).toLowerCase().includes(q)) continue;
      const w = worth(item, count, prices, fee);
      if (sellableOnly && !w.sellable) continue;
      rows.push({ item, count, name: name(item), grade: grade(item), currency: currency(item), bound: bound(item), ...w });
    }
    const by = {
      value: (a, b) => (b.total ?? -1) - (a.total ?? -1) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      count: (a, b) => b.count - a.count || a.name.localeCompare(b.name),
      grade: (a, b) => b.grade - a.grade || a.name.localeCompare(b.name),
    }[sort] || ((a, b) => 0);
    rows.sort((a, b) => (a.currency - b.currency) || by(a, b));
    const sum = rows.reduce((s, r) => ({ total: s.total + (r.total || 0), net: s.net + (r.net || 0), sellable: s.sellable + (r.sellable ? 1 : 0) }), { total: 0, net: 0, sellable: 0 });
    return { rows, sum };
  }

  /** A session's drops after an items event: the items that came into the
   *  inventory (more of an item than before; never a currency), Kinah and
   *  Abyss Points gained, and which came from the ground (a pickup of the same
   *  item within 1.5 s, either way round). Returns a new session. */
  const WINDOW = 1500;
  function addDrops(session, it) {
    const s = {
      ...session,
      items: { ...(session.items || {}) },
      loot: { ...(session.loot || {}) },
      recent: [...(session.recent || [])],
      pickups: [...(session.pickups || [])],
      kinah: session.kinah || 0,
      abyss: session.abyss || 0,
    };
    const since = s.start || 0;
    const mark = (g) => {
      if (g.loot) return;
      const p = s.pickups.find((x) => x.item === g.item && !x.used && Math.abs(x.at - g.at) <= WINDOW);
      if (p) {
        p.used = true;
        g.loot = true;
        s.loot[g.item] = (s.loot[g.item] || 0) + g.delta;
      }
    };
    for (const p of Array.isArray(it?.pickups) ? it.pickups : []) {
      const [, at, item, count] = p;
      if (at < since) continue;
      s.pickups.push({ at, item, count, used: false });
    }
    for (const ch of Array.isArray(it?.changes) ? it.changes : []) {
      const [, at, container, item, delta] = ch;
      if (String(container) !== INVENTORY || !Number.isFinite(delta) || delta <= 0 || at < since) continue;
      if (item === KINA) s.kinah += delta;
      else if (item === ABYSS_POINTS) s.abyss += delta;
      else if (!currency(item)) {
        s.items[item] = (s.items[item] || 0) + delta;
        s.recent.push({ at, item, delta, loot: false });
      }
    }
    // Late either way: match what is still open.
    for (const g of s.recent) mark(g);
    const now = Math.max(0, ...s.recent.map((g) => g.at), ...s.pickups.map((p) => p.at));
    s.recent = s.recent.filter((g) => now - g.at <= 10_000 || !g.loot).slice(-200);
    s.pickups = s.pickups.filter((p) => now - p.at <= 10_000).slice(-200);
    return s;
  }

  /** The content tickets as rows for the limits: [{ id, name, short, left,
   *  extra, max, time, reset }], from the character's counts and times. */
  function tickets(character) {
    const counts = character?.contentCounts || {};
    const times = character?.contentTimes || {};
    const out = [];
    for (const [id, t] of Object.entries(D.tickets || {})) {
      const [full, short, max, subMax, perServer, isTime, reset] = t;
      if (id === "60000001") continue; // Odyle Energy: Roster and the meter show it
      if (isTime) {
        const v = times[id];
        if (!Array.isArray(v)) continue;
        out.push({ id, name: full, short, time: true, left: Number(v[0]) || 0, seenAt: Number(v[1]) || null, reset });
      } else {
        const v = counts[id];
        if (!Array.isArray(v)) continue;
        out.push({ id, name: full, short, time: false, left: Number(v[0]) || 0, extra: Number(v[1]) || 0, max, subMax, perServer, reset });
      }
    }
    return out;
  }

  /** The limits the floater shows: Kinah today (live), the week's Abyss
   *  Points (live with the meter's patch 0034) and the server's gathering. */
  function limits(character) {
    const out = [];
    const k = character?.kinahToday;
    if (Number.isFinite(k)) out.push({ key: "kinah", label: "Kina today", value: k, max: KINA_DAILY });
    const ap = character?.abyssPoints;
    if (Array.isArray(ap) && Number.isFinite(ap[0])) out.push({ key: "abyss", label: "Abyss Points", value: ap[0], max: ap[1] || null });
    const g = character?.gathering;
    if (Array.isArray(g) && Number.isFinite(g[0])) out.push({ key: "gathering", label: "Gathering", value: g[0], max: g[1] || null });
    return out;
  }

  const kina = (n) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US"));
  const short = (n) => {
    if (n == null || !Number.isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
    return kina(n);
  };
  /** A storage key for a character (keys allow [A-Za-z0-9_-] only). */
  function charKey(serverId, name) {
    let h = 2166136261;
    for (const ch of String(name || "")) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
    return `c-${Number(serverId) || 0}-${h.toString(36)}`;
  }

  globalThis.InventoryCalc = Object.freeze({
    KINA, ABYSS_POINTS, KINA_DAILY, GRADES, INVENTORY, CHARACTER, ACCOUNT,
    name, grade, icon, bound, currency, totals, apply, readServers, serverOf, readCopy, readRows, worth, list,
    addDrops, tickets, limits, kina, short, charKey,
  });
})();
