// The Inventory plugin's farm days, without the page: what a character
// gained from one daily reset (07:00 UTC) to the next, by where it came
// from (open world, dungeon, Abyss, Shugo Festival, Dimensional Invasion,
// other), when the day's Kinah cap (1,000,000 from the open world) was
// reached, every gold item (Unique and higher) with when and where, and the
// statistics over the days: trends, changes in the drops, and when there is
// enough to tell. Node loads it for the tests (dev/tests).
(() => {
  const C = globalThis.InventoryCalc;
  const ZONES = globalThis.INVENTORY_ZONES || {};
  const DAY_MS = 86_400_000;
  const RESET_MS = 7 * 3_600_000;
  const KEY_WINDOW = 20_000; // a reward this close to a key used is that key's
  const ACTIVE_STEP = 5 * 60_000; // a pause this long or longer is no play
  const GOLD = 4; // Unique and higher: the game's gold items and up
  const SOURCES = ["open", "dungeon", "abyss", "shugo", "invasion", "other"];
  const NAMES = { open: "Open world", dungeon: "Dungeon", abyss: "Abyss", shugo: "Shugo Festival", invasion: "Dimensional Invasion", other: "Other" };
  // The keys the game counts down when a reward is taken (the content
  // tickets: Shugo Festival Reward Key, Dimensional Invasion Reward Key).
  const KEYS = { 1: "shugo", 7: "shugo", 8: "invasion" };

  const dayOf = (at) => Math.floor((at - RESET_MS) / DAY_MS) * DAY_MS + RESET_MS;
  /** A day's name for storage keys and lists: its reset's date (UTC). */
  const dayName = (day) => new Date(day).toISOString().slice(0, 10).replace(/-/g, "");
  const zoneName = (zone) => (zone ? ZONES[String(zone)] || `Zone ${zone}` : "Zone not known yet");
  const isGold = (item) => !C.currency(item) && C.grade(item) >= GOLD;

  /** Where a zone is, by the game's numbering (as the meter's zones.rs
   *  reads it): the open world (with its towns and airships), dungeons, the
   *  Abyss (its three layers and the Abyss Corridor), the Shugo Festival's
   *  games, the Incursion of the Spirits (taken as the Dimensional Invasion;
   *  its key says so for sure), arenas (other). No zone yet: other. */
  function zoneSource(zone) {
    const z = Number(zone);
    if (!Number.isFinite(z) || z <= 0) return "other";
    if (z === 20 || z === 22 || z === 23 || (z >= 503_000 && z <= 504_999)) return "abyss";
    if (/Incursion of the Spirits/i.test(ZONES[String(z)] || "")) return "invasion";
    if ((z >= 76 && z <= 78) || (z >= 500_000 && z <= 519_999)) return "shugo";
    if ([7, 8, 10, 12, 14].includes(z) || (z >= 60 && z <= 64)) return "other";
    if ((z >= 200_000 && z <= 499_999) || (z >= 600_000 && z <= 699_999) || (z >= 900_000 && z <= 999_999)) return "dungeon";
    return "open";
  }

  const newSource = () => ({ kinah: 0, active: 0, items: {}, gold: 0, worth: 0, n: 0, unpriced: {} });
  function newDay(at) {
    return {
      v: 1, day: dayOf(at), start: null, last: null,
      src: {}, gold: [], cap: null, counter: null, firstOpen: null,
      zones: {}, // zone id -> gains seen there (for "other")
      recent: [], keys: [], lastSrc: null,
    };
  }
  /** A stored day as this version's shape. */
  function normalize(d) {
    if (!d || typeof d !== "object" || !Number.isFinite(d.day)) return null;
    const out = { ...newDay(d.day), ...d };
    out.src = {};
    for (const [k, s] of Object.entries(d.src || {})) if (SOURCES.includes(k)) out.src[k] = { ...newSource(), ...s, items: { ...(s.items || {}) }, unpriced: { ...(s.unpriced || {}) } };
    out.gold = Array.isArray(d.gold) ? d.gold.filter(Array.isArray).map((g) => [...g]) : [];
    out.recent = Array.isArray(d.recent) ? d.recent.map((r) => ({ ...r })) : [];
    out.keys = Array.isArray(d.keys) ? d.keys.map((r) => ({ ...r })) : [];
    out.zones = { ...(d.zones || {}) };
    out.cap = d.cap ? { ...d.cap } : null;
    out.counter = d.counter ? { ...d.counter } : null;
    return out;
  }
  const src = (d, k) => (d.src[k] ||= newSource());

  // Time played, by source: a step of less than 5 minutes since the last
  // doing counts for this doing's source when both are the same.
  function touch(d, k, at) {
    if (!Number.isFinite(at)) return;
    if (d.last != null && at > d.last && at - d.last < ACTIVE_STEP && d.lastSrc === k) src(d, k).active += at - d.last;
    if (d.start == null || at < d.start) d.start = at;
    if (d.last == null || at >= d.last) {
      d.last = at;
      d.lastSrc = k;
    }
  }
  const keyAt = (d, at) => d.keys.find((u) => Math.abs(u.at - at) <= KEY_WINDOW)?.src || null;

  function addItem(d, k, item, n, at, zone, priceOf) {
    const s = src(d, k);
    s.items[item] = (s.items[item] || 0) + n;
    s.n += n;
    const w = C.currency(item) ? 0 : priceOf ? priceOf(item, n) : null;
    if (w == null) s.unpriced[item] = (s.unpriced[item] || 0) + n;
    else s.worth += w;
    let gold = false;
    if (isGold(item)) {
      s.gold += n;
      d.gold.push([at, item, n, k, Number(zone) || 0, w ?? null]);
      gold = true;
    }
    d.recent.push({ at, item, n, src: k, w: w ?? null, gold, kinah: 0 });
  }
  function moveRecent(d, r, to) {
    if (r.src === to) return;
    const a = src(d, r.src), b = src(d, to);
    if (r.kinah) {
      a.kinah -= r.kinah;
      b.kinah += r.kinah;
    } else {
      a.items[r.item] = (a.items[r.item] || 0) - r.n;
      if (a.items[r.item] <= 0) delete a.items[r.item];
      b.items[r.item] = (b.items[r.item] || 0) + r.n;
      a.n -= r.n;
      b.n += r.n;
      if (r.w == null) {
        if (!C.currency(r.item)) {
          a.unpriced[r.item] = Math.max(0, (a.unpriced[r.item] || 0) - r.n);
          if (!a.unpriced[r.item]) delete a.unpriced[r.item];
          b.unpriced[r.item] = (b.unpriced[r.item] || 0) + r.n;
        }
      } else {
        a.worth -= r.w;
        b.worth += r.w;
      }
      if (r.gold) {
        a.gold -= r.n;
        b.gold += r.n;
        const g = d.gold.find((x) => x[0] === r.at && x[1] === r.item && x[3] === r.src);
        if (g) g[3] = to;
      }
    }
    r.src = to;
  }
  function prune(d) {
    const now = d.last || 0;
    d.recent = d.recent.filter((r) => now - r.at <= 2 * KEY_WINDOW).slice(-300);
    d.keys = d.keys.filter((u) => now - u.at <= 2 * KEY_WINDOW).slice(-20);
  }

  /** A day after an items event, in `zone` (the world's), prices by
   *  `priceOf(item, count)` (null: not known yet). Only the inventory's
   *  gains count: a frame that spends Kinah (bought) or uses up other items
   *  than a chest or key (crafted, broken down) is no drop. Open-world Kinah
   *  comes from the game's own counter toward the cap (`counter`), the other
   *  places' Kinah from the inventory. Returns a new day. */
  function addItems(day, it, zone, priceOf) {
    const d = normalize(day);
    const frames = new Map();
    for (const ch of Array.isArray(it?.changes) ? it.changes : []) {
      const [, at, container, item, delta] = ch;
      if (String(container) !== C.INVENTORY || !Number.isFinite(delta) || delta === 0 || !Number.isFinite(at) || dayOf(at) !== d.day) continue;
      if (!frames.has(at)) frames.set(at, []);
      frames.get(at).push({ item, delta });
    }
    const opener = (id) => /^Key:|\b(Chest|Box|Pouch|Bundle|Crate|Coffer|Casket)\b/i.test(C.name(id));
    for (const [at, list] of [...frames].sort((a, b) => a[0] - b[0])) {
      if (list.some((c) => c.delta < 0 && (c.item === C.KINA || (!C.currency(c.item) && !opener(c.item))))) continue;
      const ups = list.filter((c) => c.delta > 0 && c.item !== C.KINA_BOUND);
      if (!ups.length) continue;
      const k = keyAt(d, at) || zoneSource(zone);
      touch(d, k, at);
      if (k === "other") d.zones[String(Number(zone) || 0)] = (d.zones[String(Number(zone) || 0)] || 0) + 1;
      for (const { item, delta } of ups) {
        if (item === C.KINA) {
          // The open world's Kinah: the game's counter (below), unless the
          // game hasn't sent one this day.
          const s = src(d, k);
          if (k === "open") {
            s.kinahItems = (s.kinahItems || 0) + delta;
            if (d.counter) continue;
          }
          s.kinah += delta;
          d.recent.push({ at, item, n: delta, src: k, kinah: delta });
          if (k === "open" && d.firstOpen == null) d.firstOpen = at;
          continue;
        }
        addItem(d, k, item, delta, at, zone, priceOf);
        if (k === "open" && d.firstOpen == null) d.firstOpen = at;
      }
    }
    prune(d);
    return d;
  }

  /** A day after the game's Kinah today (`value`, said at `at`) while in
   *  `zone`: what it grew by counts for the open world; reaching 1,000,000
   *  marks the cap with the open world's numbers at that moment (the farm
   *  goes on after it: drops still count, Kinah from the Abyss too). */
  function addCounter(day, value, at, zone) {
    const d = normalize(day);
    if (!Number.isFinite(value) || !Number.isFinite(at) || dayOf(at) !== d.day) return d;
    const s = src(d, "open");
    // In the open world (or before the meter knows the zone) the counter's
    // growth is the open world's Kinah; elsewhere that place's Kinah comes
    // from the inventory already.
    const here = zoneSource(zone);
    const open = here === "open" || !(Number(zone) > 0);
    if (!d.counter) {
      // The first value seen this day: all of today's open-world Kinah
      // (the counter starts at 0 at the reset), counted from the inventory
      // so far or not.
      if (value > s.kinah) s.kinah = value;
    } else if (value > d.counter.last && open) {
      s.kinah += value - d.counter.last;
      touch(d, "open", at);
      if (d.firstOpen == null) d.firstOpen = at;
    }
    d.counter = { first: d.counter ? d.counter.first : value, last: Math.max(value, d.counter?.last ?? 0), at };
    if (!d.cap && value >= C.KINA_DAILY) {
      d.cap = { at, active: s.active, kinah: Math.max(s.kinah, value), worth: s.worth, gold: s.gold, n: s.n, sinceFirst: d.firstOpen != null ? at - d.firstOpen : null };
    }
    return d;
  }

  /** A day after a reward key was used (the game's count of `ticket` went
   *  down at `at`): gains close to it are that key's (Shugo Festival or
   *  Dimensional Invasion), and so are the ones still coming. */
  function keyUsed(day, ticket, at) {
    const k = KEYS[String(ticket)];
    const d = normalize(day);
    if (!k || !Number.isFinite(at) || dayOf(at) !== d.day) return d;
    d.keys.push({ at, src: k });
    for (const r of d.recent) if (Math.abs(r.at - at) <= KEY_WINDOW) moveRecent(d, r, k);
    if (d.last == null || at > d.last) d.last = at;
    prune(d);
    return d;
  }

  /** A day with prices now known for what came in before them. */
  function settle(day, priceOf) {
    const d = normalize(day);
    let changed = false;
    for (const s of Object.values(d.src)) {
      for (const [id, n] of Object.entries(s.unpriced)) {
        const w = priceOf(Number(id), n);
        if (w == null) continue;
        s.worth += w;
        delete s.unpriced[id];
        changed = true;
      }
    }
    for (const g of d.gold) {
      if (g[5] != null) continue;
      const w = priceOf(g[1], g[2]);
      if (w != null) {
        g[5] = w;
        changed = true;
      }
    }
    return changed ? d : day;
  }

  /** What the list of days keeps of a day (no item lists). */
  function summary(day) {
    const d = normalize(day);
    const src = {};
    for (const [k, s] of Object.entries(d.src)) src[k] = { kinah: s.kinah, active: s.active, gold: s.gold, worth: s.worth, n: s.n };
    return { day: d.day, start: d.start, last: d.last, firstOpen: d.firstOpen, cap: d.cap, counter: d.counter?.last ?? null, src, gold: d.gold.map((g) => [...g]) };
  }
  const isEmpty = (d) => !d || (!Object.values(d.src || {}).some((s) => s.n || s.kinah) && !d.cap);

  // ---------- statistics ----------
  const MIN_HOURS = 0.5; // a day counts for a source with half an hour played there
  const MIN_DAYS = 7;
  const MIN_GOLD = 30;
  const RECENT_DAYS = 7;

  /** One source's (or "all") numbers of a day summary: hours, Kinah, gold,
   *  worth; for the open world also the hours and Kinah up to the cap. */
  function part(sum, k) {
    const list = k === "all" ? Object.values(sum.src || {}) : [sum.src?.[k]].filter(Boolean);
    const p = list.reduce((t, s) => ({ hours: t.hours + (s.active || 0) / 3_600_000, kinah: t.kinah + (s.kinah || 0), gold: t.gold + (s.gold || 0), worth: t.worth + (s.worth || 0), n: t.n + (s.n || 0) }), { hours: 0, kinah: 0, gold: 0, worth: 0, n: 0 });
    // Kinah per hour in the open world: until the cap (no Kinah after it).
    const open = sum.src?.open;
    if (k === "open" && sum.cap && open) {
      p.kinahHours = (sum.cap.active || 0) / 3_600_000;
      p.kinahToCap = sum.cap.kinah || 0;
      // The whole account: the characters' hours to their cap, on average.
      if (sum.account) p.capHours = Number.isFinite(sum.cap.hoursEach) ? sum.cap.hoursEach : null;
    }
    return p;
  }

  /** The whole account's days: the characters' day summaries ({ name:
   *  [summaries] }) added up day by day. Per source everything summed;
   *  each gold item with its character (g[6]); the cap: how many reached
   *  it of how many played, the hours to it on average, and for Kinah per
   *  hour each character's open world up to its cap (or all of it when
   *  the cap wasn't reached). */
  function mergeSums(byChar) {
    const days = new Map();
    for (const [who, list] of Object.entries(byChar || {})) {
      for (const s of Array.isArray(list) ? list : []) {
        if (!s || !Number.isFinite(s.day)) continue;
        const m = days.get(s.day) || { day: s.day, start: null, last: null, firstOpen: null, src: {}, gold: [], chars: 0, capped: 0, capActive: 0, capKinah: 0, capHours: 0, counter: 0 };
        m.chars++;
        for (const f of ["start", "firstOpen"]) if (s[f] != null && (m[f] == null || s[f] < m[f])) m[f] = s[f];
        if (s.last != null && (m.last == null || s.last > m.last)) m.last = s.last;
        for (const [k, p] of Object.entries(s.src || {})) {
          const t = (m.src[k] ||= { kinah: 0, active: 0, gold: 0, worth: 0, n: 0 });
          for (const f of Object.keys(t)) t[f] += p[f] || 0;
        }
        for (const g of s.gold || []) m.gold.push([...g.slice(0, 6), who]);
        const open = s.src?.open || {};
        if (s.cap) {
          m.capped++;
          m.capActive += s.cap.active || 0;
          m.capKinah += s.cap.kinah || 0;
          m.capHours += (s.cap.active || 0) / 3_600_000;
        } else {
          m.capActive += open.active || 0;
          m.capKinah += open.kinah || 0;
        }
        m.counter += s.counter ?? open.kinah ?? 0;
        days.set(s.day, m);
      }
    }
    return [...days.values()].sort((a, b) => a.day - b.day).map((m) => {
      const { capped, capActive, capKinah, capHours, ...rest } = m;
      return { ...rest, account: true, capped, cap: capActive ? { active: capActive, kinah: capKinah, hoursEach: capped ? capHours / capped : null } : null };
    });
  }
  const METRICS = {
    kinah: { label: "Kina per hour", value: (p) => (p.kinahHours ? p.kinahToCap / p.kinahHours : p.hours ? p.kinah / p.hours : null) },
    gold: { label: "Gold items per hour", value: (p) => (p.hours ? p.gold / p.hours : null) },
    worth: { label: "Item worth per hour", value: (p) => (p.hours ? p.worth / p.hours : null) },
    toCap: { label: "Hours to the Kina cap", value: (p) => (p.capHours !== undefined ? p.capHours : p.kinahHours ? p.kinahHours : null), open: true },
  };
  /** The days that count for a source: [{ day, hours, value, gold }]. */
  function points(sums, k, metric) {
    const m = METRICS[metric];
    const out = [];
    for (const s of sums) {
      const p = part(s, metric === "toCap" ? "open" : k);
      if (p.hours < MIN_HOURS) continue;
      const v = m.value(p);
      if (v == null || !Number.isFinite(v)) continue;
      out.push({ day: s.day, hours: p.hours, value: v, gold: p.gold });
    }
    return out.sort((a, b) => a.day - b.day);
  }

  // The t distribution's two-sided p from the regularized incomplete beta.
  function lgamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x;
    const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
    let s = 1.000000000190015;
    for (const c of g) s += c / ++y;
    return -t + Math.log((2.5066282746310005 * s) / x);
  }
  function betacf(a, b, x) {
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d; h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }
  function ibeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
  }
  /** Two-sided p of a t value with `df` degrees of freedom. */
  const pT = (t, df) => (df > 0 && Number.isFinite(t) ? ibeta(df / 2, 0.5, df / (df + t * t)) : 1);
  const mean = (a) => a.reduce((t, x) => t + x, 0) / a.length;
  const variance = (a) => {
    const m = mean(a);
    return a.length > 1 ? a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1) : 0;
  };

  /** The trend over the days: a straight line through the values by date;
   *  its slope per week relative to the mean, and the slope's p. */
  function trend(pts) {
    const n = pts.length;
    if (n < 3) return null;
    const xs = pts.map((p) => (p.day - pts[0].day) / DAY_MS), ys = pts.map((p) => p.value);
    const mx = mean(xs), my = mean(ys);
    const sxx = xs.reduce((t, x) => t + (x - mx) ** 2, 0);
    if (!sxx) return null;
    const slope = xs.reduce((t, x, i) => t + (x - mx) * (ys[i] - my), 0) / sxx;
    const icept = my - slope * mx;
    const sse = ys.reduce((t, y, i) => t + (y - (icept + slope * xs[i])) ** 2, 0);
    const se = Math.sqrt(sse / Math.max(1, n - 2) / sxx);
    const t = se > 0 ? slope / se : slope ? Infinity : 0;
    return { n, slope, icept, perWeek: my ? (slope * 7) / my : 0, p: se > 0 ? pT(t, n - 2) : slope ? 0 : 1, mean: my };
  }

  /** The last days against the ones before (Welch's t test). */
  function change(pts, recent = RECENT_DAYS) {
    if (pts.length < recent + 3) return null;
    const a = pts.slice(0, -recent).map((p) => p.value), b = pts.slice(-recent).map((p) => p.value);
    const va = variance(a) / a.length, vb = variance(b) / b.length;
    const ma = mean(a), mb = mean(b);
    const se = Math.sqrt(va + vb);
    const df = se > 0 ? (va + vb) ** 2 / ((va * va) / Math.max(1, a.length - 1) + (vb * vb) / Math.max(1, b.length - 1)) : 1;
    return { before: ma, after: mb, rel: ma ? (mb - ma) / ma : 0, p: se > 0 ? pT((mb - ma) / se, df) : ma === mb ? 1 : 0, nBefore: a.length, nAfter: b.length };
  }

  /** Gold drops, which are rare: the last days' count against the ones
   *  before for the hours played (an exact test: given all drops, how
   *  likely as many or as uneven fall in the last days by their hours). */
  function goldChange(pts, recent = RECENT_DAYS) {
    if (pts.length < recent + 3) return null;
    const a = pts.slice(0, -recent), b = pts.slice(-recent);
    const ka = Math.round(a.reduce((t, p) => t + p.gold, 0)), kb = Math.round(b.reduce((t, p) => t + p.gold, 0));
    const ha = a.reduce((t, p) => t + p.hours, 0), hb = b.reduce((t, p) => t + p.hours, 0);
    const k = ka + kb;
    if (!k || !ha || !hb) return { before: ha ? ka / ha : 0, after: hb ? kb / hb : 0, rel: 0, p: 1, k };
    const q = hb / (ha + hb);
    const lp = (i) => lgamma(k + 1) - lgamma(i + 1) - lgamma(k - i + 1) + i * Math.log(q) + (k - i) * Math.log(1 - q);
    const seen = lp(kb);
    let p = 0;
    for (let i = 0; i <= k; i++) {
      const l = lp(i);
      if (l <= seen + 1e-9) p += Math.exp(l);
    }
    const before = ka / ha, after = kb / hb;
    return { before, after, rel: before ? (after - before) / before : 0, p: Math.min(1, p), k };
  }

  /** Whether a metric can be read yet, and if not, what is missing. For
   *  rates: the days that count (7). For gold: also 30 drops. Also how big
   *  a change the days at hand would show (95 % sure, 80 % of the time). */
  function readiness(pts, metric) {
    const days = pts.length;
    const out = { days, ready: days >= MIN_DAYS, needDays: Math.max(0, MIN_DAYS - days), needGold: 0, detect: null };
    if (metric === "gold") {
      const k = pts.reduce((t, p) => t + p.gold, 0);
      out.gold = k;
      out.needGold = Math.max(0, MIN_GOLD - Math.round(k));
      out.ready = out.ready && out.needGold === 0;
      // With k drops split in two halves: the smallest factor that shows.
      if (k > 0) out.detect = Math.exp(2.8 * Math.sqrt(4 / k)) - 1;
    } else if (days >= 3) {
      const vals = pts.map((p) => p.value);
      const m = mean(vals);
      const cv = m ? Math.sqrt(variance(vals)) / Math.abs(m) : 0;
      // Two halves of the days: the change that shows at 95 %/80 %.
      out.detect = (2.8 * cv * Math.sqrt(2 / Math.max(1, days / 2)));
      out.cv = cv;
      // Days for a 10 % change: 2 groups of n = 2 (2.8 cv / 0.1)^2.
      out.daysFor10 = Math.ceil(2 * 2 * ((2.8 * cv) / 0.1) ** 2);
    }
    return out;
  }

  /** Gold drops by the hour of the day (local time) and by source: [24]. */
  function goldByHour(sums, k, hourOf) {
    const out = Array.from({ length: 24 }, () => 0);
    for (const s of sums) for (const g of s.gold || []) if (k === "all" || g[3] === k) out[hourOf(g[0])] += g[2] || 1;
    return out;
  }

  globalThis.InventoryDays = Object.freeze({
    SOURCES, NAMES, KEYS, METRICS, MIN_DAYS, MIN_GOLD, MIN_HOURS, RECENT_DAYS, GOLD,
    dayOf, dayName, zoneName, zoneSource, isGold, newDay, normalize, addItems, addCounter, keyUsed, settle, summary, isEmpty,
    part, mergeSums, points, trend, change, goldChange, readiness, goldByHour, pT,
  });
})();
