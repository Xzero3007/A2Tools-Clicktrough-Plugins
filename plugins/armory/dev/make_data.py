#!/usr/bin/env python3
"""Builds the Armory plugin's data.js: the game's enhance tables (Enchant),
the Amplified Enhance tables (+16 and on), what each level adds, and every
enhanceable item (id, name, grade, slot, item level, icon, its tables).

The tables are the game's own, read from AION 2's files by Aion2Data
(aion2data.com, unofficial), which serves them as one file for its enhance
calculator. Also what each stat does, in the game's own words (its stat
descriptions, as Aion2Data's stats page lists them). Game data and art
belong to NCSOFT.

  python3 -I dev/make_data.py <cache folder> [--fetch]

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
    }
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(PLUGIN, "data.js"), "w", encoding="utf-8") as f:
        f.write("// Built by dev/make_data.py: the game's enhance tables and enhanceable items,\n")
        f.write("// read from AION 2's files by Aion2Data (aion2data.com). Game data: NCSOFT.\n")
        f.write("globalThis.ARMORY_DATA = " + text + ";\n")
    print(f"data.js: {len(items)} items, {len(out['enchant'])} enhance tables, "
          f"{len(out['amplify'])} amplify tables, {len(out['glossary'])} stats explained, "
          f"game version {version or '?'}, {len(text) // 1024} KB")


if __name__ == "__main__":
    main()
