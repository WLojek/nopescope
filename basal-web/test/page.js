import * as ort from "onnxruntime-web/webgpu";
import { BasalWeb } from "../src/basal-web.js";
ort.env.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
window.runTests = async function () {
  const log = [];
  const t0 = performance.now();
  const b = await BasalWeb.load({ ort, base: "/model" });
  const loadMs = performance.now() - t0;
  const exp = await (await fetch(`/test/expected/${new URLSearchParams(location.search).get("exp") || "pico"}.json`)).json();
  const results = [];
  for (const c of exp.cases) {
    const a = await b.ask(c.state, c.question);
    results.push({ id: c.id, got: a.probabilities, raw: a.raw, exp: c.expected.probabilities, expRaw: c.expected.raw, ms: a.ms, tokens: a.tokens });
  }
  // timing: repeat one short case
  const times = [];
  for (let i = 0; i < 10; i++) times.push((await b.ask(exp.cases.at(-2).state, exp.cases.at(-2).question)).ms);
  return { loadMs, results, times, adapter: (await navigator.gpu?.requestAdapter())?.info?.description || "?" };
};
window.runEval = async function (rows, question) {
  const b = await BasalWeb.load({ ort, base: "/model" });
  const out = [];
  for (const r of rows) {
    const a = await b.ask(r.text, { type: "noul", instructions: question });
    out.push({ p: a.noul, raw: a.raw[0], label: r.label, lang: r.lang, ms: a.ms });
  }
  return out;
};
