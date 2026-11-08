// Run: node test/adapters.test.mjs   (from the extension dir)
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECT = {
  x: [
    { kind: "post", text: "GTA 6 trailer 3 is unreal 🔥 #gta6", author: "@alicedev", url: "https://x.com/AliceDev/status/1001" },
    { kind: "post", text: "Quote tweeting this take Spoiler: the ending of the series is bleak", author: "@bobnews", url: "https://x.com/BobNews/status/1002" },
    { kind: "post", text: "Totally agree with this", author: "@dave_99", url: "https://x.com/dave_99/status/1003" },
  ],
  youtube: [
    { kind: "video", text: "GTA 6 map size explained", author: "@mapnerd" },
    { kind: "video", text: "Old style sidebar title", author: "@oldchan" },
    { kind: "video", text: "GTA 6 gameplay leaked Everything we know about the leaked footage and what it means for the story.", author: "@leakhub" },
    { kind: "video", text: "Home tile about cooking pasta", author: "@chefanna" },
    { kind: "short", text: "Funny cat short" },
    { kind: "comment", text: "This trailer spoils the whole ending!", author: "@viewer1" },
    { kind: "comment", text: "Agreed with the parent", author: "@viewer2" },
  ],
  reddit: [
    { kind: "post", text: "Is the new patch worth it? I have been playing for 200 hours and wonder whether to upgrade. Thoughts?", author: "u/alice_r", url: "https://www.reddit.com/r/gaming/comments/abc123/is_the_new_patch_worth_it/" },
    { kind: "post", text: "Link only post", author: "u/bobthelinker" },
    { kind: "comment", text: "Top-level comment: skip it, spoilers inside.", author: "u/carol_c" },
    { kind: "comment", text: "Nested child reply text.", author: "u/dave_d" },
    { kind: "post", text: "Old reddit post title Old reddit self text body.", author: "u/oldtimer" },
    { kind: "comment", text: "Old parent comment.", author: "u/oldcommenter" },
    { kind: "comment", text: "Old child comment.", author: "u/childguy" },
    { kind: "post", text: "Search hit title about GTA Search preview snippet text.", author: "u/searcher" },
  ],
  google: [
    { kind: "result", text: "Who is the villain in GTA 6?" },
    { kind: "result", text: "Is GTA 6 coming to PC?" },
    { kind: "result", text: "Rockstar confirms GTA 6 delay again" },
    { kind: "result", text: "Fans react to the ending rumours" },
    { kind: "result", text: "GTA 6 story breakdown video YouTube · Story Channel · 10:02" },
    { kind: "result", text: "GTA 6 story leaked in full 3 days ago — The plot follows Jason and Lucia across Leonida, with a heist gone wrong.", author: "example.com", url: "https://example.com/gta6-story" },
    { kind: "result", text: "GTA 6 - Wiki Grand Theft Auto VI wiki with plot and characters.", author: "wiki.example.net" },
  ],
};
const DECOYS = ["Reply", "Share", "Repost", "Like", "Views", "Join", "Award", "Cached", "views", "Sign in", "12:34", "1.2K", "Main video"];
const LOCS = {
  x: [["x.com", true], ["twitter.com", true], ["mobile.twitter.com", true], ["notx.com", false]],
  youtube: [["www.youtube.com", true], ["m.youtube.com", true], ["youtube.com.evil.io", false]],
  reddit: [["www.reddit.com", true], ["old.reddit.com", true], ["reddit.com.x.io", false]],
  google: [["www.google.com", true, "/search"], ["www.google.pl", true, "/search"], ["www.google.com", false, "/maps"], ["evilgoogle.com", false, "/search"]],
};

let failures = 0;
const fail = (m) => { failures++; console.log("  FAIL " + m); };

async function bundle(id) {
  const r = await build({ entryPoints: [path.join(root, `src/content/sites/${id}.js`)], bundle: true, format: "iife", globalName: "Adapter", write: false, platform: "browser" });
  return r.outputFiles[0].text + "\n;window.__adapter = Adapter.default;";
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
  const killer = setTimeout(() => { console.error("timeout"); browser.close().finally(() => process.exit(2)); }, 120000);
  try {
    const page = await browser.newPage();
    for (const id of Object.keys(EXPECT)) {
      console.log(`[${id}]`);
      const code = await bundle(id);
      const html = readFileSync(path.join(root, `test/fixtures/${id}.html`), "utf8");
      const host = { x: "https://x.com/", youtube: "https://www.youtube.com/", reddit: "https://www.reddit.com/", google: "https://www.google.com/" }[id];
      await page.route("**/*", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
      await page.goto(host + "fixture", { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: code });
      const res = await page.evaluate(() => {
        const a = window.__adapter;
        const first = a.scan(document);
        const meta = { id: a.id, name: a.name };
        const items = first.map((i) => ({ ...i, el: i.el.tagName.toLowerCase() }));
        // second scan before marking: stable; then mark and rescan
        const again = a.scan(document).length;
        first.forEach((i, n) => i.el.setAttribute("data-nope-id", "n" + n));
        const after = a.scan(document).length;
        const afterRoot = a.scan(document.body).length;
        return { meta, items, again, after, afterRoot };
      });
      const exp = EXPECT[id];
      if (res.meta.id !== id) fail(`id ${res.meta.id}`);
      if (res.items.length !== exp.length) fail(`count ${res.items.length} != ${exp.length}`);
      res.items.forEach((it, n) => console.log(`  ${it.kind} | ${it.author} | ${it.text}`));
      exp.forEach((e, n) => {
        const it = res.items[n]; if (!it) return;
        for (const k of Object.keys(e)) if (it[k] !== e[k]) fail(`item ${n} ${k}: got ${JSON.stringify(it[k])} want ${JSON.stringify(e[k])}`);
      });
      for (const it of res.items) {
        if (it.text !== it.text.replace(/\s+/g, " ").trim() || !it.text) fail(`text not clean: ${it.text}`);
        for (const d of DECOYS) if (it.text.includes(d)) fail(`decoy "${d}" in: ${it.text}`);
        if (new Set(["post", "comment", "video", "result", "short"]).has(it.kind) === false) fail("bad kind");
      }
      if (res.again !== res.items.length) fail("scan not idempotent before marking");
      if (res.after !== 0) fail(`second scan after marking returned ${res.after}`);
      if (res.afterRoot !== 0) fail(`element-root scan after marking returned ${res.afterRoot}`);
      for (const [host, ok, p] of LOCS[id]) {
        const m = await page.evaluate(([h, p]) => window.__adapter.matches({ hostname: h, pathname: p || "/" }), [host, p]);
        if (m !== ok) fail(`matches(${host}${p || ""}) = ${m}`);
      }
      await page.unroute("**/*");
    }
    // index.js
    const idx = await build({ stdin: { contents: `import {ADAPTERS,pickAdapter} from "./src/content/sites/index.js"; globalThis.R={ids:ADAPTERS.map(a=>a.id),p:pickAdapter({hostname:"www.reddit.com",pathname:"/"}).id,n:pickAdapter({hostname:"example.com",pathname:"/"})}`, resolveDir: root }, bundle: true, write: false, format: "iife" });
    await page.goto("about:blank");
    const r = await page.evaluate(idx.outputFiles[0].text + ";R");
    if (r.ids.join() !== "x,youtube,reddit,google" || r.p !== "reddit" || r.n !== null) fail("index.js " + JSON.stringify(r));
    else console.log("[index] ok");
    clearTimeout(killer);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
