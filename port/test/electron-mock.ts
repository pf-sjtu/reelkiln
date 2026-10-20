// Test-only stand-in for the `electron` module (aliased by tools/build.mjs --tests).
export const calls: { fn: string; channel: string; args: unknown[] }[] = [];
export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => { calls.push({ fn: "invoke", channel, args }); return Promise.resolve(); },
  send: (channel: string, ...args: unknown[]) => { calls.push({ fn: "send", channel, args }); },
  on: (channel: string, _l: unknown) => { calls.push({ fn: "on", channel, args: [] }); },
  removeListener: (channel: string, _l: unknown) => { calls.push({ fn: "removeListener", channel, args: [] }); },
};
export const webUtils = { getPathForFile: (_f: unknown) => "/mock/path" };
export const contextBridge = { exposeInMainWorld: () => {} };
