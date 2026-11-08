// Zip dist/ into nopescope-<version>.zip (for a GitHub release or the Chrome Web Store).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const { version } = JSON.parse(fs.readFileSync("static/manifest.json", "utf8"));
if (!fs.existsSync("dist/manifest.json")) { console.error("Run `npm run build` first."); process.exit(1); }
const out = `nopescope-${version}.zip`;
fs.rmSync(out, { force: true });
execFileSync("zip", ["-r", "-q", `../${out}`, "."], { cwd: "dist", stdio: "inherit" });
console.log(`${out}  ${(fs.statSync(out).size / 1e6).toFixed(0)} MB`);
