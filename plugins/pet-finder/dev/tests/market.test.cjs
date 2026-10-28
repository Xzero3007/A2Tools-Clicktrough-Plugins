const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require(path.join(process.env.PLUGIN_DIR, "data.js"));
const L = require(path.join(process.env.PLUGIN_DIR, "logic.js"));
const ix = L.index(globalThis.PET_DATA);
const names = JSON.parse(fs.readFileSync(path.join(__dirname, "market-cases.json")));
const lines = fs.readFileSync(path.join(__dirname, "market-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const WHEN = Date.parse("2030-01-01T07:00:00Z");

// Each case's events, as the meter would send them, through MarketFrames.
function stocks(now = WHEN) {
  const out = {};
  let i = 0, events = [];
  for (const e of lines) {
    if (e.event !== "--frame-end--") { events.push(e); continue; }
    let got = null;
    const frames = new L.MarketFrames((parts) => { got = L.stockFrom(parts, now, ix); });
    for (const ev of events) frames.push(ev.event.slice(8), ev.data, now);
    frames.flush();
    out[names[i++]] = got;
    events = [];
  }
  return out;
}

test("Special tab: both pet unlocks with their prices, gear left out", () => {
  const s = stocks().special;
  assert.equal(s.tabName, "Special");
  assert.equal(s.offers.length, 2);
  assert.ok(s.offers.some((o) => o.pet === 1196 && o.item === 534760190 && o.price === 80000));
  assert.ok(s.offers.some((o) => o.pet === 1092 && o.price === 90000));
});

test("Pets tab: every offer at its price; refresh at 08:00", () => {
  const s = stocks().pets;
  const expected = { 1133: 90000, 1004: 90000, 1028: 90000, 1164: 90000, 1082: 80000, 1188: 50000, 1197: 90000, 1219: 50000, 1046: 70000, 1217: 70000 };
  assert.equal(s.tabName, "Pets");
  assert.equal(s.offers.length, 10);
  for (const o of s.offers) assert.equal(o.price, expected[o.pet], `pet ${o.pet}`);
  assert.equal(s.refresh, Date.parse("2030-01-01T08:00:00Z"));
});

test("every truncation and appended bytes fail closed", () => {
  const s = stocks();
  for (let n = 0; n < 357; n++) assert.equal(s[`trunc${n}`], null, `truncated to ${n}`);
  assert.equal(s.appended, null);
});

test("unsupported shapes, currency, discount, duplicates and quantities reject the batch", () => {
  const s = stocks();
  for (const k of ["flip0", "flip1", "flip36", "flip173", "flip310", "flip353", "currency", "discount", "duplicate", "quantity"]) assert.equal(s[k], null, k);
  assert.ok(s.soulitem && s.soulitem.offers.every((o) => o.pet !== 1196), "a soul item is never an unlock");
});

test("expired and implausible refresh times are rejected", () => {
  assert.equal(stocks(WHEN + 2 * 3600 * 1000).special, null);
  assert.equal(stocks(WHEN - 24 * 3600 * 1000).special, null);
});

test("watchlist and recommendations as PetTracker: 37 pets, Special recommends 1196 only", () => {
  const coll = new L.Collection();
  coll.snapshot({ ranks: Object.fromEntries(ix.list.map((p) => [p.id, 1])), souls: {} }, WHEN);
  assert.equal(L.watchlist(ix, coll).length, 37);
  assert.ok(L.watchlist(ix, coll).some((p) => p.name === "Elite Dratona"));
  assert.ok(!L.watchlist(ix, coll).some((p) => p.name === "Lesser Wind Spirit"));
  const special = stocks().special;
  assert.deepEqual(L.recommendations([special], coll, WHEN, ix).map((o) => o.pet), [1196]);
  assert.deepEqual(L.recommendations([special], new L.Collection(), WHEN, ix), [], "only against a read collection");
  assert.equal(L.recommendations([special], coll, WHEN + 1000, ix).length, 1, "still shown a second later");
  assert.equal(L.recommendations([special], coll, WHEN + 3 * 60 * 1000, ix).length, 0, "stale after two minutes");
  coll.rank(1196, 3, WHEN);
  assert.equal(L.recommendations([special], coll, WHEN, ix).length, 0, "not once the pet is at rank 3");
});
