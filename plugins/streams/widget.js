// The Streams plugin's video overlay: the meter draws the video under this
// page; the page shows the title and the buttons under the pointer while
// the meter is unlocked (drag the bar to move it, a corner to resize it),
// and what to do while nothing plays. Locked, clicks go through it.
(() => {
  const $ = (s) => document.querySelector(s);
  let locked = false;
  let paused = false;

  const claim = () => a2.widget.area({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }).catch(() => {});
  new ResizeObserver(claim).observe(document.body);

  $(".bar").addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button") || locked) return;
    e.preventDefault();
    a2.widget.drag().catch(() => {});
  });
  // The whole picture moves it too.
  document.body.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || locked || e.target.closest("button, .corner, .bar")) return;
    e.preventDefault();
    a2.widget.drag().catch(() => {});
  });
  $(".close").addEventListener("click", () => a2.widget.post({ type: "close" }).catch(() => {}));
  $(".pause").addEventListener("click", () => a2.widget.post({ type: "pause" }).catch(() => {}));

  const canResize = typeof a2.widget.resize === "function";
  document.body.classList.toggle("noResize", !canResize);
  for (const c of document.querySelectorAll(".corner")) {
    c.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || locked || !canResize) return;
      e.preventDefault();
      e.stopPropagation();
      a2.widget.resize(c.dataset.edge).catch(() => {});
    });
  }
  a2.on("resized", (size) => {
    if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) {
      a2.widget.post({ type: "resized", width: size.width, height: size.height }).catch(() => {});
    }
  });

  a2.on("locked", (on) => {
    locked = !!on;
    document.body.classList.toggle("locked", locked);
  });

  a2.on("widget", (d) => {
    if (!d) return;
    document.body.classList.toggle("playing", !!d.playing && d.state !== "error");
    document.body.classList.toggle("failed", d.state === "error");
    $(".title").textContent = d.title || "";
    $(".sub").textContent = d.sub || "";
    paused = /^Paused$/.test(d.sub || "");
    $(".pause").textContent = paused ? "▶" : "❚❚";
    if (d.state === "error") {
      $(".idleTitle").textContent = d.title || "Didn't play";
      $(".idleText").textContent = d.sub || "";
    } else if (!d.playing) {
      $(".idleTitle").textContent = "Nothing playing";
      $(".idleText").textContent = "Pick a stream or video in the Streams window.";
    }
  });

  a2.ready().then(() => a2.widget.post({ type: "hello" })).catch(() => {});
})();
