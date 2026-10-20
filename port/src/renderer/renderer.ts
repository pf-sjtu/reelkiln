// Stub renderer: lists window.videoclaw methods and pings a few fake-backed channels.
import "../shared/ipc-contract";
const out = document.getElementById("log")!;
const say = (s: string) => { out.textContent += s + "\n"; };
const api = window.videoclaw;
const names = api ? Object.keys(api) : [];
document.getElementById("summary")!.textContent = api
  ? `window.videoclaw exposes ${names.length} methods (expected 184).`
  : "window.videoclaw missing — preload failed.";
const ol = document.getElementById("methods")!;
for (const n of names) { const li = document.createElement("li"); li.textContent = n; ol.appendChild(li); }
api?.onBootstrapProgress((p) => say(`push bootstrap:progress ${JSON.stringify(p)}`));
document.getElementById("ping")!.addEventListener("click", async () => {
  say(`bootstrapStatus → ${JSON.stringify(await api.bootstrapStatus()).slice(0, 120)}…`);
  say(`listClients → ${JSON.stringify(await api.listClients())}`);
  say(`getAppUpdateState → ${JSON.stringify(await api.getAppUpdateState())}`);
  say(`voiceDictationStatus → ${JSON.stringify(await api.voiceDictationStatus())}`);
  say(`listSessions (unimplemented) → ${JSON.stringify(await api.listSessions())}`);
  say(`bootstrapRun → ${JSON.stringify(await api.bootstrapRun()).slice(0, 60)}…`);
});
