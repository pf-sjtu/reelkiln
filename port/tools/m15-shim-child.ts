// docs/32 M15: the local gateway shim in its OWN process, so a proof can SIGKILL it mid-operation and restart it on
// the same ledger directory and port (durable resume). --mode fake: MiniMax faked in-process; the fake's behaviour
// is steered by files in <dir>/fake (tts-delay-ms, video-status, delete-answer) and every MiniMax request is appended
// to <dir>/fake/calls.log. --mode real: the shim calls MiniMax with MINIMAX_API_KEY from this process's env only.
//   npx tsx tools/m15-shim-child.ts <ledgerDir> <port> fake|real
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { minimaxConfig } from "../src/main/llm/minimax";
import { createLogger, setLoggerForTests, registerSecret } from "../src/main/llm/logger";

const [dir, port, mode] = process.argv.slice(2);
setLoggerForTests(createLogger({ level: "silent" }));
const realKey = process.env.MINIMAX_API_KEY;
if (realKey) registerSecret(realKey);
const scrub = (s: string) => (realKey ? s.split(realKey).join("[MINIMAX_API_KEY]") : s);
const fakeDir = join(dir, "fake"); mkdirSync(fakeDir, { recursive: true });
const knob = (k: string, d: string) => { try { return readFileSync(join(fakeDir, k), "utf8").trim() || d; } catch { return d; } };
const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch;
function fakeMiniMax(): typeof fetch {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  return (async (url: any, init: any) => {
    const u = new URL(String(url));
    appendFileSync(join(fakeDir, "calls.log"), `${process.pid} ${init?.method ?? "GET"} ${u.pathname}\n`);
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (u.pathname === "/v1/t2a_v2") { await tick(Number(knob("tts-delay-ms", "0"))); return j({ data: { audio: Buffer.from("ID3fake-m15").toString("hex"), status: 2 }, extra_info: { usage_characters: JSON.parse(init.body).text.length }, base_resp: { status_code: 0 } }); }
    if (u.pathname === "/v1/image_generation") return j({ data: { image_base64: [png.toString("base64")] }, metadata: { success_count: 1 }, base_resp: { status_code: 0 } });
    if (u.pathname === "/v1/video_generation") return j({ task_id: "fake-task-m15", base_resp: { status_code: 0 } });
    if (u.pathname.startsWith("/v2/video_generation/") && init?.method === "DELETE") return knob("delete-answer", "refuse") === "cancelled" ? j({ task_id: "fake-task-m15", action: "cancelled" }) : j({ error: { message: "task is running and cannot be cancelled" } }, 400);
    if (u.pathname === "/v1/query/video_generation") { const st = knob("video-status", "Processing"); return j(st === "Success" ? { status: "Success", file_id: "f1", base_resp: { status_code: 0 } } : { status: st, base_resp: { status_code: 0 } }); }
    if (u.pathname === "/v1/files/retrieve") return j({ file: { download_url: "https://fake.invalid/v.mp4" }, base_resp: { status_code: 0 } });
    if (u.hostname === "fake.invalid") return new Response(Buffer.from("fake-mp4-m15"));
    return realFetch(url, init);
  }) as typeof fetch;
}
(async () => {
  const shim = new LocalGatewayShim({
    dir, port: Number(port), monthUsd: 5,
    provider: () => minimaxConfig(mode === "real" ? process.env : { MINIMAX_API_KEY: "fake-key-proof-only" }),
    ...(mode === "real" ? {} : { mediaFetch: fakeMiniMax(), sleep: () => tick(200) }),
    log: (l) => appendFileSync(join(dir, "shim.log"), scrub(l) + "\n"),
  });
  const url = await shim.start();
  // the parent reads the key it needs from here (the ledger keeps only key ids)
  let key = knob("../vc-key", "");
  if (!key) { key = shim.issueKey().key; writeFileSync(join(dir, "vc-key"), key, { mode: 0o600 }); }
  process.stdout.write(JSON.stringify({ ready: true, url, pid: process.pid }) + "\n");
})().catch((e) => { process.stderr.write(scrub(String(e?.stack ?? e)) + "\n"); process.exit(1); });
