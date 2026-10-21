// Stub renderer: lists window.videoclaw methods and pings a few fake-backed channels.
import "../shared/ipc-contract";
import type { LlmRouteOption, LlmRoutesView } from "../shared/port-ipc";
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

// PORT-NEW (docs/17 §5): minimal LLM route selector — list from window.videoclawPort.llmRoutes(),
// selection through the ORIGINAL settings:set (setSettings({ llmRoute })), which validates it.
const routeSelect = document.getElementById("llmRoute") as HTMLSelectElement | null;
const routeInfo = document.getElementById("llmRouteInfo");
export function routeOptionLabel(r: LlmRouteOption): string {
  const bits = [r.label];
  if (r.model) bits.push(`· ${r.model}`);
  if (r.problem === "key-missing") bits.push(`(set ${r.keyEnv ?? "its API key env var"})`);
  else if (r.problem === "protocol-not-agent-capable") bits.push("(helper calls only)");
  return bits.join(" ");
}
async function loadRoutes(): Promise<void> {
  if (!routeSelect || !window.videoclawPort) return;
  let view: LlmRoutesView;
  try { view = await window.videoclawPort.llmRoutes(); } catch (e) { if (routeInfo) routeInfo.textContent = `routes unavailable: ${String(e)}`; return; }
  routeSelect.textContent = "";
  for (const r of view.routes) {
    const o = document.createElement("option");
    o.value = r.id;
    o.textContent = routeOptionLabel(r);
    o.disabled = r.problem === "key-missing" && r.id !== view.current;
    o.selected = r.id === view.current;
    routeSelect.appendChild(o);
  }
  if (routeInfo) routeInfo.textContent = view.configError ? `providers file error: ${view.configError}` : `current: ${view.current}`;
}
routeSelect?.addEventListener("change", async () => {
  const next = routeSelect.value;
  try {
    const s = await api.setSettings({ llmRoute: next } as any);
    say(`setSettings llmRoute=${next} → ${JSON.stringify((s as any)?.llmRoute ?? "(dropped: not a valid route)")}`);
  } catch (e) { say(`setSettings failed: ${String(e)}`); }
  await loadRoutes();
});
void loadRoutes();
