// The Armory plugin's sums (calc.js) and its reading of NC's pages (nc.js)
// and of a saved questlog.gg build page, on made-up characters.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
require(path.join(dir, "data.js"));
require(path.join(dir, "calc.js"));
require(path.join(dir, "nc.js"));
const D = globalThis.ARMORY_DATA;
const C = globalThis.ArmoryCalc;
const NC = globalThis.ArmoryNC;

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} (± ${tol})`);
const idOf = (name, il) => Number(Object.keys(D.items).find((k) => D.items[k][0] === name && (!il || D.items[k][3] === il)));

test("the data: the game's enhance tables and the enhanceable items", () => {
  assert.ok(Object.keys(D.items).length > 3000);
  assert.equal(D.enchant.Enchant_Unique_86.filter((s) => s[0] > 0).length, 15);
  assert.ok(Object.keys(D.amplify).length > 50);
  assert.equal(D.mats.CoinEnchant.name, "Enhance Stone");
  assert.equal(D.mats.Enchant_Amplify_A_s_02a_f.id, 516530001);
  const bow = D.items[String(idOf("Enraged Kromede Longbow", 86))];
  assert.deepEqual(bow.slice(1, 4), ["Unique", "Bow", 86]);
  assert.equal(bow[5], "Enchant_Unique_86");
});

test("one step's tries, its chance rising after each failure", () => {
  assert.deepEqual(C.stepTries(10000, 0), { expected: 1, certain: 1, p90: 1 });
  // 20 % and 5 % more a failure: about 3.4 tries, certain by the 17th.
  const t = C.stepTries(2000, 500);
  near(t.expected, 3.4, 0.05, "tries");
  assert.equal(t.certain, 17);
  assert.ok(t.p90 >= 5 && t.p90 <= 7);
});

test("enhancing as Aion2Data's calculator has it: +0 to +15 on an item level 86 Unique", () => {
  const item = { id: idOf("Enraged Kromede Longbow", 86) };
  const c = C.climb(C.enchantTable(item), 0, 15);
  assert.equal(c.steps.length, 15);
  near(c.sum.tries, 22.24, 0.01, "tries");
  near(c.sum.kinah, 12628926, 2, "Kinah");
  near(c.sum.mats.CoinEnchant, 160752, 2, "Enhance Stones");
  // Only the last steps: +14 to +15.
  const last = C.climb(C.enchantTable(item), 14, 15);
  near(last.sum.kinah, 5376096, 2, "+14 → +15 Kinah");
});

test("a step that loses a level on failure counts the climb back (Clash Rune)", () => {
  const rune = C.climb(D.enchant.Rune_PvE_Unique, 0, 10);
  // Aion2Data: 68,978 tries and 4,230,566,866 Kinah on average to +10.
  near(rune.sum.tries, 68978, 2, "tries");
  near(rune.sum.kinah, 4230566866, 5000, "Kinah");
});

test("the gear score from its parts, as the game counts it", () => {
  const snap = {
    items: [
      { slot: "MainHand", il: 86, enchant: 15, amplify: 4, stones: [{ grade: "Rare" }, { grade: "Legend" }], theostones: [{ grade: "Rare" }] },
      { slot: "Helmet", il: 86, enchant: 13, amplify: 0, stones: [{ grade: "Common" }, { grade: "Unique" }] },
      { slot: "Arcana1", il: 80, enchant: 3, arcana: true },
    ],
    boards: [{ points: 107 }, { points: 98 }],
  };
  const g = C.gearScore(snap);
  assert.deepEqual(g.parts, { level: 252, enchant: 31, amplify: 20, manastones: 10, theostones: 3, daevanion: 205 });
  assert.equal(g.total, 252 + 31 + 20 + 10 + 3 + 205);
});

test("the cheapest way to a target gear score", () => {
  const bow = idOf("Enraged Kromede Longbow", 86);
  const snap = { items: [
    { slot: "MainHand", id: bow, il: 86, enchant: 15, amplify: 0, maxEnchant: 15, maxAmplify: 5 },
    { slot: "Bracelet1", id: idOf("Ascension Bracelet", 51), il: 51, enchant: 10, amplify: 0, maxEnchant: 15, maxAmplify: 0 },
  ] };
  // Without a price for Amplify Stones, the bow's first Amplify level (600k
  // Kinah for 5 points) is the cheapest a point.
  const plan = C.planGearScore(snap, 1000, 1005, null);
  assert.ok(plan.reached);
  assert.equal(plan.gs, 1005);
  assert.deepEqual([plan.pieces[0].slot, plan.pieces[0].kind, plan.pieces[0].to], ["MainHand", "amplify", 1]);
  // Dear Amplify Stones: the bracelet's cheaper enhance levels come first
  // (+11 to +13), then the Amplify level beats its dearer +14.
  const dear = C.planGearScore(snap, 1000, 1005, new Map([["516530001", 1e6]]));
  assert.deepEqual(dear.pieces.map((p) => [p.slot, p.kind, p.from, p.to]), [["Bracelet1", "enchant", 10, 13], ["MainHand", "amplify", 0, 1]]);
  assert.equal(dear.gs, 1008);
  // Everything there is: 5 enhance levels and 5 Amplify levels.
  const all = C.planGearScore(snap, 1000, 9999, null);
  assert.equal(all.reached, false);
  assert.equal(all.gs, 1000 + 5 + 25);
  assert.equal(C.gearRoom(snap), 30);
  // Amplify Stones at a market price count in Kinah.
  const priced = C.planGearScore(snap, 1000, 9999, new Map([["516530001", 50000]]));
  assert.ok(priced.total.worth.total > priced.total.kinah);
  assert.ok(!("Enchant_Amplify_A_s_02a_f" in priced.total.worth.unpriced));
});

test("where a skill's level comes from, and what is left to 20", () => {
  const snap = {
    skills: [
      { name: "Snipe", category: "Active", level: 16 },
      { name: "Explosion Trap", category: "Active", level: 7 },
      { name: "Griffon Arrow", category: "Dp", level: 16 },
    ],
    items: [{ slot: "Arcana2", name: "Parchment of Magic", arcana: true, subSkills: [{ name: "Snipe", level: 2 }] }],
    boards: [
      { name: "Nezekan", nodes: [
        { type: "SkillLevel", grade: "Legend", open: true, effects: ["Snipe +1"] },
        { type: "SkillLevel", grade: "Legend", open: false, effects: ["Explosion Trap +1"] },
      ] },
      { name: "Zikel", nodes: [{ type: "SkillLevel", grade: "Rare", open: true, effects: ["Snipe +3"] }] },
    ],
  };
  const [snipe, trap, stigma] = C.skillSources(snap);
  assert.deepEqual([snipe.base, snipe.fromDaev, snipe.fromGear, snipe.to20, snipe.gearFor20], [10, 4, 2, 4, 4]);
  assert.deepEqual([trap.base, trap.baseRoom, trap.closedNodes.length, trap.closedNodes[0].points], [7, 3, 1, 3]);
  assert.equal(stigma.gearFor20, null);
});

test("NC's pages read into a snapshot", () => {
  assert.equal(NC.regionOf(2305), "eu");
  assert.equal(NC.regionOf(1101), "nae");
  assert.equal(NC.regionOf(2501), "as");
  const ref = { serverId: 2305, characterId: "AbC-d_e=" };
  assert.match(NC.infoUrl(ref), /^https:\/\/aion2\.plaync\.com\/api\/character\/info\?lang=en-US&region=eu&serverId=2305&characterId=AbC-d_e%3D$/);
  assert.match(NC.searchUrl("Some Name", 2305), /^https:\/\/api-search\.plaync\.com\/aion2global\/search\/v2\/character\?keyword=Some\+Name&.*region=eu/);
  const found = NC.readSearch({ list: [
    { characterId: "x%3D", name: "<strong>Other</strong>", serverId: 2305 },
    { characterId: "AbC%3D", name: "<strong>Tester</strong>", serverId: 2305, level: 45, serverName: "Marchutan", profileImageUrl: "/game_profile_images/a?b=1" },
  ] }, "tester", 2305);
  assert.equal(found.characterId, "AbC=");
  assert.equal(found.portrait, "https://profileimg.plaync.com/game_profile_images/a?b=1");
  const info = NC.readInfo({
    profile: { characterId: "AbC=", characterName: "Tester", characterLevel: 45, className: "Ranger", combatPower: 1000, serverId: 2305, serverName: "Marchutan" },
    stat: { statList: [{ type: "STR", name: "Might", value: 56, statSecondList: ["Attack increase +5.6%"] }, { type: "ItemLevel", name: "?", value: 2626 }] },
    title: { ownedCount: 3, totalCount: 9, titleList: [] }, ranking: { rankingList: null },
    daevanion: { boardList: [{ id: 31, name: "Nezekan", openNodeCount: 2, totalNodeCount: 3 }] },
  });
  assert.equal(info.profile.gs, 2626);
  assert.equal(info.stats.STR.value, 56);
  assert.deepEqual(info.rankings, []);
  const eq = NC.readEquipment({ equipment: { equipmentList: [
    { slotPos: 1, slotPosName: "MainHand", id: 7, name: "Bow", grade: "Unique", enchantLevel: 15, exceedLevel: 4 },
    { slotPos: 41, slotPosName: "Arcana1", id: 8, name: "Card", grade: "Unique", enchantLevel: 3, exceedLevel: 0 },
  ] }, skill: { skillList: [{ id: 1, name: "Snipe", category: "Active", skillLevel: 16, acquired: 1, equip: 1 }] }, petwing: {} });
  assert.deepEqual(eq.slots.map((s) => [s.slot, s.enchant, s.amplify, s.arcana]), [["MainHand", 15, 4, false], ["Arcana1", 3, 0, true]]);
  const item = NC.readItem({ name: "Bow", level: 86, maxEnchantLevel: 15, maxExceedEnchantLevel: 5,
    mainStats: [{ id: "WeaponFixingDamage", name: "Attack", value: "431", extra: "146" }],
    magicStoneStat: [{ name: "MP", value: "+30", grade: "Rare" }], magicStoneSlotCount: 4,
    godStoneStat: [{ name: "Theostone", desc: "…", grade: "Rare" }], subSkills: [{ name: "Tempest Shot", level: 1 }] }, eq.slots[0]);
  assert.deepEqual([item.il, item.maxEnchant, item.maxAmplify, item.stones.length, item.stoneSlots, item.subSkills[0].level], [86, 15, 5, 1, 4, 1]);
  const board = NC.readBoard({ nodeList: [
    { nodeId: 1, type: "Start", grade: "None", open: 1, effectList: [] },
    { nodeId: 2, type: "Stat", grade: "Common", open: 1, effectList: [{ desc: "HP +600" }] },
    { nodeId: 3, type: "SkillLevel", grade: "Legend", open: 1, effectList: [{ desc: "Snipe +1" }] },
    { nodeId: 4, type: "Stat", grade: "Unique", open: 0, effectList: [{ desc: "Combat Speed +1.5%" }] },
    { nodeId: 5, type: "None", grade: "None", open: 0, effectList: [] },
  ] }, { id: 31, name: "Nezekan" });
  assert.deepEqual([board.points, board.maxPoints, board.open, board.total], [4, 8, 2, 3]);
  const snap = NC.snapshotOf({ info, equipment: eq, items: [item], boards: [board], at: 5 });
  assert.equal(snap.items[0].il, 86);
  assert.equal(snap.items[1].slot, "Arcana1");
  assert.equal(NC.keyOf(2305, "Tes ter"), "c-2305-Tes_ter");
});

// A saved build page, cut down to what the reading looks at.
const PAGE = `<!doctype html><html><head><title>Testbuild | AION2 Build | questlog.gg</title>
<script>var x = "<img src=nope.webp>";</script></head><body>
<div><img alt="Splendent Ebony Dragon Lord Bow" src="./p_files/Icon_WP_BW_0100_T06.webp"></div>
<span>Create New Build</span>
<div><span>+</span><span>20</span><img src="./p_files/UT_SlotGrade_Unique.webp"><img src="./p_files/Icon_WP_BW_0100_T06.webp"></div>
<div><span>+</span><span>10</span><img src="./p_files/UT_SlotGrade_Unique.webp"><img src="./p_files/Icon_Equip_AR_L_Idris_01_Helmet.webp"></div>
<div><span>+</span><span>20</span><img src="./p_files/UT_SlotGrade_Unique.webp"><img src="./p_files/Icon_ACC_ER_0047.webp"></div>
<div><span>+</span><span>20</span><img src="./p_files/UT_SlotGrade_Unique.webp"><img src="./p_files/Icon_ACC_ER_0047.webp"></div>
<div><span>+</span><span>7</span><img src="./p_files/UT_SlotGrade_Special.webp"><img src="./p_files/Icon_Acc_Rune_R_002.webp"></div>
<span>Equipment</span><span>Skills</span>
<span>Skills</span><span>Active</span>
<img src="./p_files/ICON_RA_SKILL_001.webp"><span>16</span>
<img src="./p_files/ICON_RA_SKILL_002.webp">
<img src="./p_files/ICON_RA_SKILL_013.webp"><span>12</span>
<span>Stigma</span>
<img src="./p_files/ICON_RA_SKILL_006.webp"><img src="./p_files/ICON_RA_SKILL_022.webp">
<img src="./p_files/ICON_RA_SKILL_001.webp"><span>16</span><span>1</span>
<span>Board Points</span><span>Nezekan</span><span>97 / 134</span><span>Ariel</span><span>60 / 232</span><span>Nezekan</span>
<span>Justice [Nezekan]</span><span>51</span><span>Time [Siel]</span><span>110</span>
<span>Gear Score</span><span>3107</span><span>Max Attack</span><span>1.099</span>
</body></html>`;

test("a saved questlog.gg build page read into a reference", () => {
  const ref = C.readQuestlogPage(PAGE);
  assert.equal(ref.name, "Testbuild");
  assert.equal(ref.gearScore, 3107);
  assert.deepEqual(ref.gear.map((g) => [g.slot, g.name, g.enchant, g.amplify]), [
    ["MainHand", "Splendent Ebony Dragon Lord Bow", 15, 5],
    ["Helmet", "Nuakum Helm", 10, 0],
    // The earrings have only their picture: the set of the weapon's name.
    ["Earring1", "Splendent Ebony Dragon Lord Earrings", 15, 5],
    ["Earring2", "Splendent Ebony Dragon Lord Earrings", 15, 5],
    ["Rune1", "Clash Rune", 7, 0],
  ]);
  assert.equal(ref.gear[0].guessed, false);
  assert.equal(ref.gear[2].guessed, true);
  assert.deepEqual(ref.skills, [
    { icon: "ICON_RA_SKILL_001.webp", level: 16 },
    { icon: "ICON_RA_SKILL_002.webp", level: 20 },
    { icon: "ICON_RA_SKILL_013.webp", level: 12 },
  ]);
  assert.deepEqual(ref.stigmas, ["ICON_RA_SKILL_006.webp", "ICON_RA_SKILL_022.webp"]);
  assert.deepEqual(ref.boards, [{ name: "Nezekan", points: 97, total: 134 }, { name: "Ariel", points: 60, total: 232 }]);
  assert.deepEqual(ref.deity, { Justice: 51, Time: 110 });
  // Two saved tabs of one build add up.
  const merged = C.mergeReference({ ...ref, gear: [] }, ref);
  assert.equal(merged.gear.length, 5);
  // Compared with a character's gear.
  const rows = C.compareGear({ items: [{ slot: "Helmet", id: idOf("Nuakum Helm", 86), name: "Nuakum Helm", enchant: 13 }] }, ref);
  assert.deepEqual(rows.find((r) => r.slot === "Helmet").status, "done");
  assert.deepEqual(rows.find((r) => r.slot === "MainHand").status, "missing");
});

test("the history keeps what changed", () => {
  const snap = (cp, e) => ({ at: cp, profile: { cp, gs: 2000 + e }, items: [{ slot: "Helmet", id: idOf("Nuakum Helm", 86), enchant: e }], skills: [{ name: "Snipe", level: 16 }], boards: [{ points: 5 }], titles: { owned: 3 } });
  let h = C.addHistory([], C.historyEntry(snap(100, 13)));
  h = C.addHistory(h, { ...C.historyEntry(snap(100, 13)), at: 200 });
  assert.equal(h.length, 1);
  assert.equal(h[0].seen, 200);
  h = C.addHistory(h, C.historyEntry(snap(300, 14)));
  assert.equal(h.length, 2);
  assert.deepEqual(C.historyChanges(h[0], h[1]), ["Nuakum Helm +13 → +14"]);
  // Small gear score steps say little: rises of 5 or more, three of them.
  assert.deepEqual(C.cpPerGearScore([{ cp: 100, gs: 10 }, { cp: 3000, gs: 11 }, { cp: 3400, gs: 13 }]),
    { rate: C.CP_PER_GS_SAMPLE, own: false, samples: 0 });
  const rising = [{ cp: 1000, gs: 100 }, { cp: 1300, gs: 105 }, { cp: 1310, gs: 106 }, { cp: 1700, gs: 110 }, { cp: 2400, gs: 120 }];
  assert.deepEqual(C.cpPerGearScore(rising), { rate: 70, own: true, samples: 3 });
  assert.equal(C.cpPerGearScore([]).rate, C.CP_PER_GS_SAMPLE);
});

test("what the stats do: the game's own descriptions", () => {
  assert.ok(D.glossary.length > 150);
  assert.equal(C.statName("Combat Speed +7.4%"), "Combat Speed");
  assert.equal(C.statName("Cooldown -4.8%"), "Cooldown");
  assert.match(C.explainStat("Double Chance +3.3%").desc, /Double Resist/);
  assert.equal(C.explainStat("anything", "AmplifyWeaponDamage").name, "Weapon Damage Boost");
  const list = C.characterStats({
    stats: { Wisdom: { name: "Wisdom [Lumiel]", value: 33, effects: ["MP Cost -3.3%", "Double Chance +3.3%"] } },
    items: [{ slot: "MainHand", main: [{ id: "WeaponFixingDamage", name: "Attack" }], sub: [{ id: "CombatSpeed", name: "Combat Speed" }], stones: [{ name: "Critical Hit", value: "+7" }] }],
    titles: { list: [{ stats: ["Block +10"], equipStats: ["HP +900"] }] },
    boards: [{ nodes: [{ type: "Stat", open: true, effects: ["Critical Hit +5"] }, { type: "Stat", open: false, effects: ["Evasion +5"] }] }],
  });
  const of = (n) => list.find((x) => x.name === n);
  assert.deepEqual(of("Double Chance").from, ["Wisdom [Lumiel]"]);
  assert.deepEqual(of("Critical Hit").from.sort(), ["Daevanion", "Manastones"]);
  assert.equal(of("Evasion"), undefined);
  assert.ok(list.every((x) => x.entry));
});
