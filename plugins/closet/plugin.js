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

  let zoneNow = null; // the zone of the last world report
  a2.on("world", (w) => {
    if (w?.zone != null) {
      // Another zone than at the shop or the closet (a teleport): you left.
      if (here && hereZone != null && w.zone !== hereZone) {
        zoneNow = w.zone;
        return left();
      }
      zoneNow = w.zone;
      if (here && hereZone == null) hereZone = w.zone;
    }
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
    // A frame replayed from earlier (the page started again) opens nothing.
    if (Date.now() - (stock.at || Date.now()) < 90 * 1000) arrived("shop");
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
  const pictureStats = { ok: 0, failed: 0, error: "" };
  let loading = 0;
  function pump() {
    while (loading < 4 && queue.length) {
      const icon = queue.shift();
      loading++;
      // The icon server has most as .png; a few only as .webp.
      const one = (ext) => (a2.web && typeof a2.web.image === "function" ? a2.web.image(`${ICONS}Icon_${icon}.${ext}`) : Promise.reject(new Error("this meter can't show pictures")));
      Promise.resolve()
        .then(() => one("png"))
        .catch(() => one("webp"))
        .then((data) => {
          if (data) pictureStats.ok++;
          return data;
        }, (e) => {
          pictureStats.failed++;
          pictureStats.error = String(e?.message || e || "unknown").slice(0, 90);
          if (!pictureStats.ok) dirty();
          return null;
        })
        .then((data) => {
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
  const SIZE = { status: { width: 340, height: 520, min: [220, 120] } };
  const sizeOf = (name) => {
    const s = settings.sizes?.[name] || {}, d = SIZE[name];
    return { width: Math.max(d.min[0], Math.min(900, Math.round(s.width || d.width))), height: Math.max(d.min[1], Math.min(1000, Math.round(s.height || d.height))) };
  };
  const open = { status: false };

  function charsState(now) {
    const out = [];
    for (const [key, c] of Object.entries(chars)) {
      if (character && c.serverId != null && character.serverId != null && c.serverId !== character.serverId) continue;
      const live = Object.values(c.stocks).filter((s) => s.refresh > now);
      const fresh = live.reduce((n, s) => n + s.offers.filter((o) => L.statusOf(o.item, closet, ix, learned).status === "new").length, 0);
      out.push({ name: c.name, looked: live.length > 0, fresh, playing: !!character && key === charKey(character) });
    }
    return out.sort((a, b) => Number(b.playing) - Number(a.playing) || a.name.localeCompare(b.name));
  }
  const nextHour = (now) => Math.ceil((now + 1) / 3600000) * 3600000;

  // The offers to show: the stock opened last this hour (all its tabs), with
  // whose it is. Not by the playing character, so a late or wrong character
  // never hides what you just opened.
  function offersState(now) {
    let best = null;
    for (const c of Object.values(chars)) {
      if (character && c.serverId != null && character.serverId != null && c.serverId !== character.serverId) continue;
      const live = Object.values(c.stocks).filter((s) => s.refresh > now);
      const at = Math.max(0, ...live.map((s) => s.at || 0));
      if (live.length && (!best || at > best.at)) best = { c, live, at };
    }
    if (!best) return { offers: [], owner: "", refresh: 0 };
    const offers = [];
    for (const s of best.live.sort((x, y) => x.tab - y.tab)) {
      for (const o of s.offers) {
        const m = L.statusOf(o.item, closet, ix, learned);
        if (!m.skin) continue;
        const icon = m.skin.icon;
        if (icon && !pictures.has(icon) && !waiting.has(icon)) {
          waiting.set(icon, []);
          queue.push(icon);
          pump();
        }
        offers.push({ name: m.skin.name, slot: m.skin.slot, grade: m.skin.grade, status: m.status, price: o.price, discount: o.discount, tab: s.tabName, soldOut: !!o.soldOut, picture: pictures.get(icon) || null });
      }
    }
    const rank = (o) => (o.status === "new" ? 0 : o.status === "unknown" ? 1 : 2);
    offers.sort((x, y) => rank(x) - rank(y) || y.price - x.price);
    return { offers, owner: best.c.name, refresh: Math.min(...best.live.map((s) => s.refresh)) };
  }
  // One short line of what to do in the closet (the Combine tab has the rest).
  function todoState() {
    if (!closet) return "";
    const { combined, extracted } = advise();
    const plan = (L.advice(combined, extracted) || []).find((a) => a.kind === "plan");
    if (!plan) return "";
    if (plan.now.length) return `Combine in the closet: ${plan.now.map((n) => `${n.times}× ${n.name}`).join(", then ")}`;
    return "Nothing to combine yet: keep collecting";
  }
  function statusState() {
    const now = Date.now();
    const shop = here || settings.statusAlways ? offersState(now) : { offers: [], owner: "", refresh: 0 };
    const all = charsState(now);
    return { kind: "status", count: count(), goal: L.GOAL, next: nextHour(now), here,
      offers: shop.offers, owner: shop.owner, refresh: shop.refresh,
      notLooked: all.filter((c) => !c.looked).map((c) => c.name), freshElsewhere: all.filter((c) => c.looked && c.fresh && c.name !== shop.owner).map((c) => `${c.name} ${c.fresh}`),
      todo: todoState() };
  }
  const stateOf = () => statusState();
  function unchecked(now) {
    const out = [];
    for (const [key, c] of Object.entries(chars)) {
      if (character && key === charKey(character)) continue;
      if (character && c.serverId != null && character.serverId != null && c.serverId !== character.serverId) continue;
      if (!Object.values(c.stocks).some((s) => s.refresh > now)) out.push(c.name);
    }
    return out.sort();
  }
  // One window: it shows at the Black Cloud shop and in the closet (tick
  // "Window at the shop"), or all the time ("Everywhere"). At the shop and
  // the closet it takes the mouse even with the meter locked, so its list
  // scrolls; it stays put then. Elsewhere a locked window lets clicks through.
  const widgetSize = () => ({ ...sizeOf("status"), unlocked: here });
  // One open at a time: two at once (two shop tabs told in one moment) made
  // two windows in the meter, the second empty and impossible to close.
  // A change asked for while one runs is applied when it is done.
  let opening = false, again = false;
  async function openWidget() {
    if (opening) {
      again = true;
      return;
    }
    opening = true;
    try {
      await a2.widgets.open("status", widgetSize());
      // No lock of its own: the meter's lock is every widget's.
      await a2.widgets.lock(false);
      open.status = true;
      sendWidgets();
    } catch (e) {
      console.error(e);
    } finally {
      opening = false;
    }
    if (again) {
      again = false;
      applyStatus();
    }
  }
  function closeWidget() {
    if (opening) {
      again = true;
      return;
    }
    open.status = false;
    a2.widgets.close("status").catch(() => {});
  }
  let here = false; // at the shop or the closet now
  let hereTimer = 0;
  let anchor = null; // where you stood when it opened
  let dismissed = false; // closed with its × until you come back
  const statusWanted = () => !dismissed && ((settings.popup && here) || settings.statusAlways);
  let openedHere = null; // `here` when the window was last opened (its mouse rule)
  function applyStatus() {
    if (statusWanted()) {
      if (open.status && openedHere === here) sendWidgets();
      else {
        openedHere = here;
        openWidget();
      }
    } else if (open.status || opening) closeWidget();
  }
  let hereBy = "", hereSince = 0, hereZone = null;
  function arrived(by = "") {
    if (!here) {
      dismissed = false;
      hereZone = zoneNow;
    }
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
    dismissed = false;
    clearTimeout(hereTimer);
    applyStatus();
  }
  function sendWidgets() {
    if (!open.status) return;
    let st;
    try {
      st = stateOf();
    } catch (e) {
      // Never an empty window: what went wrong, in it.
      console.error(e);
      st = { kind: "status", error: String(e?.message || e).slice(0, 200), count: count(), goal: L.GOAL };
    }
    a2.widgets.send("status", st).catch(() => {});
  }
  let widgetsSoon = 0;
  function sendWidgetsSoon() {
    clearTimeout(widgetsSoon);
    widgetsSoon = setTimeout(sendWidgets, 300);
  }
  a2.on("widget-message", ({ name, data }) => {
    if (!data) return;
    // The pop-up of 0.2 is gone: one window now.
    if (name !== "status") {
      a2.widgets.close(name).catch(() => {});
      return;
    }
    if (data.type === "ready") {
      // A window the meter brought back from before that isn't wanted now.
      if (!statusWanted()) {
        closeWidget();
        return;
      }
      open.status = true;
      sendWidgets();
    } else if (data.type === "close") {
      // Gone until you come back to the shop or the closet.
      dismissed = true;
      if (settings.statusAlways) {
        settings.statusAlways = false;
        saveSettings();
        dirty();
      }
      closeWidget();
    } else if (data.type === "keep") {
      if (here) arrived(hereBy);
    } else if (data.type === "resized" && Number.isFinite(data.width) && Number.isFinite(data.height)) {
      settings.sizes = { ...(settings.sizes || {}), status: { width: Math.round(data.width), height: Math.round(data.height) } };
      saveSettings();
      showSizes();
    }
  });
  // The meter's header button: the window all the time, or not.
  a2.on("overlay", (data) => {
    settings.statusAlways = !!data?.show;
    dismissed = !data?.show;
    saveSettings();
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
    // No picture came at all: say why, so a screenshot tells.
    if (!pictureStats.ok && pictureStats.failed) $(".state").textContent += ` · No pictures (${pictureStats.failed} failed: ${pictureStats.error})`;
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
  $(".popup").addEventListener("change", (e) => { settings.popup = e.target.checked; saveSettings(); applyStatus(); });
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
      if (open.status) a2.widgets.open("status", widgetSize()).catch(() => {});
    });
  }
  $(".statusAlways").addEventListener("change", (e) => { settings.statusAlways = e.target.checked; saveSettings(); applyStatus(); });
  $(".toast").addEventListener("change", (e) => { settings.toast = e.target.checked; saveSettings(); });
  $(".showPopup").addEventListener("click", () => { dismissed = false; arrived(hereBy || "shop"); });
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
    // The pop-up of 0.2 (a second window) is gone.
    a2.widgets.close("shop").catch(() => {});
    applyStatus();
    a2.ready?.();
  })();
})();
