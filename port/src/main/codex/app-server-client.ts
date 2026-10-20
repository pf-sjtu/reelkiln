// Typed codex app-server stdio client — port of the TRANSPORT of CodexAppServerClient
// (main/index.js L23652-24241) and spawnCodex (L24258-24267), assertCompatibleServer /
// codexAppServerVersion (L24664-24689). Wire format: newline-delimited JSON, NOT tagged with
// "jsonrpc": requests `{method,id,params?}`, notifications `{method,params?}`, responses
// `{id,result}` | `{id,error:{message}}`, server→client requests `{method,id,params}`.
// Request param shapes below are copied from the original call sites (line cited); result
// types list only the fields the original reads.
// PORT (Windows): close() escalation uses platform.killTree (taskkill /T) instead of
// child.kill(): codex spawns rg/shell children which child.kill would orphan on win32.
// NOT PORTED: notification normalisation (normalizeCodexNotification L24268+, message phases),
// approval/dynamic-tool server-request handling (L24113-24227: here they are answered with the
// original "unsupported"/"unavailable" replies), malformed-frame diagnostics rows, process slots.
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { killTree } from "../platform/kill";

export const SUPPORTED_CODEX_VERSION = "0.160.1"; // L23381
export const APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"] as const; // L24261

export interface InitializeParams { clientInfo: { name: "videoclaw_desktop"; title: "VideoClaw"; version: string }; capabilities: { experimentalApi: true; requestAttestation: false } } // L23755-23762
export interface InitializeResult { userAgent?: string; codexHome?: string }
export interface CodexRequests {
  initialize: [InitializeParams, InitializeResult];
  "account/read": [{ refreshToken: false }, { account?: { type?: "chatgpt" | "apiKey" | string; planType?: string } | null; requiresOpenaiAuth?: boolean }]; // L23771
  "model/list": [{ cursor?: string }, { data?: unknown[]; nextCursor?: string | null }]; // L23802
  "account/login/start": [{ type: "chatgpt"; codexStreamlinedLogin: true; useHostedLoginSuccessPage: true; appBrand: "codex" }, { type?: string; loginId?: string; authUrl?: string }]; // L23821
  "account/login/cancel": [{ loginId: string }, unknown]; // L23855
  "account/logout": [undefined, unknown]; // L23866
  "thread/start": [ThreadStartParams, ThreadStartResult]; // startThread L23868-23906
  "thread/resume": [ThreadStartParams & { threadId: string }, ThreadStartResult];
  "turn/start": [{ threadId: string; input: { type: "text"; text: string }[]; model?: string; clientUserMessageId?: string; outputSchema?: unknown }, { turn: { id: string } }]; // L23909
  "turn/interrupt": [{ threadId: string; turnId: string }, unknown]; // L23921
  "thread/read": [{ threadId: string; includeTurns: true }, { thread?: { turns?: unknown[] } }]; // L23925
}
export interface ThreadStartParams {
  cwd: string; ephemeral?: true; model?: string; modelProvider?: string; baseInstructions?: string; developerInstructions?: string;
  config: unknown; dynamicTools?: { name: string; [k: string]: unknown }[];
  approvalPolicy: "on-request"; // CODEX_CONTAINMENT.approvalPolicy (out/main/chunks/workbookContents-ChzKjQX1.js L986-989)
  approvalsReviewer: "user"; sandbox: string; // default "workspace-write"
}
export interface ThreadStartResult { thread: { id: string }; model?: string; modelProvider?: string; reasoningEffort?: string }

export type ClientEvent =
  | { kind: "warning"; message: string }
  | { kind: "transport_error"; message: string }
  | { kind: "notification"; method: string; params: unknown }; // PORT: raw, un-normalised

export function codexAppServerVersion(userAgent: string): string | undefined { // L24687
  return /^(?:Codex Desktop|videoclaw_desktop)\/(\d+\.\d+\.\d+)\b/.exec(userAgent)?.[1];
}
export function assertCompatibleServer(result: InitializeResult, expectedVersion: string, expectedProfileDir?: string, redact: (s: string) => string = (s) => s): void { // L24664
  const userAgent = result.userAgent ?? "";
  const version = codexAppServerVersion(userAgent);
  if (version !== expectedVersion) {
    throw new Error(`Unsupported Codex app-server protocol (${version ?? "unknown"}); VideoClaw requires ${expectedVersion}. Server identity: ${redact(userAgent || "missing userAgent")}.`);
  }
  if (expectedProfileDir) {
    const actualHome = result.codexHome;
    let expectedHome = expectedProfileDir;
    try { expectedHome = realpathSync(expectedProfileDir); } catch {}
    let resolvedActual = actualHome;
    try { if (actualHome) resolvedActual = realpathSync(actualHome); } catch {}
    if (!resolvedActual || resolvedActual !== expectedHome) throw new Error("Codex app server started outside VideoClaw’s isolated profile.");
  }
}

interface Pending { method: string; resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export interface CodexClientOptions {
  executable?: string; env?: NodeJS.ProcessEnv; appVersion?: string; profileDir?: string; expectedCodexVersion?: string;
  requestTimeoutMs?: number; terminateGraceMs?: number;
  spawnProcess?: () => ChildProcessWithoutNullStreams;
  killTreeImpl?: (pid: number, sig: NodeJS.Signals) => boolean;
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
  private opts: Required<Pick<CodexClientOptions, "requestTimeoutMs" | "terminateGraceMs" | "appVersion" | "expectedCodexVersion">> & CodexClientOptions;
  constructor(options: CodexClientOptions = {}) {
    this.opts = { requestTimeoutMs: 15e3, terminateGraceMs: 2e3, appVersion: "0.0.0-dev", expectedCodexVersion: SUPPORTED_CODEX_VERSION, ...options }; // L23688-23695
    this.process = options.spawnProcess?.() ?? nodeSpawn(options.executable ?? "codex", [...APP_SERVER_ARGS], { stdio: ["pipe", "pipe", "pipe"], env: options.env, windowsHide: true });
    createInterface({ input: this.process.stdout }).on("line", (line) => this.receiveLine(line));
    this.process.stderr.on("data", (chunk) => { const m = String(chunk).trim(); if (m) this.emit({ kind: "warning", message: m }); });
    this.process.once("error", (error) => this.stopped(new Error(`Codex app server could not start: ${error.message}`)));
    this.process.once("exit", (code, signal) => this.stopped(new Error(`Codex app server exited (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`)));
  }
  private stopped(reason: Error) {
    const deliberate = this.closed;
    this.closed = true;
    this.processStopped = true;
    this.rejectPending(reason);
    if (!deliberate) this.emit({ kind: "transport_error", message: reason.message });
  }
  onEvent(l: (e: ClientEvent) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
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

  request<M extends keyof CodexRequests>(method: M, ...[params]: CodexRequests[M][0] extends undefined ? [] : [CodexRequests[M][0]]): Promise<CodexRequests[M][1]> { // L23968
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

  receiveLine(line: string) { // L24050 (malformed-frame diagnostics simplified)
    const trimmed = line.trim();
    if (!trimmed) return;
    let envelope: any;
    try { envelope = JSON.parse(trimmed); } catch {
      const reason = new Error("Codex app server sent a malformed frame."); // PORT: original text built by malformedFrameMessage (not ported)
      this.close(reason);
      this.emit({ kind: "transport_error", message: reason.message });
      return;
    }
    if ("id" in envelope && !("method" in envelope)) {
      const waiter = this.pending.get(envelope.id);
      if (!waiter) { this.emit({ kind: "warning", message: "Codex app server returned an unknown response." }); return; }
      clearTimeout(waiter.timer);
      this.pending.delete(envelope.id);
      if (envelope.error) waiter.reject(new Error(envelope.error.message ?? "Codex request failed."));
      else waiter.resolve(envelope.result);
      return;
    }
    if (!("method" in envelope)) return;
    if ("id" in envelope) { this.answerServerRequest(envelope); return; }
    this.emit({ kind: "notification", method: envelope.method, params: envelope.params });
  }
  /** Original replies when no handler applies (L24113-24152): unknown → -32601; tool call → unavailable. */
  private answerServerRequest(req: { id: number | string; method: string }) {
    if (req.method === "item/tool/call") {
      this.write({ id: req.id, result: { contentItems: [{ type: "inputText", text: "This VideoClaw tool is unavailable." }], success: false } });
      return;
    }
    this.write({ id: req.id, error: { code: -32601, message: "Unsupported server request." } }); // PORT: approvals not ported → treated as unsupported
  }

  close(reason?: Error) { // L23938
    if (this.processStopped || this.killRequested) return;
    const firstClose = !this.closed;
    this.closed = true;
    if (firstClose) this.rejectPending(reason ?? new Error("Codex app server closed."));
    this.killRequested = true;
    const pid = this.process.pid;
    const kill = (sig: NodeJS.Signals) => (pid !== undefined && process.platform === "win32" ? (this.opts.killTreeImpl ?? killTree)(pid, sig) : this.process.kill(sig));
    if (!kill("SIGTERM")) { this.processStopped = true; return; }
    if (this.processStopped) return;
    const t = setTimeout(() => { if (!this.processStopped && !kill("SIGKILL")) this.processStopped = true; }, this.opts.terminateGraceMs);
    t.unref?.();
  }
  private rejectPending(reason: Error) {
    for (const w of this.pending.values()) { clearTimeout(w.timer); w.reject(reason); }
    this.pending.clear();
  }
}
