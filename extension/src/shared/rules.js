// Rule schema, packs and cheap-rule matching. Shared by content script, offscreen document and UI.
//
// Rule = {
//   id: string, name: string, enabled: boolean,
//   kind: "keyword" | "author" | "language" | "topic",
//   sites: Scope,                        // where the rule applies (see below); legacy: string[] of adapter ids
//   action: "blur" | "hide",
//   // keyword
//   keywords?: string[],                 // case-insensitive; whole words unless the keyword contains a space or symbol
//   // author
//   authors?: string[],                  // "@handle", "u/name", channel name; case-insensitive
//   // language
//   languages?: string[],                // ISO 639-1 codes ("ru", "de")
//   languageMode?: "block" | "only",     // block these languages, or show only these
//   // topic (model)
//   topic?: string,                      // "politics", "GTA VI story spoilers"
//   question?: string,                   // custom yes/no question; default built from topic
//   prefilter?: string[],                // only items containing one of these go to the model
//   threshold?: number,                  // calibrated P(yes) needed to nope (default 0.6)
//   pendingBlur?: boolean,               // blur prefiltered items while the model decides
//   images?: boolean,                    // topic rules: also check images / video posters (default true)
//   imagePrompts?: string[],             // what matching images look like (default built from topic)
//   imageThreshold?: number,             // zero-shot P(match) needed to nope an image (default 0.9)
//   pack?: string,                       // pack id, when the rule came from a pack
// }

// Scope = "all" | { mode: "all" | "only" | "except", hosts: string[] }
//   "all" / mode "all": every site; "only": just these hosts; "except": every site but these hosts.
//   A host matches itself and its subdomains: "x.com" matches "x.com" and "mobile.x.com".
//   Used for the global setting (settings.scope) and per rule (rule.sites).

// Sites with a dedicated adapter (better item detection). Every other site uses the generic adapter.
export const SITES = [
  { id: "x", name: "X", hosts: ["x.com", "twitter.com"] },
  { id: "youtube", name: "YouTube", hosts: ["youtube.com"] },
  { id: "reddit", name: "Reddit", hosts: ["reddit.com"] },
  { id: "google", name: "Google Search", hosts: ["google.com"] },
];

// Never touched by default: web apps where hiding text would get in the way.
export const DEFAULT_EXCEPT = ["mail.google.com", "docs.google.com", "drive.google.com", "calendar.google.com", "meet.google.com", "web.whatsapp.com", "localhost"];

export function normHost(h) {
  return String(h || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/:?#].*$/, "").replace(/^www\./, "").replace(/\.$/, "");
}

export function hostMatches(host, list) {
  const h = normHost(host);
  return (list || []).some((x) => { const n = normHost(x); return n && (h === n || h.endsWith("." + n)); });
}

export function toScope(sites) {
  if (!sites || sites === "all") return { mode: "all", hosts: [] };
  if (Array.isArray(sites)) {
    // legacy: adapter ids -> their hosts ("only")
    const hosts = sites.flatMap((id) => (SITES.find((s) => s.id === id) || { hosts: [id] }).hosts);
    return { mode: "only", hosts };
  }
  return { mode: sites.mode || "all", hosts: sites.hosts || [] };
}

export function inScope(sites, host) {
  const s = toScope(sites);
  if (s.mode === "only") return hostMatches(host, s.hosts);
  if (s.mode === "except") return !hostMatches(host, s.hosts);
  return true;
}

export function describeScope(sites) {
  const s = toScope(sites);
  if (s.mode === "all" || (s.mode === "except" && !s.hosts.length)) return "all sites";
  const list = s.hosts.slice(0, 3).join(", ") + (s.hosts.length > 3 ? ` +${s.hosts.length - 3}` : "");
  return s.mode === "only" ? `only ${list}` : `all except ${list}`;
}

export const PACKS = [
  {
    id: "gta6",
    name: "GTA VI",
    description: "Hides everything about GTA VI: posts, videos, news, trailers, leaks and spoilers. Narrower options come in a later update.",
    rules: [
      {
        // explicit names: hidden at once, no model needed
        id: "pack:gta6-names",
        name: "GTA VI",
        kind: "keyword",
        keywords: ["gta 6", "gta vi", "gta6", "gtavi", "gta 6's", "grand theft auto 6", "grand theft auto vi", "gta six"],
        action: "blur",
        sites: "all",
      },
      {
        // indirect mentions (characters, places, Rockstar): the model decides if the text is about GTA VI
        id: "pack:gta6-related",
        name: "GTA VI",
        kind: "topic",
        topic: "GTA VI",
        question: "Is this text about the video game GTA VI (Grand Theft Auto VI / GTA 6)?",
        prefilter: ["gta", "lucia", "jason", "vice city", "leonida", "rockstar", "port gellhorn", "ambrosia", "grassrivers", "mount kalaga", "leonida keys"],
        threshold: 0.4,
        pendingBlur: true,
        images: true,
        imagePrompts: ["a screenshot from the video game Grand Theft Auto VI", "Grand Theft Auto VI key art with Lucia and Jason", "GTA 6 gameplay in Vice City"],
        imageThreshold: 0.9,
        action: "blur",
        sites: "all",
      },
    ],
  },
  {
    id: "no-politics",
    name: "No politics",
    description: "Hides posts about politicians, elections, parties and government.",
    rules: [{
      id: "pack:no-politics",
      name: "Politics",
      kind: "topic",
      topic: "politics",
      question: "Is this text about politics (politicians, elections, parties, government)?",
      threshold: 0.6,
      images: true,
      imagePrompts: ["a photo of politicians", "a political rally or election campaign", "a parliament or government building", "a politician giving a speech"],
      imageThreshold: 0.95,
      action: "blur",
      sites: "all",
    }],
  },
  {
    id: "no-doom",
    name: "Less doom",
    description: "Hides news about wars, disasters, crime and deaths.",
    rules: [{
      id: "pack:no-doom",
      name: "Doom news",
      kind: "topic",
      topic: "distressing news",
      question: "Is this text distressing news (war, terrorism, disasters, violent crime, deaths)?",
      threshold: 0.6,
      images: true,
      imagePrompts: ["a photo of war", "soldiers in combat", "destroyed buildings after an attack", "a photo of a natural disaster", "an injured person"],
      imageThreshold: 0.92,
      action: "blur",
      sites: "all",
    }],
  },
];

// Text models the user can choose. They download once from Hugging Face, pinned to a commit and checked by
// SHA-256 (src/shared/models.js). Custom models can also be installed into the extension's private storage.
export const TEXT_MODELS = [
  { id: "basal-2.0-mini", name: "Basal 2.0 mini", params: "1.5B", size: "0.97 GB", hosted: true,
    note: "More accurate, best for Polish. About 1.5x slower than pico.",
    ours: "GTA spoilers AUC 0.988 · politics AUC 1.000" },
  { id: "pico", name: "Basal pico", params: "0.8B", size: "0.51 GB", hosted: true,
    note: "Fastest, smallest download. Good for weaker computers.",
    ours: "GTA spoilers AUC 0.977 · politics AUC 0.996" },
];
export const IMAGE_MODEL = { id: "mobileclip-s0", name: "MobileCLIP-S0", size: "0.11 GB" };

export const DEFAULT_SETTINGS = {
  textModel: "basal-2.0-mini", // id from TEXT_MODELS
  modelUrls: {},               // optional download URL per non-built-in model id (custom models)
  enabled: true,
  scope: { mode: "except", hosts: DEFAULT_EXCEPT }, // where Nopescope runs at all
};

export function defaultRules() {
  return PACKS[0].rules.map((r) => ({ ...r, enabled: true, pack: PACKS[0].id }));
}

export function newRule(kind) {
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base = { id, name: "", enabled: true, kind, sites: "all", action: "blur" };
  if (kind === "keyword") return { ...base, keywords: [] };
  if (kind === "author") return { ...base, authors: [] };
  if (kind === "language") return { ...base, languages: [], languageMode: "block" };
  return { ...base, topic: "", threshold: 0.6 };
}

// `host` is the page hostname (adapter ids are accepted too, for the legacy array form).
export function ruleAppliesToSite(rule, host) {
  if (!rule.enabled) return false;
  if (Array.isArray(rule.sites) && rule.sites.includes(host)) return true;
  return inScope(rule.sites, host);
}

export function siteEnabled(settings, host) {
  if (!settings.enabled) return false;
  return inScope(settings.scope || "all", host);
}

export function questionFor(rule) {
  if (rule.question) return rule.question;
  const t = (rule.topic || "").trim();
  return /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(t) ? `Czy ten tekst dotyczy tematu: ${t}?` : `Is this text about ${t}?`;
}

export function labelFor(rule) {
  return rule.name || rule.topic || (rule.keywords || rule.authors || rule.languages || []).join(", ") || rule.kind;
}

const WORDISH = /^[\p{L}\p{N}]+$/u;
const reCache = new Map();
function termRegex(term) {
  let re = reCache.get(term);
  if (!re) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = WORDISH.test(term) ? new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu") : new RegExp(esc, "iu");
    reCache.set(term, re);
  }
  return re;
}

export function containsAny(text, terms) {
  if (!terms || !terms.length) return false;
  return terms.some((t) => t && termRegex(t.trim().toLowerCase()).test(text));
}

export function firstMatch(text, terms) {
  return (terms || []).find((t) => t && termRegex(t.trim().toLowerCase()).test(text)) || null;
}

export function normAuthor(a) {
  return (a || "").trim().toLowerCase().replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "");
}

export function matchAuthor(rule, item) {
  const ids = [normAuthor(item.author), normAuthor(item.authorName)].filter(Boolean);
  if (!ids.length) return false;
  return (rule.authors || []).some((a) => {
    const n = normAuthor(a);
    if (!n) return false;
    const bare = n.replace(/^[@]|^u\//, "");
    return ids.some((i) => i === n || i.replace(/^[@]|^u\//, "") === bare);
  });
}

// language: {code, reliable} | null
export function matchLanguage(rule, lang) {
  if (!lang || !lang.code || !lang.reliable) return false;
  const set = (rule.languages || []).map((x) => x.toLowerCase());
  if (!set.length) return false;
  return rule.languageMode === "only" ? !set.includes(lang.code) : set.includes(lang.code);
}

export function modelRulesFor(rules, site, text) {
  return rules.filter((r) => r.kind === "topic" && ruleAppliesToSite(r, site) && (r.topic || r.question) &&
    (!r.prefilter || !r.prefilter.length || containsAny(text, r.prefilter)));
}
