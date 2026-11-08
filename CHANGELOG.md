# Changelog

## 0.1.0 (2026-11-09)

The first public release.

- **Rules:** one rulebook for the whole web. Topics in plain words (decided by a local model), words, people and channels, and languages.
- **Scope:** all sites, only these sites, or all sites except these, both globally and per rule. Quick add from the popup: "everywhere" or "only on this site".
- **Sites:** dedicated detection for X, YouTube, Reddit and Google Search, and automatic detection on every other website. The page curtain covers pages that are about a topic.
- **Images and video thumbnails:** MobileCLIP-S0 (zero-shot) plus alt text and captions.
- **Model output:** a "?" button on every hidden item and on the curtain shows the model's decision.
- **Text models:** Basal 2.0 mini (default) and Basal pico, switchable, running in the browser with basal-web (ONNX int4, WebGPU).
- **Model download:** the models download once from Hugging Face, pinned to a commit and checked by SHA-256. The extension package is about 30 MB.
- **Packs:** GTA VI (everything about the game), No politics, Less doom.
