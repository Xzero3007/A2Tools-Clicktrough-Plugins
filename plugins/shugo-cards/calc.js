// The Shugo Cards plugin's arithmetic, without the page: the card round read
// from its frame, what each card is worth on the market, and the statistics
// over the rounds kept (gold per card place, the most valuable card's place,
// a chi-square test of "every place is alike"). Node loads it for the tests.
(() => {
  const D = globalThis.INVENTORY_DATA || { items: {} };
  const GRADES = ["", "Common", "Rare", "Legend", "Unique", "Epic", "Mythic", "Special"];
  // Gold: Unique and up (the game draws Unique gold; Epic and Mythic above it).
  // Special (Soul Codex and the like) is not gear and not counted.
  const GOLD = new Set([4, 5, 6]);
  const PLACES = 5;

  const row = (id) => D.items[String(id)] || null;
  const name = (id) => row(id)?.[0] || `Item ${id}`;
  const grade = (id) => row(id)?.[1] || 0;
  const icon = (id) => (row(id)?.[2] ? `Icon_${row(id)[2]}` : null);
  const gold = (id) => GOLD.has(grade(id));
  const bound = (id) => /\(Bound\)/.test(name(id));
  // Currencies (Abyss Points, Enhance Stones, tokens) are items too; never sold.
  const currency = (id) => /^93[0-9]{7}$/.test(String(id));

  // ---------- the round's frame ----------
  /** The card round (decoder `round`, frame 0A 57, its body as hex) ->
   *  { key, event, cards: [{ place, tag, main: [[item, count]], bonus: [...],
   *  pickers: [{ name, times }] }] } or null when it does not read.
   *  The layout (2026-11-10): u16, u32 u32 (the round), u32 (the event), u8
   *  cards; each card a varint (its place, or 219 to 255 on some cards),
   *  its bonus layer (a list, mostly empty), its items (a list), u8 pickers, each
   *  picker 11 bytes, its name (varint length), u32, u32 times, u32, u8. A
   *  list is a varint count of (u32 item, u32 count). The cards come in their
   *  places from the left. */
  function parseRound(hex) {
    if (typeof hex !== "string" || hex.length < 30 || hex.length % 2) return null;
    const b = new Uint8Array(hex.length / 2);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
    let p = 0;
    const need = (n) => { if (p + n > b.length) throw new Error("short"); };
    const u8 = () => { need(1); return b[p++]; };
    const u16 = () => { need(2); const v = b[p] | (b[p + 1] << 8); p += 2; return v; };
    const u32 = () => { need(4); const v = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 2 ** 24; p += 4; return v; };
    const varint = () => {
      let v = 0;
      for (let s = 0; s < 35; s += 7) {
        const x = u8();
        v += (x & 127) * 2 ** s;
        if (x < 128) return v;
      }
      throw new Error("varint");
    };
    const list = () => {
      const n = varint();
      if (n > 64) throw new Error("list");
      const out = [];
      for (let i = 0; i < n; i++) out.push([u32(), u32()]);
      return out;
    };
    try {
      u16();
      const a = u32(), c = u32(), event = u32();
      const n = u8();
      if (n < 1 || n > 10) return null;
      const cards = [];
      for (let i = 0; i < n; i++) {
        const tag = varint();
        const bonus = list();
        const main = list();
        const np = u8();
        if (np > 8) return null;
        const pickers = [];
        for (let k = 0; k < np; k++) {
          need(11);
          p += 11;
          const len = varint();
          if (len > 64) return null;
          need(len);
          const nm = new TextDecoder().decode(b.subarray(p, p + len));
          p += len;
          u32();
          const times = u32();
          u32();
          u8();
          if (times < 1 || times > 10) return null;
          pickers.push({ name: nm, times });
        }
        cards.push({ place: i, tag, main, bonus, pickers });
      }
      return { key: `${a}-${c}`, event, cards };
    } catch {
      return null;
    }
  }

  /** A round to keep: the pickers' names become "you" or not (only yours is
   *  compared; no name is kept). `me`: the playing character's name or null
   *  (then a picker counts as you: the board is your own). */
  function keep(round, at, me, server = null) {
    if (!round) return null;
    return {
      key: round.key,
      at,
      event: round.event,
      // Your character that played it (yours only; the board is yours).
      who: me || null,
      server: Number.isFinite(Number(server)) && server != null ? Number(server) : null,
      cards: round.cards.map((c) => {
        let mine = 0, others = 0;
        for (const pk of c.pickers) {
          if (!me || pk.name === me) mine += pk.times;
          else others += pk.times;
        }
        const out = { place: c.place, main: c.main, mine };
        if (c.bonus.length) out.bonus = c.bonus;
        if (others) out.others = others;
        return out;
      }),
    };
  }

  /** Rounds an older version could not read, read again. The character
   *  that played is the one of yours among the pickers (by the names your
   *  rounds were kept under), else unknown. Gives the rounds to add and the
   *  entries still unreadable. */
  function adopt(odd, rounds) {
    const known = new Map();
    for (const r of rounds || []) if (r?.who) known.set(r.who, r.server ?? null);
    const add = [], still = [];
    for (const o of odd || []) {
      const parsed = parseRound(o?.body);
      if (!parsed) { still.push(o); continue; }
      if ((rounds || []).some((r) => r?.key === parsed.key) || add.some((r) => r.key === parsed.key)) continue;
      const names = parsed.cards.flatMap((c) => c.pickers.map((pk) => pk.name));
      const me = names.find((n) => known.has(n)) || null;
      add.push(keep(parsed, Number(o.at) || 0, me, me ? known.get(me) : null));
    }
    return { add, still };
  }

  // ---------- which event ----------
  // The card rounds come from two events with the same rewards: the Shugo
  // Festival (on the hour) and the Dimensional Invasion (at half past, not
  // every time). The round names its event by number; the ones known:
  const EVENTS = { 21070110: "shugo", 22020112: "di" }; // Shugo: FieldEvent_Defence_01 (2026-11-10 21:04); DI: 2026-11-11 16:34
  const KINDS = { shugo: "Shugo", di: "Dimensional Invasion" };
  /** A round's event: the person's choice for its number, else a known
   *  number, else a guess by the time (from 20 to 50 minutes past the hour:
   *  the Dimensional Invasion). { kind, sure }. */
  function kindOf(round, chosen = {}) {
    const k = chosen?.[round?.event] || EVENTS[round?.event];
    if (k === "shugo" || k === "di") return { kind: k, sure: true };
    const m = new Date(Number(round?.at) || 0).getMinutes();
    return { kind: m >= 20 && m < 50 ? "di" : "shugo", sure: false };
  }
  /** A character's key (server and name), "" for rounds before 0.3.0. */
  const charKey = (r) => (r?.who ? `${r.server ?? ""}:${r.who}` : "");
  /** Your characters seen in the rounds: [{ key, name, n }], most rounds first. */
  function characters(rounds) {
    const m = new Map();
    for (const r of rounds) {
      const k = charKey(r);
      const c = m.get(k) || { key: k, name: r.who || "", n: 0 };
      c.n++;
      m.set(k, c);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }
  /** One character's rounds ("all": the whole account). */
  const ofChar = (rounds, key) => (key == null || key === "all" ? rounds : rounds.filter((r) => charKey(r) === key));
  /** The rounds of one event ("shugo", "di"), or all ("all"). */
  const only = (rounds, which, chosen = {}) => (which === "shugo" || which === "di" ? rounds.filter((r) => kindOf(r, chosen).kind === which) : rounds);

  // ---------- worth ----------
  let byName = null;
  /** The ids of every item of a name (gear comes under several ids: a card's
   *  copy is often not the one traded on the market). */
  function sameName(id) {
    if (!byName) {
      byName = new Map();
      for (const [k, v] of Object.entries(D.items)) {
        const n = v?.[0];
        if (!n) continue;
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n).push(k);
      }
    }
    return byName.get(name(id)) || [];
  }
  /** A price: the lowest listing, else the average sale. Not the last seen
   *  of an item not listed now: unlisted gear keeps fantasy prices there
   *  (10,000,362 for Tempest Boots on 2026-11-10). */
  function unitOf(p, id, hist) {
    if (!p) return null;
    let unit = p.price ?? p.soldAvg ?? null;
    const A = globalThis.MarketAnomaly;
    const j = unit != null && A ? A.judge(p, A.usual(hist, id)) : null;
    if (j?.kind === "high") unit = j.ref;
    return unit;
  }
  /** One item's worth: { unit, total, guess } — the market's price of this
   *  id, else (guess) of the same item under another id; none for currencies
   *  and bound items. A price far above the usual counts at the usual. */
  function worth(item, count, prices, hist = null) {
    if (currency(item) || bound(item) || !prices) return { unit: null, total: null, guess: false };
    let unit = unitOf(prices.get(String(item)), item, hist);
    let guess = false;
    if (unit == null) {
      for (const other of sameName(item)) {
        const u = unitOf(prices.get(other), Number(other), hist);
        if (u != null) {
          unit = u;
          guess = true;
          break;
        }
      }
    }
    return { unit, total: unit == null ? null : unit * count, guess };
  }
  /** A card's worth: Kinah (the sellable items), whether a part is a guess,
   *  and the currencies by id. */
  function cardWorth(card, prices, hist = null, mainOnly = false) {
    let kinah = 0, guess = false, priced = 0;
    const cur = {};
    for (const [item, count] of [...(mainOnly ? [] : card.bonus || []), ...card.main]) {
      if (currency(item)) {
        cur[item] = (cur[item] || 0) + count;
        continue;
      }
      const w = worth(item, count, prices, hist);
      if (w.total != null) {
        kinah += w.total;
        priced++;
        guess ||= w.guess;
      }
    }
    return { kinah, guess, priced, cur };
  }

  // ---------- statistics ----------
  /** The chance of a chi-square this large or larger with 4 degrees of
   *  freedom (five places): e^(-x/2) (1 + x/2). */
  const pChi4 = (x) => Math.exp(-x / 2) * (1 + x / 2);
  /** "Are the five places alike?" over counts per place: { n, chi, p, best,
   *  share }. */
  function test(counts) {
    const n = counts.reduce((s, v) => s + v, 0);
    if (!n) return { n, chi: 0, p: 1, best: null, share: 0 };
    const e = n / counts.length;
    const chi = counts.reduce((s, v) => s + (v - e) ** 2 / e, 0);
    let best = 0;
    counts.forEach((v, i) => { if (v > counts[best]) best = i; });
    return { n, chi, p: pChi4(chi), best, share: counts[best] / n };
  }
  // How many cases a test of five places needs (5 %, 80 % power, Cohen):
  // a strong lead (one place about twice as often) and a moderate one.
  const NEED_STRONG = 50;
  const NEED_MODERATE = 130;
  /** The advice: a place only once the test says the places differ (p below
   *  5 %, with at least 25 cases, so each place expects 5). */
  function advise(t) {
    if (t.n >= 25 && t.p < 0.05) return { place: t.best, sure: true };
    return { place: null, sure: false, left: Math.max(0, NEED_STRONG - t.n), leftModerate: Math.max(0, NEED_MODERATE - t.n) };
  }

  /** Everything the page shows over the rounds: per place (cards, cards
   *  with gold in their own items, the most valuable card's place, your
   *  picks, the average Kinah), the gold found, the bonus layers, items seen,
   *  your Kinah against the best card's. A card counts whole, with its
   *  bonus layer: the round shows it on every card that has one, picked or
   *  not (2026-11-11: an unpicked card had one). */
  function stats(rounds, prices, hist = null) {
    const place = Array.from({ length: PLACES }, () => ({ cards: 0, gold: 0, best: 0, mine: 0, kinah: 0, bonus: 0 }));
    const golds = [];
    const items = new Map();
    let bonusCards = 0, bonusGold = 0, doubles = 0, yours = 0, bestSum = 0, full = 0, mineRounds = 0;
    for (const r of rounds) {
      if (!Array.isArray(r?.cards)) continue;
      const five = r.cards.length === PLACES;
      if (five) full++;
      let bestK = -1, bestAt = null, mineK = 0;
      for (const c of r.cards) {
        const w = cardWorth(c, prices, hist);
        const pl = five ? place[c.place] : null;
        if (pl) {
          pl.cards++;
          pl.kinah += w.kinah;
          if (c.mine) pl.mine++;
          if ([...c.main, ...(c.bonus || [])].some(([it]) => gold(it))) pl.gold++;
          if (c.bonus?.length) pl.bonus++;
        }
        if (w.kinah > bestK) { bestK = w.kinah; bestAt = c.place; }
        if (c.mine) mineK += w.kinah;
        if (c.mine >= 2) doubles++;
        if (c.bonus?.length) {
          bonusCards++;
          if (c.bonus.some(([it]) => gold(it))) bonusGold++;
        }
        const all = [...(c.bonus || []).map((x) => [...x, true]), ...c.main.map((x) => [...x, false])];
        const onCard = new Set();
        for (const [it, count, isBonus] of all) {
          const s = items.get(it) || { item: it, seen: 0, count: 0 };
          if (!onCard.has(it)) s.seen++;
          onCard.add(it);
          s.count += count;
          items.set(it, s);
          if (gold(it)) golds.push({ at: r.at, item: it, count, place: c.place, bonus: isBonus, mine: c.mine > 0 });
        }
      }
      if (five && bestAt != null && bestK > 0) place[bestAt].best++;
      if (bestK > 0) bestSum += bestK;
      yours += mineK;
      if (mineK > 0) mineRounds++;
    }
    for (const pl of place) pl.avg = pl.cards ? pl.kinah / pl.cards : null;
    golds.sort((a, b) => b.at - a.at);
    const goldTest = test(place.map((p) => p.gold));
    const bestTest = test(place.map((p) => p.best));
    return {
      rounds: rounds.length, full, place, golds, bonusCards, bonusGold, doubles, yours, bestSum, mineRounds,
      items: [...items.values()].sort((a, b) => b.seen - a.seen || name(a.item).localeCompare(name(b.item))),
      goldTest, bestTest, goldAdvice: advise(goldTest), bestAdvice: advise(bestTest),
    };
  }

  // ---------- prices (as the Inventory plugin reads them) ----------
  function readServers(res) {
    const list = Array.isArray(res?.servers) ? res.servers : Array.isArray(res) ? res : [];
    const out = [];
    for (const s of list) {
      const id = Number(s?.server_id ?? s?.id);
      if (!s || !Number.isFinite(id) || id <= 0) continue;
      const game = Number(s.game_server_key ?? s.game);
      out.push({ id, game: Number.isFinite(game) ? game : id % 10000, name: String(s.name || `Server ${id}`) });
    }
    return out;
  }
  const serverOf = (servers, gameServerId) => {
    const sid = Number(gameServerId);
    if (!Number.isFinite(sid) || sid <= 0) return null;
    return servers.find((s) => s.game === sid) || servers.find((s) => s.id - 10000 === sid) || null;
  };
  function readCopy(doc) {
    if (!doc || typeof doc !== "object" || !doc.items || typeof doc.items !== "object") return null;
    const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const prices = new Map();
    for (const [id, r] of Object.entries(doc.items)) {
      if (!Array.isArray(r)) continue;
      const price = n(r[0]) > 0 ? n(r[0]) : null;
      prices.set(String(id), { price, listings: price == null ? 0 : n(r[1]) ?? 0, sold: n(r[2]), soldAvg: n(r[3]), change: n(r[4]), last: n(r[5]) });
    }
    return prices.size ? { prices, snapshot: doc.snapshot || null } : null;
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

  globalThis.ShugoCalc = Object.freeze({
    GRADES, PLACES, NEED_STRONG, NEED_MODERATE, EVENTS, KINDS, kindOf, only, charKey, characters, ofChar, name, grade, icon, gold, currency,
    parseRound, keep, adopt, worth, cardWorth, pChi4, test, advise, stats, readServers, serverOf, readCopy, kina, short,
  });
})();
