// Look at a plugin's page without the meter: serves the plugin's folder with
// the SDK stand-in (a2.js here), emits the events of a JSON file in order,
// and takes a screenshot. Playwright is installed in the sessions' machines
// (require("playwright"), chromium.launch() needs no options).
//
//   node dev/harness/shot.mjs <plugin folder> <out.png> [events.json] [WxH]
//
// events.json: [["character", {...}, {meta}], ["decoded:pet-list", {...}], ...]
// WEB_FIXTURES=<json> answers a2.web.get ({ "<url or its start>": answer }),
// STORE=<json> fills the plugin's storage first; pictures are grey squares.
// WAIT=<ms> after the events (default 500), FULL=1 the whole page, PAGE=<file>
// another page of the plugin (widget.html: emit "widget" with what it shows).
// The page gets the meter's dark ground; external requests are listed (there
// should be none) and so are page errors.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [dir, out, eventsFile, size = "520x700"] = process.argv.slice(2);
if (!dir || !out) {
  console.error("node dev/harness/shot.mjs <plugin folder> <out.png> [events.json] [WxH]");
  process.exit(2);
}
const here = path.dirname(new URL(import.meta.url).pathname);
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = url === "/_sdk/a2.js" ? path.join(here, "a2.js") : path.join(dir, url === "/" ? process.env.PAGE || "index.html" : url);
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
});
server.listen(0, async () => {
  const port = server.address().port;
  const [w, h] = size.split("x").map(Number);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const outside = [];
  page.on("request", (r) => { if (!r.url().startsWith(`http://localhost:${port}`)) outside.push(r.url()); });
  page.on("pageerror", (e) => console.log("page error:", e.message));
  // Answers for a2.web.get and saved storage, set before the page loads:
  // WEB_FIXTURES=<json: { "<url or its start>": answer }>, STORE=<json>.
  const preset = {};
  if (process.env.WEB_FIXTURES) preset.web = JSON.parse(fs.readFileSync(process.env.WEB_FIXTURES, "utf8"));
  if (process.env.STORE) preset.store = JSON.parse(fs.readFileSync(process.env.STORE, "utf8"));
  if (Object.keys(preset).length) await page.addInitScript((p) => { window.__preset = p; }, preset);
  await page.goto(`http://localhost:${port}/`);
  await page.addStyleTag({ content: "html,body{background:#0b0f17;color:#e8e8e8}" });
  await page.waitForTimeout(500);
  const events = eventsFile ? JSON.parse(fs.readFileSync(eventsFile, "utf8")) : [];
  for (const [name, data, meta] of events) {
    await page.evaluate(([n, d, m]) => a2.emit(n, d, m), [name, data, meta]);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(Number(process.env.WAIT) || 500);
  await page.screenshot({ path: out, fullPage: !!process.env.FULL });
  console.log(`screenshot: ${out}`);
  console.log(`requests outside the plugin: ${outside.length ? outside.join(", ") : "none"}`);
  await browser.close();
  server.close();
});
