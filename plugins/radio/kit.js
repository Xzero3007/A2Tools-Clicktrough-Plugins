// The Radio plugin's helpers, without the page (the tests load them in Node).
(() => {
  const fold = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

  // The stations a country tab, genre and search show. "all": every one;
  // "fav": the favourites, in the order of the list.
  function filter(stations, { country, genre, query, favourites }) {
    const q = fold(query).trim();
    return stations.filter((s) => {
      if (country === "fav") { if (!favourites?.has(s.id)) return false; }
      else if (country && country !== "all" && s.country !== country) return false;
      if (genre && !(s.genres || []).includes(genre)) return false;
      if (q && !fold(`${s.name} ${s.info || ""} ${(s.genres || []).join(" ")}`).includes(q)) return false;
      return true;
    });
  }

  function countByCountry(stations, favourites) {
    const out = { all: stations.length, fav: 0 };
    for (const s of stations) {
      out[s.country] = (out[s.country] || 0) + 1;
      if (favourites?.has(s.id)) out.fav++;
    }
    return out;
  }

  // The genres among these stations, in the order they first appear.
  function genresOf(stations) {
    const seen = [];
    for (const s of stations) for (const g of s.genres || []) if (!seen.includes(g)) seen.push(g);
    return seen;
  }

  function debounce(fn, ms) {
    let t = 0;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function ago(at, now = Date.now()) {
    const min = Math.max(0, Math.round((now - at) / 60000));
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  }

  // Why an <audio> failed, in plain words.
  function mediaError(err) {
    switch (err?.code) {
      case 2: return "The connection failed";
      case 3: return "The stream couldn't be decoded";
      case 4: return "The stream isn't reachable from here";
      default: return "It doesn't play from here";
    }
  }

  // Checks kept a week; a station gone from the list or with other streams
  // than when checked loses its check.
  function freshChecks(checked, byId, now, keepMs = 7 * 86400000) {
    const out = {};
    for (const [id, c] of Object.entries(checked || {})) {
      if (!byId.has(id) || !c || typeof c.at !== "number" || now - c.at > keepMs) continue;
      out[id] = { ok: !!c.ok, at: c.at, why: String(c.why || "") };
    }
    return out;
  }

  // Whether one stream starts within `ms` (an <audio> given, muted).
  function probe(audio, url, ms) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok, why = "") => {
        if (done) return;
        done = true;
        clearTimeout(t);
        audio.removeEventListener("playing", onPlay);
        audio.removeEventListener("error", onErr);
        audio.pause();
        resolve({ ok, why });
      };
      const onPlay = () => finish(true);
      const onErr = () => finish(false, mediaError(audio.error));
      const t = setTimeout(() => finish(false, "No answer"), ms);
      audio.addEventListener("playing", onPlay);
      audio.addEventListener("error", onErr);
      audio.src = url;
      audio.play().catch(() => {});
    });
  }

  globalThis.RadioKit = { filter, countByCountry, genresOf, debounce, ago, mediaError, freshChecks, probe, fold };
})();
