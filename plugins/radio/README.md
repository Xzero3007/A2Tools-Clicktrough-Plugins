# Radio (A2Tools plugin)

Internet radio while you play, from a fixed list of stations.

- **Countries** as tabs: ★ Favourites, All, Türkiye, USA, Germany, Japan, World;
  under them the **genres** found there (Pop, Hits, Rap & Hip-Hop, R&B, Old
  school, Slow, Rock, Türkü & Halk, Sanat, Electronic, Chill, Alternative,
  Anime, City pop, Retro, Jazz, Vocaloid, Game music, News & talk, Local radio)
  and a search (Turkish letters fold: "turku" finds Türkü).
- **109 stations**: Best FM first, Best Rap, Kral FM, Kral Pop, Power Türk,
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
  Japan (0.3.0): LISTEN.moe, R/a/dio, J1 HITS, XTRA and GOLD, asia DREAM
  radio's Japan Hits, J-Pop Powerplay (and Kawaii), J-Pop Sakura, J-Rock
  Powerplay, J-Club Hip Hop, Jazz Sakura and Club Bandstand, BOX Japan City
  Pop, Retro-Ko, Yumi Co. Radio, Nightwave Plaza, Miku Radio, Gensokyo
  Radio, Nonstop Casiopea, Moon Mission Recordings, Otaku Music Radio, Big B
  Radio J-Pop, Anison.FM, Eden Radio, Patchwork Archive, NHK World Radio
  Japan, and the community stations FM Setagaya, FM わぃわぃ and Radio
  Hayama (radiko and NHK's own radio play only inside Japan).
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
On Arch, stations that send AAC need `gst-libav`, and stations that send
HLS (most Turkish ones: Kral, Power, TRT Türkü, TRT Nağme ...) need
`gst-plugins-bad` (`sudo pacman -S gst-libav gst-plugins-bad`); MP3 plays
with what the meter needs anyway.

0.3.0: **30 Japanese stations** (J-Pop, anime, city pop, J-Rock, Japanese hip
hop, jazz, Vocaloid, NHK World, local radio). HLS streams play: the meter
turned WebKit's HLS on (meter patch 0043); before, every HLS station showed ✕.

0.2.0: stations that didn't play are **hidden** (a tick at the bottom shows
them again; the list says how many are hidden), and **Check stations** tries
the hidden ones too. A check counts only for the addresses it tried: a
station whose addresses changed in an update is tried afresh. Süper FM, Joy
Türk, JoyTürk Rock, Metro FM and Gönül Türküleri try their AAC streams first
(their Shoutcast ones didn't play).

The stream addresses were taken from the stations' own stream pages and from
radio directories that print them (November 2026). No station's name, logo
or programme is part of this plugin beyond its name in the list.

Licence: GPL-3.0-or-later (`LICENSE`).

While a station plays, the meter shows its name and controls (before, pause,
after, mute, volume, favourite, stop) in its player row under its title (0.4.0,
permission `media`, meter patch 0049). Pause (0.5.0) keeps the station: play
goes on live, connecting again.
