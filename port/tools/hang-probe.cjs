// PORT-NEW docs/40 M23: leaked-handle probe for `node --test` without --test-force-exit. Loaded via
// NODE_OPTIONS="--require <this>" so every per-file test child gets it. An UNREF'd timer (it never keeps the
// process alive itself) fires only if the child is still running after HANG_PROBE_MS and prints what keeps the
// event loop alive: getActiveResourcesInfo() plus the live handles with whatever identifies them.
const ms = Number(process.env.HANG_PROBE_MS) || 45000;
const t0 = Date.now();
const file = process.argv.find((a) => /\.test\.c?js$/.test(a)) ?? process.argv.slice(1).join(" ");
const describe = (h) => {
  const o = { type: h?.constructor?.name ?? typeof h };
  for (const k of ["pid", "spawnfile", "fd", "_idleTimeout", "path", "remoteAddress", "remotePort", "localPort"]) if (h?.[k] !== undefined && h[k] !== null) o[k] = h[k];
  if (Array.isArray(h?.spawnargs)) o.spawnargs = h.spawnargs.slice(0, 8).map(String).map((s) => s.slice(0, 120));
  if (h?._handle?.fd !== undefined) o.fd = h._handle.fd;
  if (typeof h?.address === "function") { try { o.address = h.address(); } catch {} }
  if (h?._onTimeout) o.onTimeout = String(h._onTimeout).slice(0, 160);
  if (h?.isTTY) o.tty = true;
  return o;
};
setTimeout(() => {
  let handles = [];
  try { handles = process._getActiveHandles().map(describe); } catch {}
  let requests = [];
  try { requests = process._getActiveRequests().map((r) => r?.constructor?.name); } catch {}
  process.stderr.write(`\nHANG_PROBE ${JSON.stringify({ file, pid: process.pid, aliveMs: Date.now() - t0, resources: process.getActiveResourcesInfo(), handles, requests })}\n`);
}, ms).unref();
