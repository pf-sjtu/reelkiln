// Session layer needed by editorRender and engine-spawning handlers.
//  - engineSessionEnv (main/index.js L9380-9418): ported line-for-line with its module-level
//    collaborators injected (currentEngine, workspaceRoot, enginePath_, configured gateway,
//    studio bundle store). Both injected "configs" default to the ORIGINAL's unconfigured
//    state: configuredGatewayEnv returns {} until configureEngineGatewaySession ran (L9372),
//    studioBundleSessionEnv returns {} until configureStudioBundleStore ran (L8192).
//  - SessionRegistry: READ-ONLY subset of AgentHost.loadRegistry (L35661-35830) +
//    listSessions (L38348) + isDeleting (L39154) — the part the session-scoped handlers
//    (editorRender/hfPreview/workflowSubmission `getSession`) consume. Not ported: the
//    agent runtime, createSession (L38726), beacons, title fallback from transcripts,
//    retirePlanContract, healCodexPermissionMode, healSessionCwd, media recovery.
//  - docs/21 M2: registry WRITES — writeRegistry (L36199, merge-with-disk, tmp+fsync+rename) for
//    the rows the AgentHost owns, DEFAULT_CLIENTS (L34377), listClients / createClient (L36329-36365)
//    with projectNameError (L288) verbatim.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { validateInstalledEngineSessionContext, SessionContextError } from "./session-context.generated";
import { UV_PYTHON_POLICY_ENV } from "./bootstrap";

export interface SessionEnvDeps {
  currentEngine: () => { path: string; buildSha256?: string } | null;
  workspaceRoot: () => string;
  enginePathEnv: (enginePath: string) => string; // enginePath_ L9313
  /** engineGatewaySessionConfig (L9332); undefined = not configured (original initial state). */
  gatewaySessionConfig?: () => { gatewayUrl: string } | undefined;
  /** processStore$1?.sessionEnv (L8192); undefined store = {} (original initial state). */
  studioSessionEnv?: (gatewayUrl?: string) => Record<string, string> | undefined;
}

export function configuredGatewayEnv(d: SessionEnvDeps, gatewayKey?: string, gatewayUrlOverride?: string): Record<string, string> { // L9372
  const cfg = d.gatewaySessionConfig?.();
  if (!cfg) return {};
  return {
    VIDEOCLAW_GATEWAY_URL: gatewayUrlOverride?.replace(/\/+$/, "") ?? cfg.gatewayUrl,
    ...(gatewayKey ? { VIDEOCLAW_API_KEY: gatewayKey } : {}),
  };
}

export function engineSessionEnv(d: SessionEnvDeps, gatewayKey?: string, gatewayUrlOverride?: string): Record<string, string> { // L9380
  const gatewayEnv = configuredGatewayEnv(d, gatewayKey, gatewayUrlOverride);
  const studioEnv = d.studioSessionEnv?.(gatewayUrlOverride) ?? {};
  const qaEnv = { VIDEOCLAW_FINAL_QA_AUTHORITY: "videoclaw.app-final-qa/v1" };
  const eng = d.currentEngine();
  if (!eng) return { ...gatewayEnv, ...studioEnv, ...qaEnv };
  const ws = d.workspaceRoot();
  const contextHashes = validateInstalledEngineSessionContext(eng.path, eng.buildSha256);
  const buildSha256 = contextHashes.engineBuildSha256;
  const problems: string[] = [];
  let effectiveSettingsSha256: string | undefined;
  try {
    effectiveSettingsSha256 = createHash("sha256").update(readFileSync(join(ws, ".claude", "settings.json"))).digest("hex");
  } catch {
    problems.push("the effective workspace settings are missing or unreadable");
  }
  if (effectiveSettingsSha256 && effectiveSettingsSha256 !== contextHashes.engineSettings) {
    problems.push("the effective workspace settings differ from the verified engine settings");
  }
  if (problems.length > 0) throw new SessionContextError(problems);
  return {
    ...gatewayEnv,
    ...studioEnv,
    ...qaEnv,
    VIDEOCLAW_ENGINE: eng.path,
    VIDEOCLAW_WORKSPACE: ws,
    VIDEOCLAW_JOBS_DIR: join(ws, "jobs"),
    VIDEOCLAW_CONTEXT_EPOCH: randomUUID(),
    VIDEOCLAW_ENGINE_BUILD_SHA256: buildSha256,
    VIDEOCLAW_EFFECTIVE_LAWS_SHA256: contextHashes.laws,
    VIDEOCLAW_EFFECTIVE_PREFLIGHT_SHA256: contextHashes.preflightBlock,
    VIDEOCLAW_EFFECTIVE_SETTINGS_SHA256: effectiveSettingsSha256!,
    ...UV_PYTHON_POLICY_ENV,
    PATH: d.enginePathEnv(eng.path),
  };
}

// workbookContents chunk L141-144 (CLIENT_JOB_ID_RE / isClientJobId), verbatim.
const CLIENT_JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function isClientJobId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_JOB_ID_RE.test(value);
}
/** expandTilde$1 L34408. PORT: also `~\` on win32. */
export function expandTilde(p: string, home = homedir(), plat: NodeJS.Platform = process.platform): string {
  return plat === "win32" ? p.replace(/^~(?=$|[\\/])/, home) : p.replace(/^~(?=$|\/)/, home);
}

/** Fields loadRegistry strips from the persisted meta before exposing it (L35700-35722). */
const PRIVATE_META_KEYS = ["postCompactRouteBarrier", "contextEpoch", "acceptedOperations", "claudeAllowanceExhausted", "claudeAllowanceTurnIds", "creditContinuation", "completedModelResults", "lateResultReports", "lateResultLines", "lateResultFailures", "sessionPlan", "sessionPlanDetails", "dismissedSessionPlan", "sessionPlanRequired", "pulseJourney", "pulseEligible", "mediaRecoveryNeeded", "mediaRecoveryIssue", "versionDone", "liveWork", "turnStartedAtMs", "pendingPermissionMode", "permissionModeSwitchFailed"];
const NEW_VIDEO_TITLE_PLACEHOLDER_OLD = "New session";
export const NEW_VIDEO_TITLE = "New video"; // L266

export const DEFAULT_CLIENTS = [{ clientId: "personal", name: "Personal" }]; // L34377
export function projectNameError(name: unknown, projects: Array<{ clientId: string; name: string }>, currentId?: string): string | null { // L288
  if (typeof name !== "string" || !name.trim()) return "Enter a project name.";
  if (name.trim().length > 80) return "Use 80 characters or fewer.";
  if (/[\u0000-\u001f\u007f]/.test(name.trim()))
    return "Remove the unsupported character from the name.";
  const normalized = name.trim().normalize("NFKC").toLowerCase();
  if (
    projects.some(
      (p) =>
        p.clientId !== currentId && p.name.trim().normalize("NFKC").toLowerCase() === normalized,
    )
  ) {
    return "A project already uses that name.";
  }
  return null;
}

export interface SessionMeta { sessionId: string; cwd: string; jobId?: string; clientId: string; status: string; title?: string; runtime?: string; createdAt?: number; sidebarOrder?: number; [k: string]: unknown }

export class SessionRegistry {
  sessions = new Map<string, { meta: SessionMeta }>();
  clients: { clientId: string; name: string; tenant?: string }[] = [];
  /** docs/26: AgentHost.trashWorkspaces (L34844) — workspaces holding a `.videoclaw-trash` (deleteProject L39270). */
  trashWorkspaces = new Set<string>();
  constructor(readonly registryFile: string, private o: { now?: () => number } = {}) {}
  /** loadRegistry L35661 (read-only subset; see header). Returns whether healing changed anything. */
  load(): boolean {
    this.sessions.clear();
    let raw: any;
    try {
      raw = JSON.parse(readFileSync(this.registryFile, "utf-8"));
    } catch {
      this.clients = [...DEFAULT_CLIENTS]; // original also: corrupt-copy + beacon + recoverOrphanSessions — NOT PORTED
      return false;
    }
    const metas: any[] = Array.isArray(raw) ? raw : (raw.sessions ?? []);
    this.clients = Array.isArray(raw) ? [...DEFAULT_CLIENTS] : (raw.clients ?? [...DEFAULT_CLIENTS]);
    if (!Array.isArray(raw) && Array.isArray(raw.trashWorkspaces)) for (const w of raw.trashWorkspaces) if (typeof w === "string" && isAbsolute(w)) this.trashWorkspaces.add(w);
    let healedAny = false;
    for (const meta of metas) {
      if (!meta || typeof meta.sessionId !== "string") continue;
      const interruptedFromStatus = meta.status === "running" || meta.status === "awaiting_permission" ? meta.status : undefined;
      if (interruptedFromStatus) healedAny = true;
      const publicMeta = { ...meta };
      for (const k of PRIVATE_META_KEYS) delete publicMeta[k];
      const healed: SessionMeta = {
        ...publicMeta,
        clientId: meta.clientId ?? "personal",
        title: meta.title === NEW_VIDEO_TITLE_PLACEHOLDER_OLD ? NEW_VIDEO_TITLE : meta.title,
        status: "idle",
        ...(interruptedFromStatus ? { interruptedAtMs: (this.o.now ?? Date.now)(), interruptedFromStatus } : {}),
      };
      if (healed.jobId && !isClientJobId(healed.jobId)) { delete healed.jobId; healedAny = true; } // L35761
      if ((healed as any).adoptCandidate?.jobId && !isClientJobId((healed as any).adoptCandidate.jobId)) { delete (healed as any).adoptCandidate; healedAny = true; }
      if (healed.jobId && (healed.runtime ?? "local") === "local" && !existsSync(join(expandTilde(healed.cwd), "jobs", healed.jobId))) { // L35773
        delete healed.jobId;
        healedAny = true;
      }
      if (healed.jobId && (healed as any).adoptCandidate) { delete (healed as any).adoptCandidate; healedAny = true; } // L35823
      this.sessions.set(meta.sessionId, { meta: healed });
    }
    return healedAny;
  }
  /** listSessions L38348: meta + liveWork snapshot + media recovery (NOT PORTED → [] / false). */
  listSessions() {
    const projectRank = new Map(this.clients.map((c, i) => [c.clientId, i]));
    return [...this.sessions.values()]
      .map((s) => ({ ...s.meta, liveWork: [] as unknown[], mediaRecoveryNeeded: false }))
      .sort((a, b) => {
        const projectDelta = (projectRank.get(a.clientId) ?? Number.MAX_SAFE_INTEGER) - (projectRank.get(b.clientId) ?? Number.MAX_SAFE_INTEGER);
        if (projectDelta !== 0) return projectDelta;
        const aOrder = a.sidebarOrder, bOrder = b.sidebarOrder;
        if (aOrder !== undefined || bOrder !== undefined) {
          if (aOrder === undefined) return 1;
          if (bOrder === undefined) return -1;
          if (aOrder !== bOrder) return aOrder - bOrder;
        }
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      });
  }
  /** Hand the healed rows to the AgentHost (which then owns them) and stop serving them here. */
  takeSessions(): SessionMeta[] { const rows = [...this.sessions.values()].map((s) => s.meta); this.sessions.clear(); return rows; }
  listClients() { return [...this.clients]; } // L36329
  createClient(name: unknown, save: () => void) { // L36346
    const error = projectNameError(name, this.clients);
    if (error) throw new Error(error);
    const trimmed = (name as string).trim();
    const base =
      trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 32) || randomUUID().slice(0, 8);
    let clientId = base;
    while (this.clients.some((client2) => client2.clientId === clientId)) {
      clientId = `${base.slice(0, 23)}-${randomUUID().slice(0, 8)}`;
    }
    const client = { clientId, name: trimmed };
    this.clients.push(client);
    save();
    return client;
  }
  /** docs/25: removeClient's tombstones (original removedClientIds / removedSessionIds) so a whole-file
   *  write never resurrects a removed project or its videos from the on-disk copy. */
  removedClientIds = new Set<string>();
  removedSessionIds = new Set<string>();
  getClient(clientId: string) { return this.clients.find((c) => c.clientId === clientId); } // L36380
  /** reorderClients (L36332) — client:reorder. */
  reorderClients(clientIds: unknown, save: () => void) {
    const ids = Array.isArray(clientIds) ? clientIds : [];
    const current = new Set(this.clients.map((client) => client.clientId));
    if (
      ids.length !== this.clients.length ||
      new Set(ids).size !== ids.length ||
      ids.some((clientId) => !current.has(clientId))
    ) {
      throw new Error("project reorder must contain every project exactly once");
    }
    const byId = new Map(this.clients.map((client) => [client.clientId, client]));
    this.clients = ids.map((clientId) => byId.get(clientId)!);
    save();
    return this.listClients();
  }
  /** renameClient (L36367) — client:rename. `flush` = writeRegistry(); false → roll back. */
  renameClient(clientId: string, name: unknown, flush: () => boolean) {
    const client = this.getClient(clientId);
    if (!client) return { error: "This project is no longer available." };
    const error = projectNameError(name, this.clients, clientId);
    if (error) return { error };
    const previous = client.name;
    client.name = (name as string).trim();
    if (!flush()) {
      client.name = previous;
      return { error: "The project name could not be saved. Try again." };
    }
    return { ...client };
  }
  /** removeClient (L36384) — client:remove: sidebar records only; files and media stay on disk.
   *  `busy(sessionIds)` stands in for the original's deletion/recovery blockers (port: a running turn). */
  removeClient(clientId: string, sessionIds: string[], busy: boolean, flush: () => boolean, removeSession: (id: string) => void) {
    if (clientId === "personal" || !this.getClient(clientId)) {
      return { error: "This project cannot be removed." };
    }
    if (busy) return { error: "Finish running or recovering work in this project before removing it." };
    const previous = this.clients;
    this.clients = previous.filter((client) => client.clientId !== clientId);
    this.removedClientIds.add(clientId);
    for (const id of sessionIds) this.removedSessionIds.add(id);
    if (!flush()) {
      this.clients = previous;
      this.removedClientIds.delete(clientId);
      for (const id of sessionIds) this.removedSessionIds.delete(id);
      return { error: "The project could not be removed. Your chats are still here; try again." };
    }
    for (const id of sessionIds) { this.sessions.delete(id); removeSession(id); }
    return this.listClients();
  }
  /** setClientTenant (L36424) — library:setTenant: bind a client to a media-library tenant slug. */
  setClientTenant(clientId: string, tenant: unknown, save: () => void) {
    const client = this.clients.find((c) => c.clientId === clientId);
    if (!client) throw new Error(`unknown client: ${clientId}`);
    client.tenant =
      String(tenant ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "-")
        .slice(0, 40) || clientId;
    save();
    return client;
  }
  /** seedProjectPack (L36444) — project:seedPack: bind the tenant, write taste/packs/<slug>/README.md. */
  seedProjectPack(clientId: string, cwd: string, brief: unknown, save: () => void, writeProjectPack: (cwd: string, slug: string, name: string, brief: string) => string) {
    const client = this.getClient(clientId);
    if (!client) throw new Error(`unknown client: ${clientId}`);
    const tenant = client.tenant ?? this.setClientTenant(clientId, client.name, save).tenant!;
    const packPath = writeProjectPack(cwd, tenant, client.name, String(brief ?? ""));
    return { client: this.getClient(clientId), packPath };
  }
  /** writeRegistry (L36199) for `rows` (the AgentHost's registryRows()): whole-file write that
   *  carries through disk rows/clients this instance never saw; tmp → fsync → rename → fsync dir. */
  writeRegistry(rows: Array<Record<string, any>>, ownIds: Set<string> = new Set(rows.map((r) => r.sessionId))): boolean {
    try {
      mkdirSync(dirname(this.registryFile), { recursive: true });
      const sessions = rows.filter((r) => !this.removedSessionIds.has(r.sessionId));
      const clients = [...this.clients];
      let migrations: unknown, trashWorkspaces: unknown[] = [];
      try {
        const disk = JSON.parse(readFileSync(this.registryFile, "utf-8"));
        const diskSessions = Array.isArray(disk) ? disk : (disk?.sessions ?? []);
        for (const meta of diskSessions) {
          if (!meta || typeof meta.sessionId !== "string") continue;
          if (ownIds.has(meta.sessionId) || this.sessions.has(meta.sessionId) || this.removedSessionIds.has(meta.sessionId)) continue;
          sessions.push(meta);
        }
        if (!Array.isArray(disk)) { migrations = disk?.migrations; if (Array.isArray(disk?.trashWorkspaces)) trashWorkspaces = disk.trashWorkspaces.filter((r: unknown) => typeof r === "string" && isAbsolute(r)); }
        for (const w of trashWorkspaces) if (typeof w === "string") this.trashWorkspaces.add(w);
        const diskClients = Array.isArray(disk) ? [] : (disk?.clients ?? []);
        for (const c of diskClients) {
          if (!c || typeof c.clientId !== "string") continue;
          if (!clients.some((k) => k.clientId === c.clientId) && !this.removedClientIds.has(c.clientId)) clients.push(c);
        }
      } catch {}
      sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      trashWorkspaces = [...this.trashWorkspaces].sort();
      const temporary = `${this.registryFile}.${randomUUID()}.tmp`;
      try {
        const fd = openSync(temporary, "wx", 384);
        try { writeFileSync(fd, JSON.stringify({ clients, sessions, migrations, trashWorkspaces }, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temporary, this.registryFile);
        if (process.platform !== "win32") { const directory = openSync(dirname(this.registryFile), "r"); try { fsyncSync(directory); } finally { closeSync(directory); } } // PORT: no dir fsync on win32
      } finally {
        rmSync(temporary, { force: true });
      }
      return true;
    } catch (err) {
      console.error("registry save failed", err);
      return false;
    }
  }
  isDeleting(_sessionId: string): boolean { return false; } // L39154: deletions are not ported, so none is ever in flight
  /** liveSession L62403 */
  liveSession = (sessionId: string) => (this.isDeleting(sessionId) ? undefined : this.listSessions().find((s) => s.sessionId === sessionId));
}
void isAbsolute;
