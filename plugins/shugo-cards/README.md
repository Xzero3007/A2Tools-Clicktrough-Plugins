# Shugo Cards (A2Tools plugin)

The card rounds of the Shugo Festival and the Dimensional Invasion (the same
rewards), kept and counted. When a round ends the
game shows what lay behind every card, picked or not; this plugin keeps each
round and adds them up, so you see over time where the gold lies and whether
any card is better than another.

- **All / Shugo / Dimensional Invasion** (above the tabs, with each one's
  count): every tab, the statistics and the tip go by the rounds picked here,
  both events together or each alone. A round names its event by number:
  21070110 is the Shugo Festival; a number not known yet is guessed by the
  time (20 to 50 minutes past the hour: the Dimensional Invasion, which comes
  at half past) and marked so, and its two buttons settle it for every round
  of that number.
- **Rounds**: the five cards from the left, each with its items (picture,
  name, count; gold items first and marked), its currencies (Abyss Points,
  Enhance Stones, Centuryroot Tokens) and what its sellable items bring on
  your server's market (the most valuable card in gold). **You** (×2 when
  picked twice) marks your picks. A **Bonus** layer shows above a card's own
  items: so far it came on a card picked twice, with its second pick. ‹ ›
  go through earlier rounds.
- **Gold**: every gold item (Unique and higher) with its picture and name,
  when, on which card, bonus or not, yours or not picked; and by item, how
  often and on which cards.
- **Places**: per card place (1 to 5 from the left) how often its own items
  held gold, how often it was the most valuable card, its worth on average
  and your picks. **The tip**: a chi-square test of "every place is alike";
  only when that is below 5 % by chance (and at least 25 cases) does it say
  which card to pick. Until then it says how far it is: a strong lead (one
  place twice as often) shows after about 50 cases, a moderate one after
  about 130. If the game shuffles the cards, no tip ever appears, and that
  is the answer. Bonus layers are not counted here (they show only where you
  picked twice).
- **Items**: everything seen on the cards, on how many cards and in all,
  with each one's price.

**Kinah**: the lowest listing on your server (else the average sale) from
aion2.exchange (the fork's hourly copy). A card's gear often has another id
than the copies traded: then the same item's price under the other id counts,
marked ≈ (that copy may be bound). A price far above the item's usual one
counts at the usual (`anomaly.js`, the Market's). Currencies and bound items
have no Kinah value.

**How**: the plugin's decoder `round` takes the round's end (frame `0A 57`)
whole (the meter's `rest` field, patch 0042) and `calc.js` reads it: the
cards in their places, each with its bonus layers, its items, and who picked
it how often. Only "you" or "someone else" is kept, no names. Nothing comes
before the round ends: what lies behind a card is not known while you pick.
A round that does not read is kept as it came (the last 5) and counted at
the top.

Item names, grades and icons: `data.js` is the Inventory plugin's (SkeeveAN's
Aion-DPS-Meter, MIT, and Aion2Data; see the NOTICE files), `anomaly.js` the
Market's and Inventory's; `dev/ci.sh` checks they are the same files.

Tests: `bash dev/ci.sh <meter source>` (`dev/tests/frames.py` builds the test
frames by hand).
