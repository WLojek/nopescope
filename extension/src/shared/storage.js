import { DEFAULT_SETTINGS, defaultRules } from "./rules.js";

export async function getRules() {
  const { rules } = await chrome.storage.local.get("rules");
  if (Array.isArray(rules)) return rules;
  const d = defaultRules();
  await chrome.storage.local.set({ rules: d });
  return d;
}

export async function setRules(rules) {
  await chrome.storage.local.set({ rules });
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const s = await getSettings();
  const next = { ...s, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getStats() {
  const { stats } = await chrome.storage.local.get("stats");
  return stats || {};
}

export async function getLabels() {
  const { labels } = await chrome.storage.local.get("labels");
  return labels || [];
}
