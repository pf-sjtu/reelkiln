// Verbatim port of the shell-command helpers used by the agent Bash tool.
// Source: out/main/chunks/workbookContents-ChzKjQX1.js (reconstructed line numbers):
//   tokenizeShell L2235-2334, splitEveryBlank L2234, ENGINE_REF_RE_SRC L3979-3989,
//   CD_ENGINE_PREFIX_RE L3990, OUTPUT_FILTER_HEADS L3994-4006, splitPipelineOnly L4007-4055,
//   stripTrailingOutputRedirects L4056-4063, isPureOutputFilter L4064-4073,
//   paidCommandUsesOutputPipeline L4074-4078, withOutputPipefail L4079-4084.
// Differential-tested against the shipped chunk (test/shell-command.test.ts).

export interface ShellToken { value: string; quoted: boolean; escaped: boolean; literalPrefixLen: number }

// Original toggles this module-level flag around a re-tokenisation (chunk L3457-3464);
// withOutputPipefail never sets it, so it stays false on this path.
let splitEveryBlank = false;
export function __setSplitEveryBlank(v: boolean) { splitEveryBlank = v; }

export function tokenizeShell(command: string): { tokens: ShellToken[]; unclosedQuote: boolean; opaque: boolean } {
  const tokens: ShellToken[] = [];
  let value = "";
  let started = false;
  let quoted = false;
  let escaped = false;
  let quote: string | null = null;
  let opaque = false;
  let stillLiteral = true;
  let literalPrefixLen = 0;
  const addLiteral = (ch: string) => {
    value += ch;
    started = true;
    if (stillLiteral) literalPrefixLen += ch.length;
  };
  const addNonLiteral = (ch: string, wasEscape: boolean) => {
    value += ch;
    started = true;
    stillLiteral = false;
    if (wasEscape) escaped = true;
  };
  const flush = () => {
    if (!started) return;
    tokens.push({ value, quoted, escaped, literalPrefixLen });
    value = "";
    started = false;
    quoted = false;
    escaped = false;
    stillLiteral = true;
    literalPrefixLen = 0;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") {
        quote = null;
        quoted = true;
      } else {
        addNonLiteral(c, false);
      }
      continue;
    }
    if (quote === '"') {
      if (c === '"') {
        quote = null;
        quoted = true;
      } else if (c === "\\" && command[i + 1] === "\n") {
        i++;
      } else if (
        c === "\\" &&
        i + 1 < command.length &&
        (command[i + 1] === "$" || command[i + 1] === "`" || command[i + 1] === '"' || command[i + 1] === "\\")
      ) {
        addNonLiteral(command[++i], true);
      } else {
        if (c === "$" || c === "`") opaque = true;
        addNonLiteral(c, false);
      }
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || (splitEveryBlank && /\s/.test(c))) {
      if (c === "\n" || c === "\r") opaque = true;
      flush();
      continue;
    }
    if (/\s/.test(c)) opaque = true;
    if (c === "'" || c === '"') {
      quote = c;
      quoted = true;
      started = true;
      stillLiteral = false;
      continue;
    }
    if (c === "\\") {
      if (command[i + 1] === "\n") {
        i++;
        continue;
      }
      if (command[i + 1] === "\r" && command[i + 2] === "\n") {
        i += 2;
        continue;
      }
      if (i + 1 >= command.length) {
        opaque = true;
        continue;
      }
      addNonLiteral(command[++i], true);
      continue;
    }
    if (";&|<>(){}*?[]".includes(c) || c === "`" || c === "$" || c === "#") {
      opaque = true;
    }
    addLiteral(c);
  }
  flush();
  return { tokens, unclosedQuote: quote !== null, opaque };
}

export const ENGINE_REF_RE_SRC = [
  '"\\$VIDEOCLAW_ENGINE"',
  "'\\$VIDEOCLAW_ENGINE'",
  "\\$VIDEOCLAW_ENGINE",
  '"\\$\\{VIDEOCLAW_ENGINE\\}"',
  "'\\$\\{VIDEOCLAW_ENGINE\\}'",
  "\\$\\{VIDEOCLAW_ENGINE\\}",
  '"\\$\\{VIDEOCLAW_ENGINE:-[^}"\'`\\\\]*\\}"',
  "'\\$\\{VIDEOCLAW_ENGINE:-[^}\"'`\\\\]*\\}'",
  "\\$\\{VIDEOCLAW_ENGINE:-[^}\\s\"'`\\\\]*\\}",
].join("|");
export const CD_ENGINE_PREFIX_RE = new RegExp(`^\\s*cd\\s+(?:${ENGINE_REF_RE_SRC})\\s+&&\\s+([^]+)$`);
export const OUTPUT_FILTER_HEADS = new Set(["tail", "head", "grep", "egrep", "fgrep", "wc", "cat", "uniq", "cut", "tr", "jq"]);

export function splitPipelineOnly(command: string): string[] | null {
  const segments: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"' && i + 1 < command.length) {
        cur += command[++i];
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      cur += c + command[++i];
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (segments.length > 0 && cur.trim().length === 0) {
        cur += " ";
        continue;
      }
      return null;
    }
    if (c === ";") return null;
    if (c === "&") {
      if (command[i - 1] !== ">") return null;
      cur += c;
      continue;
    }
    if (c === "|") {
      if (command[i + 1] === "|") return null;
      segments.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  segments.push(cur);
  const trimmed = segments.map((s) => s.trim());
  return trimmed.every((s) => s.length > 0) ? trimmed : null;
}

export function stripTrailingOutputRedirects(segment: string): string {
  let s = segment;
  for (;;) {
    const next = s.replace(/\s+(?:2>&1|2>\/dev\/null|>\/dev\/null)\s*$/, "");
    if (next === s) return s.trim();
    s = next;
  }
}

export function isPureOutputFilter(segment: string): boolean {
  const parsed = tokenizeShell(segment);
  if (parsed.opaque || parsed.unclosedQuote || parsed.tokens.length === 0) return false;
  const head = parsed.tokens[0];
  if (head.quoted || head.escaped) return false;
  if (head.value.includes("/")) return false;
  return OUTPUT_FILTER_HEADS.has(head.value);
}

export function paidCommandUsesOutputPipeline(command: string): boolean {
  const cd = CD_ENGINE_PREFIX_RE.exec(command);
  const pipeline = splitPipelineOnly(cd ? cd[1] : command);
  return pipeline !== null && pipeline.length > 1 && pipeline.slice(1).every(isPureOutputFilter);
}

export function withOutputPipefail(command: string): string {
  return paidCommandUsesOutputPipeline(command) ? `set -o pipefail\n${command}` : command;
}
