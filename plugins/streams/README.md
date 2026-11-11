# Streams (A2Tools plugin)

Twitch, YouTube and your own Jellyfin server while you play, in small
video overlays over the game: each in its own, several at once if you like.

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
  **TV button** in the meter's title shows or hides that row (0.5.0, meter
  patch 0055). The row always has Twitch, YouTube and Jellyfin: a stopped
  one is dimmed and ▶ plays its last video again; the row opens by itself
  when a video starts. A playing video stays on screen when the plugin
  window is hidden.
- **← →** at the top of the window go back and on through where you were
  (tabs, views, Jellyfin's folders, searches), as in a browser; also the
  mouse's side buttons and Alt+← / Alt+→ (0.5.0).
- When AION2 closes, the videos stop (0.3.1).
- **Jellyfin** (0.4.0): your own Jellyfin server, **in your home network
  only**. Sign in once (the server's address, like `192.168.1.20:8096`,
  your user and password): the meter keeps the address and the server's
  key in its own folder on this PC and forgets the password; an address
  outside your home network is refused. **Home** (Continue watching, Next
  up, what is new in each library), **Libraries** (films; shows, their
  seasons and episodes) and a **search**. A click goes on where you
  stopped (right-click: from the start), in its own overlay. The bar shows
  where it is (click to jump), back 10 s and on 30 s, the audio track and
  the subtitles (those of your Jellyfin settings at start). **Skip intro**
  (and recaps, credits, previews) where your server knows them: Jellyfin
  10.10's Media Segments, or the Intro Skipper plugin; a button in the
  overlay, the bar and the meter's player row, or by itself
  ("Skip intros by themselves"). "⏮ Previous" and "Next ⏭" (in the bar)
  and ⏮ ⏭ (in the player row) play the episode before or after (0.5.0).
  The bar is as see-through as the window (its opacity slider; 0.5.1,
  meter patch 0056).
- A video that doesn't play says why: what yt-dlp or mpv said (meter
  patch 0057), with a plain hint where one is known (yt-dlp too old, no
  JavaScript runtime for YouTube: `sudo pacman -S deno`). A video started
  while the plugins are off (the meter's puzzle button) shows at once
  (0.5.2). At an episode's end the next one starts
  ("Play the next episode"). Quality: **Original** (the file as it is) or
  your server's conversion to 1080p down to 360p, or sound only. Your
  server is told what plays and how far, so Continue watching and
  "watched" are right in every Jellyfin app; ✓ on a card marks it watched.
- Favourites and settings stay in the plugin's storage on this computer.

**Needs** `mpv` and `yt-dlp` installed (`sudo pacman -S mpv yt-dlp`); the
plugin says so when one is missing.

**What goes out**: the meter reads Twitch's public list of channels and
streams (gql.twitch.tv, read only), a YouTube channel's public feed of
its newest videos (www.youtube.com/feeds/videos.xml) and the pictures from
YouTube's and Twitch's picture servers; YouTube's search and the videos
themselves go through yt-dlp and mpv, as your own mpv would play them. Only
search words, channel names and video ids are sent; no account, no sign-in,
no links to any website (meter patch 0047). Jellyfin: only your own
server in your home network (meter patch 0053), nothing else.
