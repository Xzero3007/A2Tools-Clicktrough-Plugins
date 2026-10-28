"""Downloads what the Map takes from Aion 2 Timers' interactive map into a
cache folder, for dev/make_data.py --a2t <cache>:

    python3 -I dev/fetch_aion2timers.py <cache> [<map id>:<zoom> ...]

maps.json and positions/<id>.json of every map with something on it (each
map's spawn groups, points and labels, as the game client has them), the
game's minimap symbols its points are drawn with (icons/), and,
for the maps given, the tiles of one zoom level (tiles/<id>/<zoom>/<x>_<y>.webp,
256 px each; the highest zoom is the whole picture at full size). A file
already in the cache isn't fetched again; one request at a time, a little
apart. Nothing else is sent: plain downloads.
"""
import json
import os
import sys
import time
import urllib.request

BASE = "https://www.aion2timers.com/map/data/"
UA = "Clicktrough Map plugin build"


def fetch(cache, path, pause=0.15):
    local = os.path.join(cache, path)
    if os.path.exists(local) and os.path.getsize(local):
        return open(local, "rb").read()
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            break
        except OSError:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    os.makedirs(os.path.dirname(local), exist_ok=True)
    with open(local, "wb") as f:
        f.write(data)
    time.sleep(pause)
    return data


def main():
    cache = sys.argv[1]
    catalog = json.loads(fetch(cache, "maps.json"))
    icons = set()
    for m in catalog["maps"]:
        if not m.get("empty"):
            pos = json.loads(fetch(cache, m["data"]))
            icons.update(p["iconPath"] for p in pos.get("points", []) if p.get("iconPath"))
    # The game's minimap symbols its points are drawn with.
    for path in sorted(icons):
        fetch(cache, path)
    by_id = {str(m["id"]): m for m in catalog["maps"]}
    for arg in sys.argv[2:]:
        mid, zoom = arg.split(":")
        m = by_id[mid]
        n = max(1, (m["image"]["width"] // m["image"]["tile_size"]) >> (m["image"]["max_zoom"] - int(zoom)))
        for x in range(n):
            for y in range(n):
                fetch(cache, m["tiles"].format(z=zoom, x=x, y=y))
        print(f"map {mid} zoom {zoom}: {n} x {n} tiles", flush=True)
    print(f"build {catalog.get('build')}, {sum(1 for m in catalog['maps'] if not m.get('empty'))} maps")


if __name__ == "__main__":
    main()
