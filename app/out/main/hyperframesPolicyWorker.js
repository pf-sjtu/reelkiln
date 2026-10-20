import { realpathSync, statSync, readFileSync, lstatSync, readdirSync } from "node:fs";
import { p as parseComposition } from "./chunks/compositionEdit-Dc8_ecez.js";
import { resolve, extname, relative, sep } from "node:path";
const TEXT_EXTENSIONS = /* @__PURE__ */ new Set([".html", ".htm", ".js", ".mjs", ".css"]);
const NETWORK_API = /\b(?:fetch\s*\(|new\s+(?:XMLHttpRequest|WebSocket|EventSource)\b|(?:XMLHttpRequest|WebSocket|EventSource)\s*\()/i;
const ATTRIBUTE_REF = /\b(?:src|href)\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;
const CSS_REF = /url\(\s*(?:(["'])(.*?)\1|([^\s)]+))\s*\)/gi;
const MODULE_REF = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gi;
const DYNAMIC_IMPORT_REF = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gi;
const MAX_POLICY_FILE_BYTES = 8 * 1024 * 1024;
const MAX_POLICY_FILES = 128;
const MAX_POLICY_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_RUNTIME_FILES = 256;
const MAX_RUNTIME_TOTAL_BYTES = 32 * 1024 * 1024;
const REQUIRED_RUNTIME_FILES = ["gsap.min.js", "fonts/fonts.css"];
function contained(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel);
}
function runtimeMatches(sourceDir, destinationDir) {
  let sourceRoot;
  let destinationRoot;
  try {
    if (lstatSync(destinationDir).isSymbolicLink()) return false;
    sourceRoot = realpathSync(sourceDir);
    destinationRoot = realpathSync(destinationDir);
    for (const rel of REQUIRED_RUNTIME_FILES) {
      if (!statSync(resolve(sourceRoot, rel)).isFile()) return false;
    }
  } catch {
    return false;
  }
  const pending = [
    { source: sourceRoot, destination: destinationRoot }
  ];
  let files = 0;
  let totalBytes = 0;
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current.source, { withFileTypes: true })) {
      const source = resolve(current.source, entry.name);
      const destination = resolve(current.destination, entry.name);
      try {
        if (entry.isSymbolicLink() || lstatSync(destination).isSymbolicLink()) return false;
        if (entry.isDirectory()) {
          if (!statSync(destination).isDirectory()) return false;
          pending.push({ source, destination });
        } else if (entry.isFile()) {
          if (!statSync(destination).isFile()) return false;
          const sourceSize = statSync(source).size;
          files++;
          totalBytes += sourceSize;
          if (files > MAX_RUNTIME_FILES || totalBytes > MAX_RUNTIME_TOTAL_BYTES) return false;
          if (statSync(destination).size !== sourceSize) return false;
          if (!readFileSync(source).equals(readFileSync(destination))) return false;
        }
      } catch {
        return false;
      }
    }
  }
  return true;
}
function localReference(raw, moduleSpecifier) {
  const value = raw.trim();
  if (!value || value.startsWith("#") || value.startsWith("data:") || value.startsWith("blob:")) return null;
  if (value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error("non-local reference");
  }
  if (moduleSpecifier && !value.startsWith(".") && !value.startsWith("/")) return null;
  const clean = value.split("#", 1)[0].split("?", 1)[0];
  return decodeURIComponent(clean);
}
function references(text) {
  const found = [];
  for (const pattern of [ATTRIBUTE_REF, CSS_REF]) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      found.push({ raw: match[2] ?? match[3], moduleSpecifier: false });
    }
  }
  MODULE_REF.lastIndex = 0;
  for (let match = MODULE_REF.exec(text); match; match = MODULE_REF.exec(text)) {
    found.push({ raw: match[1], moduleSpecifier: true });
  }
  DYNAMIC_IMPORT_REF.lastIndex = 0;
  for (let match = DYNAMIC_IMPORT_REF.exec(text); match; match = DYNAMIC_IMPORT_REF.exec(text)) {
    found.push({ raw: match[1], moduleSpecifier: true });
  }
  return found;
}
function validatePreviewComposition(compositionDir, entryPath, engineRuntimeDir) {
  let root;
  let entry;
  try {
    root = realpathSync(compositionDir);
    entry = realpathSync(entryPath);
    if (!contained(entry, root) || !statSync(entry).isFile()) {
      return { ok: false, reason: "entry-outside-composition" };
    }
  } catch {
    return { ok: false, reason: "entry-unavailable" };
  }
  const destinationRuntime = resolve(root, "runtime");
  if (!runtimeMatches(engineRuntimeDir, destinationRuntime)) {
    return { ok: false, reason: "runtime-missing-or-modified" };
  }
  const runtimeRoot = realpathSync(destinationRuntime);
  const pending = [entry];
  const visited = /* @__PURE__ */ new Set();
  let totalBytes = 0;
  try {
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      if (visited.size > MAX_POLICY_FILES) {
        return { ok: false, reason: "policy-too-many-files" };
      }
      if (file !== entry && contained(file, runtimeRoot)) continue;
      const size = statSync(file).size;
      if (size > MAX_POLICY_FILE_BYTES) {
        return { ok: false, reason: "policy-file-too-large" };
      }
      totalBytes += size;
      if (totalBytes > MAX_POLICY_TOTAL_BYTES) {
        return { ok: false, reason: "policy-total-too-large" };
      }
      const rawText = readFileSync(file, "utf-8");
      const text = [".html", ".htm"].includes(extname(file).toLowerCase()) ? rawText.replace(/<!--[\s\S]*?-->/g, "") : rawText;
      if (NETWORK_API.test(text)) {
        return { ok: false, reason: "network-capability" };
      }
      for (const ref of references(text)) {
        const local = localReference(ref.raw, ref.moduleSpecifier);
        if (!local) continue;
        const lexical = local.startsWith("/") ? resolve(root, `.${local}`) : resolve(file, "..", local);
        if (!contained(lexical, root)) {
          return { ok: false, reason: "reference-outside-composition" };
        }
        const target = realpathSync(lexical);
        if (!contained(target, root) || !statSync(target).isFile()) {
          return { ok: false, reason: "reference-outside-composition" };
        }
        if (TEXT_EXTENSIONS.has(extname(target).toLowerCase())) pending.push(target);
      }
    }
  } catch {
    return { ok: false, reason: "invalid-local-reference" };
  }
  return { ok: true };
}
const parentPort = process.parentPort;
if (parentPort) {
  parentPort.on("message", ({ data }) => {
    if (data.type !== "validate") return;
    let ok = false;
    try {
      ok = validatePreviewComposition(
        data.compositionDir,
        data.entryPath,
        data.runtimeDir
      ).ok && parseComposition(readFileSync(data.entryPath, "utf-8")) !== null;
    } catch {
      ok = false;
    }
    parentPort.postMessage({ type: "result", ok });
  });
}
