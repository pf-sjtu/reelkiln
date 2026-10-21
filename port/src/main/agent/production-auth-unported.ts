// PORT (docs/21 M2): the collaborators of the verbatim authorizeProductionCommand slice
// (production-auth.generated.ts) that are NOT ported, each reduced to the ORIGINAL's behaviour in
// the state the port is always in. Kept tiny and explicit so the verbatim slice stays byte-identical.
//
//   classifyProductionCommand (L22065) — only reached on the ENGINE-LESS branch (no VIDEOCLAW_ENGINE).
//     The port never runs agent sessions without an installed engine (AgentHost refuses to spawn), so
//     this returns a closed "error" classification: the branch then refuses, as the original does for
//     an unclassifiable command.
//   processStore (feature-flag store, L9150) — never configured in the port (it is fed by the gateway),
//     so the verbatim featureFlagDecision returns { enabled: true, state: "absent" } exactly like an
//     original install before its first flag refresh.
//   buildInputBoundExecutionPlan (L21301) — only for input-bound PAID mint_video. Not ported →
//     undefined, which makes the verbatim code refuse ("requires a verified app-owned launcher").
export const processStore: { decide(ns: string, key: string): unknown } | undefined = undefined;
export function classifyProductionCommand(_command: string, _cwd: string, _env: Record<string, string | undefined>) {
  return { protected: true, actions: [] as Array<{ jobId?: string }>, error: "Production is blocked because no installed engine can validate the current route. Run Setup, then retry." };
}
export function buildInputBoundExecutionPlan(_command: string, _verdict: unknown, _context: unknown): undefined { return undefined; }
