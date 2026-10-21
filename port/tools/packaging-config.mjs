// PORT-NEW (docs/18): electron-builder configuration for the port, as a pure function so it can be
// unit-tested (test/packaging.test.ts) and driven by tools/package.mjs.
//
// Layout of a packaged app (all targets):
//   resources/app.asar                    dist/** (esbuild bundles: main, preload, renderer, worker, cli)
//                                         + package.json. No node_modules: every runtime dependency is
//                                         bundled by esbuild (only `electron` is external).
//   resources/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk          (SDK, ESM)
//   resources/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-<os>-<arch>/claude[.exe]
//   resources/claude-agent-sdk/node_modules/<peer deps: @anthropic-ai/sdk, @modelcontextprotocol/sdk, zod …>
// → agent-sdk.ts discovery candidate #4 `<resourcesPath>/claude-agent-sdk` (resolveSdkPackageDir
//   checks <dir>/node_modules/@anthropic-ai/claude-agent-sdk). Kept OUTSIDE app.asar on purpose: the
//   SDK spawns the native `claude` executable, which cannot be executed from inside an asar archive
//   (the original solves the same problem with asarUnpack → app.asar.unpacked/node_modules, which our
//   discovery also checks as candidate #3).
// NOT bundled (external, env-configured, docs/02 + docs/18 §4): ffmpeg/ffprobe, node, uv, codex, the
// Python engine (installed by bootstrap at runtime from its own source), Claude Code sign-in.

/** electron-builder platform keys → node process.platform values. */
export const PLATFORMS = {
  linux: { os: "linux", targets: ["AppImage", "deb"], exe: "claude", verifiedOnBox: true },
  win: { os: "win32", targets: ["nsis", "portable"], exe: "claude.exe", verifiedOnBox: false },
  mac: { os: "darwin", targets: ["dmg"], exe: "claude", verifiedOnBox: false },
};
export const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";
export const SDK_RESOURCE_DIR = "claude-agent-sdk";
export const ORIGINAL_RENDERER_RESOURCE_DIR = "renderer-original";

/** Native-binary package name for a node platform/arch (what install-agent-sdk.mjs pulls in). */
export const nativeSdkPackage = (os, arch) => `${SDK_PACKAGE}-${os}-${arch}`;

/** Filter for extraResources: keep the SDK + its peers, drop native packages of OTHER platforms
 *  (npm --os/--cpu already avoids most; this is a guard against a stale multi-platform vendor dir). */
export function sdkResourceFilter(os, arch) {
  const keep = nativeSdkPackage(os, arch);
  const drop = [];
  for (const p of Object.values(PLATFORMS)) for (const a of ["x64", "arm64"]) for (const suf of ["", "-musl"]) {
    const name = `${nativeSdkPackage(p.os, a)}${suf}`;
    // the -musl build of the target is dropped too (glibc assumed; 200+ MB) — see docs/18 §6
    if (name !== keep) drop.push(`!${name}{,/**/*}`);
  }
  return ["**/*", ...drop, "!**/.bin{,/**/*}", "!**/*.map"];
}

/**
 * @param {{ platform: "linux"|"win"|"mac", arch: "x64"|"arm64", sdkDir?: string|null, version: string, outDir?: string }} o
 *   sdkDir = an install-agent-sdk.mjs directory (contains node_modules/@anthropic-ai/claude-agent-sdk),
 *   null = package WITHOUT the SDK (agent path then needs VIDEOCLAW_CLAUDE_AGENT_SDK / ~/.videoclaw).
 *   originalRendererDir (docs/21 M1) = the shipped, unmodified app/out/renderer → resources/renderer-original
 *   (the window's default page, see src/main/renderer-entry.ts).
 *   quickstartsDir (docs/24) = the shipped app/resources/quickstarts → resources/quickstarts.
 */
export function builderConfig(o) {
  const p = PLATFORMS[o.platform];
  if (!p) throw new Error(`unknown platform ${o.platform}`);
  const extraResources = [
    ...(o.sdkDir ? [{ from: `${o.sdkDir}/node_modules`, to: `${SDK_RESOURCE_DIR}/node_modules`, filter: sdkResourceFilter(p.os, o.arch) }] : []),
    ...(o.originalRendererDir ? [{ from: o.originalRendererDir, to: ORIGINAL_RENDERER_RESOURCE_DIR, filter: ["**/*", "!**/*.map"] }] : []),
    // docs/24: the shipped bundled Quickstart catalog (app/resources/quickstarts) → resources/quickstarts,
    // the original QuickstartCatalogStore candidate root join(process.resourcesPath, "quickstarts") (L61021)
    ...(o.quickstartsDir ? [{ from: o.quickstartsDir, to: "quickstarts" }] : []),
  ];
  return {
    appId: "com.videoclaw.port",
    // distinct from the original "Videoclaw" → separate userData dir (~/.config/Videoclaw Port),
    // so a packaged port never rewrites the real app's settings.json
    productName: "Videoclaw Port",
    executableName: "videoclaw-port",
    copyright: "Videoclaw port (reconstruction) — not an official build",
    artifactName: "Videoclaw-Port-${version}-${os}-${arch}.${ext}",
    directories: { output: o.outDir ?? "release", buildResources: "build-resources" },
    asar: true,
    files: ["package.json", "dist/**/*", "!dist/**/*.map", "!node_modules{,/**/*}", "!vendor{,/**/*}", "!dist-test{,/**/*}"],
    extraMetadata: { main: "dist/main/index.cjs", version: o.version, desktopName: "videoclaw-port.desktop" },
    extraResources,
    // node:sqlite is a Node builtin inside Electron (no native addon) → nothing to rebuild
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    // docs/33 M16 T3: a generic publish target so electron-builder writes resources/app-update.yml
    // (updaterCacheDirName) — electron-updater's download helper reads it even when createAppUpdater sets the feed
    // URL itself (L2257 setFeedURL `${gateway}/v1/app/updates/${channel}/`). Nothing is uploaded (publish: "never").
    publish: [{ provider: "generic", url: "https://videoclaw-gw-650303209435.us-central1.run.app/v1/app/updates/latest/" }],
    linux: {
      target: p.os === "linux" ? p.targets.map((t) => ({ target: t, arch: [o.arch] })) : undefined,
      category: "AudioVideo",
      syncDesktopName: true,
      maintainer: "Videoclaw port <port@videoclaw.invalid>",
      synopsis: "Videoclaw desktop (port)",
      description: "Cross-platform port of the Videoclaw 0.0.40 Electron shell (custom LLM routes, Claude Agent SDK).",
    },
    deb: { depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"] },
    // UNVERIFIED on the box (no wine / macOS): config only, see docs/18 §6
    win: { target: p.os === "win32" ? p.targets.map((t) => ({ target: t, arch: [o.arch] })) : undefined },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, artifactName: "Videoclaw-Port-${version}-win-${arch}-setup.${ext}" },
    // docs/34 M17: a portable single-file .exe next to the installer (distinct name — both would be .exe)
    portable: { artifactName: "Videoclaw-Port-${version}-win-${arch}-portable.${ext}" },
    mac: { target: p.os === "darwin" ? p.targets.map((t) => ({ target: t, arch: [o.arch] })) : undefined, category: "public.app-category.video", hardenedRuntime: true, identity: null },
    dmg: { artifactName: "Videoclaw-Port-${version}-${arch}.dmg" },
  };
}

/** Checks a staged SDK dir before packaging (pure; fs injected). Returns problems (empty = ok). */
export function validateSdkStaging(sdkDir, { os, arch, pinned, exists, readJson }) {
  const problems = [];
  const sdkPkg = `${sdkDir}/node_modules/${SDK_PACKAGE}`;
  if (!exists(`${sdkPkg}/package.json`) || !exists(`${sdkPkg}/sdk.mjs`)) { problems.push(`SDK not installed under ${sdkDir} (run npm run agent-sdk:install)`); return problems; }
  const v = readJson(`${sdkPkg}/package.json`).version;
  if (v !== pinned) problems.push(`SDK version ${v} != pinned ${pinned}`);
  const exe = `${sdkDir}/node_modules/${nativeSdkPackage(os, arch)}/${os === "win32" ? "claude.exe" : "claude"}`;
  if (!exists(exe)) problems.push(`native claude binary missing: ${exe} (install with --os ${os} --cpu ${arch})`);
  return problems;
}
