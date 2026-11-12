// The Inventory plugin's window: your inventory, character storage and
// server storage with each item's picture and name and what the sellable
// ones bring on your server's market; the drops of a session; the limits
// (Kinah today, the week's Abyss Points, the keys and entry counts) and a
// floater with the ones you pick. The items come from the meter
// (events:items: the game sends the inventory and both storages when you
// enter the world, and each change after), kept here per character for when
// you play another; the prices from the fork's hourly copy of aion2.exchange
// (a2.web.get), the pictures from the game's icon server (a2.web.image).
(() => {
  const C = globalThis.InventoryCalc;
  const $ = (s) => document.querySelector(s);
  const ICONS = "https://assets.playnccdn.com/static-aion2-gamedata/resources/";
  const COPY = "https://raw.githubusercontent.com/Xzero3007/A2Tools-DPS-Meter_Clicktrough/market-data";
  const API = "https://aion2.exchange/api";
  const STALE_MS = 20 * 60_000;
  const AUTO_MS = 30 * 60_000;
  const PAGE = 250;
  // Shown in the floater at first: the limits and the commonest keys.
  const FIRST_TICKETS = ["1", "7", "4", "8", "101", "70000001", "80000001"];

  let settings = {
    tab: "inv",
    sort: "value",
    sellableOnly: false,
    search: {},
    fee: 10,
    server: null, // aion2.exchange's server id
    view: null, // the character key looked at; null: the one playing
    floater: false,
    floaterLock: false,
    floaterOpacity: 0.86,
    floaterWidth: 260,
    floaterSlots: [null, null, null], // the floater's places 1 2 3: { x, y, width }
    shown: { kinah: true, abyss: true, gathering: true },
    tickets: null, // ids shown in the floater; null: FIRST_TICKETS
    breakMin: 180, // a new session after this long off (minutes; 0: only by hand)
    source: "all", // Drops: all, gathered, loot, reward, other
    lastLimits: null, // the key of the character whose limits were kept last
    statSource: "open", // Farm days: the source the statistics are about ("all" or days.js SOURCES)
    statMetric: "kinah", // Farm days: kinah, gold, worth, toCap
    farmWho: null, // Farm days: null the character looked at, "all" the whole account
  };
  const HISTORY = 40; // earlier sessions kept
  const SOURCE_NAMES = { all: "All", gathered: "Gathered", loot: "Loot", reward: "Rewards", other: "Other" };
  let character = null;
  let chars = []; // [{ key, name, serverId, at }]
  const stocks = new Map(); // key -> { name, serverId, inv, char, exactAt, at }
  const accounts = new Map(); // serverId -> { acc, exactAt, at }
  let session = C.newSession(Date.now());
  let history = []; // earlier sessions, newest first (C.summary)
  let pastView = null; // the start of the earlier session looked at; null: this one
  let area = null; // where you are, as the Map plugin shares it
  let lastItems = null;
  let servers = [];
  let prices = new Map();
  let hist = null; // the copy's price history of the server (anomaly.js)
  let fetchedAt = 0;
  let snapshot = null;
  let busy = false;
  let priceError = "";
  let shownRows = PAGE;

  // ---------- farm days ----------
  // What a character gained from one daily reset to the next, by where it
  // came from (days.js): the day being counted (the one playing), the lists
  // of days (summaries) per character, the world's zone, and the reward
  // keys' counts (a key going down marks its rewards).
  const F = globalThis.InventoryDays;
  const FARM_DAYS = 400; // days kept in a character's list
  let zone = null;
  let farmKey = null;
  let farmDay = null;
  const farmLists = new Map(); // character key -> [summaries], oldest first
  const keyCounts = new Map(); // ticket id -> left, for the one playing
  let dayView = null; // the day looked at; null: today
  let farmQ = Promise.resolve();
  const farm = (fn) => (farmQ = farmQ.then(fn).catch((e) => console.error(e)));
  const listKey = (key) => `f${key}`;
  const dayKey = (key, day) => `f${key}-${F.dayName(day)}`;
  async function loadFarmList(key) {
    if (!key || farmLists.has(key)) return;
    let list = null;
    try {
      list = await a2.storage.get(listKey(key));
    } catch {}
    if (!farmLists.has(key)) farmLists.set(key, Array.isArray(list) ? list.filter((x) => x && Number.isFinite(x.day)) : []);
  }
  let farmTimer = 0;
  const saveFarm = () => {
    clearTimeout(farmTimer);
    farmTimer = setTimeout(() => farm(async () => {
      if (!farmKey || !farmDay) return;
      await a2.storage.set(dayKey(farmKey, farmDay.day), farmDay).catch(() => {});
      await a2.storage.set(listKey(farmKey), farmLists.get(farmKey) || []).catch(() => {});
    }), 2000);
  };
  function noteSummary() {
    if (!farmKey || !farmDay || F.isEmpty(farmDay)) return;
    const list = (farmLists.get(farmKey) || []).filter((x) => x.day !== farmDay.day);
    list.push(F.summary(farmDay));
    list.sort((a, b) => a.day - b.day);
    farmLists.set(farmKey, list.slice(-FARM_DAYS));
  }
  /** The day an event at `at` counts in, for the one playing (loaded or new). */
  async function farmFor(at) {
    const key = currentKey();
    if (!key || !Number.isFinite(at)) return null;
    const day = F.dayOf(at);
    if (farmKey === key && farmDay?.day === day) return farmDay;
    if (farmKey === key && farmDay && day < farmDay.day) return null; // an older day's late event
    // Another character or a new day: the one before is kept as it is.
    if (farmKey && farmDay) {
      noteSummary();
      await a2.storage.set(dayKey(farmKey, farmDay.day), farmDay).catch(() => {});
      await a2.storage.set(listKey(farmKey), farmLists.get(farmKey) || []).catch(() => {});
    }
    await loadFarmList(key);
    let doc = null;
    try {
      doc = await a2.storage.get(dayKey(key, day));
    } catch {}
    farmKey = key;
    farmDay = F.normalize(doc) || F.newDay(at);
    return farmDay;
  }
  /** Where you are: the Map's map and region in the open world and the
   *  Abyss (with its window or overlay open), else the zone's name. */
  const placeLabel = () => {
    const k = F.zoneSource(zone);
    return area && (k === "open" || k === "abyss") ? area : F.zoneName(zone);
  };
  const priceOf = (item, n) => {
    if (!prices.size) return null;
    const w = C.worth(item, n, prices, settings.fee, hist);
    if (!w.sellable) return 0;
    return w.total ?? null;
  };
  function farmChanged() {
    noteSummary();
    saveFarm();
    if (settings.tab === "days") renderDays();
  }
  function farmItems(it) {
    const ats = (it?.changes || []).map((c) => c?.[1]).filter(Number.isFinite);
    if (!ats.length) return;
    const at = Math.max(...ats);
    const z = zone, place = placeLabel();
    farm(async () => {
      if (!(await farmFor(at))) return;
      farmDay = F.addItems(farmDay, it, z, priceOf, place);
      farmChanged();
    });
  }
  function farmCharacter(c) {
    if (!c?.name) return;
    const seen = c.seenAt || {};
    const z = zone, place = placeLabel();
    const kinah = Number(c.kinahToday);
    const kinahAt = Number(seen.kinahToday) || Date.now();
    // The reward keys: one going down is a reward taken.
    const used = [];
    const counts = c.contentCounts || {};
    for (const id of Object.keys(F.KEYS)) {
      const v = counts[id];
      if (!Array.isArray(v) || !Number.isFinite(Number(v[0]))) continue;
      const left = Number(v[0]) + (Number(v[1]) || 0);
      const before = keyCounts.get(id);
      keyCounts.set(id, left);
      if (before != null && left < before) used.push([id, Number(seen.contentCounts?.[id]) || Date.now()]);
    }
    if (!Number.isFinite(kinah) && !used.length) return;
    farm(async () => {
      if (Number.isFinite(kinah) && (await farmFor(kinahAt))) farmDay = F.addCounter(farmDay, kinah, kinahAt, z, place);
      for (const [id, at] of used) if (await farmFor(at)) farmDay = F.keyUsed(farmDay, id, at);
      farmChanged();
    });
  }
  function farmPrices() {
    if (!farmDay) return;
    farm(async () => {
      const next = F.settle(farmDay, priceOf);
      if (next !== farmDay) {
        farmDay = next;
        farmChanged();
      }
    });
  }

  // ---------- dungeon runs ----------
  // Each visit of a dungeon with the Odyle Energy spent there and the gold
  // items that came in (dungeons.js), per character, against the game's
  // drop rates.
  const D = globalThis.InventoryDungeons;
  const runLists = new Map(); // character key -> runs, oldest first
  let energyLast = null; // { key, value }: the Odyle Energy last seen
  let runQ = Promise.resolve();
  const runKey = (key) => `d${key}`;
  async function loadRuns(key) {
    if (!key || runLists.has(key)) return;
    let list = null;
    try {
      list = await a2.storage.get(runKey(key));
    } catch {}
    if (!runLists.has(key)) runLists.set(key, Array.isArray(list) ? list : []);
  }
  const runTimers = new Map();
  function saveRuns(key) {
    clearTimeout(runTimers.get(key));
    runTimers.set(key, setTimeout(() => a2.storage.set(runKey(key), runLists.get(key) || []).catch(() => {}), 2000));
  }
  /** Changes the runs of the one playing with `fn(runs)`, in order. */
  function runs(fn) {
    const key = currentKey();
    if (!key) return;
    runQ = runQ.then(async () => {
      await loadRuns(key);
      const before = runLists.get(key);
      const next = fn(before);
      if (JSON.stringify(next) === JSON.stringify(before)) return;
      runLists.set(key, next);
      saveRuns(key);
      if (settings.tab === "days") renderDays();
    }).catch((e) => console.error(e));
  }
  function runEnergy(c) {
    const key = currentKey();
    const value = D.energyOf(c);
    if (!key || value == null) return;
    const before = energyLast?.key === key ? energyLast.value : null;
    energyLast = { key, value };
    if (before != null && value < before) {
      const at = Number(c.seenAt?.contentCounts?.[D.ENERGY]) || Date.now();
      const z = zone;
      runs((l) => D.spend(l, z, before - value, at));
    }
  }

  /** A grade's name with a dot in the item's colour after it. */
  const gradeTag = (grade, rest = "") => el("span", { class: "grade" }, C.GRADES[grade] || "", el("i", { class: `dot g${grade}`, "aria-hidden": "true" }), rest);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  };
  const saver = (fn, ms = 500) => {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  };
  const saveSettings = saver(() => a2.storage.set("settings", settings).catch(() => {}));
  const saveSession = saver(() => a2.storage.set("session", session).catch(() => {}), 1500);
  const saveHistory = saver(() => a2.storage.set("sessions", history).catch(() => {}), 800);
  const saveChars = saver(() => a2.storage.set("chars", chars).catch(() => {}), 800);
  const dirty = new Set();
  const saveStocks = saver(async () => {
    for (const key of [...dirty]) {
      dirty.delete(key);
      if (key.startsWith("acc-")) {
        const sid = Number(key.slice(4));
        await a2.storage.set(key, accounts.get(sid)).catch(() => {});
      } else {
        await a2.storage.set(key, stocks.get(key)).catch(() => {});
      }
    }
  }, 1200);

  // ---------- each character's limits, kept ----------
  // The game sends the whole list only at a login: a meter started after it
  // (or again after an update) shows the kept values until the game says
  // new ones (calc.js keep, withKept).
  const kept = new Map(); // limits key -> calc.js keep()
  const keptKey = (charKey) => `l${charKey}`;
  const saveKept = saver(async () => {
    for (const [key, rec] of kept) if (rec.dirty) {
      rec.dirty = false;
      const { dirty: _, ...doc } = rec;
      await a2.storage.set(keptKey(key), doc).catch(() => {});
    }
  }, 1000);
  async function loadKept(key) {
    if (!key || kept.has(key)) return;
    let doc = null;
    try {
      doc = await a2.storage.get(keptKey(key));
    } catch {}
    if (!kept.has(key)) kept.set(key, C.keep(doc, null, Date.now()));
  }
  // Whose limits show: the one playing; before the meter knows who (just
  // started), the one whose were kept last.
  const limitsKey = () => currentKey() || (character?.name ? null : settings.lastLimits) || null;
  function noteLimits() {
    const key = currentKey();
    if (!key || !kept.has(key)) return;
    const before = kept.get(key);
    const next = C.keep(before, character, Date.now());
    next.name = character.name;
    const { dirty: _, ...was } = before;
    const { at: _a, ...a } = was;
    const { at: _b, ...b } = next;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      kept.set(key, { ...next, dirty: true });
      saveKept();
    }
    if (settings.lastLimits !== key) {
      settings.lastLimits = key;
      saveSettings();
    }
  }
  // Abyss Points gained while the meter has no week's points of its own.
  function noteAbyssGain(it) {
    const key = currentKey();
    if (!key || !kept.has(key) || (Array.isArray(character?.abyssPoints) && Number.isFinite(character.abyssPoints[0]))) return;
    let rec = kept.get(key);
    let gained = false;
    for (const c of Array.isArray(it?.changes) ? it.changes : []) {
      if (c?.[3] === C.ABYSS_POINTS && c[4] > 0) {
        rec = { ...C.keepAbyssGain(rec, c[4], Number(c[1]) || Date.now()), name: rec.name };
        gained = true;
      }
    }
    if (gained) {
      kept.set(key, { ...rec, dirty: true });
      saveKept();
    }
  }

  // ---------- whose items ----------
  const currentKey = () => (character?.name ? C.charKey(character.serverId, character.name) : null);
  const viewKey = () => settings.view || currentKey() || chars[0]?.key || null;
  const viewed = () => stocks.get(viewKey()) || null;
  async function loadStock(key) {
    if (!key || stocks.has(key)) return;
    try {
      const s = await a2.storage.get(key);
      if (s && typeof s === "object") stocks.set(key, s);
    } catch {}
    const st = stocks.get(key);
    if (st && !accounts.has(st.serverId)) {
      try {
        const a = await a2.storage.get(`acc-${st.serverId}`);
        if (a && typeof a === "object") accounts.set(st.serverId, a);
      } catch {}
    }
  }

  // A new session by itself after a break (a change of character is none).
  function rollAt(at) {
    if (!C.isBreak(session, at, (Number(settings.breakMin) || 0) * 60_000)) return;
    if (C.isEmpty(session)) {
      session = C.newSession(at);
      return;
    }
    endSession(at);
  }
  function endSession(at) {
    if (!C.isEmpty(session)) {
      history = [C.summary(session), ...history.filter((h) => h.start !== session.start)].slice(0, HISTORY);
      saveHistory();
    }
    session = C.newSession(at);
    saveSession();
  }

  function noteItems(it) {
    lastItems = it;
    noteAbyssGain(it);
    // The drops of the session: the changes of whoever plays.
    if ((it.changes && it.changes.length) || (it.pickups && it.pickups.length)) {
      const first = Math.min(...(it.changes || []).map((c) => c[1]).filter(Number.isFinite));
      if (Number.isFinite(first)) rollAt(first);
      session = C.addDrops(session, it);
      saveSession();
    }
    // Whose: the meter names the owner of a world entry once the game has;
    // without one (the meter started later) the character playing.
    const owner = it.owner || (it.snapshotAt ? null : character?.name);
    if (!owner || character?.serverId == null) {
      render();
      return;
    }
    const serverId = character.serverId;
    const key = C.charKey(serverId, owner);
    const kept = stocks.get(key);
    const acc = accounts.get(serverId);
    const next = C.apply({ inv: kept?.inv, char: kept?.char, acc: acc?.acc, exactAt: kept?.exactAt }, it);
    stocks.set(key, { name: owner, serverId, inv: next.inv, char: next.char, exactAt: next.exactAt, at: Date.now() });
    accounts.set(serverId, { acc: next.acc, exactAt: it.snapshotAt || acc?.exactAt || null, at: Date.now() });
    dirty.add(key);
    dirty.add(`acc-${serverId}`);
    saveStocks();
    if (!chars.some((c) => c.key === key)) {
      chars.push({ key, name: owner, serverId, at: Date.now() });
      saveChars();
    } else {
      chars.find((c) => c.key === key).at = Date.now();
    }
    render();
  }

  // ---------- prices ----------
  const server = () => servers.find((s) => s.id === settings.server) || null;
  function pickServer() {
    if (settings.server != null && servers.some((s) => s.id === settings.server)) return;
    const mine = C.serverOf(servers, character?.serverId);
    if (mine) {
      settings.server = mine.id;
      saveSettings();
    }
  }
  async function loadServers() {
    for (const url of [`${COPY}/servers.json`, `${API}/servers`]) {
      try {
        const list = C.readServers(await a2.web.get(url));
        if (list.length) {
          servers = list;
          a2.storage.set("servers", { at: Date.now(), servers }).catch(() => {});
          break;
        }
      } catch {}
    }
    pickServer();
  }
  async function directRows(id) {
    const rows = [];
    for (let page = 0; page < 10; page++) {
      const res = await a2.web.get(`${API}/items?server=${id}&limit=1000&offset=${rows.length}`);
      const items = Array.isArray(res?.items) ? res.items : [];
      rows.push(...items);
      if (!items.length || rows.length >= (Number(res?.total) || 0)) break;
    }
    return rows;
  }
  async function loadPrices(force = false) {
    const s = server();
    if (!s || busy) return renderTop();
    if (!force && fetchedAt && Date.now() - fetchedAt < STALE_MS && prices.size) return;
    busy = true;
    priceError = "";
    renderTop();
    try {
      let got = null;
      try {
        const copy = C.readCopy(await a2.web.get(`${COPY}/prices/${s.id}.json`));
        if (copy) got = { prices: copy.prices, snapshot: copy.snapshot };
      } catch {}
      if (!got) {
        const rows = await directRows(s.id);
        if (rows.length) got = { prices: C.readRows(rows), snapshot: rows.map((r) => r.captured_at).filter(Boolean).sort().pop() || null };
      }
      if (!got) throw new Error("no prices for this server yet");
      prices = got.prices;
      snapshot = got.snapshot;
      fetchedAt = Date.now();
      farmPrices();
      const keep = [...prices].map(([id, p]) => [id, p.price, p.listings, p.sold, p.soldAvg, p.last, p.change]);
      a2.storage.set("prices", { server: s.id, at: fetchedAt, snapshot, rows: keep }).catch(() => {});
      // The course of the lowest listings (the copy's history): an item far
      // above its usual price counts at the usual one (anomaly.js).
      try {
        const h = globalThis.MarketAnomaly?.readHistory(await a2.web.get(`${COPY}/history/${s.id}.json`));
        if (h) {
          hist = h;
          a2.storage.set("history", { server: s.id, doc: { v: 1, ...h } }).catch(() => {});
        }
      } catch {}
    } catch (e) {
      priceError = `Prices: ${e?.message || e}${prices.size ? " (showing the earlier ones)" : ""}`;
    } finally {
      busy = false;
    }
    render();
  }
  function restorePrices(c) {
    if (c?.server !== settings.server || !Array.isArray(c.rows)) return;
    prices = new Map(c.rows.map(([id, price, listings, sold, soldAvg, last, change]) => [String(id), { price, listings, sold, soldAvg, last, change: change ?? null }]));
    fetchedAt = c.at || 0;
    snapshot = c.snapshot || null;
  }

  // ---------- pictures ----------
  const pictures = new Map(); // icon name -> data URL | null
  const asked = new Map(); // icon name -> the boxes waiting for it
  const queue = [];
  let loading = 0;
  function pump() {
    while (loading < 4 && queue.length) {
      const icon = queue.shift();
      loading++;
      const get = a2.web && typeof a2.web.image === "function" ? a2.web.image(`${ICONS}${icon}.png`) : Promise.resolve(null);
      Promise.resolve(get)
        .catch(() => null)
        .then((data) => {
          pictures.set(icon, data || null);
          for (const box of asked.get(icon) || []) show(box, data);
          asked.delete(icon);
        })
        .finally(() => {
          loading--;
          pump();
        });
    }
  }
  function show(box, data) {
    if (!data || !box.isConnected) return;
    box.replaceChildren(el("img", { src: data, alt: "" }));
  }
  function iconBox(item) {
    const g = C.grade(item);
    const box = el("span", { class: `icon g${g}`, text: C.name(item).slice(0, 1) });
    const icon = C.icon(item);
    if (!icon) return box;
    if (pictures.has(icon)) {
      // Shown once in the page: show() needs the box in it.
      const data = pictures.get(icon);
      if (data) box.replaceChildren(el("img", { src: data, alt: "" }));
    } else if (asked.has(icon)) {
      asked.get(icon).push(box);
    } else {
      asked.set(icon, [box]);
      queue.push(icon);
      pump();
    }
    return box;
  }

  // ---------- drawing ----------
  const when = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const span = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };

  function renderTop() {
    const pick = $(".pick");
    const cur = currentKey();
    const opts = [...chars].sort((a, b) => (b.key === cur) - (a.key === cur) || b.at - a.at);
    if (cur && !opts.some((c) => c.key === cur)) opts.unshift({ key: cur, name: character.name, serverId: character.serverId });
    pick.replaceChildren(
      ...(opts.length ? opts : [{ key: "", name: "No character yet" }]).map((c) =>
        el("option", { value: c.key, text: `${c.name}${c.key === cur ? " (playing)" : ""}`, selected: c.key === viewKey() })),
    );
    const st = viewed();
    $(".state").textContent = st ? (st.exactAt ? `Complete as of ${when(st.exactAt)}` : "What the meter saw change") : "";
    const s = server();
    $(".priceState").textContent = busy ? "Reading prices …" : priceError || (s ? `${s.name}: ${prices.size ? `prices of ${when(Date.parse(snapshot) || fetchedAt)}` : "no prices yet"}` : "No server for prices yet");
    $(".update").disabled = busy || !s;
  }

  function counts() {
    const st = viewed();
    switch (settings.tab) {
      case "inv": return st?.inv || {};
      case "char": return st?.char || {};
      case "acc": return accounts.get(st?.serverId ?? character?.serverId)?.acc || {};
      case "drops": {
        const s = dropSession();
        return settings.source === "all" ? s.items || {} : C.bySource(s)[settings.source] || {};
      }
      default: return {};
    }
  }

  const dropSession = () => (pastView != null && history.find((h) => h.start === pastView)) || session;

  function render() {
    renderTop();
    for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === settings.tab));
    const limitsTab = settings.tab === "limits";
    const daysTab = settings.tab === "days";
    $(".listView").hidden = limitsTab || daysTab;
    $(".limitsView").hidden = !limitsTab;
    $(".daysView").hidden = !daysTab;
    if (limitsTab) renderLimits();
    else if (daysTab) renderDays();
    else renderList();
    sendFloater();
  }

  function renderList() {
    const tab = settings.tab;
    const search = settings.search[tab] || "";
    if ($(".search").value !== search && document.activeElement !== $(".search")) $(".search").value = search;
    $(".sellableOnly").checked = !!settings.sellableOnly;
    $(".sort").value = settings.sort;
    const { rows, sum } = C.list(counts(), prices, { fee: settings.fee, sort: settings.sort, search, sellableOnly: settings.sellableOnly, hist });
    // The session line, the sources and gathering on Drops.
    $(".sessionBar").hidden = tab !== "drops";
    $(".sources").hidden = tab !== "drops";
    $(".gatherBox").hidden = true;
    $(".whereBox").hidden = true;
    const ds = dropSession();
    if (tab === "drops") renderSession(ds);
    // The summary: how many, and what the sellable ones are worth.
    const st = viewed();
    const parts = [el("span", {}, el("b", { text: String(rows.filter((r) => !r.currency).length) }), " items")];
    if (prices.size) {
      parts.push(el("span", {}, el("b", { text: String(sum.sellable) }), " sellable"));
      parts.push(el("span", { class: "worth", title: `The lowest listing on your server for each (the usual price where that listing is far above it), times how many; after the market's ${settings.fee} % fee: ${C.kina(sum.net)}` },
        "worth ", el("b", { text: C.kina(sum.total) }), " Kina"));
    }
    if (tab === "inv") {
      const k = (st?.inv || {})[C.KINA];
      if (k) parts.push(el("span", {}, "Kina ", el("b", { text: C.kina(k) })));
    }
    $(".summary").replaceChildren(...parts);
    // Why a list is empty, or not complete.
    const hint = $(".hint");
    let text = "";
    if (tab === "drops") text = rows.length ? "" : settings.source !== "all" ? "Nothing of this kind in the session." : "Nothing came in since the session started. Items you gather, pick up or get count here, each with where it came from.";
    else if (!st) text = "Enter the world (log in, or switch character) while the meter runs: the game sends the inventory and both storages then.";
    else if (!st.exactAt && tab !== "inv") text = "Not seen yet: the game sends the storages when you enter the world. Log in again (or switch character) while the meter runs.";
    else if (!st.exactAt) text = "Only what changed since the meter started: log in again (or switch character) while the meter runs for the whole inventory.";
    else if (tab !== "inv") text = "Moving items to or from a storage sends nothing the meter can read: the storages are exact as of the last login, and after sorting your inventory.";
    hint.hidden = !text;
    hint.textContent = text;
    // The rows.
    const list = $(".items");
    if (!rows.length) {
      list.replaceChildren(el("li", { class: "empty", text: tab === "drops" ? "No drops yet." : settings.sellableOnly ? "Nothing sellable here." : "No items." }));
      return;
    }
    const out = [el("li", { class: "head" }, el("span"), el("span", { text: "Item" }), el("span", { class: "cnt", text: "Count" }), el("span", { class: "unit", text: "Each" }), el("span", { class: "tot", text: "Worth" }))];
    let lastGroup = null;
    for (const r of rows.slice(0, shownRows)) {
      const group = r.currency ? "Currencies" : null;
      if (group && group !== lastGroup) out.push(el("li", { class: "group", text: group }));
      lastGroup = group;
      const tags = el("span", { class: "tags" });
      if (C.GRADES[r.grade]) tags.append(gradeTag(r.grade));
      if (r.sellable) tags.append(el("span", { class: "tag sell", title: `On the market: ${r.listings} listed${r.sold != null ? `, ${r.sold} sold in 28 days` : ""}`, text: "Sellable" }));
      else if (r.bound) tags.append(el("span", { class: "tag", text: "Bound" }));
      if (r.odd) tags.append(el("span", { class: "tag odd", title: `The lowest listing, ${C.kina(r.listed)}, is far above the usual price: ${globalThis.MarketAnomaly.reason(r.odd, C.kina)}. Counted at ${C.kina(r.unit)} each.`, text: "Usual price" }));
      if (tab === "drops" && settings.source === "all") {
        if (ds.gathered?.[r.item]) tags.append(el("span", { class: "tag gath", title: "Gathered", text: `Gathered ${C.kina(ds.gathered[r.item])}` }));
        if (ds.loot?.[r.item]) tags.append(el("span", { class: "tag loot", title: "Picked up from the ground", text: `Loot ${C.kina(ds.loot[r.item])}` }));
        if (ds.reward?.[r.item]) tags.append(el("span", { class: "tag rew", title: "From a chest, a key or a reward of several items", text: `Reward ${C.kina(ds.reward[r.item])}` }));
      }
      out.push(
        el("li", { class: `g${r.grade}${r.sellable ? " sellable" : ""}`, title: `${r.name} (${r.item})` },
          iconBox(r.item),
          el("span", { class: "nm" }, el("span", { class: "n", text: r.name }), tags),
          el("span", { class: "cnt", text: C.kina(r.count) }),
          el("span", { class: "unit", text: r.unit != null ? C.short(r.unit) : "" }),
          el("span", { class: "tot", text: r.total != null ? C.kina(r.total) : "" })),
      );
    }
    if (rows.length > shownRows) {
      const more = el("button", { type: "button", class: "more", text: `Show ${Math.min(PAGE, rows.length - shownRows)} more of ${rows.length - shownRows}` });
      more.addEventListener("click", () => {
        shownRows += PAGE;
        renderList();
      });
      out.push(el("li", { class: "group" }, more));
    }
    list.replaceChildren(...out);
  }

  const perHour = (n, ms) => (ms >= 5 * 60_000 ? n / (ms / 3_600_000) : null);
  const sumWorth = (counts) => Object.entries(counts || {}).reduce((t, [id, n]) => t + (C.worth(Number(id), n, prices, settings.fee, hist).total || 0), 0);

  function renderSession(ds) {
    const past = ds !== session;
    // Which session: this one or an earlier one.
    const pick = $(".sessionPick");
    const label = (h, cur) => `${cur ? "This session" : when(h.start)}${cur ? "" : ` – ${when(h.end ?? h.last ?? h.start).replace(/^.*, /, "")}`}${h.active ? ` (${span(h.active)})` : ""}`;
    pick.replaceChildren(
      el("option", { value: "", text: label(session, true), selected: !past }),
      ...history.map((h) => el("option", { value: String(h.start), text: label(h, false), selected: past && h.start === ds.start })),
    );
    $(".breakPick").value = String(settings.breakMin ?? 180);
    $(".newSession").hidden = past;
    const end = past ? ds.end ?? ds.last ?? ds.start : Date.now();
    const played = ds.active || 0;
    const bits = [`Since ${when(ds.start)}`];
    if (played) bits.push(`played ${span(played)}`);
    if (ds.kinah) {
      const h = perHour(ds.kinah, played);
      bits.push(`Kina +${C.kina(ds.kinah)}${h != null ? ` (${C.short(h)}/h)` : ""}`);
    }
    if (ds.abyss) bits.push(`Abyss Points +${C.kina(ds.abyss)}`);
    $(".sessionText").textContent = bits.join(" · ");
    $(".sessionText").title = `From ${when(ds.start)} to ${when(end)}. Played: the time with something happening, pauses of 5 minutes or more left out. A new session starts by itself after the break set on the right.`;
    // Where it came from.
    const src = C.bySource(ds);
    const n = (m) => Object.values(m || {}).reduce((t, x) => t + (x > 0 ? 1 : 0), 0);
    const chips = ["all", "gathered", "loot", "reward", "other"].map((k) => {
      const count = k === "all" ? n(ds.items) : n(src[k]);
      const b = el("button", { type: "button", "aria-pressed": String(settings.source === k), title: k === "other" ? "Bought, crafted, from mail or a quest ..." : "" }, SOURCE_NAMES[k], el("b", { text: String(count) }));
      b.addEventListener("click", () => {
        settings.source = k;
        shownRows = PAGE;
        saveSettings();
        renderList();
      });
      return b;
    });
    $(".sources").replaceChildren(...chips);
    // Gathering and what was broken down.
    const box = $(".gatherBox");
    const lines = [];
    const g = ds.gather || {};
    if (g.n && (settings.source === "all" || settings.source === "gathered")) {
      const got = (g.amount || 0) + (g.bonus || 0);
      const worth = sumWorth(src.gathered);
      const wh = perHour(worth, played);
      lines.push(el("div", {},
        el("span", { class: "head", text: "Gathering" }),
        el("b", { text: C.kina(g.n) }), ` times at `, el("b", { text: C.kina(g.spots || 0) }), ` spots · `,
        el("b", { text: C.kina(got) }), ` items (`, el("b", { text: (got / g.n).toFixed(1) }), ` a time) · `,
        el("span", { title: "Gatherings the game marked as a great success" }, "great ", el("b", { text: `${C.kina(g.great || 0)}` }), ` (${Math.round(((g.great || 0) / g.n) * 100)} %)`), ` · `,
        el("span", { title: "Items the game added to a gathering as a bonus" }, "bonus ", el("b", { text: `+${C.kina(g.bonus || 0)}` })),
        prices.size ? el("span", { class: "worth" }, ` · worth `, el("b", { text: C.kina(worth) }), wh != null ? ` (${C.short(wh)}/h)` : "") : null));
      const areas = Object.entries(g.byArea || {}).sort((a, b) => b[1].n - a[1].n);
      if (areas.length && !(areas.length === 1 && areas[0][0] === "Unknown")) {
        lines.push(el("div", { title: "Where you gathered (as the Map plugin knows it)" }, "Where: ",
          ...areas.flatMap(([a, v], i) => [i ? " · " : "", `${a === "Unknown" ? "Map not open" : a} `, el("b", { text: C.kina(v.n) })])));
      }
    }
    const d = ds.dismantled || {};
    if (d.pieces && (settings.source === "all" || settings.source === "other")) {
      lines.push(el("div", { title: "Gear the game broke down as it came in: not counted as a drop" },
        el("span", { class: "head", text: "Dismantled" }),
        el("b", { text: C.kina(d.pieces) }), ` pieces → `, el("b", { text: C.kina(d.stones) }), ` Enhance Stones`,
        ...(d.kinahBound ? [` · `, el("b", { text: `−${C.kina(d.kinahBound)}` }), ` bound Kina`] : [])));
    }
    box.hidden = !lines.length;
    box.replaceChildren(...lines.flat());
    // Where and when in the session.
    const wb = $(".whereBox");
    const where = ds.where || [];
    wb.hidden = !where.length || settings.source !== "all";
    if (!wb.hidden) wb.replaceChildren(el("div", { class: "head", text: "Where and when" }), el("div", { class: "dayCard stints" }, ...stintRows(where, false)));
  }

  // ---------- farm days: the page ----------
  const pctText = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))} %`;
  const pText = (p) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
  const dayLabel = (day) => new Date(day).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  const clockOf = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const hours = (ms) => (ms ? span(ms) : "—");
  const metricText = (metric, v) => (v == null ? "—" : metric === "gold" ? v.toFixed(2) : metric === "toCap" ? `${v.toFixed(1)} h` : C.short(v));
  /** The days of the character looked at, today's as it is now. */
  function farmSums() {
    if (settings.farmWho === "all") {
      // The whole account: every character seen, added up day by day.
      const keys = [...new Set([...chars.map((c) => c.key), currentKey()].filter(Boolean))];
      const missing = keys.filter((k) => !farmLists.has(k));
      if (missing.length) {
        Promise.all(missing.map(loadFarmList)).then(() => settings.tab === "days" && renderDays());
        return [];
      }
      const byChar = {};
      for (const k of keys) byChar[chars.find((c) => c.key === k)?.name || character?.name || k] = charSums(k);
      return F.mergeSums(byChar);
    }
    const key = viewKey();
    if (!key) return [];
    if (!farmLists.has(key)) {
      loadFarmList(key).then(() => settings.tab === "days" && renderDays());
      return [];
    }
    return charSums(key);
  }
  function charSums(key) {
    const list = [...(farmLists.get(key) || [])];
    if (key === farmKey && farmDay && !F.isEmpty(farmDay)) {
      const i = list.findIndex((x) => x.day === farmDay.day);
      const s = F.summary(farmDay);
      if (i >= 0) list[i] = s;
      else list.push(s);
    }
    return list.sort((a, b) => a.day - b.day);
  }

  function renderDays() {
    // Whose: the character looked at (the menu at the top), or all of them.
    const who = $(".dayWho");
    const name = chars.find((c) => c.key === viewKey())?.name || character?.name || "This character";
    who.replaceChildren(el("option", { value: "", text: name, selected: settings.farmWho !== "all" }), el("option", { value: "all", text: "Whole account", selected: settings.farmWho === "all" }));
    const sums = farmSums();
    const today = F.dayOf(Date.now());
    const shown = sums.find((s) => s.day === (dayView ?? today)) || (dayView == null ? null : sums[sums.length - 1]) || null;
    // Which day.
    const pick = $(".dayPick");
    const opts = [...sums].reverse();
    if (!opts.some((s) => s.day === today)) opts.unshift({ day: today });
    pick.replaceChildren(...opts.map((s) => el("option", { value: String(s.day), text: `${dayLabel(s.day)}${s.day === today ? " (today)" : ""}${s.account ? (s.capped ? ` · ${s.capped} cap${s.capped === 1 ? "" : "s"}` : "") : s.cap ? " · cap" : ""}`, selected: s.day === (shown?.day ?? today) })));
    renderDay(shown);
    renderStats(sums);
    renderDungeons();
  }

  /** Where and when: a row a stint (newest first). */
  function stintRows(list, account) {
    const rows = [el("div", { class: "row head" }, el("span", { text: "When" }), el("span", { text: "Where" }), el("span", { text: "Played" }), el("span", { text: "Kina" }), el("span", { text: "Worth" }), el("span", { text: "Gold" }))];
    for (const x of [...(list || [])].sort((a, b) => b.from - a.from)) {
      rows.push(el("div", { class: "row", title: `${x.place}: ${clockOf(x.from)} to ${clockOf(x.to)}, ${C.kina(x.n)} items` },
        el("span", { text: `${clockOf(x.from)}–${clockOf(x.to)}` }),
        el("span", { class: "pl" }, el("span", { class: "n", text: x.place }), el("span", { class: `tag src-${x.src}`, text: F.NAMES[x.src] || x.src }), account && x.who ? el("span", { class: "tag", text: x.who }) : null),
        el("span", { text: hours(x.active) }), el("span", { text: C.kina(x.kinah) }), el("span", { class: "gold", text: C.short(x.worth) }), el("span", { class: x.gold ? "g4c" : "", text: String(x.gold || 0) })));
    }
    return rows;
  }

  function renderDay(s) {
    const box = $(".dayCard");
    const goldBox = $(".goldList");
    if (!s) {
      $(".dayText").textContent = "";
      $(".dayStints").replaceChildren(el("p", { class: "empty", text: "Where you played shows here, with when." }));
      box.replaceChildren(el("p", { class: "empty", text: "Nothing yet this day. Gains count from the daily reset (07:00 UTC) to the next, each with where it came from." }));
      goldBox.replaceChildren(el("li", { class: "empty", text: "No gold items this day." }));
      return;
    }
    const open = s.src?.open || {};
    // The Kina cap and the time to it.
    const bits = [];
    if (s.account) {
      bits.push(el("span", {}, el("b", { text: String(s.chars) }), ` character${s.chars === 1 ? "" : "s"} played`));
      if (s.capped) bits.push(el("span", {}, el("b", { text: String(s.capped) }), " reached the Kina cap", s.cap?.hoursEach ? [", after ", el("b", { text: span(s.cap.hoursEach * 3_600_000) }), " on average in the open world"] : ""));
      bits.push(el("span", {}, "Kina toward the caps ", el("b", { text: C.kina(s.counter || 0) })));
    } else if (s.cap) {
      bits.push(el("span", {}, "Kina cap reached at ", el("b", { text: clockOf(s.cap.at) }), " after ", el("b", { text: hours(s.cap.active) }), " in the open world",
        s.cap.sinceFirst ? ` (${span(s.cap.sinceFirst)} since its first Kina)` : ""));
      const after = { active: (open.active || 0) - (s.cap.active || 0), gold: (open.gold || 0) - (s.cap.gold || 0), worth: (open.worth || 0) - (s.cap.worth || 0) };
      if (after.active > 0 || after.gold > 0 || after.worth > 0) {
        bits.push(el("span", { title: "In the open world after the cap: no more Kina there, the drops go on" }, "After it: ", el("b", { text: hours(after.active) }), ", ",
          el("b", { text: String(after.gold) }), " gold, worth ", el("b", { class: "gold", text: C.short(after.worth) })));
      }
    } else {
      const k = s.counter ?? open.kinah ?? 0;
      bits.push(el("span", {}, "Kina toward the cap ", el("b", { text: C.kina(k) }), ` / ${C.short(C.KINA_DAILY)}`, open.active ? ` after ${hours(open.active)} in the open world` : ""));
    }
    $(".dayText").replaceChildren(...bits.flatMap((b, i) => (i ? [" · ", b] : [b])));
    // By source.
    const head = el("div", { class: "row head" }, el("span", { text: "Where" }), el("span", { text: "Played" }), el("span", { text: "Kina" }), el("span", { text: "Items" }), el("span", { text: "Worth" }), el("span", { text: "Gold" }));
    const rows = [head];
    const tot = { active: 0, kinah: 0, n: 0, worth: 0, gold: 0 };
    for (const k of F.SOURCES) {
      const p = s.src?.[k];
      if (!p || !(p.n || p.kinah || p.active)) continue;
      for (const f of Object.keys(tot)) tot[f] += p[f] || 0;
      rows.push(el("div", { class: `row src-${k}` },
        el("span", { text: F.NAMES[k] }), el("span", { text: hours(p.active) }), el("span", { text: C.kina(p.kinah) }),
        el("span", { text: C.kina(p.n) }), el("span", { class: "gold", text: C.short(p.worth) }), el("span", { class: p.gold ? "g4c" : "", text: String(p.gold || 0) })));
    }
    if (rows.length > 2) rows.push(el("div", { class: "row total" }, el("span", { text: "All" }), el("span", { text: hours(tot.active) }), el("span", { text: C.kina(tot.kinah) }), el("span", { text: C.kina(tot.n) }), el("span", { class: "gold", text: C.short(tot.worth) }), el("span", { text: String(tot.gold) })));
    box.replaceChildren(...(rows.length > 1 ? rows : [el("p", { class: "empty", text: "Nothing came in yet this day." })]));
    // Where and when.
    const st = $(".dayStints");
    st.replaceChildren(...((s.stints || []).length ? stintRows(s.stints, s.account) : [el("p", { class: "empty", text: "Where you played shows here, with when." })]));
    // The gold items, newest first.
    const gold = [...(s.gold || [])].sort((a, b) => b[0] - a[0]);
    goldBox.replaceChildren(...(gold.length ? gold.map(([at, item, n, k, z, w, who]) => el("li", { class: `g${C.grade(item)}`, title: `${C.name(item)} (${item})` },
      iconBox(item),
      el("span", { class: "nm" }, el("span", { class: "n", text: `${C.name(item)}${n > 1 ? ` ×${n}` : ""}` }),
        el("span", { class: "tags" }, C.GRADES[C.grade(item)] ? gradeTag(C.grade(item)) : null, s.account && who ? el("span", { class: "tag", text: who }) : null, el("span", { class: `tag src-${k}`, text: F.NAMES[k] || k }), el("span", { text: F.zoneName(z) }))),
      el("span", { class: "cnt", text: clockOf(at) }),
      el("span", { class: "tot gold", text: w != null ? C.kina(w) : "" }))) : [el("li", { class: "empty", text: "No gold items this day." })]));
  }

  function chips(target, items, current, onPick) {
    target.replaceChildren(...items.map(([k, label, title]) => {
      const b = el("button", { type: "button", "aria-pressed": String(current === k), title: title || "" }, label);
      b.addEventListener("click", () => onPick(k));
      return b;
    }));
  }

  function renderStats(sums) {
    const k = settings.statSource;
    const metric = F.METRICS[settings.statMetric] ? settings.statMetric : "kinah";
    chips($(".statSources"), [["all", "All"], ...F.SOURCES.map((x) => [x, F.NAMES[x]])], k, (x) => {
      settings.statSource = x;
      saveSettings();
      renderDays();
    });
    chips($(".statMetrics"), Object.entries(F.METRICS).map(([m, d]) => [m, d.label, d.open ? "The open world only: its played time until the Kina cap" : ""]), metric, (m) => {
      settings.statMetric = m;
      saveSettings();
      renderDays();
    });
    const pts = F.points(sums, k, metric);
    const where = metric === "toCap" ? "the open world" : k === "all" ? "anywhere" : F.NAMES[k];
    // The chart: a bar a day, the trend's line over it.
    const chart = $(".chart");
    const tr = F.trend(pts);
    if (!pts.length) {
      chart.replaceChildren();
      chart.setAttribute("hidden", "");
    } else {
      chart.removeAttribute("hidden");
      const W = 560, H = 120, pad = 4;
      const max = Math.max(...pts.map((p) => p.value), tr ? Math.max(tr.icept, tr.icept + tr.slope * ((pts[pts.length - 1].day - pts[0].day) / 86_400_000)) : 0) || 1;
      const first = pts[0].day, spanDays = Math.max(1, (pts[pts.length - 1].day - first) / 86_400_000);
      const bw = Math.max(3, Math.min(24, (W - 2 * pad) / (spanDays + 1) - 2));
      const x = (day) => pad + ((day - first) / 86_400_000 / spanDays) * (W - 2 * pad - bw);
      const y = (v) => H - 14 - (v / max) * (H - 24);
      const ns = "http://www.w3.org/2000/svg";
      const svg = (tag, attrs, text) => {
        const n = document.createElementNS(ns, tag);
        for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v);
        if (text != null) n.textContent = text;
        return n;
      };
      const parts = [svg("line", { x1: 0, x2: W, y1: H - 14, y2: H - 14, class: "axis" })];
      for (const p of pts) {
        const r = svg("rect", { x: x(p.day), y: y(p.value), width: bw, height: Math.max(1, H - 14 - y(p.value)), class: "col" });
        r.append(svg("title", {}, `${dayLabel(p.day)}: ${metricText(metric, p.value)} (${p.hours.toFixed(1)} h${metric === "gold" ? `, ${p.gold} gold` : ""})`));
        parts.push(r);
      }
      if (tr) {
        const xs = (pts[pts.length - 1].day - first) / 86_400_000;
        parts.push(svg("line", { x1: x(first) + bw / 2, x2: x(pts[pts.length - 1].day) + bw / 2, y1: y(Math.max(0, tr.icept)), y2: y(Math.max(0, tr.icept + tr.slope * xs)), class: `trend${tr.p < 0.05 && pts.length >= F.MIN_DAYS ? " sure" : ""}` }));
      }
      parts.push(svg("text", { x: pad, y: H - 2, class: "lbl" }, dayLabel(first)));
      if (pts.length > 1) parts.push(svg("text", { x: W - pad, y: H - 2, class: "lbl end" }, dayLabel(pts[pts.length - 1].day)));
      parts.push(svg("text", { x: W - pad, y: 10, class: "lbl end" }, `max ${metricText(metric, max)}`));
      chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
      chart.replaceChildren(...parts);
    }
    // What the numbers say, and whether they can say it yet.
    const out = [];
    const ready = F.readiness(pts, metric);
    const avg = pts.length ? pts.reduce((t, p) => t + p.value, 0) / pts.length : null;
    out.push(el("div", {}, el("span", { class: "head", text: F.METRICS[metric].label }), ` in ${where}: `,
      el("b", { text: metricText(metric, avg) }), ` on average over `, el("b", { text: String(pts.length) }), ` day${pts.length === 1 ? "" : "s"}`,
      metric === "gold" && ready.gold != null ? [` (`, el("b", { text: String(Math.round(ready.gold)) }), ` gold items)`] : ""));
    const missing = [];
    if (ready.needDays) missing.push(`${ready.needDays} more day${ready.needDays === 1 ? "" : "s"} with half an hour or more here`);
    if (ready.needGold) missing.push(`${ready.needGold} more gold item${ready.needGold === 1 ? "" : "s"}`);
    out.push(el("div", { class: ready.ready ? "ok" : "wait" }, ready.ready
      ? `Statistically meaningful: ${pts.length} days${metric === "gold" ? ` and ${Math.round(ready.gold)} gold items` : ""}.`
      : `Not meaningful yet: it needs ${F.MIN_DAYS} days${metric === "gold" ? ` and ${F.MIN_GOLD} gold items` : ""}; ${missing.join(" and ")} to go. Until then a trend is only a hint.`));
    if (tr) {
      const sure = tr.p < 0.05;
      out.push(el("div", { class: ready.ready ? "" : "prelim", title: "A straight line through the days by date: how much it rises or falls a week, against the average, and how likely a slope this steep is by chance alone (p)" },
        "Trend: ", sure ? el("b", { text: `${tr.perWeek >= 0 ? "rising" : "falling"} ${pctText(tr.perWeek)} a week` }) : el("b", { text: "none to see" }),
        ` (${sure ? "" : `a slope of ${pctText(tr.perWeek)} a week is chance, `}${pText(tr.p)})`));
    }
    const ch = metric === "gold" ? F.goldChange(pts) : F.change(pts);
    if (ch) {
      const sure = ch.p < 0.05;
      out.push(el("div", { class: ready.ready ? "" : "prelim", title: metric === "gold" ? "Gold items per hour played in the last 7 days against the days before; an exact test for rare drops" : "The last 7 days against the days before (Welch's t test)" },
        `Last ${F.RECENT_DAYS} days against the ${ch.nBefore ?? pts.length - F.RECENT_DAYS} before: `, el("b", { text: `${metricText(metric, ch.before)} → ${metricText(metric, ch.after)}` }),
        ` (${pctText(ch.rel)}): `, el("b", { text: sure ? "the drops changed" : "no change to see" }), ` (${pText(ch.p)})`));
    } else if (pts.length) {
      out.push(el("div", { class: "prelim", text: `Changes: from ${F.RECENT_DAYS + 3} days on, the last ${F.RECENT_DAYS} days are compared with the ones before.` }));
    }
    if (ready.detect != null && Number.isFinite(ready.detect)) {
      out.push(el("div", { class: "muted", title: "95 % sure, found 4 times out of 5" },
        `With these days a change of about ${Math.round(ready.detect * 100)} % shows`,
        ready.daysFor10 ? `; for 10 % about ${ready.daysFor10} days` : "", "."));
    }
    $(".verdicts").replaceChildren(...out);
    // By place, over all days.
    const places = F.byPlace(sums, metric === "toCap" ? "open" : k).filter((p) => p.hours >= F.MIN_HOURS);
    const pb = $(".places");
    pb.hidden = !places.length;
    if (places.length) {
      const ph = (v, h) => (h ? v / h : null);
      pb.replaceChildren(el("div", { class: "row head" }, el("span", { text: `By place (${where})` }), el("span", { text: "Days" }), el("span", { text: "Played" }), el("span", { text: "Kina/h" }), el("span", { text: "Worth/h" }), el("span", { text: "Gold/h" })),
        ...places.slice(0, 15).map((p) => el("div", { class: "row" }, el("span", { class: "pl", title: p.place }, el("span", { class: "n", text: p.place })), el("span", { text: String(p.days) }), el("span", { text: `${p.hours.toFixed(1)} h` }),
          el("span", { text: C.short(ph(p.kinah, p.hours)) }), el("span", { class: "gold", text: C.short(ph(p.worth, p.hours)) }), el("span", { text: ph(p.gold, p.hours).toFixed(2) }))));
    }
    // Gold items by the hour of the day.
    const byHour = F.goldByHour(sums, metric === "toCap" ? "open" : k, (at) => new Date(at).getHours());
    const most = Math.max(...byHour);
    const hb = $(".hours");
    hb.hidden = !most;
    if (most) {
      hb.replaceChildren(el("div", { class: "head", text: `Gold items by the hour of the day (${where})` }),
        el("div", { class: "hourBars" }, ...byHour.map((n, h) => el("span", { title: `${String(h).padStart(2, "0")}:00 to ${String((h + 1) % 24).padStart(2, "0")}:00: ${n}` },
          el("i", { style: `height:${(n / most) * 100}%` }), el("small", { text: h % 3 ? "" : String(h) })))));
    }
  }

  // ---------- dungeon drops ----------
  const VERDICT = { in: ["In range", "ok"], above: ["Above the range", "above"], below: ["Below the range", "below"], none: ["No boxes yet", "wait"] };
  const pctBox = (x) => (x == null ? "—" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`);
  /** The runs of the character looked at, or of every character (the account). */
  function runsShown() {
    if (settings.farmWho === "all") {
      const keys = [...new Set([...chars.map((c) => c.key), currentKey()].filter(Boolean))];
      const missing = keys.filter((k) => !runLists.has(k));
      if (missing.length) {
        Promise.all(missing.map(loadRuns)).then(() => settings.tab === "days" && renderDays());
        return null;
      }
      const out = {};
      for (const k of keys) out[chars.find((c) => c.key === k)?.name || character?.name || k] = runLists.get(k) || [];
      return out;
    }
    const key = viewKey();
    if (!key) return [];
    if (!runLists.has(key)) {
      loadRuns(key).then(() => settings.tab === "days" && renderDays());
      return null;
    }
    return runLists.get(key) || [];
  }
  /** A drop group's name, the dot after its grade (put on when it has none). */
  function labelWithDot(label, grade) {
    const name = C.GRADES[grade];
    if (!name) return el("span", { text: label });
    return label.startsWith(name) ? el("span", {}, gradeTag(grade, label.slice(name.length))) : el("span", {}, label, " ", gradeTag(grade));
  }
  function verdictRow(v, label, title) {
    const [text, cls] = VERDICT[v.verdict] || VERDICT.none;
    return el("div", { class: `row${v.main && v.key === "gold" ? " total" : ""}`, title: title || "" },
      labelWithDot(label, v.grade),
      el("span", { text: `${v.found} (${pctBox(v.rate)})`, title: v.boxes ? `${v.found} in ${v.boxes} boxes: ${pctBox(v.rate)} a box; 95 % sure your real rate lies between ${pctBox(v.rateLo)} and ${pctBox(v.rateHi)}` : "" }),
      el("span", { text: v.expectedLo < v.expected * 0.97 ? `${v.expectedLo.toFixed(1)}–${v.expected.toFixed(1)}` : `${v.expected.toFixed(1)} (${pctBox(v.chance)})`,
        title: v.expectedLo < v.expected * 0.97 ? `${pctBox(v.chanceLo)} to ${pctBox(v.chance)} a box, times ${v.boxes} boxes: the game's table gives each item's chance to drop at least once a box, not how often` : `The game's chance a box: ${pctBox(v.chance)}, times ${v.boxes} boxes` }),
      el("span", { text: v.boxes ? `${v.lo}–${v.hi}` : "—", title: "95 of 100 players with as many boxes find this many" }),
      el("span", { class: `vd ${cls}${v.sure ? "" : " prelim"}`, title: `${v.boxes ? pText(v.p) : ""}${v.sure ? "" : ` · still a hint: about ${v.need} more boxes until ${D.MIN_EXPECTED} drops are to expect`}` }, text));
  }
  function renderDungeons() {
    const box = $(".dungeons");
    const list = runsShown();
    if (list == null) return;
    const all = D.summarize(list);
    if (!all.length) {
      box.replaceChildren(el("p", { class: "empty", text: "Your dungeon runs show here: each visit with the Odyle Energy spent (40 a reward box) and what dropped, against the game's own drop rates." }));
      return;
    }
    const account = settings.farmWho === "all";
    box.replaceChildren(...all.map((d) => {
      const t = d.total;
      const parts = [el("div", { class: "dhead" },
        el("b", { text: d.name }), d.level ? el("span", { class: "tag", text: d.level, title: "The mode is taken from the game's zone number: tell it if it is wrong" }) : null,
        el("span", { class: "muted", text: `zone ${d.zone}` }),
        el("span", { class: "dnums" }, el("b", { text: String(t.runs) }), ` run${t.runs === 1 ? "" : "s"} · `, el("b", { text: String(t.boxes) }), ` box${t.boxes === 1 ? "" : "es"} (${C.kina(t.energy)} Odyle Energy) · `,
          el("b", { class: t.gold ? "g4c" : "", text: String(t.gold) }), ` gold item${t.gold === 1 ? "" : "s"}`,
          t.boxless ? ` · ${t.boxless} visit${t.boxless === 1 ? "" : "s"} without a box` : ""))];
      if (d.rows) {
        const head = el("div", { class: "row head" }, el("span", { text: "Drops" }), el("span", { text: "You (a box)" }), el("span", { text: "Expected" }), el("span", { text: "Range" }), el("span", { text: "Verdict" }));
        parts.push(el("div", { class: "dayCard dgrid" }, head, ...d.rows.map((v) => {
          const g = d.rate.groups.find((x) => x.key === v.key);
          const tip = g ? g.items.map(([, n, p]) => (p != null ? `${n}: ${pctBox(p)}` : n)).join("\n") + (g.extra ? "\n(the game's Obtainable Rewards window)" : "") : "";
          return verdictRow(v, v.label, tip ? `The game's chance a box, each at least once:\n${tip}` : "");
        })));
        // Now: the last 7 days.
        if (d.recent) {
          const v = d.recent.rows.find((x) => x.main);
          const [text, cls] = VERDICT[v.verdict];
          parts.push(el("div", { class: "dline" }, el("span", { class: "head", text: "Last 7 days" }), ` (${v.label.replace(", together", "")}): ${v.found} in ${v.boxes} boxes (${pctBox(v.rate)} a box, expected ${v.chanceLo < v.chance * 0.97 ? `${pctBox(v.chanceLo)}–` : ""}${pctBox(v.chance)}): `, el("b", { class: `vd ${cls}${v.sure ? "" : " prelim"}`, text }), ` (${pText(v.p)})`));
        }
        // Week by week.
        if (d.weeks.length > 1 || (d.weeks.length && !d.recent)) {
          parts.push(el("div", { class: "dayCard dweeks" }, el("div", { class: "row head" }, el("span", { text: "Week from" }), el("span", { text: "Boxes" }), el("span", { text: d.rows.find((x) => x.main)?.grade >= 4 ? "Unique+" : "Found" }), el("span", { text: "Expected" }), el("span", { text: "Verdict" })),
            ...d.weeks.slice(0, 12).map((w) => {
              const v = w.all;
              const [text, cls] = VERDICT[v?.verdict || "none"];
              return el("div", { class: "row" }, el("span", { text: dayLabel(w.week) }), el("span", { text: String(w.total.boxes) }), el("span", { text: v ? `${v.found} (${pctBox(v.rate)})` : "—" }),
                el("span", { text: v ? (v.expectedLo < v.expected * 0.97 ? `${v.expectedLo.toFixed(1)}–${v.expected.toFixed(1)}` : v.expected.toFixed(1)) : "—" }), el("span", { class: `vd ${cls}${v?.sure ? "" : " prelim"}`, title: v ? pText(v.p) : "", text }));
            })));
        }
      } else {
        parts.push(el("div", { class: "dline muted", text: `Gold items: ${t.boxes ? (t.gold / t.boxes).toFixed(2) : "—"} a box. The game's drop rates for this dungeon and mode are not in the plugin.` }));
      }
      // The last runs, to see what each one brought.
      parts.push(el("details", { class: "druns" }, el("summary", { text: "Last runs" }),
        el("div", { class: "dayCard" }, ...d.last.map((r) => el("div", { class: "row" },
          el("span", { text: `${dayLabel(r.from)} ${clockOf(r.from)}${account && r.who ? ` · ${r.who}` : ""}` }),
          el("span", { text: r.boxes ? `${r.boxes} box${r.boxes === 1 ? "" : "es"}` : r.energy ? `${r.energy} energy` : "no box" }),
          el("span", { class: "pl" }, ...Object.entries(r.items).map(([id, n]) => el("span", { class: `tag g${C.grade(Number(id))}`, title: `${C.name(Number(id))} (${C.GRADES[C.grade(Number(id))] || ""})` }, el("i", { class: `dot g${C.grade(Number(id))}`, "aria-hidden": "true" }), ` ${C.name(Number(id))}${n > 1 ? ` ×${n}` : ""}`))))))));
      return el("div", { class: "dungeon" }, ...parts);
    }));
  }

  // ---------- limits and the floater ----------
  const ticketsShown = () => new Set(settings.tickets || FIRST_TICKETS);
  const pct = (v, m) => (m ? Math.max(0, Math.min(100, (v / m) * 100)) : 0);
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  /** Every limit and ticket as a row: { key, label, value, max, text, shown }. */
  let skins = null; // { skins, goal } from the Closet plugin
  function limitRows() {
    const { character: ch, old } = C.withKept(character, kept.get(limitsKey()), Date.now());
    const rows = C.limits(ch).map((l) => ({
      key: l.key, label: l.label, value: l.value, max: l.max, shown: settings.shown[l.key] !== false,
      text: `${C.kina(l.value)}${l.max ? ` / ${C.short(l.max)}` : ""}`,
    }));
    // The skins against Empty Closet's 700 (the Closet plugin shares them).
    if (Number.isFinite(skins?.skins)) {
      const max = Number(skins.goal) || 700;
      rows.push({ key: "skins", label: "Skins (Empty Closet)", short: "Skins", value: skins.skins, max, shown: settings.shown.skins !== false, text: `${skins.skins} / ${max}` });
    }
    const shown = ticketsShown();
    for (const t of C.tickets(ch)) {
      rows.push(t.time
        ? { key: `t${t.id}`, id: t.id, label: t.name, short: t.short, value: null, max: null, text: `${clock(t.left)} left`, shown: shown.has(t.id) }
        : { key: `t${t.id}`, id: t.id, label: t.name, short: t.short, value: t.left, max: t.max || null, text: `${t.left}${t.max ? ` / ${t.max}` : ""}${t.extra ? ` +${t.extra}` : ""}`, shown: shown.has(t.id) });
    }
    // A kept value: dimmed, with when the game said it.
    for (const r of rows) {
      const o = old[r.key];
      if (!o) continue;
      r.old = true;
      r.note = o.reset
        ? (r.key === "kinah" || r.key === "abyss" ? `0 since the reset (${asOf(o.at)} it was more); the game sends the exact value at login` : `As of ${asOf(o.at)}, before the reset: log in again for the new count`)
        : `As of ${asOf(o.at)}: the game sends this again at login or when it changes`;
    }
    return rows;
  }
  const asOf = (at) => {
    if (!at) return "earlier";
    const d = new Date(at);
    const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return new Date().toDateString() === d.toDateString() ? t : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${t}`;
  };
  function renderLimits() {
    $(".floater").checked = !!settings.floater;
    const rows = limitRows();
    const line = (r) => {
      const box = el("input", { type: "checkbox", checked: r.shown, title: "Show it in the floater" });
      box.addEventListener("change", () => {
        if (r.id) {
          const s = ticketsShown();
          if (box.checked) s.add(r.id);
          else s.delete(r.id);
          settings.tickets = [...s];
        } else {
          settings.shown[r.key] = box.checked;
        }
        saveSettings();
        sendFloater();
      });
      const bar = r.max ? el("span", { class: `bar${r.value >= r.max ? " full" : ""}` }, el("i", { style: `width:${pct(r.value, r.max)}%` })) : el("span");
      return el("li", { class: r.old ? "old" : "" }, box, el("span", { class: "lbl", title: r.label, text: r.label }), bar, el("span", { class: "val", text: r.text, title: r.note || "" }));
    };
    const limits = rows.filter((r) => !r.id);
    const gatherKnown = limits.some((r) => r.key === "gathering");
    $(".limits").replaceChildren(
      ...limits.map(line),
      ...(limits.some((r) => r.key === "kinah") ? [] : [el("li", { class: "empty", text: "Kina today: not sent by the game yet (it comes at login and with each gain)." })]),
      ...(gatherKnown ? [] : [el("li", { class: "empty", text: "Server gathering limit: not read from the game yet." })]),
    );
    const tickets = rows.filter((r) => r.id);
    $(".tickets").replaceChildren(...(tickets.length ? tickets.map(line) : [el("li", { class: "empty", text: "No counts from the game yet: they come when you log in." })]));
  }

  let floaterOpen = false;
  let lastFloater = "";
  function floaterState() {
    const all = limitRows();
    const rows = all.filter((r) => r.shown).map((r) => ({ label: r.short || r.label, title: r.note ? `${r.label}\n${r.note}` : r.label, value: r.value, max: r.max, text: r.text, old: !!r.old }));
    const empty = all.length ? "Nothing ticked: pick in the window's Limits" : "Waiting for the game's values (log in)";
    const slots = (Array.isArray(settings.floaterSlots) ? settings.floaterSlots : []).map(Boolean);
    const who = character?.name || (kept.get(limitsKey())?.name ? `${kept.get(limitsKey()).name} (last played)` : "");
    return { rows, empty, slots, opacity: settings.floaterOpacity, locked: false, who };
  }
  const floaterSize = (n) => ({ width: Math.max(180, Math.min(600, settings.floaterWidth || 260)), height: Math.max(80, Math.min(700, 40 + Math.max(1, n) * 24)) });
  async function applyFloater() {
    try {
      if (settings.floater) {
        const st = floaterState();
        await a2.widgets.open("limits", floaterSize(st.rows.length));
        // No lock of its own: the meter's lock lets clicks through to the
        // game, one lock for everything (a lock kept from before is undone).
        await a2.widgets.lock(false);
        floaterOpen = true;
        lastFloater = "";
        sendFloater();
      } else {
        floaterOpen = false;
        await a2.widgets.close("limits");
      }
    } catch (e) {
      console.error(e);
    }
  }
  let sizedFor = -1;
  function sendFloater() {
    if (!settings.floater || !floaterOpen) return;
    const st = floaterState();
    const text = JSON.stringify(st);
    if (text === lastFloater) return;
    lastFloater = text;
    if (st.rows.length !== sizedFor) {
      sizedFor = st.rows.length;
      a2.widgets.open("limits", floaterSize(st.rows.length)).catch(() => {});
    }
    a2.widgets.send("limits", st).catch(() => {});
  }
  a2.on("widget-message", ({ name, data }) => {
    if (name !== "limits" || !data) return;
    if (data.type === "ready") {
      lastFloater = "";
      sendFloater();
    } else if (data.type === "close") {
      settings.floater = false;
      saveSettings();
      applyFloater();
      render();
    } else if (data.type === "opacity" && Number.isFinite(data.value)) {
      settings.floaterOpacity = Math.max(0.2, Math.min(1, data.value));
      saveSettings();
    } else if (data.type === "resized" && Number.isFinite(data.width)) {
      settings.floaterWidth = Math.round(data.width);
      saveSettings();
    } else if (data.type === "slot" && Number.isInteger(data.slot)) {
      goToSlot(data.slot);
    } else if (data.type === "slot-save" && Number.isInteger(data.slot)) {
      saveSlot(data.slot);
    }
  });

  // The floater's places 1 2 3: where it is and how wide, kept with a
  // right-click on its number, gone to with a click.
  async function saveSlot(n) {
    if (n < 0 || n > 2) return;
    let at = null;
    try {
      at = await a2.widgets.where("limits");
    } catch {}
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    const slots = Array.isArray(settings.floaterSlots) ? [...settings.floaterSlots] : [null, null, null];
    slots[n] = { x: Math.round(at.x), y: Math.round(at.y), width: settings.floaterWidth };
    settings.floaterSlots = slots;
    saveSettings();
    lastFloater = "";
    sendFloater();
  }
  async function goToSlot(n) {
    const slot = settings.floaterSlots?.[n];
    if (!slot) return;
    if (Number.isFinite(slot.width)) settings.floaterWidth = slot.width;
    saveSettings();
    try {
      await a2.widgets.place("limits", { x: slot.x, y: slot.y });
      if (settings.floater && floaterOpen) await a2.widgets.open("limits", floaterSize(floaterState().rows.length));
    } catch {}
    lastFloater = "";
    sendFloater();
  }

  // The meter's header button for the floater (Clicktrough's meter): on or
  // off, as the Floater tick here.
  a2.on("overlay", (data) => {
    settings.floater = !!data?.show;
    saveSettings();
    applyFloater();
    if (settings.tab === "limits") renderLimits();
  });

  // ---------- controls ----------
  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => {
      settings.tab = b.dataset.tab;
      shownRows = PAGE;
      saveSettings();
      render();
    });
  }
  $(".pick").addEventListener("change", async () => {
    const key = $(".pick").value || null;
    settings.view = key && key !== currentKey() ? key : null;
    saveSettings();
    await loadStock(viewKey());
    render();
  });
  $(".search").addEventListener("input", () => {
    settings.search[settings.tab] = $(".search").value;
    shownRows = PAGE;
    saveSettings();
    renderList();
  });
  $(".sellableOnly").addEventListener("change", () => {
    settings.sellableOnly = $(".sellableOnly").checked;
    saveSettings();
    renderList();
  });
  $(".sort").addEventListener("change", () => {
    settings.sort = $(".sort").value;
    saveSettings();
    renderList();
  });
  $(".update").addEventListener("click", () => loadPrices(true));
  $(".newSession").addEventListener("click", () => {
    endSession(Date.now());
    renderList();
  });
  $(".sessionPick").addEventListener("change", () => {
    const v = $(".sessionPick").value;
    pastView = v ? Number(v) : null;
    shownRows = PAGE;
    renderList();
  });
  $(".breakPick").addEventListener("change", () => {
    settings.breakMin = Number($(".breakPick").value) || 0;
    saveSettings();
  });
  $(".dayWho").addEventListener("change", () => {
    settings.farmWho = $(".dayWho").value === "all" ? "all" : null;
    saveSettings();
    renderDays();
  });
  $(".dayPick").addEventListener("change", () => {
    const v = Number($(".dayPick").value);
    dayView = Number.isFinite(v) && v !== F.dayOf(Date.now()) ? v : null;
    renderDays();
  });
  $(".floater").addEventListener("change", () => {
    settings.floater = $(".floater").checked;
    saveSettings();
    applyFloater();
  });

  // ---------- from the meter ----------
  a2.on("character", async (c) => {
    const before = character?.serverId;
    const keyBefore = currentKey();
    character = c || null;
    if (character?.name && currentKey() !== farmKey) keyCounts.clear();
    farmCharacter(character);
    // Another character: the run of the one before ends, this one's starts
    // where it is.
    if (character?.name && currentKey() !== keyBefore && zone != null) {
      const z = zone;
      runs((l) => D.enter(l, z, Date.now()));
    }
    runEnergy(character);
    if (character?.name) {
      await loadStock(currentKey());
      await loadKept(currentKey());
      noteLimits();
    }
    if (character?.serverId != null && character.serverId !== before) {
      pickServer();
      if (lastItems && !lastItems.snapshotAt) noteItems(lastItems);
      loadPrices();
    }
    render();
  });
  // The zone you are in (the world's): where a farm day's gains came from.
  a2.on("world", (w) => {
    const z = Number(w?.zone);
    if (!(z > 0) || z === zone) return;
    // Another zone: the Map's region of the one before no longer holds.
    if (zone != null) area = null;
    zone = z;
    runs((l) => D.enter(l, z, Date.now()));
  });
  a2.on("items", (it) => {
    if (!it || typeof it !== "object") return;
    farmItems(it);
    noteItems(it);
    if (it.changes?.length) {
      const z = zone;
      runs((l) => D.addItems(l, z, it));
    }
    // Where and when, in the session (Drops).
    if (it.changes?.length) {
      const where = F.trackItems(session.where, it, zone, placeLabel(), priceOf, session.start || 0);
      if (JSON.stringify(where) !== JSON.stringify(session.where || [])) {
        session = { ...session, where };
        saveSession();
        if (settings.tab === "drops") renderList();
      }
    }
  });
  // The game's gathering result (the plugin's decoder): item, amount, bonus.
  a2.on("decoded:gathered", (d, meta) => {
    if (!d || d.kind !== 58) return;
    const at = Number(meta?.at) || Date.now();
    rollAt(at);
    session = C.addGather(session, d, at, area);
    saveSession();
    if (settings.tab === "drops") renderList();
  });
  // Where you are: the Map plugin shares its map and region.
  a2.on("shared", ({ plugin, value }) => {
    if (plugin === "closet") {
      skins = value && Number.isFinite(value.skins) ? value : null;
      if (settings.tab === "limits") renderLimits();
      sendFloater();
      return;
    }
    if (plugin !== "map" || !value?.title) return;
    area = value.region ? `${value.title} · ${value.region}` : String(value.title);
  });

  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") settings = { ...settings, ...s, search: { ...(s.search || {}) }, shown: { ...settings.shown, ...(s.shown || {}) } };
    } catch {}
    try {
      const c = await a2.storage.get("chars");
      if (Array.isArray(c)) chars = c.filter((x) => x && typeof x.key === "string");
    } catch {}
    try {
      const s = await a2.storage.get("session");
      if (s && typeof s === "object" && s.start) session = C.normalize(s);
    } catch {}
    try {
      const h = await a2.storage.get("sessions");
      if (Array.isArray(h)) history = h.filter((x) => x && Number.isFinite(x.start)).map(C.normalize).map((x) => ({ ...x, end: x.end ?? x.last ?? x.start }));
    } catch {}
    try {
      const c = await a2.storage.get("servers");
      if (Array.isArray(c?.servers)) servers = C.readServers(c);
    } catch {}
    try {
      restorePrices(await a2.storage.get("prices"));
      const h = await a2.storage.get("history");
      if (h?.server === settings.server) hist = globalThis.MarketAnomaly?.readHistory(h.doc) || null;
    } catch {}
    await loadStock(viewKey());
    await loadKept(limitsKey());
    render();
    a2.ready();
    // One lock for everything: the meter's. A lock of the overlay's own,
    // kept from an earlier version, is undone.
    a2.widgets.lock(false).catch(() => {});
    if (settings.floater) applyFloater();
    await loadServers();
    render();
    await loadPrices();
    setInterval(() => loadPrices(true), AUTO_MS);
    // The session's length and the time tickets count on.
    setInterval(() => {
      if (settings.tab === "drops") renderList();
      if (settings.tab === "limits") renderLimits();
      if (settings.tab === "days") renderDays();
    }, 30_000);
  })();
})();
