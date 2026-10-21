// PORT-NEW (docs/24 A): re-evaluate a collected UI-e2e question-card verdict with the current DECLINE_RE.
//   node port/tools/ui-e2e/reverdict.mjs <NAME>   (reads/writes artifacts/phase-b-m6/<NAME>-*)
import { readFileSync, writeFileSync } from "node:fs";
import { answerDeclined, DECLINE_RE } from "./plan.mjs";
const A = new URL("../../../artifacts/phase-b-m6/", import.meta.url).pathname; const N = process.argv[2] ?? "qcardQ1";
const s = JSON.parse(readFileSync(A + `${N}-ui-e2e-summary.json`, "utf8"));
const card = s.questionCards[0];
const ev = readFileSync(A + `${N}-events.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l))
  .filter((e) => e.ch === "session:event" && e.payload.sessionId === s.sessionId && Date.parse(e.t) >= card.atMs - 2000).map((e) => ({ t: e.t, ...e.payload.event }));
const texts = ev.filter((e) => e.kind === "thinking" || e.kind === "assistant_text").map((e) => String(e.text));
const old = /declin|denied by user|user (?:has )?(?:rejected|dismissed)|拒绝|没有回答|未回答/i;
const oldHit = texts.map((t) => { const m = t.match(old); return m ? t.slice(Math.max(0, m.index - 60), m.index + 60) : null; }).filter(Boolean);
const v = { ...card.verdict, declinedMentioned: answerDeclined(texts) };
v.accepted = v.permissionResolved && !!v.toolEnd && v.toolEnd.isError === false && !v.declinedMentioned && v.mainDecision?.behavior === "allow" && v.mainDecision?.answers > 0;
const out = { note: `docs/24 (A): post-hoc re-evaluation of ${N}'s taste_question_card verdict with the narrowed refusal regex (port/tools/ui-e2e/plan.mjs DECLINE_RE). The in-run regex may have matched non-refusal text (see oldRegexMatchedContext).`, oldRegex: String(old), oldRegexMatchedContext: oldHit, newRegex: String(DECLINE_RE), inRunVerdict: card.verdict, reVerdict: v, assistantTextAfter: ev.filter((e) => e.kind === "assistant_text").map((e) => e.text) };
writeFileSync(A + `${N}-answer-reverdict.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ oldHit, accepted: v.accepted, declined: v.declinedMentioned }, null, 1));
