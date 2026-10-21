// PORT-NEW: tiny structured (JSON-lines) logger with secret redaction, shared by the LLM provider
// framework and the models.dev sync. Two layers of protection:
//   1. any field whose NAME looks secret (key/token/secret/password/authorization/cookie/credential)
//      is replaced by "[REDACTED]" (an `apiKeyEnv` *name* field is allowed through);
//   2. every string VALUE is scrubbed of all secrets registered via registerSecret() (provider keys
//      are registered the moment they are read from the environment).
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
export interface LogRecord { ts: string; level: Exclude<LogLevel, "silent">; event: string; [k: string]: unknown }
export type LogSink = (rec: LogRecord) => void;

const secrets = new Set<string>();
/** Remember a secret value so it is scrubbed from every log line (values < 8 chars are ignored). */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) secrets.add(value);
}
export function clearSecretsForTests(): void { secrets.clear(); }

const SECRET_NAME = /(?:key|token|secret|password|passwd|authorization|cookie|credential)$/i;
const ALLOWED_NAMES = new Set<string>([]); // names that merely END in "key" but are safe go here

/** Well-known credential shapes scrubbed even when they were never registered (defence in depth). */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]"],
  [/((?:x-api-key|api-key|authorization|x-goog-api-key)\s*[:=]\s*)("?)[^\s",;]{8,}/gi, "$1$2[REDACTED]"],
  [/\b(sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,})/g, "[REDACTED]"],
  [/(\/\/[^/\s:@]+:)[^/\s@]+@/g, "$1[REDACTED]@"], // URL userinfo password
  [/([?&](?:api[_-]?key|key|token|access_token|sig)=)[^&\s"]+/gi, "$1[REDACTED]"],
];
function scrubString(s: string): string {
  let out = s;
  for (const v of secrets) if (out.includes(v)) out = out.split(v).join("[REDACTED]");
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}
/** Scrub one free-form string (error reasons returned to callers, CLI output). */
export function redactText(s: string): string { return scrubString(s); }

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return scrubString(value);
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message), ...("code" in value ? { code: (value as { code: unknown }).code } : {}) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = !ALLOWED_NAMES.has(k) && SECRET_NAME.test(k) && (typeof v === "string" || typeof v === "number") ? "[REDACTED]" : redact(v, depth + 1);
    return o;
  }
  return value;
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

const stderrSink: LogSink = (rec) => {
  try { process.stderr.write(`${JSON.stringify(rec)}\n`); } catch { /* EPIPE / closed stderr must never break a request */ }
};

export function createLogger(o: { level?: LogLevel; sink?: LogSink; base?: Record<string, unknown> } = {}): Logger {
  const env = process.env.VIDEOCLAW_LOG_LEVEL as LogLevel | undefined;
  const level: LogLevel = o.level ?? (env && env in ORDER ? env : "info");
  const sink = o.sink ?? stderrSink;
  const base = o.base ?? {};
  const emit = (lvl: Exclude<LogLevel, "silent">, event: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    try {
      sink({ ts: new Date().toISOString(), level: lvl, event, ...(redact({ ...base, ...fields }) as Record<string, unknown>) });
    } catch { /* logging is best-effort */ }
  };
  return {
    debug: (e, f) => emit("debug", e, f),
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
    child: (f) => createLogger({ level, sink, base: { ...base, ...f } }),
  };
}

let defaultLogger: Logger | undefined;
export function getLogger(): Logger { return (defaultLogger ??= createLogger()); }
export function setLoggerForTests(l: Logger | undefined): void { defaultLogger = l; }
