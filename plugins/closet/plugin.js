// The Closet plugin's page: the closet from the login, the Black Cloud
// Merchant's offers of every character, the skins you lack and the combine
// sums; the pop-up at the shop (widget.html) and the count for the Inventory
// floater (a2.share).
(() => {
  const L = globalThis.ClosetLogic;
  const ix = L.index(globalThis.CLOSET_DATA);
  const $ = (s) => document.querySelector(s);
  const ICONS = "https://assets.playnccdn.com/static-aion2-gamedata/resources/";

  const settings = { tab: "merchant", popup: true, toast: true, popupMinutes: 3, status: false, statusAlways: false, sizes: {}, kind: "all", grade: "all", order: "price", lucky: false };
  let closet = null; // Map closet id -> copies
  let closetAt = 0;
  let chars = {}; // key -> { name, serverId, stocks: { tab: stock } }
  let seen = []; // [{ at, char, tab, refresh, skins, fresh, paid }]
  let learned = {}; // item -> closet id, from purchases
  let character = null;
  const recent = []; // recent item changes [{ at, item }]
  let bag = null; // the inventory as the meter last saw it: [[slot, item, count]]

  // ---------- storage ----------
  const saveLater = (() => {
    const timers = {};
    return (key, value, ms = 500) => {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => a2.storage.set(key, value).catch(() => {}), ms);
    };
  })();
  const saveSettings = () => saveLater("settings", settings);
  const saveCloset = () => saveLater("closet", { ids: closet ? [...closet] : [], at: closetAt });
  const isSkinCount = (n) => n > 0 && n < 100; // larger values are not copies
  const saveChars = () => saveLater("chars", chars);
  const saveSeen = () => saveLater("seen", seen.slice(-1500), 1500);
  const saveLearned = () => saveLater("learned", learned);

  const charKey = (c) => `${c?.serverId ?? "?"}:${c?.name ?? "?"}`;
  const count = () => (closet ? closet.size : null);
  const advise = () => {
    const cb = L.combine(closet, ix, { lucky: settings.lucky });
    return { combined: cb, extracted: L.extraction(closet, globalThis.CLOSET_DATA.gear, cb) };
  };

  // ---------- the game ----------
  a2.on("character", (c) => {
    if (!c?.name) return;
    character = c;
    const key = charKey(c);
    if (!chars[key]) chars[key] = { name: c.name, serverId: c.serverId, stocks: {} };
    saveChars();
    dirty();
  });

  a2.on("decoded:closet-list", (data, meta) => {
    const ids = L.closetFrom(data);
    if (!ids) return;
    closet = ids;
    closetAt = meta?.at || Date.now();
    saveCloset();
    shareCount();
    // Sent at login and when the closet opens: at login you are not in it.
    if (Date.now() - (meta?.at || Date.now()) < 60000) arrived("closet");
    sendWidgets();
    dirty();
  });

  a2.on("decoded:closet-add", (data, meta) => {
    const added = L.addedFrom(data);
    if (!added || !closet) return;
    const at = meta?.at || Date.now();
    for (const { id, count: n } of added) {
      const had = closet.has(id);
      closet.set(id, isSkinCount(n) ? n : (closet.get(id) || 0) + 1);
      if (had) continue;
      // A look the data has no skin for: the skin item that just came or
      // went is the one (learnt for the next offers).
      if (!ix.looks.has(id)) {
        const r = recent.filter((x) => Math.abs(x.at - at) < 8000).map((x) => ix.items.get(x.item)).filter((s) => s && !s.look && !learned[s.item]);
        if (r.length === 1) {
          learned[r[0].item] = id;
          saveLearned();
        }
      }
    }
    closetAt = at;
    saveCloset();
    shareCount();
    sendWidgets();
    dirty();
  });

  a2.on("world", (w) => {
    if (!here || !w) return;
    // Only the game's own reports of where you are: the meter's estimate
    // wanders by metres while you stand.
    const me = w.me;
    if (anchor && w.zone != null && anchor.zone != null && w.zone !== anchor.zone) return left();
    if (!me?.exact || !Number.isFinite(me.x) || !Number.isFinite(me.y)) return;
    if (!anchor) anchor = { x: me.x, y: me.y, zone: w.zone };
    else if (Math.hypot(me.x - anchor.x, me.y - anchor.y) > 6) left();
  });

  a2.on("items", (it) => {
    // A world entry (login, teleport): a closet list just before it was the login's.
    if (it?.snapshotAt && here && hereBy === "closet" && Date.now() - hereSince < 15000) left();
    const inv = it?.containers?.["1"];
    if (Array.isArray(inv)) {
      bag = inv;
      sendWidgetsSoon();
      if (settings.tab === "combine") dirty();
    }
    for (const ch of Array.isArray(it?.changes) ? it.changes : []) {
      const [, at, , item] = ch;
      if (ix.items.has(item)) recent.push({ at, item });
    }
    while (recent.length > 50) recent.shift();
  });

  let toldNew = "";
  const frames = new L.StockFrames((parts) => {
    const stock = L.stockFrom(parts);
    if (!stock) return;
    onStock(stock);
  });
  let flushTimer = 0;
  for (const name of ["shop-a", "shop-b", "shop-c", "shop-more"]) {
    a2.on(`decoded:${name}`, (data, meta) => {
      frames.push(name, data, meta?.at || Date.now());
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => frames.flush(), 250);
    });
  }

  function onStock(stock) {
    const key = character ? charKey(character) : "?:?";
    const c = (chars[key] ||= { name: character?.name || "?", serverId: character?.serverId, stocks: {} });
    const before = c.stocks[stock.tab];
    const paid = !!before && before.refresh === stock.refresh && before.offers.map((o) => o.offer).join() !== stock.offers.map((o) => o.offer).join();
    const same = !!before && before.refresh === stock.refresh && !paid;
    c.stocks[stock.tab] = stock;
    // Drop the stocks of an hour gone by.
    for (const [tab, s] of Object.entries(c.stocks)) if (s.refresh <= stock.at) delete c.stocks[tab];
    saveChars();
    const marks = stock.offers.map((o) => L.statusOf(o.item, closet, ix, learned));
    if (!same) {
      seen.push({ at: stock.at, char: key, tab: stock.tab, refresh: stock.refresh, paid,
        skins: marks.filter((m) => m.skin).length, fresh: marks.filter((m) => m.status === "new").length });
      if (seen.length > 1600) seen = seen.slice(-1500);
      saveSeen();
    }
    const fresh = stock.offers.filter((o, i) => marks[i].status === "new");
    const tell = `${key}|${stock.tab}|${fresh.map((o) => o.offer).join()}`;
    if (settings.toast && fresh.length && tell !== toldNew) {
      toldNew = tell;
      const names = fresh.map((o) => ix.items.get(o.item)?.name).filter(Boolean);
      a2.notify(`Black Cloud: ${fresh.length === 1 ? "a skin you lack" : `${fresh.length} skins you lack`} on offer (${names.join(", ")})`).catch(() => {});
    }
    if (settings.popup) openPopup();
    arrived();
    sendWidgets();
    dirty();
  }

  function shareCount() {
    if (typeof a2.share !== "function" || !closet) return;
    a2.share({ skins: closet.size, goal: L.GOAL }).catch(() => {});
  }

  // ---------- pictures ----------
  const pictures = new Map(); // icon -> data URL | null
  const waiting = new Map(); // icon -> [img]
  const queue = [];
  let loading = 0;
  function pump() {
    while (loading < 4 && queue.length) {
      const icon = queue.shift();
      loading++;
      const get = a2.web && typeof a2.web.image === "function" ? a2.web.image(`${ICONS}Icon_${icon}.png`) : Promise.resolve(null);
      Promise.resolve(get).catch(() => null).then((data) => {
        loading--;
        pictures.set(icon, typeof data === "string" ? data : null);
        for (const img of waiting.get(icon) || []) if (data) img.src = data;
        waiting.delete(icon);
        if (data) sendWidgetsSoon();
        pump();
      });
    }
  }
  function picture(icon, letter) {
    const box = el("span", "icon", letter || "");
    if (!icon) return box;
    const img = document.createElement("img");
    img.alt = "";
    if (pictures.get(icon)) img.src = pictures.get(icon);
    else if (!pictures.has(icon)) {
      if (!waiting.has(icon)) {
        waiting.set(icon, []);
        queue.push(icon);
        pump();
      }
      waiting.get(icon).push(img);
    } else return box;
    img.addEventListener("load", () => box.replaceChildren(img), { once: true });
    if (img.src) box.replaceChildren(img);
    return box;
  }

  // ---------- the pop-up at the shop and the status floater ----------
  // Both are widget.html, drawn by their state's kind. The meter keeps where
  // a widget is; its size is kept here (the widget posts it after a resize).
  const SIZE = { shop: { width: 360, height: 460, min: [260, 160] }, status: { width: 290, height: 300, min: [200, 90] } };
  const sizeOf = (name) => {
    const s = settings.sizes?.[name] || {}, d = SIZE[name];
    return { width: Math.max(d.min[0], Math.min(900, Math.round(s.width || d.width))), height: Math.max(d.min[1], Math.min(1000, Math.round(s.height || d.height))) };
  };
  const open = { shop: false, status: false };
  let popupTimer = 0;

  function adviceState() {
    const { combined, extracted } = advise();
    const pieces = closet ? L.bagGear(bag, closet, globalThis.CLOSET_DATA, ix) : [];
    return { advice: closet ? L.advice(combined, extracted) : [], bagNew: bag ? pieces.length : null,
      bagBest: pieces.slice(0, 3).map((p) => p.name || "a new look") };
  }
  function charsState(now) {
    const out = [];
    for (const [key, c] of Object.entries(chars)) {
      if (character && c.serverId !== character.serverId) continue;
      const live = Object.values(c.stocks).filter((s) => s.refresh > now);
      const fresh = live.reduce((n, s) => n + s.offers.filter((o) => L.statusOf(o.item, closet, ix, learned).status === "new").length, 0);
      out.push({ name: c.name, looked: live.length > 0, fresh, playing: !!character && key === charKey(character) });
    }
    return out.sort((a, b) => Number(b.playing) - Number(a.playing) || a.name.localeCompare(b.name));
  }
  const nextHour = (now) => Math.ceil((now + 1) / 3600000) * 3600000;

  function popupState() {
    const now = Date.now();
    const key = character ? charKey(character) : null;
    const c = key && chars[key];
    const stocks = c ? Object.values(c.stocks).filter((s) => s.refresh > now).sort((x, y) => x.tab - y.tab) : [];
    const offers = [];
    for (const s of stocks) {
      for (const o of s.offers) {
        const m = L.statusOf(o.item, closet, ix, learned);
        if (!m.skin) continue;
        const icon = m.skin.icon;
        if (icon && !pictures.has(icon) && !waiting.has(icon)) {
          waiting.set(icon, []);
          queue.push(icon);
          pump();
        }
        offers.push({ name: m.skin.name, slot: m.skin.slot, grade: m.skin.grade, status: m.status, price: o.price, discount: o.discount, tab: s.tabName, picture: pictures.get(icon) || null });
      }
    }
    offers.sort((x, y) => (x.status === "new" ? 0 : x.status === "unknown" ? 1 : 2) - (y.status === "new" ? 0 : y.status === "unknown" ? 1 : 2) || y.price - x.price);
    const refresh = stocks.length ? Math.min(...stocks.map((s) => s.refresh)) : 0;
    return { kind: "shop", who: character?.name || "", count: count(), goal: L.GOAL, offers, refresh, tabs: stocks.map((s) => s.tabName), unchecked: unchecked(now), ...adviceState() };
  }
  function statusState() {
    const now = Date.now();
    return { kind: "status", who: character?.name || "", count: count(), goal: L.GOAL, next: nextHour(now), chars: charsState(now), ...adviceState() };
  }
  const stateOf = (name) => (name === "shop" ? popupState() : statusState());
  function unchecked(now) {
    const out = [];
    for (const [key, c] of Object.entries(chars)) {
      if (character && key === charKey(character)) continue;
      if (character && c.serverId !== character.serverId) continue;
      if (!Object.values(c.stocks).some((s) => s.refresh > now)) out.push(c.name);
    }
    return out.sort();
  }
  async function openWidget(name) {
    try {
      await a2.widgets.open(name, sizeOf(name));
      // No lock of its own: the meter's lock is every widget's.
      await a2.widgets.lock(false);
      open[name] = true;
      a2.widgets.send(name, stateOf(name)).catch(() => {});
    } catch (e) {
      console.error(e);
    }
  }
  function closeWidget(name) {
    open[name] = false;
    a2.widgets.close(name).catch(() => {});
    if (name === "shop" && statusWanted() && !open.status) openWidget("status");
  }
  function keepPopup() {
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => closeWidget("shop"), Math.max(1, settings.popupMinutes) * 60 * 1000);
  }
  function openPopup() {
    keepPopup();
    // The pop-up shows what the floater does: the floater steps aside meanwhile.
    if (open.status) closeWidget("status");
    openWidget("shop");
  }
  // The floater shows at the shop and the closet (or always, when ticked so):
  // opened by the shop's stock or the closet's list, gone when you walk off
  // or after the pop-up's minutes; the game sends nothing when they close.
  let here = false; // at the shop or the closet now
  let hereTimer = 0;
  let anchor = null; // where you stood when they opened
  const statusWanted = () => settings.status && (settings.statusAlways || here) && !open.shop;
  function applyStatus() {
    if (statusWanted()) openWidget("status");
    else if (open.status) closeWidget("status");
  }
  let hereBy = "", hereSince = 0;
  function arrived(by = "") {
    hereBy = by;
    hereSince = Date.now();
    here = true;
    anchor = null;
    clearTimeout(hereTimer);
    hereTimer = setTimeout(left, Math.max(1, settings.popupMinutes) * 60 * 1000);
    applyStatus();
  }
  function left() {
    here = false;
    clearTimeout(hereTimer);
    if (open.shop) closeWidget("shop");
    applyStatus();
  }
  function sendWidgets() {
    for (const name of ["shop", "status"]) if (open[name]) a2.widgets.send(name, stateOf(name)).catch(() => {});
  }
  let widgetsSoon = 0;
  function sendWidgetsSoon() {
    clearTimeout(widgetsSoon);
    widgetsSoon = setTimeout(sendWidgets, 300);
  }
  a2.on("widget-message", ({ name, data }) => {
    if (!SIZE[name] || !data) return;
    if (data.type === "ready") {
      // A widget the meter brought back from before (at its start) that this
      // page did not open: the pop-up belongs to an open shop only, the
      // floater to its tick.
      const wanted = open[name] || (name === "status" && statusWanted());
      if (!wanted) {
        a2.widgets.close(name).catch(() => {});
        return;
      }
      open[name] = true;
      a2.widgets.send(name, stateOf(name)).catch(() => {});
    } else if (data.type === "close") {
      clearTimeout(popupTimer);
      closeWidget(name);
      if (name === "status") {
        settings.status = false;
        saveSettings();
        dirty();
      }
    } else if (data.type === "keep" && name === "shop") {
      keepPopup();
      if (here) arrived();
    }
    else if (data.type === "resized" && Number.isFinite(data.width) && Number.isFinite(data.height)) {
      settings.sizes = { ...(settings.sizes || {}), [name]: { width: Math.round(data.width), height: Math.round(data.height) } };
      saveSettings();
      showSizes();
    }
  });
  // The meter's header button: the status floater on or off.
  a2.on("overlay", (data) => {
    settings.status = !!data?.show;
    saveSettings();
    if (settings.status) arrived(); // shown now, until you walk off
    applyStatus();
    dirty();
  });

  // ---------- the page ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const kinah = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
  const millions = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : kinah(n));
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const pct = (x) => `${Math.round(x * 1000) / 10}%`;
  const grade = (g) => L.GRADES[g] || "?";

  let queued = false;
  function dirty() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  }

  function render() {
    const n = count();
    $(".count").textContent = n == null ? "–" : String(n);
    $(".goalOf").textContent = n == null ? `of ${L.GOAL} skins for Empty Closet` : n >= L.GOAL ? `of ${L.GOAL}: Empty Closet reached` : `of ${L.GOAL} skins for Empty Closet · ${L.GOAL - n} to go`;
    $(".bar > i").style.width = `${n == null ? 0 : Math.min(100, (n / L.GOAL) * 100)}%`;
    $(".state").textContent = closet ? `Closet as of ${new Date(closetAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Log in with the meter running: the game sends your closet at login.";
    for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === settings.tab));
    $(".merchantView").hidden = settings.tab !== "merchant";
    $(".missingView").hidden = settings.tab !== "missing";
    $(".combineView").hidden = settings.tab !== "combine";
    if (settings.tab === "merchant") renderMerchant();
    else if (settings.tab === "missing") renderMissing();
    else renderCombine();
  }

  function offerRow(o) {
    const m = L.statusOf(o.item, closet, ix, learned);
    const s = m.skin;
    const li = el("li", `offer ${m.status || "other"}`);
    li.append(picture(s?.icon, s ? s.name[0] : "·"));
    const text = el("div", "text");
    text.append(el("div", "name", s ? s.name : `Item ${o.item}`), el("div", "sub", s ? `${grade(s.grade)} · ${s.slot}` : "not a skin"));
    const price = el("div", "price");
    price.append(el("b", null, kinah(o.price)), el("small", null, o.discount ? `−${o.discount}%` : ""));
    li.append(text, price);
    if (m.status) li.append(el("span", `chip ${m.status}`, m.status === "new" ? "New" : m.status === "owned" ? "Owned" : "?"));
    li.title = m.status === "unknown" ? "This skin's closet entry is not known yet: it is learnt when you buy it" : "";
    return li;
  }

  function renderMerchant() {
    $(".popup").checked = !!settings.popup;
    $(".statusBox").checked = !!settings.status;
    $(".statusAlways").checked = !!settings.statusAlways;
    showSizes();
    $(".toast").checked = !!settings.toast;
    const now = Date.now();
    const list = Object.entries(chars).filter(([, c]) => Object.values(c.stocks).some((s) => s.refresh > now));
    const blocks = list.map(([key, c]) => {
      const box = el("div", "char");
      const stocks = Object.values(c.stocks).filter((s) => s.refresh > now).sort((x, y) => x.tab - y.tab);
      const refresh = Math.min(...stocks.map((s) => s.refresh));
      const head = el("div", "charHead");
      head.append(el("b", null, c.name), el("span", "muted", `changes at ${clock(refresh)}${character && key === charKey(character) ? " · playing" : ""}`));
      box.append(head);
      for (const s of stocks) {
        const skins = s.offers.filter((o) => ix.items.has(o.item));
        const others = s.offers.length - skins.length;
        box.append(el("div", "tabHead", `${s.tabName}${others ? ` · ${others} other item${others === 1 ? "" : "s"}` : ""}`));
        const ul = el("ul", "offers");
        ul.append(...skins.sort((x, y) => rank(x) - rank(y) || y.price - x.price).map(offerRow));
        if (!skins.length) ul.append(el("li", "empty muted", "No skins in this tab"));
        box.append(ul);
      }
      return box;
    });
    $(".chars").replaceChildren(...(blocks.length ? blocks : [el("p", "note", "No offers this hour yet: open the Black Cloud shop (Shop, tab Black Cloud) and look at its tabs. Each character has its own offers, changing every full hour.")]));
    const un = unchecked(now);
    $(".unchecked").textContent = un.length ? `Not looked at this hour: ${un.join(", ")}` : "";
    $(".unchecked").hidden = !un.length;
    const st = L.merchantStats(seen);
    const box = el("div");
    if (!st.offers) box.append(el("p", "note", "Counted from the stocks you open: how often a skin you lack is on offer, and what a paid change of the stock is worth."));
    else {
      box.append(el("p", "note", `${st.stocks} stocks seen, ${st.offers} skin offers, ${st.fresh} of them new to you then (${pct(st.rate)}). A paid change shows a new skin about ${pct(st.perChange)} of the time.`));
      const t = el("table", "refresh");
      const head = el("tr");
      head.append(el("th", null, "Paid change"), el("th", null, "Costs"), el("th", null, "Per new skin"));
      t.append(head);
      for (const r of st.refreshCost) {
        const tr = el("tr");
        tr.append(el("td", null, `${r.n}.`), el("td", null, kinah(r.cost)), el("td", null, r.perNew ? `≈ ${kinah(r.perNew)}` : "–"));
        t.append(tr);
      }
      box.append(t);
      box.append(el("p", "note", "The shop's refresh button changes the stock before the full hour: 500 Kinah the first time, more each time after. Worth it while the cost per new skin stays well under a skin's price."));
    }
    $(".stats").replaceChildren(box);
  }
  function rank(o) {
    const s = L.statusOf(o.item, closet, ix, learned).status;
    return s === "new" ? 0 : s === "unknown" ? 1 : 2;
  }

  function renderMissing() {
    $(".kind").value = settings.kind;
    $(".grade").value = settings.grade;
    $(".order").value = settings.order;
    const miss = L.missing(closet, ix);
    const need = closet ? Math.max(0, L.GOAL - closet.size) : 0;
    const c = L.costs(miss, need);
    const costs = $(".costs");
    if (!closet) costs.replaceChildren(el("p", "note", "Log in with the meter running: the game sends your closet at login."));
    else if (!c) costs.replaceChildren(el("p", "note", need ? "No prices known for what is left." : "Empty Closet reached."));
    else {
      const k = (label, value, sub) => {
        const d = el("div", "k");
        d.append(el("span", null, label), el("b", null, millions(value)), el("small", null, sub));
        return d;
      };
      costs.replaceChildren(
        k(`Cheapest ${c.n}`, c.cheapest, "the cheapest, all at 50% off"),
        k("Average", c.average, "a mix, at the usual discount"),
        k("Dearest", c.dearest, "the dearest, at 10% off"),
        k(`All ${c.count}`, c.all, "every merchant skin you lack"),
      );
    }
    const q = $(".search").value.trim().toLowerCase();
    let list = miss.filter((m) => (settings.kind === "all" || m.kind === settings.kind)
      && (settings.grade === "all" || (settings.grade === "shop" ? m.price > 0 : String(m.grade) === settings.grade))
      && (!q || m.name.toLowerCase().includes(q) || m.slot.toLowerCase().includes(q)));
    const by = { price: (x, y) => (x.price || Infinity) - (y.price || Infinity) || x.name.localeCompare(y.name),
      name: (x, y) => x.name.localeCompare(y.name) || x.slot.localeCompare(y.slot),
      grade: (x, y) => y.grade - x.grade || x.name.localeCompare(y.name) };
    list = list.sort(by[settings.order] || by.price);
    $(".missCount").textContent = closet ? `${list.length} of the ${miss.length} skins you lack${list.length > 300 ? " (the first 300 shown)" : ""}. Skins without a number in the game's data (sets, costumes) are not listed.` : "";
    $(".grid").replaceChildren(...list.slice(0, 300).map((m) => {
      const d = el("div", `card g${m.grade}`);
      const t = el("div", "text");
      t.append(el("div", "name", m.name), el("div", "sub", `${grade(m.grade)} · ${m.slot}`),
        el("div", "price", m.price ? `${kinah(m.price)} · 50% off ${kinah(m.price / 2)}` : "not sold by the merchant"));
      d.append(picture(m.icon, m.name[0]), t);
      return d;
    }));
  }

  const VERDICT = { yes: ["Combine", "good"], ok: ["Worth it", "mid"], feed: ["Only to climb a grade", "mid"], no: ["Stop", "bad"],
    cheap: ["Only cheap pieces", "mid"] };
  // The game's Extract Settings dialog, ticked as it pays: Auto Extract on
  // or off, the four grades, and the options to leave as they are.
  function renderSettings(box, set) {
    if (!set) {
      box.replaceChildren(el("p", "note", "Log in with the meter running: the settings follow from your closet."));
      return;
    }
    const dlg = el("div", "dialog");
    const onoff = el("div", "onoff");
    onoff.append(el("span", set.on ? "sel" : "", "ON"), el("span", set.on ? "" : "sel", "OFF"));
    dlg.append(onoff, el("div", "dlgHead", "Item Grade"));
    const grid = el("div", "grades");
    for (const g of set.grades) {
      const row = el("div", `grade ${g.tick ? "on" : "off"}`);
      const t = el("div");
      t.append(el("b", `g${g.grade}`, g.name), el("small", null, g.why));
      row.append(el("span", "tick", g.tick ? "✓" : ""), t);
      grid.append(row);
    }
    dlg.append(grid,
      el("div", "keep", "✓ Select gear that cannot be equipped and has a low base item level · ✓ Exclude Supply Request Gear · the level range as you have it"),
      el("div", "keep", "Quick Select (extracting by hand): the same grades."));
    box.replaceChildren(dlg);
  }
  function verdictCell(v, map) {
    const [text, tone] = map[v] || ["–", ""];
    return el("td", `verdict ${tone}`, text);
  }
  function renderCombine() {
    $(".lucky").checked = !!settings.lucky;
    const { combined: r, extracted } = advise();
    $(".combine tbody").replaceChildren(...r.rows.map((x) => {
      const tr = el("tr");
      tr.append(el("td", `g${x.grade}`, x.name),
        el("td", null, closet ? `${x.lackSame} / ${x.totalSame}` : "–"),
        el("td", null, closet ? (x.assumed ? `${x.next || "next"} (${Math.round(x.up * 100)}%, assumed all new)` : `${x.lackNext} / ${x.totalNext} ${x.next} (${Math.round(x.up * 100)}%)`) : "–"),
        el("td", null, closet ? pct(x.yieldNew) : "–"),
        el("td", null, closet && x.kinah ? `≈ ${kinah(x.kinah)}` : "–"),
        el("td", null, closet ? `${x.spares}${x.possible ? ` (${x.possible}×)` : ""}` : "–"),
        closet ? verdictCell(x.verdict, VERDICT) : el("td", null, "–"));
      return tr;
    }));
    renderSettings($(".xset"), closet ? L.extractSettings(extracted) : null);
    const pieces = closet ? L.bagGear(bag, closet, globalThis.CLOSET_DATA, ix) : [];
    const box = $(".bag");
    if (!closet || !bag) box.replaceChildren(el("p", "note", "Gear in your bag that would give a new skin shows here once the meter has seen your inventory (at a world entry)."));
    else if (!pieces.length) box.replaceChildren(el("p", "note", "No gear in your bag has a look you lack: sell or dismantle it."));
    else {
      const ul = el("ul", "offers");
      ul.append(...pieces.slice(0, 60).map((p) => {
        const li = el("li", "offer new");
        li.append(picture(p.icon, p.name ? p.name[0] : "·"));
        const t = el("div", "text");
        t.append(el("div", "name", p.name || `Look ${p.look}`), el("div", "sub", `${grade(p.grade)} gear${p.slot ? ` · ${p.slot}` : ""}${p.count > 1 ? ` · ${p.count} pieces` : ""}`));
        const c = el("div", "price");
        c.append(el("b", null, pct(1 - Math.pow(1 - p.chance, p.count))), el("small", null, "skin chance"));
        li.append(t, c);
        return li;
      }));
      box.replaceChildren(el("p", "note", `${pieces.length} piece${pieces.length === 1 ? "" : "s"} in your bag with a look you lack: extract ${pieces.length === 1 ? "it" : "these"}, sell the rest.`), ul);
    }
  }

  // ---------- controls ----------
  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => {
      settings.tab = b.dataset.tab;
      saveSettings();
      render();
    });
  }
  $(".popup").addEventListener("change", (e) => { settings.popup = e.target.checked; saveSettings(); if (!settings.popup) closeWidget("shop"); });
  $(".statusBox").addEventListener("change", (e) => { settings.status = e.target.checked; saveSettings(); applyStatus(); });
  function showSizes() {
    for (const i of document.querySelectorAll(".size")) if (document.activeElement !== i) i.value = String(sizeOf(i.dataset.w)[i.dataset.k]);
  }
  for (const i of document.querySelectorAll(".size")) {
    i.addEventListener("change", () => {
      const name = i.dataset.w;
      const v = Number(i.value);
      if (!Number.isFinite(v)) return;
      settings.sizes = { ...(settings.sizes || {}), [name]: { ...sizeOf(name), [i.dataset.k]: v } };
      saveSettings();
      showSizes();
      if (open[name]) a2.widgets.open(name, sizeOf(name)).catch(() => {});
    });
  }
  $(".statusAlways").addEventListener("change", (e) => { settings.statusAlways = e.target.checked; saveSettings(); applyStatus(); });
  $(".toast").addEventListener("change", (e) => { settings.toast = e.target.checked; saveSettings(); });
  $(".showPopup").addEventListener("click", () => openPopup());
  $(".search").addEventListener("input", () => renderMissing());
  for (const k of ["kind", "grade", "order"]) $(`.${k}`).addEventListener("change", (e) => { settings[k] = e.target.value; saveSettings(); renderMissing(); });
  $(".lucky").addEventListener("change", (e) => { settings.lucky = e.target.checked; saveSettings(); renderCombine(); sendWidgets(); });
  // The hour changes: stocks run out.
  setInterval(() => { if (settings.tab === "merchant") dirty(); sendWidgets(); }, 30 * 1000);

  // ---------- start ----------
  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") Object.assign(settings, s);
      const c = await a2.storage.get("closet");
      if (c && Array.isArray(c.ids) && c.ids.length && !closet) {
        // Kept as [id, copies] (0.2) or as bare ids (0.1).
        closet = new Map(c.ids.map((e) => (Array.isArray(e) ? [e[0], e[1]] : [e, 1])));
        closetAt = c.at || 0;
      }
      const ch = await a2.storage.get("chars");
      if (ch && typeof ch === "object") chars = { ...ch, ...chars };
      const sn = await a2.storage.get("seen");
      if (Array.isArray(sn)) seen = [...sn, ...seen];
      const le = await a2.storage.get("learned");
      if (le && typeof le === "object") learned = { ...le, ...learned };
    } catch (e) {
      console.error(e);
    }
    shareCount();
    render();
    // A pop-up the meter kept from before belongs to no open shop.
    if (!open.shop) a2.widgets.close("shop").catch(() => {});
    applyStatus();
    a2.ready?.();
  })();
})();
