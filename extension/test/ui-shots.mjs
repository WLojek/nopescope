// Visual check of options + popup with a stubbed chrome API. Serves dist/ over http (module scripts do not load from file://).
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { chromium } from "playwright-core";
const root = path.resolve("dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const srv = http.createServer((q, s) => { const f = path.join(root, q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); s.end(d); } }); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const day = new Date(); const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
const seed = {
  rules: [
    { id: "pack:gta6-related", pack: "gta6", name: "GTA VI", enabled: true, kind: "topic", topic: "GTA VI story spoilers", threshold: 0.5, action: "blur", sites: "all", prefilter: ["gta"] },
    { id: "a1", name: "", enabled: true, kind: "topic", topic: "football transfers", images: true, imagePrompts: ["a football match photo"], threshold: 0.7, action: "hide", sites: { mode: "only", hosts: ["x.com", "reddit.com"] } },
    { id: "a2", name: "", enabled: true, kind: "keyword", keywords: ["crypto", "giveaway", "ratio"], action: "blur", sites: "all" },
    { id: "a3", name: "", enabled: false, kind: "author", authors: ["@elonmusk", "u/spez"], action: "hide", sites: "all" },
    { id: "a4", name: "", enabled: true, kind: "language", languages: ["ru", "de"], languageMode: "block", action: "blur", sites: "all" },
  ],
  settings: { enabled: true, scope: { mode: "except", hosts: ["mail.google.com", "docs.google.com", "web.whatsapp.com", "localhost"] }, sites: {}, modelBase: "http://127.0.0.1:8787/model" },
  stats: { [key]: { "pack:gta6-related": 14, a1: 6, a2: 3, a4: 1 } },
  labels: new Array(37).fill({ text: "x", ruleId: "a1", label: "false_positive" }),
};
const stub = (seed, status) => `(() => {
  const data = ${JSON.stringify(seed)}; const ls = [];
  const fake = { models: { installed: false } };
  navigator.storage.getDirectory = async () => ({ getDirectoryHandle: async (n) => { if (n === "models" && !fake.models.installed) { const d = { getDirectoryHandle: async () => { throw 0; } }; return d; } return { getFileHandle: async () => ({}), getDirectoryHandle: async () => ({ getFileHandle: async () => ({}) }) }; } });
  window.chrome = { storage: { local: { get: async (k) => { const o = {}; for (const x of [].concat(k)) if (x in data) o[x] = JSON.parse(JSON.stringify(data[x])); return o; }, set: async (o) => Object.assign(data, o) }, onChanged: { addListener: (f) => ls.push(f) } },
    runtime: { sendMessage: async (m) => m.type === "nope:status" || m.type === "nope:loadModel" ? ${JSON.stringify({ model: "pico", ...status, downloads: { "pico": { state: "ready", loaded: 492116736, total: 492116736 }, "basal-2.0-mini": { state: "downloading", loaded: 418000000, total: 971992064 }, "mobileclip-s0": { state: "none" } } })} : {}, openOptionsPage() {} },
    tabs: { query: async () => [{ url: location.hash === "#bbc" ? "https://www.bbc.co.uk/news" : "https://www.youtube.com/watch?v=1" }] } };
})();`;
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
try {
  const shots = async (name, url, vp, status, act) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: name.includes("light") ? "light" : "dark" });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("PAGEERR", e.message)); page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
    await page.addInitScript(stub(seed, status)); await page.goto(base + url); await page.waitForTimeout(500);
    if (act) await act(page);
    await page.screenshot({ path: `test/screens/${name}.png`, fullPage: true }); await ctx.close();
  };
  const ready = { state: "ready", msPerDecision: 82 };
  const openAll = async (p) => { await p.click(".rule:nth-of-type(1) .summary"); await p.waitForTimeout(100); };
  await shots("options-dark", "/options.html", { width: 1100, height: 900 }, ready, async (p) => { for (const t of ["football", "crypto", "elonmusk", "Russian"]) await p.locator(".summary", { hasText: t }).first().click().catch(() => {}); await p.locator(".summary", { hasText: "Russian" }).first().click().catch(() => {}); });
  await shots("options-filter", "/options.html", { width: 1100, height: 700 }, ready, async (p) => { await p.fill("#siteFilter", "https://old.reddit.com/r/x"); await p.waitForTimeout(150); });
  await shots("options-model", "/options.html", { width: 1100, height: 700 }, ready, async (p) => { await p.waitForTimeout(300); await p.locator("#model").scrollIntoViewIfNeeded(); });
  await shots("options-light-nogpu", "/options.html", { width: 1100, height: 900 }, { state: "nogpu" });
  await shots("options-dl", "/options.html", { width: 1100, height: 900 }, { state: "downloading", progress: 0.42 });
  await shots("popup-dark", "/popup.html", { width: 340, height: 500 }, ready);
  await shots("popup-light", "/popup.html#bbc", { width: 340, height: 500 }, { state: "idle" });
} finally { await browser.close(); srv.close(); }
