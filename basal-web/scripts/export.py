"""Export a basal model (or the MobileCLIP image model) for the browser, in one command.

  python basal-web/scripts/export.py Remek/basal-omni-pico models-web/basal-omni-pico
  python basal-web/scripts/export.py Remek/basal-2.0-mini  models-web/basal-2.0-mini
  python basal-web/scripts/export.py Xenova/mobileclip_s0  models-web/mobileclip_s0

Text models: downloads the Hugging Face weights, builds ONNX int4 for WebGPU with the onnxruntime-genai model
builder, then writes basal-web.json (graph I/O + the int4 correction from corrections.json) and copies the
tokenizer and calibration files. Needs: torch, transformers==5.17.0, onnx, onnxruntime-genai>=0.19, huggingface_hub.
"""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path
from huggingface_hub import snapshot_download

HERE = Path(__file__).resolve().parent
repo, out = sys.argv[1], Path(sys.argv[2]).resolve()
work = Path(tempfile.mkdtemp(prefix="basal-web-export-"))

if repo == "Xenova/mobileclip_s0":
    src = Path(snapshot_download(repo, local_dir=work / "src", allow_patterns=["*.json", "onnx/vision_model_fp16.onnx", "onnx/text_model_fp16.onnx"]))
    shutil.copytree(src, out, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".cache"))
    print("MobileCLIP-S0 (fp16) ->", out)
    sys.exit(0)

src = Path(snapshot_download(repo, local_dir=work / "src", allow_patterns=["*.json", "*.safetensors", "*.jinja"]))
cfg = json.loads((src / "config.json").read_text())
builder_in = src
extra = ["prune_lm_head=true"]
if cfg.get("architectures", [""])[0] == "Qwen3_5ForCausalLM":
    # the builder knows Qwen3.5 as Qwen3_5ForConditionalGeneration: wrap the text config, drop the MTP head
    builder_in = work / "wrapped"
    builder_in.mkdir()
    for f in src.iterdir():
        if f.name != "config.json" and f.is_file():
            (builder_in / f.name).symlink_to(f)
    wrapped = {"architectures": ["Qwen3_5ForConditionalGeneration"], "model_type": "qwen3_5",
               "text_config": dict(cfg, model_type="qwen3_5_text"), "tie_word_embeddings": cfg.get("tie_word_embeddings", True),
               "transformers_version": cfg.get("transformers_version")}
    (builder_in / "config.json").write_text(json.dumps(wrapped))
    extra.append("exclude_mtp=true")

onnx_dir = work / "onnx"
subprocess.run([sys.executable, "-m", "onnxruntime_genai.models.builder", "-i", str(builder_in), "-o", str(onnx_dir),
                "-p", "int4", "-e", "webgpu", "-c", str(work / "cache"), "--extra_options", *extra], check=True)
subprocess.run([sys.executable, str(HERE / "write_meta.py"), str(src), str(onnx_dir), str(out)], check=True)
shutil.rmtree(work, ignore_errors=True)
print(repo, "->", out)
