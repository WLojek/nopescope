// Curtain check: open a page about GTA VI, expect the curtain; click "Show page", expect no blurred items.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { serveModels, testSettings, waitForModels } from "./helpers.mjs";
import { defaultRules, DEFAULT_SETTINGS } from "../src/shared/rules.js";
const url = process.argv[2] || "https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI";
const dist = path.resolve("dist"), profile = fs.mkdtempSync(path.join(os.tmpdir(), "nopescope-cur-"));
const models = await serveModels();
const kill = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 180000);
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--enable-unsafe-webgpu"] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  await sw.evaluate(async ([rules, settings]) => chrome.storage.local.set({ rules, settings }), [defaultRules(), testSettings(models.base)]);
  { const ui = await ctx.newPage(); await ui.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`); await waitForModels(ui, { images: true }); await ui.close(); }
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("nope-curtain", { timeout: 20000 });
  console.log("curtain:", await page.textContent("nope-curtain .title"));
  await page.screenshot({ path: "test/screens/curtain.png" });
  await page.waitForTimeout(6000);
  await page.locator("nope-curtain button", { hasText: "Show page" }).click();
  await page.waitForTimeout(4000);
  const blurred = await page.$$eval("[data-nope-state=blur], [data-nope-state=pending]", (e) => e.length);
  console.log("after Show page -> curtain:", await page.$$eval("nope-curtain", (e) => e.length), "blurred items:", blurred);
  await page.screenshot({ path: "test/screens/curtain-shown.png" });
} finally { clearTimeout(kill); models.server.close(); await ctx?.close().catch(() => {}); fs.rmSync(profile, { recursive: true, force: true }); }
