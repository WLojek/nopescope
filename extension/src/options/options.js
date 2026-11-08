import { PACKS, SITES, newRule, labelFor, describeScope, normHost, ruleAppliesToSite } from "../shared/rules.js";
import { getRules, setRules, getSettings, setSettings, getLabels } from "../shared/storage.js";
import { mountModelChooser } from "./models.js";
import { scopeEditor } from "../ui/scope.js";
import { h, switchEl, debounce, describeStatus, progressPct } from "../ui/dom.js";

const $ = (id) => document.getElementById(id);

const LANGS = [
  ["en", "English"], ["pl", "Polish"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"],
  ["pt", "Portuguese"], ["nl", "Dutch"], ["sv", "Swedish"], ["no", "Norwegian"], ["da", "Danish"], ["fi", "Finnish"],
  ["cs", "Czech"], ["sk", "Slovak"], ["uk", "Ukrainian"], ["ru", "Russian"], ["tr", "Turkish"], ["ar", "Arabic"],
  ["he", "Hebrew"], ["hi", "Hindi"], ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"], ["id", "Indonesian"],
  ["vi", "Vietnamese"], ["th", "Thai"], ["ro", "Romanian"], ["hu", "Hungarian"], ["el", "Greek"], ["bg", "Bulgarian"],
];
const KINDS = [
  { kind: "topic", label: "Topics", add: "Nope a topic" },
  { kind: "keyword", label: "Words", add: "Nope a word" },
  { kind: "author", label: "People and channels", add: "Nope a person/channel" },
  { kind: "language", label: "Languages", add: "Nope a language" },
];

let rules = [];
let settings = null;
const open = new Set();
let lastRulesJson = "";
let siteFilter = "";

const saveRules = () => { lastRulesJson = JSON.stringify(rules); return setRules(rules); };
const saveRulesSoon = debounce(saveRules, 250);

/* ---------- packs ---------- */
function renderPacks() {
  $("packList").replaceChildren(...PACKS.map((p) => {
    const on = rules.some((r) => r.pack === p.id);
    const card = h("div", { class: "pack" + (on ? " on" : "") },
      h("div", { class: "pack-top" }, h("b", null, p.name), switchEl(on, async (v) => {
        if (v) {
          const have = new Set(rules.map((r) => r.id));
          rules = [...rules, ...p.rules.filter((r) => !have.has(r.id)).map((r) => ({ ...r, enabled: true, pack: p.id }))];
        } else rules = rules.filter((r) => r.pack !== p.id);
        await saveRules(); renderPacks(); renderRules();
      }, `${p.name} pack`)),
      h("p", null, p.description),
      p.rules.some((r) => r.images) ? h("p", { class: "mutedline" }, "Text + images") : null,
      p.id === "gta6" ? h("span", { class: "tag" }, "Launch pack · 19 Nov") : null,
    );
    return card;
  }));
}

/* ---------- editor widgets ---------- */
function chipsEditor(list, placeholder, norm, onChange) {
  const box = h("div", { class: "chips" });
  const input = h("input", { type: "text", placeholder, "aria-label": placeholder, spellcheck: "false" });
  const commit = (raw) => {
    for (const part of raw.split(/[,\n]/)) {
      const v = norm(part);
      if (v && !list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
    }
    onChange(); draw();
  };
  function draw() {
    box.replaceChildren(
      ...list.map((c, i) => h("span", { class: "chip" }, c, h("button", { type: "button", "aria-label": `Remove ${c}`, onclick: (e) => { e.stopPropagation(); list.splice(i, 1); onChange(); draw(); } }, "×"))),
      input,
    );
  }
  input.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); commit(input.value); input.focus(); }
    else if (e.key === "Backspace" && !input.value && list.length) { list.pop(); onChange(); draw(); input.focus(); }
  });
  input.addEventListener("blur", () => { if (input.value.trim()) commit(input.value); });
  box.addEventListener("click", () => input.focus());
  draw();
  return box;
}

function segmented(options, value, onPick) {
  const wrap = h("div", { class: "seg", role: "group" });
  const draw = (v) => wrap.replaceChildren(...options.map(([val, label]) => h("button", { type: "button", "aria-pressed": String(v === val), onclick: () => { onPick(val); draw(val); } }, label)));
  draw(value);
  return wrap;
}

function field(label, control, hint) {
  return h("div", { class: "field" }, h("span", null, label), control, hint ? h("p", { class: "hint" }, hint) : null);
}

function sitesEditor(rule, onChange) {
  return scopeEditor(() => rule.sites, (v) => { rule.sites = v; onChange(); });
}

function languagesEditor(rule, onChange) {
  rule.languages = rule.languages || [];
  const wrap = h("div", { class: "langs" });
  const draw = () => wrap.replaceChildren(...LANGS.map(([code, name]) => {
    const on = rule.languages.includes(code);
    return h("button", { type: "button", class: "pill", "aria-pressed": String(on), onclick: () => {
      rule.languages = on ? rule.languages.filter((c) => c !== code) : [...rule.languages, code];
      onChange(); draw();
    } }, h("span", { class: "code" }, code), name);
  }));
  draw();
  return wrap;
}

function describe(rule) {
  switch (rule.kind) {
    case "topic": return rule.pack ? "Topic · from pack" : "Topic";
    case "keyword": return `${(rule.keywords || []).length} word${(rule.keywords || []).length === 1 ? "" : "s"}`;
    case "author": return `${(rule.authors || []).length} name${(rule.authors || []).length === 1 ? "" : "s"}`;
    default: return rule.languageMode === "only" ? "Show only" : "Block";
  }
}
function subline(rule) {
  return `${describe(rule)} \u00b7 ${rule.action === "hide" ? "hide" : "blur"} \u00b7 ${describeScope(rule.sites)}`;
}
function titleOf(rule) {
  if (rule.kind === "language") {
    const names = (rule.languages || []).map((c) => (LANGS.find((l) => l[0] === c) || [c, c])[1]);
    return rule.name || (names.length ? names.join(", ") : "No language chosen");
  }
  return labelFor(rule) === rule.kind ? `Empty ${rule.kind} rule` : labelFor(rule);
}

/* ---------- rules ---------- */
function editorFor(rule, refresh) {
  const change = () => { refresh(); saveRulesSoon(); };
  const parts = [];
  if (rule.kind === "topic") {
    const t = h("input", { type: "text", value: rule.topic || "", placeholder: "e.g. politics, football transfers, crypto", "data-first": "1" });
    t.addEventListener("input", () => { rule.topic = t.value; if (!rule.pack) { rule.name = ""; rule.question = undefined; } change(); });
    parts.push(field("Topic", t, "Decided locally by the AI model. Describe it in a few words, in any language."));
    const th = rule.threshold ?? 0.6;
    const pos = h("input", { type: "range", min: "30", max: "90", step: "5", value: String(Math.round((1.2 - th) * 100)), "aria-label": "Strictness" });
    pos.addEventListener("input", () => { rule.threshold = Math.round((120 - Number(pos.value))) / 100; change(); });
    parts.push(h("div", { class: "field" }, h("span", null, "Strictness"),
      h("div", { class: "slider" }, h("span", null, "looser"), pos, h("span", null, "stricter")),
      h("p", { class: "hint" }, "Stricter hides more, including some borderline posts. Looser hides only clear matches.")));
    const imgBox = h("div", { class: "img-opts" });
    const drawImg = () => {
      imgBox.replaceChildren();
      if (rule.images === false) return;
      const ith = rule.imageThreshold ?? 0.9;
      const ip = h("input", { type: "range", min: "80", max: "99", step: "1", value: String(Math.round((1.79 - ith) * 100)), "aria-label": "Image strictness" });
      ip.addEventListener("input", () => { rule.imageThreshold = (179 - Number(ip.value)) / 100; change(); });
      rule.imagePrompts = rule.imagePrompts || [];
      imgBox.append(
        h("div", { class: "field" }, h("span", null, "Image strictness"),
          h("div", { class: "slider" }, h("span", null, "looser"), ip, h("span", null, "stricter")),
          h("p", { class: "hint" }, "Images are judged by a small local vision model; it recognises a style or scene, not exact titles.")),
        field("What do matching images look like?", chipsEditor(rule.imagePrompts, "e.g. a screenshot from GTA VI", (x) => x.trim(), change), "Optional. When empty, prompts are built from the topic."),
      );
    };
    parts.push(h("div", { class: "field img-switch" }, h("label", { class: "inline" }, switchEl(rule.images !== false, (v) => { rule.images = v; drawImg(); change(); }, "Check images"), h("span", { class: "lab-text" }, "Also hide matching images and video thumbnails"))), imgBox);
    drawImg();
  } else if (rule.kind === "keyword") {
    rule.keywords = rule.keywords || [];
    parts.push(field("Words or phrases", chipsEditor(rule.keywords, "Type a word, press Enter", (s) => s.trim(), change), "Case-insensitive. A single word matches whole words only; a phrase matches as written."));
  } else if (rule.kind === "author") {
    rule.authors = rule.authors || [];
    parts.push(field("People and channels", chipsEditor(rule.authors, "@handle, u/name or channel", (s) => s.trim(), change), "Use the handle where there is one: @name on X and YouTube, u/name on Reddit."));
  } else {
    parts.push(field("Mode", segmented([["block", "Block these"], ["only", "Show only these"]], rule.languageMode || "block", (v) => { rule.languageMode = v; change(); })));
    parts.push(field("Languages", languagesEditor(rule, change)));
  }
  parts.push(h("div", { class: "row2" },
    field("Action", segmented([["blur", "Blur"], ["hide", "Hide"]], rule.action || "blur", (v) => { rule.action = v; change(); })),
    field("Sites", sitesEditor(rule, change)),
  ));
  return h("div", { class: "editor" }, ...parts);
}

function ruleCard(rule) {
  const card = h("div", { class: "rule" });
  const draw = () => {
    card.className = "rule" + (open.has(rule.id) ? " open" : "") + (rule.enabled ? "" : " disabled");
    const title = h("span", { class: "title" }, titleOf(rule));
    const sub = h("span", { class: "sub" }, subline(rule));
    const refresh = () => { title.textContent = titleOf(rule); sub.textContent = subline(rule); };
    const head = h("div", { class: "rule-h" },
      switchEl(rule.enabled, async (v) => { rule.enabled = v; card.classList.toggle("disabled", !v); await saveRules(); }, "Enable rule"),
      h("button", { type: "button", class: "summary", "aria-expanded": String(open.has(rule.id)), onclick: () => { open.has(rule.id) ? open.delete(rule.id) : open.add(rule.id); draw(); } }, title, sub),
      h("span", { class: "chev", "aria-hidden": "true" }, "›"),
      h("button", { type: "button", class: "icon-btn", title: "Delete rule", "aria-label": "Delete rule", onclick: async () => {
        rules = rules.filter((r) => r !== rule); open.delete(rule.id); await saveRules(); renderRules(); renderPacks();
      } }, "✕"),
    );
    card.replaceChildren(head, ...(open.has(rule.id) ? [editorFor(rule, refresh)] : []));
  };
  draw();
  return card;
}

function renderRules() {
  const list = $("ruleList");
  const shown = siteFilter ? rules.filter((r) => ruleAppliesToSite(r, siteFilter)) : rules;
  const groups = KINDS.map((k) => ({ ...k, items: shown.filter((r) => r.kind === k.kind) })).filter((g) => g.items.length);
  if (!groups.length) { list.replaceChildren(h("div", { class: "empty" }, siteFilter ? `No enabled rules apply on ${siteFilter}.` : "No rules yet. Add one above, or turn on a pack.")); return; }
  list.replaceChildren(...groups.map((g) => h("div", { class: "group" }, h("h3", { class: "group-h" }, `${g.label} · ${g.items.length}`), ...g.items.map(ruleCard))));
}

$("siteFilter").addEventListener("input", (e) => { siteFilter = normHost(e.target.value); renderRules(); });

function renderAdders() {
  $("adders").replaceChildren(...KINDS.map((k) => h("button", { type: "button", onclick: async () => {
    const r = newRule(k.kind);
    rules = [...rules, r]; open.add(r.id);
    await saveRules(); renderRules();
    const ed = [...document.querySelectorAll(".rule.open")].pop();
    const first = ed && ed.querySelector("input[type=text]");
    if (ed) ed.scrollIntoView({ block: "center", behavior: "smooth" });
    if (first) first.focus();
  } }, k.add)));
}

/* ---------- sites + master ---------- */
function renderMaster() {
  $("masterSlot").replaceChildren(switchEl(settings.enabled, async (v) => { settings = await setSettings({ enabled: v }); renderMaster(); }, "Nopescope on or off"));
  $("masterText").textContent = settings.enabled ? "Nopescope is on" : "Paused everywhere";
  document.body.classList.toggle("off", !settings.enabled);
}
function renderSites() {
  $("siteList").replaceChildren(scopeEditor(() => settings.scope || "all", (v) => { settings = { ...settings, scope: v }; setSettings({ scope: v }); }));
}

/* ---------- model ---------- */
async function pollModel() {
  if (document.hidden) return;
  let st = null;
  try { st = await chrome.runtime.sendMessage({ type: "nope:status" }); } catch {}
  chooser && chooser.update(st);
  renderModel(st);
}
let chooser = null;
function renderModel(st) {
  const d = describeStatus(st);
  const state = st ? st.state : "none";
  $("mDot").className = `dot ${d.tone}`;
  const titles = { idle: "Not loaded", downloading: `Downloading ${progressPct(st)}%`, loading: "Loading", ready: "Ready", error: "Error", nogpu: "No WebGPU", none: "Background not responding" };
  $("mState").textContent = titles[state] || d.text;
  $("mDetail").textContent = state === "ready" && st.msPerDecision ? `${Math.round(st.msPerDecision)} ms per decision` : "";
  const bar = $("mBar");
  bar.hidden = state !== "downloading";
  bar.firstElementChild.style.width = progressPct(st) + "%";
  const note = $("mNote");
  const notes = {
    nogpu: "WebGPU is unavailable in this browser, so topic rules cannot run. Keyword, author and language rules still work.",
    error: st && st.error ? st.error : "",
    idle: "Topic rules need the model. It is part of the extension and loads in a few seconds, on your GPU.",
    loading: "Warming up the model on your GPU.",
  };
  note.textContent = notes[state] || "";
  note.hidden = !notes[state];
  const btn = $("mLoad");
  btn.hidden = !(state === "idle" || state === "error");
  btn.textContent = state === "error" ? "Try again" : "Load model";
}
$("mLoad").addEventListener("click", async () => {
  $("mLoad").disabled = true;
  try { renderModel(await chrome.runtime.sendMessage({ type: "nope:loadModel" })); } catch {}
  $("mLoad").disabled = false;
});

/* ---------- feedback, advanced ---------- */
async function renderLabels() { $("labelCount").textContent = (await getLabels()).length.toLocaleString(); }
$("export").addEventListener("click", async () => {
  const blob = new Blob([JSON.stringify(await getLabels(), null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `nopescope-labels-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- init ---------- */
async function load() {
  [rules, settings] = await Promise.all([getRules(), getSettings()]);
  lastRulesJson = JSON.stringify(rules);
}
(async function init() {
  await load();
  renderAdders(); renderPacks(); renderRules(); renderMaster(); renderSites(); renderLabels();
  chooser = mountModelChooser($("modelChoice"), { getSettings, setSettings: async (p) => { settings = await setSettings(p); return settings; }, send: (m) => chrome.runtime.sendMessage(m) });
  pollModel(); setInterval(pollModel, 1000);
  document.addEventListener("visibilitychange", pollModel);
  chrome.storage.onChanged.addListener(async (ch) => {
    if (ch.labels) renderLabels();
    if (ch.rules && JSON.stringify(ch.rules.newValue) !== lastRulesJson) { await load(); renderPacks(); renderRules(); }
    if (ch.settings) { settings = await getSettings(); renderMaster(); renderSites(); chooser && chooser.refresh(); }
  });
})();
