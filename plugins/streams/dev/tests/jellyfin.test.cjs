// The Streams plugin's Jellyfin helpers: the server's answers in the cards'
// shape, the tracks, the parts to skip, the times. (Reaching the server,
// home network only, is the meter's: plugins/jellyfin.rs.)
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const J = require(path.join(process.env.PLUGIN_DIR || path.join(__dirname, "../.."), "jellyfin.js"));

const A = "0123456789abcdef0123456789abcdef";
const B = "fedcba9876543210fedcba9876543210";

test("an episode, a film and a show as cards", () => {
  const [ep, film, show, bad] = J.items({ Items: [
    { Id: A, Type: "Episode", Name: "Pilot", SeriesName: "Show", SeriesId: B, ParentIndexNumber: 1, IndexNumber: 3,
      RunTimeTicks: 24 * 60 * 1e7, ImageTags: { Primary: "x" }, UserData: { PlaybackPositionTicks: 6 * 60 * 1e7, PlayedPercentage: 25 } },
    { Id: B, Type: "Movie", Name: "Film", ProductionYear: 2024, BackdropImageTags: ["y"], ImageTags: { Primary: "p" }, UserData: { Played: true } },
    { Id: A, Type: "Series", Name: "Show", IsFolder: true, UserData: { UnplayedItemCount: 4 } },
    { Id: "x", Type: "Movie" },
  ] });
  assert.strictEqual(bad, undefined);
  assert.strictEqual(ep.code, "S1 E3");
  assert.strictEqual(ep.sub, "Show · S1 E3");
  assert.strictEqual(ep.position, 360);
  assert.strictEqual(ep.percent, 25);
  assert.deepStrictEqual(ep.wide, { item: A, type: "Primary" });
  assert.ok(ep.playable && !ep.openable);
  assert.deepStrictEqual(film.wide, { item: B, type: "Backdrop" });
  assert.deepStrictEqual(film.poster, { item: B, type: "Primary" });
  assert.ok(film.played);
  assert.strictEqual(film.sub, "2024");
  assert.ok(show.openable && !show.playable);
  assert.strictEqual(show.unplayed, 4);
});

test("libraries: films and shows first, music left out", () => {
  const libs = J.libraries({ Items: [
    { Id: A, Name: "Music", CollectionType: "music" },
    { Id: B, Name: "Shows", CollectionType: "tvshows" },
    { Id: A.replace("0", "1"), Name: "Films", CollectionType: "movies" },
  ] });
  assert.deepStrictEqual(libs.map((l) => l.name), ["Films", "Shows"]);
});

test("the parts to skip, from Media Segments or the Intro Skipper", () => {
  const segs = J.segments({ Items: [
    { Type: "Outro", StartTicks: 1300 * 1e7, EndTicks: 1400 * 1e7 },
    { Type: "Intro", StartTicks: 60 * 1e7, EndTicks: 150 * 1e7 },
    { Type: "Commercial", StartTicks: 0, EndTicks: 10 * 1e7 },
    { Type: "Intro", StartTicks: 5 * 1e7, EndTicks: 5.5 * 1e7 },
  ] });
  assert.deepStrictEqual(segs, [{ kind: "intro", start: 60, end: 150 }, { kind: "credits", start: 1300, end: 1400 }]);
  assert.strictEqual(J.skipLabel(J.segmentAt(segs, 100)), "Skip intro");
  assert.strictEqual(J.segmentAt(segs, 149.5), null);
  assert.strictEqual(J.segmentAt(segs, 30), null);
  const old = J.segments({ Introduction: { IntroStart: 10, IntroEnd: 95, Valid: true }, Credits: { IntroStart: 0, IntroEnd: 0, Valid: false } });
  assert.deepStrictEqual(old, [{ kind: "intro", start: 10, end: 95 }]);
  assert.deepStrictEqual(J.segments(null), []);
});

test("the tracks: mpv's numbers for the file's, the server's for the rest", () => {
  const t = J.tracks({
    DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: 5,
    MediaStreams: [
      { Index: 0, Type: "Video" },
      { Index: 1, Type: "Audio", Language: "jpn", DisplayTitle: "Japanese" },
      { Index: 2, Type: "Audio", Language: "ger", DisplayTitle: "German" },
      { Index: 3, Type: "Subtitle", Codec: "ass", DisplayTitle: "German (ASS)" },
      { Index: 4, Type: "Subtitle", Codec: "PGSSUB", DisplayTitle: "English (PGS)" },
      { Index: 5, Type: "Subtitle", Codec: "subrip", IsExternal: true, DisplayTitle: "English (SRT)" },
      { Index: 6, Type: "Subtitle", Codec: "pgs", IsExternal: true },
    ],
  });
  assert.deepStrictEqual(t.audio.map((a) => [a.index, a.ord]), [[1, 1], [2, 2]]);
  assert.strictEqual(t.audioIndex, 2);
  assert.deepStrictEqual(t.subs.map((s) => [s.index, s.ord, s.external, s.format]), [[3, 1, false, "ass"], [4, 2, false, null], [5, null, true, "srt"]]);
  assert.strictEqual(t.subIndex, 5);
  assert.strictEqual(J.tracks({ MediaStreams: [], DefaultSubtitleStreamIndex: -1 }).subIndex, -1);
});

test("times", () => {
  assert.strictEqual(J.clock(65), "1:05");
  assert.strictEqual(J.clock(3725), "1:02:05");
  assert.strictEqual(J.clock(-3), "0:00");
});
