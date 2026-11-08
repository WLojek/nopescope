import { toScope, normHost, DEFAULT_EXCEPT } from "../shared/rules.js";
import { h } from "./dom.js";

// Compact scope control: segmented mode + host chips. `get()` returns the current scope, `set(scope)` stores it.
export function scopeEditor(get, set) {
  const wrap = h("div", { class: "scope" });
  const MODES = [["all", "All sites"], ["only", "Only these"], ["except", "All except these"]];
  function draw() {
    const cur = toScope(get());
    const hosts = cur.hosts.slice();
    const commit = (mode, list) => { set(mode === "all" && !list.length ? "all" : { mode, hosts: list }); draw(); };
    const seg = h("div", { class: "seg", role: "group" }, ...MODES.map(([m, label]) => h("button", { type: "button", "aria-pressed": String(cur.mode === m), onclick: () => {
      if (m === cur.mode) return;
      commit(m, m === "except" && !hosts.length ? [...DEFAULT_EXCEPT] : m === "all" ? [] : hosts);
    } }, label)));
    const kids = [seg];
    if (cur.mode !== "all") {
      const input = h("input", { type: "text", placeholder: "add a site, e.g. bbc.co.uk or paste a URL", spellcheck: "false", "aria-label": "Add a site" });
      const add = (raw) => {
        const list = hosts.slice();
        for (const part of raw.split(/[\s,]+/)) { const v = normHost(part); if (v && !list.includes(v)) list.push(v); }
        commit(cur.mode, list);
      };
      input.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); add(input.value); wrap.querySelector(".chips input").focus(); } else if (e.key === "Backspace" && !input.value && hosts.length) { hosts.pop(); commit(cur.mode, hosts); wrap.querySelector(".chips input").focus(); } });
      input.addEventListener("blur", () => { if (input.value.trim()) add(input.value); });
      const box = h("div", { class: "chips" }, ...hosts.map((x, i) => h("span", { class: "chip" }, x, h("button", { type: "button", "aria-label": `Remove ${x}`, onclick: (e) => { e.stopPropagation(); hosts.splice(i, 1); commit(cur.mode, hosts); } }, "×"))), input);
      box.addEventListener("click", () => input.focus());
      kids.push(box);
      if (!hosts.length) kids.push(h("p", { class: "hint" }, cur.mode === "only" ? "No sites yet, so nothing runs." : "Empty list: runs everywhere."));
    }
    wrap.replaceChildren(...kids);
  }
  draw();
  return wrap;
}
