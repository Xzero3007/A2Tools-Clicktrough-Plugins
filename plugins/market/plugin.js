// The Market plugin's window: what the gathered materials bring on your
// server's market, what they cost made from Odyle (Substance Morph), what
// each recipe costs and brings, and where each material goes. Prices come
// from aion2.exchange: first from the Clicktrough fork's hourly copy of
// them on GitHub (fast; .github/workflows/market-prices.yml), else from its
// public API itself (slow, often briefly down); both through the meter
// (a2.web.get).
(() => {
  const D = globalThis.MARKET_DATA;
  const C = globalThis.MarketCalc;
  const $ = (s) => document.querySelector(s);
  const API = "https://aion2.exchange/api";
  const COPY = "https://raw.githubusercontent.com/Xzero3007/A2Tools-DPS-Meter_Clicktrough/market-data";
  const STALE_MS = 20 * 60_000; // prices older than this are fetched again on opening
  const AUTO_MS = 30 * 60_000; // and while the window stays open
  const COPY_OLD_MS = 3 * 3600_000; // a copy older than this: aion2.exchange itself first

  let settings = {
    server: null, // aion2.exchange's server id
    tab: "gather",
    fee: 10, // % the market keeps of a sale
    npc: {}, // the player's own NPC prices: id -> Kina
    prof: "all",
    sort: "profit",
    priced: true,
    kind: "all",
    search: {},
    faction: null, // "Asmodian" or "Elyos": whose items; the server's until picked
    fav: [], // favourite item ids (a star in every tab)
    favFirst: false, // favourites listed first
  };
  let servers = []; // [{ id, game, name, region, faction, hasData }] (calc.js readServers)
  let prices = new Map();
  let fetchedAt = 0;
  let snapshot = null;
  let source = null; // "copy" or "aion2.exchange"
  let character = null;
  let busy = false;
  let error = "";
  const open = new Set(); // rows shown open: "r:<recipe>", "m:<material>"
  let shown = { recipes: 80, materials: 80 };

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) if (k != null) n.append(k);
    return n;
  };
  const kina = C.kina;
  const fold = (t) => String(t).toLowerCase();
  const saveLater = (() => {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => a2.storage.set("settings", settings).catch(() => {}), 400);
    };
  })();

  // ---------- the server and its prices ----------
  const server = () => servers.find((s) => s.id === settings.server) || null;
  const faction = () => settings.faction || server()?.faction || null;
  const npc = () => ({ ...D.npcPrices, ...settings.npc });

  async function loadServers() {
    // The copy's list (null while there is none yet), else aion2.exchange's.
    let list = [];
    let failure = null;
    for (const url of [`${COPY}/servers.json`, `${API}/servers`]) {
      try {
        list = C.readServers(await a2.web.get(url));
        if (list.length) break;
      } catch (e) {
        failure = e;
      }
    }
    if (list.length) {
      servers = list;
      error = "";
      a2.storage.set("servers", { at: Date.now(), servers }).catch(() => {});
    } else if (!servers.length) {
      error = `aion2.exchange: ${failure ? failure.message || failure : "no servers in its answer"}`;
    }
    pickServer();
    renderBar();
  }

  /** Every item row of a server from aion2.exchange itself, page by page. */
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

  /** The player's server, once: aion2.exchange numbers it 10000 more than
   *  the game does (12305 = Marchutan, the game's 2305). */
  function pickServer() {
    if (settings.server != null && servers.some((s) => s.id === settings.server)) return;
    const mine = C.serverOf(servers, character?.serverId);
    if (mine) {
      settings.server = mine.id;
      saveLater();
    }
  }

  async function loadPrices(force = false) {
    const s = server();
    if (!s || busy) return;
    if (!force && fetchedAt && Date.now() - fetchedAt < STALE_MS && prices.size) return;
    busy = true;
    error = "";
    renderBar();
    try {
      // The copy first; aion2.exchange itself when the copy lacks the server
      // or is old, and the old copy still when aion2.exchange fails.
      let copy = null;
      try {
        copy = C.readCopy(await a2.web.get(`${COPY}/prices/${s.id}.json`));
      } catch {}
      const copyOld = !copy || Date.now() - (Date.parse(copy.copied) || 0) > COPY_OLD_MS;
      let got = null;
      let failure = null;
      if (copyOld) {
        try {
          const rows = await directRows(s.id);
          if (rows.length) {
            got = { prices: C.readPrices(rows), snapshot: rows.map((r) => r.captured_at).filter(Boolean).sort().pop() || null, source: "aion2.exchange" };
          }
        } catch (e) {
          failure = e;
        }
      }
      if (!got && copy) got = { prices: copy.prices, snapshot: copy.snapshot, source: "copy" };
      if (!got) throw failure || new Error("no prices for this server yet");
      prices = got.prices;
      snapshot = got.snapshot;
      source = got.source;
      fetchedAt = Date.now();
      if (failure) error = `aion2.exchange: ${failure.message || failure} · showing the copy of ${when(snapshot)}`;
      const keep = [...prices].map(([id, p]) => [id, p.price, p.listings, p.sold, p.soldAvg, p.change]);
      a2.storage.set("prices", { server: s.id, at: fetchedAt, snapshot, source, rows: keep }).catch(() => {});
    } catch (e) {
      error = `aion2.exchange: ${e?.message || e}${prices.size ? " · showing the prices from before" : ""}`;
    } finally {
      busy = false;
    }
    render();
  }

  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "earlier");

  function restoreCache(c) {
    try {
      if (c?.server !== settings.server || !Array.isArray(c.rows)) return;
      prices = new Map(c.rows.map(([id, price, listings, sold, soldAvg, change]) => [String(id), { price, listings, sold, soldAvg, change }]));
      fetchedAt = c.at || 0;
      snapshot = c.snapshot || null;
      source = c.source || null;
    } catch {}
  }

  // ---------- the top bar ----------
  function renderBar() {
    const pick = $(".server");
    const regions = new Map();
    for (const s of servers) {
      if (!s.hasData) continue;
      const r = s.region || "Other";
      if (!regions.has(r)) regions.set(r, []);
      regions.get(r).push(s);
    }
    pick.replaceChildren(el("option", { value: "", textContent: servers.length ? "Pick your server" : "Servers …" }));
    for (const [region, list] of [...regions].sort((a, b) => a[0].localeCompare(b[0]))) {
      const g = el("optgroup", { label: region });
      for (const s of list.sort((a, b) => String(a.faction).localeCompare(String(b.faction)) || a.name.localeCompare(b.name))) {
        g.append(el("option", { value: String(s.id), textContent: `${s.name} · ${s.faction || ""}` }));
      }
      pick.append(g);
    }
    pick.value = settings.server != null ? String(settings.server) : "";
    const st = $(".status");
    st.classList.toggle("error", !!error);
    if (error) st.textContent = error;
    else if (busy) st.textContent = "Getting prices …";
    else if (!server()) st.textContent = "Pick your server for its prices.";
    else if (!fetchedAt) st.textContent = "No prices yet.";
    else {
      const listed = [...prices.values()].filter((p) => p.price != null).length;
      const from = source === "copy" ? " · Clicktrough's copy" : source ? ` · ${source}` : "";
      st.textContent = `Prices of ${when(snapshot || new Date(fetchedAt).toISOString())} · ${listed} items listed${from}`;
      st.title = source === "copy" ? "aion2.exchange's prices, copied every hour onto GitHub by the Clicktrough fork (fast); aion2.exchange itself only when the copy is older than 3 hours" : "";
    }
  }

  // ---------- the tabs ----------
  function render() {
    renderBar();
    for (const b of document.querySelectorAll(".faction button")) b.setAttribute("aria-pressed", String(b.dataset.faction === faction()));
    $(".favFirst").setAttribute("aria-pressed", String(!!settings.favFirst));
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.tab === settings.tab));
    for (const p of document.querySelectorAll(".pane")) p.hidden = p.dataset.pane !== settings.tab;
    for (const s of document.querySelectorAll(".search")) if (document.activeElement !== s) s.value = settings.search[s.dataset.for] || "";
    if (settings.tab === "gather") renderGather();
    else if (settings.tab === "odyle") renderOdyle();
    else if (settings.tab === "recipes") renderRecipes();
    else renderMaterials();
  }

  const priceCell = (v) => el("td", { className: v == null ? "none" : "" }, kina(v));
  const changeCell = (v) => el("td", { className: v == null ? "none" : v > 0 ? "gain" : v < 0 ? "loss" : "" },
    v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v)}%`);

  // ---------- favourites, map links, the lists that open ----------
  const isFav = (id) => settings.fav.includes(Number(id));
  /** Favourites first while the button in the bar is on; else as they are. */
  const favFirst = (list, idOf) => {
    if (!settings.favFirst) return list;
    const fav = list.filter((x) => isFav(idOf(x)));
    return fav.length ? [...fav, ...list.filter((x) => !isFav(idOf(x)))] : list;
  };
  const SVG = "http://www.w3.org/2000/svg";
  const icon = (d, cls) => {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (cls) svg.setAttribute("class", cls);
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
    return svg;
  };
  const STAR = "M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6-4.5-4.2 6.1-.7z";
  const MAP = "M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Zm0 0v13.5m6-11v13.5";

  /** A star: the item a favourite, in every tab. */
  function star(id) {
    const on = isFav(id);
    const b = el("button", { type: "button", className: `star${on ? " on" : ""}`, title: on ? "A favourite: click to take it out" : "Make it a favourite" });
    b.setAttribute("aria-pressed", String(on));
    b.append(icon(STAR));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const n = Number(id);
      settings.fav = isFav(n) ? settings.fav.filter((x) => x !== n) : [...settings.fav, n];
      saveLater();
      render();
    });
    return b;
  }

  /** The Map plugin shows where a gathered material grows (a2.share). */
  function showOnMap(id) {
    a2.share({ source: "Market", focus: { gather: C.name(id), item: Number(id), at: Date.now() } }).catch(() => {});
  }
  function mapButton(id) {
    if (!C.kindOf(id) || typeof a2.share !== "function") return null;
    const b = el("button", { type: "button", className: "mapBtn", title: `Where ${C.name(id)} is gathered: on the Map` });
    b.append(icon(MAP));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      showOnMap(id);
    });
    return b;
  }

  /** The first cell of an item's row: star, name, what follows, map link. */
  const nameCell = (id, ...after) => el("td", { className: "name" }, star(id), el("span", { className: "label" }, C.name(id)), ...after, mapButton(id));

  /** A row that opens what it holds under it ("<kind>:<id>" in `open`). */
  function opener(row, key, again) {
    row.classList.add("click");
    row.classList.toggle("open", open.has(key));
    row.addEventListener("click", () => {
      if (open.has(key)) open.delete(key);
      else open.add(key);
      again();
    });
    return row;
  }

  /** The recipes of the faction that need `id`: product, count, what that
   *  many cost, what the product sells for. */
  function usesTable(id) {
    const n = npc();
    const fee = Math.max(0, Math.min(50, Number(settings.fee) || 0)) / 100;
    const us = C.usesOf(faction()).get(String(id)) || [];
    if (!us.length) return el("p", { className: "sub" }, `No ${faction() || ""} recipe needs ${C.name(id)}.`);
    const best = C.unitCost(prices, n, id);
    const h = el("tr", {}, el("th", {}, "Used in"), el("th", {}, "Count"), el("th", { title: "Count × best price each" }, "Costs"),
      el("th", { title: "The product's lowest listing, less the fee" }, "Product sells for"));
    const rows = us.slice().sort((a, b) => b.count - a.count || C.name(a.recipe[6]).localeCompare(C.name(b.recipe[6]))).map((u) => {
      const s = C.recipeSums(u.recipe, prices, n, { fee });
      return el("tr", {}, el("td", {}, C.name(u.recipe[6]), el("span", { className: "sub" }, ` · ${u.recipe[2]}`)),
        el("td", {}, `× ${u.count}`), priceCell(best.unit == null ? null : best.unit * u.count), priceCell(s.net));
    });
    return el("table", { className: "inner" }, el("thead", {}, h), el("tbody", {}, ...rows));
  }

  /** A table whose header stays at the top while the list scrolls, with
   *  its columns as wide as `widths` (one layout for every group). */
  function table(widths, headCells, body) {
    const cols = el("colgroup", {}, ...widths.map((w) => {
      const c = el("col");
      if (w) c.style.width = w;
      return c;
    }));
    return el("table", { className: "list" }, cols, el("thead", {}, el("tr", {}, ...headCells)), body);
  }
  const groupRow = (title, span) => el("tr", { className: "group" }, el("th", { colSpan: span }, title));

  function renderGather() {
    const q = fold(settings.search.gather || "");
    const fac = faction();
    const groups = [["Odyle", [D.odyle]], ...Object.entries(D.gather)];
    const titles = { Odyle: "Odyle", Ore: "Ore", Gemstone: "Gemstones", Log: "Logs", Herb: "Herbs", Cooking: "Cooking ingredients" };
    const wanted = (id) => C.ofFaction(id, fac) && (!q || fold(C.name(id)).includes(q));
    const sections = [];
    const favs = settings.favFirst ? groups.flatMap(([, lists]) => lists.flat()).filter((id) => wanted(id) && isFav(id)) : [];
    if (favs.length) sections.push(["Favorites", favs]);
    for (const [kind, lists] of groups) {
      const ids = lists.flat().filter((id) => wanted(id) && !favs.includes(id));
      if (ids.length) sections.push([titles[kind] || kind, ids]);
    }
    const all = sections.flatMap(([, ids]) => ids);
    // The sales columns only while aion2.exchange has sales to tell.
    const sales = all.some((id) => prices.get(String(id))?.sold != null || prices.get(String(id))?.soldAvg != null);
    const span = sales ? 6 : 4;
    const head = [el("th", {}, "Material"), el("th", {}, "Lowest"), el("th", {}, "Listed")];
    if (sales) head.push(el("th", { title: "Sold in the last 28 days" }, "Sold 28 d"), el("th", {}, "Avg sold"));
    head.push(el("th", {}, "Change"));
    const body = el("tbody");
    for (const [title, ids] of sections) {
      body.append(groupRow(title, span));
      for (const id of ids) {
        const p = prices.get(String(id)) || {};
        const key = `g:${id}`;
        const cells = [nameCell(id), priceCell(p.price), el("td", {}, p.listings ? kina(p.listings) : "—")];
        if (sales) cells.push(el("td", {}, p.sold != null ? kina(p.sold) : "—"), priceCell(p.soldAvg));
        cells.push(changeCell(p.change));
        body.append(opener(el("tr", {}, ...cells), key, renderGather));
        if (open.has(key)) body.append(el("tr", { className: "detail" }, el("td", { colSpan: span }, usesTable(id))));
      }
    }
    const widths = sales ? ["34%", "14%", "11%", "13%", "14%", "14%"] : ["46%", "20%", "16%", "18%"];
    const box = $(".gatherList");
    if (!all.length) box.replaceChildren(el("p", { className: "empty", textContent: "Nothing matches." }));
    else box.replaceChildren(table(widths, head, body));
  }

  function renderOdyle() {
    const e = C.energyMorphCost(prices);
    $(".energy").replaceChildren(
      el("strong", {}, "Odyle Energy (Bound), +40: "),
      "25 Odyle, 5 Fine Odyle, 1 Pure Odyle and 50,000 Kina",
      e ? ` = ${kina(e.total)} Kina, ${kina(e.perEnergy)} per energy` : " (no Odyle prices yet)",
      el("span", { className: "sub" }, " · at most 4 a week per character, 16 per server"),
    );
    const head = [el("th", {}, "Material"), el("th", {}, "Market"), el("th", {}, "Odyle used"),
      el("th", {}, "Odyle price"), el("th", { title: "What one morphed instead of bought saves" }, "Morph saves")];
    const body = el("tbody");
    for (const r of favFirst(C.morphTable(prices, faction()), (x) => x.item)) {
      const key = `o:${r.item}`;
      const save = r.saving == null ? el("td", { className: "none" }, "—")
        : el("td", { className: r.saving > 0 ? "gain" : "loss" },
          r.saving > 0 ? `${kina(r.saving)} (${Math.round(r.savingPct * 100)}%)` : `buy (${kina(-r.saving)} cheaper)`);
      body.append(opener(el("tr", {}, nameCell(r.item), priceCell(r.market), el("td", { className: "sub" }, C.name(r.odyle)),
        priceCell(r.odylePrice), save), key, renderOdyle));
      if (open.has(key)) body.append(el("tr", { className: "detail" }, el("td", { colSpan: 5 }, usesTable(r.item))));
    }
    $(".odyleList").replaceChildren(table(["34%", "14%", "16%", "14%", "22%"], head, body));
  }

  const PROFS = ["all", "Alchemy", "Blacksmithing", "Jewelcrafting", "Tailoring", "Cooking"];

  function sourceTag(cost) {
    if (cost.source === "morph") return el("span", { className: "tag morph", title: `Morphed from ${C.name(cost.via)}` }, "morph");
    if (cost.source === "npc") return el("span", { className: "tag npc" }, "NPC");
    return null;
  }

  function recipeDetail(sums, recipe) {
    const head = el("tr", {}, el("th", {}, "Material"), el("th", {}, "Count"), el("th", {}, "Market each"),
      el("th", {}, "Best each"), el("th", {}, "Total"));
    const rows = sums.lines.map((l) => el("tr", {},
      nameCell(l.item, sourceTag(l.best)),
      el("td", {}, `× ${l.count}`),
      priceCell(l.buy.source === "npc" ? l.buy.unit : C.market(prices, l.item)),
      priceCell(l.best.unit),
      priceCell(l.bestTotal)));
    const extra = [];
    if (recipe[9]) {
      const [pct, item, n] = recipe[9];
      const p = C.market(prices, item);
      extra.push(`Combo ${pct}%: ${n > 1 ? `${n} × ` : ""}${C.name(item)}${p != null ? ` (${kina(p)} each)` : ""}`);
    }
    if (recipe[4] > 0) extra.push(`Level ${recipe[4]}`);
    extra.push(recipe[5] === "Auto" ? "learnt by level" : recipe[5] === "Advancement" ? "mastery advancement" : recipe[5]);
    return el("div", {}, el("table", { className: "inner" }, el("thead", {}, head), el("tbody", {}, ...rows)), el("div", { className: "sub" }, extra.join(" · ")));
  }

  function renderRecipes() {
    $(".profs").replaceChildren(...PROFS.map((p) => {
      const b = el("button", { type: "button", className: "chip", textContent: p === "all" ? "All" : p });
      b.setAttribute("aria-pressed", String(settings.prof === p));
      b.addEventListener("click", () => {
        settings.prof = p;
        shown.recipes = 80;
        saveLater();
        renderRecipes();
      });
      return b;
    }));
    $(".priced").checked = !!settings.priced;
    $(".sort").value = settings.sort;
    if (document.activeElement !== $(".fee")) $(".fee").value = String(settings.fee);
    const box = $(".recipeList");
    if (!faction()) {
      box.replaceChildren(el("p", { className: "empty", textContent: "Pick your server or faction above: its recipes and its prices." }));
      renderNpc();
      return;
    }
    const q = fold(settings.search.recipes || "");
    const fee = Math.max(0, Math.min(50, Number(settings.fee) || 0)) / 100;
    const n = npc();
    let list = C.recipesOf(faction())
      .filter((r) => settings.prof === "all" || r[2] === settings.prof)
      .filter((r) => !q || fold(C.name(r[6])).includes(q) || r[8].some(([i]) => fold(C.name(i)).includes(q)))
      .map((r) => ({ r, s: C.recipeSums(r, prices, n, { fee }) }));
    if (settings.priced) list = list.filter((x) => x.s.sell != null || isFav(x.r[6]));
    const by = {
      profit: (a, b) => (b.s.profit ?? -Infinity) - (a.s.profit ?? -Infinity),
      margin: (a, b) => (b.s.margin ?? -Infinity) - (a.s.margin ?? -Infinity),
      level: (a, b) => a.r[4] - b.r[4],
      name: (a, b) => C.name(a.r[6]).localeCompare(C.name(b.r[6])),
    }[settings.sort] || (() => 0);
    list.sort((a, b) => by(a, b) || C.name(a.r[6]).localeCompare(C.name(b.r[6])));
    list = favFirst(list, (x) => x.r[6]);
    const head = [el("th", {}, "Product"), el("th", { title: "Lowest listing × how many, less the fee" }, "Sells for"),
      el("th", { title: "Every material bought" }, "Cost: market"), el("th", { title: "Odyle morphed where cheaper" }, "Cost: morph"),
      el("th", { title: "Sells for − cost with morph" }, "Profit")];
    const body = el("tbody");
    for (const { r, s } of list.slice(0, shown.recipes)) {
      const key = `r:${r[0]}`;
      const profit = s.profit == null ? el("td", { className: "none" }, s.complete ? "—" : "prices missing")
        : el("td", { className: s.profit >= 0 ? "gain" : "loss" }, `${s.profit >= 0 ? "+" : ""}${kina(s.profit)}`,
          s.margin != null ? el("span", { className: "sub" }, ` ${Math.round(s.margin * 100)}%`) : null);
      const row = el("tr", {},
        nameCell(r[6], r[7] > 1 ? el("span", { className: "sub" }, ` × ${r[7]}`) : null, el("span", { className: "sub" }, ` · ${r[2]}`)),
        priceCell(s.net), priceCell(s.complete ? s.costBuy : null), priceCell(s.complete ? s.costBest : null), profit);
      body.append(opener(row, key, renderRecipes));
      if (open.has(key)) body.append(el("tr", { className: "detail" }, el("td", { colSpan: 5 }, recipeDetail(s, r))));
    }
    const kids = [table(["34%", "15%", "15%", "15%", "21%"], head, body)];
    if (!list.length) kids.push(el("p", { className: "empty", textContent: prices.size ? "Nothing matches." : "No prices yet." }));
    if (list.length > shown.recipes) {
      const more = el("button", { type: "button", className: "more", textContent: `Show more (${list.length - shown.recipes})` });
      more.addEventListener("click", () => {
        shown.recipes += 80;
        renderRecipes();
      });
      kids.push(more);
    }
    box.replaceChildren(...kids);
    renderNpc();
  }

  function renderNpc() {
    const box = $(".npcList");
    if (box.childElementCount) return;
    const ids = Object.keys(D.npcPrices).sort((a, b) => C.name(a).localeCompare(C.name(b)));
    for (const id of ids) {
      const input = el("input", { type: "number", min: "0", step: "10", value: String(settings.npc[id] ?? D.npcPrices[id]) });
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v > 0 && v !== D.npcPrices[id]) settings.npc[id] = v;
        else delete settings.npc[id];
        saveLater();
        render();
      });
      box.append(el("span", {}, C.name(id)), input);
    }
  }

  const KINDS = [["all", "All"], ["gathered", "Gathered"], ["crafted", "Crafted materials"], ["npc", "NPC tools"], ["gear", "Earlier tiers"]];
  function materialKind(id) {
    if (C.kindOf(id)) return "gathered";
    if (D.npcPrices[String(id)] != null) return "npc";
    const g = Number(String(id).slice(0, 2));
    return g >= 61 && g <= 63 ? "crafted" : "gear";
  }

  function renderMaterials() {
    $(".kinds").replaceChildren(...KINDS.map(([k, label]) => {
      const b = el("button", { type: "button", className: "chip", textContent: label });
      b.setAttribute("aria-pressed", String(settings.kind === k));
      b.addEventListener("click", () => {
        settings.kind = k;
        shown.materials = 80;
        saveLater();
        renderMaterials();
      });
      return b;
    }));
    const box = $(".materialList");
    if (!faction()) {
      box.replaceChildren(el("p", { className: "empty", textContent: "Pick your server or faction above." }));
      return;
    }
    const q = fold(settings.search.materials || "");
    const n = npc();
    const uses = C.usesOf(faction());
    let list = [...uses.entries()]
      .filter(([id]) => settings.kind === "all" || materialKind(id) === settings.kind)
      .filter(([id, us]) => !q || fold(C.name(id)).includes(q) || us.some((u) => fold(C.name(u.recipe[6])).includes(q)))
      .sort((a, b) => b[1].length - a[1].length || C.name(a[0]).localeCompare(C.name(b[0])));
    list = favFirst(list, (x) => x[0]);
    const head = [el("th", {}, "Material"), el("th", {}, "Market"), el("th", {}, "Best"), el("th", {}, "Recipes")];
    const body = el("tbody");
    for (const [id, us] of list.slice(0, shown.materials)) {
      const key = `m:${id}`;
      const best = C.unitCost(prices, n, id);
      body.append(opener(el("tr", {},
        nameCell(id, sourceTag(best)), priceCell(best.source === "npc" ? best.unit : C.market(prices, id)), priceCell(best.unit),
        el("td", {}, String(us.length))), key, renderMaterials));
      if (open.has(key)) body.append(el("tr", { className: "detail" }, el("td", { colSpan: 4 }, usesTable(id))));
    }
    const kids = [table(["52%", "17%", "17%", "14%"], head, body)];
    if (!list.length) kids.push(el("p", { className: "empty", textContent: "Nothing matches." }));
    if (list.length > shown.materials) {
      const more = el("button", { type: "button", className: "more", textContent: `Show more (${list.length - shown.materials})` });
      more.addEventListener("click", () => {
        shown.materials += 80;
        renderMaterials();
      });
      kids.push(more);
    }
    box.replaceChildren(...kids);
  }

  // ---------- the controls ----------
  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => {
      settings.tab = t.dataset.tab;
      saveLater();
      render();
    });
  }
  for (const s of document.querySelectorAll(".search")) {
    s.addEventListener("input", () => {
      settings.search[s.dataset.for] = s.value;
      shown = { recipes: 80, materials: 80 };
      saveLater();
      render();
    });
  }
  $(".server").addEventListener("change", () => {
    settings.server = $(".server").value ? Number($(".server").value) : null;
    prices = new Map();
    fetchedAt = 0;
    open.clear();
    saveLater();
    render();
    loadPrices(true);
  });
  $(".refresh").addEventListener("click", () => {
    if (!servers.length) loadServers().then(() => loadPrices(true));
    else loadPrices(true);
  });
  for (const b of document.querySelectorAll(".faction button")) {
    b.addEventListener("click", () => {
      settings.faction = b.dataset.faction;
      open.clear();
      saveLater();
      render();
    });
  }
  $(".favFirst").addEventListener("click", () => {
    settings.favFirst = !settings.favFirst;
    saveLater();
    render();
  });
  $(".priced").addEventListener("change", () => {
    settings.priced = $(".priced").checked;
    saveLater();
    renderRecipes();
  });
  $(".sort").addEventListener("change", () => {
    settings.sort = $(".sort").value;
    saveLater();
    renderRecipes();
  });
  $(".fee").addEventListener("input", () => {
    const v = Number($(".fee").value);
    if (!Number.isFinite(v)) return;
    settings.fee = Math.max(0, Math.min(50, v));
    saveLater();
    renderRecipes();
  });

  // ---------- from the meter ----------
  a2.on("character", (c) => {
    character = c || null;
    if (settings.server == null && servers.length) {
      pickServer();
      render();
      loadPrices();
    }
  });

  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") {
        settings = { ...settings, ...s, npc: { ...(s.npc || {}) }, search: { ...(s.search || {}) } };
        if (!Array.isArray(settings.fav)) settings.fav = [];
      }
    } catch {}
    try {
      const c = await a2.storage.get("servers");
      if (Array.isArray(c?.servers)) servers = C.readServers(c);
    } catch {}
    try {
      const p = await a2.storage.get("prices");
      if (p) restoreCache(p);
    } catch {}
    render();
    a2.ready();
    await loadServers();
    render();
    await loadPrices();
    setInterval(() => loadPrices(true), AUTO_MS);
  })();
})();
