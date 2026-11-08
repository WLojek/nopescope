"""Fit a label-free correction so the int4 browser model's yes/no logit matches the fp32 reference:
logit_ref ~ a * logit_int4 + b. Writes {"correction": {"a", "b"}} into basal-web.json.
Usage: fit_correction.py <basal model dir> <web model dir> <question> <dump.json> [<question2> <dump2.json> ...]"""
import json, math, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "reference"))
from basal_ref import Basal
src, web = sys.argv[1], Path(sys.argv[2])
pairs = sys.argv[3:]
b = Basal(src)
X, Y = [], []
for q, dump in zip(pairs[0::2], pairs[1::2]):
    for r in json.load(open(dump)):
        a, *_ = b.ask(r["text"], {"type": "noul", "instructions": q})
        lg = lambda p: math.log(max(p, 1e-6) / max(1 - p, 1e-6))
        X.append(lg(r["raw"])); Y.append(lg(a["raw"][0]))
X, Y = np.array(X), np.array(Y)
A = np.vstack([X, np.ones_like(X)]).T
a, c = np.linalg.lstsq(A, Y, rcond=None)[0]
pred = a * X + c
print(f"n={len(X)} a={a:.4f} b={c:.4f} mean|dlogit| before={np.mean(np.abs(X - Y)):.3f} after={np.mean(np.abs(pred - Y)):.3f}")
meta = json.loads((web / "basal-web.json").read_text())
meta["correction"] = {"a": round(float(a), 5), "b": round(float(c), 5), "n": int(len(X)), "note": "int4 -> fp32 reference, yes/no logit"}
(web / "basal-web.json").write_text(json.dumps(meta, indent=1))
