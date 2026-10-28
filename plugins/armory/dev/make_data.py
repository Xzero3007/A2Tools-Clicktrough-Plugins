#!/usr/bin/env python3
"""Builds the Armory plugin's data.js: the game's enhance tables (Enchant),
the Amplified Enhance tables (+16 and on), what each level adds, and every
enhanceable item (id, name, grade, slot, item level, icon, its tables).

The tables are the game's own, read from AION 2's files by Aion2Data
(aion2data.com, unofficial), which serves them as one file for its enhance
calculator. Also what each stat does, in the game's own words (its stat
descriptions, as Aion2Data's stats page lists them). Game data and art
belong to NCSOFT.

  python3 -I dev/make_data.py <cache folder> [--fetch] [--questlog <file>]

Also the soul binding lists (which stats, in which range and by which
weight, and which skill effects each item's soul binding can give), from the
game's item data as questlog.gg's item database holds it: --questlog takes
a file the "Armory probe" bookmark saved on a questlog.gg build page (its
item database rides along) and keeps what is needed in the cache folder
(questlog-soul.json). And what the strongest players of a class keep on
each piece, from dev/top_players.py (<cache>/top/top.json), counted.

--fetch downloads https://aion2data.com/tools/enchant/data.json and
https://aion2data.com/stats into the cache folder first (and the game version
from its text calculator). Without it the cached files are used.
"""
import html as H
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
SOURCE = "https://aion2data.com/tools/enchant/data.json"
VERSION = "https://aion2data.com/calc/tools/enchant?item=110430051&from=14&to=15&format=json"
STATS = "https://aion2data.com/stats"


def fetch(url, path):
    last = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Clicktrough Armory data build"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            with open(path, "wb") as f:
                f.write(body)
            return
        except Exception as e:  # the site drops a connection now and then
            last = e
            time.sleep(3 + attempt * 2)
    raise SystemExit(f"could not download {url}: {last}")


def glossary(page):
    """The stats page: each stat's name, its key in the game (the one NC's
    pages use for an item's stats too), its group in the character window and
    the game's description. [[name, key, group, description], ...]"""
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', page)
    payload = "".join(json.loads('"' + c + '"') for c in chunks)
    keys = dict((i, k) for k, i in re.findall(r'\["\$","li","([^"]*)",\{"id":"([^"]*)"', payload))
    body = re.sub(r"<script\b.*?</script>", "", page.split("</head>", 1)[-1], flags=re.S)
    text = lambda s: H.unescape(re.sub(r"<[^>]+>", "", s)).strip()
    out = []
    for sec in re.finditer(r'<section[^>]*data-tab="([^"]+)"[^>]*>(.*?)</section>', body, re.S):
        group = H.unescape(sec.group(1))
        for li in re.finditer(r'<li[^>]*\bid="([^"]+)"[^>]*>(.*?)</li>', sec.group(2), re.S):
            a = re.search(r'<a[^>]*href="/stats/[^"]*"[^>]*>(.*?)</a>', li.group(2), re.S)
            p = re.search(r'<p[^>]*>(.*?)</p>', li.group(2), re.S)
            if a and p:
                desc = text(re.sub(r"<br\s*/?>", "\n", p.group(1)))
                out.append([text(a.group(1)), keys.get(li.group(1)) or "", group, desc])
    if len(out) < 150:
        raise SystemExit(f"the stats page gave only {len(out)} stats: its layout changed?")
    return out


def soul_from_questlog(path):
    """The soul binding lists from a probe file's questlog.gg item database:
    { stats: [name, ...], pools: [[[stat index, min, max, weight], ...]],
      pct: [stat index, ...] (values in hundredths of a percent),
      items: { id: [pool index or -1, properties, skill group] },
      skills: { group: { class: [[skill name, weight, top level], ...] } },
      statIds: { questlog's stat id: [name, 1 when in hundredths of a percent] },
      skillIds: { skill id: name } (the ids read a questlog.gg build),
      arcana: { id: [name, grade, item level, icon] } (Aion2Data's list has
      no Arcana),
      manastones: { "<stat id>:<value>": grade } (a Manastone's grade by what
      it gives), theostones: { id: grade },
      icons: { id: icon } (the game's own icon name, where Aion2Data's list
      names another: the game's icon server knows only the game's) }"""
    d = json.load(open(path, encoding="utf-8"))
    p = d.get("payload") or {}
    pick = lambda prefix: next((v for k, v in p.items() if k.startswith(prefix)), None)
    items = pick("characterBuilder.getEquipmentItems")
    subskills = pick("characterBuilder.getItemSubStatSkills")
    skills = pick("skillBuilder.getSkills")
    fmt = p.get("statFormat-en") or {}
    if not items or not subskills or not skills or not fmt:
        raise SystemExit(f"{path}: not a probe file with questlog.gg's item database")
    names = {s["id"]: s["name"] for s in skills}
    stat_index, stat_names, pct = {}, [], set()
    def stat(sid):
        if sid not in stat_index:
            f = fmt.get(sid) or {}
            stat_index[sid] = len(stat_names)
            stat_names.append(f.get("name") or sid)
            if "percent" in (f.get("indicator") or ""):
                pct.add(stat_index[sid])
        return stat_index[sid]
    pools, pool_index, out_items = [], {}, {}
    for it in items:
        info = it.get("equipmentInfo") or {}
        st = it.get("itemStats") or {}
        stats = st.get("subStats") or []
        count = info.get("soulbindRandomStatCount") or 0
        skills_count = info.get("soulbindRandomSkillCount") or 0
        group = st.get("subSkillGroup") or ""
        if not (stats and count) and not (group and skills_count):
            continue
        pool = tuple(sorted((stat(x["id"]), x["minValue"], x["maxValue"], x["randomWeight"]) for x in stats if x.get("type") == "stat"))
        if pool and pool not in pool_index:
            pool_index[pool] = len(pools)
            pools.append([list(x) for x in pool])
        out_items[it["id"]] = [pool_index[pool] if pool else -1, max(count, skills_count), group]
    groups = {}
    for x in subskills:
        name = names.get(x["id"])
        if name:
            groups.setdefault(x["group"], {}).setdefault(x["class"], []).append([name, x["randomProb"], x.get("levelMaxValue") or 1])
    used = {v[2] for v in out_items.values()}
    grades = {11: "Common", 21: "Rare", 31: "Legend", 41: "Unique", 51: "Epic", 71: "Special"}
    arcana = {str(it["id"]): [it.get("name") or "", grades.get(it.get("grade"), ""), (it.get("equipmentInfo") or {}).get("itemLevel") or 0,
                              (it.get("icon") or "").rsplit(".", 1)[-1]]
              for it in items if it.get("mainCategory") == "arcana"}
    manastones = {}
    for it in items:
        if it.get("subCategory") != "magicstone":
            continue
        for st in (it.get("usableInfo") or {}).get("magicStoneStats") or []:
            for g in st.get("stats") or []:
                key = f'{st["statId"]}:{g["value"]}'
                manastones[key] = max(manastones.get(key, ""), grades.get(g["grade"], ""), key=lambda x: list(grades.values()).index(x) if x in grades.values() else -1)
    theostones = {str(it["id"]): grades.get(it.get("grade"), "") for it in items if it.get("subCategory") == "getgodstone"}
    icons = {str(it["id"]): (it.get("icon") or "").rsplit(".", 1)[-1] for it in items if it.get("icon")}
    stat_ids = {sid: [f.get("name") or sid, 1 if "percent" in (f.get("indicator") or "") else 0]
                for sid, f in fmt.items() if isinstance(f, dict) and not f.get("isDisabled")}
    return {"stats": stat_names, "pct": sorted(pct), "pools": pools, "items": out_items,
            "skills": {g: v for g, v in groups.items() if g in used},
            "statIds": stat_ids, "skillIds": {str(k): v for k, v in names.items()}, "arcana": arcana,
            "manastones": manastones, "theostones": theostones, "icons": icons}


def steps(rows, with_stats=False):
    """A table's steps as [chance /10000, + chance per failure, levels lost on
    failure, Kinah, [[material, count], ...]] (and the stats it gives)."""
    out = []
    for r in rows:
        step = [r["p"], r["corr"], r["pen"], r["gold"], [[i["key"], i["count"]] for i in r["items"]]]
        if with_stats:
            step.append(r.get("stats", []))
        out.append(step)
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    data_path = os.path.join(cache, "enchant_data.json")
    version_path = os.path.join(cache, "enchant_version.json")
    stats_path = os.path.join(cache, "stats.html")
    if "--fetch" in sys.argv or not os.path.exists(data_path):
        fetch(SOURCE, data_path)
        fetch(VERSION, version_path)
    if "--fetch" in sys.argv or not os.path.exists(stats_path):
        fetch(STATS, stats_path)
    soul_path = os.path.join(cache, "questlog-soul.json")
    if "--questlog" in sys.argv:
        soul = soul_from_questlog(sys.argv[sys.argv.index("--questlog") + 1])
        json.dump(soul, open(soul_path, "w", encoding="utf-8"), ensure_ascii=False)
    soul = json.load(open(soul_path, encoding="utf-8")) if os.path.exists(soul_path) else None
    top_path = os.path.join(cache, "top", "top.json")
    top = json.load(open(top_path, encoding="utf-8")) if os.path.exists(top_path) else None
    d = json.load(open(data_path, encoding="utf-8"))
    version = ""
    if os.path.exists(version_path):
        version = json.load(open(version_path, encoding="utf-8")).get("build", "")

    mats = {}
    for key, m in d["costItems"].items():
        item_id = int(m["slug"].split("-", 1)[0]) if m.get("slug") else None
        mats[key] = {"name": m["name"], "id": item_id, "bound": "(Bound)" in m["name"]}

    items = {}
    for row in d["items"]:
        item_id, name, _slug, grade, cat, il, icon, enchant, effect, exceed = row
        icon = os.path.splitext(os.path.basename(icon or ""))[0]
        items[str(item_id)] = [name, grade, cat, il, icon, enchant, effect, exceed]

    effects = {}
    for key, levels in d["effects"].items():
        effects[key] = [lv["stats"] for lv in sorted(levels, key=lambda lv: lv["il"])]

    if soul and soul.get("icons"):
        soul = {**soul, "icons": {k: v for k, v in soul["icons"].items() if k in items and v and v != items[k][4]}}
    out = {
        "version": version,
        "source": "Aion2Data (aion2data.com), read from AION 2's game files",
        "mats": mats,
        "stats": {k: [v["name"], 1 if v.get("pct") else 0, v.get("div", 1)] for k, v in d["stats"].items()},
        "enchant": {k: steps(v) for k, v in d["groups"].items()},
        "amplify": {k: steps(v, True) for k, v in d["exceed"].items()},
        "effects": effects,
        "items": items,
        "glossary": glossary(open(stats_path, encoding="utf-8").read()),
        "soul": soul,
        "top": top,
    }
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(PLUGIN, "data.js"), "w", encoding="utf-8") as f:
        f.write("// Built by dev/make_data.py: the game's enhance tables and enhanceable items,\n")
        f.write("// read from AION 2's files by Aion2Data (aion2data.com). Game data: NCSOFT.\n")
        f.write("globalThis.ARMORY_DATA = " + text + ";\n")
    top_note = ", ".join(f"{k} {v['n']}" for k, v in (top or {}).get("classes", {}).items()) or "none"
    print(f"data.js: {len(items)} items, {len(out['enchant'])} enhance tables, "
          f"{len(out['amplify'])} amplify tables, {len(out['glossary'])} stats explained, "
          f"{len(soul['items']) if soul else 0} soul binding lists ({len(soul['pools']) if soul else 0} kinds), "
          f"top players: {top_note}, "
          f"game version {version or '?'}, {len(text) // 1024} KB")


if __name__ == "__main__":
    main()
