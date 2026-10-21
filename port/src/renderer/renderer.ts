// Port renderer: Settings page (PORT-NEW, docs/18 §5) + the original IPC smoke/debug view.
import "../shared/ipc-contract";
import { mountSettingsPage } from "./settings-page";
const out = document.getElementById("log")!;
const say = (s: string) => { out.textContent += s + "\n"; };
const api = window.videoclaw;
const names = api ? Object.keys(api) : [];

// tabs
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("nav button[data-view]"))) {
  b.addEventListener("click", () => {
    for (const o of Array.from(document.querySelectorAll<HTMLButtonElement>("nav button[data-view]"))) {
      const on = o === b;
      o.setAttribute("aria-selected", String(on));
      document.getElementById(`view-${o.dataset.view}`)!.hidden = !on;
    }
  });
}

const settingsRoot = document.getElementById("view-settings");
if (settingsRoot) (window as any).__videoclawSettings = mountSettingsPage(settingsRoot); // handle for the smoke driver

// debug view: lists window.videoclaw methods and pings a few fake-backed channels
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
