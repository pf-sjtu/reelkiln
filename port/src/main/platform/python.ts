// nativePythonArgs (main/index.js L7172+): forces an arm64 interpreter on Apple
// Silicon via Mach-O inspection. The ORIGINAL already returns [] when
// process.platform !== "darwin" || process.arch !== "arm64", so on Windows it is a no-op.
import { type Plat } from "./types";
export function needsNativePythonProbe(p: Plat = process.platform, arch: string = process.arch): boolean {
  return p === "darwin" && arch === "arm64";
}
