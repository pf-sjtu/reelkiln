// PORT (docs/22 M3/M4): Electron-free ports of the original main-process media / file / intake
// handlers, so they can be unit-tested without a window. Each cites the original registration.
//   vcmedia://local/<abs path>     protocol.handle("vcmedia") L62452 (+ registerSchemesAsPrivileged L60356)
//   exposeJobSnapshot              L60411: every render / asset / version path of a snapshot is granted
//   file:saveItemAs                L61987 (save dialog → copyFile → showItemInFolder)
//   file:revealItem / file:openPath L61983 / L61917 + openLocalPath L55678
//   intake:pickFiles               L62157 (+ isIntakePickerScope L304)
// PORT-NEW (smoke only, VIDEOCLAW_PORT_SMOKE=1): VIDEOCLAW_PORT_SMOKE_SAVE_AS=<path> answers the save
// dialog and VIDEOCLAW_PORT_SMOKE_PICK_FILES=<paths, newline-separated> answers the open dialog — what a
// user would click; every check after the dialog is the original code path.
import { createReadStream, existsSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, isAbsolute, join, win32 } from "node:path";
import { Readable } from "node:stream";
import { MediaCapabilityRegistry, mediaFailure, mimeFor, planMediaResponse } from "./media.generated";

/** module-level registry (original L60408): only files main granted are ever served. */
export function createMediaCapabilities(): any {
  return new (MediaCapabilityRegistry as any)((filePath: string) => mimeFor(filePath) !== "application/octet-stream");
}
export function exposeJobSnapshot(media: any, snapshot: any): any { // L60411
  media.grantJobSnapshot(snapshot);
  return snapshot;
}

/** PORT-WIN docs/34: main builds vcmedia URLs from pathToFileURL(path).pathname (L61029/L61121/L62204), which on Windows
 *  is "/C:/Users/…" — back to the native "C:\\Users\\…" the capability table was granted with. POSIX: unchanged. */
export function vcmediaFilePath(pathname: string, platform: string = process.platform): string {
  if (platform !== "win32" || !/^\/[A-Za-z]:[\\/]/.test(pathname)) return pathname;
  return win32.normalize(pathname.slice(1));
}

/** protocol.handle("vcmedia") body (L62452-62486). */
export async function handleVcmedia(req: Request, media: any, chatMediaRoot: (sessionId: string) => string | null | undefined): Promise<Response> {
  let filePath: string;
  let expectedIdentity: string | undefined;
  let sessionId: string | null;
  try {
    const url = new URL(req.url);
    if (url.hostname !== "local") return mediaFailure("denied");
    filePath = vcmediaFilePath(decodeURIComponent(url.pathname));
    expectedIdentity = url.searchParams.get("version") ?? undefined;
    sessionId = url.searchParams.get("session");
  } catch {
    return mediaFailure("denied");
  }
  if (req.method === "HEAD" && sessionId) {
    const root = chatMediaRoot(sessionId);
    if (root) media.grantJobFile(filePath, root);
  }
  const capability = media.resolve(filePath, expectedIdentity);
  if (capability.state !== "ready") return mediaFailure(capability.state);
  const plan: { status: number; headers: Record<string, string>; range: { start: number; end: number } | null } = planMediaResponse(capability.path, capability.size, req.headers.get("range")) as any;
  const headers: Record<string, string> = {
    ...plan.headers,
    "X-Videoclaw-Media-State": "ready",
    "X-Videoclaw-Media-Identity": capability.identity,
    "Access-Control-Expose-Headers": "X-Videoclaw-Media-State, X-Videoclaw-Media-Identity",
  };
  if (plan.status === 416) return new Response(null, { status: 416, headers });
  if (req.method === "HEAD") return new Response(null, { status: plan.status, headers });
  const stream = Readable.toWeb(createReadStream(capability.path, plan.range ?? undefined)) as unknown as ReadableStream;
  return new Response(stream, { status: plan.status, headers });
}

export interface DialogLike {
  showSaveDialog(opts: { defaultPath: string }): Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog(opts: { title: string; buttonLabel: string; properties: string[] }): Promise<{ canceled: boolean; filePaths: string[] }>;
}
export interface ShellLike { showItemInFolder(p: string): void; openPath(p: string): Promise<string> }

export function smokeDialog(real: DialogLike, env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = () => {}): DialogLike {
  // docs/23 M5: the UI-e2e mode (VIDEOCLAW_PORT_UI_E2E=1, CDP-driven original UI) answers the native
  // dialogs the same way — a headless run has no one to click the GTK dialog.
  if (env.VIDEOCLAW_PORT_SMOKE !== "1" && env.VIDEOCLAW_PORT_UI_E2E !== "1") return real;
  return {
    showSaveDialog: async (opts) => {
      const p = env.VIDEOCLAW_PORT_SMOKE_SAVE_AS;
      if (!p) return real.showSaveDialog(opts);
      log(`[smoke] save dialog answered: ${p} (default ${opts.defaultPath})`);
      return { canceled: false, filePath: p };
    },
    showOpenDialog: async (opts) => {
      const list = env.VIDEOCLAW_PORT_SMOKE_PICK_FILES;
      if (!list) return real.showOpenDialog(opts);
      const filePaths = list.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      log(`[smoke] open dialog (${opts.title}) answered: ${filePaths.length} file(s)`);
      return { canceled: false, filePaths };
    },
  };
}

/** isIntakePickerScope (L304). */
export function isIntakePickerScope(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  const scope = value;
  if (scope.kind === "character") return true;
  if ((scope.kind !== "composer" && scope.kind !== "input_request") || typeof scope.sessionId !== "string" || !scope.sessionId) return false;
  return scope.kind !== "input_request" || (typeof scope.requestId === "string" && Boolean(scope.requestId));
}

export interface FileIpcDeps {
  dialog: DialogLike;
  shell: ShellLike;
  downloadsDir: () => string;
  media: any;
  sessionIds: () => string[];
  /** host.hasPendingInput (input:* not ported → always false) */
  hasPendingInput?: (sessionId: string, requestId: string) => boolean;
}
export function fileIpcHandlers(d: FileIpcDeps): Record<string, (...a: any[]) => unknown> {
  const openLocalPath = async (path: unknown) => { // L55678
    if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) throw new Error("Invalid file path");
    const error = await d.shell.openPath(path);
    if (error) throw new Error("Could not open this file");
  };
  return {
    "file:openPath": async (path: unknown) => { await openLocalPath(path); },
    "file:revealItem": (path: unknown) => { d.shell.showItemInFolder(String(path)); },
    "file:saveItemAs": async (path: unknown) => { // L61987
      if (typeof path !== "string" || !path.trim() || path.length > 4096 || !existsSync(path)) {
        throw new Error("This file is no longer available. Refresh the preview and try again.");
      }
      const { canceled, filePath } = await d.dialog.showSaveDialog({ defaultPath: join(d.downloadsDir(), basename(path)) });
      if (canceled || !filePath) return false;
      try {
        await copyFile(path, filePath);
      } catch {
        throw new Error("Could not save this file. Check the destination and try again.");
      }
      d.shell.showItemInFolder(filePath);
      return true;
    },
    "intake:pickFiles": async (scope: any) => { // L62157
      if (!isIntakePickerScope(scope) || (scope.kind !== "character" && !d.sessionIds().includes(scope.sessionId))) {
        throw new Error("That file request no longer belongs to an open video.");
      }
      const res = await d.dialog.showOpenDialog({ title: scope.kind === "input_request" ? "Choose requested files" : "Add footage", buttonLabel: "Add", properties: ["openFile", "multiSelections"] });
      if (res.canceled) return { scope, files: [] };
      if (scope.kind !== "character" && !d.sessionIds().includes(scope.sessionId)) throw new Error("That video closed while the file picker was open.");
      if (scope.kind === "input_request" && !(d.hasPendingInput?.(scope.sessionId, scope.requestId) ?? false)) throw new Error("That file request was closed while the picker was open.");
      d.media.grantMany(res.filePaths, "external");
      const files = res.filePaths.map((p) => {
        let sizeBytes = 0;
        try { sizeBytes = statSync(p).size; } catch {}
        return { path: p, name: basename(p), sizeBytes };
      });
      return { scope, files };
    },
  };
}
