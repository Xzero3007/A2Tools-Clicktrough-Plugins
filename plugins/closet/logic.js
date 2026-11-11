// The Closet plugin's logic, without any page: the skins, the closet the game
// sends at login, the Black Cloud Merchant's stock, prices and the combine
// sums. Loaded by the page and by the tests (node).
(() => {
  const GOAL = 700; // the title "Empty Closet"
  const GRADES = { 1: "Common", 2: "Rare", 3: "Epic", 4: "Unique", 5: "above Unique", 7: "Special" }; // as the game's English client names them
  const KINA = 0x5d;
  /** Discount codes in an offer: code -> percent paid. */
  const PAID = { 0: 90, 1: 80, 2: 70, 3: 50 };
  const TABS = { 1: "Special", 2: "Tab 2", 3: "Skins", 4: "Pets" };
  const tabName = (tab) => (tab >= 100 ? TABS[tab % 100] || `Tab ${tab % 100}` : undefined);
  const WEAPONS = ["Greatsword", "Longsword", "Dagger", "Bow", "Spellbook", "Orb", "Mace", "Staff"];
  const ARMOUR = ["Helm", "Pauldrons", "Breastplate", "Gloves", "Greaves", "Boots", "Cloak"];
  const JEWELS = ["Necklace", "Earrings"];
  const kindOf = (slot) => (WEAPONS.includes(slot) ? "weapon" : ARMOUR.includes(slot) ? "armour" : JEWELS.includes(slot) ? "jewel" : "other");

  // The merchant's list price of a Common skin per slot; Rare costs 2.5
  // times that, Legend 10 times (the prices of the offers seen in the game).
  const BASE = { Greatsword: 96000, Longsword: 96000, Dagger: 96000, Bow: 96000, Spellbook: 96000, Orb: 96000, Mace: 96000, Staff: 96000,
    Breastplate: 64400, Greaves: 48000, Helm: 40320, Boots: 40320, Pauldrons: 40320, Necklace: 40320, Gloves: 31680, Cloak: 31680, Earrings: 31680 };
  const TIMES = { 1: 1, 2: 2.5, 3: 10 };
  function listPrice(grade, slot) {
    if (!TIMES[grade] || !BASE[slot]) return null;
    const p = BASE[slot] * TIMES[grade];
    return grade === 1 ? Math.ceil(p / 100) * 100 : Math.round(p / 100) * 100;
  }

  // Skin combining (NCSOFT's published chances): the chance of the next grade
  // and the fee per combine, by the grade put in.
  const COMBINE = {
    1: { up: 0.25, aura: 0.35, fee: 600 },
    2: { up: 0.2, aura: 0.3, fee: 1000 },
    3: { up: 0.15, aura: 0.25, fee: 6000 },
    4: { up: 0.1, aura: 0.15, fee: 30000 },
  };

  /** The skins (data.js) by item and by closet entry. */
  function index(data) {
    const items = new Map();
    const looks = new Map(); // closet id -> skin (the first item with it)
    const byLook = new Map(); // closet id -> every skin item with it
    for (const [k, [name, grade, slot, icon, look]] of Object.entries(data.skins)) {
      const s = { item: Number(k), name, grade, slot, icon, look: look || 0, kind: kindOf(slot) };
      items.set(s.item, s);
      if (s.look && !looks.has(s.look)) looks.set(s.look, s);
      if (s.look) byLook.set(s.look, [...(byLook.get(s.look) || []), s]);
    }
    return { items, looks, byLook };
  }

  /** The closet list at login (decoder closet-list): a Map closet id -> copies, or null when it does not look like one. */
  function closetFrom(data) {
    const list = data?.looks;
    if (!Array.isArray(list) || list.length < 1) return null;
    const ids = new Map();
    for (const e of list) {
      const id = e?.id;
      if (!Number.isInteger(id) || id < 10000000 || id > 99999999) return null;
      ids.set(id, Number.isInteger(e.value) ? e.value : 1);
    }
    return ids;
  }

  /** Closet entries added or changed (decoder closet-add): [{ id, count }], or null. */
  function addedFrom(data) {
    const list = data?.looks;
    if (!Array.isArray(list) || list.length < 1 || list.length > 64) return null;
    const out = [];
    for (const e of list) {
      if (!Number.isInteger(e?.id) || e.id < 10000000 || e.id > 99999999) return null;
      out.push({ id: e.id, count: Number.isInteger(e.value) ? e.value : 1 });
    }
    return out;
  }

  /**
   * Puts a stock frame's three parts back together: shop-a, -b, -c arrive in
   * that order for one frame; shop-more only when the frame was longer than a
   * stock (then it is none). Call `flush` a moment after.
   */
  /**
   * One tab's stock from the Black Cloud shop's frame (decoder "shop": tab,
   * count, the rest as hex): {tab, tabName, at, refresh, offers: [{offer,
   * item, price, original, discount, soldOut}]}; null when it isn't one.
   * Each offer is offer u32, item u32, left to buy u64 (1, or 0 once
   * bought), discount u8, currency u8 (Kinah), list price u64, price u64.
   * Offers are found by their prices (the price is the list price at the
   * discount), not at fixed places: a byte the game puts between offers, or
   * a new one, doesn't lose the tab. Then the time the stock changes.
   */
  function stockFromShop(d, at) {
    const name = tabName(d?.tab);
    if (!name || typeof d.body !== "string" || d.body.length % 2 || !/^[0-9a-f]*$/i.test(d.body)) return null;
    const b = new Uint8Array(d.body.length / 2);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(d.body.substr(i * 2, 2), 16);
    const dv = new DataView(b.buffer);
    const u64 = (o) => Number(dv.getBigUint64(o, true));
    const count = Number(d.count) || 0;
    const offers = [];
    const ids = new Set();
    let end = 0;
    for (let p = 16; p + 18 <= b.length && offers.length < Math.max(count, 1) * 2; p++) {
      const paid = PAID[b[p]];
      if (!paid || b[p + 1] !== KINA || p - 16 < end) continue;
      const original = u64(p + 2), price = u64(p + 10);
      if (!(original > 0 && original <= 1e9) || !(price > 0) || price !== Math.floor((original * paid) / 100)) continue;
      const offer = dv.getUint32(p - 16, true), item = dv.getUint32(p - 12, true), left = u64(p - 8);
      if (!(offer > 0) || !(item > 0) || ids.has(offer) || !(left === 0 || left === 1)) continue;
      ids.add(offer);
      offers.push({ offer, item, price, original, discount: 100 - paid, soldOut: left === 0 });
      end = p + 18;
      p = end - 1;
    }
    if (!offers.length || (count && offers.length > count)) return null;
    let refresh = 0;
    for (let p = end; p + 8 <= b.length; p++) {
      const v = u64(p);
      if (v > at && v <= at + 2 * 3600 * 1000) {
        refresh = v;
        break;
      }
    }
    if (!refresh) return null;
    return { tab: d.tab, tabName: name, at, refresh, offers };
  }

  /** An offer's skin and whether you have it: "new", "owned" or "unknown" (no closet entry known). */
  function statusOf(item, closet, ix, learned) {
    const s = ix.items.get(item);
    if (!s) return { skin: null, status: null };
    const look = s.look || learned?.[item] || 0;
    if (!look || !closet) return { skin: s, look, status: "unknown" };
    return { skin: s, look, status: closet.has(look) ? "owned" : "new" };
  }

  /** The skins you lack (one per closet entry), with list prices. */
  function missing(closet, ix) {
    const out = [];
    if (!closet) return out;
    for (const [look, s] of ix.looks) if (!closet.has(look)) out.push({ ...s, look, price: listPrice(s.grade, s.slot) });
    return out;
  }

  /**
   * What `need` more skins cost at the merchant: the cheapest ones at 50%
   * off, an average one at the average discount, the dearest at 10% off.
   */
  function costs(miss, need, avgPaid = 0.74) {
    const prices = miss.map((m) => m.price).filter((p) => p > 0).sort((x, y) => x - y);
    if (!prices.length || need <= 0) return null;
    const n = Math.min(need, prices.length);
    const sum = (arr) => arr.reduce((t, p) => t + p, 0);
    const mean = sum(prices) / prices.length;
    return {
      n,
      count: prices.length,
      cheapest: Math.round(sum(prices.slice(0, n)) * 0.5),
      average: Math.round(mean * n * avgPaid),
      dearest: Math.round(sum(prices.slice(-n)) * 0.9),
      all: Math.round(sum(prices) * avgPaid),
    };
  }

  /** Paid changes of the stock: 500 Kinah, then more for each one in the hour. */
  const REFRESH = [500, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 15000];

  /**
   * From the stocks seen: how many skin offers, how many were new to you then
   * (as recorded), and what a paid change brings.
   */
  function merchantStats(seen) {
    let offers = 0, fresh = 0;
    for (const s of seen) {
      offers += s.skins || 0;
      fresh += s.fresh || 0;
    }
    const rate = offers ? fresh / offers : null;
    const perStock = seen.length ? offers / seen.length : 0;
    // Chance that one paid change of a tab shows at least one new skin.
    const perChange = rate == null ? null : 1 - Math.pow(1 - rate, perStock || 10);
    return { stocks: seen.length, offers, fresh, rate, perChange,
      refreshCost: REFRESH.map((cost, i) => ({ n: i + 1, cost, perNew: perChange ? Math.round(cost / perChange) : null })) };
  }

  /** Copies beyond the first, per grade (the closet's count of each look): what combining can use. */
  function spares(closet, ix) {
    const out = {};
    if (!(closet instanceof Map)) return out;
    for (const [look, n] of closet) {
      const s = ix.looks.get(look);
      if (!s || !(n > 1 && n < 100)) continue;
      out[s.grade] = (out[s.grade] || 0) + n - 1;
    }
    return out;
  }

  const PER_COMBINE = 4; // skins put into one combine
  /** Kinah per new skin below which a way is plainly worth it, and below which it still beats the merchant. */
  const CHEAP = 50000, MERCHANT = 160000;

  /**
   * Combining: per grade put in, the chance a combine gives a skin you lack
   * at once, and what it gives counting the copies it leaves (a copy goes
   * into the next combine): new skins per combine and Kinah per new skin,
   * with a verdict. A combine takes 4 skins of a grade and gives one: the
   * next grade at the published chance, else a random skin of the same grade
   * (sources differ on that). Every skin of a grade is equally likely.
   * Unique's next grade is not in the data: taken as all lacking.
   */
  function combine(closet, ix, { lucky = false } = {}) {
    const byGrade = {};
    for (const [look, s] of ix.looks) {
      const g = (byGrade[s.grade] ||= { total: 0, owned: 0 });
      g.total++;
      if (closet?.has(look)) g.owned++;
    }
    const spare = spares(closet, ix);
    const rows = [];
    let mNext = 0; // new skins a copy of the next grade brings in the end
    for (const grade of [4, 3, 2, 1]) {
      const c = COMBINE[grade], same = byGrade[grade], next = byGrade[grade + 1];
      if (!same) continue;
      const up = lucky ? c.aura : c.up;
      const missNext = next ? (next.total - next.owned) / next.total : 1;
      const missSame = (same.total - same.owned) / same.total;
      const direct = up * missNext + (1 - up) * missSame;
      const m = (direct + up * (1 - missNext) * mNext) / (PER_COMBINE - (1 - up) * (1 - missSame));
      const yieldNew = PER_COMBINE * m;
      const kinah = yieldNew > 0 ? Math.round(c.fee / yieldNew) : null;
      const verdict = kinah == null ? "no" : direct < 0.02 && yieldNew > direct * 1.5 ? (kinah <= MERCHANT ? "feed" : "no") : kinah <= CHEAP ? "yes" : kinah <= MERCHANT ? "ok" : "no";
      rows.unshift({ grade, name: GRADES[grade], next: GRADES[grade + 1], up, fee: c.fee, assumed: !next,
        lackNext: next ? next.total - next.owned : null, totalNext: next ? next.total : null,
        lackSame: same.total - same.owned, totalSame: same.total,
        chance: direct, yieldNew, combines: yieldNew > 0 ? 1 / yieldNew : null, kinah, verdict,
        spares: spare[grade] || 0, possible: Math.floor((spare[grade] || 0) / PER_COMBINE), perMaterial: m });
      mNext = m;
    }
    return { rows, byGrade, spares: spare };
  }

  /** Extracting gear gives its look as a skin: one time in four (Common, Rare, Epic), one in ten (Unique). */
  const EXTRACT = { 1: 0.25, 2: 0.25, 3: 0.25, 4: 0.1 };
  /**
   * Per gear grade: the share of its looks you lack, the chance one
   * extraction gives a new skin, what the copy is worth for combining, and
   * a verdict: extract, only cheap pieces, or sell / dismantle instead.
   */
  function extraction(closet, gear, combined) {
    const rows = [];
    for (const [g, looks] of Object.entries(gear || {})) {
      const grade = Number(g);
      const p = EXTRACT[grade];
      if (!p || !looks.length) continue;
      const lack = closet ? looks.filter((l) => !closet.has(l)).length : looks.length;
      const share = lack / looks.length;
      const chance = p * share;
      const m = combined?.rows.find((r) => r.grade === grade)?.perMaterial || 0;
      const total = chance + p * (1 - share) * m;
      // Counting the copies too: a skin you have goes into a combine, which
      // can climb to a grade you lack (Rare to Epic).
      const verdict = total >= 0.05 ? "yes" : total >= 0.015 ? "cheap" : "no";
      // A piece's sale price up to which extracting it beats selling it
      // (a new skin worth about what the merchant asks for a cheap one).
      const breakEven = Math.round((total * MERCHANT) / 100) * 100;
      rows.push({ grade, name: GRADES[grade], p, lack, looks: looks.length, share, chance, total, breakEven, verdict });
    }
    return rows;
  }

  /**
   * Gear in the bag whose look you lack (the items event's inventory,
   * [[slot, item, count]]): what to extract rather than sell. Each piece
   * once per look, best grade first.
   */
  function bagGear(rows, closet, data, ix) {
    const pieces = data?.pieces || {};
    const out = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      const p = pieces[r?.[1]];
      if (!p || closet?.has(p[0])) continue;
      const [look, grade] = p;
      const was = out.get(look);
      if (was) { was.count += Number(r[2]) || 1; continue; }
      const skin = ix?.looks.get(look);
      out.set(look, { item: r[1], look, grade, count: Number(r[2]) || 1, chance: EXTRACT[grade] || 0, name: skin?.name || null, slot: skin?.slot || null, icon: skin?.icon || null });
    }
    return [...out.values()].sort((a, b) => b.chance - a.chance || b.grade - a.grade);
  }

  /**
   * The game's Auto Extract settings to choose (its dialog: Item Grade
   * Common, Rare, Epic, Unique): a grade is ticked when extracting it brings
   * new skins (Epic), or its gear is worth little anyway (Common); Rare is
   * left off to sell; Unique is left off too, its pieces are worth selling,
   * and the few with a new look are extracted by hand (the bag list).
   * Returns { on, grades: [{ grade, name, tick, hand, chance, why }] } or null.
   */
  function extractSettings(extracted) {
    if (!extracted?.length) return null;
    const grades = [];
    for (const g of [1, 2, 3, 4]) {
      const e = extracted.find((x) => x.grade === g);
      if (!e) continue;
      const every = e.total > 0 ? Math.round(1 / e.total) : null;
      const direct = e.chance > 0 ? Math.round(1 / e.chance) : null;
      const odds = every ? `1 piece in ${every} brings a new skin${direct && direct !== every ? ` (${direct} at once, the rest through combining its copies)` : ""}` : "no new skins left";
      const k = `${Math.round(e.breakEven / 100) / 10}k`;
      let tick, hand = false, why;
      if (g === 4) {
        tick = false;
        hand = e.verdict !== "no";
        why = hand ? `extract by hand only the pieces with a new look (the bag list), sell the rest: Unique sells well` : `sell: ${odds}`;
      } else if (e.verdict === "yes") { tick = true; why = `${odds}: you lack ${e.lack} of its ${e.looks} looks`; }
      else if (e.verdict === "cheap") { tick = true; why = `${odds}. Worth it while a piece sells for less than about ${k} Kinah; sell dearer ones`; }
      else { tick = false; why = `sell instead: only ${odds}`; }
      grades.push({ grade: g, name: GRADES[g], tick, hand, chance: e.total, every, breakEven: e.breakEven, why });
    }
    return { on: grades.some((x) => x.tick), grades };
  }

  /**
   * When to combine: now, with every 4 spare copies of a grade that pays,
   * lowest grade first (what climbs goes into the next grade's combines);
   * else how many more copies to collect. Waiting gains nothing: the chance
   * a combine is new depends only on what you lack (a Lucky Aura aside).
   */
  function combinePlan(combined) {
    const rows = (combined?.rows || []).filter((r) => r.verdict !== "no").sort((a, b) => a.grade - b.grade);
    if (!rows.length) return null;
    const now = rows.filter((r) => r.possible > 0).map((r) => ({ grade: r.grade, name: r.name, times: r.possible }));
    const collect = rows.filter((r) => r.verdict !== "feed" && r.possible === 0).map((r) => ({ grade: r.grade, name: r.name, more: PER_COMBINE - (r.spares % PER_COMBINE) }));
    return { kind: "plan", tone: now.length ? "good" : "mid", now, collect,
      why: "Combine whenever you have 4 spare copies of a grade, lowest grade first: what climbs goes straight into the next grade's combines. Waiting gains nothing, the chance of a new skin depends only on what you lack (except with a Lucky Aura)." };
  }

  /**
   * Short advice for the pop-up and the status floater: which grades to
   * combine, which only to climb, which not; which gear grades to extract
   * (auto-extract on) and which to sell. [{ kind, tone: good|mid|bad, text }]
   */
  function advice(combined, extracted) {
    const out = [];
    const pctOf = (x) => `${Math.round(x * 100)}%`;
    const k = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
    const order = { yes: 0, ok: 1, feed: 2, no: 3 };
    const rows = (combined?.rows || []).slice().sort((a, b) => order[a.verdict] - order[b.verdict] || (a.kinah ?? Infinity) - (b.kinah ?? Infinity));
    for (const r of rows) {
      const left = r.possible ? ` · your spares: ${r.possible}×` : "";
      const every = r.yieldNew > 0 ? Math.max(1, Math.round(1 / r.yieldNew)) : null;
      const base = { kind: "combine", grade: r.grade, name: r.name };
      if (r.verdict === "yes" || r.verdict === "ok") out.push({ ...base, tone: r.verdict === "yes" ? "good" : "mid", tag: "Combine", text: `new skin every ${every} combine${every === 1 ? "" : "s"} · ≈ ${k(r.kinah)} Kinah each${left}`,
        why: `Combining 4 ${r.name} skins gives a skin you lack about ${pctOf(r.yieldNew)} of the time (counting the copies that go into the next combines): one new skin every ${every} combines, about ${k(r.kinah)} Kinah in fees for each. ${r.possible ? `Your spare copies are enough for ${r.possible} combine${r.possible === 1 ? "" : "s"} now.` : "You have no 4 spare copies of this grade now."}` });
      else if (r.verdict === "feed") out.push({ ...base, tone: "mid", tag: `Only for ${r.next}`, text: `new skin only every ${Math.round(r.combines)} combines${left}`,
        why: `You have nearly every ${r.name} skin, so a failed combine almost never gives a new one. It pays only through the ${r.next} skins it gives one time in four, which feed the ${r.next} combines.` });
      else out.push({ ...base, tone: "bad", tag: "Stop", text: "no longer pays", why: `Combining ${r.name} almost never gives a skin you lack any more.` });
    }
    const plan = combinePlan(combined);
    if (plan) out.unshift(plan);
    const set = extractSettings(extracted);
    if (set) out.push({ kind: "extract", tone: "good", settings: set });
    return out;
  }

  // ---------- the Exchange (the players' market) ----------
  // Prices of skins on the Exchange, by item id: { price, listings, at, from }
  // ("game": read from the game as you browse it; "list": the hourly price
  // list, aion2.exchange's prices as Clicktrough copies them). The game's
  // reading comes first; the list only for what the game hasn't shown.

  /** The player's server in the price list's servers.json: the game's
   *  number (2305) is its game_server_key, its id 10000 more. */
  function exchangeServer(doc, gameServerId) {
    const sid = Number(gameServerId);
    const list = Array.isArray(doc?.servers) ? doc.servers : Array.isArray(doc) ? doc : [];
    if (!Number.isFinite(sid) || sid <= 0) return null;
    const ok = list.filter((s) => Number.isFinite(Number(s?.server_id ?? s?.id)));
    const s = ok.find((x) => Number(x.game_server_key ?? x.game) === sid) || ok.find((x) => Number(x.server_id ?? x.id) - 10000 === sid);
    return s ? Number(s.server_id ?? s.id) : null;
  }

  /** A price list file ({ snapshot, items: { id: [price, listings, ...] } })
   *  -> the skins' prices: Map item -> { price, listings, at, from: "list" }. */
  function listPrices(doc, ix) {
    if (!doc || typeof doc !== "object" || !doc.items || typeof doc.items !== "object") return null;
    const at = Date.parse(doc.snapshot || "") || Date.parse(doc.copied || "") || 0;
    const out = new Map();
    for (const [id, row] of Object.entries(doc.items)) {
      const item = Number(id);
      if (!ix.items.has(item) || !Array.isArray(row)) continue;
      const price = Number(row[0]);
      if (!(price > 0)) continue;
      out.set(item, { price, listings: Number(row[1]) > 0 ? Number(row[1]) : null, at, from: "list" });
    }
    return out;
  }

  /** The game's reading first, the list for the rest. */
  function mergeExchange(game, list) {
    const out = new Map(list || []);
    for (const [item, p] of game || []) out.set(item, p);
    return out;
  }

  /** The cheapest listing of a look (several items can give one look). */
  function exchangeOf(look, ix, prices) {
    let best = null;
    for (const s of ix.byLook?.get(look) || []) {
      const p = prices.get(s.item);
      if (p && (!best || p.price < best.price)) best = { ...p, item: s.item };
    }
    return best;
  }

  /** Worth buying on the Exchange: cheaper than the merchant asks for the
   *  skin before his discount (he may never offer it). */
  const goodBuy = (exPrice, merchantPrice) => exPrice > 0 && merchantPrice > 0 && exPrice < merchantPrice;

  /** The start of the stock's hour, as a key: which characters have looked since the change. */
  const hourOf = (refresh) => refresh - 3600 * 1000;

  const api = { GOAL, GRADES, TABS, WEAPONS, ARMOUR, JEWELS, REFRESH, COMBINE, tabName, kindOf, listPrice, index, closetFrom, addedFrom,
    stockFromShop, statusOf, missing, costs, merchantStats, combine, spares, extraction, bagGear, EXTRACT, advice, extractSettings, combinePlan, PER_COMBINE, CHEAP, MERCHANT, hourOf,
    exchangeServer, listPrices, mergeExchange, exchangeOf, goodBuy };
  globalThis.ClosetLogic = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
