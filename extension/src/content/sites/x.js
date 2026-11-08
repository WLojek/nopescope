import { clean, collectText, join, findFresh, abs } from "./util.js";

const TWEET = 'article[data-testid="tweet"]';
const QUOTE = '[role="link"]';

function handleFrom(block) {
  if (!block) return { handle: "", name: "" };
  let handle = "", name = "";
  for (const a of block.querySelectorAll("a[href]")) {
    const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(a.getAttribute("href") || "");
    if (m && !handle) { handle = "@" + m[1].toLowerCase(); name = collectText(a); }
  }
  if (!handle) {
    const m = /@([A-Za-z0-9_]{1,15})/.exec(block.textContent || "");
    if (m) handle = "@" + m[1].toLowerCase();
  }
  return { handle, name: name.startsWith("@") ? "" : name };
}

export default {
  id: "x",
  name: "X",
  matches: (loc) => /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(loc.hostname),
  scan(root) {
    const items = [];
    for (const el of findFresh(root, TWEET)) {
      const inThis = (e) => e.closest(TWEET) === el;
      const texts = Array.from(el.querySelectorAll('[data-testid="tweetText"]')).filter(inThis);
      const inQuote = (e) => { const q = e.closest(QUOTE); return !!q && el.contains(q); };
      const own = texts.filter((t) => !inQuote(t));
      const quoted = texts.filter((t) => !own.includes(t));
      const text = join(...own.map((t) => collectText(t)), ...quoted.map((t) => collectText(t)));
      if (!text) continue;
      const names = Array.from(el.querySelectorAll('[data-testid="User-Name"]')).filter(inThis);
      const mainName = names.find((n) => !inQuote(n)) || names[0];
      const { handle, name } = handleFrom(mainName);
      let url = "";
      for (const a of el.querySelectorAll('a[href*="/status/"]')) {
        if (!inThis(a)) continue;
        if (a.querySelector("time") || !url) url = a.getAttribute("href");
        if (a.querySelector("time")) break;
      }
      items.push({ el, kind: "post", text, author: handle, authorName: clean(name), url: abs(url) });
    }
    return items;
  },
};
