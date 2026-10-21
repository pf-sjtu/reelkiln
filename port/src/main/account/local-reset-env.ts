// PORT-NEW glue (docs/26) for the verbatim local-reset slice (local-reset.generated.ts).
// CredentialStoreError (L5490): the port has no credential vault (no Videoclaw account; provider keys stay
// in the box env), so nothing ever throws it — the class exists so `instanceof` checks stay verbatim.
export class CredentialStoreError extends Error {
  reason: string;
  constructor(reason: string, message?: string) { super(message ?? reason); this.reason = reason; this.name = "CredentialStoreError"; }
}
/** CredentialStore (L5392) — PORT: no vault file is ever written by the port, so the reset's credential
 *  step has no Videoclaw account state to release and the boundary check finds none. */
export class CredentialStore {
  constructor(readonly o: { file: string; packaged: boolean }) {}
  assertCanMutate(): void {}
  releaseVideoclawAccounts(_urls: string[]): void {}
  unreadable(): boolean { return false; }
  holdsVideoclawAccountState(): boolean { return false; }
}
export { sanitizeErrorText } from "../agent/history.generated";
