// Live check on public YouTube search with the real extension (no login). Bounded, temp profile.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http";
import { serveModels, testSettings, waitForModels } from "./helpers.mjs";
import { defaultRules, PACKS } from "../src/shared/rules.js";
const q = process.argv[2] || "gta 6 story ending";
const dist = path.resolve("dist");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nopescope-live-"));
const models = await serveModels();
const kill = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 240000);
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1280, height: 1600 }, locale: "en-US",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--enable-unsafe-webgpu"] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const rules = [...defaultRules(), ...PACKS[1].rules.map((r) => ({ ...r, enabled: true, pack: PACKS[1].id }))];
  await sw.evaluate(async ([rules, settings]) => chrome.storage.local.set({ rules, settings }), [rules, testSettings(models.base)]);
  { const ui = await ctx.newPage(); await ui.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`); await waitForModels(ui, { images: true }); await ui.close(); }
  const page = await ctx.newPage();
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
  const reject = page.locator('button:has-text("Reject all"), button:has-text("Odrzuć wszystko")').first();
  if (await reject.isVisible({ timeout: 5000 }).catch(() => false)) { await reject.click(); await page.waitForLoadState("domcontentloaded"); }
  await page.waitForSelector("ytd-video-renderer", { timeout: 30000 });
  await page.waitForTimeout(20000);
  const rows = await page.$$eval("[data-nope-id]", (els) => els.map((e) => ({ tag: e.tagName.toLowerCase(), state: e.getAttribute("data-nope-state") || "shown",
    title: (e.querySelector("#video-title")?.textContent || e.querySelector("h3")?.textContent || e.textContent).trim().replace(/\s+/g, " ").slice(0, 80) })));
  const counts = rows.reduce((a, r) => ((a[r.state] = (a[r.state] || 0) + 1), a), {});
  console.log("items:", rows.length, counts);
  for (const r of rows.slice(0, 24)) console.log(`${r.state.padEnd(8)} ${r.tag.padEnd(26)} ${r.title}`);
  await page.screenshot({ path: "test/screens/live-youtube.png" });
} finally { clearTimeout(kill); models.server.close(); await ctx?.close().catch(() => {}); fs.rmSync(profile, { recursive: true, force: true }); }
