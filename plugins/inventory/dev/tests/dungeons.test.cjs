// The Inventory plugin's dungeon runs (dungeons.js): a run a visit, the
// reward boxes from the Odyle Energy spent, the drops by the game's reward
// pools, and how they compare with its drop rates.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
for (const f of ["data.js", "anomaly.js", "calc.js", "zones.js", "days.js", "dungeons.js"]) require(path.join(dir, f));
const C = globalThis.InventoryCalc;
const D = globalThis.InventoryDungeons;

const FT_HARD = 600023, FT_OTHER = 600021, TOWN = 1011;
const CLAYMORE = 110130037; // Enraged Kromede Claymore, Unique
const EGO = 610511015; // Wrathful Ego
const WINGS = 602460005; // Sealed Kromede Wings
const MEAT = 610531001; // Common
const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);
const gain = (at, item, n) => ({ changes: [[1, at, 1, item, n]] });

test("the rate table: Fire Temple Hard as the game shows it", () => {
  const r = D.rateOf(FT_HARD);
  assert.equal(r.name, "Fire Temple");
  assert.equal(r.groups.length, 3);
  const by = Object.fromEntries(r.groups.map((g) => [g.key, D.perBox(g)]));
  assert.ok(Math.abs(by.gear - 0.15) < 1e-12);
  assert.ok(Math.abs(by.wrath - 0.06) < 1e-12);
  assert.ok(Math.abs(by.art - 0.025) < 1e-12);
  assert.equal(D.groupOf(r, CLAYMORE), "gear");
  assert.equal(D.groupOf(r, 310130051), "gear", "the necklace's other id");
  assert.equal(D.groupOf(r, 310330037), null, "the ring is no Hard drop");
  assert.equal(D.groupOf(r, EGO), "wrath");
  assert.equal(D.groupOf(r, 630511013), "wrath", "a bound copy");
  assert.equal(D.groupOf(r, WINGS), "art");
  assert.equal(D.groupOf(r, 514310203), "art", "Artwork: Wrathful Fire Temple");
  assert.equal(D.rateOf(FT_OTHER), null);
  assert.equal(D.energyOf({ contentCounts: { 60000001: [600, 40] } }), 640);
  assert.equal(D.energyOf({}), null);
});

test("a run a visit: boxes from the energy, the gold that came in", () => {
  let runs = D.enter([], FT_HARD, T0);
  runs = D.addItems(runs, FT_HARD, gain(T0 + 60_000, MEAT, 5));
  runs = D.spend(runs, FT_HARD, 80, T0 + 600_000);
  runs = D.addItems(runs, FT_HARD, { changes: [[1, T0 + 601_000, 1, CLAYMORE, 1], [2, T0 + 601_000, 1, EGO, 1]] });
  assert.equal(runs.length, 1);
  assert.equal(D.boxes(runs[0]), 2);
  assert.deepEqual(runs[0].items, { [CLAYMORE]: 1, [EGO]: 1 });
  assert.equal(runs[0].gold, 2);
  // Out to town: closed; what comes in there is not the run's.
  runs = D.enter(runs, TOWN, T0 + 700_000);
  runs = D.addItems(runs, TOWN, gain(T0 + 710_000, CLAYMORE, 1));
  runs = D.spend(runs, TOWN, 40, T0 + 720_000);
  assert.equal(runs[0].open, false);
  assert.equal(runs[0].items[CLAYMORE], 1);
  assert.equal(runs[0].energy, 80);
  // The same zone again (a world event repeats it): the same run.
  runs = D.enter(runs, FT_HARD, T0 + 800_000);
  runs = D.enter(runs, FT_HARD, T0 + 801_000);
  assert.equal(runs.length, 2);
  // A visit without a box or drop is dropped once the next starts.
  runs = D.enter(runs, TOWN, T0 + 900_000);
  runs = D.enter(runs, FT_HARD, T0 + 1_000_000);
  assert.equal(runs.length, 2);
});

test("Poisson: the range, the p value, the rate's range", () => {
  assert.ok(Math.abs(D.cdf(3, 2) - 0.857123) < 1e-5);
  assert.equal(D.quantile(10, 0.025), 4);
  assert.equal(D.quantile(10, 0.975), 17);
  assert.ok(Math.abs(D.pValue(10, 10) - 1) < 1e-9);
  assert.ok(D.pValue(20, 10) < 0.01);
  assert.ok(D.pValue(3, 10) < 0.05);
  const [lo, hi] = D.meanRange(10);
  assert.ok(Math.abs(lo - 4.795) < 0.01 && Math.abs(hi - 18.39) < 0.02, `${lo} ${hi}`);
  assert.deepEqual(D.meanRange(0).map((x) => Math.round(x * 100) / 100), [0, 3.69]);
});

test("your drops against the game's: in range, above, below, and when it means something", () => {
  // 100 boxes: 15 Kromede pieces expected.
  assert.equal(D.compare(15, 100, 0.15).verdict, "in");
  assert.equal(D.compare(30, 100, 0.15).verdict, "above");
  assert.equal(D.compare(5, 100, 0.15).verdict, "below");
  const few = D.compare(1, 10, 0.15);
  assert.equal(few.verdict, "in");
  assert.equal(few.sure, false);
  assert.equal(few.need, 24, "34 boxes for 5 drops to expect");
  assert.equal(D.compare(0, 0, 0.15).verdict, "none");
});

test("the summary: per dungeon, all, the last 7 days, week by week", () => {
  let runs = [];
  // 20 runs of 2 boxes each over two weeks; a Kromede piece every 4th run.
  for (let i = 0; i < 20; i++) {
    const at = T0 - i * 86_400_000 * 0.7;
    runs = D.enter(runs, FT_HARD, at);
    runs = D.spend(runs, FT_HARD, 80, at + 1000);
    if (i % 4 === 0) runs = D.addItems(runs, FT_HARD, gain(at + 2000, CLAYMORE, 1));
    runs = D.enter(runs, TOWN, at + 5000);
  }
  runs.sort((a, b) => a.from - b.from);
  // A dungeon without rates.
  runs = D.enter(runs, FT_OTHER, T0 + 10_000);
  runs = D.spend(runs, FT_OTHER, 40, T0 + 11_000);
  const s = D.summarize(runs, T0 + 20_000);
  assert.equal(s.length, 2);
  const ft = s.find((x) => x.zone === FT_HARD);
  assert.equal(ft.total.runs, 20);
  assert.equal(ft.total.boxes, 40);
  const gear = ft.rows.find((r) => r.key === "gear");
  assert.equal(gear.found, 5);
  assert.ok(Math.abs(gear.expected - 6) < 1e-9);
  assert.equal(gear.verdict, "in");
  assert.equal(ft.rows.find((r) => r.key === "all").found, 5);
  assert.ok(ft.recent.total.boxes > 0 && ft.recent.total.boxes < 40);
  assert.ok(ft.weeks.length >= 2);
  assert.equal(ft.weeks.reduce((t, w) => t + w.total.boxes, 0), 40);
  const other = s.find((x) => x.zone === FT_OTHER);
  assert.equal(other.rows, null);
  assert.equal(other.total.boxes, 1);
  // The account: each run with whose it is.
  const acc = D.summarize({ A: runs, B: runs }, T0 + 20_000);
  assert.equal(acc.find((x) => x.zone === FT_HARD).total.boxes, 80);
  assert.equal(acc[0].last[0].who != null, true);
});
