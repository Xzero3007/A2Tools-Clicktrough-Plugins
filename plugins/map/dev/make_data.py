"""Builds the Map plugin's data.js and tiles/ from a checkout of SkeeveAN's
Aion-DPS-Meter (MIT, https://github.com/SkeeveAN/Aion-DPS-Meter) and of the
AION2 Interactive Map (its data CC BY-NC 4.0,
https://github.com/aion2-interactive-map/aion2-interactive-map), and the
game's own map pictures as that map publishes them (its gh-pages branch).

    python3 -I dev/make_data.py <Aion-DPS-Meter checkout> <plugin folder> \
        [--aim <aion2-interactive-map checkout>] \
        [--game-maps <aion2-interactive-map gh-pages checkout>] \
        [--pet-maps <A2Tools-Plugins checkout>] [--a2t <Aion 2 Timers cache>] \
        [--no-tiles] [--tiles <map,map>]

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

With --pet-maps, a checkout of A2 Tools' plugins (taengu/A2Tools-Plugins,
at the commit original/PIN names): the Pet Soul Tracker's maps.js, which
holds the spawn points of every monster that drops pet souls and the maps it
draws on, both from Aion 2 Timers' interactive map (the game's own spawn
data, as the client has it). Its spawn points take the place of SkeeveAN's
for those monsters (SkeeveAN's reader of the client's map files misses whole
spawn groups: Harsh Pino Worker none of 22, Hill Coradon 9 of 91), and its
pictures (maps/<id>.webp, the game's world maps) give the maps no other
source has: Eltnen, Morheim, and the Abyss's middle and upper layers.

With --a2t, the folder dev/fetch_aion2timers.py downloads Aion 2 Timers'
interactive map into (aion2timers.com: the game client's own spawn data, map
by map): every Kibelisk, field boss, gathering spot and place one can find a
Hidden Cube, the places (dungeon entrances, outposts, Spacetime Rifts, flight
circles, Monoliths, Abyss artifacts ...), the services (merchants, storage,
crafting tables, teleport towers), the quest givers and their quests, every
monster's and NPC's spawn points, the areas' names, and the full-size
pictures of Eltnen, Morheim and the Abyss's middle and upper layers (their
tiles at the highest zoom, stitched). Where the AION2 Interactive Map has a
sealed dungeon or outpost, its own stays. The Empyrean Traces of SkeeveAN's
gathering spots are the Monolith pieces (feathers): out of the gathering
spots; their object ids only learn feathers. The game's minimap symbols
(icons/) come from the AION2 Interactive Map (public/UI/.../Icon/).

--no-tiles leaves tiles/ as it is (data.js only); --tiles <map,map> writes
the tiles of those maps only.

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
NO_TILES = "--no-tiles" in args or "--tiles" in args
TILES_FOR = set(args[args.index("--tiles") + 1].split(",")) if "--tiles" in args else set()
AIM = args[args.index("--aim") + 1] if "--aim" in args else None
GAME = args[args.index("--game-maps") + 1] if "--game-maps" in args else None
PET = args[args.index("--pet-maps") + 1] if "--pet-maps" in args else None
A2T = args[args.index("--a2t") + 1] if "--a2t" in args else None
SRC, OUT = [a for i, a in enumerate(args) if not a.startswith("--")
            and (i == 0 or args[i - 1] not in ("--aim", "--game-maps", "--pet-maps", "--tiles", "--a2t"))][:2]
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
# With --pet-maps the Abyss's middle and upper layers have maps of their own,
# and so have Eltnen and Morheim.
if PET or A2T:
    WORLD_ZONES.update({22: "abyss_middle", 23: "abyss_upper", 1011: "eltnen", 1111: "morheim"})

# The maps only A2 Tools' Pet Soul Tracker pictures (--pet-maps): map -> (its
# map id, title, the client's spawn table, the AION2 Interactive Map's map
# whose places to take, or None). Each picture covers the world rectangle
# PET_MAPS gives. Checked: SkeeveAN's spawn points of each table all lie on
# land in its picture; the AION2 Interactive Map's picture of the Abyss's
# middle layer (Abyss_Reshanta_C) is the same picture, to the pixel, so its
# places fit; it has no picture of Eltnen or Morheim, so theirs aren't taken.
PET_ONLY_MAPS = {
    "eltnen": ("1011", "Eltnen", "World/World_L/World_L_B", None),
    "morheim": ("1111", "Morheim", "World/World_D/World_D_B", None),
    "abyss_middle": ("22", "Abyss (middle)", "Intersever/Abyss/Abyss_Reshanta_C", "Abyss_Reshanta_C"),
    "abyss_upper": ("23", "Abyss (upper)", "Intersever/Abyss/Abyss_Reshanta_D", None),
}

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
if PET or A2T:
    # The field bosses of Eltnen, Morheim and the Abyss's middle layer.
    GAME_KEY.update({"World_L_B": "eltnen", "World_D_B": "morheim", "Abyss_Reshanta_C": "abyss_middle"})

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

# ---------- A2 Tools' Pet Soul Tracker map data (--pet-maps) ----------
pet_commit = None
pet_spawns = {}
if PET:
    pet_js_path = os.path.join(PET, "plugins", "pet-souls", "maps.js")
    pet_js = open(pet_js_path, encoding="utf8").read()
    note(pet_js_path, "A2Tools-Plugins:plugins/pet-souls/maps.js")

    def pet_const(name):
        start = pet_js.index(f"const {name} = ") + len(f"const {name} = ")
        return json.JSONDecoder().raw_decode(pet_js[start:])[0]

    PET_MAPS = pet_const("PET_MAPS")
    pet_spawns = pet_const("PET_SPAWNS")
    try:
        pet_commit = subprocess.run(["git", "-C", PET, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        pass

    def pet_map(key):
        """A map from the Pet Soul Tracker's picture (one square picture of
        the world rectangle its bounds give), in 2 x 2 tiles."""
        mid, title, _, _ = PET_ONLY_MAPS[key]
        pm = PET_MAPS[mid]
        x0, y0, x1, y1 = pm["bounds"]
        path = os.path.join(PET, "plugins", "pet-souls", "maps", f"{mid}.webp")
        note(path, f"A2Tools-Plugins:plugins/pet-souls/maps/{mid}.webp")
        im = Image.open(path).convert("RGB")
        if im.size != (pm["w"], pm["h"]) or pm["w"] != pm["h"] or abs((x1 - x0) - (y1 - y0)) > 1:
            raise SystemExit(f"{key}: picture {im.size} or bounds {pm['bounds']} not square as expected")
        grid = 2
        size = pm["w"] // grid
        names = [f"{c}_{r}" for c in range(grid) for r in range(grid)]
        if not NO_TILES or key in TILES_FOR:
            os.makedirs(os.path.join(tiles_out, key, "lo"), exist_ok=True)
            # The small copies from the whole picture made small, then cut:
            # each tile made small on its own shows its edges as lines.
            small = im.resize((grid * LO, grid * LO), Image.LANCZOS)
            for c in range(grid):
                for r in range(grid):
                    im.crop((c * size, r * size, (c + 1) * size, (r + 1) * size)).save(
                        os.path.join(tiles_out, key, f"{c}_{r}.webp"), "WEBP", quality=QUALITY, method=6)
                    small.crop((c * LO, r * LO, (c + 1) * LO, (r + 1) * LO)).save(
                        os.path.join(tiles_out, key, "lo", f"{c}_{r}.webp"), "WEBP", quality=QUALITY, method=6)
        scale = grid * size / (x1 - x0)
        calibration[key] = {"bounds": [x0, y0, x1, y1], "from": "the game's map bounds, as A2 Tools' Pet Soul Tracker has them"}
        return {"title": title, "tile": size, "grid": grid, "scale": scale, "ox": -x0 * scale, "oy": -y0 * scale,
                "tiles": names, "lo": LO, "instance": False, "picture": "game"}


# ---------- Aion 2 Timers' interactive map (--a2t, dev/fetch_aion2timers.py) ----------
a2t_catalog, a2t_pos, A2T_MAPS = None, {}, {}
if A2T:
    path = os.path.join(A2T, "maps.json")
    note(path, "aion2timers:maps.json")
    a2t_catalog = json.load(open(path, encoding="utf8"))
    A2T_MAPS = {str(m["id"]): m for m in a2t_catalog["maps"]}
    for mid, m in A2T_MAPS.items():
        path = os.path.join(A2T, "positions", f"{mid}.json")
        if m.get("empty") or not os.path.exists(path):
            continue
        note(path, f"aion2timers:positions/{mid}.json")
        a2t_pos[mid] = json.load(open(path, encoding="utf8"))

    def a2t_map(key):
        """A map from Aion 2 Timers' picture of it (the game's world map, at
        its full size: its tiles of the highest zoom), in tiles of 1024 px."""
        mid, title, _, _ = PET_ONLY_MAPS[key]
        m = A2T_MAPS[mid]
        img, b = m["image"], m["bounds"]
        x0, y0, x1, y1 = b["minX"], b["minY"], b["maxX"], b["maxY"]
        if img["width"] != img["height"] or any((m.get("flip") or {}).values()) or abs((x1 - x0) - (y1 - y0)) > 1:
            raise SystemExit(f"{key}: Aion 2 Timers' picture {img} / bounds {b} not square and unflipped as expected")
        t, z = img["tile_size"], img["max_zoom"]
        n = img["width"] // t
        size = 1024
        grid = img["width"] // size
        names = [f"{c}_{r}" for c in range(grid) for r in range(grid)]
        if not NO_TILES or key in TILES_FOR:
            whole = Image.new("RGB", (img["width"], img["height"]))
            digest = hashlib.sha256()
            for x in range(n):
                for y in range(n):
                    tp = os.path.join(A2T, m["tiles"].format(z=z, x=x, y=y))
                    raw = open(tp, "rb").read()
                    digest.update(raw)
                    whole.paste(Image.open(tp).convert("RGB"), (x * t, y * t))
            read[f"aion2timers:{m['tiles'].format(z=z, x='*', y='*')}"] = digest.hexdigest()
            os.makedirs(os.path.join(tiles_out, key, "lo"), exist_ok=True)
            for old in os.listdir(os.path.join(tiles_out, key)):
                if old.endswith(".webp"):
                    os.remove(os.path.join(tiles_out, key, old))
            for old in os.listdir(os.path.join(tiles_out, key, "lo")):
                os.remove(os.path.join(tiles_out, key, "lo", old))
            small = whole.resize((grid * LO, grid * LO), Image.LANCZOS)
            for c in range(grid):
                for r in range(grid):
                    whole.crop((c * size, r * size, (c + 1) * size, (r + 1) * size)).save(
                        os.path.join(tiles_out, key, f"{c}_{r}.webp"), "WEBP", quality=QUALITY, method=6)
                    small.crop((c * LO, r * LO, (c + 1) * LO, (r + 1) * LO)).save(
                        os.path.join(tiles_out, key, "lo", f"{c}_{r}.webp"), "WEBP", quality=QUALITY, method=6)
        scale = grid * size / (x1 - x0)
        calibration[key] = {"bounds": [x0, y0, x1, y1], "from": "the game's map bounds, as Aion 2 Timers' map has them"}
        return {"title": title, "tile": size, "grid": grid, "scale": scale, "ox": -x0 * scale, "oy": -y0 * scale,
                "tiles": names, "lo": LO, "instance": False, "picture": "game"}

# The maps no other source has a picture of: Aion 2 Timers' (sharper) or
# the Pet Soul Tracker's.
if PET or A2T:
    for key, (mid, _, table, _) in PET_ONLY_MAPS.items():
        if key in maps:
            continue
        if A2T and mid in A2T_MAPS:
            maps[key] = a2t_map(key)
        elif PET and mid in PET_MAPS:
            maps[key] = pet_map(key)
        else:
            continue
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
AIM_MAPS.update({key: g[3] for key, g in PET_ONLY_MAPS.items() if (PET or A2T) and g[3]})
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

        # The Kibelisks of a map SkeeveAN has none for (Poeta, Ishalgen, the
        # Abyss's middle layer): the AION2 Interactive Map's teleports.
        if key not in kibelisks:
            camps = [[english(mk) or "Kibelisk", *world(mk["x"], mk["y"])] for mk in markers if mk.get("subtype") == "teleport"]
            if camps:
                kibelisks[key] = camps
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

# The Pet Soul Tracker's spawn points (Aion 2 Timers', in metres) in place of
# SkeeveAN's for every monster it has; SkeeveAN's stay for the others.
pet_replaced = pet_added = 0
for mid, per in pet_spawns.items():
    key = WORLD_ZONES.get(int(mid))
    if key not in maps:
        continue
    have = spawns.setdefault(key, {})
    for npc, pts in per.items():
        if npc in have:
            pet_replaced += 1
        else:
            pet_added += 1
        have[npc] = [round(v * 100) for v in pts]

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
if PET:
    data["petMaps"] = {"repo": "https://github.com/taengu/A2Tools-Plugins", "commit": pet_commit,
                       "path": "plugins/pet-souls/maps.js, maps/", "from": "Aion 2 Timers' interactive map",
                       "license": "GPL-3.0 (A2 Tools' plugins); the spawn points and maps are the game's"}
if AIM:
    data["aim"] = {"repo": "https://github.com/aion2-interactive-map/aion2-interactive-map", "commit": aim_commit,
                   "license": "CC BY-NC 4.0", "author": "Yihao Liu (tc-imba)"}

# ---------- everything Aion 2 Timers' map has (--a2t) ----------
# The game's own minimap symbols, as the AION2 Interactive Map publishes them
# (public/UI/Resource/Texture/Icon/UT_Marker_*; "a2t:": the one Aion 2 Timers'
# map draws, which the AION2 Interactive Map lacks), 64 px, into icons/: one
# per kind of mark (marks.js).
ICON_FILES = {
    "teleportartifact_light": "TeleportArtifact_Light_Engraved", "teleportartifact_dark": "TeleportArtifact_Dark_Engraved",
    "feather": "MonolithFragment", "monolith_light": "Monolith_Light", "monolith_dark": "Monolith_Dark",
    "boss": "Monster_Boss", "village": "Vlillage", "seal": "Exploration_Seal", "dungeon": "Dungeon",
    "battlefield": "BattleField", "occupation": "Exploration_Occupation", "rift": "Rift", "flightring": "FlightRing",
    "shop": "Shop", "storage": "Storage", "alchemy": "Alchemist", "blacksmith": "BlackSmith", "cook": "Cooking",
    "jewelcraft": "Jewelry", "tailor": "Tailor", "npcteleport": "a2t:ut_marker_movemap", "abyssartifact": "AbyssArtifact_Neutral",
    "abysscore": "AbyssArtifact_Neutral", "abysscorridor": "AbyssPortal", "fieldevent": "BattleField",
    "door": "a2t:ut_marker_movemap", "npc": "Talk",
    "heroquest": "Quest_Hero_Acquired", "districtquest": "Quest_District_Acquired",
    "gather_herb": "Gather_Herb", "gatherl_metal": "Gatherl_Metal", "gatherl_raremetal": "Gatherl_RareMetal",
    "gather_tree": "Gather_Tree", "gatherl_jewelry": "Gatherl_Jewelry", "gather_od": "Gather_Od",
    "gather_berry": "Gather_Berry", "gather_vegetable": "Gather_Vegetable", "gather_shellfish": "Gather_shellfish",
    "gather_flower": "Gather_Flower", "gather": "Gather",
}
if AIM and os.path.isdir(os.path.join(AIM, "public", "UI", "Resource", "Texture", "Icon")):
    os.makedirs(os.path.join(OUT, "icons"), exist_ok=True)
    for name, src_name in ICON_FILES.items():
        if src_name.startswith("a2t:"):
            if not A2T:
                continue
            path = os.path.join(A2T, "icons", f"{src_name[4:]}.webp")
            note(path, f"aion2timers:icons/{src_name[4:]}.webp")
        else:
            path = os.path.join(AIM, "public", "UI", "Resource", "Texture", "Icon", f"UT_Marker_{src_name}.webp")
            note(path, f"aion2-interactive-map:public/UI/Resource/Texture/Icon/UT_Marker_{src_name}.webp")
        Image.open(path).convert("RGBA").resize((64, 64), Image.LANCZOS).save(
            os.path.join(OUT, "icons", f"{name}.webp"), "WEBP", lossless=True, method=6)

if A2T:
    def a2t_key(mid):
        key = zones.get(str(mid)) or {"1000": "poeta"}.get(str(mid))
        return key if key in maps else None

    def near_any(pts, x, y, cm):
        return any((pts[i] - x) ** 2 + (pts[i + 1] - y) ** 2 <= cm * cm for i in range(0, len(pts), 2))

    def human(name):
        # The client's internal names (M_FE_..., N_FE_...) aren't shown.
        return bool(name) and "_" not in name and name.isascii()

    # Aion 2 Timers' resource types -> the map's gathering kinds, and the
    # game's symbol of each.
    GATHER_KIND = {"herb": "Herb", "metal": "Ore", "tree": "Wood", "jewelry": "Gemstone", "od": "Od",
                   "berry": "Food", "vegetable": "Food", "shellfish": "Food"}
    GATHER_ICON = {"herb": "gather_herb", "metal": "gatherl_metal", "tree": "gather_tree", "jewelry": "gatherl_jewelry",
                   "od": "gather_od", "berry": "gather_berry", "vegetable": "gather_vegetable", "shellfish": "gather_shellfish"}
    KIND_ICON = {"Herb": "gather_herb", "Ore": "gatherl_metal", "Wood": "gather_tree", "Gemstone": "gatherl_jewelry",
                 "Od": "gather_od", "Food": "gather_vegetable", "Cotton": "gather_flower"}
    # Its points -> the map's places (kind), the most telling type first.
    POINT_KINDS = [("heroquest", "heroquest"), ("districtquest", "districtquest"), ("stronghold", "occupation"),
                   ("dungeon", "dungeon"), ("rift", "rift"), ("flightring", "flightring"), ("monolith", "monolith"),
                   ("abyssartifact", "abyssartifact"), ("abysscore", "abysscore"), ("abysscorridor", "abysscorridor"),
                   ("fieldevent", "fieldevent"), ("movemapcondition", "door"), ("shop", "shop"), ("storage", "storage"),
                   ("alchemy", "alchemy"), ("blacksmith", "blacksmith"), ("cook", "cook"), ("jewelcraft", "jewelcraft"),
                   ("tailor", "tailor"), ("npcteleport", "npcteleport")]
    objects = data["gather"]["objects"]
    # The Empyrean Traces are the Monolith pieces ("feathers", the AION2
    # Interactive Map's): 541 of Verteron's 559 lie on one. Out of the
    # gathering spots; their object ids learn feathers.
    feather_ids = sorted(env for env, o in objects.items() if o["kind"] == "Fragment")
    for env in feather_ids:
        del objects[env]
        for per in gather_points.values():
            per.pop(env, None)
    for o in objects.values():
        o.setdefault("icon", KIND_ICON.get(o["kind"], "gather"))
    monsters, npcs, labels, object_kinds, levels = {}, {}, {}, {}, {}
    a2t_pet_spawns = {}
    counts = {}
    for mid, d in a2t_pos.items():
        key = a2t_key(mid)
        if not key:
            continue
        c = counts.setdefault(key, {})
        # Kibelisks and field bosses: theirs, on every map they have.
        kib = [[p["name"], round(p["x"]), round(p["y"]), "dark" if "_dark_" in (p.get("iconPath") or "") else "light"]
               for p in d["points"] if "teleportartifact" in p["types"]]
        if kib:
            kibelisks[key] = kib
        boss = [[int(p["entity"]["id"]), p["name"], round(p["x"]), round(p["y"])]
                for p in d["points"] if "boss" in p["types"] and p.get("entity")]
        if boss:
            data["bosses"][key] = boss
        # Their objects' ids, for what the meter sees to be learnt.
        for p in d["points"]:
            if not p["id"].startswith("object-"):
                continue
            env = p["id"].split("-")[1]
            kind = "kibelisk" if "teleportartifact" in p["types"] else next((k for t, k in POINT_KINDS if t in p["types"]), None)
            if kind:
                object_kinds.setdefault(env, kind)
        # Places: theirs beside the AION2 Interactive Map's (a sealed
        # dungeon or outpost it has wins over one of theirs within 50 m).
        mine = places.setdefault(key, [])
        aim_at = {}
        for kind, _, x, y, *_ in mine:
            aim_at.setdefault(kind, []).extend([x, y])
        for p in d["points"]:
            kind = next((k for t, k in POINT_KINDS if t in p["types"]), None)
            if not kind or "teleportartifact" in p["types"] or "boss" in p["types"]:
                continue
            x, y = round(p["x"]), round(p["y"])
            if kind == "occupation" and near_any(aim_at.get("occupation", []), x, y, 5000):
                continue
            if kind == "dungeon" and near_any(aim_at.get("seal", []), x, y, 5000):
                continue
            quests = "; ".join(q["name"] for q in p.get("quests") or [] if q.get("name"))
            mine.append([kind, p["name"], x, y, quests] if quests else [kind, p["name"], x, y])
            c[kind] = c.get(kind, 0) + 1
        # Area names where the map has no regions of its own.
        if not regions.get(key) and d.get("labels"):
            labels[key] = [[l["name"], l["type"], round(l["x"]), round(l["y"])] for l in d["labels"]]
        gp = gather_points.setdefault(key, {})
        for g in d["groups"]:
            types, e = g["types"], g["entity"]
            pts = [round(v) for v in g["positions"]]
            res = next((t[9:] for t in types if t.startswith("resource-")), None)
            if res in GATHER_KIND:
                env = str(e["id"])
                objects.setdefault(env, {"kind": GATHER_KIND[res], "name": e["name"]})
                objects[env]["icon"] = GATHER_ICON[res]
                have = gp.setdefault(env, [])
                for i in range(0, len(pts), 2):
                    if not near_any(have, pts[i], pts[i + 1], 800):
                        have += pts[i:i + 2]
                c["gather"] = c.get("gather", 0) + len(pts) // 2
            elif "hiddencube" in types:
                for env in e.get("envObjIds") or []:
                    if env not in CUBES:
                        CUBES.append(env)
                have = gp.setdefault("cube", [])
                for i in range(0, len(pts), 2):
                    if not near_any(have, pts[i], pts[i + 1], 800):
                        have += pts[i:i + 2]
            elif any(t.startswith("monster-") for t in types) or "npc-other" in types:
                npc = str(e["id"])
                into = monsters if any(t.startswith("monster-") for t in types) else npcs
                if into is npcs and not human(e.get("name")):
                    continue
                # In metres: tens of thousands of points.
                into.setdefault(key, {}).setdefault(npc, []).extend(round(v / 100) for v in g["positions"])
                if e.get("level"):
                    levels.setdefault(npc, e["level"])
                if human(e.get("name")) and npc not in data["npcNames"]:
                    data["npcNames"][npc] = e["name"]
                if into is monsters:
                    a2t_pet_spawns.setdefault(key, {}).setdefault(npc, []).extend(pts)
    # Every pet monster's spawn points: theirs, as the game has them.
    pets_of = data["npcPets"]
    a2t_replaced = 0
    for key, per in a2t_pet_spawns.items():
        for npc, pts in per.items():
            if npc in pets_of:
                spawns.setdefault(key, {})[npc] = pts
                a2t_replaced += 1
    data["cubes"] = CUBES
    data["monsters"] = monsters
    data["npcs"] = npcs
    data["labels"] = labels
    data["objectKinds"] = object_kinds
    data["featherIds"] = [int(env) for env in feather_ids]
    data["monsterLevels"] = levels
    data["a2t"] = {"site": "aion2timers.com", "build": a2t_catalog.get("build"), "generated": a2t_catalog.get("generated"),
                   "positions": "the game client's"}
    print(f"Aion 2 Timers (build {a2t_catalog.get('build')}): pet monsters' spawn points {a2t_replaced}, "
          f"monsters {sum(len(v) for v in monsters.values())} kinds, NPCs {sum(len(v) for v in npcs.values())}, "
          f"object ids {len(object_kinds)}, per map: {counts}")

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
    if A2T:
        f.write("// Kibelisks, field bosses, gathering spots, Hidden Cube places, places, services, quests,\n")
        f.write("// monsters' and NPCs' spawn points (monsters, npcs: metres), area names, the pet monsters'\n")
        f.write("// spawn points and the maps of Eltnen, Morheim and the Abyss's middle and upper layers: from\n")
        f.write("// Aion 2 Timers' interactive map (see NOTICE-Aion2Timers.txt). icons/: the game's minimap\n")
        f.write("// symbols, as the AION2 Interactive Map publishes them.\n")
    elif PET:
        f.write("// The pet monsters' spawn points, and the maps of Eltnen, Morheim and the Abyss's middle and\n")
        f.write("// upper layers: from A2 Tools' Pet Soul Tracker (maps.js, maps/), which has them from\n")
        f.write("// Aion 2 Timers' interactive map (see NOTICE-Aion2Timers.txt).\n")
    f.write("// AION 2 names, maps and game data belong to their respective owners.\n")
    f.write("globalThis.MAP_DATA = ")
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

with open(os.path.join(OUT, "dev", "provenance.json"), "w", encoding="utf8") as f:
    json.dump({"repo": data["source"]["repo"], "commit": data["source"]["commit"],
               **({"aim": {"repo": data["aim"]["repo"], "commit": aim_commit}} if AIM else {}),
               **({"pictures": data["pictures"]} if GAME else {}),
               **({"petMaps": {"repo": data["petMaps"]["repo"], "commit": pet_commit}} if PET else {}),
               **({"aion2timers": data["a2t"]} if A2T else {}),
               "calibration": calibration, "sha256": dict(sorted(read.items()))}, f, indent=1)
    f.write("\n")

print(f"{len(maps)} maps, {sum(len(v) for v in spawns.values())} monster kinds with spawn points, "
      f"{sum(len(p) // 2 for v in gather_points.values() for p in v.values())} gathering spots, "
      f"{len(data['npcNames'])} monster names, unused pets of spawned monsters: {len(spawned - set(npc_pets))}")
if AIM:
    print(f"calibration: {calibration}")
    print(f"cube spots {sum(len(v) // 2 for v in cube_spots.values())}, monoliths {sum(len(v) // 2 for v in monoliths.values())}, "
          f"places {sum(len(v) for v in places.values())}, regions {sum(len(v) for v in regions.values())}")
if PET:
    print(f"Pet Soul Tracker spawn points: {pet_replaced} monsters replaced, {pet_added} added")
if GAME_SOURCES:
    # Every monster that drops pet souls, against the game's own count of its
    # spawn points (sources.js): what the map has of it.
    same, fewer, more, no_map = [], [], [], []
    for pet, src in GAME_SOURCES.items():
        for d in src.get("drops", []):
            npc, game = str(d.get("npcId")), d.get("spawns") or 0
            key = zones.get(str(d.get("mapId")))
            if not game:
                continue
            if key not in maps:
                no_map.append(f"{npc} (map {d.get('mapId')})")
                continue
            n = len(spawns.get(key, {}).get(npc, [])) // 2
            (same if n == game else fewer if n < game else more).append(f"{npc} {key} {n}/{game}")
    print(f"pet monsters: {len(same)} with all the game's spawn points, {len(fewer)} with fewer, {len(more)} with more, "
          f"{len(no_map)} on a map the plugin has no picture of")
    for label, rows in (("fewer", fewer), ("more", more), ("no map", no_map)):
        if rows:
            print(f"  {label}: {', '.join(rows)}")
