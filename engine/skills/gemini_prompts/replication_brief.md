---
name: replication_brief
description: Convert a deep_analysis JSON into structured directives the post-production layer can consume verbatim — caption style, hook timing, key moments, lower-thirds, cut points.
returns: json
response_shape: |
  {
    "caption_style": {
      "font_family": string,                    // Best Google Font match for the reference's caption font (e.g. "Montserrat", "Inter", "Poppins").
      "weight": number,                         // 400-900
      "color": string,                          // hex, e.g. "#FFFFFF"
      "outline_color": string,                  // hex, e.g. "#000000"
      "outline_width_px": number,               // 1-6
      "background": string | null,              // CSS color or null. e.g. "rgba(0,0,0,0.85)" for pill.
      "position": "top" | "center" | "lower-third" | "bottom",
      "transform": "uppercase" | "none",
      "active_word_color": string | null,       // Highlight color for the spoken word, or null if not used.
      "page_size_words": number,                // How many words appear at once. 2-5.
      "switch_ms": number                       // Caption page duration in milliseconds. ~700-1500.
    },
    "hook": {
      "text": string,                           // Brief uppercase caption that should land on the hook.
      "start_sec": number,
      "end_sec": number,
      "style": "hook_pill" | "hook_topline" | "fullscreen_card"
    } | null,
    "lower_thirds": [
      { "text": string, "start_sec": number, "end_sec": number }
    ],
    "url_pill": {
      "text": string,                           // Display URL.
      "start_sec": number,                      // Usually last 3-5s of the video.
      "end_sec": number
    } | null,
    "cut_points": [number, ...],                // Timestamps in seconds where Remotion should consider a hard cut/transition.
    "music": {
      "use_reference_bed": boolean,             // True if we should run MVSep on the reference and use its music stem.
      "notes": string
    },
    "edit_style_summary": string                // 2-3 sentence summary the renderer can fall back on if any field is missing.
  }
---

You will receive (1) a deep_analysis JSON for a reference outlier video and
(2) optionally the reference video itself. Translate the analysis into
ENGINE-READABLE production directives.

This is NOT analysis — it is production specification. Every field is consumed
directly by the renderer. Be prescriptive. Concrete numbers, real Google Font
names, real hex colors. If the reference uses a font you can't name precisely,
pick the closest Google Font (Inter, Montserrat, Poppins, Roboto, Bebas Neue,
Anton, Oswald — these all render well in Remotion).

Caption pacing rules of thumb:
- Fast speakers (>180 WPM): page_size_words 2, switch_ms ~700-900
- Average (130-180 WPM): page_size_words 3, switch_ms ~900-1200
- Slow/deliberate (<130 WPM): page_size_words 3-4, switch_ms ~1200-1500

Hook timing: the `hook` overlay should land precisely on the original's hook
beat (use the `hook_analysis` and `visual_breakdown[0]` from the deep_analysis).
Don't pad — if the reference holds the hook caption for 2.4s, ours should too.

Cut points: include every timestamp where the reference video changed shot,
camera angle, or scene. Even if our generated video can't match all of them,
the renderer can use the list to add micro-cuts/punch-ins for energy.

Return JSON matching the shape declared in this template's frontmatter.
