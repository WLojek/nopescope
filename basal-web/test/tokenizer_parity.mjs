import { Tokenizer } from "@huggingface/tokenizers";
import fs from "node:fs";
const [model, expected] = process.argv.slice(2);
const tj = JSON.parse(fs.readFileSync(`${model}/tokenizer.json`, "utf8"));
const tc = JSON.parse(fs.readFileSync(`${model}/tokenizer_config.json`, "utf8"));
const tok = new Tokenizer(tj, tc);
const exp = JSON.parse(fs.readFileSync(expected, "utf8"));
let ok = 0, bad = 0;
for (const c of exp.cases) {
  const ids = tok.encode(c.prompt, { add_special_tokens: false }).ids;
  const same = ids.length === c.input_ids.length && ids.every((v, i) => v === c.input_ids[i]);
  if (same) ok++; else { bad++; const i = ids.findIndex((v, j) => v !== c.input_ids[j]); console.log("MISMATCH", c.id, "at", i, ids.slice(i, i + 5), c.input_ids.slice(i, i + 5)); }
}
console.log({ ok, bad });
