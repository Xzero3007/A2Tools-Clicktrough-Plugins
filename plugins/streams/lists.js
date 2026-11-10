// The Streams plugin's lists: Twitch's and YouTube's answers made into one
// shape for the cards, and the words and numbers on them. No page objects
// here, so the tests run it in Node (dev/tests).
(() => {
  const str = (v) => (typeof v === "string" ? v : "");
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // A Twitch user (a channel), live or not: { login, name, avatar, live,
  // title, viewers, startedAt, preview, game }.
  function twitchUser(u) {
    if (!u || typeof u !== "object" || !str(u.login)) return null;
    const s = u.stream && typeof u.stream === "object" ? u.stream : null;
    return {
      login: u.login.toLowerCase(),
      name: str(u.displayName) || u.login,
      avatar: str(u.profileImageURL),
      live: !!s,
      title: str(s?.title) || str(u.broadcastSettings?.title),
      viewers: s ? num(s.viewersCount) : 0,
      startedAt: str(s?.createdAt),
      preview: str(s?.previewImageURL),
      game: str(s?.game?.displayName),
    };
  }

  // A live stream (Twitch's streams list): the same shape.
  function twitchStream(s) {
    const b = s?.broadcaster;
    if (!b || !str(b.login)) return null;
    return twitchUser({ ...b, stream: s });
  }

  // Whatever a Twitch query answered: users (search, user, channels) or
  // streams (live), live ones first, by viewers.
  function twitchList(data) {
    let out = [];
    if (Array.isArray(data?.users)) out = data.users.map(twitchUser);
    else if (data?.user !== undefined) out = [twitchUser(data.user)];
    else if (Array.isArray(data?.searchFor?.channels?.items)) out = data.searchFor.channels.items.map(twitchUser);
    else {
      const edges = data?.game ? data.game.streams?.edges : data?.streams?.edges;
      if (Array.isArray(edges)) out = edges.map((e) => twitchStream(e?.node));
    }
    return out.filter(Boolean).sort((a, b) => (b.live - a.live) || (b.viewers - a.viewers));
  }

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const unescape = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    return m ? unescape(m[1].trim()) : "";
  };

  // A YouTube channel's feed (Atom): its videos, newest first:
  // [{ id, title, channel, channelId, published, views }].
  function youtubeFeed(xml) {
    const text = String(xml || "");
    const channelName = tag(text.split("<entry>")[0], "title");
    const out = [];
    for (const m of text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const e = m[1];
      const id = tag(e, "yt:videoId");
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
      const views = e.match(/<media:statistics[^>]*views="(\d+)"/);
      const author = e.match(/<author>([\s\S]*?)<\/author>/);
      out.push({
        id,
        title: tag(e, "title"),
        channel: (author && tag(author[1], "name")) || channelName,
        channelId: tag(e, "yt:channelId"),
        published: tag(e, "published"),
        views: views ? Number(views[1]) : null,
        // A Short's link says so.
        short: /<link[^>]*href="[^"]*\/shorts\//.test(e),
      });
    }
    return out.sort((a, b) => String(b.published).localeCompare(String(a.published)));
  }

  // "1.2K", "34K", "1.5M".
  function count(n) {
    n = num(n);
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K`;
    return String(Math.round(n));
  }

  // How long a stream has run: "4h 46m", "12m".
  function uptime(startedAt, now = Date.now()) {
    const t = Date.parse(startedAt);
    if (!Number.isFinite(t)) return "";
    const m = Math.max(0, Math.floor((now - t) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  }

  // How long ago: "17 min ago", "3 h ago", "2 days ago", "5 weeks ago".
  function ago(when, now = Date.now()) {
    const t = Date.parse(when);
    if (!Number.isFinite(t)) return "";
    const m = Math.max(0, Math.floor((now - t) / 60000));
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.floor(h / 24);
    if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
    if (d < 70) return `${Math.floor(d / 7)} weeks ago`;
    const mo = Math.floor(d / 30.4);
    if (mo < 24) return `${mo} months ago`;
    return `${Math.floor(d / 365)} years ago`;
  }

  // A video's length: "27:33", "1:02:05".
  function length(seconds) {
    const s = Math.round(num(seconds));
    if (!s) return "";
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60));
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
  }

  // A Twitch login, or a channel's page address, as the login.
  function twitchLogin(text) {
    const t = String(text || "").trim().replace(/^https?:\/\/(www\.|m\.)?twitch\.tv\//i, "").split(/[/?#\s]/)[0];
    return /^[A-Za-z0-9_]{1,25}$/.test(t) ? t.toLowerCase() : null;
  }

  // A YouTube video id out of a link (watch, youtu.be, shorts, live,
  // embed) or the id itself.
  function youtubeId(text) {
    const t = String(text || "").trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
    const m = t.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
    return m ? m[1] : null;
  }

  // The picture servers the meter shows pictures from for this plugin.
  const PICTURE = /^https:\/\/(i\.ytimg\.com\/vi\/|yt3\.ggpht\.com\/|static-cdn\.jtvnw\.net\/(previews-ttv|jtv_user_pictures)\/)/;
  const pictureOk = (url) => PICTURE.test(String(url || ""));

  const api = { twitchUser, twitchStream, twitchList, youtubeFeed, count, uptime, ago, length, twitchLogin, youtubeId, pictureOk };
  if (typeof module !== "undefined") module.exports = api;
  globalThis.StreamLists = api;
})();
