// Real first run: a fresh profile downloads pico + MobileCLIP from Hugging Face (pinned commits, SHA-256
// checked), then classifies. Slow (about 0.6 GB); run it before a release: node test/hf-download.mjs
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { waitForModels } from "./helpers.mjs";

const dist = path.resolve("dist"), profile = fs.mkdtempSync(path.join(os.tmpdir(), "nopescope-hf-"));
const kill = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 900000);
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--enable-unsafe-webgpu"] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  await sw.evaluate(() => chrome.storage.local.set({
    settings: { enabled: true, scope: { mode: "all", hosts: [] }, textModel: "pico" },
    rules: [{ id: "t", name: "Tusk", enabled: true, kind: "topic", topic: "Donald Tusk", threshold: 0.6, sites: "all", action: "blur" }],
  }));
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  const t0 = Date.now();
  const ticker = setInterval(async () => {
    const st = await pop.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "nope:status" }, r))).catch(() => null);
    const d = st?.downloads || {};
    console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`, Object.entries(d).map(([k, v]) => `${k}:${v.state}:${(v.loaded / 1e6).toFixed(0)}/${(v.total / 1e6).toFixed(0)}MB`).join("  "));
  }, 10000);
  const st = await waitForModels(pop, { images: true, timeout: 800000 });
  clearInterval(ticker);
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`, st.model, JSON.stringify(st.downloads));
  const v = await pop.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "nope:classify", ruleIds: ["t"], items: [{ id: "a", text: "Premier Donald Tusk ogłosił dziś nowy rząd.", kind: "post", site: "x.com" }] }, r)));
  console.log("verdict:", v.verdicts?.[0]?.action, v.verdicts?.[0]?.score?.toFixed(3), v.verdicts?.[0]?.detail?.model);
  if (v.verdicts?.[0]?.action !== "blur") process.exitCode = 1;
} finally { clearTimeout(kill); await ctx?.close().catch(() => {}); fs.rmSync(profile, { recursive: true, force: true }); }
