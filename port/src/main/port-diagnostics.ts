// PORT-NEW (docs/18): self check used by the packaged app (settings page "About this build", the
// Electron smoke and `port-cli agent-sdk-check`). Electron-free: the caller passes app facts.
// Never imports the SDK (discovery + file checks only) and never touches secrets.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSdkStatus, PortDiagnostics } from "../shared/port-ipc";
import { claudeCodeExecutableFor, discoverClaudeAgentSdk, PINNED_CLAUDE_AGENT_SDK_VERSION, type SdkDiscoveryOptions } from "./llm/agent-sdk";
import { checkSqliteCapability } from "./models-dev/sqlite";

export function agentSdkStatus(o: SdkDiscoveryOptions & { platform?: string; arch?: string } = {}): AgentSdkStatus {
  try {
    const d = discoverClaudeAgentSdk(o);
    const version = JSON.parse(readFileSync(join(d.packageDir, "package.json"), "utf8")).version as string;
    const executable = claudeCodeExecutableFor(d.packageDir, { env: o.env, exists: o.exists, platform: o.platform, arch: o.arch }) ?? null;
    return {
      ok: !!executable, source: d.source, packageDir: d.packageDir, version, pinned: PINNED_CLAUDE_AGENT_SDK_VERSION, matchesPin: version === PINNED_CLAUDE_AGENT_SDK_VERSION, executable,
      ...(executable ? {} : { error: "native claude binary for this platform not found next to the SDK (optional dependency skipped?)" }),
    };
  } catch (e) {
    return { ok: false, pinned: PINNED_CLAUDE_AGENT_SDK_VERSION, error: e instanceof Error ? e.message : String(e) };
  }
}

export function portDiagnostics(a: { version: string; packaged: boolean; resourcesPath?: string | null; appPath: string; userData: string; env?: NodeJS.ProcessEnv }): PortDiagnostics {
  const sq = checkSqliteCapability();
  return {
    app: {
      version: a.version, packaged: a.packaged, resourcesPath: a.resourcesPath ?? null, appPath: a.appPath, userData: a.userData,
      electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, platform: process.platform, arch: process.arch,
    },
    sqlite: { ok: sq.ok, sqliteVersion: sq.sqliteVersion, error: sq.error },
    agentSdk: agentSdkStatus({ env: a.env, resourcesPath: a.resourcesPath ?? undefined, exists: existsSync }),
  };
}
