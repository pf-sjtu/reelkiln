import { createServer } from "node:http";
import { existsSync, realpathSync, statSync, createReadStream } from "node:fs";
import { resolve, normalize, relative, sep } from "node:path";
import { p as planMediaResponse } from "./chunks/rangeMedia-848zXGXe.js";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
const HTML_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
function mimeFor(path) {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 && MIME[path.slice(dot).toLowerCase()]) || "application/octet-stream";
}
function pipeFile(res, filePath, range) {
  const stream = createReadStream(filePath, range);
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}
function hostPage(token) {
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}
hyperframes-player{display:block;width:100%;height:100%}</style>
<script src="/__player.js"><\/script></head>
<body>
<hyperframes-player id="p" src="/index.html"></hyperframes-player>
<script>
(function(){
  var TOKEN = ${JSON.stringify(token)};
  var p = document.getElementById('p');
  function up(msg){ msg.source='hf-preview'; parent.postMessage(msg, '*'); }
  p.addEventListener('ready', function(e){ up({ type:'ready', duration: e.detail && e.detail.duration }); });
  p.addEventListener('timeupdate', function(e){ up({ type:'timeupdate', currentTime: e.detail && e.detail.currentTime }); });
  p.addEventListener('error', function(e){ up({ type:'error', message: String((e.detail && e.detail.message) || 'player error') }); });
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.source !== 'hf-preview-control' || d.token !== TOKEN) return;
    try {
      if (d.type === 'play') p.play();
      else if (d.type === 'pause') p.pause();
      else if (d.type === 'seek') p.seek(Number(d.timeSeconds) || 0);
      else if (d.type === 'reload') p.setAttribute('src', '/index.html?rev=' + Date.now());
    } catch (err) { up({ type:'error', message: String(err && err.message || err) }); }
  });
  up({ type:'host-ready' });
})();
<\/script></body></html>`;
}
function startPreviewServer(cmd, onListening, onError) {
  const root = resolve(cmd.compositionDir);
  const host = hostPage(cmd.controlToken);
  const server = createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    if (pathname === "/" || pathname === "/__host") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": HTML_CSP,
      });
      res.end(host);
      return;
    }
    if (pathname === "/__player.js") {
      if (!existsSync(cmd.playerScriptPath)) {
        res.writeHead(404).end("player unavailable");
        return;
      }
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      pipeFile(res, cmd.playerScriptPath);
      return;
    }
    const rel = normalize(pathname).replace(/^([/\\])+/, "");
    const abs = resolve(root, rel);
    const contained = (child, parent) => {
      const r = relative(parent, child);
      return r === "" || (!r.startsWith("..") && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r));
    };
    if (!contained(abs, root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    let real;
    let size;
    try {
      real = realpathSync(abs);
      if (!contained(real, realpathSync(root))) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const st = statSync(real);
      if (!st.isFile()) {
        res.writeHead(404).end("not found");
        return;
      }
      size = st.size;
    } catch {
      res.writeHead(404).end("not found");
      return;
    }
    const plan = planMediaResponse(real, size, req.headers.range ?? null);
    if (plan.status === 416) {
      res.writeHead(416, plan.headers).end();
      return;
    }
    res.writeHead(plan.status, {
      ...plan.headers,
      "Content-Type": mimeFor(real),
      "Cache-Control": "no-store",
      ...(mimeFor(real).startsWith("text/html") ? { "Content-Security-Policy": HTML_CSP } : {}),
    });
    pipeFile(res, real, plan.range ?? void 0);
  });
  server.on("error", (err) => onError(err.message));
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") onListening(`http://127.0.0.1:${addr.port}`);
    else onError("no address");
  });
  return {
    get url() {
      const addr = server.address();
      return addr && typeof addr === "object" ? `http://127.0.0.1:${addr.port}` : "";
    },
    close: () => server.close(),
  };
}
const parentPort = process.parentPort;
if (parentPort) {
  let handle = null;
  const post = (m) => parentPort.postMessage(m);
  parentPort.on("message", ({ data }) => {
    if (data.type === "start" && !handle) {
      handle = startPreviewServer(
        data,
        (url) => post({ type: "listening", requestId: data.requestId, url }),
        (message) => post({ type: "error", requestId: data.requestId, message }),
      );
    } else if (data.type === "stop") {
      try {
        handle?.close();
      } catch {}
      handle = null;
      process.exit(0);
    }
  });
}
export { startPreviewServer };
