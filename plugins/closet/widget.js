// The Closet window, fed by plugin.js: the Black Cloud merchant's skins you
// opened last (new ones first, with pictures), the characters not looked at
// this hour, and what to combine. Dragged by the head, sized at the edges
// while the meter is unlocked (the plugin keeps the size).
(() => {
  const $ = (s) => document.querySelector(s);
  let locked = false;
  let last = null;
  // The skins' pictures, sent by the plugin in messages of their own: a kept
  // small copy whole, a picture from the icon server in parts.
  const pictures = new Map();
  const parts = new Map(); // icon -> { n, got: [], count }
  const pictureOf = (o) => o.picture || (o.icon && pictures.get(o.icon)) || null;
  // A small copy (144 px, on the window's colour) for the plugin to keep.
  function keepSmall(icon, src) {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 144;
        const g = c.getContext("2d");
        g.fillStyle = "#212328";
        g.fillRect(0, 0, 144, 144);
        const k = Math.max(144 / img.naturalWidth, 144 / img.naturalHeight);
        const w = img.naturalWidth * k, h = img.naturalHeight * k;
        g.drawImage(img, (144 - w) / 2, (144 - h) / 2, w, h);
        const data = c.toDataURL("image/jpeg", 0.88);
        if (data.startsWith("data:image/jpeg") && data.length <= 30000) a2.widget.post({ type: "thumb", icon, data }).catch(() => {});
      } catch (e) {
        console.error(e);
      }
    };
    img.src = src;
  }
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const kinah = (n) => Math.round(n).toLocaleString("en-US");
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const left = (t) => {
    const m = Math.max(0, Math.round((t - Date.now()) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };

  function offerRow(o) {
      const li = el("li", o.status || "");
      const src = pictureOf(o);
      const icon = el("span", `icon g${o.grade || 0}`, src ? null : (o.name || "·")[0]);
      if (src) {
        const img = el("img");
        img.src = src;
        img.alt = "";
        icon.append(img);
      }
      const text = el("div", "text");
      text.append(el("div", "name", o.name), el("div", "sub", `${o.slot} · ${o.tab}${o.soldOut ? " · bought" : ""}`));
      const price = el("div", "price");
      price.append(el("b", null, kinah(o.price)), el("small", null, o.discount ? `−${o.discount}%` : ""));
      li.append(icon, text, price, el("span", `chip ${o.status}`, o.status === "new" ? "New" : o.status === "owned" ? "Owned" : "?"));
      return li;
  }

  // A skin you lack listed on the Exchange: "Buy" when below the merchant's price.
  function exRow(o) {
    const li = el("li", "new ex");
    const src = pictureOf(o);
    const icon = el("span", `icon g${o.grade || 0}`, src ? null : (o.name || "·")[0]);
    if (src) {
      const img = el("img");
      img.src = src;
      img.alt = "";
      icon.append(img);
    }
    const text = el("div", "text");
    text.append(el("div", "name", o.name), el("div", "sub", `${o.slot} · Exchange${o.listings ? ` · ${o.listings} listed` : ""}`));
    const price = el("div", "price");
    price.append(el("b", null, kinah(o.price)), el("small", null, o.good ? "below merchant" : ""));
    li.append(icon, text, price, el("span", `chip${o.good ? " new" : ""}`, o.good ? "Buy" : "New"));
    li.title = o.good ? "Cheaper on the Exchange than the merchant asks" : "";
    return li;
  }

  // The Exchange tab: every skin you lack that is listed there, cheapest first.
  function drawExchange(st) {
    const ex = st?.exchange || { total: 0, rows: [] };
    const rows = Array.isArray(ex.rows) ? ex.rows : [];
    const info = $(".info");
    const good = rows.filter((o) => o.good).length;
    if (st?.error) info.textContent = `Something went wrong: ${st.error}`;
    else if (!rows.length) info.textContent = ex.note || "None of the skins you lack is on the Exchange now.";
    else info.textContent = `${ex.total} you lack on the Exchange${ex.total > rows.length ? `, the ${rows.length} cheapest` : ""}${good ? ` · ${good} below the merchant` : ""} · ${ex.from === "game" ? "from the game" : `price list ${clock(ex.at)}`}`;
    info.classList.toggle("good", good > 0);
    $(".chars").replaceChildren();
    $(".rows").replaceChildren(...rows.map(exRow));
    $(".advice").replaceChildren();
    $(".foot").hidden = true;
  }

  // Top: the merchant's skins you just opened (new first). Below, two short
  // lines: characters not looked at this hour, and what to combine.
  function drawStatus(st) {
    $(".title").textContent = "Closet";
    const view = st?.view === "exchange" ? "exchange" : "shop";
    for (const b of document.querySelectorAll(".views button")) b.classList.toggle("on", b.dataset.view === view);
    if (view === "exchange") return drawExchange(st);
    const offers = Array.isArray(st?.offers) ? st.offers : [];
    const fresh = offers.filter((o) => o.status === "new").length;
    const info = $(".info");
    if (st?.error) info.textContent = `Something went wrong: ${st.error}`;
    else if (st?.count == null) info.textContent = "Log in with the meter running: the game sends your closet then.";
    else if (offers.length) info.textContent = `${st.owner ? `${st.owner}: ` : ""}${fresh ? `${fresh} new for you` : "nothing new for you"} · changes in ${left(st.refresh || st.next)}`;
    else if (st?.here) info.textContent = "Open the shop's tabs (Special, Skins): their skins show here.";
    else info.textContent = `Merchant changes in ${left(st?.next || Date.now())}`;
    info.classList.toggle("good", fresh > 0);
    $(".chars").replaceChildren();
    const rows = offers.map(offerRow);
    const ex = st?.exchange;
    if (ex?.rows?.length) {
      rows.push(el("li", "section", `On the Exchange: ${ex.total} you lack${ex.total > ex.rows.length ? `, the ${ex.rows.length} cheapest` : ""} · ${ex.from === "game" ? "from the game" : `price list ${clock(ex.at)}`}`));
      rows.push(...ex.rows.map(exRow));
    }
    $(".rows").replaceChildren(...rows);
    const lines = [];
    const not = Array.isArray(st?.notLooked) ? st.notLooked : [];
    if (not.length) lines.push(el("li", "todo", `Not looked this hour: ${not.join(", ")}`));
    const elsewhere = Array.isArray(st?.freshElsewhere) ? st.freshElsewhere : [];
    if (elsewhere.length) lines.push(el("li", "good", `New skins on offer: ${elsewhere.join(", ")}`));
    if (st?.todo) lines.push(el("li", "", st.todo));
    $(".advice").replaceChildren(...lines);
    $(".foot").hidden = true;
  }

  function draw(st) {
    last = st;
    $(".goal").textContent = st?.count != null ? `${st.count} / ${st.goal}` : "";
    document.body.dataset.kind = st?.kind || "shop";
    drawStatus(st);
  }
  // The countdown moves on between the plugin's updates.
  setInterval(() => { if (last?.kind === "status") drawStatus(last); }, 20 * 1000);

  const claim = () => a2.widget.area({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }).catch(() => {});
  new ResizeObserver(claim).observe(document.body);
  $(".head").addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button") || locked) return;
    e.preventDefault();
    a2.widget.drag().catch(() => {});
  });
  $(".close").addEventListener("click", () => a2.widget.post({ type: "close" }).catch(() => {}));
  document.addEventListener("mouseenter", () => a2.widget.post({ type: "keep" }).catch(() => {}));
  const canResize = typeof a2.widget.resize === "function";
  document.body.classList.toggle("noResize", !canResize);
  for (const c of document.querySelectorAll(".edge")) {
    c.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || locked || !canResize) return;
      e.preventDefault();
      e.stopPropagation();
      a2.widget.resize(c.dataset.edge).catch(() => {});
    });
  }
  a2.on("resized", (size) => {
    if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) {
      a2.widget.post({ type: "resized", width: size.width, height: size.height }).catch(() => {});
    }
  });
  let redraw = 0;
  a2.on("widget", (data) => {
    if (data?.kind === "picture") {
      const icon = data.icon;
      if (typeof icon !== "string") return;
      if (typeof data.picture === "string") pictures.set(icon, data.picture);
      else if (typeof data.data === "string" && Number.isInteger(data.part) && Number.isInteger(data.parts) && data.part >= 0 && data.part < data.parts) {
        let p = parts.get(icon);
        if (!p || p.n !== data.parts) parts.set(icon, (p = { n: data.parts, got: [], count: 0 }));
        if (p.got[data.part] == null) p.count++;
        p.got[data.part] = data.data;
        if (p.count < p.n) return;
        parts.delete(icon);
        const full = p.got.join("");
        if (!full.startsWith("data:image/")) return;
        pictures.set(icon, full);
        keepSmall(icon, full);
      } else return;
      // Several come at once: draw once for them.
      clearTimeout(redraw);
      redraw = setTimeout(() => { if (last?.kind === "status") drawStatus(last); }, 60);
      return;
    }
    draw(data);
  });
  for (const b of document.querySelectorAll(".views button")) {
    b.addEventListener("click", () => {
      if (last) draw({ ...last, view: b.dataset.view });
      a2.widget.post({ type: "view", view: b.dataset.view }).catch(() => {});
    });
  }
  a2.on("locked", (on) => {
    locked = !!on;
    document.body.classList.toggle("locked", locked);
  });
  claim();
  // Never an empty window: until the plugin answers, say so, and ask again.
  $(".info").textContent = "Waiting for the Closet plugin…";
  const hello = () => a2.widget.post({ type: "ready" }).catch(() => {});
  a2.ready().then(hello);
  let asks = 0;
  const ask = setInterval(() => {
    if (last || ++asks > 6) return clearInterval(ask);
    hello();
  }, 3000);
})();
