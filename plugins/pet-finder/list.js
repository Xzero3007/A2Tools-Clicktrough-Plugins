// Pet Finder's "Pets" tab: the Pet Soul Tracker's list (A2 Tools, GPL-3.0,
// github.com/taengu/A2Tools-Plugins plugins/pet-souls 0.4.9 with the
// Clicktrough patches), taken in whole: souls still needed to raise each pet,
// and where each pet's souls drop (sources.js, from the game's own data; click
// a pet to see them). Its pins (★) are Pet Finder's favourites, the one list
// the Map plugin shows with the pets being farmed; the other tabs (plugin.js)
// read the collection and the pins through globalThis.PetList.
//
// The game sends every pet's level and soul points once, at login (decoder
// "pet-list"), then each soul as it is picked up ("soul-gained") and each
// level reached ("level-up"). The counts are kept per server (a pet collection
// is shared by all your characters on a server), so they
// survive restarts; logging in again resyncs them from the game.

// Souls a pet needs to go from level N to N + 1. The first is inferred: 26
// pets at level 0 held 1 to 4 souls, none 5 or more.
const NEEDED = [5, 25, 75];
const MAX_LEVEL = NEEDED.length;
// Souls from the start of each level to level 3: [105, 100, 75].
const TO_MAX = NEEDED.map((_, level) => NEEDED.slice(level).reduce((n, x) => n + x, 0));

// Everything of the list lives in #petsView (the other tabs have their own).
const listRoot = document.getElementById("petsView");
const q1 = (s) => listRoot.querySelector(s);
const els = {
  search: q1(".search"),
  status: q1(".status"),
  summary: q1(".summary"),
  overall: q1(".overall span"),
  filtersButton: q1(".filtersButton"),
  filterCount: q1(".filterCount"),
  filters: q1(".filters"),
  hideMax: q1(".hideMax"),
  chestOnly: q1(".chestOnly"),
  scaleLabel: q1(".scaleLabel"),
  scale: q1(".scaleSelect"),
  layout: q1(".layoutSelect"),
  genus: q1(".genus"),
  levels: q1(".levels"),
  regions: q1(".regions"),
  head: q1(".head"),
  list: q1(".pets:not(.farmList)"),
  empty: q1(".empty"),
  farm: q1(".farm"),
  farmList: q1(".farmList"),
  farmLeft: q1(".farmLeft"),
  toFull: q1(".toFull"),
  toFarm: q1(".toFarm"),
  farmHide: q1(".farmHide"),
  farmPopup: q1(".farmPopup"),
  farmAfter: q1(".farmAfter"),
  hideAfter: q1(".hideAfterSelect"),
};

// farmed: each pet given a soul below level 3, by when (the farming pop-up).
const empty = () => ({ levels: {}, points: {}, syncedAt: 0, lastGain: null, farmed: {} });
let key = null; // storage key of the character shown
let state = empty();
let names = {};
let language = "en";
let openId = null; // the pet whose sources are shown
// How the list is sorted, and whether maxed pets show; kept across restarts.
// hiddenRegions: null until the user picks; until then the other side's maps hide.
let prefs = { sort: "left", desc: false, hideMax: true, genus: "", level: "", pinned: [], hiddenRegions: null, scale: 1, filtersOpen: false, chestOnly: false, layout: "cards", farmPopup: false, hideAfter: 20 };
// Text size: the whole page scaled, spacing and controls with the text. 100%
// is BASE_ZOOM, a little larger than the stylesheet's own sizes.
const SCALES = [0.9, 1, 1.1, 1.25, 1.5];
const BASE_ZOOM = 1.1;
function applyScale() {
  const scale = SCALES.includes(Number(prefs.scale)) ? Number(prefs.scale) : 1;
  document.documentElement.style.zoom = String(Math.round(BASE_ZOOM * scale * 1000) / 1000);
}
// The layout, as a class on the page: the stylesheet draws each its own way.
function applyLayout() {
  const layout = LAYOUT_NAMES[prefs.layout] ? prefs.layout : "cards";
  for (const name of Object.keys(LAYOUT_NAMES)) document.body.classList.toggle(`layout-${name}`, name === layout);
  if (!els.layout.options.length) {
    els.layout.replaceChildren(...Object.entries(LAYOUT_NAMES).map(([value, label]) => Object.assign(document.createElement("option"), { value, textContent: label })));
  }
  els.layout.value = layout;
}
function renderScale() {
  els.scaleLabel.textContent = ui().textSize;
  els.scale.replaceChildren(...SCALES.map((x) => {
    const o = document.createElement("option");
    o.value = String(x);
    o.textContent = `${Math.round(x * 100)}%`;
    return o;
  }));
  els.scale.value = String(SCALES.includes(Number(prefs.scale)) ? Number(prefs.scale) : 1);
}
// Each side's maps. A server's number says the side, as for the meter's
// Discord status: 1xxx Elyos, 2xxx Asmodian.
const SIDE_MAPS = { elyos: ["Poeta", "Verteron", "Eltnen"], asmodian: ["Ishalgen", "Altgard", "Morheim"] };
const sideOf = (charKey) => {
  const server = Number((charKey || "").match(/^(?:server|char)-(\d+)/)?.[1]);
  return server >= 1000 && server < 2000 ? "elyos" : server >= 2000 && server < 3000 ? "asmodian" : null;
};
// The regions hidden: the user's pick, else the other side's maps.
const hiddenRegions = () => {
  // regionsPicked: an empty list saved by the version before this one wasn't a choice.
  if (prefs.regionsPicked && Array.isArray(prefs.hiddenRegions)) return prefs.hiddenRegions;
  const side = sideOf(key);
  return side ? SIDE_MAPS[side === "elyos" ? "asmodian" : "elyos"] : [];
};
// A text from sources.js in the meter's language, else English.
const text = (k) => SOURCE_TEXT[k]?.[language] ?? SOURCE_TEXT[k]?.en ?? String(k ?? "").replace(/^=/, "");
// The words around them, in each of the meter's languages.
const SOURCE_UI = {
  en: { textSize: "Text size", noSource: "No source known.", noDrops: "No drops or chests listed.", spawns: (n) => `${n} spawn${n === 1 ? "" : "s"}`,
        teleport: (n, name) => `nearest teleport #${n} ${name}`, near: (name) => `near Kibelisk ${name}`,
        perOpening: (p) => `${p} per opening`, boxFrom: (x) => `The box comes from ${x}`, also: (x) => `Also drops in ${x} (hidden)`,
        map: "Map" },
  ko: { textSize: "글자 크기", noSource: "알려진 출처가 없습니다.", noDrops: "드롭이나 상자 정보가 없습니다.", spawns: (n) => `${n}곳 출현`,
        teleport: (n, name) => `가까운 텔레포트 #${n} ${name}`, near: (name) => `${name} 근처`,
        perOpening: (p) => `개봉당 ${p}`, boxFrom: (x) => `상자 획득처: ${x}`, also: (x) => `${x}에서도 드롭 (숨김)`,
        map: "지도" },
  ja: { textSize: "文字の大きさ", noSource: "入手先は不明です。", noDrops: "ドロップや箱の情報はありません。", spawns: (n) => `出現 ${n}か所`,
        teleport: (n, name) => `最寄りのテレポート #${n} ${name}`, near: (name) => `${name}付近`,
        perOpening: (p) => `開封ごとに ${p}`, boxFrom: (x) => `箱の入手先: ${x}`, also: (x) => `${x}でもドロップ（非表示）`,
        map: "地図" },
  de: { textSize: "Textgröße", noSource: "Keine Quelle bekannt.", noDrops: "Keine Drops oder Truhen bekannt.", spawns: (n) => `${n} Spawn${n === 1 ? "" : "s"}`,
        teleport: (n, name) => `nächster Teleport #${n} ${name}`, near: (name) => `nahe ${name}`,
        perOpening: (p) => `${p} pro Öffnung`, boxFrom: (x) => `Die Truhe gibt es über: ${x}`, also: (x) => `Droppt auch in ${x} (ausgeblendet)`,
        map: "Karte" },
  fr: { textSize: "Taille du texte", noSource: "Aucune source connue.", noDrops: "Aucun butin ni coffre répertorié.", spawns: (n) => `${n} apparition${n === 1 ? "" : "s"}`,
        teleport: (n, name) => `téléporteur le plus proche n° ${n} ${name}`, near: (name) => `près de ${name}`,
        perOpening: (p) => `${p} par ouverture`, boxFrom: (x) => `Le coffre s'obtient via : ${x}`, also: (x) => `Tombe aussi à ${x} (masqué)`,
        map: "Carte" },
  es: { textSize: "Tamaño del texto", noSource: "No se conoce ninguna fuente.", noDrops: "No hay botín ni cofres.", spawns: (n) => `${n} aparici${n === 1 ? "ón" : "ones"}`,
        teleport: (n, name) => `teletransporte más cercano n.º ${n} ${name}`, near: (name) => `cerca de ${name}`,
        perOpening: (p) => `${p} por apertura`, boxFrom: (x) => `El cofre se obtiene en: ${x}`, also: (x) => `También cae en ${x} (oculto)`,
        map: "Mapa" },
  pt: { textSize: "Tamanho do texto", noSource: "Nenhuma fonte conhecida.", noDrops: "Nenhum drop ou baú listado.", spawns: (n) => `${n} apari${n === 1 ? "ção" : "ções"}`,
        teleport: (n, name) => `teleporte mais próximo nº ${n} ${name}`, near: (name) => `perto de ${name}`,
        perOpening: (p) => `${p} por abertura`, boxFrom: (x) => `O baú vem de: ${x}`, also: (x) => `Também dropa em ${x} (oculto)`,
        map: "Mapa" },
  ru: { textSize: "Размер текста", noSource: "Источник неизвестен.", noDrops: "Нет данных о добыче и сундуках.", spawns: (n) => `мест появления: ${n}`,
        teleport: (n, name) => `ближайший телепорт №${n} ${name}`, near: (name) => `рядом: ${name}`,
        perOpening: (p) => `${p} за открытие`, boxFrom: (x) => `Сундук можно получить: ${x}`, also: (x) => `Также выпадает: ${x} (скрыто)`,
        map: "Карта" },
  "zh-Hant": { textSize: "文字大小", noSource: "來源不明。", noDrops: "沒有掉落或寶箱資料。", spawns: (n) => `${n} 個出現點`,
        teleport: (n, name) => `最近的傳送點 #${n} ${name}`, near: (name) => `${name}附近`,
        perOpening: (p) => `每次開啟 ${p}`, boxFrom: (x) => `寶箱來源：${x}`, also: (x) => `${x}也會掉落（已隱藏）`,
        map: "地圖" },
  "zh-Hans": { textSize: "文字大小", noSource: "来源不明。", noDrops: "没有掉落或宝箱资料。", spawns: (n) => `${n} 个出现点`,
        teleport: (n, name) => `最近的传送点 #${n} ${name}`, near: (name) => `${name}附近`,
        perOpening: (p) => `每次开启 ${p}`, boxFrom: (x) => `宝箱来源：${x}`, also: (x) => `${x}也会掉落（已隐藏）`,
        map: "地图" },
};
const ui = () => SOURCE_UI[language] || SOURCE_UI.en;
// "A, B and C" as the meter's language writes it.
const listOf = (items) => {
  try {
    return new Intl.ListFormat(language, { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
};
// A spawn's region: its map, by English name (as region choices are saved).
const regionOf = (drop) => drop.region || "";
// Each region's map name, to label its chip in the meter's language.
const REGION_MAP = {};
for (const s of Object.values(PET_SOURCES)) for (const d of s.drops) if (d.region) REGION_MAP[d.region] ||= d.map;
// The regions the sources name, Asmodian and Elyos maps first, then Reshanta.
const REGIONS = Object.keys(REGION_MAP)
  .sort((a, b) => a.includes("Reshanta") - b.includes("Reshanta") || a.localeCompare(b));
// The pet you last picked up a soul for counts as being farmed this long, and
// sorts first (after the pinned ones).
const FARMING_MS = 30 * 60 * 1000;
const GENUS_ORDER = ["cogni", "fera", "natura", "varian"];

const savePrefs = () => a2.storage.set("prefs", prefs).catch(() => {});

// The game's name in the meter's language, then English; the user's own name wins.
const gameName = (id) => PET_NAMES[id]?.[language] || PET_NAMES[id]?.en || `Pet #${id}`;
const petName = (id) => names[id] || gameName(id);
// A pet no monster drops: its souls come only from pet chests (the battle
// pass's), so it can't be farmed. Hidden unless asked for.
const chestOnly = (id) => {
  const src = PET_SOURCES[id];
  return !!src && !src.drops.length && src.chests.length > 0;
};
const genusName = (genus) => GENUS_NAMES[genus]?.[language] || GENUS_NAMES[genus]?.en || genus;

// Clicktrough: metres from you to each pet's nearest spawn point on the map
// you're on, as the Map plugin shares them (a2.on("shared"), again once
// you've moved 40 m or changed map); pets with none there, far away.
const FAR = 1e9;
let mapNearest = null; // { nearest: { id: metres }, at }
const NEAREST_FRESH_MS = 5 * 60 * 1000;
const nearestKnown = () => !!mapNearest && Date.now() - mapNearest.at < NEAREST_FRESH_MS;
const nearOf = (id) => (nearestKnown() ? mapNearest.nearest[id] ?? FAR : FAR);
const SORTS = {
  // Closest spawn on this map of a monster that drops its souls first.
  near: (a, b) => nearOf(a.id) - nearOf(b.id),
  level: (a, b) => a.level - b.level,
  name: (a, b) => a.name.localeCompare(b.name, language),
  progress: (a, b) => a.progress - b.progress,
  // Pets already at level 3 sort after every pet still to raise.
  left: (a, b) => a.rank - b.rank,
};

// A pet as the list draws it.
function petOf(id) {
  const level = state.levels[id] || 0;
  const points = state.points[id] || 0;
  const target = NEEDED[level];
  return {
    id: String(id),
    level,
    points,
    target,
    name: petName(id),
    genus: PET_GENUS[id] || "",
    progress: target ? points / target : 1,
    // The goal is level 3, so this counts every soul still needed to get there.
    left: target === undefined ? 0 : Math.max(0, TO_MAX[level] - points),
    rank: target === undefined ? Infinity : Math.max(0, TO_MAX[level] - points),
  };
}

function render() {
  dropMaxedPins();
  const ids = new Set([...Object.keys(state.levels), ...Object.keys(state.points)]);
  // Special pets come at their highest level and take no souls, so they are
  // left out, as are pets only found on maps not open yet (the game lists
  // them anyway). A pet missing from PET_GENUS (newer than this plugin) stays in.
  const pinned = (prefs.pinned || []).map(String);
  const pets = [...ids].filter((id) => PET_GENUS[id] !== "special" && !PET_SOURCES[id]?.unreleased)
    .filter((id) => prefs.chestOnly || !chestOnly(id) || pinned.includes(id)).map(petOf);
  const open = pets.filter((p) => p.level < MAX_LEVEL);
  const souls = open.reduce((n, p) => n + p.left, 0);
  // The souls still to go, large; the pets left beside them; under them a bar
  // of every soul picked up toward level 3 so far.
  const num = (n) => n.toLocaleString(language);
  els.summary.replaceChildren();
  if (pets.length) {
    const big = document.createElement("b");
    big.textContent = num(souls);
    const pl = document.createElement("span");
    pl.className = "petsLeft";
    pl.textContent = `${open.length} / ${pets.length} pets to go`;
    els.summary.append(big, " souls to level 3", pl);
  }
  const needed = pets.length * TO_MAX[0];
  els.overall.parentElement.hidden = !pets.length;
  els.overall.style.width = needed ? `${(100 * (needed - souls)) / needed}%` : "0";
  els.status.textContent = state.syncedAt
    ? `Synced at login ${syncedText(state.syncedAt)}`
    : "Log in to a character (or relog) to read your pets.";
  if (pinNote && Date.now() - pinNote.at < PIN_NOTE_MS) els.status.textContent += ` · ${pinNote.text}`;

  // A search matches the shown name, the English one or the id.
  const query = els.search.value.trim().toLocaleLowerCase();
  const matches = (p) =>
    !query ||
    p.name.toLocaleLowerCase().includes(query) ||
    (PET_NAMES[p.id]?.en || "").toLowerCase().includes(query) ||
    p.id === query;
  // Nearest only while the Map tells where the souls are; else as before.
  const byNear = prefs.sort === "near" && nearestKnown();
  const sort = byNear ? SORTS.near : prefs.sort === "near" ? SORTS.left : SORTS[prefs.sort] || SORTS.left;
  els.head.querySelector(".sortNear").hidden = !nearestKnown();
  const dir = prefs.desc ? -1 : 1;
  // Picking level 3 shows those pets even while they are otherwise hidden.
  // Clicktrough: a favourite at level 3 (made one again on purpose) stays listed.
  const listed = els.hideMax.checked && prefs.level !== String(MAX_LEVEL) ? pets.filter((p) => p.level < MAX_LEVEL || pinned.includes(p.id)) : pets;
  const ofGenus = (p) => !prefs.genus || p.genus === prefs.genus;
  const ofLevel = (p) => !prefs.level || String(Math.min(p.level, MAX_LEVEL)) === prefs.level;
  // With a region turned off, the pets whose souls drop only there leave the
  // list. Chests don't count (nearly every pet has one, from the battle pass);
  // a pet no monster is known to drop stays, as nothing says where it is.
  const hidden = new Set(hiddenRegions());
  const ofRegion = (p) => {
    const src = PET_SOURCES[p.id];
    if (!hidden.size || !src || !src.drops.length) return true;
    return src.drops.some((d) => !regionOf(d) || !hidden.has(regionOf(d)));
  };
  renderChips(els.genus, "genus", listed.filter(ofLevel).filter(ofRegion), (p) => p.genus,
    GENUS_ORDER.map((g) => [g, genusName(g)]));
  // The level row counts every pet, level 3 included, so it shows how far along each level is.
  renderChips(els.levels, "level", pets.filter(ofGenus).filter(ofRegion),
    (p) => String(Math.min(p.level, MAX_LEVEL)),
    NEEDED.map((_, l) => [String(l), `Lv ${l}`]).concat([[String(MAX_LEVEL), `Lv ${MAX_LEVEL}`]]));
  // Pinned pets first, in the order pinned; then the one being farmed; then the chosen sort.
  const active = Number(!!prefs.chestOnly) + Number(!!prefs.genus) + Number(!!prefs.level) + Number(hidden.size > 0 && !!prefs.regionsPicked);
  els.filterCount.textContent = active ? String(active) : "";
  els.filtersButton.classList.toggle("active", active > 0);
  els.filters.hidden = !prefs.filtersOpen;
  els.filtersButton.setAttribute("aria-expanded", String(!!prefs.filtersOpen));
  const farming = state.lastGain && Date.now() - state.lastGain.at < FARMING_MS ? String(state.lastGain.pet) : null;
  const pinRank = (p) => (pinned.includes(p.id) ? pinned.indexOf(p.id) : pinned.length + (p.id === farming ? 0 : 1));
  els.regions.replaceChildren(
    ...REGIONS.map((region) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.region = region;
      b.textContent = text(REGION_MAP[region]).replace("Chaotic ", "");
      b.title = text(REGION_MAP[region]);
      b.setAttribute("aria-pressed", String(!hidden.has(region)));
      return b;
    }),
  );
  const shown = listed
    .filter(ofGenus)
    .filter(ofLevel)
    .filter((p) => matches(p) || (!query && pinned.includes(p.id)))
    .filter((p) => ofRegion(p) || pinned.includes(p.id))
    .sort((a, b) => pinRank(a) - pinRank(b) || dir * sort(a, b) || a.rank - b.rank || a.id - b.id);

  for (const button of els.head.querySelectorAll("button")) {
    const active = button.dataset.sort === prefs.sort;
    button.classList.toggle("active", active);
    button.dataset.dir = active ? (prefs.desc ? "desc" : "asc") : "";
    button.setAttribute("aria-sort", active ? (prefs.desc ? "descending" : "ascending") : "none");
  }
  els.empty.hidden = !(pets.length && !shown.length);

  els.list.replaceChildren(...shown.map((p) => rowOf(p, pinned, farming)));
  renderFarm(pinned, farming);
  shareWithMap(pinned, ids);
  for (const fn of listeners) fn();
}

// Clicktrough: the pets pinned and those being farmed, for the Map plugin
// (a2.share, permission "share"), each time they change; and a map link
// clicked (`focus`), which the Map shows.
let sharedKey = "";
let sharedPets = [];
let focusRequest = null;
function showOnMap(what) {
  focusRequest = { ...what, at: Date.now() };
  a2.share({ source: "Pet Finder", pets: sharedPets, needed: sharedNeeded, souls: sharedSouls, focus: focusRequest }).catch(() => {});
}
// With them, once the pet list is read, every pet not at level 3 yet
// (`needed`): the Map marks those apart from the ones done; and the souls
// each still needs to level 3 (`souls`, id -> count), which the Map lists
// beside the monsters near you.
let sharedNeeded = null;
let sharedSouls = null;
function shareWithMap(pinned, ids) {
  if (typeof a2.share !== "function") return;
  const pets = pinned.map((id) => ({ id: Number(id), name: petName(id), mark: "pinned" }));
  for (const p of farmedPets()) {
    if (!pinned.includes(p.id) && p.level < MAX_LEVEL) pets.push({ id: Number(p.id), name: p.name, mark: "farming" });
  }
  const needed = state.syncedAt
    ? [...ids].filter((id) => PET_GENUS[id] !== "special" && levelOfPet(id) < MAX_LEVEL).map(Number).sort((a, b) => a - b)
    : null;
  const souls = needed ? Object.fromEntries(needed.map((id) => [id, petOf(String(id)).left])) : null;
  const k = JSON.stringify([pets, needed, souls]);
  if (k === sharedKey) return;
  sharedKey = k;
  sharedPets = pets;
  sharedNeeded = needed;
  sharedSouls = souls;
  a2.share({ source: "Pet Finder", pets, needed, souls, focus: focusRequest }).catch(() => {});
}

// A pet's row in the chosen layout, its sources under it while open.
function rowOf(p, pinned, farming) {
  const build = LAYOUTS[prefs.layout] || LAYOUTS.cards;
  const li = build(p, { pinned: pinned.includes(p.id), farming: p.id === farming });
  li.dataset.id = p.id;
  li.dataset.genus = p.genus;
  li.classList.toggle("max", p.level >= MAX_LEVEL);
  li.classList.toggle("farmed", p.id === farming);
  if (PET_SOURCES[p.id]) li.classList.add("hasWhere");
  if (openId === p.id) {
    li.classList.add("open");
    li.append(whereOf(p.id));
  }
  return li;
}

// ---- The farming pop-up (Filters → "Pop up while farming") ---------------
//
// A soul for a pet below level 3 shows the window with only the pets being
// farmed (a soul in the last 30 minutes), fitted to them, and hides it again
// once nothing has happened for the time chosen; the whole list stays a
// click away. Meters before 2.0.62 have no a2.window, 2.0.65 brought fit.
const win = a2.window;
const canFit = () => !!(win && typeof win.fit === "function");
const HIDE_AFTER = [10, 20, 30, 60, 0]; // seconds; 0 never
// A pet that reached level 3 stays this long, to be seen done.
const DONE_SHOWN_MS = 60 * 1000;
let view = "full"; // or "farm"
let poppedAt = 0;
// The last click, key or wheel in the window: someone using it. The mouse
// only passing over it isn't (it sits above the game, which the pointer
// crosses while playing), but keeps the pop-up up.
let usedAt = 0;
let hoveredAt = 0;
const startedAt = Date.now();

// The pets being farmed, the last given a soul first.
function farmedPets() {
  const now = Date.now();
  return Object.entries(state.farmed || {})
    .filter(([, at]) => now - at < FARMING_MS)
    .map(([id, at]) => ({ ...petOf(id), at }))
    .filter((p) => p.level < MAX_LEVEL || Date.now() - p.at < DONE_SHOWN_MS)
    .sort((a, b) => b.at - a.at);
}

function renderFarm(pinned, farming) {
  const pets = farmedPets();
  const usable = !!prefs.farmPopup && canFit();
  els.toFarm.hidden = !usable || !pets.length;
  if (!usable) {
    if (view === "farm") showFull();
    return;
  }
  const left = pets.reduce((n, p) => n + p.left, 0);
  els.farmLeft.textContent = pets.length
    ? `${pets.length} pet${pets.length === 1 ? "" : "s"} · ${left.toLocaleString(language)} souls to level 3`
    : "";
  els.farmList.replaceChildren(...pets.map((p) => rowOf(p, pinned, farming)));
  if (view === "farm") fitFarm();
}

// The page's zoom (Text size) that sizes measured on it leave out: all of it
// where they come unzoomed, none where the browser has zoomed them already
// (newer Chromium). Told apart by measuring 100 px.
function zoomLeft() {
  const zoom = Number(document.documentElement.style.zoom) || 1;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:100px;width:1px";
  document.body.append(probe);
  const measured = probe.getBoundingClientRect().height / 100;
  probe.remove();
  return measured > 0 ? zoom / measured : zoom;
}
// Measured at once: the list was just drawn, and measuring lays it out.
function fitFarm() {
  if (view !== "farm") return;
  win.fit(Math.ceil(els.farm.getBoundingClientRect().height * zoomLeft()) + 2).catch(() => {});
}
function showFarm() {
  view = "farm";
  document.body.classList.add("farmOnly");
  render();
}
function showFull() {
  if (view === "full") return;
  view = "full";
  document.body.classList.remove("farmOnly");
  if (canFit()) win.fit().catch(() => {});
  render();
}
// A soul just picked up for a pet below level 3. Someone using the whole
// list (a click, a key or the wheel in the last 10 seconds) keeps it.
function popFarm() {
  if (!prefs.farmPopup || !canFit()) return;
  if (view === "full" && Date.now() - usedAt < 10_000) return;
  poppedAt = Date.now();
  globalThis.PetFinderTabs?.select("pets");
  showFarm();
  win.show().catch(() => {});
}
// Hidden, it is the whole list again, for when it is opened from Settings.
function hideFarm() {
  // The click on × doesn't count as using the whole list.
  usedAt = 0;
  win.hide().catch(() => {});
  showFull();
}
setInterval(() => {
  const after = Number(prefs.hideAfter) * 1000;
  if (view === "farm" && after > 0 && Date.now() - Math.max(poppedAt, usedAt, hoveredAt) > after) hideFarm();
}, 1000);
for (const type of ["pointerdown", "keydown", "wheel"]) {
  document.addEventListener(type, () => { usedAt = Date.now(); }, { passive: true });
}
document.addEventListener("pointermove", () => { hoveredAt = Date.now(); }, { passive: true });

// ---- The layouts: how each pet's row is drawn (Settings → Layout) --------

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
// Its pin, its name (double-click to rename), its genus (unless the layout
// shows it elsewhere) and, while farmed, the tag.
function nameOf(p, { pinned, farming }, { genus = true } = {}) {
  const name = el("span", "name");
  const pin = el("button", "pin", pinned ? "★" : "☆");
  pin.type = "button";
  pin.title = pinned ? "Unpin" : "Pin to the top";
  pin.setAttribute("aria-pressed", String(pinned));
  const text = el("span", "nameText", p.name);
  text.title = `${p.name}${p.genus ? ` · ${genusName(p.genus)}` : ""} (double-click to rename)`;
  text.addEventListener("dblclick", () => rename(p.id, text));
  // Its portrait, as the Nearby and Merchant tabs show it (images.js).
  const src = globalThis.PET_IMAGES?.portraits?.[p.id];
  if (src) {
    const img = document.createElement("img");
    img.className = "petPic";
    img.alt = "";
    img.src = src;
    img.decoding = "async";
    name.append(pin, img, text);
  } else {
    name.append(pin, text);
  }
  if (genus && p.genus) name.append(el("span", "genusTag", genusName(p.genus)));
  if (farming) {
    const tag = el("span", "farming", "farming");
    tag.title = "You picked up a soul for this pet in the last 30 minutes";
    name.append(tag);
  }
  return name;
}
// The way to level 3 in its three steps (5, 25 and 75 souls): the steps
// done full, the current one by its souls, the count beside it.
function stepsOf(p) {
  const souls = el("span", "souls");
  const steps = el("span", "steps");
  steps.title = p.target ? `${p.points}/${p.target} souls toward level ${p.level + 1}` : "Level 3";
  for (let l = 0; l < MAX_LEVEL; l += 1) {
    const step = el("i");
    const fill = l < p.level ? 1 : l === p.level && p.target ? p.points / p.target : 0;
    step.style.setProperty("--f", `${Math.min(100, fill * 100)}%`);
    steps.append(step);
  }
  souls.append(steps, el("span", "count", p.target ? `${p.points}/${p.target}` : "MAX"));
  return souls;
}
const leftTitle = (p) => (p.target ? `${p.left} souls to level 3` : "");

const LAYOUTS = {
  // A card: the level ring, the name and the souls left in its corner, and
  // under them the three steps.
  cards(p, flags) {
    const li = el("li");
    const left = el("span", "left");
    if (p.target) left.append(el("b", "", String(p.left)), " left");
    left.title = leftTitle(p);
    const top = el("div", "line");
    top.append(nameOf(p, flags), left);
    const main = el("div", "main");
    main.append(top, stepsOf(p));
    li.append(levelRing(p), main);
    return li;
  },
  // A card that fills with the souls toward the next level: its genus icon,
  // its level as dots, the souls left large.
  filled(p, flags) {
    const li = el("li");
    li.style.setProperty("--p", `${Math.min(100, p.progress * 100)}%`);
    const main = el("div", "main");
    const sub = el("div", "line sub");
    const pips = el("span", "pips");
    pips.title = `Level ${Math.min(p.level, MAX_LEVEL)}`;
    for (let l = 0; l < MAX_LEVEL; l += 1) pips.append(el("i", l < p.level ? "on" : ""));
    sub.append(pips, el("span", "count", p.target ? `${p.points}/${p.target}` : "MAX"));
    if (p.genus) sub.append(el("span", "genusName", genusName(p.genus)));
    const top = el("div", "line");
    top.append(nameOf(p, flags, { genus: false }));
    main.append(top, sub);
    const left = el("span", "left");
    if (p.target) left.append(el("b", "", String(p.left)), el("small", "", "to Lv 3"));
    left.title = leftTitle(p);
    li.append(genusIcon(p.genus), main, left);
    return li;
  },
  // One line: the level ring, the name, the three steps, the souls left.
  rows(p, flags) {
    const li = el("li");
    const left = el("span", "left", p.target ? String(p.left) : "");
    left.title = leftTitle(p);
    li.append(levelRing(p), nameOf(p, flags), stepsOf(p), left);
    return li;
  },
  // The table as it was: level, name, a bar of the souls toward the next
  // level, the souls left.
  classic(p, flags) {
    const li = el("li");
    const bar = el("span", "bar");
    const fill = el("span");
    fill.style.width = `${Math.min(100, p.progress * 100)}%`;
    bar.append(fill, el("span", "count", p.target ? `${p.points}/${p.target}` : ""));
    const left = el("span", "left", p.target ? String(p.left) : "");
    left.title = leftTitle(p);
    li.append(el("span", "level", p.level >= MAX_LEVEL ? "MAX" : `Lv ${p.level}`), nameOf(p, flags), bar, left);
    return li;
  },
};
const LAYOUT_NAMES = { cards: "Cards", filled: "Filled cards", rows: "Rows", classic: "Classic" };

// Each genus's mark: an eye (Cogni), a paw (Fera), a leaf (Natura), a
// spiral (Varian).
const GENUS_ICONS = {
  cogni: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  fera: "M12 13c-3 0-5.5 3-5.5 5.2 0 1.6 1.4 2.3 2.8 2.3 1.2 0 1.8-.6 2.7-.6s1.5.6 2.7.6c1.4 0 2.8-.7 2.8-2.3C17.5 16 15 13 12 13ZM5 11.5a2 2.4 0 1 0 0 .01M19 11.5a2 2.4 0 1 0 0 .01M9 7a2 2.5 0 1 0 0 .01M15 7a2 2.5 0 1 0 0 .01",
  natura: "M5 19C5 10 10 5 20 4c0 9-5 15-13 15m-2 0 8-8",
  varian: "M12 12m-1 0a1 1 0 1 1 2 0 3 3 0 1 1-6 0 5 5 0 1 1 10 0 7 7 0 1 1-14 0 9 9 0 0 1 9-9",
};
function genusIcon(genus) {
  const NS = "http://www.w3.org/2000/svg";
  const box = el("span", "icon");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", GENUS_ICONS[genus] || "M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0");
  svg.append(path);
  box.append(svg);
  return box;
}

// A pet's level in a ring of its genus colour, the ring filling with the
// souls toward the next level (full and gold at level 3).
function levelRing(p) {
  const NS = "http://www.w3.org/2000/svg";
  const box = document.createElement("span");
  box.className = "ring";
  box.title = `Level ${Math.min(p.level, MAX_LEVEL)}`;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("aria-hidden", "true");
  const circle = (cls, part) => {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "18");
    c.setAttribute("cy", "18");
    c.setAttribute("r", "15");
    c.setAttribute("pathLength", "100");
    if (part != null) c.setAttribute("stroke-dasharray", `${part} 100`);
    return c;
  };
  svg.append(circle("track"), circle("arc", Math.round(Math.min(1, p.progress) * 100)));
  const n = document.createElement("b");
  n.textContent = String(Math.min(p.level, MAX_LEVEL));
  box.append(svg, n);
  return box;
}

// When the pet list came: the time today, else the date and time.
function syncedText(at) {
  const d = new Date(at);
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  return today ? time : `${d.toLocaleDateString(language, { month: "short", day: "numeric" })} ${time}`;
}

// Where a pet's souls come from: the monsters that drop them (level, chance,
// zone and map, nearest Kibelisk) and the chests that hold them, from the
// game's own data (sources.js).
function whereOf(id) {
  const box = document.createElement("div");
  box.className = "where";
  const src = PET_SOURCES[id];
  const words = ui();
  if (!src) {
    box.textContent = words.noSource;
    return box;
  }
  const line = (cls, ...parts) => {
    const div = document.createElement("div");
    div.className = cls;
    div.textContent = parts.filter(Boolean).join(" · ");
    return div;
  };
  const tag = (t, cls = "") => {
    const span = document.createElement("span");
    span.className = `tag ${cls}`.trim();
    span.textContent = t;
    return span;
  };
  const hidden = new Set(hiddenRegions());
  const elsewhere = new Set();
  // The monsters with the most spawns first: the easiest to find (a
  // player's request, 2026-10-19); the game data's order otherwise.
  const drops = [...src.drops].sort((x, y) => (y.spawns || 0) - (x.spawns || 0));
  for (const d of drops) {
    if (hidden.has(regionOf(d))) {
      elsewhere.add(regionOf(d));
      continue;
    }
    const who = line("who", text(d.npc));
    if (d.level) who.append(tag(`Lv ${d.level}`));
    if (d.chance) who.append(tag(d.chance, "chance"));
    box.append(who);
    // In the Abyss each side has Kibelisks of its own: yours, when known.
    const k = d.bySide?.[sideOf(key)] || d.kibelisk;
    // The teleport's number as the in-game map lists it, where known.
    const kib = k && `${text(k.name)} · ${k.m.toLocaleString(language)} m`;
    const kibelisk = kib && (k.teleport ? words.teleport(k.teleport, kib) : words.near(kib));
    const zones = listOf((d.zones || []).map(text)) || "?";
    const at = line("at", zones, d.map && text(d.map), d.spawns && words.spawns(d.spawns), kibelisk);
    // The monster's spawn points on the Map plugin (a2.share): a button in
    // the meter, never a website.
    if (d.npcId && typeof a2.share === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mapLink";
      button.title = "Show its spawn points on the Map";
      // A folded map before the word.
      const NS = "http://www.w3.org/2000/svg";
      const icon = document.createElementNS(NS, "svg");
      icon.setAttribute("class", "mapIcon");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", "M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Zm0 0v13.5m6-11v13.5");
      icon.append(path);
      button.append(icon, words.map);
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        showOnMap({ npc: d.npcId, name: SOURCE_TEXT[d.npc]?.en || text(d.npc), region: regionOf(d) });
      });
      at.append(" · ", button);
    }
    box.append(at);
  }
  for (const c of src.chests) {
    const who = line("who chest", text(c.name));
    who.append(tag(words.perOpening(c.chance), "chance"));
    box.append(who);
    if (c.from) box.append(line("at", words.boxFrom(listOf(c.from.map(text)))));
  }
  if (!src.drops.length && !src.chests.length) box.append(line("at", words.noDrops));
  if (elsewhere.size) box.append(line("at", words.also(listOf([...elsewhere].map((r) => text(REGION_MAP[r]))))));
  return box;
}


// A filter row (genus or level): All, then each choice with how many of
// `pets` it holds, given the other filters.
function renderChips(row, pref, pets, valueOf, choices) {
  const counts = {};
  for (const p of pets) counts[valueOf(p)] = (counts[valueOf(p)] || 0) + 1;
  const chip = (value, label, count) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.value = value;
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = `(${count})`;
    b.append(label, " ", n);
    b.setAttribute("aria-pressed", String(prefs[pref] === value));
    return b;
  };
  row.dataset.pref = pref;
  row.replaceChildren(
    chip("", "All", pets.length),
    ...choices.map(([value, label]) => chip(value, label, counts[value] || 0)),
  );
}

// The sandbox allows no dialogs, so the name is edited in place.
function rename(id, span) {
  const input = document.createElement("input");
  input.className = "rename";
  input.value = names[id] || "";
  input.placeholder = gameName(id);
  input.maxLength = 40;
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    if (keep) {
      if (input.value.trim()) names[id] = input.value.trim();
      else delete names[id];
      a2.storage.set("names", names).catch(() => {});
    }
    render();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  span.replaceWith(input);
  input.focus();
}

// A pet whose souls reach what its level needs goes up a level, its count
// starting again from 0 as the game's does (Karnif: 25 -> 0; Aberrant Bee,
// 2026-10-12: carrying the extra over came out 2 above the game's 33). The
// game's own level-up message doesn't come for every step (Brax: 24 souls
// picked up at level 0 and no level-up seen), so the counts level themselves;
// the next login's pet list corrects them either way.
function levelUp(st, pet) {
  const level = st.levels[pet] || 0;
  if (level < MAX_LEVEL && (st.points[pet] || 0) >= NEEDED[level]) {
    st.levels[pet] = level + 1;
    st.points[pet] = 0;
  }
}

// ---- Clicktrough: the list for Pet Finder's other tabs (plugin.js) -------
// One list of favourites (the pins) and one collection for every tab.
const listeners = [];
const gainListeners = [];
function togglePin(id) {
  const list = (prefs.pinned || []).map(String);
  const kept = (prefs.keepAtMax || []).map(String);
  const k = String(id);
  if (list.includes(k)) {
    prefs.pinned = list.filter((x) => x !== k);
    prefs.keepAtMax = kept.filter((x) => x !== k);
  } else {
    prefs.pinned = [...list, k];
    // Made a favourite at level 3: on purpose, so it stays one.
    if (state.syncedAt && levelOfPet(k) >= MAX_LEVEL) prefs.keepAtMax = [...kept.filter((x) => x !== k), k];
  }
  savePrefs();
  render();
}
const levelOfPet = (id) => Math.min(MAX_LEVEL, state.levels[id] || 0);
// A favourite that reaches level 3 stops being one, so the Map no longer
// follows it; one made a favourite again at level 3 stays (keepAtMax). Only
// once the pet list is read: before, the levels aren't known.
const PIN_NOTE_MS = 60_000;
let pinNote = null;
function dropMaxedPins() {
  if (!state.syncedAt) return;
  const list = (prefs.pinned || []).map(String);
  const kept = new Set((prefs.keepAtMax || []).map(String));
  const done = list.filter((id) => !kept.has(id) && levelOfPet(id) >= MAX_LEVEL);
  if (!done.length) return;
  prefs.pinned = list.filter((id) => !done.includes(id));
  prefs.keepAtMax = [...kept].filter((id) => prefs.pinned.includes(id));
  savePrefs();
  const names = done.map((id) => petName(id));
  pinNote = { at: Date.now(), text: `${names.length > 2 ? `${names.length} pets` : names.join(" and ")} at level 3: no longer ${names.length > 1 ? "favourites" : "a favourite"}` };
}
/** A pet's progress as Pet Finder's tabs show it: { rank (the level, 0-3),
 *  souls, goal (souls for the next level, null at 3), toMax }; all null
 *  before the pet list is read. */
function progressOf(id) {
  if (!state.syncedAt) return { rank: null, souls: null, goal: null, toMax: null };
  const level = Math.min(MAX_LEVEL, state.levels[id] || 0);
  const souls = state.points[id] || 0;
  const goal = NEEDED[level] ?? null;
  return { rank: level, souls, goal, toMax: goal == null ? 0 : Math.max(0, TO_MAX[level] - souls) };
}
globalThis.PetList = {
  get synced() { return state.syncedAt > 0; },
  get syncedAt() { return state.syncedAt; },
  progress: progressOf,
  isPinned: (id) => (prefs.pinned || []).map(String).includes(String(id)),
  togglePin,
  name: (id) => petName(id),
  showOnMap,
  onChange: (fn) => listeners.push(fn),
  onGain: (fn) => gainListeners.push(fn),
};
// The pins from before, once: Pet Finder's own (0.2) and the Pet Soul
// Tracker's (it shares them while it still runs).
async function importPins() {
  if (prefs.pinsImported) return;
  const old = await a2.storage.get("pins").catch(() => null);
  if (Array.isArray(old) && old.length) {
    const list = (prefs.pinned || []).map(String);
    for (const id of old) if (!list.includes(String(id))) list.push(String(id));
    prefs.pinned = list;
  }
  prefs.pinsImported = true;
  savePrefs();
}
a2.on("shared", ({ plugin, value }) => {
  // The Map's nearest spawn of each pet (for the Nearest sort).
  if (plugin === "map" && value?.nearest && typeof value.nearest === "object") {
    const before = nearestKnown();
    mapNearest = { nearest: value.nearest, at: Date.now() };
    if (prefs.sort === "near" || !before) render();
    return;
  }
  if (plugin !== "pet-souls" || prefs.pstImported || !Array.isArray(value?.pets)) return;
  const list = (prefs.pinned || []).map(String);
  for (const p of value.pets) if (p?.mark === "pinned" && !list.includes(String(p.id))) list.push(String(p.id));
  prefs.pinned = list;
  prefs.pstImported = true;
  savePrefs();
  render();
});

// Each pet's souls in a soul-gained event.
const soulsIn = (data) => (Array.isArray(data?.souls) ? data.souls : data && data.pet != null ? [{ pet: data.pet, amount: data.amount }] : []);
// Whether the pet was below level 3: being farmed.
function gain(st, pet, amount, at = Date.now()) {
  const farmed = (st.levels[pet] || 0) < MAX_LEVEL;
  st.points[pet] = (st.points[pet] || 0) + amount;
  st.lastGain = { pet, at };
  if (farmed) {
    const now = Date.now();
    st.farmed = Object.fromEntries(Object.entries(st.farmed || {}).filter(([, t]) => now - t < FARMING_MS));
    st.farmed[pet] = at;
  }
  levelUp(st, pet);
  return farmed;
}

// What each event does to a character's counts.
const handle = {
  "decoded:pet-list"(st, data) {
    st.levels = {};
    st.points = {};
    st.syncedAt = Date.now();
    for (const { pet, level } of data.levels || []) st.levels[pet] = level;
    for (const { pet, points } of data.points || []) st.points[pet] = points;
  },
  // A kill can give souls for several pets at once: the packet lists each
  // (BobbySk, 2026-10-19: two pets in one, and only the first was counted).
  // Before 0.4.6 the decoder read one pet; its events still come as { pet, amount }.
  // Returns whether one was a pet being farmed.
  "decoded:soul-gained"(st, data, at) {
    let farmed = false;
    for (const { pet, amount } of soulsIn(data)) farmed = gain(st, pet, amount, at) || farmed;
    return farmed;
  },
  "decoded:level-up"(st, { pet, level, status }) {
    // Clicktrough: a frame with a status other than 0 is no level reached
    // (PetTracker's rule; the decoder reads the status, 0.4.9 skipped it).
    if (status) return;
    // The game resets a pet's points as it levels (Karnif: 25 -> 0). Already
    // levelled from its souls: the souls picked up since stay.
    if ((st.levels[pet] || 0) >= level) return;
    st.levels[pet] = level;
    st.points[pet] = 0;
  },
};

// Counts are kept per server: a pet collection is shared by every character
// on a server. Each event comes stamped with who was playing when it
// happened, so a login on another server starts that server's list rather
// than overwriting this one. No server known (a new character still in the
// tutorial): no key.
const keyFor = (character) => (Number(character?.serverId) > 0 ? `server-${Number(character.serverId)}` : null);
// Before 0.3.1 counts were kept per character, under this key.
const characterKey = (character) =>
  character?.name
    ? `char-${character.serverId || 0}-${encodeURIComponent(character.name)}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
    : null;
// A server's counts start from the counts a character on it had saved, the
// first time that character is seen (the plugin can't list its saved keys).
const adopt = async (k, character) => {
  const old = characterKey(character);
  if (!k || !old || loaded.has(k) || (await a2.storage.get(k).catch(() => null))) return;
  const saved = await a2.storage.get(old).catch(() => null);
  if (saved) await a2.storage.set(k, saved).catch(() => {});
};
const loaded = new Map();
const load = async (k) => {
  if (!loaded.has(k)) {
    const st = (await a2.storage.get(k).catch(() => null)) || empty();
    // Counts saved before pets levelled from their souls (a pet at level 0 with
    // 24): the souls past each step, picked up one by one, count toward the next.
    for (const pet of Object.keys(st.points || {})) {
      let level = st.levels[pet] || 0;
      while (level < MAX_LEVEL && st.points[pet] >= NEEDED[level]) {
        st.points[pet] -= NEEDED[level];
        level += 1;
      }
      st.levels[pet] = level;
    }
    loaded.set(k, st);
  }
  return loaded.get(k);
};
// When the meter doesn't know who is playing: the character seen last.
const UNNAMED_KEY = "server-unknown";
const fallbackKey = async () => key || (await a2.storage.get("last").catch(() => null)) || "char-default";
const show = async (k) => {
  key = k;
  state = await load(k);
  render();
};

// Events are handled one at a time, in order (loading a character's counts waits on storage).
let chain = Promise.resolve();
const queued = (fn) => {
  chain = chain.then(fn).catch((e) => console.error(e));
};

// The last changes, kept with the counts to trace a count that drifts from
// the game's: [time, event, pet, amount or level, level after, souls after].
const HISTORY = 200;
function note(st, event, data) {
  if (event === "decoded:soul-gained") {
    for (const soul of soulsIn(data)) noteOne(st, event, soul);
    return;
  }
  noteOne(st, event, data);
}
function noteOne(st, event, data) {
  const pets = event === "decoded:pet-list" ? [] : [data.pet];
  const value = event === "decoded:soul-gained" ? data.amount : event === "decoded:level-up" ? data.level : null;
  const entry = [new Date().toISOString(), event.replace("decoded:", ""), pets[0] ?? null, value];
  if (pets.length) entry.push(st.levels[pets[0]] || 0, st.points[pets[0]] || 0);
  else entry.push((data.levels || []).length, (data.points || []).length);
  st.history = [...(st.history || []), entry].slice(-HISTORY);
}

for (const event of Object.keys(handle)) {
  a2.on(event, (data, meta) => queued(async () => {
    // A pet list replaces a server's counts, so one from a character with no
    // server yet (a new character in the tutorial) gets a key of its own
    // rather than the last one's: falling back there wiped Naicha's counts
    // when an alt was created (2026-10-13). Single souls still fall back,
    // for a meter started mid-session that hasn't seen who is playing.
    const k = keyFor(meta?.character)
      || (event === "decoded:pet-list" ? UNNAMED_KEY : await fallbackKey());
    await adopt(k, meta?.character);
    const st = await load(k);
    const at = Number(meta?.at) > 0 ? Number(meta.at) : Date.now();
    const farmed = handle[event](st, data, at);
    note(st, event, data);
    if (event === "decoded:soul-gained") for (const { pet, amount } of soulsIn(data)) for (const fn of gainListeners) fn(Number(pet), amount, at);
    await a2.storage.set(k, st).catch(() => {});
    await a2.storage.set("last", k).catch(() => {});
    if (k !== key) await show(k);
    else render();
    // Not for the souls of before the window opened, which the meter sends
    // again as it opens.
    const live = meta?.at != null ? Date.now() - Number(meta.at) < 15_000 : Date.now() - startedAt > 5_000;
    if (farmed && live) popFarm();
  }));
}
// Who is playing as the window opens.
a2.on("character", (character) => queued(async () => {
  const k = keyFor(character);
  await adopt(k, character);
  await show(k || (await fallbackKey()));
}));
a2.on("language", (code) => {
  language = typeof code === "string" ? code : "en";
  renderScale();
  render();
});
// The window's fold button (body.compact): plugin.js sets it for every tab.
els.search.addEventListener("input", render);
for (const row of [els.genus, els.levels]) {
  row.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-value]");
    if (!button) return;
    prefs[row.dataset.pref] = button.dataset.value;
    savePrefs();
    render();
  });
}
els.regions.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-region]");
  if (!button) return;
  const hidden = new Set(hiddenRegions());
  if (hidden.has(button.dataset.region)) hidden.delete(button.dataset.region);
  else hidden.add(button.dataset.region);
  prefs.hiddenRegions = [...hidden];
  prefs.regionsPicked = true;
  savePrefs();
  render();
});
els.filtersButton.addEventListener("click", () => {
  prefs.filtersOpen = !prefs.filtersOpen;
  savePrefs();
  render();
});
els.layout.addEventListener("change", () => {
  prefs.layout = els.layout.value;
  savePrefs();
  applyLayout();
  render();
});
els.scale.addEventListener("change", () => {
  prefs.scale = Number(els.scale.value);
  savePrefs();
  applyScale();
});
els.chestOnly.addEventListener("change", () => {
  prefs.chestOnly = els.chestOnly.checked;
  savePrefs();
  render();
});
els.farmPopup.addEventListener("change", () => {
  prefs.farmPopup = els.farmPopup.checked;
  els.farmAfter.hidden = !prefs.farmPopup;
  savePrefs();
  render();
});
els.hideAfter.addEventListener("change", () => {
  prefs.hideAfter = Number(els.hideAfter.value);
  savePrefs();
});
els.toFull.addEventListener("click", showFull);
els.toFarm.addEventListener("click", () => {
  poppedAt = Date.now();
  showFarm();
});
els.farmHide.addEventListener("click", hideFarm);
els.hideMax.addEventListener("change", () => {
  prefs.hideMax = els.hideMax.checked;
  savePrefs();
  render();
});
// A click on a pet shows or hides where its souls drop (a double click on
// its name still renames it).
const onListClick = (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  if (e.target.closest(".pin")) {
    togglePin(li.dataset.id);
    return;
  }
  if (e.detail > 1 || e.target.closest("input, a, .where")) return;
  openId = openId === li.dataset.id ? null : li.dataset.id;
  render();
};
els.list.addEventListener("click", onListClick);
els.farmList.addEventListener("click", onListClick);
// A column's button sorts by it; pressing it again reverses the order.
els.head.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-sort]");
  if (!button) return;
  const sort = button.dataset.sort;
  prefs.desc = prefs.sort === sort ? !prefs.desc : false;
  prefs.sort = sort;
  savePrefs();
  render();
});

(async () => {
  names = (await a2.storage.get("names").catch(() => null)) || {};
  prefs = { ...prefs, ...((await a2.storage.get("prefs").catch(() => null)) || {}) };
  await importPins();
  els.hideMax.checked = prefs.hideMax;
  els.chestOnly.checked = !!prefs.chestOnly;
  els.farmPopup.checked = !!prefs.farmPopup;
  els.farmAfter.hidden = !prefs.farmPopup;
  if (!canFit()) {
    els.farmPopup.disabled = true;
    els.farmPopup.parentElement.title = "Needs meter 2.0.65 or later";
  }
  els.hideAfter.replaceChildren(...HIDE_AFTER.map((n) =>
    Object.assign(document.createElement("option"), { value: String(n), textContent: n ? (n < 60 ? `${n} s` : `${n / 60} min`) : "Never" })));
  els.hideAfter.value = String(HIDE_AFTER.includes(Number(prefs.hideAfter)) ? Number(prefs.hideAfter) : 20);
  applyLayout();
  applyScale();
  renderScale();
  await a2.ready();
  // The "farming" mark wears off without an event to redraw it.
  setInterval(() => { if (state.lastGain) render(); }, 60_000);
  // Without a character from the meter, show the last one tracked.
  queued(async () => { if (!key) await show(await fallbackKey()); });
})();
