// PORT-NEW (docs/18 §5): Settings page — "LLM route" selector + "About this build". Renders the
// llm-settings.ts controller with plain DOM (the port has no React renderer yet; the original
// settings UI lives in the not-yet-ported React bundle). textContent only — no HTML from data.
import type { PortDiagnostics } from "../shared/port-ipc";
import { createLlmSettingsController, type LlmSettingsController, type LlmSettingsState } from "./llm-settings";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderRoutes(root: HTMLElement, s: LlmSettingsState, ctl: LlmSettingsController): void {
  const list = root.querySelector<HTMLElement>("#llmRoutes")!;
  const status = root.querySelector<HTMLElement>("#llmRouteStatus")!;
  const banner = root.querySelector<HTMLElement>("#llmConfigError")!;
  const notice = root.querySelector<HTMLElement>("#llmNotice")!;
  banner.hidden = !s.configError;
  banner.textContent = s.configError ? `Providers file problem — only presets are listed: ${s.configError}` : "";
  notice.textContent = s.notice?.text ?? "";
  notice.dataset.tone = s.notice?.tone ?? "";
  status.textContent = s.phase === "loading" ? "Loading…" : s.phase === "error" ? "Unavailable" : `Active: ${s.rows.find((r) => r.selected)?.title ?? s.view?.current ?? "?"}`;
  list.textContent = "";
  if (s.phase === "ready" && !s.rows.length) list.appendChild(el("p", { class: "muted" }, "No routes available."));
  for (const r of s.rows) {
    const row = el("label", { class: "route" + (r.selected ? " selected" : "") + (r.selectable ? "" : " disabled"), "data-route": r.id });
    const radio = el("input", { type: "radio", name: "llmRoute", value: r.id });
    radio.checked = r.selected;
    radio.disabled = !r.selectable || !!s.pending;
    radio.addEventListener("change", () => { if (radio.checked) void ctl.select(r.id); });
    const body = el("div", { class: "route-body" });
    const head = el("div", { class: "route-head" });
    head.appendChild(el("span", { class: "route-title" }, r.title));
    head.appendChild(el("code", { class: "route-id" }, r.id));
    if (s.pending === r.id) head.appendChild(el("span", { class: "badge info" }, "saving…"));
    body.appendChild(head);
    if (r.detail) body.appendChild(el("div", { class: "route-detail" }, r.detail));
    const badges = el("div", { class: "badges" });
    for (const b of r.badges) badges.appendChild(el("span", { class: `badge ${b.tone}` }, b.text));
    body.appendChild(badges);
    if (r.reason) body.appendChild(el("div", { class: "route-reason" }, r.reason));
    row.append(radio, body);
    list.appendChild(row);
  }
}

function renderDiagnostics(root: HTMLElement, d: PortDiagnostics | { error: string }): void {
  const dl = root.querySelector<HTMLElement>("#diagnostics")!;
  dl.textContent = "";
  const add = (k: string, v: string, tone?: string) => { dl.appendChild(el("dt", {}, k)); const dd = el("dd", tone ? { class: tone } : {}, v); dl.appendChild(dd); };
  if ("error" in d) { add("Diagnostics", d.error, "warn"); return; }
  add("Version", `${d.app.version} (${d.app.packaged ? "packaged" : "development"}) · Electron ${d.app.electron ?? "?"} · Node ${d.app.node} · ${d.app.platform}-${d.app.arch}`);
  add("Claude Agent SDK", d.agentSdk.ok ? `${d.agentSdk.version} via ${d.agentSdk.source}${d.agentSdk.matchesPin ? "" : ` (pinned ${d.agentSdk.pinned})`}` : `not available — ${d.agentSdk.error ?? "unknown"}`, d.agentSdk.ok ? "ok" : "warn");
  if (d.agentSdk.executable) add("claude binary", d.agentSdk.executable);
  add("node:sqlite", d.sqlite.ok ? `ok (SQLite ${d.sqlite.sqliteVersion})` : `unavailable — ${d.sqlite.error ?? ""}`, d.sqlite.ok ? "ok" : "warn");
  add("User data", d.app.userData);
}

export interface SettingsPageHandle { controller: LlmSettingsController; refreshDiagnostics(): Promise<void>; dispose(): void }

export function mountSettingsPage(root: HTMLElement): SettingsPageHandle | null {
  const api = window.videoclaw;
  const port = window.videoclawPort;
  if (!port || !api) { root.textContent = "Settings unavailable: preload bridge missing."; return null; }
  const ctl = createLlmSettingsController({
    llmRoutes: () => port.llmRoutes(),
    setLlmRoute: (id) => api.setSettings({ llmRoute: id } as any) as Promise<{ llmRoute?: unknown }>,
    onChange: (s) => renderRoutes(root, s, ctl),
  });
  const refreshDiagnostics = async () => {
    try { renderDiagnostics(root, await port.diagnostics()); } catch (e) { renderDiagnostics(root, { error: String(e) }); }
  };
  root.querySelector("#llmRefresh")?.addEventListener("click", () => { void ctl.refresh("button"); void refreshDiagnostics(); });
  // refresh triggers: main-process push (route changed / providers file reloaded), window focus,
  // tab becoming visible again (env-var keys are read at startup, the providers file hot-reloads)
  const off = port.onLlmRoutesChanged((view) => ctl.applyView(view, "push"));
  const onFocus = () => { void ctl.refresh("focus"); };
  const onVis = () => { if (document.visibilityState === "visible") void ctl.refresh("visible"); };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVis);
  void ctl.refresh("mount");
  void refreshDiagnostics();
  return { controller: ctl, refreshDiagnostics, dispose: () => { off(); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); } };
}
