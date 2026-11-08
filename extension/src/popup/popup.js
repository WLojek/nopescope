import { SITES, newRule, labelFor, normHost, ruleAppliesToSite, hostMatches, siteEnabled, toScope } from "../shared/rules.js";
import { getRules, setRules, getSettings, setSettings, getStats, today } from "../shared/storage.js";
import { h, switchEl, describeStatus } from "../ui/dom.js";

const $ = (id) => document.getElementById(id);

async function currentHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return null;
    return normHost(tab.url) || null;
  } catch { return null; }
}

let settings, rules, host = null, where = "all";

function renderMaster() {
  $("masterSlot").replaceChildren(switchEl(settings.enabled, async (v) => {
    settings = await setSettings({ enabled: v });
    renderMaster(); renderSite();
  }, "Nopescope on or off"));
  $("masterLabel").textContent = settings.enabled ? "Active" : "Paused everywhere";
  document.body.classList.toggle("paused", !settings.enabled);
}

async function toggleHost(host, on) {
  const sc = toScope(settings.scope || "all");
  const without = sc.hosts.filter((x) => !hostMatches(host, [x]));
  let next;
  if (sc.mode === "all") next = on ? sc : { mode: "except", hosts: [host] };
  else if (sc.mode === "except") next = { mode: "except", hosts: on ? without : [...without, host] };
  else next = { mode: "only", hosts: on ? [...without, host] : without };
  settings = await setSettings({ scope: next });
  renderSite();
}

async function renderSite() {
  host = await currentHost();
  renderScopeChoice(); renderActive();
  const row = $("siteRow");
  if (!host) {
    row.replaceChildren(h("div", { class: "name" }, "Nopescope can't run on this page"));
    return;
  }
  const on = siteEnabled(settings, host);
  const dedicated = SITES.some((s) => hostMatches(host, s.hosts));
  row.replaceChildren(
    h("div", { class: "name" }, h("span", { class: "host" }, host), h("small", null, settings.enabled ? (on ? "Rules apply here" : "Off for this site") : "Paused everywhere"), ),
    h("span", { class: "tag" + (dedicated ? " ded" : "") }, dedicated ? "dedicated" : "auto-detect"),
    switchEl(on, (v) => toggleHost(host, v), `Nopescope on ${host}`),
  );
}

function renderScopeChoice() {
  const box = $("where");
  if (!host) { where = "all"; box.replaceChildren(); box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(...[["all", "Everywhere"], ["only", `Only on ${host}`]].map(([v, l]) =>
    h("button", { type: "button", "aria-pressed": String(where === v), onclick: () => { where = v; renderScopeChoice(); } }, l)));
}

function renderActive() {
  const n = host ? rules.filter((r) => ruleAppliesToSite(r, host)).length : 0;
  $("active").textContent = host ? `Rules active here: ${n}` : "";
}

async function renderStats() {
  const day = (await getStats())[today()] || {};
  const entries = Object.entries(day).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, c]) => n + c, 0);
  $("total").textContent = total.toLocaleString();
  const byId = new Map(rules.map((r) => [r.id, r]));
  const max = entries.length ? entries[0][1] : 1;
  const list = $("perRule");
  if (!entries.length) { list.replaceChildren(h("li", { class: "empty" }, "Nothing hidden yet today.")); return; }
  list.replaceChildren(...entries.slice(0, 5).map(([id, c]) => h("li", null,
    h("span", null, byId.has(id) ? labelFor(byId.get(id)) : id.replace(/^pack:/, "")),
    h("span", { class: "n" }, c),
    h("span", { class: "bar" }, h("i", { style: `width:${Math.max(4, (c / max) * 100)}%` })),
  )));
}

async function renderModel() {
  let st = null;
  try { st = await chrome.runtime.sendMessage({ type: "nope:status" }); } catch {}
  const d = describeStatus(st);
  $("modelDot").className = `dot ${d.tone}`;
  $("modelText").textContent = d.text;
  $("modelText").title = d.text;
}

$("quick").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("quickInput").value.trim();
  if (!v) return;
  const r = { ...newRule("topic"), topic: v };
  if (where === "only" && host) r.sites = { mode: "only", hosts: [host] };
  rules = await getRules();
  await setRules([...rules, r]);
  rules = [...rules, r]; renderActive();
  $("quickInput").value = "";
  const btn = e.submitter; if (btn) { btn.textContent = "Added"; setTimeout(() => (btn.textContent = "Nope"), 1200); }
});

$("openOptions").addEventListener("click", (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); });

(async function init() {
  [settings, rules] = await Promise.all([getSettings(), getRules()]);
  renderMaster(); renderSite(); renderStats(); renderModel();
  setInterval(async () => { rules = await getRules(); renderModel(); renderStats(); renderActive(); }, 1000);
})();
