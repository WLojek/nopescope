import { clean, collectText, join, findFresh, abs } from "./util.js";

const NEW_POST = "shreddit-post";
const NEW_COMMENT = "shreddit-comment";
const OLD = ".thing.link, .thing.comment";
const SEARCH_POST = 'search-telemetry-tracker[view-type="search_post"], [data-testid="search-post-unit"], [data-testid="search-post-with-content-preview"]';
const ALL = [NEW_POST, NEW_COMMENT, OLD, SEARCH_POST].join(", ");

const user = (n) => (n ? "u/" + String(n).replace(/^\/?u\//i, "").toLowerCase() : "");

function newPost(el) {
  let title = el.getAttribute("post-title") || "";
  if (!title) title = collectText(el.querySelector('[slot="title"], h1, a[id^="post-title"]') || document.createElement("i"));
  const bodyEl = el.querySelector('[slot="text-body"], [data-post-click-location="text-body"]');
  const body = bodyEl ? collectText(bodyEl) : "";
  const text = join(title, body);
  if (!text) return null;
  const name = el.getAttribute("author") || "";
  return { el, kind: "post", text, author: user(name), authorName: name, url: abs(el.getAttribute("permalink") || el.getAttribute("content-href")) };
}

function newComment(el) {
  // Own body only: the direct child slot="comment", never the nested shreddit-comment children.
  let body = null;
  for (const c of el.children) if (c.getAttribute("slot") === "comment") { body = c; break; }
  const text = body ? collectText(body, NEW_COMMENT) : "";
  if (!text) return null;
  const name = el.getAttribute("author") || "";
  return { el, kind: "comment", text, author: user(name), authorName: name, url: abs(el.getAttribute("permalink")) };
}

function oldThing(el) {
  const isComment = el.classList.contains("comment");
  const name = el.getAttribute("data-author") || "";
  const permalink = el.getAttribute("data-permalink") || "";
  let text = "";
  if (isComment) {
    const entry = Array.from(el.children).find((c) => c.classList.contains("entry"));
    const body = entry && entry.querySelector(".usertext-body");
    text = body ? collectText(body, ".child, .thing") : "";
  } else {
    const t = el.querySelector("a.title");
    const body = el.querySelector(".expando .usertext-body");
    text = join(t ? collectText(t) : "", body ? collectText(body) : "");
  }
  if (!text) return null;
  return { el, kind: isComment ? "comment" : "post", text, author: user(name), authorName: name, url: abs(permalink) };
}

function searchPost(el) {
  const t = el.querySelector('[data-testid="post-title"], a[data-testid="post-title-text"], h2, h3');
  const title = t ? (t.getAttribute("aria-label") || collectText(t)) : "";
  const prev = el.querySelector('[data-testid="post-content"], [data-testid="search-post-content"], p');
  const text = join(title, prev ? collectText(prev) : "");
  if (!text) return null;
  const link = (t && (t.matches("a") ? t : t.closest("a"))) || el.querySelector('a[href*="/comments/"]');
  const au = el.querySelector('a[href^="/user/"], a[href*="reddit.com/user/"], a[href^="/u/"]');
  const m = au && /\/u(?:ser)?\/([^/?#]+)/.exec(au.getAttribute("href"));
  return { el, kind: "post", text, author: m ? user(m[1]) : "", authorName: m ? m[1] : "", url: abs(link && link.getAttribute("href")) };
}

export default {
  id: "reddit",
  name: "Reddit",
  matches: (loc) => /(^|\.)reddit\.com$/.test(loc.hostname),
  scan(root) {
    const items = [];
    for (const el of findFresh(root, ALL)) {
      let it = null;
      if (el.matches(NEW_POST)) it = newPost(el);
      else if (el.matches(NEW_COMMENT)) it = newComment(el);
      else if (el.matches(OLD)) it = oldThing(el);
      else if (!el.closest(NEW_POST) && !(el.parentElement && el.parentElement.closest(SEARCH_POST))) it = searchPost(el);
      if (it) items.push(it);
    }
    return items;
  },
};
