// PORT-NEW docs/36 M19 — FAKE-LLM (never evidence of model quality): a deterministic Anthropic-compatible stand-in
// for MiniMax that scripts the WHOLE S1 agent edit. The sequence is the critical path the real-MiniMax S1 run took
// (artifacts/phase-b-m16/T5-s1-appimage-real1-events.jsonl, 46 turns, $0.27): stage incoming/ → footage/+audio/,
// prepare_production (same two workflows), Write edl.json (the EDL that run wrote: T5-s1-appimage-real1-edl.json),
// assemble.py --check, assemble.py, compose_render.py --mode render --resolution 720p --no-captions --no-overlays,
// then the final message linking final.mp4. Exploration turns (ls/grep/sed/--help/Read) are dropped: they do not
// change the job. Every tool really runs in the app's agent (Claude Code SDK → Bash/Write) against the real engine.
// Any follow-up turn (e.g. the original taste capture after Approve) gets one short text answer.
//   node tools/s1-fake-upstream.mjs [port=47999]   (MINIMAX_BASE_URL=http://127.0.0.1:<port>/anthropic)
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 47999);
const LOG = process.env.FAKE_REQ_LOG;
const log = (o) => { if (LOG) appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n"); };
export const BRIEF_MARK = "帮我做一个 6.5 秒的竖屏";
export const S1_EDL = { fps: 30, width: 1080, height: 1920, beats: [
  { name: "b1_a", source: "footage/clip_a.mp4", in: 0.5, out: 3.0, role: "hook", framing: "center", grade: "none", source_kind: "real" },
  { name: "b2_b", source: "footage/clip_b.mp4", in: 0.0, out: 2.0, role: "broll", framing: "subject", grade: "none", source_kind: "real" },
  { name: "b3_c", source: "footage/clip_c.mp4", in: 0.5, out: 2.5, role: "broll", framing: "center", grade: "none", source_kind: "real" }],
  audio: { from_beats: false, bed: { source: "audio/music.mp3", gain: 1.0 } }, output: "final_raw.mp4" };

const textOf = (c) => typeof c === "string" ? c : (c ?? []).map((b) => b.type === "text" ? b.text : b.type === "tool_result" ? "[tool_result] " + (typeof b.content === "string" ? b.content : JSON.stringify(b.content)) : "").join("\n");
const sysOf = (j) => typeof j.system === "string" ? j.system : (j.system ?? []).map((b) => b.text).join("\n");
const isToolResultMsg = (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result");

/** The scripted S1 steps for one job. `cwd` is the agent's working directory (from its system prompt). */
export function s1Steps(job, cwd) {
  const sep = /\\/.test(cwd) && !cwd.startsWith("/") ? "\\" : "/";
  const J = `jobs/${job}`;
  // workspace CLAUDE.md contract: one engine command per call, output only piped into `tail -n <N>`; the app adds pipefail
  const L = 'uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools';
  return [
    { say: "I'll start by staging your source material.", tool: "Bash", input: { command: `cd ${J} && mkdir -p footage audio && cp incoming/clip_a.mp4 footage/clip_a.mp4 && cp incoming/clip_b.mp4 footage/clip_b.mp4 && cp incoming/clip_c.mp4 footage/clip_c.mp4 && cp incoming/music.mp3 audio/music.mp3 && ls footage audio`, description: "Stage footage and music" } },
    { say: "Sources look good. Now I'll set up the cut.", tool: "Bash", input: { command: `${L}/prepare_production.py" --job ${job} --workflow workflows/trend-duplication.md --workflow workflows/cinematic-ad.md 2>&1 | tail -n 40`, description: "Load production context" } },
    { say: "Writing the cut now.", tool: "Write", input: { file_path: [cwd, "jobs", job, "edl.json"].join(sep), content: JSON.stringify(S1_EDL, null, 2) + "\n" } },
    { tool: "Bash", input: { command: `${L}/assemble.py" --job ${job} --check 2>&1 | tail -n 30`, description: "Validate the EDL" } },
    { say: "The cut validates at exactly 6.50s. Rendering.", tool: "Bash", input: { command: `${L}/assemble.py" --job ${job} 2>&1 | tail -n 30`, description: "Assemble the 6.5s timeline with music" } },
    { tool: "Bash", input: { command: `${L}/compose_render.py" --job ${job} --mode render --resolution 720p --no-captions --no-overlays 2>&1 | tail -n 40`, description: "Render the final cut at 720p", timeout: 600000 } },
    { final: `Done — the cut is rendered.\n\n**[Watch the finished cut](${J}/final.mp4)**\n\n- 6.5s, vertical 9:16, a → b → c with your trims\n- music.mp3 is the only soundtrack; no captions, no overlays, no paid tools.` },
  ];
}

/** Decide the reply blocks for one /v1/messages request (pure; unit-tested). */
export function decide(j, counter = { n: 0 }) {
  const sys = sysOf(j); const msgs = j.messages ?? []; const tools = (j.tools ?? []).map((t) => t.name);
  if (/security monitor for autonomous/.test(sys)) return { kind: "monitor", blocks: [{ type: "text", text: "<block>no</block>" }] };
  if (!tools.length) return { kind: "notools", blocks: [{ type: "text", text: "S1 vertical cut" }] };
  // the last human (non tool_result) user message decides the turn
  let hi = -1; for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user" && !isToolResultMsg(msgs[i])) { hi = i; break; }
  const human = hi >= 0 ? textOf(msgs[hi].content) : "";
  if (!human.includes(BRIEF_MARK)) return { kind: "followup", blocks: [{ type: "text", text: "Noted — nothing else to change for this video." }] };
  const all = sys + "\n" + msgs.map((m) => textOf(m.content)).join("\n");
  const job = /jobs[\\/]([A-Za-z0-9][A-Za-z0-9._-]{4,})/.exec(all)?.[1];
  // Claude Code puts its "# Environment" block (Primary working directory) in a role:"system" message
  const cwd = /Primary working directory:\s*([^\n]+)/.exec(all)?.[1]?.trim();
  if (!job || !cwd) return { kind: "nojob", blocks: [{ type: "text", text: `FAKE-LLM: could not find the job id / working directory (job=${job}, cwd=${cwd}).` }] };
  const after = msgs.slice(hi + 1);
  const done = after.filter((m) => m.role === "assistant").reduce((a, m) => a + (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_use").length : 0), 0);
  const lastErr = after.length && isToolResultMsg(after.at(-1)) && after.at(-1).content.some((b) => b.type === "tool_result" && b.is_error);
  if (lastErr) return { kind: "error", step: done, blocks: [{ type: "text", text: `FAKE-LLM: step ${done} failed: ${textOf(after.at(-1).content).slice(0, 600)}` }] };
  const steps = s1Steps(job, cwd); const s = steps[Math.min(done, steps.length - 1)];
  if (s.final) return { kind: "final", step: done, job, blocks: [{ type: "text", text: s.final }] };
  return { kind: "tool", step: done, job, blocks: [...(s.say ? [{ type: "text", text: s.say }] : []), { type: "tool_use", id: `toolu_s1_${++counter.n}`, name: s.tool, input: s.input }] };
}

function reply(res, j, blocks, n) {
  const stop = blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
  const usage = { input_tokens: 1200, output_tokens: 60 };
  if (!j.stream) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ id: `msg_${n}`, type: "message", role: "assistant", model: j.model, content: blocks, stop_reason: stop, stop_sequence: null, usage })); }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
  w("message_start", { message: { id: `msg_${n}`, type: "message", role: "assistant", model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } });
  blocks.forEach((b, i) => {
    if (b.type === "text") { w("content_block_start", { index: i, content_block: { type: "text", text: "" } }); w("content_block_delta", { index: i, delta: { type: "text_delta", text: b.text } }); }
    else { w("content_block_start", { index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }); w("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }); }
    w("content_block_stop", { index: i });
  });
  w("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 60 } }); w("message_stop", {});
  res.end();
}

if (process.argv[1] && /s1-fake-upstream\.mjs$/.test(process.argv[1])) {
  const counter = { n: 0 }; let req = 0;
  createServer(async (rq, res) => {
    let body = ""; for await (const c of rq) body += c;
    const u = new URL(rq.url, "http://x");
    if (u.pathname.endsWith("/count_tokens")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ input_tokens: 1000 })); }
    if (!u.pathname.endsWith("/v1/messages")) { log({ path: u.pathname, status: 404 }); res.writeHead(404); return res.end("{}"); }
    let j; try { j = JSON.parse(body); } catch { res.writeHead(400); return res.end("{}"); }
    const d = decide(j, counter); req++;
    if (process.env.FAKE_SYS_DUMP && d.kind === "nojob") appendFileSync(process.env.FAKE_SYS_DUMP, sysOf(j) + "\n=====MSGS=====\n" + JSON.stringify(j.messages).slice(0, 20000) + "\n");
    log({ req, kind: d.kind, step: d.step, job: d.job, tools: (j.tools ?? []).length, model: j.model, stream: !!j.stream, out: d.blocks.map((b) => b.type === "tool_use" ? `${b.name} ${JSON.stringify(b.input).slice(0, 200)}` : b.text.slice(0, 200)), cwdCtx: (() => { const s = sysOf(j); const i = s.search(/working directory/i); return i >= 0 ? s.slice(Math.max(0, i - 200), i + 300) : s.slice(0, 200); })() });
    reply(res, j, d.blocks, req);
  }).listen(port, "127.0.0.1", () => console.log(`s1 fake upstream (FAKE-LLM) on ${port}`));
}
