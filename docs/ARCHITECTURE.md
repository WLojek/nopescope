# Architecture

Nopescope is a Manifest V3 Chrome extension. It has four processes:

```
content script (every http(s) tab)     service worker                  offscreen document (WebGPU)
  site adapter -> items                  routes messages               BasalWeb: text model (basal-web)
  word / author / language rules         adds rules + model location    Clip: MobileCLIP-S0
  queue (nearest to the viewport)  ──▶   stats, feedback labels    ──▶  one GPU job at a time (gpuLock)
  overlay (closed shadow DOM)  ◀──────── verdicts + model output ◀────  verdict / image caches
```

- **Content script** (`src/content/`): finds items, runs the cheap rules, queues topic rules and applies the UI.
- **Service worker** (`src/background.js`):
  - keeps one offscreen document alive and passes it the rules and the model location with every request (offscreen documents only get `chrome.runtime`);
  - counts stats and stores feedback labels.
- **Offscreen document** (`src/offscreen.js`): hosts the models. WebGPU needs a document context, and the document survives the service worker's idle shutdown.
- **Options and popup** (`src/options/`, `src/popup/`): the rulebook and the toolbar popup.

## Items and site adapters

An adapter (`src/content/sites/*.js`) turns a page into items:

```js
{ el, kind: "post" | "comment" | "video" | "result" | "short" | "paragraph", text, author, authorName, url }
```

- `x.js`, `youtube.js`, `reddit.js` and `google.js` follow those sites' markup.
- `generic.js` handles every other site:
  - **Containers:** semantic posts (`article`, `role=article`, schema.org comments, reviews and postings), elements whose class or id says post, comment, story, card, entry or result, and list items with real text.
  - **Innermost wins:** a comment inside a post card becomes its own item.
  - **Paragraphs:** long paragraphs outside any container become items too.
  - **Skipped:** navigation, forms, editors and code.
  - **Reads:** `textContent` only, never layout.

## Pipeline per item

1. **Words and authors** are matched in the content script, with whole-word matching for single words.
2. **Language** comes from `chrome.i18n.detectLanguage` (CLD3, on device). Only reliable detections of 20 or more characters count.
3. **Topic rules** whose prefilter matches (or that have none) are queued. Pack rules may blur the item while the model decides (`pendingBlur`).
4. **The queue** sends batches of 6 items to the model, nearest to the viewport first and only within 2.5 screens. The rest wait for scrolling.
5. **Each topic rule** becomes one Basal `noul` question. If calibrated P(yes) is at or above the rule's threshold, the item is noped.
6. **Failures never leave a blur behind.** Requests time out after 60 s and are retried up to 3 times, and pending items are released.

## Images and video posters

- **What is checked:** `img` and `video[poster]` of 96 px or more, outside items that are already covered and outside revealed ones.
- **Alt text and captions** go through Basal like any item.
- **Pixels:** the offscreen document downloads the image itself (public `http(s)` only, no loopback or private networks, 12 MB cap, 10 s timeout). MobileCLIP-S0 then compares it with the rule's image prompts against generic "other" prompts. A softmax over these gives P(match), and the image is noped at or above `imageThreshold`.
- **Changed sources:** if a site swaps an image's source (lazy loading, recycled feed elements), the image is checked again.

## The page curtain

On generic sites, the page title plus `h1` is checked like an item. A match covers the whole page with a curtain ("This page is about …") offering Go back, Model output and Show page. In single-page apps, a new URL or title means a new decision.

## The UI and privacy

- **Closed shadow DOM:** the pill, the Model output panel and the curtain live in closed shadow roots, so page scripts cannot read which topics a user hides. The test suite opens them with `settings.debug`, which pages cannot set.
- **Hosts:** `<nope-cover>` (an absolute cover, no layout shift) or `<nope-bar>` (before elements that render through their own shadow root, such as Reddit's custom elements).
- **Revealed items** are remembered in memory by their text and link, so a site re-rendering a post does not blur it again.
- **Our own DOM changes** do not trigger rescans.

## The local models

- **One GPU job at a time:** both models share one onnxruntime-web instance, which is not re-entrant. All `session.run` calls go through `gpuLock`, which has a 30 s watchdog. Corrupted wasm memory or a lost device reloads the offscreen document, and the models load again in a few seconds.
- **Model files** (`src/shared/models.js`, `src/model-store.js`): each model is a Hugging Face repo pinned to a commit, with the size and SHA-256 of every file.
  - On first use, the offscreen document streams each file, checks its size and SHA-256, and only then stores it in Cache Storage. A mismatch is refused, and failed downloads are retried.
  - While a model is downloading or loading, classify requests answer `notReady` at once, so pages stay visible instead of waiting on a blur.
  - The settings show progress and can delete downloaded models.
- **Caches:** verdicts are cached by question and text (8,000 entries), and image embeddings by URL (3,000).

## Storage (`chrome.storage.local`)

| Key | Value |
|---|---|
| `rules` | `Rule[]`; the schema is at the top of `src/shared/rules.js` |
| `settings` | `{ enabled, scope: {mode: "all" \| "only" \| "except", hosts}, textModel, modelUrls }` |
| `stats` | `{ "YYYY-MM-DD": { ruleId: count } }`, kept for 60 days |
| `labels` | `[{ text, ruleId, label: "false_positive" \| "missed", url, ts }]`, capped at 5,000 |

## Messages (`chrome.runtime`)

| Type | From → to | Payload → response |
|---|---|---|
| `nope:classify` | content → SW → offscreen | `{items, ruleIds}` → `{verdicts: [{id, action, ruleId, label, score, detail}]}` |
| `nope:classifyMedia` | content → SW → offscreen | `{items: [{id, src, context, site}]}` → `{verdicts}` |
| `nope:status` / `nope:loadModel` | UI → SW → offscreen | → `{state, progress, model, msPerDecision, error, errors}` |
| `nope:stat` | content → SW | `{ruleId}` |
| `nope:feedback` | content → SW | `{text, ruleId, label, url}` |

All listeners check `sender.id === chrome.runtime.id`. The extension declares no `externally_connectable`.
