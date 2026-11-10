// The Closet plugin's page: the closet from the login, the Black Cloud
// Merchant's offers of every character, the skins you lack and the combine
// sums; the pop-up at the shop (widget.html) and the count for the Inventory
// floater (a2.share).
(() => {
  const L = globalThis.ClosetLogic;
  const ix = L.index(globalThis.CLOSET_DATA);
  const $ = (s) => document.querySelector(s);
  const ICONS = "https://assets.playnccdn.com/static-aion2-gamedata/resources/";

  const settings = { tab: "merchant", popup: true, toast: true, popupMinutes: 3, kind: "all", grade: "all", order: "price", lucky: false };
  let closet = null; // Set of closet ids
  let closetAt = 0;
  let chars = {}; // key -> { name, serverId, stocks: { tab: stock } }
  let seen = []; // [{ at, char, tab, refresh, skins, fresh, paid }]
  let learned = {}; // item -> closet id, from purchases
  let character = null;
  const recent = []; // recent item changes [{ at, item }]

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
  const saveChars = () => saveLater("chars", chars);
  const saveSeen = () => saveLater("seen", seen.slice(-1500), 1500);
  const saveLearned = () => saveLater("learned", learned);

  const charKey = (c) => `${c?.serverId ?? "?"}:${c?.name ?? "?"}`;
  const count = () => (closet ? closet.size : null);

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
    dirty();
  });

  a2.on("decoded:closet-add", (data, meta) => {
    const ids = L.addedFrom(data);
    if (!ids || !closet) return;
    const at = meta?.at || Date.now();
    for (const id of ids) {
      if (closet.has(id)) continue;
      closet.add(id);
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
    sendPopup();
    dirty();
  });

  a2.on("items", (it) => {
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
    else sendPopup();
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
        if (data) sendPopupSoon();
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

  // ---------- the pop-up at the shop ----------
  let popupOpen = false;
  let popupTimer = 0;
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
    return { who: character?.name || "", count: count(), goal: L.GOAL, offers, refresh, tabs: stocks.map((s) => s.tabName), unchecked: unchecked(now) };
  }
  function unchecked(now) {
    const out = [];
    for (const [key, c] of Object.entries(chars)) {
      if (character && key === charKey(character)) continue;
      if (character && c.serverId !== character.serverId) continue;
      if (!Object.values(c.stocks).some((s) => s.refresh > now)) out.push(c.name);
    }
    return out.sort();
  }
  async function openPopup() {
    clearTimeout(popupTimer);
    popupTimer = setTimeout(closePopup, Math.max(1, settings.popupMinutes) * 60 * 1000);
    try {
      const st = popupState();
      await a2.widgets.open("shop", { width: 340, height: Math.min(560, 96 + Math.max(1, st.offers.length) * 34) });
      await a2.widgets.lock(false);
      popupOpen = true;
      a2.widgets.send("shop", st).catch(() => {});
    } catch (e) {
      console.error(e);
    }
  }
  function closePopup() {
    clearTimeout(popupTimer);
    popupOpen = false;
    a2.widgets.close("shop").catch(() => {});
  }
  function sendPopup() {
    if (popupOpen) a2.widgets.send("shop", popupState()).catch(() => {});
  }
  let popupSoon = 0;
  function sendPopupSoon() {
    clearTimeout(popupSoon);
    popupSoon = setTimeout(sendPopup, 300);
  }
  a2.on("widget-message", ({ name, data }) => {
    if (name !== "shop" || !data) return;
    if (data.type === "ready") sendPopup();
    else if (data.type === "close") closePopup();
    else if (data.type === "keep") {
      clearTimeout(popupTimer);
      popupTimer = setTimeout(closePopup, Math.max(1, settings.popupMinutes) * 60 * 1000);
    }
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

  function renderCombine() {
    $(".lucky").checked = !!settings.lucky;
    const r = L.combine(closet, ix, { lucky: settings.lucky });
    $(".combine tbody").replaceChildren(...r.rows.map((x) => {
      const tr = el("tr");
      tr.append(el("td", `g${x.grade}`, x.name), el("td", `g${x.grade + 1}`, `${x.next} (${Math.round(x.up * 100)}%)`),
        el("td", null, closet ? `${x.lackNext} of ${x.totalNext}` : "–"),
        el("td", null, closet ? pct(x.chance) : "–"),
        el("td", null, closet && x.combines ? `≈ ${Math.round(x.combines * 10) / 10}` : "–"),
        el("td", null, closet && x.kinah ? `≈ ${kinah(x.kinah)}` : "–"));
      return tr;
    }));
  }

  // ---------- controls ----------
  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => {
      settings.tab = b.dataset.tab;
      saveSettings();
      render();
    });
  }
  $(".popup").addEventListener("change", (e) => { settings.popup = e.target.checked; saveSettings(); if (!settings.popup) closePopup(); });
  $(".toast").addEventListener("change", (e) => { settings.toast = e.target.checked; saveSettings(); });
  $(".showPopup").addEventListener("click", () => openPopup());
  $(".search").addEventListener("input", () => renderMissing());
  for (const k of ["kind", "grade", "order"]) $(`.${k}`).addEventListener("change", (e) => { settings[k] = e.target.value; saveSettings(); renderMissing(); });
  $(".lucky").addEventListener("change", (e) => { settings.lucky = e.target.checked; saveSettings(); renderCombine(); });
  // The hour changes: stocks run out.
  setInterval(() => { if (settings.tab === "merchant") dirty(); }, 30 * 1000);

  // ---------- start ----------
  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") Object.assign(settings, s);
      const c = await a2.storage.get("closet");
      if (c && Array.isArray(c.ids) && c.ids.length && !closet) {
        closet = new Set(c.ids);
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
    a2.ready?.();
  })();
})();
