# Eval sets

| File | Items | Labels | Notes |
|---|---|---|---|
| `gta6_spoilers.jsonl` | 260 (200 en, 60 pl) | 1 = reveals GTA VI story or plot details | Synthetic. The game is not out, so the "spoilers" are invented. Many hard negatives. |
| `politics.jsonl` | 120 (80 en, 40 pl) | 1 = about politics | Synthetic. Hard negatives: office politics, school elections, sport, economy. |

Each line is `{"text", "label", "lang", "source", "note"}`. The items were written by a model, labelled at the same time and spot-checked by hand.

`run_eval.py` scores a set with the fp32 reference implementation:

```bash
python eval/run_eval.py models/basal-2.0-mini eval/politics.jsonl "Is this text about politics (politicians, elections, parties, government)?"
```

For the browser int4 builds use `basal-web/test/eval-browser.mjs`. Results are in [docs/EVAL.md](../docs/EVAL.md).
