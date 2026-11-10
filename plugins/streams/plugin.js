// The Streams plugin's window: Twitch's live channels (your favourites,
// AION 2's, all, a search) and YouTube's videos (your FreeTube
// subscriptions and saved channels, a search). A click plays one in the
// video overlay (the widget "video"): the meter's mpv draws it there, and
// the meter's lock makes it click-through. Favourites and settings are
// kept in the plugin's storage on this computer.
(() => {
  const L = globalThis.StreamLists;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const WIDGET = "video";
  const SIZES = { s: [320, 180], m: [480, 270], l: [640, 360], xl: [800, 450] };

  const settings = {
    tab: "twitch",
    twitchView: "aion",
    youtubeView: "subs",
    quality: "1080",
    volume: 70,
    mute: false,
    size: "m",
    overlaySize: null, // [w, h] after a corner was dragged
    useFreeTube: true,
  };
  // Twitch logins; YouTube channels { id, name, thumbnail }.
  const favs = { twitch: [], youtube: [] };
  // What plays: { kind, id, title, sub } and the player's state.
  let playing = null;
  let player = { state: "", title: "", pause: false, buffering: false, error: "" };
  let overlayOpen = false;

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
      const got = pictures.get(url) || a2.web.image(url);
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
    card.classList.toggle("playing", playing?.kind === "twitch" && playing.id === c.login);
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
    card.classList.toggle("playing", playing?.kind === "youtube" && playing.id === v.id);
    const thumb = el("div", "thumb");
    thumb.append(picture(`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`));
    if (v.live) thumb.append(el("span", "badge live", "LIVE"));
    if (v.duration) thumb.append(el("span", "badge right", L.length(v.duration)));
    card.append(thumb);
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
    try {
      youtube.results = await a2.video.search(q);
    } catch (e) {
      youtube.error = String(e?.message || e);
    }
    youtube.busy = false;
    redraw();
  }

  function drawYoutube(box) {
    const view = settings.youtubeView;
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
  const overlaySize = () => (Array.isArray(settings.overlaySize) ? settings.overlaySize : SIZES[settings.size] || SIZES.m);

  async function openOverlay() {
    const [width, height] = overlaySize();
    await a2.widgets.open(WIDGET, { width, height });
    overlayOpen = true;
  }

  async function play(what) {
    playing = what;
    player = { state: "loading", title: what.title, pause: false, buffering: false, error: "" };
    drawPlayer();
    redraw();
    try {
      await openOverlay();
      tellWidget();
      await a2.video.play(WIDGET, {
        [what.kind]: what.id,
        quality: settings.quality,
        volume: settings.mute ? 0 : settings.volume,
      });
      if (settings.mute) a2.video.control(WIDGET, "mute", true).catch(() => {});
      settings.last = what;
      save();
    } catch (e) {
      player.state = "error";
      player.error = String(e?.message || e);
      drawPlayer();
      tellWidget();
    }
  }

  async function stop() {
    await a2.video.control(WIDGET, "stop").catch(() => {});
    playing = null;
    player = { state: "", title: "", pause: false, buffering: false, error: "" };
    await a2.widgets.close(WIDGET).catch(() => {});
    overlayOpen = false;
    drawPlayer();
    redraw();
  }

  a2.on("video", (v) => {
    if (!v || v.widget !== WIDGET || !playing) return;
    if (v.state) player.state = v.state;
    if (v.state === "loading" || v.state === "playing") player.error = "";
    if (v.error) player.error = v.error;
    if (typeof v.title === "string" && v.title && !/^(https?:|watch\?)/.test(v.title)) player.title = v.title;
    if (typeof v.pause === "boolean") player.pause = v.pause;
    if (typeof v.buffering === "boolean") player.buffering = v.buffering;
    if (typeof v.mute === "boolean") settings.mute = v.mute;
    drawPlayer();
    tellWidget();
  });

  function stateText() {
    if (player.state === "error") return humanError(player.error);
    if (player.state === "loading") return "Starting …";
    if (player.state === "ended") return "Ended";
    if (player.buffering) return "Loading …";
    if (player.pause) return "Paused";
    return playing?.kind === "twitch" ? `Twitch · ${playing.id}` : `YouTube${playing?.sub ? ` · ${playing.sub}` : ""}`;
  }

  // mpv's and yt-dlp's words, said plainly where we know them.
  function humanError(e) {
    const t = String(e || "");
    if (/yt-dlp is not installed|youtube-dl|ytdl/i.test(t) && /not|fail|found/i.test(t)) return "yt-dlp is missing: sudo pacman -S yt-dlp";
    if (/libmpv|mpv is not installed/i.test(t)) return "mpv is missing: sudo pacman -S mpv";
    if (/loading failed|unrecognized file format/i.test(t)) return playing?.kind === "twitch" ? "Not live right now, or Twitch didn't give the stream" : "YouTube didn't give this video";
    return t || "It didn't play";
  }

  function tellWidget() {
    if (!overlayOpen) return;
    a2.widgets.send(WIDGET, {
      title: player.title || playing?.title || "",
      sub: stateText(),
      state: player.state,
      playing: !!playing,
      failed: player.state === "error",
    }).catch(() => {});
  }

  function drawPlayer() {
    const bar = $(".player");
    bar.hidden = !playing;
    if (!playing) return;
    bar.classList.toggle("on", player.state === "playing" && !player.pause);
    bar.classList.toggle("failed", player.state === "error");
    $(".nowTitle").textContent = player.title || playing.title;
    $(".nowState").textContent = stateText();
    $(".pause").textContent = player.pause ? "▶" : "❚❚";
    $(".mute").textContent = settings.mute ? "🔇" : "🔊";
    if (document.activeElement !== $(".volume")) $(".volume").value = String(settings.volume);
    $(".quality").value = settings.quality;
    const size = Array.isArray(settings.overlaySize) ? "" : settings.size;
    for (const b of $$(".sizes button")) b.setAttribute("aria-pressed", String(b.dataset.size === size));
  }

  $(".pause").addEventListener("click", () => a2.video.control(WIDGET, "pause", !player.pause).catch(() => {}));
  $(".mute").addEventListener("click", () => {
    settings.mute = !settings.mute;
    save();
    a2.video.control(WIDGET, "mute", settings.mute).catch(() => {});
    if (!settings.mute) a2.video.control(WIDGET, "volume", settings.volume).catch(() => {});
    drawPlayer();
  });
  $(".volume").addEventListener("input", () => {
    settings.volume = Number($(".volume").value);
    a2.video.control(WIDGET, "volume", settings.volume).catch(() => {});
    if (settings.mute) {
      settings.mute = false;
      a2.video.control(WIDGET, "mute", false).catch(() => {});
    }
    drawPlayer();
  });
  $(".volume").addEventListener("change", save);
  $(".quality").addEventListener("change", () => {
    settings.quality = $(".quality").value;
    save();
    if (playing) play(playing);
  });
  for (const b of $$(".sizes button")) {
    b.addEventListener("click", () => {
      settings.size = b.dataset.size;
      settings.overlaySize = null;
      save();
      drawPlayer();
      if (overlayOpen) openOverlay().catch(() => {});
    });
  }
  $(".stop").addEventListener("click", stop);

  // The overlay's own buttons and corners.
  a2.on("widget-message", ({ name, data }) => {
    if (name !== WIDGET || !data) return;
    if (data.type === "close") stop();
    else if (data.type === "pause") a2.video.control(WIDGET, "pause", !player.pause).catch(() => {});
    else if (data.type === "resized" && Number.isFinite(data.width) && Number.isFinite(data.height)) {
      settings.overlaySize = [Math.round(data.width), Math.round(data.height)];
      save();
      drawPlayer();
    } else if (data.type === "hello") tellWidget();
  });

  // The meter's header button for the overlay: on shows the overlay (and
  // plays the last one again), off stops it.
  a2.on("overlay", (data) => {
    if (data?.show) {
      if (settings.last) play(settings.last);
      else openOverlay().then(tellWidget).catch(() => {});
    } else {
      stop();
    }
  });

  // ---------- the page ----------
  function status(tab) {
    const box = $(`.pane[data-pane="${tab}"] .status`);
    const s = tab === "twitch" ? twitch : youtube;
    box.classList.toggle("error", !!s.error);
    if (s.error) box.textContent = /yt-dlp is not installed/.test(s.error) ? "yt-dlp is missing: sudo pacman -S yt-dlp" : `Couldn't get the list: ${s.error}`;
    else if (s.busy) box.textContent = "Loading …";
    else if (tab === "twitch" && twitch.at) box.textContent = `${twitch.list.filter((c) => c.live).length} live · updated ${new Date(twitch.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    else box.textContent = "";
  }

  function redraw() {
    for (const t of $$(".tab")) t.setAttribute("aria-selected", String(t.dataset.tab === settings.tab));
    for (const p of $$(".pane")) p.hidden = p.dataset.pane !== settings.tab;
    for (const tab of ["twitch", "youtube"]) {
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
    else drawYoutube(box);
    document.scrollingElement.scrollTop = scroll;
  }

  function setView(tab, view) {
    settings.tab = tab;
    settings[`${tab}View`] = view;
    save();
    redraw();
    if (tab === "twitch") loadTwitch();
    else if (view !== "search") loadFeeds(false);
  }

  for (const t of $$(".tab")) {
    t.addEventListener("click", () => setView(t.dataset.tab, settings[`${t.dataset.tab}View`] === "search" ? (t.dataset.tab === "twitch" ? "aion" : "subs") : settings[`${t.dataset.tab}View`]));
  }
  for (const b of $$(".views button")) {
    b.addEventListener("click", () => setView(b.closest(".pane").dataset.pane, b.dataset.view));
  }
  for (const f of $$(".searchForm")) {
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $(".search", f).value.trim();
      if (!q) return;
      const tab = f.dataset.for;
      if (tab === "twitch") {
        twitch.query = q;
        setView("twitch", "search");
      } else {
        youtube.query = q;
        if (L.youtubeId(q)) { searchYoutube(); return; }
        settings.tab = "youtube";
        settings.youtubeView = "search";
        redraw();
        searchYoutube();
      }
    });
  }
  for (const b of $$(".refresh")) {
    b.addEventListener("click", () => {
      if (settings.tab === "twitch") loadTwitch();
      else if (settings.youtubeView === "search") { if (youtube.query) searchYoutube(); }
      else loadFeeds(true);
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
      Object.assign(settings, (await a2.storage.get("settings")) || {});
      const f = (await a2.storage.get("favourites")) || {};
      if (Array.isArray(f.twitch)) favs.twitch = f.twitch.filter((x) => L.twitchLogin(x));
      if (Array.isArray(f.youtube)) favs.youtube = f.youtube.filter((c) => c && typeof c.id === "string");
    } catch {}
    if (settings.twitchView === "search") settings.twitchView = favs.twitch.length ? "favs" : "aion";
    if (settings.youtubeView === "search") settings.youtubeView = "subs";
    redraw();
    drawPlayer();
    a2.ready();
    if (settings.tab === "twitch") loadTwitch(); else loadFeeds(false);
  })();
})();
