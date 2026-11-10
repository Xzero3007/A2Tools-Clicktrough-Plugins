# Inventory (A2Tools plugin)

Your inventory, character storage and server storage, each item with its
picture and name and what the sellable ones bring on your server's market;
the drops of a session; your limits and keys, and a floater with the ones you
pick.

- **Inventory, Character storage, Server storage**: every item with its
  picture, name, grade and count, sorted by value (or name, count, grade), a
  search, and **Sellable only**. **Sellable** (gold) is an item traded on your
  server's market and not bound: the lowest listing on your server (else the
  average sale of the last 28 days), times how many, and the sum of each list
  (before the market's 10 % fee; after it in the sum's tip). An item whose
  lowest listing is far above its **usual price** (5 × or more: a single
  listing at a fantasy price, as Destruction Cloaks at 10,000,123 while they
  usually go for about 65,000) counts at the usual price, marked **Usual
  price** with the why on hover: `anomaly.js`, the same file as the Market
  plugin's, with the course the hourly price copy keeps. Bound items and
  currencies are listed without a value; the inventory's Kinah stands in the
  line above the list.
- **Drops**: what came into your inventory in a **session**, every item
  with its count and worth and **where it came from**: the buttons above
  the list show **All**, **Gathered** (the game's own gathering result for
  the item), **Loot** (picked up from the ground), **Rewards** (a chest or
  Hidden Cube opened with a key, or several items at once) and **Other**
  (bought, crafted, from mail or a quest). Kinah, Kinah per hour and Abyss
  Points gained stand in the line above.
  - **Gathering**: how often you gathered, at how many spots, how many items
    (and per gathering), the **great** gatherings the game marked, the
    **bonus** items it added, and what it is worth (in all and per hour);
    **Where** splits them by map and region (as the Map plugin knows them:
    with the Map's window or overlay open).
  - **Dismantled**: common gear the game breaks down for Enhance Stones as
    it comes in is **no drop**: it is taken out of the list, and the line
    says how many pieces, how many Enhance Stones and the bound Kinah it
    cost.
  - **Sessions**: a session goes on across restarts and changes of
    character, and a **new one starts by itself** when you play again after
    a break (3 hours at first; 1, 6 or 12 hours, or only by hand, in the
    menu on the right). **Played** counts the time something happened,
    pauses of 5 minutes or more left out, and the per-hour numbers go by it.
    The menu on the left shows the **earlier sessions** (the last 40).
    **New session** starts one at once.
- **Limits**: Kinah gained today (of 1,000,000), the week's Abyss Points (of
  the week's limit), and the keys and entry counts the game keeps (Shugo
  Festival keys, Nightmare, Dimensional Invasion, the daily dungeons, the
  Ascension Trial, the Abyss's hours, the party dungeons' rewards ...), each
  with its bar. A tick puts it in the **floater**, a small card over the game
  (switched on here; dragged by its head, its sides set the width, the slider
  how much of the game shows through; the meter's lock locks it too:
  locked, clicks go through it to the game).
  **1 2 3** in its head are three places of your own: a right-click on a
  number keeps where the floater is and its width there, a click goes back
  to it (a kept place's number is gold). The **gauge button in the meter's
  title** (meter patch 0035) shows or hides the floater without the plugin
  window; the puzzle button leaves it as it is.
- **Another character**: the menu at the top shows the items of every
  character seen before, as they were last.

## Where it comes from

The game sends the inventory and both storages when you enter the world
(log in, or switch character), and each change after it: the meter reads
them (its patch 0034, permission `events:items`), and the plugin keeps
each character's (the server storage once per server). So:

- **Start the meter before the game** (or log in again once): a meter
  started later sees only what changes, until the next login.
- Moving items between the inventory and a storage sends nothing the meter
  can read: the storages are exact as of the last login, and after sorting
  your inventory (the sort resends it, and what it has more or less went to
  or came from a storage).
- Kinah today comes with each gain; the week's Abyss Points at login, and
  with patch 0034 each gain is added to them at once.
- The keys and entry counts come at login and each time one changes.
- The **server's gathering limit** is not read from the game yet.
- Gathering: the game reports each gathering's item, amount and bonus; the
  plugin reads it with its own decoder (`gathered`, permission
  `decoder:gathered`) and matches it to the item coming in. The map and
  region come from the Map plugin (`events:shared`).

Prices: aion2.exchange's (players' collected market prices), first from the
Clicktrough fork's hourly copy on GitHub, else from aion2.exchange itself,
read when the window opens and every 30 minutes (`a2.web.get`). Pictures:
the game's icon server (assets.playnccdn.com), through the meter
(`a2.web.image`). Nothing is sent anywhere.

## Data

`data.js` is generated: `python3 -I dev/fetch_icons.py <cache>` (Aion2Data's
item lists, once), then `python3 -I dev/make_data.py <SkeeveAN checkout>
<cache>`. Item names, grades, the gear's and crafting items' icons and the
content tickets come from SkeeveAN's Aion-DPS-Meter (MIT, read from the game
client; NOTICE-SkeeveAN.txt), the other items' icon names from Aion2Data
(NOTICE-Aion2Data.txt). Tests: `bash dev/ci.sh`.
