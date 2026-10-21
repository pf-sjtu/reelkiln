// PARTIAL port of writeWorkspace (main/index.js L9650-9689) + initializeWorkspaceChannel
// (L4454-4467). Ported: the six workspace directories, the taste-pack seed copy
// (L9651-9662, verbatim loop) and the verbatim copy of the engine's .claude/settings.json
// (L9685-9688) — exactly what doctor's `workspace`, `hooks` and `taste packs` checks read.
// docs/21 M2: CLAUDE.md creation/migration (verbatim workspaceClaudeMd / migrateWorkspaceClaudeMd,
// L9664-9681, atomic tmp+rename) and validateEngineSessionContext (L4188) are now ported.
// NOT PORTED (logged by callers): auditWorkspaceChannel, ensureRealWorkspaceDirectory /
// assertRealWorkspaceFile symlink-escape guards.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrateWorkspaceClaudeMd, workspaceClaudeMd } from "../agent/session-assembly.generated";
import { validateEngineSessionContext } from "./session-context.generated";

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
  const claudeMd = join(ws, "CLAUDE.md"); // L9664-9681
  if (existsSync(claudeMd)) {
    const existing = readFileSync(claudeMd, "utf8");
    const migrated = migrateWorkspaceClaudeMd(existing);
    if (migrated !== existing) {
      const tmp = `${claudeMd}.tmp-${randomUUID()}`;
      try { writeFileSync(tmp, migrated, { mode: statSync(claudeMd).mode & 511 }); renameSync(tmp, claudeMd); } catch (error) { rmSync(tmp, { force: true }); throw error; }
    }
  } else {
    writeFileSync(claudeMd, workspaceClaudeMd());
  }
  validateEngineSessionContext(enginePath); // L9683
  writeFileSync(join(ws, ".claude", "settings.json"), readFileSync(join(enginePath, ".claude", "settings.json")));
  return { notPorted: ["auditWorkspaceChannel", "workspace symlink guards"] };
}
