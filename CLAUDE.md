# Clicktrough plugins: instructions for Claude

Read this first in every session on this repo. It holds what earlier sessions
learnt about the plugins, so nothing has to be asked or worked out again. The
meter itself (the app, its patches, its releases) is the other repo,
[Xzero3007/A2Tools-DPS-Meter_Clicktrough](https://github.com/Xzero3007/A2Tools-DPS-Meter_Clicktrough),
with its own CLAUDE.md: work on the meter happens there, not here.

## The person

- Writes in **German**: answer in German. Everything that gets built is in
  **English**: UI texts, READMEs, code comments, commit messages, issues.
- Uses the meter on an Arch-based Linux with KDE and updates it through the
  **green button** in the meter's title. Sends screenshots from the game.
- **No blue in any UI** (buttons, highlights, links): neutral whites and greys,
  gold, red, purple are fine. Data colours that match an existing plugin are
  fine (Pet Finder's genus colours).
- Wants results and a short, plain explanation of what changed and what to do,
  not a log of the work.

## Hard rules

- **Write down the plan before changing anything**, in plain words, and wait
  for the person's yes. They decide; don't take features away on your own.
- **Nothing is sent, no account, no prompts, no links out.** A plugin sends
  nothing anywhere and links to no website (no "report it here", Discord,
  donation or sign-in links, no pop-up asking to share). A credit names its
  source as text. The only downloads a plugin can make are the meter's:
  `a2.web.get` for the market prices (aion2.exchange and this build's hourly
  copy on the app repo's branch `market-data`) and the shared world boss /
  Abyss siege timer files (`a2.bossTimers`, `a2.abyssSiege`, read only).
  Anything else needs the person's yes first, and a meter patch.
- **This repo is public. No network analysis goes in here**: no write-ups of
  what the game's traffic holds, no packet captures, no logs. Those go in
  the person's private repo `Xzero3007/A2Tools-Clicktrough-Notes` (clone it
  next to this one as `../a2tools-clicktrough-notes`; its CLAUDE.md says
  what goes there), which also holds what is known about the traffic. A
  plugin's own decoders (its manifest) and the tests it needs are code and
  live with it.
- **Packet logs the person sends** hold chat and names: use them only for the
  analysis in the session, never commit them anywhere.
- **Never push to, or open anything on, the original's repos**
  (`taengu/A2Tools-DPS-Meter`, `taengu/A2Tools-Plugins`). They are read only.
  The working clone `../ct-plugins` is never pushed.
- Commit in this repo as `Claude <noreply@anthropic.com>`, on `main`, and push
  `main`: the meter's release takes `main` as it is. End commit messages with
  the session's attribution lines. Patch commits in `../ct-plugins`: author
  `A2Tools-patch <patch@localhost>`, committer Claude (`dev/setup.sh` sets
  the committer).
- Take data only where its licence allows it, and credit it (NOTICE files,
  READMEs, as text). Game data taken from the client (spawn points, the
  game's map pictures) is the game's, whoever extracted it: Aion 2 Timers'
  spawn points and map pictures are used, as A2 Tools' Pet Soul Tracker has
  them, credited (the person's decision, 2026-10-28). Not allowed so far:
  The Hidden Gaming Lair, allthings.how (gathering spots players collected).
- Plugin storage keys must match `[A-Za-z0-9_-]{1,64}`.
- One project per repo: other projects of the person have their own repos and
  sessions.

## What this repo is

The plugins of the Clicktrough build: three of its own and its changes to the
original's. Nothing is installed from here directly: the app's release puts
them into its package (`build/assemble.sh`), and every meter updates through
the green button. The original's plugins are frozen at one commit and taken
on only when the person decides (see below).

| Path | What |
|---|---|
| `plugins/<id>/` | Own plugins: `map`, `market`, `pet-finder`. Edited here directly. `dev/` holds tests (`dev/ci.sh`) and data generators; it is not shipped. |
| `original/PIN` | The commit of `taengu/A2Tools-Plugins` the build takes the original's plugins at. |
| `original/pins.txt` | Single plugins at another commit (`<id> <commit>`): a new plugin, or a new version of one, without moving PIN. |
| `original/<id>/*.patch` | Changes to the original's plugins (`git format-patch`, applied in order with `git am -3`). Now: Daily Checklist, Event Timers, Roster's report times and hints, Enhanced Boss Telegraph without its link. A file `installed-only` there: the plugin still runs only where installed. |
| `original/left-out.txt` | The original's plugins never shipped or run (the meter's patch 0026): Pet Soul Tracker (Pet Finder replaces it). |
| `build/assemble.sh` | Puts the package's plugin folder together (the release, the app's `setup-workspace.sh` and `a2tools-rebuild.sh` all run it). |
| `dev/setup.sh` | The working clones (below). |
| `dev/export-patches.sh` | Writes `original/<id>/*.patch` again from `../ct-plugins`. |
| `dev/harness/` | `a2.js`, a stand-in for the meter's SDK, and `shot.mjs`, a screenshot of a plugin's page. |

Plugins the original shipped: every one not held back by its author
(`.unpublished`), not left out and not with an own plugin's id goes into the
package; each runs only where the person installed it (Settings → Plugins →
Available), unless `original/<id>/` changes it without an `installed-only`
file.

## Start of a session

```bash
bash dev/setup.sh            # ../ct-plugins at PIN with the patches, ~10 s
bash dev/setup.sh --meter    # and the app repo and ../ct-src (the meter's source), ~1 min
bash dev/setup.sh --build    # and a debug meter with these plugins in it (minutes)
```

`../ct-plugins`: the original's plugins, branch `ct-patches`: PIN, then
pins.txt, tag `ct-base`, then one commit per patch.

## Changing things

**An own plugin.** Edit it in `plugins/<id>/`, raise its `manifest.json`
version, update its README and its row in `README.md`. Test:
`bash plugins/<id>/dev/ci.sh ../ct-src` (`dev/setup.sh --meter` makes
`../ct-src`; Pet Finder's checks its decoders with the meter's own
`decoder.rs` from there, and runs its merchant test from a capture only when
the private notes repo lies next to this one).

**One of the original's plugins.** Work in `../ct-plugins` on `ct-patches`
(after `dev/setup.sh`): a new commit per change, author
`A2Tools-patch <patch@localhost>`. A fix to an existing patch: `git commit
--fixup=<its commit>`, then `GIT_SEQUENCE_EDITOR=: git rebase -q -i
--autosquash ct-base`. Then `bash dev/export-patches.sh <id>`. A plugin
changed for the first time is no longer installed-only unless you add an
`installed-only` file to `original/<id>/`. Raise nothing in its manifest:
Settings tags a changed plugin "Clicktrough" by itself.

**A new plugin or version of the original.** The app repo's "Original watch"
opens an issue (label `plugin-watch`). Look at it as for the meter: what it
reads, whether it sends anything, links out, asks to sign in; tell the person
and wait. Taken: a line `<id> <commit>` in `original/pins.txt` (or PIN moved,
which takes every plugin's newest), its links and anything sending removed by
a patch, `bash build/assemble.sh ../ct-plugins /tmp/x` to see it apply.

**The Map's data.** `plugins/map/dev/make_data.py` builds `data.js`, the
tiles and `icons/` (the game's minimap symbols) from SkeeveAN's
Aion-DPS-Meter, the AION2 Interactive Map, A2 Tools' Pet Soul Tracker map
data (`--pet-maps`, a checkout of taengu/A2Tools-Plugins at `original/PIN`)
and Aion 2 Timers' map (`--a2t <cache>`: `dev/fetch_aion2timers.py
<cache> 1011:5 1111:5 22:3 23:3` downloads it, everything the map has:
Kibelisks, gathering, places, services, quests, monsters, NPCs, the big
pictures; allowed by the person, 2026-10-28): the commands are in the Map's
README. Run it with `plugins/pet-finder` next to the output folder (it reads
`../pet-finder/sources.js` for the monsters' levels and pets). Its `dev/tests/coverage.test.cjs` checks every pet monster of the
game's tables (Pet Finder's `sources.js`) against the map: it fails when one
has no spawn point on a map the plugin has, or lies on an open-world map
without a picture, and lists what differs. A new area or new pets: take the
original's newer data (PIN or pins.txt), rebuild with `--tiles <new map>`,
and let the test say what is missing. Pet Finder's `sources.js` comes with
the Pet Soul Tracker's list; `plugins/map/dev/make_areas.py` builds
`areas.js` from it (the fallback for monsters the data lacks).

**Looking at a page.** Without the meter:
`node dev/harness/shot.mjs plugins/<id> out.png [events.json] [WxH]`. The
events file is `[["character", {...}], ["world", {...}], ...]`, emitted in
order. It lists external requests (there must be none) and page errors.
Playwright is installed in the sessions' machines and needs no options. In
the real meter: `dev/setup.sh --build`, then the app's
`clicktrough/dev/run-meter.sh start`, xdotool on `DISPLAY=:97`,
`run-meter.sh shot <file>`.

**Reaching the person.** Push `main` here. The app's "Clicktrough release"
runs hourly (GitHub starts it every 4 to 5 hours in practice) and builds when
this repo's `main` changed; to have it now, start it by hand:

```bash
gh workflow run "Clicktrough release" -R Xzero3007/A2Tools-DPS-Meter_Clicktrough
gh run list -R Xzero3007/A2Tools-DPS-Meter_Clicktrough -w "Clicktrough release" -L 3
```

It builds in about 10 minutes; the meter offers it within 20 minutes (the
green button). The release notes list the plugins that changed. A plugin
patch that no longer applies, or a failing `ci.sh`, fails the release (an
issue opens in the app repo).

## The plugin interface (what a plugin can use)

A plugin is a folder with `manifest.json` (`id`, `name`, `version`,
`permissions`, optional `decoders`, `widgets`), `index.html` and its scripts.
Its page loads `/_sdk/a2.js` and runs in a sandboxed frame; every call and
event is checked against its permissions, in the page and again in the meter.

Events (`a2.on(name, fn)`):

| Event | Permission | What |
|---|---|---|
| `character` | `events:character` | The character playing: name, server, class, level, combat power, gear score, and the game's entry counts (Odyle energy, content counts and times, shop limits, crafts, Kinah today, Abyss Points), each with when the game reported it (`seenAt`). Not replayed: a plugin not running misses changes. |
| `decoded:<name>` | `decoder:<name>` | The plugin's own decoder (its manifest) on a matching game frame. Numbered and replayed for the meter's run. |
| `world` | `events:world` | The zone, the player's position (exact or estimated, about 10 m in the median), monsters and objects around. At most 4 a second, a heartbeat every 2 s. |
| `shared` | `events:shared` | What other plugins `a2.share` (Pet Finder's pets, the Map's spawns, Event Timers' and Market's focus). |
| `bossMap`, `abyss` | `feed:boss-timers` | Field bosses of a map the player opened; Abyss artifact holders. |
| `ping`, `game`, `language`, `theme`, `compact`, `visible` | none | Ping, the game window, Settings' language and colours, the window folded, shown or hidden. |
| `fps` | `fps` | Frame rate, while asked for with `a2.watchFps(true)`. |

Calls: `a2.storage.get/set` (`storage`, a JSON file per key, ≤ 1 MB, key
`[A-Za-z0-9_-]{1,64}`), `a2.notify` (`notify`), `a2.file(path)` (its own
images and JSON as a data URL, ≤ 8 MB; WebKitGTK can't load a plugin's own
files once its page started), `a2.share(value)` (`share`, ≤ 64 KB),
`a2.web.get(url)` (`web:<host>`, only the market price hosts),
`a2.bossTimers` / `a2.abyssSiege` (`feed:boss-timers`, read only; live
updates and reporting don't exist in this build), `a2.window.*` (`window`),
`a2.widgets.*` (`widgets`, `resize` is Clicktrough's).

Decoders: fixed layouts read from the start of a frame's body: `u8`, `u16`,
`u32`, `u64`, `i32`, `varint`, `skip:N`, `list` (counted, nested two deep);
at most 32 fields a level. No strings, floats or conditionals: a plugin reads
alternatives with several decoders on one frame type, and long layouts in
parts. `self: "<field>"` keeps only frames about the player; `immediate`
skips the 500 ms wait that lets the login's identity land first.

## Known pitfalls

- WebKitGTK: a plugin's frame can't load its own files once its page has
  started (use `a2.file`), and a `<select>` is drawn in the desktop's light
  theme unless styled.
- The player's own position: the game sends it only with an action, an
  effect, a teleport or a loading screen. In between, the meter estimates it
  from what is around (SkeeveAN's method), and the Map smooths it.
- Shop limits and crafts reach a plugin only when that window opens in the
  game; Abyss Points only at login. Roster explains it in its hints.
- aion2.exchange is slow and often answers 503: Market reads the hourly copy
  first.
- `pkill -f <pattern>` also kills the shell running it: use
  `pkill -x a2tools-dps-met`.
