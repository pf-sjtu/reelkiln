"""
build_carousel.py — the canonical multi-slide carousel primitive.

ONE self-contained tool, parameterized by `--mode`. Absorbs the logic of the
three former backends (which now DELETE):
  - mint_carousel_illustrations.py  (raw per-slide illustrations, no text)
  - layout_carousel.py              (gpt-image-2 typeset pass — the shippable art)
  - render_carousel.py              (Remotion `Carousel` still fallback)

A carousel is a multi-slide Instagram image post whose typography and body copy
are BAKED INTO each image by gpt-image-2 — there is no Remotion caption layer in
the production path. (The Remotion `Carousel` composition is retained only as a
draft/preview fallback; the gpt-image-2 layout pass is the press.)

  uv run python tools/build_carousel.py --job <job> --mode <mode> \
      [--slides N] [--concept "..."] \
      [--reference <png|url>]   # repeatable; base STYLE image(s)
      [--style-proof]           # optional slide-1 preview; never an approval gate
      [--workers 3]             # parallel mints (rate-limit cushion)
      [--regen 2,5]             # re-mint specific slide indices (implies --force)
      [--slide N]               # operate on ONE slide index
      [--force]                 # re-mint even if the output PNG exists
      [--style <preset|file>]   # layout look; default preset coaching_gems

`--mode` is REQUIRED and logged as `usage_role`. `--job` is always passed (only
pick_company.py is exempt). Both modes read `<job_dir>/carousel.json`.

MODES
  two_pass           Standard path. Stage 1 mints a cohesive RAW illustration set
                     (no text). Stage 2 typesets each slide's verbatim copy over
                     its illustration via gpt-image-2 (baked typography). Output:
                     <job>/images/slide_NN_layout_v1.png (shippable).
                     `--reference` (optional) anchors illustration STYLE in stage 1.

  reference_matched  One-shot. Each slide is generated in a SINGLE gpt-image-2
                     `--reference` pass so every slide inherits the exact visual
                     style/palette/composition of the supplied base STYLE image(s).
                     No separate illustration stage; typography is baked in the
                     same call. `--reference <png|url>` is REQUIRED for this mode
                     and is LOAD-BEARING (it defines the matched look).

BACKEND
  Every image is minted by shelling out to the canonical image primitive
  `tools/mint_image.py --role card` (gpt-image-2 — strongest baked typography),
  with `--aspect 2:3 --quality high` and `--reference <ref>` for the layout /
  match passes. This preserves the exact model id, retry flow, and reference
  semantics of the absorbed backends (which themselves shelled out to the old
  generate_image.py, now consolidated into mint_image.py).

SELF-CONTAINED: this file imports only the surviving low-level helpers
(`job.py`, `log.py`, `_paths.py`). It does NOT import any of the absorbed
backends — their logic is inlined below.

See skills/primitives/build_carousel.md for the full workflow + checkpoints.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import string
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import REPO_ROOT, OUTPUT_ROOT, SKILLS_DIR  # noqa: E402
from job import (resolve_job_dir, add_job_arg, billing_input_path,
                 billing_optional_input_path)  # noqa: E402
from _billing_manifest import job_path as billing_job_path  # noqa: E402
from log import log_event  # noqa: E402

# ── Paths ────────────────────────────────────────────────────────────────────

STYLE_PACKS_DIR = SKILLS_DIR / "carousel_styles"
MINT_IMAGE = "tools/mint_image.py"
# Brand-asset dir (closing-slide stamp etc.) lives alongside the job dirs, e.g.
# jobs/_brand_coaching_gems/. relpaths starting "_brand_" resolve from there.
BRAND_PREFIX = "_brand_"

VALID_MODES = ("two_pass", "reference_matched")


# ── Style-pack CORE_STYLE_BLOCK extraction (from mint_carousel_illustrations) ──

def extract_core_style_block(style_pack: str) -> str:
    """Pull the CORE_STYLE_BLOCK section from a style-pack markdown file.

    The block lives under `### CORE_STYLE_BLOCK` and is rendered as a markdown
    blockquote (each non-blank line prefixed with `> `). We strip the `> `
    prefix and stitch the lines back into prose. (Inlined verbatim from the
    absorbed mint_carousel_illustrations.py so behaviour is identical.)
    """
    pack_path = STYLE_PACKS_DIR / f"{style_pack}.md"
    if not pack_path.is_file():
        raise SystemExit(
            f"Style pack not found: {pack_path}\n"
            f"Available: {sorted(p.stem for p in STYLE_PACKS_DIR.glob('*.md'))}"
        )
    text = pack_path.read_text()
    m = re.search(r"### CORE_STYLE_BLOCK\s*\n+(.*?)(?:\n## |\Z)", text, re.S)
    if not m:
        raise SystemExit(f"Could not find ### CORE_STYLE_BLOCK section in {pack_path}")
    raw = m.group(1)
    lines: list[str] = []
    for line in raw.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("> "):
            lines.append(stripped[2:])
        elif stripped == ">":
            lines.append("")
        else:
            lines.append(line)
    return "\n".join(lines).strip()


# ── Locked layout style block (inlined verbatim from layout_carousel) ─────────

LOCKED_STYLE = """\
LOCKED — DO NOT CHANGE under any circumstance:
- Cream paper background #F2EBDC (warm cream, NOT white, NOT off-white)
- Two text colors ONLY: deep ink-black for body narration, saturated burnt-orange #C84A1E italic for emphasis
- Classical book-typography serif font throughout (Bodoni, Didone, EB Garamond, or equivalent vintage book serif). NOT sans-serif. NOT modern display. NOT marker. NOT handwritten.
- Italic styling on emphasis phrases, on the handle, and on the URL
- Verbatim words as listed below — do not paraphrase, do not insert words, do not skip words
- Subtle paper grain texture as in a vintage book press

AESTHETIC: This is a finished page from an editorial Penguin Classics-style book issue, published as one slide of an Instagram carousel by @coachgems_ ('Coaching Gems'). The text must feel HAND-SET by an editorial art director — curated, deliberate, with intentional rhythm and negative space. NOT a flat block of text floating above the picture. The typography wraps around the illustration using the cream paper's empty regions as designed margins.

ANTI-PATTERNS — absolutely avoid:
- sans-serif fonts (no Inter, no Helvetica, no Montserrat, no any-sans)
- modern startup minimalism / generic Canva aesthetic
- drop shadows, gradients, glossiness
- flat caption blocks
- watercolor, paint splatter, ink wash beyond the engraved illustration itself
- any color other than cream + burnt-orange + ink-black
- garbled or hallucinated letters in the text (the words below must read crisply)
"""


COACHING_GEMS_FOOTER = \
    'Footer (every slide, very bottom, centered, small burnt-orange italic): "{handle}"'


# ── Per-slide-kind layout prompt templates (inlined from layout_carousel) ─────
# str.format templates. {style_block} and {footer} are the style's own block and
# rendered footer line; the rest are the slide's carousel.json fields.

COACHING_GEMS_BEAT = """{style_block}

{footer}

TYPESET THE FOLLOWING VERBATIM TEXT onto the input illustration:

1. Lead narration (classical ink-black serif): "{narration_plain}"

2. PULL-QUOTE EMPHASIS (set LARGE and PROMINENT in burnt-orange italic — this is the visual climax of the typography on this slide): "{narration_emphasis}"

3. Continuation narration (smaller classical ink-black serif, italic optional): "{narration_continuation}"

LAYOUT DIRECTION for THIS slide:
{layout_direction}

The input image is a vintage intaglio engraving in burnt-orange ink on cream paper. Preserve the illustration's composition. Only ADD the text typeset per the layout direction above. Make it look like a curated editorial book page.
"""

COACHING_GEMS_COVER = """{style_block}

{footer}

This is the COVER slide of an editorial Instagram carousel issue. The input image is a vintage intaglio engraved portrait of an executive coach.

TYPESET THE FOLLOWING VERBATIM TEXT onto the input portrait:

1. Top editorial tagline (small all-caps, burnt-orange, classical letter-spacing): "{header_chip}"

2. Featured-name headline (LARGE classical display serif, ink-black, set BELOW the portrait): "{headline}"

3. Tagline subhead (italic classical serif, ink-black, smaller, set beneath the headline): "{tagline}"

LAYOUT DIRECTION for THIS slide:
{layout_direction}

Preserve the portrait. Add the text typeset like a vintage Penguin Classics cover.
"""

COACHING_GEMS_CLOSING = """{style_block}

{footer}

This is the CLOSING SLIDE of an editorial Instagram carousel. There is NO illustration in the upper area — the typography itself is the visual hero. The input reference image is the brand's wordmark stamp (a vintage book-press hot-foil mark in burnt-orange on cream).

TYPESET THE FOLLOWING VERBATIM TEXT as a curated editorial closing card:

1. STAT HERO (set ENORMOUS in burnt-orange Bodoni/Didone display serif — high-contrast strokes, this is the visual centerpiece of the entire carousel): "{stat_display}"

2. Stat body (classical ink-black serif at moderate size, set BENEATH the stat hero; render the named emphasized phrase from the body in italic burnt-orange while the rest stays ink-black serif): "{stat_body}"

3. A thin horizontal rule in burnt-orange (decorative editorial separator)

4. Closer line (italic classical serif, ink-black, centered): "{closer_line}"

5. PLACE the wordmark stamp (the input reference image) centered beneath the closer line, at moderate size

6. URL (italic ink-black classical serif, small, centered): "{brand_url}"

LAYOUT DIRECTION for THIS slide:
{layout_direction}

NO illustration in the upper area — the stat itself IS the visual. Pure editorial closing card.
"""


# ── Layout styles (#276) ──────────────────────────────────────────────────────
# The typeset pass used to hard-code the Coaching Gems look and handle, so every
# brand came out as Coaching Gems. A layout style is that brand text: the style
# block (used verbatim), the footer template, and one template per slide kind.
# "coaching_gems" is the default preset and reproduces the old prompts exactly.
# Another brand passes `--style <file.json>` (or sets carousel.json
# "layout_style"); a style file must supply every key, so nothing of another
# brand's look can leak in.

DEFAULT_LAYOUT_STYLE = "coaching_gems"
LAYOUT_STYLE_PRESETS: dict[str, dict] = {
    "coaching_gems": {
        "name": "coaching_gems",
        "handle": "@coachgems_",
        "style_block": LOCKED_STYLE,
        "footer": COACHING_GEMS_FOOTER,
        "beat": COACHING_GEMS_BEAT,
        "cover": COACHING_GEMS_COVER,
        "closing": COACHING_GEMS_CLOSING,
    },
}
# Placeholders each template may use; handle is available everywhere.
LAYOUT_TEMPLATE_FIELDS: dict[str, frozenset[str]] = {
    "footer": frozenset({"handle"}),
    "beat": frozenset({"style_block", "footer", "handle", "layout_direction",
                       "narration_plain", "narration_emphasis", "narration_continuation"}),
    "cover": frozenset({"style_block", "footer", "handle", "layout_direction",
                        "header_chip", "headline", "tagline"}),
    "closing": frozenset({"style_block", "footer", "handle", "layout_direction",
                          "stat_display", "stat_body", "closer_line", "brand_url"}),
}
LAYOUT_STYLE_REQUIRED = ("style_block", *LAYOUT_TEMPLATE_FIELDS)


def _template_fields(template: str, key: str, origin: str) -> set[str]:
    try:
        parsed = list(string.Formatter().parse(template))
    except ValueError as exc:
        raise SystemExit(f"layout style {origin}: {key!r} is not a valid template "
                         f"({exc}); write literal braces as {{{{ and }}}}") from None
    for _, field, spec, conversion in parsed:
        if field is not None and (spec or conversion):
            raise SystemExit(f"layout style {origin}: {key!r} placeholders must be plain "
                             f"{{name}}, not {{{field}{'!' + conversion if conversion else ''}"
                             f"{':' + spec if spec else ''}}}")
    return {field for _, field, _, _ in parsed if field is not None}


def validate_layout_style(style: object, origin: str) -> dict:
    """Check a layout style object; SystemExit names the first problem."""
    if not isinstance(style, dict):
        raise SystemExit(f"layout style {origin} must be a JSON object")
    unknown = sorted(set(style) - {"name", "handle", *LAYOUT_STYLE_REQUIRED})
    if unknown:
        raise SystemExit(f"layout style {origin} has unknown key(s): {', '.join(unknown)}")
    missing = [key for key in LAYOUT_STYLE_REQUIRED
               if not isinstance(style.get(key), str) or not style[key].strip()]
    if missing:
        raise SystemExit(f"layout style {origin} needs non-empty string(s): "
                         f"{', '.join(missing)}")
    for key in ("name", "handle"):
        if key in style and not isinstance(style[key], str):
            raise SystemExit(f"layout style {origin}: {key!r} must be a string")
    for key, allowed in LAYOUT_TEMPLATE_FIELDS.items():
        extra = _template_fields(style[key], key, origin) - allowed
        if extra:
            raise SystemExit(
                f"layout style {origin}: {key!r} uses unknown placeholder(s) "
                f"{', '.join(sorted(extra))}; allowed: {', '.join(sorted(allowed))}")
    return style


def layout_style_path(value: str | None, job_dir: Path) -> Path | None:
    """The style FILE a --style / carousel.json value names, or None for a preset."""
    if value is not None and not isinstance(value, str):
        raise SystemExit("layout style must be a preset name or a style file path")
    if not value or value in LAYOUT_STYLE_PRESETS:
        return None
    path = Path(value).expanduser()
    return path if path.is_absolute() else job_dir / path


def resolve_layout_style(value: str | None, job_dir: Path) -> dict:
    """Preset name or job-relative JSON file → validated layout style."""
    path = layout_style_path(value, job_dir)
    if path is None:
        return LAYOUT_STYLE_PRESETS[value or DEFAULT_LAYOUT_STYLE]
    source = billing_input_path(path)
    if not source.is_file():
        raise SystemExit(
            f"layout style {value!r} is neither a preset "
            f"({', '.join(sorted(LAYOUT_STYLE_PRESETS))}) nor a file at {path}")
    try:
        style = json.loads(source.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"layout style {path} is not valid JSON: {exc}") from None
    return validate_layout_style(style, str(path))


def _render_layout_prompt(slide: dict, carousel: dict, style: dict) -> str:
    handle = carousel.get("handle", style.get("handle", ""))
    shared = {"style_block": style["style_block"],
              "footer": style["footer"].format(handle=handle),
              "handle": handle}
    if slide["kind"] == "cover":
        return style["cover"].format(
            **shared, header_chip=slide["header_chip"], headline=slide["headline"],
            tagline=slide["tagline"], layout_direction=slide["layout_direction"])
    if slide["kind"] == "closing":
        return style["closing"].format(
            **shared, stat_display=slide["stat_display"], stat_body=slide["stat_body"],
            closer_line=slide["closer_line"], brand_url=carousel.get("brand_url", ""),
            layout_direction=slide["layout_direction"])
    return style["beat"].format(
        **shared, narration_plain=slide["narration_plain"].strip(),
        narration_emphasis=slide["narration_emphasis"],
        narration_continuation=slide.get("narration_continuation", "").strip(),
        layout_direction=slide["layout_direction"])


# The Coaching Gems prompt for one slide kind, exactly as before layout styles.
def prompt_for_beat(slide: dict, handle: str) -> str:
    return _render_layout_prompt(slide, {"handle": handle},
                                 LAYOUT_STYLE_PRESETS[DEFAULT_LAYOUT_STYLE])


def prompt_for_cover(slide: dict, handle: str) -> str:
    return _render_layout_prompt(slide, {"handle": handle},
                                 LAYOUT_STYLE_PRESETS[DEFAULT_LAYOUT_STYLE])


def prompt_for_closing(slide: dict, handle: str, brand_url: str) -> str:
    return _render_layout_prompt(slide, {"handle": handle, "brand_url": brand_url},
                                 LAYOUT_STYLE_PRESETS[DEFAULT_LAYOUT_STYLE])


def build_layout_prompt(slide: dict, carousel: dict, style: dict | None = None) -> str:
    # Authoring markup describes styling, never characters to typeset. Work on
    # a copy so both layout modes and later retries retain the authored source.
    emphasis: list[str] = []

    def plain_text(match: re.Match) -> str:
        phrase = match.group(1)
        emphasis.append(phrase)
        return phrase

    text_fields = (
        "header_chip", "headline", "tagline", "narration_plain",
        "narration_emphasis", "narration_continuation", "stat_display",
        "stat_body", "closer_line",
    )
    slide = dict(slide)
    for field in text_fields:
        if isinstance(slide.get(field), str):
            slide[field] = re.sub(r"\[\[([^\[\]]+)\]\]", plain_text, slide[field])
    prompt = _render_layout_prompt(
        slide, carousel, style or LAYOUT_STYLE_PRESETS[DEFAULT_LAYOUT_STYLE])
    if emphasis:
        prompt += "\nStyling instructions only; do not typeset these instructions:\n"
        prompt += "\n".join(
            f'Emphasise {json.dumps(phrase, ensure_ascii=False)} in italic burnt-orange within the text above; do not repeat it.'
            for phrase in dict.fromkeys(emphasis)
        )
    return prompt


# ── Reference resolution (inlined from layout_carousel) ───────────────────────

def layout_reference_path(slide: dict, job_dir: Path,
                          output_root: Path = OUTPUT_ROOT) -> Path:
    """Pick the input reference image for a slide's layout pass.

    Conventions (from the absorbed layout_carousel.py):
      kind=closing → the brand stamp (slide['stamp_source_relpath'])
      otherwise    → the slide's illustration_source_relpath
    relpaths starting `_brand_` resolve from OUTPUT_ROOT (jobs/); everything else
    resolves from <job_dir>.
    """
    if slide["kind"] == "closing":
        relpath = slide.get("stamp_source_relpath")
    else:
        relpath = slide.get("illustration_source_relpath")
    if not relpath:
        raise SystemExit(f"Slide {slide['index']} missing a reference path.")
    if relpath.startswith(BRAND_PREFIX):
        return output_root / relpath
    return job_dir / relpath


def select_slides(slides: list[dict], args: argparse.Namespace) -> list[dict]:
    """Canonical selection shared by execution and the billing manifest."""
    if args.slide is not None:
        selected = [slide for slide in slides if slide["index"] == args.slide]
        if not selected:
            raise SystemExit(f"No slide {args.slide} in carousel.json")
        return selected
    if args.style_proof:
        return [slide for slide in slides if slide["index"] == 1] or slides[:1]
    regen = parse_regen(args.regen)
    if regen is not None:
        return [slide for slide in slides if slide["index"] in regen]
    return slides


def billing_manifest(args: argparse.Namespace, cwd: Path) -> dict:
    job_dir = billing_job_path(args.job, cwd)
    carousel_path = billing_input_path(job_dir / "carousel.json")
    carousel = json.loads(carousel_path.read_text())
    selected = select_slides(carousel["slides"], args)
    inputs = [{"path": str(job_dir / "carousel.json"), "kind": "carousel"}]
    style_file = layout_style_path(args.style or carousel.get("layout_style"), job_dir)
    if style_file is not None:
        inputs.append({"path": str(style_file.absolute()),
                       **({"dest": "style"} if args.style else {"kind": "carousel_style"})})
    inputs.extend({"path": str((Path(value).expanduser()
                                if Path(value).expanduser().is_absolute()
                                else cwd / value).absolute()),
                   "dest": "reference"} for value in args.reference
                  if not re.match(r"^[a-z][a-z0-9+.-]*://", value, re.I))
    for slide in selected:
        generated_here = (args.mode == "two_pass" and args.illustrations
                          and slide.get("kind") != "closing"
                          and slide.get("illustration_scene")
                          and str(slide.get("illustration_source_relpath", "")).startswith("images/"))
        needs_layout_ref = args.mode == "two_pass"
        if args.mode == "reference_matched" and slide.get("kind") == "closing":
            stamp = slide.get("stamp_source_relpath")
            if stamp:
                candidate = ((cwd / "jobs" / stamp) if stamp.startswith(BRAND_PREFIX)
                             else (job_dir / stamp))
                needs_layout_ref = billing_optional_input_path(candidate) is not None
        if needs_layout_ref and not generated_here:
            inputs.append({"path": str(layout_reference_path(
                slide, job_dir, cwd / "jobs")), "kind": "carousel_reference"})
    illustration_count = 0
    if args.mode == "two_pass" and args.illustrations:
        illustration_count = len([
            slide for slide in selected if slide.get("illustration_scene")
            and str(slide.get("illustration_source_relpath", "")).startswith("images/")
        ])
    return {"role": args.mode, "count": len(selected) + illustration_count,
            "inputs": inputs}


def layout_output_name(slide: dict) -> str:
    return f"slide_{slide['index']:02d}_layout_v1"


# ── mint_image dispatch ───────────────────────────────────────────────────────

def _run_mint_image(name: str, prompt: str, job_id: str, references: list[str],
                    log_tag: str, idx: int) -> tuple[int, int, str]:
    """Shell out to the canonical mint_image.py --role card. Returns (idx, rc, tail).

    Preserves the absorbed backends' exact image-call contract:
      --aspect 2:3 --quality high [--reference <ref> ...]
    Text is baked into the image by gpt-image-2 (role=card).
    """
    cmd = [
        "uv", "run", "python", MINT_IMAGE,
        "--job", job_id,
        "--role", "card",
        "--name", name,
        "--aspect", "2:3",
        "--quality", "high",
    ]
    for ref in references:
        cmd += ["--reference", str(ref)]
    cmd += ["--prompt", prompt]

    log_path = Path(f"/tmp/build_carousel_{log_tag}_{job_id}_slide_{idx:02d}.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    refnote = f"  (refs: {len(references)})" if references else ""
    print(f"  [slide {idx:02d}] → {name}.png{refnote}", flush=True)
    with log_path.open("w") as logfh:
        proc = subprocess.run(cmd, cwd=REPO_ROOT, stdout=logfh, stderr=subprocess.STDOUT)
    tail = "\n".join(log_path.read_text().splitlines()[-3:])
    return (idx, proc.returncode, tail)


# ── Stage 1: raw illustrations (inlined from mint_carousel_illustrations) ─────

def mint_illustration(slide: dict, core: str, style_refs: list[str],
                      job_id: str) -> tuple[int, int, str]:
    idx = slide["index"]
    relpath = slide["illustration_source_relpath"]
    name = Path(relpath).stem  # generate to images/<stem>.png
    scene = slide["illustration_scene"]
    prompt = f"{core}\n\nSCENE: {scene}"
    # Optional STYLE anchor references for illustration-style consistency.
    return _run_mint_image(name, prompt, job_id, style_refs, "illu", idx)


# ── Stage 2 / one-shot: typeset layout pass ──────────────────────────────────

def mint_layout(slide: dict, carousel: dict, job_dir: Path,
                job_id: str, style: dict | None = None) -> tuple[int, int, str]:
    idx = slide["index"]
    prompt = build_layout_prompt(slide, carousel, style)
    ref = billing_input_path(layout_reference_path(slide, job_dir))
    if not ref.exists():
        return (idx, 99, f"reference does not exist: {ref}")
    name = layout_output_name(slide)
    return _run_mint_image(name, prompt, job_id, [str(ref)], "layout", idx)


def mint_reference_matched(slide: dict, carousel: dict, job_dir: Path,
                           job_id: str, style_refs: list[str],
                           style: dict | None = None) -> tuple[int, int, str]:
    """One-shot: typeset the slide directly over the base STYLE reference(s).

    No separate illustration exists; the supplied --reference style image(s) are
    LOAD-BEARING and passed straight into the baked-typography gpt-image-2 call.
    """
    idx = slide["index"]
    prompt = build_layout_prompt(slide, carousel, style)
    # For the closing slide, the brand stamp is still the natural reference;
    # prepend it if present, then the operator's style refs.
    refs: list[str] = []
    if slide["kind"] == "closing":
        stamp_rel = slide.get("stamp_source_relpath")
        if stamp_rel:
            stamp = (OUTPUT_ROOT / stamp_rel) if stamp_rel.startswith(BRAND_PREFIX) else (job_dir / stamp_rel)
            stamp = billing_optional_input_path(stamp)
            if stamp is not None:
                refs.append(str(stamp))
    refs += [str(r) for r in style_refs]
    if not refs:
        return (idx, 99, "reference_matched mode requires at least one --reference style image")
    name = layout_output_name(slide)
    return _run_mint_image(name, prompt, job_id, refs, "refmatch", idx)


# ── Slide selection helpers ───────────────────────────────────────────────────

def parse_regen(spec: str | None) -> set[int] | None:
    if not spec:
        return None
    out: set[int] = set()
    for tok in spec.replace(" ", "").split(","):
        if tok:
            out.add(int(tok))
    return out


def illustration_slides(carousel: dict) -> list[dict]:
    """Slides that need a fresh raw illustration (scene + images/ source)."""
    return [
        s for s in carousel["slides"]
        if s.get("illustration_scene")
        and isinstance(s.get("illustration_source_relpath"), str)
        and s["illustration_source_relpath"].startswith("images/")
    ]


def run_batch(label: str, slides: list[dict], fn, workers: int) -> int:
    """Generic parallel dispatch over slides. Returns process exit code."""
    if not slides:
        print(f"  ({label}) no slides to mint.")
        return 0
    print(f"  ({label}) {len(slides)} slide(s), {workers} parallel worker(s)\n")
    results: list[tuple[int, int]] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(fn, s): s["index"] for s in slides}
        for fut in as_completed(futs):
            idx, code, tail = fut.result()
            status = "ok" if code == 0 else f"FAIL exit {code}"
            print(f"  [slide {idx:02d}] {status}\n    {tail}", flush=True)
            results.append((idx, code))
    failed = [i for i, c in results if c != 0]
    if failed:
        print(f"\n  ({label}) FAILED slides: {failed}")
        return 1
    print(f"\n  ({label}) all {len(results)} slide(s) ok")
    return 0


# ── Main ──────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(parser)
    parser.add_argument("--mode", required=True, choices=VALID_MODES,
                        help="Carousel build mode. REQUIRED. Logged as usage_role.")
    parser.add_argument("--slides", type=int, default=None,
                        help="Expected slide count (sanity-checked against carousel.json).")
    parser.add_argument("--concept", default=None,
                        help="Free-text concept note (logged; carousel.json is the source of truth).")
    parser.add_argument("--reference", action="append", default=[],
                        help="Base STYLE image (png path or URL). Repeatable. "
                             "REQUIRED for --mode reference_matched (load-bearing — defines "
                             "the matched look). In two_pass it optionally anchors illustration style.")
    parser.add_argument("--style-proof", dest="style_proof", action="store_true",
                        help="Generate slide 1 only as an optional preview; never an approval gate.")
    parser.add_argument("--slide", type=int, default=None,
                        help="Operate on ONE slide index (overrides --style-proof/--regen).")
    parser.add_argument("--regen", default=None,
                        help="Comma-separated slide indices to re-mint (implies --force on those).")
    parser.add_argument("--workers", type=int, default=None,
                        help="Max parallel mints. Default: one per slide. Use --workers 3 on "
                             "Replicate accounts under $10 credit (stays under the 5-burst limit).")
    parser.add_argument("--force", action="store_true",
                        help="Re-mint even if the output PNG already exists. Default: skip existing.")
    parser.add_argument("--no-illustrations", dest="illustrations", action="store_false",
                        help="[two_pass] Skip stage 1 (reuse existing illustrations); run layout only.")
    parser.add_argument("--style", default=None,
                        help="Layout style for the typeset pass: a preset name "
                             f"({', '.join(sorted(LAYOUT_STYLE_PRESETS))}) or a job-relative "
                             "JSON style file. Overrides carousel.json 'layout_style'; "
                             f"default {DEFAULT_LAYOUT_STYLE}.")
    return parser


def main() -> int:
    args = build_parser().parse_args()

    job_dir = resolve_job_dir(args.job)
    job_id = job_dir.name
    carousel_path = billing_input_path(job_dir / "carousel.json")
    if not carousel_path.is_file():
        raise SystemExit(f"Missing {carousel_path}. Author the carousel narrative first.")
    carousel = json.loads(carousel_path.read_text())
    all_slides = carousel["slides"]

    # Sanity-check slide count if --slides was passed.
    if args.slides is not None and args.slides != len(all_slides):
        print(f"  [warn] --slides {args.slides} != {len(all_slides)} slides in carousel.json "
              f"(carousel.json wins).", file=sys.stderr)

    regen = parse_regen(args.regen)
    force = args.force or bool(regen)

    # Resolve the layout style before anything is minted, so a bad style file
    # costs nothing (--style wins over carousel.json "layout_style").
    style_value = args.style or carousel.get("layout_style")
    style = resolve_layout_style(style_value, job_dir)
    if (layout_style_path(style_value, job_dir) is not None
            and not carousel.get("handle", style.get("handle"))
            and any("handle" in _template_fields(style[key], key, str(style_value))
                    for key in LAYOUT_TEMPLATE_FIELDS)):
        raise SystemExit(f"layout style {style_value!r} prints {{handle}}, but neither "
                         "carousel.json nor the style file sets 'handle'")

    # Build the active slide subset (precedence: --slide > --style-proof > --regen > all).
    select = lambda slides: select_slides(slides, args)  # noqa: E731

    workers_for = lambda n: args.workers or max(n, 1)  # noqa: E731

    log_event(
        job_dir, tool="build_carousel.py", event="build_started",
        prompt=args.concept,
        extra={
            "usage_role": args.mode,
            "mode": args.mode,
            "slides_in_carousel": len(all_slides),
            "slides_arg": args.slides,
            "style_proof": args.style_proof,
            "slide": args.slide,
            "regen": sorted(regen) if regen else None,
            "force": force,
            "references": list(args.reference),
            "layout_style": style.get("name") or style_value or DEFAULT_LAYOUT_STYLE,
        },
    )

    print(f"Job:   {job_id}")
    print(f"Mode:  {args.mode}  (usage_role)")
    if args.style_proof:
        print("Preview: slide 1 only — inspect if useful, then continue when ready.")
    print()

    rc = 0

    if args.mode == "two_pass":
        style_pack = carousel.get("style_pack")
        if not style_pack:
            raise SystemExit("carousel.json missing 'style_pack' field (required for two_pass).")
        core = extract_core_style_block(style_pack)
        style_refs = [str(r) for r in args.reference]  # optional illustration-style anchor

        # ── Stage 1: raw illustrations ──────────────────────────────────────
        if args.illustrations:
            illu = select(illustration_slides(carousel))
            if not force:
                pending = []
                for s in illu:
                    out = job_dir / s["illustration_source_relpath"]
                    if out.is_file():
                        print(f"  [slide {s['index']:02d}] skip illustration — exists ({out.name})")
                    else:
                        pending.append(s)
                illu = pending
            print(f"\nStage 1 — illustrations (style_pack={style_pack}, "
                  f"CORE_STYLE_BLOCK {len(core)} chars):")
            rc |= run_batch(
                "illustrations", illu,
                lambda s: mint_illustration(s, core, style_refs, job_id),
                workers_for(len(illu)),
            )
        else:
            print("Stage 1 — skipped (--no-illustrations); reusing existing illustrations.")

        # ── Stage 2: typeset layout pass ───────────────────────────────────
        lay = select(all_slides)
        if not force:
            pending = []
            for s in lay:
                out = job_dir / "images" / f"{layout_output_name(s)}.png"
                if out.is_file():
                    print(f"  [slide {s['index']:02d}] skip layout — exists ({out.name})")
                else:
                    pending.append(s)
            lay = pending
        print(f"\nStage 2 — typeset layout (baked typography):")
        rc |= run_batch(
            "layout", lay,
            lambda s: mint_layout(s, carousel, job_dir, job_id, style),
            workers_for(len(lay)),
        )
        out_hint = "slide_NN_layout_v1.png"

    else:  # reference_matched
        style_refs = [str(r) for r in args.reference]
        if not style_refs:
            raise SystemExit(
                "--mode reference_matched requires at least one --reference "
                "(the base STYLE image is load-bearing)."
            )
        slides = select(all_slides)
        if not force:
            pending = []
            for s in slides:
                out = job_dir / "images" / f"{layout_output_name(s)}.png"
                if out.is_file():
                    print(f"  [slide {s['index']:02d}] skip — exists ({out.name})")
                else:
                    pending.append(s)
            slides = pending
        print(f"\nOne-shot — reference-matched ({len(style_refs)} style ref(s), baked typography):")
        rc |= run_batch(
            "reference_matched", slides,
            lambda s: mint_reference_matched(s, carousel, job_dir, job_id, style_refs, style),
            workers_for(len(slides)),
        )
        out_hint = "slide_NN_layout_v1.png"

    out_dir = job_dir / "images"
    log_event(
        job_dir, tool="build_carousel.py", event="build_finished",
        extra={"usage_role": args.mode, "mode": args.mode, "exit_code": rc,
               "output_dir": str(out_dir.relative_to(job_dir.parent))},
    )

    if rc == 0:
        if args.style_proof:
            print(f"\n[OK] Style preview rendered → {out_dir}/ . "
                  f"Re-run WITHOUT --style-proof to batch the rest; no human "
                  f"approval checkpoint is required.")
        else:
            print(f"\n[OK] Carousel slides → {out_dir}/{out_hint}")
    else:
        print(f"\n[FAIL] Some slides failed. Re-run with --regen <indices> to retry just those.")
    return rc


if __name__ == "__main__":
    sys.exit(main())
