// The map view the Map plugin's window and its overlay share: the map's
// tiles as images (WebP: the game's own world maps whole, the instances with
// the sea transparent), and the marks drawn on a canvas above them. World units are centimetres; a map's
// pixel is offset + scale * world (no flip, no rotation).
(() => {
  const D = globalThis.MAP_DATA;

  const GATHER_COLORS = {
    Ore: "#c9b08f", Herb: "#79d38a", Food: "#f0a35e", Gemstone: "#c99af7", Od: "#62d6c8",
    Cotton: "#ededed", Wood: "#b0845c", Fragment: "#ffd666", Cube: "#a35cf5",
  };
  // A Hidden Cube: a small purple cube (top, left and right face).
  const CUBE_FACES = ["#d7a8ff", "#a35cf5", "#7434d0"];
  const PET_RED = "#e5484d";
  const PLACE_COLORS = { seal: "#ff8a7a", battlefield: "#ffb454", occupation: "#c99af7", village: "#ffffff" };
  const GOLD = "#ffd666";

  // The tile pictures come through the meter (a2.file) where it can:
  // WebKitGTK 2.54 lets a plugin's frame load no file from the plugin scheme
  // once its page has started. Older meters: the file itself. The last few
  // dozen are kept.
  const tileUrls = new Map();
  function tileUrl(path) {
    let url = tileUrls.get(path);
    if (url) {
      tileUrls.delete(path);
    } else {
      url = typeof globalThis.a2?.file === "function" ? globalThis.a2.file(path).catch(() => path) : Promise.resolve(path);
    }
    tileUrls.set(path, url);
    while (tileUrls.size > 80) tileUrls.delete(tileUrls.keys().next().value);
    return url;
  }

  /** World -> the map's own pixels. */
  const toNative = (map, x, y) => [map.ox + map.scale * x, map.oy + map.scale * y];

  function MapView(root, { interactive = true, onView } = {}) {
    root.classList.add("mapView");
    const tilesEl = document.createElement("div");
    tilesEl.className = "mapTiles";
    const canvas = document.createElement("canvas");
    canvas.className = "mapMarks";
    const tip = document.createElement("div");
    tip.className = "mapTip";
    tip.hidden = true;
    root.append(tilesEl, canvas, tip);
    const ctx = canvas.getContext("2d");

    let key = null;
    let map = null;
    // The view: the native pixel at the middle, and screen px per native px.
    let cx = 0;
    let cy = 0;
    let zoom = 0.05;
    let marks = [];
    // A fit asked for while the view had no size yet (a hidden dock tab).
    let fitPending = false;
    let drawn = []; // [sx, sy, r, label] for the tooltip
    const imgs = new Map(); // "lo/1_2" -> <img>
    let queued = false;

    const size = () => [root.clientWidth, root.clientHeight];

    function screenOf(nx, ny) {
      const [w, h] = size();
      return [(nx - cx) * zoom + w / 2, (ny - cy) * zoom + h / 2];
    }

    function setMap(next) {
      if (next === key) return;
      key = next;
      map = next ? D.maps[next] : null;
      for (const img of imgs.values()) img.remove();
      imgs.clear();
      if (map) fitMap();
      redraw();
    }

    function fitMap() {
      const full = map.tile * map.grid;
      cx = full / 2;
      cy = full / 2;
      const [w, h] = size();
      fitPending = !w || !h;
      zoom = fitZoom();
    }

    const fitZoom = () => {
      if (!map) return 0.05;
      const [w, h] = size();
      return Math.max(0.005, Math.min(w, h) / (map.tile * map.grid));
    };

    function centerOn(x, y) {
      if (!map) return;
      [cx, cy] = toNative(map, x, y);
      redraw();
    }

    function setZoom(z, at) {
      if (!map) return;
      const min = fitZoom() * 0.5;
      const next = Math.max(min, Math.min(4, z));
      if (at) {
        // Keep the native pixel under the pointer where it is.
        const [w, h] = size();
        const nx = cx + (at[0] - w / 2) / zoom;
        const ny = cy + (at[1] - h / 2) / zoom;
        cx = nx - (at[0] - w / 2) / next;
        cy = ny - (at[1] - h / 2) / next;
      }
      zoom = next;
      redraw();
    }

    function redraw() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        drawTiles();
        drawMarks();
        onView?.({ key, cx, cy, zoom });
      });
    }

    function drawTiles() {
      const [w, h] = size();
      if (!map || !w || !h) return;
      // The small copies always (they are light), and the sharp tiles on top
      // once a tile shows a little bigger than its small copy.
      const sharp = map.tile * zoom > map.lo * 1.25;
      const want = new Set();
      const x0 = cx - w / 2 / zoom;
      const y0 = cy - h / 2 / zoom;
      const x1 = cx + w / 2 / zoom;
      const y1 = cy + h / 2 / zoom;
      const px = map.tile * zoom;
      for (const name of map.tiles) {
        const [c, r] = name.split("_").map(Number);
        const tx = c * map.tile;
        const ty = r * map.tile;
        if (tx > x1 || ty > y1 || tx + map.tile < x0 || ty + map.tile < y0) continue;
        const [sx, sy] = screenOf(tx, ty);
        for (const lo of sharp ? [true, false] : [true]) {
          const id = `${lo ? "lo/" : ""}${name}`;
          want.add(id);
          let img = imgs.get(id);
          if (!img) {
            img = document.createElement("img");
            img.decoding = "async";
            img.draggable = false;
            // WebP with the sea transparent (no CSS mask: WebKitGTK draws
            // none from a plugin's own scheme).
            const shown = img;
            tileUrl(`tiles/${key}/${id}.webp`).then((url) => {
              if (imgs.get(id) === shown) shown.src = url;
            });
            img.style.zIndex = lo ? "0" : "1";
            tilesEl.append(img);
            imgs.set(id, img);
          }
          img.style.transform = `translate(${sx}px, ${sy}px)`;
          img.style.width = `${px + 0.5}px`;
          img.style.height = `${px + 0.5}px`;
        }
      }
      for (const [id, img] of imgs) {
        if (want.has(id)) continue;
        img.remove();
        imgs.delete(id);
      }
    }

    function drawMarks() {
      const [w, h] = size();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawn = [];
      if (!map) return;
      // Least important first: what matters most lies on top. Zoomed far
      // out the marks shrink, so a whole map of them stays readable.
      const ordered = [...marks].sort((a, b) => (a.z || 0) - (b.z || 0));
      shrink = Math.max(0.5, Math.min(1, 0.45 + map.scale * 100 * zoom));
      for (const m of ordered) {
        const [nx, ny] = toNative(map, m.x, m.y);
        const [sx, sy] = screenOf(nx, ny);
        // The way to a place: a dashed line from where it starts (you, or the
        // Kibelisk to teleport to), wherever its ends are.
        if (m.kind === "route") {
          const [fx, fy] = screenOf(...toNative(map, m.from[0], m.from[1]));
          ctx.save();
          ctx.lineCap = "round";
          ctx.setLineDash([]);
          ctx.lineWidth = 6 * markScale;
          ctx.strokeStyle = "rgba(0,0,0,0.45)";
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(sx, sy);
          ctx.stroke();
          ctx.setLineDash([9 * markScale, 7 * markScale]);
          ctx.lineWidth = 3 * markScale;
          ctx.strokeStyle = GOLD;
          ctx.stroke();
          ctx.restore();
          continue;
        }
        const pad = (m.r || 4) * markScale + 12;
        if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
        drawMark(m, sx, sy);
        if (m.label) drawn.push([sx, sy, (m.r || 4) * markScale + 3, m.label]);
      }
    }

    function circle(sx, sy, r, fill, stroke, width = 1.5) {
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.lineWidth = width;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }

    // A pet's spawn point or a pet monster there now ("live"), by how it
    // stands, filled in its genus colour (red when not known): "fav" (a
    // favourite: a gold star), "farm" (being farmed: a target, thick white
    // ring and dot), "need" (not at level 3 yet: a white ring),
    // "max" (level 3: small and grey), "plain" (levels not known: small and
    // white). Each with a dark edge, so it shows on sand as on grass.
    function pet(sx, sy, r, look, live, color = PET_RED) {
      if (look === "fav") {
        const R = r * 1.8;
        if (live) circle(sx, sy, R + 3, null, "rgba(255,255,255,0.9)", 2);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const d = i % 2 ? R * 0.48 : R;
          ctx[i ? "lineTo" : "moveTo"](sx + d * Math.cos(a), sy + d * Math.sin(a));
        }
        ctx.closePath();
        ctx.fillStyle = GOLD;
        ctx.lineJoin = "round";
        ctx.lineWidth = 1.75;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.fill();
        ctx.stroke();
        circle(sx, sy, R * 0.3, color || PET_RED, null);
        return;
      }
      if (look === "max") {
        circle(sx, sy, r * 0.8, "rgba(175,175,175,0.7)", "rgba(0,0,0,0.5)", 1);
        return;
      }
      if (look === "plain") {
        circle(sx, sy, r, "rgba(255,255,255,0.85)", "rgba(0,0,0,0.55)", 1);
        if (live) circle(sx, sy, r + 3, null, "rgba(255,255,255,0.7)", 1.5);
        return;
      }
      const farm = look === "farm";
      if (live) circle(sx, sy, r + (farm ? 6.5 : 5), null, "rgba(255,255,255,0.75)", 1.5);
      circle(sx, sy, r + (farm ? 2.6 : 1.9), null, "rgba(0,0,0,0.6)", 1.2);
      circle(sx, sy, r + (farm ? 1.2 : 0.8), color || PET_RED, "#ffffff", farm ? 2.6 : 1.8);
      // Being farmed: a white dot in the middle too (a target).
      if (farm) circle(sx, sy, Math.max(1.5, r * 0.4), "#ffffff", null);
    }

    // An upright cube seen from above at an angle: a hexagon of three faces
    // around its centre, "size" from the centre to a corner.
    function cube(sx, sy, size, alpha, stroke, width) {
      const w = size * 0.866;
      const h = size / 2;
      const faces = [
        [[0, -size], [w, -h], [0, 0], [-w, -h]],
        [[-w, -h], [0, 0], [0, size], [-w, h]],
        [[0, 0], [w, -h], [w, h], [0, size]],
      ];
      ctx.save();
      ctx.globalAlpha = alpha;
      faces.forEach((f, i) => {
        ctx.beginPath();
        f.forEach(([x, y], j) => (j ? ctx.lineTo(sx + x, sy + y) : ctx.moveTo(sx + x, sy + y)));
        ctx.closePath();
        ctx.fillStyle = CUBE_FACES[i];
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.lineJoin = "round";
      // The inner edges thin and dark, the outline as asked.
      ctx.beginPath();
      ctx.moveTo(sx - w, sy - h);
      ctx.lineTo(sx, sy);
      ctx.lineTo(sx + w, sy - h);
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy + size);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(30,10,52,0.55)";
      ctx.stroke();
      ctx.beginPath();
      [[0, -size], [w, -h], [w, h], [0, size], [-w, h], [-w, -h]].forEach(([x, y], j) => (j ? ctx.lineTo(sx + x, sy + y) : ctx.moveTo(sx + x, sy + y)));
      ctx.closePath();
      ctx.lineWidth = width;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.restore();
    }

    let shrink = 1;
    // How large the marks are drawn (the player's setting: 1 = as designed).
    let markScale = 1;
    function drawMark(m, sx, sy) {
      const r = (m.r || 4) * (m.kind === "me" ? 1 : shrink) * markScale;
      switch (m.kind) {
        case "me": {
          // Not exact: a ring as large as the guess is uncertain (~10 m).
          if (!m.exact) {
            const ring = Math.max(r + 4, (m.acc || 10) * 100 * map.scale * zoom);
            circle(sx, sy, ring, "rgba(255,255,255,0.08)", "rgba(255,255,255,0.35)", 1);
          }
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(((m.heading ?? 0) * Math.PI) / 180);
          ctx.beginPath();
          ctx.moveTo(0, -r * 1.6);
          ctx.lineTo(r, r);
          ctx.lineTo(0, r * 0.45);
          ctx.lineTo(-r, r);
          ctx.closePath();
          ctx.fillStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.strokeStyle = "rgba(0,0,0,0.75)";
          ctx.stroke();
          ctx.fill();
          ctx.restore();
          break;
        }
        case "petSpawn":
          pet(sx, sy, r, m.look || "need", false, m.color);
          break;
        case "petLive":
          pet(sx, sy, r, m.look || "need", true, m.color);
          break;
        case "monster":
          circle(sx, sy, r, "rgba(220,220,220,0.75)", "rgba(0,0,0,0.5)", 1);
          break;
        case "gather":
          ctx.fillStyle = GATHER_COLORS[m.gather] || "#ddd";
          ctx.strokeStyle = m.live ? "#ffffff" : "rgba(0,0,0,0.6)";
          ctx.lineWidth = m.live ? 2 : 1;
          ctx.beginPath();
          ctx.rect(sx - r, sy - r, r * 2, r * 2);
          ctx.fill();
          ctx.stroke();
          break;
        case "cube":
          // A cube in range right now: solid, with a white edge.
          cube(sx, sy, r * 1.25, 1, "#ffffff", 2);
          break;
        case "boss": {
          // A field boss: a crown of three points on a dark disc, orange-red.
          circle(sx, sy, r * 1.15, "rgba(30,10,8,0.85)", "#ff7a52", 2);
          ctx.beginPath();
          ctx.moveTo(sx - r * 0.7, sy + r * 0.45);
          ctx.lineTo(sx - r * 0.7, sy - r * 0.35);
          ctx.lineTo(sx - r * 0.35, sy);
          ctx.lineTo(sx, sy - r * 0.6);
          ctx.lineTo(sx + r * 0.35, sy);
          ctx.lineTo(sx + r * 0.7, sy - r * 0.35);
          ctx.lineTo(sx + r * 0.7, sy + r * 0.45);
          ctx.closePath();
          ctx.fillStyle = "#ffb199";
          ctx.fill();
          break;
        }
        case "teleport":
          // The Kibelisk to teleport to on the way: its triangle, large, in a
          // gold ring.
          circle(sx, sy, r + 5, "rgba(10,12,16,0.75)", GOLD, 2.5);
          ctx.beginPath();
          ctx.moveTo(sx, sy - r * 1.1);
          ctx.lineTo(sx + r * 0.85, sy + r * 0.65);
          ctx.lineTo(sx - r * 0.85, sy + r * 0.65);
          ctx.closePath();
          ctx.fillStyle = "#9ee6d8";
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "rgba(0,0,0,0.7)";
          ctx.fill();
          ctx.stroke();
          break;
        case "kibelisk":
          ctx.beginPath();
          ctx.moveTo(sx, sy - r * 1.4);
          ctx.lineTo(sx + r, sy + r * 0.8);
          ctx.lineTo(sx - r, sy + r * 0.8);
          ctx.closePath();
          ctx.fillStyle = "#9ee6d8";
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "rgba(0,0,0,0.7)";
          ctx.fill();
          ctx.stroke();
          break;
        case "cubeSpot":
          // A place a Hidden Cube is known to stand at: the cube, paler (a
          // cube there right now is the solid one); every place one can
          // appear (the search): fainter still.
          cube(sx, sy, r * 1.3, m.all ? 0.45 : 0.7, "rgba(20,8,36,0.85)", m.all ? 1 : 1.25);
          break;
        case "monolith":
          // A Monolith piece: a small upright bar.
          ctx.fillStyle = "#d9c6ff";
          ctx.strokeStyle = "rgba(0,0,0,0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(sx - r * 0.55, sy - r * 1.2, r * 1.1, r * 2.4);
          ctx.fill();
          ctx.stroke();
          break;
        case "place": {
          // Sealed dungeon, battlefield, outpost, village: a ring with a dot,
          // its colour by kind.
          const c = PLACE_COLORS[m.place] || "#ffffff";
          circle(sx, sy, r, "rgba(10,12,16,0.7)", c, 2);
          circle(sx, sy, Math.max(1.5, r * 0.4), c, null);
          break;
        }
        case "region":
          // A region's name, written where it lies (no mark).
          if (zoom * map.tile >= 70) {
            ctx.font = "600 12px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(0,0,0,0.75)";
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.strokeText(m.text, sx, sy);
            ctx.fillText(m.text, sx, sy);
            ctx.textAlign = "start";
          }
          return;
        default:
          circle(sx, sy, r, "#ffffff", "rgba(0,0,0,0.6)");
      }
      // What the search or another plugin asked for: a gold ring around it.
      if (m.hit) circle(sx, sy, Math.max(r + 4, 7), null, GOLD, 2.5);
      // The way's Kibelisk always says its name; other names once zoomed in.
      if (m.text && (m.kind === "teleport" || zoom * map.tile >= 180)) {
        ctx.font = `${m.kind === "teleport" ? "600 " : ""}${Math.round(11 * Math.min(1.4, markScale))}px system-ui, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.fillStyle = "#fff";
        const tx = sx + r + (m.kind === "teleport" ? 9 : 4);
        ctx.strokeText(m.text, tx, sy + 4);
        ctx.fillText(m.text, tx, sy + 4);
      }
    }

    // The nearest labelled mark under the pointer, as a tooltip.
    function hover(px, py) {
      let best = null;
      for (const [sx, sy, r, label] of drawn) {
        const d = Math.hypot(sx - px, sy - py);
        if (d <= Math.max(r, 7) && (!best || d < best[0])) best = [d, label, sx, sy];
      }
      if (!best) {
        tip.hidden = true;
        return;
      }
      tip.textContent = best[1];
      tip.hidden = false;
      const [w] = size();
      tip.style.left = `${Math.min(best[2] + 10, w - tip.offsetWidth - 4)}px`;
      tip.style.top = `${Math.max(0, best[3] - 28)}px`;
    }

    if (interactive) {
      let drag = null;
      root.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, cx, cy, moved: false };
        e.preventDefault();
      });
      window.addEventListener("mousemove", (e) => {
        const rect = root.getBoundingClientRect();
        if (drag) {
          const dx = e.clientX - drag.x;
          const dy = e.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
          cx = drag.cx - dx / zoom;
          cy = drag.cy - dy / zoom;
          redraw();
          root.dispatchEvent(new CustomEvent("mapdrag"));
        } else if (e.target === canvas || root.contains(e.target)) {
          hover(e.clientX - rect.left, e.clientY - rect.top);
        }
      });
      window.addEventListener("mouseup", () => { drag = null; });
      root.addEventListener("mouseleave", () => { tip.hidden = true; });
      root.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = root.getBoundingClientRect();
        setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8), [e.clientX - rect.left, e.clientY - rect.top]);
        root.dispatchEvent(new CustomEvent("mapzoom", { detail: zoom }));
      }, { passive: false });
    }
    new ResizeObserver(() => {
      if (fitPending && map) fitMap();
      redraw();
    }).observe(root);

    return {
      setMap,
      get key() { return key; },
      get map() { return map; },
      get zoom() { return zoom; },
      setZoom,
      fit() { if (map) { fitMap(); redraw(); } },
      /** Show these world points (x, y, x, y ...), all of them, not closer
       *  than about 400 m across. */
      fitPoints(pts) {
        if (!map || pts.length < 2) return;
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < pts.length; i += 2) {
          const [nx, ny] = toNative(map, pts[i], pts[i + 1]);
          x0 = Math.min(x0, nx); y0 = Math.min(y0, ny); x1 = Math.max(x1, nx); y1 = Math.max(y1, ny);
        }
        const [w, h] = size();
        const minSpan = 40000 * map.scale;
        cx = (x0 + x1) / 2;
        cy = (y0 + y1) / 2;
        zoom = Math.max(fitZoom() * 0.5, Math.min(4, Math.min((w || 300) / Math.max(x1 - x0, minSpan), (h || 300) / Math.max(y1 - y0, minSpan)) * 0.85));
        redraw();
      },
      centerOn,
      setMarks(list) { marks = list; redraw(); },
      /** How large the marks are drawn: 1 as designed, 1.25 a quarter larger. */
      setMarkScale(f) {
        const v = Math.max(0.6, Math.min(2.5, Number(f) || 1));
        if (v !== markScale) { markScale = v; redraw(); }
      },
      redraw,
      /** Screen px per world metre at this zoom, and setting it. */
      pxPerMetre: () => (map ? map.scale * 100 * zoom : 0),
      setPxPerMetre(v) { if (map) setZoom(v / (map.scale * 100)); },
    };
  }

  /** The map the player is on from the monsters around him: each pet monster
   *  standing within 40 m of one of its species' spawn points on a map votes
   *  for that map (SkeeveAN, Aion2Maps.Detect). */
  // The map the player is on, from what is around him: each pet monster
  // standing within 40 m of a spawn point of its kind on a map votes for that
  // map, and so does each gathering spot or Hidden Cube within 30 m of a place
  // one stands at on it. Null when nothing around is known anywhere.
  function detectMap(npcs, objects = []) {
    const best = Object.entries(mapVotes(npcs, objects)).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  }
  /** How many of the monsters and objects around stand where each map has
   *  them: { mapKey: count }. */
  function mapVotes(npcs, objects = []) {
    const votes = {};
    const near = (pts, x, y, cm) => {
      for (let i = 0; i < pts.length; i += 2) {
        if ((pts[i] - x) ** 2 + (pts[i + 1] - y) ** 2 <= cm * cm) return true;
      }
      return false;
    };
    for (const [, npc, x, y] of npcs || []) {
      for (const [key, per] of Object.entries(D.spawns)) {
        const pts = per[npc];
        if (pts && near(pts, x, y, 4000)) votes[key] = (votes[key] || 0) + 1;
      }
    }
    const cubeIds = new Set(D.cubes.map(String));
    for (const [, env, x, y] of objects || []) {
      const id = cubeIds.has(String(env)) ? "cube" : String(env);
      for (const [key, per] of Object.entries(D.gather.points)) {
        const pts = per[id];
        if (pts && near(pts, x, y, 3000)) votes[key] = (votes[key] || 0) + 1;
      }
    }
    return votes;
  }

  /** Compass bearing from a to b, 0 = up (north on the map), clockwise. */
  const bearing = (ax, ay, bx, by) => (Math.atan2(by - ay, bx - ax) * 180) / Math.PI + 90;
  const metres = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay) / 100;

  globalThis.MapKit = Object.freeze({ MapView, detectMap, mapVotes, toNative, bearing, metres, GATHER_COLORS, PLACE_COLORS, PET_RED, GOLD });
})();
