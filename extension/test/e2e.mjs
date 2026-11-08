// End-to-end: load the built extension in Playwright's Chromium, route x.com to a fixture, check verdicts.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { defaultRules } from "../src/shared/rules.js";
import { serveModels, testSettings, waitForModels } from "./helpers.mjs";

const dist = path.resolve("dist");
const fixture = fs.readFileSync("test/fixtures/e2e-x.html", "utf8");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nopescope-e2e-"));
let ctx;
const models = await serveModels();
const deadline = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 240000);
try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--enable-unsafe-webgpu"],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500)); // let onInstalled seed its defaults first
  await sw.evaluate(async ([rules, settings]) => {
    const extra = [
      { id: "t-lang", name: "Russian", enabled: true, kind: "language", languages: ["ru"], languageMode: "block", sites: "all", action: "hide" },
      { id: "t-author", name: "@blockedperson", enabled: true, kind: "author", authors: ["@blockedperson"], sites: "all", action: "blur" },
    ];
    await chrome.storage.local.set({ rules: [...rules, ...extra], settings });
  }, [defaultRules(), testSettings(models.base)]);
  const extId = new URL(sw.url()).host;
  const ui = await ctx.newPage();
  ui.on("console", (m) => console.log("[ui]", m.text()));
  await ui.goto(`chrome-extension://${extId}/popup.html`);
  const st0 = Date.now();
  const warm = await waitForModels(ui);
  console.log("model:", JSON.stringify(warm), `${Date.now() - st0} ms`);
  await ctx.route("https://x.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: fixture }));
  const page = await ctx.newPage();
  page.on("console", (m) => { if (/nopescope|error/i.test(m.text())) console.log("[page]", m.text()); });
  await page.goto("https://x.com/home");
  await page.waitForFunction(() => {
    const arts = [...document.querySelectorAll("article[data-testid=tweet]")];
    return arts.length && arts.every((a) => a.hasAttribute("data-nope-id")) && !document.querySelector("[data-nope-state=pending]");
  }, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-nope-state=blur]").length >= 3, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const states = await page.$$eval("article[data-testid=tweet]", (as) => as.map((a) => ({
    state: a.getAttribute("data-nope-state") || "shown",
    label: ((e) => { const p = e.querySelector(":scope > nope-cover > nope-pill") || (e.previousElementSibling?.tagName === "NOPE-BAR" ? e.previousElementSibling.querySelector("nope-pill") : null) || e.parentElement?.querySelector(":scope > nope-cover.media > nope-pill"); return p?.shadowRoot?.querySelector(".label")?.textContent || ""; })(a),
    text: a.querySelector("[data-testid=tweetText]")?.textContent.slice(0, 70),
  })));
  console.table(states);
  await page.screenshot({ path: "test/screens/e2e-x.png", fullPage: true });
  // "Model output" panel for a model decision and for a word match
  const art = await page.$$("article[data-testid=tweet]");
  for (const [i, idx] of [[0, 1], [1, 2]]) {
    const why = await art[idx]?.$("nope-pill .why");
    if (!why) continue;
    await why.click();
    await page.waitForTimeout(300);
    const txt = await page.evaluate(() => document.querySelector("nope-panel")?.shadowRoot?.querySelector(".panel")?.innerText || "");
    console.log(`panel ${i}:`, txt.replace(/\s+/g, " ").slice(0, 400));
    await page.screenshot({ path: `test/screens/e2e-why-${i}.png` });
    await page.keyboard.press("Escape");
  }
  // regression: "Show" must survive the site re-rendering the post (X/YouTube rebuild elements while scrolling)
  await page.locator("article[data-testid=tweet]").first().locator("nope-pill button", { hasText: /^Show$/ }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const a = document.querySelector("article[data-testid=tweet]");
    const clone = a.cloneNode(true);
    clone.removeAttribute("data-nope-id"); clone.removeAttribute("data-nope-state");
    clone.querySelectorAll("nope-cover").forEach((n) => n.remove());
    a.replaceWith(clone); // same post, brand-new element
  });
  await page.waitForTimeout(4000);
  const after = await page.$eval("article[data-testid=tweet]", (a) => a.getAttribute("data-nope-state") || "shown");
  console.log("after Show + re-render:", after, after === "revealed" || after === "shown" ? "OK" : "FAIL (blurred again)");
  if (!(after === "revealed" || after === "shown")) process.exitCode = 1;
  const status = await ui.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "nope:status" }, r)));
  console.log("status:", JSON.stringify(status));
} finally {
  clearTimeout(deadline);
  await ctx?.close().catch(() => {});
  models.server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
