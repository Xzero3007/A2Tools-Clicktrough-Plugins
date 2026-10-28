// The map's fallback for a pet monster its spawn data lacks (Map 0.9.0):
// the game's middle spawn point and where the game puts it (areas.js). The
// data has every pet monster now, so the gap is made here: Harsh Pino
// Worker's spawn points taken out before marks.js reads them.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
globalThis.requestAnimationFrame = (f) => f();
require(path.join(dir, "data.js"));
require(path.join(dir, "areas.js"));
const D = globalThis.MAP_DATA;
delete D.spawns.verteron["2100955"];
require(path.join(dir, "render.js"));
require(path.join(dir, "marks.js"));
const M = globalThis.MapMarks;
const layers = { pets: true, monsters: true, gather: true, cubes: true, kibelisks: true };

const HARSH = "2100955";

test("a monster the data lacks still has the game's middle spawn point, and where it lies", () => {
  const A = globalThis.MAP_AREAS;
  const [spawns, x, y, zones] = A[HARSH].verteron;
  assert.equal(spawns, 22);
  assert.deepEqual(zones, ["Aullaeu Village"]);
  const focus = { type: "npc", ids: [HARSH], label: "Harsh Pino Worker" };
  assert.deepEqual(M.focusPoints(focus, "verteron"), [[x, y]]);
  assert.deepEqual(M.focusMaps(focus), { verteron: 1 });
  const area = M.focusArea(focus, "verteron");
  assert.equal(area.game, 22);
  assert.equal(area.known, 1);
  assert.deepEqual(area.zones, ["Aullaeu Village"]);
  assert.ok(area.rings.length && area.labels[0][0] === "Aullaeu Village");
  // Framed with the outline, not the one point alone.
  assert.ok(M.focusFit(focus, "verteron").length > 2);
  const built = M.build({ key: "verteron", world: null, tracked: new Map(), heading: 0, layers, gatherKinds: {}, petsMode: "all", focus });
  assert.equal(built.marks.filter((m) => m.kind === "area").length, 1);
  const hit = built.marks.find((m) => m.hit && m.x === x && m.y === y);
  assert.match(hit.label, /middle one of the game's 22 spawn points/);
  // The search finds it.
  assert.ok(M.search("Harsh Pino").some((r) => r.label === "Harsh Pino Worker" && r.maps.verteron === 1));
  // The pet's own focus finds the same.
  assert.deepEqual(M.focusArea({ type: "pet", ids: [String(D.npcPets[HARSH])], label: "Pino Worker" }, "verteron").zones, ["Aullaeu Village"]);
});

test("a monster the data knows in full gets no outline, and no second point", () => {
  // Pino Worker: 6 of the game's 6 in the data.
  const focus = { type: "npc", ids: ["2100953"], label: "Pino Worker" };
  const area = M.focusArea(focus, "verteron");
  assert.equal(area.game, 6);
  assert.equal(area.known, 6);
  assert.equal(M.focusPoints(focus, "verteron").length, 6);
  const built = M.build({ key: "verteron", world: null, tracked: new Map(), heading: 0, layers, gatherKinds: {}, petsMode: "all", focus });
  assert.equal(built.marks.filter((m) => m.kind === "area").length, 0);
});

test("one the meter sees near the game's middle point isn't learnt twice", () => {
  const [, x, y] = globalThis.MAP_AREAS[HARSH].verteron;
  const store = {};
  assert.equal(M.learnFrom(store, "verteron", { npcs: [[1, Number(HARSH), x + 500, y]], objects: [] }), 0);
  assert.equal(M.learnFrom(store, "verteron", { npcs: [[1, Number(HARSH), x + 9000, y]], objects: [] }), 1);
});
