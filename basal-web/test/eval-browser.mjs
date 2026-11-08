// Run an eval JSONL through the browser (WebGPU, int4) model and report AUC / precision / recall.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import fs from "node:fs";
import { serve } from "./server.mjs";
const [evalPath, question, modelDir = "../models-web/basal-omni-pico"] = process.argv.slice(2);
const rows = fs.readFileSync(evalPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
await build({ entryPoints: ["test/page.js"], bundle: true, format: "esm", outfile: "test/page.bundle.js", logLevel: "warning" });
const srv = await serve(modelDir);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu"] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${srv.address().port}/test/page.html`);
  const res = await page.evaluate(([r, q]) => window.runEval(r, q), [rows, question]);
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(res.map((x, i) => ({ text: rows[i].text, raw: x.raw }))));
  const auc = (xs) => { const P = xs.filter((x) => x.label === 1), N = xs.filter((x) => x.label === 0); let s = 0; for (const p of P) for (const n of N) s += p.p > n.p ? 1 : p.p === n.p ? 0.5 : 0; return s / (P.length * N.length); };
  const ms = res.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`browser int4: n=${res.length} auc=${auc(res).toFixed(3)} median ${Math.round(ms[ms.length >> 1])} ms`);
  for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    const tp = res.filter((r) => r.p >= t && r.label === 1).length, fp = res.filter((r) => r.p >= t && r.label === 0).length, fn = res.filter((r) => r.p < t && r.label === 1).length;
    console.log(`  t=${t} precision=${(tp / (tp + fp)).toFixed(3)} recall=${(tp / (tp + fn)).toFixed(3)} fp=${fp} fn=${fn}`);
  }
} finally { await browser.close(); srv.close(); }
