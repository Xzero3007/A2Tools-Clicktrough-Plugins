# Armory

Your AION 2 character as NC's official character pages show it, with every
value written out (no hovering), and what to do next.

- **Overview**: the gear score taken apart (item levels, enhance levels,
  Amplify, Manastones, Theostones, Daevanion points), checked against the
  game's own number; the Daevanion boards (points spent of all); titles with
  their stats; pet and wings.
- **Stats**: the deity stats round a wheel and the base stats inside, each
  with what its points give; and **what each stat does**, every one your
  character has (from deity stats, gear, Manastones, titles, Daevanion), in
  the game's own words (Double Chance, Perfect, Endurance, Penetration, the
  caps ...), with where yours come from, and a short "In short" of how they
  work together; or every stat the game has.
- **Gear**: each piece with its enhance and Amplify level, item level, its
  stats and what the enhance level adds, sub stats, Manastones (and empty
  slots), Theostones, the extra skill levels it gives, and its next step:
  chance, the chance a failure adds, Kinah and materials a try.
- **Skills**: each skill's level split into skill points (to 10), Daevanion
  (to 14: one node on each of the first four boards) and gear and Arcana (the
  rest), with what is left to 20: the Daevanion nodes still closed (board,
  grade, points) and the levels gear and Arcana must give. Stigmas apart.
- **Reference**: a build to compare with and aim at, read from a questlog.gg
  character build page saved in the browser (its Equipment, Skills and
  Daevanion tabs; nothing is fetched from questlog.gg, the files are read in
  the plugin). Slot by slot yours against it, skills, stigmas, Daevanion
  points, deity stats. **Edit** changes a slot (any item by name, its levels);
  **Code** shows the reference as text, to keep or move.
- **Goals**: a target gear score (or combat power, by an estimate), and the
  cheapest enhance and Amplify steps on the gear you wear to get there, each
  with its Kinah on average and 9 times in 10, and the materials: Enhance
  Stones, Amplify Stones (in Kinah at your server's market price), bound
  scrolls. What the gear can't give: Daevanion points still open, empty
  Manastone slots, the reference's better pieces.
- **History**: every reading kept when something changed (combat power,
  gear score, gear, skills, Daevanion, titles), with a chart; while you play,
  the game's own combat power and gear score as they change.

The character you play is read by itself (when its last reading is older
than 6 hours); **Update** reads it again. **Look up** finds anyone by name in
a shard.

## Where it comes from

- **Characters**: NC's AION 2 character pages (aion2.plaync.com, the
  official site's character info, and its character search), read through
  the meter (`a2.web.get`, the meter's patch 0032), pictures through
  `a2.web.image` from the game's icon server (assets.playnccdn.com) and NC's
  portraits. Nothing is sent but the lookup itself (a name, or a server and
  a character's id); no account, no sign-in. NC's page is behind the game
  until it updates; the header shows the game's own numbers beside it.
- **The gear score**: the game's Item Level from its parts, found on 24
  characters and exact for every one: a piece's item level and enhance level
  (Arcana too), 5 an Amplify level, Manastones 1 to 4 and Theostones 3 or 5 by
  grade, 1 a Daevanion point (a node costs 1 to 4 by grade). Titles don't
  count.
- **Enhancing**: the game's own enhance (Enchant) and Amplify tables and
  every enhanceable item, read from AION 2's files by
  [Aion2Data](https://aion2data.com) (unofficial; `dev/make_data.py` builds
  `data.js` from its calculator's data file). Game data belongs to NCSOFT.
  Average tries count the chance a failure adds; a step that loses a level on
  failure (the Clash Rune) counts the climb back. Enhancement Supplements are
  not counted.
- **What the stats do**: the game's own stat descriptions, from its files as
  Aion2Data's stats page lists them (`dev/make_data.py` reads them too).
- **Prices**: aion2.exchange's market prices of your server, from the fork's
  hourly copy (the Market's).
- **Combat power**: NC doesn't publish its formula. The goal's combat power
  is an estimate: from your own history once it has two changes, before that
  about 52 a gear score point (24 characters of all strengths, 2026-10-28).

## Data

```bash
python3 -I dev/make_data.py <cache folder> --fetch   # downloads Aion2Data's file, writes data.js
bash dev/ci.sh ../ct-src                             # the tests
```
