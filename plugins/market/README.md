# Market (A2Tools plugin)

What the gathered materials bring on your server's market, what they cost
made from Odyle, what every recipe costs and brings, and where each material
goes.

- **Gatherables**: Odyle, ore, gemstones, logs, herbs and cooking ingredients
  in every grade: the lowest listing, how many are listed, how many sold in the
  last 28 days and at what average, and the change.
- **Odyle morph**: Substance Morph turns one Odyle into one gathered material of
  the same grade (Odyle → base, Fine → Fine / Fresh, Pure → Pure, Radiant →
  Radiant), always. For each of the 42 materials: its market price against
  the Odyle's, and what morphing one saves (or "buy" when the market is
  cheaper). What morphing makes is **bound**: it goes into your own crafting,
  not onto the market; the way to sell it is to craft something with it (see
  Recipes). Also what Odyle Energy (Bound), +40, costs through Substance
  Morph (25 Odyle, 5 Fine Odyle, 1 Pure Odyle and 50,000 Kina).
- **Recipes**: your faction's recipes (from the server picked), by profession,
  with a search over products and materials: what the product sells for (its
  lowest listing × how many, less the market's fee, 10 % unless changed), what
  the materials cost bought on the market, what they cost with Odyle morphed
  where that is cheaper, and the profit. A click shows each material, how
  many, its price on the market and the best price (morph or NPC marked), and
  the total; and the combo chance with what it adds. One craft that succeeds:
  failures and combos are not counted. The bound tools the NPC shops sell
  (catalysts, solvents, inks ...) count at their NPC prices, which can be
  changed at the bottom.
- **Materials**: every material your faction's recipes use, with its price
  and in how many recipes; a click lists those recipes with how many each
  needs, what that many cost, and what the product sells for. Filter by
  gathered materials, crafted materials, NPC tools or earlier tiers.

In every tab:

- **Asmodian / Elyos** beside Update (remembered; your server's side until
  picked): only that side's materials and recipes (Asvata, Azpha ... are
  Asmodian; Yggdrasil, Aria ... Elyos; Odyle and ore both).
- **One column layout** for a whole list, its header kept at the top while
  the list scrolls; the sales columns only while aion2.exchange has sales.
- **A star** before a name makes the item a favourite, in every tab;
  **Favorites** in the bar lists them first (in Gatherables as a group of
  their own), off again the usual order.
- **A click** on a material (Gatherables, Odyle morph, Materials) lists the
  recipes that need it, how many and what that many cost.
- **A map button** beside a gathered material (also in a recipe's materials)
  shows where it is gathered in the Map plugin, with the way there (permission
  `share`).

Prices: the server is picked from yours when the meter knows your character,
else from the list. They are [aion2.exchange](https://aion2.exchange)'s
(players' collected market prices, a new snapshot about every hour), read
when the window opens and every 30 minutes while it is open, through the
meter (`a2.web.get`, Clicktrough patch 0016; the plugin's page itself has no
network):

1. first from **Clicktrough's copy** on GitHub: aion2.exchange is slow and
   often briefly down ("database unavailable"), so the fork's workflow
   `market-prices.yml` asks it patiently once an hour (`dev/copy_prices.py`,
   the European servers) and publishes a small file per server on the
   branch `market-data`, which the plugin reads in a moment;
2. from aion2.exchange itself when the copy lacks your server or is older
   than 3 hours; and the old copy still when that fails.

The line at the top says which ("Clicktrough's copy" or "aion2.exchange")
and what went wrong ("could not connect: ...", "no answer in time", "the
service is down right now"). The last prices are kept for the next start.

## Data

`data.js` is generated from SkeeveAN's
[Aion-DPS-Meter](https://github.com/SkeeveAN/Aion-DPS-Meter) (MIT, see
`NOTICE-SkeeveAN.txt`): the recipes and item names of the game client, with
`python3 -I dev/make_data.py <checkout> .`; `dev/provenance.json` names the
revision and every file read. The NPC prices are those MetaBot.GG's crafting
calculator lists from the game files. AION 2 names and game data belong to
their respective owners.

Unofficial, not affiliated with NCSOFT, A2Tools or aion2.exchange.

The plugin's own code: GPL-3.0-or-later, see `LICENSE`.
