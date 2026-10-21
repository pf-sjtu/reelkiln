export interface PlatformInfo { os: "linux" | "win32" | "darwin"; targets: string[]; exe: string; verifiedOnBox: boolean }
export const PLATFORMS: Record<"linux" | "win" | "mac", PlatformInfo>;
export const SDK_PACKAGE: string;
export const SDK_RESOURCE_DIR: string;
export function nativeSdkPackage(os: string, arch: string): string;
export function sdkResourceFilter(os: string, arch: string): string[];
export function builderConfig(o: { platform: "linux" | "win" | "mac"; arch: "x64" | "arm64"; sdkDir?: string | null; version: string; outDir?: string }): Record<string, any>;
export function validateSdkStaging(sdkDir: string, o: { os: string; arch: string; pinned: string; exists: (p: string) => boolean; readJson: (p: string) => any }): string[];
