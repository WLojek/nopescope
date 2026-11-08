// The models Nopescope downloads from Hugging Face on first use. Each one is pinned to an exact commit
// (`revision`), and every file is checked against its SHA-256 before it is used or cached. A changed file on
// the Hub can never reach the user.
//
// The Basal builds are ONNX int4 conversions of Remigiusz Kinas' models (Apache-2.0), made with
// basal-web/scripts/export.py. MobileCLIP-S0 is Xenova's ONNX conversion of Apple's model; it is downloaded
// as is, not redistributed by Nopescope.

export const MODEL_FILES = {
  "basal-2.0-mini": {
    repo: "WLojek/basal-2.0-mini-onnx-web",
    revision: "5bf9d55887248a50d31480ca2a63638c467deb71",
    files: {
      "basal-web.json": { size: 9157, sha256: "c3cf65350db393cd403ca47c6c8a83da3da4033fdc4a6fba1e8c172283f30195" },
      "basal.json": { size: 373, sha256: "e179b384718a094efbd020b1461da81e8407d4f8f45f705c93b083fe0fb94286" },
      "CALIBRATION.json": { size: 3541, sha256: "971cea10874d2961ce6aa5c78dfa3405ce49b609f5b71e9be82ec78bc73e323e" },
      "tokenizer.json": { size: 3705408, sha256: "20f059c5ba108cc6e4d59df55be30e73c30b86ff7aab314362bfa4eff1e21657" },
      "tokenizer_config.json": { size: 658, sha256: "61e5f4523187519f1c2391b85ce7b4830e76b24851d5458ba959d153163ce404" },
      "model.onnx": { size: 302733, sha256: "1d88cf1d69199647ede6558a91149f120a6293fb04484b0c9c80130627d7230f" },
      "model.onnx.data": { size: 971992064, sha256: "8f896e5127debba45367cc2a287e2431516c6322f6e7d61631fc140f05741346" },
    },
  },
  pico: {
    repo: "WLojek/basal-omni-pico-onnx-web",
    revision: "d56e7c343c14c2ec8b345a87625a55f389a56752",
    files: {
      "basal-web.json": { size: 7006, sha256: "757d04d450a902674df1972ca7c7343e7950fdc31490e135047f1da06be15d92" },
      "basal.json": { size: 374, sha256: "baf2997becf0d08f589a479d8aef1a2654f09ae8687f0aafd7f1fc83b4e65cf8" },
      "CALIBRATION.json": { size: 5672, sha256: "37271567a03f819ea9529cf5930880ece5b6f03b858847cc3eeb6dc38792544b" },
      "tokenizer.json": { size: 19989493, sha256: "b6d27c11283798debbfbcb1bd3bbdbcebac6c9b20d0be0c5b79231c97de97501" },
      "tokenizer_config.json": { size: 1127, sha256: "171ecbe7ddae98d11840698f7df2b8d5b4722139db0f0620d3bbf429bd656250" },
      "model.onnx": { size: 314950, sha256: "677560614d70270ce055b902f248fd239fbea04a97b0ac72fa029510b8c30c22" },
      "model.onnx.data": { size: 492116736, sha256: "cef96ff5af062a4cba9495813ab11c6ea382aebd5d9524fab661d9a81416a106" },
    },
  },
  "mobileclip-s0": {
    repo: "Xenova/mobileclip_s0",
    revision: "757d59c9c6870a76a4b0306f05f5061bca15c39f",
    files: {
      "tokenizer.json": { size: 2224081, sha256: "72ed5c96db5729294468543e4bc75fce14ca63f58e37300290189ba1c1e52b85" },
      "tokenizer_config.json": { size: 763, sha256: "a7d9d24f248071b792e4a3b56ab0539c2f40eec8da56d6fd91fb3a50058acebd" },
      "onnx/vision_model_fp16.onnx": { size: 22876479, sha256: "22b1d36ecc6837e8205aee05003440a25e1c1ee0c7e2945dbb9dd597211c59dc" },
      "onnx/text_model_fp16.onnx": { size: 84971030, sha256: "2f74b7b3abd9f3a70dcc60115f627bbadb9534606ac841400f9841f49bf980cc" },
    },
  },
};

export function modelBytes(id) {
  return Object.values(MODEL_FILES[id]?.files || {}).reduce((a, f) => a + f.size, 0);
}

export function fileUrl(id, file) {
  const m = MODEL_FILES[id];
  return `https://huggingface.co/${m.repo}/resolve/${m.revision}/${file}`;
}
