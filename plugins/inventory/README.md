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
  (before the market's 10 % fee; after it in the sum's tip). Bound items and
  currencies are listed without a value; the inventory's Kinah stands in the
  line above the list.
- **Drops**: what came into your inventory since **New session** (pressed, or
  the plugin's first start): every item picked up, gathered, crafted or
  bought, with its count and worth; **Loot** marks what came from the ground.
  Kinah and Abyss Points gained stand in the line above. The session goes on
  across restarts until **New session**.
- **Limits**: Kinah gained today (of 1,000,000), the week's Abyss Points (of
  the week's limit), and the keys and entry counts the game keeps (Shugo
  Festival keys, Nightmare, Dimensional Invasion, the daily dungeons, the
  Ascension Trial, the Abyss's hours, the party dungeons' rewards ...), each
  with its bar. A tick puts it in the **floater**, a small card over the game
  (switched on here; dragged by its head, its sides set the width, the slider
  how much of the game shows through; **Lock in place** keeps it still).
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
