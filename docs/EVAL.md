# Evaluation

All numbers below come from the **browser builds** (ONNX int4 on onnxruntime-web, WebGPU, Chrome, Apple M4 Pro) unless they are marked *fp32*. The fp32 reference is the PyTorch implementation in `basal-web/reference/basal_ref.py`.

## Runtime parity (basal-web against the reference)

The test cases are 12 yes/no and choice requests from Basal's `format2_vectors.jsonl`, plus 11 of our own in English and Polish (`basal-web/test/expected/*.json`).

| Model | Same answer | Max \|Δp\| | Median latency |
|---|---|---|---|
| basal-omni-pico | 23/23 | 0.038 | ~80–110 ms |
| basal-2.0-mini | 23/23 | 0.087 with the int4 correction (0.20 without) | ~110 ms |

The JS tokenizer (`@huggingface/tokenizers`) produced the same token ids as Hugging Face's Python tokenizer on all 23 prompts.

### int4 correction

int4 basal-2.0-mini leans towards "yes": its yes/no logit is shifted by about −1.7 compared with fp32. We fit a label-free linear map from the int4 logit to the fp32 logit on 380 texts (`basal-web/scripts/fit_correction.py`). Its mean |Δlogit| drops from 1.73 to 0.77. The fitted values ship in `basal-web/corrections.json`, so the same thresholds work for both models. pico needs almost no correction (a = 1.003, b = −0.10).

## Text rules

The eval sets are synthetic: written by a model, labelled at the same time, and spot-checked. GTA VI is not out yet, so its "spoilers" are invented.

- `eval/gta6_spoilers.jsonl`: 260 posts (200 en, 60 pl), 45% spoilers. It has many hard negatives: trailer talk, price, fps, other games, "no spoilers please", reviews without plot details, and words like "ending" or "died" used outside the story.
- `eval/politics.jsonl`: 120 posts (80 en, 40 pl), 40% politics. Hard negatives include office politics, school elections, sports, and economy news without government.

| | pico, AUC | mini, AUC | pico at the default threshold | mini at the default threshold |
|---|---|---|---|---|
| GTA VI spoilers | 0.977 | 0.988 | t 0.4: precision 0.88, recall 0.94 | t 0.4: precision 0.93, recall 0.94 |
| Politics | 0.996 | 1.000 | t 0.6: precision 0.96, recall 0.98 | t 0.6: precision 0.98, recall 1.00 |

fp32 reference for comparison:
- pico: GTA spoilers AUC 0.987 (en 0.993, pl 0.969), politics 0.995.
- mini: GTA spoilers 0.989 (pl 0.989), politics 1.000.

basal-2.0-mini scores lower than pico on Basal's own Werdykt benchmark (0.618 vs 0.660). On these topic-filtering tasks it scores higher, most visibly in Polish, which fits its Bielik base.

**Reproduce:**

```bash
python eval/run_eval.py models/basal-2.0-mini eval/gta6_spoilers.jsonl "<question>"                       # fp32
node basal-web/test/eval-browser.mjs eval/gta6_spoilers.jsonl "<question>" models-web/basal-2.0-mini      # browser
```

## Images

`extension/test/media.mjs` puts 40 unlabelled Wikipedia images on a page with the *GTA VI* and *No politics* packs on. The images are GTA VI art, other games, politics, Miami photos, maps and animals, fetched by `extension/scripts/fetch-test-images.py`. The extension's verdict agreed with the group label on **28/40**:

- **Politics:** 12 of 18 caught (people at podiums, parliament, rallies). Missed: oil paintings, charts and a ballot. 3 false positives: actors at events and an aerial hotel photo.
- **GTA VI:** 2 of 3 caught. The miss was a photoreal skyline that looks like Miami. Other GTA-style game art was hidden as well.
- **Everything else** stayed visible: landscapes, maps, animals and portraits.

In `test/custom-topic.mjs`, with user topics "Donald Tusk" and "Donald Trump": Tusk photos 3/3 and Trump photos 8/11 were caught. The model also flagged one other politician and one actor. It recognises the scene ("a politician"), not the identity.

## The extension, end to end

- **`test/e2e.mjs`** (an X feed fixture):
  - all GTA VI posts are blurred: by name, without the model, or by the model for "Lucia looks unreal in the new trailer…";
  - the blocked author and the Russian post are handled;
  - the cat post stays;
  - "Show" survives the site re-rendering the post.
- **`test/custom-topic.mjs`:** topics added through the popup. 4/4 posts about Tusk or Trump are hidden, including "The former president held a rally…", which never names him. Donald Duck, sourdough and football stay.
- **`test/live-youtube.mjs`:** live YouTube search for "gta 6 story ending". With the spoiler-only rule (before the pack became "everything GTA VI"), 21 of 32 results were blurred.
- **`test/live-curtain.mjs`:** Wikipedia "Grand Theft Auto VI" gets the curtain, and "Show page" clears everything.
- **`test/switch-model.mjs`:** switching mini → pico → mini at runtime works, with verdicts from each model.
- **`test/hf-download.mjs`:** a real first run on a fresh profile. All three models (1.6 GB) came from Hugging Face at their pinned commits, were SHA-256 verified and were ready in 18 s on a fast connection. The first decision was correct.
