/** Platforms the port cares about. Every function takes `platform` explicitly (default
 *  process.platform) so both code paths are unit-testable on any host. */
export type Plat = NodeJS.Platform;
export const isWin = (p: Plat = process.platform) => p === "win32";
