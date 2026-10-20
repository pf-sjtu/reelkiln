# How the user likes scripts written

**Read this BEFORE drafting a `script.json` and apply.** Re-read after every script edit cycle — patterns evolve.

This file = **distilled rules**, agent-curated.

For the **raw verbatim before/after** of every edit round (just "what did the user actually change"), see [EDIT_PAIRS.md](EDIT_PAIRS.md) — auto-regenerated, no commentary, scrollable in one place.

This file accumulates patterns the user has revealed through their edits to agent-authored scripts. Each pattern is grounded in a real round (date + job ID) so you can audit. **NEVER invent a pattern** — only add what the user has actually demonstrated through edits.

For provenance per video, see `agent/output/<job-id>/script_history/round_*.md` (raw snapshots) and `agent/output/<job-id>/script_history/EDIT_PAIRS.md` (per-job paired view). Cross-job index in [INDEX.md](INDEX.md).

---

## Hard rules (the user will reject scripts that violate these)

### 0. ALWAYS use contractions in dialogue. No one says "did not" — they say "didn't".
*Identified: 2026-05-20, Humeo Medicine & Healthcare job, round 2 (locked as a hard rule via user directive).*

> User feedback verbatim: *"the script should ALWAYS use contractings did not -> didn't NO ONE FUCKING SAYS DID NOT"*

❌ Agent draft (uncontracted): *"If you **are** a doctor … **you are** a brilliant clinician … and **it is** never just one hour … you **are** trying to be the strategist … and no discipline **is going to** fix it."*
✅ Required (contracted): *"If **you're** a doctor … **you're** a brilliant clinician … and **it's** never just one hour … **you're** trying to be the strategist … and no discipline **isn't going to** fix it."*

**Apply (universal — no exceptions unless explicitly emphatic):** every dialogue line MUST use contractions wherever they exist in spoken English. Default mappings:
- `did not` → `didn't`
- `do not` → `don't`
- `does not` → `doesn't`
- `is not` → `isn't`
- `are not` → `aren't`
- `was not` → `wasn't`
- `were not` → `weren't`
- `will not` → `won't`
- `would not` → `wouldn't`
- `could not` → `couldn't`
- `should not` → `shouldn't`
- `cannot` → `can't`
- `you are` → `you're`
- `it is` → `it's`
- `that is` → `that's`
- `there is` → `there's`
- `we are` → `we're`
- `they are` → `they're`
- `I am` → `I'm`
- `you have` → `you've`
- `we have` → `we've`
- `I have` → `I've`
- `they have` → `they've`
- `you will` → `you'll`
- `I will` → `I'll`
- `we will` → `we'll`
- `you would` → `you'd`
- `I would` → `I'd`
- `let us` → `let's`

**The ONLY exception** is when the uncontracted form is the emphatic move — pattern #4 (casual + emphatic). Example: *"do not wait"* (chunk-level emphatic imperative — keep uncontracted because the word is the emphasis). If you're not deliberately reaching for emphasis, contract. This subsumes the sub-pattern previously noted at #33 (contractions preferred for routine cadence) and promotes it from soft preference to hard rule.

**This rule also applies to dialogue handed to TTS / Seedance** — TTS reads contractions naturally; uncontracted forms in dialogue make Seedance and ElevenLabs deliver awkward stilted speech. The contracted form is BOTH more natural English AND better TTS output.

**If the agent writes "did not" / "do not" / "you are" / "it is" / "that is" anywhere in dialogue that isn't deliberately emphatic, the script is broken and must be fixed before seedance runs.**

---

### 1. Conversational sentences that flow when spoken aloud — NOT chopped-up phrases
*Identified: 2026-05-06, Teuwen job, round 2.*

> User feedback verbatim: *"It's called a trade-stack and it's made up of three simple moves that start thirty days before your launch. ^ this is a sentence that can be spoken and allows listeners enough time to actually understand whats being said"*

❌ My (agent) draft: *"It's called the trade-stack. Three moves, thirty days before launch. One: ..."*
✅ User's rewrite: *"It's called a trade-stack and it's made up of three simple moves that start thirty days before your launch."*

**Apply:** Write full sentences. Don't aggressively chop into telegraph-style fragments thinking it sounds punchy. The user's read of "punchy" is "spoken-natural at conversational pace," not "minimum syllables."

### 2. PRESERVE EVERY WORD VERBATIM when the user pastes back edits
*Identified: 2026-05-06, Teuwen job, round 2 (and codified as memory entry [feedback_preserve_user_prose_verbatim](../../../.claude/projects/-Users-chin-projects-sandbox/memory/feedback_preserve_user_prose_verbatim.md)).*

When the user edits prose and pastes it back, every word survives. ONLY edit at explicit `[markers]` they flagged. Do not silently rewrite for tightness, casing, punctuation, or "better voice." If their text exceeds a constraint (15s seedance ceiling, etc.), SPLIT into more chunks rather than compressing their words.

### 3. Address explicit `[bracket]` placeholders + answer parenthetical questions
*Identified: 2026-05-06, Teuwen job, round 2.*

The user uses two kinds of inline markers:
- `[fill this in]`, `[clear IVP language sentence]`, `[clear self evident reason]`, `[same thing here]` — fill these, in their conversational voice
- `[shall we get an email screenshot onscreen instead of saying this?]`, `[points down]` — direct questions/stage-directions to YOU. Answer the question (not in the script — in your reply), then act on the answer

---

## Voice register

### 4. Casual + emphatic over polished + neutral
*Examples from Teuwen edits:*
- *"do not wait"* (not "don't wait" — emphatic)
- *"You absolutely do not need a six-figure relaunch"* (intensifier)
- *"trust me — the trade asks for your label by name"* (familiar, conspiratorial)

### 5. Deliberate ellipsis = breathing pause
*Example:* *"You absolutely do not need a six-figure relaunch... Two of these trade-stack moves this quarter can flip the chain reset meeting."*

The `...` is a deliberate beat. Don't normalize to `.`. Treat as pacing instruction.

### 6. Asterisk emphasis = caption highlight
*Example:* *"...have the trade asking for your label *by name*."*

Map to a caption highlight at render time — italic text, momentary highlighted color, or pink-block in the caption track. Don't strip the asterisks from the dialogue.

### 7. Inconsistent numbering can be intentional
*Example:* *"First: ... Second: ... Three: ..."* (not "Third")

Don't silently normalize. Preserve verbatim. If clearly a typo, ask once.

---

## Structural preferences

### 8. Conditional / lower-bar hooks > absolute claims
*Identified: 2026-05-06, Teuwen job, hook edit.*

❌ My draft: *"Your imported wine brand slid twenty-one percent last year."* (absolute, only applies to one cohort)
✅ User's rewrite: *"If your imported wine brand slid more than fifteen percent last year, do not wait."* (conditional opening, lower threshold = wider IVP qualification)

**Apply:** When writing a hook that names a stat, prefer "If [condition with lowered bar]..." → "[urgent imperative]." Casts a wider IVP net + flatters the viewer who clears the bar.

### 9. Stripped name-drops over packed name-drops
*Identified: 2026-05-06, Teuwen job, chunk 3 round.*

The user explicitly removed publication name-drops *"— Wine Spectator, James Suckling —"* from a chunk after the first render's TTS mispronounced both. Now reads *"scores from the wine press published the same week"* — generic, doesn't risk the AI mispronouncing.

**Apply:** Be CAREFUL with proper-noun name-drops in dialogue. If Seedance/TTS is likely to mangle a brand name, use a generic descriptor instead AND let the visual overlay carry the brand name (where Remotion renders it correctly as text).

### 10. Anchor brand mentions to sentences that answer "why this trusted source"
*Identified: 2026-05-06, Teuwen job — the user kept "A company called Teuwen runs this exact playbook for Wines of Alsace, Cognac, and Champagne Laurent-Perrier" intact across edits.*

The brand mention works because each named client is real and verifiable + together they signal old-world wine PR credibility. Don't drop the proof clients when name-dropping the brand.

---

## Patterns from chung-press.com (round 1, 2026-05-06)

### 11. Bookend the brand — front-mention + closing-mention
*Identified: 2026-05-06, Chung & Press job, round 1.*

❌ My (agent) draft mentioned the brand only at the close (chunk 2 CTA).
✅ User's edit added a front-mention in chunk 0: *"This is how you can avoid losing your house when you file for bankruptcy and I only learned about it from a legal firm called Chung and Press:"* — then closed in chunk 5 with *"Get Chung and Press."*

**Apply:** When the brand is the punchline, mention it twice — early (as a credibility anchor framed as recommendation, not self-promo) AND at the close (as the action). The early mention works specifically because it's framed as *the speaker learning from the firm*, not as the speaker being the firm — keeps the credible-witness register intact.

### 12. IVP-naming via lived scenario, not demographics
*Identified: 2026-05-06, Chung & Press job, round 1.*

❌ My draft hooked with abstract framing: *"There's one rule that decides whether you keep your house."*
✅ User added an IVP-naming clause: *"If you've got creditor's lawyers breathing down your neck and you're not sure what will happen when you file for bankruptcy..."*

**Apply:** Name the IVP's exact lived emotional moment as a conditional. *"If you've got [specific situation the IVP would feel in their gut], …"* — visceral phrasing ("breathing down your neck") makes the listener self-identify and stops the scroll. Beats demographic framing every time.

### 13. Concrete future-state consequence over abstract jargon
*Identified: 2026-05-06, Chung & Press job, round 1.*

❌ My draft: *"that lien decides whether your title closes clean later."*
✅ User's rewrite: *"that lien could haunt you years down the line and stop you from ever selling or refinancing."*

**Apply:** Translate the technical mechanism into the concrete future state the IVP fears. "Title closes clean" is correct legalese but lands as abstract; "stop you from ever selling or refinancing" lands in the gut because that's the actual lived consequence. The job of the payoff line is to plant the bad future the corrective action prevents.

### 14. Italic asterisks = TTS stress markers (extends pattern #6)
*Identified: 2026-05-06, Chung & Press job, round 1.*

User used `*Wrong.*` (chunk 1 corrective pivot) and `*have to*` (chunk 2 urgency beat). Same convention as Teuwen's existing pattern #6 (asterisk emphasis = caption highlight) — but here the stress is also a delivery instruction for the seedance prompt: the avatar should hit those words harder.

**Apply:** When the user italicizes a word, do TWO things at render time:
1. Caption highlight (per pattern #6 — momentary color shift / italic in caption track)
2. Seedance delivery direction — quote the dialogue with explicit stress note: *"with sharp emphasis on 'Wrong'"* in the prompt body (do NOT include the asterisks in the quoted dialogue — Seedance might vocalize them).

### 15. Rhetorical-question hook → sharp single-word answer
*Identified: 2026-05-06, Chung & Press job, round 1.*

❌ My draft: *"You probably think Chapter 7 wipes everything you owe. It doesn't."* (statement → soft contradiction)
✅ User's rewrite: *"You've probably heard somewhere that Chapter 7 wipes away everything you owe, **right?** **Wrong.**"* (rhetorical question → single-word sharp pivot)

**Apply:** When pivoting away from a strawman, prefer the rhetorical question form (*"...right?"*) followed by a one-word italicized answer (*"Wrong."*). The question deputizes the listener; the one-word answer hits as a slap. Stronger structural beat than declarative statement → contradiction.

### 16. Permission-asking soft CTA over direct ask
*Identified: 2026-05-06, Chung & Press job, round 1.*

❌ My draft CTA: *"Questions about your house? Call Chung and Press."*
✅ User's rewrite: *"If you want more house-saving tips like this, Get an attorney who thinks in real estate. Get Chung and Press."*

**Apply:** Prefer conditional / permission-asking CTA shapes ("**If you want** [more X], [do Y]") over direct asks ("Call us"). Lower-pressure, frames the firm as ongoing source of value rather than transaction endpoint. Pairs well with credible-witness position.

### 17. Single corrective action > full mechanism listicle (when the strawman→subvert is doing the work)
*Identified: 2026-05-06, Chung & Press job, round 1.*

❌ My draft chunk 2 had four mechanism rules: pull title, file §522(f), time discharge, get attorney.
✅ User collapsed to one urgent rule: *"To avoid this, you have to act fast and file a section 522 F motion to avoid the lien."*

**Apply:** When the script's primary mechanism is wrong→stop→right (strawman + subvert), the BODY can carry just ONE corrective action — the listicle isn't required. Multiple rules dilute the urgency. Reserve the listicle mechanism for scripts where listicle IS the primary structural hook (i.e. *"3 things X"* hook archetype). Caveat: this is a contextual choice, not a universal rule — sometimes the user WILL want the listicle.

### 18. Spell out legal/technical codes phonetically for spoken delivery (extends pattern #9)
*Identified: 2026-05-06, Chung & Press job, round 1.*

❌ My draft used the symbol form: *"§522(f)"* (correct legalese, but TTS pronounces ambiguously and Scribe transcribes inconsistently)
✅ User's rewrite spelled it out as Seedance would say it: *"section 522 F"* (numerals + letter, no symbols).

**Apply:** Anything that's a citation, code section, statute, or technical reference should be written in the dialogue field exactly as you want the TTS to say it aloud. Spell out symbols ("section" not "§"), keep numerals or convert to words depending on what reads better as a spoken phrase. The visual citation (e.g. *"11 U.S.C. §522(f)"* in proper symbol form) goes in the Remotion overlay, not the dialogue. Same TTS-safety meta-rule as pattern #9 (stripped name-drops) — if the AI can't say it cleanly, write it differently OR move the formal version to the visual layer.

---

## Patterns from thejenmoff.com (round 1, 2026-05-11)

### 19. Pull the brand's actual marketing tagline into the CTA's permission-frame
*Identified: 2026-05-11, Jen Moff job, round 1.*

❌ My (agent) draft CTA: *"If your offsite is in the next quarter, get Jen Moff in the room."* (generic "book a speaker" frame using IVP-context language I invented)
✅ User's rewrite: *"If you want to learn more about making your story worth telling, get Jen Moff in the room."* — pulled the brand's actual website tagline ("Every team has a story. Let's make yours worth telling." from thejenmoff.com homepage) directly into the conditional clause.

**Apply:** Before drafting any CTA, READ the company's website context (`<job_dir>/website_context.txt`) and look for a marketing tagline, headline phrase, or signature line the brand already uses. Pull it verbatim — or near-verbatim — into the conditional clause of the permission-asking CTA (pattern #16 form): *"If you want [brand's own value-prop language], [brand-action]."* This anchors the brand-drop in the brand's lived language rather than in IVP-context language the agent invented. The viewer who recognizes the tagline registers it as "this person knows the brand"; the viewer who doesn't gets the value-prop in one beat anyway. Combines with #11 (bookend) + #16 (permission-asking) — same architecture, sharper anchor.

### 20. Register varies by position — credible-witness skews softer than peer
*Identified: 2026-05-11, Jen Moff job, round 1 — observed across multiple chunk edits, not yet promoted to a hard rule.*

The user's edit register on this job ran systematically SOFTER than on the Teuwen / Chung & Press jobs:
- ❌ My draft: *"do not wait to figure out why"* (Teuwen-emphatic urgency) → ✅ User: *"here's why getting to yes is simpler than you think..."* (curiosity-loop with breathing pause)
- ❌ My draft: *"The problem?"* (rhetorical-question pivot per pattern #15) → ✅ User: *"The thing is,"* (conversational softener)
- ❌ My draft: *"So next time? Read the room..."* (rhetorical-question per #15) → ✅ User: *"So next time you pitch, read the room..."* (conversational adverbial)
- ❌ My draft: paradox stated absolutely → ✅ User: *"sometimes,"* hedged before the paradox (consistent with #8)

**Apply (with caveat):** This is NOT a universal override of patterns #4 (casual + emphatic), #15 (rhetorical-question pivot), or the Teuwen-style "do not wait" emphatic. Those still apply for **peer-voice** and **mentor-direct** registers (Teuwen wine PR, Chung & Press bankruptcy law). For **credible-witness** position in softer / more inviting niches (leadership coaching, keynote speaker, mindfulness-adjacent), the user prefers conversational softeners over rhetorical-question pivots and curiosity-loops over urgent imperatives. **Treat vision.md's `position` field as the register selector**: if position = peer or mentor-direct, drafts can lean Teuwen-emphatic; if position = credible-witness in a soft niche, default to conversational + curiosity-loop. When in doubt, draft the softer version first — it's easier for the user to sharpen than to soften.

This pattern is FRESHLY OBSERVED across one job — flagged for further confirmation. If a future credible-witness job comes back with emphatic edits, this becomes register-context-dependent rather than position-dependent.

---

## Patterns from sanespaces.com (round 1+2, 2026-05-13)

### 21. Prescriptive mechanism > definitional mechanism
*Identified: 2026-05-13, Sane Spaces job, round 1.*

❌ My (agent) draft mechanism (definitional): *"Clear dumps the swirling mental clutter out of your head and onto paper. Frame is structure flexible enough to fit how your day actually moves. Finish is the muscle that closes the loop."*
✅ User's rewrite (prescriptive with concrete protocol steps): *"First, you Clear your head by dumping every worry and todo you have onto a piece of paper. Then you Frame by choosing 3 core tasks and setting 45 minute slots to get them done. And finally you Finish by closing all unrelated browser tabs and physically crossing off each one the moment it's complete."*

**Apply:** When the script's mechanism is a listicle of N steps the IVP can DO, write each pillar as **"First/Then/And finally, you [pillar-verb] by [concrete action with specific number/object]"** — not as a *definition* of what the pillar means. The viewer leaves with steps they can execute Monday morning, not metaphors they have to translate. Anchors:
- Use the imperative form ("you Clear your head by dumping…") not the descriptive form ("Clear is the act of dumping…").
- Pair each pillar verb with at least one **concrete object/number**: *45 minute slots*, *piece of paper*, *browser tabs*, *cross off each one*. Generic stand-ins like *"the structure"* / *"the loop"* fail the IVP-relativity test (viralizer §6.3).
- Use **First / Then / And finally** as the numerical scaffold — the asymmetric "And finally" works better than "Third" for landing the final beat with weight.

Combines with the named-framework reveal (the pillar names — *Clear*, *Frame*, *Finish* — keep the framework brand-anchored, the prescriptive expansion makes it stealable).

### 22. Move spoken proof beats into visual overlays when timing is tight
*Identified: 2026-05-13, Sane Spaces job, round 2 (after user attached a reference screenshot showing the original outlier's lower-third).*

❌ My (agent) round-1 draft burned a full 13s chunk on the Barkley proof beat (*"Why three? Because Russell Barkley — the most-cited ADHD researcher alive — says it isn't a disorder of knowing what to do…"*).
✅ User's round-2 instruction: keep the Barkley credit, but move it from a spoken proof beat to a **Remotion lower-third overlay on the opening chunk** — text *"Advice from the most-cited ADHD researcher alive"* fading in at ~0.4s and out by ~1.3s, mirroring the reference video's *"from a Harvard-trained career coach"* lower-third at the same beat.

**Apply:** When a proof beat (named expert, institution, study citation) adds credibility but extending the spoken script costs seconds or rhythm, **render it as a precisely-timed Remotion lower-third overlay on the opening 1–2 seconds** instead. The credibility lands sub-second, the spoken hook stays sharp, and the viewer reads it almost subliminally. Decision rule:
- **Spoken proof beat** works when the proof is the SIGNATURE element of the script — the reveal hangs on it (viralizer §6.4, MrBeast wow-factor research). Spend the seconds.
- **Visual proof overlay** works when the proof is a *credibility anchor* (the speaker's standing to talk) rather than the script's reveal. The reference video does this with *"from a Harvard-trained career coach"* on s0.

Implementation: per CLAUDE.md rule 21, this needs `<job_dir>/overlays.tsx` since the default style_directives lower-third doesn't support precisely-timed credibility text cards. Mirror the timing of the reference's overlay if it has one (extracted from the deep_analyze_video.py analysis — check `sentences[0].overlays` in the analysis JSON).

### 23. Widen the hook from narrow-IVP-specific to broader-emotional
*Identified: 2026-05-13, Sane Spaces job, round 1.*

❌ My (agent) draft hook (narrow IVP): *"If you've been *starting* the same task for three hours past midnight, this is for you."* (matches one very specific lived moment — only the ADHD-aware late-night-grinding founder self-identifies)
✅ User's rewrite (broader emotional state, closer to reference): *"If you've lost your motivation in your job, this is for you."* (matches the reference's actual hook *"If you've lost your motivation in your job, this video's for you"*; widens IVP qualification massively — anyone questioning their motivation self-identifies, then the script narrows back to ADHD/executive-function in the body)

**Apply (with caveat):** The viralizer §6 specificity ladder + IVP-relativity test pushes toward narrow-IVP-specific hooks, but those can over-narrow when the reference outlier's hook is itself broad. **When the reference's hook is broad-emotional ("lost your motivation", "feeling stuck", "tired of grinding"), match its breadth rather than trying to outdo it on specificity** — the viewer who self-identifies on the broad hook stays for the narrow body. Casting too narrow on the hook loses the wider top-of-funnel that made the reference work.

Heuristic: if the user widened the hook in edit, the agent's original draft was probably solving for specificity at the *wrong layer* — the specificity belongs in the BODY mechanism (where the user added concrete protocol steps per pattern #21), not the hook.

This is the inverse of pattern #12 (IVP-naming via lived scenario, not demographics). #12 says lived-scenario beats demographics. This pattern says the *lived scenario* itself should match the reference's BREADTH — not always the narrowest version. Both can be true: name a lived emotional state (#12), at the breadth the reference established (#23).

---

## Patterns from humeo.com (round 1, 2026-05-19)

### 32. Borrow the reference's own retention-engineering phrasing verbatim at the loop_widener position
*Identified: 2026-05-19, Humeo Medicine & Healthcare job, round 1.*

❌ My (agent) draft loop_widener (invented empirical claim): *"And the *third* is so overlooked, it is quietly costing you a full workday every week."* — specific stat at the loop_widener, agent-authored, defensible-but-invented.

✅ User's rewrite (verbatim borrow from the reference outlier itself): *"And the *third* is so overlooked, that once you hear it you'll wish that you learned about it years ago."* — pulled almost verbatim from magnus.aka s1 (the reference outlier we replicated, which said *"the third one is so overlooked that when you hear it, you'd wish that you learned about it years ago"*). The reference is the proven structure; its retention-engineering words are the proven words.

**Apply:** The loop_widener is a high-leverage retention beat — the line that holds the viewer through the body. When we're replicating a reference's diagnostic-listicle structure, the user prefers borrowing the reference's own loop_widener phrasing VERBATIM over inventing a different elaboration. The reference is the proof; its language is part of the proof. This generalizes PATTERN #30 (elaborated hold-the-reveal beats generic) — when the elaboration to use IS the one in the source video, borrow it wholesale rather than paraphrasing.

The discipline: when about to author a loop_widener for a script that adapts a specific reference outlier, READ the reference's analysis JSON at the loop_widener sentence (typically `s1` for diagnostic-listicle archetypes) and pull its phrasing verbatim. Edit only what the topic requires (the topic NOUN may change — "find your purpose" → "grow on Instagram") — but keep the retention-engineering verbs and structure ("you'll wish that you learned about it years ago", "the third is so overlooked", "so simple you'll wonder why nobody told you"). The user's read: invented stats and clever phrasings at this beat read as the agent flexing; the reference's words read as the speaker channeling a structure the viewer has already responded to.

This is the inverse of PATTERN #9 (stripped name-drops to avoid TTS mangling). #9 says don't import proper-noun trouble. #32 says DO import the reference's structural-retention language, because it is proven AND it is plain English that TTS handles cleanly. The signal is: borrow what works in the language layer the viewer cares about, strip what doesn't survive the medium.

### 33. Collapse contrastive wind-ups when the punchline is sharp enough alone
*Identified: 2026-05-19, Humeo Medicine & Healthcare job, round 1.*

❌ My (agent) draft (contrastive setup + punchline): *"That is not a content problem. That is a *staffing* problem."* — two-sentence structure where the negation sets up the punchline. The "X is not Y, it's Z" form.

✅ User's rewrite (collapsed): *"That's a *staffing* problem."* — single sharp punchline. The implicit contrast (content vs. staffing) lands on its own because *staffing* is the unexpected word in a content-marketing video.

**Apply:** The "X is not Y, it is Z" structure is a workhorse contrast scaffold — it works when Z is mild enough that Y needs to set it up. But when Z is itself a sharp, unexpected word in context (here: *staffing* in a video about content), the negation half is redundant — it just delays the punch. The user's read: the punchline carries its own contrast; the wind-up dilutes the surprise. Collapse to the punchline alone.

Heuristic for when to keep vs. collapse the contrastive wind-up:
- **Keep** the "not Y, it's Z" form when Z is a mild or general word that needs Y's contrast to register as a corrective ("it's not about effort, it's about timing").
- **Collapse** to Z alone when Z is itself a sharp, unexpected, or category-shifting word that lands on its own ("That's a *staffing* problem." — staffing is the surprise; no setup needed).

The asterisks pattern (#6 / #14 / #26) interacts with this: when the user italicizes a single word inside the punchline, that's a signal Z is already doing the work of the contrast. The italic = "this is the sharp word"; the structure becomes Z + italic instead of Y → not Y → Z.

This extends PATTERN #1 (conversational sentences that flow when spoken aloud) — the question for any line is "would the user say this out loud the way it reads?" Two-sentence contrastive wind-ups are an authoring habit, not a spoken habit. People speaking confidently land sharp punchlines without preamble. Match that.

Also revealed in this round (sub-patterns, not yet promoted):
- **Contractions preferred for routine cadence** even when the agent uses uncontracted for emphasis. *"can't keep it up"* not *"cannot keep it up"*; *"That's"* not *"That is"*; *"you've trained"* not *"you have trained"*. Pattern #4 (casual + emphatic) holds — but contractions are the default-casual; only switch to uncontracted when the WORD itself is the emphatic move (*"do not wait"*, *"do not lower the bar"*). For routine declarative beats, contractions every time.
- **Open-ended endings over closed-list endings.** User changed *"two takes, three trims, and a rewrite of the caption"* (closed prescriptive list) to *"two takes, three trims, and whatever else comes with it"* (open-ended). The closed list reads as agent demonstrating thoroughness; the open ending reads as a speaker conveying weariness with the unbounded cost. Generalizes: when listing the components of a frustrating thing, leave room for "...and whatever else" so the viewer can fill in their own variant.

---

---

## Patterns from resultsbydesigncoaching.com (round 1, 2026-05-13)

### 24. Third-person credible-witness handoff > first-person founder pitch (extends #11 to personal brands)
*Identified: 2026-05-13, Results By Design Coaching job, round 1.*

❌ My (agent) draft CTA: *"come find me. I'm Pratiti. Results By Design Coaching."* (first-person founder self-introduction)
✅ User's rewrite: *"go and find Pratiti at Results By Design Coaching."* (third-person referral — the speaker recommends the brand instead of being the brand)

The user rewrote the entire script voice from "Pratiti speaking" to "a peer-witness friend recommending Pratiti." Throughout:
- *"I've coached women..."* → *"I've seen women..."* (observational verb, not transactional)
- *"every woman I coach"* → *"every high performing woman I know"* (peer frame)
- *"come find me. I'm Pratiti."* → *"go and find Pratiti at..."* (third-person referral)

**Apply:** Even when the brand IS a single person (solo coach, solo consultant), the script's CTA can use the third-person credible-witness referral form *"go and find [Name] at [Brand]"* instead of the first-person *"I'm [Name]"* self-introduction. This is the chung-press pattern #11 (front-mention as credible witness) extended to *personal* brands — turn the speaker into a trusted friend recommending the founder, not the founder pitching themselves. Stronger trust frame, especially when the IVP is buyer-skeptical of self-promotion.

**Coherence requirement:** the entire script voice must support this. Verbs of observation (*"I've seen"*, *"I've watched"*, *"I know women who"*) — NOT verbs of provision (*"I coach"*, *"I help"*, *"I work with"*). Authority comes from witnessing, not from credentialing.

**Avatar implication (FLAG, not yet a rule):** when the script uses third-person founder referral, the avatar should EITHER (a) visually match the founder's archetype loosely enough to function as a peer ("a friend who is similar to Pratiti") OR (b) deliberately differ from the founder ("a friend who is clearly someone other than Pratiti"). Avoid the ambiguous middle — where viewers might confuse the speaker for the founder. The user did not push back on the existing matching-archetype avatar for this job, so option (a) is acceptable until proven otherwise.

### 25. British spelling preserved verbatim
*Identified: 2026-05-13, Results By Design Coaching job, round 1.*

User used *"prioritises"* (British) in their edit. Preserve verbatim — do not normalize to American *"prioritizes"*.

**Apply:** Even when the avatar's accent is locked to American (this job's `seedance_anchor_description`), the user may use British spelling in the dialogue field. The dialogue field is what feeds captions; the seedance line gets the same string but Seedance pronounces from sound, not spelling. Preserve British spelling in the dialogue verbatim per the existing verbatim-preservation rule (#2 / memory `feedback_preserve_user_prose_verbatim`). The audio comes out American because the accent anchor wins; the caption shows British spelling because the user wrote it that way. Both can coexist.

### 26. Italic asterisks inside the CTA dialogue (extends #6 / #14)
*Identified: 2026-05-13, Results By Design Coaching job, round 1.*

User wrote *"You don't \*need\* to do more."* in chunk 6 — italic asterisks on a single stress word, INSIDE the CTA line, not in earlier mechanism beats. This extends patterns #6 (asterisk = caption highlight) and #14 (asterisk = TTS stress) to the CTA position specifically.

**Apply:** In CTAs, the user may pick one word to italicize — usually a negation or qualifier (*need*, *don't*, *only*, *just*). Render at both layers per pattern #14: (1) caption highlight (italic + bold + warm color), (2) seedance prompt note *"with sharp emphasis on '[word]' — slight pause around the word, do NOT vocalize the asterisks themselves"*. The CTA italic does double duty — emphasizes the negation that makes the permission-frame work, and signals the speaker's relational tone (firm but warm).

---

## Patterns from dream2inspirellc.com (round 3, 2026-05-13)

### 27. First-person testimony is permitted (CLAUDE.md rule 11 ban removed 2026-05-13)
*Identified: 2026-05-13, Dream2Inspire job, round 3.*

❌ My (agent) round-2 draft routed around any "I learned" / "they taught me" phrasing because CLAUDE.md rule 11 banned first-person testimony for synthetic avatars (the "avatar lacks authentic peer history" theory).

✅ User's round-3 edit included verbatim *"These guys here were the ones that really taught me the cost of silence"* — explicit first-person testimony. When surfaced as a rule-11 flag, the user said *"nah I think we should remove that rule."* CLAUDE.md rule 11 was updated in the same turn.

**Apply:** Treat the avatar as a real coach with a coherent professional past. First-person testimony ("I learned this the hard way", "these guys here taught me", "the way I figured this out…") is now load-bearing for credibility, especially in the credible-witness / mentor positions. The previous theory (synthetic avatar = no authentic experience) over-indexed on safety; the realism of a coach speaking from their own teaching career was worth more than the synthetic-history caveat. Still avoid: claims that contradict the avatar's visible persona (e.g. a 25-year-old saying "in my 30 years of doing this"), and avoid named-event testimony that's verifiably false ("I worked at Goldman in 2008"). The avatar can have a *plausible coherent past* — just not a *named verifiable past*.

### 28. Match the reference's production REGISTER when casting the avatar — stage register requires a stage shot
*Identified: 2026-05-13, Dream2Inspire job, round 3.*

❌ My round-3 draft kept the seated home-studio `front` variant even after swapping reference from sabastianenges (intimate TikTok talking-head) to Ryan Leak (motivational speaker on a conference stage, audience visible, dramatic lighting, swelling synth).

✅ User's direction: *"this guy is like a motivational speaker type so our video needs to reflect that we should have our avatar up on a stage shot from a distance."* New variant `stage_speaker` minted via `--add-shot`. Every chunk's `image_ref` updated.

**Apply:** Read the reference's production-design register BEFORE locking the avatar variant. Production register checklist:
- **Intimate handheld TikTok** (sabastianenges, juliastarrcoaching): seated home-studio `front`, 3/4 angle to off-camera interviewer, soft natural daylight
- **Motivational-speaker stage** (Ryan Leak): standing on stage, ~12ft pullback, audience silhouettes in foreground, dramatic accent lighting, direct-to-camera or audience-eye-contact
- **Walk-and-talk B-roll** (lifestyle creators): walking with camera tracking, environmental context
- **Authority desk** (financial / legal / clinical): seated at a credible workspace, more formal lighting

If the reference's register doesn't match the avatar's `front` variant, mint a register-matched variant via `generate_avatar.py --add-shot <variant_name>` BEFORE writing seedance prompts. The variant's setting becomes the chunk's setting. Check the reference's `video_level.production_overall` in the analysis JSON — `lighting`, `background`, `camera_distance_default`, `camera_motion_overall` all signal the register.

### 29. When the reference's audio bed is load-bearing, RIP IT
*Identified: 2026-05-13, Dream2Inspire job, round 3.*

❌ My drafts kept defaulting to "no music" per CLAUDE.md rule 24 (score.py de-prioritized) even when the reference has a load-bearing music bed.

✅ User's direction: *"we should use our tool to rip the audio because it's good."* Ran `audio_bed.py` to MVSep-separate vocals from the reference, producing `<job_dir>/audio/bed.wav` — vocal-stripped synth/instrumental that we layer under our seedance avatar speech.

**Apply:** When the reference video's `video_level.production_overall.music_overall` describes a music bed AND `audio_bed_dynamics_overall` describes the bed as load-bearing (swelling at structural pivots, contemplative drone, etc.), default to ripping it via `audio_bed.py --job <id>` and layering under the seedance avatar. CLAUDE.md rule 24 ("score.py de-prioritized") is about *generating* a new bed from scratch — NOT about ripping a reference's existing bed when the user wants it. Tag in `adaptation_notes` that the bed is ripped (not licensed for commercial shipping per audio_bed.py docstring; user has made the explicit creative call). Mix recipe (JC, #321, supersedes the original swell): one steady ripped bed about 15 dB under the voice for the whole video — no swells at the pivots, never ducked, cut or muted under a line.

---

## Patterns from jennyevans.com (round 1, 2026-05-15)

### 30. Elaborated hold-the-reveal phrase > generic "here is the thing"
*Identified: 2026-05-15, Jenny Evans job, round 1.*

❌ My (agent) draft loop widener: *"And here is the thing —"* (generic, the bare PATTERN #6-style hold-the-reveal formula)
✅ User's rewrite: *"And this rule is so overlooked that when you hear it youll wish you learned about it years ago:"* (elaborated hold-the-reveal that opens a tighter open-loop — promises a specific emotional outcome on hearing the next sentence)

**Apply:** When the script needs a loop-widener pivot between a casual anecdote and the mechanism reveal, the bare *"here's the thing"* formula is too generic — it tells the viewer to pay attention without giving them a reason to. The elaborated form **names what they'll feel when they hear what's next** (*"so overlooked that when you hear it you'll wish you learned about it years ago"* / *"so simple you'll wonder why nobody told you"* / *"so counterintuitive that you'll forget it three times before it sticks"*). The viewer commits to the next sentence because the prophecy of their reaction is already on the line. Combines with PATTERN #6's loop-widener structural function — elevate the EXECUTION of that function, don't just check the box. This is the verbal equivalent of the reference video's s6 *"But here's the thing"* — done with more specificity for thesis-mechanism reveals where the payoff is high enough to justify the build.

### 31. Accessible plural language ("those chemicals") > specific clinical terms ("cortisol") at thesis-statement moments
*Identified: 2026-05-15, Jenny Evans job, round 1.*

❌ My (agent) draft thesis statement: *"And no mindset, no matter how positive, can override cortisol."* (specific clinical term — assumes the IVP has internalized the technical vocabulary)
✅ User's rewrite: *"And no mindset, no matter how positive, can override those chemicals."* (plural-accessible — keeps the IVP who hasn't internalized the vocabulary inside the tent)

**Apply:** At thesis-statement moments where the mechanism is named in plain language (chunks 4 / mechanism reveal / payoff lines), default to the **accessible plural** over the technical singular. *"Those chemicals"* > *"cortisol"*. *"Those signals"* > *"interoceptive afferent input"*. *"Those gut bacteria"* > *"the gut microbiome"*. The specific technical term can still land **once** — at the proof beat or in a caption overlay (PATTERN #22) where it acts as a credibility anchor — but the thesis statement itself uses the IVP's everyday register. The thesis is the line the viewer **takes with them**; if they can't say it back to themselves in plain language, it doesn't stick. The technical name is the citation; the thesis is the story.

Heuristic: when a thesis-statement uses a noun the IVP would NOT spontaneously say at a dinner party, swap to the accessible plural. The proof beat earlier in the script can carry the technical term as authority signal.

This combines with PATTERN #9 (stripped name-drops over packed name-drops) — same meta-rule: every noun in dialogue earns its place at the LANGUAGE-REGISTER level the IVP actually lives in, not the level the agent inherited from research.

---

## What changes I should still expect

The user has not explicitly opined on (these are NOT yet patterns):
- CTA forms (kept all 8 viralizer §8 forms in play)
- Hook archetype preferences (kept D Counter-Establishment + E Walkthrough)
- Mechanism preferences (kept "named framework + 2 stealable scripts + reveal" without comment)
- WPM target (let densify default to 200 WPM range without complaint)

---

## Patterns from josephchin (reels batch 1+2, locked 2026-06-01)

Joseph's reels are a SEPARATE pipeline from the coach/avatar pipeline above. He records his own
audio, runs his own A-roll lipsync, owns the brand. The patterns below are Joseph-specific —
when drafting a coach reel, ignore this section; when drafting a Joseph reel, this is law.

### J1. **Documentary register, NEVER prescription (Hormozi rule).**
"This is what I did" beats "this is what you should do." Every script. The reel IS a diary entry.
Joseph is the subject; the viewer is welcome to take what resonates.

- **Banned openers:** "you need to", "stop doing X", "the truth is", "most people don't realize",
  "here's what nobody tells you" (gatekeepy), "the secret".
- **Welcomed openers:** "my", "I", "I learned", "I tried", "what changed for me", "I used to…",
  "I'm new to…", "quick confession", "I noticed…"
- **Identity claim + receipt beats expertise claim.** "I'm new to note-taking but here's what I
  noticed" lands; "here's the framework for note-taking" doesn't.
- **Endorser stance, not founder stance** — Joseph speaks as a peer who's a few steps ahead,
  even when he's the founder of the thing being recommended. Already locked in
  `feedback_endorser_not_brand_voice.md`; documentary rule reinforces it.

### J2. **The "learning out loud" closer (Joseph's locked outro shape).**
The default close for any documentary reel: log-for-myself + welcome-to-follow-along. NO
prescription, NO call to action that sells anything. Joseph's own words for the close:

> "This is what I'm doing right now. If it helps you, that's great — it's just another way to
> look at things. Follow along if you wanna learn with me. I'll keep sharing these insights
> both as a log of what I'm thinking AND in case it helps someone else."

Pick variants of that for closes. The structural elements: (1) acknowledge it's just his
current state, (2) optional-help framing, (3) follow-along invitation as a learning peer.
NEVER "save this map" / "comment X for the repo" / "drop a like if you found this useful" as
the default close — those work only when the reel has earned a specific verbal CTA
(e.g. "Delete every MCP" earned a `BUILDER → repo` CTA via the contrarian setup).

### J3. **Don't force anchor metaphors across a batch.**
"RAM stick for the brain" landed because Joseph already used the phrase in conversation. Don't
templatize that pattern — don't make every reel hang on a tech-metaphor-for-cognition. Use a
metaphor only where it's already in his head when he speaks. Otherwise, plain language.

### J4. **Books / authors / people he respects — fair game on camera.**
Joseph confirmed his reading-list is fair game for citation. Names that can appear in scripts
or on-screen without further clearance:

> Alex Hormozi, Roberto P. Nickson (@rpn), Daniel Kahneman (Thinking, Fast and Slow),
> Carnegie (How to Win Friends), Mark Manson (Subtle Art), C.S. Lewis (Mere Christianity),
> Robert Cialdini (Influence), Alan Watts, Matt Mochary, Josh Waitzkin (Art of Learning),
> Phil Jones (Exactly What to Say), Nassim Taleb (Antifragile / Black Swan / Skin in the Game),
> Naval Ravikant, Charlie Munger, Roger Fisher (Getting to Yes), Chris Voss (Never Split the
> Difference), Eckhart Tolle (Power of Now), Ryan Holiday / general Stoics, Michael Masterson
> (Ready Fire Aim), Brian Tracy (Eat That Frog), Nir Eyal (Indistractable), Yuval Harari
> (Sapiens), Robert Greene (48 Laws of Power), Charles Duhigg (Power of Habit), James Clear
> (Atomic Habits), Annie Duke (Thinking in Bets).

Don't force these into every reel. Cite where the take genuinely came from one of them.

### J5. **Don't name conversations as sources without consent.**
Joseph won't reveal what cofounder / friend / family said as a content source without explicit
clearance. Stick to: his own thoughts, public books/posts above, agent scouting (from
WebSearch). When a seed wants to attribute an idea to "a conversation I had", treat that
attribution as off-limits unless Joseph explicitly OKs it for that specific script.

### J6. **Idea-sourcing reality (his correction, locked):**
Joseph's IDEAS come from his own thoughts, not from scrolling. What he uses agent-scouts
for is the SHAPE / format — finding a viral reel structure to give the idea a vehicle. So
any "how I get ideas" reel should distinguish: ideas live in his head; outlier-research
gives them a shape.

### J7. **Don't talk about Meridian until it exists.**
Meridian (the creator-roster dataset for v2 outlier work) is in design, not built. Don't
reference it by name in any reel until there's something to point at. Same for any
unshipped product the new co is working on — wait until there's a number / artifact
worth naming.

### J8. **"I'm new to X" — finite resource. Don't lean on it every script.**
The low-status fresh-eyes identity claim is powerful but stops being honest if every reel
opens with it. Joseph's actual stance varies by topic — "new to note-taking" is true; "new
to shipping product" is not (250K users on DocuAsk). Match the identity claim to the actual
state on a per-script basis. Rule of thumb: at most 1 in 3 reels in a batch opens with
"I'm new to X."

### J10. **"My previous company" beats "DocuAsk" (locked 2026-06-01).**
When Joseph cites his 250K-user receipt, ALWAYS phrase it as "my previous company" — never
"DocuAsk." Two reasons:
1. Nobody outside builder-world knows what DocuAsk is; the name burns 3 seconds on no-context
2. "My previous company hit 250K" is a subtle flex AND immediately gives the viewer the context
   they need (this person built something, has now moved on, is talking from experience)

Apply across all reels that reference the receipt. Same logic applies to any future unshipped
work: don't name it until it has its own number to drop.

### J11. **Don't pitch seeds that aren't true.**
The single-hook standalones I proposed in batch-2 round 2 (Drawing-is-the-new-prompt,
5-min-iPad-ritual, Reading-list, Title-first) were killed because Joseph doesn't actually do
those things. Documentary register requires real receipts — pitching what looks viral but
isn't true to Joseph's actual practice is the deepest possible voice violation.

Future scouts MUST distinguish between (a) seeds where Joseph has confirmed receipts and
(b) seeds where the scout extrapolated from a viral pattern. Pitch (a). Surface (b) as
"Joseph, do you actually do X?" — never lock it as a seed.

### J12. **Joseph's "I figured something out" opener (locked 2026-06-01).**
The documentary-friendliest contrarian opener Joseph likes:

> "If you've felt [specific pain], I figured something out — and it's not [the hyped thing
> everyone else points at]."

Used in #09 (Tailscale). Compresses into: name the specific pain (viewer self-identifies),
admit you figured it out (peer not guru), name the misframe (the hyped thing isn't the real
unlock). NO "the truth is" / "stop doing X" — pure documentary.

### J14. **YOU-leading hooks beat I-leading hooks (locked 2026-06-01).**
Joseph rewrote nearly every batch-2 hook to address the viewer's situation first, not his own.
Agent draft "I have four email addresses" → Joseph edit "I'm pretty sure you have at least 2
email addresses." Agent draft "If you've felt stuck bouncing between machines" → Joseph edit
"If some video got you to impulse buy a Mac mini." The curiosity gap is created by NAMING
the viewer's situation, not by leading with the agent's.

**Default move:** open with "If you…" / "I'm pretty sure you…" / "You're [doing specific
thing]…". The viewer self-identifies in the first 2 seconds. Then Joseph enters as the operator
who's been there. Joseph's "I" can wait until line 2 — almost never opens the script.

### J15. **Specific-behavior IVP > generic-pain IVP.**
"If you've felt stuck bouncing between your Mac mini and your laptop" is generic. Joseph's
rewrite "If some video got you to impulse buy a Mac mini and you just don't know what you're
gonna use it for now" is SPECIFIC. Names a literal recent behavior the viewer just performed.
Stronger self-identification → stronger watch-through.

When proposing an IVP-naming hook: name a specific behavior, purchase, frustration, or
confusion the viewer just did/felt — NOT a generic feeling.

### J16. **Conversational softeners are voice-defining.**
Joseph's edits inserted "honestly," "kinda," "I'm starting to think," "a bit of," "anyway,"
"peace!" liberally. These aren't filler — they're calibration. They mark Joseph as a peer
thinking out loud, not an authority delivering a take.

**Default vocabulary for the agent to use:**
- "honestly" (one per script max — it loses meaning past one)
- "kinda" / "kinda like"
- "a bit of" (softens claims — "a bit of imposter syndrome" beats "imposter syndrome")
- "I'm starting to think" (replaces "I think" when the claim is tentative)
- "anyway" (transition into the close)
- "peace!" (sign-off — Joseph uses this verbatim; use sparingly so it stays his)

### J17. **"Comment if you want a deep dive" CTAs are on-brand when offering more depth.**
Earlier rule (J2) said no "drop a like / comment X for repo" defaults. Joseph's edits revealed
a permitted CTA shape: an offer to go deeper.

- ✅ "Drop a comment if you wanna see a full tutorial on the scripts I'm working on" (offering
   real depth, conditional on interest)
- ✅ "Let me know if you guys want a deep dive on my full video creation setup!"
- ✅ "Comment if you want a full walkthrough on how to set this up"
- ❌ "Drop a like if you found this useful" (no offer, pure engagement-bait)
- ❌ "Comment 'AGENT' for my repo" (transactional, comment-farm-style)

**Heuristic:** the CTA is offering to PRODUCE more content, not transacting a token for a
freebie. The "learning out loud" close (J2) is still the default; the deep-dive comment-CTA is
a permitted variant when the script genuinely teases something Joseph could share more about.

### J18. **Cross-script narrative threading is desired.**
Joseph's edit on script 11 mentions the patterns file from script 12 ("a simple recap of all
my previous scripts which makes sure the AI outputs sound more and more like me"). He WANTS
scripts to reference each other where natural — building a connected content universe, not
discrete one-off reels.

**Default move:** when one script's mechanism is referenced in another, name it. "I built a
patterns file for this — I'll cover that in another reel" beats "I have a system" (vague).

### J19. **"Ready for something embarrassing" — damaging-admission opener archetype.**
Joseph's edit to script 08 opener: "Ready for something embarrassing? I'm 30 and I only just
started taking notes seriously about four months ago. Before this I was just raw dogging all
my thoughts." The "ready for something embarrassing" pattern is a dopamine-trigger — people
watch because someone is about to admit something low-status.

Use sparingly across a batch (1 in 4-5 scripts max — loses power if repeated). Pair with a
GENUINE embarrassing thing, not a humblebrag. The "raw dogging all my thoughts" line is what
makes it work — specific enough to be real.

### J20. **Anti-engagement-farm callouts are credibility moves (use sparingly).**
Joseph's edit to script 12: "you don't have to comment 'AI' to learn how to do it" — explicitly
distances from a saturated comment-bait pattern (commenting 'AI' for a tool/repo is the canonical
2026 engagement-farm move). Naming and rejecting this signals Joseph is NOT one of those guys.

Use sparingly (once per batch max). The move only lands when there's a recognizable pattern
to reject — don't manufacture an enemy.

### J21. **Reorganization-as-dopamine — the satisfying-reframe narrative shape.**
Joseph explicitly named this from his edit: "There's something like that gives you a dopamine
about, like, reorganization of something or resimplification of something that you kind of
knew already but haven't heard said in exactly those way."

Apply to any script where the payoff is a reframe of a familiar idea. Examples Joseph delivered
in his edits:
- "Imposter syndrome doesn't go away — but it splits into two flavors and one is useful"
   (reframe of familiar idea)
- "Note-taking isn't about the writing — it's about freeing up working memory" (resimplification)
- "The Mac mini isn't the unlock — the network is" (reorganization)

The viewer's reward is the "oh, that's a cleaner way to think about it" feeling. The script
shouldn't TELL THEM SOMETHING NEW — it should re-pattern something they already feel.

### J22. **End on warmth, not on insight.**
Joseph's edits consistently pulled closes from punchline-end to warm-exit. The insight delivers
in the middle; the close is "I hope this helps" / "Peace!" / "anyway" / "give it a go."

**Avoid:** ending on the punchline as the close ("…and that's the unlock"). The line that lands
the insight should be in the body, not the close. The close is goodbye, not climax.

### J23. **Joseph's voice quirks (typos, contractions, abbreviations) are voice — don't fix them.**
Joseph's edits include: "tutourials" (misspelled), "raw dogging" (vernacular), no comma after
"And honestly," "the the agent" (doubled article). These are NOT typos to correct in the agent
re-draft — they are voice. Preserve verbatim per CLAUDE.md memory rule
`preserve-user-prose-verbatim`. The agent does NOT introduce typos in its own draft, but does
not silently fix Joseph's.

### J13. **Complexity beats age as the trigger for change.**
When Joseph explains why X works for him NOW that didn't matter before, frame it as
"I'm dealing with more complexity now" — NEVER "I'm older now" or "I couldn't do this when
I was younger." The complexity framing reads as growth-and-scaling; the age framing reads
as decline-and-cope.

Example: note-taking reel — "the unlock wasn't a system, it was admitting I'm now juggling
more complexity than my head can hold" beats "I couldn't hold it all in my head anymore"
(which implies age-related decline).

### J9. **Multi-hook experiments are opt-in (locked 2026-06-01).**
Joseph wants to A/B different hooks against the same body to test which lands. Protocol:
- One script in `drafting/NN_slug.md` carries the SAME log line + body
- Adds a "Hook variants" section with 3 candidate openers
- Records the body once + each hook separately
- A-roll pipeline produces 3 reel files (`hook_a`, `hook_b`, `hook_c`)
- All 3 ship within ~24h to the same platform
- Performance feeds back into the patterns corpus — which hook archetype Joseph's audience
  actually rewards

Not every script gets this treatment — Joseph opts in per script. Default is single-hook.

---

## How to update this file

After each round of script edits in any job, **if the user revealed a new pattern**:
1. Add a numbered section with the pattern + grounding example.
2. Add an entry to [INDEX.md](INDEX.md) pointing to the round.
3. If a pattern is confirmed across multiple jobs, promote it to "Hard rules" at the top.

If a previously-recorded pattern is contradicted by a later edit, EDIT the existing pattern with a "Updated [date]:" note rather than deleting — the contradiction is itself signal.
