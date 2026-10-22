// Port of runBash (out/main/index.js L25270-25387; constants L25251-25256, truncate
// L25257-25269). Behaviour identical except the two OS touch points, routed through
// the platform layer:
//   * shell: original spawn("/bin/bash", ["-c", …]) → platform.bashShell() (Git Bash on win32);
//   * tree kill: original process.kill(-pid) on POSIX / child.kill() on win32 →
//     platform.killTree() (taskkill /T on win32 — PORT IMPROVEMENT, the original orphaned
//     grandchildren on Windows).
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { existsSync } from "node:fs";
import { withOutputPipefail } from "./shell-command";
import { bashShell, spawnDetachedForGroup, type ShellChoice } from "../platform/shell";
import { killTree as platformKillTree } from "../platform/kill";
import { which } from "../platform/which";
import { statSync } from "node:fs";

export const DEFAULT_BASH_TIMEOUT_MS = 12e4;
export const MAX_BASH_TIMEOUT_MS = 6e5;
export const MAX_OUTPUT_CHARS = 3e4;
export const OUTPUT_TAIL_CHARS = 8e3;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = Math.min(OUTPUT_TAIL_CHARS, Math.floor(max / 2));
  const head = max - tail;
  return text.slice(0, head) + `\n… [truncated — ${text.length - max} characters omitted] …\n` + text.slice(text.length - tail);
}

/** PORT-WIN docs/36 (W13): without Git Bash the only shell left is cmd.exe, which cannot run the agent's bash-syntax
 *  engine commands (`uv run … | tail -n N`, `$VIDEOCLAW_ENGINE`, `&&` chains with `cd`) — they would "run but do the
 *  wrong thing". Fail closed with an actionable message instead of spawning a degraded shell. */
export const NO_BASH_MESSAGE =
  "Bash is unavailable: Git for Windows (bash.exe) was not found on PATH or under Program Files. Install Git for Windows (https://git-scm.com/download/win) and restart the app.";

export interface BashInput { command: string; timeout?: number }
export interface BashEnv {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  deps?: {
    spawn?: (file: string, args: string[], opts: SpawnOptions) => ChildProcess;
    shell?: ShellChoice;
    killTree?: (pid: number, signal: NodeJS.Signals) => boolean;
    platform?: NodeJS.Platform;
  };
}
export interface BashResult { output: string; isError: boolean }

const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };

export function runBash(input: BashInput, env: BashEnv): Promise<BashResult> {
  const spawn = env.deps?.spawn ?? nodeSpawn;
  const platform = env.deps?.platform ?? process.platform;
  const shell = env.deps?.shell ?? bashShell({ platform, env: env.env, which: (c) => which(c, { env: env.env, platform, isFile }), exists: existsSync });
  const treeKill = env.deps?.killTree ?? ((pid: number, sig: NodeJS.Signals) => platformKillTree(pid, sig, { platform }));
  const timeout = Math.min(Math.max(1, input.timeout ?? DEFAULT_BASH_TIMEOUT_MS), MAX_BASH_TIMEOUT_MS);
  if (shell.degraded) return Promise.resolve({ output: NO_BASH_MESSAGE, isError: true });
  return new Promise((resolvePromise) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let abortKillTimer: NodeJS.Timeout | undefined;
    let child: ChildProcess | undefined;
    let aborting = false;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      env.signal?.removeEventListener("abort", onAbort);
    };
    const done = (r: BashResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(r);
    };
    const killTree = (signal: NodeJS.Signals) => {
      if (!child) return;
      if (typeof child.pid === "number" && treeKill(child.pid, signal)) return;
      try { child.kill(signal); } catch {}
    };
    const abortedResult = (): BashResult => ({
      output: truncate(out, MAX_OUTPUT_CHARS) + (out ? "\n\nCommand aborted" : "Command aborted"),
      isError: true,
    });
    const onAbort = () => {
      if (settled || aborting) return;
      aborting = true;
      killTree("SIGTERM");
      abortKillTimer = setTimeout(() => {
        killTree("SIGKILL");
        done(abortedResult());
      }, 250);
    };
    let out = "";
    if (env.signal?.aborted) {
      done(abortedResult());
      return;
    }
    try {
      child = spawn(shell.file, shell.argsFor(withOutputPipefail(input.command)), {
        cwd: env.cwd,
        env: env.env,
        detached: spawnDetachedForGroup(platform),
        windowsHide: true,
      });
    } catch (err) {
      done({ output: `Command failed to start: ${(err as Error).message}`, isError: true });
      return;
    }
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    const collector = (stream: "stdout" | "stderr") => (chunk: Buffer | string) => {
      out += typeof chunk === "string" ? chunk : decoders[stream].write(chunk);
    };
    const flushDecoders = () => { out += decoders.stdout.end() + decoders.stderr.end(); };
    child.stdout?.on("data", collector("stdout"));
    child.stderr?.on("data", collector("stderr"));
    timer = setTimeout(() => {
      killTree("SIGKILL");
      done({ output: truncate(out, MAX_OUTPUT_CHARS) + `\n\nCommand timed out after ${timeout}ms`, isError: true });
    }, timeout);
    timer.unref?.();
    env.signal?.addEventListener("abort", onAbort, { once: true });
    if (env.signal?.aborted) onAbort();
    child.on("error", (err) => {
      if (aborting) return;
      done({ output: `Command failed to start: ${err.message}`, isError: true });
    });
    child.on("close", (code) => {
      if (aborting) return;
      flushDecoders();
      const body = truncate(out, MAX_OUTPUT_CHARS);
      if (code === 0) done({ output: body, isError: false });
      else done({ output: (body ? body + "\n\n" : "") + `Command exited with code ${code ?? "null"}`, isError: true });
    });
  });
}
