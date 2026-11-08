import { clean, collectText, join, findFresh, abs } from "./util.js";

// Outer tiles. Inner lockups inside these are skipped (the outer tile is the cover).
const TILE = "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-renderer, ytd-compact-playlist-renderer";
const LOCKUP = "yt-lockup-view-model";
const SHORT = "ytm-shorts-lockup-view-model, ytd-reel-item-renderer";
const COMMENT = "ytd-comment-view-model, ytd-comment-renderer";
const ALL = [TILE, LOCKUP, SHORT, COMMENT].join(", ");
const NEVER = "#player, ytd-player, #movie_player, ytd-watch-metadata, #masthead-container";

function handleFromHref(h) {
  const m = /\/(@[^/?#]+)/.exec(h || "");
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

function channelOf(el) {
  const sel = 'a[href^="/@"], a[href*="youtube.com/@"], ytd-channel-name a, #channel-name a, a[href^="/channel/"]';
  const a = el.querySelector(sel);
  let handle = a ? handleFromHref(a.getAttribute("href")) : "";
  let name = "";
  const cn = el.querySelector("ytd-channel-name, #channel-name, .yt-content-metadata-view-model__metadata-text, #author-text");
  if (cn) name = collectText(cn);
  if (!name && a) name = collectText(a);
  name = name.replace(/^@/, "");
  return { handle, name: clean(name) };
}

function videoItem(el, kind) {
  const titleEl = el.querySelector("#video-title, .yt-lockup-metadata-view-model-wiz__title, .yt-lockup-metadata-view-model__title, h3 a, a#video-title-link, .shortsLockupViewModelHostMetadataTitle, .shortsLockupViewModelHostOutsideMetadataTitle, h3");
  let title = titleEl ? (titleEl.getAttribute("title") || collectText(titleEl)) : "";
  if (!title) title = clean(el.querySelector("a[title]")?.getAttribute("title"));
  if (!title) title = clean(el.querySelector("a[aria-label]")?.getAttribute("aria-label"));
  const snip = el.querySelector(".metadata-snippet-text, yt-formatted-string.metadata-snippet-text, .metadata-snippet-container");
  const text = join(title, snip ? collectText(snip) : "");
  if (!text) return null;
  const { handle, name } = channelOf(el);
  const link = el.querySelector('a[href*="/watch?"], a[href^="/shorts/"], a[href*="/playlist?"], a#thumbnail[href]');
  return { el, kind, text, author: handle || name.toLowerCase(), authorName: name, url: abs(link && link.getAttribute("href")) };
}

function commentItem(el) {
  const body = el.querySelector("#content-text, #content yt-attributed-string, yt-attributed-string#content-text");
  const text = body ? collectText(body) : "";
  if (!text) return null;
  const a = el.querySelector("#author-text, a#author-text");
  const handle = a ? handleFromHref(a.getAttribute("href")) : "";
  const name = a ? collectText(a).replace(/^@/, "") : "";
  const stamp = el.querySelector('#published-time-text a, a[href*="lc="]');
  return { el, kind: "comment", text, author: handle || name.toLowerCase(), authorName: name, url: abs(stamp && stamp.getAttribute("href")) };
}

export default {
  id: "youtube",
  name: "YouTube",
  matches: (loc) => /(^|\.)youtube\.com$/.test(loc.hostname),
  scan(root) {
    const items = [];
    for (const el of findFresh(root, ALL)) {
      if (el.closest(NEVER)) continue;
      const up = el.parentElement;
      if (el.matches(LOCKUP) && up && up.closest(TILE)) continue; // covered by outer tile
      if (el.matches(SHORT) && up && up.closest("ytd-rich-item-renderer")) continue;
      let it = null;
      if (el.matches(COMMENT)) it = commentItem(el);
      else if (el.matches(SHORT)) it = videoItem(el, "short");
      else {
        const isShort = !!el.querySelector('a[href^="/shorts/"]') && !el.querySelector('a[href*="/watch?"]');
        it = videoItem(el, isShort ? "short" : "video");
      }
      if (it) items.push(it);
    }
    return items;
  },
};
