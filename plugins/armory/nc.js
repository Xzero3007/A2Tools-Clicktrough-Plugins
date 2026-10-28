// The Armory plugin's reading of NC's character pages (the official AION 2
// site's character info, read through the meter's a2.web.get): the addresses
// and what their answers hold, as one snapshot of a character. No requests
// here: plugin.js makes them; the tests feed answers in.
(() => {
  const SITE = "https://aion2.plaync.com/api/character";
  const SEARCH = "https://api-search.plaync.com/aion2global/search/v2/character";
  const PORTRAITS = "https://profileimg.plaync.com";
  const LANG = "en-US";

  /** Global's five shards, by a server's number: 2305 Marchutan is EU
   *  (the hundreds: 1 NA East, 2 NA West, 3 Europe, 4 South America, 5 Asia). */
  const REGIONS = { 1: "nae", 2: "naw", 3: "eu", 4: "la", 5: "as" };
  const regionOf = (serverId) => REGIONS[Math.floor(Number(serverId) / 100) % 10] || null;

  const query = (params) => new URLSearchParams(params).toString();
  const searchUrl = (name, serverId) =>
    `${SEARCH}?${query({ keyword: name, page: 1, size: 40, region: regionOf(serverId), localeInfo: LANG, serverId })}`;
  const base = (ref) => ({ lang: LANG, region: regionOf(ref.serverId), serverId: ref.serverId, characterId: ref.characterId });
  const infoUrl = (ref) => `${SITE}/info?${query(base(ref))}`;
  const equipmentUrl = (ref) => `${SITE}/equipment?${query(base(ref))}`;
  const itemUrl = (ref, s) =>
    `${SITE}/equipment/item?${query({ ...base(ref), id: s.id, enchantLevel: s.enchantLevel ?? s.enchant ?? 0, slotPos: s.slotPos })}`;
  const boardUrl = (ref, boardId) => `${SITE}/daevanion/detail?${query({ ...base(ref), boardId })}`;

  const strip = (s) => String(s ?? "").replace(/<[^>]*>/g, "").trim();
  const int = (v) => {
    const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  /** An answer's character id is URL-escaped ("...rA%3D"); the addresses
   *  take it plain (URLSearchParams escapes it again). */
  const plainId = (id) => {
    try { return decodeURIComponent(String(id || "")); } catch { return String(id || ""); }
  };
  const absolute = (url, origin) => (!url ? null : /^https:\/\//.test(url) ? url : `${origin}${url.startsWith("/") ? "" : "/"}${url}`);

  /** The search's match for a name on a server (the name exactly, any
   *  case), or null. */
  function readSearch(res, name, serverId) {
    const list = Array.isArray(res?.list) ? res.list : [];
    const want = String(name || "").toLowerCase();
    const hit = list.find((c) => strip(c.name).toLowerCase() === want && (!serverId || Number(c.serverId) === Number(serverId)));
    if (!hit) return null;
    return {
      characterId: plainId(hit.characterId), name: strip(hit.name), serverId: Number(hit.serverId), serverName: hit.serverName || "",
      level: int(hit.level), race: int(hit.race), portrait: absolute(hit.profileImageUrl, PORTRAITS),
    };
  }

  /** Every match of a name part, for looking someone up. */
  function readSearchList(res) {
    const list = Array.isArray(res?.list) ? res.list : [];
    return list.map((c) => ({ characterId: plainId(c.characterId), name: strip(c.name), serverId: Number(c.serverId),
      serverName: c.serverName || "", level: int(c.level), race: int(c.race), portrait: absolute(c.profileImageUrl, PORTRAITS) }));
  }

  /** The info page: profile, stats, titles, the Daevanion boards' summary. */
  function readInfo(res) {
    if (!res || typeof res !== "object" || !res.profile) return null;
    const p = res.profile;
    const stats = {};
    let gs = null;
    for (const s of res.stat?.statList || []) {
      if (s.type === "ItemLevel") gs = int(s.value);
      else stats[s.type] = { name: s.name || s.type, value: int(s.value), effects: s.statSecondList || [] };
    }
    const titles = {
      owned: int(res.title?.ownedCount), total: int(res.title?.totalCount),
      list: (res.title?.titleList || []).map((t) => ({
        id: t.id, name: t.name, grade: t.grade, category: t.equipCategory, owned: int(t.ownedCount), total: int(t.totalCount),
        stats: (t.statList || []).map((x) => x.desc), equipStats: (t.equipStatList || []).map((x) => x.desc),
      })),
    };
    return {
      profile: {
        characterId: plainId(p.characterId), name: p.characterName, level: int(p.characterLevel), className: p.className,
        race: p.raceName, serverId: int(p.serverId), serverName: p.serverName, legion: p.regionName || "", title: p.titleName || "",
        titleGrade: p.titleGrade || "", cp: int(p.combatPower), gs, portrait: absolute(p.profileImage, PORTRAITS),
      },
      stats, titles,
      boards: (res.daevanion?.boardList || []).map((b) => ({ id: b.id, name: b.name, icon: b.icon || null,
        open: int(b.openNodeCount), total: int(b.totalNodeCount) })),
      rankings: (res.ranking?.rankingList || []).map((r) => ({ name: r.rankingContentsName, rank: int(r.rank), grade: r.gradeName || "" })),
    };
  }

  /** The equipment page: the worn pieces (Arcana from slot 41 on), skills,
   *  pet and wings. */
  function readEquipment(res) {
    if (!res || typeof res !== "object" || !res.equipment) return null;
    const slots = (res.equipment.equipmentList || []).map((s) => ({
      slotPos: s.slotPos, slot: s.slotPosName, id: s.id, name: s.name, grade: s.grade,
      enchant: int(s.enchantLevel), amplify: int(s.exceedLevel), icon: s.icon || null,
      arcana: int(s.slotPos) >= 41 || /^Arcana/.test(s.slotPosName || ""),
    }));
    const skills = (res.skill?.skillList || []).map((s) => ({
      id: s.id, name: s.name, category: s.category, level: int(s.skillLevel), needLevel: int(s.needLevel),
      acquired: !!s.acquired, equipped: !!s.equip, icon: s.icon || null,
    }));
    const pw = res.petwing || {};
    return {
      slots, skills,
      pet: pw.pet ? { name: pw.pet.name, level: int(pw.pet.level), icon: pw.pet.icon || null } : null,
      wing: pw.wing ? { name: pw.wing.name, grade: pw.wing.grade, enchant: int(pw.wing.enchantLevel), icon: pw.wing.icon || null } : null,
    };
  }

  /** One piece's own page: item level, tops, stats, stones, extra skills. */
  function readItem(res, slot) {
    const it = { ...slot };
    if (!res || typeof res !== "object") return it;
    it.name = res.name || it.name;
    it.grade = res.grade || it.grade;
    it.il = int(res.level);
    it.maxEnchant = int(res.maxEnchantLevel);
    it.maxAmplify = int(res.maxExceedEnchantLevel);
    it.category = res.categoryName || "";
    it.equipLevel = int(res.equipLevel);
    it.tradable = !!res.tradable;
    it.icon = res.icon || it.icon;
    it.main = (res.mainStats || []).map((m) => ({ id: m.id, name: m.name, value: m.value, extra: m.extra, min: m.minValue || null }));
    it.sub = (res.subStats || []).map((m) => ({ id: m.id, name: m.name, value: m.value }));
    it.subSkills = (res.subSkills || []).map((k) => ({ id: k.id, name: k.name, level: int(k.level), icon: k.icon || null }));
    it.stones = (res.magicStoneStat || []).map((m) => ({ name: m.name, value: m.value, grade: m.grade, icon: m.icon || null }));
    it.stoneSlots = int(res.magicStoneSlotCount);
    it.theostones = (res.godStoneStat || []).map((g) => ({ name: g.name, desc: g.desc || "", grade: g.grade, icon: g.icon || null }));
    it.theostoneSlots = int(res.godStoneSlotCount);
    it.sources = res.sources || [];
    return it;
  }

  /** One Daevanion board: its nodes (open or not, what each gives) and the
   *  points spent (Common 1, Rare 2, Legend 3, Unique 4 a node). */
  function readBoard(res, summary) {
    const P = { Common: 1, Rare: 2, Legend: 3, Unique: 4 };
    const nodes = (res?.nodeList || []).filter((n) => n.type && n.type !== "None").map((n) => ({
      id: n.nodeId, type: n.type, grade: n.grade, open: !!n.open, name: n.name || "", row: n.row, col: n.col,
      effects: (n.effectList || []).map((e) => e.desc),
    }));
    const real = nodes.filter((n) => n.type !== "Start");
    return {
      id: summary?.id ?? real[0]?.id, name: summary?.name || "", icon: summary?.icon || null,
      open: real.filter((n) => n.open).length, total: real.length,
      points: real.filter((n) => n.open).reduce((a, n) => a + (P[n.grade] || 0), 0),
      maxPoints: real.reduce((a, n) => a + (P[n.grade] || 0), 0),
      nodes,
      skillEffects: (res?.openSkillEffectList || []).map((e) => e.desc),
      statEffects: (res?.openStatEffectList || []).map((e) => e.desc),
    };
  }

  /** The parts read as one snapshot of the character. */
  function snapshotOf({ info, equipment, items, boards, at }) {
    const byPos = new Map((items || []).map((it) => [it.slotPos, it]));
    return {
      at: at || Date.now(),
      profile: info?.profile || null,
      stats: info?.stats || {},
      titles: info?.titles || { owned: 0, total: 0, list: [] },
      rankings: info?.rankings || [],
      items: (equipment?.slots || []).map((s) => byPos.get(s.slotPos) || s),
      skills: equipment?.skills || [],
      pet: equipment?.pet || null,
      wing: equipment?.wing || null,
      boards: boards || [],
    };
  }

  /** A storage key for a character: server and name, in the characters a
   *  key may hold. */
  const keyOf = (serverId, name) => `c-${Number(serverId) || 0}-${String(name || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}`;

  globalThis.ArmoryNC = Object.freeze({
    regionOf, searchUrl, infoUrl, equipmentUrl, itemUrl, boardUrl, readSearch, readSearchList, readInfo, readEquipment,
    readItem, readBoard, snapshotOf, keyOf, plainId,
  });
})();
