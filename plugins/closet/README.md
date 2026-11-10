# Closet (A2Tools plugin)

Your skins against the 700 of the title **Empty Closet**: what the Black Cloud
Merchant offers each of your characters this hour, marked new or owned; a
pop-up when you open the shop; every skin you still lack with its picture and
price, and what the rest costs; and what combining skins is worth.

- **Merchant**: each character's offers of this hour (Special and Skins tabs,
  and any other tab with skins), **New** (gold: a skin you lack), **Owned**
  (dimmed) or **?** (a skin whose closet entry is not known yet), with price
  and discount and when the stock changes. Which characters of the server you
  have not looked at this hour. **What the merchant brings**: from the stocks
  you open, how often a skin you lack is on offer and what a paid change of
  the stock (the shop's refresh button: 500 Kinah, then 1,000, 2,000 ...
  15,000) costs per new skin.
- **Pop up at the shop**: opening a tab of the Black Cloud shop opens a small
  window over the game with that character's skin offers, new ones first,
  your count and who has not looked yet; it closes after 3 minutes (the game
  sends nothing when the shop closes) or with its ×. **Note new skins**: a
  note when a skin you lack is on offer.
- **Missing**: every skin you lack (one per closet entry) with its picture,
  grade, slot and the merchant's list price, filterable by kind and grade,
  searchable; above, what the skins still needed for 700 cost: the cheapest
  all at 50 % off, an average mix at the usual discount, the dearest at 10 %
  off, and every merchant skin you lack.
- **Combine**: per grade put in, how many of the next grade you lack, the
  chance a combine gives a skin you lack, and the combines and fees for one,
  with or without a Lucky Aura (NCSOFT's published chances and fees).
- **Inventory's floater**: the count goes to the Inventory plugin (`share`),
  whose Limits can show **Skins 622 / 700** in its floater.

## How it knows

- **Your closet**: the game sends it whole at login (every look you have,
  account-wide) and each new one when it comes. Start the meter before you
  log in.
- **The merchant's stock**: sent when you open a tab of the shop; ten offers
  a tab, each character its own, a new stock every full hour. The layout is
  Pet Finder's (PetTracker's).
- **Which skin fills which closet entry**: the skin's icon names the look's
  number (`WP_ST_0015` → weapons, look 15, staff), as every skin bought so
  far confirms. Sets and costumes whose icon has no number are learnt when
  one is bought.
- **Prices**: the merchant's list price depends only on grade and slot (a
  Legend weapon 960,000, Legend boots 403,200, Rare 2.5 times Common, Legend
  10 times); the discount is 10, 20, 30 or 50 %.

## Permissions

`storage` (settings, your closet, the stocks seen), `notify` (a skin you
lack on offer), `widgets` (the pop-up), `share` (the count for the
Inventory), `events:character` (whose stock it is), `events:items` (which
skin was just bought, for the looks it learns), `web:assets.playnccdn.com`
(the skins' pictures from the game's icon server), and one `decoder:` per
game message it reads. Nothing is sent anywhere.

## Data

Skin names, grades and icons: the Inventory plugin's item list, from AION 2's
client via SkeeveAN's Aion-DPS-Meter (MIT) and Aion2Data
(`dev/make_data.py`). AION 2 names and game data belong to NCSOFT.

## Tests

`bash dev/ci.sh <meter source>`: the decoders through the meter's own
`decoder.rs` on frames built from the layouts, and the logic.
