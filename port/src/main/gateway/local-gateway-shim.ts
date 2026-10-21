// PORT-NEW (docs/28): the LOCAL GATEWAY + BILLING SHIM — a loopback HTTP service that answers the gateway
// contract the original app speaks to `cfg.gatewayUrl` (docs/27 §1.2) for ONE self-hosted account, backed by a
// real local spend ledger, with every model call routed to MiniMax (MINIMAX_API_KEY, box env, never written
// anywhere by this module).
//
// Served (all responses carry `x-videoclaw-port-shim: 1`):
//   GET  /v1/me                              key identity + key meter (keyMeterFrom fields, wb L108-135; verifyKeyAt
//                                            L60601 reads {id,name}; id = sha256(key) hex, the cohort shape L8680)
//   POST /v1/keys/{id}/topup-session         startTopUp L55325 — a self-hosted account has no checkout: 503 (the
//                                            original's "Checkout is unavailable right now" branch). Credit is
//                                            added by the owner through LocalGatewayShim.topUp (local ledger).
//   POST /anthropic/v1/messages              helper / gateway-route Anthropic passthrough (resolveHelperCreds L22343)
//                                            → MiniMax Anthropic endpoint, metered into the ledger; refused with
//                                            402 billing_error once the account has no credit left.
//   POST /v1/quotes/project                  quoteProject L28893 — deterministic local price table
//   GET|PUT /v1/spend-authorities/{jobId}    setSessionSpendPolicy L28919 / getJobBudget L28936
//   PUT  /v1/budgets/{jobId}                 credentialsForBudgetedTools L28956
//   GET  /v1/config/flags                    an UNSIGNED shipped-defaults document. NOTE: the original never fetches
//                                            flags from a `local` gateway (FeatureFlagStore.target L8706: no pinned
//                                            trust → shipped defaults); served for contract completeness only.
//   /v1/token, /v1/accounts, /v1/account*    404 account-plane-not-offered: the original refuses to present an
//                                            identity token to a non-official gateway (resolveAuthPool → no pool,
//                                            AccountAuth.assertTrustedGateway L54xxx), so a self-hosted gateway is
//                                            reached ONLY through the `vc_` key plane, exactly like a custom gateway.
//   docs/29 additions (local sinks — persisted under <dir>/sinks, never sent anywhere else):
//   POST /v1/feedback, /v1/feedback/blocked  sendFeedback / sendBlockedFeedback L57394-57537 (+ signed screenshot PUT)
//   POST /v1/telemetry/beacon, sessions/{id}/entries, jobs/{id}/log, jobs/{id}/final(+PUT,/complete),
//   PUT  /v1/telemetry/sessions/{id}/index   the Outbox delivery executors L19708-19830
//   GET  /v1/app/latest                       startUpdateCheck L55921: the release feed for THIS build (always
//                                            "current" — the shim never offers a newer build); nightly → 404
//   POST /v1/uploads (+ tokenised PUT)        engine _gateway.upload: reference bytes land on local disk
//   POST /v1/{paid tool}                      mint_image / embed / mint_video / …: refused 422 not_submitted —
//                                            the MiniMax backend has no faithful equivalent (docs/29 §4)
// Anything else → 404. No request is ever forwarded with the shim key; MiniMax sees only its own key.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { costUsd, priceTable, type ModelPrice } from "./pricing";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authHeaders } from "../llm/protocols";
import type { ResolvedProvider } from "../llm/provider-registry";
import { providerGate } from "../llm/retry";
import { withMiniMaxRetry } from "../llm/minimax";
import { registerSecret } from "../llm/logger";

export const LOCAL_GATEWAY_ENV = "VIDEOCLAW_PORT_LOCAL_GATEWAY";
export const LOCAL_GATEWAY_PORT_ENV = "VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT";
export const LOCAL_GATEWAY_MONTH_USD_ENV = "VIDEOCLAW_PORT_LOCAL_GATEWAY_MONTH_USD";
export const DEFAULT_LOCAL_GATEWAY_PORT = 47719;
export const SHIM_HEADER = "x-videoclaw-port-shim";
export const LEDGER_SCHEMA = "videoclaw-port.local-gateway-ledger/v1";
/** generateGatewayKey L5103 / GATEWAY_KEY_FORMAT L5106. */
export const GATEWAY_KEY_FORMAT = /^vc_[0-9a-f]{40}$/;
export const generateGatewayKey = () => `vc_${randomBytes(20).toString("hex")}`;
export const keyIdFor = (key: string) => createHash("sha256").update(key.trim()).digest("hex");
/** CredentialStore.keyHint L4874 shape. */
export const keyHintFor = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;

/** docs/29 §1: the ledger charges PER MODEL (gateway/pricing.ts: env override → models.dev → MiniMax fallback);
 *  this is only the table identifier recorded in the ledger header. */
export const PRICING_TABLE_ID = "port-per-model/v2";
/** quoteProject: cents per paid-tool call (local table; unknown tools are quoted at the default). */
export const TOOL_QUOTE_CENTS: Record<string, number> = { model_call: 1, mint_image: 4, mint_video: 50, audio_enhance: 2, media_pull: 0 };
export const DEFAULT_TOOL_QUOTE_CENTS = 5;

export interface LedgerEntry { id: string; at: number; kind: "model_call"; usd: number; keyId: string; model: string; upstreamModel: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; status: number; pricing: ModelPrice }
export interface Ledger {
  schema: typeof LEDGER_SCHEMA;
  account: { id: string; name: string; createdAt: number };
  keys: Array<{ id: string; hint: string; createdAt: number; revokedAt?: number }>;
  limits: { monthUsd: number | null; totalUsd: number | null };
  topupBalanceUsd: number;
  topups: Array<{ at: number; usd: number; source: string }>;
  entries: LedgerEntry[];
  refusals: Array<{ at: number; keyId: string; reason: string }>;
  spendAuthorities: Record<string, { mode: string; ceilingUsd: number | null; updatedAt: number }>;
  budgets: Record<string, { ceilingUsd: number; updatedAt: number }>;
  quotes: Array<{ at: number; jobId: string; totalCents: number }>;
  /** the table identifier (per-entry prices live on each entry). Pre-docs/29 ledgers carry the old flat table here. */
  pricing: { table: string } | { inputPerMTokUsd: number; outputPerMTokUsd: number; source: string };
  /** docs/29: per-job scoped capabilities issued by credentialsForBudgetedTools (library lease / sheet build) */
  sinks?: Record<string, number>;
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7); // UTC calendar month

export function emptyLedger(now: number, monthUsd: number | null): Ledger {
  return {
    schema: LEDGER_SCHEMA,
    account: { id: `acct_local_${randomBytes(6).toString("hex")}`, name: "Local studio (self-hosted)", createdAt: now },
    keys: [], limits: { monthUsd, totalUsd: null }, topupBalanceUsd: 0, topups: [], entries: [], refusals: [],
    spendAuthorities: {}, budgets: {}, quotes: [], pricing: { table: PRICING_TABLE_ID },
  };
}

export interface ShimOptions {
  dir: string;
  /** MiniMax provider (Anthropic surface). null → model calls answer 503 (no upstream configured). */
  provider: () => ResolvedProvider | null;
  port?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  monthUsd?: number | null;
  log?: (line: string) => void;
  /** docs/29: per-model price resolver (default: gateway/pricing.ts priceTable()) */
  price?: (model: string) => ModelPrice;
  /** docs/29: the version THIS build reports (GET /v1/app/latest answers it as current) */
  appVersion?: string;
}

export class LocalGatewayShim {
  private server?: Server;
  private ledger: Ledger;
  private readonly file: string;
  url = "";
  private readonly price: (model: string) => ModelPrice;
  readonly sinkDir: string;
  /** tokenised unauthenticated PUT targets (signed-URL stand-ins): token → where the bytes go + what they must be */
  private readonly putTargets = new Map<string, { file: string; size?: number; sha256?: string; md5Base64?: string; contentType?: string; onDone?: () => void }>();
  constructor(private readonly o: ShimOptions) {
    mkdirSync(o.dir, { recursive: true });
    this.file = join(o.dir, "ledger.json");
    this.sinkDir = join(o.dir, "sinks");
    this.price = o.price ?? priceTable();
    this.ledger = this.load();
  }
  private now() { return (this.o.now ?? Date.now)(); }
  private load(): Ledger {
    if (existsSync(this.file)) {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      if (raw?.schema !== LEDGER_SCHEMA) throw new Error(`local gateway ledger has an unknown schema (${String(raw?.schema)})`);
      return { ...emptyLedger(this.now(), null), ...raw };
    }
    const fresh = emptyLedger(this.now(), this.o.monthUsd === undefined ? 5 : this.o.monthUsd);
    this.write(fresh);
    return fresh;
  }
  private write(l: Ledger = this.ledger) {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(l, null, 1), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  snapshot(): Ledger { return JSON.parse(JSON.stringify(this.ledger)); }

  // ── keys ────────────────────────────────────────────────────────────────
  /** Issue a new `vc_` key for the local account; returns the plaintext ONCE (the shim keeps only its hash). */
  issueKey(): { key: string; id: string; hint: string } {
    const key = generateGatewayKey();
    const id = keyIdFor(key);
    this.ledger.keys.push({ id, hint: keyHintFor(key), createdAt: this.now() });
    this.write();
    return { key, id, hint: keyHintFor(key) };
  }
  revokeKey(id: string): boolean {
    const k = this.ledger.keys.find((x) => x.id === id && !x.revokedAt);
    if (!k) return false;
    k.revokedAt = this.now(); this.write(); return true;
  }
  /** The active key row for a presented bearer, or null. Constant-time on the hash. */
  authenticate(bearer: string | undefined): { id: string } | null {
    if (!bearer || !GATEWAY_KEY_FORMAT.test(bearer.trim())) return null;
    const id = Buffer.from(keyIdFor(bearer));
    for (const k of this.ledger.keys) {
      if (k.revokedAt) continue;
      const cand = Buffer.from(k.id);
      if (cand.length === id.length && timingSafeEqual(cand, id)) return { id: k.id };
    }
    return null;
  }
  isActiveKey(key: string | undefined): boolean { return !!this.authenticate(key); }

  // ── billing ─────────────────────────────────────────────────────────────
  setLimits(limits: Partial<Ledger["limits"]>): void { this.ledger.limits = { ...this.ledger.limits, ...limits }; this.write(); }
  topUp(usd: number, source = "local-owner"): void {
    if (!Number.isFinite(usd) || usd <= 0 || usd > 10_000) throw new Error("top-up amount is invalid");
    this.ledger.topupBalanceUsd = round6(this.ledger.topupBalanceUsd + usd);
    this.ledger.topups.push({ at: this.now(), usd, source });
    this.write();
  }
  /** The keyMeterFrom input body (wb L110): month + lifetime spend, both grant ceilings, top-up balance and the
   *  computed available credit. Spend first consumes the monthly/total grant; past it, the top-up balance. */
  meter(): Record<string, unknown> {
    const now = this.now();
    const month = monthKey(now);
    const spentMonth = round6(this.ledger.entries.filter((e) => monthKey(e.at) === month).reduce((a, e) => a + e.usd, 0));
    const spentTotal = round6(this.ledger.entries.reduce((a, e) => a + e.usd, 0));
    const { monthUsd, totalUsd } = this.ledger.limits;
    const rooms = [monthUsd == null ? Infinity : monthUsd - spentMonth, totalUsd == null ? Infinity : totalUsd - spentTotal];
    const grantRoom = Math.min(...rooms);
    // overspend of the grant is paid from the top-up balance
    const topupLeft = Number.isFinite(grantRoom) && grantRoom < 0 ? Math.max(0, this.ledger.topupBalanceUsd + grantRoom) : this.ledger.topupBalanceUsd;
    const available = Number.isFinite(grantRoom) ? round6(Math.max(0, grantRoom) + topupLeft) : null;
    return {
      name: this.ledger.account.name,
      spend_this_month_usd: spentMonth,
      spend_total_usd: spentTotal,
      limit_month_usd: monthUsd,
      limit_total_usd: totalUsd,
      topup_balance_usd: round6(topupLeft),
      reserved_credit_usd: 0,
      available_credit_usd: available,
      effective_month_limit_usd: monthUsd == null ? null : round6(monthUsd + this.ledger.topupBalanceUsd),
      topup_min_usd: 5,
      topup_max_usd: 500,
      self_hosted: true,
    };
  }
  available(): number | null { return this.meter().available_credit_usd as number | null; }
  /** The price the ledger charges `model` at (docs/29 §1). */
  priceFor(model: string): ModelPrice { return this.price(model); }
  charge(e: Omit<LedgerEntry, "id" | "at" | "usd" | "pricing">): LedgerEntry {
    const p = this.price(e.upstreamModel);
    const usd = costUsd(p, e);
    const entry: LedgerEntry = { id: `spend_${randomBytes(6).toString("hex")}`, at: this.now(), usd, pricing: { ...p }, ...e };
    this.ledger.entries.push(entry);
    this.write();
    return entry;
  }
  quote(jobId: string, items: unknown): Record<string, unknown> {
    const rows = (Array.isArray(items) ? items : []).map((it: any) => {
      const tool = String(it?.tool ?? it?.name ?? "unknown");
      const count = Number.isSafeInteger(it?.count) && it.count > 0 ? it.count : 1;
      const unit = TOOL_QUOTE_CENTS[tool] ?? DEFAULT_TOOL_QUOTE_CENTS;
      return { tool, count, unit_cents: unit, cents: unit * count };
    });
    const planned = rows.reduce((a, r) => a + r.cents, 0);
    const reserve = Math.ceil(planned * 0.2);
    this.ledger.quotes.push({ at: this.now(), jobId, totalCents: planned + reserve });
    if (this.ledger.quotes.length > 200) this.ledger.quotes.splice(0, this.ledger.quotes.length - 200);
    this.write();
    return { job_id: jobId, items: rows, planned_total_cents: planned, reserve_cents: reserve, total_cents: planned + reserve, pricing: "port-local-quote-table/v1" };
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  async start(): Promise<string> {
    const server = createServer((req, res) => { void this.handle(req, res).catch((e) => { this.o.log?.(`[local-gateway] handler failed: ${e instanceof Error ? e.message : String(e)}`); if (!res.headersSent) this.json(res, 500, { error: "internal" }); else res.destroy(); }); });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(this.o.port ?? 0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    this.server = server;
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return this.url;
  }
  close(): Promise<void> { return new Promise((r) => { if (!this.server) return r(); this.server.closeAllConnections?.(); this.server.close(() => r()); }); }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json", [SHIM_HEADER]: "1" });
    res.end(JSON.stringify(body));
  }
  private async body(req: IncomingMessage, max = 16 * 1024 * 1024): Promise<Buffer> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > max) throw new Error("request body too large"); chunks.push(c as Buffer); }
    return Buffer.concat(chunks);
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (/^\/v1\/(token|accounts?)(\/|$)/.test(path)) {
      req.resume();
      return this.json(res, 404, { error: "account-plane-not-offered", message: "This self-hosted Videoclaw gateway has no account sign-in. Use its vc_ key." });
    }
    // ── docs/29 unauthenticated surfaces (exactly the ones the original calls without a key) ──
    let m0: RegExpExecArray | null;
    if (method === "PUT" && (m0 = /^\/v1\/sinks\/put\/([0-9a-f]{48})$/.exec(path))) return this.sinkPut(req, res, m0[1]);
    if (method === "POST" && path === "/v1/feedback/blocked") return this.feedbackSink(req, res, null, true); // sendBlockedFeedback: no authorization header
    if (method === "GET" && path === "/v1/app/latest") { req.resume(); return this.appLatest(res, url.searchParams.get("channel")); } // startUpdateCheck: no authorization on the latest channel
    const auth = typeof req.headers.authorization === "string" ? /^Bearer\s+(.+)$/i.exec(req.headers.authorization.trim())?.[1] : undefined;
    const key = this.authenticate(auth ?? (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined));
    if (!key) { req.resume(); return this.json(res, 401, { error: "invalid key" }); }
    if (method === "GET" && path === "/v1/me") return this.json(res, 200, { id: key.id, ...this.meter() });
    let m: RegExpExecArray | null;
    if (method === "POST" && (m = /^\/v1\/keys\/([0-9a-f]{64})\/topup-session$/.exec(path))) {
      req.resume();
      if (m[1] !== key.id) return this.json(res, 403, { error: "key mismatch" });
      return this.json(res, 503, { error: "checkout-unavailable", message: "A self-hosted Videoclaw account has no hosted checkout; the owner adds credit to the local ledger." });
    }
    if (method === "GET" && path === "/v1/config/flags") { req.resume(); return this.json(res, 200, { schema: "videoclaw.feature-flags/v1", generation: 0, flags: {}, signed: false, self_hosted: true }); }
    if (method === "POST" && path === "/v1/quotes/project") {
      let b: any; try { b = JSON.parse((await this.body(req)).toString("utf8")); } catch { return this.json(res, 400, { error: "invalid json" }); }
      if (typeof b?.job_id !== "string" || !b.job_id) return this.json(res, 400, { error: "job_id required" });
      return this.json(res, 200, this.quote(b.job_id, b.items));
    }
    if ((m = /^\/v1\/spend-authorities\/([^/]+)$/.exec(path))) {
      const jobId = decodeURIComponent(m[1]);
      if (method === "PUT") {
        let b: any; try { b = JSON.parse((await this.body(req)).toString("utf8")); } catch { return this.json(res, 400, { error: "invalid json" }); }
        const mode = b?.mode;
        if (mode !== "capped" && mode !== "unlimited" && mode !== "per_operation") return this.json(res, 400, { error: "mode invalid" });
        const ceiling = mode === "capped" ? Number(b.ceiling_usd) : null;
        if (mode === "capped" && !(Number.isFinite(ceiling) && (ceiling as number) > 0)) return this.json(res, 400, { error: "ceiling_usd invalid" });
        this.ledger.spendAuthorities[jobId] = { mode, ceilingUsd: ceiling, updatedAt: this.now() }; this.write();
        return this.json(res, 200, { job_id: jobId, mode, ceiling_usd: ceiling });
      }
      if (method === "GET") {
        req.resume();
        const a = this.ledger.spendAuthorities[jobId];
        return this.json(res, 200, { job_id: jobId, mode: a?.mode ?? "per_operation", ceiling_usd: a?.ceilingUsd ?? null, spent_usd: 0, available_credit_usd: this.available() });
      }
    }
    if (method === "PUT" && (m = /^\/v1\/budgets\/([^/]+)$/.exec(path))) {
      let b: any; try { b = JSON.parse((await this.body(req)).toString("utf8")); } catch { return this.json(res, 400, { error: "invalid json" }); }
      const ceiling = Number(b?.ceiling_usd);
      if (!(Number.isFinite(ceiling) && ceiling > 0)) return this.json(res, 400, { error: "ceiling_usd invalid" });
      const jobId = decodeURIComponent(m[1]);
      this.ledger.budgets[jobId] = { ceilingUsd: ceiling, updatedAt: this.now() }; this.write();
      return this.json(res, 200, { job_id: jobId, ceiling_usd: ceiling });
    }
    if (method === "POST" && path === "/anthropic/v1/messages") return this.messages(req, res, key.id);
    // ── docs/29: local sinks + upload intake + paid-tool refusal ──
    if (method === "POST" && path === "/v1/feedback") return this.feedbackSink(req, res, key.id, false);
    if ((m = /^\/v1\/telemetry\/(beacon|sessions\/([A-Za-z0-9._:-]{1,160})\/(entries|index)|jobs\/([A-Za-z0-9._-]{1,160})\/(log|final|final\/complete))$/.exec(path))) {
      const expected = m[3] === "index" ? "PUT" : "POST";
      if (method === expected) return this.telemetrySink(req, res, key.id, m);
    }
    if (method === "POST" && path === "/v1/uploads") return this.uploadIntake(req, res, key.id);
    if (method === "POST" && (m = /^\/v1\/(mint_image|mint_video|embed|audio\/enhance|media\/pull|synth_voice|lipsync_footage|llm|model_call|qa_video|enumerate_profile|harness\/review|[a-z][a-z0-9_]{1,63})$/.exec(path))) {
      req.resume();
      return this.paidToolRefusal(res, m[1]);
    }
    req.resume();
    return this.json(res, 404, { error: "not offered by the self-hosted gateway", path });
  }

  // ── docs/29: local sinks ───────────────────────────────────────────────
  private sinkFile(kind: string, name: string): string {
    const dir = join(this.sinkDir, kind);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return join(dir, name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160));
  }
  private stamp() { return `${new Date(this.now()).toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`; }
  private record(kind: string) { (this.ledger.sinks ??= {})[kind] = (this.ledger.sinks[kind] ?? 0) + 1; this.write(); }
  private putUrl(target: { file: string; size?: number; sha256?: string; md5Base64?: string; contentType?: string; onDone?: () => void }): string {
    const token = randomBytes(24).toString("hex");
    this.putTargets.set(token, target);
    return `${this.url}/v1/sinks/put/${token}`;
  }
  /** The signed-URL stand-in: one PUT per token, exact length / sha256 / md5 when the issuer bound them. */
  private async sinkPut(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    const t = this.putTargets.get(token);
    if (!t) { req.resume(); return this.json(res, 404, { error: "unknown upload" }); }
    let bytes: Buffer;
    try { bytes = await this.body(req, 2 * 1024 * 1024 * 1024); } catch { return this.json(res, 413, { error: "too large" }); }
    if (t.size !== undefined && bytes.length !== t.size) return this.json(res, 400, { error: "length mismatch" });
    if (t.sha256 && createHash("sha256").update(bytes).digest("hex") !== t.sha256) return this.json(res, 400, { error: "sha256 mismatch" });
    if (t.md5Base64 && createHash("md5").update(bytes).digest("base64") !== t.md5Base64) return this.json(res, 400, { error: "md5 mismatch" });
    this.putTargets.delete(token);
    writeFileSync(t.file, bytes, { mode: 0o600 });
    t.onDone?.();
    res.writeHead(200, { [SHIM_HEADER]: "1" }); res.end();
  }
  /** POST /v1/feedback (+ /blocked): the report lands in sinks/feedback/<reportId>.json; a screenshot gets a
   *  tokenised PUT bound to the exact bytes the app declared (sendFeedback L57509-57536). */
  private async feedbackSink(req: IncomingMessage, res: ServerResponse, keyId: string | null, blocked: boolean): Promise<void> {
    let b: any; try { b = JSON.parse((await this.body(req, 64 * 1024 * 1024)).toString("utf8")); } catch { return this.json(res, 400, { error: "invalid json" }); }
    if (!b || typeof b !== "object" || Array.isArray(b)) return this.json(res, 400, { error: "invalid report" });
    const id = typeof b.reportId === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(b.reportId) ? b.reportId : this.stamp();
    const file = this.sinkFile(blocked ? "feedback-blocked" : "feedback", `${id}.json`);
    writeFileSync(file, JSON.stringify({ receivedAt: new Date(this.now()).toISOString(), keyId, blocked, report: b }, null, 1), { mode: 0o600 });
    this.record(blocked ? "feedback-blocked" : "feedback");
    if (!blocked && b.screenshot === true && Number.isSafeInteger(b.screenshotBytes) && typeof b.screenshotSha256 === "string") {
      const putUrl = this.putUrl({ file: this.sinkFile("feedback", `${id}.png`), size: b.screenshotBytes, sha256: b.screenshotSha256, onDone: () => this.record("feedback-screenshot") });
      return this.json(res, 200, { ok: true, reportId: id, screenshotPutUrl: putUrl, screenshotPutHeaders: { "Content-Type": "image/png", "Content-Length": String(b.screenshotBytes), "x-goog-content-sha256": b.screenshotSha256 } });
    }
    return this.json(res, 200, { ok: true, reportId: id });
  }
  /** /v1/telemetry/*: each delivery is appended to sinks/telemetry/<kind>.jsonl (session index = latest per id);
   *  a final-video upload gets a tokenised PUT bound to the declared size/sha256, completed by final/complete. */
  private async telemetrySink(req: IncomingMessage, res: ServerResponse, keyId: string, m: RegExpExecArray): Promise<void> {
    let b: any; try { b = JSON.parse((await this.body(req, 64 * 1024 * 1024)).toString("utf8") || "{}"); } catch { return this.json(res, 400, { error: "invalid json" }); }
    const kind = m[1] === "beacon" ? "beacon" : m[3] ? `session-${m[3]}` : `job-${m[5].replace("/", "-")}`;
    const subject = m[2] ?? m[4] ?? null;
    if (kind === "job-final") {
      const objectName = `final-${subject}-${this.stamp()}.mp4`;
      const putUrl = this.putUrl({ file: this.sinkFile("telemetry-final", objectName), size: Number.isSafeInteger(b?.bytes) ? b.bytes : undefined, sha256: typeof b?.sha256 === "string" ? b.sha256 : undefined });
      this.appendSink(kind, { keyId, subject, declared: { contentType: b?.contentType, bytes: b?.bytes, sha256: b?.sha256 }, object: objectName });
      return this.json(res, 200, { putUrl, contentType: typeof b?.contentType === "string" ? b.contentType : "video/mp4", object: objectName });
    }
    this.appendSink(kind, { keyId, subject, body: b });
    return this.json(res, 200, { ok: true });
  }
  private appendSink(kind: string, row: Record<string, unknown>) {
    const file = this.sinkFile("telemetry", `${kind}.jsonl`);
    writeFileSync(file, `${JSON.stringify({ at: new Date(this.now()).toISOString(), ...row })}\n`, { flag: "a", mode: 0o600 });
    this.record(kind);
  }
  /** GET /v1/app/latest (startUpdateCheck L55921): this self-hosted gateway publishes exactly the build that is
   *  running — the check answers {kind:"current"}. Nightly needs an invited account the shim never has → 404. */
  private appLatest(res: ServerResponse, channel: string | null) {
    if (channel === "nightly") return this.json(res, 404, { error: "nightly channel is not offered by the self-hosted gateway" });
    const v = this.o.appVersion;
    if (!v) return this.json(res, 404, { error: "no release feed configured" });
    return this.json(res, 200, { version: v, minSupported: v, autoUpdate: false, notes: "Self-hosted Videoclaw port build (no newer release is published by this gateway).", self_hosted: true });
  }
  /** POST /v1/uploads (engine _gateway.upload): the bytes go to sinks/uploads via a tokenised PUT bound to the
   *  declared size + md5 (the ticket contract backend#292). */
  private async uploadIntake(req: IncomingMessage, res: ServerResponse, keyId: string): Promise<void> {
    let b: any; try { b = JSON.parse((await this.body(req)).toString("utf8")); } catch { return this.json(res, 400, { error: "invalid json" }); }
    if (typeof b?.filename !== "string" || !Number.isSafeInteger(b?.size_bytes) || b.size_bytes < 0) return this.json(res, 400, { error: "filename and size_bytes required" });
    const uploadId = `up_${randomBytes(12).toString("hex")}`;
    const contentType = typeof b.content_type === "string" ? b.content_type : "application/octet-stream";
    const put_url = this.putUrl({ file: this.sinkFile("uploads", `${uploadId}-${b.filename}`), size: b.size_bytes, md5Base64: typeof b.md5_base64 === "string" ? b.md5_base64 : undefined, onDone: () => this.record("upload") });
    this.appendSink("upload-ticket", { keyId, uploadId, filename: b.filename, size: b.size_bytes });
    return this.json(res, 200, { upload_id: uploadId, put_url, headers: { "Content-Type": contentType } });
  }
  /** Paid generation tools: the MiniMax backend has no faithful equivalent of the gateway's paid tools
   *  (mint_image = multi-reference nano-banana-2/edit, embed = Gemini multimodal embedding space, …; docs/29 §4),
   *  so every one is refused BEFORE anything is reserved or submitted (`not_submitted: true` → the engine's
   *  GatewayNotSubmittedError: nothing charged, never retried as accepted work). */
  private paidToolRefusal(res: ServerResponse, tool: string) {
    this.appendSink("paid-refusal", { tool });
    res.writeHead(422, { "content-type": "application/json", [SHIM_HEADER]: "1", "x-should-retry": "false" });
    res.end(JSON.stringify({ detail: { code: "TOOL_NOT_OFFERED", message: `This self-hosted Videoclaw gateway does not offer ${tool}: its model backend (MiniMax) has no equivalent for this paid tool. Nothing was charged.`, retryable: false, not_submitted: true } }));
  }

  /** /anthropic/v1/messages → MiniMax, metered. Credit is checked BEFORE the call (402 when exhausted); the
   *  call is charged afterwards from the usage MiniMax reports (postpaid, like a metered gateway). */
  private async messages(req: IncomingMessage, res: ServerResponse, keyId: string): Promise<void> {
    let raw: Buffer;
    try { raw = await this.body(req); } catch { return this.json(res, 413, { type: "error", error: { type: "request_too_large", message: "request body too large" } }); }
    let body: any;
    try { body = JSON.parse(raw.toString("utf8")); } catch { return this.json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "invalid json" } }); }
    const available = this.available();
    if (available !== null && available <= 0) {
      this.ledger.refusals.push({ at: this.now(), keyId, reason: "no-credit" }); this.write();
      return this.json(res, 402, { type: "error", error: { type: "billing_error", message: "This self-hosted Videoclaw account has no credit left this month. Add credit to the local ledger, then try again." } });
    }
    const p = this.o.provider();
    if (!p) return this.json(res, 503, { type: "error", error: { type: "api_error", message: "The self-hosted gateway has no model provider configured (MINIMAX_API_KEY is not set)." } });
    registerSecret(p.key);
    const requested = typeof body?.model === "string" ? body.model : "";
    // Claude model ids (TITLE_MODEL, gateway-route pins) are served by the configured MiniMax model.
    const upstreamModel = /^MiniMax-/i.test(requested) ? requested : p.model;
    const upstreamBody = JSON.stringify({ ...body, model: upstreamModel });
    const stream = body?.stream === true;
    const doFetch = this.o.fetchImpl ?? fetch;
    const gate = providerGate(p.gateKey ?? p.name, p.maxConcurrency);
    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, status = 0;
    const usageIn = (u: any) => {
      if (!u || typeof u !== "object") return;
      inputTokens = Number(u.input_tokens ?? 0) || inputTokens;
      cacheReadTokens = Number(u.cache_read_input_tokens ?? 0) || cacheReadTokens;
      cacheWriteTokens = Number(u.cache_creation_input_tokens ?? 0) || cacheWriteTokens;
    };
    await gate.run(async () => {
      const upstream = await withMiniMaxRetry(() => doFetch(`${p.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
        method: "POST",
        headers: { ...authHeaders(p.auth, p.key), "content-type": "application/json", "anthropic-version": String(req.headers["anthropic-version"] ?? "2023-06-01"), "accept-encoding": "identity" },
        body: upstreamBody, signal: AbortSignal.timeout(Math.max(p.timeoutMs ?? 60_000, 10_000)),
      }));
      status = upstream.status;
      const ct = upstream.headers.get("content-type") ?? "application/json";
      res.writeHead(upstream.status, { "content-type": ct, [SHIM_HEADER]: "1" });
      if (stream && /event-stream/i.test(ct) && upstream.body) {
        const dec = new TextDecoder(); let buf = "";
        for await (const c of upstream.body as any) {
          res.write(c);
          buf += dec.decode(c, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev?.type === "message_start") usageIn(ev.message?.usage);
              if (ev?.type === "message_delta") { outputTokens = Number(ev.usage?.output_tokens ?? 0) || outputTokens; usageIn({ ...ev.usage, output_tokens: undefined }); }
            } catch {}
          }
        }
        res.end();
      } else {
        const text = await upstream.text();
        try { const j = JSON.parse(text); usageIn(j?.usage); outputTokens = Number(j?.usage?.output_tokens ?? 0) || 0; } catch {}
        res.end(text);
      }
    });
    if (status >= 200 && status < 300) this.charge({ kind: "model_call", keyId, model: requested || upstreamModel, upstreamModel, inputTokens, outputTokens, ...(cacheReadTokens ? { cacheReadTokens } : {}), ...(cacheWriteTokens ? { cacheWriteTokens } : {}), status });
  }
}

/** Resolve the shim configuration from the environment (opt-in). */
export function localGatewayEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return env[LOCAL_GATEWAY_ENV] === "1"; }
export function localGatewayPort(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env[LOCAL_GATEWAY_PORT_ENV]);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_LOCAL_GATEWAY_PORT;
}
export function localGatewayMonthUsd(env: NodeJS.ProcessEnv = process.env): number | null | undefined {
  const v = env[LOCAL_GATEWAY_MONTH_USD_ENV];
  if (v === undefined || v === "") return undefined;
  if (v === "none") return null;
  const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined;
}
