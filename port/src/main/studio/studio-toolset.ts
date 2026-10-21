// PORT-NEW glue (docs/30 §1): makeStudioToolset (original AgentHost L48166-49500) and the Codex projection
// makeCodexToolset (L49503-49640) for the studio tools this port can honour. The tool names, descriptions and input
// shapes are the original's (verbatim constants/schemas from studio-tools.generated.ts, inline shapes copied with
// line refs); the handlers call the same host methods. The SDK server is built with the loaded Claude Agent SDK's own
// createSdkMcpServer/tool (the original imports them from the same package), alwaysLoad:true (#930).
//
// PORTED (handler → host):          propose_session_plan L48526, project_memory L48555, save_account_preference L48561,
//   read_workbook L48567, read_pdf L48611, get_workflow L48642 / search_workflows L48709 / workflow_advisor L48741 (the
//   original no-pinned-Studio-Bundle branch: the port pins no bundle), request_rights_confirmation L49348,
//   request_voiceover L49380, request_files L49445.
// NOT REGISTERED (docs/30 §1.3, each needs the paid gateway model plane the MiniMax-backed shim refuses):
//   preview_session_shot, character_voice, quickstart_reference, search_models, call_model, get_project_budget,
//   set_video_budget, plan_paid_operations; Codex-only import_generated_image / write_video_project_files /
//   execute_videoclaw_command.
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import { closeSync, constants, createReadStream, fstatSync, openSync } from "node:fs";
import { z } from "zod";
import {
  SESSION_PLAN_GUIDANCE, sessionPlanToolShape, projectMemoryToolShape, PROJECT_MEMORY_TOOL_DESCRIPTION, ACCOUNT_PREFERENCE_TOOL_DESCRIPTION,
  SAVED_VOICE_RIGHTS_EXEMPTION, VOICEOVER_NAME_PREFIX_RE, LIBRARY_ID,
} from "./studio-tools.generated";
import { resolveProjectDestination, attestExistingProjectDirectory, sameProjectDirectory } from "../memory/project-memory.generated";
import { writeProjectStream } from "./relative-writer";

const ACCOUNT_PREFERENCE_MAX_TEXT = 1e3; // L1638

export interface StudioSdk {
  createSdkMcpServer(o: { name: string; version?: string; alwaysLoad?: boolean; tools: unknown[] }): unknown;
  tool(name: string, description: string, shape: Record<string, unknown>, handler: (args: any, extra: unknown) => Promise<any>): unknown;
}
export interface StudioInputRequest { sessionId: string; kind: "rights" | "voiceover" | "files"; prompt: string; destDir: string; direction?: string; accept?: string[] }
export interface StudioToolHost {
  callSessionPlan(sessionId: string, args: unknown): Promise<unknown>;
  callProjectMemory(meta: any, args: unknown): Promise<unknown>;
  saveAccountPreference(meta: any, args: { text: string }): unknown;
  readWorkbook(sessionId: string, attachmentId: string, o: Record<string, unknown>): unknown;
  readPdf(sessionId: string, attachmentId: string, o: Record<string, unknown>): unknown;
  requestInput(req: StudioInputRequest): Promise<any>;
  noteMaterial(sessionId: string, arrival: Record<string, unknown>): void;
}
export interface StudioToolset { server?: unknown; dynamicTools: Array<{ type: "function"; name: string; description: string; inputSchema: unknown }>; call(name: string, input: unknown): Promise<unknown>; names: string[] }

/** prepareConfinedProjectDirectory (L2656) + reattestWriteDirectory (L2666) around writeProjectStream (L2920). */
function confinedStream(cwd: string, requestedDir: string, preferredName: string, input: () => AsyncIterable<any>): Promise<string> {
  if (!preferredName || preferredName.includes("\0") || basename(preferredName) !== preferredName || preferredName === "." || preferredName === "..") {
    throw new Error("Studio filename must be a safe basename."); // safeFilename L2646
  }
  return writeProjectStream({
    prepare: () => {
      resolveProjectDestination(cwd, requestedDir);
      const initial = attestExistingProjectDirectory(cwd, requestedDir);
      const beforeOpen = attestExistingProjectDirectory(cwd, requestedDir);
      if (!sameProjectDirectory(initial, beforeOpen)) throw new Error("Studio destination changed before the write.");
      return { path: beforeOpen.path, identity: `${beforeOpen.dev}:${beforeOpen.ino}`, attested: beforeOpen } as any;
    },
    reattest: (dir: any) => { if (!sameProjectDirectory(dir.attested, attestExistingProjectDirectory(cwd, requestedDir))) throw new Error("Studio destination changed during the write."); },
    preferredName,
    input,
  });
}
/** writeProjectBytes (L2671). */
export function writeProjectBytes(cwd: string, requestedDir: string, preferredName: string, bytes: Buffer): Promise<string> {
  return confinedStream(cwd, requestedDir, preferredName, () => Readable.from([bytes]));
}
/** copyProjectFile (L2805). */
export function copyProjectFile(cwd: string, requestedDir: string, source2: string, preferredName: string): Promise<string> {
  const sourceFd = openSync(source2, constants.O_RDONLY | constants.O_NOFOLLOW);
  const sourceInfo = fstatSync(sourceFd);
  closeSync(sourceFd);
  if (!sourceInfo.isFile()) throw new Error("Studio source must be a regular non-symlink file.");
  return confinedStream(cwd, requestedDir, preferredName, () => createReadStream(source2, { fd: openSync(source2, constants.O_RDONLY | constants.O_NOFOLLOW), autoClose: true }) as any);
}

/** makeStudioToolset (L48166). `sdk` absent → only the dynamic (Codex) projection is built. */
export function makeStudioToolset(meta: { sessionId: string; cwd: string; clientId: string }, host: StudioToolHost, sdk?: StudioSdk): StudioToolset {
  const sessionId = meta.sessionId;
  const cwd = meta.cwd;
  const resolveDest = (destDir: string) => resolveProjectDestination(cwd, destDir);
  const text2 = (payload: unknown) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });
  const dynamic = new Map<string, { spec: any; call: (input: unknown) => Promise<unknown> }>();
  const tools: unknown[] = [];
  // studioTool (L48190): the completions wrapper (completedModelContext) only adds paid model_call results, which
  // the port never collects (call_model not ported) — so the handler result passes through unchanged.
  const studioTool = (name: string, description: string, inputSchema: Record<string, any>, handler: (args: any) => Promise<any>) => {
    const schema = z.object(inputSchema);
    dynamic.set(name, {
      spec: { type: "function", name, description, inputSchema: z.toJSONSchema(schema) },
      call: async (input) => {
        const result = await handler(schema.parse(input));
        const first = result.content[0];
        if (first?.type !== "text") return result;
        try { return JSON.parse(first.text); } catch { return first.text; }
      },
    });
    if (sdk) tools.push(sdk.tool(name, description, inputSchema, (args: any) => handler(args)));
  };
  const noBundle = (reason: string) => async () => text2({ ok: false, reason });
  studioTool("propose_session_plan", SESSION_PLAN_GUIDANCE, sessionPlanToolShape, async (args) => text2(await host.callSessionPlan(sessionId, args)));
  studioTool("project_memory", PROJECT_MEMORY_TOOL_DESCRIPTION, projectMemoryToolShape, async (args) => text2(await host.callProjectMemory(meta, args)));
  studioTool("save_account_preference", ACCOUNT_PREFERENCE_TOOL_DESCRIPTION, { text: z.string().trim().min(1).max(ACCOUNT_PREFERENCE_MAX_TEXT) }, async (args) => text2(host.saveAccountPreference(meta, args)));
  studioTool(
    "read_workbook", // L48567
    `Read a spreadsheet (.xlsx, .xls, .ods) the user attached to this video, by the attachment id from the composer attachment list. Without sheet it returns the workbook overview (sheet names, used ranges, cell counts). With sheet (name or zero-based index) it returns that sheet's filled cells in row order, optionally clipped to range (e.g. "A1:D20"), at most 500 per call; follow next_offset for more. A cell marked truncated is read whole with sheet + cell (e.g. "B2") and char_offset, following next_char_offset. Each cell has its cached value, displayed text and formula text. Formulas were never evaluated and external links were never followed: report the cached values as the file stored them. Read-only; never convert or extract the workbook yourself.`,
    {
      attachment_id: z.string().uuid().describe("Attachment id from the composer attachment list."),
      sheet: z.string().min(1).max(200).optional().describe("Sheet name, or zero-based sheet index as a string."),
      range: z.string().min(2).max(24).optional().describe('Optional A1-style range, e.g. "A1:D20".'),
      offset: z.number().int().min(0).max(1e6).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      cell: z.string().min(2).max(12).optional().describe('One cell, e.g. "B2", to read its full text.'),
      char_offset: z.number().int().min(0).max(1e6).optional(),
    },
    async (args) => text2(host.readWorkbook(sessionId, args.attachment_id, { sheet: args.sheet, range: args.range, offset: args.offset, limit: args.limit, cell: args.cell, charOffset: args.char_offset })),
  );
  studioTool(
    "read_pdf", // L48611
    "Read the text of a PDF the user attached to this video, by the attachment id from the composer attachment list. Returns whole pages in order from page (one-based, default 1), at most 30,000 characters per call; follow next_page (and next_char_offset inside a long page) for more. A page with no text layer is marked no_text. A PDF that is password-protected, scanned or image-only, damaged, or too long returns ok:false with that reason instead of text. Read-only; never extract or convert the PDF yourself.",
    {
      attachment_id: z.string().uuid().describe("Attachment id from the composer attachment list."),
      page: z.number().int().min(1).max(1e5).optional().describe("One-based page to start from."),
      char_offset: z.number().int().min(0).max(1e6).optional().describe("Characters into that page to start from, from next_char_offset."),
    },
    async (args) => text2(host.readPdf(sessionId, args.attachment_id, { page: args.page, charOffset: args.char_offset })),
  );
  studioTool(
    "get_workflow", // L48642 — the port pins no Studio Bundle (meta.studioBundle unset): the original's first branch
    `Read one workflow from this session's pinned catalog by its exact id from the workflow index: its run card (or method), templates, exemplar job pointers, recipe index for families, the craft library entries the card names (looks, model prompt guides, voices, music, captions, SFX), and the app's house rules. Call it once for the workflow you chose, before prepare_production. For a family, pass recipe=<id> to also read one recipe. Pass library=<entry id> (e.g. prompt.seedance) to read one library entry in full without repeating the card. Large signed template files return an exact local_path to Read in chunks. This never changes the system prompt or writes the project. Example: {"id":"workflow.voice-clone"}.`,
    {
      id: z.string().min(1).max(120).regex(/^(?:workflow\.)?[a-z0-9]+(?:-[a-z0-9]+)*$/).describe("Exact workflow id from the workflow index, e.g. workflow.voice-clone."),
      recipe: z.string().min(1).max(160).optional().describe("Optional recipe id inside a family, from the card's recipe index."),
      library: z.string().min(1).max(120).regex(LIBRARY_ID).optional().describe("Optional craft library entry id (look.*, prompt.*, voice.*, music.*, caption.*, sfx.*) to read in full instead of the card."),
    },
    noBundle("This session has no pinned Studio Bundle. Continue with the engine router."),
  );
  studioTool(
    "search_workflows", // L48709
    "Search this session's pinned workflow catalog when no workflow index line fits, or to find a recipe inside a family. Deterministic: it ranks the index text, card text, recipe titles and craft library titles against the user's words and returns the best matches with a one-line reason each. It serves no card; call get_workflow with the id you choose. A miss does not mean the app cannot do the task.",
    { query: z.string().min(1).max(2e3).describe("The user's own words for what they want."), limit: z.number().int().min(1).max(10).optional() },
    noBundle("This session has no pinned Studio Bundle. Continue with the engine router."),
  );
  studioTool(
    "workflow_advisor", // L48741
    "Deprecated one-release alias. Use get_workflow(id) for a workflow card and search_workflows(query) to find one. With workflow_ids it returns those cards exactly as get_workflow does; without them it returns search matches and no card.",
    {
      mode: z.enum(["ideas", "method", "troubleshoot", "reconsider"]),
      goal: z.string().min(1).max(4e3).describe("Current user goal or production question."),
      current_plan: z.string().max(8e3).optional().describe("Optional current plan."),
      capabilities: z.array(z.string().min(1).max(200)).max(64).optional().describe("Ignored; kept so older calls still validate."),
      workflow_ids: z.array(z.string().regex(/^workflow\.[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1).max(3).optional().describe("Exact workflow ids to read, e.g. those a Quickstart pinned."),
      max_workflows: z.number().int().min(1).max(3).optional(),
    },
    noBundle("This session has no pinned Studio Bundle."),
  );
  studioTool(
    "request_rights_confirmation", // L49348
    "Before cloning or closely imitating a real person's voice or likeness, show the user a mandatory rights checkbox. Do not call this for identity motion transfer when the user uploaded or selected the face: that input is treated as authorized. This is also not needed for ordinary editing or a synthetic character. " +
      SAVED_VOICE_RIGHTS_EXEMPTION + "Blocks until confirmed or canceled.",
    {
      subject: z.string().min(1).max(160).describe("Whose voice or likeness will be used"),
      purpose: z.string().min(1).max(500).describe("How it will be used in this video"),
    },
    async (args) => {
      const response = await host.requestInput({ sessionId, kind: "rights", prompt: `${args.subject}\n\n${args.purpose}`, destDir: cwd });
      if (response.kind !== "rights" || !response.accepted) return text2({ confirmed: false, reason: response.reason ?? "Rights not confirmed" });
      return text2({ confirmed: true, rights_confirmation: `rights_${randomUUID().replaceAll("-", "")}`, subject: args.subject, instruction: "Preserve this receipt in the reference_tts command and job provenance." });
    },
  );
  studioTool(
    "request_voiceover", // L49380
    "Ask the user to record a voiceover in the app. Shows a recorder card with the script as a teleprompter; the user records takes and keeps one. The kept take is saved as 48kHz lossless WAV (PCM); the engine consumes wav/m4a directly. Blocks until the user keeps a take or declines.",
    {
      script: z.string().describe("Only the words the user will read aloud: the plan's script when there is one. No stage directions."),
      direction: z.string().optional().describe("Optional one-line delivery note (tone, pace) shown above the script, not read aloud"),
      dest_dir: z.string().describe("Directory to save takes into, relative to the workspace (e.g. jobs/<id>/real)"),
      name_prefix: z.string().regex(VOICEOVER_NAME_PREFIX_RE).optional().describe('Basename-safe filename prefix using letters, numbers, underscore, or hyphen (default "vo")'),
    },
    async (args) => {
      const dest = resolveDest(args.dest_dir);
      const response = await host.requestInput({ sessionId, kind: "voiceover", prompt: args.script, ...(args.direction?.trim() ? { direction: args.direction.trim() } : {}), destDir: dest });
      if (response.kind !== "voiceover") return text2({ declined: true, reason: response.reason ?? "User declined" });
      const prefix = args.name_prefix ?? "vo";
      const saved: string[] = [];
      for (const [i, take] of response.takes.entries()) {
        const requestedExt = extname(take.name || "").toLowerCase();
        const ext = requestedExt === ".m4a" ? ".m4a" : ".wav";
        const file = await writeProjectBytes(cwd, args.dest_dir, `${prefix}_take${i + 1}${ext}`, Buffer.from(take.data));
        saved.push(file);
        host.noteMaterial(sessionId, { name: basename(file), origin: "voiceover", path: file, takes: response.takes.length });
      }
      return text2({ saved, format: "wav/pcm_s24le", count: saved.length });
    },
  );
  studioTool(
    "request_files", // L49445
    "Ask the user to provide files (footage, images, audio, documents) via drag-and-drop in the app. Files are copied into dest_dir. Blocks until the user responds or declines.",
    {
      description: z.string().describe("What you need and why, shown to the user"),
      dest_dir: z.string().describe("Directory to copy files into, relative to the workspace"),
      accept: z.array(z.string()).optional().describe('Accepted extensions like [".mp4", ".jpg"]; omit for any'),
    },
    async (args) => {
      const dest = resolveDest(args.dest_dir);
      const response = await host.requestInput({ sessionId, kind: "files", prompt: args.description, destDir: dest, accept: args.accept });
      if (response.kind !== "files") return text2({ declined: true, reason: response.reason ?? "User declined" });
      const saved: string[] = [];
      for (const src of response.paths) {
        const target = await copyProjectFile(cwd, args.dest_dir, src, basename(src));
        saved.push(target);
        host.noteMaterial(sessionId, { name: basename(target), origin: "studio-files", path: target });
      }
      return text2({ saved, count: saved.length });
    },
  );
  const server = sdk ? sdk.createSdkMcpServer({ name: "studio", version: "1.0.0", alwaysLoad: true, tools }) : undefined;
  return {
    server,
    names: [...dynamic.keys()],
    dynamicTools: [...dynamic.values()].map((definition) => definition.spec),
    call: async (name, input) => {
      const definition = dynamic.get(name);
      if (!definition) throw new Error("Unknown VideoClaw Studio tool.");
      return definition.call(input);
    },
  };
}

/** makeCodexToolset (L49503) — the studio half (the three Codex-only tools are not ported, docs/30 §1.3). */
export function makeCodexToolset(studio: StudioToolset) {
  const studioNames = new Set(studio.dynamicTools.map((definition) => definition.name));
  return {
    dynamicTools: [...studio.dynamicTools],
    call: async (call: { tool: string; arguments: unknown }, _signal?: AbortSignal) => {
      if (studioNames.has(call.tool)) return studio.call(call.tool, call.arguments);
      throw new Error("Unknown VideoClaw tool.");
    },
  };
}
