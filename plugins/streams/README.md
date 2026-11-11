# Streams (A2Tools plugin)

Twitch and YouTube while you play, in small video overlays over the game:
Twitch and YouTube each in its own, both at once if you like.

- **Twitch**: **Favourites** (your channels: who is live, with the
  stream's picture, title, game, how long it runs and how many watch; the
  others below as offline), **AION 2** (the live AION 2 streams with the
  most viewers), **All live**, and a **search** (a channel's name; Enter
  on an exact name finds that channel too). ☆ on a card keeps the channel
  in your favourites. No Twitch account.
- **YouTube**: **Subscriptions** (the newest videos of your FreeTube
  subscriptions, read from FreeTube's own file on this computer, its own
  folder or its Flatpak's, and of the channels you added; one channel or
  all), **Channels** (the list), and a **search**; a video's link pasted
  into the search plays it at once. ☆ on a video adds its channel.
- **A click plays it** in its overlay (Twitch's or YouTube's: a Twitch
  stream and a YouTube video can play at the same time, each with its own
  volume, opacity, quality, size and place): mpv plays it (the meter draws
  it into the overlay), **above the game**, and **while the meter is locked
  clicks go through it**. Unlocked, the pointer on it shows the title,
  pause and ×; drag it to move it, drag a corner to resize it. Sizes S, M,
  L, XL, quality (1080p down to 360p, or sound only), pause, mute,
  volume and the video's opacity (◐, 20 to 100 %: the game shows through
  it) are at the bottom of the window (both playing: Twitch | YouTube picks
  which one they are for). While a video plays, the meter shows its controls
  (pause, mute, volume, opacity, quality, stop) in its player row under its
  title, a button for each one playing (meter patches 0049 and 0051). The
  **TV button** in the meter's title shows the Twitch overlay (and plays
  the last channel again) or stops it.
- Favourites and settings stay in the plugin's storage on this computer.

**Needs** `mpv` and `yt-dlp` installed (`sudo pacman -S mpv yt-dlp`); the
plugin says so when one is missing.

**What goes out**: the meter reads Twitch's public list of channels and
streams (gql.twitch.tv, read only), a YouTube channel's public feed of
its newest videos (www.youtube.com/feeds/videos.xml) and the pictures from
YouTube's and Twitch's picture servers; YouTube's search and the videos
themselves go through yt-dlp and mpv, as your own mpv would play them. Only
search words, channel names and video ids are sent; no account, no sign-in,
no links to any website (meter patch 0047).
