// The Streams plugin's Jellyfin helpers: the server's answers made into the
// cards' shape, an item's tracks, its intro and credits, and the times. No
// page objects here, so the tests run it in Node (dev/tests). The server
// itself is reached only through the meter (a2.video.jellyfin), which takes
// a server in the home network alone.
(() => {
  const str = (v) => (typeof v === "string" ? v : "");
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const TICKS = 10000000;

  const PLAYABLE = new Set(["Movie", "Episode", "Video", "MusicVideo", "Trailer"]);
  const OPENABLE = new Set(["Series", "Season", "BoxSet", "Folder", "CollectionFolder", "Playlist"]);

  // An item: { id, type, name, sub, playable, openable, seriesId, seasonId,
  // runtime, position, percent, played, poster, wide } (times in seconds;
  // poster and wide: { item, type } for a picture, or null).
  function item(i) {
    if (!i || typeof i !== "object" || !/^[0-9a-fA-F-]{32,36}$/.test(str(i.Id))) return null;
    const type = str(i.Type);
    const ud = i.UserData && typeof i.UserData === "object" ? i.UserData : {};
    const tags = i.ImageTags && typeof i.ImageTags === "object" ? i.ImageTags : {};
    const runtime = num(i.RunTimeTicks) / TICKS;
    const position = num(ud.PlaybackPositionTicks) / TICKS;
    const ep = type === "Episode";
    const se = (n) => (Number.isInteger(n) ? n : null);
    const s = se(i.ParentIndexNumber);
    const e = se(i.IndexNumber);
    const code = ep && e != null ? `${s != null ? `S${s} ` : ""}E${e}` : "";
    const year = num(i.ProductionYear) || "";
    const pic = (id, kind) => (/^[0-9a-fA-F-]{32,36}$/.test(str(id)) ? { item: str(id), type: kind } : null);
    // Wide: an episode's own still, a film's thumb or backdrop, else the series'.
    let wide = null;
    if (ep && tags.Primary) wide = pic(i.Id, "Primary");
    else if (tags.Thumb) wide = pic(i.Id, "Thumb");
    else if (Array.isArray(i.BackdropImageTags) && i.BackdropImageTags.length) wide = pic(i.Id, "Backdrop");
    else if (i.ParentThumbItemId) wide = pic(i.ParentThumbItemId, "Thumb");
    else if (Array.isArray(i.ParentBackdropImageTags) && i.ParentBackdropImageTags.length) wide = pic(i.ParentBackdropItemId, "Backdrop");
    else if (tags.Primary) wide = pic(i.Id, "Primary");
    let poster = tags.Primary ? pic(i.Id, "Primary") : null;
    if (!poster && ep && i.SeriesPrimaryImageTag) poster = pic(i.SeriesId, "Primary");
    const unplayed = num(ud.UnplayedItemCount);
    return {
      id: str(i.Id),
      type,
      name: str(i.Name) || "Untitled",
      series: str(i.SeriesName),
      code,
      sub: ep ? [str(i.SeriesName), code].filter(Boolean).join(" · ") : [year, type === "Series" ? "Series" : ""].filter(Boolean).join(" · "),
      playable: PLAYABLE.has(type) || (!OPENABLE.has(type) && !!i.MediaType && i.MediaType === "Video"),
      openable: OPENABLE.has(type) || !!i.IsFolder,
      seriesId: str(i.SeriesId),
      seasonId: str(i.SeasonId),
      runtime,
      position: position > 0 && (!runtime || position < runtime) ? position : 0,
      percent: Math.max(0, Math.min(100, num(ud.PlayedPercentage) || (runtime && position ? (position / runtime) * 100 : 0))),
      played: !!ud.Played,
      unplayed: unplayed > 0 ? unplayed : 0,
      poster,
      wide,
    };
  }

  // A list answer ({ Items: [...] } or [...]) as items.
  function items(answer) {
    const all = Array.isArray(answer) ? answer : Array.isArray(answer?.Items) ? answer.Items : [];
    return all.map(item).filter(Boolean);
  }

  // The libraries a user has (UserViews), films' and shows' first.
  function libraries(answer) {
    const order = { movies: 0, tvshows: 1, homevideos: 2, musicvideos: 3, mixed: 4 };
    const all = Array.isArray(answer?.Items) ? answer.Items : Array.isArray(answer) ? answer : [];
    return all
      .filter((v) => v && /^[0-9a-fA-F-]{32,36}$/.test(str(v.Id)) && !["music", "books", "playlists", "livetv", "boxsets"].includes(str(v.CollectionType)))
      .map((v) => ({ id: v.Id, name: str(v.Name) || "Library", kind: str(v.CollectionType) }))
      .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.name.localeCompare(b.name));
  }

  // The parts of an item to skip, in seconds: Jellyfin's Media Segments
  // ({ Items: [{ Type, StartTicks, EndTicks }] }) or the Intro Skipper
  // plugin's own answer ({ Introduction: { IntroStart, IntroEnd, Valid }, Credits: ... }).
  const KINDS = { Intro: "intro", Introduction: "intro", Recap: "recap", Outro: "credits", Credits: "credits", Preview: "preview" };
  function segments(answer) {
    const out = [];
    if (Array.isArray(answer?.Items)) {
      for (const s of answer.Items) {
        const kind = KINDS[str(s?.Type)];
        const start = num(s?.StartTicks) / TICKS;
        const end = num(s?.EndTicks) / TICKS;
        if (kind && end > start + 1) out.push({ kind, start, end });
      }
    } else if (answer && typeof answer === "object") {
      for (const [k, s] of Object.entries(answer)) {
        const kind = KINDS[k];
        if (!kind || !s || s.Valid === false) continue;
        const start = num(s.IntroStart ?? s.Start);
        const end = num(s.IntroEnd ?? s.End);
        if (end > start + 1) out.push({ kind, start, end });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // The part playing at `t` (not in its last second: skipping that is no use).
  const segmentAt = (segs, t) => (Array.isArray(segs) ? segs.find((s) => t >= s.start && t < s.end - 1) || null : null);
  const SKIP = { intro: "Skip intro", recap: "Skip recap", credits: "Skip credits", preview: "Skip preview" };
  const skipLabel = (seg) => (seg ? SKIP[seg.kind] || "Skip" : "");

  // A subtitle codec as the file mpv can take from the server.
  function subFormat(codec) {
    const c = str(codec).toLowerCase();
    if (c === "subrip" || c === "srt") return "srt";
    if (c === "webvtt" || c === "vtt") return "vtt";
    if (c === "ass") return "ass";
    if (c === "ssa") return "ssa";
    return null;
  }

  // A media source's tracks: audio and subtitles, each with the server's
  // index and mpv's number for it (the n-th of its kind inside the file);
  // a subtitle outside the file has none and comes from the server (as do
  // the file's own text subtitles while the server converts the video;
  // `format` says which can).
  function tracks(source) {
    const streams = Array.isArray(source?.MediaStreams) ? source.MediaStreams : [];
    const name = (s) => str(s.DisplayTitle) || [str(s.Language).toUpperCase(), str(s.Codec)].filter(Boolean).join(" ") || `Track ${s.Index}`;
    const audio = [];
    const subs = [];
    let a = 0;
    let t = 0;
    for (const s of streams.slice().sort((x, y) => num(x.Index) - num(y.Index))) {
      if (s.Type === "Audio" && !s.IsExternal) audio.push({ index: num(s.Index), ord: ++a, label: name(s) });
      else if (s.Type === "Subtitle") {
        if (s.IsExternal) {
          const format = subFormat(s.Codec);
          if (format) subs.push({ index: num(s.Index), ord: null, external: true, format, label: name(s) });
        } else subs.push({ index: num(s.Index), ord: ++t, external: false, format: subFormat(s.Codec), label: name(s) });
      }
    }
    const defAudio = Number.isInteger(source?.DefaultAudioStreamIndex) ? source.DefaultAudioStreamIndex : null;
    const defSub = Number.isInteger(source?.DefaultSubtitleStreamIndex) ? source.DefaultSubtitleStreamIndex : -1;
    return {
      audio,
      subs,
      audioIndex: audio.some((x) => x.index === defAudio) ? defAudio : audio[0]?.index ?? null,
      subIndex: subs.some((x) => x.index === defSub) ? defSub : -1,
    };
  }

  // 3725 -> "1:02:05", 65 -> "1:05".
  function clock(sec) {
    const s = Math.max(0, Math.floor(num(sec)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
  }

  // The fields a list asks the server for.
  const FIELDS = "PrimaryImageAspectRatio,ParentId,SeriesPrimaryImage,MediaSourceCount";
  const IMAGE_TYPES = "Primary,Thumb,Backdrop";

  const api = { item, items, libraries, segments, segmentAt, skipLabel, subFormat, tracks, clock, FIELDS, IMAGE_TYPES, TICKS };
  if (typeof module !== "undefined") module.exports = api;
  globalThis.StreamJellyfin = api;
})();
