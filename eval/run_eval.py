"""Score an eval JSONL with a basal model (reference implementation, fp32) and report precision/recall per threshold.
Usage: run_eval.py <model dir> <eval.jsonl> <question> [out.json]"""
import json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "basal-web" / "reference"))
from basal_ref import Basal

model_dir, path, question = sys.argv[1:4]
out = sys.argv[4] if len(sys.argv) > 4 else None
rows = [json.loads(l) for l in Path(path).read_text().splitlines() if l.strip()]
b = Basal(model_dir)
t0 = time.time()
for r in rows:
    a, *_ = b.ask(r["text"], {"type": "noul", "instructions": question})
    r["p"] = a["noul"]
dt = (time.time() - t0) / len(rows)


def auc(rows):
    pos = [r["p"] for r in rows if r["label"] == 1]
    neg = [r["p"] for r in rows if r["label"] == 0]
    s = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return s / (len(pos) * len(neg)) if pos and neg else float("nan")


def prf(rows, t):
    tp = sum(r["p"] >= t and r["label"] == 1 for r in rows)
    fp = sum(r["p"] >= t and r["label"] == 0 for r in rows)
    fn = sum(r["p"] < t and r["label"] == 1 for r in rows)
    pr = tp / (tp + fp) if tp + fp else 1.0
    rc = tp / (tp + fn) if tp + fn else 1.0
    return pr, rc, fp, fn


print(f"{Path(model_dir).name} on {Path(path).name}: n={len(rows)} auc={auc(rows):.3f} {1000*dt:.0f} ms/item")
for lang in sorted({r.get("lang", "en") for r in rows}):
    sub = [r for r in rows if r.get("lang", "en") == lang]
    print(f"  {lang}: n={len(sub)} auc={auc(sub):.3f}")
for t in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
    pr, rc, fp, fn = prf(rows, t)
    print(f"  t={t:.1f} precision={pr:.3f} recall={rc:.3f} fp={fp} fn={fn}")
worst = sorted(rows, key=lambda r: -abs(r["p"] - r["label"]))[:12]
print("worst:")
for r in worst:
    print(f"  p={r['p']:.2f} label={r['label']} [{r.get('lang')}] {r['text'][:110]!r} {r.get('note', '')}")
if out:
    Path(out).write_text(json.dumps(rows, ensure_ascii=False, indent=0))
