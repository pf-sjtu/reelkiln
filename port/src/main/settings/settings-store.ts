// Settings store — port of the original `Settings` class (main/index.js L5291-5577) +
// rendererWritableSettingsPatch (L5107-5155), normalizedAlphaConsentRecords (L5170-5193) and
// writeSettingsFile (L5578-5593). Differential-tested against the original text
// (test/llm-main-wiring.test.ts).
//
// PORT-NEW (docs/15 §3.4) — llmRoute may name a registered custom provider:
//   * load: "claude-code" | "gateway" | a REGISTERED provider name is kept (the original keeps only
//     the two literals). A provider-shaped name that is NOT registered right now (config invalid /
//     provider removed) is parked in `other.llmRoute`: never exposed by get(), resolvedLlmRoute
//     treats the user as on the original default ("claude-code"), but the choice survives on disk
//     (`write({...other, ...value})`) and is re-adopted by revalidateLlmRoute() once the provider
//     is registered again (provider-config hot reload).
//   * setSettings: an llmRoute that is neither built-in nor registered is removed from the patch
//     (the original persisted any value and only filtered it at the next launch).
// NOT PORTED: gateway credentials vault (CredentialStore); the legacy-credential fields are still
// loaded/preserved exactly like the original so a settings.json written by the real app round-trips.
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getProviderRegistry, type ProviderRegistry } from "../llm/provider-registry";
import { redact } from "../llm/logger";

/** out/main/chunks/workbookContents-ChzKjQX1.js L20 */
export const PROD_GATEWAY_URL = "https://videoclaw-gw-650303209435.us-central1.run.app";

export const APP_SETTINGS_KEYS = [ // L5273
  "gatewayUrl", "updateChannelPreference", "telemetry", "usageSharingConsentAt", "agentHarness", "codexProvider", "codexModel",
  "llmRoute", "llmRouteAcknowledgedAt", "alphaConsentAt", "alphaConsentsByKey", "accountSignedInOnce", "lastEngineVersion", "world3",
  "runnerUrl", "feedbackContact",
] as const;

type Obj = Record<string, any>;
const KEY_ID_RE = /^[a-f0-9]{64}$/;
export function normalizedAlphaConsentRecords(value: unknown): Obj { // L5170
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const records: Obj = {};
  for (const [keyId, raw] of Object.entries(value as Obj)) {
    if (!KEY_ID_RE.test(keyId) || !raw || typeof raw !== "object") continue;
    const candidate = raw as Obj;
    if (typeof candidate.acceptedAt !== "number" || !Number.isFinite(candidate.acceptedAt) || candidate.acceptedAt <= 0) continue;
    const record: Obj = { acceptedAt: candidate.acceptedAt };
    if (typeof candidate.beaconQueuedAt === "number" && Number.isFinite(candidate.beaconQueuedAt) && candidate.beaconQueuedAt > 0) record.beaconQueuedAt = candidate.beaconQueuedAt;
    records[keyId] = record;
  }
  return records;
}

/** L5107. PORT-NEW: `registry` validates llmRoute (see header). */
export function rendererWritableSettingsPatch(patch: unknown, registry?: ProviderRegistry): Obj {
  const {
    gatewayUrl: _gatewayUrl, updateChannelPreference: _u, gatewayKey: _gk, gatewayKeys: _gks, openaiApiKey: _o, openRouterApiKey: _or,
    providerKeys: _pk, alphaConsentAt: _a, alphaConsentsByKey: _ab, usageSharingConsentAt: _us, ...safePatch
  } = (patch ?? {}) as Obj;
  if (safePatch.agentHarness !== undefined && safePatch.agentHarness !== "claude-code" && safePatch.agentHarness !== "codex-app-server") delete safePatch.agentHarness;
  if (safePatch.codexProvider !== undefined && safePatch.codexProvider !== "chatgpt" && safePatch.codexProvider !== "openai-api" && safePatch.codexProvider !== "openrouter") delete safePatch.codexProvider;
  if (safePatch.codexProvider === "chatgpt") {
    const model = typeof safePatch.codexModel === "string" ? safePatch.codexModel.trim().slice(0, 200) : "";
    safePatch.codexModel = model || undefined;
  } else if (safePatch.codexProvider === "openai-api" || safePatch.codexProvider === "openrouter") {
    const model = typeof safePatch.codexModel === "string" ? safePatch.codexModel.trim().slice(0, 200) : "";
    if (model) safePatch.codexModel = model;
    else { delete safePatch.codexProvider; delete safePatch.codexModel; }
  } else delete safePatch.codexModel;
  // PORT-NEW
  if (registry && "llmRoute" in safePatch && safePatch.llmRoute !== undefined && safePatch.llmRoute !== "claude-code" && safePatch.llmRoute !== "gateway" && !registry.has(safePatch.llmRoute)) delete safePatch.llmRoute;
  return safePatch;
}

/** L5578. Atomic: tmp + rename, mode 0600. THROWS on failure (message never includes values). */
export function writeSettingsFile(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch { /* PORT: chmod is a no-op/EPERM on some Windows filesystems */ }
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    const code = (err as NodeJS.ErrnoException)?.code;
    throw new Error(`Could not finish saving Videoclaw settings. ${code ?? String(redact(err instanceof Error ? err.message : err))}`, { cause: err });
  }
}

/** Provider-route names have the provider-config name shape (provider-config.ts). */
const PROVIDER_NAME_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class SettingsStore {
  value: Obj;
  legacy: Obj = {};
  legacySealedOnly = false;
  migratedSealed = false;
  legacyManagedGatewayUrl: string | undefined;
  other: Obj = {};
  private readonly registry: () => ProviderRegistry;

  constructor(readonly file: string, defaultGatewayUrl = PROD_GATEWAY_URL, decryptLegacy?: (v: string) => string, o: { registry?: () => ProviderRegistry; write?: (file: string, value: unknown) => void } = {}) {
    this.registry = o.registry ?? getProviderRegistry;
    if (o.write) this.writeImpl = o.write;
    const defaults = { gatewayUrl: defaultGatewayUrl, telemetry: true };
    let loaded: Obj = {};
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) loaded = parsed;
    } catch {}
    const loadedGatewayUrl = typeof loaded.gatewayUrl === "string" && loaded.gatewayUrl.trim() ? loaded.gatewayUrl : defaultGatewayUrl;
    if (loaded.accountSignedInOnce === true) this.legacyManagedGatewayUrl = loadedGatewayUrl;
    const known = new Set<string>(APP_SETTINGS_KEYS);
    const publicLoaded: Obj = {};
    const sealed: Obj = {};
    for (const [k, v] of Object.entries(loaded)) {
      if (known.has(k)) publicLoaded[k] = v;
      else if (k === "gatewayKey") { if (typeof v === "string" && v.trim()) this.legacy.gatewayKey = v; }
      else if (k === "gatewayKeys") { if (v && typeof v === "object" && !Array.isArray(v)) this.legacy.gatewayKeys = v; }
      else if (k === "gatewayKeyEncrypted" || k === "gatewayKeysEncrypted") sealed[k] = v;
      else this.other[k] = v;
    }
    if (Object.keys(sealed).length > 0) {
      let recovered: Obj | undefined;
      if (decryptLegacy) {
        try {
          const bare = sealed.gatewayKeyEncrypted;
          const map = sealed.gatewayKeysEncrypted;
          const out: Obj = {};
          if (typeof bare === "string" && bare.trim()) { const plain = decryptLegacy(bare); if (plain.trim()) out.gatewayKey = plain; }
          if (map && typeof map === "object" && !Array.isArray(map)) {
            const keys: Obj = {};
            for (const [url, enc] of Object.entries(map)) {
              if (typeof enc !== "string" || !enc.trim()) continue;
              const plain = decryptLegacy(enc);
              if (plain.trim()) keys[url] = plain;
            }
            if (Object.keys(keys).length > 0) out.gatewayKeys = keys;
          }
          recovered = out;
        } catch { recovered = undefined; }
      }
      if (recovered && (recovered.gatewayKey || recovered.gatewayKeys)) {
        const hadPlaintext = Boolean(this.legacy.gatewayKey || this.legacy.gatewayKeys);
        if (recovered.gatewayKey && !this.legacy.gatewayKey) this.legacy.gatewayKey = recovered.gatewayKey;
        if (recovered.gatewayKeys) this.legacy.gatewayKeys = { ...recovered.gatewayKeys, ...this.legacy.gatewayKeys };
        for (const [k, v] of Object.entries(sealed)) this.other[k] = v;
        this.migratedSealed = true;
        this.legacySealedOnly = !hadPlaintext;
      } else for (const [k, v] of Object.entries(sealed)) this.other[k] = v;
    }
    this.value = { ...defaults, ...publicLoaded };
    if (this.value.agentHarness !== undefined && this.value.agentHarness !== "claude-code" && this.value.agentHarness !== "codex-app-server") delete this.value.agentHarness;
    if (this.value.codexProvider !== undefined && this.value.codexProvider !== "chatgpt" && this.value.codexProvider !== "openai-api" && this.value.codexProvider !== "openrouter") delete this.value.codexProvider;
    if (this.value.codexProvider === undefined) delete this.value.codexModel;
    else if (typeof this.value.codexModel !== "string" || !this.value.codexModel.trim()) delete this.value.codexModel;
    else this.value.codexModel = this.value.codexModel.trim().slice(0, 200);
    // L5397 + PORT-NEW provider routes
    const route = this.value.llmRoute;
    if (route !== "claude-code" && route !== "gateway" && !this.registry().has(route)) {
      if (typeof route === "string" && PROVIDER_NAME_SHAPE.test(route)) this.other.llmRoute = route; // parked, see header
      delete this.value.llmRoute;
    }
    if (typeof this.value.llmRouteAcknowledgedAt !== "number" || !Number.isFinite(this.value.llmRouteAcknowledgedAt) || this.value.llmRouteAcknowledgedAt <= 0) delete this.value.llmRouteAcknowledgedAt;
    if (this.legacy.gatewayKey) {
      const sealedSource = this.other.gatewayKeyEncryptedSourceUrl;
      this.legacy.gatewayKeySourceUrl = typeof sealedSource === "string" && sealedSource.trim() ? sealedSource : this.value.gatewayUrl;
      if (this.migratedSealed) this.other.gatewayKeyEncryptedSourceUrl = this.legacy.gatewayKeySourceUrl;
    }
    this.value.alphaConsentsByKey = normalizedAlphaConsentRecords(this.value.alphaConsentsByKey);
  }

  /** The PUBLIC settings. Never holds a credential. (L5441) */
  get(): Obj {
    const out: Obj = { gatewayUrl: this.value.gatewayUrl, telemetry: this.value.telemetry };
    for (const k of APP_SETTINGS_KEYS) {
      if (k === "gatewayUrl" || k === "telemetry") continue;
      const v = this.value[k];
      if (v !== undefined) out[k] = v;
    }
    if (out.alphaConsentsByKey) out.alphaConsentsByKey = Object.fromEntries(Object.entries(out.alphaConsentsByKey).map(([id, r]) => [id, { ...(r as Obj) }]));
    return out;
  }
  legacyCredentials(): Obj {
    return {
      ...(this.legacy.gatewayKey ? { gatewayKey: this.legacy.gatewayKey } : {}),
      ...(this.legacy.gatewayKeys ? { gatewayKeys: { ...this.legacy.gatewayKeys } } : {}),
      ...(this.legacy.gatewayKeySourceUrl ? { gatewayKeySourceUrl: this.legacy.gatewayKeySourceUrl } : {}),
    };
  }
  hasLegacyCredentials(): boolean { return Boolean(this.legacy.gatewayKey || this.legacy.gatewayKeys); }
  legacySignedInOnceFor(gatewayUrl: string): boolean {
    const n = (url: string) => url.trim().replace(/\/+$/, "");
    return Boolean(this.value.accountSignedInOnce && this.legacyManagedGatewayUrl && n(this.legacyManagedGatewayUrl) === n(gatewayUrl));
  }
  /** Merge and persist; write-then-adopt; THROWS when the write fails. (L5497) */
  patch(update: Obj): Obj {
    const next: Obj = { ...this.value, ...update, alphaConsentsByKey: normalizedAlphaConsentRecords(update.alphaConsentsByKey ?? this.value.alphaConsentsByKey) };
    const providerChanged = update.codexProvider !== undefined && update.codexProvider !== this.value.codexProvider;
    if (next.codexProvider === undefined) delete next.codexModel;
    else if (providerChanged && update.codexModel === undefined) delete next.codexModel;
    const pinned = this.pinnedLegacy(next.gatewayUrl);
    // PORT-NEW: an explicit llmRoute choice supersedes a parked (unregistered) one
    const other = "llmRoute" in update ? (({ llmRoute: _p, ...rest }) => rest)(this.other) : this.other;
    this.write({ ...other, ...pinned.onDisk, ...next });
    this.other = other;
    this.value = next;
    this.legacy = pinned.legacy;
    return this.get();
  }
  patchDurable(update: Obj): Obj { return this.patch(update); }
  pinnedLegacy(nextGatewayUrl: string): { onDisk: Obj; legacy: Obj } {
    if (this.legacySealedOnly) return { onDisk: {}, legacy: this.legacy };
    const source = this.legacy.gatewayKeySourceUrl;
    const key = this.legacy.gatewayKey;
    if (!key || !source || source === nextGatewayUrl) return { onDisk: this.legacyOnDisk(), legacy: this.legacy };
    const keys = { [source]: key, ...(this.legacy.gatewayKeys ?? {}) };
    return { onDisk: { gatewayKeys: keys }, legacy: { gatewayKeys: keys } };
  }
  legacyOnDisk(): Obj {
    return { ...(this.legacy.gatewayKey ? { gatewayKey: this.legacy.gatewayKey } : {}), ...(this.legacy.gatewayKeys ? { gatewayKeys: this.legacy.gatewayKeys } : {}) };
  }

  /** PORT-NEW: re-evaluate llmRoute against the CURRENT provider registry (call after a provider
   *  config reload). In memory only — nothing is written. Returns true when the effective value changed. */
  revalidateLlmRoute(): boolean {
    const reg = this.registry();
    const cur = this.value.llmRoute;
    if (cur !== undefined && cur !== "claude-code" && cur !== "gateway" && !reg.has(cur)) {
      this.other.llmRoute = cur;
      delete this.value.llmRoute;
      return true;
    }
    if (cur === undefined && typeof this.other.llmRoute === "string" && reg.has(this.other.llmRoute)) {
      this.value.llmRoute = this.other.llmRoute;
      delete this.other.llmRoute;
      return true;
    }
    return false;
  }
  /** PORT-NEW: the parked (currently unregistered) provider route, if any. */
  parkedLlmRoute(): string | undefined { return typeof this.other.llmRoute === "string" ? this.other.llmRoute : undefined; }

  private writeImpl: (file: string, value: unknown) => void = writeSettingsFile;
  write(value: unknown): void { this.writeImpl(this.file, value); }
}
