// The Inventory plugin's dungeon runs (dungeons.js): a run a visit, the
// reward boxes from the Odyle Energy spent, the drops by the game's reward
// pools, and how they compare with its drop rates.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
for (const f of ["data.js", "anomaly.js", "calc.js", "zones.js", "days.js", "dungeon-rates.js", "dungeons.js"]) require(path.join(dir, f));
const C = globalThis.InventoryCalc;
const D = globalThis.InventoryDungeons;

const FT_HARD = 600023, FT_OTHER = 600021, TOWN = 1011;
const CLAYMORE = 110130037; // Enraged Kromede Claymore, Unique
const EGO = 610511015; // Wrathful Ego
const WINGS = 602460005; // Sealed Kromede Wings
const MEAT = 610531001; // Common
const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);
const gain = (at, item, n) => ({ changes: [[1, at, 1, item, n]] });

test("the rate table: the game's, Fire Temple Hard as its window shows it", () => {
  const r = D.rateOf(FT_HARD);
  assert.equal(r.name, "Fire Temple");
  assert.equal(r.level, "Hard");
  assert.equal(D.rateOf(FT_OTHER).level, "Normal");
  assert.equal(D.rateOf(600031), null, "Draupnir Normal: its drops are all better elsewhere");
  assert.equal(D.rateOf(600082).name, "Abyssal Forge: Ludra");
  const by = Object.fromEntries(r.groups.map((g) => [g.key, g]));
  // The window: pool 1 is 7.5 % (Kromede's Desire) + 3.75 % twice, its
  // weights 8 × 5.747285 %, 13.792054 %, 17.241853 % and the ring's rest.
  const kromede = by["Unique-gear"].items.filter(([, n]) => /^Enraged Kromede/.test(n));
  assert.equal(kromede.length, 11, "the ring is in pool 1 too");
  const claymore = kromede.find(([, n]) => n === "Enraged Kromede Claymore")[2];
  const fromWindow = 1 - (1 - 0.075 * 0.05747285) * (1 - 0.0375 * 0.05747285) ** 2;
  assert.ok(Math.abs(claymore - fromWindow) < 1e-7, `${claymore} ${fromWindow}`);
  assert.ok(Math.abs(D.perBox(by["Unique-gear"]) - 0.15) < 0.002, `${D.perBox(by["Unique-gear"])}`);
  assert.ok(Math.abs(D.perBox(by.wrath) - 0.06) < 1e-12);
  assert.ok(by["Legend-gear"].perBox > 3, "the Corrupted Judicator set: more than 3 pieces a box");
  assert.equal(by["Legend-gear"].unrated, true, "it drops every box, several times: no expected count");
  assert.equal(!!by["Unique-gear"].unrated, false);
  assert.equal(D.groupOf(r, CLAYMORE), "Unique-gear", "by name: the window's other id");
  assert.equal(D.groupOf(r, 310130051), "Unique-gear");
  assert.equal(D.groupOf(r, 310330053), "Unique-gear", "the ring");
  assert.equal(D.groupOf(r, EGO), "wrath");
  assert.equal(D.groupOf(r, 630511013), "wrath", "a bound copy");
  assert.equal(D.groupOf(r, WINGS), "Unique-other");
  assert.equal(D.groupOf(r, MEAT), null);
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
  runs = D.enter(runs, 600031, T0 + 12_000);
  runs = D.spend(runs, 600031, 40, T0 + 13_000);
  const s = D.summarize(runs, T0 + 20_000);
  assert.equal(s.length, 3);
  assert.equal(s.find((x) => x.zone === 600031).rows, null, "no rates: no verdict");
  const ft = s.find((x) => x.zone === FT_HARD);
  assert.equal(ft.total.runs, 20);
  assert.equal(ft.total.boxes, 40);
  const gear = ft.rows.find((r) => r.key === "Unique-gear");
  assert.equal(gear.found, 5);
  assert.ok(Math.abs(gear.expected - 40 * D.perBox(D.rateOf(FT_HARD).groups.find((g) => g.key === "Unique-gear"))) < 1e-9);
  assert.equal(gear.verdict, "in");
  assert.equal(ft.rows.find((r) => r.main).found, 5);
  // A count between the two models (one roll, three bosses') is in range.
  assert.equal(D.compare(38, 100, 0.42, 0.364).verdict, "in");
  assert.equal(D.compare(22, 100, 0.42, 0.364).verdict, "below");
  assert.ok(ft.recent.total.boxes > 0 && ft.recent.total.boxes < 40);
  assert.ok(ft.weeks.length >= 2);
  assert.equal(ft.weeks.reduce((t, w) => t + w.total.boxes, 0), 40);
  const other = s.find((x) => x.zone === FT_OTHER);
  assert.equal(other.rows.length > 1, true, "Fire Temple Normal has the game's rates too");
  assert.equal(other.total.boxes, 1);
  // The account: each run with whose it is.
  const acc = D.summarize({ A: runs, B: runs }, T0 + 20_000);
  assert.equal(acc.find((x) => x.zone === FT_HARD).total.boxes, 80);
  assert.equal(acc[0].last[0].who != null, true);
});
