// Live check on arbitrary public pages with the real extension (generic adapter). Bounded, temp profile.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { serveModels, testSettings, waitForModels } from "./helpers.mjs";
import { defaultRules, PACKS, DEFAULT_SETTINGS } from "../src/shared/rules.js";
const urls = process.argv.slice(2);
const politics = process.env.POLITICS === "1";
const dist = path.resolve("dist");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nopescope-gen-"));
const models = await serveModels();
const kill = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 300000);
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1280, height: 1400 }, locale: "en-US",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--enable-unsafe-webgpu"] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const rules = [...defaultRules(), ...(politics ? PACKS.find((p) => p.id === "no-politics").rules.map((r) => ({ ...r, enabled: true, pack: "no-politics" })) : [])];
  await sw.evaluate(async ([rules, settings]) => chrome.storage.local.set({ rules, settings }), [rules, testSettings(models.base)]);
  { const ui = await ctx.newPage(); await ui.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`); await waitForModels(ui, { images: true }); await ui.close(); }
  for (const [i, url] of urls.entries()) {
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      for (const t of ["Reject all", "Reject All", "I do not accept", "Odrzuć wszystko", "Decline", "Accept all"]) {
        const b = page.locator(`button:has-text("${t}")`).first();
        if (await b.isVisible({ timeout: 800 }).catch(() => false)) { await b.click().catch(() => {}); break; }
      }
      await page.waitForTimeout(15000);
      const rows = await page.$$eval("[data-nope-id]", (els) => els.map((e) => ({ tag: e.tagName.toLowerCase(), state: e.getAttribute("data-nope-state") || "shown", text: e.textContent.trim().replace(/\s+/g, " ").slice(0, 90) })));
      const counts = rows.reduce((a, r) => ((a[r.state] = (a[r.state] || 0) + 1), a), {});
      console.log(`\n== ${url}\nitems: ${rows.length}`, counts);
      for (const r of rows.filter((r) => r.state !== "shown").slice(0, 6)) console.log(`  ${r.state.padEnd(7)} ${r.tag.padEnd(8)} ${r.text}`);
      for (const r of rows.filter((r) => r.state === "shown").slice(0, 5)) console.log(`  shown   ${r.tag.padEnd(8)} ${r.text}`);
      await page.screenshot({ path: `test/screens/live-generic-${i}.png` });
    } catch (e) { console.log(`\n== ${url}\nERROR ${e.message.split("\n")[0]}`); }
    finally { await page.close().catch(() => {}); }
  }
} finally { clearTimeout(kill); models.server.close(); await ctx?.close().catch(() => {}); fs.rmSync(profile, { recursive: true, force: true }); }
