// Repro: add topics "Donald Tusk" and "Donald Trump" through the popup UI, then open a page with posts and photos.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http";
import { DEFAULT_SETTINGS } from "../src/shared/rules.js";
import { serveModels, testSettings, waitForModels } from "./helpers.mjs";

const IMG = process.env.IMG_DIR || path.resolve("test/images"); // fetch with: python3 scripts/fetch-test-images.py
const imgs = fs.readdirSync(IMG).filter((f) => /Tusk|trump__|Medvedev|Everest|Pizza|Skyline|Ray_?Liotta|Dieter|Carl_G/i.test(f)).slice(0, 26);
const posts = [
  "Donald Tusk zapowiedział dziś rekonstrukcję rządu, ministrowie czekają na decyzję premiera.",
  "Premier Tusk spotkał się w Brukseli z przewodniczącą Komisji Europejskiej.",
  "Trump says he will impose new tariffs on European cars starting next month.",
  "The former president held a rally in Ohio last night, telling supporters the election was rigged.",
  "My sourdough finally has a proper rise after switching to 75% hydration.",
  "Lewandowski strzelił dwa gole w meczu z Valencią.",
  "Donald Duck turns 92 this year and Disney is releasing a special comic.",
];
const html = `<!doctype html><html><head><meta charset="utf-8"><title>News feed</title></head><body><main>
${posts.map((p, i) => `<article class="post"><h3>Post ${i}</h3><p>${p}</p></article>`).join("\n")}
<section class="gallery">${imgs.map((f) => `<figure><img src="/img/${encodeURIComponent(f)}" width="300" height="200" alt=""></figure>`).join("")}</section>
</main></body></html>`;
const dist = path.resolve("dist"), profile = fs.mkdtempSync(path.join(os.tmpdir(), "nopescope-ct-"));
const models = await serveModels();
const kill = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 240000);
let ctx, srv;
try {
  srv = http.createServer((req, res) => { const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/img/")) { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(fs.readFileSync(path.join(IMG, decodeURIComponent(u.pathname.slice(5))))); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1200, height: 2200 }, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--enable-unsafe-webgpu"] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  await new Promise((r) => setTimeout(r, 2000));
  // the user's path: popup quick-add
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await sw.evaluate(async (settings) => chrome.storage.local.set({ settings }), testSettings(models.base));
  await waitForModels(pop, { images: true });
  for (const t of ["Donald Tusk", "Donald Trump"]) { await pop.fill("#quickInput", t); await pop.press("#quickInput", "Enter"); await pop.waitForTimeout(500); }
  console.log("rules:", JSON.stringify(await sw.evaluate(async () => (await chrome.storage.local.get("rules")).rules.map((r) => [r.kind, r.topic || r.name, r.enabled, JSON.stringify(r.sites)]))));
  console.log("model:", await pop.textContent("#modelText"));
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || /nope/i.test(m.text())) console.log("[page]", m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForTimeout(20000);
  console.log("marked:", await page.$$eval("[data-nope-id]", (e) => e.map((x) => x.tagName + "#" + x.getAttribute("data-nope-id") + ":" + (x.getAttribute("data-nope-state") || "-")).join(" ")));
  const ids = await sw.evaluate(async () => (await chrome.storage.local.get("rules")).rules.filter((r) => r.kind === "topic").map((r) => r.id));
  const direct = await pop.evaluate((ruleIds) => new Promise((r) => chrome.runtime.sendMessage({ type: "nope:classify", ruleIds, items: [{ id: "t1", text: "Donald Tusk zapowiedział dziś rekonstrukcję rządu.", kind: "post", site: "127.0.0.1" }] }, r)), ids);
  console.log("direct classify:", JSON.stringify(direct).slice(0, 400));
  console.log("pages:", ctx.pages().map((p) => p.url()).join(" | "), "| bg:", ctx.backgroundPages().map((p) => p.url()).join(" "));
  const st = await pop.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "nope:status" }, r)));
  console.log("status:", JSON.stringify(st));
  const rows = await page.$$eval("article p, article, img", (els) => els.map((e) => ({ tag: e.tagName, state: e.getAttribute("data-nope-state") || (e.closest("[data-nope-state=blur]") ? "inside-blur" : "shown"), label: ((e) => { const p = e.querySelector(":scope > nope-cover > nope-pill") || (e.previousElementSibling?.tagName === "NOPE-BAR" ? e.previousElementSibling.querySelector("nope-pill") : null) || e.parentElement?.querySelector(":scope > nope-cover.media > nope-pill"); return p?.shadowRoot?.querySelector(".label")?.textContent || ""; })(e), t: (e.getAttribute("src") || e.textContent).trim().slice(0, 70) })));
  for (const r of rows.filter((r) => r.tag !== "P")) console.log(r.state.padEnd(11), (r.label || "").padEnd(14), r.t);
  console.log("loaded model:", JSON.stringify((await pop.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "nope:status" }, r)))).model));
  console.log("model after:", await pop.textContent("#modelText"));
  await page.screenshot({ path: "test/screens/custom-topic.png", fullPage: true });
} finally { clearTimeout(kill); srv?.close(); models.server.close(); await ctx?.close().catch(() => {}); fs.rmSync(profile, { recursive: true, force: true }); }
