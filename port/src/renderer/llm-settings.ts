// PORT-NEW (docs/18 §5): settings-page LLM route selector — view model + controller. DOM-free so it
// is unit-tested under node (test/settings-llm.test.ts); settings-page.ts renders it.
// Data: window.videoclawPort.llmRoutes() (port:llm:routes) + push port:llm:routesChanged.
// Selection: the ORIGINAL settings:set (window.videoclaw.setSettings({ llmRoute })), which drops a
// route that is neither built-in nor registered — the controller detects that and reports it.
import type { LlmRouteOption, LlmRoutesView } from "../shared/port-ipc";

export type BadgeTone = "ok" | "warn" | "muted" | "info";
export interface RouteBadge { tone: BadgeTone; text: string }
export interface RouteRow {
  id: string;
  title: string;
  detail: string;
  badges: RouteBadge[];
  /** can be chosen now (the current route is always "selectable" so it stays visible as checked) */
  selectable: boolean;
  selected: boolean;
  /** why it is not (fully) usable — shown under the row */
  reason?: string;
}

const PROTOCOL_LABEL: Record<string, string> = {
  "anthropic-messages": "Anthropic Messages",
  "openai-chat-completions": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
};

export function routeRow(r: LlmRouteOption, current: string): RouteRow {
  const selected = r.id === current;
  if (r.kind === "builtin") {
    if (r.id === "claude-code") {
      return { id: r.id, title: r.label, detail: "Agent sessions and helper calls use your local Claude Code sign-in (original default).", badges: [{ tone: "info", text: "Built-in" }, { tone: "ok", text: "Agent" }, { tone: "ok", text: "Helper" }], selectable: true, selected };
    }
    return {
      id: r.id, title: r.label, detail: "Original Videoclaw gateway route.", badges: [{ tone: "info", text: "Built-in" }, { tone: "warn", text: "Gateway sign-in not ported" }],
      selectable: true, selected, reason: "The gateway credential vault is not ported yet; sessions on this route report not-ready until a gateway key is available.",
    };
  }
  const badges: RouteBadge[] = [{ tone: "info", text: r.preset ? "Preset" : "Custom provider" }];
  badges.push(r.keyPresent ? { tone: "ok", text: `Key set (${r.keyEnv})` } : { tone: "warn", text: `Key missing (${r.keyEnv})` });
  badges.push(r.agentCapable ? { tone: "ok", text: "Agent" } : { tone: "muted", text: "No agent" });
  badges.push(r.helperCapable ? { tone: "ok", text: "Helper" } : { tone: "muted", text: "No helper" });
  badges.push({ tone: "muted", text: `Structured output: ${r.structuredOutput ?? "native"}` });
  const detail = [r.protocol ? PROTOCOL_LABEL[r.protocol] ?? r.protocol : undefined, r.model].filter(Boolean).join(" · ");
  let reason: string | undefined;
  if (r.problem === "key-missing") reason = `Set the ${r.keyEnv ?? "API key"} environment variable and restart Videoclaw to use this route.`;
  else if (r.problem === "protocol-not-agent-capable") reason = "This protocol can serve helper calls only; agent sessions need an Anthropic Messages-compatible provider.";
  return { id: r.id, title: r.label, detail, badges, selectable: r.problem !== "key-missing" || selected, selected, ...(reason ? { reason } : {}) };
}

export function routeRows(view: LlmRoutesView): RouteRow[] {
  return view.routes.map((r) => routeRow(r, view.current));
}

export interface Notice { tone: "ok" | "error" | "info"; text: string }
export interface LlmSettingsState {
  phase: "loading" | "ready" | "error";
  view?: LlmRoutesView;
  rows: RouteRow[];
  /** route id being saved */
  pending?: string;
  notice?: Notice;
  /** providers file problem (safe message from main) */
  configError?: string;
  refreshes: number;
}
export interface LlmSettingsDeps {
  llmRoutes(): Promise<LlmRoutesView>;
  /** window.videoclaw.setSettings({ llmRoute }) → the settings after the patch */
  setLlmRoute(id: string): Promise<{ llmRoute?: unknown } | undefined>;
  onChange(state: LlmSettingsState): void;
}
export interface LlmSettingsController {
  state(): LlmSettingsState;
  refresh(reason?: string): Promise<void>;
  select(id: string): Promise<boolean>;
  /** port:llm:routesChanged payload */
  applyView(view: LlmRoutesView, reason?: string): void;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createLlmSettingsController(d: LlmSettingsDeps): LlmSettingsController {
  let s: LlmSettingsState = { phase: "loading", rows: [], refreshes: 0 };
  let seq = 0; // latest request wins (focus + push + post-save refresh can overlap)
  const emit = (patch: Partial<LlmSettingsState>) => { s = { ...s, ...patch }; d.onChange(s); };
  const adopt = (view: LlmRoutesView, extra: Partial<LlmSettingsState> = {}) => {
    emit({ phase: "ready", view, rows: routeRows(view), configError: view.configError, refreshes: s.refreshes + 1, ...extra });
  };
  const ctl: LlmSettingsController = {
    state: () => s,
    async refresh() {
      const mine = ++seq;
      try {
        const view = await d.llmRoutes();
        if (mine === seq) adopt(view);
      } catch (e) {
        if (mine === seq) emit({ phase: s.view ? "ready" : "error", notice: { tone: "error", text: `Could not load LLM routes: ${errText(e)}` } });
      }
    },
    applyView(view) { seq++; adopt(view); },
    async select(id) {
      if (s.pending) return false;
      const row = s.rows.find((r) => r.id === id);
      if (!row) { emit({ notice: { tone: "error", text: `Unknown route "${id}".` } }); return false; }
      if (row.selected) return true;
      if (!row.selectable) { emit({ notice: { tone: "error", text: row.reason ?? `Route "${id}" is not available.` } }); return false; }
      emit({ pending: id, notice: { tone: "info", text: `Switching to ${row.title}…` } });
      let ok = false;
      try {
        const settings = await d.setLlmRoute(id);
        ok = settings?.llmRoute === id;
        emit({ pending: undefined, notice: ok
          ? { tone: "ok", text: `Saved: ${row.title} is now the default LLM route for new videos.` }
          : { tone: "error", text: `Main process rejected "${id}" (no longer a registered route); settings unchanged.` } });
      } catch (e) {
        emit({ pending: undefined, notice: { tone: "error", text: `Saving failed: ${errText(e)}` } });
      }
      await ctl.refresh("after-select");
      return ok;
    },
  };
  return ctl;
}
