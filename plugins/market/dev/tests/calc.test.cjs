// The Market plugin's sums (calc.js) on the generated data and a few
// aion2.exchange rows as its API gives them.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
require(path.join(dir, "data.js"));
require(path.join(dir, "calc.js"));
const D = globalThis.MARKET_DATA;
const C = globalThis.MarketCalc;

const id = (name) => Number(Object.keys(D.items).find((k) => D.items[k][0] === name));
const row = (name, price, extra = {}) => ({ item_key: id(name), name, price, listings: 7, listed: price > 0, units_sold: 120,
  sold_avg_price: price, captured_at: "2026-10-24T18:10:02Z", ...extra });

test("the data: recipes of both factions, names, the gathered materials and their Odyle", () => {
  // The combo results (no materials) ride with the recipe that makes them.
  assert.ok(D.recipes.length > 500 && D.recipes.every((r) => r[8].length > 0));
  const combo = D.recipes.find((r) => r[9]);
  assert.ok(combo[9][0] > 0 && D.items[combo[9][1]] && combo[9][2] >= 1);
  assert.ok(C.recipesOf("Elyos").every((r) => r[1] === "L") && C.recipesOf("Asmodian").every((r) => r[1] === "D"));
  assert.equal(C.recipesOf("Elyos").length + C.recipesOf("Asmodian").length, D.recipes.length);
  // 42 materials Substance Morph makes: 4 ore, 12 gemstone, 8 log, 8 herb, 10 cooking.
  const counts = Object.fromEntries(Object.entries(D.gather).map(([k, g]) => [k, g.flat().length]));
  assert.deepEqual(counts, { Ore: 4, Gemstone: 12, Log: 8, Herb: 8, Cooking: 10 });
  assert.equal(C.morphFrom(id("Radiant Orichalcum Ore")), id("Radiant Odyle"));
  assert.equal(C.morphFrom(id("Fresh Aria")), id("Fine Odyle"));
  assert.equal(C.morphFrom(id("Cypri")), id("Odyle"));
  assert.equal(C.morphFrom(id("Orichalcum Ingot")), null);
  assert.equal(D.npcPrices[String(id("Orichalcum Solvent (Bound)"))], 400);
});

test("aion2.exchange rows: the lowest listing, none while nothing is listed", () => {
  const p = C.readPrices([row("Odyle", 2892), row("Fine Odyle", 0, { listed: false, listings: 0 }), { name: "no key" }]);
  assert.equal(p.get(String(id("Odyle"))).price, 2892);
  assert.equal(p.get(String(id("Odyle"))).sold, 120);
  assert.equal(p.get(String(id("Fine Odyle"))).price, null);
  assert.equal(p.size, 2);
});

test("a material's cost: the NPC's for tools, else the cheaper of the market and its Odyle", () => {
  const p = C.readPrices([row("Fine Asvata Log", 5999), row("Fine Odyle", 1849), row("Orichalcum Ore", 1000), row("Odyle", 2892)]);
  const npc = D.npcPrices;
  assert.deepEqual(C.unitCost(p, npc, id("Fine Asvata Log")), { unit: 1849, source: "morph", via: id("Fine Odyle") });
  assert.deepEqual(C.unitCost(p, npc, id("Fine Asvata Log"), { morph: false }), { unit: 5999, source: "market" });
  assert.deepEqual(C.unitCost(p, npc, id("Orichalcum Ore")), { unit: 1000, source: "market" });
  assert.deepEqual(C.unitCost(p, npc, id("Sandpaper (Bound)")), { unit: 400, source: "npc" });
  assert.deepEqual(C.unitCost(p, npc, id("Pure Ruby Gemstone")), { unit: null, source: null });
  // Not listed, but its Odyle is: morphed.
  assert.equal(C.unitCost(p, npc, id("Fine Yggdrasil Log")).source, "morph");
});

test("one craft: costs with and without morphing, the sale less the fee, the profit", () => {
  const ingot = D.recipes.find((r) => r[1] === "D" && D.items[r[6]][0] === "Orichalcum Ingot" && r[7] === 1);
  const cheapOre = C.readPrices([row("Orichalcum Ore", 1000), row("Odyle", 2892), row("Orichalcum Ingot", 4000)]);
  let s = C.recipeSums(ingot, cheapOre, D.npcPrices, { fee: 0.1 });
  assert.equal(s.costBuy, 2 * 1000 + 400);
  assert.equal(s.costBest, 2 * 1000 + 400);
  assert.equal(s.net, 3600);
  assert.equal(s.profit, 1200);
  const dearOre = C.readPrices([row("Orichalcum Ore", 5000), row("Odyle", 2892), row("Orichalcum Ingot", 9000)]);
  s = C.recipeSums(ingot, dearOre, D.npcPrices, { fee: 0.1 });
  assert.equal(s.costBuy, 2 * 5000 + 400);
  assert.equal(s.costBest, 2 * 2892 + 400);
  assert.equal(s.lines[0].best.source, "morph");
  assert.equal(Math.round(s.profit), Math.round(9000 * 0.9 - (2 * 2892 + 400)));
  // A material without any price: no profit, said so.
  s = C.recipeSums(ingot, C.readPrices([row("Orichalcum Ingot", 9000)]), D.npcPrices, { fee: 0.1 });
  assert.equal(s.complete, false);
  assert.equal(s.profit, null);
});

test("where a material goes, and what Odyle Energy costs through morph", () => {
  const uses = C.usesOf("Asmodian");
  const ore = uses.get(String(id("Radiant Orichalcum Ore")));
  assert.ok(ore.length > 10 && ore.every((u) => u.recipe[1] === "D" && u.count > 0));
  const p = C.readPrices([row("Odyle", 2892), row("Fine Odyle", 1849), row("Pure Odyle", 5000)]);
  const e = C.energyMorphCost(p);
  assert.equal(e.total, 25 * 2892 + 5 * 1849 + 5000 + 50000);
  assert.equal(e.perEnergy, e.total / 40);
  assert.equal(C.energyMorphCost(C.readPrices([row("Odyle", 2892)])), null);
});

test("the items to price: products, materials, gathered and Odyle, no NPC tools", () => {
  const keys = C.neededItems("Elyos");
  assert.ok(keys.includes(String(id("Odyle"))) && keys.includes(String(id("Cypri"))));
  assert.ok(!keys.includes(String(id("Sandpaper (Bound)"))));
  assert.ok(keys.length > 300 && keys.length < 900);
});

test("the morph table: biggest saving first", () => {
  const p = C.readPrices([row("Fine Asvata Log", 5999), row("Fine Odyle", 1849), row("Orichalcum Ore", 1000), row("Odyle", 2892)]);
  const t = C.morphTable(p);
  assert.equal(t[0].item, id("Fine Asvata Log"));
  assert.equal(t[0].saving, 5999 - 1849);
  assert.ok(t.find((r) => r.item === id("Orichalcum Ore")).saving < 0);
  assert.equal(t.length, 42);
});

test("aion2.exchange servers as its API gives them, and the player's among them", () => {
  // As /api/servers answered on 2026-10-24.
  const res = { default: 11304, servers: [
    { server_id: 11101, name: "Siel", game_server_key: 1101, region: "NAE", region_name: "North America East", faction: "Elyos", has_data: true },
    { server_id: 12101, name: "Israphel", game_server_key: 2101, region: "NAE", region_name: "North America East", faction: "Asmodian", has_data: true },
    { server_id: 12305, name: "Marchutan", game_server_key: 2305, region: "EU", region_name: "Europe", faction: "Asmodian", has_data: false },
    { name: "no id" },
  ] };
  const list = C.readServers(res);
  assert.equal(list.length, 3);
  assert.deepEqual(list[1], { id: 12101, game: 2101, name: "Israphel", region: "North America East", faction: "Asmodian", hasData: true, copied: false });
  assert.equal(list[2].hasData, false);
  // The fork's copy says which servers it has.
  assert.equal(C.readServers({ servers: [{ ...res.servers[0], copied: true }] })[0].copied, true);
  // Read again from the plugin's own cache: the same.
  assert.deepEqual(C.readServers({ servers: list }), list);
  assert.equal(C.serverOf(list, 2305).name, "Marchutan");
  assert.equal(C.serverOf(list, "1101").name, "Siel");
  assert.equal(C.serverOf(list, null), null);
  assert.equal(C.serverOf(list, 9999), null);
});

test("the fork's copy of a server's prices reads as aion2.exchange's rows do", () => {
  const odyle = String(id("Odyle"));
  const fine = String(id("Fine Odyle"));
  const copy = C.readCopy({ v: 1, server: 12305, snapshot: "2026-10-25T02:10:02Z", copied: "2026-10-25T02:20:00Z",
    items: { [odyle]: [2222, 135, null, 2100.5, -36.46, 2222], [fine]: [null, 0, null, null, null, 1486], bad: "x" } });
  assert.equal(copy.snapshot, "2026-10-25T02:10:02Z");
  assert.equal(copy.prices.get(odyle).price, 2222);
  assert.equal(copy.prices.get(odyle).listings, 135);
  assert.equal(copy.prices.get(odyle).change, -36.46);
  assert.equal(copy.prices.get(fine).price, null);
  assert.equal(copy.prices.get(fine).last, 1486);
  assert.equal(copy.prices.size, 2);
  assert.equal(C.readCopy(null), null);
  assert.equal(C.readCopy({ items: {} }), null);
  // The same sums as with the API's rows.
  const viaRows = C.readPrices([row("Odyle", 2222)]);
  assert.equal(C.market(copy.prices, id("Odyle")), C.market(viaRows, id("Odyle")));
});

test("each faction's items: its recipes' materials and products; Odyle for both", () => {
  assert.equal(C.ofFaction(id("Asvata Log"), "Asmodian"), true);
  assert.equal(C.ofFaction(id("Asvata Log"), "Elyos"), false);
  assert.equal(C.ofFaction(id("Yggdrasil Log"), "Elyos"), true);
  assert.equal(C.ofFaction(id("Yggdrasil Log"), "Asmodian"), false);
  assert.equal(C.ofFaction(id("Orichalcum Ore"), "Asmodian"), true);
  assert.equal(C.ofFaction(id("Orichalcum Ore"), "Elyos"), true);
  assert.equal(C.ofFaction(id("Fine Odyle"), "Elyos"), true);
  assert.equal(C.ofFaction(id("Asvata Log"), null), true);
  // The morph table of a faction leaves the other side's materials out.
  const asmo = C.morphTable(new Map(), "Asmodian").map((r) => C.name(r.item));
  assert.ok(asmo.includes("Pure Asvata Log") && !asmo.some((n) => /Yggdrasil|^Aria$|Targena/.test(n)));
  assert.equal(C.morphTable(new Map()).length, 42);
});
