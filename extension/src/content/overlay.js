// The blur / collapse UI on an item, the "Model output" panel and the page curtain.
//
// Privacy: everything that shows the user's rules (labels, the panel, the curtain card) lives in CLOSED shadow
// roots, so scripts on the page cannot read which topics the user hides. Page-derived text only ever goes in via
// textContent.
//
// Layout: blur uses an absolutely positioned <nope-cover> over the item (no layout shift). Items whose element has
// a shadow root (e.g. Reddit's <shreddit-post>) cannot show light-DOM children, so their bar goes before them.

const STATE = "data-nope-state";
// Closed in normal use. Tests turn on settings.debug (not reachable from pages) to inspect the UI.
let shadowMode = "closed";
export function setDebug(on) { shadowMode = on ? "open" : "closed"; }
const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

// ---------------------------------------------------------------- helpers
function ensurePositioned(el) {
  if (el.dataset.nopePos) return;
  if (getComputedStyle(el).position === "static") { el.style.position = "relative"; el.dataset.nopePos = "set"; }
  else el.dataset.nopePos = "kept";
}

function restorePosition(el) {
  if (el.dataset.nopePos === "set") el.style.removeProperty("position");
  delete el.dataset.nopePos;
}

function node(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

function button(text, cls, onClick) {
  const b = node("button", cls, text);
  b.type = "button";
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); }, true);
  return b;
}

/** A host element with a closed shadow root holding `css` and `children`. */
function shadowHost(tag, css, ...children) {
  const host = document.createElement(tag);
  const root = host.attachShadow({ mode: shadowMode });
  const style = document.createElement("style");
  style.textContent = css;
  root.append(style, ...children);
  for (const ev of ["click", "mousedown", "mouseup", "pointerdown", "pointerup"]) host.addEventListener(ev, (e) => e.stopPropagation());
  return host;
}

// ---------------------------------------------------------------- pill
const PILL_CSS = `
:host { all: initial; display: inline-block; max-width: calc(100% - 16px); }
.pill { pointer-events: auto; display: inline-flex; align-items: center; gap: 8px; max-width: 100%; box-sizing: border-box;
  padding: 6px 6px 6px 10px; border-radius: 999px; background: #111317; color: #e9ecf1; border: 1px solid #2a2f37;
  box-shadow: 0 6px 24px rgba(0,0,0,.35); font: 500 13px/1.2 ${FONT}; white-space: nowrap; }
.mark { font-weight: 800; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #0b0d10;
  background: #ff5a36; padding: 3px 7px; border-radius: 999px; }
.label { overflow: hidden; text-overflow: ellipsis; max-width: 260px; color: #c9cfd8; }
button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px; background: #232830; color: #f2f4f7;
  font: 600 12px/1.2 ${FONT}; }
button:hover { background: #2f3540; }
button:focus-visible { outline: 2px solid #ff5a36; outline-offset: 1px; }
.why { font-weight: 800; min-width: 14px; text-align: center; }
.ghost { background: transparent; color: #9aa3af; }
.ghost:hover { color: #f2f4f7; background: #1b1f25; }
@container (max-width: 360px) { .label, .ghost { display: none; } .pill { gap: 6px; padding: 5px 5px 5px 8px; } }
@media (prefers-color-scheme: light) {
  .pill { background: #fff; color: #14171c; border-color: #dfe3e8; box-shadow: 0 6px 24px rgba(0,0,0,.12); }
  .label { color: #4a525e; } button { background: #eef1f4; color: #14171c; } button:hover { background: #e2e6eb; }
  .ghost { background: transparent; color: #66707c; }
}`;

function pill(verdict, onShow, onWrong) {
  const p = node("div", "pill");
  p.setAttribute("role", "group");
  p.setAttribute("aria-label", "Hidden by Nopescope");
  const label = verdict.label || "";
  const why = button("?", "why", (b) => (openPanel ? closeDetail() : showDetail(b, verdict)));
  why.title = "Model output: why this was hidden";
  why.setAttribute("aria-label", "Model output");
  p.append(node("span", "mark", "nope"), node("span", "label", label), button("Show", "", onShow), why,
    button(`Not ${label.length > 18 ? "this" : label}`, "ghost", onWrong));
  return shadowHost("nope-pill", PILL_CSS, p);
}

// ---------------------------------------------------------------- items
function removeUi(el) {
  el.querySelectorAll(":scope > nope-cover").forEach((n) => n.remove());
  const prev = el.previousElementSibling;
  if (prev && prev.tagName === "NOPE-BAR" && prev.dataset.for === el.getAttribute("data-nope-id")) prev.remove();
}

export function clear(el) {
  removeUi(el);
  restorePosition(el);
  el.removeAttribute(STATE);
}

export function markPending(el) {
  if (el.getAttribute(STATE) === "revealed") return;
  el.setAttribute(STATE, "pending");
}

/**
 * Cover an item.
 * @param {Element} el
 * @param {{action: "blur"|"hide", label: string, detail?: object}} verdict
 * @param {{onShow: () => void, onWrong: () => void}} h
 */
export function apply(el, verdict, h) {
  if (el.getAttribute(STATE) === "revealed") return;
  removeUi(el);
  const id = el.getAttribute("data-nope-id");
  const reveal = () => { clear(el); el.setAttribute(STATE, "revealed"); closeDetail(); h.onShow(); };
  const wrong = () => { clear(el); el.setAttribute(STATE, "revealed"); closeDetail(); h.onWrong(); };
  const bar = () => {
    const b = document.createElement("nope-bar");
    b.dataset.for = id;
    b.append(pill(verdict, reveal, wrong));
    el.before(b);
  };
  if (verdict.action === "hide") {
    el.setAttribute(STATE, "hide");
    const parent = el.parentElement;
    if (!(parent && getComputedStyle(parent).display.includes("grid"))) bar(); // a bar would take a grid cell
    return;
  }
  el.setAttribute(STATE, "blur");
  if (el.shadowRoot) return bar();
  ensurePositioned(el);
  const cover = document.createElement("nope-cover");
  cover.append(pill(verdict, reveal, wrong));
  el.append(cover);
}

// ---------------------------------------------------------------- images and video posters
// The element itself is blurred (an <img> cannot hold children); the pill sits in a cover placed over it.
export function applyMedia(el, verdict, h) {
  if (el.getAttribute(STATE) === "revealed") return;
  clearMedia(el);
  el.setAttribute(STATE, "blur");
  const host = el.parentElement;
  if (!host) return;
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return;
  ensurePositioned(host);
  const hr = host.getBoundingClientRect();
  const cover = document.createElement("nope-cover");
  cover.className = "media";
  cover.dataset.for = el.getAttribute("data-nope-mid");
  const set = (k, v) => cover.style.setProperty(k, v, "important");
  set("inset", "auto"); set("left", `${r.left - hr.left + host.scrollLeft}px`); set("top", `${r.top - hr.top + host.scrollTop}px`);
  set("width", `${r.width}px`); set("height", `${r.height}px`);
  const reveal = () => { clearMedia(el); el.setAttribute(STATE, "revealed"); closeDetail(); h.onShow(); };
  const wrong = () => { clearMedia(el); el.setAttribute(STATE, "revealed"); closeDetail(); h.onWrong(); };
  cover.append(pill(verdict, reveal, wrong));
  host.append(cover);
}

export function clearMedia(el) {
  const id = el.getAttribute("data-nope-mid");
  const host = el.parentElement;
  if (id && host) {
    host.querySelectorAll(":scope > nope-cover.media").forEach((n) => { if (n.dataset.for === id) n.remove(); });
    if (!host.querySelector(":scope > nope-cover")) restorePosition(host);
  }
  if (el.getAttribute(STATE) !== "revealed") el.removeAttribute(STATE);
}

// ---------------------------------------------------------------- "Model output" panel
const PANEL_CSS = `
:host { all: initial; }
.panel { position: fixed; z-index: 2147483647; width: min(440px, calc(100vw - 24px)); max-height: min(70vh, 560px); overflow: auto;
  box-sizing: border-box; background: #111317; color: #e9ecf1; border: 1px solid #2a2f37; border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,.5); font: 13px/1.45 ${FONT}; padding: 14px 16px 12px; }
.head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.mark { font: 800 10px/1 ${FONT}; letter-spacing: .07em; text-transform: uppercase; color: #0b0d10; background: #ff5a36; padding: 4px 7px; border-radius: 999px; }
.title { font-weight: 650; font-size: 14px; flex: 1; }
.x { all: unset; cursor: pointer; color: #9aa3af; font-size: 16px; padding: 0 4px; }
.x:hover { color: #fff; }
dl { display: grid; grid-template-columns: 112px 1fr; gap: 6px 10px; margin: 0; }
dt { color: #8b93a0; } dd { margin: 0; word-break: break-word; }
.big { font-size: 15px; font-weight: 700; }
.yes { color: #ff7a59; } .no { color: #48d597; }
.bar { height: 6px; background: #232830; border-radius: 99px; position: relative; margin-top: 5px; }
.bar i { position: absolute; left: 0; top: 0; bottom: 0; background: #ff5a36; border-radius: 99px; }
.bar b { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #e9ecf1; }
.quote { margin-top: 10px; padding: 8px 10px; background: #181b21; border-radius: 8px; color: #c9cfd8; max-height: 140px; overflow: auto; white-space: pre-wrap; }
.mono { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; color: #8b93a0; font-size: 12px; }
button.copy { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 999px; background: #232830; color: #f2f4f7; font-weight: 600; font-size: 12px; white-space: nowrap; }
button.copy:hover { background: #2f3540; }
@media (prefers-color-scheme: light) {
  .panel { background: #fff; color: #14171c; border-color: #dfe3e8; box-shadow: 0 18px 50px rgba(0,0,0,.18); }
  dt, .foot { color: #66707c; } .quote { background: #f3f5f7; color: #3a414b; } .bar { background: #e6e9ed; } .bar b { background: #14171c; }
  button.copy { background: #eef1f4; color: #14171c; }
}`;

let openPanel = null;
export function closeDetail() { openPanel?.remove(); openPanel = null; }
const pct = (x) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);

export function showDetail(anchor, verdict) {
  closeDetail();
  const d = verdict.detail || { kind: "unknown" };
  const panel = node("div", "panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Model output");
  const head = node("div", "head");
  const x = button("✕", "x", closeDetail);
  x.title = "Close";
  head.append(node("span", "mark", "nope"), node("span", "title", "Model output"), x);
  const dl = node("dl");
  const row = (k, v, cls) => {
    if (v == null || v === "") return;
    dl.append(node("dt", null, k));
    const dd = node("dd", cls);
    if (v instanceof Node) dd.append(v); else dd.textContent = String(v);
    dl.append(dd);
  };
  row("Rule", d.rule || verdict.label);
  row("Checked by", d.model);
  if (d.via) row("Looked at", d.via);
  if (d.kind === "text") {
    row("Question", d.question);
    row("Answer", node("span", `big ${d.pYes >= d.threshold ? "yes" : "no"}`, `${(d.answer || "").toUpperCase()} · P(yes) ${pct(d.pYes)}`));
    const bar = node("div", "bar");
    const fill = node("i"); fill.style.width = pct(d.pYes);
    const mark = node("b"); mark.style.left = pct(d.threshold);
    bar.append(fill, mark);
    const thr = node("div");
    thr.append(node("span", null, `Hidden at P(yes) ≥ ${pct(d.threshold)} (your strictness)`), bar);
    row("Threshold", thr);
    row("Before calibration", `yes ${pct(d.raw?.yes)} · no ${pct(d.raw?.no)} · temperature ${d.temperature?.toFixed?.(2) ?? "–"}`, "mono");
    row("Speed", `${d.cached ? "cached answer · " : ""}${d.ms} ms · ${d.tokens} tokens · prompt language ${d.lang}`, "mono");
  } else if (d.kind === "image") {
    row("Answer", node("span", "big yes", `MATCH · ${pct(d.pMatch)}`));
    row("Threshold", `Hidden at ≥ ${pct(d.threshold)}`);
    row("Best match", `“${d.bestPrompt}” (similarity ${d.bestSimilarity})`);
    row("Closest other", `“${d.closestOther}” (similarity ${d.closestOtherSimilarity})`);
    row("Looks for", (d.prompts || []).join(" · "));
    if (d.caption) row("Caption / alt", d.caption);
    row("Speed", `${d.ms} ms`, "mono");
  } else if (d.kind === "keyword") {
    row("Matched", `“${d.matched}”`, "big yes");
  } else if (d.kind === "author") {
    row("Author", d.author, "big yes");
    row("Your list", (d.list || []).join(", "));
  } else if (d.kind === "language") {
    row("Detected", `${d.detected} (${d.percentage ?? "?"}%${d.reliable ? ", reliable" : ""})`, "big yes");
    row("Rule", `${d.mode === "only" ? "show only" : "hide"}: ${(d.list || []).join(", ")}`);
  }
  panel.append(head, dl);
  if (d.input) panel.append(node("div", "quote", d.input));
  const foot = node("div", "foot");
  const copy = button("Copy JSON", "copy", () => {
    navigator.clipboard?.writeText(JSON.stringify({ label: verdict.label, ...d }, null, 2)).then(() => { copy.textContent = "Copied"; }, () => {});
  });
  foot.append(node("span", null, "Runs on your computer. Nothing was sent anywhere."), copy);
  panel.append(foot);
  const host = shadowHost("nope-panel", PANEL_CSS, panel);
  document.documentElement.append(host);
  // next to the anchor, inside the viewport
  const r = anchor.getBoundingClientRect();
  const w = Math.min(440, innerWidth - 24);
  panel.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
  const below = r.bottom + 8, ph = panel.offsetHeight;
  panel.style.top = `${below + ph > innerHeight - 12 ? Math.max(12, r.top - ph - 8) : below}px`;
  openPanel = host;
}

addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); }, true);
addEventListener("mousedown", (e) => {
  if (!openPanel) return;
  // clicks inside the panel or on any pill (whose "?" toggles the panel) keep it
  const path = e.composedPath();
  if (path.includes(openPanel) || path.some((n) => n.tagName === "NOPE-PILL" || n.tagName === "NOPE-CURTAIN")) return;
  closeDetail();
}, true);
addEventListener("scroll", () => closeDetail(), { passive: true, capture: true });

// ---------------------------------------------------------------- page curtain
const CURTAIN_CSS = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center;
  background: rgba(8, 9, 12, .55); backdrop-filter: blur(28px) saturate(.5); -webkit-backdrop-filter: blur(28px) saturate(.5); }
.card { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 28px 32px; border-radius: 18px;
  background: #111317; border: 1px solid #2a2f37; box-shadow: 0 20px 60px rgba(0,0,0,.45); color: #e9ecf1;
  font: 500 15px/1.35 ${FONT}; max-width: 420px; text-align: center; }
.mark { font: 800 11px/1 ${FONT}; letter-spacing: .06em; text-transform: uppercase; color: #0b0d10; background: #ff5a36; padding: 4px 8px; border-radius: 999px; }
.title { font-size: 18px; font-weight: 650; color: #f2f4f7; }
.row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
button { all: unset; cursor: pointer; padding: 8px 16px; border-radius: 999px; background: #eef1f4; color: #14171c; font: 600 13px/1.2 ${FONT}; }
button:hover { background: #fff; }
button.ghost { background: transparent; color: #9aa3af; } button.ghost:hover { color: #f2f4f7; background: #1b1f25; }
button:focus-visible { outline: 2px solid #ff5a36; outline-offset: 2px; }`;

/** Curtain the whole page: it is about a topic the user said nope to. */
export function curtain(label, { onShow, onBack, detail }) {
  removeCurtain();
  const card = node("div", "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Nopescope");
  const row = node("div", "row");
  const why = button("Model output", "ghost", (b) => (openPanel ? closeDetail() : showDetail(b, { label, detail })));
  row.append(
    button("Go back", "ghost", () => { onBack?.(); if (history.length > 1) history.back(); else removeCurtain(); }),
    why,
    button("Show page", "", () => { removeCurtain(); onShow?.(); }),
  );
  card.append(node("span", "mark", "nope"), node("div", "title", `This page is about ${label}`), row);
  const host = shadowHost("nope-curtain", CURTAIN_CSS, card);
  (document.body || document.documentElement).append(host);
  document.documentElement.classList.add("nope-curtained");
}

export function removeCurtain() {
  closeDetail();
  document.querySelectorAll("nope-curtain").forEach((n) => n.remove());
  document.documentElement.classList.remove("nope-curtained");
}
