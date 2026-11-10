// The Radio plugin's stations: each station's own live stream addresses,
// tried in order (the first that plays). Found published on the stations'
// own stream pages and on radio directories (radio.dubbeh.net and others
// that print them), November 2026. The meter lets the plugin play from these
// servers only (RADIO_HOSTS, meter patch 0043): a new server needs a new
// entry there, and dev/ci.sh checks the two agree.
// Never a homepage or other address here: the plugin links nowhere.
globalThis.RADIO_COUNTRIES = [
  ["fav", "★ Favourites"],
  ["all", "All"],
  ["TR", "Türkiye"],
  ["US", "USA"],
  ["DE", "Germany"],
  ["INT", "World"],
];

globalThis.RADIO_GENRES = {
  pop: "Pop",
  hits: "Hits",
  rap: "Rap & Hip-Hop",
  rnb: "R&B",
  oldschool: "Old school",
  slow: "Slow",
  rock: "Rock",
  turku: "Türkü & Halk",
  sanat: "Sanat",
  electronic: "Electronic",
  chill: "Chill",
  alternative: "Alternative",
};

const STW = "https://playerservices.streamtheworld.com/api/livestream-redirect/";

globalThis.RADIO_STATIONS = [
  // ---- Türkiye ----
  { id: "best-fm", name: "Best FM", country: "TR", info: "İstanbul 98.4", genres: ["pop"], streams: [
    "https://bestfm.turkhosted.com/;stream.mp3",
    "https://babaradyo.turkhosted.com/best/bestfm.stream/playlist.m3u8",
    "http://46.20.7.126/bestfmmp3",
    "http://46.20.7.125/bestfmaac",
  ] },
  { id: "best-rap", name: "Best Rap", country: "TR", info: "Best FM", genres: ["rap"], streams: [
    "https://wowza3.radyotvonline.com/best/bestgicir.stream/playlist.m3u8",
  ] },
  { id: "kral-fm", name: "Kral FM", country: "TR", genres: ["pop"], streams: [
    "https://dygedge2.radyotvonline.net/kralfm/playlist.m3u8",
    "https://ssldyg.radyotvonline.com/smil/smil:kralfm.smil/playlist.m3u8",
    "https://dygmaster.radyotvonline.net/kralfm/playlist.m3u8",
  ] },
  { id: "kral-pop", name: "Kral Pop", country: "TR", genres: ["pop"], streams: [
    "https://dygmaster.radyotvonline.net/kralpop/playlist.m3u8",
    "https://dygedge.radyotvonline.net/kralpop/playlist.m3u8",
    "https://ssldyg.radyotvonline.com/smil/smil:kralpop.smil/playlist.m3u8",
  ] },
  { id: "power-turk", name: "Power Türk", country: "TR", genres: ["pop"], streams: [
    "https://live.powerapp.com.tr/powerturk/abr/powerturk/128/playlist.m3u8",
    "https://listen.powerapp.com.tr/powerturk/abr/powerturk/128/playlist.m3u8",
  ] },
  { id: "power-turk-rap", name: "PowerTürk Rap", country: "TR", genres: ["rap"], streams: [
    "https://live.powerapp.com.tr/powerturkrap/abr/playlist.m3u8",
  ] },
  { id: "power-fm", name: "Power FM", country: "TR", info: "International hits", genres: ["hits"], streams: [
    "https://listen.powerapp.com.tr/powerfm/abr/powerfm/128/playlist.m3u8",
    "https://listen.powerapp.com.tr/powerfm/256/chunks.m3u8",
  ] },
  { id: "super-fm", name: "Süper FM", country: "TR", genres: ["pop"], streams: [`${STW}SUPER_FMAAC.aac`, `${STW}SUPER_FM_SC`] },
  { id: "joy-turk", name: "Joy Türk", country: "TR", genres: ["slow"], streams: [`${STW}JOY_TURKAAC.aac`, `${STW}JOY_TURK_SC`] },
  { id: "joy-turk-rock", name: "JoyTürk Rock", country: "TR", genres: ["rock"], streams: [`${STW}JOYTURK_ROCKAAC.aac`, `${STW}JOYTURK_ROCK_SC`] },
  { id: "metro-fm", name: "Metro FM", country: "TR", info: "International hits", genres: ["hits"], streams: [`${STW}METRO_FM128AAC.aac`, `${STW}METRO_FMAAC.aac`, `${STW}METRO_FM_SC`] },
  { id: "number1-turk", name: "Number1 Türk", country: "TR", genres: ["pop"], streams: [
    "https://n10101m.mediatriple.net/numberoneturk",
    "https://n10101m.mediatriple.net/videoonlylive/mtkgeuihrlfwlive/u_stream_5c9e30cf8d28e_1/playlist.m3u8",
  ] },
  { id: "number1-turk-rap", name: "Number1 Türk Rap", country: "TR", genres: ["rap"], streams: [
    "https://dijimedya.radyotvonline.net/turkrap",
  ] },
  { id: "radyo-fenomen", name: "Radyo Fenomen", country: "TR", info: "International hits", genres: ["hits"], streams: [
    "https://live.radyofenomen.com/fenomen/128/icecast.audio",
    "https://listen.radyofenomen.com/fenomen/128/icecast.audio",
  ] },
  { id: "fenomen-turk", name: "Fenomen Türk", country: "TR", genres: ["pop"], streams: [
    "https://live.radyofenomen.com/fenomenturk/128/icecast.audio",
    "https://listen.radyofenomen.com/fenomenturk/128/icecast.audio",
  ] },
  { id: "fenomen-rap", name: "Fenomen Rap", country: "TR", info: "International rap", genres: ["rap"], streams: [
    "https://live.radyofenomen.com/fenomenrap/128/icecast.audio",
    "https://listen.radyofenomen.com/fenomenrap/128/icecast.audio",
  ] },
  { id: "fenomen-turk-rap", name: "Fenomen Türkçe Rap", country: "TR", genres: ["rap"], streams: [
    "https://live.radyofenomen.com/fenomenturkrap/128/icecast.audio",
    "https://listen.radyofenomen.com/fenomenturkrap/128/icecast.audio",
  ] },
  { id: "slow-turk", name: "Slow Türk", country: "TR", genres: ["slow"], streams: ["https://radyo.duhnet.tv/ak_dtvh_slowturk"] },
  { id: "radyo-viva", name: "Radyo Viva", country: "TR", genres: ["pop"], streams: [
    "https://moondigitaledge.radyotvonline.net/radyoviva/playlist.m3u8",
  ] },
  { id: "alem-fm", name: "Alem FM", country: "TR", genres: ["pop"], streams: [
    "https://turkmedya.radyotvonline.net/alemfmaac",
    "https://turkmedya.radyotvonline.com/turkmedya/alemfm.stream/playlist.m3u8",
  ] },
  { id: "trt-fm", name: "TRT FM", country: "TR", genres: ["pop"], streams: ["https://trt.radyotvonline.net/trtfm"] },
  { id: "trt-turku", name: "TRT Türkü", country: "TR", genres: ["turku"], streams: [
    "https://radio-trtturku.live.trt.com.tr/master.m3u8",
    "https://rd-trtturku.medya.trt.com.tr/master_128.m3u8",
  ] },
  { id: "trt-nagme", name: "TRT Nağme", country: "TR", info: "Türk sanat müziği", genres: ["sanat"], streams: [
    "https://rd-trtnagme.medya.trt.com.tr/master.m3u8",
    "https://ssl4.radyotvonline.com/radyohome/trtnagme.stream_aac/playlist.m3u8",
  ] },
  { id: "radyo-turku", name: "Radyo Türkü", country: "TR", genres: ["turku"], streams: [
    "https://yayin.turkhosted.com/4591/stream",
    "http://radyo.turkuradyo.net:4591/;",
  ] },
  { id: "radyo-seymen", name: "Radyo Seymen", country: "TR", info: "Türkü, halk müziği", genres: ["turku"], streams: [
    "https://yayin.radyoseymen.com.tr:1070/stream",
  ] },
  { id: "mamas-turku", name: "Mamaş FM Türkü", country: "TR", genres: ["turku"], streams: ["https://mamasturku-erdem.radioca.st/stream.mp3"] },
  { id: "trd-halk", name: "TRD 4 Halk", country: "TR", info: "Halk müziği", genres: ["turku"], streams: ["https://live.streamlojik.com:8000/trd4.aac"] },
  { id: "gonul-turkuleri", name: "Gönül Türküleri", country: "TR", genres: ["turku"], streams: [`${STW}SC020_SO1AAC.aac`, "https://22653.live.streamtheworld.com/SC020_SO1AAC.aac"] },
  { id: "turkuvaz-musiki", name: "Turkuvaz Musiki", country: "TR", info: "Türk sanat müziği", genres: ["sanat"], streams: [
    "https://trkvz-radyolar.ercdn.net/turkuvazmusiki/playlist.m3u8",
  ] },
  { id: "mamas-tsm", name: "Mamaş FM Türk Sanat Müziği", country: "TR", genres: ["sanat"], streams: ["https://tsm-erdem.radioca.st/stream.mp3"] },
  { id: "trd-sanat", name: "TRD 3 Sanat", country: "TR", info: "Türk sanat müziği", genres: ["sanat"], streams: ["https://live.streamlojik.com:8000/trd3.aac"] },
  { id: "pal-alaturka", name: "Pal Alaturka", country: "TR", info: "Türk sanat müziği", genres: ["sanat"], streams: ["http://shoutcast.radyogrup.com:3050/;"] },

  // ---- USA ----
  { id: "hot-97", name: "Hot 97", country: "US", info: "New York 97.1", genres: ["rap"], streams: [`${STW}WQHTAAC.aac`, `${STW}WQHTFMAAC_SC`] },
  { id: "power-1051", name: "Power 105.1", country: "US", info: "New York · The Breakfast Club", genres: ["rap"], streams: [
    "https://stream.revma.ihrhls.com/zc1481", "https://stream.revma.ihrhls.com/zc1481/hls.m3u8",
  ] },
  { id: "wbls", name: "WBLS 107.5", country: "US", info: "New York", genres: ["rnb"], streams: [`${STW}WBLSFMAAC.aac`] },
  { id: "power-106", name: "Power 106", country: "US", info: "Los Angeles", genres: ["rap"], streams: [`${STW}KPWRAAC_SC`] },
  { id: "real-923", name: "Real 92.3", country: "US", info: "Los Angeles · Big Boy", genres: ["rap"], streams: [
    "https://stream.revma.ihrhls.com/zc181", "https://stream.revma.ihrhls.com/zc181/hls.m3u8",
  ] },
  { id: "kday", name: "93.5 KDAY", country: "US", info: "Los Angeles", genres: ["rap", "oldschool"], streams: [`${STW}KDAYFMAAC.aac`, `${STW}KDAYFMAAC_SC`] },
  { id: "the-box", name: "97.9 The Box", country: "US", info: "Houston", genres: ["rap"], streams: [`${STW}KBXXFM_SC`] },
  { id: "the-beat-dallas", name: "97.9 The Beat", country: "US", info: "Dallas", genres: ["rap"], streams: [`${STW}KBFBFMAAC.aac`, `${STW}KBFBFMAAC_SC`] },
  { id: "k104", name: "K104", country: "US", info: "Dallas", genres: ["rnb"], streams: ["https://ais-sa1.streamon.fm/7285_64k.aac/playlist.m3u8"] },
  { id: "hot-1079", name: "Hot 107.9", country: "US", info: "Atlanta", genres: ["rap"], streams: [`${STW}WHTAFMAAC.aac`] },
  { id: "v-103", name: "V-103", country: "US", info: "Atlanta", genres: ["rap", "rnb"], streams: ["https://live.amperwave.net/direct/audacy-wveefmaac-imc"] },
  { id: "wgci", name: "WGCI 107.5", country: "US", info: "Chicago", genres: ["rap"], streams: [
    "https://stream.revma.ihrhls.com/zc841", "https://stream.revma.ihrhls.com/zc841/hls.m3u8",
  ] },
  { id: "power-99", name: "Power 99", country: "US", info: "Philadelphia", genres: ["rap"], streams: [
    "https://stream.revma.ihrhls.com/zc2009", "https://stream.revma.ihrhls.com/zc2009/hls.m3u8",
  ] },
  { id: "whur", name: "WHUR 96.3", country: "US", info: "Washington", genres: ["rnb"], streams: ["https://ais-sa1.streamon.fm/7028_48k.aac/playlist.m3u8"] },
  { id: "hot-108", name: "Hot 108 Jamz", country: "US", info: "Internet radio", genres: ["rap"], streams: ["https://live.powerhitz.com/hot108"] },
  { id: "powerhitz-1power", name: "Powerhitz 1Power", country: "US", info: "Internet radio", genres: ["rap", "rnb"], streams: ["https://live.powerhitz.com/1power"] },
  { id: "cadillacc", name: "Snoop Dogg's Cadillacc Music", country: "US", info: "Internet radio", genres: ["rap", "oldschool"], streams: [
    "https://littlive-live-a.cdnstream1.com/5595_128",
  ] },
  { id: "throwback-jamz", name: "GotRadio Throwback Jamz", country: "US", info: "Internet radio", genres: ["oldschool", "rnb"], streams: [
    "https://pureplay.cdnstream1.com/6045_128.mp3",
  ] },
  { id: "defjay", name: "Defjay", country: "US", info: "Internet radio", genres: ["rnb", "rap"], streams: ["https://icepool.silvacast.com/DEFJAY.mp3"] },
  { id: "hiphop-request", name: "HipHop Request", country: "US", info: "Internet radio, Boston", genres: ["rap"], streams: ["https://radio.978host.com/sslstream"] },
  { id: "hot-21", name: "Hot 21 Radio", country: "US", info: "Internet radio, New York", genres: ["rap", "rnb"], streams: [
    "https://azh.webradiomanager.fr/listen/hot_21_radio/radio.mp3",
  ] },
  { id: "dirty-south", name: "Dirty South Radio", country: "US", info: "Internet radio", genres: ["rap"], streams: ["https://ec7.yesstreaming.net:1360/stream"] },

  // ---- Germany ----
  { id: "1live", name: "1LIVE", country: "DE", genres: ["pop"], streams: [
    "https://wdr-1live-live.icecastssl.wdr.de/wdr/1live/live/mp3/128/stream.mp3",
    "http://wdr-1live-live.icecast.wdr.de/wdr/1live/live/mp3/128/stream.mp3",
  ] },
  { id: "bigfm", name: "bigFM", country: "DE", genres: ["pop"], streams: ["https://stream.bigfm.de/deutschland/mp3-128/stream.bigfm.de/"] },
  { id: "bigfm-us-rap", name: "bigFM US Rap & Hip-Hop", country: "DE", genres: ["rap"], streams: [
    "https://stream.bigfm.de/exusraphiphop/mp3-128/stream.bigfm.de/",
    "http://streams.bigfm.de/bigfm-usrap-128-aac?usid=0-0-H-A-D-30",
  ] },
  { id: "bigfm-oldschool-rap", name: "bigFM Oldschool Rap & Hip-Hop", country: "DE", genres: ["rap", "oldschool"], streams: [
    "https://stream.bigfm.de/exoldschoolrap/mp3-128/stream.bigfm.de/",
    "http://streams.bigfm.de/bigfm-oldschool-128-aac?usid=0-0-H-A-D-30",
  ] },
  { id: "bigfm-hiphop", name: "bigFM Hip-Hop", country: "DE", genres: ["rap"], streams: ["https://stream.bigfm.de/hiphop/mp3-128/stream.bigfm.de/"] },
  { id: "energy-berlin", name: "ENERGY Berlin", country: "DE", genres: ["pop"], streams: [
    "https://frontend.streamonkey.net/energy-berlin/stream/mp3",
  ] },
  { id: "fluxfm", name: "FluxFM", country: "DE", info: "Berlin", genres: ["alternative"], streams: [
    "https://streams.fluxfm.de/live/mp3-320/streams.fluxfm.de/",
    "https://fluxmusic.api.radiosphere.io/channels/FluxFM/stream.mp3",
  ] },
  { id: "dasding", name: "DASDING", country: "DE", genres: ["pop"], streams: ["https://dispatcher.rndfnk.com/hr/dasding/live/high"] },
  { id: "n-joy", name: "N-JOY", country: "DE", genres: ["pop"], streams: ["http://icecast.ndr.de/ndr/njoy/live/mp3/128/stream.mp3"] },
  { id: "sunshine-live", name: "sunshine live", country: "DE", genres: ["electronic"], streams: [
    "https://stream.sunshine-live.de/live/mp3-192/stream.sunshine-live.de/",
  ] },
  { id: "sunshine-live-techno", name: "sunshine live Techno", country: "DE", genres: ["electronic"], streams: [
    "https://stream.sunshine-live.de/techno/mp3-192/stream.sunshine-live.de/",
  ] },
  { id: "sunshine-live-house", name: "sunshine live House", country: "DE", genres: ["electronic"], streams: [
    "https://stream.sunshine-live.de/house/mp3-192/stream.sunshine-live.de/",
  ] },
  { id: "sunshine-live-edm", name: "sunshine live EDM", country: "DE", genres: ["electronic"], streams: [
    "https://stream.sunshine-live.de/edm/mp3-192/stream.sunshine-live.de/",
  ] },
  { id: "bigfm-deep-tech-house", name: "bigFM Deep & Tech House", country: "DE", genres: ["electronic"], streams: [
    "https://stream.bigfm.de/deeptechhouse/mp3-128/stream.bigfm.de/",
  ] },
  { id: "fluxfm-elektro", name: "FluxFM ElektroFlux", country: "DE", genres: ["electronic"], streams: [
    "https://streams.fluxfm.de/elektro/mp3-320/streams.fluxfm.de/",
  ] },

  // ---- World ----
  { id: "soma-groove-salad", name: "SomaFM Groove Salad", country: "INT", info: "San Francisco, internet radio", genres: ["electronic", "chill"], streams: [
    "https://ice5.somafm.com/groovesalad-128-mp3", "https://ice6.somafm.com/groovesalad-128-mp3",
  ] },
  { id: "soma-beat-blender", name: "SomaFM Beat Blender", country: "INT", info: "Deep house, downtempo", genres: ["electronic", "chill"], streams: [
    "https://ice5.somafm.com/beatblender-128-mp3", "https://ice6.somafm.com/beatblender-128-mp3",
  ] },
  { id: "soma-defcon", name: "SomaFM DEF CON Radio", country: "INT", info: "Music for hacking", genres: ["electronic"], streams: [
    "https://ice5.somafm.com/defcon-128-mp3", "https://ice6.somafm.com/defcon-128-mp3",
  ] },
  { id: "soma-the-trip", name: "SomaFM The Trip", country: "INT", info: "Progressive house, trance", genres: ["electronic"], streams: [
    "https://ice5.somafm.com/thetrip-128-mp3", "https://ice6.somafm.com/thetrip-128-mp3",
  ] },
  { id: "soma-fluid", name: "SomaFM Fluid", country: "INT", info: "Instrumental hip-hop", genres: ["rap", "chill"], streams: [
    "https://ice5.somafm.com/fluid-128-mp3", "https://ice2.somafm.com/fluid-128-mp3",
  ] },
  { id: "soma-space-station", name: "SomaFM Space Station Soma", country: "INT", info: "Ambient, electronica", genres: ["electronic", "chill"], streams: [
    "https://ice5.somafm.com/spacestation-128-mp3",
  ] },
  { id: "ibiza-global", name: "Ibiza Global Radio", country: "INT", info: "Ibiza", genres: ["electronic"], streams: [
    "https://listenssl.ibizaglobalradio.com:8024/ibizaglobalradio.mp3",
  ] },
  { id: "ibiza-global-classics", name: "Ibiza Global Classics", country: "INT", info: "Ibiza", genres: ["electronic"], streams: [
    "https://control.streaming-pro.com:8000/ibizaglobalclassics.mp3",
  ] },
  { id: "radio-record", name: "Radio Record", country: "INT", info: "St. Petersburg, EDM", genres: ["electronic"], streams: [
    "https://radiorecord.hostingradio.ru/rr_main96.aacp",
  ] },
  { id: "intergalactic-fm", name: "Intergalactic FM", country: "INT", info: "The Hague, Italo and electro", genres: ["electronic"], streams: [
    "http://radio.intergalactic.fm/1",
  ] },
];
