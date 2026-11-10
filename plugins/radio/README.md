# Radio (A2Tools plugin)

Internet radio while you play, from a fixed list of stations.

- **Countries** as tabs: ★ Favourites, All, Türkiye, USA, Germany, World;
  under them the **genres** found there (Pop, Hits, Rap & Hip-Hop, R&B, Old
  school, Slow, Rock, Türkü & Halk, Sanat, Electronic, Chill, Alternative)
  and a search (Turkish letters fold: "turku" finds Türkü).
- **79 stations**: Best FM first, Best Rap, Kral FM, Kral Pop, Power Türk,
  PowerTürk Rap, Power FM, Süper FM, Joy Türk, JoyTürk Rock, Metro FM,
  Number1 Türk (and Türk Rap), Radyo Fenomen (Türk, Rap, Türkçe Rap), Slow
  Türk, Radyo Viva, Alem FM, TRT FM; türkü and halk müziği (TRT Türkü,
  Radyo Türkü, Radyo Seymen, Mamaş FM Türkü, TRD 4 Halk, Gönül Türküleri);
  Türk sanat müziği (TRT Nağme, Turkuvaz Musiki, Mamaş FM TSM, TRD 3 Sanat,
  Pal Alaturka). US hip hop: Hot 97, Power 105.1, WBLS, Power 106, Real 92.3,
  KDAY, The Box, The Beat, K104, Hot 107.9, V-103, WGCI, Power 99, WHUR,
  and internet stations (Hot 108 Jamz, Powerhitz 1Power, Snoop Dogg's
  Cadillacc Music, Throwback Jamz, Defjay, HipHop Request, Hot 21, Dirty
  South Radio). Germany: 1LIVE, bigFM (and its US Rap, Oldschool Rap,
  Hip-Hop and Deep & Tech House channels), ENERGY Berlin, FluxFM (and
  ElektroFlux), DASDING, N-JOY, sunshine live (and Techno, House, EDM).
  World: SomaFM (Groove Salad, Beat Blender, DEF CON Radio, The Trip, Fluid,
  Space Station Soma), Ibiza Global Radio (and Classics), Radio Record,
  Intergalactic FM.
- **Player**: play/stop, the station before or after (in the list shown),
  mute, volume (also the wheel over the player), ☆ favourites. The sound
  plays on with the plugin's tab closed or the dock hidden. **Play the last
  station when the meter starts** if ticked.
- **Player over the game**: a small player (the radio button in the meter's
  title, or the tick at the bottom) with the station, play/stop, before and
  after, mute, volume and ☆; moved by its head, the meter's lock is its lock.
- **Doesn't play from here**: some US stations (iHeart, Audacy) send their
  stream only inside the USA, and a station can move its stream. Each
  station has one or more addresses, tried in order; when none plays it is
  marked ✕ with why (kept a week, a click tries again). **Check stations**
  tries each station of the list for a few seconds, muted, and marks the
  ones that don't play.

Nothing is sent but the request for the stream itself, and the plugin links
to no website. The meter lets it play only from the stations' servers
(permission `radio`, meter patch 0043, `RADIO_HOSTS`); a station on a new
server needs that list changed too, and `dev/ci.sh` checks both agree.
Stations that send AAC need `gst-libav` on Arch (`sudo pacman -S
gst-libav`); MP3 and the HLS streams play with what the meter needs anyway.

The stream addresses were taken from the stations' own stream pages and from
radio directories that print them (November 2026). No station's name, logo
or programme is part of this plugin beyond its name in the list.

Licence: GPL-3.0-or-later (`LICENSE`).
