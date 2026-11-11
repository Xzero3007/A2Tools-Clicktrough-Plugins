// The Closet window, fed by plugin.js: the Black Cloud merchant's skins you
// opened last (new ones first, with pictures), the characters not looked at
// this hour, and what to combine. Dragged by the head, sized at the edges
// while the meter is unlocked (the plugin keeps the size).
(() => {
  const $ = (s) => document.querySelector(s);
  let locked = false;
  let last = null;
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
      const icon = el("span", `icon g${o.grade || 0}`, o.picture ? null : (o.name || "·")[0]);
      if (o.picture) {
        const img = el("img");
        img.src = o.picture;
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

  // Top: the merchant's skins you just opened (new first). Below, two short
  // lines: characters not looked at this hour, and what to combine.
  function drawStatus(st) {
    $(".title").textContent = "Closet";
    const offers = Array.isArray(st?.offers) ? st.offers : [];
    const fresh = offers.filter((o) => o.status === "new").length;
    const info = $(".info");
    if (st?.count == null) info.textContent = "Log in with the meter running: the game sends your closet then.";
    else if (offers.length) info.textContent = `${st.owner ? `${st.owner}: ` : ""}${fresh ? `${fresh} new for you` : "nothing new for you"} · changes in ${left(st.refresh || st.next)}`;
    else if (st?.here) info.textContent = "Open the shop's tabs (Special, Skins): their skins show here.";
    else info.textContent = `Merchant changes in ${left(st?.next || Date.now())}`;
    info.classList.toggle("good", fresh > 0);
    $(".chars").replaceChildren();
    $(".rows").replaceChildren(...offers.map(offerRow));
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
  a2.on("widget", (data) => draw(data));
  a2.on("locked", (on) => {
    locked = !!on;
    document.body.classList.toggle("locked", locked);
  });
  claim();
  a2.ready().then(() => a2.widget.post({ type: "ready" }).catch(() => {}));
})();
