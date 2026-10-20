# Avatar Prompting Guide — photorealism, IVP-derivation, anti-uncanny

Avatar relatability is the single biggest creative quality lever in
advertising — bigger than script, bigger than production. A great script
delivered by a generic AI-influencer face converts a fraction of the same
script delivered by someone the IVP would actually trust. We've been under-
investing here for too long.

This guide enforces three pillars:

1. **Derive from vision.md, not company.json.** Avatar is a casting
   decision driven by the IVP, not a portrait of "the brand."
2. **Photorealism + skin texture (anti-uncanny).** Default seedream output
   skews symmetric, plastic-skinned, AI-influencer. Force it off the
   attractor with a non-negotiable scaffold.
3. **Background as credibility.** Where the avatar sits is a load-bearing
   trust signal. Generic beige rooms are anti-credibility.

Read this cover-to-cover the first time. Re-read §1, §2, §6 every job.

---

## 0. Prerequisites — vision.md fail-fast

You cannot cast an avatar without a strategy. Before you write a single
prompt, verify these vision.md fields exist (CLAUDE.md rule 11):

- [ ] **IVP** — named character with age, life-stage, emotional moment.
- [ ] **Core drive** — control / status / approval / belonging / etc.
- [ ] **Position** — mentor / credible-witness / peer / aspirational-self.
- [ ] **Lore positioning** — what the company stands for.

If any is missing, STOP and fill it in before continuing. The avatar's
casting decisions all derive from these.

---

## 1. Derive from vision.md, not from company.json

The avatar is a casting decision. You cast based on **who the IVP would
trust as the messenger of this script**, not based on what the company
sells.

Re-read `<job_dir>/vision.md` BEFORE writing any character_sheet. The
fields that drive avatar decisions:

| vision.md field | Avatar decision it drives |
|---|---|
| **IVP** (age, life-stage, emotional moment) | Avatar's age, gender expression, cultural register. Aspirational distance: ~5y ahead of IVP for "the friend who's been there"; +10-15y for mentor; same age for peer |
| **Core drive** | Energy register (warm-confiding for approval, sharp-authoritative for control, dry-amused for status, earnest-vulnerable for survival) |
| **Position** | Archetype: mentor / witness / peer / aspirational-self (see §3) |
| **Lore positioning** | Wardrobe-as-position, setting-as-credibility, posture, micro-expression |

**Coherence test.** For every avatar choice, you must be able to write the
sentence: *"This avatar exists this way because [vision.md field] requires
[specific choice]."* If you can't write that sentence, you're casting
from vibes, not vision.

---

## 2. The photorealism scaffold (anti-uncanny)

The single biggest move: force seedream off the AI-influencer attractor.
Default output trends symmetric, plastic-skinned, generically attractive.
Reads as "AI-generated content" within 2 seconds. Kills trust.

### 2.1. The prompt template (use verbatim structure)

```
Frontal, centered ultra-realistic close-up from top of head to just below
shoulders, of a [AGE]-year-old [ETHNICITY/NATIONALITY] [MAN/WOMAN].
[HAIR TYPE], [HAIR COLOR]. [SKIN TONE] skin showing super realistic
pores, fine texture, [SPECIFIC IMPERFECTION — see §2.2].

Wearing [SPECIFIC WARDROBE — see §5]. Posture [UPRIGHT / RELAXED /
LEANING SLIGHTLY FORWARD]. Expression [SPECIFIC — see §4].

[SETTING — see §6 — name 3+ specific objects visible]. Background softly
blurred. [LIGHTING — see §7].

Shot on Canon EOS R5, 85mm portrait lens, shallow depth of field,
photorealistic RAW. High-resolution skin texture with extreme detail.

Avoid: plastic skin, symmetric face, airbrushed look, HDR sheen, stock-
photo quality, AI-influencer aesthetic, over-saturated colors.
```

Target length: 80–150 words. Shorter loses specificity. Longer stacks
conflicting instructions.

Per the official Seedream 4.5/4.0 guide: prefer concise natural language
over ornate vocabulary. Each adjective earns its place; don't pad.

### 2.2. Specific imperfection — mandatory slot

Real-trustworthy people are asymmetric. Default seedream output is
symmetric. **You MUST name a specific imperfection in the prompt** — at
least one — or the model snaps back to the plastic-face attractor.

Pick at least ONE per avatar. Two or three is better when truthful.

**Skin texture imperfections:**
- Light freckles across the bridge of the nose
- Dense freckles across both cheeks
- Visible pores (always include — works for all ages and skin tones)
- Subtle under-eye shadows (real-person look, not bags)
- Faint laugh lines around the eyes (30+)
- Slight skin redness / natural flush across cheeks
- Visible peach fuzz / fine facial hair on the upper lip or jaw
- Small acne scars (light, not severe)
- Dry patches around the corners of the mouth
- Beauty mark / single mole (cheek, above the lip, on the jawline)

**Asymmetries:**
- Asymmetric smile (one corner of the mouth lifts higher)
- Slightly crooked nose (real-person nose, not a sculpted one)
- Subtle different-sized eyes
- Asymmetric eyebrows (one slightly higher than the other)
- Slightly crooked front tooth visible when smiling
- Cowlick / asymmetric hair part

**Marks:**
- Small scar above the left eyebrow
- Small scar on the chin / cheek
- Faint vaccination mark on the upper arm (if shoulder visible)

**Hair texture:**
- 2-day stubble (men) — natural, not styled-stubble
- Single grey strand at the temple (younger)
- Greying at the temples (older)
- Slight cowlick / not-perfectly-styled
- Slightly damp, freshly-washed look

**Other:**
- Slightly chapped lips (not perfectly glossy)
- Subtle eye veins / slightly tired eyes
- A small piercing (single stud earring, nose stud) when culturally apt

The imperfection must be **named verbatim in the prompt**, not implied.
*"a slightly imperfect face"* doesn't work. *"light freckles across the
bridge of the nose and asymmetric smile lines"* works.

### 2.3. Skin texture language — mandatory phrases

Always include all three of these phrases verbatim:

1. `"super realistic pores"` — locks pore detail
2. `"fine texture"` — prevents skin smoothing
3. `"high-resolution skin texture with extreme detail"` — locks the
   technical specification at the end

These are the phrases that consistently produce real-skin output across
seedream versions. Don't paraphrase.

### 2.4. Camera-spec language — mandatory

The line that locks photorealism (use verbatim):

> Shot on Canon EOS R5, 85mm portrait lens, shallow depth of field,
> photorealistic RAW.

**Alternatives** (pick ONE per avatar; reuse across all variants for
visual continuity):

| Camera spec | When to use |
|---|---|
| Canon EOS R5, 85mm portrait lens, shallow DOF, photorealistic RAW | Default — flatters most subjects, classic portrait look |
| Sony A7R V, 50mm f/1.4, natural light, no retouching | Slightly more "real" / documentary feel |
| Hasselblad medium format, soft natural light, RAW capture | Editorial / high-end mentor avatars |
| Documentary photography, 35mm lens, available light | Peer / vulnerable / behind-the-scenes feel |

**Why camera-spec works:** seedream's training corpus includes real
photographs tagged with camera metadata. Naming the camera invokes the
photographic prior over the digital-render prior.

### 2.5. Negatives — mandatory at end of every prompt

Append verbatim at the very end:

> Avoid: plastic skin, symmetric face, airbrushed look, HDR sheen, stock-
> photo quality, AI-influencer aesthetic, over-saturated colors.

These are documented failure modes — the model defaults toward them
unless explicitly told not to. Skipping the negatives is the most common
reason a generated avatar reads "AI."

---

## 3. Position → avatar archetype

The vision.md **Position** field selects the archetype. Each maps to a
different casting decision.

### 3.1. Mentor (default for B2B coaches, professional services, B2B
agencies)

The avatar is older than the IVP, has visible cues of expertise, warm-
confiding energy. The viewer thinks: *"This person has figured out what
I'm trying to figure out."*

- **Age:** +10 to +15y from the IVP.
- **Energy:** warm-confiding, settled, slightly amused.
- **Wardrobe:** elevated-casual (well-fitting cardigan, tailored knit,
  blazer over a t-shirt, simple linen shirt). Never a full suit unless
  the niche demands it.
- **Setting:** modern home office, bookshelf, framed art, plant.

### 3.2. Credible-witness (medical, legal, financial, technical)

The avatar is a domain insider with visible credentials. The viewer
thinks: *"This person has standing to say this."*

- **Age:** ~peer-aged but with seniority cues (35-50).
- **Energy:** neutral-confident, evidence-based, slight earnestness.
- **Wardrobe:** position-specific (white coat, scrubs, tailored suit,
  blazer with subtle credential signal). Specificity matters — "white
  coat" beats "professional clothing."
- **Setting:** clinical, legal-office, or institutional with diploma
  frames, anatomy poster, leather-bound books, framed credentials.

### 3.3. Peer (founder content, lifestyle commentary, observational
takes)

The avatar is the same age range as the IVP. The viewer thinks: *"This
person is in the same boat I'm in — but they're paying attention."*

**Critical constraint:** the avatar lacks authentic peer history.
**NEVER use "I tried this", "I struggled with X", "when I was your age"**
— these read inauthentic because the avatar is generated. Peer voice
only works when dialogue is OBSERVATION or COMMENTARY, not testimony.

- **Age:** matches IVP (±3y).
- **Energy:** dry-observational, slightly amused, "we're noticing this
  together."
- **Wardrobe:** matches what the IVP would actually wear (casual founder
  in coworking gear, lifestyle creator in soft sweater, etc.).
- **Setting:** matches IVP's habitat (coworking nook, lived-in living
  room, kitchen counter with coffee).

### 3.4. Aspirational-self (fitness, lifestyle, personal-finance for
late-20s/30s)

The avatar is the IVP 5 years from now — same demographics, but the
"figured-it-out" version. The viewer thinks: *"This is what it looks like
when I've solved this."*

- **Age:** +5y from IVP.
- **Energy:** content, settled, slightly behind-the-scenes / casual.
- **Wardrobe:** elevated version of what the IVP would wear (post-
  workout casual for fitness, soft cashmere for lifestyle, lived-in
  designer for late-20s creatives).
- **Setting:** the IVP's current habitat but slightly upgraded — same
  kind of place, more put-together.

---

## 4. Energy register

Match the avatar's expression + posture + framing energy to the script's
delivery tone. The script's tone derives from the **core drive** in
vision.md.

| Core drive | Energy register | Expression | Posture | Framing |
|---|---|---|---|---|
| Control / status | Sharp-authoritative | Direct gaze, slight smirk, settled jaw | Upright, slight forward lean, hands engaged | Tight close-up, eye contact, slight low angle |
| Approval / belonging | Warm-confiding | Quiet smile, soft eyes, slight head-tilt | Relaxed, open chest, hands visible | Medium close-up, slight 3/4 angle |
| Survival / safety | Earnest-vulnerable | Neutral-to-soft, eyes briefly down then up | Open, hands visible, slight shoulder relaxation | Wider, room context visible, eye level |
| Reproduction / desire | Wry-playful | Half-smile, raised eyebrow, knowing eyes | Casual, slight back-lean, hands relaxed | 3/4 angle, slightly lower light |
| Money / freedom | Dry-amused | Knowing settled smile, slight sparkle | Settled, hands relaxed in front | Medium, environment visible |

Pick ONE register per avatar. The energy lock is what makes the avatar
feel like a coherent person across multiple chunks rather than a
randomized model.

---

## 5. Wardrobe as position

Wardrobe is one of the loudest position signals. Match it to the position
from §3 AND the lore positioning from vision.md.

**Three rules:**

1. **Specific item, not category.** Not "professional clothing" — *"a
   well-fitting navy cardigan over a white tee"* or *"a tailored grey
   blazer over a black shell, no tie."*
2. **One specific accent.** Tortoiseshell glasses, simple gold chain,
   minimalist watch, single stud earring, scarf, lapel pin. ONE — more
   reads as costume.
3. **Niche-coherent.** Doctor wears white coat or scrubs, never a blazer.
   B2B founder wears casual-elevated, never a full suit. Coach wears warm
   and intentional, never sales-y polish.

**Wardrobe library by archetype:**

- **Mentor:** well-fitting cardigan over tee; tailored knit sweater;
  blazer over a t-shirt; linen shirt with rolled sleeves; soft
  cashmere crewneck.
- **Credible-witness (medical):** clean white coat over scrubs; visible
  stethoscope; subtle ID badge.
- **Credible-witness (legal/financial):** charcoal or navy tailored
  blazer; oxford shirt unbuttoned at the collar; subtle tie or no tie.
- **Peer (founder):** soft sweatshirt, t-shirt under a worn flannel,
  technical fleece, hoodie that fits well.
- **Aspirational-self (fitness):** post-workout tank or zip-up; clean
  athleisure; subtle activewear branding.
- **Aspirational-self (lifestyle):** soft cashmere; oversized shirt;
  lived-in designer pieces.

---

## 6. Background as credibility (the most underweighted lever)

A neutral beige room is anti-credibility. The setting must implicitly say
*"this person is in the right place to be saying these things."*

### 6.1. Setting categories per niche

| Niche | Default setting | Specific named props (3+) |
|---|---|---|
| B2B / consulting / coaching | Modern home office | Walnut shelf with a small terracotta snake-plant pot, a brass desk lamp, a folded grey wool throw on a chair arm, an unframed canvas on the wall (no text) |
| Lifestyle / personal coaches | Warm living room | Neutral linen sofa, soft throw pillow, ceramic vase with eucalyptus, abstract textile wall hanging, woven basket |
| Medical / clinics | Examining room or clinical office | Stethoscope on the desk, tongue-depressor jar, blood-pressure cuff hung on the wall, anatomy model (3D bust, not a poster), soft-blue pastel wall |
| Legal / financial | Wood-tone office | Brass desk lamp, single fountain pen on a leather blotter, a small brass scales-of-justice statuette, a folded newspaper face-down, a wood-paneled wall |
| Fitness / parenting | Lived-in home | Kitchen counter visible, well-used ceramic coffee mug, water bottle, soft-grey kitchen towel, a small bowl of fruit |
| Real estate | Property interior | Architectural feature (exposed beam, large window, fireplace), staged side table with fresh-cut flowers, a small sculptural vase, a wool throw |
| E-commerce / founders | Coworking nook or kitchen-table | MacBook (closed), aluminum coffee mug, monstera plant, AirPods case, a small ceramic dish |
| Wine / spirits / hospitality PR | Tasting room or warm office | A clean stemmed wine glass, an empty decanter, a wood-handled sommelier knife on the desk, a wine barrel detail or wood paneling visible, a small ceramic vessel — NEVER labeled bottles, magazines, books, or framed regional maps |

### 6.2. Specificity beats neutrality — the 3+ named props rule

A SPECIFIC setting with named props beats a generic "professional
background" every time. **If you can't name 3 specific objects visible in
the background, it's not specific enough.**

> ❌ "Neutral home office background, professional, soft lighting."
>
> ✅ "Warm cream-and-walnut shelf behind, half-visible: a small terracotta
> pot with a snake plant, a brass desk lamp, a folded grey wool throw, an
> unframed abstract canvas."

The viewer doesn't read each prop consciously — but the brain registers
*"this is a real place"* and credibility lifts.

### 6.3. NO LEGIBLE-TEXT PROPS — the AI-tell rule (mandatory)

**Never put a prop in the background that's supposed to have legible text on
it.** This includes:
- Books with visible spines / titles / author names (bookshelves are the #1
  offender — Wine Spectator, Cal Newport titles, Bob Moesta books, leather-
  bound legal volumes, *The World Atlas of Wine*, etc.)
- Magazines or newspapers with readable headlines
- Framed certificates / diplomas / awards
- Framed regional maps with place-name labels (e.g. *"MÉDOC"*, *"NAPA VALLEY"*)
- Wine bottles with visible labels (label angled away from camera or shape-
  only is fine)
- Posters with text (anatomy posters, motivational posters, movie posters)
- Whiteboard or notebook with readable writing
- Computer screen with visible text
- Mug or t-shirt with a brand logo

**Why:** seedream cannot reliably render text. It produces near-words —
*"WORLD ATL IS OF WIN"*, *"MÉDCO"*, *"WINE SPECTOR"*, garbled author names,
nonsense Latin on diplomas. The viewer's brain reads the misspelling
instantly and the entire frame flips from *"this is a real place"* to *"this
is AI-generated."* It's the single most reliable AI-tell after plastic skin.

**Use credibility props that don't require text:**
- Physical tools-of-the-trade (stethoscope, sommelier knife, fountain pen,
  brass scales, microphone, paintbrush in a jar)
- Plants (snake plant, monstera, eucalyptus, fresh-cut flowers)
- Architectural texture (exposed brick, wood paneling, large window,
  fireplace, exposed beam)
- Lighting fixtures (brass desk lamp, pendant lamp, sconce)
- Soft goods (linen throw, wool blanket, woven basket, ceramic vase)
- Abstract art (unframed canvas, textile wall hanging, monochrome print —
  never with words)
- Domain-specific physical objects (wine glass, decanter, anatomy bust,
  3D printer, weights rack) — pick objects with shape/silhouette
  credibility, not text credibility

If a setting in §6.1 calls for a "book" or "magazine" or "framed credential",
swap it for a non-text equivalent. The credibility lift comes from
*"recognizable physical object in the right room"* — not from the viewer
reading a title.

### 6.4. The "right place" coherence test

For every setting, ask: *would the IVP expect to find this avatar in
this room?* A doctor in a modern home office reads off. A founder in a
clinical exam room reads off. The setting is part of the position
signal — match it to §3.

---

## 7. Lighting language

Always include explicit lighting in the prompt. Lighting is the highest-
leverage technical move after camera-spec.

**Defaults that work:**

- *"Soft natural daylight from a large window camera-left, warm afternoon
  tones, gentle falloff into the background"* (most flattering, default)
- *"Overcast natural daylight, even and flattering"* (when slight
  vulnerability is wanted)
- *"Warm afternoon golden-hour-adjacent light from camera-right"* (lifts
  the mood)
- *"Soft three-point studio lighting with the key from camera-left"*
  (formal/credible-witness)

**Avoid:**

- *"Dramatic lighting"* — too contrasty for talking-head
- *"Cinematic lighting"* — vague, the model defaults to teal-and-orange
  filter
- *"Studio lighting"* alone — defaults to flat and harsh
- *"Top-down light"* — reads as Zoom call, kills credibility

**Ratios that read real:** the key light should fall off into the
background, not flood it. A specifically-named direction (camera-left /
camera-right / behind-camera) anchors the look.

---

## 8. Variant strategy — which shots to mint

Default mint: `front` only. Add variants when the script demands them
(reference `agent/skills/seedance_prompting_guide.md` §5 for in-prompt
camera moves that don't need a new variant).

| Variant name | When to mint | Prompt focus |
|---|---|---|
| `front` | Always | The default — chest-up, 85mm, eye contact, full setting visible |
| `tight_close_up` | Confiding lines, vulnerable beats | Forehead-to-chin only, slight push-in feel, 50mm — drop the wider setting |
| `three_quarter` | Story telling, mid-script energy shift | 3/4 angle, eye still on camera, hands visible |
| `wide_with_context` | Setting reveal, lore beat | Pull back to show full setting — when the room IS the lore |
| `expressive` | Big emotional moment, payoff | Animated face, hands engaged, slight forward lean |

**Identity continuity:** every `--add-shot` is text-to-image (no image
input). Identity comes from RESTATING the character description verbatim
in every variant prompt. Pull from `seedance_anchor_description` and
adapt only framing/pose/expression. Same imperfection, same wardrobe,
same setting, same camera spec.

**Prefer in-prompt moves to new variants.** A slow push-in or pull-back
inside ONE Seedance chunk uses the same avatar URL across the whole
shot — strongest possible identity lock. Mint a new variant only when
the framing change can't be done in-prompt (a different room context, a
deliberate cutaway pose).

---

## 9. The character_sheet.json schema

After deriving from vision.md, the character_sheet has this structure:

```json
{
  "company": "<company name>",

  "avatar_vision": {
    "position": "mentor | peer | credible-witness | aspirational-self",
    "aspirational_distance": "+5y | +10y | same-age | +15y from IVP",
    "energy_register": "warm-confiding | sharp-authoritative | dry-amused | earnest-vulnerable | wry-playful",
    "trust_anchor": "ONE sentence: why THIS IVP would specifically trust this person as the messenger of this script",
    "specific_imperfection": "the named asymmetry/freckle/scar/etc — must appear verbatim in every prompt",
    "wardrobe_one_line": "the specific outfit + one accent",
    "setting_one_line": "the place + 3 specific named objects visible"
  },

  "character_description": "<2-3 sentences: age, ethnicity/nationality, hair type and color, skin tone WITH visible pores, the specific imperfection, the wardrobe, the setting>",

  "brand_alignment": "<one sentence: why this character fits the brand AND the IVP — cite vision.md fields>",

  "seedance_anchor_description": "<1-2 sentences used VERBATIM at the start of every Seedance prompt — must include the imperfection, wardrobe, and setting>",

  "prompts": {
    "front": "<full Seedream prompt using §2.1 scaffold — every mandatory phrase from §2.3, camera-spec from §2.4, negatives from §2.5>"
  },

  "avatar_byteplus_urls": {
    "front": "<populated by generate_avatar.py>"
  },
  "byteplus_urls_generated_at_utc": "<populated by generate_avatar.py>"
}
```

Variants beyond `front` are added on-demand via `generate_avatar.py
--add-shot <name>` and append to both `prompts` and
`avatar_byteplus_urls`.

---

## 10. The authoring checklist

Before running `generate_avatar.py`, every prompt must pass:

**Derivation (§1):**
- [ ] vision.md was Read in this conversation
- [ ] `avatar_vision.position` matches vision.md Position field
- [ ] `avatar_vision.energy_register` matches vision.md core drive (§4)
- [ ] `avatar_vision.aspirational_distance` is named explicitly
- [ ] `avatar_vision.trust_anchor` sentence written and credible

**Photorealism (§2):**
- [ ] Camera-spec language present verbatim (Canon EOS R5 / 50mm-85mm /
      shallow DOF / photorealistic RAW or §2.4 alternative)
- [ ] *"super realistic pores, fine texture"* appears verbatim
- [ ] *"high-resolution skin texture with extreme detail"* appears
      verbatim near the camera-spec
- [ ] AT LEAST ONE specific imperfection from §2.2 is named verbatim in
      the prompt (not implied — named)
- [ ] Negatives appear verbatim at the end (plastic skin, symmetric
      face, airbrushed, HDR sheen, stock-photo, AI-influencer)

**Position (§3):**
- [ ] Avatar archetype matches `avatar_vision.position`
- [ ] Age sits at the right aspirational distance from the IVP

**Energy (§4):**
- [ ] Expression + posture + framing match `avatar_vision.energy_register`

**Wardrobe (§5):**
- [ ] Specific named item (not a category)
- [ ] One specific accent detail named
- [ ] Wardrobe is niche-coherent

**Background (§6):**
- [ ] AT LEAST 3 specific objects visible behind subject (not "decor"
      → "a small terracotta pot with a snake plant, a brass desk lamp,
      a folded grey wool throw")
- [ ] Setting matches niche category from §6.1
- [ ] **NO legible-text props (§6.3):** no books with visible spines/titles,
      no labeled magazines, no framed maps with place names, no diplomas,
      no labeled bottles, no posters with text. Use physical objects with
      shape credibility, not text credibility
- [ ] Negatives include text-leak guards: *"Avoid: text on books, readable
      labels, garbled lettering, text in background, framed text"*
- [ ] "Right place" coherence test passes

**Lighting (§7):**
- [ ] Direction named (camera-left / camera-right / behind-camera)
- [ ] Tone named (warm / overcast / golden-hour / etc.)

**Variants (§8):**
- [ ] Default `front` minted
- [ ] Variants only minted when script demands them
- [ ] Identity-lock: same imperfection, wardrobe, setting, camera across
      all variants

If every box is green, run `generate_avatar.py`.

---

## 11. Reading the research

References behind any rule in this guide:

- Official Seedream 4.5 / 4.0 prompt guide — concise natural language,
  subject + action + environment, reference-image patterns. Embedded
  guidance throughout this skill (§2.1 prompt structure, §2 mandate to
  not stack ornate vocabulary).
- Photorealism-template patterns from advertising prompters — the camera-
  spec + skin-texture + named-imperfection scaffold (§2).
- `agent/CLAUDE.md` rule 11 — vision.md spec the avatar derives from.
- `agent/CLAUDE.md` rule 4 — BytePlus URL pipeline (operational, not
  craft).
- `agent/skills/seedance_prompting_guide.md` §5 — in-prompt camera moves
  that often replace the need for a new variant.

---

## 12. When stuck — the diagnostic ladder

If a generated avatar reads "off," walk this ladder in order:

1. **Does it read AI-influencer / plastic?** → §2 photorealism scaffold.
   Check that camera-spec, *"super realistic pores"*, the specific
   imperfection, and negatives are ALL in the prompt verbatim. The
   single most common failure: imperfection was implied, not named.
2. **Does it look credible-but-wrong-person?** → §1, §3 IVP derivation.
   The avatar may be technically photoreal but at the wrong aspirational
   distance or position. Re-check `avatar_vision.position` vs vision.md.
3. **Does the face read fine but the room reads wrong?** → §6 background
   specificity. The 3+ named props rule was probably skipped.
4. **Does it look right but feel cold?** → §4 energy register. Posture,
   expression, framing may be defaulting to neutral instead of the named
   register.
5. **Does it look right at chest-up but the wardrobe is generic?** → §5.
   Replace category words with specific items.

If the diagnostic fails on more than one rung, regenerate from scratch
rather than incrementally fixing — incremental edits to seedream prompts
tend to drift identity.
