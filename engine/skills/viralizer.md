# Viralizer — script punch-up & humanizer pass

After you've drafted `script.json`, before you spend Seedance credits, run
this pass. It is the cheapest quality lever in the pipeline.

This skill assumes you have already written `<job_dir>/vision.md` (CLAUDE.md
rule 11) — IVP, core drive, position, journey arc, and lore positioning.
**Every craft rule below is verifying that the script delivers on those
strategy fields.** If vision.md is missing them, fail fast and write them
first; don't try to punch up a script with no upstream strategy.

The skill is the brainchild of three things:

1. The **humanizer** taxonomy from softaworks/agent-toolkit — what makes text
   sound like an actual human wrote it (vendored at
   `agent/skills/_references/softaworks-agent-toolkit/skills/humanizer/SKILL.md`).
2. The **viral-retention** patterns extracted from ~370 of the highest-
   outlier-score-and-views videos in our DB across all 7 niches we ship to.
   Raw notes: `agent/skills/viralizer_research/`.
3. **Minho's Ideal Viewer Persona framework** — the upstream strategy layer
   that produces the hooks the rest of the research reverse-engineers
   (`agent/skills/viralizer_research/_pedagogy/minho_ideal_viewer_persona.md`).

The rules trade *politeness* for *grip*. They will sometimes feel pushy. Use
judgment — a calm purpose-coaching reel doesn't need a fitness-bro hype
reel's cadence — but never skip the pass entirely.

---

## 0. Prerequisites — vision.md fail-fast

Before you read any further, open `<job_dir>/vision.md` and verify these
**eight** fields exist and are specific. If any is missing or fluffy, STOP
and fill it in (CLAUDE.md rule 11 has the full spec).

- [ ] **Log Line.** ONE sentence, 20-30 words, with the 4-beat arc:
      **problem → attempted solution → issue with that attempt → surprising-
      yet-inevitable fix**. The middle two slots are load-bearing — they
      make the fix feel *earned*. Every other field below must serve this
      line, and every script-craft rule that follows verifies it.
      *"Luxury craft pros softening on price to win wealthy clients silently
      fail the buyer's 5-second cost-signal trust check — the cue is to
      never apologize for cost."* passes.
      *"Selling to the wealthy requires understanding the wealthy"* fails
      (no 4-beat arc; it's a tagline, not a log line).
- [ ] **IVP.** ONE named character — age, life-stage, current emotional
      moment. *"Professionals 25-40"* fails. *"35-year-old engineering
      manager passed over for promotion the second time, lying in bed at
      11pm wondering if her career is going anywhere"* passes.
- [ ] **Core drive.** The deep human want under the surface topic.
      Survival / money / reproduction / status / approval (Minho's list).
      The hook fires at the drive; the surface tactic is the mechanism.
- [ ] **Position.** Mentor / credible-witness only. The avatar is a
      third-party expert recommending the company, not the founder, not a
      peer with personal history.
- [ ] **Journey arc.** One sentence: where the IVP is right now → where the
      video takes them by the end. The whole script is a bridge between
      these two states.
- [ ] **Lore positioning.** One sentence on what the company *stands for*,
      not what it does. This is the implicit thesis the script carries
      before it ever says the brand name.
- [ ] **Signature element.** ONE specific, disproportionately-researched
      detail this script will land — a named study with a real number, a
      verbatim quote with the actual dollar figure, a real protocol step a
      generic shop wouldn't dig up. If you can't name it before drafting,
      the script will land generic and the punch-up can't save it.
- [ ] **Mechanism.** The structural through-line that pulls viewers to the
      end (closing countdown / listicle of N / wrong→stop→right /
      transformation / open-loop cascade). Often implied by the hook
      archetype (§2.5), but the body has to execute it — name it
      explicitly so the punch-up can verify it.

If all eight are solid, you have a strategy. Now we craft.

---

## 1. The North Star

Five things have to be true of every punched-up script before it ships:

1. **The IVP feels seen by sentence 3.** A stranger reads/watches the open
   and thinks "this is for me, specifically." Minho's threshold: the
   viewer answers "is this for me, will it pay off?" within 5-10 seconds,
   consciously or subconsciously. If a reader matching the IVP can't
   answer in that window, the hook missed.
2. **The first 5 seconds pass the AGIQ test.** Read the open as the most-
   tired version of the IVP — end of a long day, scrolling on the couch.
   The viewer isn't dumb; they're depleted. If a phrase requires them to
   stop and parse, it's friction. Hyper-simplicity wins not because the
   audience is simple but because their attention is.
3. **Every 3-5 seconds there is a pattern-interrupt OR a fresh open loop.**
   Re-hook density is what holds attention past the open.
4. **The payoff lands** with specificity (a script, a number, a quoted
   line, a named technique) — not abstractly.
5. **The brand is delivered as positioning, not as a logo.** The viewer can
   describe in one sentence what the company *stands for* after watching.

If any of those five is missing, you haven't punched up the script yet.

---

## 2. The hook (first 5 seconds)

### 2.1. Anchor the topic in sentence 1 — and anchor it to the IVP

The most-violated rule. A hook full of pronouns with no antecedents leaves
the viewer searching for a referent they don't have. *"Most life coaches
skip this — too nerdy. UCL settled it in 2010."* — skip what? settled what?

Open with something that names the topic AND positions the viewer inside
it. The reference outlier from drchelsey_parenting is the gold standard:

> *"Your **nine-year-old daughter's confidence window** closes in three
> years."*

Topic named in word 4. The viewer (a parent of a tween daughter) is
*positioned inside the topic* by word 4. They are the IVP.

**Operating rule:** every pronoun (*this, it, that, those, yours, mine,
them*) must have a referent named within the same sentence OR the
immediately preceding one.

### 2.2. The 5-second perceived-value test

After you write your hook, pause-test it at 5 seconds. Could a stranger
matching your IVP answer "what is this video about, and why should I
care?" in one phrase? If not, the hook is leading with mechanism instead
of value.

### 2.3. Emotion before information (the Yerba Mate rule)

Same content, two registers. Both true.

- **Mechanism-first (scrolled):** *"120mg of caffeine, here's how you match
  the L-theanine to caffeine ratio from 120 to 240."*
- **Emotion-first (hits):** *"This is the magic potion I drink every
  morning to run my business and post a video every single day."*

Lead with the EMOTIONAL OUTCOME — the deep drive your IVP is already
chasing — and use the mechanism (the surface tactic) to deliver it. The
deep drive is in vision.md as the core-drive field. Aim the hook at it.

### 2.4. Two register checks (Minho's AGIQ + Jenny's readability)

Two complementary lenses. Apply both — they fail differently.

**Minho's AGIQ register check.** Read the hook as the most-tired version
of the IVP. Translate jargon to the *thing* the jargon names, even when
the jargon is technically accurate.

- *"behavioral neuroscience"* → *"how your brain actually changes"*
- *"cognitive restructuring tools"* → *"new ways to think when you spiral"*
- *"belief system reprogramming"* → *"installing a new operating system"*
- *"hypertrophy mechanisms"* → *"how muscle actually gets bigger"*

**Jenny's 5th-grade readability test.** Jenny Hoyos analyzed thousands of
high-performing shorts and found Mr Beast's are at *first-grade* level;
≤5th-grade is the durable bar. Paste the script into
[readabilityformulas.com](https://readabilityformulas.com) and target
≤5th grade.

Common failure mode for the readability test: a single category word
single-handedly bumps the grade by 3-4. *Business, finance, profit,
framework, methodology, intervention.* Jenny's move — *"instead of saying
'profit' I just explain the definition of profit every time I talk about
it."*

The two checks fail differently. AGIQ catches words that *trip a tired
mind*; readability catches sentences that *parse-cost too high* by syntax.
A line can pass one and fail the other.

### 2.5. Six hook archetypes that consistently hit

Pick ONE — sometimes two combined. Format below: **WHY · REQUIRES ·
EXAMPLE**. The examples are verbatim from real outliers in our 370-video
sample — derive the *archetype* (the shape and what it requires), don't
mimic the example's exact phrasing or sentence structure (§14).

**A. The Skit (Wrong → Stop → Right).** *Why:* viewer mentally rehearses
the corrected behavior. *Requires:* a performable wrong-version, a clean
"STOP" pivot, verbatim corrected dialogue. *Example:* *"Salary
expectations? Um, I don't know. $45k I guess." → STOP, don't answer this
directly → "Thank you so much for bringing that up. I'd love to know the
approved range."* (advicewitherin, 23M)

**B. The Insider Confession.** *Why:* authority + scarcity of access.
*Requires:* clear credentialing, a specific dollar/case/scenario, "I
shouldn't be telling you this" undertone. *Example:* *"I just offered a
candidate $85,000 for a job that had a budget of $130,000. I personally
don't have the bandwidth to give lessons on salary negotiation."*
(jobdoctortessa, 9.4M)

**C. The Diagnostic Listicle ("3 signs that…", "5 things you…").** *Why:*
self-recognition is dopamine. *Requires:* odd specific number; items
roughly equal length; a re-hook before #1 and between 3-4. *Example:*
*"6 things I would never do as an asset protection specialist. Number one:
I would never leave anything to my partner or children in my will."*
(mpestateplanninguk, 5.1M)

**D. The Counter-Establishment Reveal.** *Why:* frames you as on-the-
viewer's-side against a powerful institution. *Requires:* a NAMED
institution; mechanism; a payoff the viewer can act on TODAY. *Example:*
*"LinkedIn did not intend for job seekers to read this article."*
(selfmademillennial, 1.6M) · *"Banks make money on your patience, not your
payments."* (chriscobb_chosen)

**E. The Transformation / Walkthrough.** *Why:* each visible step is a
micro-payoff. *Requires:* clear before-state, narration per step, "much
better" cue, anchored final reveal. *Example:* *"Let's turn this 1/10
resume into a 10/10. First we've got a master's, so let's add that. Much
better. Next, we don't need the street address. Bye bye."* (greglangstaff,
12.7M)

**F. The Story-as-Confession.** *Why:* story is the oldest retention
container. *Requires:* a named protagonist or antagonist; sensory
specifics; escalating beats; a coda that re-frames meaning without
lecturing. *Example:* *"So I just got kicked out of my hotel and the
authorities were called in Chautauqua, New York."* (sharonkgillenwater,
8.5M, 559s)

### 2.6. Foreshadow — the mandatory second beat (Jenny Hoyos rule)

The hook (S1) names the topic. The next 1-2 sentences — the **foreshadow**
— name the *destination*. What is at the end of the video that makes this
worth watching?

Jenny Hoyos runs every short on this two-beat opening:

1. **Hook** — *"My mom's never had a Mother's Day gift. I'm going to change
   that."*
2. **Foreshadow** — *"…and surprise her with the best present I can buy
   with $5."*

The viewer now knows: by the end, I'm going to see the gift. They have a
reason to keep watching beyond the hook's grip.

Combined hook + foreshadow target: ≤3 seconds, ≤2 lines.

**Operating rule:** every script must answer, in S2-S3, *"what specifically
will the viewer have seen / learned / felt by the time this is over?"* If
the answer is implicit, foreshadow is missing.

After the foreshadow, the script's job changes: every subsequent line must
be DELIVERY, not more setup. Re-telling the promise mid-body is a failure
mode — once you've told them what's coming, start showing.

(Receipts: `viralizer_research/_pedagogy/jenny_hoyos_extractions.md`.)

### 2.7. First-frame visual hook test

Jenny: *"if it could be used as a title in thumbnail on a long form and
still get clicks, it'll work for a short. The hook needs to be very visual
— you need to understand it without even listening to it."*

The first frame is its own hook. Mute the first second of your planned
video and ask: does the IVP know what this is about?

- **Talking head** — first frame shows avatar + framing + lighting. Does
  the framing energy match the spoken hook? A whisper-secret hook needs a
  tight close-up; a polarizing reveal needs eye-contact + room context.
- **Kinetic typography** — the first frame literally is the hook text card.
  The text alone must do the job of a long-form thumbnail.
- **B-roll** — first frame is the visual subject. Does it name the topic
  visually?

If the muted first frame is generic ("a face, neutral expression, beige
room"), the visual hook has not been crafted. Go back to vision.md's beat
sheet and decide what frame 1 actually shows.

### 2.8. Patterns that fail (cut on sight)

- *"So today I want to talk about…"*
- *"Hi everyone, [your name] here…"*
- *"I've been thinking about…"* (no stakes, no curiosity)
- *"So"* as throat-clearing before getting started. (Jenny's *"So I cooked
  illegally"* is content-carrying, not throat-clearing — the cut is on
  filler "So", not the word itself.)
- Long credentialing intros (max one mid-content credential drop).
- Anything that could appear on slide 12 of a slide deck.

---

## 3. Retention — mechanism + re-hooks every 3-5 seconds

### 3.0. Mechanism — the structural through-line

Before re-hook tactics, name the **mechanism** — the structural device
that makes the viewer track progress to the end. Jenny on Mr Beast:
*"Last to leave the circle wins $500,000. The mechanism is the circle is
constantly closing — so the viewer is watching till the end. If it wasn't
closing, I don't know if anyone would watch to the end."*

The mechanism is named in vision.md (production fields). Common forms,
each implied by a §2.5 hook archetype:

- **Listicle of N** (*"3 things", "5 mistakes"*) — viewer counts items.
- **Transformation / walkthrough** — viewer watches visible progression
  toward a final reveal.
- **Wrong → stop → right** (the skit) — viewer waits for the corrective.
- **Closing countdown / time pressure** — explicit timer.
- **Open-and-close loop cascade** — each beat opens a fresh loop before
  closing the previous one.

A re-hook anchored to a mechanism is *progress*; one floating in space is
*noise*. *"Mistake number two…"* lands because mistake number three is
coming. Before you write a single re-hook, audit: is the mechanism
visible to the viewer at every beat?

### 3.1. Re-hook moves

Re-hooks reset attention. Mix five forms.

**Pattern-interrupts.** *"Stop." / "Wait." / "But here's the thing." /
"Are you paying attention?"* — and a CUT to a different shot is itself a
re-hook even when dialogue is mid-flow. Operationalize via timeline-
segmentation in Seedance prompts (`seedance_prompting_guide.md` §9 +
CLAUDE.md rule 8).

**Loop-deferrers (open the loop wider).** *"Stick around to the end
because I'll also share…" / "And the kicker is…" / "And yes, I'm even
gonna tell you the wildest thing X did that nobody knows."*

**Mechanism-prompts.** *"Why does this work?" / "Maybe you're wondering,
how does this even work? You see…"*

**Self-doubt invitations.** *"I know what you're thinking — '[the
objection]'. And here's the answer."*

**Listicle-internal beats.** *"Mistake number one… mistake number two…" /
"And number five is the one nobody talks about."*

**Operating rule:** the read-aloud test is the audit. Speak the script
aloud at conversational pace; if a 5-second stretch passes without an
interrupt, fresh loop, or visible mechanism progress, the viewer's
attention has slack to scroll. This is a *no-flat-patches* check, not a
quota — counting beats encourages over-chopping (§5.2).

---

## 4. Open loops, loop-widening, and satisfying payoffs

A line that ANSWERS something kills retention. A line that POSES the next
question keeps them watching.

### 4.1. Open-loop discipline

Every chunk's last line should either pose the next question OR promise
the answer is coming with a specific tease. Audit:
- Does this line answer a question? If yes: does the NEXT line raise a
  fresh one BEFORE delivering the answer?
- If not: don't deliver the answer here. Move it later.

### 4.2. Inline loop-widening (the *"let me explain…"* move)

Beyond not-answering, *actively tease* the answer right before delivering.
This is a SECOND hook inside the body of the chunk.

Shape: **[setup of claim] — [partial reveal posing a new question] —
[explicit hold] — [substance] — [actual reveal].**

Stock holds: *"…and they found something nobody expected. Let me
explain." / "…but here's where it gets wild." / "…stick with me, this part
is the whole thing." / "…and the answer surprised me too."*

**Without:** *"UCL proved it in 2010 — 96 people, 12 weeks. Anything you do
daily for 66 days locks in."* (the headline-of-the-headline before
anyone wants it).

**With:** *"UCL proved it in 2010. They ran a study with 96 people over
twelve weeks and proved something nobody expected — let me explain. They
had people repeat one small daily action and tracked the moment the brain
stopped consciously choosing. The number? Sixty-six."*

Same fact, but the viewer was HELD across a tease, given the mechanism,
and the reveal lands with weight.

**Rule of thumb:** when the script is about to deliver its biggest
reveal, tease it first. The check isn't a count — it's whether the
highest-payoff moment has a hold-line in front of it.

### 4.3. Direction changes (pivots)

A flat script has one direction: claim → proof → CTA. A dynamic script
**pivots** 2-4 times. Each pivot is a fresh hook because the viewer's
brain has to re-orient.

Stock pivots:
- **Claim → confession.** *"I used to think the opposite, and that's
  exactly why I was broke for 5 years."*
- **Mechanism → application.** *"That's the science. Now here's what to
  actually do with it Monday morning."*
- **Reveal → "and here's how to use it."**
- **Tactic → meta.** *"That's the move. But here's why nobody actually
  does it…"*
- **Personal story → general principle**, or the reverse.

Most outliers in the 30s-60s range pivot 2-4 times. Below 2 the script is
flat (claim → proof → CTA). Above 4 in 60s the viewer feels jerked. The
check is read-and-feel: if the script sits on one tone all the way
through, add a pivot.

### 4.4. What makes a payoff *satisfying*, not just delivered

1. **Specificity.** Numbers, named techniques, exact dialogue scripts.
2. **A small surprise.** Not the obvious answer.
3. **Re-applicability.** Viewer can plug it in tomorrow.
4. **Emotional release.** Relief, validation, righteous-anger,
   vindication.
5. **Closed loop with a wedge for the next loop.** *"And the bonus tip?
   That's in my next video."*

### 4.5. The expectations contract (MrBeast rule)

The hook makes a promise. The body's job is to deliver *that exact
promise*. Not a related promise. Not a directionally-correct promise. The
one the hook made.

MrBeast's framing: a thumbnail with a yellow bouncy castle and the title
*"World's Largest Bouncy Castle"* must show a yellow castle that is, in
fact, the world's largest. A red castle, or a normal-sized one, breaks the
contract — *"you'd feel like you were lied to and click off."*

For our pipeline this means: every promise the hook + foreshadow makes is
now an obligation. Audit before shipping:

1. **List every promise.** Write down each claim and visual cue in S1-S3.
   E.g. *"the $5 Mother's Day gift"* promises $5 spend + a gift + a
   Mother's Day context.
2. **Check fidelity.** For each promise, point to the chunk in the body
   that delivers it.
3. **Penalty for substitution.** If a promise can't be located in the
   body, either rewrite the hook or rewrite the body. Don't ship a script
   that resolves to *"well it's about the same idea."*

The contract is different from §4.4 satisfaction. Satisfaction is the
*quality* of payoff (specificity, surprise, emotional release). Contract
is *fidelity* — did the script pay back the specific debt the hook took
on. A script can be high-fidelity and unsatisfying, or satisfying-but-
off-promise. You need both.

(Receipts: `viralizer_research/_pedagogy/How-To-Succeed-At-MrBeast-Production.pdf`
Ch.1 — the bouncy-castle expectations example.)

### 4.6. Anti-patterns that fail satisfaction

- *"And remember to be your authentic self."* — abstract, untestable.
- *"And the rest is up to you."* — abdication.
- Listing the answer in slot 1 of 5.
- Closing with a sponsor-name in place of an emotional beat.
- Heavy summarization — drains the payoff energy.
- **Signaling the end** (MrBeast: *"Don't ever signal the end of the
  video unless it's to build hype for the prize"*). Banned phrasings:
  *"in conclusion / so that's why / before I go / wrapping up / hopefully
  this was helpful / and that's all for today."* Telegraphing the close
  hands the viewer permission to leave. The end arrives without warning.
- **Ending on a meta beat instead of on the moment.** Jenny trims the
  literal last 1 second of YouTube renders to lift retention ~5 points.
  The video ends *as the punchline lands*, not after.

---

## 5. Pacing — substance density, word budget, sentence rhythm

### 5.1. Hit your word budget

A 14s chunk at 150 WPM holds ~35 words. At 170 WPM, ~40. At 190, ~47.
If your draft for that chunk is 22 words, you've left ~13 words of
speaking time *unused* — and the viewer feels the rush. The script
literally stops talking before it should.

**The fix is almost always to add MECHANISM** — explain *how* or *why*
the claim works, in the same chunk.

| Chunk length | 150 WPM | 170 WPM | 190 WPM |
|---|---|---|---|
| 4s  | 10 | 11 | 13 |
| 8s  | 20 | 23 | 25 |
| 12s | 30 | 34 | 38 |
| 14s | 35 | 40 | 44 |
| 15s | 38 | 43 | 47 |

Audit: count words per chunk, divide by `(end_sec - start_sec) ×
target_wpm / 60`. Below 90% = too sparse, add mechanism. Above 105% = too
crammed, cut filler.

### 5.2. Sentence-rhythm — the read-aloud test

The check is *speakability at conversational pace*, not a word-count
quota. **Read every sentence aloud as the avatar would deliver it.**

- If you stumble (the sentence trips a speaker mid-thought), it's wrong.
- If a listener wouldn't have time to absorb the meaning before the next
  sentence lands, it's wrong.

Both failure modes apply equally. Too long = listener can't track. Too
short = chopped fragments that read tight on the page but trip the
speaker — *"It's called the trade-stack. Three moves, thirty days before
launch."* reads punchy and breaks when spoken; *"It's called a trade-
stack and it's made up of three simple moves that start thirty days
before your launch"* flows and lands. The user's revealed definition of
"punchy" = **spoken-natural at conversational pace**, not syllable-
minimized. (Receipts: `user_script_voice/PATTERNS.md` #1.)

Humanizer covers the same ground without quotas: *"short punchy
sentences. Then longer ones that take their time getting where they're
going. Mix it up."* The mix is felt, not counted.

### 5.3. Cut filler — but never setup or connecting tissue

- No throat-clearing: *"So", "Look", "Listen", "Actually"* used as filler
  before getting started. (Jenny's *"So I cooked illegally"* is content,
  not filler — see §2.8.)
- Replace 3-syllable abstractions with 1-syllable concrete words when the
  concrete word is honest.

**Setup is not filler.** A sentence that names the topic, anchors a
metaphor, or establishes a referent is *earning* its place even if it
isn't punchy. The most common failure mode of this rule is over-cutting
context until specifics float without referents (back to §2.1).

**Connecting tissue is not filler.** Words like *"and"*, *"that"*,
*"it's"*, *"of"*, *"made up of"*, *"that start"* — these don't add
information but they buy the listener time to absorb meaning when the
sentence is spoken aloud. Strip them and the prose looks tight on the
page but trips the speaker (see §5.2). When in doubt, keep the
connecting tissue.

### 5.4. Pacing break without the pacing actually breaking (Jenny rule)

Viewers can't absorb three claims in a row without a beat to settle. You
need micro-breaths between dense beats. But the breath cannot be a
META-transition (*"let's get started", "first thing's first", "so today
I want to talk about", "moving on"*) because those drain energy and
telegraph structure.

Jenny's craft move: replace the meta-transition with a **content-carrying
line** that buys the same beat of breath.

- *"And then let's get started."* (meta — drains energy)
- *"So I cooked illegally."* (carries content — same breath, lands harder)

The principle: every line — including the breath — has to carry
information or escalate stakes. Audit your draft for any sentence whose
only job is to announce what's coming next; rewrite it as a content-line
that does the same structural work.

This is the positive-space pair of §5.3. §5.3 cuts throat-clearing; §5.4
says don't replace it with hollow announcement-language either.

---

## 6. Specificity — the escalation ladder

The biggest single quality lever. **More specific is almost always
better.** Abstractions slide off; specifics stick.

### 6.1. The escalation ladder

Push your draft as far down as the truth allows:

1. **Generic claim** — *"Many people struggle with this."*
2. **Named-quantity claim** — *"Most founders struggle with this."*
3. **Counted-quantity** — *"800 founders I've coached struggled with this."*
4. **Counted + observed** — *"I've coached 800 founders. 78 of them wrote
   the same vague mission."*
5. **Counted + observed + verbatim** — *"I've coached 800 founders. 78
   wrote the exact same line: 'we empower people to reach their potential.'"*

Each rung adds a number, a name, a quoted line, or a sensory detail.

### 6.2. Weight ranking (high → low)

- **Verbatim quoted dialogue.** Highest leverage.
- **Named characters / institutions.** Helen, UCL, De Beers, Bob Moesta.
- **Specific numbers.** *"$85,000 for a job that had a budget of
  $130,000"*, *"sixty-six days"*.
- **Brand names of mundane objects.** *"Carolina Herrera gown"*,
  *"American Standard golf-ball toilet"*.
- **Place names with texture.** *"Chautauqua"*, *"Upper East Side"*.
- **Sensory specifics.** *"laminated sign"*, *"$400 a night"*.
- **Verb specificity.** *"piss it away"* > *"spend it"*.

### 6.3. The IVP-relativity test (replaces the old "any coach" test)

Don't ask *"could this line appear in any coach's video?"* — niche-
specificity is the goal, not a failure. Ask instead:

> Does this line land HARDER for our IVP than for a generic viewer?

If yes — even if it would feel "too niche" to outsiders — keep it. Your
goal is to make ONE specific person feel uniquely seen, not to be
universally palatable.

If a line is *equally* relevant to everyone, it's not specific enough.
Find the one that hits your IVP harder than anyone else.

### 6.4. Specificity carries the brand

Specifics aren't only craft — they're the most credible way to land the
brand. *"The team at Inevitable You runs the exact 66-day UCL protocol —
two weeks mapping your current OS, then 64 days installing the new
patterns one at a time"* sells the company harder than *"Inevitable You is
amazing — go check them out."* Specifics ARE the endorsement.

### 6.5. The extremity axis (MrBeast rule)

Specificity (§6.1) is one escalation lever. **Extremity** is the other.

MrBeast: *"'I Spent 50 Hours In My Front Yard' is lame. 'I Survived 50
Hours In Ketchup' is 100x more viral. Both are similar in time/effort —
but 'survived' adds intrigue and feels extreme."*

The principle: when the underlying truth supports it, push to the most
absolute, most extreme phrasing. Hedge-words leak energy.

Hedge-words come in two classes — they fail differently and only one is
fair game for stripping.

**Claim hedges — strip when truth supports.** These soften the *truth-
value* of the claim itself: *often, sometimes, many, most, can, may,
might, tend to.* If the truth is absolute, the hedge is leaking energy.

**Soft verbs / nouns — replace when more honest.** *spent / did / went*
when *survived / endured / escaped / destroyed* are honest. *issue* when
*disaster* fits; *change* when *betrayal* fits.

**Conversational hedges — KEEP.** *kind of, sort of, a bit, somewhat,
basically, pretty much.* These don't soften the claim — they soften the
*delivery register* into spoken-natural cadence. Stripping them produces
the same disease as §5.2's chopping: prose that reads tight on the page
but sounds robotic when spoken aloud. The user keeps these in their
edits deliberately (see `user_script_voice/PATTERNS.md` #1).

Examples:

- *"Most coaches do X."* → *"Coaches who do X are stealing from you."*
- *"Bananas aren't great."* → *"Bananas are the worst food on earth."*
- *"This habit might help your career."* → *"This is the habit that locks
  in your career."*
- *"I spent 50 hours."* → *"I survived 50 hours."*

The discipline: **never lie**, never strip what makes the line speakable.
Specificity asks *"can I add a number, a name, a quote?"* Extremity asks
*"can I drop a claim hedge?"* Speakability asks *"would I keep this word
if I were saying this aloud to a friend?"* All three apply to every
line.

(Receipts: `viralizer_research/_pedagogy/How-To-Succeed-At-MrBeast-Production.pdf`
Ch.1 — the ketchup vs front-yard example.)

---

## 7. Brand promotion — carrying the lore positioning

The brand isn't a logo or a tagline. The brand is the **positioning**
you defined in vision.md. Every chunk of the script should be carrying
that positioning forward — even when the brand name isn't on screen.

A script that nails the topic but misses the positioning gets viral
attention without the company attribution.

### 7.1. The brand IS the positioning

Re-read `<job_dir>/vision.md` → **lore positioning** field. That sentence
is what the viewer needs to absorb implicitly *before* the brand name
drops. Examples:

- **Inevitable You:** *"Runs elite-military discipline as a precise
  behavioral science, not as motivation."* The script's *operating
  system* / *meticulous* / *one pattern at a time* language carries this.
- **On Purpose:** *"Your purpose isn't found, it's named — in two words."*
  The whole script is leading to that line.
- **A B2B agency:** *"They speak fluent decision-maker, not marketer-
  jargon."* The script demonstrates plain-English ROI talk throughout.

If the script's tone, pacing, and choice of details don't carry the
positioning, the brand mention at the end will sound like an ad. If they
do, the brand mention sounds like the punchline.

### 7.2. Third-person voice (mentor / credible-witness only)

The avatar is NOT the founder. The avatar is a credible educator who
recommends the company. Voice is third-person:
- ✅ *"They call it…"*
- ✅ *"At Inevitable You they…"*
- ✅ *"There's a system called X that runs this exact protocol."*
- ❌ *"We install a new operating system."*
- ❌ *"Our 66-day intervention."*
- ❌ *"Here's what I did with my clients."* (peer-claim — unsupported by
  the avatar's generated history; reads as inauthentic)

### 7.3. The brand-curiosity loop (build → curiosity → CTA)

The CTA needs to land at the moment the viewer is silently asking *"who
ARE these guys?"* Selling before the curiosity peak feels like an ad.
Selling at the peak feels like a recommendation.

**Beat order:**

1. Hook + topic (no brand yet).
2. Reveal + mechanism (still no brand — let the *content* sell).
3. **Lore beat.** A specific, weighted description of what the company
   does — using positioning language from vision.md. *"They take two weeks
   just mapping your current OS. Then 64 days meticulously installing a
   new one, one pattern at a time."* This is where weight-words like
   *meticulously*, *entire*, *one pattern at a time* earn their place —
   because they're carrying the positioning.
4. **Brand name drops here, riding the lore beat.** *"There's a system
   called Inevitable You that runs exactly this."*
5. CTA — names the company in third-person, ties to a specific deliverable.

### 7.4. Weaving techniques (pick by format)

- **Credible-Witness Frame** *(default for talking head)*. *"There's a
  system called X that…"* / *"The team at X calls it…"*
- **Metaphor-Attribution.** Use the brand metaphor first, attribute it
  after the AHA. *"Your habits are an operating system. That's how
  Inevitable You frames it."*
- **Where-To-Go Recommendation.** Save the brand for the moment the viewer
  is asking "where do I go for this?" — right before CTA.
- **Case-In-Point Citation.** Use the brand as a *demonstration* of the
  concept. *"This is why coaches like the team at X spend two weeks just
  mapping the current OS — you can't overwrite what you haven't measured."*
- **Lower-Third-Only.** For B-roll or kinetic-typography reels: brand
  appears as a Remotion lower-third / end-card and is named verbally
  once near the CTA.
- **Kinetic-Typography Card.** Brand metaphor as a hero card, brand name
  as attribution after the reveal.

### 7.5. Frequency + position

- Brand name appears **1-2 times verbally**, not in every chunk. Once
  well-placed beats four times sprinkled.
- **Never in sentence 1.** The hook earns the right to introduce it.
- Best placements: the lore beat (~60-75% through), and the CTA.

---

## 8. CTA forms

A URL pill alone doesn't convert. Bake the CTA into the dialogue. Use one
or combine 2-3 of these forms (always third-person re: the company):

1. **Reassurance + Follow** — *"You got this. Follow me for more."*
2. **Gateway-to-resource** — *"Comment OS — I'll point you to their
   diagnostic."*
3. **Save-this-for-later** — *"Save this and watch tomorrow morning before
   you open email."*
4. **Self-identification + comment** — *"If you can relate to any of these
   3, drop it below."*
5. **Share-trigger** — *"Send this to somebody who [audience descriptor]."*
6. **Daily-show parasocial** — *"I'll see you tomorrow."*
7. **Bookmark with smiley** — *"You might wanna bookmark this for future
   reference, just saying :)"*
8. **Polarizing close** — *"Disagree? Let me know in the comments."*

Verbal CTA can repeat the URL pill (good — reinforcement). It cannot be
absent.

**The CTA must NOT telegraph closure.** *"In conclusion, follow me…"* /
*"Wrapping up, drop a comment…"* hands the viewer permission to leave.
The CTA arrives ON the energy peak, not after a closing-ceremony breath.
Jenny ends *reaction → cut*. The CTA is part of the punchline, not a
coda. (See §4.6 — the signaling-the-end anti-pattern.)

---

## 9. Storytelling craft — viral AND satisfying

Test: can the viewer retell what they just saw to a friend in one sentence
and have it land? If not, it wasn't a story, it was a list of facts.

- **Named characters anchor narrative.** Helen, Bitsy, Bunny, Joe (76,
  former marine, current savage). Names create cinema.
- **Quoted dialogue is the highest-leverage move.** Quoted lines get
  screenshotted and shared.
- **Earn the lesson.** Viral structure is HOOK → SETUP → ESCALATION →
  MOMENT → LESSON-IN-PASSING → CTA. Lesson lands in the SHADOW of the
  moment, not as the moment.
- **Vulnerability is a force multiplier.** *"When our son was little I
  didn't like him."* The creator's specific shame on the table = trust
  spike.
- **Earned profanity, ungeneric jokes** telegraph "real human." Use 1-2x
  per script, tied to a specific emotional beat.
- **But / Therefore connectors (Jenny rule).** Audit your script for
  sequential *"and then / and then / and then"* — that's a list of
  events, not a story. Replace with *but / therefore* connectors to force
  change-driven narrative.

  > *"I went on a walk THEN it started raining THEN I went back home."*
  > (flat — three events, no causal link)
  >
  > *"I went on a walk BUT it started raining THEREFORE I ran back home."*
  > (story — change drives every beat)

  Same facts. Rule of thumb: every story beat should connect to the
  previous one with *but* (something obstructed the plan) or *therefore*
  (a consequence followed) — almost never *and then*. (Also known as the
  South Park writers' rule.)

---

## 10. Humanizer pass — strip AI fingerprints

From `agent/skills/_references/softaworks-agent-toolkit/skills/humanizer/SKILL.md`,
based on Wikipedia's "Signs of AI writing." AI-tells repel attention
because audiences subconsciously recognize them.

### 10.1. AI vocabulary to nuke

> Additionally, align with, crucial, delve, emphasizing, enduring, enhance,
> fostering, garner, highlight (verb), interplay, intricate, intricacies,
> key (adjective), landscape (abstract noun), pivotal, showcase, tapestry,
> testament, underscore (verb), valuable, vibrant.

If any appear, rewrite the line.

### 10.2. Structural AI-tells

- **Em dash overuse.** Replace with commas where the pause is short, full
  stops where it's a real beat. Don't substitute every em dash for a
  period — that biases the prose toward chopped fragments (§5.2).
- **Rule of three.** Break it — twos, fours, single items.
- **Negative parallelism.** *"It's not just X, it's Y."* Replace with a
  direct claim.
- **Inflated symbolism.** *"stands as a testament to"*, *"marks a pivotal
  moment"*. Cut.
- **Vague attributions.** *"Industry experts argue."* Name the source or
  remove.
- **Promotional tone leak.** *"boasts a"*, *"vibrant"*, *"stunning"*. Cut.
- **Superficial -ing analyses.** *"…highlighting the importance of…"*. Cut.
- **Sycophantic tone.** *"Great question!"*, *"You're absolutely right!"* —
  never in a script.

### 10.3. How to add VOICE (anti-soulless)

Avoiding AI patterns is half the job. Sterile/voiceless writing is just as
obvious as slop.

- **Have opinions.** React to facts, don't just report them.
- **Vary rhythm.** Short punchy sentences. Then longer ones that take their
  time.
- **Acknowledge complexity.** *"This is impressive but also kind of
  unsettling."*
- **Use "I" when it fits.** First person is honest, not unprofessional.
- **Let some mess in.** Tangents and asides are human.
- **Be specific about feelings.** Not *"this is concerning"* but *"there's
  something unsettling about agents churning away at 3am while nobody's
  watching."*

---

## 11. Fact-check before generating audio (non-negotiable)

If a chunk includes:
- a number, a name, an attribution, a date/year, or a non-trivial empirical
  claim,

…verify via `WebSearch` before generating audio. If a claim can't be
verified within ~2 searches, rewrite the line. Hallucinated stats damage
the brand. Restated in CLAUDE.md rule 13.

---

## 12. Niche calibration

After universal punch-up, tune the dial for the niche of the reference
outlier. Niche-specific defaults, lean-towards/avoid notes, and named
champions per niche live in
**`agent/skills/viralizer_research/niche_calibration.md`**.

Read the section for your niche before the final pass. Keep this skill
focused on operating doctrine; the calibration table is encyclopedic
reference.

---

## 13. The punch-up checklist

Don't move to seedance until every box is green.

**Prerequisites (§0):**
- [ ] vision.md has IVP, core drive, position, journey arc, lore positioning,
      **signature element**, **mechanism**

**Hook (§2):**
- [ ] Topic anchored in sentence 1 (no floating pronouns)
- [ ] IVP feels seen by sentence 3
- [ ] 5-second perceived-value test passes
- [ ] Hook leads with EMOTION (the core drive), not mechanism
- [ ] AGIQ register: no jargon a tired person would have to think about.
      Script paste passes ≤5th grade on readabilityformulas.com (§2.4)
- [ ] Hook archetype matches §2.5.A-F (write down which)
- [ ] **Foreshadow beat (§2.6) present in S2-S3 — names the destination,
      not just more setup. Combined hook+foreshadow ≤3s.**
- [ ] **First-frame visual hook (§2.7): muted first second, the IVP can
      tell what this is about**

**Retention (§3-4):**
- [ ] **Mechanism named (§3.0) — listicle / transformation / wrong-stop-
      right / countdown / loop cascade — and visible at every beat**
- [ ] Read-aloud test: no flat 5-second stretch without an interrupt,
      fresh loop, or visible mechanism progress (§3.1)
- [ ] Biggest reveal has a hold-line teasing it before delivery
      (§4.2 *"let me explain…"*)
- [ ] At least 2 pivots in a 30s-60s script — script doesn't sit on one
      tone (§4.3)
- [ ] Open loops > closed loops; payoff sits at the END
- [ ] Payoff is satisfying (specificity + small surprise + re-applicability
      + emotional release)
- [ ] **Expectations contract audit (§4.5):** list every promise in
      S1-S3; point to the chunk that delivers each one. No substitution.

**Pacing (§5):**
- [ ] Word-budget hit at 90-105% per chunk (use cheatsheet)
- [ ] Read-aloud test passes: no sentence trips a speaker, listener has
      time to absorb each line. Punchy = spoken-natural, not syllable-
      minimized (§5.2 + `user_script_voice/PATTERNS.md` #1)
- [ ] No throat-clearing — but setup AND connecting tissue preserved
      (§5.3)
- [ ] **Pacing breaks carry content (§5.4) — no meta-transitions like
      *"let's get started"*; rewrite as content-lines**

**Specificity (§6):**
- [ ] Every line has a number, name, quoted line, or sensory detail
- [ ] IVP-relativity test: lines land HARDER for the IVP than for a
      generic viewer
- [ ] At least one quoted line OR named character/institution
- [ ] **Signature element from vision.md is delivered verbatim somewhere
      in the body — the one disproportionately-researched specific**
- [ ] **Extremity sweep (§6.5): claim hedges (often / may / might)
      stripped when truth supports. Conversational hedges (kind of /
      a bit / basically) KEPT — they make prose speakable.**

**Brand (§7):**
- [ ] **Log-line retell test:** read the dialogue end-to-end, then write
      the 4 beats of the log line as the viewer would retell them:
      problem · attempted · issue · fix. If a beat is missing or weak in
      the script, the script is off-brief — rewrite, do not ship. If you
      can also write the one-sentence "what does this company do" answer
      the viewer would give, even better.
- [ ] Lore positioning from vision.md is carried by the script's tone +
      details — not just stated at the end
- [ ] Brand name appears 1-2 times verbally; not in sentence 1
- [ ] Lore beat (~60-75% through) uses weighted positioning language —
      *"meticulously"*, *"entire"*, *"one at a time"*, etc. — that crystallizes
      what the company stands for
- [ ] Third-person voice throughout. No *"we / our / us"* referring to the
      company
- [ ] Brand-weaving technique chosen from §7.4

**CTA (§8):**
- [ ] Verbal CTA in the dialogue (one of §8 forms), not just URL pill
- [ ] CTA names the company in third-person + connects to a specific offer
- [ ] CTA arrives AFTER the lore beat, not before
- [ ] **CTA does not telegraph closure** — no *"in conclusion / wrapping
      up / before I go / hopefully this was helpful"* (§4.6, §8)

**Storytelling (§9):**
- [ ] **But/therefore connectors:** no sequential *"and then / and then"*.
      Every story beat connects via *but* (obstruction) or *therefore*
      (consequence)

**Polish (§10-11):**
- [ ] No high-frequency AI-vocabulary words (§10.1)
- [ ] No em-dash overuse, rule-of-three, negative parallelism
- [ ] Numbers / names / claims fact-checked (§11)
- [ ] Niche calibration applied per `viralizer_research/niche_calibration.md`

---

## 14. When stuck — re-read the outlier transcript

The reference outlier got viral because of how its WORDS land. Re-read the
`reference/analysis__*.json` and the verbatim hook from the DB row you
selected. **Don't copy the words — derive the arc.** Different references
produce different arcs; there is no master template. Map their beats and
adapt to your IVP, journey arc, and lore positioning.

For champion examples per niche, see
`agent/skills/viralizer_research/bundles/<niche>.md` — full transcripts of
every video in the 370-sample.

---

## 15. Reading the research

Receipts behind any rule in this skill:

- `viralizer_research/_pedagogy/minho_ideal_viewer_persona.md` — the IVP /
  core-drive / AGIQ / emotion-first / where-they-are framework that drives
  §0, §2, and §7
- `viralizer_research/_pedagogy/jenny_hoyos_extractions.md` — Jenny Hoyos
  craft principles (foreshadow §2.6, first-frame visual §2.7, 5th-grade
  readability §2.4, mechanism §3.0, pacing-break §5.4, but/therefore §9,
  end-abruptly §4.6)
- `viralizer_research/_pedagogy/How-To-Succeed-At-MrBeast-Production.pdf`
  — MrBeast's production handbook. Ch.1 is the source of expectations
  contract (§4.5), extremity axis (§6.5), and never-signal-the-end (§4.6,
  §8). The rest of the book is production-org management — skip unless
  curious.
- `viralizer_research/notes_master_patterns.md` — cross-niche patterns with
  quoted examples (source of §2-9)
- `viralizer_research/niche_calibration.md` — per-niche defaults (§12)
- `viralizer_research/bundles/<niche>.md` — full transcripts of all 370
  champion videos
- `viralizer_research/sample.jsonl` — raw DB pull, JSONL, re-formattable
  via `_format_for_reading.py`
- `_references/softaworks-agent-toolkit/skills/humanizer/SKILL.md` — the
  original humanizer skill we built §10 on top of
