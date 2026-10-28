# Map (A2Tools plugin)

The map you are on, with where you are, and an overlay with a small map that
follows you over the game.

- **Your position**: the arrow points the way you walk (the game sends no
  facing). The game reports your exact place only with an action, an effect
  you put on, or a teleport; what your client tells the server as you walk is
  encrypted, so no tool can read it. In between, the meter takes the middle
  of the monsters and players moving around you (10 to 15 m off). The map
  weighs that against your last exact place by how far each is likely off,
  and moves the arrow there smoothly, no faster than one runs, instead of
  jumping; the ring around it is how far off it may be ("±12 m"). A Kibelisk
  teleport places you exactly at once (patch 0023, the teleport record as
  A2 Tools' Pet Soul Tracker 0.5.0 reads it). The header names the region you
  are in (Safe Haven, Black Claw Village ...) and, while the place is only
  about, how long ago it last was exact ("exact 21 s ago").
- **Which map**: the game names your zone at login and at each teleport or
  zone change. When what is around you clearly belongs to another map than
  the zone heard (3 or more monsters or spots, more than of the zone's map),
  the map goes by what is around you: a zone change the meter missed doesn't
  leave it on the wrong map. Started after that, the meter hasn't heard it yet: the map
  then goes by what is around you (pet monsters, gathering spots, Hidden
  Cubes), else it is the map you were on last time, marked "map as last
  time" (and a "?" in the overlay) until your next teleport.
- **Pets**: whose spawn points show (the selector beside the layers):
  **favourites** (Pet Finder's ★ and the pet you are farming), **not at level
  3** (those and every pet still needing souls, as the Pet Soul Tracker's map
  shows them) or **all**. Your favourites show as a **gold star** and the one
  you are farming as a **target** (white ring and dot); a pet not at level 3
  yet is filled in its **genus colour** (Cogni violet, Fera orange, Natura
  green, Varian cyan, as Pet Finder's list colours them). Pet Finder holds the Pet Soul Tracker's list
  now, so this is one list; while the Pet Soul Tracker still runs too, the map
  goes by Pet Finder's alone. With no pet followed, or with **All pets**,
  every pet's spawn points show: **red in a white ring** while the pet is not
  at level 3 yet, **small and grey** at level 3 (Pet Finder tells which once it
  has read your pet list; before, small and white). Which monster gives which pet's
  souls comes from the game's drop tables (Pet Finder's `sources.js`), so the
  map shows the same monsters as Pet Finder's list and Map button. The pet monsters around
  you right now are the large marks with a white halo, and every one not at
  level 3 yet shows, followed or not. A legend under the map explains them.
  **Under the map**, as the Pet Soul Tracker's map lists them: the nearest
  kinds of monster that drop souls you still need, up to four: name, level,
  how many are in range, which way and how far, the pet and the souls it still
  needs to level 3; with none in range, the nearest spawn points. A click
  shows that monster's spawn points. At the bottom: the next pet to go for,
  which way and how far (hover it for why it is followed), and how many pets
  this map has and how many are around you.
- **Next**: a favourite first (however far), then the one you are farming;
  among those, one that is there right now before a spawn point, then the
  nearest. **Next: off** shows none (a search still has its Next).
- **Monsters**: the monsters around you right now, by name.
- **Gathering**: the gathering spots by kind, each kind on or off (hover a kind
  for what it holds); those there right now framed white:
  - Herbs: Aria, Targena, Azpha, Calendula
  - Ore: Orichalcum, Silver, Gold, Platinum, Mithril
  - Wood: Yggdrasil, Asvata
  - Fibers (for cloth): Ruko, Fess, Remi, Linon, Lapageria and more
  - Cooking: Mela, Coriolus, Inina, Kukuru and about 30 more
  - Gemstones: Sapphire, Diamond, Ruby, Aquamarine, Topaz and more
  - Odyle: Odyle, Splendent Odyle, Mysterious Odyle
  - Empyrean Traces: the traces to collect in Verteron
- **Hidden Cubes**: purple cubes: the spots where a cube is known to stand
  (pale, about 110 per map), and a cube in range right now (solid with a white
  edge, it shows as soon as the game announces it).
- **Monoliths**: the Monolith pieces to collect (560 in Verteron and in
  Altgard, about 200 in the Abyss).
- **Kibelisks**: the Kibelisk camps.
- **Places**: sealed dungeons, battlefields, outposts and villages, with
  their names once zoomed in, the names of the regions, and the **field
  bosses** (an orange crown).
- **Marks 100% to 175%**: how large the marks are, on the map and the
  overlay (125% to begin with).
- **What your meter sees is learnt**: the data knows only the gathering
  spots and pet spawns players' meters happened to report (Asvata: 3 in
  Altgard). Each gathering spot, Hidden Cube and pet monster your meter sees
  where the map has none of its kind yet (8 m for a spot, 20 m for a
  monster), on the map the zone or what is around names, is added, kept
  (0.5.0 kept nothing past a restart) and shown like the others ("12 spots your meter
  saw" at the bottom); the more you play, the fuller the map.

**Search** (two letters or more): gathering spots by name (Orichalcum, Aria
...), pets, the monsters that drop them, Kibelisk camps, **Hidden Cube**
(the known spots, or every place the game may put one: about 1,400 per map),
**Monolith**, sealed dungeons, battlefields, outposts and villages (each kind,
or one by its name) and regions, each with the maps it is on and how often.
Picking one shows all its places with a gold ring, the map framed around them
(the bar above the map switches between its maps), and **the way there**:
from your position, walking, or a teleport to the Kibelisk nearest the place
(gold ring, "Teleport: <name>") and a dashed line from there, whichever is
shorter (a teleport counts as 250 m of walking); to the cheapest of its
places when it has several. **Next** says it, in the overlay too: "teleport
to <Kibelisk>, then 186 m", or which way and how far. A map link in Pet
Finder (its Nearby tab, or Map beside a monster in a pet's sources) does the same for that pet or monster, a world
boss's map button in **Event Timers** for that boss, and a material's map
button in the **Market** for where it is gathered; each brings the Map
forward. It stays, after a restart too, until its **×** stops it: in the bar
above the map, or at the bottom of the overlay ("Showing ...", in gold).

Drag to move the map, the wheel zooms, a double-click goes back to following
you. **Overlay** opens the small map, always on the map you are on: drag it by
its title; **S, M, L, XL** in its title (shown while the pointer is on it) or
**Overlay size** here set its size, or drag one of its corners (the brackets)
for any other, which the window manager does as for any window; the wheel
zooms it; the slider in its title (or **Opacity** here) sets how much of the
game shows through (the marks stay solid); **Lock it** lets clicks through to
the game.

Maps: Verteron, Altgard, the Abyss, Poeta and Ishalgen, whole, as the game
draws its world map (on its parchment, the sea painted), and 25 instances.
Eltnen, Morheim and the Abyss's other layers have no map here yet.

## How it knows

The meter's `events:world` (Clicktrough patch 0010) reads where you and the
monsters, players and objects around you are from the game's own data, and the
pets to show come from other plugins through `events:shared` (patch 0011);
the Map shares each pet's nearest spawn point on your map back (`share`),
for Pet Finder's **Nearest** sort. The monsters' levels come from Pet
Finder's copy of the Pet Soul Tracker's game data (GPL-3.0). The
map pictures come through the meter (`a2.file`, patch 0012): WebKitGTK 2.54
lets a plugin load no file of its own once its page has started. No network.

## Data

`data.js` and `tiles/` are generated from SkeeveAN's
[Aion-DPS-Meter](https://github.com/SkeeveAN/Aion-DPS-Meter) (MIT, see
`NOTICE-SkeeveAN.txt`) and the data of the
[AION2 Interactive Map](https://github.com/aion2-interactive-map/aion2-interactive-map)
by Yihao Liu (tc-imba) (CC BY-NC 4.0: non-commercial use only, see
`NOTICE-AION2-Interactive-Map.txt`) with
`python3 -I dev/make_data.py <Aion-DPS-Meter checkout> . --aim <aion2-interactive-map checkout> --game-maps <its gh-pages checkout>`
(`--no-tiles` keeps `tiles/`); `dev/provenance.json` names the revisions,
the calibration and every file read. The field bosses' places are SkeeveAN's
(`bosses/field_bosses.json`), their world-map ids the meter's
(`capture/field_bosses.rs`).

Fuller gathering maps exist (allthings.how and The Hidden Gaming Lair show
158 Asvata spots in Altgard), but their data is theirs, with no licence to
reuse it here; so the plugin learns what your own meter sees instead.

The world maps are the game's own map pictures as the AION2 Interactive Map
publishes them (its `gh-pages` branch, `UI/Map/WorldMap`), the way the map
sites all show them: SkeeveAN's are the same pictures taken as a player had
explored them, so Altgard had dark holes (Black Claw Village, Immortal Isle
and more). Verteron keeps SkeeveAN's sharper picture (twice the pixels) where
it has one. Each picture covers a fixed rectangle of the world (the client's
map bounds, as the map sites use them), one pixel 99.6 cm on every map: that
is the calibration. The Kibelisks of both sources agree with it (60 and 61
pairs, 6 and 8 m apart on average); 99 % of the spawn points of Verteron and
the Abyss lie on land with it, and the Hidden Cube spots on places the game
may put a cube (7 m apart on average). SkeeveAN's own fit was 2 % too small,
up to 90 m off towards Altgard's edges.

The map pictures are the game's artwork (© NCSOFT); AION 2 names, maps and
game material belong to their respective owners.

Unofficial, not affiliated with NCSOFT or A2Tools. Third-party tools can put a
game account at risk.

The plugin's own code: GPL-3.0-or-later, see `LICENSE`. The monsters' levels
(`npcLevels` in `data.js`) come from A2 Tools' Pet Soul Tracker data
(GPL-3.0, https://github.com/taengu/A2Tools-Plugins).
