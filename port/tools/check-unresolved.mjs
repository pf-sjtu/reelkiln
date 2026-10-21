// PORT-NEW dev helper: report identifiers a GENERATED (@ts-nocheck) verbatim slice uses but never
// declares/imports (TS2304 "Cannot find name"), so a missing collaborator fails here, not at runtime.
//   node tools/check-unresolved.mjs src/main/agent/production-auth.generated.ts ...
import ts from "typescript";
import { readFileSync } from "node:fs";
let bad = 0;
for (const f of process.argv.slice(2)) {
  const text = readFileSync(f, "utf8").replace("// @ts-nocheck", "//");
  const host = ts.createCompilerHost({});
  const orig = host.getSourceFile;
  host.getSourceFile = (n, l, ...r) => (n === f ? ts.createSourceFile(n, text, l) : orig(n, l, ...r));
  const p = ts.createProgram([f], { noEmit: true, allowJs: true, types: ["node"], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true }, host);
  const ds = p.getSemanticDiagnostics(p.getSourceFile(f)).filter((d) => d.code === 2304 || d.code === 2552);
  const names = [...new Set(ds.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ").match(/'([^']+)'/)?.[1]))];
  console.log(`${f}: ${names.length ? "UNRESOLVED " + names.join(", ") : "ok"}`);
  bad += names.length;
}
process.exit(bad ? 1 : 0);
