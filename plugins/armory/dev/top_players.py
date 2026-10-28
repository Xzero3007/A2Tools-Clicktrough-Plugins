#!/usr/bin/env python3
"""What the strongest players of a class wear: the soul bindings they keep on
each piece, the items, their skill levels and where the extra levels come
from. For the Armory's suggestions (data.js "top"), counted, with no names.

Who: Shugo.GG's combat power leaderboard (its top 100 of Global, built from
NC's own combat power), the players of the classes asked for. What: NC's
character pages (the official AION 2 site's character info), as the Armory
reads them in the meter. Only the counts are kept in the output; the
characters' pages stay in the cache folder (never commit it).

  python3 -I dev/top_players.py <cache folder> [ranger ...] [--fetch]

--fetch reads the leaderboard and the characters again (slowly: about 25
pages a character); without it the cache is used. Writes <cache>/top.json.
"""
import collections
import glob
import html
import json
import os
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request

LEADERBOARD = "https://shugo.gg/leaderboard"
SEARCH = "https://api-search.plaync.com/aion2global/search/v2/character"
SITE = "https://aion2.plaync.com/api/character"
GROUP = {"Earring1": "Earrings", "Earring2": "Earrings", "Ring1": "Rings", "Ring2": "Rings",
         "Bracelet1": "Bracelets", "Bracelet2": "Bracelets", "Rune1": "Runes", "Rune2": "Runes"}


def get(url, as_json=True):
    for attempt in range(4):
        try:
            time.sleep(0.3)
            req = urllib.request.Request(url, headers={"User-Agent": "Clicktrough Armory data build"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read()
            return json.loads(body) if as_json else body.decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 + attempt * 2)
        except Exception:
            time.sleep(2 + attempt * 2)
    return None


def leaderboard(cache):
    """The leaderboard's characters: region, server, name, class, combat power."""
    path = os.path.join(cache, "leaderboard.html")
    if "--fetch" in sys.argv or not os.path.exists(path):
        page = get(LEADERBOARD, as_json=False)
        if not page:
            raise SystemExit("the leaderboard did not answer")
        open(path, "w", encoding="utf-8").write(page)
    page = open(path, encoding="utf-8").read()
    links = re.findall(r'href="https://shugo.gg/character/global/([a-z]+)-([a-z]+)/([^"]+)"', page)
    text = [t.strip() for t in re.sub(r"<[^>]+>", "\n", re.sub(r"<script\b.*?</script>", "", page, flags=re.S)).split("\n") if t.strip()]
    out, seen = [], set()
    for region, server, name in links:
        name = urllib.parse.unquote(name)
        if (server, name) in seen:
            continue
        seen.add((server, name))
        shown = html.escape(name, quote=False)
        i = text.index(shown) if shown in text else (text.index(name) if name in text else -1)
        if i < 0:
            continue
        out.append({"region": region, "server": server, "name": name, "class": text[i + 1]})
    return out


def read_character(c, path):
    q = urllib.parse.urlencode({"keyword": c["name"], "page": 1, "size": 40, "region": c["region"], "localeInfo": "en-US"})
    res = get(f"{SEARCH}?{q}") or {}
    hit = next((x for x in res.get("list", []) if re.sub(r"<[^>]+>", "", x["name"]) == c["name"]
                and x.get("serverName", "").lower() == c["server"].lower()), None)
    if not hit:
        json.dump({"top": c, "missing": True}, open(path, "w"))
        return
    base = {"lang": "en-US", "region": c["region"], "serverId": hit["serverId"], "characterId": urllib.parse.unquote(hit["characterId"])}
    info = get(f"{SITE}/info?" + urllib.parse.urlencode(base))
    eq = get(f"{SITE}/equipment?" + urllib.parse.urlencode(base))
    items = {}
    for s in (eq or {}).get("equipment", {}).get("equipmentList", []):
        items[str(s["slotPos"])] = get(f"{SITE}/equipment/item?" + urllib.parse.urlencode(
            {**base, "id": s["id"], "enchantLevel": s["enchantLevel"], "slotPos": s["slotPos"]}))
    json.dump({"top": c, "info": info, "eq": eq, "items": items}, open(path, "w"))


def share(count, n):
    return round(count / n, 3) if n else 0


def aggregate(rows):
    """The counts of one class's characters."""
    n = len(rows)
    slot_n = collections.Counter()
    items = collections.defaultdict(collections.Counter)
    stats = collections.defaultdict(collections.Counter)
    values = collections.defaultdict(lambda: collections.defaultdict(list))
    skills = collections.defaultdict(collections.Counter)
    arcana_n = collections.Counter()
    arcana_items = collections.defaultdict(collections.Counter)
    arcana_skills = collections.defaultdict(collections.Counter)
    levels = collections.defaultdict(list)
    category = {}
    sources = collections.defaultdict(collections.Counter)
    cps = []
    for r in rows:
        cps.append(r["info"]["profile"]["combatPower"])
        for s in r["eq"]["skill"]["skillList"]:
            levels[s["name"]].append(s["skillLevel"])
            category[s["name"]] = s["category"]
        for s in r["eq"]["equipment"]["equipmentList"]:
            d = r["items"].get(str(s["slotPos"])) or {}
            if s["slotPosName"].startswith("Arcana"):
                card = d.get("categoryName") or "Arcana"
                arcana_n[card] += 1
                arcana_items[card][s["name"]] += 1
                for k in d.get("subSkills") or []:
                    arcana_skills[card][k["name"]] += 1
                    sources[k["name"]][f"Arcana: {card}"] += k.get("level", 0)
                continue
            g = GROUP.get(s["slotPosName"], s["slotPosName"])
            slot_n[g] += 1
            items[g][s["name"]] += 1
            for m in d.get("subStats") or []:
                stats[g][m["name"]] += 1
                values[g][m["name"]].append(m["value"])
            for k in d.get("subSkills") or []:
                skills[g][k["name"]] += 1
                sources[k["name"]][g] += k.get("level", 0)

    def median_value(vals):
        nums = [float(re.sub(r"[^\d.]", "", v) or 0) for v in vals]
        m = statistics.median(nums) if nums else 0
        pct = any("%" in v for v in vals)
        return (f"{m:.2f}".rstrip("0").rstrip(".") + "%") if pct else str(int(round(m)))

    out = {"n": n, "cp": [min(cps), int(statistics.median(cps)), max(cps)], "slots": {}, "arcana": {}, "skills": {}}
    for g, count in slot_n.items():
        out["slots"][g] = {
            "items": [[k, share(c, count)] for k, c in items[g].most_common(4)],
            "stats": [[k, share(c, count), median_value(values[g][k])] for k, c in stats[g].most_common(10)],
            "skills": [[k, share(c, count)] for k, c in skills[g].most_common(8)],
        }
    for card, count in arcana_n.items():
        out["arcana"][card] = {
            "items": [[k, share(c, count)] for k, c in arcana_items[card].most_common(4)],
            "skills": [[k, share(c, count)] for k, c in arcana_skills[card].most_common(10)],
        }
    for name, lv in levels.items():
        out["skills"][name] = [category[name], statistics.median(lv), share(sum(1 for v in lv if v >= 20), len(lv)),
                               share(sum(1 for v in lv if v >= 16), len(lv)),
                               [[w, c] for w, c in sources[name].most_common(5)]]
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cache = sys.argv[1]
    classes = [a.lower() for a in sys.argv[2:] if not a.startswith("--")] or ["ranger"]
    os.makedirs(os.path.join(cache, "chars"), exist_ok=True)
    board = leaderboard(cache)
    result = {"source": "Shugo.GG's combat power leaderboard (Global top 100) and NC's character pages",
              "at": time.strftime("%Y-%m-%d"), "classes": {}}
    for cls in classes:
        wanted = [c for c in board if c["class"].lower() == cls]
        rows = []
        for c in wanted:
            key = re.sub(r"[^\w-]", "_", f'{c["region"]}-{c["server"]}-{c["name"]}')
            path = os.path.join(cache, "chars", f"{key}.json")
            if "--fetch" in sys.argv or not os.path.exists(path):
                read_character(c, path)
            r = json.load(open(path))
            if not r.get("missing") and r.get("eq") and r.get("info"):
                rows.append(r)
        if rows:
            result["classes"][cls] = aggregate(rows)
        print(f"{cls}: {len(rows)} of {len(wanted)} characters read")
    json.dump(result, open(os.path.join(cache, "top.json"), "w"), ensure_ascii=False)


if __name__ == "__main__":
    main()
