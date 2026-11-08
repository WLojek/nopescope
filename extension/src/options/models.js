import { TEXT_MODELS, IMAGE_MODEL } from "../shared/rules.js";
import { MODEL_FILES } from "../shared/models.js";
import { h } from "../ui/dom.js";

const mb = (n) => (n / 1e6 >= 1000 ? (n / 1e9).toFixed(2) + " GB" : Math.round(n / 1e6) + " MB");

// Cards for the text models and the image model. api: {getSettings, setSettings, send(msg) -> status}
export function mountModelChooser(host, api) {
  let st = null, settings = null, sig = "";
  const dl = (id) => (st && st.downloads && st.downloads[id]) || { state: "none" };

  async function call(msg) {
    try { const r = await api.send(msg); if (r) { st = r; render(); } } catch {}
  }
  async function select(id) {
    settings = await api.setSettings({ textModel: id });
    render();
    call({ type: "nope:loadModel" });
  }

  function source(id) {
    const f = MODEL_FILES[id];
    if (!f) return null;
    return h("a", { class: "src mono", href: `https://huggingface.co/${f.repo}/tree/${f.revision}`, target: "_blank", rel: "noreferrer" },
      `From Hugging Face: ${f.repo}@${f.revision.slice(0, 7)}, verified with SHA-256`);
  }

  function dlBlock(id, size, activeText) {
    const d = dl(id);
    if (d.state === "downloading") {
      const pct = d.total ? Math.round((d.loaded / d.total) * 100) : 0;
      return h("div", { class: "mc-prog" }, h("div", { class: "progress", "data-prog": id }, h("i", { style: `width:${pct}%` })),
        h("span", { class: "muted mono", "data-progtxt": id }, `${pct}% · ${mb(d.loaded)} / ${mb(d.total)}`));
    }
    if (d.state === "verifying") return h("div", { class: "mc-dl" }, h("span", { class: "muted" }, "Checking…"));
    if (d.state === "ready") {
      const del = h("button", { type: "button", class: "btn", disabled: !!activeText, title: activeText ? "Switch to another model first" : "", onclick: () => call({ type: "nope:deleteModel", id }) }, "Delete");
      return h("div", { class: "mc-dl" }, h("span", { class: "ok-text" }, "Downloaded ✓"), del);
    }
    return h("div", { class: "mc-dl" },
      h("span", { class: "muted" }, `Not downloaded · ${size}`),
      h("button", { type: "button", class: "btn primary", onclick: () => call({ type: "nope:downloadModel", id }) }, d.state === "error" ? "Retry download" : "Download"),
      d.state === "error" && d.error ? h("span", { class: "warn-text" }, d.error) : null);
  }

  function textCard(m) {
    const chosen = settings.textModel === m.id;
    const loaded = st && st.model === m.id && st.state === "ready";
    return h("div", { class: "mcard" + (chosen ? " chosen" : ""), role: "radio", "aria-checked": String(chosen), tabindex: "0",
      onclick: (e) => { if (!e.target.closest("button, a")) select(m.id); },
      onkeydown: (e) => { if ((e.key === " " || e.key === "Enter") && e.target === e.currentTarget) { e.preventDefault(); select(m.id); } } },
      h("div", { class: "mc-top" }, h("span", { class: "radio", "aria-hidden": "true" }), h("b", null, m.name),
        h("span", { class: "mono muted" }, `${m.params} · ${m.size}`), loaded ? h("span", { class: "badge live" }, "Loaded") : null),
      h("p", { class: "mc-note" }, m.note),
      m.ours ? h("p", { class: "mc-score mono" }, m.ours) : null,
      h("div", { class: "mc-actions" }, dlBlock(m.id, m.size, chosen)),
      source(m.id));
  }

  function imageCard() {
    return h("div", { class: "mcard img" },
      h("div", { class: "mc-top" }, h("b", null, IMAGE_MODEL.name), h("span", { class: "mono muted" }, IMAGE_MODEL.size), h("span", { class: "badge" }, "Images")),
      h("p", { class: "mc-note" }, "Checks images and video thumbnails"),
      h("div", { class: "mc-actions" }, dlBlock(IMAGE_MODEL.id, IMAGE_MODEL.size, false)),
      source(IMAGE_MODEL.id));
  }

  function render() {
    if (!settings) return;
    const s = JSON.stringify([settings.textModel, st && st.model, st && st.state, Object.entries((st && st.downloads) || {}).map(([k, v]) => [k, v.state, v.error])]);
    if (s === sig) { // same layout: only patch progress bars
      for (const [id, d] of Object.entries((st && st.downloads) || {})) {
        const bar = host.querySelector(`[data-prog="${id}"]`), txt = host.querySelector(`[data-progtxt="${id}"]`);
        if (!bar || d.state !== "downloading") continue;
        const pct = d.total ? Math.round((d.loaded / d.total) * 100) : 0;
        bar.firstElementChild.style.width = pct + "%"; txt.textContent = `${pct}% · ${mb(d.loaded)} / ${mb(d.total)}`;
      }
      return;
    }
    sig = s;
    const active = settings.textModel;
    const activeReady = dl(active).state === "ready";
    host.replaceChildren(
      !activeReady && !(st && st.state === "nogpu") ? h("p", { class: "first-run" }, "Nopescope is downloading its AI model once (about 1 GB). Word, people and language rules already work.") : null,
      h("div", { class: "mlist", role: "radiogroup", "aria-label": "Text model" }, ...TEXT_MODELS.map(textCard), imageCard()),
    );
  }

  return {
    async update(status) { st = status; settings = await api.getSettings(); render(); },
    async refresh() { settings = await api.getSettings(); render(); },
  };
}
