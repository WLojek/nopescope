// Image side of Nopescope: MobileCLIP-S0 (Apple, via Xenova/mobileclip_s0 ONNX fp16) on WebGPU.
// Zero-shot: an image matches a rule when its similarity to the rule's prompts beats generic "other" prompts.
import { Tokenizer } from "@huggingface/tokenizers";

const SIZE = 256;
const NEGATIVES = [
  "a photo", "a photo of people", "a photo of a city", "a landscape photo", "a photo of an animal", "a photo of food",
  "a video game screenshot", "an illustration", "a cartoon", "a screenshot of a website", "a meme", "a logo", "a product photo",
];

export class Clip {
  /** fetchImpl(file) returns a Response for a file of Xenova/mobileclip_s0 (e.g. "onnx/vision_model_fp16.onnx") */
  static async load({ ort, fetchImpl, lock = (fn) => fn() }) {
    const get = async (f) => { const r = await fetchImpl(f); if (!r.ok) throw new Error(`${f}: ${r.status}`); return r; };
    const j = (f) => get(f).then((r) => r.json());
    const [tj, tc] = await Promise.all([j("tokenizer.json"), j("tokenizer_config.json")]);
    const bin = (f) => get(f).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b));
    const opts = { executionProviders: ["webgpu"], graphOptimizationLevel: "all" };
    const [vb, tb] = await Promise.all([bin("onnx/vision_model_fp16.onnx"), bin("onnx/text_model_fp16.onnx")]);
    const vision = await lock(() => ort.InferenceSession.create(vb, opts));
    const text = await lock(() => ort.InferenceSession.create(tb, opts));
    return new Clip(ort, vision, text, new Tokenizer(tj, tc), lock);
  }

  constructor(ort, vision, text, tok, lock = (fn) => fn()) {
    this.ort = ort; this.vision = vision; this.text = text; this.tok = tok; this.lock = lock;
    this.textCache = new Map();
  }

  run(fn) { return this.lock(fn); }

  async embedText(t) {
    const key = t.toLowerCase();
    if (this.textCache.has(key)) return this.textCache.get(key);
    let ids = this.tok.encode(key, { add_special_tokens: true }).ids.slice(0, 77);
    if (ids[ids.length - 1] !== 49407) ids[Math.min(ids.length, 76)] = 49407; // keep end-of-text (pooled by argmax)
    ids = ids.concat(new Array(77 - ids.length).fill(0));
    const out = await this.run(() => this.text.run({ input_ids: new this.ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, 77]) }));
    const e = normalize(Float32Array.from(out.text_embeds.data));
    this.textCache.set(key, e);
    return e;
  }

  async embedImage(bitmap) {
    const c = new OffscreenCanvas(SIZE, SIZE);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    const s = SIZE / Math.min(bitmap.width, bitmap.height);
    const w = bitmap.width * s, h = bitmap.height * s;
    g.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h); // resize shortest edge + center crop
    const px = g.getImageData(0, 0, SIZE, SIZE).data;
    const x = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0, n = SIZE * SIZE; i < n; i++) {
      x[i] = px[i * 4] / 255; x[n + i] = px[i * 4 + 1] / 255; x[2 * n + i] = px[i * 4 + 2] / 255;
    }
    const out = await this.run(() => this.vision.run({ pixel_values: new this.ort.Tensor("float32", x, [1, 3, SIZE, SIZE]) }));
    return normalize(Float32Array.from(out.image_embeds.data));
  }

  /** {p: P(image matches one of `prompts` rather than generic negatives), best, bestSim, topNeg, topNegSim} */
  async score(imageEmb, prompts) {
    const pos = await Promise.all(prompts.map((p) => this.embedText(p)));
    const negAll = await Promise.all(NEGATIVES.map((p) => this.embedText(p)));
    // drop negatives that say the same thing as a prompt (e.g. "a photo of food" for a food rule)
    const neg = negAll.filter((n) => pos.every((p) => dot(n, p) < 0.85));
    const ps = pos.map((p) => dot(p, imageEmb));
    const sp = Math.max(...ps);
    const negNames = NEGATIVES.filter((_, i) => pos.every((p) => dot(negAll[i], p) < 0.85));
    const ns = neg.map((n) => dot(n, imageEmb));
    const logits = [sp, ...ns].map((v) => v * 100);
    const m = Math.max(...logits);
    const e = logits.map((v) => Math.exp(v - m));
    const k = ns.indexOf(Math.max(...ns));
    return { p: e[0] / e.reduce((a, b) => a + b, 0), best: prompts[ps.indexOf(sp)], bestSim: sp, topNeg: negNames[k], topNegSim: ns[k] };
  }
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function normalize(v) { const n = Math.sqrt(dot(v, v)) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v; }

export function promptsFor(rule) {
  if (rule.imagePrompts?.length) return rule.imagePrompts;
  const t = (rule.topic || "").trim();
  return [`a photo of ${t}`, `an image about ${t}`, `a screenshot of ${t}`];
}
