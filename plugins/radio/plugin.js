// The Radio plugin: internet radio stations by country and genre, played in
// this page (it keeps running while its tab is closed or the dock hidden),
// with favourites, volume, and a small player over the game (widget.html)
// that only sends this page what was pressed. The stations and their stream
// addresses are stations.js; the meter lets this page play from those
// servers only (its permission "radio", meter patch 0043).
(() => {
  const R = globalThis.RadioKit;
  const STATIONS = globalThis.RADIO_STATIONS;
  const GENRES = globalThis.RADIO_GENRES;
  const COUNTRIES = globalThis.RADIO_COUNTRIES;
  const byId = new Map(STATIONS.map((s) => [s.id, s]));
  const $ = (s) => document.querySelector(s);

  let settings = {
    country: "TR", genre: "", station: null, volume: 0.6, muted: false,
    favourites: [], autoplay: false, overlay: false, hideFailed: true,
  };
  // Stations checked on this computer: id -> { ok, at, why }.
  let checked = {};
  const save = R.debounce(() => a2.storage.set("settings", settings).catch(() => {}), 400);
  const saveChecked = R.debounce(() => a2.storage.set("checked", checked).catch(() => {}), 800);

  // ---- playing ----
  const audio = new Audio();
  audio.preload = "none";
  let playing = null; // the station id while it should play
  let paused = false; // playing, held by the player row's pause
  let streamIndex = 0;
  let status = "idle"; // idle | connecting | playing | buffering | failed
  let why = "";
  let watchdog = 0;

  function applyVolume() {
    audio.volume = Math.max(0, Math.min(1, settings.volume));
    audio.muted = !!settings.muted;
  }

  function setStatus(s, text = "") {
    status = s;
    why = text;
    render();
  }

  function play(id) {
    const station = byId.get(id);
    if (!station) return;
    stopAudio();
    playing = id;
    paused = false;
    streamIndex = 0;
    settings.station = id;
    save();
    tryStream();
  }

  function tryStream() {
    const station = byId.get(playing);
    if (!station) return;
    const url = station.streams[streamIndex];
    if (!url) {
      // Every address failed.
      markChecked(station.id, false, why || "no answer");
      playing = null;
      stopAudio();
      setStatus("failed", why || "It doesn't play from here");
      return;
    }
    setStatus("connecting");
    applyVolume();
    audio.src = url;
    audio.play().catch((e) => onFail(e?.name === "NotAllowedError" ? "Press play" : "It doesn't play from here"));
    clearTimeout(watchdog);
    // A server that takes the request and sends nothing.
    watchdog = setTimeout(() => {
      if (status === "connecting") onFail("No answer");
    }, 15000);
  }

  function onFail(text) {
    if (!playing || paused) return;
    clearTimeout(watchdog);
    why = text;
    streamIndex++;
    tryStream();
  }

  function stopAudio() {
    clearTimeout(watchdog);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  function stop() {
    playing = null;
    paused = false;
    stopAudio();
    setStatus("idle");
  }

  // Pause: the station stays chosen (and in the meter's row); play goes on
  // live, connecting again, not from where it was held.
  function togglePause() {
    if (!playing) return;
    if (paused) {
      paused = false;
      streamIndex = 0;
      tryStream();
    } else {
      paused = true;
      stopAudio();
      setStatus("paused");
    }
  }

  audio.addEventListener("playing", () => {
    clearTimeout(watchdog);
    if (playing) markChecked(playing, true);
    setStatus("playing");
  });
  audio.addEventListener("waiting", () => { if (playing && status === "playing") setStatus("buffering"); });
  audio.addEventListener("error", () => onFail(R.mediaError(audio.error)));
  // A stream that ends (the server dropped it): connect again.
  audio.addEventListener("ended", () => { if (playing && !paused) tryStream(); });
  audio.addEventListener("stalled", () => {
    if (!playing || status !== "playing") return;
    setTimeout(() => { if (playing && status === "buffering") tryStream(); }, 10000);
  });

  function markChecked(id, ok, text = "") {
    checked[id] = { ok, at: Date.now(), why: ok ? "" : text, sig: R.signature(byId.get(id)) };
    saveChecked();
  }

  // ---- the list ----
  // The list as filtered, before stations that didn't play are hidden.
  const filtered = () => R.filter(STATIONS, {
    country: settings.country, genre: settings.genre, query: $(".search").value,
    favourites: new Set(settings.favourites),
  });
  const failed = (s) => checked[s.id]?.ok === false;
  const visible = () => {
    const list = filtered();
    // Hidden: a station that didn't play, unless it is the one picked.
    return settings.hideFailed ? list.filter((s) => !failed(s) || s.id === (playing || settings.station)) : list;
  };

  function step(dir) {
    const list = visible();
    if (!list.length) return;
    const at = list.findIndex((s) => s.id === (playing || settings.station));
    const next = list[(at + dir + list.length) % list.length] || list[0];
    play(next.id);
  }

  function toggleFavourite(id) {
    const fav = new Set(settings.favourites);
    if (fav.has(id)) fav.delete(id); else fav.add(id);
    settings.favourites = [...fav];
    save();
    render();
  }

  function renderCountries() {
    const nav = $(".countries");
    const counts = R.countByCountry(STATIONS, new Set(settings.favourites));
    nav.replaceChildren(...COUNTRIES.map(([key, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.country = key;
      b.textContent = `${label} ${counts[key] ?? 0}`;
      b.setAttribute("aria-selected", String(settings.country === key));
      b.addEventListener("click", () => {
        settings.country = key;
        settings.genre = "";
        save();
        render();
      });
      return b;
    }));
  }

  function renderGenres() {
    const box = $(".genres");
    const here = R.genresOf(R.filter(STATIONS, { country: settings.country, genre: "", query: "", favourites: new Set(settings.favourites) }));
    if (settings.genre && !here.includes(settings.genre)) settings.genre = "";
    const chip = (key, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(settings.genre === key));
      b.addEventListener("click", () => {
        settings.genre = settings.genre === key ? "" : key;
        save();
        render();
      });
      return b;
    };
    box.replaceChildren(chip("", "All"), ...here.map((g) => chip(g, GENRES[g] || g)));
  }

  function renderList() {
    const list = visible();
    const ul = $(".list");
    const fav = new Set(settings.favourites);
    const current = playing || settings.station;
    ul.replaceChildren(...list.map((s) => {
      const li = document.createElement("li");
      li.classList.toggle("current", s.id === current);
      const c = checked[s.id];
      li.classList.toggle("failed", c?.ok === false);
      const star = Object.assign(document.createElement("button"), {
        type: "button", className: `fav${fav.has(s.id) ? " on" : ""}`, textContent: fav.has(s.id) ? "★" : "☆",
        title: fav.has(s.id) ? "Remove from favourites" : "Add to favourites",
      });
      star.addEventListener("click", (e) => { e.stopPropagation(); toggleFavourite(s.id); });
      const flag = Object.assign(document.createElement("span"), { className: "flag", textContent: s.country === "INT" ? "" : s.country });
      const name = Object.assign(document.createElement("span"), { className: "name", textContent: s.name });
      const info = Object.assign(document.createElement("span"), {
        className: "info", textContent: [s.info, ...(s.genres || []).map((g) => GENRES[g] || g)].filter(Boolean).join(" · "),
      });
      const mark = document.createElement("span");
      mark.className = "mark";
      if (s.id === playing && status !== "failed") {
        mark.textContent = status === "playing" ? "♪" : status === "paused" ? "❚❚" : "…";
        mark.classList.add("ok");
      } else if (c?.ok === false) {
        mark.textContent = "✕";
        mark.classList.add("bad");
        mark.title = `Didn't play from here (${c.why || "no answer"}), ${R.ago(c.at)}. Click to try again.`;
      }
      li.append(star, flag, name, info, mark);
      li.title = s.id === playing ? "Click to stop" : `Play ${s.name}`;
      li.addEventListener("click", () => (s.id === playing ? stop() : play(s.id)));
      return li;
    }));
    const hidden = settings.hideFailed ? filtered().length - list.length : 0;
    $(".hiddenNote").hidden = hidden === 0;
    $(".hiddenNote").textContent = `${hidden} station${hidden === 1 ? "" : "s"} that didn't play from here hidden`;
    $(".empty").hidden = list.length > 0;
    $(".empty").textContent = settings.country === "fav" ? "No favourites yet: ☆ beside a station adds it." : "No station here.";
  }

  function nowText() {
    const station = byId.get(playing || settings.station);
    const name = station ? station.name : "No station";
    let state = "Pick a station below";
    if (status === "connecting") state = "Connecting…";
    else if (status === "buffering") state = "Buffering…";
    else if (status === "playing") state = settings.muted ? "Playing (muted)" : "Playing";
    else if (status === "paused") state = "Paused";
    else if (status === "failed") state = `${why || "It doesn't play from here"}: try another station`;
    else if (station) state = "Stopped";
    return { name, state, station };
  }

  // The meter's player row (a2.media, meter patch 0048): while a station
  // plays, its name and controls under the meter's header.
  let meterSaid = "";
  function tellMeter() {
    const { name, state, station } = nowText();
    const data = playing ? {
      icon: "radio",
      title: name,
      sub: state,
      playing: true,
      paused,
      muted: !!settings.muted,
      volume: settings.volume,
      favourite: !!station && settings.favourites.includes(station.id),
      controls: ["prev", "pause", "next", "mute", "volume", "favourite", "stop"],
    } : null;
    const key = JSON.stringify(data);
    if (key === meterSaid) return;
    meterSaid = key;
    a2.media?.set(data).catch(() => {});
  }

  function renderNow() {
    tellMeter();
    const { name, state, station } = nowText();
    $(".nowName").textContent = name;
    $(".nowName").title = station ? [station.name, station.info].filter(Boolean).join(" · ") : "";
    const st = $(".nowState");
    st.textContent = state;
    st.classList.toggle("playing", status === "playing");
    st.classList.toggle("bad", status === "failed");
    const on = !!playing;
    const ps = $(".playStop");
    ps.textContent = on ? "■" : "▶";
    ps.classList.toggle("on", on);
    ps.disabled = !station;
    $(".mute").textContent = settings.muted || settings.volume === 0 ? "🔇" : "🔊";
    $(".mute").title = settings.muted ? "Sound on" : "Mute";
    const vol = $(".volume");
    if (document.activeElement !== vol) vol.value = String(Math.round(settings.volume * 100));
    $(".volText").textContent = `${Math.round(settings.volume * 100)} %`;
    $(".autoplay").checked = !!settings.autoplay;
    $(".overlayOn").checked = !!settings.overlay;
    $(".hideFailed").checked = !!settings.hideFailed;
  }

  function render() {
    renderCountries();
    renderGenres();
    renderList();
    renderNow();
    sendWidget();
  }

  // ---- the player over the game ----
  let lastSent = "";
  function sendWidget(force = false) {
    if (!settings.overlay) return;
    const { name, state, station } = nowText();
    const data = {
      name, state, status, on: !!playing, hasStation: !!station,
      volume: settings.volume, muted: !!settings.muted,
      favourite: !!station && settings.favourites.includes(station.id),
      info: station ? station.info || "" : "",
    };
    const key = JSON.stringify(data);
    if (!force && key === lastSent) return;
    lastSent = key;
    a2.widgets.send("player", data).catch(() => {});
  }

  async function applyOverlay() {
    try {
      if (settings.overlay) {
        // unlocked: its buttons and volume stay usable with the meter locked
        // (meter patch 0064); it still doesn't move then.
        await a2.widgets.open("player", { width: 320, height: 96, unlocked: true });
        // The meter's lock is every widget's lock (patch 0036).
        await a2.widgets.lock(false);
        sendWidget(true);
      } else {
        await a2.widgets.close("player");
      }
    } catch (e) {
      console.error(e);
    }
  }

  // The meter's header button for the player (patch 0035).
  a2.on("overlay", (data) => {
    settings.overlay = !!data?.show;
    save();
    renderNow();
    applyOverlay();
  });

  a2.on("widget-message", ({ name, data }) => {
    if (name !== "player" || !data) return;
    if (data.type === "ready") sendWidget(true);
    else if (data.type === "playStop") togglePlay();
    else if (data.type === "prev") step(-1);
    else if (data.type === "next") step(1);
    else if (data.type === "mute") setMuted(!settings.muted);
    else if (data.type === "favourite") { const id = playing || settings.station; if (id) toggleFavourite(id); }
    else if (data.type === "volume" && Number.isFinite(data.value)) setVolume(data.value);
    else if (data.type === "close") {
      settings.overlay = false;
      save();
      renderNow();
      applyOverlay();
    }
  });

  // A control in the meter's player row: as the player's buttons.
  a2.on("media", ({ action, value } = {}) => {
    if (action === "playStop") togglePlay();
    else if (action === "pause") togglePause();
    else if (action === "stop") stop();
    else if (action === "prev") step(-1);
    else if (action === "next") step(1);
    else if (action === "mute") setMuted(!settings.muted);
    else if (action === "favourite") { const id = playing || settings.station; if (id) toggleFavourite(id); }
    else if (action === "volume" && Number.isFinite(value)) setVolume(value);
  });

  function togglePlay() {
    if (playing) stop();
    else if (settings.station) play(settings.station);
  }
  function setVolume(v) {
    settings.volume = Math.max(0, Math.min(1, v));
    if (settings.volume > 0 && settings.muted) settings.muted = false;
    applyVolume();
    save();
    renderNow();
    sendWidget();
  }
  function setMuted(on) {
    settings.muted = !!on;
    applyVolume();
    save();
    renderNow();
    sendWidget();
  }

  // ---- checking every station ----
  let checking = false;
  async function checkAll() {
    if (checking) { checking = false; return; }
    checking = true;
    const btn = $(".checkAll");
    // Every station of the tab and genre, the hidden ones too.
    const list = filtered();
    const probe = new Audio();
    probe.muted = true;
    probe.preload = "auto";
    let n = 0;
    for (const s of list) {
      if (!checking) break;
      n++;
      btn.textContent = `Stop (${n}/${list.length})`;
      if (s.id === playing && status === "playing") continue;
      let ok = false;
      let text = "no answer";
      for (const url of s.streams) {
        const r = await R.probe(probe, url, 9000);
        if (r.ok) { ok = true; break; }
        text = r.why;
      }
      if (!checking) break;
      markChecked(s.id, ok, text);
      renderList();
    }
    probe.removeAttribute("src");
    probe.load();
    checking = false;
    btn.textContent = "Check stations";
  }

  // ---- controls ----
  $(".playStop").addEventListener("click", togglePlay);
  $(".prev").addEventListener("click", () => step(-1));
  $(".next").addEventListener("click", () => step(1));
  $(".mute").addEventListener("click", () => setMuted(!settings.muted));
  $(".volume").addEventListener("input", () => setVolume(Number($(".volume").value) / 100));
  $(".search").addEventListener("input", () => renderList());
  $(".autoplay").addEventListener("change", () => { settings.autoplay = $(".autoplay").checked; save(); });
  $(".overlayOn").addEventListener("change", () => { settings.overlay = $(".overlayOn").checked; save(); applyOverlay(); });
  $(".checkAll").addEventListener("click", checkAll);
  $(".hideFailed").addEventListener("change", () => { settings.hideFailed = $(".hideFailed").checked; save(); renderList(); });
  // The wheel over the player changes the volume.
  $(".now").addEventListener("wheel", (e) => {
    e.preventDefault();
    setVolume(settings.volume + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });

  a2.on("compact", (on) => document.body.classList.toggle("compact", !!on));

  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") settings = { ...settings, ...s };
    } catch {}
    try {
      const c = await a2.storage.get("checked");
      if (c && typeof c === "object") checked = R.freshChecks(c, byId, Date.now());
    } catch {}
    settings.favourites = (settings.favourites || []).filter((id) => byId.has(id));
    if (!COUNTRIES.some(([k]) => k === settings.country)) settings.country = "TR";
    if (settings.station && !byId.has(settings.station)) settings.station = null;
    applyVolume();
    render();
    if (settings.overlay) applyOverlay();
    a2.ready();
    if (settings.autoplay && settings.station) play(settings.station);
  })();
})();
