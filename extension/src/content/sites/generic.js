// Generic adapter for every site without a dedicated one. It finds content items by structure:
//   1. containers: semantic posts (article, role=article, schema.org comments/reviews/posts, data-testid post/comment),
//      elements whose class/id says post/comment/story/card/entry/result/..., and list items with real text;
//   2. the innermost container wins (a comment inside a post card becomes its own item);
//   3. long paragraphs outside any container (article bodies) become items of their own.
// Reads textContent only (no layout), skips navigation, forms, editors and code.
import { clean, collectText, fresh } from "./util.js";

const SKIP = "nav, header, footer, aside, form, menu, dialog, code, pre, textarea, input, select, [contenteditable=''], [contenteditable='true'], [role='navigation'], [role='banner'], [role='contentinfo'], [role='menu'], [role='menubar'], [role='toolbar'], [role='tablist'], [role='textbox'], [role='search'], [aria-hidden='true'], nope-cover, nope-bar, nope-curtain, nope-panel, nope-pill";
const SEMANTIC = "article, [role='article'], [itemtype*='Comment'], [itemtype*='Review'], [itemtype*='SocialMediaPosting'], [itemtype*='NewsArticle'], [itemtype*='BlogPosting'], [data-testid*='post' i], [data-testid*='comment' i], [data-testid*='feedItem' i], [data-testid*='message' i]";
const CLASSY = /(^|[\s_-])(post|comment|reply|tweet|status|story|entry|message|feed-?item|feed-?card|result|card|review|thread|teaser|news-?item|article|tile|listing)s?($|[\s_-]|\d)/i;
const MIN = 25, MAX_ITEM = 1500, MAX_SCAN = 6000;
const rejected = new WeakSet();

const textLen = (el) => clean(el.textContent).length;
const skipped = (el) => !!el.closest(SKIP) || el === document.body || el === document.documentElement || el.tagName === "MAIN";
const nearMarked = (el) => !!el.closest("[data-nope-id]") || !!el.querySelector("[data-nope-id]");

function authorOf(el) {
  const a = el.querySelector("[rel='author'], [itemprop='author'], [class*='author' i] a, a[class*='author' i], [class*='username' i], a[href*='/user/'], a[href*='/u/']");
  return a ? clean(a.textContent).slice(0, 80) : "";
}

function urlOf(el) {
  const h = el.querySelector("h1 a[href], h2 a[href], h3 a[href], h4 a[href], a[href] h2, a[href] h3");
  const a = h ? (h.tagName === "A" ? h : h.closest("a")) : null;
  try { return a ? new URL(a.getAttribute("href"), location.href).href : ""; } catch { return ""; }
}

export default {
  id: "generic",
  name: "Any site",
  matches: (loc) => /^https?:$/.test(loc.protocol),
  scan(root) {
    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const body = doc.body;
    if (!body) return [];
    const pageLen = Math.max(1, textLen(body));

    // 1. containers
    const cands = new Set();
    const consider = (el) => {
      if (cands.has(el) || rejected.has(el) || !fresh(el)) return;
      if (skipped(el)) { rejected.add(el); return; }
      const n = textLen(el);
      if (n < MIN) return; // may still grow (lazy content), so not rejected
      if (n > MAX_ITEM || n > pageLen * 0.6) { rejected.add(el); return; }
      cands.add(el);
    };
    for (const el of body.querySelectorAll(SEMANTIC)) consider(el);
    let seen = 0;
    for (const el of body.querySelectorAll("div[class], li, section[class], div[id]")) {
      if (++seen > MAX_SCAN) break;
      if (rejected.has(el) || !fresh(el)) continue;
      if (el.tagName === "LI" || CLASSY.test(`${el.getAttribute("class") || ""} ${el.id || ""}`)) consider(el);
    }
    // 2. innermost container wins
    const list = [...cands];
    const containers = list.filter((el) => !list.some((o) => o !== el && el.contains(o)));

    // 3. paragraphs outside containers
    const paras = [];
    for (const p of body.querySelectorAll("p, blockquote, dd")) {
      if (rejected.has(p) || !fresh(p)) continue;
      if (containers.some((c) => c.contains(p))) continue;
      if (skipped(p)) { rejected.add(p); continue; }
      const n = textLen(p);
      if (n >= 60 && n <= MAX_ITEM) paras.push(p);
    }

    const out = [];
    for (const el of containers) {
      if (nearMarked(el)) continue;
      const text = collectText(el);
      if (text.length < MIN) continue;
      const author = authorOf(el);
      out.push({ el, kind: "post", text, author: author.toLowerCase(), authorName: author, url: urlOf(el) });
    }
    for (const p of paras) {
      if (nearMarked(p)) continue;
      const text = collectText(p);
      if (text.length < 60) continue;
      out.push({ el: p, kind: "paragraph", text, author: "", authorName: "", url: "" });
    }
    return out;
  },
};
