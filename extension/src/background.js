// Service worker: keeps the offscreen model document alive, routes messages, counts stats, records feedback.
import { getRules, getSettings, today } from "./shared/storage.js";
import { TEXT_MODELS } from "./shared/rules.js";

const OFFSCREEN = "offscreen.html";
const MAX_LABELS = 5000;
const MAX_LABEL_TEXT = 2000;
let creating = null;

async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL(OFFSCREEN)] });
  return ctx.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ||= chrome.offscreen.createDocument({
    url: OFFSCREEN,
    // the model runs in the document's GPU/wasm workers; WebGPU needs a document context
    reasons: ["WORKERS"],
    justification: "Runs the local AI models (WebGPU) that check page items against the user's rules. Nothing is sent anywhere.",
  }).catch((e) => {
    if (!/single offscreen/i.test(String(e?.message || e))) throw e; // created meanwhile by another call: fine
  }).finally(() => { creating = null; });
  await creating;
}

function textModelFor(settings) {
  return (TEXT_MODELS.find((m) => m.id === settings.textModel) || TEXT_MODELS[0]).id;
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  const settings = await getSettings();
  const debug = settings.debug === true; // set only by the test suite
  const extra = {
    textModel: textModelFor(settings),
    allowLocal: debug,                                  // lets the image check read test images from a local server
    devBase: debug ? settings.devModelBase || null : null, // tests serve the model files locally instead of the Hub
  };
  if (msg.type === "nope:classify") {
    const ids = new Set(msg.ruleIds || []);
    extra.rules = (await getRules()).filter((r) => ids.has(r.id));
  }
  if (msg.type === "nope:classifyMedia") extra.rules = (await getRules()).filter((r) => r.enabled && r.kind === "topic");
  // a freshly created offscreen document needs a moment before its listener exists
  for (let i = 0; ; i++) {
    try {
      return await chrome.runtime.sendMessage({ ...msg, ...extra, target: "offscreen" });
    } catch (e) {
      if (i >= 50 || !/Receiving end does not exist/.test(String(e?.message || e))) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

// storage writes are read-modify-write: serialise them
let writes = Promise.resolve();
const serial = (fn) => (writes = writes.then(fn).catch(() => {}));

function bumpStat(ruleId) {
  return serial(async () => {
    const { stats = {} } = await chrome.storage.local.get("stats");
    const day = (stats[today()] ||= {});
    day[ruleId] = (day[ruleId] || 0) + 1;
    for (const k of Object.keys(stats).sort().slice(0, -60)) delete stats[k]; // keep 60 days
    await chrome.storage.local.set({ stats });
  });
}

function addLabel(entry) {
  return serial(async () => {
    const { labels = [] } = await chrome.storage.local.get("labels");
    labels.push({ ...entry, ts: Date.now() });
    await chrome.storage.local.set({ labels: labels.slice(-MAX_LABELS) });
  });
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.target === "offscreen") return false;
  const reply = (p) => { p.then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) })); return true; };
  switch (msg?.type) {
    case "nope:classify":
    case "nope:classifyMedia":
    case "nope:status":
    case "nope:loadModel":
    case "nope:downloadModel":
    case "nope:deleteModel":
      return reply(toOffscreen(msg));
    case "nope:stat":
      if (typeof msg.ruleId === "string") bumpStat(msg.ruleId.slice(0, 80));
      return false;
    case "nope:feedback":
      return reply(addLabel({
        text: str(msg.text, MAX_LABEL_TEXT), ruleId: str(msg.ruleId, 80) || null,
        label: msg.label === "missed" ? "missed" : "false_positive", url: str(msg.url, 500),
      }).then(() => ({ ok: true })));
    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await getRules();
  await getSettings();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "nope-missed", title: "Nopescope: this should have been hidden", contexts: ["selection"] });
  });
  if (reason === "install") chrome.runtime.openOptionsPage();
  // first run: download the chosen text model and the image model from Hugging Face (shown in the rulebook)
  toOffscreen({ type: "nope:loadModel", withImages: true }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "nope-missed" && info.selectionText) {
    addLabel({ text: info.selectionText.slice(0, MAX_LABEL_TEXT), ruleId: null, label: "missed", url: (tab?.url || "").slice(0, 500) });
  }
});

// Load the model (from the local cache) when the browser starts, so the first pages do not wait for it.
chrome.runtime.onStartup.addListener(() => { toOffscreen({ type: "nope:loadModel" }).catch(() => {}); });
