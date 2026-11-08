// Build the extension into dist/: static files, the onnxruntime-web wasm and the bundled scripts.
//
//   node build.mjs           one build
//   node build.mjs --watch   rebuild scripts on change
//
// The models are not part of the package: the extension downloads them once from Hugging Face, pinned to a
// commit and checked by SHA-256 (src/shared/models.js).
import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");
const out = "dist";

fs.rmSync(out, { recursive: true, force: true });
// static files
fs.mkdirSync(`${out}/ort`, { recursive: true });
for (const f of fs.readdirSync("static", { recursive: true })) {
  const src = path.join("static", f);
  if (fs.statSync(src).isDirectory()) fs.mkdirSync(path.join(out, f), { recursive: true });
  else fs.copyFileSync(src, path.join(out, f));
}
fs.copyFileSync("src/content/overlay.css", `${out}/content.css`);

// onnxruntime-web's WebGPU build loads this wasm at runtime; it must be inside the extension (no remote code)
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  fs.copyFileSync(path.join("node_modules/onnxruntime-web/dist", f), path.join(out, "ort", f));
}

// scripts
// ../basal-web is bundled from source: resolve its dependencies from this package's node_modules
const common = { bundle: true, logLevel: "warning", target: "chrome124", legalComments: "none", nodePaths: [path.resolve("node_modules")] };
const jobs = [
  { ...common, entryPoints: { background: "src/background.js", offscreen: "src/offscreen.js", options: "src/options/options.js", popup: "src/popup/popup.js" }, format: "esm", outdir: out },
  { ...common, entryPoints: { content: "src/content/index.js" }, format: "iife", outdir: out },
];
if (watch) {
  for (const j of jobs) await (await context(j)).watch();
  console.log("watching src/ ...");
} else {
  await Promise.all(jobs.map((j) => build(j)));
  console.log(`built ${out}/`);
}
