// Boss Notes' rules: which boss, its phases by HP, time, casts and buffs,
// alerts and their time, and what a fight records.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
global.window = {};
require(path.join(dir, "bosses.js"));
const D = global.window.BOSS_CALLOUTS;
const L = require(path.join(dir, "logic.js"));

function engine(sheets) {
  let t = 1_000_000;
  const done = [];
  const e = L.create(D, {
    now: () => t,
    sheet: (k) => sheets[k],
    allEntries: () => Object.values(sheets).flatMap((s) => s.entries || []),
    done: (r) => done.push(r),
  });
  return { e, done, at: (ms) => (t = 1_000_000 + ms), t: () => t };
}
const boss = (hp, extra) => ({ entity: 700, npc: 2_400_001, name: "Thamon", boss: true, hp, maxHp: 1000, since: 1_000_000, lastHit: 1_000_000, ...extra });

test("a boss is known by its name in any of the game's languages", () => {
  const ix = L.index(D);
  assert.equal(L.keyOf(ix, { name: "Thamon", npc: 1 }), "thamon");
  assert.equal(L.keyOf(ix, { name: "Unknown One", npc: 42 }), "npc-42");
});

test("phases follow the HP, the time and a cast; the next one is named", () => {
  const sheets = {
    thamon: {
      notes: "Stack behind.",
      entries: [
        { id: "a", kind: "phase", name: "Opening", text: "Tank faces away", when: { type: "start" } },
        { id: "b", kind: "phase", name: "Adds", text: "Kill the adds", when: { type: "hp", value: 70 } },
        { id: "c", kind: "phase", name: "Burn", text: "All in", when: { type: "hp", value: 30 } },
        { id: "d", kind: "alert", name: "Purple", text: "Stop magic", when: { type: "cast", value: 1604670 }, ms: 5000 },
        { id: "e", kind: "phase", name: "Enrage", text: "Run", when: { type: "time", value: 300 } },
      ],
    },
  };
  const { e, at } = engine(sheets);
  e.combat({ at: 1_000_000, fought: [boss(1000)] });
  let s = e.state("en");
  assert.equal(s.fight.key, "thamon");
  assert.equal(s.phase.name, "Opening");
  assert.equal(s.next.name, "Adds");
  assert.equal(s.next.when, "HP at 70 %");
  assert.equal(s.notes, "Stack behind.");
  at(20_000);
  e.combat({ at: 1_020_000, fought: [boss(690)] });
  s = e.state("en");
  assert.equal(s.phase.name, "Adds");
  assert.equal(s.next.name, "Burn");
  // An alert on a cast, for its time.
  e.cast({ caster: 700, skill: 1604670 }, 1_021_000);
  s = e.state("en");
  assert.deepEqual(s.alerts.map((a) => a.name), ["Purple"]);
  at(27_000);
  assert.equal(e.state("en").alerts.length, 0);
  // HP back up (a heal) doesn't undo a phase: HP fires once.
  e.combat({ at: 1_028_000, fought: [boss(800)] });
  assert.equal(e.state("en").phase.name, "Adds");
  at(301_000);
  e.combat({ at: 1_301_000, fought: [boss(500)] });
  assert.equal(e.state("en").phase.name, "Enrage");
});

test("a buff's alert lasts the buff and ends with it; another entity's buff is not heard", () => {
  const sheets = { thamon: { entries: [{ id: "x", kind: "alert", name: "Reflect", text: "", when: { type: "buff", value: 16046701 } }] } };
  const { e, at } = engine(sheets);
  e.combat({ at: 1_000_000, fought: [boss(1000)] });
  e.added({ entity: 701, instance: 1, abnormal: 16046701, length: 10000 }, 1_000_500);
  assert.equal(e.state("en").alerts.length, 0);
  e.added({ entity: 700, instance: 3, abnormal: 16046701, length: 10000 }, 1_001_000);
  at(5_000);
  let s = e.state("en");
  assert.equal(s.alerts.length, 1);
  assert.ok(Math.abs(s.alerts[0].left - 6000) < 5);
  e.removed({ entity: 700, instance: 3 }, 1_006_000);
  assert.equal(e.state("en").alerts.length, 0);
});

test("the fight is recorded: a boss's opening cast, its doings once a second, the HP; nothing of players", () => {
  const { e, done, at } = engine({});
  // The boss casts before its first hit (Thamon's skill is a boss's in the data).
  e.cast({ caster: 700, skill: 1604670 }, 999_000);
  e.cast({ caster: 5, skill: 1604670 }, 999_100); // another entity: dropped at the fight's start
  e.combat({ at: 1_000_000, fought: [boss(1000)] });
  e.skill({ caster: 700, skill: 1604390 }, 1_001_000);
  e.skill({ caster: 700, skill: 1604390 }, 1_001_200); // the same within a second: once
  e.skill({ caster: 9999, skill: 123 }, 1_001_300); // a player: never
  e.combat({ at: 1_002_000, fought: [boss(455)] });
  at(30_000);
  e.combat({ at: 1_030_000, fought: [] });
  assert.equal(done.length, 1);
  const r = done[0];
  assert.equal(r.key, "thamon");
  assert.deepEqual(
    r.events.filter((x) => x[1] !== "h").map((x) => [x[1], x[2]]),
    [["c", 1604670], ["s", 1604390]],
  );
  assert.deepEqual(r.events.filter((x) => x[1] === "h").map((x) => x[2]), [100, 45]);
  const sum = L.summary(r, D, "en");
  assert.equal(sum.list[0].kind, "cast");
  assert.equal(sum.list[0].line, "Surging violet!");
  assert.equal(e.state("en").fight, null);
});

test("a monster that is no boss is followed only when it has a sheet", () => {
  const { e } = engine({ "npc-77": { entries: [{ id: "p", kind: "phase", name: "Go", when: { type: "start" } }] } });
  e.combat({ at: 1_000_000, fought: [{ entity: 1, npc: 76, name: "Mob", boss: false, hp: 5, maxHp: 10 }] });
  assert.equal(e.state("en").fight, null);
  e.combat({ at: 1_000_000, fought: [{ entity: 2, npc: 77, name: "Elite", boss: false, hp: 5, maxHp: 10 }] });
  assert.equal(e.state("en").phase.name, "Go");
});

test("the starter sheets are the hand-checked mechanics", () => {
  const s = L.starters(D, "en");
  assert.ok(s.thamon.entries.some((x) => x.name === "Purple — stop magic attacks" && x.when.type === "cast" && x.when.value === 1604670));
  assert.ok(s.vakron.entries.some((x) => x.when.type === "skill"));
});
