// PORT-NEW glue (docs/28): the account / gateway-key / billing IPC channels, served by the ORIGINAL bodies
// (main L61376-61600) over the verbatim account-gateway slice (account-gateway.generated.ts) and the verbatim
// CredentialStore (credential-store.generated.ts). Electron-free (every platform call is injected) so
// test/account-gateway.test.ts drives exactly the handlers real-backend.ts registers.
//
//   gateway:verify            L61376 verifyKeyAt(openedGatewayUrl, key)
//   settings:switchGateway    L61377 switchGatewayKeys → settings.patch → verifyKeyAt (requiresRestart)
//   settings:saveGatewayKey   L61393 applyManualKeyWrite → credentials.setActiveKey → resolveAccount
//   account:snapshot/refresh  L61406-61407 resolveAccount (L60790) → resolveAccountSnapshot (L55423)
//   account:signInGoogle/Email/resendEmail/cancelSignIn/signOut/consent/ensureAccess/mintKey/claimKey
//                             L61408-61574, over PortAccountAuth (below)
//   gateway:meter / topup     L61593-61602 loadKeyMeter / startTopUp
//
// PortAccountAuth is the reachable SUBSET of AccountAuth (L53984-54960). Managed sign-in (Google PKCE / Identity
// Platform email link / ID-token account plane) is NOT ported: this build offers no videoclaw.com account, so
// the auth pool resolves to "unconfigured" for prod/staging (PORT decision, the original's copy for a build with
// no pool) and verbatim for local ("unconfigured") / custom ("untrusted-gateway") gateways. Every account-plane
// method therefore stops at the original's own assertTrustedGateway()/config() refusal before any network I/O.
import {
  AccountAuthError, ACCOUNT_BLOCKED_COPY, applyManualKeyWrite, envForGatewayUrl, loadKeyMeter, mintFailureReason,
  normalizeGatewayUrl, paidWorkBlockedFor, pinGatewaySettings, resolveAccountSnapshot, resolveAuthPool as originalResolveAuthPool,
  signInFailure, SIGN_IN_UNAVAILABLE_COPY, startTopUp, switchGatewayKeys, verifyKeyAt,
} from "./account-gateway.generated";
import { accountSnapshot as localStudioSnapshot, PORT_ACCOUNT_GATE_ENV } from "../home-boot";
import { ALPHA_TERMS_VERSION } from "../account-snapshot.generated";

type Obj = Record<string, any>;
type Handler = (...a: any[]) => unknown;

/** PORT auth pool: no Firebase pool is configured for prod/staging in this build (no videoclaw.com account). */
export function portResolveAuthPool(gatewayUrl: string): { config: null; reason: string } | { config: unknown } {
  const env = envForGatewayUrl(gatewayUrl);
  if (env === "prod" || env === "staging") return { config: null, reason: "unconfigured" };
  return originalResolveAuthPool(gatewayUrl, { prod: null, staging: null });
}

export interface CredentialsLike {
  activeKey(url: string): string | undefined;
  setActiveKey(url: string, key: string | undefined, o?: { blockLegacyFallback?: boolean }): void;
  session(url: string): { refreshToken?: string } | undefined;
  clearSession(url: string): void;
  hasSignedInOnce(url: string): boolean;
  pendingKey(url: string): string | undefined;
  secureStorageUnavailable(): boolean;
  unreadable(): boolean;
  assertCanMutate(): void;
  assertCanStartInteractiveSignIn(): void;
}

/** The reachable subset of AccountAuth (L53984). */
export class PortAccountAuth {
  sessionGeneration = 0;
  constructor(private readonly credentials: CredentialsLike, private readonly gateway: () => { gatewayUrl: string }, private readonly resolvePool = portResolveAuthPool) {}
  key() { return normalizeGatewayUrl(this.gateway().gatewayUrl); }
  config(): unknown { // L54100
    const { config, reason } = this.resolvePool(this.gateway().gatewayUrl) as any;
    if (!config) {
      const why = reason ?? "unconfigured";
      throw new AccountAuthError(why, `${(SIGN_IN_UNAVAILABLE_COPY as any)[why]} Use “I already have an alpha key” instead.`);
    }
    return config;
  }
  assertTrustedGateway() { this.config(); }
  signInAvailable() { return (this.resolvePool(this.gateway().gatewayUrl) as any).config !== null; }
  signInUnavailableReason() { return (this.resolvePool(this.gateway().gatewayUrl) as any).reason; }
  isSignedIn() { return Boolean(this.credentials.session(this.key())?.refreshToken); }
  signedInProfileImageUrl() { return undefined; }
  isCurrentAccountResult() { return true; }
  signOut() { this.sessionGeneration++; this.credentials.clearSession(this.key()); }
  cancelInteractiveSignIn() { /* L54394: activeInteractiveCancel is never set — no browser round-trip exists */ }
  /** Reached only with a session, which this build can never create. */
  async fetchAccount(): Promise<never> { this.assertTrustedGateway(); throw new AccountAuthError("rejected", "Sign in to continue."); }
  async signInWithGoogle(): Promise<never> { ++this.sessionGeneration; this.config(); throw new AccountAuthError("unconfigured", "Google sign-in is not available in this build."); }
  async signInWithEmailLink(email: string, _onSent?: () => void): Promise<never> {
    ++this.sessionGeneration;
    this.config();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email ?? "").trim())) throw new AccountAuthError("rejected", "Enter a valid email address.");
    throw new AccountAuthError("unconfigured", "Email sign-in is not available in this build.");
  }
  async resendEmailLink(): Promise<never> { throw new AccountAuthError("cancelled", "That sign-in is no longer waiting — start again."); } // L54531 (no active link)
  async acceptConsent(termsVersion: unknown, _appVersion: string): Promise<never> { // L54720
    if (termsVersion !== ALPHA_TERMS_VERSION) throw new AccountAuthError("rejected", "Videoclaw has updated its alpha terms. Update the app to read the current terms — we won’t agree to them on your behalf.");
    this.assertTrustedGateway(); // this.call() L54587
    throw new AccountAuthError("rejected", "Sign in to continue.");
  }
  /** accountApiRequest (L54613): needs the account session; the port has no sign-in pool → assertTrustedGateway throws. */
  async accountApiRequest(_path: string, _init?: unknown): Promise<Response> { this.assertTrustedGateway(); throw new AccountAuthError("rejected", "Sign in to continue."); }
  async issueKey(): Promise<never> { this.assertTrustedGateway(); this.credentials.assertCanMutate(); throw new AccountAuthError("rejected", "Sign in to continue."); }
  async addDeviceAccess(): Promise<never> { this.assertTrustedGateway(); this.credentials.assertCanMutate(); throw new AccountAuthError("rejected", "Sign in to continue."); }
  async claimKey(_key: string): Promise<never> { this.assertTrustedGateway(); this.credentials.assertCanMutate(); throw new AccountAuthError("rejected", "Sign in to continue."); }
}

export interface AccountServiceDeps {
  settings: { get(): Obj; patch(u: Obj): unknown; legacySignedInOnceFor?(url: string): boolean };
  credentials: CredentialsLike;
  /** The gateway this process opened with (L60917): a switch only applies after a restart. */
  openedGatewayUrl: string;
  packaged: boolean;
  appVersion: string;
  env?: NodeJS.ProcessEnv;
  push: (channel: string, ...a: unknown[]) => void;
  openExternal: (url: string) => Promise<void>;
  stopAuthenticatedWork?: () => void;
  fetchImpl?: typeof fetch;
}

export class AccountService {
  readonly auth: PortAccountAuth;
  account: Obj = { loaded: false };
  signedOutInProcess = false;
  /** projectMemoryIdentity (L60800-60835) — the verified key identity memoryBinding (L36456) is bound to. */
  projectMemoryIdentity: { gatewayUrl: string; gatewayKey: string; canonicalKeyId: string } | null = null;
  private generation = 0;
  readonly opened: string;
  constructor(private readonly d: AccountServiceDeps) {
    this.opened = normalizeGatewayUrl(d.openedGatewayUrl);
    this.auth = new PortAccountAuth(d.credentials, () => this.activeSettings() as { gatewayUrl: string });
  }
  private localStudio() { return (this.d.env ?? process.env)[PORT_ACCOUNT_GATE_ENV] !== "1"; }
  /** resolvedSettings (L60371): settings + the vault key for each gateway. */
  resolvedSettings(): Obj {
    const s = this.d.settings.get();
    const legacyKeys: Obj = { ...(s.gatewayKeys ?? {}) };
    const keyFor = (u: string) => this.d.credentials.activeKey(u)
      || (typeof legacyKeys[u] === "string" && legacyKeys[u].trim() ? legacyKeys[u].trim() : undefined)
      || (typeof s.gatewayKey === "string" && s.gatewayKey.trim() && normalizeGatewayUrl(String(s.gatewayKeySourceUrl ?? s.gatewayUrl ?? "")) === u ? s.gatewayKey.trim() : undefined);
    const url = normalizeGatewayUrl(String(s.gatewayUrl ?? this.opened));
    const keys: Obj = { ...legacyKeys };
    for (const u of new Set([url, this.opened])) { const k = keyFor(u); if (k) keys[u] = k; else delete keys[u]; }
    return { ...s, gatewayKey: keyFor(url), gatewayKeys: keys };
  }
  /** activeSettings (L60918) — pinned to the opened gateway. PORT: alpha consent is the local-studio policy
   *  (AlphaConsentCoordinator / beacon outbox not ported) unless VIDEOCLAW_PORT_ACCOUNT_GATE=1. */
  activeSettings(): Obj {
    const current = this.resolvedSettings();
    const pinned = pinGatewaySettings(this.opened, current.gatewayKeys?.[this.opened] || undefined, current);
    return {
      ...pinned,
      accountSignedInOnce: this.d.credentials.hasSignedInOnce(this.opened) || (this.d.settings.legacySignedInOnceFor?.(this.opened) ?? false),
      alphaConsentAt: current.alphaConsentAt ?? (this.localStudio() && pinned.gatewayKey ? "port-local-studio" : undefined),
    };
  }
  paidWorkBlocked(): boolean { // L60847
    return paidWorkBlockedFor(this.account, { packaged: this.d.packaged, channel: "prod", managedDevelopment: false });
  }
  /** resolveAccount (L60790). PORT: with NO stored key the docs/21 local-studio snapshot stays in force. */
  async resolveAccount(opts: Obj = {}): Promise<Obj> {
    const ticket = ++this.generation;
    this.projectMemoryIdentity = null;
    const resolving = this.activeSettings();
    let resolved: Obj;
    if (!resolving.gatewayKey && this.localStudio() && !this.auth.isSignedIn()) {
      resolved = localStudioSnapshot({ env: this.d.env, accountSignedInOnce: resolving.accountSignedInOnce });
      if (opts.message) resolved = { ...resolved, message: opts.message };
    } else {
      resolved = await resolveAccountSnapshot({
        settings: () => resolving,
        auth: this.auth,
        credentials: this.d.credentials,
        verifyKey: (url: string, key: string) => this.verifyKey(url, key),
        signedOutInProcess: () => this.signedOutInProcess,
        blockInProcess: () => { if (ticket !== this.generation) return; this.signedOutInProcess = true; this.d.stopAuthenticatedWork?.(); },
      }, opts);
    }
    if (ticket !== this.generation) return this.account;
    this.account = resolved;
    if (resolved.step === "ready" && resolved.storedKeyId && resolving.gatewayKey && (resolved.legacyKeyOnly || (resolved.signedIn && resolved.account?.activeKeyId === resolved.storedKeyId))) {
      this.projectMemoryIdentity = { gatewayUrl: resolving.gatewayUrl, gatewayKey: resolving.gatewayKey, canonicalKeyId: resolved.storedKeyId };
    }
    this.d.push("account:changed", this.account);
    return this.account;
  }
  /** verifyKeyAt (L60601, verbatim: the global fetch, 5 s timeout). */
  private verifyKey(url: string, key: string) { return verifyKeyAt(url, key); }

  handlers(): Record<string, Handler> {
    const d = this.d;
    const auth = this.auth;
    return {
      "gateway:verify": (key: unknown) => this.verifyKey(this.opened, String(key ?? "")),
      "settings:switchGateway": async (url: unknown) => {
        const swap = switchGatewayKeys(this.activeSettings(), String(url ?? ""));
        const target = swap.gatewayUrl;
        const targetKey = swap.gatewayKey;
        d.settings.patch({ gatewayUrl: target });
        const verify2 = targetKey ? await this.verifyKey(target, targetKey) : null;
        return { settings: d.settings.get(), verify: verify2, interrupted: [], requiresRestart: true };
      },
      "settings:saveGatewayKey": async (key: unknown) => {
        applyManualKeyWrite({
          gatewayUrl: this.opened,
          hasSignedInOnce: (url: string) => d.credentials.hasSignedInOnce(url),
          legacySignedInOnce: d.settings.legacySignedInOnceFor?.(this.opened) ?? false,
          setActiveKey: (url: string, k: string) => d.credentials.setActiveKey(url, k, { blockLegacyFallback: true }),
        }, key);
        await this.resolveAccount();
        return d.settings.get();
      },
      "account:snapshot": () => (this.account.loaded ? this.account : this.resolveAccount()),
      "account:refresh": () => this.resolveAccount(),
      "account:signInGoogle": async () => {
        try {
          const state = await auth.signInWithGoogle();
          this.signedOutInProcess = false;
          await this.resolveAccount({ state });
          return { ok: true, account: state };
        } catch (err) { await this.resolveAccount(); return signInFailure(err); }
      },
      "account:resendEmail": async () => {
        try { await auth.resendEmailLink(); return { ok: true }; } catch (err) { return signInFailure(err); }
      },
      "account:cancelSignIn": () => { auth.cancelInteractiveSignIn(); },
      "account:signInEmail": async (email: unknown) => {
        try {
          const state = await auth.signInWithEmailLink(String(email ?? ""), () => d.push("account:emailSent"));
          this.signedOutInProcess = false;
          await this.resolveAccount({ state });
          return { ok: true, account: state };
        } catch (err) { await this.resolveAccount(); return signInFailure(err); }
      },
      "account:signOut": async () => {
        this.signedOutInProcess = true;
        d.stopAuthenticatedWork?.();
        let message: string | undefined;
        try { auth.signOut(); } catch { message = "You’ve been signed out and everything running has been stopped, but Videoclaw couldn’t update its saved credentials. If you reopen Videoclaw and it’s still signed in, sign out again. Your Videoclaw key and your projects have not been touched."; }
        return this.resolveAccount({ state: null, message });
      },
      "account:consent": async (termsVersion: unknown) => {
        try {
          const state = await auth.acceptConsent(termsVersion, d.appVersion);
          await this.resolveAccount({ state });
          return { ok: true, account: state };
        } catch (err) { await this.resolveAccount(); return signInFailure(err); }
      },
      "account:ensureAccess": async () => { // L61508
        try {
          const current = await this.resolveAccount();
          const state = current.account;
          if (!current.signedIn || !state) throw new AccountAuthError("rejected", "Sign in to Videoclaw first.");
          if (!state.termsAccepted) throw new AccountAuthError("rejected", "Accept the Videoclaw terms first.");
          if (state.supportRequired) throw new AccountAuthError("rejected", "This account needs the Videoclaw team to restore access. Nothing was changed.");
          if (current.step === "ready") return { ok: true, account: state };
          let next: any;
          if (state.hasActiveKey) ({ account: next } = await auth.addDeviceAccess() as any);
          else {
            const local = this.resolvedSettings().gatewayKey;
            if (local && !current.storedKeyInvalid) ({ account: next } = await auth.claimKey(local) as any);
            else ({ account: next } = await auth.issueKey() as any);
          }
          await this.resolveAccount({ state: next });
          return { ok: true, account: next };
        } catch (err: any) {
          await this.resolveAccount();
          return { ok: false, reason: mintFailureReason(err?.reason), message: err?.message ?? "Could not restore Videoclaw access — try again.", ...(err?.retryable ? { retryable: true } : {}) };
        }
      },
      "account:mintKey": async () => { // L61557
        try {
          const { account: state } = await auth.issueKey() as any;
          await this.resolveAccount({ state });
          return { ok: true, account: state };
        } catch (err: any) {
          await this.resolveAccount();
          return { ok: false, reason: err?.conflict ? "conflict" : mintFailureReason(err?.reason), message: err?.message ?? "Could not set up a key — try again.", ...(err?.retryable ? { retryable: true } : {}), ...(err?.existing ? { existing: err.existing } : {}) };
        }
      },
      "account:claimKey": async (key: unknown) => { // L61574
        const plain = (typeof key === "string" ? key.trim() : "") || this.resolvedSettings().gatewayKey;
        if (!plain) return { ok: false, reason: "unknown", message: "Paste your Videoclaw key first." };
        try {
          const { account: state, alreadyClaimed } = await auth.claimKey(plain) as any;
          await this.resolveAccount({ state });
          return { ok: true, account: state, alreadyClaimed };
        } catch (err: any) {
          await this.resolveAccount();
          return { ok: false, reason: err?.reason === "network" || err?.reason === "vault-unreadable" ? err.reason : "rejected", message: err?.message ?? "Could not link that key — try again." };
        }
      },
      "gateway:meter": () => loadKeyMeter({ settings: () => this.activeSettings(), ...(d.fetchImpl ? { fetch: d.fetchImpl } : {}) }),
      "gateway:topup": (usd: unknown) => startTopUp(usd, { settings: () => this.activeSettings(), blocked: () => this.paidWorkBlocked(), openExternal: d.openExternal, ...(d.fetchImpl ? { fetch: d.fetchImpl } : {}) }),
    };
  }
  /** currentProjectMemoryScope (L60451). */
  currentProjectMemoryScope(): { gatewayUrl: string; canonicalKeyId: string } | null {
    const current = this.activeSettings();
    const verified = this.projectMemoryIdentity;
    return !this.signedOutInProcess && this.account.step === "ready" && verified && current
      && verified.gatewayUrl === current.gatewayUrl && verified.gatewayKey === current.gatewayKey
      ? { gatewayUrl: verified.gatewayUrl, canonicalKeyId: verified.canonicalKeyId } : null;
  }
  /** host.setCreditHandoffEligibility (L61622) — the credit-route eligibility verdict. */
  async creditHandoffEligibility(): Promise<Obj> {
    const cfg = { ...this.activeSettings() };
    if (this.paidWorkBlocked() || !cfg.gatewayKey) return { available: false, reason: "account-unavailable", message: "Verify your VideoClaw account before continuing." };
    const meter: any = await loadKeyMeter({ settings: () => cfg, ...(this.d.fetchImpl ? { fetch: this.d.fetchImpl } : {}) });
    const current = this.activeSettings();
    if (!meter || this.paidWorkBlocked() || current.gatewayKey !== cfg.gatewayKey || current.gatewayUrl !== cfg.gatewayUrl) return { available: false, reason: "account-unavailable", message: "Your VideoClaw credits could not be checked. Try again." };
    if (meter.availableUsd !== null && meter.availableUsd <= 0) return { available: false, reason: "insufficient-credits", message: "Add VideoClaw credits before continuing." };
    return { available: true };
  }
}
export { ACCOUNT_BLOCKED_COPY };
