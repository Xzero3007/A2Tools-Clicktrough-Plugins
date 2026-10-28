const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PLUGIN = process.env.PLUGIN_DIR;
require(path.join(PLUGIN, "data.js"));
const L = require(path.join(PLUGIN, "logic.js"));
const ix = L.index(globalThis.PET_DATA);
const events = fs.readFileSync(path.join(__dirname, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

function run() {
  const nearby = new L.Nearby(ix);
  const coll = new L.Collection();
  const log = [];
  const frames = new L.Frames({
    spawn: ({ entity, npc }) => { log.push(["spawn", entity, npc]); nearby.spawn(entity, npc, 1000 + log.length); },
    remove: ({ entity, reason }) => { log.push(["remove", entity, reason]); nearby.remove(entity); },
  });
  const states = [];
  for (const e of events) {
    if (e.event === "--frame-end--") { states.push({ frame: e.frame, view: nearby.view(), coll: JSON.parse(JSON.stringify(coll)) }); continue; }
    const name = e.event.slice("decoded:".length);
    if (name.startsWith("npc-")) frames.push(name, e.data);
    else {
      frames.flush();
      if (name === "pet-collection") { const c = L.collectionFrom(e.data, ix.catalog); if (c) coll.snapshot(c, 5000); else log.push(["rejected", name]); }
      if (name === "pet-souls") { const b = L.batchFrom(e.data, ix.catalog); if (b) b.forEach((i) => coll.gain(i.pet, i.amount, 6000)); else log.push(["rejected", name]); }
      if (name === "pet-spent") { const b = L.batchFrom(e.data, ix.catalog); if (b) b.forEach((i) => coll.spend(i.pet, i.amount, 6000)); else log.push(["rejected", name]); }
      if (name === "pet-rank") { const r = L.rankFrom(e.data, ix.catalog); if (r) coll.rank(r.pet, r.rank, 6000); else log.push(["rejected", name]); }
    }
  }
  frames.flush();
  return { log, nearby, coll, states };
}

test("the npc at +0 (PetTracker fixtures) and at +2 both spawn, summons and garbage never do", () => {
  const { log } = run();
  const spawns = log.filter((l) => l[0] === "spawn");
  assert.deepEqual(spawns.map((s) => [s[1], s[2]]), [[101, 2100481], [102, 2100481], [300, 2100481], [104, 2100482]]);
});

test("NPC 2100481 is a pet mob, 2100482 is not (PetTracker: never invents a link)", () => {
  assert.ok(ix.npcs.has(2100481));
  assert.equal(ix.npcs.get(2100482), undefined);
});

test("a removal frame removes; a longer 42 36 frame is no removal", () => {
  const { log, nearby } = run();
  assert.deepEqual(log.filter((l) => l[0] === "remove"), [["remove", 101, 3]]);
  const left = [...nearby.entities.keys()].sort((a, b) => a - b);
  assert.deepEqual(left, [102, 300], "101 removed, 102 kept, unknown npc 104 never listed");
});

test("nearby groups by pet with mob names", () => {
  const { nearby } = run();
  const v = nearby.view();
  assert.equal(v.length, 1);
  const pet = ix.pets.get(v[0].pet);
  assert.equal(v[0].count, 2);
  assert.ok(pet.mobs.length > 0);
  assert.equal(v[0].mobs.length, 1);
  assert.equal(v[0].mobs[0].count, 2);
  console.log("   nearby:", pet.name, "←", v[0].mobs.map((m) => `${m.name} ×${m.count}`).join(", "));
});

test("the Pets list's frames: the pet list at login, souls, a level; a level frame with a status is one to leave", () => {
  const got = (name) => events.filter((e) => e.event === `decoded:${name}`).map((e) => e.data);
  const [list, ...more] = got("pet-list");
  assert.equal(more.length, 0, "the garbage 00 90 frame reads as no pet list");
  assert.deepEqual(list.levels.map((l) => [l.pet, l.level]), [[1007, 1], [1086, 2], [1163, 1]]);
  assert.deepEqual(list.points.map((p) => [p.pet, p.points]), [[1007, 24], [1086, 45]]);
  assert.deepEqual(got("soul-gained").map((d) => d.souls.map((s) => [s.pet, s.amount])), [[[1007, 1]], [[1029, 1], [1098, 1]]]);
  const levels = got("level-up");
  assert.deepEqual(levels.map((d) => [d.status, d.pet, d.level]), [[0, 1007, 2], [1, 1007, 3]]);
});

test("collection frames that break PetTracker's rules are rejected", () => {
  const c = ix.catalog;
  assert.equal(L.collectionFrom({ equipped: 0, ranks: [{ pet: 1007, dup: 1008, rank: 1 }], souls: [] }, c), null, "dup must repeat the id");
  assert.equal(L.collectionFrom({ equipped: 0, ranks: [{ pet: 1007, dup: 1007, rank: 4 }], souls: [] }, c), null, "rank 1..3");
  assert.equal(L.collectionFrom({ equipped: 0, ranks: [{ pet: 1007, dup: 1007, rank: 1 }], souls: [{ pet: 1007, souls: 26 }] }, c), null, "counter above the rank's goal");
  assert.equal(L.collectionFrom({ equipped: 9999, ranks: [], souls: [] }, c), null, "unknown equipped pet");
  assert.equal(L.batchFrom({ items: [{ pet: 1007, amount: 0 }] }, c), null);
  assert.equal(L.batchFrom({ items: [{ pet: 1007, amount: 1 }, { pet: 1007, amount: 1 }] }, c), null, "one entry per pet");
  assert.equal(L.batchFrom({ items: [] }, c), null);
});

test("search: by pet, by mob, by region, by source; maxed hidden on request", () => {
  const coll = new L.Collection();
  coll.snapshot({ ranks: { 1047: 1, 1004: 3 }, souls: { 1047: 17 } }, 1);
  const names = (q, o) => L.search(ix, q, coll, o).map((p) => p.name);
  assert.ok(names("armadon").includes("Aberrant Armadon"));
  assert.ok(names("splendent").includes("Aberrant Armadon"), "by mob name");
  assert.ok(names("verteron armadon").includes("Aberrant Armadon"), "every word must match");
  assert.ok(names("fera bound").length > 0, "by source alias");
  assert.equal(names("zzzz").length, 0);
  const all = L.search(ix, "", coll);
  const p1004 = ix.pets.get(1004);
  assert.ok(all.some((p) => p.id === 1004));
  assert.ok(!L.search(ix, "", coll, { hideMaxed: true }).some((p) => p.id === 1004), "rank 3 hidden");
  assert.deepEqual(coll.progress(1047), { rank: 1, souls: 17, goal: 25, toMax: 83 });
  const fera = L.search(ix, "", coll, { family: "Fera" });
  assert.ok(fera.length > 0 && fera.every((p) => p.family === "Fera"));
  console.log(`   ${all.length} pets listed; 1004 = ${p1004.name}`);
});

test("pinned pets come first", () => {
  const coll = new L.Collection();
  const pinned = new Set([1047]);
  assert.equal(L.search(ix, "", coll, { pinned })[0].id, 1047);
});

test("storage keys are what A2Tools accepts", () => {
  for (const c of [{ name: "Zoë-Ärger", serverId: 1304 }, { name: "a".repeat(30), serverId: 2550 }, null]) {
    const k = L.characterKey(c);
    assert.match(k, /^[A-Za-z0-9_-]{1,64}$/);
  }
  assert.notEqual(L.characterKey({ name: "A", serverId: 1 }), L.characterKey({ name: "B", serverId: 1 }));
});

test("totals count the 208 pets of the Global game, plus any with progress", () => {
  const coll = new L.Collection();
  coll.snapshot({ ranks: {}, souls: {} }, 1);
  const t0 = L.totals(ix, coll);
  assert.equal(t0.all, 208);
  assert.equal(t0.toMax, 208 * 105);
  // An Asian-release pet you somehow have progress on is counted too.
  const asian = ix.list.find((p) => !p.maps.length && !p.acq);
  coll.rank(asian.id, 1, 2);
  assert.equal(L.totals(ix, coll).all, 209);
});
