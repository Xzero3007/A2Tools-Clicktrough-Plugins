// Pet Finder's page: three tabs. Pets is the Pet Soul Tracker's list
// (list.js): every pet's level and souls, where they drop, the favourites
// (★). Nearby: the pet mobs near you, how far and which way. Merchant: the
// Black Cloud Merchant's offers you still need. One collection and one list of
// favourites for all three (globalThis.PetList), and one for the Map plugin.
(() => {
  const L = globalThis.PetLogic;
  const P = globalThis.PetList;
  const ix = L.index(globalThis.PET_DATA);
  const IMG = globalThis.PET_IMAGES || { portraits: {}, crystals: {} };
  const $ = (s) => document.querySelector(s);
  const MIN = 60 * 1000;

  const STRINGS = {
    en: {
      pets: "Pets", nearby: "Nearby", search: "Search", hideMaxed: "Hide level 3", clear: "Clear",
      keepFor: "Keep for", minutes: "{n} min", untilGone: "until gone",
      noNearby: "No pet mobs seen yet. They appear as the game shows them to you; changing map clears the list after a while.",
      searchPlaceholder: "Pet, mob, region or source…", allFamilies: "All",
      petCount: "{n} pets", more: "Show {n} more",
      notSynced: "Collection not read yet: log into your character with the meter running.",
      synced: "Synced at login, {t}", live: "live",
      toGo: "{n} of {all} pets still to reach rank 3 · {souls} souls to go",
      rank: "Lv {r}", locked: "Lv 0", max: "Lv 3", seen: "seen {t} ago", now: "just now",
      pin: "A favourite: on the Map, first in every list", unpin: "Not a favourite any more", mobs: "Souls from", maps: "Maps", source: "Source",
      pinnedNearby: "Pinned pet nearby: {pet} ({mob})",
      character: "{name}", noData: "No data on this pet's sources yet.",
      merchant: "Merchant", kina: "{n} Kina", off: "−{n} %", bought: "✓ souls received",
      merchantHint: "Open the Black Cloud Merchant in game once your collection is read: the pets there you still need show here for two minutes.",
      merchantNone: "Nothing in this stock you still need.", merchantStale: "Stock seen {t}: open the shop again for current offers.",
      lookOut: "Look out for: only chests and merchants give these", merchantToast: "Black Cloud Merchant: {n} pet(s) you still need",
      alsoFarmable: "Also on offer, and mobs drop these too", onlyMerchant: "Only chests and merchants give these",
      far: "{m} m", onMap: "Show its spawn points on the Map", nearestFirst: "Nearest first: distances from where you are",
      merchantUnknown: "The shop was opened {t} ago, but its offer list is in a layout Pet Finder does not know yet (it reads only the one PetTracker checked). See the README: a short packet log helps add it.",
      sideBySide: "Side by side", belowEachOther: "Below each other",
    },
  };
  // English only, whatever the meter's language.
  const t = (k, vars = {}) => (STRINGS.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
  const locale = () => "en-US";
  const fmtNum = (n) => Number(n).toLocaleString(locale());

  // ---------- state ----------
  let settings = { tab: "pets", hideMaxedNearby: false, keepMin: 10, merchantColumns: false };
  let character = null;
  // The collection and the favourites: the Pets tab's (list.js), read here
  // as Pet Finder's own collection was.
  const collection = { get synced() { return P.synced; }, progress: (id) => P.progress(id) };
  const pinned = { has: (id) => P.isPinned(id) };
  let compact = false;
  const nearby = new L.Nearby(ix);
  const frames = new L.Frames({
    spawn: ({ entity, npc }) => {
      const at = currentAt || Date.now();
      const isNew = nearby.spawn(entity, npc, at);
      if (isNew !== null && pinned.has(isNew) && Date.now() - at < 30000) {
        a2.notify(t("pinnedNearby", { pet: petName(isNew), mob: ix.npcNames.get(npc) || "" })).catch(() => {});
      }
      dirty();
    },
    remove: ({ entity }) => {
      if (nearby.remove(entity)) dirty();
    },
  });
  let currentAt = 0;
  let flushTimer = 0;
  const stocks = new Map(); // tab -> stock
  const bought = new Map(); // pet -> when its souls came after it was offered
  let toldOffers = "";
  const market = new L.MarketFrames((parts) => {
    const stock = L.stockFrom(parts, parts.at, ix);
    if (!stock) return;
    shopReadAt = parts.at;
    stocks.set(stock.tab, stock);
    const all = [...stocks.values()];
    const recs = [...L.recommendations(all, collection, Date.now(), ix), ...L.recommendations(all, collection, Date.now(), ix, { farmable: true })];
    const key = recs.map((r) => `${r.pet}:${r.stock.refresh}`).join(",");
    if (recs.length && key !== toldOffers) {
      toldOffers = key;
      a2.notify(t("merchantToast", { n: recs.length })).catch(() => {});
    }
    dirty();
  });
  let marketTimer = 0;
  let shopSeenAt = 0; // any stock response, understood or not
  let shopReadAt = 0; // the last one understood
  a2.on("decoded:market-seen", (data, meta) => {
    shopSeenAt = meta?.at || Date.now();
    dirty();
  });
  for (const name of ["market-a", "market-b", "market-c", "market-more"]) {
    a2.on(`decoded:${name}`, (data, meta) => {
      market.push(name, data, meta?.at || Date.now());
      clearTimeout(marketTimer);
      marketTimer = setTimeout(() => market.flush(), 250);
    });
  }

  // ---------- storage ----------
  const saveLater = (() => {
    const timers = {};
    return (key, value) => {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => a2.storage.set(key, value).catch(() => {}), 400);
    };
  })();
  const saveSettings = () => saveLater("settings", settings);
  // The game's name in the meter's language (or the player's own), as the
  // Pets tab shows it; else PetTracker's.
  const petName = (id) => P.name(id) || ix.pets.get(id)?.name || `Pet ${id}`;
  // Souls for a pet just after it was on offer: bought (the shopping list
  // ticks it).
  P.onGain((pet, amount, at) => {
    const all = [...stocks.values()];
    const offered = new Set([...L.recommendations(all, collection, at, ix), ...L.recommendations(all, collection, at, ix, { farmable: true })].map((r) => r.pet));
    if (offered.has(pet) && !bought.has(pet)) bought.set(pet, at);
    dirty();
  });
  P.onChange(() => { if (settings.tab !== "pets" || compact) dirty(); });

  // ---------- where things are (a2.on("world")) ----------
  // The meter's world around the player: where he is and where the monsters
  // around stand, for the distance to each pet's nearest monster.
  let world = null;
  let positions = new Map(); // entity -> [x, y]
  let worldDrawn = 0;
  a2.on("world", (w) => {
    world = w;
    positions = new Map((w?.npcs || []).map(([e, , x, y]) => [e, [x, y]]));
    // At most once a second: a list redrawn under the pointer loses clicks.
    if (Date.now() - worldDrawn >= 1000 && (compact || settings.tab === "nearby")) {
      worldDrawn = Date.now();
      dirty();
    }
  });
  const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  /** The nearest monster of a pet around you: { metres, arrow } or null. */
  function nearestOf(pet) {
    const me = world?.me;
    if (!me) return null;
    let best = null;
    for (const [entity, e] of nearby.entities) {
      if (e.pet !== pet) continue;
      const p = positions.get(entity);
      if (!p) continue;
      const metres = Math.hypot(p[0] - me.x, p[1] - me.y) / 100;
      if (!best || metres < best.metres) {
        const deg = (Math.atan2(p[1] - me.y, p[0] - me.x) * 180) / Math.PI + 90;
        best = { metres, arrow: ARROWS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] };
      }
    }
    return best;
  }

  // ---------- events from the meter ----------
  function sameCharacter(a, b) {
    return !!a && !!b && a.name === b.name && Number(a.serverId) === Number(b.serverId);
  }
  function setCharacter(c) {
    if (!c || !c.name) return;
    if (sameCharacter(c, character)) return;
    character = { name: c.name, serverId: c.serverId };
    nearby.clear();
    stocks.clear();
    bought.clear();
  }

  a2.on("compact", (on) => {
    compact = !!on;
    render();
  });
  a2.on("character", (c) => {
    setCharacter(c);
    render();
  });

  const npcEvents = ["npc-removed", "npc-removed-more"];
  for (const op of ["40", "41", "42"]) for (const v of ["a", "b"]) npcEvents.push(`npc-spawn-${op}${v}`);
  for (const name of npcEvents) {
    a2.on(`decoded:${name}`, (data, meta) => {
      currentAt = meta?.at || Date.now();
      frames.push(name, data);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => frames.flush(), 250);
    });
  }

  // ---------- rendering ----------
  let renderQueued = false;
  function dirty() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function portrait(id) {
    const src = IMG.portraits[id];
    const box = el("span", "portrait");
    if (src) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = src;
      img.decoding = "async";
      box.append(img);
    }
    return box;
  }
  function familyTag(family) {
    const tag = el("span", `family f-${family.toLowerCase()}`);
    const src = IMG.crystals[family];
    if (src) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = src;
      tag.append(img);
    }
    tag.append(document.createTextNode(family));
    return tag;
  }
  function progressLine(id) {
    const p = collection.progress(id);
    const wrap = el("div", "progress");
    if (p.rank === null) return wrap;
    const label = el("span", "rankText", t("rank", { r: p.rank }));
    const count = el("span", "count", p.goal === null ? t("max") : `${p.souls}/${p.goal}`);
    const bar = el("div", "bar");
    const fill = el("div", "fill");
    fill.style.width = `${p.goal === null ? 100 : Math.min(100, (100 * p.souls) / p.goal)}%`;
    if (p.goal === null) bar.classList.add("maxed");
    bar.append(fill);
    wrap.append(label, count, bar);
    return wrap;
  }
  function pinButton(id) {
    const on = pinned.has(id);
    const b = el("button", on ? "pin on" : "pin", on ? "★" : "☆");
    b.title = on ? t("unpin") : t("pin");
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      P.togglePin(id);
      render();
    });
    return b;
  }
  /** Its spawn points on the Map plugin. */
  function mapButton(id) {
    if (typeof a2.share !== "function") return null;
    const b = el("button", "mapBtn");
    b.type = "button";
    b.title = t("onMap");
    b.setAttribute("aria-label", b.title);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Zm0 0v13.5m6-11v13.5"/></svg>';
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      P.showOnMap({ pet: id, name: petName(id) });
    });
    return b;
  }
  function span(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
  }
  function ago(ms) {
    if (Date.now() - ms < 5000) return t("now");
    return t("seen", { t: span(ms) });
  }

  function renderHeader() {
    const h = $("#status");
    h.replaceChildren();
    if (!collection.synced) {
      h.append(el("div", "muted", t("notSynced")));
      return;
    }
    const time = new Date(P.syncedAt).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
    const line = el("div", "muted", t("synced", { t: time }));
    if (character?.name) line.prepend(el("strong", "who", `${character.name} · `));
    h.append(line);
  }

  function renderTabs() {
    const nav = $("#tabs");
    nav.hidden = compact;
    const count = nearby.view().length;
    const offers = [...merchantRows(Date.now()), ...merchantRows(Date.now(), true)].filter((r) => !r.done).length;
    nav.replaceChildren(
      ...[["pets", t("pets")], ["nearby", `${t("nearby")}${count ? ` (${count})` : ""}`], ["merchant", `${t("merchant")}${offers ? ` (${offers})` : ""}`]].map(([id, label]) => {
        const b = el("button", settings.tab === id ? "tab on" : "tab", label);
        b.addEventListener("click", () => select(id));
        return b;
      }),
    );
    if (settings.tab === "merchant") nav.append(columnsButton());
  }

  // The Merchant tab's sections (only from chests and merchants, also
  // farmable, look out for) side by side, a column each, as a wide bar; too
  // narrow for that, they wrap under each other.
  function columnsButton() {
    const on = !!settings.merchantColumns;
    const b = el("button", "layoutBtn");
    b.type = "button";
    b.title = on ? t("belowEachOther") : t("sideBySide");
    b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-pressed", String(on));
    b.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 4v16"/></svg>';
    b.addEventListener("click", () => {
      settings.merchantColumns = !settings.merchantColumns;
      saveSettings();
      render();
    });
    return b;
  }

  function renderNearby() {
    const view = $("#view");
    const frag = [];
    if (!compact) {
      const bar = el("div", "controls");
      const hide = el("label", "check");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = settings.hideMaxedNearby;
      cb.addEventListener("change", () => { settings.hideMaxedNearby = cb.checked; saveSettings(); render(); });
      hide.append(cb, el("span", null, t("hideMaxed")));
      // Buttons, not a <select>: WebKitGTK draws a select in the desktop's
      // light theme, unreadable on the dark panel.
      const keep = el("div", "keep");
      keep.append(el("span", null, t("keepFor")));
      for (const m of [5, 10, 30, 0]) {
        const b = el("button", m === settings.keepMin ? "seg on" : "seg", m ? t("minutes", { n: m }) : t("untilGone"));
        b.addEventListener("click", () => { settings.keepMin = m; saveSettings(); render(); });
        keep.append(b);
      }
      const clear = el("button", "small", t("clear"));
      clear.addEventListener("click", () => { nearby.clear(); render(); });
      bar.append(hide, keep, clear);
      frag.push(bar);
    }
    nearby.prune(Date.now(), settings.keepMin * MIN);
    let groups = nearby.view();
    if (settings.hideMaxedNearby) groups = groups.filter((g) => collection.progress(g.pet).rank !== 3);
    // Pinned first; then, where the meter knows where you are, the nearest.
    const near = new Map(groups.map((g) => [g.pet, nearestOf(g.pet)]));
    const dist = (g) => near.get(g.pet)?.metres ?? Infinity;
    groups.sort((a, b) => (pinned.has(b.pet) ? 1 : 0) - (pinned.has(a.pet) ? 1 : 0) || dist(a) - dist(b) || b.seen - a.seen);
    if (!groups.length) {
      frag.push(el("p", "empty", t("noNearby")));
    } else {
      const ul = el("ul", "rows");
      for (const g of groups) {
        const pet = ix.pets.get(g.pet);
        const li = el("li", pinned.has(g.pet) ? "row pinned" : "row");
        const main = el("div", "main");
        const title = el("div", "title");
        title.append(el("span", "name", petName(g.pet)), familyTag(pet.family));
        const mb = mapButton(g.pet);
        if (mb) title.append(mb);
        main.append(title, el("div", "mobs", g.mobs.map((m) => (m.count > 1 ? `${m.name} ×${m.count}` : m.name)).join(", ")), progressLine(g.pet));
        const side = el("div", "side");
        const n = near.get(g.pet);
        side.append(pinButton(g.pet));
        if (n) side.append(el("span", "far", `${n.arrow} ${t("far", { m: Math.round(n.metres) })}`));
        side.append(el("span", "seen", ago(g.seen)));
        li.append(portrait(g.pet), main, side);
        ul.append(li);
      }
      frag.push(ul);
    }
    view.replaceChildren(...frag);
  }

  /** The shopping list: fresh offers you need; one you just got souls for stays 20 s, ticked. */
  function merchantRows(now, farmable = false) {
    const rows = [];
    for (const r of L.recommendations([...stocks.values()], collection, now, ix, { farmable })) {
      const at = bought.get(r.pet);
      if (at !== undefined && now - at > 20000) continue;
      rows.push({ ...r, done: at !== undefined });
    }
    return rows;
  }

  function renderMerchant() {
    const view = $("#view");
    const columns = !!settings.merchantColumns && !compact;
    const groups = [];
    let frag = [];
    const nextGroup = () => {
      if (frag.length) groups.push(frag);
      frag = [];
    };
    const now = Date.now();
    const rows = merchantRows(now);
    const farm = merchantRows(now, true);
    const latest = [...stocks.values()].sort((a, b) => b.seen - a.seen)[0];
    const offerList = (list) => {
      const ul = el("ul", "rows");
      for (const r of list) {
        const pet = ix.pets.get(r.pet);
        const li = el("li", r.done ? "row done" : "row offer");
        const main = el("div", "main");
        const title = el("div", "title");
        title.append(el("span", "name", petName(r.pet)), familyTag(pet.family));
        main.append(title, progressLine(r.pet));
        const side = el("div", "side");
        if (r.done) side.append(el("span", "bought", t("bought")));
        else {
          side.append(el("span", "price", t("kina", { n: fmtNum(r.price) })));
          side.append(el("span", "seen", `${r.stock.tabName}${r.discount ? ` · ${t("off", { n: r.discount })}` : ""}`));
        }
        li.append(portrait(r.pet), main, side);
        ul.append(li);
      }
      return ul;
    };
    if (rows.length) {
      if (farm.length || columns) frag.push(el("h3", "section first", t("onlyMerchant")));
      frag.push(offerList(rows));
    } else if (!collection.synced) {
      // The line above says it already; the compact window has no such line.
      if (compact) frag.push(el("p", "empty", t("notSynced")));
    } else if (shopSeenAt && now - shopSeenAt < 2 * 60 * 1000 && shopReadAt < shopSeenAt - 1000) {
      frag.push(el("p", "empty warn", t("merchantUnknown", { t: span(shopSeenAt) })));
    } else if (latest && L.freshStock(latest, now)) {
      if (!farm.length) frag.push(el("p", "empty", t("merchantNone")));
    } else if (latest) {
      frag.push(el("p", "empty", t("merchantStale", { t: ago(latest.seen) })));
    } else {
      frag.push(el("p", "empty", t("merchantHint")));
    }
    nextGroup();
    if (farm.length) {
      frag.push(el("h3", "section", `${t("alsoFarmable")} (${farm.length})`));
      frag.push(offerList(farm));
    }
    nextGroup();
    if (!compact && collection.synced) {
      const watch = L.watchlist(ix, collection);
      if (watch.length) {
        frag.push(el("h3", "section", `${t("lookOut")} (${watch.length})`));
        const ul = el("ul", "rows small");
        for (const pet of watch) {
          const li = el("li", "row");
          const main = el("div", "main");
          const title = el("div", "title");
          title.append(el("span", "name", petName(pet.id)), familyTag(pet.family));
          main.append(title, progressLine(pet.id));
          li.append(portrait(pet.id), main, el("div", "side"));
          ul.append(li);
        }
        frag.push(ul);
      }
    }
    nextGroup();
    if (!columns) {
      view.replaceChildren(...groups.flat());
      return;
    }
    const cols = el("div", "merchantCols");
    for (const g of groups) {
      const col = el("div", "merchantCol");
      col.append(...g);
      cols.append(col);
    }
    view.replaceChildren(cols);
  }

  // ---------- the tabs ----------
  const TABS = ["pets", "nearby", "merchant"];
  function select(tab) {
    if (!TABS.includes(tab) || tab === settings.tab) return;
    settings.tab = tab;
    saveSettings();
    render();
  }
  // The farming pop-up (list.js) opens on the Pets tab.
  globalThis.PetFinderTabs = { select };

  function render() {
    renderTabs();
    document.body.classList.toggle("compact", compact);
    document.body.classList.toggle("merchantColumns", !compact && settings.tab === "merchant" && !!settings.merchantColumns);
    const tab = TABS.includes(settings.tab) ? settings.tab : "pets";
    document.body.dataset.tab = tab;
    $("#petsView").hidden = tab !== "pets";
    $("#finder").hidden = tab === "pets";
    if (tab === "pets") return;
    renderHeader();
    if (tab === "nearby") renderNearby();
    else renderMerchant();
  }

  // "seen 12s ago" and the keep-for limit, while nothing else changes.
  setInterval(() => {
    if (settings.tab !== "pets") dirty();
  }, 5000);

  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") settings = { ...settings, ...s };
      // Pet Finder 0.2's Search tab is the Pets tab now.
      if (!TABS.includes(settings.tab)) settings.tab = "pets";
    } catch {}
    render();
    // a2.ready() comes from list.js, once its saved counts are loaded: the
    // meter then sends what happened before, once (both scripts listen).
  })();
})();
