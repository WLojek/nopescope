// Downloads models from Hugging Face, pinned to a commit, verifies every file's SHA-256, and keeps them in
// Cache Storage (inside the extension, persistent with `unlimitedStorage`). Used by the offscreen document.
import { MODEL_FILES, fileUrl, modelBytes } from "./shared/models.js";

const CACHE = "nopescope-models-v1";
const RETRIES = 3;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export class ModelStore {
  /** @param {{devBase?: string}} o  devBase (tests only): fetch "<devBase>/<id>/<file>" instead of the Hub */
  constructor({ devBase = null } = {}) {
    this.devBase = devBase;
    this.jobs = new Map(); // id -> Promise (download in flight)
    this.progress = {};    // id -> {state, loaded, total, error}
  }

  url(id, file) {
    return this.devBase ? `${this.devBase}/${id}/${file}` : fileUrl(id, file);
  }

  // cache key: always the pinned Hub URL, so a dev download and a Hub download are the same entry
  key(id, file) { return fileUrl(id, file); }

  async has(id) {
    const m = MODEL_FILES[id];
    if (!m) return false;
    const cache = await caches.open(CACHE);
    for (const f of Object.keys(m.files)) if (!(await cache.match(this.key(id, f)))) return false;
    return true;
  }

  async remove(id) {
    const cache = await caches.open(CACHE);
    for (const f of Object.keys(MODEL_FILES[id]?.files || {})) await cache.delete(this.key(id, f));
    this.progress[id] = { state: "none", loaded: 0, total: modelBytes(id) };
  }

  /** Download (if needed) and verify all files of a model. Concurrent calls share one download. */
  ensure(id) {
    if (this.jobs.has(id)) return this.jobs.get(id);
    const job = this._ensure(id).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
    return job;
  }

  async _ensure(id) {
    const m = MODEL_FILES[id];
    if (!m) throw new Error(`unknown model ${id}`);
    if (!this.devBase && /PENDING/.test(m.revision)) throw new Error(`${id} is not published yet`);
    const cache = await caches.open(CACHE);
    const total = modelBytes(id);
    const p = (this.progress[id] = { state: "downloading", loaded: 0, total, error: null });
    try {
      for (const [file, meta] of Object.entries(m.files)) {
        const key = this.key(id, file);
        if (await cache.match(key)) { p.loaded += meta.size; continue; }
        const base = p.loaded;
        let buf = null;
        for (let attempt = 1; !buf; attempt++) {
          try {
            buf = await this.download(this.url(id, file), meta, (n) => { p.loaded = base + n; });
          } catch (e) {
            if (attempt >= RETRIES) throw e;
            p.loaded = base;
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
        p.state = "verifying";
        const digest = hex(await crypto.subtle.digest("SHA-256", buf));
        if (digest !== meta.sha256) throw new Error(`${file}: checksum mismatch, refusing to use it`);
        await cache.put(key, new Response(buf, { headers: { "content-length": String(buf.byteLength) } }));
        p.state = "downloading";
        p.loaded = base + meta.size;
      }
      p.state = "ready";
      p.loaded = total;
    } catch (e) {
      p.state = "error";
      p.error = String(e?.message || e);
      throw e;
    }
  }

  async download(url, meta, onBytes) {
    const res = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    const out = new Uint8Array(meta.size);
    const reader = res.body.getReader();
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > meta.size) { reader.cancel().catch(() => {}); throw new Error(`${url}: larger than expected`); }
      out.set(value, n);
      n += value.length;
      onBytes(n);
    }
    if (n !== meta.size) throw new Error(`${url}: got ${n} of ${meta.size} bytes`);
    return out.buffer;
  }

  /** fetch()-like access to a verified file: "hf:<id>/<file>" */
  async fetch(url) {
    const m = /^hf:([^/]+)\/(.+)$/.exec(url);
    if (!m) return fetch(url);
    const [, id, file] = m;
    const hit = await (await caches.open(CACHE)).match(this.key(id, file));
    return hit || new Response(null, { status: 404, statusText: "not downloaded" });
  }

  async summary() {
    const out = {};
    for (const id of Object.keys(MODEL_FILES)) {
      const p = this.progress[id];
      const ready = await this.has(id);
      out[id] = { state: ready ? "ready" : p?.state === "error" ? "error" : this.jobs.has(id) ? p.state : "none",
        loaded: ready ? modelBytes(id) : p?.loaded || 0, total: modelBytes(id), error: p?.error || null };
    }
    return out;
  }
}
