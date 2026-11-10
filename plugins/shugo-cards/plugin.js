// The Shugo Cards plugin's window. After a Shugo Festival's card round the
// game sends what lay behind all five cards and who picked which (decoder
// `round`); each round is kept here, with "you" or "not you" for the pickers
// and no names. The prices come from the fork's hourly copy of aion2.exchange
// (a2.web.get), the pictures from the game's icon server (a2.web.image).
(() => {
  const C = globalThis.ShugoCalc;
  const $ = (s) => document.querySelector(s);
  const ICONS = "https://assets.playnccdn.com/static-aion2-gamedata/resources/";
  const COPY = "https://raw.githubusercontent.com/Xzero3007/A2Tools-DPS-Meter_Clicktrough/market-data";
  const API = "https://aion2.exchange/api";
  const STALE_MS = 30 * 60_000;
  const KEEP = 1500; // rounds kept (about 600 bytes each)
  // Rounds that did not read: their frame is kept (a few) to be looked at.
  const KEEP_ODD = 5;

  let settings = { tab: "round", server: null };
  let rounds = [];
  let odd = [];
  let character = null;
  let servers = [];
  let prices = new Map();
  let hist = null;
  let fetchedAt = 0;
  let snapshot = null;
  let busy = false;
  let priceError = "";
  let shown = null; // the round's key looked at; null: the latest

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "title") n.title = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  };
  const saver = (fn, ms) => {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  };
  const saveSettings = saver(() => a2.storage.set("settings", settings).catch(() => {}), 500);
  const saveRounds = saver(() => {
    a2.storage.set("rounds", rounds).catch(() => {});
    a2.storage.set("odd", odd).catch(() => {});
  }, 800);

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
          break;
        }
      } catch {}
    }
    pickServer();
  }
  async function loadPrices(force = false) {
    const s = server();
    if (!s || busy) return renderTop();
    if (!force && fetchedAt && Date.now() - fetchedAt < STALE_MS && prices.size) return;
    busy = true;
    priceError = "";
    renderTop();
    try {
      const copy = C.readCopy(await a2.web.get(`${COPY}/prices/${s.id}.json`));
      if (!copy) throw new Error("no prices for this server yet");
      prices = copy.prices;
      snapshot = copy.snapshot;
      fetchedAt = Date.now();
      try {
        const h = globalThis.MarketAnomaly?.readHistory(await a2.web.get(`${COPY}/history/${s.id}.json`));
        if (h) hist = h;
      } catch {}
    } catch (e) {
      priceError = `Prices: ${e?.message || e}${prices.size ? " (showing the earlier ones)" : ""}`;
    } finally {
      busy = false;
    }
    render();
  }

  // ---------- pictures ----------
  const pictures = new Map();
  const asked = new Map();
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
          for (const box of asked.get(icon) || []) if (data && box.isConnected) box.replaceChildren(el("img", { src: data, alt: "" }));
          asked.delete(icon);
        })
        .finally(() => {
          loading--;
          pump();
        });
    }
  }
  function iconBox(item) {
    const box = el("span", { class: `icon g${C.grade(item)}`, text: C.name(item).slice(0, 1) });
    const icon = C.icon(item);
    if (!icon) return box;
    if (pictures.has(icon)) {
      const data = pictures.get(icon);
      if (data) box.replaceChildren(el("img", { src: data, alt: "" }));
    } else if (asked.has(icon)) asked.get(icon).push(box);
    else {
      asked.set(icon, [box]);
      queue.push(icon);
      pump();
    }
    return box;
  }

  // ---------- drawing ----------
  const when = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const CUR = { 930100003: "Abyss Points", 930100023: "Enhance Stones", 930100011: "Centuryroot Tokens" };
  const curText = (cur) =>
    Object.entries(cur)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${C.kina(n)} ${CUR[id] || C.name(Number(id))}`)
      .join(" · ");
  const kinahText = (w) => (w.priced ? `${w.guess ? "≈ " : ""}${C.short(w.kinah)}` : "—");

  function renderTop() {
    const s = server();
    $(".count").textContent = rounds.length ? `${rounds.length} round${rounds.length === 1 ? "" : "s"} since ${when(rounds[0].at)}${odd.length ? ` · ${odd.length} not read` : ""}` : "No round yet";
    $(".priceState").textContent = busy ? "Reading prices …" : priceError || (s ? `${s.name}: ${prices.size ? `prices of ${when(Date.parse(snapshot) || fetchedAt)}` : "no prices yet"}` : "No server for prices yet");
    $(".update").disabled = busy || !s;
  }

  function itemLine(item, count, extra = {}) {
    const w = C.worth(item, count, prices, hist);
    const li = el(
      "li",
      { class: `it g${C.grade(item)}${C.gold(item) ? " gold" : ""}${extra.bonus ? " bonus" : ""}`, title: `${C.name(item)} (${C.GRADES[C.grade(item)] || "?"})${w.guess ? "\nPrice: the same item under another id on the market (this copy may be bound)" : ""}` },
      iconBox(item),
      el("span", { class: "nm", text: C.name(item) }),
      el("span", { class: "n", text: count > 1 ? `×${C.kina(count)}` : "" }),
    );
    if (w.total != null) li.append(el("span", { class: "v", text: `${w.guess ? "≈" : ""}${C.short(w.total)}` }));
    return li;
  }

  function renderRound() {
    const i = shown == null ? rounds.length - 1 : rounds.findIndex((r) => r.key === shown);
    const r = rounds[i] || null;
    $(".empty").hidden = !!r;
    $(".nav").hidden = !r;
    $(".prev").disabled = i <= 0;
    $(".next").disabled = !r || i >= rounds.length - 1;
    $(".when").textContent = r ? `${when(r.at)} · round ${i + 1} of ${rounds.length}` : "";
    const box = $(".cards");
    if (!r) {
      box.replaceChildren();
      $(".roundSum").textContent = "";
      return;
    }
    const ws = r.cards.map((c) => C.cardWorth(c, prices, hist));
    const best = Math.max(...ws.map((w) => w.kinah));
    let mine = 0;
    r.cards.forEach((c, k) => { if (c.mine) mine += ws[k].kinah; });
    $(".roundSum").textContent = prices.size ? `Your cards: ${C.short(mine)} Kinah` : "";
    box.replaceChildren(
      ...r.cards.map((c, k) => {
        const w = ws[k];
        const head = el(
          "div",
          { class: "head" },
          el("b", { text: `Card ${c.place + 1}` }),
          c.mine ? el("span", { class: "you", text: c.mine > 1 ? `You ×${c.mine}` : "You" }) : null,
          c.others ? el("span", { class: "other", text: "Someone else" }) : null,
        );
        const worth = el("div", { class: `worth${w.kinah === best && best > 0 ? " top" : ""}`, title: "What the card's sellable items bring on your server's market (≈: some only as the same item under another id)" }, kinahText(w));
        const list = el("ul", { class: "its" });
        // The same item several times on a card comes as one line; gold first.
        const lines = (pairs) => {
          const m = new Map();
          for (const [it, n] of pairs) if (!C.currency(it)) m.set(it, (m.get(it) || 0) + n);
          return [...m].sort((a, b) => C.gold(b[0]) - C.gold(a[0]));
        };
        if (c.bonus?.length) {
          list.append(el("li", { class: "sep", text: "Bonus" }));
          for (const [it, n] of lines(c.bonus)) list.append(itemLine(it, n, { bonus: true }));
          list.append(el("li", { class: "sep", text: "Card" }));
        }
        for (const [it, n] of lines(c.main)) list.append(itemLine(it, n));
        const cur = el("div", { class: "cur muted", text: curText(w.cur) });
        const hasGold = [...c.main, ...(c.bonus || [])].some(([it]) => C.gold(it));
        return el("div", { class: `card${c.mine ? " mine" : ""}${hasGold ? " hasGold" : ""}` }, head, worth, cur, list);
      }),
    );
  }

  function renderGold(s) {
    const n = s.golds.length;
    $(".goldSum").replaceChildren(
      el("span", {}, el("b", { text: String(n) }), ` gold item${n === 1 ? "" : "s"} in ${s.rounds} round${s.rounds === 1 ? "" : "s"}`),
      el("span", {}, el("b", { text: String(s.golds.filter((g) => g.mine).length) }), " on cards you picked"),
      el("span", {}, el("b", { text: `${s.bonusGold} of ${s.bonusCards}` }), " bonus layers with gold"),
    );
    const by = new Map();
    for (const g of s.golds) {
      const x = by.get(g.item) || { item: g.item, seen: 0, mine: 0, places: [0, 0, 0, 0, 0] };
      x.seen++;
      if (g.mine) x.mine++;
      x.places[g.place]++;
      by.set(g.item, x);
    }
    const byItem = [...by.values()].sort((a, b) => b.seen - a.seen);
    $(".goldByItem").replaceChildren(
      ...(byItem.length
        ? byItem.map((x) => {
            const w = C.worth(x.item, 1, prices, hist);
            return el(
              "li",
              { class: "row gold" },
              iconBox(x.item),
              el("span", { class: "nm" }, el("span", { text: C.name(x.item) }), el("small", { text: ` ${C.GRADES[C.grade(x.item)]}` })),
              el("span", { class: "c", text: `${x.seen}× seen, ${x.mine}× yours` }),
              el("span", { class: "c", title: "On which card (1 to 5 from the left)", text: x.places.map((v, i) => (v ? `#${i + 1}: ${v}` : "")).filter(Boolean).join("  ") }),
              el("span", { class: "v", text: w.total != null ? `${w.guess ? "≈" : ""}${C.short(w.total)}` : "—" }),
            );
          })
        : [el("li", { class: "note", text: "No gold item yet." })]),
    );
    $(".goldList").replaceChildren(
      ...s.golds.slice(0, 200).map((g) =>
        el(
          "li",
          { class: "row" },
          iconBox(g.item),
          el("span", { class: "nm", text: C.name(g.item) }),
          el("span", { class: "c", text: when(g.at) }),
          el("span", { class: "c", text: `Card ${g.place + 1}${g.bonus ? " (bonus)" : ""}` }),
          el("span", { class: g.mine ? "c you" : "c muted", text: g.mine ? "Yours" : "Not picked" }),
        ),
      ),
    );
  }

  function adviceText(t, a, what) {
    if (a.sure) return el("div", { class: "advice sure" }, el("b", { text: `Pick card ${a.place + 1}` }), ` — ${what} lay there ${Math.round(t.share * 100)} % of the time (${t.n} cases; by chance it would be 20 %, and a spread like this comes by chance only ${(t.p * 100).toFixed(1)} % of the time).`);
    const lead = t.n ? ` Card ${t.best + 1} leads with ${Math.round(t.share * 100)} %, which chance explains (${Math.round(t.p * 100)} %).` : "";
    return el("div", { class: "advice" }, `${what[0].toUpperCase()}${what.slice(1)}: ${t.n} case${t.n === 1 ? "" : "s"} so far. No card is better than chance yet.${lead} A strong lead (one card twice as often) shows after about ${C.NEED_STRONG}, a moderate one after about ${C.NEED_MODERATE}.`);
  }

  function renderPlaces(s) {
    $(".tip").replaceChildren(adviceText(s.goldTest, s.goldAdvice, "gold in the card's own items"), adviceText(s.bestTest, s.bestAdvice, "the most valuable card"));
    $(".places tbody").replaceChildren(
      ...s.place.map((p, i) => {
        const pct = (v, n) => (n ? `${v} (${Math.round((v / n) * 100)} %)` : "—");
        const tr = el(
          "tr",
          {},
          el("td", { text: `Card ${i + 1}` }),
          el("td", { text: pct(p.gold, p.cards) }),
          el("td", { text: pct(p.best, s.full) }),
          el("td", { text: prices.size && p.avg != null ? C.short(p.avg) : "—" }),
          el("td", { text: String(p.mine) }),
        );
        if (s.goldAdvice.sure && s.goldAdvice.place === i) tr.className = "lead";
        return tr;
      }),
    );
    $(".placeSum").replaceChildren(
      el("span", {}, el("b", { text: String(s.full) }), " full rounds"),
      el("span", {}, el("b", { text: String(s.doubles) }), " cards picked twice"),
      prices.size ? el("span", { class: "worth" }, "your cards ", el("b", { text: C.short(s.yours) }), " Kinah, the best card each round ", el("b", { text: C.short(s.bestSum) })) : null,
    );
  }

  function renderItems(s) {
    $(".itemList").replaceChildren(
      el("li", { class: "row head" }, el("span", {}), el("span", { text: "Item" }), el("span", { class: "c", text: "On cards" }), el("span", { class: "c", text: "Count in all" }), el("span", { class: "v", text: "Each" })),
      ...s.items.map((x) => {
        const w = C.worth(x.item, 1, prices, hist);
        return el(
          "li",
          { class: `row${C.gold(x.item) ? " gold" : ""}` },
          iconBox(x.item),
          el("span", { class: `nm g${C.grade(x.item)}`, text: C.name(x.item) }),
          el("span", { class: "c", text: `${x.seen}` }),
          el("span", { class: "c", text: C.kina(x.count) }),
          el("span", { class: "v", text: w.unit != null ? `${w.guess ? "≈" : ""}${C.short(w.unit)}` : "—" }),
        );
      }),
    );
  }

  function render() {
    renderTop();
    for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === settings.tab));
    for (const v of document.querySelectorAll(".view")) v.hidden = v.dataset.view !== settings.tab;
    if (settings.tab === "round") return renderRound();
    const s = C.stats(rounds, prices, hist);
    if (settings.tab === "gold") renderGold(s);
    else if (settings.tab === "places") renderPlaces(s);
    else renderItems(s);
  }

  // ---------- the page ----------
  for (const b of document.querySelectorAll(".tabs button"))
    b.addEventListener("click", () => {
      settings.tab = b.dataset.tab;
      saveSettings();
      render();
    });
  $(".update").addEventListener("click", () => loadPrices(true));
  const step = (d) => {
    const i = shown == null ? rounds.length - 1 : rounds.findIndex((r) => r.key === shown);
    const j = Math.max(0, Math.min(rounds.length - 1, i + d));
    shown = j === rounds.length - 1 ? null : rounds[j]?.key ?? null;
    renderRound();
  };
  $(".prev").addEventListener("click", () => step(-1));
  $(".next").addEventListener("click", () => step(1));

  // ---------- from the meter ----------
  a2.on("character", (c) => {
    const before = character?.serverId;
    character = c || null;
    if (character?.serverId != null && character.serverId !== before) {
      pickServer();
      loadPrices();
    }
  });
  // The round's end: all five cards and the picks. The game sends it twice.
  a2.on("decoded:round", (d, meta) => {
    const at = Number(meta?.at) || Date.now();
    const parsed = C.parseRound(d?.body);
    if (!parsed) {
      if (typeof d?.body === "string" && !odd.some((o) => o.body === d.body)) {
        odd = [...odd, { at, body: d.body }].slice(-KEEP_ODD);
        saveRounds();
        renderTop();
      }
      return;
    }
    const kept = C.keep(parsed, at, character?.name || null);
    const k = rounds.findIndex((r) => r.key === kept.key);
    if (k >= 0) {
      // The second copy (or a replay): only the picks may have changed.
      rounds[k] = { ...kept, at: rounds[k].at };
    } else {
      rounds = [...rounds, kept].slice(-KEEP);
      shown = null;
      // Just now (not a replay of the meter's run): show it.
      if (settings.tab !== "round" && Date.now() - at < 60_000) {
        settings.tab = "round";
        saveSettings();
      }
    }
    saveRounds();
    render();
  });

  (async () => {
    try {
      const s = await a2.storage.get("settings");
      if (s && typeof s === "object") settings = { ...settings, ...s };
    } catch {}
    try {
      const r = await a2.storage.get("rounds");
      if (Array.isArray(r)) rounds = [...r.filter((x) => x && Array.isArray(x.cards)), ...rounds.filter((x) => !r.some((y) => y?.key === x.key))].sort((a, b) => a.at - b.at);
      const o = await a2.storage.get("odd");
      if (Array.isArray(o)) odd = o;
    } catch {}
    render();
    await loadServers();
    await loadPrices();
    render();
  })();
})();
