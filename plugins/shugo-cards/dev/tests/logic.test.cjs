// Shugo Cards: the round read from the decoder's events (decoder-check over
// round-frames.txt, made by frames.py), what is kept, worth and statistics.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.PLUGIN_DIR;
for (const f of ["data.js", "anomaly.js", "calc.js"]) require(path.join(dir, f));
const C = globalThis.ShugoCalc;

const events = fs.existsSync(path.join(__dirname, "round-events.jsonl"))
  ? fs.readFileSync(path.join(__dirname, "round-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "decoded:round")
  : null;

test("the decoder hands over the frame as hex", { skip: !events && "no meter source" }, () => {
  assert.equal(events.length, 2);
  assert.match(events[0].data.body, /^[0-9a-f]+$/);
});

test("a round reads: five cards, the bonus layer, the picks", () => {
  const hex = events ? events[0].data.body : fs.readFileSync(path.join(__dirname, "round-frames.txt"), "utf8").split("\n")[1].slice(6).toLowerCase();
  const r = C.parseRound(hex);
  assert.ok(r);
  assert.equal(r.key, "116211-4333");
  assert.equal(r.event, 21070110);
  assert.deepEqual(r.cards.map((c) => c.place), [0, 1, 2, 3, 4]);
  assert.deepEqual(r.cards[1].bonus.map(([i]) => i), [210430080, 210540103, 930100023]);
  assert.deepEqual(r.cards[1].pickers, [{ name: "Tester", times: 2 }]);
  assert.deepEqual(r.cards[3].pickers, [{ name: "Tester", times: 1 }]);
  assert.equal(r.cards[4].main[0][0], 210430080);
  const k = C.keep(r, 1000, "Tester");
  assert.deepEqual(k.cards.map((c) => c.mine), [0, 2, 0, 1, 0]);
  const other = C.keep(r, 1000, "Someone");
  assert.ok(!JSON.stringify(other).includes("Tester"), "no other player's name is kept");
  assert.deepEqual(other.cards.map((c) => c.others || 0), [0, 2, 0, 1, 0]);
});

test("what does not read is null", () => {
  assert.equal(C.parseRound("0000ffff"), null);
  assert.equal(C.parseRound(""), null);
  assert.equal(C.parseRound(null), null);
});

test("worth: this id's listing, else the same item's (a guess); never currencies or unlisted last prices", () => {
  const prices = new Map([
    ["610610013", { price: 7000, soldAvg: null, last: 7000 }],
    ["210430005", { price: 1600000, soldAvg: null, last: 1600000 }], // Fantasy Pauldrons under another id
    ["210650008", { price: null, soldAvg: null, last: 10000362 }], // Tempest Boots, not listed
  ]);
  assert.deepEqual(C.worth(610610013, 2, prices), { unit: 7000, total: 14000, guess: false });
  assert.deepEqual(C.worth(210430080, 1, prices), { unit: 1600000, total: 1600000, guess: true });
  assert.equal(C.worth(210650085, 1, prices).total, null);
  assert.equal(C.worth(930100003, 320, prices).total, null);
  const w = C.cardWorth({ main: [[610610013, 1], [930100003, 320]], bonus: [[210430080, 1]] }, prices);
  assert.equal(w.kinah, 1607000);
  assert.equal(w.guess, true);
  assert.deepEqual(w.cur, { 930100003: 320 });
});

test("the chi-square chance and the advice", () => {
  assert.equal(C.pChi4(0), 1);
  assert.ok(Math.abs(C.pChi4(9.488) - 0.05) < 0.001); // 4 degrees of freedom, 5 %
  assert.equal(C.advise(C.test([5, 5, 5, 5, 5])).sure, false);
  assert.equal(C.advise(C.test([3, 0, 0, 0, 0])).sure, false, "too few cases");
  const t = C.test([20, 4, 5, 6, 5]);
  assert.equal(t.best, 0);
  assert.ok(t.p < 0.05);
  assert.deepEqual(C.advise(t), { place: 0, sure: true });
  assert.equal(C.advise(C.test([2, 1, 0, 0, 1])).left, C.NEED_STRONG - 4);
});

test("statistics over rounds: gold per place on the cards' own items", () => {
  const card = (place, main, extra = {}) => ({ place, main, mine: 0, ...extra });
  const round = (at, goldAt, mineAt) => ({
    key: String(at), at,
    cards: [0, 1, 2, 3, 4].map((p) => card(p, p === goldAt ? [[210430080, 1]] : [[610610013, 1]], p === mineAt ? { mine: 1 } : {})),
  });
  const rounds = [round(1, 2, 2), round(2, 2, 0), round(3, 4, 4)];
  rounds[1].cards[0].bonus = [[210540103, 1], [210430080, 1]];
  const s = C.stats(rounds, new Map([["210430005", { price: 1000000 }], ["610610013", { price: 7000 }]]));
  assert.deepEqual(s.place.map((p) => p.gold), [0, 0, 2, 0, 1]);
  assert.deepEqual(s.place.map((p) => p.best), [0, 0, 2, 0, 1], "the most valuable card by its own items");
  assert.equal(s.golds.length, 4);
  assert.equal(s.golds.filter((g) => g.bonus).length, 1);
  assert.equal(s.bonusCards, 1);
  assert.equal(s.bonusGold, 1);
  assert.equal(s.mineRounds, 3);
  assert.equal(s.items.find((x) => x.item === 610610013).seen, 12, "cards it was on");
});

test("which event: a known number, the person's choice, else a guess by the time", () => {
  const at = (h, m) => new Date(2026, 10, 11, h, m).getTime();
  assert.deepEqual(C.kindOf({ event: 21070110, at: at(21, 4) }), { kind: "shugo", sure: true });
  assert.deepEqual(C.kindOf({ event: 99, at: at(21, 34) }), { kind: "di", sure: false });
  assert.deepEqual(C.kindOf({ event: 99, at: at(21, 4) }), { kind: "shugo", sure: false });
  assert.deepEqual(C.kindOf({ event: 99, at: at(21, 4) }, { 99: "di" }), { kind: "di", sure: true });
  assert.deepEqual(C.kindOf({ event: 21070110, at: at(21, 4) }, { 21070110: "di" }), { kind: "di", sure: true });
  const rounds = [{ event: 21070110, at: at(21, 4) }, { event: 99, at: at(21, 33) }, { event: 99, at: at(22, 33) }];
  assert.equal(C.only(rounds, "all").length, 3);
  assert.equal(C.only(rounds, "shugo").length, 1);
  assert.equal(C.only(rounds, "di").length, 2);
  assert.equal(C.only(rounds, "shugo", { 99: "shugo" }).length, 3);
});

test("per character and for the account", () => {
  const hex = fs.readFileSync(path.join(__dirname, "round-frames.txt"), "utf8").split("\n")[1].slice(6).toLowerCase();
  const k = C.keep(C.parseRound(hex), 1000, "Tester", 2305);
  assert.equal(k.who, "Tester");
  assert.equal(k.server, 2305);
  const rounds = [{ ...k, key: "a" }, { ...k, key: "b", who: "Other" }, { ...k, key: "c" }, { key: "old", at: 1, cards: [] }];
  assert.deepEqual(C.characters(rounds).map((c) => [c.name, c.n]), [["Tester", 2], ["", 1], ["Other", 1]]);
  assert.equal(C.ofChar(rounds, "all").length, 4);
  assert.equal(C.ofChar(rounds, "2305:Tester").length, 2);
  assert.equal(C.ofChar(rounds, "").length, 1);
});
