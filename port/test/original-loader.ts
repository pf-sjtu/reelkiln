// Loads modules straight from the SHIPPED bundle (app/out/main) for differential tests.
// Only modules whose imports are node built-ins (+ yauzl, stubbed) can be loaded.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = join(process.cwd(), "../app/out/main");
const dynImport = new Function("u", "return import(u)") as (u: string) => Promise<any>;

export async function loadOriginalChunk(prefix: string): Promise<any> {
  const dir = mkdtempSync(join(tmpdir(), "vc-orig-"));
  const file = readdirSync(join(OUT, "chunks")).find((f) => f.startsWith(prefix))!;
  copyFileSync(join(OUT, "chunks", file), join(dir, file));
  mkdirSync(join(dir, "node_modules", "yauzl"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "yauzl", "package.json"), JSON.stringify({ name: "yauzl", type: "module", main: "index.js" }));
  writeFileSync(join(dir, "node_modules", "yauzl", "index.js"), "export default {};\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  return dynImport(pathToFileURL(join(dir, file)).href);
}
export async function loadOriginalWorker(name: string): Promise<any> {
  return dynImport(pathToFileURL(join(OUT, name)).href);
}
