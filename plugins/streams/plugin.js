// The Streams plugin's window: Twitch's live channels (your favourites,
// AION 2's, all, a search) and YouTube's videos (your FreeTube
// subscriptions and saved channels, a search), and the player's own
// Jellyfin server in the home network (Continue watching, Next up, the
// libraries, a search). A click plays one in its video overlay: the meter's
// mpv draws it there, and the meter's lock makes it click-through.
// Favourites and settings are kept in the plugin's storage on this
// computer; the Jellyfin server's address and key the meter keeps itself.
(() => {
  const L = globalThis.StreamLists;
  const J = globalThis.StreamJellyfin;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const SIZES = { s: [320, 180], m: [480, 270], l: [640, 360], xl: [800, 450] };
  // The qualities each kind offers ("original": Jellyfin's file as it is).
  const QUALITIES = {
    twitch: ["1080", "720", "480", "360", "audio"],
    youtube: ["1080", "720", "480", "360", "audio"],
    jellyfin: ["original", "1080", "720", "480", "360", "audio"],
  };

  const settings = {
    tab: "twitch",
    twitchView: "aion",
    youtubeView: "subs",
    jellyfinView: "home",
    // Jellyfin: skip intros by themselves, play the next episode.
    jellyfin: { autoSkip: false, autoNext: true },
    // Each kind's player: quality, volume, mute, opacity (percent, 20 to
    // 100), size, and [w, h] after a corner was dragged.
    slots: {},
    last: {},
    useFreeTube: true,
  };
  const SLOT_DEFAULTS = { quality: "1080", volume: 70, mute: false, opacity: 100, size: "m", overlaySize: null };
  // Jellyfin plays the file as it is unless asked otherwise.
  const slotDefaults = (kind) => ({ ...SLOT_DEFAULTS, ...(kind === "jellyfin" ? { quality: "original" } : {}) });
  for (const k of ["twitch", "youtube", "jellyfin"]) settings.slots[k] = slotDefaults(k);
  // Twitch logins; YouTube channels { id, name, thumbnail }.
  const favs = { twitch: [], youtube: [], videos: [] };
  // Per kind: what plays ({ kind, id, title, sub }), the player's state,
  // whether its overlay is open.
  const slots = {
    twitch: { widget: "video", playing: null, player: { state: "", title: "", pause: false, buffering: false, error: "" }, open: false },
    youtube: { widget: "youtube", playing: null, player: { state: "", title: "", pause: false, buffering: false, error: "" }, open: false },
    jellyfin: { widget: "jellyfin", playing: null, player: { state: "", title: "", pause: false, buffering: false, error: "" }, open: false },
  };
  let focus = "twitch";

  const save = () => a2.storage.set("settings", settings).catch(() => {});
  const saveFavs = () => a2.storage.set("favourites", favs).catch(() => {});

  // ---------- pictures: through the meter, a few at a time, when seen ----------
  const pictures = new Map();
  const waiting = [];
  let loading = 0;
  function pump() {
    while (loading < 4 && waiting.length) {
      const { url, img } = waiting.shift();
      if (!img.isConnected) continue;
      loading++;
      const got = pictures.get(url) || fetchPicture(url);
      pictures.set(url, got);
      got.then((data) => { img.src = data; img.classList.remove("wait"); })
        .catch(() => pictures.delete(url))
        .finally(() => { loading--; pump(); });
    }
  }
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      waiting.push({ url: e.target.dataset.src, img: e.target });
    }
    pump();
  }, { rootMargin: "300px" });
  // "jf:<item>:<type>:<height>": a picture of the Jellyfin server, through the meter.
  function fetchPicture(url) {
    if (url.startsWith("jf:")) {
      const [, item, type, height] = url.split(":");
      return a2.video.jellyfin("image", { item, type, height: Number(height) });
    }
    return a2.web.image(url);
  }
  function jfPicture(pic, height) {
    const img = document.createElement("img");
    img.alt = "";
    img.className = "wait";
    if (pic) {
      img.dataset.src = `jf:${pic.item}:${pic.type}:${height}`;
      seen.observe(img);
    }
    return img;
  }
  function picture(url, cls = "") {
    const img = document.createElement("img");
    img.alt = "";
    // Not hidden: a picture with display:none is never seen on screen, so
    // it would never be asked for. Invisible and tiny until it has come.
    img.className = cls ? `${cls} wait` : "wait";
    if (L.pictureOk(url)) {
      img.dataset.src = url;
      seen.observe(img);
    }
    return img;
  }
  // Twitch's previews change: a new address every 5 minutes.
  const fresh = (url) => (url ? `${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 300000)}` : "");

  function avatar(url, name) {
    const box = document.createElement("span");
    box.className = "avatar";
    box.textContent = (String(name || "?").trim()[0] || "?").toUpperCase();
    if (L.pictureOk(url)) {
      const img = picture(url);
      img.addEventListener("load", () => { box.textContent = ""; box.append(img); }, { once: true });
      box.append(img);
    }
    return box;
  }

  // ---------- the cards ----------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function starButton(on, title, toggle) {
    const b = el("button", `star${on ? " on" : ""}`, on ? "★" : "☆");
    b.type = "button";
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    return b;
  }

  function twitchCard(c) {
    const card = el("div", "card");
    card.classList.toggle("playing", slots.twitch.playing?.id === c.login);
    const thumb = el("div", "thumb");
    thumb.append(picture(fresh(c.preview)));
    thumb.append(el("span", "badge live", "LIVE"));
    if (c.startedAt) thumb.append(el("span", "badge left", `⏱ ${L.uptime(c.startedAt)}`));
    thumb.append(el("span", "badge right", `👁 ${L.count(c.viewers)}`));
    const fav = favs.twitch.includes(c.login);
    card.append(thumb, starButton(fav, fav ? "Remove from favourites" : "Add to favourites", () => toggleTwitchFav(c.login)));
    const words = el("div", "words");
    words.append(el("div", "title", c.title || c.name), el("div", "sub", c.name), el("div", "sub", c.game));
    const meta = el("div", "meta");
    meta.append(avatar(c.avatar, c.name), words);
    card.append(meta);
    card.title = `${c.name}${c.game ? ` · ${c.game}` : ""}\n${c.title}`;
    card.addEventListener("click", () => play({ kind: "twitch", id: c.login, title: c.name, sub: c.title }));
    return card;
  }

  function twitchRow(c) {
    const row = el("div", "row");
    const words = el("div", "words");
    words.append(el("div", "", c.name), el("div", "sub", c.live ? c.title : "Offline"));
    const fav = favs.twitch.includes(c.login);
    const star = starButton(fav, fav ? "Remove from favourites" : "Add to favourites", () => toggleTwitchFav(c.login));
    star.classList.remove("star");
    const playBtn = el("button", "", "Play");
    playBtn.type = "button";
    playBtn.title = "Play it (when the channel is live)";
    playBtn.addEventListener("click", () => play({ kind: "twitch", id: c.login, title: c.name, sub: c.title }));
    row.append(avatar(c.avatar, c.name), words, playBtn, star);
    return row;
  }

  function videoCard(v) {
    const card = el("div", "card");
    card.classList.toggle("playing", slots.youtube.playing?.id === v.id);
    const thumb = el("div", "thumb");
    thumb.append(picture(`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`));
    if (v.live) thumb.append(el("span", "badge live", "LIVE"));
    if (v.duration) thumb.append(el("span", "badge right", L.length(v.duration)));
    card.append(thumb);
    {
      const on = favs.videos.some((x) => x.id === v.id);
      const heart = el("button", `heart${on ? " on" : ""}`, on ? "♥" : "♡");
      heart.type = "button";
      heart.title = on ? "Remove from your favourite videos" : "Add to your favourite videos";
      heart.addEventListener("click", (e) => { e.stopPropagation(); toggleVideoFav(v); });
      card.append(heart);
    }
    if (v.isNew) thumb.append(el("span", "badge new", "NEW"));
    if (v.hideable && v.channelId) {
      const hide = el("button", "hideCh", "Hide channel");
      hide.type = "button";
      hide.title = `Never show ${v.channel || "this channel"} in AION 2 new`;
      hide.addEventListener("click", (e) => { e.stopPropagation(); hideTrackerChannel(v.channelId); });
      card.append(hide);
    }
    if (v.channelId) {
      const fav = favs.youtube.some((c) => c.id === v.channelId);
      card.append(starButton(fav, fav ? `Remove ${v.channel} from your channels` : `Add ${v.channel} to your channels`,
        () => toggleYoutubeChannel({ id: v.channelId, name: v.channel })));
    }
    const words = el("div", "words");
    const bits = [v.views != null ? `${L.count(v.views)} views` : "", v.published ? L.ago(v.published) : ""].filter(Boolean).join(" · ");
    words.append(el("div", "title", v.title), el("div", "sub", v.channel), el("div", "sub", bits));
    const meta = el("div", "meta");
    meta.append(words);
    card.append(meta);
    card.title = `${v.title}\n${v.channel}`;
    card.addEventListener("click", () => play({ kind: "youtube", id: v.id, title: v.title, sub: v.channel }));
    return card;
  }

  // ---------- favourites ----------
  // Favourite videos: a list to watch later (the heart on a video).
  function toggleVideoFav(v) {
    const i = favs.videos.findIndex((x) => x.id === v.id);
    if (i >= 0) favs.videos.splice(i, 1);
    else favs.videos.unshift({ id: v.id, title: v.title || "", channel: v.channel || "", channelId: v.channelId || "", duration: v.duration || null, published: v.published || "", addedAt: Date.now() });
    if (favs.videos.length > 300) favs.videos.length = 300;
    saveFavs();
    redraw();
  }
  function toggleTwitchFav(login) {
    const i = favs.twitch.indexOf(login);
    if (i >= 0) favs.twitch.splice(i, 1);
    else favs.twitch.push(login);
    saveFavs();
    if (settings.twitchView === "favs") loadTwitch(); else redraw();
  }
  function toggleYoutubeChannel(ch) {
    const i = favs.youtube.findIndex((c) => c.id === ch.id);
    if (i >= 0) favs.youtube.splice(i, 1);
    else favs.youtube.push({ id: ch.id, name: ch.name || ch.id, thumbnail: ch.thumbnail || "" });
    feeds.delete(ch.id);
    saveFavs();
    redraw();
  }

  // ---------- Twitch ----------
  const twitch = { list: [], query: "", at: 0, error: "", busy: false };
  async function loadTwitch() {
    const view = settings.twitchView;
    twitch.busy = true;
    twitch.error = "";
    status("twitch");
    try {
      let data;
      if (view === "favs") data = favs.twitch.length ? await a2.video.twitch("channels", favs.twitch) : { users: [] };
      else if (view === "aion") data = await a2.video.twitch("live", "AION 2");
      else if (view === "all") data = await a2.video.twitch("live", null);
      else {
        // A search: Twitch's, and the name itself as a channel when it is one.
        const q = twitch.query;
        const login = L.twitchLogin(q);
        const [found, exact] = await Promise.all([
          a2.video.twitch("search", q).catch((e) => ({ error: e })),
          login ? a2.video.twitch("user", login).catch(() => null) : null,
        ]);
        const list = found?.error ? [] : L.twitchList(found);
        const own = exact ? L.twitchList(exact) : [];
        for (const c of own) if (!list.some((x) => x.login === c.login)) list.unshift(c);
        if (found?.error && !own.length) throw found.error;
        data = { users: [] };
        twitch.list = list;
      }
      if (view !== "search") twitch.list = L.twitchList(data);
      twitch.at = Date.now();
    } catch (e) {
      twitch.error = String(e?.message || e);
      twitch.list = [];
    }
    twitch.busy = false;
    if (settings.twitchView === view) redraw();
  }

  function drawTwitch(box) {
    const list = twitch.list;
    const live = list.filter((c) => c.live);
    const off = list.filter((c) => !c.live);
    if (settings.twitchView === "favs" && !favs.twitch.length) {
      box.append(el("div", "empty", "No favourites yet. Find a channel (the search, AION 2, All live) and click its ☆, or type a channel's name in the search and press Enter."));
      return;
    }
    if (!list.length && !twitch.busy && !twitch.error) {
      box.append(el("div", "empty", settings.twitchView === "search" ? "Nothing found." : "No one is live here right now."));
      return;
    }
    if (live.length) {
      if (settings.twitchView === "favs" || settings.twitchView === "search") box.append(el("h3", "", `Live (${live.length})`));
      const grid = el("div", "grid");
      for (const c of live) grid.append(twitchCard(c));
      box.append(grid);
    }
    if (off.length) {
      box.append(el("h3", "", "Offline"));
      const rows = el("div", "rows");
      for (const c of off) rows.append(twitchRow(c));
      box.append(rows);
    }
  }

  // ---------- YouTube ----------
  const feeds = new Map(); // channel id -> { at, videos, error }
  const youtube = { results: [], query: "", error: "", busy: false, subs: null, channel: "" };

  async function loadSubs() {
    if (!settings.useFreeTube) { youtube.subs = []; return; }
    try {
      youtube.subs = (await a2.video.freetube()) || [];
    } catch {
      youtube.subs = [];
    }
  }
  const channels = () => {
    const out = [...favs.youtube];
    for (const s of youtube.subs || []) if (!out.some((c) => c.id === s.id)) out.push(s);
    return out;
  };

  let feedRun = 0;
  async function loadFeeds(force) {
    const run = ++feedRun;
    youtube.busy = true;
    youtube.error = "";
    if (youtube.subs == null || force) await loadSubs();
    const todo = channels().filter((c) => force || !feeds.has(c.id) || Date.now() - feeds.get(c.id).at > 15 * 60000);
    status("youtube");
    redraw();
    let i = 0;
    const next = async () => {
      while (i < todo.length && run === feedRun) {
        const c = todo[i++];
        try {
          feeds.set(c.id, { at: Date.now(), videos: L.youtubeFeed(await a2.video.feed(c.id)).filter((v) => !v.short) });
        } catch (e) {
          feeds.set(c.id, { at: Date.now(), videos: [], error: String(e?.message || e) });
        }
        if (i % 4 === 0) redraw();
      }
    };
    await Promise.all([next(), next(), next()]);
    if (run !== feedRun) return;
    youtube.busy = false;
    redraw();
  }

  async function searchYoutube() {
    const q = youtube.query;
    const id = L.youtubeId(q);
    if (id) {
      play({ kind: "youtube", id, title: "YouTube video", sub: "" });
      return;
    }
    youtube.busy = true;
    youtube.error = "";
    youtube.results = [];
    status("youtube");
    redraw();
    youtube.resultsFor = q;
    try {
      youtube.results = await a2.video.search(q);
    } catch (e) {
      youtube.error = String(e?.message || e);
    }
    youtube.busy = false;
    redraw();
  }

  // ---------- AION 2 new: the newest AION 2 videos in English, German, Turkish ----------
  // Three of YouTube's searches, newest uploads first (yt-dlp, through the
  // meter), every 30 minutes while the meter runs. YouTube's list doesn't
  // say a video's language: titles in other scripts (Korean, Chinese,
  // Japanese, Cyrillic, Thai, Arabic, Vietnamese) and with a few Spanish,
  // Portuguese, French, Italian or Polish words are left out, and a channel
  // can be hidden for good.
  const TRACK_SEARCHES = ["AION 2", "AION 2 deutsch", "AION 2 türkçe"];
  const TRACK_EVERY = 30 * 60000;
  const tracker = { videos: [], hidden: [], at: 0, seenAt: 0, shownSince: 0, busy: false, error: "" };
  const saveTracker = () => a2.storage.set("aion2Tracker", { videos: tracker.videos, hidden: tracker.hidden, at: tracker.at, seenAt: tracker.seenAt }).catch(() => {});
  const OTHER_SCRIPT = /[Ѐ-ӿ؀-ۿ฀-๿ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯Ạ-ỹƠơƯư]/;
  const OTHER_WORDS = /(^|[^\p{L}])(español|espanol|guía|guia|nuevo|nueva|mejor|cómo|português|portugues|brasil|pt-br|novo|nova|melhor|français|francais|meilleur|nouveau|italiano|polski|po polsku|indonesia|bahasa|tiếng)(?![\p{L}])/iu;
  function trackerKeeps(v) {
    const text = `${v.title} ${v.channel}`;
    if (!/aion/i.test(text)) return false;
    if (OTHER_SCRIPT.test(text) || OTHER_WORDS.test(v.title)) return false;
    return !tracker.hidden.includes(v.channelId);
  }
  async function trackAion2(force) {
    if (tracker.busy || (!force && Date.now() - tracker.at < TRACK_EVERY)) return;
    tracker.busy = true;
    tracker.error = "";
    if (settings.youtubeView === "new") status("youtube");
    let found = 0;
    let failed = 0;
    for (const q of TRACK_SEARCHES) {
      try {
        const list = await a2.video.search(q, { newest: true });
        for (const v of Array.isArray(list) ? list : []) {
          if (v.live || tracker.videos.some((x) => x.id === v.id)) continue;
          tracker.videos.push({ ...v, foundAt: Date.now() });
          found++;
        }
      } catch (e) {
        failed++;
        tracker.error = String(e?.message || e);
      }
    }
    if (failed < TRACK_SEARCHES.length) tracker.error = "";
    // The newest found first; at most 200 kept.
    tracker.videos.sort((a, b) => b.foundAt - a.foundAt);
    if (tracker.videos.length > 200) tracker.videos.length = 200;
    tracker.at = Date.now();
    tracker.busy = false;
    // Looked at while found: seen (the NEW marks stay for this visit).
    if (settings.tab === "youtube" && settings.youtubeView === "new") tracker.seenAt = Date.now();
    saveTracker();
    drawTrackerCount();
    if (found || settings.youtubeView === "new") redraw();
  }
  function trackerUnseen() {
    return tracker.videos.filter((v) => v.foundAt > tracker.seenAt && trackerKeeps(v)).length;
  }
  function drawTrackerCount() {
    const b = $('.pane[data-pane="youtube"] .views button[data-view="new"]');
    if (!b) return;
    const n = trackerUnseen();
    b.textContent = n ? `AION 2 new (${n})` : "AION 2 new";
  }
  function hideTrackerChannel(id) {
    if (!tracker.hidden.includes(id)) tracker.hidden.push(id);
    saveTracker();
    drawTrackerCount();
    redraw();
  }
  setInterval(() => trackAion2(false), 5 * 60000);

  function drawYoutube(box) {
    const view = settings.youtubeView;
    if (view === "favs") {
      if (!favs.videos.length) box.append(el("div", "empty", "No favourite videos yet. Click the ♡ on a video to keep it here."));
      const grid = el("div", "grid");
      for (const v of favs.videos) grid.append(videoCard(v));
      box.append(grid);
      return;
    }
    if (view === "new") {
      const list = tracker.videos.filter(trackerKeeps);
      if (tracker.hidden.length) {
        const undo = el("button", "more", `Show hidden channels again (${tracker.hidden.length})`);
        undo.type = "button";
        undo.addEventListener("click", () => { tracker.hidden = []; saveTracker(); drawTrackerCount(); redraw(); });
        box.append(undo);
      }
      if (!list.length && !tracker.busy) box.append(el("div", "empty", tracker.at ? "No new AION 2 videos found yet." : "Looking for new AION 2 videos …"));
      const grid = el("div", "grid");
      for (const v of list.slice(0, 120)) grid.append(videoCard({ ...v, isNew: v.foundAt > tracker.shownSince, hideable: true }));
      box.append(grid);
      return;
    }
    if (view === "search") {
      if (!youtube.results.length && !youtube.busy && !youtube.error) box.append(el("div", "empty", "Nothing found."));
      const grid = el("div", "grid");
      for (const v of youtube.results) grid.append(videoCard(v));
      box.append(grid);
      return;
    }
    const all = channels();
    if (view === "channels") {
      if (!all.length) {
        box.append(el("div", "empty", "No channels yet. Your FreeTube subscriptions show here when FreeTube is installed; add more with the ☆ on a video from the search."));
        return;
      }
      const rows = el("div", "rows");
      for (const c of all.slice().sort((a, b) => a.name.localeCompare(b.name))) {
        const row = el("div", "row");
        const words = el("div", "words");
        const f = feeds.get(c.id);
        const own = favs.youtube.some((x) => x.id === c.id);
        words.append(el("div", "", c.name), el("div", "sub",
          [own ? "Your channel" : "FreeTube", f?.error ? `can't read it: ${f.error}` : f?.videos?.[0] ? `newest ${L.ago(f.videos[0].published)}` : ""].filter(Boolean).join(" · ")));
        const show = el("button", "", "Videos");
        show.type = "button";
        show.addEventListener("click", () => { youtube.channel = c.id; setView("youtube", "subs"); });
        row.append(avatar(c.thumbnail, c.name), words, show);
        if (own) {
          const rm = el("button", "", "Remove");
          rm.type = "button";
          rm.addEventListener("click", () => toggleYoutubeChannel(c));
          row.append(rm);
        }
        rows.append(row);
      }
      box.append(rows);
      return;
    }
    // Subscriptions: every channel's newest videos, newest first.
    if (!all.length) {
      box.append(el("div", "empty", "No subscriptions found. FreeTube's subscriptions show here when FreeTube is installed (its own folder or its Flatpak's); or search a video and add its channel with ☆."));
      return;
    }
    const pick = el("select", "channelPick");
    pick.append(new Option("All channels", ""));
    for (const c of all.slice().sort((a, b) => a.name.localeCompare(b.name))) pick.append(new Option(c.name, c.id));
    pick.value = youtube.channel;
    pick.addEventListener("change", () => { youtube.channel = pick.value; redraw(); });
    box.append(pick);
    const videos = [];
    for (const c of all) {
      if (youtube.channel && c.id !== youtube.channel) continue;
      for (const v of feeds.get(c.id)?.videos || []) videos.push(v);
    }
    videos.sort((a, b) => String(b.published).localeCompare(String(a.published)));
    if (!videos.length && !youtube.busy) box.append(el("div", "empty", "No videos read yet."));
    const grid = el("div", "grid");
    grid.style.marginTop = "10px";
    for (const v of videos.slice(0, 90)) grid.append(videoCard(v));
    box.append(grid);
  }

  // ---------- playing ----------
  // Twitch and YouTube play side by side, each in its own overlay (widget
  // "video" for Twitch, "youtube" for YouTube) with its own volume, opacity,
  // quality and size. The bar below shows one of them (both playing: a
  // switch picks which); the meter's player row shows both.
  const slot = (kind) => slots[kind];
  const kindOfWidget = (name) => Object.keys(slots).find((k) => slots[k].widget === name) || null;
  const idle = () => ({ state: "", title: "", pause: false, buffering: false, error: "" });
  const ss = (kind) => settings.slots[kind];
  const overlaySize = (kind) => (Array.isArray(ss(kind).overlaySize) ? ss(kind).overlaySize : SIZES[ss(kind).size] || SIZES.m);
  const anyPlaying = () => Object.values(slots).some((x) => x.playing);
  // The kind the bar shows: the one asked for if it plays, else one that does.
  const shown = () => (slots[focus].playing ? focus : Object.keys(slots).find((k) => slots[k].playing) || focus);

  async function openOverlay(kind) {
    const [width, height] = overlaySize(kind);
    await a2.widgets.open(slot(kind).widget, { width, height });
    slot(kind).open = true;
  }

  async function play(what) {
    const kind = what.kind;
    const x = slot(kind);
    const c = ss(kind);
    if (kind === "jellyfin" && x.playing) await jfStopped();
    x.playing = what;
    x.player = { ...idle(), state: "loading", title: what.title };
    focus = kind;
    drawPlayer();
    redraw();
    try {
      await openOverlay(kind);
      tellWidget(kind);
      // Before it plays: the meter keeps it for the widget's video.
      await a2.video.control(x.widget, "opacity", c.opacity / 100).catch(() => {});
      const extra = kind === "jellyfin" ? await jfPrepare(what) : {};
      if (x.playing !== what) return;
      await a2.video.play(x.widget, {
        [kind]: what.id,
        quality: c.quality,
        volume: c.mute ? 0 : c.volume,
        ...extra,
      });
      if (c.mute) a2.video.control(x.widget, "mute", true).catch(() => {});
      settings.last[kind] = what;
      save();
    } catch (e) {
      x.player.state = "error";
      x.player.error = String(e?.message || e);
      drawPlayer();
      tellWidget(kind);
    }
  }

  async function stop(kind) {
    const x = slot(kind);
    if (kind === "jellyfin") await jfStopped();
    await a2.video.control(x.widget, "stop").catch(() => {});
    x.playing = null;
    x.player = idle();
    await a2.widgets.close(x.widget).catch(() => {});
    x.open = false;
    drawPlayer();
    redraw();
  }

  a2.on("video", (v) => {
    const kind = kindOfWidget(v?.widget);
    if (!kind || !slot(kind).playing) return;
    const p = slot(kind).player;
    // mpv ending a file with an error in its last seconds (no sound device,
    // a cut-off last frame) ended it all the same.
    if (kind === "jellyfin" && v.state === "error" && p.duration && (p.position || 0) >= p.duration - 3) {
      v = { ...v, state: "ended", error: undefined };
    }
    if (v.state) p.state = v.state;
    if (v.state === "loading" || v.state === "playing") p.error = "";
    if (v.error) p.error = v.error;
    if (typeof v.title === "string" && v.title && !/^(https?:|watch\?)/.test(v.title)) p.title = v.title;
    if (typeof v.pause === "boolean") p.pause = v.pause;
    if (typeof v.buffering === "boolean") p.buffering = v.buffering;
    if (typeof v.mute === "boolean") ss(kind).mute = v.mute;
    if (Number.isFinite(v.position)) p.position = v.position;
    if (Number.isFinite(v.duration)) p.duration = v.duration;
    if (kind === "jellyfin") jfHeard(v);
    // The position alone: only the time moves, nothing else is drawn again.
    if (Object.keys(v).every((k) => k === "position" || k === "widget")) {
      if (kind === "jellyfin") { drawTime(); tellWidget(kind); }
      return;
    }
    drawPlayer();
    tellWidget(kind);
  });

  function stateText(kind) {
    const { playing, player } = slot(kind);
    if (player.state === "error") return humanError(player.error, kind);
    if (player.state === "loading") return "Starting …";
    if (player.state === "ended") return "Ended";
    if (player.state === "next") return "The next episode starts in a moment";
    if (player.buffering) return "Loading …";
    if (player.pause) return "Paused";
    if (kind === "jellyfin") return `Jellyfin${playing?.sub ? ` · ${playing.sub}` : ""}`;
    return kind === "twitch" ? `Twitch · ${playing?.id || ""}` : `YouTube${playing?.sub ? ` · ${playing.sub}` : ""}`;
  }

  // mpv's and yt-dlp's words, said plainly where we know them.
  function humanError(e, kind) {
    const t = String(e || "");
    if (/yt-dlp is not installed|(youtube-dl|yt-dlp|ytdl)\S* (was )?not found/i.test(t)) return "yt-dlp is missing: sudo pacman -S yt-dlp";
    if (/libmpv|mpv is not installed/i.test(t)) return "mpv is missing: sudo pacman -S mpv";
    // yt-dlp's own reasons (the meter passes on what it said through mpv).
    if (/javascript runtime|js.?runtime|\bdeno\b|n challenge|signature/i.test(t)) return "yt-dlp needs a JavaScript runtime for YouTube now: sudo pacman -S deno (and update yt-dlp)";
    if (/sign in to confirm|not a bot/i.test(t)) return "YouTube wants a sign-in to prove you're not a bot (it does this to some networks); try again later";
    if (/only images are available|requested format is not available|no video formats/i.test(t)) return "yt-dlp found no playable stream for this video: update yt-dlp (sudo pacman -Syu yt-dlp) and install deno";
    if (kind === "jellyfin" && /loading failed|unrecognized file format|401|403/i.test(t)) return "Your Jellyfin server didn't give this video (try another quality, or sign in again)";
    // What yt-dlp or mpv said about it, after the plain words.
    const detail = (t.match(/\((.*)\)\s*$/) || [])[1] || "";
    if (/loading failed|unrecognized file format|no audio or video data/i.test(t)) {
      const plain = kind === "twitch" ? "Not live right now, or Twitch didn't give the stream" : "YouTube didn't give this video";
      return detail ? `${plain}: ${detail}` : plain;
    }
    return t || "It didn't play";
  }

  function tellWidget(kind) {
    const x = slot(kind);
    if (!x.open) return;
    a2.widgets.send(x.widget, {
      title: x.player.title || x.playing?.title || "",
      sub: stateText(kind),
      state: x.player.state,
      playing: !!x.playing,
      failed: x.player.state === "error",
      // Jellyfin: where it is, and a part to skip.
      position: kind === "jellyfin" ? x.player.position || 0 : null,
      duration: kind === "jellyfin" ? x.player.duration || 0 : null,
      skip: kind === "jellyfin" ? J.skipLabel(jf.segment) : "",
    }).catch(() => {});
  }

  // The meter's player row (a2.media): each kind in its own slot, always:
  // one not playing offers its last video again (playStop).
  const meterSaid = {};
  const KIND_NAMES = { twitch: "Twitch", youtube: "YouTube", jellyfin: "Jellyfin" };
  const KIND_ICONS = { twitch: "tv", youtube: "youtube", jellyfin: "clapperboard" };
  const isEpisode = (what) => what?.kind === "jellyfin" && what.item?.type === "Episode" && !!what.item.seriesId;
  function tellMeter(kind) {
    const { playing, player } = slot(kind);
    const c = ss(kind);
    const jelly = kind === "jellyfin";
    const last = settings.last[kind];
    const idleState = {
      icon: KIND_ICONS[kind],
      title: last?.title || KIND_NAMES[kind],
      sub: last ? `${KIND_NAMES[kind]} · stopped` : "Nothing played yet",
      playing: false,
      controls: last ? ["playStop"] : [],
    };
    const ep = isEpisode(playing);
    const state = playing ? {
      icon: KIND_ICONS[kind],
      title: player.title || playing.title || "",
      sub: stateText(kind),
      paused: !!player.pause,
      muted: !!c.mute,
      volume: c.volume / 100,
      opacity: c.opacity / 100,
      quality: c.quality,
      controls: jelly
        ? [...(ep ? ["prev"] : []), "pause", ...(ep ? ["next"] : []), "rewind", "forward", ...(jf.segment ? ["skip"] : []), "mute", "volume", "opacity", "quality", "stop"]
        : ["pause", "mute", "volume", "opacity", "quality", "stop"],
      ...(jelly ? { qualities: QUALITIES.jellyfin, skip: J.skipLabel(jf.segment) } : {}),
    } : idleState;
    const key = JSON.stringify(state);
    if (key === meterSaid[kind]) return;
    meterSaid[kind] = key;
    a2.media?.set(state, kind).catch(() => {});
  }

  function drawPlayer() {
    for (const kind of Object.keys(slots)) tellMeter(kind);
    const bar = $(".player");
    bar.hidden = !anyPlaying();
    if (!anyPlaying()) return;
    const kind = shown();
    const { playing, player } = slot(kind);
    const c = ss(kind);
    const several = Object.values(slots).filter((x) => x.playing).length > 1;
    $(".slotSwitch").hidden = !several;
    for (const b of $$(".slotSwitch button")) {
      b.hidden = !slots[b.dataset.slot]?.playing;
      b.setAttribute("aria-pressed", String(b.dataset.slot === kind));
    }
    bar.classList.toggle("on", player.state === "playing" && !player.pause);
    bar.classList.toggle("failed", player.state === "error");
    $(".nowTitle").textContent = player.title || playing?.title || "";
    $(".nowState").textContent = stateText(kind);
    $(".pause").textContent = player.pause ? "▶" : "❚❚";
    $(".mute").textContent = c.mute ? "🔇" : "🔊";
    if (document.activeElement !== $(".volume")) $(".volume").value = String(c.volume);
    if (document.activeElement !== $(".opacity")) $(".opacity").value = String(c.opacity);
    $(".opacityValue").textContent = `${c.opacity}%`;
    for (const o of $(".quality").options) o.hidden = o.disabled = !QUALITIES[kind].includes(o.value);
    $(".quality").value = c.quality;
    drawJfBar(kind);
    const size = Array.isArray(c.overlaySize) ? "" : c.size;
    for (const b of $$(".sizes button")) b.setAttribute("aria-pressed", String(b.dataset.size === size));
  }

  const togglePause = (kind) => a2.video.control(slot(kind).widget, "pause", !slot(kind).player.pause).catch(() => {});
  function setMute(kind, on) {
    const c = ss(kind);
    c.mute = !!on;
    save();
    a2.video.control(slot(kind).widget, "mute", c.mute).catch(() => {});
    if (!c.mute) a2.video.control(slot(kind).widget, "volume", c.volume).catch(() => {});
    drawPlayer();
  }
  function setVolume(kind, v) {
    const c = ss(kind);
    c.volume = Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
    a2.video.control(slot(kind).widget, "volume", c.volume).catch(() => {});
    if (c.mute) {
      c.mute = false;
      a2.video.control(slot(kind).widget, "mute", false).catch(() => {});
    }
    drawPlayer();
  }
  function setOpacity(kind, v) {
    ss(kind).opacity = Math.min(100, Math.max(20, Math.round(Number(v) || 100)));
    a2.video.control(slot(kind).widget, "opacity", ss(kind).opacity / 100).catch(() => {});
    drawPlayer();
  }
  function setQuality(kind, q) {
    if (!QUALITIES[kind].includes(q) || ss(kind).quality === q) return;
    ss(kind).quality = q;
    save();
    const playing = slot(kind).playing;
    // Jellyfin goes on where it was.
    if (playing && kind === "jellyfin") play({ ...playing, start: slot(kind).player.position || playing.start || 0 });
    else if (playing) play(playing);
    else drawPlayer();
  }
  $(".pause").addEventListener("click", () => togglePause(shown()));
  $(".mute").addEventListener("click", () => setMute(shown(), !ss(shown()).mute));
  $(".volume").addEventListener("input", () => setVolume(shown(), $(".volume").value));
  $(".volume").addEventListener("change", save);
  $(".opacity").addEventListener("input", () => setOpacity(shown(), $(".opacity").value));
  $(".opacity").addEventListener("change", save);
  $(".quality").addEventListener("change", () => setQuality(shown(), $(".quality").value));
  for (const b of $$(".slotSwitch button")) {
    b.addEventListener("click", () => { focus = b.dataset.slot; drawPlayer(); });
  }
  // The meter's player row: the same as the buttons here, for its slot.
  let saveSoon = null;
  const saveLater = () => { clearTimeout(saveSoon); saveSoon = setTimeout(save, 800); };
  a2.on("media", ({ action, value, slot: kind } = {}) => {
    if (!slots[kind]) return;
    if (action === "playStop") {
      if (slot(kind).playing) stop(kind);
      else if (settings.last[kind]) play(settings.last[kind]);
      return;
    }
    if (!slot(kind).playing) return;
    if ((action === "prev" || action === "next") && kind === "jellyfin") { jfEpisode(action === "prev" ? -1 : 1); return; }
    if (action === "pause") togglePause(kind);
    else if (action === "mute") setMute(kind, !ss(kind).mute);
    else if (action === "volume" && Number.isFinite(value)) { setVolume(kind, value * 100); saveLater(); }
    else if (action === "opacity" && Number.isFinite(value)) { setOpacity(kind, value * 100); saveLater(); }
    else if (action === "quality" && typeof value === "string") setQuality(kind, value);
    else if (action === "rewind") a2.video.control(slot(kind).widget, "skip", -10).catch(() => {});
    else if (action === "forward") a2.video.control(slot(kind).widget, "skip", 30).catch(() => {});
    else if (action === "skip" && kind === "jellyfin") jfSkip();
    else if (action === "stop") stop(kind);
  });
  for (const b of $$(".sizes button")) {
    b.addEventListener("click", () => {
      const kind = shown();
      ss(kind).size = b.dataset.size;
      ss(kind).overlaySize = null;
      save();
      drawPlayer();
      if (slot(kind).open) openOverlay(kind).catch(() => {});
    });
  }
  $(".stop").addEventListener("click", () => stop(shown()));

  // The overlays' own buttons and corners.
  a2.on("widget-message", ({ name, data }) => {
    const kind = kindOfWidget(name);
    if (!kind || !data) return;
    if (data.type === "close") stop(kind);
    else if (data.type === "pause") togglePause(kind);
    else if (data.type === "skip" && kind === "jellyfin") jfSkip();
    else if (data.type === "seek" && Number.isFinite(data.to)) a2.video.control(slot(kind).widget, "seek", data.to).catch(() => {});
    else if (data.type === "resized" && Number.isFinite(data.width) && Number.isFinite(data.height)) {
      ss(kind).overlaySize = [Math.round(data.width), Math.round(data.height)];
      save();
      drawPlayer();
    } else if (data.type === "hello") tellWidget(kind);
  });

  // The meter's header button (the Twitch overlay): on shows it (and plays
  // the last channel again), off stops it.
  a2.on("overlay", (data) => {
    const kind = kindOfWidget(data?.widget) || "twitch";
    if (data?.show) {
      if (settings.last[kind]) play(settings.last[kind]);
      else openOverlay(kind).then(() => tellWidget(kind)).catch(() => {});
    } else {
      stop(kind);
    }
  });

  // AION2 closed: the videos stop (the meter may stay open, started by hand).
  // Only when it closes: with the game not running at all, they play.
  let gameRunning = null;
  a2.on("game", ({ running } = {}) => {
    const was = gameRunning;
    gameRunning = !!running;
    if (was === true && !gameRunning) for (const kind of Object.keys(slots)) if (slot(kind).playing) stop(kind);
  });

  // ---------- Jellyfin ----------
  // The player's own server, in the home network only: the meter signs in
  // and keeps the key (a2.video.jellyfin); the plugin asks it for the lists
  // and pictures, and tells the server what plays and how far, so Continue
  // watching and "watched" are right in every Jellyfin app.
  const jf = {
    account: undefined, // undefined: not asked yet; null: not signed in
    libs: [], resume: [], nextUp: [], latest: [], results: [], items: [], total: 0,
    // Where the Libraries view is: the library, then a show, then a season.
    path: [],
    query: "", busy: false, error: "", at: 0,
    // What plays: its tracks, its parts to skip, the server's play session.
    tracks: null, segments: [], segment: null, skipped: new Set(), session: "", source: "", method: "DirectPlay",
    started: false, reportedAt: 0, lastPos: 0, nextTimer: 0, seeking: false, tracksKey: "",
  };
  const jfCall = (action, arg) => a2.video.jellyfin(action, arg);
  const LIST_Q = { Fields: J.FIELDS, EnableImageTypes: J.IMAGE_TYPES, ImageTypeLimit: 1, EnableUserData: true };
  const jfError = (e) => {
    const t = String(e?.message || e || "");
    if (/401/.test(t)) return "Your server didn't take the sign-in any more: sign out and in again.";
    if (/could not connect|no answer in time/.test(t)) return `Your Jellyfin server doesn't answer (${t}). Is it on, and this PC in the same network?`;
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  // Newer servers' paths first, then older ones'.
  async function jfGet(paths, query) {
    let last;
    for (const path of paths) {
      try {
        return await jfCall("get", { path, query });
      } catch (e) {
        last = e;
        if (!/40[45]/.test(String(e?.message || e))) throw e;
      }
    }
    throw last;
  }

  async function jfLibs(force) {
    if (jf.libs.length && !force) return;
    jf.libs = J.libraries(await jfGet(["/UserViews", "/Users/{user}/Views"], { userId: jf.account.userId }));
  }

  // The folder at the end of the path: a library's films or shows, a show's
  // seasons, a season's episodes, a collection's items; `more` adds the next page.
  async function jfLoadFolder(more) {
    const at = jf.path[jf.path.length - 1];
    const uid = jf.account.userId;
    const start = more ? jf.items.length : 0;
    let answer;
    if (at.type === "Series") {
      answer = await jfGet([`/Shows/${at.id}/Seasons`], { userId: uid, ...LIST_Q });
    } else if (at.type === "Season") {
      answer = await jfGet([`/Shows/${at.seriesId}/Episodes`], { userId: uid, seasonId: at.id, ...LIST_Q });
    } else {
      const kind = at.kind || "";
      const types = kind === "movies" ? "Movie" : kind === "tvshows" ? "Series" : "";
      answer = await jfGet(["/Items", "/Users/{user}/Items"], {
        userId: uid, ParentId: at.id, SortBy: "SortName", SortOrder: "Ascending", StartIndex: start, Limit: 120,
        ...(types ? { IncludeItemTypes: types, Recursive: true } : {}), ...LIST_Q,
      });
    }
    const got = J.items(answer);
    jf.items = more ? jf.items.concat(got) : got;
    jf.total = Number.isFinite(answer?.TotalRecordCount) ? answer.TotalRecordCount : jf.items.length;
  }

  let jfRun = 0;
  async function loadJellyfin(force, more) {
    const run = ++jfRun;
    if (jf.account === undefined || force) {
      try {
        jf.account = await jfCall("status");
      } catch (e) {
        jf.account = null;
        jf.error = jfError(e);
      }
    }
    if (!jf.account) {
      redraw();
      return;
    }
    const view = settings.jellyfinView;
    const uid = jf.account.userId;
    jf.busy = true;
    jf.error = "";
    redraw();
    try {
      if (view === "home") {
        const [resume, next] = await Promise.all([
          jfGet(["/UserItems/Resume", "/Users/{user}/Items/Resume"], { userId: uid, Limit: 24, MediaTypes: "Video", ...LIST_Q }).catch(() => null),
          jfGet(["/Shows/NextUp"], { userId: uid, Limit: 24, ...LIST_Q }).catch(() => null),
          jfLibs(force),
        ]);
        jf.resume = J.items(resume);
        jf.nextUp = J.items(next);
        jf.latest = await Promise.all(jf.libs.slice(0, 4).map((lib) =>
          jfGet(["/Items/Latest", "/Users/{user}/Items/Latest"], { userId: uid, ParentId: lib.id, Limit: 18, ...LIST_Q })
            .then((a) => ({ lib, items: J.items(a) }))
            .catch(() => ({ lib, items: [] }))));
      } else if (view === "library") {
        await jfLibs(force);
        if (jf.path.length) await jfLoadFolder(more);
      } else if (view === "search" && jf.query) {
        jf.results = J.items(await jfGet(["/Items", "/Users/{user}/Items"], {
          userId: uid, searchTerm: jf.query, IncludeItemTypes: "Movie,Series,Episode", Recursive: true, Limit: 60, ...LIST_Q,
        }));
      }
      jf.at = Date.now();
    } catch (e) {
      jf.error = jfError(e);
    }
    if (run !== jfRun) return;
    jf.busy = false;
    if (settings.jellyfinView === view) redraw();
  }

  function jfOpen(it) {
    remember();
    const at = jf.path[jf.path.length - 1];
    jf.path.push({ id: it.id, name: it.name, type: it.type, seriesId: it.seriesId || (at?.type === "Series" ? at.id : ""), kind: "" });
    if (settings.jellyfinView !== "library") settings.jellyfinView = "library";
    jf.items = [];
    save();
    loadJellyfin(false);
    document.scrollingElement.scrollTop = 0;
  }

  function jfTitle(it) {
    return it.type === "Episode" ? [it.series, it.code, it.name].filter(Boolean).join(" · ") : it.name;
  }
  function jfPlay(it, fromStart) {
    play({ kind: "jellyfin", id: it.id, title: jfTitle(it), sub: it.type === "Episode" ? it.series : "", item: it, start: fromStart ? 0 : it.position || 0 });
  }

  function jfCard(it, wide) {
    const card = el("div", "card");
    card.classList.toggle("playing", slots.jellyfin.playing?.id === it.id);
    const thumb = el("div", wide ? "thumb" : "thumb poster");
    thumb.append(el("span", "fallback", it.name));
    thumb.append(jfPicture(wide ? it.wide || it.poster : it.poster || it.wide, wide ? 240 : 330));
    if (it.played) thumb.append(el("span", "badge done", "✓"));
    else if (it.unplayed) thumb.append(el("span", "badge done", String(it.unplayed)));
    if (it.playable && it.runtime) thumb.append(el("span", "badge right", it.position ? `${L.length(it.runtime - it.position)} left` : L.length(it.runtime)));
    if (it.percent > 0 && !it.played) {
      const bar = el("div", "progress");
      const fill = el("span");
      fill.style.width = `${it.percent}%`;
      bar.append(fill);
      thumb.append(bar);
    }
    card.append(thumb);
    if (it.playable || it.type === "Series" || it.type === "Season") {
      const w = el("button", "watched", "✓");
      w.type = "button";
      w.title = it.played ? "Mark as not watched" : "Mark as watched";
      w.addEventListener("click", (e) => {
        e.stopPropagation();
        jfCall("played", { item: it.id, on: !it.played }).then(() => loadJellyfin(false)).catch((err) => { jf.error = jfError(err); status("jellyfin"); });
      });
      card.append(w);
    }
    const words = el("div", "words");
    const inSeason = jf.path[jf.path.length - 1]?.type === "Season" && settings.jellyfinView === "library";
    words.append(el("div", "title", inSeason && it.code ? `${it.code.replace(/^S\d+ /, "")} · ${it.name}` : it.name), el("div", "sub", inSeason ? "" : it.sub));
    const meta = el("div", "meta");
    meta.append(words);
    card.append(meta);
    card.title = [jfTitle(it), it.playable ? (it.position ? `Click: go on from ${J.clock(it.position)} · right-click: from the start` : "Click to play") : "Click to open"].join("\n");
    card.addEventListener("click", () => (it.playable ? jfPlay(it, false) : it.openable ? jfOpen(it) : null));
    card.addEventListener("contextmenu", (e) => {
      if (!it.playable) return;
      e.preventDefault();
      jfPlay(it, true);
    });
    return card;
  }

  function jfGrid(box, list, wide, heading) {
    if (!list.length) return;
    if (heading) box.append(el("h3", "", heading));
    const grid = el("div", wide ? "grid" : "grid posters");
    for (const it of list) grid.append(jfCard(it, wide));
    box.append(grid);
  }

  function drawJellyfin(box) {
    const signed = !!jf.account;
    $(".jfLogin").hidden = signed || jf.account === undefined;
    $(".jfMain").hidden = !signed;
    if (!signed) return;
    $(".jfAccount").textContent = `${jf.account.user} · ${jf.account.serverName || jf.account.server}`;
    $(".jfAccount").title = jf.account.server;
    $(".jfAutoSkip").checked = !!settings.jellyfin.autoSkip;
    $(".jfAutoNext").checked = !!settings.jellyfin.autoNext;
    const view = settings.jellyfinView;
    const crumbs = $(".crumbs");
    crumbs.replaceChildren();
    if (view === "library" && jf.path.length) {
      const back = (n, name) => {
        const b = el("button", "", name);
        b.type = "button";
        b.addEventListener("click", () => { remember(); jf.path = jf.path.slice(0, n); jf.items = []; loadJellyfin(false); });
        return b;
      };
      crumbs.append(back(0, "Libraries"));
      jf.path.forEach((p, i) => {
        crumbs.append(el("span", "muted", "›"));
        crumbs.append(i === jf.path.length - 1 ? el("span", "here", p.name) : back(i + 1, p.name));
      });
    }
    if (view === "home") {
      jfGrid(box, jf.resume, true, "Continue watching");
      jfGrid(box, jf.nextUp, true, "Next up");
      for (const { lib, items } of jf.latest) jfGrid(box, items, false, `New in ${lib.name}`);
      if (!jf.busy && !jf.error && !jf.resume.length && !jf.nextUp.length && !jf.latest.some((l) => l.items.length)) {
        box.append(el("div", "empty", "Nothing here yet. Your libraries are under Libraries."));
      }
    } else if (view === "library") {
      if (!jf.path.length) {
        const grid = el("div", "grid");
        for (const lib of jf.libs) {
          const tile = el("div", "lib");
          tile.append(el("div", "title", lib.name), el("div", "sub", { movies: "Films", tvshows: "Shows", homevideos: "Videos", musicvideos: "Music videos" }[lib.kind] || "Folder"));
          tile.addEventListener("click", () => { remember(); jf.path = [{ id: lib.id, name: lib.name, type: "lib", kind: lib.kind }]; jf.items = []; loadJellyfin(false); });
          grid.append(tile);
        }
        box.append(grid);
        if (!jf.libs.length && !jf.busy && !jf.error) box.append(el("div", "empty", "No libraries for this user."));
      } else {
        const at = jf.path[jf.path.length - 1];
        const wide = at.type === "Season" || jf.items.every((i) => i.type === "Episode" || i.type === "Video");
        jfGrid(box, jf.items, wide && jf.items.length > 0, "");
        if (!jf.items.length && !jf.busy && !jf.error) box.append(el("div", "empty", "Nothing in here."));
        if (jf.items.length < jf.total && at.type !== "Series" && at.type !== "Season") {
          const more = el("button", "more", `More (${jf.total - jf.items.length})`);
          more.type = "button";
          more.addEventListener("click", () => loadJellyfin(false, true));
          box.append(more);
        }
      }
    } else {
      const eps = jf.results.filter((i) => i.type === "Episode");
      jfGrid(box, jf.results.filter((i) => i.type !== "Episode"), false, eps.length ? "Films and shows" : "");
      jfGrid(box, eps, true, "Episodes");
      if (!jf.results.length && !jf.busy && !jf.error) box.append(el("div", "empty", "Nothing found."));
    }
  }

  $(".jfLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const state = $(".jfLoginState");
    state.classList.remove("error");
    state.textContent = "Signing in …";
    try {
      jf.account = await jfCall("login", { server: f.server.value, user: f.user.value, password: f.password.value });
      f.password.value = "";
      state.textContent = "";
      jf.libs = [];
      settings.jellyfinView = "home";
      save();
      loadJellyfin(false);
    } catch (err) {
      state.classList.add("error");
      state.textContent = jfError(err);
    }
  });
  $(".jfLogout").addEventListener("click", async () => {
    if (slots.jellyfin.playing) await stop("jellyfin");
    await jfCall("logout").catch(() => {});
    Object.assign(jf, { account: null, libs: [], resume: [], nextUp: [], latest: [], results: [], items: [], path: [] });
    redraw();
  });
  $(".jfAutoSkip").addEventListener("change", (e) => { settings.jellyfin.autoSkip = e.target.checked; save(); });
  $(".jfAutoNext").addEventListener("change", (e) => { settings.jellyfin.autoNext = e.target.checked; save(); });

  // ----- playing on the server -----
  const jfId = (s) => String(s || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);

  // Before it plays: the server's file and play session, the tracks the
  // user's settings pick, and (in the background) the parts to skip.
  async function jfPrepare(what) {
    clearTimeout(jf.nextTimer);
    Object.assign(jf, { tracks: null, segments: [], segment: null, skipped: new Set(), started: false, lastPos: what.start || 0, reportedAt: 0, tracksKey: "" });
    let info = null;
    try {
      info = await jfCall("playbackInfo", { item: what.id });
    } catch {}
    const src = Array.isArray(info?.MediaSources) ? info.MediaSources[0] : null;
    jf.source = jfId(src?.Id) || what.id;
    jf.session = jfId(info?.PlaySessionId);
    jf.tracks = src ? J.tracks(src) : null;
    if (jf.tracks && Number.isInteger(what.audioIndex)) jf.tracks.audioIndex = what.audioIndex;
    if (jf.tracks && Number.isInteger(what.subIndex)) jf.tracks.subIndex = what.subIndex;
    const q = ss("jellyfin").quality;
    jf.method = q === "original" || q === "audio" ? "DirectPlay" : "Transcode";
    jfSegments(what.id);
    return {
      start: what.start || 0,
      title: what.title,
      source: jf.source,
      session: jf.session,
      ...(jf.method === "Transcode" && Number.isInteger(jf.tracks?.audioIndex) ? { audio: jf.tracks.audioIndex } : {}),
    };
  }

  // Media Segments (Jellyfin 10.10 and newer), else the Intro Skipper plugin's own.
  async function jfSegments(id) {
    const tries = [
      () => jfCall("get", { path: `/MediaSegments/${id}` }),
      () => jfCall("get", { path: `/Episode/${id}/IntroSkipperSegments` }),
      () => jfCall("get", { path: `/Episode/${id}/IntroTimestamps/v1` }).then((a) => ({ Introduction: a })),
    ];
    for (const t of tries) {
      let segs = [];
      try { segs = J.segments(await t()); } catch {}
      if (segs.length) {
        if (slots.jellyfin.playing?.id === id) jf.segments = segs;
        return;
      }
    }
  }

  function jfReport(kind) {
    const what = slots.jellyfin.playing;
    if (!what) return Promise.resolve();
    jf.reportedAt = Date.now();
    return jfCall("report", {
      kind, item: what.id, source: jf.source, session: jf.session, position: jf.lastPos,
      paused: !!slots.jellyfin.player.pause, muted: !!ss("jellyfin").mute, method: jf.method,
    }).catch(() => {});
  }
  // Stopped: the server keeps where it was (or marks it watched near the end).
  async function jfStopped() {
    clearTimeout(jf.nextTimer);
    if (!slots.jellyfin.playing || !jf.started) return;
    jf.started = false;
    // Played again from the player row: on from here.
    const last = settings.last.jellyfin;
    if (last && last.id === slots.jellyfin.playing.id) { last.start = jf.lastPos; save(); }
    await jfReport("stopped");
    if (settings.tab === "jellyfin" && settings.jellyfinView !== "search") setTimeout(() => loadJellyfin(false), 800);
  }
  window.addEventListener("pagehide", () => { if (jf.started) jfReport("stopped"); });

  function jfSkip() {
    const seg = jf.segment;
    if (!seg) return;
    jf.skipped.add(seg);
    jf.segment = null;
    a2.video.control(slots.jellyfin.widget, "seek", seg.end).catch(() => {});
    drawPlayer();
    tellWidget("jellyfin");
  }

  function jfSubApply() {
    const t = jf.tracks;
    const what = slots.jellyfin.playing;
    if (!t || !what) return;
    const w = slots.jellyfin.widget;
    const s = t.subs.find((x) => x.index === t.subIndex);
    if (!s) a2.video.control(w, "subtitle", "no").catch(() => {});
    else if (!s.external && jf.method === "DirectPlay") a2.video.control(w, "subtitle", s.ord).catch(() => {});
    else if (s.format) a2.video.control(w, "subtitleFile", { item: what.id, source: jf.source, index: s.index, format: s.format }).catch(() => {});
  }
  function jfTracksApply() {
    const t = jf.tracks;
    if (!t) return;
    if (jf.method === "DirectPlay") {
      const a = t.audio.find((x) => x.index === t.audioIndex);
      if (a) a2.video.control(slots.jellyfin.widget, "audio", a.ord).catch(() => {});
    }
    jfSubApply();
  }

  async function jfEnded() {
    const what = slots.jellyfin.playing;
    jf.lastPos = slots.jellyfin.player.duration || jf.lastPos;
    await jfStopped();
    if (!settings.jellyfin.autoNext || what?.item?.type !== "Episode" || !what.item.seriesId || !jf.account) return;
    try {
      const a = await jfGet([`/Shows/${what.item.seriesId}/Episodes`], { userId: jf.account.userId, startItemId: what.id, Limit: 2, ...LIST_Q });
      const next = J.items(a).find((e) => e.id !== what.id);
      if (!next || slots.jellyfin.playing !== what) return;
      slots.jellyfin.player.state = "next";
      slots.jellyfin.player.title = `Next: ${jfTitle(next)}`;
      drawPlayer();
      tellWidget("jellyfin");
      jf.nextTimer = setTimeout(() => { if (slots.jellyfin.playing === what) jfPlay(next, true); }, 4000);
    } catch {}
  }

  // The episode before or after the one playing (the series' order, across
  // seasons), from its start.
  async function jfEpisode(dir) {
    const what = slots.jellyfin.playing;
    if (!isEpisode(what) || !jf.account) return;
    try {
      const all = J.items(await jfGet([`/Shows/${what.item.seriesId}/Episodes`], { userId: jf.account.userId, ...LIST_Q }));
      const at = all.findIndex((e) => e.id === what.id);
      const to = at >= 0 ? all[at + dir] : null;
      if (!to || slots.jellyfin.playing !== what) return;
      jfPlay(to, true);
    } catch (e) {
      jf.error = jfError(e);
      status("jellyfin");
    }
  }

  // What mpv says, for the server and the parts to skip.
  function jfHeard(v) {
    if (!slots.jellyfin.playing) return;
    if (v.state === "playing" && !jf.started) {
      jf.started = true;
      jfTracksApply();
      jfReport("start");
    }
    if (typeof v.pause === "boolean" && jf.started) jfReport("progress");
    if (Number.isFinite(v.position)) {
      jf.lastPos = v.position;
      const seg = J.segmentAt(jf.segments, v.position);
      if (seg !== jf.segment) {
        jf.segment = seg;
        if (seg && settings.jellyfin.autoSkip && !jf.skipped.has(seg)) jfSkip();
        else { drawPlayer(); tellWidget("jellyfin"); }
      }
      if (jf.started && Date.now() - jf.reportedAt > 10000) jfReport("progress");
    }
    if (v.state === "ended") jfEnded();
  }

  // The bar's second row while Jellyfin shows: where it is, skip, the tracks.
  function drawJfBar(kind) {
    const on = kind === "jellyfin" && !!slots.jellyfin.playing;
    $(".seekRow").hidden = !on;
    if (!on) return;
    const ep = isEpisode(slots.jellyfin.playing);
    $(".prevEp").hidden = !ep;
    $(".nextEp").hidden = !ep;
    const sk = $(".skipBtn");
    sk.hidden = !jf.segment;
    sk.textContent = J.skipLabel(jf.segment);
    const t = jf.tracks;
    const key = JSON.stringify([slots.jellyfin.playing.id, t?.audio, t?.subs]);
    if (key !== jf.tracksKey) {
      jf.tracksKey = key;
      const a = $(".audioTrack");
      a.replaceChildren(...(t?.audio || []).map((x) => new Option(x.label, String(x.index))));
      a.hidden = !t || t.audio.length < 2;
      const s = $(".subTrack");
      const subs = (t?.subs || []).filter((x) => x.format || (!x.external && jf.method === "DirectPlay"));
      s.replaceChildren(new Option("No subtitles", "-1"), ...subs.map((x) => new Option(x.label, String(x.index))));
      s.hidden = !subs.length;
    }
    if (t) {
      $(".audioTrack").value = String(t.audioIndex);
      $(".subTrack").value = String(t.subIndex);
    }
    drawTime();
  }
  function drawTime() {
    const x = slots.jellyfin;
    if (!x.playing || shown() !== "jellyfin") return;
    const dur = x.player.duration || x.playing.item?.runtime || 0;
    if (!jf.seeking) {
      $(".time").textContent = J.clock(x.player.position || 0);
      $(".seek").value = String(dur ? Math.round(((x.player.position || 0) / dur) * 1000) : 0);
    }
    $(".total").textContent = J.clock(dur);
  }
  const seekTo = () => {
    const x = slots.jellyfin;
    const dur = x.player.duration || x.playing?.item?.runtime || 0;
    return (Number($(".seek").value) / 1000) * dur;
  };
  $(".seek").addEventListener("input", () => { jf.seeking = true; $(".time").textContent = J.clock(seekTo()); });
  $(".seek").addEventListener("change", () => {
    jf.seeking = false;
    a2.video.control(slots.jellyfin.widget, "seek", seekTo()).catch(() => {});
  });
  $(".back").addEventListener("click", () => a2.video.control(slot(shown()).widget, "skip", -10).catch(() => {}));
  $(".fwd").addEventListener("click", () => a2.video.control(slot(shown()).widget, "skip", 30).catch(() => {}));
  $(".skipBtn").addEventListener("click", jfSkip);
  $(".prevEp").addEventListener("click", () => jfEpisode(-1));
  $(".nextEp").addEventListener("click", () => jfEpisode(1));
  $(".audioTrack").addEventListener("change", () => {
    const what = slots.jellyfin.playing;
    if (!jf.tracks || !what) return;
    jf.tracks.audioIndex = Number($(".audioTrack").value);
    const a = jf.tracks.audio.find((x) => x.index === jf.tracks.audioIndex);
    // The server's conversion has one sound track: it starts again with the other.
    if (jf.method === "DirectPlay" && a) a2.video.control(slots.jellyfin.widget, "audio", a.ord).catch(() => {});
    else play({ ...what, start: slots.jellyfin.player.position || 0, audioIndex: jf.tracks.audioIndex, subIndex: jf.tracks.subIndex });
  });
  $(".subTrack").addEventListener("change", () => {
    if (!jf.tracks) return;
    jf.tracks.subIndex = Number($(".subTrack").value);
    jfSubApply();
  });

  // ---------- back and forth ----------
  // Every place the window was (tab, view, Jellyfin folder, searches): ←
  // goes back to the one before, → on again, as in a browser.
  const nav = { back: [], fwd: [], restoring: false };
  const here = () => ({
    tab: settings.tab, tv: settings.twitchView, yv: settings.youtubeView, jv: settings.jellyfinView,
    path: jf.path.map((p) => ({ ...p })), tq: twitch.query, yq: youtube.query, jq: jf.query,
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function remember() {
    if (nav.restoring) return;
    const now = here();
    if (!same(nav.back[nav.back.length - 1], now)) nav.back.push(now);
    if (nav.back.length > 50) nav.back.shift();
    nav.fwd = [];
    drawNav();
  }
  function drawNav() {
    $(".navBack").disabled = !nav.back.length;
    $(".navFwd").disabled = !nav.fwd.length;
  }
  function goTo(to) {
    nav.restoring = true;
    settings.tab = to.tab;
    settings.twitchView = to.tv;
    settings.youtubeView = to.yv;
    settings.jellyfinView = to.jv;
    jf.path = to.path.map((p) => ({ ...p }));
    twitch.query = to.tq;
    youtube.query = to.yq;
    jf.query = to.jq;
    const input = $(`.searchForm[data-for="${to.tab}"] .search`);
    if (input) input.value = { twitch: to.tq, youtube: to.yq, jellyfin: to.jq }[to.tab] || "";
    save();
    redraw();
    if (to.tab === "twitch") loadTwitch();
    else if (to.tab === "jellyfin") { jf.items = []; loadJellyfin(false); }
    else if (to.yv === "search") { if (youtube.resultsFor !== to.yq && to.yq) searchYoutube(); }
    else if (to.yv === "new") openTracker();
    else if (to.yv !== "favs") loadFeeds(false);
    document.scrollingElement.scrollTop = 0;
    nav.restoring = false;
    drawNav();
  }
  function goBack() {
    if (!nav.back.length) return;
    let to = nav.back.pop();
    while (to && same(to, here()) && nav.back.length) to = nav.back.pop();
    if (!to || same(to, here())) { drawNav(); return; }
    nav.fwd.push(here());
    goTo(to);
  }
  function goFwd() {
    if (!nav.fwd.length) return;
    const to = nav.fwd.pop();
    nav.back.push(here());
    goTo(to);
  }
  $(".navBack").addEventListener("click", goBack);
  $(".navFwd").addEventListener("click", goFwd);
  // The mouse's side buttons, and Alt+← / Alt+→.
  window.addEventListener("mouseup", (e) => {
    if (e.button === 3) { e.preventDefault(); goBack(); }
    else if (e.button === 4) { e.preventDefault(); goFwd(); }
  });
  window.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); goFwd(); }
  });

  // ---------- the page ----------
  function status(tab) {
    const box = $(`.pane[data-pane="${tab}"] .status`);
    const s = tab === "twitch" ? twitch : tab === "jellyfin" ? jf : youtube;
    box.classList.toggle("error", !!s.error);
    if (s.error) box.textContent = /yt-dlp is not installed/.test(s.error) ? "yt-dlp is missing: sudo pacman -S yt-dlp" : `Couldn't get the list: ${s.error}`;
    else if (s.busy) box.textContent = "Loading …";
    else if (tab === "youtube" && settings.youtubeView === "new") {
      box.classList.toggle("error", !!tracker.error);
      box.textContent = tracker.error ? `Couldn't search: ${tracker.error}` : tracker.busy ? "Looking for new videos …"
        : tracker.at ? `English, German and Turkish titles · looked ${new Date(tracker.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, every 30 minutes` : "";
    }
    else if (tab === "twitch" && twitch.at) box.textContent = `${twitch.list.filter((c) => c.live).length} live · updated ${new Date(twitch.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    else box.textContent = "";
  }

  function redraw() {
    for (const t of $$(".tab")) t.setAttribute("aria-selected", String(t.dataset.tab === settings.tab));
    for (const p of $$(".pane")) p.hidden = p.dataset.pane !== settings.tab;
    for (const tab of ["twitch", "youtube", "jellyfin"]) {
      const pane = $(`.pane[data-pane="${tab}"]`);
      const view = settings[`${tab}View`];
      for (const b of $$(".views button", pane)) {
        b.setAttribute("aria-pressed", String(b.dataset.view === view));
        if (b.dataset.view === "search") b.hidden = view !== "search";
      }
      status(tab);
    }
    const box = $(`.pane[data-pane="${settings.tab}"] .list`);
    const scroll = document.scrollingElement.scrollTop;
    box.replaceChildren();
    if (settings.tab === "twitch") drawTwitch(box);
    else if (settings.tab === "jellyfin") drawJellyfin(box);
    else drawYoutube(box);
    document.scrollingElement.scrollTop = scroll;
  }

  function setView(tab, view) {
    remember();
    settings.tab = tab;
    settings[`${tab}View`] = view;
    save();
    redraw();
    if (tab === "twitch") loadTwitch();
    else if (tab === "jellyfin") loadJellyfin(false);
    else if (view === "new") openTracker();
    else if (view === "subs" || view === "channels") loadFeeds(false);
  }
  // Opened: what came since the last look is marked NEW for this visit.
  function openTracker() {
    tracker.shownSince = tracker.seenAt;
    tracker.seenAt = Date.now();
    saveTracker();
    drawTrackerCount();
    redraw();
    trackAion2(false);
  }

  const FIRST_VIEW = { twitch: "aion", youtube: "subs", jellyfin: "home" };
  for (const t of $$(".tab")) {
    t.addEventListener("click", () => {
      const tab = t.dataset.tab;
      // Jellyfin keeps its search and where it was in a library.
      const view = settings[`${tab}View`] === "search" && tab !== "jellyfin" ? FIRST_VIEW[tab] : settings[`${tab}View`];
      setView(tab, view);
    });
  }
  for (const b of $$(".views button")) {
    b.addEventListener("click", () => {
      const tab = b.closest(".pane").dataset.pane;
      remember();
      nav.restoring = true;
      if (tab === "jellyfin" && b.dataset.view === "library") jf.path = [];
      setView(tab, b.dataset.view);
      nav.restoring = false;
    });
  }
  for (const f of $$(".searchForm")) {
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $(".search", f).value.trim();
      if (!q) return;
      const tab = f.dataset.for;
      remember();
      nav.restoring = true;
      if (tab === "twitch") {
        twitch.query = q;
        setView("twitch", "search");
      } else if (tab === "jellyfin") {
        jf.query = q;
        setView("jellyfin", "search");
      } else {
        youtube.query = q;
        if (L.youtubeId(q)) { nav.restoring = false; searchYoutube(); return; }
        settings.tab = "youtube";
        settings.youtubeView = "search";
        redraw();
        searchYoutube();
      }
      nav.restoring = false;
      drawNav();
    });
  }
  // The AION 2 button beside YouTube's search.
  $(".aionSearch").addEventListener("click", () => {
    remember();
    nav.restoring = true;
    youtube.query = "AION 2";
    $('.searchForm[data-for="youtube"] .search').value = youtube.query;
    settings.tab = "youtube";
    settings.youtubeView = "search";
    redraw();
    searchYoutube();
    nav.restoring = false;
    drawNav();
  });
  for (const b of $$(".refresh")) {
    b.addEventListener("click", () => {
      if (settings.tab === "twitch") loadTwitch();
      else if (settings.tab === "jellyfin") loadJellyfin(true);
      else if (settings.youtubeView === "search") { if (youtube.query) searchYoutube(); }
      else if (settings.youtubeView === "new") trackAion2(true);
      else if (settings.youtubeView !== "favs") loadFeeds(true);
    });
  }

  // Twitch's live lists again every 3 minutes while the window shows.
  let visible = true;
  a2.on("visible", (v) => { visible = v !== false; });
  setInterval(() => {
    if (visible && settings.tab === "twitch" && settings.twitchView !== "search") loadTwitch();
  }, 180000);

  (async () => {
    try {
      const saved = (await a2.storage.get("settings")) || {};
      Object.assign(settings, saved);
      // 0.2.x kept one player's settings at the top, and one last video.
      const old = {};
      for (const k of Object.keys(SLOT_DEFAULTS)) if (k in saved) old[k] = saved[k];
      if (!settings.slots || typeof settings.slots !== "object") settings.slots = {};
      if (!settings.last || typeof settings.last !== "object" || settings.last.kind) {
        const was = saved.last && saved.last.kind ? saved.last : null;
        settings.last = was ? { [was.kind]: was } : {};
      }
      for (const k of Object.keys(slots)) settings.slots[k] = { ...slotDefaults(k), ...(k === "jellyfin" ? {} : old), ...(settings.slots[k] || {}) };
      if (!QUALITIES.jellyfin.includes(settings.slots.jellyfin.quality)) settings.slots.jellyfin.quality = "original";
      settings.jellyfin = { autoSkip: false, autoNext: true, ...(saved.jellyfin && typeof saved.jellyfin === "object" ? saved.jellyfin : {}) };
      for (const k of Object.keys(SLOT_DEFAULTS)) delete settings[k];
      const f = (await a2.storage.get("favourites")) || {};
      if (Array.isArray(f.twitch)) favs.twitch = f.twitch.filter((x) => L.twitchLogin(x));
      if (Array.isArray(f.youtube)) favs.youtube = f.youtube.filter((c) => c && typeof c.id === "string");
      if (Array.isArray(f.videos)) favs.videos = f.videos.filter((v) => v && typeof v.id === "string");
      const t = await a2.storage.get("aion2Tracker");
      if (t && typeof t === "object") {
        if (Array.isArray(t.videos)) tracker.videos = t.videos.filter((v) => v && typeof v.id === "string");
        if (Array.isArray(t.hidden)) tracker.hidden = t.hidden.filter((x) => typeof x === "string");
        tracker.at = Number(t.at) || 0;
        tracker.seenAt = Number(t.seenAt) || 0;
      }
    } catch {}
    if (settings.twitchView === "search") settings.twitchView = favs.twitch.length ? "favs" : "aion";
    if (settings.youtubeView === "search") settings.youtubeView = "subs";
    if (!["home", "library"].includes(settings.jellyfinView)) settings.jellyfinView = "home";
    redraw();
    drawPlayer();
    drawNav();
    drawTrackerCount();
    a2.ready();
    // The tracker's first look a minute after the start (the meter busy then).
    setTimeout(() => trackAion2(false), 60000);
    if (settings.tab === "twitch") loadTwitch();
    else if (settings.tab === "jellyfin") loadJellyfin(false);
    else if (settings.youtubeView === "new") openTracker();
    else if (settings.youtubeView !== "favs") loadFeeds(false);
  })();
})();
