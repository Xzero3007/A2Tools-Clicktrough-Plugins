// The Closet plugin's widgets, fed by plugin.js and drawn by their state's
// kind: "shop", the pop-up at the Black Cloud shop (the playing character's
// skin offers of this hour, new ones first), and "status", the slim floater
// (count, next change, characters looked or not, what to combine and
// extract). Dragged by the head, sized at the edges (the plugin keeps the size).
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

  function adviceRows(st, all) {
    const list = Array.isArray(st?.advice) ? st.advice : [];
    const rows = list.filter((a) => all || a.tone !== "bad" || a.kind === "extract").map((a) => {
      if (a.kind === "plan") {
        // Combine now (in order), or what to collect first.
        const li = el("li", `plan ${a.tone}`);
        li.title = a.why || "";
        if (a.now.length) {
          li.append(el("span", "tag good", "Combine now"));
          a.now.forEach((n, i) => {
            if (i) li.append(el("span", "num", "→"));
            li.append(el("b", `g${n.grade}`, `${n.name} ${n.times}×`));
          });
        } else li.append(el("span", "tag mid", "Nothing to combine: keep collecting"));
        for (const c of a.collect) li.append(el("span", "num", `· ${c.name}: collect ${c.more} more`));
        return li;
      }
      if (a.settings) {
        // The game's Auto Extract grades, ticked as they pay.
        const li = el("li", "xset");
        li.title = "The game's Extract Settings, Auto Extract: tick these grades. 1 in N: how many pieces it takes for one skin you lack. Hover a grade for why.";
        li.append(el("span", "tag good", `Auto Extract ${a.settings.on ? "ON" : "OFF"}`));
        for (const g of a.settings.grades) {
          const c = el("span", `box ${g.tick ? "on" : "off"}`);
          c.title = g.why;
          c.append(el("i", null, g.tick ? "✓" : ""), el("b", `g${g.grade}`, g.name), el("span", "num", g.hand ? "by hand" : g.every ? `1 in ${g.every}` : "–"));
          li.append(c);
        }
        return li;
      }
      // The grade in its colour, the verdict as a tag, then the numbers.
      const li = el("li", a.tone);
      li.title = a.why || "";
      li.append(el("b", `g${a.grade || 0}`, a.name || ""), el("span", `tag ${a.tone}`, a.tag || ""), el("span", "num", a.text));
      return li;
    });
    if (Number.isFinite(st?.bagNew) && st.bagNew > 0) {
      rows.push(el("li", "good bag", `Extract from your bag: ${st.bagBest.join(", ")}${st.bagNew > st.bagBest.length ? ` and ${st.bagNew - st.bagBest.length} more` : ""}`));
    }
    return rows;
  }

  function offerRow(o) {
      const li = el("li", o.status || "");
      const icon = el("span", "icon");
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

  function drawShop(st) {
    $(".title").textContent = st?.who ? `Black Cloud · ${st.who}` : "Black Cloud";
    const offers = Array.isArray(st?.offers) ? st.offers : [];
    const fresh = offers.filter((o) => o.status === "new").length;
    const known = st?.count != null;
    $(".info").textContent = !known ? "Closet not known yet: log in once with the meter running (until then every skin shows ?)"
      : !offers.length ? "Open a tab of the shop: its skins show here."
      : `${fresh ? `${fresh} new for you` : "Nothing new for you"}${st.refresh ? ` · changes at ${clock(st.refresh)}` : ""}`;
    $(".info").classList.toggle("good", fresh > 0);
    $(".chars").replaceChildren();
    $(".rows").replaceChildren(...offers.map(offerRow));
    $(".advice").replaceChildren(...adviceRows(st, false));
    const un = Array.isArray(st?.unchecked) ? st.unchecked : [];
    $(".foot").textContent = un.length ? `Not looked this hour: ${un.join(", ")}` : "";
    $(".foot").hidden = !un.length;
  }

  function drawStatus(st) {
    $(".title").textContent = "Closet";
    $(".info").textContent = st?.next ? `Merchant changes in ${left(st.next)}` : "";
    $(".info").classList.remove("good");
    const chars = Array.isArray(st?.chars) ? st.chars : [];
    $(".chars").replaceChildren(...chars.map((c) => {
      const li = el("li", c.looked ? (c.fresh ? "fresh" : "done") : "todo");
      const what = c.looked ? (c.fresh ? `${c.fresh} new` : "nothing new") : "not looked";
      li.append(el("span", "mark", c.looked ? "✓" : "○"), el("span", "who", c.name), el("span", "what", c.playing ? `playing · ${what}` : what));
      return li;
    }));
    if (!chars.length) $(".chars").append(el("li", "todo", "Open the Black Cloud shop: your characters show here."));
    // At the shop: the offers of this hour, new first.
    const offers = Array.isArray(st?.offers) ? st.offers : [];
    $(".rows").replaceChildren(...offers.map(offerRow));
    if (offers.length) {
      const fresh = offers.filter((o) => o.status === "new").length;
      $(".info").textContent = `${fresh ? `${fresh} new for you` : "Nothing new for you"} · merchant changes in ${left(st.next)}`;
      $(".info").classList.toggle("good", fresh > 0);
    }
    $(".advice").replaceChildren(...adviceRows(st, true));
    $(".foot").hidden = true;
  }

  function draw(st) {
    last = st;
    $(".goal").textContent = st?.count != null ? `${st.count} / ${st.goal}` : "";
    document.body.dataset.kind = st?.kind || "shop";
    if (st?.kind === "status") drawStatus(st);
    else drawShop(st);
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
