// Shared test helpers: serve the exported models locally (instead of downloading them from Hugging Face on
// every run) and the extension settings that point at that server.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MODELS_WEB = process.env.MODELS_WEB || path.resolve("../models-web");

/** Serves <MODELS_WEB>/<model id>/<file> (ids as in src/shared/models.js). Resolves to {server, base}. */
export async function serveModels() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    const file = path.join(MODELS_WEB, rel);
    if (!file.startsWith(MODELS_WEB)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (e, st) => {
      if (e || !st.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-length": st.size, "access-control-allow-origin": "*" });
      fs.createReadStream(file).pipe(res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** Settings for tests: open shadow roots, local test images allowed, models from the local server. */
export const testSettings = (devModelBase, extra = {}) => ({
  enabled: true, scope: { mode: "all", hosts: [] }, textModel: "basal-2.0-mini", debug: true, devModelBase, ...extra,
});

/** Wait until the offscreen document reports the text model ready (and optionally the image model). */
export async function waitForModels(page, { images = false, timeout = 180000, model = null } = {}) {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate((images) => new Promise((r) => chrome.runtime.sendMessage({ type: "nope:loadModel", withImages: images }, r)), images);
    const imgReady = !images || st?.downloads?.["mobileclip-s0"]?.state === "ready";
    if (st?.state === "ready" && imgReady && (!model || st.model === model)) return st;
    if (st?.state === "error" || st?.state === "nogpu") throw new Error(`model: ${st.state} ${st.error}`);
    if (Date.now() - t0 > timeout) throw new Error(`model not ready after ${timeout} ms: ${JSON.stringify(st).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
