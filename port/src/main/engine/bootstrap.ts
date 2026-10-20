// Port of the Bootstrap setup pipeline (main/index.js):
//   tool/run/classifyBootstrapFailure/sha256$3   L9427-9463
//   engineManifestCompatibility                   L9465-9495   compareEngineVersions L9243-9261
//   runDoctor / engineDoctorGatewayEnv / engineDoctorEnv  L9689-9727
//   class Bootstrap: status L9802, runAll L9863-9988, installEngineDir L9990-10035,
//   ensureVenv L10036-10046, ensureRemotion L10047-10066, ensureHyperframes L10067-10081,
//   writeEnvFile L10082-10085, doctor L10086-10089, activateEngine L10219-10237
//   doctorFailures L10446-10451, scrubEngineGatewaySecrets L9333-9353
// Real logic is ported line-for-line. Pieces that depend on modules NOT yet ported (Studio
// bundles, feature flags, session-context hashing, production-contract inspection, money
// compatibility, workspace writer, engine source/gateway download) are injected via
// `BootstrapHooks` and listed as stubs in docs/10.
// OS-specific behaviour goes through the platform layer: PATH delimiter/keys, exe suffixes,
// npm/npx (.cmd + CVE-2024-27980), tar (System32 bsdtar), chmod no-op on win32.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { composeEnginePath, exeName, isWin, npmInvocation, pathEnvKey, pathMod, tarInvocation, type Invocation, type Plat } from "../platform";

export const UV_PYTHON_POLICY_ENV = { UV_PYTHON_PREFERENCE: "only-managed" } as const; // L7145
export const MIN_PLAN_FREE_ENGINE_APP_VERSION = "0.0.11"; // L9464
export const STORAGE_FAILURE = /\bENOSPC\b|no space left on device|not enough space|insufficient (disk )?space|disk (is )?full|out of disk space/i; // L9439

export function compareEngineVersions(a: string, b: string): number { // L9243
  const parse = (v: string) => {
    const m = /^v?(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(String(v).trim());
    return m ? { core: m[1].split(".").map(Number), pre: m[2] ?? null } : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

export interface EngineManifest { version: string; minAppVersion: string; sha256?: string; file?: string; url?: string; [k: string]: unknown }
export function engineManifestCompatibility(value: unknown, appVersion: string): { compatible: true; manifest: EngineManifest } | { compatible: false; reason: string } { // L9465
  if (!value || typeof value !== "object" || Array.isArray(value)) return { compatible: false, reason: "engine manifest is not an object" };
  const manifest = value as EngineManifest;
  if (!manifest.version?.trim()) return { compatible: false, reason: "engine manifest has no version" };
  if (!manifest.minAppVersion?.trim()) return { compatible: false, reason: "engine manifest has no minAppVersion" };
  const re = /^v?\d+(?:\.\d+)*(?:-[A-Za-z0-9.-]+)?$/;
  if (!re.test(manifest.minAppVersion) || !re.test(appVersion)) return { compatible: false, reason: "engine manifest has an invalid app version" };
  if (compareEngineVersions(manifest.minAppVersion, MIN_PLAN_FREE_ENGINE_APP_VERSION) < 0) return { compatible: false, reason: `engine ${manifest.version} predates the plan-free contract epoch` };
  if (compareEngineVersions(appVersion, manifest.minAppVersion) < 0) return { compatible: false, reason: `engine ${manifest.version} requires app ${manifest.minAppVersion} or newer` };
  return { compatible: true, manifest };
}

export function classifyBootstrapFailure(e: unknown): "storage" | undefined { // L9441
  let cursor: any = e;
  for (let depth = 0; cursor && depth < 5; depth++) {
    if (cursor.code === "ENOSPC") return "storage";
    const text = [cursor.message, cursor.stderr, cursor.stdout].filter((v) => typeof v === "string").join("\n");
    if (text && STORAGE_FAILURE.test(text)) return "storage";
    cursor = cursor.cause;
  }
  return undefined;
}

export function doctorFailures(report: { checks: Record<string, { ok: boolean; detail?: string; fix?: string }> }): string { // L10446
  return Object.entries(report.checks).filter(([, c]) => !c.ok).map(([n, c]) => `${n}: ${c.fix ?? c.detail}`).join(" · ");
}

export function readHashFile(path: string): string | undefined { // L9419
  try {
    const value = readFileSync(path, "utf-8").trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(value) ? value : undefined;
  } catch { return undefined; }
}

export function sha256File(file: string): Promise<string> { // sha256$3 L9454
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

/** PORT: `{...process.env, ...opts.env}` (L9433) with case-insensitive PATH on win32, so an
 *  overriding `PATH` replaces the inherited `Path` instead of producing two keys. */
export function mergeEnv(base: NodeJS.ProcessEnv, extra: Record<string, string | undefined> = {}, p: Plat = process.platform): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...base };
  if (isWin(p) && Object.keys(extra).some((k) => k.toUpperCase() === "PATH")) {
    for (const k of Object.keys(out)) if (k.toUpperCase() === "PATH") delete out[k];
  }
  return Object.assign(out, extra);
}

export interface RunOpts { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number; shell?: boolean }
export type Runner = (cmd: string, args: string[], opts?: RunOpts) => Promise<string>;

/** Port of run() L9430-9438 (15 min default timeout, 32 MiB maxBuffer). */
export function createRunner(o: { platform?: Plat; baseEnv?: NodeJS.ProcessEnv; execFileImpl?: typeof execFile } = {}): Runner {
  const p = o.platform ?? process.platform;
  const execFileP = promisify(o.execFileImpl ?? execFile) as any;
  return async (cmd, args, opts = {}) => {
    const { stdout } = await execFileP(cmd, args, {
      cwd: opts.cwd,
      env: mergeEnv(o.baseEnv ?? process.env, opts.env, p),
      timeout: opts.timeoutMs ?? 15 * 6e4,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true, // PORT
      ...(opts.shell ? { shell: true } : {}),
    });
    return stdout;
  };
}
const runInv = (run: Runner, inv: Invocation, opts: RunOpts = {}) => run(inv.file, inv.args, { ...opts, ...(inv.shell ? { shell: true } : {}) });

export function doctorArgv(enginePath: string, p: Plat = process.platform): string[] { // L9692
  return ["run", "--project", enginePath, "python", pathMod(p).join(enginePath, "tools", "doctor.py"), "--json"];
}
export function syncArgv(enginePath: string, python: string[] = []): string[] { // L10043
  return ["sync", "--frozen", "--project", enginePath, ...python];
}
export function parseDoctorOutput(out: string): any { // L9701-9702
  const jsonStart = out.indexOf("{");
  return JSON.parse(out.slice(jsonStart));
}
export function engineDoctorGatewayEnv(gatewayUrl?: string): Record<string, string> { // L9704
  return gatewayUrl ? { VIDEOCLAW_GATEWAY_URL: gatewayUrl, VIDEOCLAW_API_KEY: "vcs_doctor_no_authority" } : {};
}
export function engineDoctorEnv(o: { enginePath: string; workspace: string; enginePathEnv: string; gatewayUrl?: string; platform?: Plat }): Record<string, string> { // L9715
  return {
    ...engineDoctorGatewayEnv(o.gatewayUrl),
    VIDEOCLAW_ENGINE: o.enginePath,
    VIDEOCLAW_WORKSPACE: o.workspace,
    VIDEOCLAW_JOBS_DIR: pathMod(o.platform).join(o.workspace, "jobs"),
    ...UV_PYTHON_POLICY_ENV,
    PATH: o.enginePathEnv,
  };
}

/** scrubEngineGatewaySecrets L9333-9353, verbatim. */
export function scrubEngineGatewaySecrets(enginePath: string, p: Plat = process.platform): void {
  const envPath = pathMod(p).join(enginePath, ".env");
  let existing = "";
  try { existing = readFileSync(envPath, "utf8"); } catch {}
  const kept = existing
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:export\s+)?VIDEOCLAW_(?:API_KEY|GATEWAY_URL|GW_URL)\s*=/.test(line) && line !== "# Videoclaw injects a private session gateway credential at runtime.")
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
  const content = [...kept, "# Videoclaw injects a private session gateway credential at runtime.", ""].join("\n");
  const tmp = `${envPath}.tmp-${randomUUID()}`;
  writeFileSync(tmp, content, { mode: 384 });
  renameSync(tmp, envPath);
}

export type StepId = "layout" | "engine" | "venv" | "remotion" | "hyperframes" | "workspace" | "env" | "doctor";
export interface BootstrapProgress { step: StepId; status: "running" | "ok" | "skip" | "fail"; detail?: string; reason?: string; phase?: string; fraction?: number }
export interface EngineRef { version: string; path: string; buildSha256?: string }

/** Unported collaborators. Defaults throw `NOT PORTED` so a stub can never pass silently. */
export interface BootstrapHooks {
  resolveEngineSource(): Promise<{ manifest: EngineManifest; fetch: (onBytes?: (r: number, t?: number) => void) => Promise<string> }>; // L9496
  validateEngineSessionContext(enginePath: string): void; // L4188
  assertInstalledEngineProductionContract(enginePath: string): void; // L6982
  inspectProductionCompatible(enginePath: string): boolean; // L6952
  writeWorkspace(enginePath: string, ws?: string): void; // L9650
  assertEngineMoneyCompatibility(enginePath: string): Promise<void>;
  revalidateStudioBundle(): Promise<void>;
  nativePythonArgs(uv: string, o: { cwd: string; project: string }): Promise<string[]>; // L7171 (darwin-arm64 only → [] elsewhere)
  runDoctor?(enginePath: string, ws: string): Promise<any>;
  ensureEngineCommandShims(enginePath: string): void; // L7283 (ported: command-shims.ts)
}

export interface BootstrapEnv {
  platform: Plat;
  userData: string;
  workspaceRoot: string;
  bootstrapRoots: string[];
  packaged: boolean;
  inheritedPath?: string;
  gatewayUrl?: string;
  exists?: (p: string) => boolean;
  bootstrapTool: (name: "ffmpeg" | "ffprobe" | "uv") => string | undefined;
}

export class BootstrapCore {
  lastDoctor: any;
  running = false;
  private exists: (p: string) => boolean;
  private pm: ReturnType<typeof pathMod>;
  constructor(private env: BootstrapEnv, private hooks: BootstrapHooks, private run: Runner, private emitProgress: (p: BootstrapProgress) => void, private appendSetupLog: (line: string) => void = () => {}, private beacon?: (kind: string, detail: string) => void) {
    this.exists = env.exists ?? existsSync;
    this.pm = pathMod(env.platform);
  }
  enginesRoot() { return this.pm.join(this.env.userData, "engines"); } // L9181
  enginePointerFile() { return this.pm.join(this.env.userData, "engine-current.json"); } // L9184
  currentEngine(): EngineRef | null { // L9187-9201
    try {
      const pointer = JSON.parse(readFileSync(this.enginePointerFile(), "utf-8"));
      if (pointer?.path && this.exists(this.pm.join(pointer.path, "ENGINE_VERSION.json"))) return { version: pointer.version, path: pointer.path, buildSha256: pointer.buildSha256 };
    } catch {}
    return null;
  }
  tool(name: "ffmpeg" | "ffprobe" | "uv"): string { return this.env.bootstrapTool(name) ?? exeName(name, this.env.platform); } // L9427 (PORT: bare name gets .exe on win32 — harmless for PATH lookup)
  enginePathEnv(enginePath: string): string { // enginePath_ L9313
    return composeEnginePath({ engineDir: enginePath, bootstrapRoots: this.env.bootstrapRoots, inheritedPath: this.env.inheritedPath, exists: this.exists, platform: this.env.platform });
  }
  private nodeDirs(): string[] {
    return this.env.bootstrapRoots.flatMap((r) => [this.pm.join(r, "node"), this.pm.join(r, "node", "bin")]);
  }

  /** status() L9802 — the Studio/flags/identity fields are filled by the caller (unported). */
  status() {
    const eng = this.currentEngine();
    const productionCompatible = eng ? this.hooks.inspectProductionCompatible(eng.path) : false;
    return {
      ready: Boolean(eng) && productionCompatible && Boolean(this.lastDoctor?.ok),
      engineVersion: eng?.version,
      enginePath: eng?.path,
      workspacePath: this.env.workspaceRoot,
      doctor: this.lastDoctor,
      packaged: this.env.packaged,
    };
  }

  async runAll() { // L9863
    if (this.running) return this.status();
    this.running = true;
    this.appendSetupLog("— setup run started —");
    try {
      const step = async (id: StepId, fn: () => Promise<string | "skip">) => {
        this.emitProgress({ step: id, status: "running" });
        this.appendSetupLog(`${id}: running`);
        try {
          const detail = await fn();
          this.emitProgress({ step: id, status: detail === "skip" ? "skip" : "ok", detail: detail === "skip" ? undefined : detail });
          this.appendSetupLog(detail === "skip" ? `${id}: skip (already satisfied)` : `${id}: ok — ${detail}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const reason = classifyBootstrapFailure(e);
          this.emitProgress({ step: id, status: "fail", detail: msg.slice(0, 400), reason });
          this.appendSetupLog(`${id}: fail${reason ? ` (${reason})` : ""} — ${msg.slice(0, 2e3)}`);
          this.beacon?.(`bootstrap-${id}`, msg);
          throw e;
        }
      };
      await step("layout", async () => {
        mkdirSync(this.enginesRoot(), { recursive: true });
        mkdirSync(this.env.workspaceRoot, { recursive: true });
        return `engines=${this.enginesRoot()} · workspace=${this.env.workspaceRoot}`;
      });
      const activeBeforeRepair = this.currentEngine();
      let enginePath = activeBeforeRepair?.path ?? "";
      let doctorWorkspace = this.env.workspaceRoot;
      let isolated = false;
      await step("engine", async () => {
        const { manifest, fetch } = await this.hooks.resolveEngineSource();
        const activeSameVersion = activeBeforeRepair?.version === manifest.version && this.exists(activeBeforeRepair.path) ? activeBeforeRepair : undefined;
        // (repair-diagnostics beacon L9906-9935 omitted: telemetry only, no effect on install)
        const target = activeSameVersion
          ? this.pm.join(this.enginesRoot(), `engine-${manifest.version}-repair-${randomUUID().slice(0, 8)}`)
          : this.pm.join(this.enginesRoot(), `engine-${manifest.version}`);
        enginePath = await this.installEngineDir(manifest, fetch, target, (phase, fraction) => this.emitProgress({ step: "engine", status: "running", phase, fraction }));
        return `v${manifest.version} → ${enginePath}`;
      });
      await step("venv", () => this.ensureVenv(enginePath));
      await step("remotion", () => this.ensureRemotion(enginePath));
      await step("hyperframes", () => this.ensureHyperframes(enginePath));
      await step("workspace", async () => {
        if (activeBeforeRepair && activeBeforeRepair.path !== enginePath) {
          doctorWorkspace = this.pm.join(enginePath, ".videoclaw-doctor-workspace");
          rmSync(doctorWorkspace, { recursive: true, force: true });
          this.hooks.writeWorkspace(enginePath, doctorWorkspace);
          isolated = true;
          return `staged candidate hooks in ${doctorWorkspace}`;
        }
        this.hooks.writeWorkspace(enginePath);
        return `wired ${this.env.workspaceRoot} → engine hooks`;
      });
      await step("env", async () => this.writeEnvFile(enginePath));
      await step("doctor", async () => {
        try {
          const report = await this.doctor(enginePath, doctorWorkspace);
          this.lastDoctor = report;
          if (!report.ok) throw new Error(`doctor failed → ${doctorFailures(report)}`);
          await this.activateEngine(enginePath);
          return "all green — engine activated";
        } finally {
          if (isolated) rmSync(doctorWorkspace, { recursive: true, force: true });
        }
      });
    } finally {
      this.running = false;
    }
    await this.hooks.revalidateStudioBundle();
    return this.status();
  }

  async installEngineDir(manifest: EngineManifest, fetchTarball: (cb?: (r: number, t?: number) => void) => Promise<string>, target: string, onPhase?: (phase: string, fraction?: number) => void): Promise<string> { // L9990
    onPhase?.("download");
    let lastEmit = 0;
    const tarball = await fetchTarball((received, total) => {
      if (!onPhase || !total) return;
      const now = Date.now();
      if (received < total && now - lastEmit < 250) return;
      lastEmit = now;
      onPhase("download", Math.min(1, received / total));
    });
    onPhase?.("verify");
    const digest = await sha256File(tarball);
    if (!/^[0-9a-f]{64}$/i.test(manifest.sha256 ?? "")) throw new Error("engine manifest has no valid sha256");
    if (digest !== manifest.sha256!.toLowerCase()) throw new Error(`engine sha mismatch: got ${digest.slice(0, 12)}…`);
    onPhase?.("unpack");
    const staging = `${target}.staging`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    await runInv(this.run, tarInvocation(["-xf", tarball, "-C", staging, "--strip-components", "1"], { platform: this.env.platform }));
    const binDir = this.pm.join(staging, "bin");
    mkdirSync(binDir, { recursive: true });
    for (const b of ["ffmpeg", "ffprobe", "uv"] as const) {
      const src = this.env.bootstrapTool(b);
      if (src) {
        const dst = this.pm.join(binDir, exeName(b, this.env.platform)); // PORT: keep .exe on win32
        copyFileSync(src, dst);
        chmodSync(dst, 493); // no-op on win32
      }
    }
    writeFileSync(this.pm.join(staging, ".videoclaw-build-sha256"), `${digest}\n`, { mode: 384 });
    this.hooks.assertInstalledEngineProductionContract(staging);
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
    return target;
  }

  async ensureVenv(enginePath: string): Promise<string> { // L10036
    this.hooks.ensureEngineCommandShims(enginePath);
    const uv = this.tool("uv");
    const python = await this.hooks.nativePythonArgs(uv, { cwd: enginePath, project: enginePath });
    await this.run(uv, syncArgv(enginePath, python), { cwd: enginePath, env: { ...UV_PYTHON_POLICY_ENV }, timeoutMs: 20 * 6e4 });
    return "uv sync --frozen: venv ready";
  }

  async ensureRemotion(enginePath: string): Promise<string> { // L10047
    const rem = this.pm.join(enginePath, "remotion");
    const env = { [isWin(this.env.platform) ? pathEnvKey(process.env, this.env.platform) : "PATH"]: this.enginePathEnv(enginePath) };
    if (this.exists(this.pm.join(rem, "node_modules"))) return "skip";
    const npm = npmInvocation("npm", ["ci", "--no-audit", "--no-fund"], { platform: this.env.platform, nodeDirs: this.nodeDirs(), exists: this.exists });
    await runInv(this.run, npm, { cwd: rem, env, timeoutMs: 20 * 6e4 });
    const npx = npmInvocation("npx", ["remotion", "browser", "ensure"], { platform: this.env.platform, nodeDirs: this.nodeDirs(), exists: this.exists });
    await runInv(this.run, npx, { cwd: rem, env, timeoutMs: 10 * 6e4 }).catch(() => {});
    return "npm ci + browser ensure";
  }

  async ensureHyperframes(enginePath: string): Promise<string> { // L10067
    const project = this.pm.join(enginePath, "hyperframes");
    const env = { [isWin(this.env.platform) ? pathEnvKey(process.env, this.env.platform) : "PATH"]: this.enginePathEnv(enginePath) };
    if (this.exists(this.pm.join(project, "node_modules", "hyperframes", "package.json"))) return "skip";
    if (!this.exists(this.pm.join(project, "package-lock.json"))) throw new Error("installed engine has no HyperFrames lockfile");
    const npm = npmInvocation("npm", ["ci", "--no-audit", "--no-fund"], { platform: this.env.platform, nodeDirs: this.nodeDirs(), exists: this.exists });
    await runInv(this.run, npm, { cwd: project, env, timeoutMs: 20 * 6e4 });
    return "npm ci: HyperFrames renderer/player ready";
  }

  writeEnvFile(enginePath: string): string { // L10082
    scrubEngineGatewaySecrets(enginePath, this.env.platform);
    return ".env scrubbed (gateway authority stays in the app process)";
  }

  async doctor(enginePath: string, ws = this.env.workspaceRoot): Promise<any> { // L10086
    this.hooks.validateEngineSessionContext(enginePath);
    return (this.hooks.runDoctor ?? ((e, w) => this.runDoctor(e, w)))(enginePath, ws);
  }

  async runDoctor(enginePath: string, ws = this.env.workspaceRoot): Promise<any> { // L9689
    const out = await this.run(this.tool("uv"), doctorArgv(enginePath, this.env.platform), {
      cwd: enginePath,
      env: engineDoctorEnv({ enginePath, workspace: ws, enginePathEnv: this.enginePathEnv(enginePath), gatewayUrl: this.env.gatewayUrl, platform: this.env.platform }),
      timeoutMs: 5 * 6e4,
    }).catch((e: any) => { if (e?.stdout) return e.stdout as string; throw e; });
    return parseDoctorOutput(out);
  }

  async activateEngine(enginePath: string): Promise<boolean> { // L10219
    const active = this.currentEngine();
    const version = JSON.parse(readFileSync(this.pm.join(enginePath, "ENGINE_VERSION.json"), "utf-8")).version;
    const buildSha256 = readHashFile(this.pm.join(enginePath, ".videoclaw-build-sha256"));
    if (!buildSha256) throw new Error("engine build digest is missing or invalid");
    await this.hooks.assertEngineMoneyCompatibility(enginePath);
    this.hooks.ensureEngineCommandShims(enginePath);
    this.hooks.writeWorkspace(enginePath);
    mkdirSync(this.pm.dirname(this.enginePointerFile()), { recursive: true });
    const pointer: any = { version, path: enginePath, buildSha256 };
    if (active && active.path !== enginePath) pointer.previous = active;
    const pointerPath = this.enginePointerFile();
    const stagingPath = `${pointerPath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(stagingPath, JSON.stringify(pointer), { mode: 384 });
    renameSync(stagingPath, pointerPath);
    return true;
  }
}

/** Default hooks: each unported collaborator throws a labelled error (never a fake pass). */
export function notPortedHooks(partial: Partial<BootstrapHooks> = {}): BootstrapHooks {
  const np = (name: string) => () => { throw new Error(`NOT PORTED: ${name} (see docs/10)`); };
  return {
    resolveEngineSource: async () => np("resolveEngineSource L9496")(),
    validateEngineSessionContext: np("validateEngineSessionContext L4188"),
    assertInstalledEngineProductionContract: np("assertInstalledEngineProductionContract L6982"),
    inspectProductionCompatible: np("inspectInstalledEngineProductionContract L6952") as any,
    writeWorkspace: np("writeWorkspace L9650"),
    assertEngineMoneyCompatibility: async () => np("assertEngineMoneyCompatibility")(),
    revalidateStudioBundle: async () => {},
    nativePythonArgs: async () => [], // faithful on non-darwin-arm64 (L7172 early return)
    ensureEngineCommandShims: np("ensureEngineCommandShims"),
    ...partial,
  };
}

/** Bundled half of resolveEngineSource (L9541-9570), verbatim. The gateway half (L9500-9540:
 *  `GET ${gatewayUrl}/v1/engine/latest` with the account key, then a streamed download) is
 *  NOT PORTED — the port must not make that network call until the Windows engine artifact
 *  question is settled (the gateway would hand out the macOS engine; see docs/08). When a
 *  gateway key is present the port records that it skipped the gateway. */
export function resolveBundledEngineSource(o: { resourcesPath: string; env: NodeJS.ProcessEnv; appVersion: string; packaged: boolean; gatewaySkipped?: boolean; platform?: Plat; exists?: (p: string) => boolean }) {
  const pm = pathMod(o.platform);
  const exists = o.exists ?? existsSync;
  const rejected: string[] = [];
  if (o.gatewaySkipped) rejected.push("gateway: NOT PORTED (port skips the gateway engine download)");
  for (const dir of [pm.join(o.resourcesPath ?? "", "bootstrap"), o.env.VIDEOCLAW_ENGINE_DIST ?? ""]) {
    if (!dir) continue;
    const manifestPath = pm.join(dir, "engine.manifest.json");
    if (exists(manifestPath)) {
      const parsed = engineManifestCompatibility(JSON.parse(readFileSync(manifestPath, "utf-8")), o.appVersion);
      if (!parsed.compatible) { rejected.push(`bundled: ${parsed.reason}`); continue; }
      const manifest = parsed.manifest;
      const tarball = pm.join(dir, manifest.file ?? `engine-${manifest.version}.tar.gz`);
      if (exists(tarball)) return { manifest, fetch: async () => tarball };
    }
  }
  const managedLaunch = !o.packaged && o.env.VIDEOCLAW_MANAGED_DEV === "1";
  throw new Error(
    `no compatible engine source: gateway unreachable/keyless and no bundled tarball ${rejected.length ? `(${rejected.join("; ")}) ` : ""}` +
      (managedLaunch
        ? "(npm run dev/staging downloads the engine from the staging gateway: check the connection and sign-in, then retry setup)"
        : "(dev: set VIDEOCLAW_ENGINE_DIST to a dir with engine.manifest.json + tarball)"),
  );
}
