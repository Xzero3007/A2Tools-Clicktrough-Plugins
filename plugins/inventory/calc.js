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
      prices.set(String(id), { price, listings: price == null ? 0 : n(r[1]) ?? 0, sold: n(r[2]), soldAvg: n(r[3]), change: n(r[4]), last: n(r[5]) });
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
      prices.set(String(id), { price: listed ? num(r.price) : null, listings: listed ? num(r.listings) ?? 0 : 0, sold: num(r.units_sold), soldAvg: num(r.sold_avg_price), change: num(r.change_pct), last: num(r.last_price) });
    }
    return prices;
  }

  /** What one item is worth: sellable (traded on the market and not bound),
   *  the unit price (the lowest listing, else the average sale, else the last
   *  seen), the total, and the total after the market's fee (in %). A lowest
   *  listing far above the item's usual price (anomaly.js, with the copy's
   *  price history `hist`) counts at the usual price: `odd` then holds the
   *  judgement, and the listing is `listed`. */
  function worth(item, count, prices, fee = 10, hist = null) {
    const p = prices?.get(String(item)) || null;
    const sellable = !!p && !bound(item) && !currency(item);
    let unit = sellable ? p.price ?? p.soldAvg ?? p.last ?? null : null;
    const A = globalThis.MarketAnomaly;
    const j = sellable && A ? A.judge(p, A.usual(hist, item)) : null;
    const odd = j?.kind === "high" ? j : null;
    if (odd) unit = odd.ref;
    const total = unit == null ? null : unit * count;
    return { sellable, unit, total, net: total == null ? null : Math.floor(total * (1 - fee / 100)), listings: p?.listings ?? 0, sold: p?.sold ?? null,
      odd, listed: p?.price ?? null };
  }

  /** A list's rows, each with its worth; sorted ("value", "name", "count",
   *  "grade"), filtered by a search text and sellable only. */
  function list(counts, prices, { fee = 10, sort = "value", search = "", sellableOnly = false, hist = null } = {}) {
    const q = String(search || "").trim().toLowerCase();
    const rows = [];
    for (const [id, count] of Object.entries(counts || {})) {
      const item = Number(id);
      if (q && !name(item).toLowerCase().includes(q)) continue;
      const w = worth(item, count, prices, fee, hist);
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

  // ---------- the drops of a session ----------
  // What came into the inventory, by where it came from: Gathered (the game's
  // gathering result for the same item), Loot (picked up from the ground),
  // Rewards (a chest, a key or several items at once), and the rest (bought,
  // crafted, mail ...). Common gear the game breaks down at once for Enhance
  // Stones is taken out again and counted as Dismantled.
  const WINDOW = 1500;
  const ENHANCE_STONE = 930100023;
  const KINA_BOUND = 930100001;
  const SOURCES = ["gathered", "loot", "reward"];
  const opener = (id) => /^Key:|\b(Chest|Box|Pouch|Bundle|Crate|Coffer|Casket)\b/i.test(name(id));

  function newSession(now) {
    return {
      v: 2, start: now, last: null, active: 0,
      items: {}, loot: {}, gathered: {}, reward: {}, kinah: 0, abyss: 0,
      dismantled: { pieces: 0, stones: 0, kinahBound: 0 },
      gather: { n: 0, great: 0, amount: 0, bonus: 0, spots: 0, byItem: {}, byArea: {} },
      recent: [], pickups: [], gathers: [], opened: [], nodes: [],
    };
  }
  /** A stored session of any version as this one's shape. */
  function normalize(s) {
    const base = newSession(Number(s?.start) || Date.now());
    if (!s || typeof s !== "object") return base;
    const out = { ...base, ...s };
    for (const k of ["items", "loot", "gathered", "reward"]) out[k] = { ...(s[k] || {}) };
    out.dismantled = { ...base.dismantled, ...(s.dismantled || {}) };
    out.gather = { ...base.gather, ...(s.gather || {}), byItem: { ...(s.gather?.byItem || {}) }, byArea: { ...(s.gather?.byArea || {}) } };
    for (const k of ["recent", "pickups", "gathers", "opened", "nodes"]) out[k] = Array.isArray(s[k]) ? s[k].map((x) => (x && typeof x === "object" ? { ...x } : x)) : [];
    // Version 1 kept { at, item, delta, loot }.
    out.recent = out.recent.filter((g) => g && Number.isFinite(g.delta)).map((g) => ({ ...g, left: g.left ?? g.delta, src: g.src ?? (g.loot ? "loot" : null) }));
    out.v = 2;
    return out;
  }
  const isEmpty = (s) => !Object.keys(s.items || {}).length && !s.kinah && !s.abyss && !(s.gather?.n) && !(s.dismantled?.pieces);
  /** Whether an event at `at` starts a new session: a break of more than
   *  `breakMs` since the session's last doing (0: never). An empty session
   *  just starts again then (see `restart`). */
  function isBreak(s, at, breakMs) {
    if (!breakMs || !Number.isFinite(at)) return false;
    const last = s.last ?? s.start;
    return at - last > breakMs;
  }
  /** What a finished session keeps for the list of earlier ones. */
  function summary(s) {
    const { recent, pickups, gathers, opened, nodes, ...kept } = s;
    return { ...kept, end: s.last ?? s.start };
  }
  // A doing at `at`: the time played grows by the step since the last one
  // when it was short (a pause of 5 minutes or more is no play).
  const ACTIVE_STEP = 5 * 60_000;
  function touch(s, at) {
    if (!Number.isFinite(at)) return;
    if (s.last != null && at > s.last && at - s.last <= ACTIVE_STEP) s.active += at - s.last;
    if (s.last == null || at > s.last) s.last = at;
  }
  /** Items that came in by source: { gathered, loot, reward, other }. */
  function bySource(s) {
    const other = {};
    for (const [id, n] of Object.entries(s.items || {})) {
      const rest = n - SOURCES.reduce((t, k) => t + (s[k]?.[id] || 0), 0);
      if (rest > 0) other[id] = rest;
    }
    return { gathered: s.gathered || {}, loot: s.loot || {}, reward: s.reward || {}, other };
  }
  function clone(session) {
    return normalize(session);
  }
  // Match what came in to a source, either way round (the frames come in any order).
  function mark(s) {
    for (const g of s.recent) {
      if (g.src || g.left <= 0) continue;
      const p = s.pickups.find((x) => x.item === g.item && !x.used && Math.abs(x.at - g.at) <= WINDOW);
      if (p) {
        p.used = true;
        g.src = "loot";
      } else {
        const h = s.gathers.find((x) => x.item === g.item && !x.used && Math.abs(x.at - g.at) <= WINDOW);
        if (h) {
          h.used = true;
          g.src = "gathered";
        } else if (s.opened.some((o) => g.at - o.at >= -200 && g.at - o.at <= 2500)) {
          g.src = "reward";
        }
      }
      if (g.src) s[g.src][g.item] = (s[g.src][g.item] || 0) + g.left;
    }
  }
  function prune(s) {
    const now = Math.max(0, ...s.recent.map((g) => g.at), ...s.pickups.map((p) => p.at), ...s.gathers.map((p) => p.at));
    const fresh = (x) => now - x.at <= 15_000;
    s.recent = s.recent.filter(fresh).slice(-200);
    s.pickups = s.pickups.filter(fresh).slice(-200);
    s.gathers = s.gathers.filter(fresh).slice(-200);
    s.opened = s.opened.filter(fresh).slice(-50);
  }

  /** A session after an items event. Returns a new session. */
  function addDrops(session, it) {
    const s = clone(session);
    const since = s.start || 0;
    for (const p of Array.isArray(it?.pickups) ? it.pickups : []) {
      const [, at, item, count] = p;
      if (at < since) continue;
      s.pickups.push({ at, item, count, used: false });
    }
    // The changes by frame (one `at`): a frame that breaks gear down is one.
    const frames = new Map();
    for (const ch of Array.isArray(it?.changes) ? it.changes : []) {
      const [, at, container, item, delta] = ch;
      if (String(container) !== INVENTORY || !Number.isFinite(delta) || delta === 0 || at < since) continue;
      if (!frames.has(at)) frames.set(at, []);
      frames.get(at).push({ item, delta });
    }
    for (const [at, list] of [...frames].sort((a, b) => a[0] - b[0])) {
      touch(s, at);
      const stones = list.find((c) => c.item === ENHANCE_STONE && c.delta > 0);
      const gone = list.filter((c) => c.delta < 0 && !currency(c.item));
      if (stones && gone.length) {
        // Broken down: the pieces out, their stones and bound Kinah counted.
        for (const c of gone) {
          let n = -c.delta;
          s.dismantled.pieces += n;
          for (const g of [...s.recent].reverse()) {
            if (g.item !== c.item || g.left <= 0 || n <= 0) continue;
            const take = Math.min(n, g.left);
            g.left -= take;
            n -= take;
            s.items[c.item] = Math.max(0, (s.items[c.item] || 0) - take);
            if (!s.items[c.item]) delete s.items[c.item];
            if (g.src) {
              s[g.src][c.item] = Math.max(0, (s[g.src][c.item] || 0) - take);
              if (!s[g.src][c.item]) delete s[g.src][c.item];
            }
          }
        }
        s.dismantled.stones += stones.delta;
        const bound = list.find((c) => c.item === KINA_BOUND && c.delta < 0);
        if (bound) s.dismantled.kinahBound += -bound.delta;
        continue;
      }
      for (const c of list) if (c.delta < 0 && opener(c.item)) s.opened.push({ at, item: c.item });
      const ups = list.filter((c) => c.delta > 0);
      const many = ups.filter((c) => !currency(c.item)).length >= 3;
      for (const { item, delta } of ups) {
        if (item === KINA) s.kinah += delta;
        else if (item === ABYSS_POINTS) s.abyss += delta;
        else if (!currency(item)) {
          s.items[item] = (s.items[item] || 0) + delta;
          const g = { at, item, delta, left: delta, src: many ? "reward" : null };
          if (g.src) s.reward[item] = (s.reward[item] || 0) + delta;
          s.recent.push(g);
        }
      }
    }
    mark(s);
    prune(s);
    return s;
  }

  /** A session after the game's gathering result ({ item, amount, bonus,
   *  great, node }, at `at`, in `area`). Returns a new session. */
  function addGather(session, d, at, area) {
    const s = clone(session);
    const item = Number(d?.item), amount = Number(d?.amount) || 0, bonus = Number(d?.bonus) || 0;
    if (!Number.isFinite(item) || item < 100_000_000 || amount + bonus <= 0 || amount + bonus > 1000 || at < (s.start || 0)) return session;
    touch(s, at);
    const g = s.gather;
    g.n++;
    g.amount += amount;
    g.bonus += bonus;
    if (d.great) g.great++;
    const node = Number(d.node);
    if (Number.isFinite(node) && !s.nodes.includes(node)) {
      g.spots++;
      s.nodes = [...s.nodes, node].slice(-50);
    }
    const bi = g.byItem[item] || { n: 0, count: 0 };
    g.byItem[item] = { n: bi.n + 1, count: bi.count + amount + bonus };
    const key = area || "Unknown";
    const ba = g.byArea[key] || { n: 0, count: 0 };
    g.byArea[key] = { n: ba.n + 1, count: ba.count + amount + bonus };
    s.gathers.push({ at, item, count: amount + bonus, used: false });
    mark(s);
    prune(s);
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


  // ---------- the limits kept per character ----------
  // The game sends the whole list (Kina today, Abyss Points, every key and
  // entry count) only at a login. A meter started later (after the login, or
  // again after an update) has only what changed since, so the plugin keeps
  // each character's last values and shows them until the game sends new
  // ones. The resets as the meter has them: daily 07:00 UTC, weekly
  // Wednesday 07:00 UTC.
  const DAY_MS = 86_400_000;
  const WEEK_MS = 7 * DAY_MS;
  const DAILY_RESET_MS = 7 * 3_600_000;
  const WEEKLY_RESET_MS = 6 * DAY_MS + DAILY_RESET_MS;
  const lastReset = (now, period, offset) => Math.floor((now - offset) / period) * period + offset;
  /** Whether a reset ("d" daily, "w" weekly) has passed between `at` and `now`. */
  function resetSince(kind, at, now) {
    if (kind === "d") return lastReset(now, DAY_MS, DAILY_RESET_MS) > at;
    if (kind === "w") return lastReset(now, WEEK_MS, WEEKLY_RESET_MS) > at;
    return false;
  }
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
  function readKept(k) {
    const out = { kinah: null, abyss: null, counts: {}, times: {}, at: 0 };
    if (!k || typeof k !== "object") return out;
    if (Array.isArray(k.kinah) && num(k.kinah[0]) != null) out.kinah = [num(k.kinah[0]), num(k.kinah[1]) || 0];
    if (Array.isArray(k.abyss) && num(k.abyss[0]) != null) out.abyss = [num(k.abyss[0]), num(k.abyss[1]), num(k.abyss[2]) || 0];
    for (const [id, v] of Object.entries(k.counts || {})) if (Array.isArray(v) && num(v[0]) != null) out.counts[id] = [num(v[0]), num(v[1]) || 0, num(v[2]) || 0];
    for (const [id, v] of Object.entries(k.times || {})) if (Array.isArray(v) && num(v[0]) != null) out.times[id] = [num(v[0]), num(v[1]) || 0, num(v[2]) || 0];
    out.at = num(k.at) || 0;
    if (typeof k.name === "string") out.name = k.name;
    return out;
  }

  /** A character's kept limits with what the meter says now ({ kinah: [value,
   *  at], abyss: [points, limit, at], counts: { id: [left, extra, at] },
   *  times: { id: [time, seen at, at] }, at }). A whole list (a login's: five
   *  counts or more, all reported within ten seconds) replaces the kept
   *  counts and times; single changes replace theirs only. */
  function keep(kept, character, now) {
    const k = readKept(kept);
    if (!character) return k;
    const seen = character.seenAt || {};
    let changed = false;
    const kn = num(character.kinahToday);
    if (kn != null) {
      k.kinah = [kn, num(seen.kinahToday) || now];
      changed = true;
    }
    const ap = character.abyssPoints;
    if (Array.isArray(ap) && num(ap[0]) != null) {
      k.abyss = [num(ap[0]), num(ap[1]), num(seen.abyssPoints) || now];
      changed = true;
    }
    const counts = character.contentCounts && typeof character.contentCounts === "object" ? character.contentCounts : {};
    const times = character.contentTimes && typeof character.contentTimes === "object" ? character.contentTimes : {};
    const ids = Object.keys(counts).filter((id) => Array.isArray(counts[id]));
    const ats = ids.map((id) => num(seen.contentCounts?.[id]) || now);
    if (ids.length >= 5 && Math.max(...ats) - Math.min(...ats) <= 10_000 && Math.min(...ats) > k.at) {
      k.counts = {};
      k.times = {};
    }
    ids.forEach((id, i) => {
      k.counts[id] = [num(counts[id][0]) || 0, num(counts[id][1]) || 0, ats[i]];
      delete k.times[id];
      changed = true;
    });
    for (const [id, v] of Object.entries(times)) {
      if (!Array.isArray(v)) continue;
      k.times[id] = [num(v[0]) || 0, num(v[1]) || now, num(v[1]) || now];
      delete k.counts[id];
      changed = true;
    }
    if (changed) k.at = now;
    return k;
  }

  /** Abyss Points gained (the inventory's Abyss Points going up) while the
   *  meter has no week's points of its own: added to the kept, up to the
   *  limit, so the row goes on after a meter started mid-game. */
  function keepAbyssGain(kept, delta, at) {
    const k = readKept(kept);
    if (!k.abyss || !(delta > 0)) return k;
    const [points, limit, when] = k.abyss;
    const base = resetSince("w", when, at) ? 0 : points;
    k.abyss = [limit ? Math.min(limit, base + delta) : base + delta, limit, at];
    return k;
  }

  /** The character as the limits show it: what the meter says, and for what
   *  it hasn't said the kept values. `old` names each row taken from the
   *  kept ones ("kinah", "abyss", "t<id>") with when the game said it and
   *  whether a reset has passed since (Kina and Abyss Points are 0 then;
   *  a key or count stays as it was, marked). */
  function withKept(character, kept, now) {
    const k = readKept(kept);
    const c = { ...(character || {}) };
    const old = {};
    if (num(c.kinahToday) == null && k.kinah) {
      const reset = resetSince("d", k.kinah[1], now);
      c.kinahToday = reset ? 0 : k.kinah[0];
      old.kinah = { at: k.kinah[1], reset };
    }
    if (!(Array.isArray(c.abyssPoints) && num(c.abyssPoints[0]) != null) && k.abyss) {
      const reset = resetSince("w", k.abyss[2], now);
      c.abyssPoints = [reset ? 0 : k.abyss[0], k.abyss[1]];
      old.abyss = { at: k.abyss[2], reset };
    }
    const counts = { ...(c.contentCounts || {}) };
    const times = { ...(c.contentTimes || {}) };
    for (const [id, v] of Object.entries(k.counts)) {
      if (counts[id] || times[id]) continue;
      counts[id] = [v[0], v[1]];
      old[`t${id}`] = { at: v[2], reset: resetSince(D.tickets?.[id]?.[6], v[2], now) };
    }
    for (const [id, v] of Object.entries(k.times)) {
      if (counts[id] || times[id]) continue;
      times[id] = [v[0], v[1]];
      old[`t${id}`] = { at: v[2], reset: resetSince(D.tickets?.[id]?.[6], v[2], now) };
    }
    c.contentCounts = counts;
    c.contentTimes = times;
    return { character: c, old };
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
    addDrops, addGather, newSession, normalize, isEmpty, isBreak, summary, bySource,
    tickets, limits, kina, short, charKey, ENHANCE_STONE, KINA_BOUND,
    keep, keepAbyssGain, withKept, resetSince,
  });
})();
