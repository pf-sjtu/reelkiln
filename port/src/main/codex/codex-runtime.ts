// createCodexRuntime (index.js L24772-25088) — ported, with the MiniMax backend (docs/27 §3) in place of
// the original's ChatGPT/OpenAI/OpenRouter provider configs. Shape changes (port host seam):
//   - the port AgentHost consumes a runtime the way it consumes the Claude Agent SDK: `query` is an async
//     iterable of SDK-shaped messages (codexEventToSdkMessages, verbatim) with interrupt/close/setModel,
//     and turns are fed from the host's input iterable (`prompt`) instead of `pushInput` being called
//     directly — `codexQuery()` pumps each queued user message through the original pushInput logic.
//   - NOT PORTED: runtimeTurnStore duplicate recovery (recoverAcceptedTurn — the host dedupes clientTurnIds
//     itself), persistContextReceipt, the studio dynamic tools (makeCodexToolset: execute_videoclaw_command,
//     write_video_project_files, propose_session_plan — `dynamicTools` stays empty), attestExistingProjectDirectory.
import { isAbsolute, relative, resolve } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { CodexAppServerClient, type CallDynamicTool, type ClientEvent, type CodexClientOptions } from "./app-server-client";
import { codexChildEnv, codexDeveloperInstructions, codexEventToSdkMessages, codexVideoConfig, sdkUserText } from "./codex-protocol.generated";
import { resolveCodexContainment } from "./codex-routes.generated";

export interface CodexCanUseTool {
  (toolName: string, input: Record<string, unknown>, o: { signal: AbortSignal; requestId?: string; toolUseID?: string; title?: string; description?: string }): Promise<{ behavior: string; updatedInput?: Record<string, unknown>; interrupt?: boolean } | undefined | null>;
}
export interface CodexRuntimeDeps {
  sessionId: string;
  cwd: string;
  resume?: string;
  model?: string;
  reasoningEffort?: string;
  permissionMode: string;
  /** the codexProvider slot ("chatgpt" | "openai-api" | "openrouter"); the MiniMax backend serves the first two */
  provider: string;
  /** PORT-NEW: the gate-proxied backend (codex-minimax.ts startCodexMiniMaxBackend) */
  backend: { modelProvider: string; config: Record<string, unknown>; secret: { envName: string; key: string } };
  sessionContext: { append: string; assembled?: boolean; lawsVersion?: string };
  engineEnv: Record<string, string>;
  profileDir: string;
  appVersion?: string;
  executable?: string;
  dynamicTools?: { name: string; [k: string]: unknown }[];
  callDynamicTool?: CallDynamicTool;
  canUseTool: CodexCanUseTool;
  /** tests */
  createClient?: (o: Pick<CodexClientOptions, "decideApproval" | "callDynamicTool">) => CodexAppServerClient;
  /** PORT-NEW: structured final answer — passed as turn/start.outputSchema (docs/27 §4.3) */
  outputSchema?: unknown;
  onWarning?: (message: string) => void;
}

/** isExistingProjectDirectory (L2593) minus attestExistingProjectDirectory (not ported: realpath check only). */
export function isExistingProjectDirectory(cwd: string, requested: string): boolean {
  try {
    const lexicalWorkspace = resolve(cwd);
    const requestedPath = isAbsolute(requested) ? resolve(requested) : resolve(cwd, requested);
    const rel = relative(lexicalWorkspace, requestedPath);
    if (rel === "") { const ws = realpathSync(lexicalWorkspace); const info = lstatSync(ws); return info.isDirectory() && !info.isSymbolicLink(); }
    if (rel.startsWith("..") || isAbsolute(rel)) return false;
    const real = realpathSync(requestedPath);
    const realRel = relative(realpathSync(lexicalWorkspace), real);
    return !realRel.startsWith("..") && !isAbsolute(realRel) && lstatSync(real).isDirectory();
  } catch { return false; }
}

export interface CodexRuntime {
  query: AsyncIterable<Record<string, any>> & { interrupt(): Promise<void>; setPermissionMode(mode: string): Promise<void>; setModel(model: string): Promise<void>; close(): void };
  pushInput(message: Record<string, any>): Promise<{ duplicate: boolean }>;
  pending: Record<string, any>[];
  resumedFrom?: string;
  dead: boolean;
  llmRoute: "codex";
  client: CodexAppServerClient;
}

export function createCodexRuntime(deps: CodexRuntimeDeps): CodexRuntime {
  const containment = resolveCodexContainment(deps.permissionMode);
  if (!containment.ok) throw new Error(containment.reason);
  const pending: Record<string, any>[] = [];
  const output: Record<string, any>[] = [];
  let wake: (() => void) | undefined;
  let streamEnded = false;
  let clientClosed = false;
  let streamError: Error | undefined;
  let threadId: string | undefined;
  let threadReady = false;
  let currentTurnId: string | undefined;
  const completedTurns = new Set<string>();
  let currentModel = deps.model;
  const push = (message: Record<string, any>) => {
    if (streamEnded) return;
    output.push(message);
    wake?.(); wake = undefined;
  };
  let runtime: CodexRuntime;
  const decideApproval = async (event: ClientEvent, signal: AbortSignal): Promise<string> => {
    if (!threadReady || event.threadId !== threadId || !currentTurnId || event.turnId !== currentTurnId) return "decline";
    if (event.toolKind === "command" && !event.command) return "decline";
    if (event.toolKind === "file-change" && (!event.grantRoot || !isExistingProjectDirectory(deps.cwd, event.grantRoot))) return "decline";
    const input = event.toolKind === "command" ? { command: event.command } : { path: event.grantRoot, description: event.title };
    const result = await deps.canUseTool(event.toolKind === "command" ? "Bash" : "Edit", input, { signal, requestId: String(event.requestId), toolUseID: event.itemId, title: event.title, description: event.reason });
    if (!result) return "decline";
    if (result.behavior !== "allow") return result.interrupt ? "cancel" : "decline";
    if (event.toolKind === "command") {
      const rewritten = result.updatedInput?.command;
      if (typeof rewritten === "string" && rewritten !== event.command) return "decline";
    }
    return "accept";
  };
  const callDynamicTool: CallDynamicTool = async (call, signal) => {
    if (!threadReady || call.threadId !== threadId || !currentTurnId || call.turnId !== currentTurnId) throw new Error("The VideoClaw tool call no longer belongs to the active turn.");
    if (!deps.callDynamicTool) throw new Error("This VideoClaw tool is unavailable.");
    return deps.callDynamicTool(call, signal);
  };
  const client = deps.createClient?.({ decideApproval, callDynamicTool }) ?? new CodexAppServerClient({
    decideApproval, callDynamicTool, appVersion: deps.appVersion, profileDir: deps.profileDir, executable: deps.executable,
    env: codexChildEnv(deps.backend.secret, deps.engineEnv, deps.profileDir),
  });
  let unsubscribe = () => {};
  const closeClient = () => {
    if (clientClosed) return;
    clientClosed = true;
    unsubscribe();
    client.close();
  };
  unsubscribe = client.onEvent((event) => {
    if (event.kind === "warning") { deps.onWarning?.(String(event.message ?? "")); }
    for (const message of codexEventToSdkMessages(event)) {
      const uuid = event.kind === "turn_completed" && event.threadId === threadId && event.turnId === currentTurnId && pending.length === 1 ? pending[0]?.uuid : undefined;
      push(message.type === "result" && uuid ? { ...message, user_message_uuid: uuid, user_message_uuids: [uuid] } : message);
    }
    if (event.kind === "turn_started") currentTurnId = event.turnId;
    if (event.kind === "turn_completed") {
      completedTurns.add(event.turnId);
      while (completedTurns.size > 32) { const oldest = completedTurns.values().next().value; if (typeof oldest !== "string") break; completedTurns.delete(oldest); }
      if (currentTurnId === event.turnId) currentTurnId = undefined;
      streamEnded = true;
      closeClient();
      wake?.(); wake = undefined;
    }
    if (event.kind === "transport_error") {
      streamError = new Error(event.message);
      streamEnded = true;
      closeClient();
      wake?.(); wake = undefined;
    }
  });
  const ensureThread = async (model: string | undefined): Promise<string> => {
    if (threadReady && threadId) return threadId;
    // the original checks the ChatGPT account for "chatgpt" and the saved key for keyed providers; the
    // MiniMax backend is keyed (the gate token) for every slot — the profile makes account/read report it
    const account = await client.accountStatus();
    if (!account.authenticated) throw new Error(account.recovery ?? "Codex is not connected in Setup.");
    if (!model) throw new Error(`Choose a model id for ${deps.provider} in Setup.`);
    const thread = await client.startThread({
      cwd: deps.cwd,
      resumeThreadId: deps.resume,
      model,
      modelProvider: deps.backend.modelProvider,
      sandbox: containment.sandbox,
      developerInstructions: codexDeveloperInstructions(deps.sessionContext.append),
      // model_reasoning_effort is the app-server's THREAD-LOCAL config key (L24901-24906)
      config: codexVideoConfig(deps.engineEnv, { ...deps.backend.config, ...(deps.reasoningEffort ? { model_reasoning_effort: deps.reasoningEffort } : {}) }),
      dynamicTools: deps.dynamicTools,
    });
    if (deps.reasoningEffort && thread.reasoningEffort !== deps.reasoningEffort) {
      closeClient();
      throw new Error(`Codex started this thread at reasoning effort “${thread.reasoningEffort ?? "the runtime default"}” instead of the pinned “${deps.reasoningEffort}”. VideoClaw will not run a video at an effort it did not pin (#108).`);
    }
    if (model && thread.model && thread.model !== model) {
      // AGENT_ROUTE_EVIDENCE "no silent model substitution at thread/start" — enforced at runtime in the port
      closeClient();
      throw new Error(`Codex started this thread on ${thread.model} instead of the pinned ${model}. VideoClaw will not run a video on a model it did not pin (#108).`);
    }
    threadId = thread.threadId;
    threadReady = true;
    push({ type: "system", subtype: "init", session_id: threadId, ...(thread.model ? { model: thread.model } : {}) });
    return threadId;
  };
  const query = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (output.length === 0) {
          if (streamEnded) {
            runtime.dead = true;
            if (streamError) throw streamError;
            return;
          }
          await new Promise<void>((r) => { wake = r; });
        }
        yield output.shift()!;
      }
    },
    interrupt: async () => {
      if (threadReady && threadId && currentTurnId) await client.interrupt(threadId, currentTurnId);
    },
    setPermissionMode: async (mode: string) => {
      const next = resolveCodexContainment(mode);
      if (!next.ok) throw new Error(next.reason);
    },
    setModel: async (model: string) => { currentModel = model; },
    close: () => {
      streamEnded = true;
      closeClient();
      wake?.(); wake = undefined;
    },
  };
  runtime = {
    query,
    llmRoute: "codex",
    client,
    pushInput: async (message) => {
      if (streamEnded) throw streamError ?? new Error("Codex runtime is closed.");
      if (currentTurnId) throw new Error("Codex is already working on this video.");
      const turnModel = currentModel;
      const text = sdkUserText(message);
      if (!text) throw new Error("Codex currently requires a text instruction.");
      pending.push(message);
      let turn: { turnId: string };
      try {
        const activeThread = await ensureThread(turnModel);
        turn = await client.startTurn(activeThread, text, turnModel, message.uuid, deps.outputSchema);
      } catch (error) {
        streamEnded = true;
        streamError = error instanceof Error ? error : new Error(String(error));
        closeClient();
        runtime.dead = true;
        wake?.(); wake = undefined;
        throw error;
      }
      if (!completedTurns.delete(turn.turnId)) currentTurnId = turn.turnId;
      return { duplicate: false };
    },
    pending,
    resumedFrom: deps.resume,
    dead: false,
  };
  return runtime;
}

/** PORT-NEW host seam: the SDK-like `query({prompt})` over a Codex runtime — each message the host
 *  queues on `prompt` becomes one pushInput (one Codex turn); the stream ends after turn/completed exactly
 *  like the original (the host respawns + resumes the thread for the next send). */
export function codexQuery(rt: CodexRuntime, prompt: AsyncIterable<Record<string, any>>): CodexRuntime["query"] {
  void (async () => {
    try {
      for await (const msg of prompt) {
        if (rt.dead) break;
        await rt.pushInput(msg);
      }
    } catch { /* pushInput already ended the stream with the error (surfaced by the iterator) */ }
  })();
  return rt.query;
}
