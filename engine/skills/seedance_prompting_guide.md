# 🎬 Seedance 2.0 — Complete Prompting Master Guide

> Compiled from the EvoLinkAI official guide, the official Seedance prompt documentation, and top community resources. This is your single reference for writing production-quality Seedance 2.0 prompts.

## ⚠️ Pipeline tokens vs provider syntax

This guide was written for the Dreamina/CapCut UI, which uses `@Image1`,
`@Video1`, and `@Audio1`. In VideoClaw prompts, keep using the stable pipeline
tokens `[Image1]`, `[Video1]`, and `[Audio1]`. The gateway converts them to
Fal's `@...` syntax at the provider boundary, so workflows never need to know
which host runs the model.

Reference fields take URLs. The tool uploads local files through the gateway
and passes the resulting URLs to Seedance.

---

## Table of Contents

0. [**Default Pattern: Long Chunks + In-Prompt Framing Cuts (READ FIRST)**](#0-the-default-pattern-one-long-chunk-with-in-prompt-framing-cuts)
1. [Core Philosophy](#1-core-philosophy)
2. [The 6-Step Prompt Formula](#2-the-6-step-prompt-formula)
3. [The Shot-Script Format (Advanced)](#3-the-shot-script-format-advanced)
4. [The @Tag Reference System](#4-the-tag-reference-system)
5. [8 Camera Movements](#5-the-8-camera-movements)
6. [Speed, Style & Lighting Keywords](#6-speed-style--lighting-keywords)
7. [Negative Prompts & Quality Killers](#7-negative-prompts--quality-killers)
8. [Three Generation Modes](#8-three-generation-modes)
9. [Advanced Techniques](#9-advanced-techniques)
10. [Prompt Templates](#10-prompt-templates-ready-to-use)
11. [10 Major Capability Areas](#11-the-10-major-capability-areas)
12. [Common Mistakes & Fixes](#12-common-mistakes--fixes)
13. [Parameter Specifications](#13-parameter-specifications)
14. [Iteration Methodology](#14-iteration-methodology)
15. [Video Extension & Long-Form Chaining](#15-video-extension--long-form-chaining)
16. [Community Prompt Patterns](#16-community-prompt-patterns)
17. [Patterns from the Official Bytedance Doc](#17-patterns-from-the-official-bytedance-doc)
18. [Engine Failure Modes & Cut Grammar](#18-engine-failure-modes--cut-grammar)

---

## 0. The Default Pattern: One Long Chunk With In-Prompt Framing Cuts

> **Read this before anything else if you're writing a script for our pipeline.**

For talking-head and mixed-format short-form videos, the right unit is **one
Seedance generation per coherent voice block**, up to the model's 15-second
maximum, with framing changes scheduled INSIDE the prompt via timeline
segmentation. NOT many small 4-second chunks.

**Why:** every independent Seedance generation produces a slightly different
voice timbre, accent emphasis, lighting, and color grade. 7 short chunks =
6 micro-discontinuities the viewer subconsciously feels. 2 long chunks = 1
discontinuity. The math is brutal.

**The pattern (use this verbatim as a starting template for talking-head):**

```
{Anchor description from character_sheet.json — verbatim, 1 sentence}.
{Lighting — soft natural daylight from large window camera-left, ...}.

[00:00-00:03] Medium close-up, fixed camera. He speaks: "<line 1>"
[00:03-00:07] Cut to tight close-up, slight push-in. He speaks: "<line 2>"
[00:07-00:11] Cut to 3/4 angle, eyes still on camera. He speaks: "<line 3>"
[00:11-00:14] Pull back to medium close-up, gentle nod on the closing word.
              He speaks: "<line 4>"

Character details stay consistent across cuts. Natural multi-camera coverage.
Avoid jitter and bent limbs.
[Image1]
```

The `[Image1]` reference (front BytePlus URL) anchors identity for the WHOLE
chunk. The framing changes are guided by the timeline labels and "Cut to"
phrasing, not by switching photos mid-chunk.

**When NOT to use this pattern:**
- True B-roll cutaways with no dialogue (use a short ≥4s standalone chunk)
- Pure typography / kinetic-text beats (skip Seedance, use Remotion only)
- A deliberate hard cut to a different room or setting

**Word budget per long chunk** (use `pacing.py estimate`):
- 150 WPM × 15s ≈ 37 words
- 170 WPM × 15s ≈ 42 words
- 190 WPM × 15s ≈ 47 words

**Pipeline note:** `pacing.py validate` (default `--max-chunk-sec 15`) will
refuse any chunk longer than 5s that does NOT contain timeline-segmentation
language — this gate exists because the most common failure of the long-chunk
pattern is to write a 14s prompt that holds a single static framing.

See §9 for the full Multi-Camera Narrative spec and §10 Template 5 for the
canonical shot-script form.

---

## 1. Core Philosophy

**You are a director, not a describer.** Seedance 2.0 understands instructions the way a real director would speak them. Write your prompt like a shot list — describe the scene, the action, and the mood, not technical camera specs.

Seedance 2.0 is the industry's first model supporting **quad-modal input** (image + video + audio + text simultaneously). It uses a **Dual-Branch Diffusion Transformer** — one branch handles spatial information (what things look like), the other handles temporal information (how things move over time).

**Key insight:** Vague prompts force both branches to guess. Structured prompts feed both branches clearly, producing dramatically better results.

### What Seedance 2.0 Actually Understands

The model has built-in understanding of:

- **Physics accuracy** — objects fall, collide, and interact by real-world rules (fabric drapes, water splashes, dust rises)
- **Fluid motion** — natural movement with proper momentum and timing
- **Precise instruction following** — it executes complex multi-step prompts
- **Style consistency** — maintains visual coherence across all frames
- **Native audio** — generates sound effects, dialogue, and music synchronized to the visuals

This means you should **describe physical interactions**, not just appearances. "The tires smoke as the car drifts 90 degrees" gives the physics engine something to work with. "Car turns" doesn't.

### Edit vs. Reference — Know the Difference

When uploading an existing video, always be clear about your intent:

- **Edit** = modify the existing video directly (replace a character, remove an object, change the plot)
- **Reference** = extract a quality from the video (camera movement, motion style, rhythm) and apply it to new content

```
Edit:      "In @Video1, replace the woman with @Image1..."
Reference: "Reference @Video1's camera movement for a new scene..."
```

---

## 2. The 6-Step Prompt Formula

The officially recommended standard structure:

```
[Subject], [Action], in [Environment], camera [Camera Movement], style [Style], avoid [Constraints]
```

> **Required vs optional (per the official Bytedance Seedance 2.0 doc):**
> Only **Subject + Motion** are required — everything else is optional layering. Environment/Aesthetics define tone; Camera/Audio are advanced controls. Don't pad a prompt with all six just because the formula has six slots. If the shot is "a hand picks up a thermos," that's a complete prompt. Add layers only when they meaningfully change the output.

| Step | Element | Requirement | Example |
|------|---------|-------------|---------|
| **1. Subject** | Who/what | **Required.** Specific visual features | "A young woman in a white dress" |
| **2. Action / Motion** | What happens | **Required.** Specific verbs, quantified intensity | "Slowly turns around, breeze blowing the skirt" |
| **3. Environment** | Where | Optional. Lighting + atmosphere | "in a seaside at dusk, golden glow" |
| **4. Aesthetics / Style** | The feel | Optional. Specific visual references | "cinematic film tone, 35mm" |
| **5. Camera Movement / Cut** | How to shoot | Advanced. ONE primary camera instruction | "camera slow push-in" |
| **6. Audio** | Sound layer | Advanced. Ambient/dialogue/SFX for synced AV | "deep rumbling bass; voiceover: '...'" |

**Target length: 60–100 words.** Too short = missing details. Too long = conflicting instructions.

### Good vs. Bad Example

**✅ Good:**
```
A skateboarder lands a clean trick in an empty dawn parking lot,
camera low tracking shot then subtle rise, modern cinematic contrast,
6 seconds, 16:9, avoid jitter and bent limbs.
```

**❌ Bad:**
```
cool skateboard video, cinematic, fast, amazing tricks,
lots of movement, epic style
```

---

## 3. The Shot-Script Format (Advanced)

The highest-quality outputs use shot scripts. This is what top creators and viral videos use.

### Structure

```
【Style】Specific style anchor (director name / film style / art movement)
【Duration】Total length

[00:00-00:04] Shot 1: Shot Name (Camera Type).
Scene description with physical details.
Character action with specific body language.
Audio cue.

[00:04-00:07] Shot 2: Shot Name (Camera Type).
...

[00:07-00:10] Shot 3: Shot Name (Camera Type).
...

Consistency constraints. Physics requirements. Palette notes.
```

### Why It Works Better

1. **Temporal precision** — Timecodes tell Seedance exactly *when* each action happens. Without them, actions distribute unpredictably.
2. **Narrative arc** — Named shots force setup → discovery → payoff. The model generates more compelling motion with emotional progression.
3. **Physical grounding** — Details like "dust particles float in slow motion around the boots" give the physics engine concrete constraints.

### Full Shot-Script Example

```
【Style】Denis Villeneuve Sci-Fi Epic, IMAX 70mm, desaturated teal-orange palette.
【Duration】10 seconds

[00:00-00:04] Shot 1: The Scale (Extreme Wide Shot).
A lone astronaut in a white spacesuit stands at the edge of an enormous
crater on Mars. Red dust blows across the visor in gusts. The crater
stretches to the horizon — the scale of nature dwarfs the human figure
completely. Deep rumbling bass audio.

[00:04-00:07] Shot 2: The Discovery (Push-in to Close-up).
Camera slowly pushes from the wide shot into a tight close-up of the
astronaut's helmet visor. In the curved reflection, we see Earth — tiny,
blue, impossibly far away. The astronaut's breathing is audible.
Anamorphic lens flare streaks across the frame.

[00:07-00:10] Shot 3: The Decision (Low Angle, Static).
From below, the astronaut steps forward off the crater edge — a leap of
faith into the unknown. Dust particles float in slow motion around the
boots. Camera holds steady as the figure descends. Cut to black.

Consistent spacesuit design. Realistic Mars dust physics. Epic
orchestral audio swell on final shot.
```

> ⚠️ **Reflection caveat:** Shot 2's visor-reflection beat ("in the curved
> reflection, we see Earth") is a known risk pattern — community reports say
> reflection shots (visors, mirrors, blades, puddles) can break scene geography
> (§18.1). If a reflection beat matters to you, generate a one-variable probe
> first; otherwise prefer a direct cutaway (e.g., cut to Earth small in the
> black sky).

---

## 4. The @Tag Reference System

This is what makes Seedance 2.0 truly multimodal. When you upload files, each gets an automatic tag.

### Two Entry Modes

| Mode | When to Use | How It Works |
|------|------------|--------------|
| **First/Last Frame Mode** | Simple single-shot generation | Upload one image as starting point + text prompt. Quick and effective. |
| **Universal Reference Mode** (All-in-One Reference) | Full multimodal control | Combine images + videos + audio + text. This is where the real power lives. |

> ⚠️ **Dreamina UI Note:** Seedance 2.0 supports "First/Last Frame" and "All-in-One Reference" entry points only. "Smart Multi-Frame" and "Subject Reference" modes appear in the UI but **cannot be selected** with Seedance 2.0.

### Syntax Rules

| Type | Tags | Limit |
|------|------|-------|
| **Images** | `@Image1` through `@Image9` | Up to 9 |
| **Videos** | `@Video1` through `@Video3` | Up to 3 |
| **Audio** | `@Audio1` through `@Audio3` | Up to 3 |
| **Total** | — | ≤ 12 files combined |

Tags are assigned in **upload order** within each type.

> 🔑 **Golden Rule for References:** Always be specific about **which element** should be extracted from **which file**. Don't just mention the file — state its role explicitly. The model can extract motion, style, camera work, character appearance, audio rhythm, or effects from a single reference. Tell it which one you want.
>
> ```
> ❌ Use @Video1 for the scene
> ✅ Reference @Video1 for camera movement only. Character appearance references @Image1.
> ```

### 5 Ways to Use Image References

| Usage | Prompt Syntax | Effect |
|-------|--------------|--------|
| First frame | `@Image1 as first frame` | Video starts from this exact image |
| Last frame | `@Image1 as last frame` | Video ends at this image |
| Character ref | `@Image1 as character reference` | Preserves character look throughout |
| Environment | `@Image1 as background environment` | Uses image as scene setting |
| Style ref | `@Image1 as style reference` | Matches color palette, texture, mood |

### 4 Ways to Use Video References

| Usage | Prompt Syntax | Effect |
|-------|--------------|--------|
| Camera replication | `follow @Video1 camera movement` | Copies pan, tilt, zoom pattern |
| Motion imitation | `character moves like @Video1` | Transfers choreography/motion |
| Effect replication | `apply @Video1 transition effects` | Matches visual effects |
| Rhythm reference | `match @Video1 pacing and cuts` | Syncs timing and rhythm |

### 3 Ways to Use Audio References

| Usage | Prompt Syntax | Effect |
|-------|--------------|--------|
| Background music | `@Audio1 as background soundtrack` | Sets mood with uploaded music |
| Sound effects | `@Audio1 as ambient sound` | Adds specific sound effects |
| Voice style | `@Audio1 as voice style reference` | Matches vocal tone and cadence |

### Common @Tag Writing Patterns

```
# Specify first frame
Use @Image1 as the first frame of the scene, ...

# Reference camera movement only, not character
Reference all camera movement effects from @Video1,
but use the character appearance from @Image1

# Separate action and camera references
Reference character action from @Video1,
reference circular camera movement from @Video2

# First + last frame (AI fills the gap)
@Image1 as the first frame and @Image2 as the last frame

# Video extension
Extend @Video1 by 5s, [content description]

# Reference video sound effects
Background BGM references sound effects from @Video1
```

### File Allocation Strategy

| Use Case | Images | Videos | Audio | Total |
|----------|--------|--------|-------|-------|
| Product commercial | 4 (product angles) | 1 (camera ref) | 1 (music) | 6 |
| Character animation | 3 (character + scene) | 2 (motion ref) | 1 (music) | 6 |
| Music video | 2 (style + character) | 2 (dance ref) | 3 (tracks) | 7 |
| Multi-shot narrative | 6 (scene keyframes) | 1 (style ref) | 1 (music) | 8 |
| Max quality single shot | 9 (all angles) | 0 | 3 (audio layers) | 12 |

> **Tip:** Fewer, higher-quality references usually outperform many low-quality ones.

---

## 5. The 8 Camera Movements

Camera movement is the **single most effective way** to boost video quality.

| Camera Type | English Term | Effect | Best For |
|-------------|-------------|--------|----------|
| **Push-in** | push-in / dolly in | Camera moves toward subject | Close-up emphasis, emotional focus |
| **Pull-out** | pull-out / dolly out | Camera moves away to reveal | Environmental reveal, spatial context |
| **Pan** | lateral motion / pan | Horizontal movement | Tracking subjects, scanning scenes |
| **Tracking** | tracking shot / follow | Camera follows movement | Action scenes, walking characters |
| **Orbit** | orbit / arc | Camera rotates around subject | Product showcases, character portraits |
| **Aerial** | aerial / drone shot | High-altitude view | Landscapes, cities, grand scale |
| **Handheld** | handheld | Natural slight shake | Documentary style, realism |
| **Fixed** | fixed / locked-off | Camera stays completely still | Focusing on subject action |

### 🚨 Three Critical Camera Rules

**Rule 1: ONE primary camera instruction only.**
```
✅ camera slow push-in
❌ camera push-in, then pan left, zoom out, orbit around
```
If you need compound movement, describe primary then secondary:
```
✅ camera low tracking shot then subtle rise
```

**Rule 2: Use rhythmic descriptions, NOT technical specs.**
```
✅ slow, smooth, stable, gradual, gentle
❌ 24fps, f/2.8, ISO 800, focal length 85mm
```
"Describe the rhythm as if you're talking to an editor."

**Rule 3: Separate camera movement from subject movement.**
```
✅ The dancer spins slowly. Camera holds fixed framing.
❌ spinning camera around a dancing person
```
Mixing these is the #1 most common mistake → uncontrollable, shaky video.

---

## 6. Speed, Style & Lighting Keywords

### Speed Keywords

| Speed | Keywords | Effect |
|-------|----------|--------|
| Extremely Slow | imperceptible, barely | Almost unnoticeable movement |
| Slow | slow, gentle, gradual | Smooth and stable |
| Medium | smooth, controlled | Natural rhythm |
| Fast | dynamic, swift | High impact (**use with extreme caution**) |

> ⚠️ "Fast" is the keyword most likely to degrade quality. If you need speed, make only ONE element fast.

### Style Keywords

| Category | Keywords | Effect |
|----------|----------|--------|
| Cinematic | cinematic, film tone, 35mm | Classic movie aesthetic |
| Quality | 4K, high detail, sharp | High-definition |
| Film | film grain, analog, vintage | Retro texture |
| Tone | warm tone, cool palette, desaturated | Color bias |
| Atmosphere | moody, dreamy, ethereal | Emotional mood |
| Realism | realistic, natural, documentary | Realistic style |

### Lighting Keywords (HIGHEST LEVERAGE)

**If you can only add ONE element to improve quality, add a lighting description.**

| Keyword | Effect | Example |
|---------|--------|---------|
| golden hour | Warm golden tones | "soft golden hour lighting" |
| rim light | Highlights subject edges | "dramatic rim light against dark bg" |
| natural light | Natural illumination | "soft natural window light" |
| neon | Neon glow | "neon-lit rainy street" |
| backlit | Light from behind | "backlit silhouette at sunset" |
| overcast | Soft, diffused light | "even overcast diffused light" |

### Keyword-Triggered Special Effects

| Desired Effect | Recommended Writing |
|---------------|-------------------|
| Hitchcock zoom | `protagonist in panic with Hitchcock zoom` |
| Circular camera | `robotic arm multi-angle circular movement` |
| Accelerating speed | `speed accelerates like a roller coaster` |
| Particle effects | `golden sand particles scatter` / `particle dispersion effect` |

---

## 7. Negative Prompts & Quality Killers

### Essential Negative Prompts (Always Include)

| Negative Prompt | What It Excludes | Use Case |
|----------------|-----------------|----------|
| `avoid jitter` | Screen shaking | All videos |
| `avoid bent limbs` | Distorted limbs | Character videos |
| `avoid temporal flicker` | Temporal flickering | Long-duration videos |
| `avoid identity drift` | Subject feature drift | Character consistency |
| `avoid chaotic composition` | Messy composition | Complex scenes |

### Words That KILL Quality

| Dangerous Word | Why It's Risky | Use Instead |
|---------------|---------------|-------------|
| `fast` (alone) | Causes total chaos | Make only one element fast |
| `cinematic` (alone) | Too vague | "cinematic film tone, 35mm, warm" |
| `epic` | Model doesn't know what it means | Describe specific visual effects |
| `amazing` / `beautiful` | No practical guidance | Specific lighting + composition |
| `lots of movement` | Causes jitter | Describe one specific motion |

### Antislop Ban List

LLM-slop adjectives carry zero visual information and steer the model toward
generic output. Never use these in a prompt — replace each with a concrete
visual fact (a light source, a texture, a named physical action):

- **EN:** breathtaking, stunning, captivating, mesmerizing, awe-inspiring,
  masterfully, meticulously, exquisitely, beautifully crafted, cinematic
  masterpiece, visual feast, a symphony of, seamlessly, effortlessly,
  flawlessly, cutting-edge, state-of-the-art, next-level, rich tapestry,
  kaleidoscope of, elevate, unleash, groundbreaking, a testament to
- **ZH:** 令人叹为观止, 令人惊叹, 令人着迷, 精心打造, 匠心独运, 独具匠心,
  视觉盛宴, 光影交响, 完美呈现, 极致体验, 引人入胜, 震撼人心, 巧妙融合

---

## 8. Three Generation Modes

### Text-to-Video
Use the full 6-step formula. Describe everything.

```
A lone astronaut walks across an amber desert under twin moons,
camera slow lateral tracking, cinematic sci-fi tone, 8 seconds,
16:9, avoid temporal flicker.
```

### Image-to-Video
Don't re-describe what's in the image. Focus on **motion + camera**.

```
Animate the provided image, preserve composition and colors,
add gentle wind motion to the leaves, camera slowly pushes in,
keep consistent lighting, 6 seconds.
```

### Video-to-Video
Describe the **style transformation** while preserving motion.

```
Transform source clip to anime watercolor style,
preserve core motion and timing, adjust color palette to pastel,
keep identity consistent, avoid identity drift.
```

| Element | Text-to-Video | Image-to-Video |
|---------|--------------|----------------|
| Subject description | Must be detailed | Already in image, omit |
| Motion description | Full description | Focus on dynamic changes |
| Composition retention | Not applicable | Must emphasize "preserve" |
| Camera movement | Flexible | Must align with image composition |

---

## 9. Advanced Techniques

### Long Videos (10s+): Use Timeline Segmentation

```
0-3s: [description of opening]
3-6s: [description of middle action]
6-10s: [description of climax/ending]
```

### Actions & Emotions Must Be Specific

```
❌ character is very sad
✅ tears slide down cheeks, mouth trembles slightly
```

### One Continuous Shot

Always end your prompt with:
```
No scene cuts throughout, one continuous shot.
```

Full example:
```
@Image1 @Image2 @Image3, first-person one continuous tracking camera,
movement trajectory: from street through alley to rooftop,
speed gradually accelerates then slows at the peak.
No scene cuts throughout, one continuous shot.
```

### Character Consistency Across Multiple Videos

1. Use the **exact same reference image** every time via `@Image1 as character reference`
2. Include explicit appearance descriptors even with image ref: "same red jacket, short black hair"
3. Use last frame of video N as first frame image for video N+1

### Camera Movement Replication

```
Reference all camera movement effects from @Video1,
but use the character appearance from @Image1
```

If it doesn't replicate, strengthen with:
```
completely reference all camera movement effects from @Video1
```

### Video Extension

```
Extend @Video1 forward by 5s.
0-2s: [continuing scene description].
2-5s: [new action/ending].
```

Note: Duration = new seconds only, not total duration.

### Music Beat Sync

Upload audio and let the model sync visuals:
```
Background music references @Audio1. Visuals sync to the beat rhythm.
Camera cuts and movement changes align with musical beats.
```

### Video Merging (Insert Between Two Clips)

You can insert new content between two existing videos:
```
I want to add a scene between @Video1 and @Video2, with the content 
being [description of the bridging scene].
```

### Continuous Action Chains

For complex multi-step physical actions, describe the transition explicitly:
```
The character transitions directly from jumping to rolling, 
maintaining smooth and fluid motion throughout.
```

### Multi-Camera Narrative (Automatic Shot Coverage)

Seedance 2.0 can generate multiple camera angles within a single generation. Describe a conversation or scene, and the model creates proper shot-reverse-shot coverage, wide establishing shots, character close-ups, and medium shots automatically:
```
A conversation between two characters sitting across from each other 
at a cafe table. They discuss the plan with increasing tension. 
Natural multi-camera coverage with shot-reverse-shot editing.
Character details stay consistent across cuts.
```

### No Audio Reference? Use a Video's Sound Instead

If you don't have a separate audio file, you can reference the sound from an existing video:
```
Background BGM references the sound effects from @Video1.
```

---

## 10. Prompt Templates (Ready to Use)

### Template 1: Product 360° Showcase

```
@Image1 [product name] as the main subject,
camera movement references @Video1,
zoom in to close-up of [specific part],
camera rotates and [product] flips to show full view,
[product feature details] clearly visible,
surrounding environment [atmosphere description]
```

### Template 2: Advertisement Comparison

```
This is a [product] advertisement, @Image1 as the first frame,
[character A] in [state A, e.g.: elegant],
camera quickly pans right, shooting @Image2 [character B] [state B, e.g.: disheveled],
camera pans left and zooms in shooting [product],
[product] references @Image3, [product] in [working state].
```

### Template 3: Video Extension Script

```
[N]s
Extend @Video1 [forward/backward] by [N] seconds.
[0-X]s: [scene description].
[X-Y]s: [scene description].
[Y-N]s: [ending scene/subtitles].
```

### Template 4: One Continuous Shot

```
@Image1 @Image2 @Image3..., [perspective] one continuous shot [movement type] camera,
[movement trajectory: from A through B to C], [speed/rhythm changes].
No scene cuts throughout, one continuous shot.
```

### Template 5: Cinematic Racing Scene (Shot-Script)

```
【Style】Hollywood Professional Racing Movie (Le Mans Style), Cinematic Night, Rain, High Stakes.
【Duration】10 seconds

[00:00-00:03] Shot 1: The Veteran (Interior/Close-up).
Rain hammers the windshield of a high-tech race car on a night track.
Inside the cockpit, the veteran driver in a black helmet looks sideways
at his rival. Dashboard instruments glow green on his visor.
He gives a subtle nod and mouths 'Let's go.'

[00:03-00:06] Shot 2: The Challenger (Interior/Close-up).
Cut to the rival car. A younger driver grips the steering wheel with
white knuckles. Raindrops streak across the side window. Eyes wide with
adrenaline through the visor slit.
He whispers 'Focus' to himself.

[00:06-00:10] Shot 3: The Green Light (Wide Action Shot).
Starting lights turn GREEN. Both cars launch forward in sync on gleaming
wet asphalt. Massive water rooster tails spray behind them. Rain hits
the camera lens. Motion blur turns stadium lights into long golden streaks.

Consistent car designs. Realistic rain physics, water reflections.
Tension-building audio.
```

### Template 6: Anime Character Emotion

```
【Style】High-quality anime, Studio Ghibli-inspired, detailed facial expressions.
【Duration】12 seconds

[00:00-00:04] Shot 1: The Letter Arrives (Medium Close-up).
A young anime girl with long black hair sits by a sunlit window.
She holds an unopened envelope with both hands, turning it over carefully.
Her eyes show curiosity mixed with anticipation. Soft morning light.

[00:04-00:08] Shot 2: The Reading (Close-up on Face).
She opens the letter and begins reading. Her expression changes —
eyes widening with surprise, then a slow smile spreading.
Her lips part slightly as if to gasp.

[00:08-00:12] Shot 3: The Joy (Medium Shot, Slight Pull Back).
She clutches the letter to her chest and closes her eyes with happiness.
A single tear of joy rolls down her cheek. Cherry blossom petals drift
past the window behind her.

Consistent anime character design. Detailed emotional facial animation.
Natural lighting transitions.
```

### Template 7: Product Commercial (Image-to-Video)

```
@Image1 as first frame.
【Style】Premium product keynote, clean minimal aesthetic.
【Duration】15 seconds

[00:00-00:03] Rapid four-frame flash cuts — black, blue, white, rose gold
product variants appear one by one. Close-up on texture and finish.

[00:03-00:08] Extreme close-up of mechanism unfolding. Precision engineering
visible in slow motion. Studio lighting creates elegant highlights.

[00:08-00:12] Quick-cut lifestyle montage. Different users in different settings,
each wearing/using the product variant matching their aesthetic.

[00:12-00:15] All variants lined up on minimal white pedestal.
Brand text elegantly fades in at bottom.

Maintain exact product proportions from @Image1.
Commercial-grade lighting. Clean, premium aesthetic throughout.
```

### Template 8: ASMR / Sensory Content

```
Create a vertical ASMR video with no music, focusing on macro details.
A light blue skincare gel bottle sits on glass. A pale, elegant hand
gently taps the glass, producing crisp fingernail tapping sounds.
The hand picks up the bottle and slowly twists the cap, with the
rotation sound clearly audible. A spoon scoops a portion of gel and
drops it onto the glass with a soft "plop," showing dense gel with
tiny air bubbles. Dramatic cool lighting from behind makes the gel
glow like a gemstone. The hand presses onto the gel, spreading it
in circular motions, causing tiny bubbles to swirl.
```

---

## 11. The 10 Major Capability Areas

Based on the EvoLinkAI official guide, Seedance 2.0 excels in these 10 areas:

| # | Capability | Description |
|---|-----------|-------------|
| 01 | **Consistency Enhancement** | Face, clothing, product detail, text, and scene consistency across frames |
| 02 | **Camera Movement & Action Replication** | Replicate complex camera work and choreography from reference videos |
| 03 | **Creative Effects Replication** | Reproduce transitions, particle effects, style transforms from references |
| 04 | **Story Completion** | AI fills in narrative gaps from minimal images and audio input |
| 05 | **Video Extension** | Extend clips forward or backward with natural transitions |
| 06 | **Audio & Voice** | Realistic sound effects, accurate lip-sync, timbre replication |
| 07 | **One Continuous Shot** | Long unbroken shots with multiple image/video references |
| 08 | **Video Editing** | Script reversal, character swapping, precise local modifications |
| 09 | **Music Beat Sync** | Model understands rhythm and aligns visuals to musical beats |
| 10 | **Emotion Performance** | Nuanced facial expressions, body language, emotional timing |

---

## 12. Common Mistakes & Fixes

| # | Mistake | Why It Fails | Fix |
|---|---------|-------------|-----|
| 1 | Too vague ("nice video of dog") | Model guesses everything | Specify breed, action, camera, setting |
| 2 | Wrong @tag numbering | References non-existent file | Check upload order; tags start at 1 |
| 3 | No duration/resolution | Defaults may not match needs | Always specify in prompt AND parameters |
| 4 | Conflicting modalities | Image = day, prompt = "dark night" | Align prompt with reference content |
| 5 | Overloaded (200+ words) | Key instructions diluted | Keep under 150 words; use refs for visuals |
| 6 | No camera direction | Static or random movement | Add explicit: "slow dolly-in" or "static wide" |
| 7 | Realistic face uploads | Blocked by E005 face-detection moderation | Generate the face with `bytedance/seedream-5-lite` + `return_byteplus_urls=True` and pass the BytePlus URL — it's a trusted Seedance input. Otherwise use illustrated/stylized characters. |
| 8 | Exceeding file limits | Request rejected | ≤9 images, ≤3 videos, ≤3 audio, ≤12 total |
| 9 | No style anchor | Generic output | Anchor to director/film/art style |
| 10 | No timecodes | Unpredictable action timing | Use `[00:00-00:05]` format |
| 11 | Fast + fast + complex | Guaranteed jitter | Only ONE element can be "fast" |
| 12 | Camera + subject mixed | Shaky, incoherent footage | Describe each separately |
| 13 | Age markers on characters | Moderation tripwire (same family as E005) | Describe by role + wardrobe + action, never age — see §13 Compliance |

---

## 13. Parameter Specifications

### Input Limits

| Input Type | Formats | Quantity | Size Limit | Duration |
|-----------|---------|----------|-----------|----------|
| Image | JPEG, PNG, WebP, BMP, TIFF, GIF | ≤ 9 | < 30MB each | — |
| Video | MP4, MOV | ≤ 3 | < 50MB each | Total 2-15s |
| Audio | MP3, WAV | ≤ 3 | < 15MB each | Total ≤ 15s |
| Text | Natural language | — | — | — |
| **Combined** | — | **≤ 12 files total** | — | — |

### Output Specs

- Generated duration: **4-15 seconds** (freely selectable)
- Resolution: Up to **2K**
- Includes: Sound effects + background music
- Audio: Stereo, lip-sync in 8+ languages

### Compliance

- ❌ Does NOT support realistic human face photos uploaded as raw files (ByteDance suspended "Face-to-Voice" feature after privacy concerns — uploaded human reference inputs hit E005 face-detection moderation).
- ✅ **The escape hatch:** generate the face with `bytedance/seedream-5-lite` and pass `return_byteplus_urls=True`. The returned BytePlus URLs are recognised as **trusted inputs by Seedance 2.0** and bypass face-detection moderation. URLs expire after **24h**, so regenerate the avatar if your pipeline pauses overnight. This is exactly what `agent/tools/generate_avatar.py` does — the URL is stored in `character_sheet.json` under `avatar_byteplus_urls`, and `seedance.py` prefers it over a local upload.
- ✅ Other safe inputs: illustration style, AI-generated virtual characters, animals, products, scenes.
- ⚠️ Having reference videos costs more credits than image-only or text-only generations.
- ⚠️ **Age-blind character rule:** never describe characters by age, in any
  language. Trigger words: *boy, girl, child, kid, young, teen, little, 男孩,
  女孩, 孩子, 少年, 少女, 小孩, 年轻*. Age-marked characters are a moderation
  tripwire in the same family as the E005 face rule. Describe by **role**
  (rider, traveler, speaker), **wardrobe**, and **action** instead: "a figure
  in a wool cloak", not "a young boy".

### Post-Generation Tools (Dreamina UI)

After generating, you can refine without regenerating:

- **"Generate soundtrack"** — one-click to add/replace audio on your generated video
- **"Interpolate frames"** — smooths motion by adding interpolated frames between existing ones
- **"Regenerate"** — re-rolls the same prompt for a different result

### Platform-Specific Aspect Ratios

| Platform | Aspect Ratio | Notes |
|----------|-------------|-------|
| YouTube / landscape | 16:9 | Default for cinematic content |
| TikTok / Reels / Shorts | 9:16 | Add "vertical format, 9:16" to prompt |
| Instagram feed | 1:1 | Square format |
| Vintage / retro aesthetic | 4:3 | Classic TV ratio |
| Cinematic widescreen | 2.35:1 | Add "2.35:1 widescreen" to style line |

Always use the **same aspect ratio** across all clips when chaining extensions.

### Input Quality Recommendations

| Input Type | Minimum Quality | Why It Matters |
|-----------|----------------|---------------|
| Images | 1080p+ resolution, good lighting, sharp | Low-res or blurry images = low-res output |
| Videos | Stable footage, well-lit, clear action | Shaky/dark refs produce shaky/dark output |
| Audio | 256kbps+, clear without excessive noise | Muddy audio = poor beat sync and lip-sync |
| Asset count | Start with 2-4 assets, add more only if needed | More isn't always better — quality > quantity |

### Troubleshooting Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| Character changes between shots | Identity not locked | Add "maintain consistent facial features and clothing from @Image1 throughout entire video" |
| Motion doesn't match reference | Vague reference instruction | Be specific: "Exactly replicate the camera movement from @Video1, smooth tracking left to right" |
| Visuals don't hit audio beats | No sync instruction | Add "camera movements and transitions hit beats in @Audio1" + specify sync points |
| Visual style drifts mid-video | No style lock | Reference style multiple times: "Visual style from @Image1 applies to entire duration, consistent color grading" |
| Extension seams feel unnatural | Didn't describe starting state | Start extension prompt by describing the state at the end of the previous clip |

---

## 14. Iteration Methodology

### The "One Variable at a Time" Rule

1. **Baseline:** Generate 2-3 options with a standard prompt
2. **Adjust ONE element:** Camera angle, motion intensity, OR style — never multiple
3. **Score:** Rate continuity, instruction adherence, post-production usability
4. **Select:** Choose highest-scoring version
5. **Repeat:** Adjust next variable

### Three-Tier Template Management

| Tier | Purpose | Characteristics |
|------|---------|----------------|
| Starter | Quick direction validation | Short and precise |
| Production | Official delivery | Strict camera + consistency constraints |
| Fallback | For unstable output | Highly simplified, back to basics |

### Pre-Publishing Checklist

- [ ] Read entire prompt from non-author perspective
- [ ] Remove redundant adjectives
- [ ] Confirm only ONE primary camera instruction
- [ ] Ensure constraints are achievable
- [ ] Check for conflicts between style and motion
- [ ] Verify @tag numbers match upload order
- [ ] Include negative prompts (avoid jitter, bent limbs)
- [ ] Include at least one lighting description
- [ ] Confirm edit vs. reference intent is explicit for any uploaded video

### Real-World Creative Applications

| Use Case | Workflow |
|----------|---------|
| **Product line variants** | Generate one hero commercial → use video editing to swap the product for each SKU (different colors, sizes). Same camera work, 5 variants from 1 generation. |
| **Content localization** | Generate base video → use audio reference to re-generate with lip-sync dialogue in different languages. One shoot, many markets. |
| **Storyboard → video** | Upload storyboard panels as reference images → model understands shot composition, camera angles, and transitions directly from the drawings. |
| **Template-based series** | Find a viral video style → upload as reference → generate new content in that style with your own characters/products. Consistent series across episodes. |
| **Progressive scene building** | Generate a basic scene first → use element addition to place objects and characters one at a time. More controlled than specifying everything in one prompt. |
| **Fixing imperfect generations** | Video is 90% perfect but has a distracting element? Use element deletion to remove it rather than regenerating from scratch and losing everything that worked. |

---

## 15. Video Extension & Long-Form Chaining

> How to build videos longer than 15 seconds by chaining multiple generations together seamlessly.
> Source: Opus.pro Seedance extension guide + EvoLinkAI official documentation.

### The Core Concept

Seedance 2.0's generation window is **4-15 seconds per clip**. To create longer videos (30s, 60s, 90s+), you **chain extensions** — each generation continues smoothly from the previous output. The model analyzes the entire trajectory of the previous clip (movement, lighting, composition, style), not just the last frame, so extensions feel continuous rather than stitched.

There is **no hard limit** on how many extensions you can chain. Each one adds 4-15 seconds of new footage.

### The Chain Workflow

```
CLIP 1: Initial generation (text-to-video or image-to-video) → 15s
CLIP 2: Upload Clip 1 output as @Video1 → "Continue from @Video1..." → +10s
CLIP 3: Upload Clip 2 output as @Video1 → "Continue from @Video1..." → +10s
CLIP 4: Upload Clip 3 output as @Video1 → "Continue from @Video1..." → +10s
= 45 seconds of continuous video
```

### Critical Rules for Chaining

**Rule 1: Extension prompts describe ONLY what happens next.**
Never re-describe what already happened. Think of it as directing the next scene.

```
❌ "The man was walking through the city and now he enters a cafe..."
✅ "Continue from @Video1. The man pushes open the cafe door and steps inside. Warm interior lighting replaces the cool street light. Camera follows him to a table."
```

**Rule 2: Every extension prompt starts with the continuation command.**

```
Continue from @Video1. [new scene description]
```
or
```
Extend @Video1 forward by [N] seconds. [new scene description]
```

**Rule 3: Include explicit continuity instructions in EVERY extension.**

The model can drift over multiple chains. Fight this by reinforcing visual anchors:

```
Continue from @Video1. Maintain the exact same lighting angle, color 
temperature, and character appearance from the previous clip. [then 
describe the new action]
```

**Rule 4: Use the same aspect ratio across ALL clips.**
Mismatched ratios break seamless joins. If Clip 1 is 16:9, every extension must be 16:9.

**Rule 5: 3-6 extensions maintain excellent consistency.**
That gives you 30-90 seconds of total footage. Beyond 6 chains, drift risk increases — periodically re-anchor by referencing the original generation's visual properties or re-uploading the original character reference image.

### Extension Prompt Formula

```
Continue from @Video1.
[What happens next — new action, new camera direction, new elements]
[Continuity anchors — "maintain same lighting/character/style"]
[Duration: Ns]
```

### Long-Form Script Format (How I'll Write Multi-Clip Scripts)

When you ask for a video longer than 15 seconds, I'll deliver it as numbered clips:

```
════════════════════════════════════════
CLIP 1 — INITIAL GENERATION (15s)
Mode: Text-to-Video (or Image-to-Video with @Image1)
════════════════════════════════════════

[Full prompt with 【Style】【Duration】 and timecodes]

════════════════════════════════════════
CLIP 2 — EXTENSION FROM CLIP 1 (10s)
Mode: Upload Clip 1 output as @Video1
════════════════════════════════════════

Continue from @Video1. [new scene description]
Maintain exact same [lighting/character/style] from previous clip.

════════════════════════════════════════
CLIP 3 — EXTENSION FROM CLIP 2 (10s)
Mode: Upload Clip 2 output as @Video1
════════════════════════════════════════

Continue from @Video1. [new scene description]
Maintain exact same [lighting/character/style] from previous clip.

... and so on
```

### Your Workflow Step-by-Step

1. **Generate Clip 1** using the first prompt I give you
2. **Review it** — if it's good, download the output
3. **Upload that output** as @Video1 in a new generation
4. **Paste Clip 2 prompt** — this only describes what happens next
5. **Generate** — the model continues seamlessly from where Clip 1 ended
6. **Repeat** for each subsequent clip
7. **Join all clips** in your video editor (or they may already flow as one if extended in-platform)

### Advanced Extension Techniques

**Reference-Guided Extension:**
You can bring in a NEW reference video for camera movement while continuing from your base:
```
Continue from @Video1. Use @Video2 as a reference for the camera 
movement in this extension — replicate the spiral descent from @Video2 
while continuing the scene from @Video1.
```

**Style Evolution Through Extension:**
Deliberately shift mood across chains:
```
Continue from @Video1. The lighting gradually transitions from warm 
daylight to cool blue twilight as the camera pushes forward. The 
atmosphere becomes more mysterious. Maintain character appearance.
```

**A/B Branching:**
Generate Clip 1, then extend it in two different directions — one dramatic, one subtle. Same starting point, different endings. Test which works better before committing.

**Seamless Looping:**
For website background videos, extend with a prompt that returns to the starting composition:
```
Continue from @Video1. The camera completes the full orbit, returning 
to the exact same angle, lighting, and composition as the first frame 
of the original video to create a seamless loop.
```

### Video Editing (Modify Without Regenerating)

Beyond extension, you can also **edit existing clips** without starting over:

**Character Replacement:**
```
In @Video1, replace the woman with @Image1. Keep all camera movement, 
lighting, background, and timing exactly the same. Only the character 
identity changes.
```

**Element Addition:**
```
In @Video1, add @Image1 (a coffee cup) to the right side of the desk. 
It should be lit consistently with the existing scene. Everything else 
unchanged.
```

**Element Deletion:**
```
In @Video1, remove the plant from the left corner. Fill the area with 
a continuation of the wall. Keep everything else unchanged.
```

**Plot Subversion:**
```
Subvert the plot in @Video1. [describe the new narrative direction 
along a timeline: 0-3s / 3-6s / 6-9s...]
```

### Extension Duration Rules

- The duration you set = **new seconds generated**, NOT total duration
- If you extend a 10s video by 5s, you get 5s of new footage (total becomes 15s after joining)
- Use time markers within extensions for smoother transitions: "0-3s: [action] / 3-6s: [action]"
- Specify "extend forward" (continue after the end) or "extend backward" (add before the beginning)

### Drift Prevention Checklist

For chains longer than 3 extensions, include these in every prompt:

- [ ] "Maintain the exact same character appearance from the original"
- [ ] "Keep consistent lighting angle and color temperature"
- [ ] "Same visual style and color palette throughout"
- [ ] Re-upload the original character reference image as @Image1 if drift appears
- [ ] Keep aspect ratio identical across all clips

---

## Quick Reference Card

```
FORMULA:  Subject + Action + Environment + Camera + Style + Constraints
LENGTH:   60-100 words
CAMERA:   ONE primary instruction + pacing words (slow/smooth/gentle)
LIGHTING: Always include one lighting description (highest leverage)
NEGATIVE: "avoid jitter and bent limbs" on every character video
TIMECODES: Use [00:00-00:05] for videos > 5 seconds
STYLE:    Anchor to specific director/film/art movement
REFS:     @Image1-9, @Video1-3, @Audio1-3 (≤12 total)
ACTIONS:  Specific verbs, physical details, NOT abstract adjectives
SPEED:    Only ONE element can be "fast" at a time
PHYSICS:  Describe physical interactions ("tires smoke") not just appearance
SPECIFY:  State WHICH element to extract from WHICH file (motion/camera/style)
INTENT:   Always clarify "edit @Video1" vs "reference @Video1" — they're different
EXTEND:   "Continue from @Video1." + new scene + continuity anchors
CHAIN:    Max 15s per clip → chain 3-6 extensions for 30-90s total
DURATION: Extension duration = NEW seconds only, not total
DRIFT:    Re-anchor character/lighting/style every 2-3 extensions
CUTS:     Double contrast — every cut changes shot size AND camera mode (§18.2)
ANCHOR:   After a cut back into a space, restate who is where + facing (§18.2)
EXITS:    Left frame = gone — no exit + re-entry in one continuous shot (§18.1)
ONSCREEN: Off-screen = nonexistent — show state changes before referencing (§18.1)
AGE:      No age markers on characters, any language (§13 Compliance)
```

## 16. Community Prompt Patterns

> Compiled from the **EvoLinkAI/awesome-seedance-2.0-prompts** repo (164 curated community prompts, sourced from public posts on X, cleaned and translated). These are patterns observed across what's actually shipping and getting strong results — alternatives and supplements to the formats in Sections 1–15.

### 16.1 JSON-Style Structured Prompt Format

An alternative to shot-script format. Compact, machine-readable, useful when you want to template prompts programmatically or strip narrative fluff. Strong for VFX-driven and POV work.

```json
{
  "location": "Tokyo Cityscape (Night)",
  "duration": "10s",
  "prompt": "A cinematic POV shot riding an invisible rollercoaster through Tokyo at night. A glowing neon rail 'creates itself' milliseconds before the camera hits it, weaving through Tokyo Tower. Each building it touches transforms into stacks of glowing cubes that rotate and re-assemble. Shot ends diving into a sea of neon that becomes a logo before cutting to black.",
  "vfx_focus": [
    "Procedural rail generation",
    "Dynamic environment transformation (Geometry nodes style)",
    "Extremely high-speed camera motion with light streaks"
  ]
}
```

**When to use:** VFX-heavy prompts, POV pieces, anything where you want the model to focus on specific technical effects. The `vfx_focus` array acts as an emphasis layer — call out 2–4 specific effects you want the model to prioritize.

### 16.2 The `<<<Image1>>>` Syntax — Alternative to `@Image1`

Both syntaxes work in Seedance 2.0. The `<<<Image1>>>` form appears frequently in Japanese-language community prompts and is especially common in morphing/transformation templates where you want visual emphasis on the reference markers in long prompts.

```
Start from <<<Image1>>>.
The footage transforms in order: <<<Image1>>> -> <<<Image2>>> -> <<<Image3>>>...
```

Use whichever reads more clearly in your prompt. Stay consistent within a single prompt — don't mix `@Image1` and `<<<Image1>>>` in the same generation.

### 16.3 Multi-Chapter Long-Form Structure

**Different from extension chaining (Section 15).** Multi-chapter structure writes one master script with explicit `Chapter 1 / Chapter 2 / Chapter 3` blocks, where **each chapter is generated as its own 15-second clip**. The chapters share continuity language but are not necessarily produced via Seedance's video extension pipeline — they can be planned upfront, generated independently with shared character/style anchors, and stitched in post.

```
Chapter 1 (0–15 seconds): [Title]. Style: [...]. Camera: [...]. 
Sound effects: [...]. [Visual reference / character description]. 
[Timeline per second: 0–4s / 4–9s / 9–15s].

Chapter 2 (0–15 seconds): [Title]. Continuing from Video 1 and 
extending by 15 seconds. [Same structure].

Chapter 3 (0–15 seconds): [Title]. [Same structure].
```

**When to use this vs. extension chaining:** Use multi-chapter for narrative arcs you've planned end-to-end before generating (storyboarding the whole 45s upfront). Use extension chaining (Section 15) when you're discovering the story as you go and want each clip to literally continue the previous one's motion trajectory.

### 16.4 The 8 Prompt Category Buckets

The repo organizes 164 prompts into these buckets. Useful as a mental taxonomy when planning a piece:

| Bucket | What it covers |
|---|---|
| **Action / Fantasy** | Combat, chase, anime, wuxia, creature, large-scale spectacle |
| **Cinematic Realism** | Grounded live-action, mood, body language, practical light, believable camera |
| **POV / FPV** | First-person, drone-like, body-mounted, momentum-driven |
| **Commercial / Product** | Advertising, fashion, lifestyle, product, premium brand |
| **Reference-Driven** | Image references, character consistency, frame-to-frame control |
| **Surreal / VFX** | Abstract, impossible, stylized, transformation-heavy |
| **Templates & Structured Formats** | Reusable skeletons, JSON specs, highly structured |
| **General Cinematic** | Strong general-purpose references that don't fit tighter buckets |

**For Drift Protocol:** primarily Cinematic Realism + Reference-Driven, with selective Surreal/VFX moments for the hack visualization beats.

### 16.5 Hard-Cut Testing Pattern

A specialized test format for stress-testing Seedance's cut handling and identity consistency under rapid cutting:

```
Anime high-speed cut test — 20 hard cuts in 10 seconds 
(0.5 seconds per cut, no fade-in/fade-out, no transitions).

[0.0s–0.5s]: Cut 1 — Close-up. Character A: [description]. [action].
[0.5s–1.0s]: Cut 2 — Wide shot. Character B: [description]. [action].
[1.0s–1.5s]: Cut 3 — ...
```

**Key constraint phrase:** `"no fade-in/fade-out, no transitions"` — this forces hard cuts. Useful for music-video-style rapid cutting and for testing whether your character descriptions are detailed enough to survive aggressive cut frequency.

### 16.6 Sub-Second Timecodes for Micro-Timing

Community prompts use fractional second markers — `0.3s`, `0.5s`, `1.5s`, `0.4 seconds` — when whole-second precision isn't enough. Particularly common in:

- Emotion beats: `"shyly lowers her head for 0.3 seconds, gently biting her lower lip"`
- Reaction shots: `"he is stunned for 0.4 seconds"`
- Hard-cut sequences: `[0.0s–0.5s]`, `[1.5s–3.0s]`
- Pause/hold beats: `"natural short pauses between 200–400 milliseconds"`

**Rule of thumb:** use sub-second markers when the beat is shorter than 1 second AND timing precision changes the meaning of the shot. Don't over-fragment — sub-second markers everywhere becomes noise.

### 16.7 Seven-Image Morphing Template (Reusable Skeleton)

A reusable template structure for transforming N still images into one continuous morphing shot. The key innovation is **explicit prohibited/allowed lists** for camera behavior — Seedance responds well to negative-space constraints framed this way.

```
[Basic Settings]
structure: Single continuous shot (no cuts)
progression: Morphing N images sequentially
visibility: Each image clearly recognizable for an instant (no stopping)
transition: Always smooth and continuous
style: Cinematic, high-definition, dynamic, no flicker

[Prompt Body]
Start from <<<Image1>>>.
Seamless single shot, transforming in order: 
<<<Image1>>> -> <<<Image2>>> -> ... -> <<<ImageN>>>.
Camera is constantly moving. Subject recognizability maintained.
Each image has a peak state where it is clearly visible for an instant,
but no stopping or holding.

[Transformation Logic — fixed order, no duplication]
<<<Image1>>> -> <<<Image2>>>: Push-in forward. Outline -> parts -> color 
  -> texture. Particle decomposition -> reconstruction.
<<<Image2>>> -> <<<Image3>>>: Horizontal tracking. Light scanning rewrite. 
  *Particle expression prohibited.*
<<<Image3>>> -> <<<Image4>>>: Orbit movement. Spatial distortion + lens warp.
[continue per pair...]

[Camera Behavior]
Allowed:
  - Push-in / Pull-out
  - Horizontal tracking
  - Orbit (circling)
  - Light perspective change
Prohibited:
  - Sudden blur
  - Loss of subject
  - Unnatural jumps

[Constraints]
- Cut editing prohibited (complete single shot)
- Reuse of the same effect prohibited
- Flicker, noise, breakdown prohibited
- Each image must achieve a clearly visible state at least once

[Enhancement Keywords]
dynamic camera movement, cinematic motion flow, smooth continuous morphing,
temporal coherence, high detail preservation, consistent subject identity,
seamless transformation flow
```

**Why prohibited/allowed lists work:** they give the model explicit negative space. Instead of describing what you want and hoping the model avoids unwanted behavior, you constrain the behavior space directly. Adapt this pattern beyond morphing — any prompt where specific failure modes are predictable benefits from an explicit `Prohibited:` block.

### 16.8 Production Design Language Anchors

The highest-rated community prompts consistently use very specific style anchors instead of generic terms like "cinematic" or "high quality." These phrases appear repeatedly in featured prompts and produce notably stronger results:

| Anchor | What it triggers | Use for |
|---|---|---|
| **Naturalistic Film Print Emulation** | Realistic film stock characteristics, organic grain, accurate color science | Grounded realism, documentary, mythic-but-real |
| **DaVinci industrial-grade color grading** | Precise contrast control, professional color science, controlled saturation | Commercial work, premium product, high-contrast looks |
| **Tsui Hark style / Tsui Hark new style Wuxia blockbuster** | Bright tonality, "Cold Jade Blue-Black + Amber Flowing Light," high contrast, mountain mist as soft filter | Wuxia, large-scale martial action, Asian cinematic spectacle |
| **Hollywood IMAX blockbuster quality** | Large-format cinematic feel, deep dynamic range, epic scale | Sci-fi, action set pieces, Drift Protocol hack reveals |
| **35mm handheld film camera, natural grain, subtle organic shake** | Documentary realism, breathing camera, no digital sterility | Drift Protocol witness/interview-style beats |
| **100% real-life shooting texture** | Suppresses CGI tells, pushes toward photographic believability | Anything that needs to read as "real footage" |
| **Cold documentary style, natural light on a cloudy day** | Desaturated, even lighting, no dramatic shadows | True-crime, investigation, Drift Protocol opening |
| **8K cinematic, ultra-fine detail, HDR glow, no artifacts** | Quality ceiling enforcement | Final-frame keyframes, hero shots |

**Drift Protocol relevance:** the combination most likely to land your desaturated teal-blue/amber Gibney-Fincher palette is `35mm handheld film camera, natural grain, subtle organic shake + DaVinci industrial-grade color grading + cold documentary style, natural light + Naturalistic Film Print Emulation`. Stack 2–3 of these anchors per prompt; don't try to use all of them at once.

**Pattern across all 8 anchors:** they name a *specific tradition* (a film stock, a colorist tool, a director, a format) rather than describing the look in adjectives. Seedance has clearly learned these reference points strongly. When in doubt, replace a generic style word with the most specific industry-standard phrase you know for that look.

---

*Section 16 sourced from EvoLinkAI/awesome-seedance-2.0-prompts (164 prompts, latest entries dated 07 Apr 2026). Patterns extracted from featured prompts across all 8 category buckets.*

---

## 17. Patterns from the Official Bytedance Doc

> Sourced directly from the official Bytedance/Dreamina Seedance 2.0 prompting guide. These patterns are authoritative — when a community pattern conflicts with this section, this section wins. Keep the pipeline's canonical `[Image1]` / `[Video1]` tokens; the gateway performs the provider-specific translation described at the top of this guide.

### 17.1 Text Rendering (Slogans, Subtitles, Speech Bubbles)

Seedance 2.0 can render legible on-screen text across T2V, I2V, R2V, and V2V. The model auto-matches font and color to scene context, but you can override.

**Best practices:**
- Use common, high-frequency English words. Rare/obscure words render inconsistently.
- Avoid complex symbols and non-standard punctuation.
- Prefer short, punchy strings over paragraphs.
- For brand-strict typography, pair with a logo image reference (Section 17.2).

> **Important:** This is for in-frame rendered text *the model burns into pixels*. For the Drift Protocol pipeline, captions and overlays are still handled in Remotion post-production per `agent/CLAUDE.md`. Use Seedance text rendering only when the text is part of the diegetic scene (a speech bubble, a sign, a title card baked into the shot).

#### 17.1.1 Slogans / Title Cards

```
[Text Content] + [Timing] + [Positioning] + [Entrance/Appearance Style], [Visual Attributes (Color, Font Style)]
```

Example:
```
The frame gradually blurs, and the text "Bite", "Laugh", "Seedance" appear
sequentially in the center of the screen.
```

#### 17.1.2 Subtitles (Synced to Voiceover or Dialogue)

```
Display subtitles at the bottom-center with the text. The subtitles must be
perfectly synchronized with the audio rhythm and pacing.
```

For multi-speaker scenes, sequence them:
```
Render the dialogue as subtitles at the bottom-center of the screen.
Subtitles should appear sequentially as each character speaks.
```

#### 17.1.3 Speech Bubbles (Comic Style)

```
[Character] says, "[Dialogue]." Speech bubbles appear around the character
containing the spoken text.
```

Multi-character version (the official template):
```
The girl looks at the boy and says: "We can definitely do it!"
Cut to a close-up of the boy. He hesitates and replies: "Are you sure?"
Speech bubbles containing the corresponding lines appear around the
speaking character.
```

### 17.2 Multi-Image Role Assignment

The official doc's most powerful pattern: assign a **specific role** to each reference image, so the model composes a scene from parts. This goes well beyond "use Image 1 as a reference" — you can build entire scenes by saying who-wears-what-where.

**Template:**
```
Refer to / Extract / Combine / Follow the [described element] from [Image N] to
generate [Scene Description], maintaining consistency of [Referenced Elements].
```

**Full role-assignment example (5 images, 5 roles):**
```
The scene is set in the restaurant from Image 4 with people coming and going.
The girl from Image 1, wearing the clothes from Image 2, is organizing items
on the counter. The boy customer from Image 3 approaches her to ask for her
contact information. The logo from Image 5 remains in the bottom right corner
throughout.
```

**Role categories the model handles cleanly:**
- **Character identity** — face, build, hair from Image N
- **Wardrobe** — clothing from a different Image N
- **Environment** — scene/location from another image
- **Logo / brand mark** — persistent overlay from a logo asset
- **Product** — specific SKU appearance to lock in

**Why this matters for the Drift Protocol pipeline:** when you have an avatar character sheet (front/angle/expressive) plus a company logo plus a product shot, this pattern lets you compose them into one Seedance call instead of fighting drift across separate generations.

### 17.3 Multi-Panel Sequence Reference (Storyboard-as-Input)

You can upload a **single image containing multiple panels** (a storyboard, a comic page, a contact sheet) and instruct the model to follow the panel order as a shot sequence.

```
Refer to the sequence in Image 1 to create [scene type]. All frame
compositions from Image 1 shall be presented in strict predefined order,
after which [continuation].
```

**When to use:** you've drawn or rendered a 4-panel/6-panel storyboard and want Seedance to honor the composition AND the order. This is faster than describing each shot in prose.

**Compare to multi-image sequence:** if you upload separate images (Image 1, 2, 3, 4) for sequential shots, use:
```
Refer to the composition in Image 3. [Action]. Then the camera pans right
and cuts to the frame and composition shown in Image 4. [Action]. Then cuts
back to a close-up... [continue].
```

### 17.4 Track Completion (Multi-Clip Stitching)

> **Different from extension chaining (Section 15).** Extension chaining grows ONE clip forward/backward indefinitely. Track completion stitches a SET of pre-generated clips into one flowing piece by generating the *connective tissue* between them.

**Official limits (hard):**
- Max **3 video clips** as input
- Total combined duration ≤ **15 seconds**
- The model auto-trims connecting frames at clip boundaries — only necessary frames are kept

**Template:**
```
[Video 1] + [Transition Description] + followed by [Video 2] + [Transition Description] + followed by [Video 3]
```

**Example:**
```
Video 1. The moment a leaf falls to the ground, it sets off a special effect
of golden particles. A gust of wind blows by, leading into Video 2.
```

**When to use track completion vs. extension chaining:**
| Need | Use |
|---|---|
| You have 2-3 finished clips and need transitions to glue them | Track completion |
| You have one clip and want to grow the timeline forward/backward | Extension chaining (Section 15) |
| You need 30s+ total | Extension chaining (track completion caps at 15s) |
| You want a specific transition VFX between known beats | Track completion |

### 17.5 Element Edit Templates (Add / Remove / Modify)

The official syntax — more precise than Section 15's edit examples:

```
Adding:    At [Timestamp/Timing] and [Spatial Location] of [Video N], add [intended element].
Removing:  Remove [Element to delete] from [Video N], keeping the rest unchanged.
Modifying: Replace [element to change] in [Video N] with [intended replacement].
```

**Modify-with-reference pattern (common for product swaps):**
```
Replace the perfume featured in Video 1 with the face cream from Image 1,
with all original motions and camera work preserved.
```

That last clause — "with all original motions and camera work preserved" — is the key. Without it, the model sometimes regenerates motion. With it, only the swapped element changes.

### 17.6 Video Reference: Motion vs Camera vs VFX

The official doc separates these three reference types cleanly. Be explicit about which one you're pulling from a reference video:

| Reference type | Template | What gets transferred |
|---|---|---|
| **Motion reference** | `Refer to the [motion description] from Video N to generate [scene], keeping the motion details consistent.` | Choreography, body language, character action |
| **Camera motion reference** | `Refer to the [camera movement description] from Video N to generate [scene], keeping the scene consistent.` | Pan/tilt/dolly/orbit pattern, rhythm of camera moves |
| **VFX reference** | `Refer to the [VFX description] from Video N to generate [scene], keeping the special effects consistent.` | Particles, glows, transitions, stylized effects |

**Combine references for complex shots:**
```
Refer to the character movements and shot language in Video 1 to create a
fight scene with the character from Image 2 on the left and the character
from Image 1 on the right.
```

This is the official idiom for "borrow choreography from one source, identities from another."

### 17.7 Identifying References — Be Explicit, Always

The single most-repeated rule across the official examples:

> Make sure that you identify the reference objects clearly.

Don't say "use the references." Say "the cameras featured in Image 1, Image 2 and Image 3" or "the cat and dog from Image 1 and Image 2." Every reference image should be named with its index AND its role in the same sentence. This is even more important when the same prompt mixes images and videos — never leave the model to guess which file maps to which mention.

---

*Section 17 sourced directly from the official Bytedance/Dreamina Seedance 2.0 prompting documentation. When in doubt, this section overrides community patterns elsewhere in this guide.*

---

## 18. Engine Failure Modes & Cut Grammar

> Imported 2026-07-18 from an external Seedance 2.0 director skill
> (community-authored, bilingual EN/ZH prompt compiler). This section covers a
> category the rest of the guide barely touches: **what physically breaks the
> renderer**, and **how cuts must relate to each other**. Verification status
> per rule: ✅ = consistent with the official doc / our own QA observations;
> ⚠️ = community-asserted, not yet validated in our pipeline — before treating
> a ⚠️ rule as law in a paid job, run a one-variable probe (§14).
>
> For the compact operational checklist that applies this section (plus §2,
> §5, §7) to freehand prompts, see
> [`seedance_prompt_compiler.md`](seedance_prompt_compiler.md).

### 18.1 Renderer failure modes

| # | Rule | Status |
|---|------|--------|
| 1 | **Action beats = intent + named technique, not biomechanics.** ✅ "spinning back kick connects." ❌ "left forearm rotates 45° to deflect the incoming right hook at wrist level." If a specific move matters, name it; never describe joint mechanics. | ✅ (same principle as §5 Rule 2: rhythm, not specs) |
| 2 | **Describe force and direction, not a destruction sequence.** ✅ "driven into the car, metal buckling." ❌ "thrown into side door, glass shatters, uses rebound to sweep leg" — chained cause-effect-cause in one beat overloads the temporal branch. | ⚠️ |
| 3 | **≤ 3 characters tracked across cuts.** Beyond that, name the acting pair and their interaction vector per shot; treat everyone else as crowd/background. | ⚠️ |
| 4 | **Exit-frame = implicit cut.** A character who leaves frame is gone for the remainder of that continuous shot. Never choreograph exit + re-entry in the same shot. | ⚠️ |
| 5 | **Off-screen = nonexistent.** A state change (a weapon drawn, a door opened, an object moved) must be shown on camera before any later beat references it. | ⚠️ |
| 6 | **Avoid reflection shots** (visors, blades, mirrors, puddles) — reflections can break scene geography. If a reflection beat is essential, probe it first. | ⚠️ (conflicts with the §3 example — see caveat there) |
| 7 | **Only describe what can be seen or heard.** ❌ "The air smells of pine." ✅ "Pine needles covering the ground, wind moving through branches." | ✅ |
| 8 | **Micro-expressions as physics.** ✅ "jaw clenches, nostrils flare." ❌ "looks angry." | ✅ (already the law in §9 Actions & Emotions) |

### 18.2 Cut grammar

Rules for prompts that contain hard cuts (shot-scripts, §3 / §9 timeline
segmentation). These govern the relationship BETWEEN shots — the rest of the
guide governs each shot individually.

**Double contrast (⚠️).** Every cut should change **both** shot size AND
camera character:

- Shot-size scale: `extreme wide → wide → medium → medium close-up → close-up → ECU`
- Camera modes: handheld | static/locked-off | stabilized tracking | crane/vertical | aerial — don't repeat the same mode across a cut.

A cut that changes neither reads as a stutter; a cut that changes only one
reads as a jump cut.

**Re-anchoring and the 180° rule (✅ — same failure class as §13
troubleshooting "character changes between shots").** After any cut that
returns to established space, re-state who is where and which direction they
face. If a character moves left-to-right before the cut, they move
left-to-right after it. State screen direction explicitly — spatial
continuity does not survive a cut on its own.

**Insert cutaways (⚠️).** Sub-second (0.3–0.5s) detail shots as dramatic
punctuation (compare §16.6 sub-second timecodes). *Not to be confused with
`mint_video --mode insert`, which is multi-second (1–6s) under-dialogue b-roll
— a different tool concept, not a cut-grammar cutaway.*

- No story beats inside an insert cutaway — static moments only.
- **Causally motivated:** the viewer must understand WHY they see this detail. ✅ Hero slammed onto hood → **his** hand gripping the metal. ❌ generic boot stepping in a puddle.
- **Name the subject:** specify WHOSE body part or object. Without attribution the model renders the wrong content.
- Insert cutaways obey double contrast like any other cut.

### 18.3 Dialogue budget

~**25–30 spoken words fit in 15 seconds** of dialogue-scene video (for
talking-head delivery use the WPM math in §0 — 37–47 words — which is
measured for our pipeline; the 25–30 figure budgets for reaction beats
between lines). When a scene has more dialogue than fits, trim by keeping:

1. the **power-shift exchange** (the line where dominance flips or the truth lands),
2. one line before it (setup),
3. one line after it (reaction),

and convert everything else to physical behavior (§18.1 rule 8).

### 18.4 Scene archetype router (⚠️ heuristic, not law)

Before picking a template (§10), identify the scene's dramatic mechanics —
the archetype tells you what the camera should do and what must change over
time:

| Archetype | What changes | Camera signature |
|---|---|---|
| **Pursuit** | Distance closes/opens; path narrows | Pursued ahead in frame, pursuer behind |
| **Duel** | Advantage MUST alternate — neither side dominates 2 consecutive beats (else write it as a one-sided assault) | Camera sits lower on the currently dominant side |
| **Impact** | One decisive contact | Build-up slow → hit fast → aftermath slow; contact point = frame center |
| **Journey** | Position in space | Tracking/aerial alongside; landscapes pass |
| **Atmosphere** | Nothing — mood IS the content | Minimal movement; slow push-in or static hold; micro-changes carry the drama |
| **Reveal** | Hidden → visible | Pan/crane/dolly controls WHEN the viewer sees it |
| **Confrontation** (dialogue) | Dominance trades per exchange | Tight OTS; camera crosses the axis on a power shift |
| **Interrogation** (dialogue) | One extracts, one resists | Low-angle on questioner; push-in on silence |
| **Negotiation** (dialogue) | Balanced need | Symmetrical framing, matching shot sizes |

Default when unsure: in medias res — the scene is already in progress unless
the brief says "starts with…" / "ends with…".

---

*Section 18 imported from an external community Seedance 2.0 director skill, 2026-07-18. ⚠️-marked rules pending validation probes through our QA loop.*

---

*Guide compiled April 2026. Sources: EvoLinkAI/awesome-seedance-2-guide (GitHub), Seedance2API blog, APIYI official prompt interpretation, WeShop AI guide, ImagineArt prompt collection, SeaArt community guide, Opus.pro extension & editing guide, WaveSpeedAI complete guide, Dreamina/CapCut official tutorial, Digen.ai quick guide, seedancetwo.com official user manual (Feishu doc mirror), the official Volcengine Seedance documentation, and the EvoLinkAI/awesome-seedance-2.0-prompts community repository (164 prompts, sourced 11 April 2026).*
