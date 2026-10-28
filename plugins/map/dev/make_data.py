"""Builds the Map plugin's data.js and tiles/ from a checkout of SkeeveAN's
Aion-DPS-Meter (MIT, https://github.com/SkeeveAN/Aion-DPS-Meter) and of the
AION2 Interactive Map (its data CC BY-NC 4.0,
https://github.com/aion2-interactive-map/aion2-interactive-map), and the
game's own map pictures as that map publishes them (its gh-pages branch).

    python3 -I dev/make_data.py <Aion-DPS-Meter checkout> <plugin folder> \
        [--aim <aion2-interactive-map checkout>] \
        [--game-maps <aion2-interactive-map gh-pages checkout>] [--no-tiles]

What it takes (Client/assets/aion2/ of SkeeveAN's repo), English names only:
  maps/maps.json, maps/instances.json  the maps: tiles, grid, world -> pixel
                                       (pixel = offset + scale * world)
  maps/<key>/<col>_<row>.jpg, _a.png   the map pictures and their masks (the
                                       sea transparent), as WebP with the mask
                                       as alpha (WebKitGTK draws no CSS masks
                                       from a plugin's own scheme), at full
                                       size and small for the zoomed-out view
                                       (tiles/<key>/lo/)
  pets/spawns.json, pets/pets.json     the spawn points of the pet monsters,
                                       the pets and which monsters drop them
  maps/gather.json                     gathering spots by kind
  maps/kibelisks.json                  Kibelisk camps
  bosses/field_bosses.json             the field bosses' places, by world map
  npcs/npc_names.json                  monster names (for monsters around)
  zones/zones.json                     zone names

With --game-maps: the game's own world map pictures (UI/Map/WorldMap/<name>/
Res/<name>_<col>_<row>.webp, 1024 px tiles) of Verteron, Altgard, the Abyss,
Poeta and Ishalgen, whole: SkeeveAN's are the same pictures, but taken as a
player had explored them, so Altgard had dark holes (Black Claw Village,
Immortal Isle ...). Where SkeeveAN's tile is sharper (Verteron, 2048 px), it
goes over the game's (upscaled) where its mask has land. Each picture covers
a rectangle of the world, GAME_MAPS (the bounds the map sites use, as the
client has them): one pixel is 99.6 cm on every map, and that is the
calibration of these maps. It agrees with the Kibelisks of both sources (6
to 8 m apart on average) and puts 99 % of the spawn points of Verteron and
the Abyss on land; SkeeveAN's own fit was 2 % too small (up to 90 m off at
Altgard's edges).

From the AION2 Interactive Map (public/data, English names from
public/locales/en), with --aim: the Hidden Cube spots, the Monolith pieces,
the sealed dungeons, battlefields, outposts and villages, and the regions
(their names and outlines). Its places are pixels of the game's own map
pictures; turned into game coordinates with the calibration above (without
--game-maps, one fitted to its Kibelisks and SkeeveAN's, see calibrate()).

--no-tiles leaves tiles/ as it is (data.js only).

It writes dev/provenance.json with the revisions and a SHA-256 of every file
it read, so a rebuild can be checked against the same sources.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

from PIL import Image

args = sys.argv[1:]
NO_TILES = "--no-tiles" in args
AIM = args[args.index("--aim") + 1] if "--aim" in args else None
GAME = args[args.index("--game-maps") + 1] if "--game-maps" in args else None
SRC, OUT = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--aim", "--game-maps"))][:2]
ASSETS = os.path.join(SRC, "Client", "assets", "aion2")
LO = 512  # px per tile of the zoomed-out copies
QUALITY = 72  # WebP

read = {}


def load(rel):
    path = os.path.join(ASSETS, rel)
    data = open(path, "rb").read()
    read[rel] = hashlib.sha256(data).hexdigest()
    return json.loads(data)


def en(names):
    return (names or {}).get("en") or ""


# Hidden Cubes: the object ids the client names "Hidden Cube" (SkeeveAN,
# Aion2FrameDecoder.IsHiddenCube).
CUBES = [*range(1200036, 1200042), 1200667, 1200707, *range(1201502, 1201506), *range(1300081, 1300084), 1300754,
         1301199, 1301200, *range(1301242, 1301246), 1100056, 1100094]

# Open-world zone ids -> map (SkeeveAN Aion2Maps.OfZone; the Abyss's three
# layers, Poeta and Ishalgen from zones.json); instances bring their own.
WORLD_ZONES = {1010: "verteron", 902: "verteron", 1110: "altgard", 901: "altgard", 20: "abyss", 22: "abyss", 23: "abyss",
               100001: "poeta", 100002: "poeta", 1100: "ishalgen", 110001: "ishalgen"}

# The game's own map pictures (--game-maps): map -> (picture, title, the
# client's spawn table, the world rectangle it covers: x0, y0, x1, y1 in cm,
# x to the right, y down).
GAME_MAPS = {
    "verteron": ("World_L_A", "Verteron", "World/World_L/World_L_A", (-408000, -408000, 408000, 408000)),
    "altgard": ("World_D_A", "Altgard", "World/World_D/World_D_A", (-408000, -408000, 408000, 408000)),
    "abyss": ("Abyss_Reshanta_A", "Abyss", "Intersever/Abyss/Abyss_Reshanta_A", (-204000, -204000, 204000, 204000)),
    "poeta": ("World_L_Starter", "Poeta", "World/World_L/World_L_Starter", (-204000, -204000, 204000, 204000)),
    "ishalgen": ("World_D_Starter", "Ishalgen", "World/World_D/World_D_Starter", (-329748, -257999.78125, 180252, 252000.21875)),
}

GAME_KEY = {v[0]: k for k, v in GAME_MAPS.items()}  # "World_D_A" -> "altgard"

maps_src = {**{k: {**v, "instance": False} for k, v in load("maps/maps.json")["maps"].items()},
            **{k: {**v, "instance": True} for k, v in load("maps/instances.json")["maps"].items()}}
spawns_src = load("pets/spawns.json")["maps"]
pets_src = load("pets/pets.json")
gather_src = load("maps/gather.json")
kib_src = load("maps/kibelisks.json")["maps"]
bosses_src = load("bosses/field_bosses.json")["maps"]

# The world-map boss id of each field boss's NPC code: the id the in-game map,
# a2tools.app's timers and Event Timers know it by (the meter's
# src-tauri/src/capture/field_bosses.rs, from the game's tables).
FIELD_BOSS_IDS = {
    2100003: 101001, 2100040: 101002, 2100050: 101003, 2100076: 101004, 2100077: 101005, 2100079: 101006,
    2100141: 101007, 2100177: 101008, 2100178: 101009, 2100582: 101010, 2100617: 101011, 2100661: 101012,
    2100708: 101013, 2100718: 101014, 2100876: 101015, 2100877: 101016, 2100988: 101017, 2100989: 101018,
    2100991: 101019, 2101016: 101020, 2101074: 101021, 2101120: 101022, 2101122: 101023, 2101131: 101024,
    2400017: 111001, 2400074: 111002, 2400140: 111003, 2400141: 111004, 2400212: 111005, 2400223: 111006,
    2400274: 111007, 2400335: 111008, 2400353: 111009, 2400358: 111010, 2400419: 111011, 2400424: 111012,
    2400425: 111013, 2400474: 111014, 2400504: 111015, 2400593: 111016, 2400607: 111017, 2400608: 111018,
    2400659: 111019, 2400709: 111020, 2400800: 111021, 2400853: 111022, 2400854: 111023, 2400855: 111024,
    2600068: 2001,
}
npc_src = load("npcs/npc_names.json")
zones_src = load("zones/zones.json")["zones"]

tiles_out = os.path.join(OUT, "tiles")
if not NO_TILES:
    shutil.rmtree(tiles_out, ignore_errors=True)

maps, zones, spawns, gather_points, kibelisks = {}, {}, {}, {}, {}
calibration = {}


def note(path, name):
    read[name] = hashlib.sha256(open(path, "rb").read()).hexdigest()


def skeeve_tile(jpg, mask, size, out):
    """One of SkeeveAN's tiles as WebP, its mask as alpha."""
    if NO_TILES:
        return
    im = Image.open(jpg).convert("RGB")
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    im.putalpha(Image.open(mask).convert("L").resize(im.size, Image.LANCZOS))
    im.save(out, "WEBP", quality=QUALITY, method=6)


def game_map(key, skeeve=None):
    """A map from the game's own picture (whole, the sea painted): its tiles,
    with SkeeveAN's on top where they are sharper, and its calibration from
    the rectangle it covers."""
    name, title, _, (x0, y0, x1, y1) = GAME_MAPS[key]
    folder = os.path.join(GAME, "UI", "Map", "WorldMap", name, "Res")
    files = {}
    for f in os.listdir(folder):
        m = re.fullmatch(rf"{re.escape(name)}_(\d+)_(\d+)\.webp", f)
        if m:
            files[(int(m[1]), int(m[2]))] = os.path.join(folder, f)
    grid = max(max(c, r) for c, r in files) + 1
    if len(files) != grid * grid:
        raise SystemExit(f"{name}: {len(files)} tiles, not {grid} x {grid}")
    tex = Image.open(next(iter(files.values()))).size[0]
    sharper = skeeve and skeeve["grid"] == grid and skeeve["tile"] > tex
    size = skeeve["tile"] if sharper else tex
    sk_folder = os.path.join(ASSETS, "maps", key)
    if not NO_TILES:
        os.makedirs(os.path.join(tiles_out, key, "lo"), exist_ok=True)
    names = []
    for (c, r), path in sorted(files.items()):
        n = f"{c}_{r}"
        names.append(n)
        note(path, f"game:UI/Map/WorldMap/{name}/Res/{os.path.basename(path)}")
        jpg, mask = os.path.join(sk_folder, f"{n}.jpg"), os.path.join(sk_folder, f"{n}_a.png")
        over = sharper and os.path.exists(jpg) and os.path.exists(mask)
        if over:
            note(jpg, f"maps/{key}/{n}.jpg")
            note(mask, f"maps/{key}/{n}_a.png")
        if NO_TILES:
            continue
        out = os.path.join(tiles_out, key, f"{n}.webp")
        im = Image.open(path).convert("RGB")
        if size == tex:
            shutil.copyfile(path, out)
        else:
            im = im.resize((size, size), Image.LANCZOS)
            if over:
                im.paste(Image.open(jpg).convert("RGB").resize((size, size), Image.LANCZOS), (0, 0),
                         Image.open(mask).convert("L").resize((size, size), Image.LANCZOS))
            im.save(out, "WEBP", quality=QUALITY, method=6)
        im.resize((LO, LO), Image.LANCZOS).save(os.path.join(tiles_out, key, "lo", f"{n}.webp"), "WEBP", quality=QUALITY, method=6)
    scale = grid * size / (x1 - x0)
    calibration[key] = {"bounds": [x0, y0, x1, y1], "from": "the game's map bounds"}
    return {"title": title, "tile": size, "grid": grid, "scale": scale, "ox": -x0 * scale, "oy": -y0 * scale,
            "tiles": names, "lo": LO, "instance": False, "picture": "game"}


def collect(key, tables):
    """A map's spawn points (each place once: an instance has a table per
    difficulty with the same places) and gathering spots."""
    points = {}
    for table in tables:
        for npc, pts in (spawns_src.get(table) or {}).items():
            seen = points.setdefault(npc, [])
            for p in pts:
                xy = [round(p[0]), round(p[1])]
                if xy not in [seen[i:i + 2] for i in range(0, len(seen), 2)]:
                    seen += xy
    if points:
        spawns[key] = points
    g = {}
    for table in tables:
        for env, pts in (gather_src["maps"].get(table) or {}).items():
            g.setdefault(env, [])
            for p in pts:
                g[env] += [round(p[0]), round(p[1])]
    if g:
        gather_points[key] = g
    if key in kib_src:
        kibelisks[key] = [[en(k["names"]), round(k["x"]), round(k["y"])] for k in kib_src[key]]


for key, m in maps_src.items():
    tables = m.get("tables") or [m["table"]]
    if GAME and key in GAME_MAPS:
        maps[key] = game_map(key, m)
        collect(key, tables)
        continue
    folder = os.path.join(ASSETS, "maps", key)
    names = sorted(f[:-4] for f in os.listdir(folder) if f.endswith(".jpg"))
    names = [n for n in names if os.path.exists(os.path.join(folder, f"{n}_a.png"))]
    if not names:
        continue
    if not NO_TILES:
        os.makedirs(os.path.join(tiles_out, key, "lo"), exist_ok=True)
    for n in names:
        jpg, mask = os.path.join(folder, f"{n}.jpg"), os.path.join(folder, f"{n}_a.png")
        note(jpg, f"maps/{key}/{n}.jpg")
        note(mask, f"maps/{key}/{n}_a.png")
        skeeve_tile(jpg, mask, None, os.path.join(tiles_out, key, f"{n}.webp"))
        skeeve_tile(jpg, mask, LO, os.path.join(tiles_out, key, "lo", f"{n}.webp"))
    maps[key] = {
        "title": m.get("title", key), "tile": m["tile"], "grid": m["grid"], "scale": m["scale"],
        "ox": m["offsetX"], "oy": m["offsetY"], "tiles": names, "lo": LO, "instance": m["instance"],
    }
    for z in m.get("zones") or []:
        zones[str(z)] = key
    collect(key, tables)

# Maps only the game's pictures have (Poeta, Ishalgen).
if GAME:
    for key, (_, _, table, _) in GAME_MAPS.items():
        if key not in maps:
            maps[key] = game_map(key)
            collect(key, [table, *[t for t in spawns_src if t.startswith(table + "/")]])
game_commit = None
if GAME:
    try:
        game_commit = subprocess.run(["git", "-C", GAME, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        pass

# ---------- the AION2 Interactive Map (--aim) ----------
# Its map -> ours (its pictures are the game's: GAME_MAPS).
AIM_MAPS = {key: g[0] for key, g in GAME_MAPS.items()}
AIM_PLACES = {"seal": "Sealed dungeon", "battlefield": "Battlefield", "occupation": "Outpost", "village": "Village"}
aim_commit = None
cube_spots, monoliths, places, regions = {}, {}, {}, {}


def aim_load(rel):
    data = open(os.path.join(AIM, "public", rel), "rb").read()
    read[f"aion2-interactive-map:public/{rel}"] = hashlib.sha256(data).hexdigest()
    return yaml.safe_load(data) or {}


def calibrate(key, teleports, factor):
    """World -> pixel of a map from its Kibelisks: each of SkeeveAN's (game
    coordinates) paired with the nearest of the AION2 Interactive Map's
    (pixels of the game's map picture, y up) under the fit so far, starting
    from the map's own; one scale and offset fitted to the pairs by least
    squares, three times over. None when they don't agree (too few, or more
    than 15 m apart on average). With the game's pictures the fit only checks
    their bounds; without, it replaces SkeeveAN's fit."""
    m = maps[key]
    size = m["tile"] * m["grid"]
    tel = np.array([(x * factor, size - y * factor) for x, y in teleports], float)
    kib = np.array([(x, y) for _, x, y in kibelisks.get(key, [])], float)
    if len(tel) < 10 or len(kib) < 10:
        return None
    s, ox, oy = m["scale"], m["ox"], m["oy"]
    for _ in range(3):
        px = np.c_[ox + s * kib[:, 0], oy + s * kib[:, 1]]
        d = np.sqrt(((px[:, None, :] - tel[None, :, :]) ** 2).sum(-1))
        near, j = d.min(1), d.argmin(1)
        ok = near / s / 100 < 150  # metres
        n = int(ok.sum())
        if n < 10:
            return None
        a = np.zeros((2 * n, 3))
        b = np.zeros(2 * n)
        a[:n, 0], a[:n, 2], b[:n] = 1, kib[ok, 0], tel[j[ok], 0]
        a[n:, 1], a[n:, 2], b[n:] = 1, kib[ok, 1], tel[j[ok], 1]
        (ox, oy, s), *_ = np.linalg.lstsq(a, b, rcond=None)
        rms = float(np.sqrt(((b - a @ np.array([ox, oy, s])) ** 2).mean() * 2) / s / 100)
    if rms > 15:
        return None
    return {"scale": float(s), "ox": float(ox), "oy": float(oy), "pairs": n, "rmsMetres": round(rms, 1)}


def centroid(ring):
    """The middle of a polygon (by its area), for its name."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-9:
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    return cx / (3 * a), cy / (3 * a)


if AIM:
    import numpy as np
    import yaml

    aim_sizes = {m["name"]: m["tileWidth"] * m["tilesCountX"] for m in aim_load("data/maps.yaml").get("maps") or []}
    for key, name in AIM_MAPS.items():
        if key not in maps or name not in aim_sizes:
            continue
        m = maps[key]
        size = m["tile"] * m["grid"]
        factor = size / aim_sizes[name]
        markers = aim_load(f"data/markers/{name}.yaml").get("markers") or []
        words = aim_load(f"locales/en/markers/{name}.yaml") if os.path.exists(
            os.path.join(AIM, "public", "locales", "en", "markers", f"{name}.yaml")) else {}
        fit = calibrate(key, [(mk["x"], mk["y"]) for mk in markers if mk.get("subtype") == "teleport"], factor)
        if fit and m.get("picture") == "game":
            # The Kibelisks against the bounds: how far apart their own fit
            # puts the map's corners.
            far = max(abs((fit[o] + fit["scale"] * c) - (m[o] + m["scale"] * c)) / m["scale"] / 100
                      for o, cs in (("ox", (calibration[key]["bounds"][0], calibration[key]["bounds"][2])),
                                    ("oy", (calibration[key]["bounds"][1], calibration[key]["bounds"][3]))) for c in cs)
            calibration[key]["kibelisks"] = {"pairs": fit["pairs"], "rmsMetres": fit["rmsMetres"], "cornersApartMetres": round(far, 1)}
        elif fit:
            calibration[key] = {"from": {k: m[k] for k in ("scale", "ox", "oy")}, **fit}
            m.update({k: fit[k] for k in ("scale", "ox", "oy")})

        def world(x, y):
            return [round((x * factor - m["ox"]) / m["scale"]), round((size - y * factor - m["oy"]) / m["scale"])]

        def english(mk):
            w = words.get(mk.get("id")) or words.get(mk.get("name")) or {}
            n = (w.get("name") if isinstance(w, dict) else None) or ""
            return n if n.isascii() else ""

        for mk in markers:
            kind = mk.get("subtype")
            if kind == "hiddenCube":
                cube_spots.setdefault(key, []).extend(world(mk["x"], mk["y"]))
            elif kind == "monolithMaterial":
                monoliths.setdefault(key, []).extend(world(mk["x"], mk["y"]))
            elif kind in AIM_PLACES:
                places.setdefault(key, []).append([kind, english(mk), *world(mk["x"], mk["y"])])
        region_words = aim_load(f"locales/en/regions/{name}.yaml") if os.path.exists(
            os.path.join(AIM, "public", "locales", "en", "regions", f"{name}.yaml")) else {}
        region_src = aim_load(f"data/regions/{name}.yaml").get("regions") if os.path.exists(
            os.path.join(AIM, "public", "data", "regions", f"{name}.yaml")) else None
        for r in region_src or []:
            w = region_words.get(r.get("name")) or {}
            label = (w.get("name") if isinstance(w, dict) else None) or ""
            rings = [[world(x, y) for x, y in ring] for ring in r.get("borders") or [] if len(ring) >= 3]
            if not label or not label.isascii() or not rings:
                continue
            big = max(rings, key=len)
            lx, ly = centroid(big)
            regions.setdefault(key, []).append([label, round(lx), round(ly), [[c for p in ring for c in p] for ring in rings]])
    try:
        aim_commit = subprocess.run(["git", "-C", AIM, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        pass

for z, key in WORLD_ZONES.items():
    if key in maps:
        zones[str(z)] = key

npc_pets = {npc: pet for npc, pet in pets_src["monsters"].items()}
spawned = {npc for per in spawns.values() for npc in per}
data = {
    "source": {"repo": "https://github.com/SkeeveAN/Aion-DPS-Meter", "commit": None},
    "maps": maps,
    "zones": zones,
    "zoneNames": {str(z["id"]): en(z["names"]) for z in zones_src if en(z["names"])},
    "pets": {pid: {"name": en(p["names"]), "category": p.get("category", "")} for pid, p in pets_src["pets"].items()},
    "npcPets": npc_pets,
    "npcNames": {npc: en(n) for npc, n in npc_src.items() if en(n)},
    "spawns": spawns,
    "gather": {
        "objects": {env: {"kind": o["kind"], "name": en(o["names"])} for env, o in gather_src["objects"].items()},
        "points": gather_points,
    },
    "kibelisks": kibelisks,
    # The field bosses of each map: [npc, name, x, y]; and the world-map id
    # of each (Event Timers asks for a boss by it).
    "bosses": {GAME_KEY[m["key"]]: [[b["npc"], en(b["names"]), round(b["x"]), round(b["y"])] for b in m["bosses"]]
               for m in bosses_src if m.get("key") in GAME_KEY and GAME_KEY[m["key"]] in maps},
    "bossIds": {str(wid): npc for npc, wid in FIELD_BOSS_IDS.items()},
    "cubes": CUBES,
    "cubeSpots": cube_spots,
    "monoliths": monoliths,
    "places": places,
    "regions": regions,
    "calibration": calibration,
}
# Pet Finder's copy of the Pet Soul Tracker's sources.js (A2 Tools, GPL-3.0:
# the game's own drop tables), or None.
def game_sources():
    path = os.path.join(OUT, "..", "pet-finder", "sources.js")
    try:
        text = open(path, encoding="utf8").read()
    except OSError:
        return None
    start = text.index("const PET_SOURCES = ") + len("const PET_SOURCES = ")
    sources, _ = json.JSONDecoder().raw_decode(text[start:])
    return sources


# The level of each monster that drops pet souls.
def npc_levels(sources):
    return {str(d["npcId"]): d["level"] for s in (sources or {}).values() for d in s.get("drops", []) if d.get("npcId") and d.get("level")}


# Which pet's souls each monster drops, from the game's drop tables: the same
# as Pet Finder's list and Map button. SkeeveAN's pets.json also names
# monsters the drop tables don't (a second "Contaminated Swarm" in Altgard
# as a Drana Swarm, whose souls drop only in Verteron), so it is used only
# without Pet Finder's data.
def npc_pets_from_game(sources):
    return {str(d["npcId"]): int(pet) for pet, s in sources.items() for d in s.get("drops", []) if d.get("npcId")}


GAME_SOURCES = game_sources()
data["npcLevels"] = npc_levels(GAME_SOURCES)
if GAME_SOURCES:
    npc_pets = npc_pets_from_game(GAME_SOURCES)
    data["npcPets"] = npc_pets
if GAME:
    data["pictures"] = {"repo": "https://github.com/aion2-interactive-map/aion2-interactive-map", "branch": "gh-pages",
                        "commit": game_commit, "path": "UI/Map/WorldMap", "owner": "NCSOFT (the game's own map pictures)"}
if AIM:
    data["aim"] = {"repo": "https://github.com/aion2-interactive-map/aion2-interactive-map", "commit": aim_commit,
                   "license": "CC BY-NC 4.0", "author": "Yihao Liu (tc-imba)"}
try:
    data["source"]["commit"] = subprocess.run(["git", "-C", SRC, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
except (OSError, subprocess.CalledProcessError):
    pass

with open(os.path.join(OUT, "data.js"), "w", encoding="utf8") as f:
    f.write("// Generated by dev/make_data.py from SkeeveAN's Aion-DPS-Meter (MIT) and, for cubeSpots,\n")
    f.write("// monoliths, places, regions and the calibration, the AION2 Interactive Map's data\n")
    f.write("// (CC BY-NC 4.0, Yihao Liu (tc-imba); see NOTICE-AION2-Interactive-Map.txt). Do not edit by hand.\n")
    f.write("// The world map pictures (tiles/) of Verteron, Altgard, the Abyss, Poeta and Ishalgen are the\n")
    f.write("// game's own, as the AION2 Interactive Map publishes them (its gh-pages branch).\n")
    f.write("// npcLevels, npcPets: from Pet Finder's sources.js (A2 Tools' Pet Soul Tracker, GPL-3.0).\n")
    f.write("// AION 2 names, maps and game data belong to their respective owners.\n")
    f.write("globalThis.MAP_DATA = ")
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

with open(os.path.join(OUT, "dev", "provenance.json"), "w", encoding="utf8") as f:
    json.dump({"repo": data["source"]["repo"], "commit": data["source"]["commit"],
               **({"aim": {"repo": data["aim"]["repo"], "commit": aim_commit}} if AIM else {}),
               **({"pictures": data["pictures"]} if GAME else {}),
               "calibration": calibration, "sha256": dict(sorted(read.items()))}, f, indent=1)
    f.write("\n")

print(f"{len(maps)} maps, {sum(len(v) for v in spawns.values())} monster kinds with spawn points, "
      f"{sum(len(p) // 2 for v in gather_points.values() for p in v.values())} gathering spots, "
      f"{len(data['npcNames'])} monster names, unused pets of spawned monsters: {len(spawned - set(npc_pets))}")
if AIM:
    print(f"calibration: {calibration}")
    print(f"cube spots {sum(len(v) // 2 for v in cube_spots.values())}, monoliths {sum(len(v) // 2 for v in monoliths.values())}, "
          f"places {sum(len(v) for v in places.values())}, regions {sum(len(v) for v in regions.values())}")
