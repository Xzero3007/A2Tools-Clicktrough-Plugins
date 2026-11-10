// The Closet plugin's pop-up at the Black Cloud shop: the playing character's
// skin offers of this hour, new ones first, the count against 700 and who
// has not looked yet. Fed by plugin.js; dragged by its head.
(() => {
  const $ = (s) => document.querySelector(s);
  let locked = false;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const kinah = (n) => Math.round(n).toLocaleString("en-US");
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  function draw(st) {
    $(".title").textContent = st?.who ? `Black Cloud · ${st.who}` : "Black Cloud";
    $(".goal").textContent = st?.count != null ? `${st.count} / ${st.goal}` : "";
    const offers = Array.isArray(st?.offers) ? st.offers : [];
    const fresh = offers.filter((o) => o.status === "new").length;
    $(".info").textContent = !offers.length ? "Open a tab of the shop: its skins show here."
      : `${fresh ? `${fresh} new for you` : "Nothing new for you"}${st.refresh ? ` · changes at ${clock(st.refresh)}` : ""}`;
    $(".info").classList.toggle("good", fresh > 0);
    $(".rows").replaceChildren(...offers.map((o) => {
      const li = el("li", o.status || "");
      const icon = el("span", "icon");
      if (o.picture) {
        const img = el("img");
        img.src = o.picture;
        img.alt = "";
        icon.append(img);
      }
      const text = el("div", "text");
      text.append(el("div", "name", o.name), el("div", "sub", `${o.slot} · ${o.tab}`));
      const price = el("div", "price");
      price.append(el("b", null, kinah(o.price)), el("small", null, o.discount ? `−${o.discount}%` : ""));
      li.append(icon, text, price, el("span", `chip ${o.status}`, o.status === "new" ? "New" : o.status === "owned" ? "Owned" : "?"));
      return li;
    }));
    const un = Array.isArray(st?.unchecked) ? st.unchecked : [];
    $(".foot").textContent = un.length ? `Not looked this hour: ${un.join(", ")}` : "";
    $(".foot").hidden = !un.length;
  }

  const claim = () => a2.widget.area({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }).catch(() => {});
  new ResizeObserver(claim).observe(document.body);
  $(".head").addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button") || locked) return;
    e.preventDefault();
    a2.widget.drag().catch(() => {});
  });
  $(".close").addEventListener("click", () => a2.widget.post({ type: "close" }).catch(() => {}));
  document.addEventListener("mouseenter", () => a2.widget.post({ type: "keep" }).catch(() => {}));
  a2.on("widget", (data) => draw(data));
  a2.on("locked", (on) => {
    locked = !!on;
    document.body.classList.toggle("locked", locked);
  });
  claim();
  a2.ready().then(() => a2.widget.post({ type: "ready" }).catch(() => {}));
})();
