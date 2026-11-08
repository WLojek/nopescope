import { clean, collectText, join, findFresh, abs } from "./util.js";

const PAA = "div.related-question-pair";
const NEWS = "g-inner-card, div.SoaBEf, [data-news-cluster-id]";
const VIDEO = "video-voyager";
const SPECIAL = [PAA, NEWS, VIDEO].join(", ");
const STOP = "#search, #rso, #center_col, #main, #cnt, #res, body, html, form, [role='main'], [role='search']";

function hostOf(a) { try { return new URL(a.href).hostname.replace(/^www\./, ""); } catch { return ""; } }

function organicBlock(a) {
  const pref = a.closest(".MjjYud, div.g, div.tF2Cxc, div.Ww4FFb");
  if (pref) return pref;
  // Fallback: climb while the parent still holds exactly one result heading.
  let cur = a.parentElement, best = a;
  for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
    if (cur.matches(STOP) || cur.querySelector("input, textarea")) break;
    if (cur.querySelectorAll("a h3, a [role='heading']").length !== 1) break;
    best = cur;
  }
  return best;
}

export default {
  id: "google",
  name: "Google",
  matches: (loc) => /(^|\.)google\.[a-z.]+$/.test(loc.hostname) && /^\/(search|webhp|$)/.test(loc.pathname),
  scan(root) {
    const items = [];
    const seen = new Set();
    const push = (it) => { if (it && it.text && !seen.has(it.el)) { seen.add(it.el); items.push(it); } };

    // People also ask: question text in the data-q attribute or the button label
    for (const el of findFresh(root, "div.related-question-pair")) {
      const q = el.getAttribute("data-q") || clean(el.querySelector("[data-q]")?.getAttribute("data-q")) ||
        collectText(el.querySelector("[role='heading'], .JlqpRe, span") || document.createElement("i"));
      push({ el, kind: "result", text: clean(q), author: "", authorName: "", url: "" });
    }

    // Top stories / news cards: heading plus source, link
    for (const el of findFresh(root, NEWS)) {
      if (el.parentElement && el.parentElement.closest(NEWS)) continue;
      const h = el.querySelector("[role='heading'], h3");
      const text = h ? collectText(h) : "";
      const a = el.matches("a") ? el : el.querySelector("a[href]");
      push({ el, kind: "result", text, author: "", authorName: "", url: abs(a && a.getAttribute("href")) });
    }

    // Video results
    for (const el of findFresh(root, VIDEO)) {
      const h = el.querySelector("h3, [role='heading']");
      const a = el.querySelector("a[href]");
      const snip = el.querySelector("[data-sncf], .ITZIwc, .VwiC3b");
      push({ el, kind: "result", text: join(h && collectText(h), snip && collectText(snip)), author: a ? hostOf(a) : "", authorName: "", url: abs(a && a.getAttribute("href")) });
    }

    // Organic results: a link that contains an h3
    for (const h3 of root.querySelectorAll("a h3")) {
      const a = h3.closest("a");
      if (!a || h3.closest(SPECIAL)) continue;
      const block = organicBlock(a);
      if (!block || block.hasAttribute("data-nope-id") || seen.has(block)) continue;
      if (block.closest("#searchform, form") || block.querySelector("input[name='q']")) continue;
      const title = collectText(h3);
      const snipEl = block.querySelector("[data-sncf], .VwiC3b, div[style*='-webkit-line-clamp'], .lEBKkf");
      let snippet = snipEl ? collectText(snipEl) : "";
      if (!snippet) snippet = collectText(block, "a, cite, h3, [role='heading'], g-popup, g-accordion, [data-hveid] > [jscontroller][aria-label], .TXwUJf, .B6fmyf");
      if (snippet.startsWith(title)) snippet = clean(snippet.slice(title.length));
      push({ el: block, kind: "result", text: join(title, snippet), author: hostOf(a), authorName: "", url: a.href });
    }
    return items;
  },
};
