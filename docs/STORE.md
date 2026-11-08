# Chrome Web Store listing

**Name:** Nopescope

**Summary** (132 characters at most):
Say nope to topics, people and languages on any website. A local AI model hides them before you see them.

**Category:** Productivity (alternative: Social & Communication)

## Description

Nopescope gives you one set of rules for the whole web. Tell it what you don't want to see, and it hides matching posts, comments, paragraphs, images and video thumbnails on every site, before you read them.

- **Topics in plain words, in any language:** "Donald Trump", "crypto", "GTA VI". A small AI model decides these on your own computer.
- **Words, people and channels, or whole languages.**
- **Choose where each rule applies:** all sites, only some, or all sites except some.
- **Dedicated support for X, YouTube, Reddit and Google.** Automatic detection everywhere else.
- **Whole pages about a topic get a curtain.**
- **See why something was hidden:** every hidden item has a "?" button that shows the model's decision.
- **Launch pack: GTA VI.** It hides everything about the game until you're ready.

**Private by design:** the AI models are part of the extension and run on your GPU. There are no servers, accounts, tracking or API calls. Nothing you browse leaves your computer.

**Open source** (Apache-2.0). It uses Basal decision models by Remigiusz Kinas and Apple's MobileCLIP.

**Requirements:** Chrome 124+, and WebGPU for topic rules.

## Single purpose

Hide content the user chose not to see, on the websites they choose, using rules evaluated locally.

## Permission justifications

| Permission | Justification |
|---|---|
| Host permission `<all_urls>` and a content script on all http(s) pages | The user's rules can apply on any website, and the user picks which ones. The content script reads page text to check it against the rules and hides matches. The host permission lets the extension download an image again to check it locally, and download the model files from Hugging Face. |
| `offscreen` | The local AI models need WebGPU, which requires a document. They run in an offscreen extension page that stays alive across service worker restarts. |
| `storage` | Rules, settings, per-day counts and the user's own feedback labels. |
| `unlimitedStorage` | The local AI models (about 1.1 GB) are downloaded once from Hugging Face and kept in the extension's cache storage. |
| `contextMenus` | A right-click "this should have been hidden" item for feedback. |

**Remote code:** none. All code, including the onnxruntime-web wasm, is in the package. The models downloaded from Hugging Face are data (ONNX weights), pinned to a commit and verified by SHA-256 before use.

## Data usage disclosure

- Website content is processed locally to apply the user's rules. It is not collected and not transmitted.
- No personally identifiable information, health, financial, authentication, location, communication or activity data is collected or transmitted.
- Not sold, not used for anything unrelated, and not used for creditworthiness.

## Assets

| Asset | Source |
|---|---|
| Screenshots | `docs/img/feed.png`, `model-output.png`, `images.jpg`, `curtain.jpg`, `settings.jpg`, `models.jpg` |
| Icon | `extension/static/icons/128.png` |

## Package size

About 30 MB. The models (about 1.1 GB) download on first run.
