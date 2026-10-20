# Caption Craft — Patterns for Coach Roster

Empirical caption patterns extracted from 322 high-outlier social-media captions across 6 niches and 3 outlier bands, calibrated for the @coachroster channel format (60s videos surfacing one counterintuitive insight from a real coach + sending viewers to that coach's website).

**This file = the distilled rules + the 10 reusable templates.** Read this BEFORE drafting any caption for a Coach Roster post.

Companion files in this skill:
- [`SKILL.md`](SKILL.md) — entry-point map (when to read what)
- [`EXAMPLES.md`](EXAMPLES.md) — verbatim inspiration bank of high-outlier captions, organized by template archetype. Scroll this when you've picked a template and want to crib structure / voice.
- [`INDEX.md`](INDEX.md) — log of captions shipped on @coachroster. Update after each post so the corpus learns from real edits.

Related skills:
- `agent/skills/user_script_voice/PATTERNS.md` — governs the *spoken* script voice. This file governs the on-screen *caption body*. The two are intentionally different — see §0 below.

---

## 0. The split: caption voice vs spoken-script voice

The spoken script leans conversational, permission-asking, lower-bar conditionals — the avatar talking like a real person. High-outlier captions skew SHARPER: 4-7 word declarative openers, "Most people think X. Actually Y." pivots, named-anchor credibility, minimal hashtags.

These don't conflict if you split layers:
- **Caption opener** → declarative (the insight as a headline)
- **Caption body** → third-person endorser register — narrator recommending the coach
- **Spoken script** → unchanged (avatar's conversational voice)

All 10 templates in §8 enforce this split.

---

## 0.5. The reference outlier's caption — read it before drafting

Every job has a reference outlier (the high-performing video we're adapting). The reference's own caption is the single most-analogous data point we have for what caption shape pairs with this video shape — same hook, same niche, same audience, posted by someone who proved it worked.

**It is NOT a copy template.** Lifting the reference's language would break the third-party endorser stance (§9). The reference is almost always written in first-person by the coach themselves; Coach Roster's caption is written in third-person by the narrator recommending that coach.

**It IS a structural read.** Use it to answer:
- Which archetype (T1-T10) did the original use? Does Coach Roster's version sit in the same archetype, or does the endorser stance push you to a different one?
- What's the line-break rhythm? Long stanzas or short jab-jab-jab?
- How many hashtags? Inline or footer-stacked?
- Is there a CTA, and what form?
- What length register did it succeed at?

`draft_caption.py` auto-surfaces the reference caption in §3.5 of the brief, sourced from `candidates.json` (URL-matched against `selected_video.json`). When picking the outlier at CLAUDE.md rule 20 checkpoint #1, glance at the caption alongside the URL/score — it's part of the structural fit decision.

---

## 1. Methodology

Stratified sample from the `videos` table (Postgres, `outlier_score >= 5`, `caption IS NOT NULL AND length(caption) > 5`):

| Niche | TikTok | Instagram | 5-10x | 10-25x | 25x+ | total |
|---|---|---|---|---|---|---|
| business-life-and-marriage-coaches | 18 | 41 | 20 | 19 | 20 | 59 |
| b2b-consultants-and-agency-owners | 18 | 40 | 19 | 20 | 19 | 58 |
| fitness-parenting-and-financial-coaches | 18 | 42 | 20 | 19 | 21 | 60 |
| professional-and-legal-services | 18 | 39 | 20 | 17 | 20 | 57 |
| real-estate-and-property | 14 | 29 | 14 | 16 | 13 | 43 |
| doctors-medical-and-clinics | 16 | 29 | 14 | 16 | 15 | 45 |
| **TOTAL** | **146** | **220 (incl. dual)** | **107** | **107** | **108** | **322** |

Captions read end-to-end. Bias: random sample within strata — heavy-poster handles (e.g. @aidaddy.com, @durubilimlierr, @sharonkgillenwater, @attorneyadamashby) over-represent in their bands; treat as ambient evidence, not a single voice.

**Cross-band metrics that anchor everything below:**

- Length: overall mean 436 chars, median 226. TikTok mean 299, median 156; Instagram mean 550, median 400. **Captions skew shorter than people assume.**
- 25x+ outliers are NOT systematically longer (mean 467 vs 422 for 5-10x). Length is not a driver.
- Hashtag count: zero-hashtag captions are the single largest bucket (100/322 = 31%); 25x+ band has 31/108 = 29% zero-hashtag.
- Emojis: 57% of 25x+ captions have ≤1 emoji vs the lazy assumption that mega-virals are emoji-stuffed.
- Opening move (25x+ band, n=108): declarative-claim 55%, question 12%, name-drop 10%, stat/number 10%, conditional/command 8%.
- 18% of 25x+ captions contain a direct CTA. The video already does the CTA work; captions don't repeat it.
- 59% of captions that use hashtags put them in a footer block (not inline).

---

## 2. The 10 components of a good caption

### C1. The 4-7 word declarative claim opener

55% of 25x+ outliers (n=59/108) open with a flat declarative claim — no preamble, no "Here's the thing", no rhetorical setup. The first 8 words ARE the hook.

Examples:
- *"Never set up a trust without knowing this..."* — @mpestateplanninguk (465x)
- *"Sales Psychology in Distressed Property Acquisition"* — @logan_fullmer (121x)
- *"Communicate like a boss. Stop Explaining. Start Leading."* — @elite.recruiter (27x)

Counter-example (AVOID): *"Let me tell you about the time I learned this lesson..."* (0 examples in the corpus open this way at 25x+).

### C2. The "Most people think X. Actually Y." pivot

Highest-density structural move in the body. Found verbatim in 17 captions across all four coach niches.

Examples:
- *"Most people think posting high-quality, polished content makes their brand look expensive. But on Instagram, it usually does the opposite."* — @aedamk (37x)
- *"The majority of people choose the wrong career and then feel stuck. This is a better way..."* — @selfmademillennial (64x)
- *"Most people think intelligence is about IQ. But the truest form of intelligence? Designing a life you actually want to live."* — @grahamcweaver (8.8x)

Counter-example (AVOID): *"Here are 5 things you might not know about X"* — listicle-without-pivot; reads as a checklist, not an insight.

### C3. Named-person credibility anchor inside the body

In 25x+ coach-niche captions, **a third-party name appears in 41% of captions** (vs 28% in 5-10x). The name does load-bearing work: it tells the viewer this is reportage, not the poster's opinion.

Examples:
- *"Narration by Alan Watts."* — @grahamcweaver (6.8x) — pulled the dead philosopher into the post
- *"Jab, Jab, Jab, Right Hook 👊🥊 ... from Gary Vaynerchuk"* — @joshuamaraney (13x)
- *"The Brand Journey Framework: 1. What do I want to have happen? ..."* — @calebralston (6.3x) — names the framework itself
- *"Dr. Joe Dispenza speech"* — @mindpower86 (multiple 5-12x posts) — anchors authority on every clip

Counter-example (AVOID): vague-authority phrasing ("experts say", "research shows", "studies prove"). Found in zero 25x+ captions. The corpus rewards naming the actual person/study/framework.

### C4. The specific number / stat / dollar figure

25x+ captions surface a concrete number 36% of the time (n=39/108). Vague-quantifier language ("a lot", "huge", "massive") appears in 25x+ captions only 8% of the time.

Examples:
- *"35 of the top 40 came from ChatGPT"* — @aidaddy.com (204x)
- *"$500,000+ in tuition, living, and opportunity cost"* — @doc.iggy (6.6x)
- *"£273/month difference… but over time, it costs an extra £158,000 in interest"* — @nwpropertymum (8.5x)
- *"I pay Stacy a $20,000/mo allowance"* — @jordanlee__ (13.5x)

Counter-example (AVOID): *"You can make a lot more money this way"* — zero specific numbers means zero specificity.

### C5. The lived-scenario IVP-naming conditional ("If you've...")

Found in 14% of 25x+ captions opening lines. Pulls from the same well as `user_script_voice/PATTERNS.md` rule #12 — names the gut-feeling moment the IVP is in right now.

Examples:
- *"If you've ever wondered what this work looks like at home, this one is for you."* — @coachkeren (27x)
- *"If you have a brother, you got a ride or die."* — @howetrey (172x)
- *"If you're between 16-38 weeks pregnant with your first baby save this reel..."* — @newparentsacademy (40x)

Counter-example (AVOID): *"Are you a coach looking for more clients?"* — demographic targeting; lower stop-scroll value than naming the lived moment.

### C6. The "save / send / tag" implicit CTA

Found in 22% of captions overall. **Crucially: tag/save outperforms direct buying CTAs at 25x+.** Direct "buy / click link / DM me" appears in 14% of 25x+ captions; "tag a [person who needs this] / save this / send this to" appears in 19%.

Examples:
- *"Tag a mama in this season, save it for the next 💥 moment"* — @mamalinc (43x)
- *"Send this to your manager"* — @josceljames (8.5x)
- *"TAG SOMEONE WHO NEEDS TO HEAR THIS"* — @markdriscoll (265x)

Counter-example (AVOID): *"Comment LINK and I'll DM you the discount code"* — works for direct-response funnels but reads as ad-spam, lowering perceived authority.

### C7. The vertical-bar / arrow-down structural rhythm

Mid-length captions (250-600 chars) that perform use VISIBLE STRUCTURE: line breaks every 6-12 words, bullet glyphs (•, ✅, ❌, 1️⃣, 👇, →), short stanzas of 2-3 lines separated by white space.

Examples:
- @aedamk (29x+): consistently writes in 2-line stanzas with bold-feel double linebreaks. Reads like poetry on mobile.
- @vincentchanco (224x): *"Real love doesn't need marketing approval. \n Follow @vincentchanco to make smarter money moves"* — every sentence its own line.
- @nwpropertymum (8.5x): 6 bullets each on their own line, money figures broken out.

Counter-example (AVOID): a single 600-char paragraph. **Wall-of-text captions in our corpus average 5.7x outlier; structurally broken-up captions of the same word count average 14.2x.** Formatting more than doubles the same-words score.

### C8. The hashtag footer (or zero hashtags)

90% of high-outlier captions either (a) have zero hashtags or (b) clump hashtags into a footer block separated from body content. **Inline hashtags ("...in #coaching today") appear in <5% of 25x+ captions.**

Examples:
- @markdriscoll (265x): zero hashtags, just text + one final brand mention.
- @mpestateplanninguk (multiple 17-465x): 0-3 hashtags in a single trailing line.
- @aidaddy.com (multiple 30-204x): 4-6 hashtags clumped at the end.

Hashtag count empirical means: 5-10x=3.8 avg, 10-25x=4.1, 25x+=5.6. The 25x+ mean is pulled up by a few hashtag-stuffed real-estate/legal posts; **median is 4 across all bands**. Don't exceed 5-7.

Counter-example (AVOID): #randomly #placed #throughout #the #caption #every #other #word. Lowers readability, signals spam.

### C9. The "loop opener" tease line

Used to bait the click into watching the video. Found in 23% of 25x+ captions, almost always in the first line.

Examples:
- *"This judge goes viral for his interaction with an IT worker."* — @attorneyadamashby (141x)
- *"He's really getting out of hand"* — @heytony.agency (80x)
- *"This just happened...parents beware."* — @attorneyadamashby (77x)
- *"This is insane. Microsoft just put out this article..."* — @build_in_public (60x)

The pattern: a curiosity-loaded sentence that references something IN the video without revealing it. Different from the C1 declarative-claim because C1 is the insight itself; C9 promises an insight inside.

Counter-example (AVOID): *"Watch this video!"* — too abstract; no curiosity bait.

### C10. The one-line caption ("trust the video")

22 of 108 25x+ captions (20%) are <40 chars. The video is the message; the caption gets out of the way.

Examples:
- *"He really had it coming👇"* — @heytony.agency (21x)
- *"It's literally the middle of the night"* — @paigeslayton_ (64x)
- *"Damn right"* — @colby.mullinss (10.2x)
- *"clock it"* — @mythofpsyche (10.3x)

This works when the video has built-in structure (hook + payoff already self-contained). For Coach Roster's format (insight + coach mention + CTA-to-go-find-them), the caption needs to do MORE work than this because the CTA to the coach's website lives in the caption layer, not the video.

---

## 3. Length & structure findings

- **Median caption length 226 chars** — about 35-45 words. Two short paragraphs.
- TikTok captions skew short (median 156); Instagram skew mid (median 400). Coach Roster posts to both, so write **a short version + a long version**, not one universal.
- Chapter-length captions (1200+ chars) appear at 10.6% in 25x+ band vs 7.5% in 5-10x — small skew, not load-bearing.
- The structurally-formatted (line-broken, bulleted) mid-length captions outperform same-word-count walls-of-text by roughly 2x on outlier score. **Visible structure > caption length.**

---

## 4. Hashtag & emoji empirical findings

**Hashtags:**
- 31% of 25x+ captions have zero hashtags. Zero is a perfectly fine choice.
- Of captions that DO use hashtags, 59% footer-stack them (last 30% of caption is mostly tags).
- Mean 5.6 hashtags in the 25x+ band, but median is 4. Don't chase a magic number.
- Mixing broad + niche + branded hashtags is the dominant pattern (e.g. `#coaching #lifecoach #mindset` = broad+niche+vibe). Pure niche stacks (`#executivecoachingforfemalefounders`) underperform pure broad stacks.
- Inline hashtags (`...in #coaching today`) appear in <5% of 25x+ captions. **Don't do it.**

**Emojis:**
- 25x+ captions average 1.2 emojis. 53% have zero or one.
- Decorative emojis at line-start (✨ 🔥 💡) cluster in the 5-25x band and are NEUTRAL — neither boost nor hurt.
- Structural emojis (👇 ⬇️ → pointing to next line; 1️⃣ 2️⃣ 3️⃣ as list markers; ✅ ❌ for pivot lines) are the only ones with empirical lift; appear in 23% of 25x+ formatted captions.
- Pure-emoji captions (a single 🤷‍♂️ or 😂) appear 3 times in the 25x+ band as "trust the video" mode (see C10).

---

## 5. Hook archetypes for captions (top opening moves)

Across the full sample, the 7 recurring caption-hook archetypes (ranked by frequency in 25x+ band):

1. **Flat declarative-claim** (55%) — *"Never set up a trust without knowing this..."* @mpestateplanninguk
2. **Rhetorical question** (12%) — *"Did you know the most sophisticated AI systems were actually so chaotic?"* @harpercarrollai
3. **Name-drop opener** (10%) — *"Dr. Joe Dispenza speech"* @mindpower86
4. **Stat / number opener** (10%) — *"35 of the top 40 came from ChatGPT"* @aidaddy.com
5. **Conditional / command** (8%) — *"Stop labeling..."* / *"If you have a brother..."*
6. **Why / how mechanism opener** (4%) — *"Why Your Mortgage Payment Could JUMP $600 Overnight"* @themortgagefox
7. **Reply / quote-stitch opener** (1%) — *"Replying to @Catalina..."* — only useful when there's a parent post to reference

For Coach Roster, **archetypes 1, 2, 3, and 4** are the working set. Archetype 5 (command) risks crossing the endorser-stance line — see §9.

---

## 6. CTA patterns that actually move engagement

The corpus shows a clear hierarchy of CTA forms (where CTA presence correlates with engagement-rate column):

1. **Implicit CTA via "tag / save / send"** — highest engagement lift; reads as community behavior, not selling.
   - *"Tag a mama in this season"* — @mamalinc
   - *"Send this to your manager"* — @josceljames

2. **Permission-asking conditional** (mirrors `user_script_voice/PATTERNS.md` #16) — *"If you want [outcome], [action]"*.
   - *"If you want me to review your situation... text or call me"* — @themortgagefox

3. **Comment-keyword DM funnel** — *"Comment WORKSHOP and I'll send you the link"* — appears in 11% of 5-10x captions and 14% of 25x+ (so it can work) BUT skews toward "free-stuff-for-leads" creators (mommy.labornurse, newparentsacademy, zanderfryer). Coach Roster's stance is referral, not lead-gen — **avoid this form.**

4. **Direct "link in bio" / "check link"** — appears in 22% across all bands; neutral signal. Useful for the coach's website link.

5. **"Apply for 1:1 coaching"** — high frequency in fitness coach posts but lowest engagement rate. **Avoid for Coach Roster.**

**Coach Roster's specific CTA:** the video tells you to "go and find [Coach]"; the caption can house the actual link/handle. The caption CTA pattern that fits is: third-party referral handle/URL on its own line, optionally preceded by `→` or `↓`.

---

## 7. AI-tells & dead phrases to ban

Found in the lowest-engagement quartile of our 5-10x band (signals of LLM-written captions or generic ad-copy):

**Banned phrases / patterns:**
- *"Let's dive in"* / *"Let's break it down"* / *"Buckle up"* — zero appearances in 25x+ captions
- *"In today's fast-paced world..."* — zero appearances in any band; pure template-speak
- *"Unlock your potential"* / *"Level up your life"* / *"Transform your..."* — appears 11 times in 5-10x, twice in 25x+, both ironic
- *"Game-changer"* / *"Mind-blowing"* / *"Insane"* (uppercase) — overused in 5-10x; cumulative emoji-hype reads as ad
- Em-dash everywhere — interesting empirical finding: heavy em-dash captions (>3 per caption) appear in 4% of 5-10x band but 0% of 25x+ band. Could be small-sample noise; treat as soft signal that excessive em-dashes read AI-generated.
- *"Stay tuned"* / *"More to come"* / *"Don't forget to like and subscribe"* — instant TikTok-of-2019 AI-tell
- *"Comment below 👇"* WHEN paired with no actual question — empty engagement bait
- *"As [profession/role], I [credential drop]"* — appears in 18 lower-engagement captions; the "as a" opener signals self-promotion and self-importance simultaneously

**Punctuation tells:** captions that contain *both* `—` AND `•` AND multiple `*` emphasis appear in 9 low-engagement posts and 0 25x+ posts. The "polished" formatting reads as AI-curated.

---

## 8. Ten reusable templates for Coach Roster

Each template targets the channel's structural arc: **hook → name the coach → counterintuitive insight → CTA to go find them**.

The bracketed slots are: `[HOOK]` (the counterintuitive claim, ≤7 words), `[COACH]` (full name), `[ONE-LINE INSIGHT]` (the mechanism in plain English), `[MECHANISM]` (the why), `[LINK]` (coach's website or @handle), `[BROAD-NICHE-TAGS]` (3-5 hashtags max).

---

### T1 — The declarative-claim opener (highest-frequency archetype, §2 C1)

```
[HOOK — 4-7 word counterintuitive claim].

[COACH] explains why: [ONE-LINE INSIGHT].

Go find [COACH] → [LINK]

#coachroster #[broad] #[niche]
```

**Filled (Jeffrey Shaw):**
```
Never apologize for cost.

Jeffrey Shaw explains why: wealthy clients use your pricing posture as a 5-second trust test — soften on price, and you've already failed it.

Go find Jeffrey Shaw → jeffreyshaw.com

#coachroster #luxurycraft #pricingpsychology
```

---

### T2 — The "Most people think X. Actually Y." pivot (§2 C2)

```
Most people think [COMMON BELIEF].

[COACH] flips it: [ONE-LINE INSIGHT].

[ONE-SENTENCE MECHANISM].

→ [LINK]
```

**Filled (Jenny Evans):**
```
Most people think stress is a thinking problem.

Jenny Evans flips it: stress is chemistry — your thoughts are downstream of cortisol, not the other way around.

Sixty seconds of the right physiological reset will do more for your stress than an hour of journalling.

→ jennyevans.com
```

---

### T3 — The named-framework reveal (§2 C3)

```
[COACH] calls it the [FRAMEWORK NAME].

It works like this:
1. [STEP 1, imperative verb]
2. [STEP 2]
3. [STEP 3]

[ONE-SENTENCE WHY IT WORKS].

Find [COACH] → [LINK]
```

**Filled (Jeff McCarthy / On-Purpose):**
```
Jeff McCarthy calls it the Two-Word Purpose.

It works like this:
1. Pick one verb you can't stop doing
2. Pair it with the one noun you're built to serve
3. That's your purpose — two words, no paragraph

Once you have it, every decision either rolls toward those two words or away from them.

Find Jeff McCarthy → on-purpose.com
```

---

### T4 — The lived-moment conditional (§2 C5)

```
If you've ever [SPECIFIC LIVED MOMENT — visceral, gut-level],

then you need to hear what [COACH] says about it:

[ONE-LINE INSIGHT].

→ [LINK]
```

**Filled (Awaken Coach Institute):**
```
If you've ever sat in a corporate job and felt like pieces of you were slowly going missing,

then you need to hear what Awaken Coach Institute says about it:

The job isn't draining you. It's training you to stop noticing what you've lost — and the only fix is rebuilding the part that does the noticing.

→ awakencoachinstitute.com
```

---

### T5 — The one-stat anchor (§2 C4)

```
[STAT WITH SPECIFIC NUMBER].

That's the number behind [COACH]'s [METHOD/CLAIM]:

[ONE-LINE INSIGHT].

→ [LINK]
```

**Filled (Jenny Evans — substitute real number from her research before posting):**
```
60 seconds.

That's the window Jenny Evans uses to interrupt a cortisol spike before it locks into your day:

Three rounds of paced breathing during your worst meeting, and the chemistry shifts faster than the situation does.

→ jennyevans.com
```

---

### T6 — The quoted-pivot (§5 archetype 1 + §2 C3)

```
"[VERBATIM QUOTE FROM COACH — 8-15 words]."

— [COACH]

[ONE-SENTENCE GLOSS THAT MAKES THE QUOTE LAND].

Find them → [LINK]
```

**Filled (ThigPro):**
```
"The more you label it, the more you rehearse it. The more you rehearse it, the more you become it."

— ThigPro

Stop naming your feelings out loud. You're not processing them, you're casting yourself in them.

Find them → thigpro.com
```

---

### T7 — The credible-witness referral (mirrors `user_script_voice/PATTERNS.md` #24)

The whole caption written in third-person — narrator recommending the coach, never claiming the coach's authority as their own.

```
I keep sending people to [COACH].

Here's why: [ONE-LINE COUNTERINTUITIVE INSIGHT].

Most coaches in this space [CONVENTIONAL WISDOM]. [COACH] does the opposite — and it works because [MECHANISM].

→ [LINK]
```

**Filled (Jen Moff):**
```
I keep sending people to Jen Moff.

Here's why: your airtight, fully-argued case is what's making the room dismiss you.

Most executive-communication coaches teach you to argue better. Jen teaches you to argue less — because once you've covered every angle, you've signalled to the room that they couldn't have figured it out themselves, and now they want to push back just to feel useful.

→ thejenmoff.com
```

---

### T8 — The loop-opener tease (§2 C9 + §5 archetype)

For when the video's payoff is the whole point and the caption should NOT spoil it.

```
[COACH] said one thing in 60 seconds that flipped how I think about [TOPIC].

It's at [TIMESTAMP] if you're impatient.

→ [LINK]
```

**Filled (ThigPro):**
```
ThigPro said one thing in 60 seconds that flipped how I think about emotional regulation.

It's at 0:34 if you're impatient.

→ thigpro.com
```

---

### T9 — The two-line "trust the video" (§2 C10)

For TikTok-side posting. The video carries everything; the caption is a fingerprint.

```
[COACH] on [SUBJECT]. Go find them → [LINK]

#coachroster #[niche]
```

**Filled (Jeffrey Shaw):**
```
Jeffrey Shaw on why luxury craft pros lose wealthy clients. Go find him → jeffreyshaw.com

#coachroster #pricingpsychology
```

---

### T10 — The "save this for later" structural caption (§2 C6 + C7)

For Instagram-side, longer-form posts where the caption mirrors the video's skeleton.

```
Save this — you'll need it the next time [SPECIFIC SCENARIO].

[COACH]'s rule: [ONE-LINE INSIGHT].

Three things this changes:
→ [CONSEQUENCE 1]
→ [CONSEQUENCE 2]
→ [CONSEQUENCE 3]

When you're ready: [LINK]

#coachroster #[broad] #[niche] #[vibe]
```

**Filled (Jen Moff):**
```
Save this — you'll need it the next time you walk into a room where you have to win someone over.

Jen Moff's rule: stop building airtight cases. They make people feel inferior, and inferior people push back.

Three things this changes:
→ You stop over-preparing for the meeting
→ You start leaving room for the other person to "land" the idea
→ Your win-rate on hard rooms goes up because they think it was their idea

When you're ready: thejenmoff.com

#coachroster #executivecommunication #leadership
```

---

## 9. Anti-patterns specific to Coach Roster

The channel's stance: **third-party endorser** recommending a coach — never posed as the coach themselves, never posed as a peer-of-the-coach with equivalent authority. CLAUDE.md rule 11 (endorser stance, locked 2026-05-15) governs the *spoken* script; the caption layer must hold the same line.

**Caption anti-patterns that break the endorser stance:**

1. **First-person claims of expertise that belong to the coach.**
   - ❌ *"After 15 years of coaching founders, I've learned that..."* — that's the COACH's credential, not the narrator's
   - ✅ *"Jeff McCarthy spent 15 years coaching founders and landed on this..."*

2. **"We at [coach's brand] teach..."** — collapses the endorser into the brand
   - ❌ *"At Awaken Coach Institute, we believe..."*
   - ✅ *"Awaken Coach Institute teaches..."* / *"What Awaken Coach Institute is doing..."*

3. **"My method" / "my framework"** when referring to the coach's IP
   - ❌ *"My Two-Word Purpose framework..."*
   - ✅ *"Jeff McCarthy's Two-Word Purpose framework..."*

4. **DM-for-coaching / book-a-call CTAs**
   - ❌ *"DM me for 1:1 coaching"* / *"Apply for my mentorship program"*
   - ✅ *"Go find [Coach] → [their website]"*
   - The channel sends viewers AWAY to the coach's house, not into the channel's DMs.

5. **Self-praise** about discovering the coach
   - ❌ *"I'm so proud to bring you this brilliant coach"* / *"Honored to introduce..."*
   - ✅ *"[Coach] said something today that flipped how I think about [topic]"* — humbled-by-the-insight register, not host-praising-guest register

6. **Hashtags that suggest the channel teaches the topic**
   - ❌ *#mindsetcoach #lifecoaching #careeradvice* (positions @coachroster as a coach)
   - ✅ *#coachroster #[coach's niche] #findcoaches* (positions @coachroster as a curator)

7. **Heavy emoji / fire / hype openers** (🔥💯⚡)
   - 25x+ captions in our corpus use these sparingly. For an endorser-stance channel, heavy hype reads as the narrator selling, not reporting. Cap emoji count at 2 per caption.

8. **Replicated coach quotes WITHOUT attribution**
   - If you write the coach's insight in their own voice without "—[Coach]" or "[Coach] says:", the line reads as the narrator's. Always anchor verbatim quotes with attribution.

9. **The "comment KEYWORD for the link" funnel pattern**
   - Coach Roster's link is the coach's website — visible, public, in the bio or the caption. The DM-funnel pattern hoards leads INTO the channel; the channel's whole value prop is sending viewers OUT.

10. **Generic-authority appeals**
    - ❌ *"Studies show that..."* / *"Research proves..."* / *"Experts agree..."*
    - ✅ *"[Coach] cites the [specific study / specific number / specific framework name]..."*
    - The whole channel's edge is naming a SPECIFIC person with a SPECIFIC idea. Generic-authority captions undercut that.

---

## How to use this file

Before writing a Coach Roster caption:
1. Identify the video's archetype (T1-T10).
2. Draft the caption using the template's slot structure.
3. Pass it through §9 anti-pattern check.
4. Confirm: zero or ≤5 hashtags (footer-stacked), ≤2 emojis, opener is a flat declarative or named-quote, third-person referral throughout, link is the COACH's link.

Re-read this file when a new pattern emerges across 2+ posts — update the section in place and note the date.
