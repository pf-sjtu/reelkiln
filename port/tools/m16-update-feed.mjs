#!/usr/bin/env node
// PORT-NEW harness (docs/33 M16 T3) — LABELLED FAKE UPSTREAM: a local HTTPS release gateway on the box standing in for
// the original's release gateway. It serves the two contracts the original app reads:
//   GET /v1/app/latest                         startUpdateCheck (L55921): {version, minSupported, autoUpdate, notes}
//   GET /v1/app/updates/<channel>/latest-linux.yml + the artifact   electron-updater generic provider (createAppUpdater
//                                              L2223 setFeedURL `${gateway}/v1/app/updates/${channel}/`)
// The artifact is a real newer AppImage build of the port (same code, version bumped). Download bandwidth is
// throttled so the renderer's "Downloading N%" progress is observable. Every request is logged as JSONL.
//   node tools/m16-update-feed.mjs --dir FEED_DIR --artifact NEW.AppImage --version 0.0.41-port.0 --port 47811 --log req.jsonl
import { createServer } from "node:https";
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
const argv = process.argv.slice(2); const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DIR = opt("--dir"); const ART = opt("--artifact"); const VERSION = opt("--version"); const PORT = Number(opt("--port", "47811")); const LOG = opt("--log", join(DIR, "feed-requests.jsonl"));
const BPS = Number(opt("--bytes-per-sec", String(40 * 1024 * 1024)));
const key = join(DIR, "feed-key.pem"), cert = join(DIR, "feed-cert.pem");
if (!existsSync(cert)) execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
const size = statSync(ART).size;
const sha512 = createHash("sha512").update(readFileSync(ART)).digest("base64");
const name = basename(ART);
const releaseDate = new Date().toISOString();
const yml = `version: ${VERSION}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${size}\n    blockMapSize: 0\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${releaseDate}'\n`;
writeFileSync(join(DIR, "latest-linux.yml"), yml);
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  const url = new URL(req.url, `https://127.0.0.1:${PORT}`);
  const row = { method: req.method, path: url.pathname, query: url.search, range: req.headers.range ?? null, ua: String(req.headers["user-agent"] ?? "").slice(0, 120) };
  if (url.pathname === "/v1/app/latest") {
    if (url.searchParams.get("channel") === "nightly") { log({ ...row, status: 404 }); res.writeHead(404).end(); return; }
    log({ ...row, status: 200 });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: VERSION, minSupported: "0.0.1", autoUpdate: true, notes: "M16 harness release: a newer port build served from the box." }));
    return;
  }
  if (/^\/v1\/app\/updates\/(latest|nightly)\/latest-linux\.yml$/.test(url.pathname)) { log({ ...row, status: 200, bytes: yml.length }); res.writeHead(200, { "content-type": "text/yaml" }).end(yml); return; }
  if (url.pathname === `/v1/app/updates/latest/${encodeURIComponent(name)}` || url.pathname === `/v1/app/updates/latest/${name}`) {
    log({ ...row, status: 200, bytes: size });
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": size });
    const stream = createReadStream(ART, { highWaterMark: 1 << 20 }); let sent = 0; const t0 = Date.now();
    stream.on("data", (chunk) => { sent += chunk.length; res.write(chunk); const ahead = sent / BPS * 1000 - (Date.now() - t0); if (ahead > 0) { stream.pause(); setTimeout(() => stream.resume(), ahead); } });
    stream.on("end", () => { res.end(); log({ path: url.pathname, done: true, sent, ms: Date.now() - t0 }); });
    return;
  }
  log({ ...row, status: 404 }); res.writeHead(404).end();
}).listen(PORT, "127.0.0.1", () => console.log(JSON.stringify({ feed: `https://127.0.0.1:${PORT}`, version: VERSION, artifact: name, size, sha512: sha512.slice(0, 16) })));
