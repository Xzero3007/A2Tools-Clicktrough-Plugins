// The Inventory plugin's farm days (days.js): a day from reset to reset,
// the Kina cap, where each gain came from, the reward keys, and the
// statistics over the days.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
for (const f of ["data.js", "anomaly.js", "calc.js", "zones.js", "days.js"]) require(path.join(dir, f));
const C = globalThis.InventoryCalc;
const F = globalThis.InventoryDays;

const MEAT = 610531001; // Common
const GOLD_SWORD = 110130002; // Wisdom Greatsword, Unique
const OPEN = 1011, DUNGEON = 600021, ABYSS = 22, CORRIDOR = 503001, SHUGO = 500007;
const T0 = Date.UTC(2026, 10, 11, 8, 0, 0); // an hour after the reset
const price = (item, n) => (item === GOLD_SWORD ? 50_000 * n : item === MEAT ? 100 * n : 0);
const gain = (at, item, n) => ({ changes: [[1, at, 1, item, n]] });

test("zones by kind, and the day from reset to reset", () => {
  assert.equal(F.zoneSource(OPEN), "open");
  assert.equal(F.zoneSource(DUNGEON), "dungeon");
  assert.equal(F.zoneSource(ABYSS), "abyss");
  assert.equal(F.zoneSource(CORRIDOR), "abyss");
  assert.equal(F.zoneSource(SHUGO), "shugo");
  assert.equal(F.zoneSource(500005), "invasion", "Incursion of the Spirits");
  assert.equal(F.zoneSource(7), "other", "an arena");
  assert.equal(F.zoneSource(null), "other");
  assert.equal(F.zoneName(DUNGEON), "Fire Temple");
  assert.equal(F.zoneName(0), "Zone not known yet");
  assert.equal(F.dayOf(T0), Date.UTC(2026, 10, 11, 7));
  assert.equal(F.dayOf(Date.UTC(2026, 10, 11, 6, 59)), Date.UTC(2026, 10, 10, 7), "before 07:00 UTC: the day before");
  assert.equal(F.dayName(F.dayOf(T0)), "20261111");
  assert.ok(F.isGold(GOLD_SWORD) && !F.isGold(MEAT) && !F.isGold(C.KINA));
});

test("drops by where they came from, gold with when and where", () => {
  let d = F.newDay(T0);
  d = F.addItems(d, gain(T0, MEAT, 3), OPEN, price);
  d = F.addItems(d, gain(T0 + 60_000, GOLD_SWORD, 1), OPEN, price);
  d = F.addItems(d, gain(T0 + 3_600_000, MEAT, 2), DUNGEON, price);
  d = F.addItems(d, gain(T0 + 3_660_000, C.KINA, 5000), DUNGEON, price);
  assert.deepEqual(d.src.open.items, { [MEAT]: 3, [GOLD_SWORD]: 1 });
  assert.equal(d.src.open.worth, 50_300);
  assert.equal(d.src.open.gold, 1);
  assert.equal(d.src.open.active, 60_000);
  assert.equal(d.src.dungeon.kinah, 5000);
  assert.equal(d.src.dungeon.active, 60_000, "the step from the open world to the dungeon is no play");
  assert.deepEqual(d.gold.map((g) => g.slice(0, 5)), [[T0 + 60_000, GOLD_SWORD, 1, "open", OPEN]]);
  // Bought (Kina spent) and crafted (materials used): no drops.
  d = F.addItems(d, { changes: [[1, T0 + 3_700_000, 1, C.KINA, -900], [2, T0 + 3_700_000, 1, MEAT, 1]] }, OPEN, price);
  d = F.addItems(d, { changes: [[1, T0 + 3_800_000, 1, MEAT, -5], [2, T0 + 3_800_000, 1, GOLD_SWORD, 1]] }, OPEN, price);
  assert.equal(d.src.open.n, 4);
  // Another day's change is not this day's.
  d = F.addItems(d, gain(T0 + 86_400_000, MEAT, 1), OPEN, price);
  assert.equal(d.src.open.n, 4);
});

test("the Kina cap: the counter, the time to it, and the farm after it", () => {
  let d = F.newDay(T0);
  // The inventory's Kina before the game's counter came: counted.
  d = F.addItems(d, gain(T0, C.KINA, 1000), OPEN, price);
  d = F.addCounter(d, 1000, T0 + 10, OPEN);
  assert.equal(d.src.open.kinah, 1000);
  // Then the counter: the inventory's Kina in the open world is not added twice.
  for (let i = 1; i <= 40; i++) {
    const at = T0 + i * 4 * 60_000;
    d = F.addItems(d, gain(at, C.KINA, 25_000), OPEN, price);
    d = F.addCounter(d, Math.min(1_000_000, 1000 + i * 25_000), at, OPEN);
  }
  assert.equal(d.src.open.kinah, 1_000_000);
  assert.ok(d.cap, "the cap reached");
  assert.equal(d.cap.active, 40 * 4 * 60_000, "the open world's time played up to the cap");
  // After the cap: drops go on, the Abyss's Kina too.
  d = F.addItems(d, gain(T0 + 200 * 60_000, GOLD_SWORD, 1), OPEN, price);
  d = F.addItems(d, gain(T0 + 300 * 60_000, C.KINA, 40_000), ABYSS, price);
  assert.equal(d.src.open.gold - d.cap.gold, 1);
  assert.equal(d.src.abyss.kinah, 40_000);
  const s = F.summary(d);
  assert.equal(s.cap.at, d.cap.at);
  assert.equal(s.counter, 1_000_000);
});

test("a reward key used: the rewards around it are that event's", () => {
  let d = F.newDay(T0);
  // A Dimensional Invasion in the open world: the cards' items come, then the key's count.
  d = F.addItems(d, { changes: [[1, T0, 1, GOLD_SWORD, 1], [2, T0, 1, MEAT, 2], [3, T0, 1, C.KINA, 3000]] }, OPEN, price);
  d = F.addCounter(d, 0, T0, OPEN);
  d = F.keyUsed(d, 8, T0 + 2000);
  assert.equal(d.src.invasion.gold, 1);
  assert.equal(d.src.invasion.items[MEAT], 2);
  assert.equal(d.src.open.gold, 0);
  assert.ok(!d.src.open.items[MEAT]);
  assert.equal(d.gold[0][3], "invasion");
  // The Shugo Festival's key first, its rewards after.
  d = F.keyUsed(d, 7, T0 + 600_000);
  d = F.addItems(d, gain(T0 + 605_000, MEAT, 4), OPEN, price);
  assert.equal(d.src.shugo.items[MEAT], 4);
  // Long after: the zone again.
  d = F.addItems(d, gain(T0 + 900_000, MEAT, 1), OPEN, price);
  assert.equal(d.src.open.items[MEAT], 1);
});

test("prices that come later value what came before them", () => {
  let d = F.newDay(T0);
  d = F.addItems(d, gain(T0, GOLD_SWORD, 2), OPEN, () => null);
  assert.equal(d.src.open.worth, 0);
  assert.equal(d.gold[0][5], null);
  d = F.settle(d, price);
  assert.equal(d.src.open.worth, 100_000);
  assert.equal(d.gold[0][5], 100_000);
  assert.deepEqual(d.src.open.unpriced, {});
});

test("statistics: readiness, trend and change", () => {
  const day = (i, kinah, hours, gold) => ({
    day: F.dayOf(T0) + i * 86_400_000,
    src: { open: { kinah, active: hours * 3_600_000, gold, worth: 1000 * gold, n: 10 } },
    cap: { active: hours * 3_600_000, kinah }, gold: [],
  });
  // Three days: not meaningful yet.
  let sums = [0, 1, 2].map((i) => day(i, 1_000_000, 4, 1));
  let pts = F.points(sums, "open", "kinah");
  assert.equal(pts.length, 3);
  assert.equal(pts[0].value, 250_000);
  let r = F.readiness(pts, "kinah");
  assert.equal(r.ready, false);
  assert.equal(r.needDays, 4);
  // Twenty days, faster each day: a rising trend.
  sums = Array.from({ length: 20 }, (_, i) => day(i, 1_000_000, 5 - i * 0.1 + (i % 3) * 0.05, 2));
  pts = F.points(sums, "open", "kinah");
  const tr = F.trend(pts);
  assert.ok(tr.p < 0.001 && tr.perWeek > 0, JSON.stringify(tr));
  assert.ok(F.readiness(pts, "kinah").ready);
  // Steady with noise: no trend.
  sums = Array.from({ length: 20 }, (_, i) => day(i, 1_000_000, 4 + ((i * 7) % 5) * 0.1, 2));
  assert.ok(F.trend(F.points(sums, "open", "kinah")).p > 0.05);
  // Gold: 2 a day, then 6 a day in the last 7 days: a change.
  sums = Array.from({ length: 20 }, (_, i) => day(i, 1_000_000, 4, i >= 13 ? 6 : 2));
  pts = F.points(sums, "open", "gold");
  const g = F.goldChange(pts);
  assert.ok(g.p < 0.001 && g.rel > 1, JSON.stringify(g));
  assert.ok(F.readiness(pts, "gold").ready);
  // Too few gold items: not meaningful, however many days.
  sums = Array.from({ length: 10 }, (_, i) => day(i, 1_000_000, 4, i % 4 ? 0 : 1));
  r = F.readiness(F.points(sums, "open", "gold"), "gold");
  assert.equal(r.ready, false);
  assert.equal(r.needGold, 27);
  // Half an hour or more for a day to count.
  assert.equal(F.points([day(0, 1000, 0.2, 0)], "open", "kinah").length, 0);
  // The t distribution: t = 2.086 with 20 degrees of freedom is p = 0.05.
  assert.ok(Math.abs(F.pT(2.086, 20) - 0.05) < 0.001);
});

test("the whole account: the characters' days added up", () => {
  const D0 = F.dayOf(T0);
  const a = [{ day: D0, start: T0, last: T0 + 9e6, src: { open: { kinah: 1_000_000, active: 4 * 3_600_000, gold: 2, worth: 100, n: 50 } }, cap: { at: T0 + 8e6, active: 4 * 3_600_000, kinah: 1_000_000 }, counter: 1_000_000, gold: [[T0, GOLD_SWORD, 1, "open", OPEN, 50_000]] }];
  const b = [
    { day: D0, start: T0 + 1e6, last: T0 + 5e6, src: { open: { kinah: 300_000, active: 2 * 3_600_000, gold: 1, worth: 40, n: 20 }, abyss: { kinah: 9000, active: 3_600_000, gold: 0, worth: 5, n: 3 } }, cap: null, counter: 300_000, gold: [] },
    { day: D0 + 86_400_000, src: { open: { kinah: 1_000_000, active: 6 * 3_600_000, gold: 0, worth: 0, n: 1 } }, cap: { active: 6 * 3_600_000, kinah: 1_000_000 }, counter: 1_000_000, gold: [] },
  ];
  const m = F.mergeSums({ Anna: a, Bert: b });
  assert.equal(m.length, 2);
  const d = m[0];
  assert.equal(d.chars, 2);
  assert.equal(d.capped, 1);
  assert.equal(d.src.open.kinah, 1_300_000);
  assert.equal(d.src.open.gold, 3);
  assert.equal(d.src.abyss.kinah, 9000);
  assert.equal(d.counter, 1_300_000);
  assert.deepEqual(d.gold[0].slice(-1), ["Anna"]);
  // Kina per hour: Anna up to her cap, Bert's open world (no cap): 1.3M in 6 h.
  const p = F.part(d, "open");
  assert.equal(Math.round(F.METRICS.kinah.value(p)), Math.round(1_300_000 / 6));
  // Hours to the cap: on average of those who reached it.
  assert.equal(F.METRICS.toCap.value(p), 4);
  assert.equal(F.METRICS.toCap.value(F.part(m[1], "open")), 6);
});
