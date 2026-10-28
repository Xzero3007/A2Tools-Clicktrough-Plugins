// The Map plugin's window: the map you are on with where you are, the pets
// Pet Finder follows (favourites, farming), monsters around, gathering spots,
// Hidden Cubes, Monolith pieces, Kibelisk camps, sealed dungeons and other
// places; a search; and an overlay (a widget) with a small map that follows
// you.
(() => {
  const D = globalThis.MAP_DATA;
  const K = globalThis.MapKit;
  const M = globalThis.MapMarks;
  const $ = (s) => document.querySelector(s);

  let settings = {
    layers: { pets: true, monsters: false, gather: false, cubes: true, monoliths: false, kibelisks: false, places: false },
    gatherKinds: {},
    petsMode: "tracked", // "tracked" (Pet Finder's favourites and farmed), "needed" (and every pet not at level 3), "all"
    nextFor: "all", // the next pet: "all" (pinned, then farmed, then needed), "chosen" (pinned and farmed), "off"
    follow: true,
    zoom: null, // screen px per map px while following
    overlay: false,
    overlaySize: [300, 330],
    overlayOpacity: 0.86,
    overlayZoom: 2.5, // the overlay's screen px per metre
    overlayLock: false,
    pick: "auto",
    lastKey: null,
    focus: null, // what the search or another plugin asked to show
    markScale: 1.25, // how large the marks are drawn, on the map and the overlay
  };
  let world = null;
  let shared = {};
  let tracked = new Map();
  // The pets not at level 3 yet (Pet Finder's), or null; and the souls each
  // still needs (id -> count), or null.
  let needed = null;
  let souls = null;
  let heading = 0;
  let headingFrom = null;
  let compact = false;
  const focusSeen = {}; // plugin -> the last focus request handled (its time)

  // ---------- the spots this meter has seen (marks.js learnFrom) ----------
  // Kept per map ("learned_<map>"), each at most 25,000 points.
  let learned = {};
  let learnedVersion = 0;
  const learnedDirty = new Set();
  const saveLearned = (() => {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => {
        // Storage keys are letters, digits, "-" and "_" (a "." was refused,
        // and nothing learnt was kept: 0.5.0).
        for (const key of learnedDirty) a2.storage.set(`learned_${key}`, learned[key]).catch(() => {});
        learnedDirty.clear();
      }, 5000);
    };
  })();
  function learn(w) {
    // Where the zone says the map, or what is around shows it (most of a
    // session the meter hasn't heard the zone: only at a teleport); never the
    // map of last time.
    const key = M.mapOf(w);
    if (!key || !D.maps[key]) return;
    if (M.learnFrom(learned, key, w)) {
      learnedVersion++;
      M.setLearned(learned);
      learnedDirty.add(key);
      saveLearned();
    }
  }
  const learnedCount = (key) => {
    const lk = learned[key];
    if (!lk) return 0;
    return Object.values(lk.g || {}).reduce((n, a) => n + a.length / 2, 0) + Object.values(lk.s || {}).reduce((n, a) => n + a.length / 2, 0) + (lk.c || []).length / 2;
  };

  const saveLater = (() => {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => a2.storage.set("settings", settings).catch(() => {}), 400);
    };
  })();

  const view = K.MapView($(".mapBox"), {});
  $(".mapBox").addEventListener("mapdrag", () => {
    if (!settings.follow) return;
    settings.follow = false;
    saveLater();
    renderTools();
  });
  $(".mapBox").addEventListener("mapzoom", (e) => {
    if (settings.follow) {
      settings.zoom = e.detail;
      saveLater();
    }
  });

  // ---------- which map ----------
  /** The map you are on: { key, guess }. The zone says it (or what is around
   *  you); until the meter has seen a zone (it hears one at each teleport or
   *  zone change, not while you stay), the map you were on last, as a guess.
   *  Null: no position, or a place with no map. */
  function whereAmI() {
    const key = M.mapOf(world);
    if (key) return { key, guess: false };
    if (world?.me && world.zone == null && D.maps[settings.lastKey]) return { key: settings.lastKey, guess: true };
    return null;
  }
  function currentKey() {
    if (settings.pick !== "auto" && D.maps[settings.pick]) return settings.pick;
    return whereAmI()?.key || settings.lastKey || "verteron";
  }
  const titleOf = (key) => D.maps[key]?.title || key;
  /** A map by a region's name (Pet Finder's "Verteron", "Altgard" ...). */
  const mapNamed = (name) => {
    const n = String(name || "").toLowerCase();
    return Object.keys(D.maps).find((k) => k === n || D.maps[k].title.toLowerCase() === n) || null;
  };

  // ---------- the player's heading: the way he walks (the game sends no facing) ----------
  function followHeading(me) {
    if (!me) return;
    if (!headingFrom) {
      headingFrom = [me.x, me.y];
      return;
    }
    const d = Math.hypot(me.x - headingFrom[0], me.y - headingFrom[1]);
    if (d >= 800) {
      heading = K.bearing(headingFrom[0], headingFrom[1], me.x, me.y);
      headingFrom = [me.x, me.y];
    }
  }

  // ---------- drawing ----------
  let frameQueued = false;
  function render() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      draw();
    });
  }

  function state(key) {
    return { key, world, tracked, needed, heading, layers: settings.layers, gatherKinds: settings.gatherKinds, petsMode: settings.petsMode, focus: settings.focus, nextFor: settings.nextFor };
  }

  function draw() {
    const key = currentKey();
    const where = whereAmI();
    const inZone = where?.key || null;
    if (inZone && !where.guess && inZone !== settings.lastKey) {
      settings.lastKey = inZone;
      saveLater();
    }
    view.setMap(key);
    view.setMarkScale(settings.markScale);
    const built = M.build(state(key));
    view.setMarks(built.marks);
    const me = world?.me;
    const onThisMap = me && inZone === key;
    if (settings.follow && onThisMap) {
      // Following: the zoom picked last while following, else about 150 m
      // across a 300 px view.
      if (settings.zoom) view.setZoom(settings.zoom);
      else view.setPxPerMetre(2);
      view.centerOn(me.x, me.y);
    }
    const region = me && inZone ? M.regionAt(inZone, me.x, me.y) : null;
    renderHeader(key, onThisMap, where, region);
    renderStatus(built, onThisMap);
    renderNear(key, onThisMap);
    shareNearest(key, onThisMap);
    renderFocus(key);
    // The overlay follows you on your own map, whichever one this window shows.
    const own = inZone || key;
    sendOverlay(own, !!me && inZone === own, { region: inZone === own ? region : null, guess: !!where?.guess });
  }

  function renderHeader(key, onThisMap, where, region) {
    $(".mapName").textContent = titleOf(key) || "Map";
    const zone = world?.zone;
    const zoneName = zone != null ? D.zoneNames[String(zone)] : null;
    let note = "";
    if (!world?.me) note = "Waiting for your position: log in with the meter running";
    else if (!where && zone == null) note = "Zone not known yet: it comes with your next teleport or zone change";
    else if (!where) note = `No map for ${zoneName || `zone ${zone}`}`;
    else if (!onThisMap) note = `You are in ${titleOf(where.key)}${where.guess ? "?" : ""}`;
    else {
      // Not exact: how long ago it last was (an action, an effect, a
      // teleport or a loading screen places you exactly).
      const fixAge = world.fix && Number.isFinite(world.fix.at) ? Math.max(0, Math.round((Date.now() - world.fix.at) / 1000)) : null;
      const since = fixAge == null ? "" : fixAge < 90 ? `; exact ${fixAge} s ago` : `; exact ${Math.round(fixAge / 60)} min ago`;
      note = world.me.exact ? "Your position" : `Your position (about, from what's around you${since})`;
      if (region) note += ` · ${region}`;
      if (where.guess) note += " · map as last time (the zone comes with your next teleport)";
    }
    $(".whereNote").textContent = note;
  }

  function renderStatus(built, onThisMap) {
    const n = built.next;
    $(".next").replaceChildren();
    if (n && onThisMap) {
      const label = Object.assign(document.createElement("span"), { className: "nextLabel", textContent: "Next" });
      const name = Object.assign(document.createElement("strong"), { textContent: ` ${n.name} ` });
      const dist = Object.assign(document.createElement("span"), {
        className: "muted",
        textContent: n.via
          ? `teleport to Kibelisk ${n.via.name}, then ${Math.round(n.via.metres)} m (walking: ${Math.round(n.metres)} m)`
          : `${M.arrow(n.bearing)} ${Math.round(n.metres)} m${n.live ? " (there now)" : n.focus ? "" : " (spawn point)"}`,
      });
      $(".next").append(label, name, dist);
      // Why this one: what was searched, or how the pet is followed.
      $(".next").title = n.focus ? `What the search shows: ${n.name}` : `${n.name}: ${M.markText(n.mark)}`;
    }
    const parts = [];
    if (settings.focus) parts.push(`${built.hits.length / 2} on this map`);
    else if (settings.layers.pets) parts.push(`${built.petsHere} pet${built.petsHere === 1 ? "" : "s"} on this map`, `${built.around} around you`);
    const mine = learnedCount(currentKey());
    if (mine) parts.push(`${mine} spot${mine === 1 ? "" : "s"} your meter saw`);
    $(".counts").textContent = parts.join(" · ");
  }

  // ---------- the nearest monsters with souls you still need ----------
  // Up to four kinds, the nearest first, as the Pet Soul Tracker's map lists
  // them: in range, else the nearest spawn points of the map. A click shows
  // the kind's spawn points (the focus).
  let nearShown = "";
  function renderNear(key, onThisMap) {
    const list = $(".nearKinds");
    const kinds = settings.layers.pets && onThisMap ? M.nearestKinds({ key, world, tracked, needed, souls }) : [];
    list.hidden = !kinds.length;
    // Drawn again only when it changed (metres rounded): a row replaced
    // under the pointer loses its click.
    const shown = JSON.stringify(kinds.map((k) => [k.npc, k.count, Math.round(k.metres), M.arrow(k.bearing), k.souls, k.live]));
    if (shown === nearShown) return;
    nearShown = shown;
    list.replaceChildren(...kinds.map((k) => {
      const li = document.createElement("li");
      li.className = k.live ? "live" : "spawn";
      const dot = Object.assign(document.createElement("span"), { className: "dot" });
      dot.style.background = k.genus?.color || K.PET_RED;
      const span = (cls, text) => Object.assign(document.createElement("span"), { className: cls, textContent: text });
      li.append(
        dot,
        span("mob", k.name),
        span("lv", k.level != null ? `Lv ${k.level}` : ""),
        span("n", k.live ? `×${k.count}` : ""),
        span("pet", `${k.petName}${k.souls != null ? ` (${k.souls} soul${k.souls === 1 ? "" : "s"})` : ""}`),
        span("far", `${M.arrow(k.bearing)} ${Math.round(k.metres)} m${k.live ? "" : " (spawn)"}`),
      );
      li.title = `${k.name}${k.level != null ? `, level ${k.level}` : ""}: souls for ${k.petName}${k.genus ? ` (${k.genus.name})` : ""}`
        + `${k.souls != null ? `, ${k.souls} still needed to level 3` : ""}. ${k.live ? `${k.count} in range` : "None in range: the nearest spawn point"}. Click: its spawn points.`;
      li.addEventListener("click", () => setFocus({ type: "npc", ids: [k.npc], label: k.name }, { map: key }));
      return li;
    }));
  }

  // For Pet Finder's "Nearest": each pet's nearest spawn point on the map
  // you're on (a2.share), again once you've moved 40 m or changed map.
  let nearestShared = null;
  function shareNearest(key, onThisMap) {
    if (typeof a2.share !== "function") return;
    const me = world?.me;
    if (!me || !onThisMap) return;
    if (nearestShared && nearestShared.map === key && Math.hypot(me.x - nearestShared.x, me.y - nearestShared.y) < 4000) return;
    nearestShared = { map: key, x: me.x, y: me.y };
    a2.share({ source: "Map", map: key, at: Date.now(), nearest: M.nearestByPet(key, me) }).catch(() => {});
  }

  // ---------- the focus (the search, or a map link in another plugin) ----------
  function setFocus(focus, { map = null } = {}) {
    settings.focus = focus || null;
    // The search box keeps no word that no longer matches what is shown.
    if (!focus || focus.label !== searchBox.value.trim()) searchBox.value = "";
    if (focus) {
      const maps = M.focusMaps(focus);
      const here = whereAmI()?.key;
      const key = (map && maps[map] && map) || (here && maps[here] && here) || Object.keys(maps)[0] || null;
      if (key) showFocusOn(key);
    }
    saveLater();
    renderTools();
    render();
  }

  /** The focus on a map: that map, framed around its places. */
  function showFocusOn(key) {
    settings.pick = key === whereAmI()?.key ? "auto" : key;
    settings.follow = false;
    view.setMap(key);
    view.fitPoints(M.focusPoints(settings.focus, key).flat());
    saveLater();
    renderTools();
    render();
  }

  function renderFocus(key) {
    const f = settings.focus;
    $(".focusBar").hidden = !f;
    if (!f) return;
    $(".focusText").textContent = `Showing ${f.label}`;
    const maps = M.focusMaps(f);
    $(".focusMaps").replaceChildren(...Object.entries(maps).slice(0, 6).map(([k, count]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", String(k === key));
      b.textContent = `${titleOf(k)} ${count}`;
      b.addEventListener("click", () => showFocusOn(k));
      return b;
    }));
    if (!Object.keys(maps).length) $(".focusMaps").textContent = "no known places on these maps";
  }
  $(".focusClear").addEventListener("click", () => setFocus(null));

  // ---------- the search ----------
  const searchBox = $(".search");
  const results = $(".results");
  let found = [];
  let active = -1;
  function renderResults() {
    const q = searchBox.value.trim();
    found = q.length >= 2 ? M.search(q) : [];
    active = found.length ? 0 : -1;
    results.hidden = !q || q.length < 2;
    if (results.hidden) return;
    if (!found.length) {
      results.replaceChildren(Object.assign(document.createElement("div"), { className: "noResult", textContent: "Nothing with that name on these maps" }));
      return;
    }
    results.replaceChildren(...found.map((r, i) => {
      const row = document.createElement("div");
      row.className = "result";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === active));
      const name = Object.assign(document.createElement("strong"), { textContent: r.label });
      if (r.gather) {
        const dot = document.createElement("i");
        dot.style.background = K.GATHER_COLORS[r.gather];
        name.prepend(dot);
      }
      const sub = Object.assign(document.createElement("span"), { className: "muted", textContent: ` ${r.sub}` });
      const where = Object.assign(document.createElement("span"), {
        className: "where",
        textContent: Object.entries(r.maps).slice(0, 3).map(([k, n]) => `${titleOf(k)} ${n}`).join(" · "),
      });
      row.append(name, sub, where);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(i);
      });
      return row;
    }));
  }
  function pick(i) {
    const r = found[i];
    if (!r) return;
    results.hidden = true;
    searchBox.value = r.label;
    searchBox.blur();
    setFocus(r.focus);
  }
  searchBox.addEventListener("input", renderResults);
  searchBox.addEventListener("focus", renderResults);
  searchBox.addEventListener("blur", () => { results.hidden = true; });
  searchBox.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!found.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length;
      [...results.children].forEach((c, i) => c.setAttribute("aria-selected", String(i === active)));
      results.children[active]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(Math.max(0, active));
    } else if (e.key === "Escape") {
      searchBox.value = "";
      results.hidden = true;
    }
  });

  // ---------- the overlay (a widget) ----------
  // Its sizes (the buttons S, M, L, XL); a corner dragged sets any other.
  const SIZES = { s: [220, 240], m: [300, 330], l: [400, 440], xl: [520, 570] };
  const sizeName = () => Object.keys(SIZES).find((k) => SIZES[k][0] === settings.overlaySize?.[0] && SIZES[k][1] === settings.overlaySize?.[1]) || null;
  let lastSent = 0;
  let sendTimer = 0;
  let learnedSent = -1;
  function sendOverlay(key, onThisMap, { region = null, guess = false } = {}) {
    if (!settings.overlay) return;
    const go = () => {
      lastSent = Date.now();
      const sentVersion = learnedVersion;
      a2.widgets.send("overlay", {
        key,
        world: world ? { me: world.me, zone: world.zone, npcs: world.npcs, objects: world.objects } : null,
        tracked: [...tracked].map(([id, t]) => [id, t.mark, t.name]),
        needed: needed ? [...needed] : null,
        heading,
        layers: settings.layers,
        gatherKinds: settings.gatherKinds,
        petsMode: settings.petsMode,
        nextFor: settings.nextFor,
        focus: settings.focus,
        markScale: settings.markScale,
        // The learnt spots only when they changed (the overlay keeps them).
        ...(learnedSent !== learnedVersion ? { learned, learnedVersion } : {}),
        zoom: settings.overlayZoom,
        opacity: settings.overlayOpacity,
        onThisMap: !!onThisMap,
        locked: settings.overlayLock,
        size: sizeName(),
        region,
        guess,
      }).then(() => { learnedSent = sentVersion; }).catch(() => {});
    };
    clearTimeout(sendTimer);
    const wait = 250 - (Date.now() - lastSent);
    if (wait <= 0) go();
    else sendTimer = setTimeout(go, wait);
  }

  const overlaySize = () => {
    const [w, h] = Array.isArray(settings.overlaySize) ? settings.overlaySize : SIZES.m;
    return { width: Math.max(120, Math.min(800, w)), height: Math.max(120, Math.min(800, h)) };
  };
  function setOverlaySize(name) {
    if (!SIZES[name]) return;
    settings.overlaySize = [...SIZES[name]];
    saveLater();
    renderTools();
    if (settings.overlay) a2.widgets.open("overlay", overlaySize()).then(() => { lastSent = 0; render(); }).catch(() => {});
  }
  async function applyOverlay() {
    try {
      if (settings.overlay) {
        await a2.widgets.open("overlay", overlaySize());
        await a2.widgets.lock(!!settings.overlayLock);
        lastSent = 0;
        render();
      } else {
        await a2.widgets.close("overlay");
      }
    } catch (e) {
      console.error(e);
    }
  }

  a2.on("widget-message", ({ name, data }) => {
    if (name !== "overlay" || !data) return;
    if (data.type === "zoom" && Number.isFinite(data.value)) {
      settings.overlayZoom = Math.max(0.3, Math.min(12, data.value));
      saveLater();
      render();
    } else if (data.type === "size") {
      setOverlaySize(data.size);
    } else if (data.type === "resized" && Number.isFinite(data.width) && Number.isFinite(data.height)) {
      // A corner dragged: the window has its size already, it is only kept.
      settings.overlaySize = [Math.round(data.width), Math.round(data.height)];
      saveLater();
      renderTools();
      render();
    } else if (data.type === "opacity" && Number.isFinite(data.value)) {
      settings.overlayOpacity = Math.max(0.2, Math.min(1, data.value));
      $(".overlayOpacity").value = String(Math.round(settings.overlayOpacity * 100));
      saveLater();
      render();
    } else if (data.type === "close") {
      settings.overlay = false;
      saveLater();
      renderTools();
      applyOverlay();
    } else if (data.type === "focus-clear") {
      setFocus(null);
    } else if (data.type === "ready") {
      lastSent = 0;
      learnedSent = -1;
      render();
    }
  });

  // ---------- the controls ----------
  function renderTools() {
    $(".follow").setAttribute("aria-pressed", String(settings.follow));
    $(".overlayBtn").setAttribute("aria-pressed", String(settings.overlay));
    $(".overlaySettings").hidden = !settings.overlay || compact;
    for (const chip of document.querySelectorAll(".layers .chip[data-layer]")) {
      chip.setAttribute("aria-pressed", String(!!settings.layers[chip.dataset.layer]));
    }
    $(".petsMode").value = ["tracked", "needed", "all"].includes(settings.petsMode) ? settings.petsMode : "tracked";
    $(".petsMode").hidden = !settings.layers.pets;
    $(".nextFor").value = ["all", "chosen", "off"].includes(settings.nextFor) ? settings.nextFor : "all";
    $(".nextFor").hidden = !settings.layers.pets;
    document.body.classList.toggle("noPets", !settings.layers.pets);
    $(".markScale").value = String(settings.markScale);
    const kinds = $(".kinds");
    kinds.hidden = !settings.layers.gather || compact;
    kinds.replaceChildren(...M.KIND_ORDER.map((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip kind";
      b.title = M.kindTitle(k);
      b.setAttribute("aria-pressed", String(settings.gatherKinds[k] !== false));
      const dot = document.createElement("i");
      dot.style.background = K.GATHER_COLORS[k];
      b.append(dot, M.kindLabel(k));
      b.addEventListener("click", () => {
        settings.gatherKinds = { ...settings.gatherKinds, [k]: settings.gatherKinds[k] === false };
        saveLater();
        renderTools();
        render();
      });
      return b;
    }));
    $(".overlayOpacity").value = String(Math.round(settings.overlayOpacity * 100));
    $(".overlayLock").checked = !!settings.overlayLock;
    const size = sizeName();
    for (const b of document.querySelectorAll(".overlaySizes button")) b.setAttribute("aria-pressed", String(b.dataset.size === size));
    const pick = $(".mapPick");
    if (!pick.options.length) {
      const opt = (value, text) => Object.assign(document.createElement("option"), { value, textContent: text });
      const open = Object.entries(D.maps).filter(([, m]) => !m.instance);
      const inst = Object.entries(D.maps).filter(([, m]) => m.instance).sort((a, b) => a[1].title.localeCompare(b[1].title));
      const g1 = Object.assign(document.createElement("optgroup"), { label: "World" });
      g1.append(...open.map(([k, m]) => opt(k, m.title)));
      const g2 = Object.assign(document.createElement("optgroup"), { label: "Instances" });
      g2.append(...inst.map(([k, m]) => opt(k, m.title)));
      pick.append(opt("auto", "Where you are"), g1, g2);
    }
    pick.value = D.maps[settings.pick] ? settings.pick : "auto";
  }

  for (const chip of document.querySelectorAll(".layers .chip[data-layer]")) {
    chip.addEventListener("click", () => {
      const layer = chip.dataset.layer;
      settings.layers = { ...settings.layers, [layer]: !settings.layers[layer] };
      saveLater();
      renderTools();
      render();
    });
  }
  $(".petsMode").addEventListener("change", () => {
    settings.petsMode = $(".petsMode").value;
    saveLater();
    render();
  });
  $(".markScale").addEventListener("change", () => {
    settings.markScale = Number($(".markScale").value) || 1.25;
    saveLater();
    render();
  });
  $(".nextFor").addEventListener("change", () => {
    settings.nextFor = $(".nextFor").value;
    saveLater();
    render();
  });
  $(".follow").addEventListener("click", () => {
    settings.follow = !settings.follow;
    if (settings.follow) settings.pick = "auto";
    saveLater();
    renderTools();
    if (!settings.follow) view.fit();
    render();
  });
  $(".overlayBtn").addEventListener("click", () => {
    settings.overlay = !settings.overlay;
    saveLater();
    renderTools();
    applyOverlay();
  });
  for (const b of document.querySelectorAll(".overlaySizes button")) {
    b.addEventListener("click", () => setOverlaySize(b.dataset.size));
  }
  $(".overlayOpacity").addEventListener("input", () => {
    settings.overlayOpacity = Number($(".overlayOpacity").value) / 100;
    saveLater();
    render();
  });
  $(".overlayLock").addEventListener("change", () => {
    settings.overlayLock = $(".overlayLock").checked;
    saveLater();
    a2.widgets.lock(settings.overlayLock).catch(() => {});
    render();
  });
  $(".mapPick").addEventListener("change", () => {
    settings.pick = $(".mapPick").value;
    if (settings.pick !== "auto") settings.follow = false;
    saveLater();
    renderTools();
    view.setMap(currentKey());
    if (!settings.follow) {
      const pts = settings.focus ? M.focusPoints(settings.focus, currentKey()).flat() : [];
      if (pts.length) view.fitPoints(pts);
      else view.fit();
    }
    render();
  });
  // Double-click: back to following you.
  $(".mapBox").addEventListener("dblclick", () => {
    settings.follow = true;
    settings.pick = "auto";
    saveLater();
    renderTools();
    render();
  });

  // ---------- from the meter ----------
  let shownMe = null;
  a2.on("world", (w) => {
    learn(w);
    // The place shown: steadier than the meter's guess (marks.js steady).
    shownMe = M.steady(shownMe, w);
    world = w ? { ...w, me: shownMe } : w;
    followHeading(world?.me);
    render();
  });
  a2.on("shared", ({ plugin, value }) => {
    if (value == null) delete shared[plugin];
    else shared[plugin] = value;
    tracked = M.mergeTracked(shared);
    needed = M.neededOf(shared);
    souls = M.soulsOf(shared);
    // A map link clicked in that plugin: its pet or monster, here. Only a
    // fresh one: the value shared earlier comes again when the map starts.
    const f = value?.focus;
    if (f && Number(f.at) > (focusSeen[plugin] || 0)) {
      focusSeen[plugin] = Number(f.at);
      if (Date.now() - Number(f.at) < 30_000) {
        const bossNpc = f.boss != null ? D.bossIds?.[String(f.boss)] ?? f.boss : null;
        const bossName = bossNpc != null ? Object.values(D.bosses || {}).flat().find(([npc]) => String(npc) === String(bossNpc))?.[1] : null;
        const focus = f.pet != null
          ? { type: "pet", ids: [String(f.pet)], label: f.name || M.petName(f.pet, tracked) }
          : f.npc != null ? { type: "npc", ids: [String(f.npc)], label: f.name || D.npcNames[f.npc] || "Monster" }
          : bossNpc != null ? { type: "boss", ids: [String(bossNpc)], label: bossName || f.name || "Field boss" }
          : f.gather ? M.gatherFor(f.gather) : null;
        if (focus) {
          setFocus(focus, { map: mapNamed(f.region) || f.map || null });
          // Brought forward: its dock tab, or its own window.
          a2.window?.show?.().catch(() => {});
        }
      }
    }
    render();
  });
  a2.on("compact", (on) => {
    compact = !!on;
    document.body.classList.toggle("compact", compact);
    renderTools();
    view.redraw();
  });

  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") {
        settings = { ...settings, ...s, layers: { ...settings.layers, ...(s.layers || {}) } };
        if (!Array.isArray(settings.overlaySize)) settings.overlaySize = [...SIZES.m];
      }
    } catch {}
    for (const key of Object.keys(D.maps)) {
      try {
        const lk = await a2.storage.get(`learned_${key}`);
        if (lk && typeof lk === "object") learned[key] = lk;
      } catch {}
    }
    M.setLearned(learned);
    learnedVersion++;
    renderTools();
    if (settings.focus && !settings.follow) {
      view.setMap(currentKey());
      view.fitPoints(M.focusPoints(settings.focus, currentKey()).flat());
    }
    render();
    if (settings.overlay) applyOverlay();
    a2.ready();
  })();
})();
