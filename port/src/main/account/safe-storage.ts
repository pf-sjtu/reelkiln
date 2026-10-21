// PORT-NEW (docs/28): Electron's safeStorage for the verbatim CredentialStore. Under node:test (no Electron)
// it reports encryption unavailable, so an UNPACKAGED build persists the vault in the clear — the same
// latitude the original grants unpackaged builds (CredentialStore.canPersistNew L4605).
type SafeStorageLike = { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string };
let impl: SafeStorageLike | undefined;
function resolve(): SafeStorageLike {
  if (impl) return impl;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron");
    if (electron && typeof electron === "object" && electron.safeStorage) { impl = electron.safeStorage as SafeStorageLike; return impl; }
  } catch {}
  impl = {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error("safeStorage unavailable"); },
    decryptString: () => { throw new Error("safeStorage unavailable"); },
  };
  return impl;
}
/** Test hook. */
export function setSafeStorageForTests(s: SafeStorageLike | undefined): void { impl = s; }
export const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => resolve().isEncryptionAvailable(),
  encryptString: (s) => resolve().encryptString(s),
  decryptString: (b) => resolve().decryptString(b),
};
