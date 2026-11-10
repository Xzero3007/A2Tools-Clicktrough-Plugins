// The Closet plugin's logic, without any page: the skins, the closet the game
// sends at login, the Black Cloud Merchant's stock, prices and the combine
// sums. Loaded by the page and by the tests (node).
(() => {
  const GOAL = 700; // the title "Empty Closet"
  const GRADES = { 1: "Common", 2: "Rare", 3: "Legend", 4: "Unique", 5: "Epic", 7: "Special" };
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
    for (const [k, [name, grade, slot, icon, look]] of Object.entries(data.skins)) {
      const s = { item: Number(k), name, grade, slot, icon, look: look || 0, kind: kindOf(slot) };
      items.set(s.item, s);
      if (s.look && !looks.has(s.look)) looks.set(s.look, s);
    }
    return { items, looks };
  }

  /** The closet list at login (decoder closet-list): a Set of closet ids, or null when it does not look like one. */
  function closetFrom(data) {
    const list = data?.looks;
    if (!Array.isArray(list) || list.length < 1) return null;
    const ids = new Set();
    for (const e of list) {
      const id = e?.id;
      if (!Number.isInteger(id) || id < 10000000 || id > 99999999) return null;
      ids.add(id);
    }
    return ids;
  }

  /** Closet entries added or changed (decoder closet-add): their ids, or null. */
  function addedFrom(data) {
    const list = data?.looks;
    if (!Array.isArray(list) || list.length < 1 || list.length > 64) return null;
    const ids = [];
    for (const e of list) {
      if (!Number.isInteger(e?.id) || e.id < 10000000 || e.id > 99999999) return null;
      ids.push(e.id);
    }
    return ids;
  }

  /**
   * Puts a stock frame's three parts back together: shop-a, -b, -c arrive in
   * that order for one frame; shop-more only when the frame was longer than a
   * stock (then it is none). Call `flush` a moment after.
   */
  class StockFrames {
    constructor(onStock) {
      this.onStock = onStock;
      this.parts = null;
    }
    push(name, d, at) {
      if (name === "shop-a") {
        this.flush();
        this.parts = { a: d, b: null, c: null, at };
      } else if (name === "shop-b" && this.parts && !this.parts.b) this.parts.b = d;
      else if (name === "shop-c" && this.parts?.b && !this.parts.c) this.parts.c = d;
      else if (name === "shop-more") this.parts = null;
    }
    flush() {
      const p = this.parts;
      this.parts = null;
      if (p?.a && p.b && p.c) this.onStock(p);
    }
  }

  /**
   * One tab's stock from the three parts: {tab, tabName, at, refresh, offers:
   * [{offer, item, price, original, discount}]}; null when anything is off.
   */
  function stockFrom({ a, b, c, at }) {
    if (!tabName(a.tab) || a.count !== 10 || a.m36 !== 0x55 || b.m173 !== 0x55 || c.m310 !== 5 || c.tail !== 0) return null;
    if (!(c.refresh > at && c.refresh <= at + 2 * 3600 * 1000)) return null;
    const parts = [a, a, a, a, b, b, b, b, c, c];
    const ids = new Set();
    const offers = [];
    for (let n = 0; n < 10; n++) {
      const e = (k) => parts[n][`e${n}_${k}`];
      const paid = PAID[e("disc")];
      const original = e("orig"), price = e("price");
      if (!(e("offer") > 0) || !(e("item") > 0) || ids.has(e("offer")) || e("qty") !== 1 || e("cur") !== KINA || !paid) return null;
      if (!(original > 0 && original <= 1e9) || !(price > 0) || price !== Math.floor((original * paid) / 100)) return null;
      ids.add(e("offer"));
      offers.push({ offer: e("offer"), item: e("item"), price, original, discount: 100 - paid });
    }
    return { tab: a.tab, tabName: tabName(a.tab), at, refresh: c.refresh, offers };
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

  /**
   * Combining: per grade put in, how many of the next grade you lack, the
   * chance a combine gives a skin you lack, and the expected combines and
   * Kinah for one new skin. `lucky`: with a Lucky Aura. A failed combine is
   * taken to give a random skin of the same grade (it may be new too).
   */
  function combine(closet, ix, { lucky = false } = {}) {
    const byGrade = {};
    for (const [look, s] of ix.looks) {
      const g = (byGrade[s.grade] ||= { total: 0, owned: 0 });
      g.total++;
      if (closet?.has(look)) g.owned++;
    }
    const rows = [];
    for (const [g, c] of Object.entries(COMBINE)) {
      const grade = Number(g);
      const same = byGrade[grade], next = byGrade[grade + 1];
      if (!same || !next) continue;
      const up = lucky ? c.aura : c.up;
      const missNext = (next.total - next.owned) / next.total;
      const missSame = (same.total - same.owned) / same.total;
      const chance = up * missNext + (1 - up) * missSame;
      rows.push({ grade, name: GRADES[grade], next: GRADES[grade + 1], up, fee: c.fee,
        lackNext: next.total - next.owned, totalNext: next.total, lackSame: same.total - same.owned, totalSame: same.total,
        chance, combines: chance > 0 ? 1 / chance : null, kinah: chance > 0 ? Math.round(c.fee / chance) : null });
    }
    return { rows, byGrade };
  }

  /** The start of the stock's hour, as a key: which characters have looked since the change. */
  const hourOf = (refresh) => refresh - 3600 * 1000;

  const api = { GOAL, GRADES, TABS, WEAPONS, ARMOUR, JEWELS, REFRESH, COMBINE, tabName, kindOf, listPrice, index, closetFrom, addedFrom,
    StockFrames, stockFrom, statusOf, missing, costs, merchantStats, combine, hourOf };
  globalThis.ClosetLogic = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
