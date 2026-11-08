"""Write basal-web.json (graph I/O, family, special tokens, int4 correction) next to an exported model and copy
the files the browser runtime needs. Usage: write_meta.py <basal model dir> <onnx build dir> <out dir>"""
import json, shutil, sys
from pathlib import Path
import onnx

src, build, out = map(Path, sys.argv[1:4])
out.mkdir(parents=True, exist_ok=True)
m = onnx.load(build / "model.onnx", load_external_data=False)
T = {1: "float32", 10: "float16", 7: "int64", 6: "int32"}
cfg = json.loads((src / "config.json").read_text())
fam = cfg.get("model_type")
dims = {"batch_size": 1, "past_sequence_length": 0}
past = []
for i in m.graph.input:
    if i.name in ("input_ids", "attention_mask", "position_ids"):
        continue
    shape = []
    for d in i.type.tensor_type.shape.dim:
        if d.dim_param:
            if d.dim_param == "kv_cache_dim":
                shape.append(cfg.get("head_dim") or cfg["hidden_size"] // cfg["num_attention_heads"])
            else:
                shape.append(dims[d.dim_param])
        else:
            shape.append(d.dim_value)
    past.append({"name": i.name, "type": T[i.type.tensor_type.elem_type], "shape": shape})
tc = json.loads((src / "tokenizer.json").read_text())
special = sorted({t["content"] for t in tc.get("added_tokens", []) if t.get("special") and len(t["content"]) > 1 and t["content"].strip()})
meta = {
    "name": json.loads((src / "basal.json").read_text())["name"],
    "format": 2,
    "family": fam,
    "max_tokens": min(cfg.get("max_position_embeddings", 8192), 2048),
    "outputs": [o.name for o in m.graph.output],
    "past": past,
    "special_tokens": special,
}
corr = json.loads((Path(__file__).resolve().parents[1] / "corrections.json").read_text()).get(meta["name"])
if corr:
    meta["correction"] = corr  # int4 -> fp32 yes/no logit correction (see corrections.json, fit_correction.py)
(out / "basal-web.json").write_text(json.dumps(meta, indent=1))
for f in ["tokenizer.json", "tokenizer_config.json", "CALIBRATION.json", "basal.json"]:
    shutil.copy(src / f, out / f)
for f in ["model.onnx", "model.onnx.data"]:
    dst = out / f
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    shutil.copy(build / f, dst)
print(json.dumps({k: v for k, v in meta.items() if k not in ("special_tokens", "past")}, indent=1), len(past), "past inputs")
