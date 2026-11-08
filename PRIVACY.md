# Privacy

Nopescope works entirely on your computer.

- **No servers.** The AI models run on your GPU, through WebGPU, in an extension page. Page text and images are never sent to any server run by us or anyone else.
- **Model download.** On first run, and when you pick another model, the extension downloads the model files from Hugging Face (huggingface.co and its CDN). This is a plain file download: nothing about you or your browsing is sent, and the files are checked by SHA-256 and kept in the extension's storage. You can delete them in the settings.
- **No accounts, analytics, telemetry, ads or tracking.**
- **What the extension reads:** the text and images of the pages you visit. It needs them to check them against your rules, and the check happens on your computer.
- **Network requests:** to check an image, the extension downloads it again from the same public address the page already loaded it from. It sends no cookies or referrer, never contacts local-network or loopback addresses, and stops at 12 MB and 10 seconds.
- **What is stored, locally, in your browser profile (`chrome.storage.local`):**
  - your rules and settings;
  - daily counts of how many items each rule hid (the last 60 days);
  - feedback labels: when you press "Not …" on a hidden item, or use the right-click "should have been hidden" item, the item's text (up to 2,000 characters) and its URL are saved, so you can export them. Nothing is sent anywhere. You can delete them by removing the extension or clearing its storage.
- **Not stored:** which items you revealed with "Show". That lives in memory for the open page only.
- **Your rules stay hidden from websites.** Websites cannot read them: the extension's on-page UI lives in closed shadow DOM.

**Permissions:**

| Permission | Why |
|---|---|
| Access to all sites (content script, host permission) | to find and hide matching items on any website you choose, to download an image again for the image check, and to download the models from Hugging Face |
| `offscreen` | WebGPU needs a document: the models run in an offscreen extension page |
| `storage`, `unlimitedStorage` | rules, settings, stats and labels; the downloaded models (about 1.1 GB) in the extension's cache storage |
| `contextMenus` | the right-click "should have been hidden" feedback item |

Questions or concerns: open an issue in this repository.
