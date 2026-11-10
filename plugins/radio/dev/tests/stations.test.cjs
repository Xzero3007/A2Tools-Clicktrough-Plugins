// The station list: well formed, every stream on a server the meter lets
// the plugin play from, and the helpers.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const dir = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");
for (const f of ["stations.js", "kit.js"]) {
  new Function(fs.readFileSync(path.join(dir, f), "utf8"))();
}
const S = globalThis.RADIO_STATIONS;
const G = globalThis.RADIO_GENRES;
const C = globalThis.RADIO_COUNTRIES;
const R = globalThis.RadioKit;

test("every station is well formed", () => {
  const ids = new Set();
  const countries = new Set(C.map(([k]) => k));
  assert.ok(S.length >= 20);
  for (const s of S) {
    assert.match(s.id, /^[a-z0-9-]{2,40}$/, s.id);
    assert.ok(!ids.has(s.id), `twice: ${s.id}`);
    ids.add(s.id);
    assert.ok(s.name, s.id);
    assert.ok(countries.has(s.country) && !["all", "fav"].includes(s.country), `${s.id}: ${s.country}`);
    assert.ok(Array.isArray(s.genres) && s.genres.length, s.id);
    for (const g of s.genres) assert.ok(G[g], `${s.id}: genre ${g}`);
    assert.ok(Array.isArray(s.streams) && s.streams.length, s.id);
    for (const u of s.streams) {
      const url = new URL(u);
      assert.ok(url.protocol === "https:" || url.protocol === "http:", u);
      assert.ok(!url.username && !url.password, u);
    }
  }
  assert.ok(S.some((s) => s.id === "best-fm"), "Best FM");
});

test("no link out: the page names no website", () => {
  for (const f of ["index.html", "widget.html", "plugin.js", "widget.js", "kit.js"]) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/https?:\/\//.test(text), `${f} has an address`);
    assert.ok(!/<a\s/i.test(text), `${f} has a link`);
  }
  // stations.js: addresses only in streams (no homepage).
  for (const s of S) assert.ok(!("homepage" in s) && !("url" in s), s.id);
});

test("every stream's server is one the meter allows", { skip: !process.env.METER_PLUGINS_RS && "no meter source" }, () => {
  const rs = fs.readFileSync(process.env.METER_PLUGINS_RS, "utf8");
  const block = rs.match(/pub const RADIO_HOSTS: &\[&str\] = &\[([\s\S]*?)\];/);
  assert.ok(block, "RADIO_HOSTS in the meter");
  const hosts = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // The servers the stations name, before the ones they hand on to.
  const named = [...block[1].split("redirects")[0].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const allowed = (host) => hosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));
  const missing = [];
  for (const s of S) for (const u of s.streams) if (!allowed(new URL(u).host)) missing.push(`${s.id}: ${new URL(u).host}`);
  assert.deepStrictEqual(missing, [], "add these to RADIO_HOSTS (meter patch 0043)");
  // And no server listed that no station needs.
  const used = new Set(S.flatMap((s) => s.streams.map((u) => new URL(u).host)));
  const unused = named.filter((h) => ![...used].some((u) => (h.startsWith("*.") ? u.endsWith(h.slice(1)) : u === h)));
  assert.deepStrictEqual(unused, [], "servers no station uses");
});

test("filter by country, genre, search and favourites", () => {
  const fav = new Set([S[0].id]);
  assert.strictEqual(R.filter(S, { country: "all", genre: "", query: "", favourites: fav }).length, S.length);
  assert.deepStrictEqual(R.filter(S, { country: "fav", genre: "", query: "", favourites: fav }).map((s) => s.id), [S[0].id]);
  const tr = R.filter(S, { country: "TR", genre: "", query: "", favourites: fav });
  assert.ok(tr.length && tr.every((s) => s.country === "TR"));
  assert.ok(R.filter(S, { country: "all", genre: "", query: "best", favourites: fav }).some((s) => s.id === "best-fm"));
  // Turkish letters fold: "turku" finds Türkü.
  assert.ok(R.filter(S, { country: "TR", genre: "", query: "turku", favourites: fav }).length > 0);
  const rap = R.filter(S, { country: "all", genre: "rap", query: "", favourites: fav });
  assert.ok(rap.length && rap.every((s) => s.genres.includes("rap")));
  const counts = R.countByCountry(S, fav);
  assert.strictEqual(counts.all, S.length);
  assert.strictEqual(counts.fav, 1);
});

test("checks: a week, known stations only", () => {
  const byId = new Map(S.map((s) => [s.id, s]));
  const now = 1_000_000_000_000;
  const kept = R.freshChecks({
    [S[0].id]: { ok: false, at: now - 3600e3, why: "x" },
    [S[1].id]: { ok: true, at: now - 8 * 86400e3 },
    gone: { ok: true, at: now },
  }, byId, now);
  assert.deepStrictEqual(Object.keys(kept), [S[0].id]);
  assert.strictEqual(R.ago(now - 5 * 60e3, now), "5 min ago");
});
