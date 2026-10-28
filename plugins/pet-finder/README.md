# Pet Finder (A2Tools plugin)

Three tabs beside the A2Tools DPS meter, with **one list of favourites (★)**
for all of them and for the Map plugin:

- **Pets** – the **Pet Soul Tracker's list**, whole (A2 Tools' plugin, GPL-3.0;
  its README describes it): every pet's level (0 to 3) and the souls it still
  needs (5, 25, 75), from the game's own pet data, in the meter's language;
  layouts (cards, with the pet's portrait at the left as tall as the card,
  open as tall as the open card with the sources beside it, filled cards,
  rows, classic), filters (genus, level, regions), the pop-up
  while farming; a click on a pet shows where its souls
  drop (monsters with level, chance, zone, spawns and the nearest Kibelisk,
  and chests), and **Map** beside a monster shows its spawn points on the Map
  plugin. **Nearest** (beside the sort buttons, with the Map running) sorts
  the pets by how far you are from the closest spawn on your map of a monster
  that drops their souls, as the Pet Soul Tracker 0.5.0 does. ☆ makes a pet a
  favourite. A favourite that reaches level 3 stops
  being one, so the Map no longer follows it; made one again at level 3, it
  stays. Its highlights (chosen filters, the bar of how far along every pet
  is, the links) are gold, not blue.
- **Nearby** – the pet mobs the game has shown you, grouped by pet, with your
  level and souls (the Pets tab's), how far the nearest one is and which way
  (north up); favourites first, then the nearest, a map button for each, and a
  notice when a favourite's mob appears.
- **Merchant** – a Black Cloud Merchant shopping list: the pets on offer that
  only chests and merchants give and you have not maxed, with price and
  discount; then those on offer you still need that mobs also drop; below, the
  pets to look out for. The button right of the tabs puts the three side by
  side, a column each, for a wide, low window.

Nearby and Merchant are the nearby and merchant parts of
[PetTracker](https://github.com/0Fox2Give/PetTracker) (GPLv3) brought into
A2Tools: the same packet layouts and checks, the same data. Pets is the Pet
Soul Tracker (A2 Tools, GPL-3.0, plugins/pet-souls of
[A2Tools-Plugins](https://github.com/taengu/A2Tools-Plugins), 0.4.9 with the
Clicktrough patches): `list.js`, `pets.js`, `sources.js` and its styles; see
`NOTICE-PetSoulTracker.txt`. With Pet Finder 0.3 the **Pet Soul Tracker can be
turned off** (Settings → Plugins): everything it did is here, and the Map
follows Pet Finder's list alone. Its favourites come over once on their own
while it still runs; its saved counts don't need to (the game sends them at
every login).

## Install

The meter from [A2Tools-DPS-Meter_Clicktrough](https://github.com/Xzero3007/A2Tools-DPS-Meter_Clicktrough)
ships Pet Finder: nothing to install, it comes and updates with the meter.
Start the meter **before** logging into your character: the collection is read at login.

To try changes of your own: **Settings → Plugins → Plugin developer mode** on,
**Load plugin folder…** and pick this folder (the one with `manifest.json`). A
developer folder wins over the copy the meter ships; remove it from the list
to go back to that one. Your settings, pins and collection stay either way.

Needs A2Tools 2.0.65 or newer (plugin API 2).

## How it knows

- **Collection** – the Pets tab's, as the Pet Soul Tracker reads it: the pet
  list at login, each soul picked up and each level reached, saved per server
  (a pet collection belongs to every character on a server).
- **Nearby** – monsters appearing near you whose kind drops a pet's souls,
  until the game removes them or after the time you keep them. The distance
  and direction come from the meter's `events:world` (Clicktrough): where you
  are (exact for a few seconds after an action, else about 10 m off) and
  where the mob stands. Changing map leaves old mobs until they time out;
  **Clear** empties the list.
- **Map** – your favourites and the pet you are farming (a soul in the last
  30 minutes) go to the Map plugin (`share`), which shows where their
  monsters are, and so does which pets are not at level 3 yet (the Map marks
  them apart); Map buttons show one pet or monster there.
- **Merchant** – the shop's stock, only in the layout PetTracker checked
  against the game (with Europe's tabs added); anything else is dropped, and
  the Merchant tab says the layout is unknown. Open the shop after your
  collection is read; offers show for two minutes, as the stock may change.

The meter reads the game's messages as numbers (the plugin never sees a
packet); each is checked as PetTracker checks it, and one that does not fit
is dropped.

## Permissions

`storage` (settings, favourites, your collection, names), `notify` (a
favourite nearby, merchant offers), `window` (the farming pop-up),
`events:character` (whose collection it is), `events:world` (distances),
`share` (the pets for the Map plugin), `events:shared` (the Pet Soul
Tracker's favourites, once), and one `decoder:` per game message it reads.
No network.

## Data

`pets.js` and `sources.js` are the Pet Soul Tracker's, generated from the game
client by its `tools/game-souls/gamesouls.py`. `data.js` and `images.js` are generated from PetTracker
(`python3 -I dev/make_data.py <PetTracker checkout> .`); `data.js` names the commit.
The large portraits an open card shows (`portraits/`, 256 px) come from the
same checkout: `python3 -I dev/make_portraits.py <PetTracker checkout> .`.
Pet portraits and crystals are game artwork, included as PetTracker includes them;
Aion 2 names, portraits and game material belong to their respective owners.
Source relationships come from PetTracker, which assembled them from game data,
aion2.gaming.tools and aion2maps.com.

`dev/ci.sh <meter source>` runs the tests against the plugin decoder of that
meter version; the fork's build runs it for every package.

Unofficial, not affiliated with NCSOFT or A2Tools. Third-party tools can put a game
account at risk.

Pet Finder's own parts: GPL-3.0-or-later; with the Pet Soul Tracker's list
(GPL-3.0) the plugin as a whole is distributed under the GPL-3.0. See `LICENSE`
and `NOTICE-PetSoulTracker.txt`.
