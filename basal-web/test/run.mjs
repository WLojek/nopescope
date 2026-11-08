import { chromium } from "playwright-core";
import { build } from "esbuild";
import { serve } from "./server.mjs";
const modelDir = process.argv[2] || "../models-web/basal-omni-pico";
const expName = process.argv[3] || "pico";
await build({ entryPoints: ["test/page.js"], bundle: true, format: "esm", outfile: "test/page.bundle.js", logLevel: "warning", external: [] });
const srv = await serve(modelDir);
const port = srv.address().port;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU"] });
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[page]", m.text()); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`http://127.0.0.1:${port}/test/page.html?exp=${expName}`);
  const r = await page.evaluate(() => window.runTests(), null, { timeout: 600000 });
  console.log("adapter:", r.adapter, "load ms:", Math.round(r.loadMs));
  let maxd = 0, agree = 0;
  for (const x of r.results) {
    const keys = Object.keys(x.exp);
    const d = Math.max(...keys.map((k) => Math.abs(x.got[k] - x.exp[k])));
    maxd = Math.max(maxd, d);
    const top = (o) => keys.reduce((a, k) => (o[k] > o[a] ? k : a), keys[0]);
    if (top(x.got) === top(x.exp)) agree++;
    console.log(`${x.id.padEnd(28)} tok=${x.tokens} ${Math.round(x.ms)}ms maxdiff=${d.toFixed(4)} got=${JSON.stringify(Object.fromEntries(keys.map(k=>[k,+x.got[k].toFixed(3)])))} exp=${JSON.stringify(Object.fromEntries(keys.map(k=>[k,+x.exp[k].toFixed(3)])))}`);
  }
  const t = r.times.slice(2).sort((a, b) => a - b);
  console.log({ cases: r.results.length, topAgree: agree, maxProbDiff: +maxd.toFixed(4), medianMs: Math.round(t[Math.floor(t.length / 2)]) });
} finally {
  await browser.close();
  srv.close();
}
