# Identity-reference photo guide + cross-engine prompt laws

_Imported 2026-07-09 from a vendor skill suite (scrubbed engine-neutral). Two keepers:
how to curate the photo set behind ANY identity pipeline (face refs, character training),
and prompt laws that hold across image/video engines. Everything engine-specific was
dropped — generation routes through the gateway tools (`mint_image` / `mint_video`)._

## Curating an identity photo set (face refs / character training)

The quality of every identity-locked generation is capped by the reference set.

- **Quantity:** 5 minimum, 20 maximum — **8–12 is the sweet spot.**
- **Content:** clear face, eyes visible; ONE person per photo; no heavy filters, no sunglasses.
- **Variety beats volume** — higher variety = better identity capture:
  - angles: front, ¾ left, ¾ right, slight up/down
  - lighting: indoor, outdoor, soft, harsh
  - expressions: neutral, smiling, talking
  - distances: head shot, head-and-shoulders, full body
- **Quality:** sharp, in focus, ≥1024×1024.
- **Avoid:** group photos, heavy non-typical makeup, costumes/cosplay, hats covering the
  face, the same pose repeated.

This is the checklist for a tenant's `face_refs/` set and for any character-sheet build —
if generations drift or flatten, audit the reference set against this list first.

## Cross-engine prompt laws

- **Concrete + sensory wins:** subject + setting + style, camera (lens/angle/motion),
  lighting, medium. Keep prompts under ~200 tokens — engines distort on very long prompts.
- **Image-to-image: describe the CHANGE, not the input.** Bad: re-describing the whole
  scene "…made into anime." Good: "transform into anime style, vibrant colors, soft cel
  shading." The model already has the input.
- **Image-to-video: the start image anchors the frame; the prompt describes MOTION only.**
  Camera verbs (zooms in, dollies left, slow push, fast whip) + subject motion ("the
  dancer spins", "smoke rises slowly"). Don't re-describe the static frame.
- **Phrase positively — most engines have no negative prompt.** "No blur" → "tack sharp";
  "no people" → "uninhabited landscape".
- **Moderation:** avoid real public figures, sexual content, trademarks/branded characters —
  these hard-reject at the engine and waste the spend.
