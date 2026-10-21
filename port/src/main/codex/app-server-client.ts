// Typed codex app-server stdio client — port of CodexAppServerClient (main/index.js L23652-24241) and
// spawnCodex (L24258-24267). Wire format: newline-delimited JSON, NOT tagged with "jsonrpc":
// requests `{method,id,params?}`, notifications `{method,params?}`, responses `{id,result}` |
// `{id,error:{message}}`, server→client requests `{method,id,params}`.
// docs/27: the client is now the original's whole protocol surface, over the VERBATIM normalisers in
// codex-protocol.generated.ts:
//   - notifications → normalizeCodexNotification (+ CodexMessagePhases) → typed events (L24050-24113)
//   - server requests (L24113-24227): item/tool/call → callDynamicTool (registered names per thread);
//     item/commandExecution|fileChange/requestApproval → normalizeCodexApproval → decideApproval;
//     anything else → -32601 "Unsupported server request."
//   - accountStatus / listModels / connectChatGpt / cancelLogin / logout / startThread / startTurn /
//     interrupt / readHistory (L23768-23933), account/login/completed waiters
//   - the process-slot limit MAX_ACTIVE_CODEX_APP_SERVERS = 4 (L23382-23403)
// PORT (Windows): close() escalation uses platform.killTree (taskkill /T) instead of child.kill():
// codex spawns rg/shell children which child.kill would orphan on win32.
// NOT PORTED: malformed-frame fingerprint rows / summaries (the first malformed frame still closes
// the client with the original message), transport snapshots.
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { killTree } from "../platform/kill";
import {
  assertCompatibleServer, codexAppServerVersion, codexVideoConfig, CodexMessagePhases, isDynamicToolResponse, MAX_CODEX_MODEL_PAGES,
  normalizeCodexApproval, normalizeCodexHistory, normalizeCodexNotification, normalizeDynamicToolCall, normalizedCodexModel, redactDiagnostic,
} from "./codex-protocol.generated";

export { assertCompatibleServer, codexAppServerVersion };
export const SUPPORTED_CODEX_VERSION = "0.160.1"; // L23381
export const MAX_ACTIVE_CODEX_APP_SERVERS = 4; // L23382
export const APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"] as const; // L24261

let activeCodexAppServers = 0;
const idleWaiters = new Set<() => void>();
export class CodexProcessCapacityError extends Error {}
/** reserveCodexProcessSlot (L23392). */
function reserveCodexProcessSlot(): () => void {
  if (activeCodexAppServers >= MAX_ACTIVE_CODEX_APP_SERVERS) {
    throw new CodexProcessCapacityError(`Codex is at its limit of ${MAX_ACTIVE_CODEX_APP_SERVERS} active chats or setup tasks. Wait for one to finish, or stop a working chat, then try again.`);
  }
  activeCodexAppServers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCodexAppServers = Math.max(0, activeCodexAppServers - 1);
    if (activeCodexAppServers === 0) for (const wake of [...idleWaiters]) wake();
  };
}
/** codexProcessesStopped (L23405). */
export function codexProcessesStopped(timeoutMs: number): Promise<boolean> {
  if (activeCodexAppServers === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const wake = () => { clearTimeout(timer); idleWaiters.delete(wake); resolve(true); };
    const timer = setTimeout(() => { idleWaiters.delete(wake); resolve(false); }, timeoutMs);
    idleWaiters.add(wake);
  });
}
export const activeCodexProcessCount = () => activeCodexAppServers;

export interface InitializeParams { clientInfo: { name: "videoclaw_desktop"; title: "VideoClaw"; version: string }; capabilities: { experimentalApi: true; requestAttestation: false } } // L23755-23762
export interface InitializeResult { userAgent?: string; codexHome?: string }
export interface ThreadStartOptions {
  cwd: string; resumeThreadId?: string; ephemeral?: boolean; model?: string; modelProvider?: string; baseInstructions?: string; developerInstructions?: string;
  config?: Record<string, any>; dynamicTools?: { name: string; [k: string]: unknown }[]; sandbox?: string;
}
export interface CodexAccountStatus { harness: "codex-app-server"; provider: "openai"; authenticated: boolean; mode: string; plan?: string; recovery?: string }
export interface CodexModel { id: string; model: string; displayName: string; description?: string; isDefault: boolean; defaultReasoningEffort: string; supportedReasoningEfforts: { effort: string; description?: string }[] }

/** Typed event the original's normalisers produce (plus the transport events). */
export type ClientEvent = { kind: string; [k: string]: any };
export type DecideApproval = (event: ClientEvent, signal: AbortSignal) => Promise<"accept" | "decline" | "cancel" | string>;
export type CallDynamicTool = (call: { threadId: string; turnId: string; callId: string; namespace: string | null; tool: string; arguments: unknown }, signal: AbortSignal) => Promise<unknown>;

interface Pending { method: string; resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export interface CodexClientOptions {
  executable?: string; env?: NodeJS.ProcessEnv; appVersion?: string; profileDir?: string; expectedCodexVersion?: string;
  requestTimeoutMs?: number; terminateGraceMs?: number;
  decideApproval?: DecideApproval; callDynamicTool?: CallDynamicTool;
  spawnProcess?: () => ChildProcessWithoutNullStreams;
  killTreeImpl?: (pid: number, sig: NodeJS.Signals) => boolean;
  /** PORT-NEW (tests): skip the process-slot accounting. */
  noProcessSlot?: boolean;
}

export class CodexAppServerClient {
  readonly process: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(e: ClientEvent) => void>();
  private nextId = 1;
  private closed = false;
  private processStopped = false;
  private killRequested = false;
  private initialized?: Promise<void>;
  private readonly releaseProcessSlot: () => void;
  private readonly messagePhases = new CodexMessagePhases();
  private readonly liveTurns = new Set<string>();
  private readonly dynamicToolNames = new Map<string, Set<string>>();
  private readonly approvalControllers = new Map<number | string, { controller: AbortController; threadId: string; turnId: string }>();
  private readonly toolControllers = new Map<number | string, { controller: AbortController; threadId: string; turnId: string }>();
  private readonly loginWaiters = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private opts: Required<Pick<CodexClientOptions, "requestTimeoutMs" | "terminateGraceMs" | "appVersion" | "expectedCodexVersion">> & CodexClientOptions;
  constructor(options: CodexClientOptions = {}) {
    this.opts = { requestTimeoutMs: 15e3, terminateGraceMs: 2e3, appVersion: "0.0.0-dev", expectedCodexVersion: SUPPORTED_CODEX_VERSION, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) }; // L23688-23695 (an explicit undefined keeps the default, like the original's `??`)
    this.releaseProcessSlot = options.noProcessSlot || options.spawnProcess ? () => {} : reserveCodexProcessSlot();
    try {
      this.process = options.spawnProcess?.() ?? nodeSpawn(options.executable ?? "codex", [...APP_SERVER_ARGS], { stdio: ["pipe", "pipe", "pipe"], env: options.env, windowsHide: true });
    } catch (e) { this.releaseProcessSlot(); throw e; }
    createInterface({ input: this.process.stdout }).on("line", (line) => this.receiveLine(line));
    this.process.stderr.on("data", (chunk) => { const m = String(chunk).trim(); if (m) this.emit({ kind: "warning", message: redactDiagnostic(m) }); });
    this.process.once("error", (error) => this.stopped(new Error(`Codex app server could not start: ${error.message}`)));
    this.process.once("exit", (code, signal) => this.stopped(new Error(`Codex app server exited (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`)));
  }
  private stopped(reason: Error) {
    const deliberate = this.closed;
    this.closed = true;
    this.processStopped = true;
    this.releaseProcessSlot();
    this.rejectPending(reason);
    this.rejectLogins(reason);
    if (!deliberate) this.emit({ kind: "transport_error", message: reason.message });
  }
  onEvent(l: (e: ClientEvent) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit(e: ClientEvent) { for (const l of this.listeners) l(e); }

  initialize(): Promise<void> { // L23752
    if (!this.initialized) {
      this.initialized = (async () => {
        const result = await this.request("initialize", { clientInfo: { name: "videoclaw_desktop", title: "VideoClaw", version: this.opts.appVersion }, capabilities: { experimentalApi: true, requestAttestation: false } });
        assertCompatibleServer(result, this.opts.expectedCodexVersion, this.opts.profileDir);
        this.notify("initialized", {});
      })();
    }
    return this.initialized;
  }
  async accountStatus(): Promise<CodexAccountStatus> { // L23768
    await this.initialize();
    const result = await this.request("account/read", { refreshToken: false });
    const accountType = result.account?.type;
    const authenticated = Boolean(result.account) || result.requiresOpenaiAuth === false;
    return {
      harness: "codex-app-server",
      provider: "openai",
      authenticated,
      mode: accountType === "chatgpt" ? "subscription" : accountType === "apiKey" ? "api-key" : authenticated ? "external" : "none",
      ...(result.account?.planType ? { plan: result.account.planType } : {}),
      ...(!authenticated ? { recovery: "Connect ChatGPT or add an OpenAI API key in Setup." } : {}),
    };
  }
  async listModels(): Promise<CodexModel[]> { // L23799
    await this.initialize();
    const models: CodexModel[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_CODEX_MODEL_PAGES; page += 1) {
      const result = await this.request("model/list", { ...(cursor ? { cursor } : {}) });
      for (const entry of Array.isArray(result.data) ? result.data : []) {
        const model = normalizedCodexModel(entry);
        if (model && !seen.has(model.id)) { seen.add(model.id); models.push(model); }
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return models;
  }
  async connectChatGpt(openAuthUrl: (url: string) => Promise<unknown>): Promise<CodexAccountStatus> { // L23819
    await this.initialize();
    const result = await this.request("account/login/start", { type: "chatgpt", codexStreamlinedLogin: true, useHostedLoginSuccessPage: true, appBrand: "codex" });
    if (result.type !== "chatgpt" || !result.loginId || !result.authUrl) throw new Error("Codex did not provide a ChatGPT login URL.");
    const completion = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.loginWaiters.delete(result.loginId); reject(new Error("ChatGPT connection timed out. Please try again.")); }, 10 * 6e4);
      timer.unref?.();
      this.loginWaiters.set(result.loginId, { resolve, reject, timer });
    });
    try {
      await openAuthUrl(result.authUrl);
      await completion;
      return await this.accountStatus();
    } catch (error) {
      const waiter = this.loginWaiters.get(result.loginId);
      if (waiter) { clearTimeout(waiter.timer); this.loginWaiters.delete(result.loginId); }
      throw error;
    }
  }
  async cancelLogin(): Promise<void> { // L23852
    for (const [loginId, waiter] of [...this.loginWaiters]) {
      try { await this.request("account/login/cancel", { loginId }); } finally {
        clearTimeout(waiter.timer); this.loginWaiters.delete(loginId); waiter.reject(new Error("ChatGPT connection was cancelled."));
      }
    }
  }
  async logout(): Promise<void> { await this.initialize(); await this.request("account/logout"); } // L23864
  async startThread(options: ThreadStartOptions): Promise<{ threadId: string; model?: string; modelProvider?: string; reasoningEffort?: string }> { // L23868
    await this.initialize();
    const method = options.resumeThreadId ? "thread/resume" : "thread/start";
    const config = codexVideoConfig({}, options.config);
    const result = await this.request(method, {
      ...(options.resumeThreadId ? { threadId: options.resumeThreadId } : {}),
      cwd: options.cwd,
      ...(options.ephemeral ? { ephemeral: true } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
      ...(options.baseInstructions ? { baseInstructions: options.baseInstructions } : {}),
      ...(options.developerInstructions ? { developerInstructions: options.developerInstructions } : {}),
      config,
      ...(!options.resumeThreadId && options.dynamicTools ? { dynamicTools: options.dynamicTools } : {}),
      approvalPolicy: "on-request", // CODEX_CONTAINMENT.approvalPolicy — fixed, deliberately not an option
      approvalsReviewer: "user",
      sandbox: options.sandbox ?? "workspace-write",
    });
    this.dynamicToolNames.set(result.thread.id, new Set((options.dynamicTools ?? []).map((t) => t.name)));
    return {
      threadId: result.thread.id, model: result.model, modelProvider: result.modelProvider,
      ...(typeof result.reasoningEffort === "string" && result.reasoningEffort ? { reasoningEffort: result.reasoningEffort } : {}),
    };
  }
  async startTurn(threadId: string, text: string, model?: string, clientTurnId?: string, outputSchema?: unknown): Promise<{ turnId: string }> { // L23907
    await this.initialize();
    const result = await this.request("turn/start", {
      threadId, input: [{ type: "text", text }],
      ...(model ? { model } : {}), ...(clientTurnId ? { clientUserMessageId: clientTurnId } : {}), ...(outputSchema ? { outputSchema } : {}),
    });
    return { turnId: result.turn.id };
  }
  async interrupt(threadId: string, turnId: string): Promise<void> { // L23918
    this.abortApprovals((a) => a.threadId === threadId && a.turnId === turnId);
    this.abortTools((c) => c.threadId === threadId && c.turnId === turnId);
    await this.request("turn/interrupt", { threadId, turnId });
  }
  async readHistory(threadId: string): Promise<ClientEvent[]> { // L23923
    await this.initialize();
    const result = await this.request("thread/read", { threadId, includeTurns: true });
    return normalizeCodexHistory(threadId, result.thread?.turns);
  }

  request(method: string, params?: unknown): Promise<any> { // L23968
    if (this.closed) return Promise.reject(new Error("Codex app server is closed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex app server request timed out: ${method}`)); }, this.opts.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write({ method, id, ...(params === undefined ? {} : { params }) });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  notify(method: string, params?: unknown) { this.write({ method, ...(params === undefined ? {} : { params }) }); } // L23986
  private write(message: unknown) { // L23989
    if (this.closed) throw new Error("Codex app server is closed.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  receiveLine(line: string) { // L24050
    const trimmed = line.trim();
    if (!trimmed) return;
    let envelope: any;
    try { envelope = JSON.parse(trimmed); } catch {
      const first = trimmed[0], last = trimmed[trimmed.length - 1];
      const shape = first !== "{" && first !== "[" ? "non-json" : last === "}" || last === "]" ? "invalid-json" : "truncated-json"; // malformedFrameShape L23597
      const reason = new Error(`Codex app server sent malformed JSON (${shape} during ${this.liveTurns.size ? "turn" : "idle"}).`); // malformedFrameMessage L23632 (phase simplified)
      this.close(reason);
      this.emit({ kind: "transport_error", message: reason.message });
      return;
    }
    if ("id" in envelope && !("method" in envelope)) {
      const waiter = this.pending.get(envelope.id);
      if (!waiter) { this.emit({ kind: "warning", message: "Codex app server returned an unknown response." }); return; }
      clearTimeout(waiter.timer);
      this.pending.delete(envelope.id);
      if (envelope.error) waiter.reject(new Error(redactDiagnostic(envelope.error.message ?? "Codex request failed.")));
      else waiter.resolve(envelope.result);
      return;
    }
    if (!("method" in envelope)) return;
    if ("id" in envelope) { void this.handleServerRequest(envelope); return; }
    if (envelope.method === "account/login/completed") { this.handleLoginCompleted(envelope.params); return; }
    const event = normalizeCodexNotification(envelope.method, envelope.params, this.messagePhases);
    if (event?.kind === "turn_started") {
      while (this.liveTurns.size >= 8) { const oldest = this.liveTurns.values().next().value; if (typeof oldest !== "string") break; this.liveTurns.delete(oldest); }
      this.liveTurns.add(String(event.turnId));
    } else if (event?.kind === "turn_completed") this.liveTurns.delete(String(event.turnId));
    if (event) this.emit(event);
  }
  private async handleServerRequest(request: { id: number | string; method: string; params?: unknown }) { // L24113
    if (request.method === "item/tool/call") { await this.handleDynamicToolCall(request); return; }
    const event = normalizeCodexApproval(request);
    if (!event || !this.opts.decideApproval) {
      // PORT: without a decideApproval seam (status/catalog clients) an approval is unsupported, like any unknown request
      this.write({ id: request.id, error: { code: -32601, message: "Unsupported server request." } });
      return;
    }
    this.emit(event);
    const controller = new AbortController();
    this.approvalControllers.set(request.id, { controller, threadId: event.threadId, turnId: event.turnId });
    try {
      const decision = await this.opts.decideApproval(event, controller.signal);
      this.write({ id: request.id, result: { decision } });
    } catch {
      if (!this.closed) this.write({ id: request.id, result: { decision: "decline" } });
    } finally { this.approvalControllers.delete(request.id); }
  }
  private async handleDynamicToolCall(request: { id: number | string; params?: unknown }) { // L24145
    const call = normalizeDynamicToolCall(request.params);
    const registered = call ? this.dynamicToolNames.get(call.threadId) : undefined;
    if (!call || call.namespace !== null || !registered?.has(call.tool) || !this.opts.callDynamicTool) {
      this.write({ id: request.id, result: { contentItems: [{ type: "inputText", text: "This VideoClaw tool is unavailable." }], success: false } });
      return;
    }
    const controller = new AbortController();
    this.toolControllers.set(request.id, { controller, threadId: call.threadId, turnId: call.turnId });
    try {
      const value = await this.opts.callDynamicTool(call, controller.signal);
      if (!this.closed) this.write({ id: request.id, result: isDynamicToolResponse(value) ? value : { contentItems: [{ type: "inputText", text: JSON.stringify(value) }], success: true } });
    } catch (error) {
      if (!this.closed) this.write({ id: request.id, result: { contentItems: [{ type: "inputText", text: JSON.stringify({ ok: false, reason: redactDiagnostic(error instanceof Error ? error.message : String(error)) }) }], success: false } });
    } finally { this.toolControllers.delete(request.id); }
  }
  private abortApprovals(p: (a: { threadId: string; turnId: string }) => boolean) { for (const a of this.approvalControllers.values()) if (p(a)) a.controller.abort(); }
  private abortTools(p: (a: { threadId: string; turnId: string }) => boolean) { for (const a of this.toolControllers.values()) if (p(a)) a.controller.abort(); }
  private handleLoginCompleted(value: any) { // L24200
    const loginId = typeof value?.loginId === "string" ? value.loginId : undefined;
    if (!loginId) return;
    const waiter = this.loginWaiters.get(loginId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.loginWaiters.delete(loginId);
    if (value.success === true) waiter.resolve();
    else waiter.reject(new Error(redactDiagnostic(typeof value.error === "string" ? value.error : "ChatGPT connection failed.")));
  }

  close(reason?: Error) { // L23938
    if (this.processStopped || this.killRequested) return;
    const firstClose = !this.closed;
    this.closed = true;
    if (firstClose) {
      this.abortApprovals(() => true);
      this.abortTools(() => true);
      this.dynamicToolNames.clear();
      this.messagePhases.clear();
      this.liveTurns.clear();
      const rejection = reason ?? new Error("Codex app server closed.");
      this.rejectPending(rejection);
      this.rejectLogins(rejection);
    }
    this.killRequested = true;
    const pid = this.process.pid;
    const kill = (sig: NodeJS.Signals) => (pid !== undefined && process.platform === "win32" ? (this.opts.killTreeImpl ?? killTree)(pid, sig) : this.process.kill(sig));
    if (!kill("SIGTERM")) { this.processStopped = true; this.releaseProcessSlot(); return; }
    if (this.processStopped) return;
    const t = setTimeout(() => { if (!this.processStopped && !kill("SIGKILL")) { this.processStopped = true; this.releaseProcessSlot(); } }, this.opts.terminateGraceMs);
    t.unref?.();
  }
  private rejectPending(reason: Error) {
    for (const w of this.pending.values()) { clearTimeout(w.timer); w.reject(reason); }
    this.pending.clear();
  }
  private rejectLogins(reason: Error) {
    for (const w of this.loginWaiters.values()) { clearTimeout(w.timer); w.reject(reason); }
    this.loginWaiters.clear();
  }
}
