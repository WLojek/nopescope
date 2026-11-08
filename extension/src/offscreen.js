// Offscreen document: hosts the local models on WebGPU and answers classify requests from the service worker.
//   text:   a basal decision model (basal-web runtime), one yes/no question per topic rule
//   images: MobileCLIP-S0, zero-shot against each topic rule's image prompts
// Offscreen documents only get chrome.runtime, so the service worker passes the model location and the rules in
// each message.
import * as ort from "onnxruntime-web/webgpu";
import { BasalWeb } from "../../basal-web/src/basal-web.js";
import { modelRulesFor, questionFor, labelFor, ruleAppliesToSite } from "./shared/rules.js";
import { Clip, promptsFor } from "./clip.js";
import { ModelStore } from "./model-store.js";
import { IMAGE_MODEL } from "./shared/rules.js";

ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
ort.env.wasm.numThreads = 1;
ort.env.logLevel = "error";

const GPU_TIMEOUT = 30000;              // ms; a GPU job that never settles means a lost device
const IMAGE_TIMEOUT = 10000;            // ms per image download
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const VERDICT_CACHE_MAX = 8000;
const IMAGE_CACHE_MAX = 3000;

const status = { state: "idle", progress: 0, error: null, msPerDecision: null, model: null, errors: [] };
let store = new ModelStore();
const logError = (where, e) => { status.errors = [...status.errors, `${where}: ${String(e?.stack || e?.message || e).slice(0, 300)}`].slice(-8); };

// If onnxruntime's wasm memory or the GPU device is broken, every later call fails: reload this document
// (the models load again in a few seconds).
const FATAL = /memory access out of bounds|GPUComputePipeline|GPUDevice|device (was )?lost|unreachable|gpu timeout/i;
let reloading = false;
function checkFatal(e) {
  if (!reloading && FATAL.test(String(e?.message || e))) { reloading = true; status.state = "error"; setTimeout(() => location.reload(), 50); }
}
addEventListener("error", (e) => { logError("error", e.error || e.message); checkFatal(e.error || e.message); });
addEventListener("unhandledrejection", (e) => { logError("rejection", e.reason); checkFatal(e.reason); });

// One GPU job at a time across ALL sessions (basal + CLIP): onnxruntime-web is not re-entrant, two sessions
// running at once corrupt its wasm memory. A job that hangs trips the watchdog.
let gpuTail = Promise.resolve();
function gpuLock(fn) {
  const run = () => Promise.race([
    Promise.resolve().then(fn),
    new Promise((_, reject) => setTimeout(() => reject(new Error("gpu timeout")), GPU_TIMEOUT)),
  ]);
  const p = gpuTail.then(run);
  gpuTail = p.catch((e) => checkFatal(e));
  return p;
}

// ---------------------------------------------------------------- text model
// Models download once from Hugging Face (pinned commit, SHA-256 checked) into Cache Storage; see model-store.js.
let modelPromise = null;
let modelId = null;
let modelReady = false;
const verdictCache = new Map(); // `${question}\u0000${text}` -> answer
let decisions = 0;

function setStore(devBase) {
  if ((devBase || null) !== store.devBase) store = new ModelStore({ devBase }); // tests only
}

function loadModel(id) {
  if (id && id !== modelId) {
    if (modelPromise) {
      // the user switched models: drop the old one
      const old = modelPromise;
      old.then((m) => gpuLock(() => m.session.release?.())).catch(() => {});
      verdictCache.clear();
    }
    modelId = id;
    modelPromise = null;
    modelReady = false;
  }
  if (modelPromise) return modelPromise;
  if (!modelId) return Promise.reject(new Error("no model chosen yet"));
  const id_ = modelId;
  status.model = id_;
  status.state = "loading"; // until we know whether it needs a download
  modelPromise = (async () => {
    if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) {
      status.state = "nogpu";
      throw new Error("WebGPU is not available");
    }
    status.model = id_;
    status.error = null;
    status.state = (await store.has(id_)) ? "loading" : "downloading";
    await store.ensure(id_);
    status.state = "loading";
    const model = await BasalWeb.load({ ort, base: `hf:${id_}`, fetchImpl: (u) => store.fetch(u), lock: gpuLock });
    if (modelId !== id_) { gpuLock(() => model.session.release?.()); throw new Error("model switched"); }
    status.state = "ready";
    modelReady = true;
    return model;
  })().catch((e) => {
    if (modelId === id_) {
      if (status.state !== "nogpu") status.state = "error";
      status.error = String(e?.message || e);
      modelPromise = null;
    }
    throw e;
  });
  return modelPromise;
}

async function askCached(model, text, question) {
  const key = `${question}\u0000${text}`;
  const hit = verdictCache.get(key);
  if (hit) return { a: hit, cached: true };
  const a = await model.ask(text, { type: "noul", instructions: question });
  // the first runs include WebGPU shader compilation: keep them out of the speed shown to the user
  if (++decisions > 3) status.msPerDecision = status.msPerDecision == null ? a.ms : 0.9 * status.msPerDecision + 0.1 * a.ms;
  verdictCache.set(key, a);
  if (verdictCache.size > VERDICT_CACHE_MAX) verdictCache.delete(verdictCache.keys().next().value);
  return { a, cached: false };
}

function textDetail(model, rule, question, a, input, cached) {
  return {
    kind: "text", model: `${model.meta.name} (Basal by Remigiusz Kinas, local WebGPU)`, rule: rule.name || rule.topic, ruleId: rule.id,
    question, answer: a.noul >= 0.5 ? "yes" : "no", pYes: a.noul, threshold: rule.threshold ?? 0.6,
    probabilities: a.probabilities, raw: { yes: a.raw[0], no: a.raw[1] }, temperature: a.temperature, lang: a.lang,
    ms: Math.round(a.ms), tokens: a.tokens, cached, input: input.slice(0, 800),
  };
}

async function classify({ items, rules, textModel }) {
  // while the model downloads, answer at once: the page shows items instead of waiting on a blur
  if (!modelReady || textModel !== modelId) {
    loadModel(textModel).catch(() => {});
    return { notReady: true, status: { ...status } };
  }
  const model = await loadModel(textModel);
  const verdicts = [];
  for (const it of items) {
    let verdict = { id: it.id, action: "show" };
    try {
      for (const rule of modelRulesFor(rules, it.site, it.text)) {
        const q = questionFor(rule);
        const { a, cached } = await askCached(model, it.text, q);
        if (a.noul >= (rule.threshold ?? 0.6)) {
          verdict = { id: it.id, action: rule.action || "blur", ruleId: rule.id, label: labelFor(rule), score: a.noul,
            detail: textDetail(model, rule, q, a, it.text, cached) };
          break;
        }
      }
    } catch (e) {
      // one bad item (e.g. a prompt longer than the model's context) must not fail the batch
      logError("classify item", e);
      checkFatal(e);
    }
    verdicts.push(verdict);
  }
  return { verdicts };
}

// ---------------------------------------------------------------- images and video posters
let clipPromise = null;
let clipReady = false;
function loadClip() {
  if (!clipPromise) {
    clipPromise = (async () => {
      await store.ensure(IMAGE_MODEL.id);
      const clip = await Clip.load({ ort, fetchImpl: (f) => store.fetch(`hf:${IMAGE_MODEL.id}/${f}`), lock: gpuLock });
      clipReady = true;
      return clip;
    })().catch((e) => { clipPromise = null; throw e; });
  }
  return clipPromise;
}
const imageEmbCache = new Map(); // src -> Float32Array | null

// Only public http(s) images: never local network, loopback or other schemes, whatever a page puts in its DOM.
function fetchableImage(src, allowLocal = false) {
  let u;
  try { u = new URL(src); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (allowLocal) return true;
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.includes(":") && (h === "::1" || /^f[cd]/.test(h) || /^fe80/.test(h))) return false;
  return true;
}

async function readCapped(res, cap) {
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > cap) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return new Blob(chunks, { type: res.headers.get("content-type") || "" });
}

async function imageEmbedding(clip, src, allowLocal) {
  if (imageEmbCache.has(src)) return imageEmbCache.get(src);
  let emb = null;
  if (fetchableImage(src, allowLocal)) {
    try {
      const res = await fetch(src, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(IMAGE_TIMEOUT) });
      const type = res.headers.get("content-type") || "";
      if (res.ok && res.body && /^image\//.test(type) && !/svg/.test(type)) {
        const blob = await readCapped(res, MAX_IMAGE_BYTES);
        if (blob) {
          const bmp = await createImageBitmap(blob);
          if (bmp.width >= 64 && bmp.height >= 64) emb = await clip.embedImage(bmp);
          bmp.close();
        }
      }
    } catch (e) { checkFatal(e); /* unreachable or undecodable image: leave it alone */ }
  }
  imageEmbCache.set(src, emb);
  if (imageEmbCache.size > IMAGE_CACHE_MAX) imageEmbCache.delete(imageEmbCache.keys().next().value);
  return emb;
}

async function classifyMedia({ items, rules, textModel, allowLocal }) {
  if (!clipReady) {
    loadClip().catch(() => {});
    if (!modelReady) loadModel(textModel).catch(() => {});
    return { notReady: true, status: { ...status } };
  }
  const topic = rules.filter((r) => r.kind === "topic" && r.images !== false);
  const verdicts = [];
  let clip = null;
  for (const it of items) {
    let verdict = { id: it.id, action: "show" };
    const mine = topic.filter((r) => ruleAppliesToSite(r, it.site));
    try {
      // 1. words around the image (alt, caption, title) through the text model
      if (it.context) {
        const model = modelReady && textModel === modelId ? await loadModel(textModel).catch(() => null) : null;
        for (const rule of model ? modelRulesFor(mine, it.site, it.context.toLowerCase()) : []) {
          const q = questionFor(rule);
          const { a, cached } = await askCached(model, it.context, q);
          if (a.noul >= (rule.threshold ?? 0.6)) {
            verdict = { id: it.id, action: "blur", ruleId: rule.id, label: labelFor(rule), score: a.noul,
              detail: { ...textDetail(model, rule, q, a, it.context, cached), via: "image caption / alt text", src: it.src } };
            break;
          }
        }
      }
      // 2. the pixels
      if (verdict.action === "show" && mine.length && it.src) {
        clip ||= await loadClip();
        const t0 = performance.now();
        const emb = await imageEmbedding(clip, it.src, allowLocal);
        if (emb) for (const rule of mine) {
          const sc = await clip.score(emb, promptsFor(rule));
          if (sc.p >= (rule.imageThreshold ?? 0.9)) {
            verdict = { id: it.id, action: "blur", ruleId: rule.id, label: labelFor(rule), score: sc.p, detail: {
              kind: "image", model: "MobileCLIP-S0 (Apple, local WebGPU)", rule: rule.name || rule.topic, ruleId: rule.id,
              prompts: promptsFor(rule), pMatch: sc.p, threshold: rule.imageThreshold ?? 0.9,
              bestPrompt: sc.best, bestSimilarity: +sc.bestSim.toFixed(4), closestOther: sc.topNeg, closestOtherSimilarity: +sc.topNegSim.toFixed(4),
              ms: Math.round(performance.now() - t0), src: it.src, caption: it.context || "" } };
            break;
          }
        }
      }
    } catch (e) {
      logError("classify image", e);
      checkFatal(e);
    }
    verdicts.push(verdict);
  }
  return { verdicts };
}

// ---------------------------------------------------------------- messages
async function fullStatus() {
  return { ...status, downloads: await store.summary() };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "offscreen" || sender.id !== chrome.runtime.id) return false;
  setStore(msg.devBase);
  const reply = (p) => {
    p.then(sendResponse, async (e) => { logError(msg.type, e); sendResponse({ error: String(e?.message || e), status: await fullStatus() }); checkFatal(e); });
    return true;
  };
  switch (msg.type) {
    case "nope:classify": return reply(classify(msg));
    case "nope:classifyMedia": return reply(classifyMedia(msg));
    case "nope:loadModel":
      // starts the download/load and answers with the status right away (the UI polls for progress)
      loadModel(msg.textModel).catch(() => {});
      if (msg.withImages) loadClip().catch(() => {});
      return reply(fullStatus());
    case "nope:downloadModel":
      store.ensure(msg.id).catch(() => {});
      return reply(fullStatus());
    case "nope:deleteModel":
      if (msg.id === modelId) return reply(Promise.reject(new Error("switch to another model before deleting this one")));
      if (msg.id === IMAGE_MODEL.id) { clipPromise = null; clipReady = false; }
      return reply(store.remove(msg.id).then(fullStatus));
    case "nope:status": return reply(fullStatus());
    default: return false;
  }
});
