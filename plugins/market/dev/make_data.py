"""Builds the Market plugin's data.js: the crafting recipes, the item names
and the gathered materials Substance Morph makes from Odyle.

    python3 -I dev/make_data.py <Aion-DPS-Meter checkout> <plugin folder>

From SkeeveAN's Aion-DPS-Meter (MIT, https://github.com/SkeeveAN/Aion-DPS-Meter):
  Client/assets/aion2/craft/recipes.json   every crafting recipe of the client
                                           (both factions): product, how many,
                                           the materials and how many of each
  Client/assets/aion2/items/item_names.json  item id -> grade and English name
                                           (from the revision that has it,
                                           NAMES_REV, when HEAD has none)

The gathered materials and their grades are the item families of the client
(610620xxx ore, 610660xxx gemstones, 610650xxx logs, 610670xxx herbs,
610680xxx cooking ingredients, 610610xxx Odyle). Substance Morph turns one
Odyle into one gathered material of the same grade (Gatherable Material tab:
4 ore, 12 gemstone, 8 log, 8 herb and 10 cooking recipes, 100 % success; what
it makes is bound), and 25 Odyle, 5 Fine Odyle, 1 Pure Odyle and 50,000 Kina
into Odyle Energy (Bound), +40 energy.

NPC_PRICES: what the NPC shops ask for the bound tools recipes need
(catalysts, solvents, inks ...), as MetaBot.GG's crafting calculator lists
them from the game files; the plugin lets the player change them.

It writes dev/provenance.json with the revision and a SHA-256 of every file
it read.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
ASSETS = os.path.join(SRC, "Client", "assets", "aion2")
NAMES = "Client/assets/aion2/items/item_names.json"
NAMES_REV = "2d4d2f1"  # 2026-10-21: names follow the client of that day
read = {}


def load(rel):
    path = os.path.join(SRC, rel)
    if os.path.exists(path):
        data = open(path, "rb").read()
        rev = "HEAD"
    else:
        data = subprocess.run(["git", "-C", SRC, "show", f"{NAMES_REV}:{rel}"], capture_output=True, check=True).stdout
        rev = NAMES_REV
    read[f"{rel}@{rev}"] = hashlib.sha256(data).hexdigest()
    return json.loads(data)


recipes_src = load("Client/assets/aion2/craft/recipes.json")["recipes"]
names_src = load(NAMES)

NPC_PRICES = {
    "Abex Butter (Bound)": 880, "Abrasive (Bound)": 400, "Altgard Pepper (Bound)": 880, "Benediction Scroll (Bound)": 1000,
    "Catalyst (Bound)": 400, "Cheese (Bound)": 440, "Courage Scroll (Bound)": 1000, "Curry Powder (Bound)": 440,
    "Exceptional Ink (Bound)": 10000, "Glass Bottle (Bound)": 400, "Healing Potion (Bound)": 630,
    "Intermediate Dragon Leather Softener (Bound)": 5600, "Intermediate Dragon Scale Hardener (Bound)": 5600,
    "Lazuli Hammer (Bound)": 5600, "Lesser Dragon Leather Softener (Bound)": 4650,
    "Lesser Dragon Scale Hardener (Bound)": 4650, "Life Potion (Bound)": 250, "Life Serum (Bound)": 1000,
    "Moonstone Hammer (Bound)": 6550, "Orichalcum Solvent (Bound)": 400, "Professional Glass Bottle (Bound)": 1200,
    "Professional Ink (Bound)": 1200, "Raw Triora Noodles (Bound)": 880, "Salt (Bound)": 220, "Sandpaper (Bound)": 400,
    "Soy Sauce (Bound)": 440, "Speed Scroll (Bound)": 1000, "Superior Dragon Leather Softener (Bound)": 6550,
    "Superior Dragon Scale Hardener (Bound)": 6550, "Ulmus Oil (Bound)": 880, "Zircon Hammer (Bound)": 4650,
}

# Gathered materials: family prefix -> kind.
FAMILIES = [("61062", "Ore"), ("61066", "Gemstone"), ("61065", "Log"), ("61067", "Herb"), ("61068", "Cooking")]
GRADE_WORDS = ("Fine ", "Pure ", "Radiant ", "Fresh ")


def stem(name):
    for w in GRADE_WORDS:
        if name.startswith(w):
            return name[len(w):]
    return name


used = set()
recipes = []
by_id = {r["id"]: r for r in recipes_src}
for r in recipes_src:
    # The combo results (learnt "Combo") have no materials: what a recipe
    # sometimes makes on top, at its combo chance. They stay with that recipe.
    if not r["k"]:
        continue
    mats = []
    for k in r["k"]:
        # A component with alternatives (an earlier tier's piece): the first,
        # which is what the client shows.
        mats.append([k[0], k[1]])
        used.add(k[0])
    used.add(r["p"])
    combo = by_id.get(r.get("cr")) if r.get("combo") else None
    if combo:
        used.add(combo["p"])
    recipes.append([r["id"], r["race"], r["cat"], r["sub"], r["lv"], r["learn"], r["p"], r["n"], mats,
                    [round(r["combo"] / 100, 1), combo["p"], combo["n"]] if combo else None])

odyle = [610610013, 610610014, 610610015, 610610016]
gather = {}
for prefix, kind in FAMILIES:
    groups = {}
    for i, v in names_src.items():
        if i.startswith(prefix) and len(i) == 9 and not v[1].startswith(("Title", "Soul", "Pet")):
            groups.setdefault(stem(v[1]), []).append((v[0], int(i)))
    gather[kind] = [[i for _, i in sorted(g)] for _, g in sorted(groups.items())]
used.update(odyle)
for lists in gather.values():
    for g in lists:
        used.update(g)

npc_ids = {}
for i, v in names_src.items():
    if v[1] in NPC_PRICES and int(i) in used:
        npc_ids[i] = NPC_PRICES[v[1]]

items = {str(i): [names_src[str(i)][1], names_src[str(i)][0]] for i in sorted(used) if str(i) in names_src}
missing = [i for i in used if str(i) not in names_src]
if missing:
    raise SystemExit(f"no names for {missing[:10]}")

data = {
    "source": {"repo": "https://github.com/SkeeveAN/Aion-DPS-Meter", "commit": None, "names": NAMES_REV},
    "items": items,
    # [id, race (L Elyos, D Asmodian), profession, sub, level, how learnt,
    #  product, how many, [[material, count] ...], [combo %, combo product,
    #  how many] or null]
    "recipes": recipes,
    "gather": gather,
    "odyle": odyle,
    "energyMorph": {"materials": [[610610013, 25], [610610014, 5], [610610015, 1]], "kina": 50000, "energy": 40},
    "npcPrices": npc_ids,
}
try:
    data["source"]["commit"] = subprocess.run(["git", "-C", SRC, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
except (OSError, subprocess.CalledProcessError):
    pass

with open(os.path.join(OUT, "data.js"), "w", encoding="utf8") as f:
    f.write("// Generated by dev/make_data.py from SkeeveAN's Aion-DPS-Meter (MIT): recipes and item names of\n")
    f.write("// the game client; NPC prices as MetaBot.GG's crafting calculator lists them. Do not edit by hand.\n")
    f.write("// AION 2 names and game data belong to their respective owners.\n")
    f.write("globalThis.MARKET_DATA = ")
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

with open(os.path.join(OUT, "dev", "provenance.json"), "w", encoding="utf8") as f:
    json.dump({"repo": data["source"]["repo"], "commit": data["source"]["commit"], "sha256": dict(sorted(read.items()))}, f, indent=1)
    f.write("\n")

print(f"{len(recipes)} recipes, {len(items)} items, gathered: "
      + ", ".join(f"{k} {sum(len(g) for g in v)}" for k, v in gather.items())
      + f", NPC prices {len(npc_ids)} of {len(NPC_PRICES)}")
