// The Map plugin's marks (marks.js): which map, the pets tracked, the next
// pet and the counts, with the generated data.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
globalThis.requestAnimationFrame = (f) => f();
require(path.join(dir, "data.js"));
require(path.join(dir, "areas.js"));
require(path.join(dir, "render.js"));
require(path.join(dir, "marks.js"));
const D = globalThis.MAP_DATA;
const M = globalThis.MapMarks;
const layers = { pets: true, monsters: true, gather: true, cubes: true, kibelisks: true };

// A pet monster with spawn points in Verteron.
const npc = Object.keys(D.spawns.verteron).find((n) => D.npcPets[n] != null && D.spawns.verteron[n].length >= 4);
const pet = String(D.npcPets[npc]);
const [sx, sy] = D.spawns.verteron[npc];

test("the data has the five world maps, their zones and calibration", () => {
  for (const key of ["verteron", "altgard", "abyss", "poeta", "ishalgen"]) {
    const m = D.maps[key];
    assert.ok(m && m.tiles.length && m.scale > 0 && m.tile > 0, key);
    // The game's whole pictures: every tile of the grid.
    assert.equal(m.picture, "game", key);
    assert.equal(m.tiles.length, m.grid * m.grid, key);
  }
  assert.equal(D.zones["1010"], "verteron");
  assert.equal(D.zones["1110"], "altgard");
  assert.equal(D.zones["100001"], "poeta");
  assert.equal(D.zones["1100"], "ishalgen");
  assert.ok(Object.keys(D.npcNames).length > 10000);
  assert.ok(D.cubes.includes(1200036));
});

test("the map is the zone's, else the one the pet monsters around stand on", () => {
  assert.equal(M.mapOf({ zone: 1110, npcs: [] }), "altgard");
  assert.equal(M.mapOf({ zone: 999999, npcs: [[1, Number(npc), sx + 100, sy - 100]] }), "verteron");
  assert.equal(M.mapOf({ zone: null, npcs: [] }), null);
});

test("monsters around win over a zone that is out of date, one stray doesn't", () => {
  // Three of Verteron's monsters around, the zone still Altgard's: Verteron.
  const three = [0, 1, 2].map((i) => [i + 1, Number(npc), sx + 100 * i, sy]);
  assert.equal(M.mapOf({ zone: 1110, npcs: three }), "verteron");
  // One or two are not enough to doubt the zone.
  assert.equal(M.mapOf({ zone: 1110, npcs: three.slice(0, 1) }), "altgard");
  assert.equal(M.mapOf({ zone: 1110, npcs: three.slice(0, 2) }), "altgard");
  // The zone's own map with as many around stays.
  const alt = Object.keys(D.spawns.altgard).find((n) => D.spawns.altgard[n].length >= 2 && !D.spawns.verteron[n]);
  const [ax, ay] = D.spawns.altgard[alt];
  const mixed = [...three, ...[0, 1, 2].map((i) => [i + 10, Number(alt), ax + 100 * i, ay])];
  assert.equal(M.mapOf({ zone: 1110, npcs: mixed }), "altgard");
});

test("tracked pets merge: pinned beats farming beats needed", () => {
  const t = M.mergeTracked({
    a: { pets: [{ id: 1001, mark: "needed", name: "A" }, { id: 1002, mark: "farming" }] },
    b: { pets: [{ id: 1001, mark: "pinned" }, { id: 1002, mark: "needed" }, { id: 1003 }] },
  });
  assert.equal(t.get("1001").mark, "pinned");
  assert.equal(t.get("1001").name, "A");
  assert.equal(t.get("1002").mark, "farming");
  assert.equal(t.get("1003").mark, "needed");
});

test("with a pet tracked: only its spawn points, the next one and the counts", () => {
  const tracked = M.mergeTracked({ pf: { pets: [{ id: Number(pet), mark: "pinned", name: "Mine" }] } });
  const world = {
    zone: 1010, me: { x: sx + 1000, y: sy, exact: true },
    npcs: [[7, Number(npc), sx + 3000, sy], [8, 2000000, sx, sy + 500]],
    objects: [[9, D.cubes[0], sx, sy - 500]],
  };
  const b = M.build({ key: "verteron", world, tracked, heading: 0, layers, gatherKinds: {}, petsMode: "tracked" });
  const spawns = b.marks.filter((m) => m.kind === "petSpawn");
  assert.equal(spawns.length, D.spawns.verteron[npc].length / 2 + Object.entries(D.spawns.verteron).filter(([n]) => n !== npc && String(D.npcPets[n]) === pet).reduce((s, [, p]) => s + p.length / 2, 0));
  assert.ok(spawns.every((m) => m.look === "fav"), "a favourite: the star");
  assert.equal(b.petsHere, 1);
  assert.equal(b.around, 1);
  // The live monster (20 m off) beats the nearer spawn point (10 m off).
  assert.equal(b.next.name, "Mine");
  assert.equal(b.next.live, true);
  assert.equal(Math.round(b.next.metres), 20);
  assert.ok(b.marks.some((m) => m.kind === "cube"));
  assert.ok(b.marks.some((m) => m.kind === "monster"));
  assert.ok(b.marks.some((m) => m.kind === "me" && m.exact));
});

test("pets by level: not at level 3 apart from level 3; a live one not at level 3 shows without being followed", () => {
  const npc2 = Object.keys(D.spawns.verteron).find((n) => D.npcPets[n] != null && String(D.npcPets[n]) !== pet);
  const pet2 = String(D.npcPets[npc2]);
  const [ox, oy] = D.spawns.verteron[npc2];
  const needed = M.neededOf({ "pet-finder": { pets: [], needed: [Number(pet2)] } });
  assert.ok(needed.has(pet2) && !needed.has(pet));
  assert.equal(M.neededOf({ "pet-finder": { pets: [] } }), null, "not known before the pet list is read");
  const all = M.build({ key: "verteron", world: { zone: 1010, me: null }, tracked: new Map(), needed, heading: 0, layers, gatherKinds: {}, petsMode: "all" });
  const lookOf = (p) => new Set(all.marks.filter((m) => m.kind === "petSpawn" && m.label.startsWith(M.petName(p, new Map()))).map((m) => m.look));
  assert.deepEqual([...lookOf(pet2)], ["need"]);
  assert.deepEqual([...lookOf(pet)], ["max"]);
  // Following nothing but a favourite elsewhere: the live pet2 monster (not at
  // level 3) shows, the live one at level 3 doesn't.
  const tracked = M.mergeTracked({ pf: { pets: [{ id: 999999, mark: "pinned" }] } });
  const world = { zone: 1010, me: { x: ox, y: oy, exact: true }, npcs: [[7, Number(npc2), ox + 800, oy], [8, Number(npc), ox + 900, oy]] };
  const b = M.build({ key: "verteron", world, tracked, needed, heading: 0, layers: { ...layers, monsters: false }, gatherKinds: {}, petsMode: "tracked" });
  const live = b.marks.filter((m) => m.kind === "petLive");
  assert.equal(live.length, 1);
  assert.equal(live[0].look, "need");
  assert.match(live[0].label, /not at level 3 yet/);
});

test("pets not at level 3 in their genus colour; the needed mode shows them all; the nearest kinds", () => {
  const npc2 = Object.keys(D.spawns.verteron).find((n) => D.npcPets[n] != null && String(D.npcPets[n]) !== pet && M.genusOf(D.npcPets[n]));
  const pet2 = String(D.npcPets[npc2]);
  const [ox, oy] = D.spawns.verteron[npc2];
  const needed = M.neededOf({ "pet-finder": { pets: [], needed: [Number(pet2)] } });
  const souls = M.soulsOf({ "pet-finder": { pets: [], needed: [Number(pet2)], souls: { [pet2]: 42 } } });
  const tracked = M.mergeTracked({ pf: { pets: [{ id: 999999, mark: "pinned" }] } });
  const world = { zone: 1010, me: { x: ox + 500, y: oy, exact: true }, npcs: [[7, Number(npc2), ox + 800, oy], [8, Number(npc2), ox + 3000, oy]] };
  const spawnsOf = (mode) => M.build({ key: "verteron", world, tracked, needed, heading: 0, layers: { ...layers, monsters: false }, gatherKinds: {}, petsMode: mode })
    .marks.filter((m) => m.kind === "petSpawn");
  assert.equal(spawnsOf("tracked").length, 0, "favourites only: pet2 isn't one");
  const shown = spawnsOf("needed");
  assert.ok(shown.length > 0 && shown.every((m) => m.look === "need"), "not at level 3: shown");
  assert.equal(shown[0].color, M.genusOf(pet2).color, "in its genus colour");
  assert.match(shown[0].label, new RegExp(M.genusOf(pet2).name));
  const kinds = M.nearestKinds({ key: "verteron", world, tracked, needed, souls });
  assert.equal(kinds.length, 1);
  assert.equal(kinds[0].npc, String(npc2));
  assert.equal(kinds[0].count, 2);
  assert.equal(Math.round(kinds[0].metres), 3);
  assert.equal(kinds[0].souls, 42);
  assert.equal(kinds[0].live, true);
  assert.equal(kinds[0].level, D.npcLevels[npc2] ?? null);
  // None in range: the nearest spawn points.
  const quiet = M.nearestKinds({ key: "verteron", world: { ...world, npcs: [] }, tracked, needed, souls });
  assert.ok(quiet.length >= 1 && quiet.every((k) => !k.live));
  // For Pet Finder's Nearest: pet2's nearest spawn point, 5 m off.
  assert.equal(M.nearestByPet("verteron", world.me)[pet2], 5);
});

test("the next pet: a pinned one before a farmed one before one only needed, live first within them", () => {
  // Another pet monster of Verteron, of another pet.
  const npc2 = Object.keys(D.spawns.verteron).find((n) => D.npcPets[n] != null && String(D.npcPets[n]) !== pet);
  const pet2 = String(D.npcPets[npc2]);
  const [ox, oy] = D.spawns.verteron[npc2];
  const me = { x: ox + 500, y: oy, exact: true }; // 5 m from pet2's spawn point
  const world = { zone: 1010, me, npcs: [[7, Number(npc2), ox + 800, oy]] }; // pet2 there, 3 m off
  const at = (marks) => M.mergeTracked({ pf: { pets: [{ id: Number(pet), mark: marks[0], name: "First" }, { id: Number(pet2), mark: marks[1], name: "Second" }] } });
  const nextOf = (tracked, nextFor) => M.build({ key: "verteron", world, tracked, heading: 0, layers, gatherKinds: {}, petsMode: "tracked", nextFor }).next;
  // Both only needed: the one there now.
  assert.equal(nextOf(at(["needed", "needed"])).name, "Second");
  // The pinned one, however far, before a needed one there now.
  const pinned = nextOf(at(["pinned", "needed"]));
  assert.equal(pinned.name, "First");
  assert.equal(pinned.mark, "pinned");
  assert.equal(nextOf(at(["farming", "needed"])).name, "First");
  assert.equal(nextOf(at(["pinned", "farming"])).name, "First");
  assert.equal(nextOf(at(["needed", "farming"])).name, "Second");
  // "chosen": the needed ones are no next; "off": none.
  assert.equal(nextOf(at(["needed", "needed"]), "chosen"), null);
  assert.equal(nextOf(at(["needed", "farming"]), "chosen").name, "Second");
  assert.equal(nextOf(at(["pinned", "farming"]), "off"), null);
  assert.match(M.markText("needed"), /level 3/);
});

test("with nothing tracked: every pet's spawn points, small and white, and no next", () => {
  const b = M.build({ key: "verteron", world: { zone: 1010, me: { x: sx, y: sy, exact: false }, npcs: [], objects: [] }, tracked: new Map(), heading: 0, layers: { ...layers, gather: false }, gatherKinds: {}, petsMode: "tracked" });
  const spawns = b.marks.filter((m) => m.kind === "petSpawn");
  assert.ok(spawns.length > 1000);
  assert.ok(spawns.every((m) => m.r < 3 && !m.ring));
  assert.equal(b.next, null);
  assert.ok(b.petsHere > 50);
});

test("gathering kinds can be switched off", () => {
  const on = M.build({ key: "verteron", world: null, tracked: new Map(), layers: { pets: false, gather: true }, gatherKinds: {}, petsMode: "all" });
  const kinds = new Set(on.marks.map((m) => m.gather));
  assert.ok(kinds.has("Herb") && kinds.has("Ore"));
  const off = M.build({ key: "verteron", world: null, tracked: new Map(), layers: { pets: false, gather: true }, gatherKinds: { Herb: false }, petsMode: "all" });
  assert.ok(!off.marks.some((m) => m.gather === "Herb"));
});

test("the compass arrow", () => {
  assert.equal(M.arrow(0), "↑");
  assert.equal(M.arrow(90), "→");
  assert.equal(M.arrow(-90), "←");
  assert.equal(M.arrow(181), "↓");
});

test("the search finds gathering spots, pets, monsters and camps, with their maps", () => {
  const ore = M.search("orichalcum");
  assert.equal(ore[0].label, "Orichalcum");
  assert.equal(ore[0].focus.type, "gather");
  assert.ok(ore[0].maps.verteron > 0);
  assert.ok(M.search("orich ore").length >= 1, "every word, in name or kind");
  const pet = M.search(D.pets[pet1()].name).find((r) => r.focus.type === "pet");
  assert.ok(pet && pet.total > 0);
  assert.ok(M.search("guide rest").some((r) => r.focus.type === "kibelisk"));
  assert.deepEqual(M.search("x"), [], "one letter is no search");
  assert.deepEqual(M.search("zzzqqq"), []);
});
function pet1() { return pet; }

test("a focus rings its places, and the nearest is next (one there now first)", () => {
  const focus = M.search("orichalcum")[0].focus;
  const pts = M.focusPoints(focus, "verteron");
  const [fx, fy] = pts[0];
  const world = { zone: 1010, me: { x: fx + 500, y: fy, exact: true }, npcs: [], objects: [] };
  const b = M.build({ key: "verteron", world, tracked: new Map(), heading: 0, layers: { pets: false }, gatherKinds: {}, petsMode: "tracked", focus });
  assert.equal(b.hits.length / 2, pts.length);
  assert.ok(b.marks.filter((m) => m.hit).length >= pts.length);
  assert.equal(b.next.name, "Orichalcum");
  assert.equal(Math.round(b.next.metres), 5);
  // One that is there right now wins, though further away.
  const live = M.build({ key: "verteron", world: { ...world, objects: [[1, Number(focus.ids[0]), fx + 3000, fy]] }, tracked: new Map(), heading: 0, layers: { pets: false }, gatherKinds: {}, petsMode: "tracked", focus });
  assert.equal(live.next.live, true);
  assert.equal(Math.round(live.next.metres), 25);
});

test("the gathering kinds have plain names and say what they hold", () => {
  assert.equal(M.kindLabel("Cotton"), "Fibers");
  assert.ok(M.kindTitle("Ore").includes("Orichalcum"));
  // The Empyrean Traces were the feathers (Monolith pieces) again: not a
  // gathering kind any more.
  assert.ok(!M.KIND_ORDER.includes("Fragment"));
  assert.ok(!Object.values(D.gather.objects).some((o) => o.kind === "Fragment"));
  assert.ok(D.featherIds.length >= 1 && D.featherIds.every((id) => !D.gather.objects[id]));
});

test("the calibration is the game's map bounds, and the Kibelisks agree", () => {
  for (const key of ["verteron", "altgard", "abyss", "poeta", "ishalgen"]) {
    const m = D.maps[key];
    const [x0, y0, x1, y1] = D.calibration[key].bounds;
    // One map pixel of the game's picture is 99.6 cm everywhere.
    assert.ok(Math.abs((m.tile * m.grid) / m.scale / (x1 - x0) - 1) < 1e-9, key);
    assert.ok(Math.abs(((m.tile * m.grid) / (m.tile === 2048 ? 2 : 1)) / (x1 - x0) * 100 - 1.00392) < 1e-4, key);
    assert.ok(Math.abs(m.ox + m.scale * x0) < 1e-6 && Math.abs(m.oy + m.scale * y0) < 1e-6, key);
  }
  for (const key of ["verteron", "altgard"]) {
    const k = D.calibration[key].kibelisks;
    assert.ok(k && k.pairs >= 50 && k.rmsMetres < 10 && k.cornersApartMetres < 15, key);
  }
  assert.ok(Math.abs(D.maps.verteron.ox - 8192) < 1e-6 && Math.abs(D.maps.altgard.ox - 4096) < 1e-6);
});

test("the search finds Hidden Cubes, Monoliths, places and regions", () => {
  const cubes = M.search("hidden cube");
  const spots = cubes.find((r) => r.focus.type === "cube" && r.focus.ids[0] === "spots");
  const all = cubes.find((r) => r.focus.type === "cube" && r.focus.ids[0] === "all");
  assert.ok(spots && spots.maps.altgard > 50 && spots.maps.verteron > 50);
  assert.ok(all && all.maps.altgard > 1000, "every place the game may put one");
  assert.ok(M.search("cubes").length >= 2);
  const mono = M.search("monolith").find((r) => r.focus.type === "monolith");
  assert.ok(mono && mono.maps.altgard > 100 && mono.maps.abyss > 100);
  const seals = M.search("sealed dungeons").find((r) => r.focus.ids[0] === "seal:*");
  assert.ok(seals && seals.maps.altgard > 30);
  const one = M.search("Lagta Fafnite Storage").find((r) => r.focus.type === "place");
  assert.ok(one && one.total === 1);
  const region = M.search("Safe Haven").find((r) => r.focus.type === "region");
  assert.ok(region && region.maps.altgard === 1);
});

test("the Hidden Cubes layer shows the known spots, the Places layer places and region names", () => {
  const b = M.build({ key: "altgard", world: null, tracked: new Map(), layers: { cubes: true, places: true, monoliths: true }, gatherKinds: {}, petsMode: "all" });
  assert.equal(b.marks.filter((m) => m.kind === "cubeSpot").length, D.cubeSpots.altgard.length / 2);
  assert.ok(b.marks.filter((m) => m.kind === "place").length > 50);
  assert.ok(b.marks.some((m) => m.kind === "region" && m.text === "Safe Haven"));
  assert.ok(b.marks.filter((m) => m.kind === "feather").length > 100);
  const off = M.build({ key: "altgard", world: null, tracked: new Map(), layers: {}, gatherKinds: {}, petsMode: "all" });
  assert.equal(off.marks.length, 0);
});

test("a Hidden Cube in range is the next one when searching for cubes", () => {
  const focus = M.search("hidden cube").find((r) => r.focus.ids[0] === "spots").focus;
  const [cx, cy] = M.focusPoints(focus, "altgard")[0];
  const world = { zone: 1110, me: { x: cx + 9000, y: cy, exact: true }, npcs: [], objects: [[5, D.cubes[0], cx + 9500, cy]] };
  const b = M.build({ key: "altgard", world, tracked: new Map(), heading: 0, layers: {}, gatherKinds: {}, petsMode: "tracked", focus });
  assert.equal(b.next.live, true);
  assert.equal(Math.round(b.next.metres), 5);
});

test("the region you are in, by its outline", () => {
  const [, x, y] = D.regions.altgard.find(([name]) => name === "Safe Haven");
  assert.equal(M.regionAt("altgard", x, y), "Safe Haven");
  assert.equal(M.regionAt("altgard", 10e6, 10e6), null);
});

test("without a zone, the map comes from the gathering spots and cubes around", () => {
  const [env, pts] = Object.entries(D.gather.points.altgard).find(([e]) => e !== "cube");
  assert.equal(M.mapOf({ zone: null, npcs: [], objects: [[1, Number(env), pts[0] + 200, pts[1]]] }), "altgard");
  const cube = D.gather.points.verteron.cube;
  assert.equal(M.mapOf({ zone: null, npcs: [], objects: [[2, D.cubes[0], cube[0], cube[1] + 100]] }), "verteron");
});

test("a material's gathering spots by the Market's name for it", () => {
  const asvata = M.gatherFor("Pure Asvata Log");
  assert.equal(asvata.type, "gather");
  assert.equal(asvata.label, "Asvata");
  assert.ok(asvata.ids.length >= 1 && asvata.ids.every((e) => D.gather.objects[e].name === "Asvata"));
  assert.equal(M.gatherFor("Fresh Aria").label, "Aria");
  assert.equal(M.gatherFor("Radiant Orichalcum Ore").label, "Orichalcum");
  assert.equal(M.gatherFor("Fine Odyle").label, "Odyle");
  assert.equal(M.gatherFor("Orichalcum Ingot")?.label, "Orichalcum");
  assert.equal(M.gatherFor("Wrathful Mind"), null);
});

test("field bosses: on the map, in the search, and a focus by their world-map id", () => {
  assert.equal(D.bosses.altgard.length, 24);
  assert.equal(D.bossIds["111001"], 2400017);
  const hit = M.search("Danar")[0];
  assert.equal(hit.label, "Melted Danar");
  assert.equal(hit.sub, "Field boss");
  assert.deepEqual(Object.keys(hit.maps), ["altgard"]);
  const [, , bx, by] = D.bosses.altgard.find(([npc]) => npc === 2400017);
  assert.deepEqual(M.focusPoints(hit.focus, "altgard"), [[bx, by]]);
  const places = M.build({ key: "altgard", world: null, tracked: new Map(), heading: 0, layers: { places: true }, gatherKinds: {}, petsMode: "tracked" });
  assert.equal(places.marks.filter((m) => m.kind === "boss").length, 24);
});

test("the way to a place: walk when it is near, else teleport to the Kibelisk nearest it", () => {
  const [kn, kx, ky] = D.kibelisks.altgard[0];
  const target = [kx + 3000, ky]; // 30 m from that Kibelisk
  // Far away: teleport, then 30 m.
  const far = { x: kx + 300000, y: ky + 300000 };
  const r1 = M.routeTo("altgard", far, [target]);
  assert.equal(r1.kib[0], kn);
  assert.equal(Math.round(r1.metres), 30);
  assert.deepEqual(r1.from, [kx, ky]);
  // Near: walk.
  const close = { x: target[0] + 5000, y: target[1] };
  const r2 = M.routeTo("altgard", close, [target]);
  assert.equal(r2.kib, null);
  assert.equal(Math.round(r2.walk), 50);
  // Of several places, the cheapest.
  const r3 = M.routeTo("altgard", close, [[close.x + 900000, close.y], target]);
  assert.deepEqual(r3.to, target);
  // Without a position: the Kibelisk nearest the only place.
  assert.equal(M.routeTo("altgard", null, [target]).kib[0], kn);
  assert.equal(M.routeTo("altgard", null, [target, target]), null);
  // In the marks: the route, the Kibelisk to teleport to, and next says so.
  const focus = { type: "boss", ids: ["2400017"], label: "Melted Danar" };
  const [, , bx, by] = D.bosses.altgard.find(([npc]) => npc === 2400017);
  const b = M.build({ key: "altgard", world: { zone: 1110, me: { x: bx + 400000, y: by, exact: true }, npcs: [], objects: [] }, tracked: new Map(), heading: 0, layers: {}, gatherKinds: {}, petsMode: "tracked", focus });
  assert.ok(b.marks.some((m) => m.kind === "route"));
  assert.ok(b.marks.some((m) => m.kind === "teleport"));
  assert.ok(b.next.via && b.next.via.name);
  assert.equal(b.next.name, "Melted Danar");
});

test("spots the meter sees are learnt, once each, and then shown", () => {
  M.setLearned({});
  const store = {};
  const env = Object.keys(D.gather.objects).find((e) => D.gather.objects[e].name === "Asvata");
  const before = M.focusPoints(M.gatherFor("Asvata Log"), "altgard").length;
  const far = [0, 0];
  const world = { zone: 1110, objects: [[1, Number(env), far[0], far[1]], [2, Number(env), far[0] + 300, far[1]]], npcs: [] };
  assert.equal(M.learnFrom(store, "altgard", world), 1, "the second is the same spot (3 m)");
  assert.equal(M.learnFrom(store, "altgard", world), 0, "known now");
  // A known data spot is not learnt again.
  const [dx, dy] = D.gather.points.altgard[env];
  assert.equal(M.learnFrom(store, "altgard", { objects: [[3, Number(env), dx + 200, dy]], npcs: [] }), 0);
  // A pet monster away from its spawn points.
  const npc = Object.keys(D.npcPets).find((n) => D.spawns.altgard?.[n]);
  assert.equal(M.learnFrom(store, "altgard", { objects: [], npcs: [[9, Number(npc), 1, 1]] }), 1);
  M.setLearned(store);
  assert.equal(M.focusPoints(M.gatherFor("Asvata Log"), "altgard").length, before + 1);
  assert.equal(M.learnFrom(store, "nowhere", world), 0);
  M.setLearned({});
});

test("the place shown: an exact report at once, else the report and the middle weighed, moving smoothly", () => {
  const t0 = 1_000_000;
  // A fresh exact report: there.
  const a = M.steady(null, { me: { x: 1000, y: 0, exact: true, from: "pose", at: t0 }, fix: { x: 1000, y: 0, at: t0 } }, t0 + 200);
  assert.deepEqual([a.x, a.y, a.exact], [1000, 0, true]);
  // 8 s later the middle of what is around says 30 m east: the shown place
  // moves toward a mix of both, not all the way at once.
  const around = { me: { x: 4000, y: 0, exact: false, from: "around", at: t0 + 8000 }, fix: { x: 1000, y: 0, at: t0 } };
  const b = M.steady(a, around, t0 + 8200);
  assert.ok(b.x > 1000 && b.x < 4000, String(b.x));
  assert.ok(!b.exact && b.acc > 5 && b.acc < 14, String(b.acc));
  // Asked again and again, it settles near the weighted place (close to the
  // middle, the report being 8 s old).
  let c = b;
  for (let i = 1; i <= 20; i++) c = M.steady(c, around, t0 + 8200 + i * 250);
  assert.ok(c.x > 3300 && c.x < 4000, String(c.x));
  // It never runs faster than 12 m/s (and a little).
  const far = { me: { x: 10000, y: 0, exact: false, from: "around", at: t0 + 9000 }, fix: null };
  const d = M.steady(c, far, c.at + 250);
  assert.ok(d.x - c.x <= 1200 * 0.25 + 150 + 1, String(d.x - c.x));
  // A teleport (hundreds of metres): there at once.
  const e = M.steady(d, { me: { x: 900000, y: 0, exact: false, from: "around", at: t0 }, fix: null }, d.at + 250);
  assert.equal(e.x, 900000);
  assert.equal(M.steady(e, { me: null }), null);
});

test("the map follows Pet Finder's list alone once it shares", () => {
  const both = {
    "pet-finder": { pets: [{ id: 1116, mark: "pinned" }] },
    "pet-souls": { pets: [{ id: 1083, mark: "pinned" }, { id: 1021, mark: "farming" }] },
  };
  assert.deepEqual([...M.mergeTracked(both).keys()], ["1116"]);
  assert.deepEqual([...M.mergeTracked({ "pet-souls": both["pet-souls"] }).keys()], ["1083", "1021"]);
});

test("the learnt spots' storage keys are ones the meter keeps", () => {
  for (const key of Object.keys(D.maps)) assert.match(`learned_${key}`, /^[A-Za-z0-9_-]{1,64}$/, key);
});

// Harsh Pino Worker and Hill Coradon: SkeeveAN's data had none of 22 and
// 9 of 91; the Pet Soul Tracker's (Aion 2 Timers') has them all.
test("the pet monsters' spawn points are the game's, all of them", () => {
  assert.equal(D.spawns.verteron["2100955"].length / 2, 22);
  assert.equal(D.spawns.verteron["2100821"].length / 2, 91);
  const focus = { type: "npc", ids: ["2100955"], label: "Harsh Pino Worker" };
  assert.equal(M.focusPoints(focus, "verteron").length, 22);
  // Known in full: no outline, no note.
  const area = M.focusArea(focus, "verteron");
  assert.equal(area.known, area.game);
  const built = M.build({ key: "verteron", world: null, tracked: new Map(), heading: 0, layers, gatherKinds: {}, petsMode: "all", focus });
  assert.equal(built.marks.filter((m) => m.kind === "area").length, 0);
});

test("Eltnen, Morheim and the Abyss's middle and upper layers are maps of their own", () => {
  for (const [key, zone] of [["eltnen", "1011"], ["morheim", "1111"], ["abyss_middle", "22"], ["abyss_upper", "23"]]) {
    const m = D.maps[key];
    assert.ok(m && m.tiles.length === m.grid * m.grid && m.scale > 0, key);
    assert.equal(D.zones[zone], key);
    assert.equal(M.mapOf({ zone: Number(zone), npcs: [] }), key);
  }
  assert.equal(D.zones["20"], "abyss");
  // Their field bosses.
  assert.equal(D.bosses.eltnen.length, 12);
  assert.equal(D.bosses.morheim.length, 12);
});

// ---------- 0.11.0: everything Aion 2 Timers' map has, the game's symbols, clicks ----------
const fs = require("node:fs");
const iconDir = process.env.ICON_DIR || path.join(__dirname, "..", "..", "icons");
const all = { pets: true, monsters: true, gather: true, cubes: true, monoliths: true, kibelisks: true, places: true, services: true, quests: true, npcs: true };

test("Eltnen and Morheim at the game's full size (8192 px), calibrated by the game's map bounds", () => {
  for (const key of ["eltnen", "morheim"]) {
    const m = D.maps[key];
    assert.equal(m.tile * m.grid, 8192, key);
    const [x0, , x1] = D.calibration[key].bounds;
    assert.ok(Math.abs((m.tile * m.grid) / m.scale / (x1 - x0) - 1) < 1e-9, key);
    assert.ok(D.kibelisks[key].length >= 15, key);
  }
});

test("every symbol a mark or a chip asks for is there (icons/)", () => {
  const want = new Set(["feather", "boss", "npc", "village", "gather", "dungeon", "shop", "heroquest", "teleportartifact_light", "teleportartifact_dark"]);
  for (const k of M.KIND_ORDER) want.add(M.kindIcon(k));
  for (const o of Object.values(D.gather.objects)) if (o.icon) want.add(o.icon);
  for (const list of Object.values(D.places)) for (const [kind] of list) for (const key of ["verteron", "altgard"]) want.add(M.placeIcon(kind, key));
  for (const key of Object.keys(D.maps)) {
    const b = M.build({ key, world: null, tracked: new Map(), heading: 0, layers: all, gatherKinds: {}, petsMode: "all" });
    for (const m of b.marks) if (m.icon) want.add(m.icon);
  }
  const missing = [...want].filter((n) => !fs.existsSync(path.join(iconDir, `${n}.webp`)));
  assert.deepEqual(missing, []);
});

test("every mark on the map can be clicked: its focus has it among its places", () => {
  for (const key of ["verteron", "eltnen", "abyss"]) {
    const b = M.build({ key, world: null, tracked: new Map(), heading: 0, layers: all, gatherKinds: {}, petsMode: "all" });
    const kinds = new Set();
    const cache = new Map();
    for (const m of b.marks) {
      if (["me", "route", "teleport", "area"].includes(m.kind)) continue;
      assert.ok(m.focus, `${key} ${m.kind} ${m.label}`);
      kinds.add(m.kind);
      const id = JSON.stringify(m.focus);
      if (!cache.has(id)) cache.set(id, new Set(M.focusPoints(m.focus, key).map(([x, y]) => `${x},${y}`)));
      assert.ok(cache.get(id).has(`${m.x},${m.y}`), `${key} ${m.kind} ${m.label}`);
    }
    // (Eltnen has no pets' souls and no feathers in the data.)
    const want = { verteron: ["petSpawn", "monster", "npc", "gather", "feather", "kibelisk", "place", "boss", "region"],
      eltnen: ["monster", "npc", "gather", "kibelisk", "place", "boss", "region"], abyss: ["petSpawn", "gather", "feather", "kibelisk", "place", "boss"] }[key];
    for (const k of want) assert.ok(kinds.has(k), `${key} ${k}`);
  }
});

test("the layers: places, services and quests apart; monsters and NPCs where the game has them", () => {
  const only = (l) => M.build({ key: "verteron", world: null, tracked: new Map(), heading: 0, layers: l, gatherKinds: {}, petsMode: "all" }).marks;
  const services = only({ services: true });
  assert.ok(services.length > 50 && services.every((m) => m.kind === "place" && ["shop", "storage", "alchemy", "blacksmith", "cook", "jewelcraft", "tailor", "npcteleport"].includes(m.place)));
  const quests = only({ quests: true });
  assert.ok(quests.length > 80 && quests.every((m) => ["heroquest", "districtquest"].includes(m.place)));
  assert.ok(quests.some((m) => m.label.includes(" · ")), "a quest giver's quests in its tooltip");
  const places = only({ places: true });
  assert.ok(places.some((m) => m.place === "rift") && places.some((m) => m.place === "dungeon") && places.some((m) => m.kind === "boss"));
  assert.ok(!places.some((m) => m.place === "shop" || m.place === "heroquest"));
  const monsters = only({ monsters: true });
  assert.ok(monsters.length > 10000 && monsters.every((m) => m.kind === "monster"));
  const npcs = only({ npcs: true });
  assert.ok(npcs.length > 1000 && npcs.every((m) => m.kind === "npc" && m.icon === "npc"));
  // The pets layer draws the pet monsters it shows; the monsters layer not again.
  const both = only({ pets: true, monsters: true }).filter((m) => m.kind === "monster");
  assert.ok(both.length < monsters.length);
  assert.ok(both.every((m) => D.npcPets[m.focus.ids[0]] == null));
});

test("the search finds monsters, NPCs, quests, services, feathers, Kibelisks and the areas' names", () => {
  const first = (q, type) => M.search(q).find((r) => r.focus.type === type);
  const bosses = new Set(Object.values(D.bosses).flat().map(([npc]) => String(npc)));
  const mob = Object.keys(D.monsters.verteron).find((npc) => D.npcPets[npc] == null && D.npcNames[npc] && !bosses.has(npc));
  const m = first(D.npcNames[mob], "npc");
  assert.ok(m && m.focus.ids.includes(mob) && m.sub.startsWith("Monster"));
  const person = Object.keys(D.npcs.verteron).find((n) => D.npcNames[n] && D.npcNames[n].length > 5);
  const p = first(D.npcNames[person], "person");
  assert.ok(p && p.sub === "NPC" && p.icon === "npc");
  const giver = D.places.verteron.find(([kind, , , , detail]) => kind === "heroquest" && detail);
  const quest = giver[4].split("; ")[0];
  const q = M.search(quest).find((r) => r.label === quest);
  assert.ok(q && q.focus.type === "place" && q.focus.ids[0] === `heroquest:${giver[1]}`);
  assert.ok(first("alchemy table", "place").maps.verteron >= 1);
  const merchants = M.search("merchants").find((r) => r.focus.ids[0] === "shop:*");
  assert.ok(merchants && merchants.maps.verteron > 50);
  for (const word of ["feathers", "empyrean", "monolith"]) {
    const f = first(word, "monolith");
    assert.ok(f && f.label === "Feathers" && f.icon === "feather" && f.maps.verteron > 100, word);
  }
  const kibs = M.search("kibelisks").find((r) => r.focus.ids[0] === "*");
  assert.equal(kibs.maps.verteron, D.kibelisks.verteron.length);
  const [lname] = D.labels.eltnen[0];
  const l = first(lname, "label");
  assert.ok(l && l.maps.eltnen >= 1);
  // A field boss is found as one, not as a monster.
  assert.equal(M.search("Melted Danar")[0].sub, "Field boss");
});

test("the meter's sightings complete the map: Kibelisks, feathers and other places", () => {
  const store = {};
  const kibEnv = Object.entries(D.objectKinds).find(([, k]) => k === "kibelisk")[0];
  const riftEnv = Object.entries(D.objectKinds).find(([, k]) => k === "rift")[0];
  const [kx, ky] = D.kibelisks.verteron[0].slice(1, 3);
  const far = [kx + 200000, ky + 200000];
  const world = { me: { x: far[0], y: far[1] }, npcs: [], objects: [
    [1, Number(kibEnv), kx + 500, ky], // a known Kibelisk: nothing new
    [2, Number(kibEnv), far[0], far[1]], // one the map lacks
    [3, D.featherIds[0], far[0] + 5000, far[1]], // a feather it lacks
    [4, D.featherIds[0], D.monoliths.verteron[0] + 200, D.monoliths.verteron[1]], // and one it has
    [5, Number(riftEnv), far[0], far[1] + 9000], // a rift it lacks
  ] };
  assert.equal(M.learnFrom(store, "verteron", world), 3);
  assert.deepEqual(store.verteron.o.kibelisk, [Math.round(far[0]), Math.round(far[1])]);
  assert.equal(store.verteron.f.length, 2);
  assert.equal(store.verteron.o.rift.length, 2);
  assert.equal(M.learnFrom(store, "verteron", world), 0, "each once");
  M.setLearned(store);
  const b = M.build({ key: "verteron", world: null, tracked: new Map(), heading: 0, layers: all, gatherKinds: {}, petsMode: "all" });
  assert.ok(b.marks.some((m) => m.kind === "kibelisk" && m.x === Math.round(far[0])));
  assert.ok(b.marks.some((m) => m.kind === "feather" && m.x === Math.round(far[0] + 5000)));
  assert.ok(b.marks.some((m) => m.place === "rift" && m.y === Math.round(far[1] + 9000)));
  M.setLearned({});
});

test("a click on a mark: the plugin gets the mark, and the same focus twice clears it", () => {
  const src = fs.readFileSync(path.join(dir, "plugin.js"), "utf8");
  assert.match(src, /onPick: \(m\) => \(sameFocus\(m\.focus, settings\.focus\) \? setFocus\(null\)/);
  const r = fs.readFileSync(path.join(dir, "render.js"), "utf8");
  assert.match(r, /if \(m\?\.focus\) onPick\(m\)/);
});

test("the search's counts per map are the focus's points, counted ahead", () => {
  const focuses = [];
  for (const q of ["an", "al", "ar", "er", "ion", "merchant", "quest", "kibelisk", "table", "village", "hidden", "feather"]) {
    for (const r of M.search(q, 60)) focuses.push(r.focus);
  }
  focuses.push({ type: "npc", ids: Object.keys(D.spawns.verteron).slice(0, 5), label: "x" });
  focuses.push({ type: "pet", ids: [pet], label: "x" });
  assert.ok(focuses.length > 300);
  for (const f of focuses) assert.deepEqual(M.focusMaps(f), M.focusMapsByPoints(f), JSON.stringify(f).slice(0, 100));
});

test("a field boss's one place is all the game has: the bar says so", () => {
  // Bodyguard Teegant and Divine Ansas: their pets' souls drop from them alone.
  for (const [npc, pet] of [["2100079", "1156"], ["2100718", "1206"]]) {
    assert.ok(Object.values(D.bosses).flat().some(([id]) => String(id) === npc), npc);
    assert.equal(M.focusPoints({ type: "npc", ids: [npc], label: "x" }, "verteron").length, 1);
    assert.equal(M.focusPoints({ type: "pet", ids: [pet], label: "x" }, "verteron").length, 1);
    assert.equal(globalThis.MAP_AREAS[npc].verteron[0], 1, "the game's own count");
  }
  const src = fs.readFileSync(path.join(dir, "plugin.js"), "utf8");
  assert.match(src, /is a field boss: the game has this one place for it\./);
});

test("the gathering kinds' counts: Fibers the game places nowhere, the others on their maps", () => {
  const all = M.gatherCounts(null);
  assert.equal(all.Cotton || 0, 0, "no source has a fiber spot (the client's own data: 0 each)");
  for (const k of ["Herb", "Ore", "Wood", "Food", "Gemstone", "Od"]) assert.ok(M.gatherCounts("verteron")[k] > 50, k);
  assert.equal(M.gatherCounts("verteron").Herb, Object.entries(D.gather.points.verteron)
    .filter(([env]) => D.gather.objects[env]?.kind === "Herb").reduce((n, [, p]) => n + p.length / 2, 0));
  // A fiber spot the meter sees is learnt and counted.
  const env = Object.entries(D.gather.objects).find(([, o]) => o.kind === "Cotton")[0];
  const store = {};
  M.learnFrom(store, "verteron", { objects: [[1, Number(env), 1000, 2000]], npcs: [] });
  M.setLearned(store);
  assert.equal(M.gatherCounts("verteron").Cotton, 1);
  M.setLearned({});
});

test("the map's view buttons: zoom, the whole map, what is shown, big map; and a scale", () => {
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  for (const cls of ["zoomIn", "zoomOut", "fitBtn", "resultsBtn", "bigBtn"]) assert.match(html, new RegExp(`class="${cls}"`));
  const src = fs.readFileSync(path.join(dir, "plugin.js"), "utf8");
  assert.match(src, /scaleBar: true/);
  assert.match(src, /document\.body\.classList\.toggle\("bigMap"/);
  // A gathering kind the game places nowhere has no chip until one is seen.
  assert.match(src, /M\.KIND_ORDER\.filter\(\(k\) => anywhere\[k\] > 0\)/);
  const r = fs.readFileSync(path.join(dir, "render.js"), "utf8");
  assert.match(r, /zoomBy\(f\)/);
  assert.match(r, /if \(map && fitted && \(fitPending \|\| grew\)\)/);
});
