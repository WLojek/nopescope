# basal-web

basal-web runs [Basal](https://github.com/rkinas/basal) decision models by Remigiusz Kinas **in the browser, on WebGPU**, with no server.

A Basal model reads a text (the *state*) and answers a typed question with a calibrated probability for each option, in a single forward pass. It never generates text, which makes it a fast, predictable classifier you can describe in plain words.

basal-web follows Basal's runtime contract, [docs/FORMAT2.md](https://github.com/rkinas/basal/blob/main/docs/FORMAT2.md):

- the same prompts and chat templates;
- option codes read from the logits at the answer position;
- the same per-type and per-bucket calibration temperatures.

It powers [Nopescope](../README.md), but it does not depend on it.

## Models

| Model | Base | Browser file | Same answer as fp32 | Speed (M4 Pro, Chrome, WebGPU) |
|---|---|---|---|---|
| `Remek/basal-2.0-mini` (1.5B) | Bielik v3 (Llama) | ONNX int4, 0.97 GB | 23/23, max \|Δp\| 0.087 | ~110 ms per decision |
| `Remek/basal-omni-pico` (0.8B) | Qwen3.5 | ONNX int4, 0.49 GB | 23/23, max \|Δp\| 0.038 | ~80–110 ms per decision |

The test cases are 12 yes/no and choice requests from Basal's `format2_vectors.jsonl` (copied into `test/`) plus 11 of our own in English and Polish. The JS tokenizer matches the Hugging Face tokenizer token for token.

**int4 correction.** int4 can shift a model's yes/no logit; basal-2.0-mini moves by about −1.7. `scripts/fit_correction.py` fits `logit_ref = a·logit_int4 + b` against the fp32 reference on unlabelled texts. `export.py` stores the result in `basal-web.json` from `corrections.json`, and the runtime applies it to yes/no questions, so thresholds tuned on fp32 carry over.

**Supported:**
- question types `noul` (yes/no) and `choice`;
- one option order;
- calibration temperatures;
- one GPU job at a time via an optional `lock` shared with other onnxruntime sessions on the page.

**Not yet supported:**
- `score`, `multi`, `tool`, `act`;
- two option orders;
- certified thresholds and deferral;
- state-prefix KV reuse.

## Use

```js
import * as ort from "onnxruntime-web/webgpu";
import { BasalWeb } from "basal-web";

const basal = await BasalWeb.load({ ort, base: "/models/basal-2.0-mini" });
const a = await basal.ask("Prime Minister Donald Tusk announced a new government today.", {
  type: "noul",
  instructions: "Is this text about Donald Tusk?",
});
// a.noul        calibrated P(yes)
// a.raw         uncalibrated [yes, no]
// a.probabilities, a.confidence, a.temperature, a.tokens, a.ms
```

The model directory holds:
- `model.onnx` and `model.onnx.data`,
- `tokenizer.json` and `tokenizer_config.json`,
- `CALIBRATION.json` and `basal.json`,
- `basal-web.json`: graph I/O, model family and the int4 correction.

Serve onnxruntime-web's wasm next to your bundle and set `ort.env.wasm.wasmPaths`. The WebGPU build loads `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`.

## Export

```bash
python scripts/export.py Remek/basal-2.0-mini  ../models-web/basal-2.0-mini
python scripts/export.py Remek/basal-omni-pico ../models-web/basal-omni-pico
```

`export.py` does the following:
1. downloads the weights;
2. builds ONNX int4 for WebGPU with the onnxruntime-genai model builder (≥ 0.19), wrapping Qwen3.5's text config as `Qwen3_5ForConditionalGeneration` and dropping the MTP head;
3. prunes the LM head to the last token;
4. writes `basal-web.json`.

Requirements: `torch`, `transformers==5.17.0`, `onnx`, `onnxruntime-genai>=0.19`, `huggingface_hub`.

The pico export uses onnxruntime contrib ops that run on WebGPU but have no CPU kernel: `GatedDeltaNet` and `CausalConvWithState`. So the pico build needs WebGPU.

## Tests

```bash
python reference/make_expected.py <model dir> test/expected/<name>.json   # fp32 reference outputs (PyTorch)
node test/tokenizer_parity.mjs <model dir> test/expected/<name>.json      # JS tokenizer == HF tokenizer
node test/run.mjs ../models-web/basal-2.0-mini mini                       # Chrome + WebGPU: parity and speed
node test/eval-browser.mjs ../eval/politics.jsonl "<question>" ../models-web/basal-2.0-mini
```

## License

Apache-2.0. The models are by Remigiusz Kinas and released under Apache-2.0; see their model cards. basal-web is an independent runtime and is not affiliated with the Basal authors.
