// docs/36 M19: the deterministic S1 FAKE-LLM upstream (tools/s1-fake-upstream.mjs) — pure decision logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, s1Steps, BRIEF_MARK } from "../tools/s1-fake-upstream.mjs";

const JOB = "6-5-9-16-a-b-c-a-0-5-3-0-s-b-0-2-0-s-c-0-20261022-671bea";
const brief = (cwd: string) => ({ role: "user", content: [{ type: "text", text: `[APP-OWNED PRODUCTION ID]\njobs/${JOB}/ already exists.\n\n我有三段短素材和一段配乐。${BRIEF_MARK} 9:16 快剪` }] });
const env = (cwd: string) => ({ role: "system", content: [{ type: "text", text: `# Environment\n - Primary working directory: ${cwd}\n - Platform: x` }] });
const tools = [{ name: "Bash" }, { name: "Write" }];

test("s1 fake: walks the scripted S1 edit step by step from the tool_use count", () => {
  const msgs: any[] = [brief("/w/Videoclaw"), env("/w/Videoclaw")];
  const kinds: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d: any = decide({ tools, messages: msgs });
    kinds.push(d.kind === "tool" ? d.blocks.at(-1).name : d.kind);
    if (d.kind !== "tool") break;
    const tu = d.blocks.at(-1);
    msgs.push({ role: "assistant", content: d.blocks }, { role: "user", content: [{ type: "tool_result", tool_use_id: tu.id, content: "ok" }] });
  }
  assert.deepEqual(kinds, ["Bash", "Bash", "Write", "Bash", "Bash", "Bash", "final"]);
  const write = s1Steps(JOB, "/w/Videoclaw")[2] as any;
  assert.equal(write.input.file_path, `/w/Videoclaw/jobs/${JOB}/edl.json`);
  assert.equal(JSON.parse(write.input.content).beats.length, 3);
  assert.match((s1Steps(JOB, "/w")[5] as any).input.command, /compose_render\.py" --job .* --mode render --resolution 720p --no-captions --no-overlays 2>&1 \| tail -n 40$/);
});

test("s1 fake: Windows working directory → backslash Write path; errors stop the script; follow-ups and monitors", () => {
  assert.equal((s1Steps(JOB, "D:\\a\\_temp\\run\\Videoclaw")[2] as any).input.file_path, `D:\\a\\_temp\\run\\Videoclaw\\jobs\\${JOB}\\edl.json`);
  const msgs: any[] = [brief("x"), env("/w"), { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "boom" }] }];
  assert.equal((decide({ tools, messages: msgs }) as any).kind, "error");
  assert.equal((decide({ tools, messages: [...msgs, { role: "user", content: "remember this" }] }) as any).kind, "followup");
  assert.equal((decide({ system: "You are a security monitor for autonomous agents", messages: [] }) as any).blocks[0].text, "<block>no</block>");
  assert.equal((decide({ messages: [{ role: "user", content: "title?" }] }) as any).kind, "notools");
  assert.equal((decide({ tools, messages: [brief("x")] }) as any).kind, "nojob"); // no Environment block
});
