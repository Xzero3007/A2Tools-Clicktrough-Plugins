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
  assert.ok(c.has(10015108));
});

test("an added entry", () => {
  assert.deepEqual(L.addedFrom(data("added", "closet-add")), [30150106]);
});

test("a Skins stock: ten offers, prices checked, marked against the closet", () => {
  const s = stockOf("stock");
  assert.equal(s.tabName, "Skins");
  assert.equal(s.offers.length, 10);
  assert.equal(s.refresh, WHEN + 3600 * 1000);
  const closet = new Set([10015108]);
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
  const c = L.costs(L.missing(new Set(), ix), 78);
  assert.ok(c.cheapest > 0 && c.cheapest <= c.average && c.average <= c.dearest);
});

test("combine sums: a chance per combine and fees for one new skin", () => {
  const r = L.combine(new Set(), ix);
  const legend = r.rows.find((x) => x.grade === 3);
  assert.equal(legend.up, 0.15);
  assert.ok(Math.abs(legend.chance - 1) < 1e-9); // nothing owned: every result is new
  assert.equal(legend.kinah, 6000);
});

test("merchant stats: the share of new skins and a paid change's worth", () => {
  const st = L.merchantStats([{ skins: 10, fresh: 1 }, { skins: 10, fresh: 0 }]);
  assert.equal(st.rate, 0.05);
  assert.ok(st.perChange > 0.4 && st.perChange < 0.41);
  assert.equal(st.refreshCost[0].cost, 500);
});
