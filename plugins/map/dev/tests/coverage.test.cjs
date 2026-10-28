// Every monster that drops pet souls, against the game's own count of its
// spawn points (Pet Finder's sources.js, the Pet Soul Tracker's game data):
// the map must have each of them where it has the map, all the game's spawn
// points for nearly all, and a picture of every open-world map they are on.
// What differs is listed in the build's log.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
const sourcesPath = process.env.SOURCES_JS || path.join(__dirname, "..", "..", "..", "pet-finder", "sources.js");
globalThis.requestAnimationFrame = (f) => f();
require(path.join(dir, "data.js"));
require(path.join(dir, "areas.js"));
require(path.join(dir, "render.js"));
require(path.join(dir, "marks.js"));
const D = globalThis.MAP_DATA;
const M = globalThis.MapMarks;

const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${fs.readFileSync(sourcesPath, "utf8")};this.S = PET_SOURCES;`, ctx);

const same = [];
const differ = [];
const noPoints = [];
const noMap = [];
for (const src of Object.values(ctx.S)) {
  for (const d of src.drops || []) {
    if (!d.npcId || !d.spawns) continue;
    const key = D.zones[String(d.mapId)];
    const id = `${D.npcNames[d.npcId] || "?"} (${d.npcId})`;
    if (!key) {
      noMap.push(`${id}: map ${d.mapId}`);
      continue;
    }
    const n = M.focusPoints({ type: "npc", ids: [String(d.npcId)] }, key).length;
    if (!n) noPoints.push(`${id} on ${key}`);
    else if (n === d.spawns) same.push(id);
    else differ.push(`${id} on ${key}: ${n} of the game's ${d.spawns}`);
  }
}
const total = same.length + differ.length + noPoints.length + noMap.length;

test("every pet monster has its spawn points on its map", (t) => {
  t.diagnostic(`${same.length} of ${total} pet monsters with all the game's spawn points`);
  for (const row of differ) t.diagnostic(`differs: ${row}`);
  for (const row of noMap) t.diagnostic(`on a map the plugin has no picture of: ${row}`);
  assert.deepEqual(noPoints, [], "pet monsters with no spawn point on a map the plugin has");
  assert.ok(same.length / total >= 0.95, `only ${same.length} of ${total} with all the game's spawn points`);
});

test("every open-world map a pet monster is on has a picture here", () => {
  // Instances (map ids from 600000) may lack one; an open-world map may not:
  // a new area needs its map (dev/make_data.py --pet-maps).
  const open = noMap.filter((row) => Number(row.split("map ")[1]) < 600000);
  assert.deepEqual(open, []);
});
