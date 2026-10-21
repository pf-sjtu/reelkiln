// PORT-NEW (docs/31): the MiniMax-backed paid MODEL PLANE of the self-hosted gateway shim — the generic
// `search_models` / `call_model` contract the original app speaks (studio tools L48906 / L49068 → GET
// /v1/models/search, engine tools/_model_call.py → POST /v1/model_call through AgentGatewayProxy's durable
// operation + local admission + exact quote, L29655-30300), with MiniMax's OFFICIAL media APIs as the provider:
//   minimax/speech-2.8-turbo   POST {origin}/v1/t2a_v2                (synchronous, hex mp3; billed per usage_characters)
//   minimax/image-01           POST {origin}/v1/image_generation      (synchronous, base64 jpeg; billed per image)
//   minimax/hailuo-02-i2v-512p POST {origin}/v1/video_generation      (async task → GET /v1/query/video_generation →
//                                                                       GET /v1/files/retrieve → download_url)
// Each catalog row publishes MiniMax's own input names (official request schema, a SUBSET this port verifies) and a
// PROVEN maximum price: MiniMax bills these models at fixed list prices (per character / per image / per clip), so
// the quote is `bound_proven: true` with maximum = the exact list price of the declared input (TTS: the doc's 1 CJK
// character = 2 billed characters rule gives the bound). Prices: MiniMax China pay-as-you-go list (CNY, official
// pricing page platform.minimaxi.com/docs/guides/pricing-paygo) converted at the USD/CNY ratio models.dev itself
// uses for the minimax-cn rows (0.1494 = MiniMax-M2 $0.1494 / ¥1.00 per M input tokens); env override
// VIDEOCLAW_PORT_CNY_USD. models.dev lists no MiniMax media models (docs/31 §1.2).
// The MiniMax key is read through the shim's provider() seam and never logged or persisted.
import { createHash } from "node:crypto";

export const CNY_USD_ENV = "VIDEOCLAW_PORT_CNY_USD";
export const MODELS_DEV_MINIMAX_CN_USD_PER_CNY = 0.1494;
export function cnyToUsd(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env[CNY_USD_ENV]);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : MODELS_DEV_MINIMAX_CN_USD_PER_CNY;
}
export const PRICE_SOURCE = "minimax-cn official pay-as-you-go list (CNY) × models.dev minimax-cn USD/CNY 0.1494";
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const TTS_VOICES = ["male-qn-qingse", "female-shaonv", "presenter_male", "presenter_female", "audiobook_male_1", "English_expressive_narrator"] as const;
export const IMAGE_ASPECTS = ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"] as const;
export const TTS_MAX_CHARS = 2000;

export interface CatalogModel {
  model_slug: string; name: string; description: string; provider: "MiniMax"; upstream_model: string;
  output_type: "audio" | "image" | "video"; supported_inputs: Array<"image" | "video" | "audio">; inputs_complete: true;
  callable: true; availability: "verified"; input_schema: Record<string, unknown>;
  pricing: Record<string, unknown>;
}
/** CNY list prices (official): speech-2.8-turbo ¥2.00 / 10k characters; image-01 ¥0.025 / image;
 *  MiniMax-Hailuo-02 image-to-video 512P ¥0.60 (6 s) / ¥1.00 (10 s). */
export const CNY = { ttsPerChar: 2.0 / 10_000, imagePerImage: 0.025, hailuo02I2v512p: { 6: 0.6, 10: 1.0 } as Record<number, number> };

export function catalog(env: NodeJS.ProcessEnv = process.env): CatalogModel[] {
  const fx = cnyToUsd(env);
  return [
    {
      model_slug: "minimax/speech-2.8-turbo", name: "MiniMax Speech 2.8 Turbo", provider: "MiniMax", upstream_model: "speech-2.8-turbo",
      description: "Text to speech (MiniMax T2A v2, non-streaming). Returns one MP3.", output_type: "audio", supported_inputs: [], inputs_complete: true,
      callable: true, availability: "verified",
      input_schema: {
        type: "object", additionalProperties: false, required: ["text", "voice_id"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: TTS_MAX_CHARS, description: "Text to speak (≤2000 characters here; MiniMax bills 1 CJK character as 2)." },
          voice_id: { type: "string", enum: [...TTS_VOICES], description: "MiniMax system voice id." },
          speed: { type: "number", minimum: 0.5, maximum: 2, default: 1 },
          language_boost: { type: "string", enum: ["auto", "Chinese", "English"], default: "auto" },
        },
      },
      pricing: { kind: "per-character", currency: "USD", usd_per_character: round6(CNY.ttsPerChar * fx * 1e3) / 1e3, cjk_character_weight: 2, source: PRICE_SOURCE },
    },
    {
      model_slug: "minimax/image-01", name: "MiniMax image-01", provider: "MiniMax", upstream_model: "image-01",
      description: "Text to image (MiniMax image_generation). Returns 1-4 JPEG images.", output_type: "image", supported_inputs: [], inputs_complete: true,
      callable: true, availability: "verified",
      input_schema: {
        type: "object", additionalProperties: false, required: ["prompt"],
        properties: {
          prompt: { type: "string", minLength: 1, maxLength: 1500 },
          aspect_ratio: { type: "string", enum: [...IMAGE_ASPECTS], default: "1:1" },
          n: { type: "integer", minimum: 1, maximum: 4, default: 1 },
        },
      },
      pricing: { kind: "per-image", currency: "USD", usd_per_image: round6(CNY.imagePerImage * fx), source: PRICE_SOURCE },
    },
    {
      model_slug: "minimax/hailuo-02-i2v-512p", name: "MiniMax Hailuo 02 image-to-video 512P", provider: "MiniMax", upstream_model: "MiniMax-Hailuo-02",
      description: "Image to video at 512P (MiniMax video_generation with first_frame_image). Returns one MP4. Aspect ratio follows the first frame.",
      output_type: "video", supported_inputs: ["image"], inputs_complete: true, callable: true, availability: "verified",
      input_schema: {
        type: "object", additionalProperties: false, required: ["prompt", "first_frame_image_url", "duration"],
        properties: {
          prompt: { type: "string", minLength: 1, maxLength: 2000 },
          first_frame_image_url: { type: "string", description: "First frame: an https URL or a file inside this video (uploaded by the app)." },
          duration: { type: "integer", enum: [6, 10], description: "Seconds (price dimension)." },
          prompt_optimizer: { type: "boolean", default: true },
        },
      },
      pricing: { kind: "per-clip", currency: "USD", usd_by_duration: { 6: round6(CNY.hailuo02I2v512p[6] * fx), 10: round6(CNY.hailuo02I2v512p[10] * fx) }, resolution: "512P", source: PRICE_SOURCE },
    },
  ];
}

/** MiniMax bills a CJK character as 2 (T2A pricing note); everything else as 1. Used as the proven upper bound. */
export function ttsBilledCharacterBound(text: string): number {
  let n = 0;
  for (const ch of text) n += /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/u.test(ch) ? 2 : 1;
  return n;
}

export interface PricedCall { model: CatalogModel; input: Record<string, any>; estimateUsd: number; maximumUsd: number; units: Record<string, number> }
export class ModelInputError extends Error { constructor(message: string, readonly code = "MODEL_INPUT_INVALID") { super(message); } }

/** Validate one call against the published schema (exactly the published keys and bounds) and price it. */
export function priceCall(slug: unknown, input: unknown, env: NodeJS.ProcessEnv = process.env): PricedCall {
  const model = catalog(env).find((m) => m.model_slug === slug);
  if (!model) throw new ModelInputError("This model is not in the self-hosted catalog.", "MODEL_CONTRACT_UNAVAILABLE");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ModelInputError("input must be an object");
  const props = (model.input_schema as any).properties as Record<string, any>;
  const i = input as Record<string, any>;
  for (const k of Object.keys(i)) if (!(k in props)) throw new ModelInputError(`input.${k} is not accepted by ${model.model_slug}`);
  for (const k of (model.input_schema as any).required as string[]) if (i[k] === undefined) throw new ModelInputError(`input.${k} is required`);
  for (const [k, spec] of Object.entries(props)) {
    const v = i[k];
    if (v === undefined) continue;
    if (spec.type === "string" && (typeof v !== "string" || (spec.minLength && v.length < spec.minLength) || (spec.maxLength && v.length > spec.maxLength))) throw new ModelInputError(`input.${k} must be a string within its length bounds`);
    if (spec.type === "integer" && !Number.isSafeInteger(v)) throw new ModelInputError(`input.${k} must be an integer`);
    if (spec.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) throw new ModelInputError(`input.${k} must be a number`);
    if (spec.type === "boolean" && typeof v !== "boolean") throw new ModelInputError(`input.${k} must be a boolean`);
    if (spec.enum && !spec.enum.includes(v)) throw new ModelInputError(`input.${k} must be one of ${spec.enum.join(", ")}`);
    if (typeof v === "number" && ((spec.minimum !== undefined && v < spec.minimum) || (spec.maximum !== undefined && v > spec.maximum))) throw new ModelInputError(`input.${k} is out of range`);
  }
  const fx = cnyToUsd(env);
  if (model.output_type === "audio") {
    const chars = ttsBilledCharacterBound(i.text);
    const usd = round6(chars * CNY.ttsPerChar * fx);
    return { model, input: i, estimateUsd: usd, maximumUsd: usd, units: { billed_characters_bound: chars } };
  }
  if (model.output_type === "image") {
    const n = i.n ?? 1;
    const usd = round6(n * CNY.imagePerImage * fx);
    return { model, input: i, estimateUsd: usd, maximumUsd: usd, units: { images: n } };
  }
  const usd = round6(CNY.hailuo02I2v512p[i.duration] * fx);
  return { model, input: i, estimateUsd: usd, maximumUsd: usd, units: { clips: 1, seconds: i.duration } };
}

/** The canonical exact-operation digest the proxy checks (quoteSpendOperation L30069 / handle L29404). */
export function operationSha256(path: string, body: Buffer | string): string {
  return createHash("sha256").update(`videoclaw-spend-operation/v1\0POST\0${path}\0`).update(body).digest("hex");
}

/** GET /v1/models/search over the catalog: q matches slug/name/description words (exact slug → that row only). */
export function searchCatalog(q: string, limit: number, kind: string | null, inputs: string[], env: NodeJS.ProcessEnv = process.env) {
  const all = catalog(env);
  const query = q.trim().toLowerCase();
  let rows = all.filter((m) => !kind || m.output_type === kind).filter((m) => inputs.every((x) => m.supported_inputs.includes(x as any)));
  const exact = rows.filter((m) => m.model_slug === query);
  if (exact.length) rows = exact;
  else if (query) {
    const words = query.split(/\s+/).filter(Boolean);
    const hay = (m: CatalogModel) => `${m.model_slug} ${m.name} ${m.description} ${m.output_type} ${m.output_type === "audio" ? "tts speech voice voiceover narration" : m.output_type === "image" ? "picture still frame photo" : "clip animate motion"}`.toLowerCase();
    const scored = rows.map((m) => ({ m, s: words.filter((w) => hay(m).includes(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    rows = scored.map((x) => x.m);
  }
  const page = rows.slice(0, Math.max(1, Math.min(25, limit || 10)));
  return { results: page.map(({ upstream_model, ...m }) => m), total: rows.length, has_more: rows.length > page.length, partial: false, omitted_unknown: 0 };
}

export interface MediaOutput { bytes: Buffer; contentType: string }
export interface MediaResult { outputs: MediaOutput[]; costUsd: number; units: Record<string, number>; upstream: Record<string, unknown> }
export interface MiniMaxMediaDeps {
  origin: string; key: string; fetchImpl?: typeof fetch;
  /** resolve a shim-hosted read_url (this gateway's own upload) to its bytes — MiniMax cannot reach loopback */
  readOwnUpload: (url: string) => { bytes: Buffer; contentType: string } | undefined;
  sleep?: (ms: number) => Promise<void>;
  onTask?: (taskId: string) => void;
  /** docs/32: true once MiniMax confirmed this video task cancelled — the poll loop stops without downloading */
  stopped?: () => boolean;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}
const backoffStatuses = new Set([429, 529, 503]);
async function minimaxJson(d: MiniMaxMediaDeps, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const f = d.fetchImpl ?? fetch;
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  // a POST is retried ONLY on an explicit overload status (429/529/503: MiniMax did not start the work)
  for (let attempt = 0; ; attempt++) {
    const r = await f(`${d.origin}${path}`, { method, headers: { authorization: `Bearer ${d.key}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: d.signal ?? AbortSignal.timeout(120_000) });
    const text = await r.text();
    let j: any; try { j = JSON.parse(text); } catch { j = undefined; }
    const code = j?.base_resp?.status_code;
    const overloaded = backoffStatuses.has(r.status) || code === 1002 || code === 1039;
    if (overloaded && attempt < 4) { await sleep(Math.min(30_000, 2_000 * 2 ** attempt)); continue; }
    if (!r.ok || !j) throw new Error(`MiniMax ${path} HTTP ${r.status}`);
    if (typeof code === "number" && code !== 0) throw new Error(`MiniMax ${path} status_code ${code}: ${String(j.base_resp?.status_msg ?? "").slice(0, 200)}`);
    return j;
  }
}
async function fetchBytes(d: MiniMaxMediaDeps, url: string): Promise<Buffer> {
  const r = await (d.fetchImpl ?? fetch)(url, { signal: d.signal ?? AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`MiniMax media download HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Run one priced call against MiniMax. Charges are computed from what MiniMax reports (TTS usage_characters,
 *  image success_count) and never exceed the quoted maximum. */
export async function runMiniMaxCall(call: PricedCall, d: MiniMaxMediaDeps): Promise<MediaResult> {
  const fx = cnyToUsd(d.env);
  const i = call.input;
  if (call.model.output_type === "audio") {
    const j = await minimaxJson(d, "POST", "/v1/t2a_v2", {
      model: call.model.upstream_model, text: i.text, stream: false, output_format: "hex", language_boost: i.language_boost ?? "auto",
      voice_setting: { voice_id: i.voice_id, speed: i.speed ?? 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
    });
    const hex = j?.data?.audio;
    if (typeof hex !== "string" || !hex) throw new Error("MiniMax t2a_v2 returned no audio");
    const used = Number(j?.extra_info?.usage_characters);
    const chars = Number.isFinite(used) && used >= 0 ? Math.min(used, call.units.billed_characters_bound) : call.units.billed_characters_bound;
    return { outputs: [{ bytes: Buffer.from(hex, "hex"), contentType: "audio/mpeg" }], costUsd: Math.min(call.maximumUsd, round6(chars * CNY.ttsPerChar * fx)),
      units: { billed_characters: chars }, upstream: { trace_id: j?.trace_id, audio_length_ms: j?.extra_info?.audio_length, usage_characters: j?.extra_info?.usage_characters } };
  }
  if (call.model.output_type === "image") {
    const j = await minimaxJson(d, "POST", "/v1/image_generation", { model: call.model.upstream_model, prompt: i.prompt, aspect_ratio: i.aspect_ratio ?? "1:1", n: i.n ?? 1, response_format: "base64" });
    const images: string[] = Array.isArray(j?.data?.image_base64) ? j.data.image_base64 : [];
    if (!images.length) throw new Error("MiniMax image_generation returned no image");
    const ok = Math.min(images.length, Number(j?.metadata?.success_count ?? images.length) || images.length, i.n ?? 1);
    return { outputs: images.slice(0, ok).map((b) => ({ bytes: Buffer.from(b, "base64"), contentType: "image/jpeg" })), costUsd: Math.min(call.maximumUsd, round6(ok * CNY.imagePerImage * fx)),
      units: { images: ok }, upstream: { id: j?.id, success_count: j?.metadata?.success_count, failed_count: j?.metadata?.failed_count } };
  }
  // video: image-to-video 512P
  let firstFrame: string = i.first_frame_image_url;
  if (!/^https:\/\//.test(firstFrame)) {
    const own = d.readOwnUpload(firstFrame);
    if (!own) throw new ModelInputError("first_frame_image_url must be an https URL or a file uploaded to this gateway");
    firstFrame = `data:${own.contentType};base64,${own.bytes.toString("base64")}`;
  }
  const submitted = await minimaxJson(d, "POST", "/v1/video_generation", { model: call.model.upstream_model, prompt: i.prompt, first_frame_image: firstFrame, duration: i.duration, resolution: "512P", prompt_optimizer: i.prompt_optimizer ?? true });
  const taskId = submitted?.task_id;
  if (typeof taskId !== "string" || !taskId) throw new Error("MiniMax video_generation returned no task_id");
  d.onTask?.(taskId);
  return pollMiniMaxVideo(call, d, taskId);
}
export async function pollMiniMaxVideo(call: PricedCall, d: MiniMaxMediaDeps, taskId: string): Promise<MediaResult> {
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const fx = cnyToUsd(d.env);
  for (let n = 0; n < 180; n++) {
    await sleep(10_000);
    if (d.stopped?.()) { const e: any = new Error("MiniMax video task was cancelled"); e.terminal = "canceled"; throw e; }
    const q = await minimaxJson(d, "GET", `/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`);
    if (q?.status === "Fail") { const e: any = new Error("MiniMax video task failed"); e.terminal = "failed"; throw e; }
    if (q?.status !== "Success") continue;
    const f = await minimaxJson(d, "GET", `/v1/files/retrieve?file_id=${encodeURIComponent(String(q.file_id))}`);
    const url = f?.file?.download_url;
    if (typeof url !== "string") throw new Error("MiniMax files/retrieve returned no download_url");
    const bytes = await fetchBytes(d, url);
    return { outputs: [{ bytes, contentType: "video/mp4" }], costUsd: Math.min(call.maximumUsd, round6(CNY.hailuo02I2v512p[call.input.duration] * fx)),
      units: { clips: 1, seconds: call.input.duration }, upstream: { task_id: taskId, file_id: q.file_id, video_width: q.video_width, video_height: q.video_height } };
  }
  const e: any = new Error("MiniMax video task did not finish within 30 minutes"); e.terminal = "timeout"; throw e;
}
