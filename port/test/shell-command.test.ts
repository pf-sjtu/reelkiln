import { test } from "node:test";
import assert from "node:assert/strict";
import { withOutputPipefail, tokenizeShell, splitPipelineOnly } from "../src/main/engine/shell-command";
import { loadOriginalChunk } from "./original-loader";

const CORPUS = [
  'uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools/mint_image.py" --job j1 | tail -n 20',
  'cd "$VIDEOCLAW_ENGINE" && uv run python tools/doctor.py --json | jq .ok',
  'cd ${VIDEOCLAW_ENGINE:-/x} && uv run python tools/a.py 2>&1 | tail -5',
  "uv run python tools/a.py | python -c 'print(1)'",
  "uv run python tools/a.py | /usr/bin/tail -n 3",
  'uv run python tools/a.py | "tail" -n 3',
  "echo a; echo b | tail",
  "a || b | tail",
  "a | tail &",
  "a 2>&1 | grep -v x | wc -l",
  "a | grep $(whoami)",
  "a | grep 'unclosed",
  "a |\n tail",
  "a\n| tail",
  "ls",
  "",
  "a | | tail",
  "a | cut -d, -f1 | uniq | tr a b | head -1 | cat | egrep x | fgrep y",
  "a | tail \\\n -n 1",
  'a | grep "x\\"y"',
  "a | grep x > out.txt",
  "a | grep x >/dev/null 2>&1",
];

test("withOutputPipefail is identical to the shipped bundle (chunk export a6) on a corpus", async () => {
  const orig = await loadOriginalChunk("workbookContents-");
  assert.equal(typeof orig.a6, "function");
  for (const c of CORPUS) assert.equal(withOutputPipefail(c), orig.a6(c), JSON.stringify(c));
  // sanity: at least one case gets pipefail and one does not
  assert.ok(CORPUS.some((c) => withOutputPipefail(c).startsWith("set -o pipefail\n")));
  assert.ok(CORPUS.some((c) => withOutputPipefail(c) === c));
});

test("tokenizer / splitter basics", () => {
  assert.deepEqual(splitPipelineOnly("a | b"), ["a", "b"]);
  assert.equal(splitPipelineOnly("a; b"), null);
  assert.equal(tokenizeShell("tail -n 3").tokens[0].value, "tail");
  assert.equal(tokenizeShell("echo $X").opaque, true);
});
