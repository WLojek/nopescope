// Images without any text: a fixture page on https://media.test/ with test images; checks the CLIP path.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http";
import { serveModels, testSettings, waitForModels } from "./helpers.mjs";
import { defaultRules, PACKS, DEFAULT_SETTINGS } from "../src/shared/rules.js";
const IMG = process.env.IMG_DIR || path.resolve("test/images"); // fetch with: python3 scripts/fetch-test-images.py
const man = JSON.parse(fs.readFileSync(`${IMG}/manifest.json`, "utf8")).map((m) => ({ ...m, file: path.basename(m.file) }));
const pick = man.filter((m, i) => ["gta6", "politics", "neutral", "miami"].includes(m.group) || (m.group === "othergame" && i % 2 === 0)).slice(0, 40);
const html = `<!doctype html><html><head><title>Gallery</title><style>body{font-family:system-ui} .g{display:grid;grid-template-columns:repeat(5,220px);gap:10px} .g div{position:relative} img{width:220px;height:160px;object-fit:cover;display:block}</style></head><body><h2>Photos</h2><div class="g">${pick.map((m, i) => `<div><img src="/img/${encodeURIComponent(m.file)}" alt=""><small>${i}</small></div>`).join("")}</div></body></html>`;
const dist = path.resolve("dist"), profile = fs.mkdtempSync(path.join(os.tmpdir(), "nopescope-media-"));
const models = await serveModels();
const kill = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 240000);
let ctx, srv;
try {
  ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1250, height: 1800 }, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--enable-unsafe-webgpu"] });
  // a real local server: the offscreen document fetches the images itself, outside Playwright's routing
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/img/")) { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(fs.readFileSync(path.join(IMG, decodeURIComponent(u.pathname.slice(5))))); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(html);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const rules = [...defaultRules(), ...PACKS.find((p) => p.id === "no-politics").rules.map((r) => ({ ...r, enabled: true, pack: "no-politics" }))];
  await sw.evaluate(async ([rules, settings]) => chrome.storage.local.set({ rules, settings }), [rules, testSettings(models.base)]);
  { const ui = await ctx.newPage(); await ui.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`); await waitForModels(ui, { images: true }); await ui.close(); }
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[page]", m.text()); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForTimeout(25000);
  const res = await page.$$eval("img", (els) => els.map((e) => ({ src: decodeURIComponent(e.getAttribute("src")), mid: e.getAttribute("data-nope-mid"), state: e.getAttribute("data-nope-state") || "shown", label: e.parentElement.querySelector(":scope > nope-cover.media > nope-pill")?.shadowRoot?.querySelector(".label")?.textContent || "" })));
  let ok = 0;
  for (const r of res) {
    const m = pick.find((p) => r.src.endsWith(p.file));
    const want = m.group === "gta6" ? "GTA VI" : m.group === "politics" ? "Politics" : "";
    const got = r.state === "blur" ? r.label : "";
    if ((want && got) || (!want && !got)) ok++;
    console.log(`${(got || "shown").padEnd(9)} want=${(want || "-").padEnd(8)} ${m.group.padEnd(9)} ${m.name.slice(5, 60)}`);
  }
  console.log(`agree ${ok}/${res.length}`);
  await page.screenshot({ path: "test/screens/media.png", fullPage: true });
  const why = await page.$("nope-cover.media nope-pill .why");
  if (why) {
    await why.scrollIntoViewIfNeeded(); await why.click(); await page.waitForTimeout(300);
    console.log("image panel:", (await page.evaluate(() => document.querySelector("nope-panel")?.shadowRoot?.querySelector(".panel")?.innerText || "")).replace(/\s+/g, " "));
    await page.screenshot({ path: "test/screens/media-why.png" });
  }
} finally { clearTimeout(kill); srv?.close(); models.server.close(); await ctx?.close().catch(() => {}); fs.rmSync(profile, { recursive: true, force: true }); }
