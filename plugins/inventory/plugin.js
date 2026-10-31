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
    shown: { kinah: true, abyss: true, gathering: true },
    tickets: null, // ids shown in the floater; null: FIRST_TICKETS
  };
  let character = null;
  let chars = []; // [{ key, name, serverId, at }]
  const stocks = new Map(); // key -> { name, serverId, inv, char, exactAt, at }
  const accounts = new Map(); // serverId -> { acc, exactAt, at }
  let session = { start: Date.now(), items: {}, loot: {}, kinah: 0, abyss: 0, recent: [], pickups: [] };
  let lastItems = null;
  let servers = [];
  let prices = new Map();
  let fetchedAt = 0;
  let snapshot = null;
  let busy = false;
  let priceError = "";
  let shownRows = PAGE;

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

  function noteItems(it) {
    lastItems = it;
    // The drops of the session: the changes of whoever plays.
    if ((it.changes && it.changes.length) || (it.pickups && it.pickups.length)) {
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
      const keep = [...prices].map(([id, p]) => [id, p.price, p.listings, p.sold, p.soldAvg, p.last]);
      a2.storage.set("prices", { server: s.id, at: fetchedAt, snapshot, rows: keep }).catch(() => {});
    } catch (e) {
      priceError = `Prices: ${e?.message || e}${prices.size ? " (showing the earlier ones)" : ""}`;
    } finally {
      busy = false;
    }
    render();
  }
  function restorePrices(c) {
    if (c?.server !== settings.server || !Array.isArray(c.rows)) return;
    prices = new Map(c.rows.map(([id, price, listings, sold, soldAvg, last]) => [String(id), { price, listings, sold, soldAvg, last }]));
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
      case "drops": return session.items || {};
      default: return {};
    }
  }

  function render() {
    renderTop();
    for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === settings.tab));
    const limitsTab = settings.tab === "limits";
    $(".listView").hidden = limitsTab;
    $(".limitsView").hidden = !limitsTab;
    if (limitsTab) renderLimits();
    else renderList();
    sendFloater();
  }

  function renderList() {
    const tab = settings.tab;
    const search = settings.search[tab] || "";
    if ($(".search").value !== search && document.activeElement !== $(".search")) $(".search").value = search;
    $(".sellableOnly").checked = !!settings.sellableOnly;
    $(".sort").value = settings.sort;
    const { rows, sum } = C.list(counts(), prices, { fee: settings.fee, sort: settings.sort, search, sellableOnly: settings.sellableOnly });
    // The session line on Drops.
    $(".sessionBar").hidden = tab !== "drops";
    if (tab === "drops") {
      const bits = [`Since ${when(session.start)} (${span(Date.now() - session.start)})`];
      if (session.kinah) bits.push(`Kina +${C.kina(session.kinah)}`);
      if (session.abyss) bits.push(`Abyss Points +${C.kina(session.abyss)}`);
      $(".sessionText").textContent = bits.join(" · ");
    }
    // The summary: how many, and what the sellable ones are worth.
    const st = viewed();
    const parts = [el("span", {}, el("b", { text: String(rows.filter((r) => !r.currency).length) }), " items")];
    if (prices.size) {
      parts.push(el("span", {}, el("b", { text: String(sum.sellable) }), " sellable"));
      parts.push(el("span", { class: "worth", title: `The lowest listing on your server for each, times how many; after the market's ${settings.fee} % fee: ${C.kina(sum.net)}` },
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
    if (tab === "drops") text = rows.length ? "" : "Nothing came in since the session started. Items you pick up, gather or get count here; Loot marks what came from the ground.";
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
      if (C.GRADES[r.grade]) tags.append(el("span", { text: C.GRADES[r.grade] }));
      if (r.sellable) tags.append(el("span", { class: "tag sell", title: `On the market: ${r.listings} listed${r.sold != null ? `, ${r.sold} sold in 28 days` : ""}`, text: "Sellable" }));
      else if (r.bound) tags.append(el("span", { class: "tag", text: "Bound" }));
      if (tab === "drops" && session.loot?.[r.item]) tags.append(el("span", { class: "tag loot", title: "Picked up from the ground", text: `Loot ${C.kina(session.loot[r.item])}` }));
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

  // ---------- limits and the floater ----------
  const ticketsShown = () => new Set(settings.tickets || FIRST_TICKETS);
  const pct = (v, m) => (m ? Math.max(0, Math.min(100, (v / m) * 100)) : 0);
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  /** Every limit and ticket as a row: { key, label, value, max, text, shown }. */
  function limitRows() {
    const rows = C.limits(character).map((l) => ({
      key: l.key, label: l.label, value: l.value, max: l.max, shown: settings.shown[l.key] !== false,
      text: `${C.kina(l.value)}${l.max ? ` / ${C.short(l.max)}` : ""}`,
    }));
    const shown = ticketsShown();
    for (const t of C.tickets(character)) {
      rows.push(t.time
        ? { key: `t${t.id}`, id: t.id, label: t.name, short: t.short, value: null, max: null, text: `${clock(t.left)} left`, shown: shown.has(t.id) }
        : { key: `t${t.id}`, id: t.id, label: t.name, short: t.short, value: t.left, max: t.max || null, text: `${t.left}${t.max ? ` / ${t.max}` : ""}${t.extra ? ` +${t.extra}` : ""}`, shown: shown.has(t.id) });
    }
    return rows;
  }
  function renderLimits() {
    $(".floater").checked = !!settings.floater;
    $(".floaterLock").checked = !!settings.floaterLock;
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
      return el("li", {}, box, el("span", { class: "lbl", title: r.label, text: r.label }), bar, el("span", { class: "val", text: r.text }));
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
    const rows = all.filter((r) => r.shown).map((r) => ({ label: r.short || r.label, title: r.label, value: r.value, max: r.max, text: r.text }));
    const empty = all.length ? "Nothing ticked: pick in the window's Limits" : "Waiting for the game's values (log in)";
    return { rows, empty, opacity: settings.floaterOpacity, locked: !!settings.floaterLock, who: character?.name || "" };
  }
  const floaterSize = (n) => ({ width: Math.max(180, Math.min(600, settings.floaterWidth || 260)), height: Math.max(80, Math.min(700, 40 + Math.max(1, n) * 24)) });
  async function applyFloater() {
    try {
      if (settings.floater) {
        const st = floaterState();
        await a2.widgets.open("limits", floaterSize(st.rows.length));
        await a2.widgets.lock(!!settings.floaterLock);
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
    }
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
    session = { start: Date.now(), items: {}, loot: {}, kinah: 0, abyss: 0, recent: [], pickups: [] };
    saveSession();
    renderList();
  });
  $(".floater").addEventListener("change", () => {
    settings.floater = $(".floater").checked;
    saveSettings();
    applyFloater();
  });
  $(".floaterLock").addEventListener("change", () => {
    settings.floaterLock = $(".floaterLock").checked;
    saveSettings();
    a2.widgets.lock(settings.floaterLock).catch(() => {});
    lastFloater = "";
    sendFloater();
  });

  // ---------- from the meter ----------
  a2.on("character", async (c) => {
    const before = character?.serverId;
    character = c || null;
    if (character?.name) await loadStock(currentKey());
    if (character?.serverId != null && character.serverId !== before) {
      pickServer();
      if (lastItems && !lastItems.snapshotAt) noteItems(lastItems);
      loadPrices();
    }
    render();
  });
  a2.on("items", (it) => {
    if (it && typeof it === "object") noteItems(it);
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
      if (s && typeof s === "object" && s.start) session = { ...session, ...s };
    } catch {}
    try {
      const c = await a2.storage.get("servers");
      if (Array.isArray(c?.servers)) servers = C.readServers(c);
    } catch {}
    try {
      restorePrices(await a2.storage.get("prices"));
    } catch {}
    await loadStock(viewKey());
    render();
    a2.ready();
    if (settings.floater) applyFloater();
    await loadServers();
    render();
    await loadPrices();
    setInterval(() => loadPrices(true), AUTO_MS);
    // The session's length and the time tickets count on.
    setInterval(() => {
      if (settings.tab === "drops") renderList();
      if (settings.tab === "limits") renderLimits();
    }, 30_000);
  })();
})();
