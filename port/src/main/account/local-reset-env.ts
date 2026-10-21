// PORT-NEW glue (docs/26 → docs/28) for the verbatim local-reset slice (local-reset.generated.ts).
// docs/28: the gateway-key vault is now the VERBATIM CredentialStore (credential-store.generated.ts, main
// L4534-5050): the local gateway shim's `vc_` key lives in userData/credentials.dat, so a local reset releases
// it exactly like the original releases a Videoclaw account key.
export { CredentialStore, CredentialStoreError } from "./credential-store.generated";
export { sanitizeErrorText } from "../agent/history.generated";
