// The Inventory plugin's dungeon runs, without the page: each visit of a
// dungeon with the Odyle Energy spent there (40 a reward box) and the gold
// items that came in, and how your drops compare with the game's own drop
// rates (its "Obtainable Rewards" window, AION 2 Global). Node loads it for
// the tests (dev/tests).
(() => {
  const C = globalThis.InventoryCalc;
  const F = globalThis.InventoryDays;
  const ENERGY = "60000001"; // the content count of Odyle Energy
  const BOX = 40; // Odyle Energy a reward box takes, where the table says nothing else
  const RUNS = 3000; // runs kept per character
  const WEEK_MS = 7 * 86_400_000;
  const WEEK_RESET = Date.UTC(2026, 0, 7, 7); // a Wednesday, 07:00 UTC: the game's weekly reset
  const RECENT_MS = 7 * 86_400_000;

  // The game's drop rates (AION 2 Global, its own reward tables:
  // dungeon-rates.js): per dungeon and mode the chance a reward box (one
  // clear: every boss's pools) drops each item at least once. The items
  // go in groups by grade, gear or other; a group's expected count a box
  // is its items' added up, each item's as if its chance were three bosses'
  // between the chance (one roll) and three bosses' rolls (a little more
  // for common items: 0.42 for 36 %): the table says no more. A count
  // inside either model's range is in range. An item the game drops more often elsewhere is not in a
  // dungeon's table. Added from the game's "Obtainable Rewards" window
  // (the person's screenshots): Fire Temple Hard's Wrathful Mind, Will and
  // Ego (pool 5: 3.6 + 1.2 + 1.2 %), which the table leaves out.
  const TABLE = globalThis.INVENTORY_DUNGEON_RATES || { dungeons: {}, zones: {} };
  const EXTRA = {
    "Fire Temple|Hard": [
      { key: "wrath", label: "Unique Wrathful Mind, Will, Ego (pool 5)", perBox: 0.06, names: ["Wrathful Mind", "Wrathful Will", "Wrathful Ego"] },
    ],
  };
  const GRADE_NO = Object.fromEntries(C.GRADES.map((g, i) => [g, i]));
  const GEAR = new Set(["Weapons", "Armor", "Accessories"]);
  const bare = (n) => String(n || "").replace(/\s*\((Bound|Event)\)\s*$/i, "");
  const each = (p) => 3 * (1 - Math.pow(1 - Math.min(p, 0.999999), 1 / 3));
  const RATES = {};
  for (const [zone, [name, mode]] of Object.entries(TABLE.zones || {})) {
    const rows = TABLE.dungeons?.[name]?.[mode];
    if (!rows) continue;
    const groups = new Map();
    const byId = new Map(), byName = new Map();
    for (const [id, item, grade, cat] of rows) {
      const gear = GEAR.has(cat);
      const key = `${grade}-${gear ? "gear" : "other"}`;
      if (!groups.has(key)) groups.set(key, { key, label: `${grade} ${gear ? "gear" : cat === "Materials" ? "materials" : "collectibles and more"}`, grade: GRADE_NO[grade] || 0, perBox: 0, perBoxLo: 0, items: [] });
      const p = rows.find((r) => r[0] === id)[4];
      const g = groups.get(key);
      g.perBox += each(p);
      g.perBoxLo += p;
      g.items.push([id, item, p]);
      byId.set(id, key);
      byName.set(`${bare(item)}|${GRADE_NO[grade] || 0}`, key);
    }
    for (const x of EXTRA[`${name}|${mode}`] || []) {
      groups.set(x.key, { key: x.key, label: x.label, grade: 4, perBox: x.perBox, perBoxLo: x.perBox, items: x.names.map((n) => [null, n, null]), extra: true });
      for (const n of x.names) byName.set(`${n}|4`, x.key);
    }
    // A group whose chances add up to about one or more comes from pools
    // that drop every box and roll several times (Fire Temple Hard's
    // Legend gear: about 8 pieces a box, the table's chances add up to
    // 3.6): the table's "at least once" can't say how many. Rate only.
    for (const g of groups.values()) if (!g.extra && g.perBoxLo > 0.9) g.unrated = true;
    const list = [...groups.values()].sort((a, b) => b.grade - a.grade || (a.key < b.key ? -1 : 1));
    RATES[zone] = { name, level: mode, energy: BOX, zoneAssumed: true, groups: list, byId, byName, version: TABLE.gameVersion || null };
  }
  const rateOf = (zone) => RATES[String(zone)] || null;
  const perBox = (g) => g.perBox;
  const perBoxLo = (g) => g.perBoxLo ?? g.perBox;
  const groupOf = (rate, item) => (rate ? rate.byId.get(Number(item)) || rate.byName.get(`${bare(C.name(item))}|${C.grade(item)}`) || null : null);
  const isDungeon = (zone) => F.zoneSource(zone) === "dungeon";
  /** The Odyle Energy a character has (what is left and what is extra). */
  function energyOf(character) {
    const v = character?.contentCounts?.[ENERGY];
    if (!Array.isArray(v) || !Number.isFinite(Number(v[0]))) return null;
    return Number(v[0]) + (Number(v[1]) || 0);
  }

  // ---------- runs ----------
  // A run: { from, to, zone, open, energy, items: { id: n } (gold items and
  // the rate table's), gold }. The one going on is open; leaving the zone
  // closes it.
  const copy = (runs) => (Array.isArray(runs) ? runs.filter((r) => r && Number.isFinite(r.from)).map((r) => ({ ...r, items: { ...(r.items || {}) } })) : []);
  const empty = (r) => !r.energy && !Object.keys(r.items).length;
  function tidy(out) {
    return out.filter((r, i) => r.open || i === out.length - 1 || !empty(r)).slice(-RUNS);
  }
  /** Runs after the world's zone became `zone` at `at`: a dungeon starts a
   *  run, anything else closes the one going on. */
  function enter(runs, zone, at) {
    const out = copy(runs);
    const last = out[out.length - 1];
    if (last?.open && Number(last.zone) === Number(zone)) return out;
    if (last?.open) last.open = false;
    if (isDungeon(zone) && Number.isFinite(at)) out.push({ from: at, to: at, zone: Number(zone), open: true, energy: 0, items: {}, gold: 0 });
    return tidy(out);
  }
  const current = (out, zone) => {
    const last = out[out.length - 1];
    return last?.open && Number(last.zone) === Number(zone) ? last : null;
  };
  /** Runs after `spent` Odyle Energy went in `zone` at `at`. */
  function spend(runs, zone, spent, at) {
    const out = copy(runs);
    const r = current(out, zone);
    if (!r || !(spent > 0)) return out;
    r.energy += spent;
    if (at > r.to) r.to = at;
    return out;
  }
  /** Runs after an items event in `zone`: the gold items (and the rate
   *  table's) that came in (days.js's gains: no bought or crafted ones). */
  function addItems(runs, zone, it) {
    const out = copy(runs);
    const r = current(out, zone);
    if (!r) return out;
    const rate = rateOf(zone);
    for (const { at, ups } of F.gains(it, (at) => at >= r.from - 5_000)) {
      for (const { item, delta } of ups) {
        if (C.currency(item)) continue;
        const gold = F.isGold(item);
        if (!gold && !groupOf(rate, item)) continue;
        r.items[item] = (r.items[item] || 0) + delta;
        if (gold) r.gold += delta;
        if (at > r.to) r.to = at;
      }
    }
    return out;
  }
  const boxes = (r) => Math.round((r.energy || 0) / (rateOf(r.zone)?.energy || BOX));

  // ---------- statistics ----------
  // Poisson: a box's drops of a group are rare and many boxes add up; the
  // count in n boxes is Poisson with mean n × the chance a box.
  function logPmf(k, lam) {
    if (lam <= 0) return k === 0 ? 0 : -Infinity;
    let lf = 0;
    for (let i = 2; i <= k; i++) lf += Math.log(i);
    return -lam + k * Math.log(lam) - lf;
  }
  function cdf(k, lam) {
    if (k < 0) return 0;
    let t = 0, p = Math.exp(-lam);
    for (let i = 0; i <= k; i++) {
      if (i) p *= lam / i;
      t += p;
    }
    return Math.min(1, t);
  }
  /** The count that a share `q` of luck stays at or below. */
  function quantile(lam, q) {
    let k = 0, t = 0, p = Math.exp(-lam);
    for (;;) {
      if (k) p *= lam / k;
      t += p;
      if (t >= q || k > lam + 50 * Math.sqrt(lam + 1) + 50) return k;
      k++;
    }
  }
  /** How likely a count as far from the mean as `k` is (two-sided, exact). */
  function pValue(k, lam) {
    if (lam <= 0) return k === 0 ? 1 : 0;
    const at = logPmf(k, lam);
    const top = Math.ceil(Math.max(k, lam) + 12 * Math.sqrt(lam + 1) + 20);
    let t = 0;
    for (let i = 0; i <= top; i++) {
      const l = logPmf(i, lam);
      if (l <= at + 1e-9) t += Math.exp(l);
    }
    return Math.min(1, t);
  }
  /** The mean a count `k` says, 95 % (exact, Garwood). */
  function meanRange(k) {
    const solve = (f) => {
      let lo = 0, hi = k * 3 + 20;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid)) hi = mid;
        else lo = mid;
      }
      return (lo + hi) / 2;
    };
    const lower = k === 0 ? 0 : solve((m) => 1 - cdf(k - 1, m) >= 0.025);
    const upper = solve((m) => cdf(k, m) <= 0.025);
    return [lower, upper];
  }
  const MIN_EXPECTED = 5; // a verdict means something once 5 drops are expected
  /** `found` drops in `n` boxes at `chance` a box (or between `chanceLo`
   *  and `chance`): what was to expect, the range 95 % of players land in,
   *  and whether you are in it. */
  function compare(found, n, chance, chanceLo = chance) {
    const lam = n * chance, lamLo = n * Math.min(chanceLo, chance);
    const [lo, hi] = [quantile(lamLo, 0.025), quantile(lam, 0.975)];
    const p = found < lamLo ? pValue(found, lamLo) : found > lam ? pValue(found, lam) : 1;
    const [mLo, mHi] = meanRange(found);
    const verdict = !n ? "none" : p < 0.05 ? (found > lam ? "above" : "below") : "in";
    return { found, boxes: n, chance, chanceLo: Math.min(chanceLo, chance), expected: lam, expectedLo: lamLo, lo, hi, p, verdict, rate: n ? found / n : null, rateLo: n ? mLo / n : null, rateHi: n ? mHi / n : null, sure: lam >= MIN_EXPECTED, need: lam >= MIN_EXPECTED ? 0 : Math.ceil(MIN_EXPECTED / chance) - n };
  }
  /** What the runs `list` hold: boxes, runs, energy, gold, and each group's drops. */
  function tally(list, rate) {
    const t = { runs: 0, boxless: 0, boxes: 0, energy: 0, gold: 0, found: {}, items: {} };
    for (const g of rate?.groups || []) t.found[g.key] = 0;
    for (const r of list) {
      const b = boxes(r);
      if (!b) {
        t.boxless++;
        continue;
      }
      t.runs++;
      t.boxes += b;
      t.energy += r.energy || 0;
      t.gold += r.gold || 0;
      for (const [id, n] of Object.entries(r.items || {})) {
        t.items[id] = (t.items[id] || 0) + n;
        const k = groupOf(rate, Number(id));
        if (k) t.found[k] += n;
      }
    }
    return t;
  }
  function verdicts(t, rate) {
    if (!rate) return null;
    const rows = rate.groups.map((g) => g.unrated
      ? { key: g.key, label: g.label, grade: g.grade, unrated: true, found: t.found[g.key] || 0, boxes: t.boxes, rate: t.boxes ? (t.found[g.key] || 0) / t.boxes : null, verdict: "rate" }
      : { key: g.key, label: g.label, grade: g.grade, ...compare(t.found[g.key] || 0, t.boxes, perBox(g), perBoxLo(g)) });
    // Gold and up together: the drops that count most (the summary's row).
    const gold = rate.groups.filter((g) => g.grade >= 4 && !g.unrated);
    const sum = (f) => gold.reduce((s, g) => s + f(g), 0);
    if (gold.length > 1) rows.push({ key: "gold", label: "Unique and up, together", grade: 4, main: true, ...compare(sum((g) => t.found[g.key] || 0), t.boxes, sum(perBox), sum(perBoxLo)) });
    else (rows.find((r) => r.grade >= 4 && !r.unrated) || rows.find((r) => !r.unrated) || rows[0]).main = true;
    return rows;
  }
  const weekOf = (at) => WEEK_RESET + Math.floor((at - WEEK_RESET) / WEEK_MS) * WEEK_MS;
  /** Each dungeon (zone) run: its runs and boxes, your drops against the
   *  game's rates in all, in the last 7 days, and week by week (newest
   *  first), and its last runs. `runs`: one list, or several (the account)
   *  as { name: runs }. */
  function summarize(runs, now = Date.now()) {
    const all = Array.isArray(runs) ? copy(runs) : Object.entries(runs || {}).flatMap(([who, l]) => copy(l).map((r) => ({ ...r, who })));
    const byZone = new Map();
    for (const r of all) {
      if (!byZone.has(r.zone)) byZone.set(r.zone, []);
      byZone.get(r.zone).push(r);
    }
    const out = [];
    for (const [zone, list] of byZone) {
      list.sort((a, b) => a.from - b.from);
      const rate = rateOf(zone);
      const t = tally(list, rate);
      if (!t.runs && !t.boxless) continue;
      const recent = tally(list.filter((r) => now - r.from <= RECENT_MS), rate);
      const weeks = new Map();
      for (const r of list) {
        const w = weekOf(r.from);
        if (!weeks.has(w)) weeks.set(w, []);
        weeks.get(w).push(r);
      }
      out.push({
        zone, name: rate ? rate.name : F.zoneName(zone), level: rate?.level || null, rate,
        total: t, rows: verdicts(t, rate),
        recent: recent.boxes ? { total: recent, rows: verdicts(recent, rate) } : null,
        weeks: [...weeks].sort((a, b) => b[0] - a[0]).map(([week, l]) => {
          const wt = tally(l, rate);
          return { week, total: wt, all: rate && wt.boxes ? verdicts(wt, rate).find((x) => x.main) : null };
        }).filter((w) => w.total.runs),
        last: list.slice(-10).reverse().map((r) => ({ from: r.from, to: r.to, boxes: boxes(r), energy: r.energy || 0, gold: r.gold || 0, items: { ...r.items }, who: r.who || null })),
        latest: list[list.length - 1].from,
      });
    }
    return out.sort((a, b) => b.latest - a.latest);
  }

  globalThis.InventoryDungeons = Object.freeze({
    RATES, ENERGY, BOX, MIN_EXPECTED, rateOf, perBox, perBoxLo, groupOf, isDungeon, energyOf,
    enter, spend, addItems, boxes, summarize, compare, tally, quantile, pValue, cdf, meanRange, weekOf,
  });
})();
