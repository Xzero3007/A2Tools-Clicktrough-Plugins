# Boss Notes

A cheat sheet for boss fights. You write what to do for each boss, phase by
phase; during the fight the plugin follows the boss and shows the phase you
are in, what to do, alerts with a countdown and what comes next, in its
window and in an **overlay over the game** (the swords button in the meter's
title, or Overlay in the window).

## Sheets

A sheet belongs to one boss: **general notes** and a list of **phases** and
**alerts**.

- A **phase** stays until the next phase starts. Shown big, in gold.
- An **alert** shows for a while with its seconds counting down (the time you
  give, else the buff's time when a buff starts it, else 8 s). Shown in red,
  above the phase. An alert started by a buff ends when the buff ends.

Each starts with a **trigger**:

| Trigger | When |
| --- | --- |
| At the pull | the fight starts |
| HP at or under % | the boss's HP reaches it (once a fight) |
| Seconds into the fight | that long after the pull (once a fight) |
| Boss casts skill | its cast bar starts (each time) |
| Boss uses skill | the skill goes off, also one without a cast bar (each time) |
| Buff lands on boss | the buff comes on the boss (each time) |
| Buff on boss ends | the buff goes (each time) |

The **next phase** is the first one after the current one in your list that
has not happened yet: order the phases as the fight goes.

The bosses are listed by dungeon (the game's own names, in the meter's
language), with the lines the game shows for their casts and buffs; **+ Alert**
puts one on the sheet. Five mechanics checked by hand in Enhanced Boss
Telegraph (Thamon's red and purple, Vakron's jump, Talisra's spears,
Phantasmal Lakshmi's reflect) are **starter sheets**: yours once you change
them, Reset brings the starter back. A boss the data doesn't know gets a
sheet of its own by its NPC code once you fought it.

## Fights

Every boss fight is **recorded**: what the boss cast and used, the buffs it
got and how long, and its HP over time, only the boss's, never a player's.
The last 10 fights are kept (5 to 20 in Settings). A fight shows each cast,
skill and buff once, when it came first, the boss's HP then and how often,
with the game's line where the data has one; the HP's course by tens. **+
Phase** and **+ Alert** put that moment on the boss's sheet with its trigger
filled in: you write only the name and what to do. So nobody needs to know a
skill's id.

## Overlay

The boss's name, HP and fight time in its head, the alerts and the phase, the
next phase and the general notes (both can be turned off in Settings), text
size 12 to 40 px. Dragged by its head, sized from its lower corners, its own
opacity; places **1 2 3** (right-click keeps the place, click goes there) and
✎ opens the sheet. With the meter locked clicks go through to the game. Hidden
in the Shugo games and the shop; shown in dungeons. **Keep the overlay up
between fights** shows the last boss's notes when no fight goes on.

## Sharing sheets

Settings → **Copy all sheets** puts them on the clipboard as text (or selects
the text to copy); **Paste sheets…** adds sheets copied from Boss Notes. The
plugin sends nothing anywhere: sheets and fights stay in the meter's storage.

## What it reads

- `events:combat` (meter patch 0066): the monsters you fight, with NPC code,
  name, HP and max HP as the meter reads them for its boss bar, bosses first.
  A fight starts when the meter lists the boss and ends when it hasn't been
  hit for 20 s or is dead.
- Its decoders, as Enhanced Boss Telegraph's: `09 38` a cast bar starts,
  `02 38` a skill goes off (caster and skill), `2A 38` a buff lands (entity,
  instance, buff, length), `2C 38` a buff ends (the instance). They come for
  every entity; only the bosses being fought are kept.

The boss's lines are not in its traffic: the client plays them from its own
tables. The plugin hears the cast or buff and names the line the game shows
for it.

## Data

`bosses.js` is Enhanced Boss Telegraph's (A2 Tools, GPL-3.0), built from the
game's tables (see NOTICE-A2Tools.txt). `dev/sync_bosses.sh` copies it again
from the original's plugins as this build pins them.

## Versions

- 0.1.0: the first.
