// Evaluates verbatim slices of app/reconstructed/main/index.js (pure functions only)
// so ports can be compared against the original text, not against our reading of it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const SRC = readFileSync(join(process.cwd(), "../app/reconstructed/main/index.js"), "utf8").split("\n");
export function slice(from: number, to: number): string { return SRC.slice(from - 1, to).join("\n"); }
export function lineOf(re: RegExp): number { const i = SRC.findIndex((l) => re.test(l)); if (i < 0) throw new Error(`not found ${re}`); return i + 1; }
/** Return the text from the line matching `start` to the closing line `}` of that function. */
export function fnText(start: RegExp): string {
  const a = lineOf(start);
  let b = a;
  while (SRC[b - 1] !== "}") b++;
  return slice(a, b);
}
export function evalOriginal<T>(code: string, exportsExpr: string, scope: Record<string, unknown> = {}): T {
  return new Function(...Object.keys(scope), `${code}\nreturn (${exportsExpr});`)(...Object.values(scope)) as T;
}
