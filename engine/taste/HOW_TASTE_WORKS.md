# HOW TASTE WORKS — layers, scopes, and the capture protocol

Read this before producing for any tenant. It defines (1) the **layers** an agent
resolves through to make a video, (2) the **scope matrix** — taste, molecules, and
workflows each exist at three scopes, and (3) the **capture protocol** that keeps the
system visibly learning with the user. The SessionStart hook injects a pointer to this
file plus every scope's COMMITMENTS verbatim.

---

## The layers (general → specific)

```
 Layer 1   CORE TOOLS      what each primitive can do        CANONICAL_TOOLS.md
             ↓             (mint_image, assemble, compose_render, …)
 Layer 1.5 MOLECULES       reusable multi-tool moves          skills/molecules.md
             ↓             (intent-indexed; craft in skills/craft_laws.md)
 Layer 2   WORKFLOWS       recipes → a good generic video     workflows/ (route via README)
             ↓
 Layer 3   TASTE           who chose what — THREE SCOPES,     see the matrix below
                           one schema, resolved most-specific-wins
```

**Layer 3 is not one layer — it's a matrix.** Taste, molecules, and workflows each
exist at three scopes:

| | LIBRARY (this repo — tenant-neutral) | USER (cross-tenant, visible, editable) | TENANT (per client/project) |
|---|---|---|---|
| **Taste** | `taste/packs/_default/` — the smart defaults + variation policy | `taste/GLOBAL.md` — the user's standing preferences | `taste/packs/<tenant>/README.md` + components |
| **Molecules** | `skills/molecules.md` | `taste/user_molecules.md` | the pack's "Example sequences" |
| **Workflows** | `workflows/*.md` | `taste/workflow_deltas.md` — DELTAS, never forks | the pack's COMMITMENTS |

**Resolution: TENANT > USER > DEFAULT**, field by field, one code path — the user file
and the default pack are shaped like tenant packs precisely so nothing special-cases.
When a field resolves from `_default`, **name it at use time** ("no caption preference
on file → used `tiktok`; say the word and I'll lock yours") — a default used silently
is a bug; a default named is a capture opportunity.

Scope routing in one line: *brand choices → tenant pack · how this human works across
tenants → GLOBAL.md · universal craft → the library (craft_laws / styles / molecules).*

*(App-world note: the engine/workspace split already homes `taste/` workspace-side —
in the shipped app the USER and TENANT scopes are the user's visible repo, and the
library scope ships with the engine. Tenant packs migrate with the workspace; nothing
here needs to change shape for that.)*

---

## The capture protocol — mechanical, always-followed

The goal: the user tangibly experiences videoclaw learning with them — surfaced when it
should be, silent when it should be, and every byte of it visible and editable in the
files above (each entry dated, with provenance).

### Four signal classes → four behaviors

1. **Explicit standing instruction** ("always use my real voice", "never all-caps") →
   write the commitment IMMEDIATELY at the stated scope, dated, and confirm in one line.
   Surfaced — the confirmation is the learning moment.
2. **Correction of output** ("music's too loud", "hate this font") → append a SILENT
   observation at the current tenant's scope; the acknowledgment comes free with the fix
   you're already making. No extra ceremony.
3. **Implicit single preference** (picked B of 3 candidates, praised a look) → SILENT
   append to the observations ledger. One data point is not taste.
4. **Promotion** — the same signal observed **2×** → propose locking it as a commitment:
   one line, one-tap, ONLY at a natural checkpoint (video delivered / job done — never
   mid-generation). **Cap: ≤2 proposals per session**; the rest stay queued in the
   ledger. This is the ONLY unprompted surfacing the protocol allows.

### The ledgers

Append-only JSONL, one object per line —
`{"ts": "...", "job": "<id>", "scope": "user|<tenant>", "signal": "<short slug>",
"quote": "<what the user actually said/did>"}`:
- user scope → `taste/observations.jsonl`
- tenant scope → `taste/packs/<tenant>/observations.jsonl`
Create on first write. Observations are NEVER surfaced on their own; only promotions.

### Scope routing rules

- Default capture scope = **the current job's tenant**.
- The same preference confirmed across **2+ tenants** → propose promoting it to USER
  scope (`GLOBAL.md`).
- A user molecule proven tenant-neutral (or across 2+ tenants) → propose promoting it
  into the library (`skills/molecules.md`, with provenance).
- Ask about scope only when the user's phrasing is ambiguous AND the stakes are real.

### Silence guarantees

- A declined proposal → dated entry under **ANTI-COMMITMENTS** in the scope file. Never
  re-raise it.
- Never capture what the repo already records (code, git history, library docs).
- Ground truth only: capture what the user SAID or what their shipped reels SHOW — never
  infer a spec from a generic defaults block.
- When a capture supersedes an earlier (wrong) value, leave a one-line note so the
  mistake can't mislead the next agent.

### What to capture where — the quick table

| The user… | Do | Where |
|---|---|---|
| states a standing rule ("always X") | write it now, confirm in one line | the stated scope's COMMITMENTS |
| settles a brand choice (font, grade, handle, placement) | write it now | tenant pack (+ `fonts.ts` if a font) |
| likes a b-roll style / sequence / beat pattern | write it now | tenant pack "Example sequences"; generic → `skills/broll_styles.md` |
| corrects an output | fix it + silent observation | tenant `observations.jsonl` |
| picks A over B, praises something | silent observation | the scope's `observations.jsonl` |
| shows the same signal a 2nd time | propose promotion at delivery | → COMMITMENTS on approval |
| declines a proposal | record it, drop it forever | ANTI-COMMITMENTS |
| asks for a video type no workflow covers | compose from nearest reads (router); propose a workflow once it SHIPS | `workflows/<new>.md` (provenance rule) |
| repeats a multi-tool move that isn't a library molecule | write it after 2nd use | `taste/user_molecules.md` |
| keeps overriding the same workflow step | write the delta after 2nd time | `taste/workflow_deltas.md` |

### Telemetry note

Every capture, promotion, and decline should also emit a structured event alongside
`run.log.jsonl` (the app's server side measures learning velocity from these). Format
follows the ledger objects; emission is best-effort, never blocking.
