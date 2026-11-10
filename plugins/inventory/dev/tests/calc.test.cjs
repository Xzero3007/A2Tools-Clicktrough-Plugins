// The Inventory plugin's sums (calc.js) on the generated data: what a
// character holds after the meter's items events, what it is worth, the
// drops of a session, and the limits.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
require(path.join(dir, "data.js"));
require(path.join(dir, "anomaly.js"));
require(path.join(dir, "calc.js"));
const D = globalThis.INVENTORY_DATA;
const C = globalThis.InventoryCalc;

const MEAT = 610531001, SPIRITSTONE = 610530014, SCROLL = 530560001, TICKET = 503700034;

test("the data: names, grades, icons and the tickets", () => {
  assert.ok(Object.keys(D.items).length > 9000);
  assert.equal(C.name(MEAT), "Fresh Raw Meat");
  assert.equal(C.name(C.KINA), "Kina");
  assert.equal(C.name(C.ABYSS_POINTS), "Abyss Points");
  assert.match(C.icon(MEAT), /^Icon_Item_Craft_/);
  // Gear has the game's own icon names (Aion2Data shortens some).
  assert.match(C.icon(110130002), /^Icon_Equip_WP_/);
  assert.ok(C.bound(SCROLL) && C.bound(TICKET) && !C.bound(MEAT));
  assert.ok(C.currency(C.KINA) && !C.currency(MEAT));
  assert.equal(D.tickets["4"][2], 14, "Nightmare: 14 at most");
  assert.equal(C.name(999999999), "Item 999999999");
});

test("a world entry is the truth; without one the changes add up", () => {
  const entry = { owner: "A", snapshotAt: 100, containers: { 1: [[0, C.KINA, 500], [17, MEAT, 1], [18, MEAT, 2]], 15: [[3, SPIRITSTONE, 40]], 2: [[1, MEAT, 9]] }, changes: [] };
  const a = C.apply(null, entry);
  assert.deepEqual(a.inv, { [C.KINA]: 500, [MEAT]: 3 });
  assert.deepEqual(a.char, { [SPIRITSTONE]: 40 });
  assert.deepEqual(a.acc, { [MEAT]: 9 });
  assert.equal(a.exactAt, 100);
  // The meter started later: its changes with a known count add up.
  const b = C.apply(a, { owner: null, snapshotAt: null, containers: { 1: [[17, MEAT, 4]] }, changes: [[1, 200, 1, MEAT, 1], [2, 200, 1, SCROLL, null]] });
  assert.equal(b.inv[MEAT], 4);
  assert.equal(b.char[SPIRITSTONE], 40, "the storage stays as it was");
  assert.equal(b.inv[SCROLL], undefined, "not seen in the meter's slots: not guessed");
  const c = C.apply(b, { snapshotAt: null, containers: { 1: [[28, SCROLL, 310]] }, changes: [[3, 300, 1, SCROLL, null]] });
  assert.equal(c.inv[SCROLL], 310, "at least what the meter sees");
  const d = C.apply(c, { snapshotAt: null, containers: {}, changes: [[4, 400, 1, MEAT, -4]] });
  assert.equal(d.inv[MEAT], undefined, "all gone");
});

test("worth: sellable when traded and not bound, the lowest listing first", () => {
  const prices = new Map([
    [String(MEAT), { price: 972, listings: 40, sold: 500, soldAvg: 990, last: 990 }],
    [String(SPIRITSTONE), { price: null, listings: 0, sold: 30, soldAvg: 1400, last: 1400 }],
    [String(SCROLL), { price: 50, listings: 1 }],
  ]);
  assert.deepEqual(C.worth(MEAT, 2, prices, 10), { sellable: true, unit: 972, total: 1944, net: 1749, listings: 40, sold: 500, odd: null, listed: 972 });
  assert.equal(C.worth(SPIRITSTONE, 3, prices).unit, 1400, "no listing now: the average sale");
  assert.equal(C.worth(SCROLL, 1, prices).sellable, false, "bound");
  assert.equal(C.worth(C.KINA, 9, prices).sellable, false);
  const { rows, sum } = C.list({ [MEAT]: 2, [SPIRITSTONE]: 3, [SCROLL]: 1, [C.KINA]: 10 }, prices, { sort: "value" });
  assert.deepEqual(rows.map((r) => r.item), [SPIRITSTONE, MEAT, SCROLL, C.KINA], "by value, currencies last");
  assert.equal(sum.total, 4200 + 1944);
  assert.equal(sum.sellable, 2);
  assert.deepEqual(C.list({ [MEAT]: 2, [SCROLL]: 1 }, prices, { sellableOnly: true }).rows.map((r) => r.item), [MEAT]);
  assert.deepEqual(C.list({ [MEAT]: 2, [SCROLL]: 1 }, prices, { search: "scroll" }).rows.map((r) => r.item), [SCROLL]);
});

test("drops: what came in, Kinah and Abyss Points, loot matched either way", () => {
  let s = { start: 1000, items: {}, loot: {} };
  // Inventory first, the pickup after.
  s = C.addDrops(s, { changes: [[1, 2000, 1, MEAT, 1], [2, 2000, 1, C.KINA, 306], [3, 2100, 1, C.ABYSS_POINTS, 350]], pickups: [] });
  s = C.addDrops(s, { changes: [], pickups: [[4, 2600, MEAT, 1]] });
  assert.equal(s.items[MEAT], 1);
  assert.equal(s.loot[MEAT], 1);
  assert.equal(s.kinah, 306);
  assert.equal(s.abyss, 350);
  // The pickup first; a storage item (container 15), a loss and a change
  // before the session count for nothing.
  s = C.addDrops(s, { changes: [], pickups: [[5, 5000, SPIRITSTONE, 1]] });
  s = C.addDrops(s, { changes: [[6, 5400, 1, SPIRITSTONE, 1], [7, 5400, 15, MEAT, 5], [8, 5400, 1, SCROLL, -1], [9, 500, 1, MEAT, 3], [10, 5500, 1, MEAT, null]], pickups: [] });
  assert.equal(s.items[SPIRITSTONE], 1);
  assert.equal(s.loot[SPIRITSTONE], 1);
  assert.equal(s.items[MEAT], 1);
  assert.equal(s.items[SCROLL], undefined);
  // Bought (no pickup): counted, not loot.
  s = C.addDrops(s, { changes: [[11, 9000, 1, SCROLL, 10]], pickups: [] });
  assert.equal(s.items[SCROLL], 10);
  assert.equal(s.loot[SCROLL], undefined);
});

test("limits and tickets from the character", () => {
  const ch = { kinahToday: 434900, abyssPoints: [795997, 2500000], contentCounts: { 4: [2, 0], 101: [9, 2], 60000001: [500, 100] }, contentTimes: { 3: [5400000, 1] } };
  assert.deepEqual(C.limits(ch).map((l) => [l.key, l.value, l.max]), [["kinah", 434900, 1000000], ["abyss", 795997, 2500000]]);
  const t = C.tickets(ch);
  assert.deepEqual(t.map((x) => x.id).sort(), ["101", "3", "4"], "Odyle Energy is left to Roster");
  const n = t.find((x) => x.id === "4");
  assert.deepEqual([n.left, n.max, n.reset], [2, 14, "d"]);
  assert.equal(t.find((x) => x.id === "101").extra, 2);
  assert.ok(t.find((x) => x.id === "3").time);
});

test("numbers and keys", () => {
  assert.equal(C.kina(4034753), "4,034,753");
  assert.equal(C.short(3_800_000), "3.80M");
  assert.equal(C.short(740_000), "740K");
  assert.match(C.charKey(1301, "Serasツ"), /^c-1301-[a-z0-9]+$/);
  assert.notEqual(C.charKey(1301, "A"), C.charKey(1301, "B"));
});

test("a lowest listing far above the usual price counts at the usual price", () => {
  const CLOAK = 210740008; // Destruction Cloak, 10 Nov: one listing at 10,000,123
  const prices = C.readCopy({ items: { [CLOAK]: [10000123, 1, null, null, 14900.33, 10000123] } }).prices;
  let w = C.worth(CLOAK, 7, prices);
  assert.equal(w.listed, 10000123);
  assert.equal(w.odd.kind, "high");
  assert.ok(Math.abs(w.unit - 66667) < 5 && w.total === w.unit * 7);
  // With the copy's course: its usual price.
  const hist = globalThis.MarketAnomaly.readHistory({ v: 1, hours: [], days: ["a", "b", "c", "d"], items: { [CLOAK]: { h: [], d: [60000, 65000, 70000, 10000123] } } });
  w = C.worth(CLOAK, 7, prices, 10, hist);
  assert.equal(w.unit, 65000);
  assert.equal(C.list({ [CLOAK]: 7 }, prices, { hist }).rows[0].total, 455000);
});

const STAFF = 110860021, OHKRA = 610680050, ODYLE = 610610013, CUBE_KEY = 630900003, SHARD = 533460004, CODEX = 535400001, SILENTIUM = 630840002;

test("drops: gear broken down at once is no drop; its stones and bound Kinah are counted", () => {
  let s = C.newSession(1000);
  s = C.addDrops(s, { changes: [[1, 2000, 1, STAFF, 1]], pickups: [[2, 1990, STAFF, 1]] });
  assert.equal(s.loot[STAFF], 1);
  s = C.addDrops(s, { changes: [[3, 2100, 1, C.KINA_BOUND, -1000], [4, 2100, 1, STAFF, -1], [5, 2100, 1, C.ENHANCE_STONE, 18]], pickups: [] });
  assert.equal(s.items[STAFF], undefined);
  assert.equal(s.loot[STAFF], undefined);
  assert.deepEqual(s.dismantled, { pieces: 1, stones: 18, kinahBound: 1000 });
  // Throwing an item away is no dismantling.
  s = C.addDrops(s, { changes: [[6, 3000, 1, MEAT, 2]], pickups: [] });
  s = C.addDrops(s, { changes: [[7, 3100, 1, MEAT, -2]], pickups: [] });
  assert.equal(s.dismantled.pieces, 1);
});

test("drops: gathering counted from the game's result, either order", () => {
  let s = C.newSession(1000);
  s = C.addGather(s, { great: 0, kind: 58, node: 7, item: OHKRA, amount: 1, bonus: 0 }, 2000, "Altgard · Immortal Isle");
  s = C.addDrops(s, { changes: [[1, 2050, 1, OHKRA, 1]], pickups: [] });
  s = C.addDrops(s, { changes: [[2, 9000, 1, OHKRA, 6]], pickups: [] });
  s = C.addGather(s, { great: 1, kind: 58, node: 7, item: OHKRA, amount: 3, bonus: 3 }, 9060, "Altgard · Immortal Isle");
  s = C.addGather(s, { great: 0, kind: 58, node: 9, item: ODYLE, amount: 1, bonus: 1 }, 15000, null);
  s = C.addDrops(s, { changes: [[3, 15100, 1, ODYLE, 2]], pickups: [] });
  assert.equal(s.gathered[OHKRA], 7);
  assert.equal(s.gathered[ODYLE], 2);
  assert.deepEqual([s.gather.n, s.gather.great, s.gather.amount, s.gather.bonus, s.gather.spots], [3, 1, 5, 4, 2]);
  assert.deepEqual(s.gather.byArea, { "Altgard · Immortal Isle": { n: 2, count: 7 }, Unknown: { n: 1, count: 2 } });
  assert.deepEqual(C.bySource(s).other, {});
  // Played: the steps between doings, a pause of 5 minutes or more not.
  assert.equal(s.active, 15100 - 2000);
  s = C.addDrops(s, { changes: [[4, 15100 + 10 * 60_000, 1, MEAT, 1]], pickups: [] });
  assert.equal(s.active, 15100 - 2000);
  assert.equal(C.bySource(s).other[MEAT], 1);
});

test("drops: a key's chest and many items at once are rewards", () => {
  let s = C.newSession(1000);
  s = C.addDrops(s, { changes: [[1, 5000, 1, CUBE_KEY, -1]], pickups: [] });
  s = C.addDrops(s, { changes: [[2, 5300, 1, SILENTIUM, 10]], pickups: [] });
  assert.equal(s.reward[SILENTIUM], 10);
  s = C.addDrops(s, { changes: [[3, 60000, 1, SHARD, 120], [4, 60000, 1, CODEX, 5], [5, 60000, 1, MEAT, 1]], pickups: [] });
  assert.equal(s.reward[SHARD], 120);
  assert.equal(s.reward[MEAT], 1);
});

test("sessions: a break starts a new one, a session kept for the list, older sessions read", () => {
  const H = 3_600_000;
  let s = C.newSession(0);
  assert.equal(C.isBreak(s, 2 * H, 3 * H), false);
  s = C.addDrops(s, { changes: [[1, 1000, 1, MEAT, 1]], pickups: [] });
  assert.equal(C.isBreak(s, 1000 + 2 * H, 3 * H), false, "a change of character, an hour or two off: the same session");
  assert.equal(C.isBreak(s, 1000 + 4 * H, 3 * H), true);
  assert.equal(C.isBreak(s, 1000 + 4 * H, 0), false, "only by hand");
  const sum = C.summary(s);
  assert.equal(sum.end, 1000);
  assert.equal(sum.recent, undefined);
  // A version 1 session (no last doing): over at the first doing after the break.
  const old = C.normalize({ start: 5, items: { [MEAT]: 3 }, loot: { [MEAT]: 1 }, kinah: 9, abyss: 0, recent: [{ at: 6, item: MEAT, delta: 1, loot: true }], pickups: [] });
  assert.equal(old.recent[0].src, "loot");
  assert.equal(old.recent[0].left, 1);
  assert.equal(C.isBreak(old, 5 + 4 * H, 3 * H), true);
  assert.deepEqual(C.bySource(old).other, { [MEAT]: 2 });
});

test("the gathering decoder reads the game's layout (with the meter's decoder.rs)", { skip: !require("node:fs").existsSync(path.join(__dirname, "gather-events.jsonl")) && "no meter source given" }, () => {
  const lines = require("node:fs").readFileSync(path.join(__dirname, "gather-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const got = lines.filter((l) => l.event === "decoded:gathered").map((l) => l.data);
  assert.deepEqual(got, [
    { great: 1, kind: 58, node: 129, item: OHKRA, amount: 3, bonus: 3 },
    { great: 0, kind: 58, node: 5, item: ODYLE, amount: 1, bonus: 1 },
  ]);
});
