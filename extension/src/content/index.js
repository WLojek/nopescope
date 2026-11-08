// Content core: finds items with the site adapter, runs cheap rules here, sends topic rules to the local model
// (offscreen document, via the service worker) and applies the overlay. Also handles images, video posters and the
// page curtain.
import { pickAdapter } from "./sites/index.js";
import { containsAny, firstMatch, matchAuthor, matchLanguage, modelRulesFor, ruleAppliesToSite, labelFor, siteEnabled, normHost, DEFAULT_SETTINGS } from "../shared/rules.js";
import * as overlay from "./overlay.js";

const adapter = pickAdapter(location);
const HOST = normHost(location.hostname);
const MAX_TEXT = 1500;          // characters of an item the model reads
const BATCH = 6;                // items per classify request
const MEDIA_BATCH = 4;
const AHEAD = 2.5;              // classify only items within this many screens of the viewport
const MEDIA_MIN = 96;           // px; smaller images are icons and avatars
const REQUEST_TIMEOUT = 60000;  // ms; the first request may wait for the model to load
const MAX_RETRIES = 3;

let rules = [];
let settings = DEFAULT_SETTINGS;
let nextId = 1;
let nextMid = 1;
const items = new Map();        // id -> {el, item, sig, retries, modelRuleIds}
const media = new Map();        // mid -> {el, src, context, retries}
const queue = [];               // item ids waiting for the model
const mediaQueue = [];          // media ids waiting for the model
let inflight = false;
let mediaInflight = false;
let modelDownUntil = 0;         // after a model failure, topic rules pause briefly instead of blurring forever
let pageRevealed = false;       // the user chose "Show page" on a curtained page

// What the user chose to show stays shown, also when the site re-renders the element (X, YouTube and Reddit
// rebuild posts while you scroll). Keyed by the item's own text + link. Kept in memory only: page scripts must
// not be able to read or tamper with it.
const revealed = new Set();
const revealedMedia = new Set();
const counted = new Set();      // stats count each hidden item once per page
const itemKey = (item) => `${item.text.slice(0, 300)}|${item.url || ""}`;
function remember(set, key) {
  set.add(key);
  if (set.size > 2000) set.delete(set.values().next().value);
}

// A cheap fingerprint of an element's content, to notice when a site reuses the element for another post.
// (The pill lives in a shadow root, so it does not change the element's textContent.)
const sigOf = (el) => { const t = el.textContent || ""; return `${t.slice(0, 160)}|${t.length}`; };

const active = () => adapter && siteEnabled(settings, HOST);
const modelDown = () => Date.now() < modelDownUntil;

async function loadState() {
  const got = await chrome.storage.local.get(["rules", "settings"]);
  rules = Array.isArray(got.rules) ? got.rules : [];
  settings = { ...DEFAULT_SETTINGS, ...(got.settings || {}) };
  overlay.setDebug(!!settings.debug);
}

function send(msg) {
  return Promise.race([
    chrome.runtime.sendMessage(msg),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), REQUEST_TIMEOUT)),
  ]);
}

function detectLanguage(text) {
  return new Promise((resolve) => {
    try {
      chrome.i18n.detectLanguage(text, (r) => {
        const top = r?.languages?.[0];
        resolve(top ? { code: top.language.split("-")[0], reliable: !!r.isReliable && top.percentage >= 60, percentage: top.percentage } : null);
      });
    } catch { resolve(null); }
  });
}

function stat(ruleId, key) {
  if (!ruleId || counted.has(key)) return;
  remember(counted, key);
  chrome.runtime.sendMessage({ type: "nope:stat", ruleId }).catch(() => {});
}

function viewportDistance(el) {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0) return -r.bottom + 1e5; // above the viewport: low priority
  if (r.top > innerHeight) return r.top - innerHeight;
  return 0;
}

// ---------------------------------------------------------------- items
function applyVerdict(id, verdict) {
  const rec = items.get(id);
  if (!rec || !rec.el.isConnected || pageRevealed) return;
  const key = itemKey(rec.item);
  if (verdict.action === "show" || revealed.has(key)) {
    if (rec.el.getAttribute("data-nope-state") !== "revealed") overlay.clear(rec.el);
    return;
  }
  const reveal = () => {
    remember(revealed, key);
    // images inside a post the user opened belong to that post: keep them visible too
    for (const m of rec.el.querySelectorAll("img[data-nope-mid], video[data-nope-mid]")) {
      overlay.clearMedia(m);
      m.setAttribute("data-nope-state", "revealed");
    }
  };
  overlay.apply(rec.el, verdict, {
    onShow: reveal,
    onWrong: () => {
      reveal();
      chrome.runtime.sendMessage({ type: "nope:feedback", text: rec.item.text, ruleId: verdict.ruleId, label: "false_positive", url: rec.item.url || location.href }).catch(() => {});
    },
  });
  stat(verdict.ruleId, key);
}

async function evaluate(id) {
  const rec = items.get(id);
  if (!rec) return;
  const { item, el } = rec;
  const mine = rules.filter((r) => ruleAppliesToSite(r, HOST));
  const text = item.text.toLowerCase();
  for (const r of mine) {
    if (r.kind === "keyword") {
      const m = firstMatch(text, r.keywords);
      if (m) return applyVerdict(id, { id, action: r.action || "blur", ruleId: r.id, label: labelFor(r),
        detail: { kind: "keyword", model: "none (word match, no AI)", rule: r.name || labelFor(r), ruleId: r.id, matched: m, input: item.text.slice(0, 800) } });
    }
    if (r.kind === "author" && matchAuthor(r, item)) {
      return applyVerdict(id, { id, action: r.action || "blur", ruleId: r.id, label: labelFor(r),
        detail: { kind: "author", model: "none (author match, no AI)", rule: r.name || labelFor(r), ruleId: r.id, author: item.author || item.authorName, list: r.authors } });
    }
  }
  const langRules = mine.filter((r) => r.kind === "language");
  if (langRules.length && item.text.length >= 20) {
    const lang = await detectLanguage(item.text);
    const hit = langRules.find((r) => matchLanguage(r, lang));
    if (hit) return applyVerdict(id, { id, action: hit.action || "blur", ruleId: hit.id, label: labelFor(hit),
      detail: { kind: "language", model: "Chrome language detector (CLD3, local)", rule: hit.name || labelFor(hit), ruleId: hit.id, detected: lang.code, reliable: lang.reliable, percentage: lang.percentage, mode: hit.languageMode || "block", list: hit.languages, input: item.text.slice(0, 800) } });
  }
  const model = modelRulesFor(mine, HOST, text);
  if (!model.length || modelDown()) { if (el.getAttribute("data-nope-state") === "pending") overlay.clear(el); return; }
  if (model.some((r) => r.pendingBlur)) overlay.markPending(el);
  rec.modelRuleIds = model.map((r) => r.id);
  queue.push(id);
  pump();
}

function unpend(ids, table) {
  for (const id of ids) { const rec = table.get(id); if (rec?.el.getAttribute("data-nope-state") === "pending") overlay.clear(rec.el); }
}

/** Take the next batch: connected items within AHEAD screens, nearest first. The rest stay queued for scrolling. */
function nextBatch(q, table, size) {
  const live = q.splice(0).filter((id) => table.get(id)?.el.isConnected);
  const dist = new Map(live.map((id) => [id, viewportDistance(table.get(id).el)]));
  live.sort((a, b) => dist.get(a) - dist.get(b));
  const batch = live.filter((id) => dist.get(id) <= AHEAD * innerHeight).slice(0, size);
  q.push(...live.filter((id) => !batch.includes(id)));
  return batch;
}

// The model is still downloading or loading: show the items meanwhile, and check them again shortly.
function waitForModel(batch, q, table, again) {
  unpend(batch, table);
  q.push(...batch);
  modelDownUntil = Date.now() + 4000;
  setTimeout(again, 4100);
}

const hasNear = (q, table) => q.some((id) => { const r = table.get(id); return r?.el.isConnected && viewportDistance(r.el) <= AHEAD * innerHeight; });

async function pump() {
  if (inflight || !queue.length || modelDown()) return;
  inflight = true;
  let batch = [];
  try {
    batch = nextBatch(queue, items, BATCH);
    if (!batch.length) return;
    const ruleIds = [...new Set(batch.flatMap((id) => items.get(id).modelRuleIds || []))];
    const res = await send({
      type: "nope:classify",
      ruleIds,
      items: batch.map((id) => ({ id, text: items.get(id).item.text, kind: items.get(id).item.kind, site: HOST })),
    });
    if (res?.notReady) { waitForModel(batch, queue, items, pump); return; }
    if (!res?.verdicts) throw new Error(res?.error || "no verdicts");
    for (const v of res.verdicts) applyVerdict(v.id, v);
  } catch {
    // service worker restarted, extension reloaded, model failed or timed out: never leave items blurred
    // without a way out. Retry a few times, then let them through.
    unpend(batch, items);
    for (const id of batch) {
      const rec = items.get(id);
      if (rec && (rec.retries = (rec.retries || 0) + 1) <= MAX_RETRIES) queue.push(id);
    }
    modelDownUntil = Date.now() + 5000;
    setTimeout(pump, 5100);
  } finally {
    inflight = false;
    if (hasNear(queue, items)) setTimeout(pump, 0);
  }
}

function recheck() {
  for (const [id, rec] of items) {
    if (!rec.el.isConnected) { items.delete(id); continue; }
    if (sigOf(rec.el) !== rec.sig) {
      // the site reused this element for different content: forget it so the next scan sees it fresh
      overlay.clear(rec.el);
      rec.el.removeAttribute("data-nope-id");
      items.delete(id);
    }
  }
  for (const [mid, rec] of media) if (!rec.el.isConnected) media.delete(mid);
}

function scan() {
  if (!active() || pageRevealed) return;
  recheck();
  let found;
  try { found = adapter.scan(document); } catch (e) { console.debug("[nopescope] scan failed", e); return; }
  for (const it of found) {
    if (!it?.el || it.el.hasAttribute("data-nope-id") || it.el.closest("nope-curtain")) continue;
    const text = (it.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    if (!text) continue;
    const id = `n${nextId++}`;
    it.el.setAttribute("data-nope-id", id);
    const rec = { el: it.el, item: { ...it, text }, sig: sigOf(it.el) };
    items.set(id, rec);
    if (revealed.has(itemKey(rec.item))) { it.el.setAttribute("data-nope-state", "revealed"); continue; }
    evaluate(id);
  }
  scanMedia();
}

// ---------------------------------------------------------------- images and video posters
function mediaSrc(el) {
  const raw = el.tagName === "VIDEO" ? el.poster : (el.currentSrc || el.src);
  if (!raw || raw.startsWith("blob:") || raw.startsWith("data:")) return "";
  try { return new URL(raw, location.href).href; } catch { return ""; }
}

function mediaContext(el) {
  const parts = [el.getAttribute("alt"), el.getAttribute("title"), el.getAttribute("aria-label")];
  const fig = el.closest("figure");
  if (fig) parts.push(fig.querySelector("figcaption")?.textContent);
  const a = el.closest("a");
  if (a) parts.push(a.getAttribute("aria-label") || a.getAttribute("title"));
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
}

function scanMedia() {
  const mine = rules.filter((r) => ruleAppliesToSite(r, HOST));
  const visual = mine.filter((r) => r.kind === "topic" && r.images !== false);
  const kw = mine.filter((r) => r.kind === "keyword");
  if (!visual.length && !kw.length) return;
  for (const el of document.querySelectorAll("img, video[poster]")) {
    if (el.closest("nope-cover, nope-bar, nope-curtain")) continue;
    if (el.closest('[data-nope-state="blur"], [data-nope-state="hide"], [data-nope-state="pending"]')) continue; // its post is covered
    if (el.tagName === "IMG" && !el.complete) { el.addEventListener("load", scheduleScan, { once: true }); continue; }
    const src = mediaSrc(el);
    if (el.dataset.nopeSrc === src) continue; // seen with this source (lazy loaders and feeds swap src: re-check then)
    if (el.hasAttribute("data-nope-mid")) { overlay.clearMedia(el); media.delete(el.getAttribute("data-nope-mid")); }
    el.dataset.nopeSrc = src;
    const small = el.tagName === "IMG" && (el.naturalWidth < MEDIA_MIN || el.naturalHeight < MEDIA_MIN);
    if (!src || small || el.closest('[data-nope-state="revealed"]') || revealedMedia.has(src)) { el.setAttribute("data-nope-mid", "skip"); continue; }
    const mid = `m${nextMid++}`;
    el.setAttribute("data-nope-mid", mid);
    const context = mediaContext(el);
    media.set(mid, { el, src, context });
    const lower = context.toLowerCase();
    const hit = kw.find((r) => containsAny(lower, r.keywords));
    if (hit) {
      applyMediaVerdict(mid, { action: hit.action || "blur", ruleId: hit.id, label: labelFor(hit),
        detail: { kind: "keyword", model: "none (word match in image caption / alt text)", rule: hit.name || labelFor(hit), ruleId: hit.id, matched: firstMatch(lower, hit.keywords), input: context, src } });
      continue;
    }
    if (visual.length) mediaQueue.push(mid);
  }
  pumpMedia();
}

function applyMediaVerdict(mid, v) {
  const rec = media.get(mid);
  if (!rec || !rec.el.isConnected || v.action === "show" || pageRevealed) return;
  overlay.applyMedia(rec.el, v, {
    onShow: () => remember(revealedMedia, rec.src),
    onWrong: () => {
      remember(revealedMedia, rec.src);
      chrome.runtime.sendMessage({ type: "nope:feedback", text: `[image] ${rec.src} ${rec.context}`, ruleId: v.ruleId, label: "false_positive", url: location.href }).catch(() => {});
    },
  });
  stat(v.ruleId, `img|${rec.src}`);
}

async function pumpMedia() {
  if (mediaInflight || !mediaQueue.length || modelDown()) return;
  mediaInflight = true;
  let batch = [];
  try {
    batch = nextBatch(mediaQueue, media, MEDIA_BATCH);
    if (!batch.length) return;
    const res = await send({ type: "nope:classifyMedia", items: batch.map((m) => ({ id: m, src: media.get(m).src, context: media.get(m).context, site: HOST })) });
    if (res?.notReady) { waitForModel(batch, mediaQueue, media, pumpMedia); return; }
    if (!res?.verdicts) throw new Error(res?.error || "no verdicts");
    for (const v of res.verdicts) applyMediaVerdict(v.id, v);
  } catch {
    for (const m of batch) {
      const rec = media.get(m);
      if (rec && (rec.retries = (rec.retries || 0) + 1) <= MAX_RETRIES) mediaQueue.push(m);
    }
    modelDownUntil = Date.now() + 5000;
    setTimeout(pumpMedia, 5100);
  } finally {
    mediaInflight = false;
    if (hasNear(mediaQueue, media)) setTimeout(pumpMedia, 0);
  }
}

// ---------------------------------------------------------------- page curtain (generic sites)
// If the page itself is about a noped topic (title / main heading), curtain the whole page.
let pageKey = "";
let curtained = false;
const revealedPages = new Set(); // URLs where the user chose "Show page"
async function checkPage() {
  if (!active() || adapter.id !== "generic") return;
  const h1 = document.querySelector("h1");
  const text = `${document.title} ${h1 ? h1.textContent : ""}`.replace(/\s+/g, " ").trim().slice(0, 400);
  const key = `${location.href}|${text}`;
  if (!text || key === pageKey) return;
  pageKey = key;
  if (curtained) { overlay.removeCurtain(); curtained = false; } // single-page apps: a new page, a new decision
  pageRevealed = revealedPages.has(location.href);
  if (pageRevealed) return;
  const mine = rules.filter((r) => ruleAppliesToSite(r, HOST));
  const lower = text.toLowerCase();
  let label = null, detail = null;
  const kw = mine.find((r) => r.kind === "keyword" && containsAny(lower, r.keywords));
  if (kw) {
    label = labelFor(kw);
    detail = { kind: "keyword", model: "none (word match in page title / heading)", rule: kw.name || label, ruleId: kw.id, matched: firstMatch(lower, kw.keywords), input: text };
  } else {
    const model = modelRulesFor(mine, HOST, lower);
    if (!model.length) return;
    try {
      const res = await send({ type: "nope:classify", ruleIds: model.map((r) => r.id), items: [{ id: "page", text, kind: "page", site: HOST }] });
      const v = res?.verdicts?.[0];
      if (v && v.action !== "show") { label = v.label; detail = { ...v.detail, via: "page title / heading" }; }
    } catch { return; }
    if (pageKey !== key) return; // the page changed while the model was deciding
  }
  if (!label) return;
  curtained = true;
  overlay.curtain(label, {
    detail,
    onShow: () => {
      curtained = false;
      pageRevealed = true;
      revealedPages.add(location.href);
      queue.length = 0;
      mediaQueue.length = 0;
      for (const [, rec] of items) if (rec.el.getAttribute("data-nope-state") !== "revealed") overlay.clear(rec.el);
      for (const [, rec] of media) overlay.clearMedia(rec.el);
    },
  });
}

// ---------------------------------------------------------------- lifecycle
let scanTimer = null;
function scheduleScan() {
  if (scanTimer) return;
  scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 150);
}

// Our own UI changes (covers, bars, pills, panel, curtain) must not trigger another scan.
const isOurs = (n) => n.nodeType === 1 && /^NOPE-/.test(n.tagName);
function onMutations(records) {
  for (const r of records) {
    if (isOurs(r.target)) continue;
    const nodes = [...r.addedNodes, ...r.removedNodes];
    if (nodes.length && nodes.every(isOurs)) continue;
    scheduleScan();
    return;
  }
}

function resetAll() {
  for (const [, rec] of media) { overlay.clearMedia(rec.el); rec.el.removeAttribute("data-nope-mid"); }
  document.querySelectorAll("[data-nope-mid], [data-nope-src]").forEach((e) => { e.removeAttribute("data-nope-mid"); delete e.dataset.nopeSrc; });
  media.clear();
  mediaQueue.length = 0;
  for (const [, rec] of items) { overlay.clear(rec.el); rec.el.removeAttribute("data-nope-id"); }
  items.clear();
  queue.length = 0;
  modelDownUntil = 0;
  scheduleScan();
}

async function main() {
  if (!adapter) return;
  await loadState();
  const start = () => {
    new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
    scheduleScan();
    checkPage();
    setInterval(checkPage, 1500); // single-page apps change URL / title without reloading
  };
  let scrollTimer = null;
  addEventListener("scroll", () => {
    if (!scrollTimer) scrollTimer = setTimeout(() => { scrollTimer = null; pump(); pumpMedia(); }, 200);
  }, { passive: true, capture: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !(changes.rules || changes.settings)) return;
    await loadState();
    pageRevealed = false;
    resetAll();
    if (curtained) { overlay.removeCurtain(); curtained = false; }
    pageKey = "";
    checkPage();
  });
}

main();
