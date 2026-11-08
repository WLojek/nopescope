"""Write expected outputs (prompt, input_ids, code_ids, raw fp32 probabilities, calibrated answer) for the
browser runtime tests. Cases: noul/choice requests from rkinas/basal docs/format2_vectors.jsonl plus our own
GTA VI spoiler / topic cases."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from basal_ref import Basal

model_dir, out_path = sys.argv[1], sys.argv[2]
vectors = Path(__file__).resolve().parents[1] / "test" / "format2_vectors.jsonl"  # from rkinas/basal docs/ (Apache-2.0)

cases = []
for line in vectors.read_text().splitlines():
    v = json.loads(line)
    req = v["request"]
    if v.get("orders", 1) != 1:
        continue
    for name, q in req["questions"].items():
        t = q.get("type", "choice")
        if t not in ("noul", "choice") or q.get("option_keys") == "hide":
            continue
        if not isinstance(req["state"], str) or not isinstance(q.get("instructions", ""), str):
            continue
        crit = q.get("criteria")
        if t == "choice" and not (isinstance(crit, list) or (isinstance(crit, dict) and all(isinstance(x, (str, type(None))) for x in crit.values()))):
            continue
        if len(req["state"]) > 3000:
            continue
        cases.append({"id": f"{v['id']}/{name}", "state": req["state"], "question": q})

GTA_Q = {"type": "noul", "instructions": "Does this text reveal story or plot details of the game GTA VI (missions, twists, character deaths, the ending)?"}
POL_Q = {"type": "noul", "instructions": "Is this text about politics (politicians, elections, parties, government)?"}
own = [
    ("Jason finally betrays Lucia in the last mission and the game ends with her in prison.", GTA_Q),
    ("Just preordered GTA VI, can't wait for November 19!", GTA_Q),
    ("The new GTA VI trailer shows Vice City at night, looks gorgeous.", GTA_Q),
    ("SPOILER: the guy you meet in the first mission is actually the FIB agent who sets you up at the end.", GTA_Q),
    ("Kurde, w finale GTA VI Lucia ginie, nie spodziewałem się tego.", GTA_Q),
    ("Ile GB zajmuje GTA VI na PS5?", GTA_Q),
    ("The Senate passed the budget bill after a late-night vote.", POL_Q),
    ("My sourdough finally has a good rise, 75% hydration did it.", POL_Q),
    ("Premier zapowiedział nowe podatki od przyszłego roku.", POL_Q),
    ("Mecz Legii z Lechem skończył się remisem 1:1.", POL_Q),
    ("Which genre is this post?\nNew Rockstar game drops next week, 4K screenshots inside.",
     {"type": "choice", "instructions": "What is the main topic?", "criteria": {"games": "video games", "politics": None, "sport": "sports", "food": None}}),
]
for i, (s, q) in enumerate(own):
    cases.append({"id": f"own-{i}", "state": s, "question": q})

b = Basal(model_dir)
out = []
for c in cases:
    ans, prompt, ids, cids = b.ask(c["state"], c["question"])
    out.append({**c, "prompt": prompt, "input_ids": ids, "code_ids": cids, "expected": ans})
    print(c["id"], len(ids), {k: round(v, 4) for k, v in ans["probabilities"].items()})
Path(out_path).write_text(json.dumps({"model": Path(model_dir).name, "calibration": b.cal, "cases": out}, ensure_ascii=False))
print("cases:", len(out))
