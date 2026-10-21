// PORT-NEW glue (docs/29 §3): the AgentHost project-memory + session-plan surface (original L36453-36870,
// L36986-37460) over the VERBATIM ProjectMemoryStore (project-memory.generated.ts).
//
// Faithfulness notes:
//  * memoryBinding (L36456) is the original check: a verified projectMemoryAuthority (main L61128 — set by
//    resolveAccount when the stored key verifies against the gateway; with the docs/28 local gateway shim that is
//    the self-hosted local-studio account), a known, non-removed client, and the authority's gateway == settings'.
//  * The store is the original's LOCAL file (userData/memory/<sha(gateway,keyId)>/projects/<sha(clientId)>/MEMORY.md).
//    The original has no gateway-side memory API — the brief's "shim memory API" therefore maps to this local
//    persistence (docs/29 §3 records the deviation).
//  * retainMemorySource (Library copy) is only reached from the agent's project_memory tool (callProjectMemory
//    L36895, studio MCP — not ported); the IPC path calls updateProjectMemory with no retained sources.
//  * docs/30: session plans are created by the studio MCP tool propose_session_plan (L48527); the lifecycle lives in
//    studio/session-plan-host.ts and is attached here by AgentHost.attachStudio (without it: null / "missing").
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import {
  PROJECT_MEMORY_MAX_SOURCES, projectMemorySourceKey, projectMemoryFile, ProjectMemoryError, ProjectMemoryStore, memoryError,
  SessionPlanStateError,
} from "./project-memory.generated";
import { displayTranscriptPath, readDisplayTranscript } from "../agent/history.generated";
import { projectMemoryToolSchema } from "../studio/studio-tools.generated";
import { PROJECT_MEMORY_GUIDANCE } from "../agent/session-assembly.generated";
import type { SessionPlanHost } from "../studio/session-plan-host";
import { resolveJobDir } from "../engine/job-boundary";
import { VersionStore } from "../jobs/version-store.generated";
import { redact } from "../feedback/feedback.generated";
import { join, isAbsolute, relative } from "node:path";
import { realpathSync } from "node:fs";
// appendDisplayMemory (L53034) — the display-transcript sidecar line a memory notice adds
import { appendFileSync, mkdirSync } from "node:fs";
import { CharacterVoiceError, CharacterVoiceStore } from "../characters/character-voice-store.generated";
const DISPLAY_MEMORY_VERSION = 7; // L52944
function appendDisplayMemory(file: string, memory: unknown, afterAssistantMessageId?: string): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `\n${JSON.stringify({ version: DISPLAY_MEMORY_VERSION, memory, ...(afterAssistantMessageId ? { afterAssistantMessageId } : {}) })}\n`, "utf8");
    return true;
  } catch { return false; }
}

export interface MemoryAuthority { gatewayUrl: string; canonicalKeyId: string }
export interface MemorySessionView { meta: { sessionId: string; clientId: string; cwd: string; jobId?: string }; lastAssistantMessageId?: string }
export interface ProjectMemoryHostDeps {
  /** userData (original dirname(this.registryFile)) */
  stateDir: string;
  /** main's projectMemoryAuthority (L61128) */
  authority: () => MemoryAuthority | null;
  settingsGatewayUrl: () => string;
  authenticatedWorkPaused?: () => boolean;
  getClient: (clientId: string) => { clientId: string; tenant?: string } | undefined;
  isClientRemoved: (clientId: string) => boolean;
  session: (sessionId: string) => MemorySessionView | undefined;
  sessions: () => MemorySessionView[];
  isSessionGone: (sessionId: string) => boolean;
  libraryStats?: (cwd: string, tenant: string) => Promise<{ tenant: string; sources: Array<{ path: string; exists: boolean }> }>;
  emitProjectMemoryChanged: (event: { clientId: string; change: unknown; sessionId?: string; notice?: unknown; authority: MemoryAuthority }) => void;
  emitSessionEvent?: (sessionId: string, event: unknown) => void;
  store?: InstanceType<typeof ProjectMemoryStore>;
  /** docs/34 M17: AgentHost.characterStore (L35028) — the CharacterVoiceStore (L35029) reads characters through it. */
  characterStore?: unknown;
  /** docs/34 M17: emit.characterVoicesChanged (L61104) → characters:voices:changed */
  emitCharacterVoicesChanged?: (scope: { clientId: string; gatewayUrl: string; canonicalKeyId: string }) => void;
}

export class ProjectMemoryHost {
  readonly projectMemoryStore: any;
  readonly characterVoiceStore: any;
  constructor(private readonly d: ProjectMemoryHostDeps) {
    this.projectMemoryStore = d.store ?? new ProjectMemoryStore();
    this.characterVoiceStore = new (CharacterVoiceStore as any)(d.characterStore); // L35029
  }

  // ── characters: saved voices (L45019-45063, transcribed; the store is verbatim) ──
  characterVoiceContext(clientId: string, scope?: { clientId: string; gatewayUrl: string; canonicalKeyId: string }) { // L45019
    const binding = this.memoryBinding(clientId);
    if (
      scope &&
      (scope.clientId !== clientId ||
        scope.gatewayUrl.replace(/\/+$/, "") !== binding.gatewayUrl.replace(/\/+$/, "") ||
        scope.canonicalKeyId !== binding.canonicalKeyId)
    ) {
      throw new (CharacterVoiceError as any)("The active account changed. Reopen Characters before continuing.");
    }
    const assertCurrent = () => {
      if (JSON.stringify(this.memoryBinding(clientId)) !== JSON.stringify(binding))
        throw new (CharacterVoiceError as any)("The active account changed.");
    };
    return { binding, assertCurrent };
  }
  async readCharacterVoices(scope: any) { // L45036
    const { binding, assertCurrent } = this.characterVoiceContext(scope.clientId, scope);
    return this.characterVoiceStore.list(binding, assertCurrent);
  }
  emitCharacterVoices(binding: { clientId: string; gatewayUrl: string; canonicalKeyId: string }) { // L45041
    try {
      this.d.emitCharacterVoicesChanged?.({ clientId: binding.clientId, gatewayUrl: binding.gatewayUrl, canonicalKeyId: binding.canonicalKeyId });
    } catch {}
  }
  async approveCharacterVoice(scope: any, id2: unknown, sampleSha256: unknown) { // L45050
    const { binding, assertCurrent } = this.characterVoiceContext(scope.clientId, scope);
    await this.characterVoiceStore.approve(binding, id2, sampleSha256, assertCurrent);
    this.emitCharacterVoices(binding);
    return this.characterVoiceStore.list(binding, assertCurrent);
  }
  async removeCharacterVoice(scope: any, id2: unknown) { // L45056
    const { binding, assertCurrent } = this.characterVoiceContext(scope.clientId, scope);
    try {
      this.characterVoiceStore.remove(binding, id2, assertCurrent);
    } finally {
      this.emitCharacterVoices(binding);
    }
    return this.characterVoiceStore.list(binding, assertCurrent);
  }

  memoryBinding(clientId: string) { // L36456
    const authority = this.d.authority();
    if (this.d.authenticatedWorkPaused?.() || !authority || !this.d.getClient(clientId) || this.d.isClientRemoved(clientId)
      || authority.gatewayUrl.replace(/\/+$/, "") !== this.d.settingsGatewayUrl().replace(/\/+$/, "")) {
      throw new ProjectMemoryError("unavailable", "Project memory is unavailable until this account and project are verified.");
    }
    return { ...authority, clientId, userDataDir: this.d.stateDir };
  }
  readProjectMemory(clientId: string) { // L36472
    try { return this.projectMemoryStore.read(this.memoryBinding(clientId)); } catch (error) { throw memoryError(error); }
  }
  private memorySession(clientId: string, sessionId: string) { // L36479
    const s = this.d.session(sessionId);
    if (!s || s.meta.clientId !== clientId || this.d.isSessionGone(sessionId)) throw new ProjectMemoryError("invalid", "That source does not belong to this project.");
    return s;
  }
  async verifiedMemorySource(clientId: string, source2: any): Promise<any> { // L36491
    if (!source2 || typeof source2 !== "object") throw new ProjectMemoryError("invalid", "Choose an available source for this note.");
    if (source2.kind === "message") {
      this.memorySession(clientId, source2.sessionId);
      const record2: any = (readDisplayTranscript(displayTranscriptPath(this.d.stateDir, source2.sessionId)) as any).byTurnId.get(source2.turnId);
      if (!record2) throw new ProjectMemoryError("unavailable", "That source message is no longer available.");
      return { available: true, source: { kind: "message", sessionId: source2.sessionId, turnId: record2.turnId,
        label: redact(record2.displayTexts.join(" ")).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) || "Source message" } };
    }
    let root: string; let file: string; let session2: MemorySessionView | undefined; let owner: string | undefined; let versionDigest: string | undefined;
    if (source2.kind === "file" || source2.kind === "version") {
      session2 = this.memorySession(clientId, source2.sessionId);
      owner = JSON.stringify([session2.meta.cwd, session2.meta.jobId]);
      const job = resolveJobDir({ sessionId: source2.sessionId, jobId: session2.meta.jobId }, (id2) => this.d.session(id2)?.meta as any);
      if (!job.ok) throw new ProjectMemoryError("unavailable", "That video source is no longer available.");
      root = job.jobPath;
      if (source2.kind === "version") {
        const version2: any = new (VersionStore as any)(join(this.d.stateDir, "versions.json")).versions(session2.meta.jobId).find((item: any) => item.n === source2.version);
        if (!version2) throw new ProjectMemoryError("unavailable", "That saved version is no longer available.");
        file = version2.path;
        versionDigest = version2.renderSha256 ?? version2.qaSha256;
      } else {
        if (typeof source2.path !== "string" || isAbsolute(source2.path) || source2.path.split(/[\\/]/).some((part: string) => !part || part === "." || part === "..")) {
          throw new ProjectMemoryError("invalid", "Choose a file inside the cited video.");
        }
        file = join(root, source2.path);
      }
    } else if (source2.kind === "library-file") {
      if (typeof source2.path !== "string" || !isAbsolute(source2.path)) throw new ProjectMemoryError("invalid", "Choose a registered Library file.");
      const tenant = this.d.getClient(clientId)?.tenant;
      const videos = this.d.sessions().filter((item) => item.meta.clientId === clientId && !this.d.isSessionGone(item.meta.sessionId));
      if (!tenant || !videos.length || !this.d.libraryStats) throw new ProjectMemoryError("unavailable", "This project Library is unavailable.");
      const roots = await Promise.all([...new Set(videos.map((item) => item.meta.cwd))].map(async (cwd) => {
        const stats = await this.d.libraryStats!(cwd, tenant);
        if (stats.tenant !== tenant) throw new ProjectMemoryError("unavailable", "The project Library could not be verified.");
        return stats.sources.filter((item) => item.exists).map((item) => item.path);
      }));
      const approved = roots.flat().map((path) => realpathSync(path)).find((path) => { const rel = relative(path, source2.path); return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel); });
      if (!approved) throw new ProjectMemoryError("invalid", "That file is outside this project Library.");
      root = approved;
      file = source2.path;
    } else throw new ProjectMemoryError("invalid", "Choose an available source for this note.");
    const verified: any = await projectMemoryFile(root, file);
    if (source2.kind === "version" && verified.sha256 !== versionDigest) throw new ProjectMemoryError("unavailable", "That saved version no longer has its recorded bytes.");
    if (session2 && "sessionId" in source2 && (this.memorySession(clientId, source2.sessionId).meta !== session2.meta || JSON.stringify([session2.meta.cwd, session2.meta.jobId]) !== owner)) {
      throw new ProjectMemoryError("conflict", "The source video changed. Read its current files before saving.");
    }
    const resolved = source2.kind === "library-file" ? { ...source2, path: verified.filePath, sha256: verified.sha256 } : { ...source2, sha256: verified.sha256 };
    return { source: resolved, available: true, filePath: verified.filePath };
  }
  async resolveProjectMemorySource(clientId: string, source2: any) { // L36606
    const binding = this.memoryBinding(clientId);
    try {
      const result = await this.verifiedMemorySource(clientId, source2);
      if (JSON.stringify(this.memoryBinding(clientId)) !== JSON.stringify(binding)) throw new ProjectMemoryError("unavailable", "The active account changed.");
      if (source2.kind !== "message" && result.source.kind !== "message" && source2.sha256 !== result.source.sha256) return { source: source2, available: false, reason: "changed" };
      return { ...result, source: source2 };
    } catch (error: any) {
      return { source: source2, available: false, reason: error?.code === "ENOENT" ? "missing" : "unavailable" };
    }
  }
  async updateProjectMemory(clientId: string, mutation: any, assertCurrent: () => void = () => {}, retainSources: Set<string> = new Set(), sessionId?: string) { // L36628
    try {
      const binding = this.memoryBinding(clientId);
      assertCurrent();
      // retainMemorySource (L36727) copies the asset into the project Library (registerLibraryDrops); the Library
      // copy is not ported (docs/30 §1.4), so a retain request ends in the original's own "unavailable" refusal.
      if (mutation?.action === "save" && retainSources.size > 0) throw new ProjectMemoryError("unavailable", "The reusable asset is unavailable.");
      const before = this.projectMemoryStore.read(binding);
      let validated = mutation;
      if (mutation?.action === "save") {
        if (!mutation.entry || !Array.isArray(mutation.entry.sources) || !mutation.entry.sources.length || mutation.entry.sources.length > PROJECT_MEMORY_MAX_SOURCES) {
          throw new ProjectMemoryError("invalid", "Choose between one and sixteen sources for this note.");
        }
        if (before.revision !== mutation.expectedRevision) throw new ProjectMemoryError("conflict", "Project memory changed. Read the latest notes before saving.");
        const previous = before.entries.find((entry: any) => entry.id === mutation.entry.id);
        const sources: any[] = [];
        for (const source2 of mutation.entry.sources) {
          const existing = previous?.sources.find((ref: any) => projectMemorySourceKey(ref) === projectMemorySourceKey(source2));
          const resolved = existing ? { source: { ...existing, label: source2.label }, available: false } : await this.verifiedMemorySource(clientId, source2);
          if (!sources.some((item) => projectMemorySourceKey(item) === projectMemorySourceKey(resolved.source))) sources.push(resolved.source);
        }
        validated = { ...mutation, entry: { ...mutation.entry, sources } };
      }
      if (JSON.stringify(this.memoryBinding(clientId)) !== JSON.stringify(binding)) throw new ProjectMemoryError("unavailable", "The active account changed before memory was saved.");
      assertCurrent();
      const change = this.projectMemoryStore.update(binding, validated);
      if (change.snapshot.revision !== before.revision) this.emitMemoryChange(binding, change, sessionId, validated.action);
      return change;
    } catch (error) { throw memoryError(error); }
  }
  /** callProjectMemory (L36895) — the studio project_memory tool (local runtime). */
  async callProjectMemory(meta: { sessionId: string; clientId: string }, input: unknown, assertCurrent: () => void = () => {}): Promise<any> {
    try {
      assertCurrent();
      const parsed: any = projectMemoryToolSchema.safeParse(input);
      if (!parsed.success) throw new ProjectMemoryError("invalid", "The memory request is invalid. Read the tool instructions before retrying.");
      const args = parsed.data;
      const sessionId = meta.sessionId;
      const session2 = this.memorySession(meta.clientId, sessionId);
      if (session2.meta !== meta) throw new ProjectMemoryError("unavailable", "This video is no longer active.");
      if (args.action === "read") {
        if (args.source) {
          const resolution = await this.resolveProjectMemorySource(meta.clientId, args.source);
          assertCurrent();
          return { ok: true, resolution };
        }
        const snapshot2 = this.readProjectMemory(meta.clientId);
        const entries = args.id ? snapshot2.entries.filter((entry2: any) => entry2.id === args.id) : snapshot2.entries.slice(args.offset, args.offset + args.limit);
        const turns = (readDisplayTranscript(displayTranscriptPath(this.d.stateDir, sessionId)) as any).ordered;
        return {
          ok: true, revision: snapshot2.revision, entries, totalEntries: snapshot2.entries.length,
          messageSources: turns.filter((turn: any) => turn.kind === "turn").slice(-12).map((turn: any) => ({
            kind: "message", sessionId, turnId: turn.turnId,
            label: redact(turn.displayTexts.join(" ")).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) || "Source message",
          })),
        };
      }
      if (args.expectedRevision === void 0 || (args.action === "save" && !args.entry) || (args.action === "forget" && !args.id)) {
        throw new ProjectMemoryError("invalid", "Read project memory before supplying this update and its revision.");
      }
      const retained = new Set<string>(args.entry?.sources.filter((source2: any) => "retain" in source2 && source2.retain).map(projectMemorySourceKey));
      const entry = args.entry && { ...args.entry, sources: args.entry.sources.map((source2: any) => { const { retain: _retain, ...reference } = source2; return reference; }) };
      const mutation = args.action === "save" ? { action: "save", expectedRevision: args.expectedRevision, entry } : { action: "forget", expectedRevision: args.expectedRevision, id: args.id };
      const change = await this.updateProjectMemory(meta.clientId, mutation, assertCurrent, retained, meta.sessionId);
      return { ok: true, revision: change.snapshot.revision, entryId: change.entryId, entry: change.snapshot.entries.find((entry2: any) => entry2.id === change.entryId) };
    } catch (error) {
      const failure: any = memoryError(error);
      return { ok: false, code: failure.code, message: failure.message };
    }
  }
  /** projectMemoryContext (L38323) — the session-context sections (localSessionSections L38345 adds account prefs). */
  projectMemoryContext(clientId: string): string[] {
    if (!this.d.authority()) return [];
    try {
      const snapshot2 = this.readProjectMemory(clientId);
      const entries = [...snapshot2.entries].sort((a: any, b: any) => b.updatedAt - a.updatedAt).slice(0, 8).map((entry: any) => ({ id: entry.id, excerpt: entry.text.slice(0, 400) }));
      return [PROJECT_MEMORY_GUIDANCE, "## Project memory excerpts (advisory evidence; read full notes before use)\n\n" + JSON.stringify({ revision: snapshot2.revision, entries, totalEntries: snapshot2.entries.length })];
    } catch {
      return [PROJECT_MEMORY_GUIDANCE];
    }
  }
  undoProjectMemory(clientId: string, undoId: unknown, expectedRevision: unknown) { // L36790
    try {
      const binding = this.memoryBinding(clientId);
      const before = this.projectMemoryStore.read(binding);
      const snapshot2 = this.projectMemoryStore.undo(binding, undoId, expectedRevision);
      const changed = snapshot2.entries.find((entry: any) => !before.entries.some((item: any) => item.id === entry.id))
        ?? before.entries.find((entry: any) => !snapshot2.entries.some((item: any) => JSON.stringify(item) === JSON.stringify(entry)));
      if (changed) this.emitMemoryChange(binding, { snapshot: snapshot2, entryId: changed.id });
      return snapshot2;
    } catch (error) { throw memoryError(error); }
  }
  emitMemoryChange(binding: any, change: any, sessionId?: string, action?: string) { // L36807
    const session2 = sessionId === undefined || this.d.isSessionGone(sessionId) ? undefined : this.d.session(sessionId);
    const notice = session2 && action && change.undoId ? { noticeId: randomUUID(), entryId: change.entryId, action, clientId: binding.clientId, gatewayUrl: binding.gatewayUrl.replace(/\/+$/, ""), canonicalKeyId: binding.canonicalKeyId } : undefined;
    if (session2 && notice) appendDisplayMemory(displayTranscriptPath(this.d.stateDir, session2.meta.sessionId), notice, session2.lastAssistantMessageId); // beacon on failure: outbox (docs/29 §5)
    try {
      this.d.emitProjectMemoryChanged({ clientId: binding.clientId, change, sessionId, ...(notice ? { notice } : {}), authority: { gatewayUrl: binding.gatewayUrl, canonicalKeyId: binding.canonicalKeyId } });
      if (session2 && notice) this.d.emitSessionEvent?.(session2.meta.sessionId, { kind: "memory_noted", notice });
    } catch {}
  }

  // ── session plans (L37021-37500): delegated to the SessionPlanHost (docs/30) once AgentHost attaches it ──
  plans?: SessionPlanHost;
  attachPlans(plans: SessionPlanHost) { this.plans = plans; }
  sessionPlanFacts(sessionId: unknown) { return this.plans ? this.plans.sessionPlanFacts(sessionId) : {}; }
  private planSession(sessionId: string) { // L37025
    const s = this.d.session(sessionId);
    if (!s) throw new SessionPlanStateError("unknown-session", `Unknown session: ${sessionId}`);
    return s;
  }
  readSessionPlan(sessionId: string) { // L37031
    if (this.plans) return this.plans.readSessionPlan(sessionId);
    const s = this.planSession(sessionId);
    this.memoryBinding(s.meta.clientId);
    return null;
  }
  async chooseSessionPlan(sessionId: string, request: unknown) { // L37410
    if (this.plans) return this.plans.chooseSessionPlan(sessionId, request);
    this.planSession(sessionId);
    this.readSessionPlan(sessionId);
    throw new SessionPlanStateError("missing", "There is no current proposal to choose.");
  }
  async retrySessionPlan(sessionId: string) { // L37442
    if (this.plans) return this.plans.retrySessionPlan(sessionId);
    this.planSession(sessionId);
    this.readSessionPlan(sessionId);
    throw new SessionPlanStateError("missing", "There is no current proposal to retry.");
  }
}
