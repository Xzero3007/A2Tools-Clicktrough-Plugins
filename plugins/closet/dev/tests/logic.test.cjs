const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require(path.join(process.env.PLUGIN_DIR, "data.js"));
const L = require(path.join(process.env.PLUGIN_DIR, "logic.js"));
const ix = L.index(globalThis.CLOSET_DATA);
const names = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json")));
const WHEN = 1893481200000;

// Each frame's events, as the meter sends them.
const byCase = {};
{
  let i = 0, events = [];
  for (const line of fs.readFileSync(path.join(__dirname, "events.jsonl"), "utf8").trim().split("\n")) {
    const e = JSON.parse(line);
    if (e.event !== "--frame-end--") { events.push(e); continue; }
    byCase[names[i++]] = events;
    events = [];
  }
}
const data = (name, ev) => byCase[name].find((e) => e.event === `decoded:${ev}`)?.data;
function stockOf(name) {
  let got = null;
  const f = new L.StockFrames((p) => { got = L.stockFrom(p); });
  for (const e of byCase[name]) f.push(e.event.slice(8), e.data, WHEN);
  f.flush();
  return got;
}

test("closet entries come from the skins' icons", () => {
  assert.equal(ix.items.get(535710120).look, 10015108); // Shadow Whisper staff
  assert.equal(ix.items.get(535810734).look, 30150106); // Duskpath boots
  assert.equal(ix.items.get(535910151).look, 50014103); // Shadow Jewel necklace
  assert.equal(ix.items.get(535910096).look % 1000, 101);
});

test("the closet at login: every entry", () => {
  const c = L.closetFrom(data("closet", "closet-list"));
  assert.equal(c.size, 200);
  assert.equal(c.get(10015108), 3); // two spare copies
  assert.equal(c.get(10001101), 1);
  assert.equal(L.spares(c, ix)[ix.looks.get(10015108).grade], 2);
});

test("an added entry", () => {
  assert.deepEqual(L.addedFrom(data("added", "closet-add")), [{ id: 30150106, count: 2 }]);
});

test("a Skins stock: ten offers, prices checked, marked against the closet", () => {
  const s = stockOf("stock");
  assert.equal(s.tabName, "Skins");
  assert.equal(s.offers.length, 10);
  assert.equal(s.refresh, WHEN + 3600 * 1000);
  const closet = new Map([[10015108, 1]]);
  assert.equal(L.statusOf(535710120, closet, ix).status, "owned");
  assert.equal(L.statusOf(535810734, closet, ix).status, "new");
  assert.equal(L.statusOf(930100031, closet, ix).status, null);
});

test("a longer frame is no stock", () => {
  assert.equal(stockOf("longer"), null);
});

test("list prices: Common, Rare 2.5 times, Legend 10 times", () => {
  assert.equal(L.listPrice(1, "Staff"), 96000);
  assert.equal(L.listPrice(2, "Staff"), 240000);
  assert.equal(L.listPrice(3, "Staff"), 960000);
  assert.equal(L.listPrice(3, "Boots"), 403200);
  assert.equal(L.listPrice(3, "Earrings"), 316800);
  assert.equal(L.listPrice(2, "Cloak"), 79200);
  assert.equal(L.listPrice(1, "Helm"), 40400);
  assert.equal(L.listPrice(4, "Staff"), null);
});

test("costs of what is left: cheapest <= average <= dearest", () => {
  const c = L.costs(L.missing(new Map(), ix), 78);
  assert.ok(c.cheapest > 0 && c.cheapest <= c.average && c.average <= c.dearest);
});

test("combine: 4 skins in, nothing owned: every result new, fees per new skin", () => {
  const r = L.combine(new Map(), ix);
  const legend = r.rows.find((x) => x.grade === 3);
  assert.equal(legend.up, 0.15);
  assert.ok(Math.abs(legend.chance - 1) < 1e-9);
  assert.ok(Math.abs(legend.yieldNew - 1) < 1e-9); // one new skin per combine
  assert.equal(legend.kinah, 6000);
  assert.equal(legend.verdict, "yes");
});

test("combine: a grade all owned is only worth it to climb, or not at all", () => {
  const all = new Map([...ix.looks.keys()].map((l) => [l, 1]));
  const r = L.combine(all, ix);
  for (const x of r.rows.filter((x) => x.grade < 4)) {
    assert.equal(x.chance, 0);
    assert.equal(x.verdict, "no");
  }
  // Common all owned, Rare all lacking: no new Common, but the Rare it climbs to.
  const common = new Map([...ix.looks].filter(([, s]) => s.grade === 1).map(([l]) => [l, 5]));
  const c = L.combine(common, ix).rows.find((x) => x.grade === 1);
  assert.ok(c.chance > 0.24 && c.chance <= 0.25);
  assert.ok(c.yieldNew > c.chance); // the copies feed the next combines
  assert.equal(c.possible, Math.floor(c.spares / 4));
});

test("extraction: a new skin as often as the share of the grade's looks you lack", () => {
  const gear = { 3: [1, 2, 3, 4], 4: [5, 6], 2: [7, 8, 9, 10] };
  const closet = new Map([[1, 1], [2, 1], [7, 1], [8, 1], [9, 1], [10, 1]]);
  const rows = L.extraction(closet, gear, null);
  const by = Object.fromEntries(rows.map((r) => [r.grade, r]));
  assert.equal(by[3].chance, 0.125);
  assert.equal(by[3].verdict, "yes");
  assert.equal(by[4].chance, 0.1);
  assert.equal(by[2].chance, 0);
  assert.equal(by[2].verdict, "no"); // nothing lacking, no combines counted (null)
  const set = L.advice(null, rows).find((a) => a.settings).settings;
  assert.equal(set.on, true);
  assert.deepEqual(set.grades.map((g) => [g.name, g.tick, g.hand]), [["Rare", false, false], ["Epic", true, false], ["Unique", false, true]]);
});

test("gear in the bag with a look you lack", () => {
  const [item, [look, grade]] = Object.entries(globalThis.CLOSET_DATA.pieces).find(([, p]) => p[1] === 3);
  const got = L.bagGear([[0, Number(item), 1], [1, 930100031, 5]], new Map(), globalThis.CLOSET_DATA, ix);
  assert.equal(got.length, 1);
  assert.equal(got[0].look, look);
  assert.equal(got[0].grade, grade);
  assert.equal(L.bagGear([[0, Number(item), 1]], new Map([[look, 1]]), globalThis.CLOSET_DATA, ix).length, 0);
});

test("merchant stats: the share of new skins and a paid change's worth", () => {
  const st = L.merchantStats([{ skins: 10, fresh: 1 }, { skins: 10, fresh: 0 }]);
  assert.equal(st.rate, 0.05);
  assert.ok(st.perChange > 0.4 && st.perChange < 0.41);
  assert.equal(st.refreshCost[0].cost, 500);
});

test("combine plan: lowest grade first, and what to collect", () => {
  const plan = L.combinePlan({ rows: [
    { grade: 3, name: "Epic", verdict: "yes", possible: 1, spares: 5 },
    { grade: 1, name: "Common", verdict: "feed", possible: 2, spares: 9 },
    { grade: 2, name: "Rare", verdict: "yes", possible: 0, spares: 1 },
    { grade: 4, name: "Unique", verdict: "no", possible: 3, spares: 12 },
  ] });
  assert.deepEqual(plan.now.map((n) => [n.name, n.times]), [["Common", 2], ["Epic", 1]]);
  assert.deepEqual(plan.collect, [{ grade: 2, name: "Rare", more: 3 }]);
});

test("a stock with a bought offer (left to buy 0) still reads", () => {
  let got = null;
  const f = new L.StockFrames((p) => { got = L.stockFrom(p); });
  for (const e of byCase.stock) {
    const d = e.event === "decoded:shop-a" ? { ...e.data, e0_qty: 0 } : e.data;
    f.push(e.event.slice(8), d, WHEN);
  }
  f.flush();
  assert.equal(got.offers.length, 10);
  assert.equal(got.offers[0].soldOut, true);
  assert.equal(got.offers[1].soldOut, false);
});
