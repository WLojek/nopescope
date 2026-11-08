// Tiny DOM helpers shared by the options page and the popup.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "open") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

export function switchEl(checked, onChange, label) {
  const input = h("input", { type: "checkbox", checked: !!checked, "aria-label": label || "toggle" });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "switch" }, input, h("span", { class: "track" }));
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function activeDownload(st) {
  const ds = (st && st.downloads) || {};
  return Object.values(ds).find((x) => x.state === "downloading") || null;
}

export function describeStatus(st) {
  if (!st) return { tone: "bad", text: "Background not responding" };
  const dd = activeDownload(st);
  if (dd && st.state !== "ready" && st.state !== "nogpu") return { tone: "busy", text: `Downloading model ${progressPct(st)}%` };
  switch (st.state) {
    case "ready": return { tone: "ok", text: st.msPerDecision ? `Ready · ${Math.round(st.msPerDecision)} ms per decision` : "Ready" };
    case "downloading": return { tone: "busy", text: `Downloading model ${progressPct(st)}%` };
    case "loading": return { tone: "busy", text: "Loading model\u2026" };
    case "error": return { tone: "bad", text: `Error${st.error ? ": " + st.error : ""}` };
    case "nogpu": return { tone: "warn", text: "No WebGPU · keyword, author and language rules only" };
    default: return { tone: "idle", text: "Not loaded" };
  }
}

export function progressPct(st) {
  const dd = activeDownload(st);
  const p = dd ? (dd.total ? dd.loaded / dd.total : 0) : (st && st.progress || 0);
  return Math.max(0, Math.min(100, Math.round(p > 1 ? p : p * 100)));
}
