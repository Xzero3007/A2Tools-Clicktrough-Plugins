// The Radio plugin's player over the game: what plays, play/stop, the
// stations before and after, mute and volume. The sound plays in the
// plugin's own page (plugin.js); this only shows it and sends what was
// pressed. The head drags it; the meter's lock lets clicks through to the
// game (then only the controls' look stays).
(() => {
  const $ = (s) => document.querySelector(s);
  let state = null;
  let volumeTouched = 0;
  const post = (data) => a2.widget.post(data).catch(() => {});

  function draw() {
    if (!state) return;
    $(".name").textContent = state.name;
    $(".name").title = [state.name, state.info].filter(Boolean).join(" · ");
    $(".state").textContent = state.state;
    document.body.classList.toggle("on", !!state.on && state.status === "playing");
    document.body.classList.toggle("failed", state.status === "failed");
    const play = $(".play");
    play.textContent = state.on ? "■" : "▶";
    play.classList.toggle("on", !!state.on);
    play.disabled = !state.hasStation;
    $(".mute").textContent = state.muted || state.volume === 0 ? "🔇" : "🔊";
    $(".fav").textContent = state.favourite ? "★" : "☆";
    $(".fav").classList.toggle("on", !!state.favourite);
    $(".fav").disabled = !state.hasStation;
    if (Date.now() - volumeTouched > 1500) $(".volume").value = String(Math.round(state.volume * 100));
  }

  const claim = () => a2.widget.area({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }).catch(() => {});
  new ResizeObserver(claim).observe(document.body);

  $(".head").addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button, input") || document.body.classList.contains("locked")) return;
    e.preventDefault();
    a2.widget.drag().catch(() => {});
  });
  for (const b of document.querySelectorAll("[data-do]")) b.addEventListener("click", () => post({ type: b.dataset.do }));
  $(".fav").addEventListener("click", () => post({ type: "favourite" }));
  $(".close").addEventListener("click", () => post({ type: "close" }));
  $(".volume").addEventListener("input", () => {
    volumeTouched = Date.now();
    post({ type: "volume", value: Number($(".volume").value) / 100 });
  });
  document.body.addEventListener("wheel", (e) => {
    if (!state) return;
    e.preventDefault();
    volumeTouched = Date.now();
    const v = Math.max(0, Math.min(1, (Number($(".volume").value) / 100) + (e.deltaY < 0 ? 0.05 : -0.05)));
    $(".volume").value = String(Math.round(v * 100));
    post({ type: "volume", value: v });
  }, { passive: false });

  a2.on("widget", (data) => {
    state = data;
    draw();
  });
  a2.on("locked", (on) => document.body.classList.toggle("locked", !!on));

  claim();
  a2.ready().then(() => post({ type: "ready" }));
})();
