// PORT-NEW generator: emits TypeScript modules that are VERBATIM line slices of the shipped
// main process (app/reconstructed/main/index.js, the prettier-formatted app/out/main/index.js)
// or a shipped chunk, plus an explicit, reviewed list of textual substitutions (each one a
// platform-layer routing, e.g. `.venv/bin/python` → venvPython()). Slices are located by
// anchor regexes, not hard-coded line numbers, and the emitted header records the lines.
// test/verbatim.test.ts re-runs the generator in memory and asserts the files are current.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const portRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(portRoot, "..");
const SRC = {
  main: "app/reconstructed/main/index.js",
  wb: "app/out/main/chunks/workbookContents-ChzKjQX1.js",
};
const lines = Object.fromEntries(Object.entries(SRC).map(([k, f]) => [k, readFileSync(join(repo, f), "utf8").split("\n")]));

function find(src, re, from = 0) {
  const i = lines[src].findIndex((l, n) => n >= from && re.test(l));
  if (i < 0) throw new Error(`anchor not found in ${SRC[src]}: ${re}`);
  return i;
}
/** [start, end] inclusive, end = first line matching `endRe` at/after start (inclusive). */
function slice(src, startRe, endRe, afterRe) {
  const s = find(src, startRe);
  const e = find(src, endRe, afterRe ? find(src, afterRe, s) : s);
  return { src, s, e, text: lines[src].slice(s, e + 1).join("\n") };
}

export const SPECS = [
  {
    out: "src/main/engine/session-context.generated.ts",
    imports: [
      'import { createHash } from "node:crypto";',
      'import { existsSync, readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { BANNED_USER_FACING_VOCABULARY, VOICE_GUARD } from "./voice-guard";',
      'import { venvPython } from "../platform";',
    ],
    slices: () => [
      slice("main", /^const SESSION_LAWS_VERSION = /, /^}$/ /* end of parseSessionLawsVersion */),
      slice("main", /^const REQUIRED_SESSION_CONTEXT_FILES = \{/, /^};$/),
      slice("main", /^class SessionContextError extends Error \{/, /^}$/, /^function assertEnginePython\(/),
    ],
    subs: [
      // assertEnginePython: the engine venv interpreter path differs on win32 (.venv\Scripts\python.exe).
      ['existsSync(join(engineDir, ".venv", "bin", "python"))', "existsSync(venvPython(engineDir))", 1],
    ],
    exports: ["REQUIRED_SESSION_CONTEXT_FILES", "SessionContextError", "PORTABLE_ENGINE_ROOT", "validateCanonicalSettings", "parseSessionLawsVersion", "readRequired", "sourceHashes", "validateEngineSessionContext", "validateInstalledEngineSessionContext", "ENGINE_PYTHON_PROBLEM", "assertEnginePython", "sha256$4 as sessionSha256"],
  },
  {
    out: "src/main/engine/money-compat.generated.ts",
    imports: [
      'import { execFile } from "node:child_process";',
      'import { existsSync, statSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { venvPython } from "../platform";',
    ],
    slices: () => [
      slice("wb", /^const PAID_GEN_TOOLS = \[/, /^\];$/),
      slice("wb", /^function unpricedPaidGenTools\(/, /^}$/),
      slice("main", /^const BILLING_CLI_CONTRACT_SCHEMA = /, /^const compatibilityCache = /),
      slice("main", /^function stringArray\(value\)/, /^async function assertEngineMoneyCompatibility\(/),
      slice("main", /^  const result = await inspectEngineMoneyCompatibility\(enginePath\);/, /^}$/),
    ],
    subs: [
      ['join(enginePath, ".venv", "bin", "python")', "venvPython(enginePath)", 2],
    ],
    exports: ["PAID_GEN_TOOLS", "unpricedPaidGenTools", "billingCliCapabilities", "PRICE_SURFACE_DUMP", "inspectEngineMoneyCompatibility", "cachedEngineMoneyCompatibility", "EngineMoneyCompatibilityError", "assertEngineMoneyCompatibility"],
  },
  {
    out: "src/main/engine/production-contract.generated.ts",
    imports: ['import { readFileSync } from "node:fs";', 'import { join } from "node:path";'],
    slices: () => [
      slice("main", /^const PRODUCTION_VERDICT_SCHEMA = /, /^const ROUTE_RECEIPT_SCHEMA = /),
      slice("main", /^function exactPythonConstant\(/, /^}$/, /^function assertInstalledEngineProductionContract\(/),
    ],
    subs: [],
    exports: ["PRODUCTION_VERDICT_SCHEMA", "PRODUCTION_ANALYZER", "ROUTE_RECEIPT_SCHEMA", "exactPythonConstant", "inspectInstalledEngineProductionContract", "assertInstalledEngineProductionContract"],
  },
];

export function render(spec) {
  let body = "";
  const where = [];
  for (const sl of spec.slices()) {
    where.push(`${SRC[sl.src]} L${sl.s + 1}-${sl.e + 1}`);
    body += sl.text + "\n";
  }
  for (const [from, to, n] of spec.subs) {
    const count = body.split(from).length - 1;
    if (count !== n) throw new Error(`${spec.out}: substitution ${from} expected ${n}, found ${count}`);
    body = body.split(from).join(to);
  }
  return [
    "// @ts-nocheck — GENERATED by tools/gen-verbatim.mjs. DO NOT EDIT.",
    "// Verbatim slices of the shipped bundle:",
    ...where.map((w) => `//   ${w}`),
    "// Substitutions (platform-layer routing only):",
    ...spec.subs.map(([f, t, n]) => `//   ${n}× ${f}  →  ${t}`),
    ...spec.imports,
    "",
    body.trimEnd(),
    "",
    `export { ${spec.exports.join(", ")} };`,
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const spec of SPECS) {
    const text = render(spec);
    if (!check) { writeFileSync(join(portRoot, spec.out), text); continue; }
    let cur = "";
    try { cur = readFileSync(join(portRoot, spec.out), "utf8"); } catch {}
    if (cur !== text) { stale++; console.error(`stale: ${spec.out}`); }
  }
  if (stale) process.exit(1);
}
