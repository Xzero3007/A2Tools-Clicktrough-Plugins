# Closet (A2Tools plugin)

Your skins against the 700 of the title **Empty Closet**: what the Black Cloud
Merchant offers each of your characters this hour, marked new or owned; a
pop-up when you open the shop; every skin you still lack with its picture and
price, and what the rest costs; a slim status floater; and what to combine
and extract and what no longer pays.

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
  your count, who has not looked yet, and what to combine and extract; it
  closes after 3 minutes (the game sends nothing when the shop closes) or
  with its ×. Drag it by its head, size it at its edges and corner or
  with the sizes on the Merchant tab: the meter keeps where it is, the
  plugin its size (while the meter's lock is on, the edges are hidden). **Note new skins**: a note
  when a skin you lack is on offer.
- **Status floater** (the tick, or the shirt button in the meter's title):
  a slim window that stays: your count, when the merchant changes, each
  character of the server looked at this hour or not (and how many new
  skins it had), what to combine and extract, and the gear in your bag to
  extract. Moved and sized like the pop-up. It shows at the Black Cloud shop
  and in the closet (the game sends the closet when it opens) and goes when
  you walk off or after 3 minutes; **Everywhere** keeps it up all the time.
  It steps aside while the pop-up is open. Walking off closes the pop-up
  too.
- **Missing**: every skin you lack (one per closet entry) with its picture,
  grade, slot and the merchant's list price, filterable by kind and grade,
  searchable; above, what the skins still needed for 700 cost: the cheapest
  all at 50 % off, an average mix at the usual discount, the dearest at 10 %
  off, and every merchant skin you lack.
- **Combine**: a combine takes 4 skins of a grade and gives one, the next
  grade at NCSOFT's published chance (Common 25 %, Rare 20 %, Epic 15 %,
  Unique 10 %; 35/30/25/15 % with a Lucky Aura), else a skin of the same
  grade (as seen in the game). A dyed skin can't be combined until its
  dye is removed. Per grade: the share you lack of it and of the next, new skins per
  combine (counting the copies it gives, which go into the next combines),
  Kinah per new skin, your spare copies and the combines they allow, and a
  verdict: **Combine**, **Only for <next grade>** (rarely new itself, but it
  feeds the next grade) or **Stop**.
- **Extract settings**: gear gives its look as a skin when extracted
  (Common, Rare, Epic one time in four, Unique one in ten). The game's
  Extract Settings dialog drawn again, ticked as it pays for your closet:
  Auto Extract on, a grade ticked when its pieces bring new skins (Epic) or
  are worth little anyway (Common), Rare off to sell, Unique off to extract
  by hand only the pieces with a new look; each with its chance of a new
  skin a piece. The floater shows the same ticks. Grades in the game's
  colours and names (Epic blue).
  **In your bag**: the gear the meter saw in your inventory whose look you
  lack, with the chance to get it.
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
  Epic weapon 960,000, Epic boots 403,200, Rare 2.5 times Common, Epic
  10 times); the discount is 10, 20, 30 or 50 %.
- **Spare copies**: the closet counts each look's copies (the small number
  on a skin in the game's closet is the copies beyond the first); those are
  what combining uses.
- **Gear looks**: a piece of gear's icon names its look as a skin's does.

## Permissions

`storage` (settings, your closet, the stocks seen), `notify` (a skin you
lack on offer), `widgets` (the pop-up and the status floater), `share` (the count for the
Inventory), `events:character` (whose stock it is), `events:world` (walking off closes the windows), `events:items` (which
skin was just bought, for the looks it learns, and the gear in your bag), `web:assets.playnccdn.com`
(the skins' pictures from the game's icon server), and one `decoder:` per
game message it reads. Nothing is sent anywhere.

## Data

Skin names, grades and icons: the Inventory plugin's item list, from AION 2's
client via SkeeveAN's Aion-DPS-Meter (MIT) and Aion2Data
(`dev/make_data.py`). AION 2 names and game data belong to NCSOFT.

## Tests

`bash dev/ci.sh <meter source>`: the decoders through the meter's own
`decoder.rs` on frames built from the layouts, and the logic.
