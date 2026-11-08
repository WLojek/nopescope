// Static server for tests: / -> basal-web dir, /model/ -> exported model dir. COOP/COEP for wasm threads.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
export function serve(modelDir, port = 0) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = u.startsWith("/model/") ? path.join(modelDir, u.slice(7)) : path.join(root, u);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "content-length": st.size,
        "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}
