"""Downloads Aion2Data's item lists (aion2data.com/items, one page per
category) into a cache folder and writes <cache>/icons.json: item id -> the
game's icon name (as the game's icon server names it). Aion2Data reads them
from AION 2's game files (an unofficial fan reference, not affiliated with
NCSOFT).

  python3 -I dev/fetch_icons.py <cache folder>

make_data.py reads <cache>/icons.json. A page already in the cache is not
downloaded again (delete it to refresh).
"""
import json, os, re, sys, time, urllib.request

BASE = "https://aion2data.com"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Clicktrough-Inventory-data/1 (one-off build)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf8", "replace")


def main():
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    index_path = os.path.join(cache, "items.html")
    if not os.path.exists(index_path):
        open(index_path, "w").write(get(f"{BASE}/items"))
    index = open(index_path).read()
    cats = sorted(set(re.findall(r'href="/items/c/([a-z0-9-]+)"', index)))
    icons = {}
    for c in cats:
        path = os.path.join(cache, f"c-{c}.html")
        if not os.path.exists(path):
            open(path, "w").write(get(f"{BASE}/items/c/{c}"))
            time.sleep(1.0)
        page = open(path).read()
        for item, inner in re.findall(r'<a[^>]*href="/items/(\d+)-[^"]*"[^>]*>(.*?)</a>', page, re.S):
            m = re.search(r"/game/items/[a-z0-9_-]+/(Icon_[A-Za-z0-9_]+)\.(?:webp|png)", inner)
            if m:
                icons.setdefault(item, m.group(1))
        print(f"{c}: {len(icons)} items so far", file=sys.stderr)
    json.dump(icons, open(os.path.join(cache, "icons.json"), "w"), sort_keys=True)
    print(f"{len(icons)} icons from {len(cats)} categories")


if __name__ == "__main__":
    main()
