// Shared helpers for site adapters. Pure DOM reads, no layout, no network.
const SKIP_TAGS = new Set(["BUTTON", "SCRIPT", "STYLE", "SVG", "TIME", "NOSCRIPT", "TEMPLATE", "INPUT", "TEXTAREA", "SELECT", "FORM"]);

export const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

export const fresh = (el) => !el.hasAttribute("data-nope-id");

export function abs(href) {
  if (!href) return "";
  try { return new URL(href, location.href).href; } catch { return ""; }
}

// Visible text of `root` without UI chrome. `skipSel` excludes matching descendants (and their subtrees).
export function collectText(root, skipSel) {
  const parts = [];
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) parts.push(c.nodeValue);
      else if (c.nodeType === 1) {
        if (SKIP_TAGS.has(c.tagName.toUpperCase())) continue;
        if (c.hasAttribute("hidden") || c.getAttribute("role") === "button") continue;
        if (skipSel && c.matches(skipSel)) continue;
        if (c.tagName === "IMG") { const a = c.getAttribute("alt"); if (a && a.length <= 4) parts.push(a); continue; }
        walk(c);
      }
    }
  })(root);
  return clean(parts.join(" ").replace(/ ([.,!?;:])/g, "$1"));
}

export const join = (...xs) => clean(xs.filter(Boolean).join(" "));

// Query helper that drops elements nested inside another match of `ownerSel` other than `owner`.
export function ownQueryAll(owner, sel, ownerSel) {
  return Array.from(owner.querySelectorAll(sel)).filter((e) => e.closest(ownerSel) === owner);
}

// Elements under root (or root itself) matching sel, not yet seen.
export function findFresh(root, sel) {
  const out = [];
  if (root.nodeType === 1 && root.matches(sel) && fresh(root)) out.push(root);
  for (const el of root.querySelectorAll(sel)) if (fresh(el)) out.push(el);
  return out;
}
