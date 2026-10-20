// PARTIAL port of writeWorkspace (main/index.js L9650-9689) + initializeWorkspaceChannel
// (L4454-4467). Ported: the six workspace directories, the taste-pack seed copy
// (L9651-9662, verbatim loop) and the verbatim copy of the engine's .claude/settings.json
// (L9685-9688) — exactly what doctor's `workspace`, `hooks` and `taste packs` checks read.
// NOT PORTED (logged by callers): auditWorkspaceChannel, ensureRealWorkspaceDirectory /
// assertRealWorkspaceFile symlink-escape guards, CLAUDE.md creation/migration
// (workspaceClaudeMd / migrateWorkspaceClaudeMd), validateEngineSessionContext.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const WORKSPACE_DIRS = ["jobs", "assets", "incoming", "taste", join("taste", "packs"), ".claude"]; // L4456-4463

export function writeWorkspacePartial(enginePath: string, ws: string): { notPorted: string[] } {
  for (const d of WORKSPACE_DIRS) mkdirSync(join(ws, d), { recursive: true });
  for (const pack of ["_starter", "_default"]) {
    const dst = join(ws, "taste", "packs", pack);
    if (existsSync(dst)) continue;
    const src = join(enginePath, "taste", "packs", pack);
    if (!existsSync(src)) continue;
    mkdirSync(dst, { recursive: true });
    for (const f of readdirSync(src)) if (statSync(join(src, f)).isFile()) writeFileSync(join(dst, f), readFileSync(join(src, f)));
  }
  writeFileSync(join(ws, ".claude", "settings.json"), readFileSync(join(enginePath, ".claude", "settings.json")));
  return { notPorted: ["CLAUDE.md (workspaceClaudeMd/migrateWorkspaceClaudeMd)", "validateEngineSessionContext L4188", "workspace symlink guards"] };
}
