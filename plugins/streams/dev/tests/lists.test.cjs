// The Streams plugin's lists: Twitch's answers, a YouTube feed, the words.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const L = require(path.join(process.env.PLUGIN_DIR || path.join(__dirname, "../.."), "lists.js"));

test("Twitch users and streams in one shape, live ones first by viewers", () => {
  const users = L.twitchList({ users: [
    { login: "Quiet", displayName: "Quiet", stream: null },
    { login: "small", displayName: "Small", stream: { title: "a", viewersCount: 10, createdAt: "2026-11-10T20:00:00Z", game: { displayName: "AION 2" } } },
    null,
    { login: "big", displayName: "Big", stream: { title: "b", viewersCount: 4122, previewImageURL: "https://static-cdn.jtvnw.net/previews-ttv/live_user_big-320x180.jpg" } },
  ] });
  assert.deepStrictEqual(users.map((u) => [u.login, u.live]), [["big", true], ["small", true], ["quiet", false]]);
  assert.strictEqual(users[1].game, "AION 2");
  const streams = L.twitchList({ game: { streams: { edges: [
    { node: { title: "x", viewersCount: 3, broadcaster: { login: "a", displayName: "A" } } },
    { node: { title: "y", viewersCount: 9, broadcaster: { login: "b", displayName: "B" } } },
    { node: { title: "no one" } },
  ] } } });
  assert.deepStrictEqual(streams.map((s) => s.login), ["b", "a"]);
  assert.deepStrictEqual(L.twitchList({ user: null }), []);
  assert.strictEqual(L.twitchList({ searchFor: { channels: { items: [{ login: "z" }] } } })[0].login, "z");
  assert.deepStrictEqual(L.twitchList({ currentUser: { follows: { edges: [{ node: { login: "a", stream: null } }, { node: { login: "b", stream: { viewersCount: 5 } } }] } } }).map((c) => c.login), ["b", "a"]);
});

test("a YouTube feed's videos, newest first, Shorts marked", () => {
  const xml = `<?xml version="1.0"?><feed><title>Guides &amp; More</title>
  <entry><yt:videoId>AAAAAAAAAAA</yt:videoId><yt:channelId>UC0123456789012345678901</yt:channelId><title>Old one</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/><author><name>Guides &amp; More</name></author>
  <published>2026-11-01T10:00:00+00:00</published><media:group><media:community><media:statistics views="1234"/></media:community></media:group></entry>
  <entry><yt:videoId>BBBBBBBBBBB</yt:videoId><title>New &#39;one&#39;</title><link rel="alternate" href="https://www.youtube.com/shorts/BBBBBBBBBBB"/>
  <published>2026-11-09T10:00:00+00:00</published></entry>
  <entry><yt:videoId>bad</yt:videoId><title>x</title></entry></feed>`;
  const v = L.youtubeFeed(xml);
  assert.deepStrictEqual(v.map((x) => x.id), ["BBBBBBBBBBB", "AAAAAAAAAAA"]);
  assert.strictEqual(v[0].title, "New 'one'");
  assert.strictEqual(v[0].short, true);
  assert.strictEqual(v[0].channel, "Guides & More");
  assert.strictEqual(v[1].views, 1234);
  assert.strictEqual(v[1].short, false);
});

test("the words on the cards", () => {
  assert.strictEqual(L.count(2626), "2.6K");
  assert.strictEqual(L.count(33920), "34K");
  assert.strictEqual(L.count(1500000), "1.5M");
  assert.strictEqual(L.count(995), "995");
  const now = Date.parse("2026-11-10T22:00:00Z");
  assert.strictEqual(L.uptime("2026-11-10T17:14:00Z", now), "4h 46m");
  assert.strictEqual(L.ago("2026-11-10T21:43:00Z", now), "17 min ago");
  assert.strictEqual(L.ago("2026-11-08T22:00:00Z", now), "2 days ago");
  assert.strictEqual(L.length(1653), "27:33");
  assert.strictEqual(L.length(3725), "1:02:05");
});

test("a channel name or a video link out of what was typed", () => {
  assert.strictEqual(L.twitchLogin("https://www.twitch.tv/Zealand?x=1"), "zealand");
  assert.strictEqual(L.twitchLogin("FaroooYT"), "faroooyt");
  assert.strictEqual(L.twitchLogin("two words"), "two");
  assert.strictEqual(L.twitchLogin("ü"), null);
  assert.strictEqual(L.youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), "dQw4w9WgXcQ");
  assert.strictEqual(L.youtubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.strictEqual(L.youtubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.strictEqual(L.youtubeId("aion 2 guide"), null);
});

test("pictures only from the servers the meter shows them from", () => {
  assert.ok(L.pictureOk("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
  assert.ok(L.pictureOk("https://static-cdn.jtvnw.net/previews-ttv/live_user_x-320x180.jpg?t=1"));
  assert.ok(!L.pictureOk("https://yt3.googleusercontent.com/x"));
  assert.ok(!L.pictureOk("http://i.ytimg.com/vi/x"));
});
