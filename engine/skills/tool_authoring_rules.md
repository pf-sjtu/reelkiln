# Tool Authoring Rules — for `agent/tools/*.py`

Every new tool in this pipeline follows these rules. Existing tools that
violate them are documented bugs (see [tool_audit_status.md](_references/tool_audit_status.md))
and get patched on the next touch.

> **Why this doc exists:** the pipeline grew organically. Each tool made
> reasonable local choices that produced subtle global bugs:
> `.current_job` clobbering across concurrent jobs, `densify.py` PASS 2
> overwriting PASS 1 (broke re-densify), `script_preflight` checking
> chunk-time-vs-reference instead of chunk-duration-vs-Seedance-ceiling.
> These are all the same shape: tools assumed they ran in isolation, with
> no other tool/job sharing artifacts. The rules below prevent that class
> of bug going forward.

---

## Hard rules (the "if a tool violates these, it's a bug" list)

### 1. `--job` is REQUIRED on every tool. No global-state fallback.

```python
from job import resolve_job_dir, add_job_arg

parser = argparse.ArgumentParser()
add_job_arg(parser)  # adds --job as REQUIRED by default
args = parser.parse_args()
job_dir = resolve_job_dir(args.job)
```

The legacy `agent/output/.current_job` fallback caused silent clobbering
when multiple jobs ran in parallel. It was removed. Tools MUST take `--job`
explicitly. Only `pick_company.py` (which mints a new ID) is exempt.

### 2. Inputs and outputs must be DIFFERENT artifacts. Never read X then write X.

The single most common bug shape. If your tool's PASS 2 needs to read
PASS 1, snapshot PASS 1 to a separate artifact on first run.

❌ Wrong (densify.py shipped this; we hit the bug):
```python
transcript = json.loads(transcript_path.read_text())   # reads transcript.json
# ... derive new transcript ...
transcript_path.write_text(json.dumps(new_transcript)) # OVERWRITES the source
```
On re-run, the "input" is now the previous run's output. The
silence-clip logic uses PASS 2 timestamps (densified audio) on the
PASS 1 video (predensify) — wrong frame of reference. Output truncates.

✅ Right:
```python
transcript_pass1 = job_dir / "transcript_pass1.json"
if not transcript_pass1.exists():
    shutil.copy2(transcript_path, transcript_pass1)
transcript = json.loads(transcript_pass1.read_text())  # always read snapshot
# ... derive new transcript ...
transcript_path.write_text(json.dumps(new_transcript)) # safe to overwrite
```

**Naming convention:** `<artifact>_passN.json` where N is the pass number,
or `<artifact>_pre<step>.<ext>` (e.g. `final_raw_predensify.mp4`).

### 3. Idempotent on snapshot. Re-runs must produce the same result.

If a tool can be re-run with different parameters (e.g. `densify --speed 1.15`
after `densify --speed 1.22`), it must read the SNAPSHOT, not the prior
output. See rule 2.

Test:
```bash
uv run python agent/tools/foo.py --job <id>
uv run python agent/tools/foo.py --job <id>  # second run = same result
uv run python agent/tools/foo.py --job <id> --param 2  # different param = different result, but consistent
```

### 4. Verify the job dir matches `--job` after writing.

When a tool writes a file, log the actual path written and assert it's
under `<job_dir>/`. Catches the "I thought I was writing to job X but
actually wrote to job Y" failure mode.

```python
out_path = job_dir / "reference" / f"analysis__{name}.json"
out_path.write_text(json.dumps(merged, indent=2))
assert out_path.is_relative_to(job_dir), f"Wrote outside job dir: {out_path}"
log_event(job_dir, tool=__file__, event="artifact_written",
          extra={"path": str(out_path.relative_to(job_dir))})
```

### 5. Log every meaningful event via `log_event(job_dir, ...)`.

Tools talk to humans through `<job_dir>/run.md` (rendered from `run.log.jsonl`).
Events to log:
- `<tool>_started` — at top of main()
- `<tool>_artifact_written` — when an output file lands
- `<tool>_failed` — on exception (with last-1000-chars of stderr)
- Any per-step event the human would care about (`api_call_made`,
  `cache_hit`, `pass_completed`, etc.)

### 6. Standard CLI flags (in this order):

```python
add_job_arg(parser)                           # --job (required)
parser.add_argument("--regen", ...)           # for cacheable steps — overwrite cached output
parser.add_argument("--list", ...)            # for tools with libraries — list contents and exit
parser.add_argument("--quiet", ...)           # suppress stdout, log only
parser.add_argument("--dry-run", ...)         # show what WOULD happen, don't do it
```

Avoid one-off `--no-X` flags unless the negation is genuinely useful. Prefer
positive defaults (skip-by-default → `--enable-X`) over negative ones.

### 7. Validate inputs at the door. Fail fast and loud.

```python
if not (job_dir / "transcript.json").exists():
    sys.exit(f"ERROR: {job_dir / 'transcript.json'} not found. Run elevenlabs.py first.")
```

Don't let the tool run for 90 seconds before failing on a missing prereq.

### 8. Print a one-line "next step" hint at completion.

```python
print(f"\nDone. Next: uv run python agent/tools/densify.py --job {job_id}")
```

The pipeline is N steps deep. Help the human (or the next agent) know
what runs next.

### 9. External API calls go through a wrapper that logs cost.

```python
from log import log_api_call

result = log_api_call(
    job_dir,
    provider="replicate",
    model="bytedance/seedance-1-pro",
    fn=lambda: replicate.run(...),
    estimate_usd=lambda r: estimate_seedance_cost(r),
)
```

(See `cost_tracking.md` for the per-provider rate tables. This rule is the
foundation for `run.md` cost rollups.)

### 10. Cache external assets. Never re-fetch unless the source changed.

If you call Replicate / Gemini / ElevenLabs and the call is deterministic
on its inputs, hash the inputs and cache by hash. `--regen` overrides.
Library tools (`sfx.py`, `generate_image.py`) MUST cache by `<name>` and
no-op on cache hit.

---

## Soft rules (defaults, not laws)

### 11. Per-job artifacts in `<job_dir>/<category>/`. Library artifacts in `agent/<library>/`.

Per-job (deletable when the job ships):
- `<job_dir>/avatar/`, `<job_dir>/chunks/`, `<job_dir>/audio/`,
  `<job_dir>/cards/`, `<job_dir>/images/`, `<job_dir>/sfx/`, etc.

Library (durable across jobs):
- `agent/sfx_library/<category>/<name>.mp3`
- `agent/avatar_library/...` (future — for stable avatar archetypes)
- `agent/card_templates/...` (future)

When a tool generates something for a job AND it's reusable, write to the
library + copy into `<job_dir>/`. The job copy is what the renderer uses.

### 12. CLI tools should be importable as Python modules.

Wrap the CLI in `if __name__ == "__main__": sys.exit(main())` and expose
the core function (`def densify(job_dir, speed, ...) -> dict`) for other
tools to import. Lets the pipeline auto-chain steps without subprocess.

### 13. Heavy LLM/API calls run in parallel where safe.

If you're scoring N candidates or auditing N chunks via an LLM, use
`concurrent.futures.ThreadPoolExecutor`. The 6-chunk parallel pattern in
`script_preflight.py` is the reference implementation.

### 14. Ship the failure mode in the docstring.

Every tool's top-of-file docstring must include a "Common failure modes"
section. New users should learn the pitfalls from the docstring, not by
hitting them.

### 15. Tools never call other tools via subprocess. They import.

Subprocess calls add latency, lose error context, can't share Python
objects, and break in agent environments where shell is restricted. Import
the sibling tool's main function instead.

### 16. MCP/schema authoring: intent first, payloads last, IDs verbatim.

When a tool grows an MCP-facing schema (the future MCP surface promised in
CANONICAL_TOOLS.md): put intent/role/mode parameters FIRST in the schema —
models commit to intent before generating the big blob, which measurably
improves the blob — and large prompt/spec payloads LAST. Mark every
ID-shaped field (job id, voice_id, chunk index, model slug) with "copy
verbatim from the source artifact — never type from memory"; opaque IDs
retyped from memory are a classic silent-failure source (see
skills/voice.md's voice_id passthrough gotcha).

---

## When you ARE allowed to break a rule

These rules are based on bugs we actually shipped. If you have a stronger
reason to break one, DOCUMENT IT in:
1. The tool's docstring (top-of-file note)
2. The PR / commit message
3. A new entry in this file's "Documented exceptions" section below

If you find yourself wanting to break a rule, the answer is usually that
the rule should be amended. PR the rule first, then ship the violation.

## Documented exceptions

(Empty — every existing exception either gets fixed or earns a written
justification here.)
