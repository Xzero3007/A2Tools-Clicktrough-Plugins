// The Inventory plugin's sums (calc.js) on the generated data: what a
// character holds after the meter's items events, what it is worth, the
// drops of a session, and the limits.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
require(path.join(dir, "data.js"));
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
  assert.deepEqual(C.worth(MEAT, 2, prices, 10), { sellable: true, unit: 972, total: 1944, net: 1749, listings: 40, sold: 500 });
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
