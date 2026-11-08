// Switch text model mini -> pico -> mini and classify after each switch.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { serveModels, testSettings, waitForModels } from "./helpers.mjs";

const dist = path.resolve("dist"), profile = fs.mkdtempSync(path.join(os.tmpdir(), "nopescope-sw-"));
const kill = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 180000);
let ctx, models;
try {
  ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--enable-unsafe-webgpu"] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const pop = await ctx.newPage(); await pop.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  const send = (m) => pop.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), m);
  models = await serveModels();
  await sw.evaluate((settings) => chrome.storage.local.set({ settings }), testSettings(models.base));
  await sw.evaluate(() => chrome.storage.local.set({ rules: [{ id: "t", name: "Tusk", enabled: true, kind: "topic", topic: "Donald Tusk", threshold: 0.6, sites: "all", action: "blur" }] }));
  for (const tm of ["basal-2.0-mini", "pico", "basal-2.0-mini"]) {
    await sw.evaluate(async (tm) => { const { settings = {} } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...settings, textModel: tm } }); }, tm);
    const st = await waitForModels(pop, { model: tm });
    const v = await send({ type: "nope:classify", ruleIds: ["t"], items: [{ id: "a", text: "Premier Donald Tusk ogłosił dziś nowy rząd.", kind: "post", site: "x.com" }] });
    console.log(tm, "->", st.model, st.state, "| verdict:", v.verdicts?.[0]?.action, (v.verdicts?.[0]?.score ?? 0).toFixed(3), v.verdicts?.[0]?.detail?.model, "| errors:", (st.errors || []).length);
  }
} finally { clearTimeout(kill); models?.server.close(); await ctx?.close().catch(() => {}); fs.rmSync(profile, { recursive: true, force: true }); }
