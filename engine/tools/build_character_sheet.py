"""
build_character_sheet.py — turnkey, DETERMINISTIC character-sheet builder.

Photos in → a 3-panel character sheet + cropped face references out. This is a
FIXED RECIPE (the `build-character-sheet` molecule, skills/molecules.md
§Character/identity), not an agentic flow: no chat turn, no LLM tokens, no
transcript. The desktop app's Characters panel spawns it directly and renders
its machine-readable progress; a model is never in the loop.

    .venv/bin/python tools/build_character_sheet.py \
        --from-photos <dir> --out <sheet.png> \
        [--name "<display name>"] [--face-refs-out <dir>] \
        [--rail nano|gpt] [--dry-run] [--json] [--job <id>]

The recipe (6 deterministic steps — 3 of them paid):
  1. validate photos       — count + readable (honest, simple: no face model)
  2. face close-up panel    ) three identity-locked panels, each conditioned on
  3. front full-body panel  ) ALL the photos as references (the identity lock).
  4. back full-body panel   ) The default rail is nano-banana-2/edit; --rail gpt
                              falls back to `mint_image --role portrait`.
  5. assemble the sheet     — PIL: 3 panels side-by-side on light grey
  6. save face references   — crop the face close-up → face_refs/

ROUTING (load-bearing): real-person likeness rides an instruction-following,
reference-conditioned image rail. The DEFAULT is **nano-banana-2/edit**, routed
through the VideoClaw gateway (`--rail nano`): an eval (2026-07-22) showed it
beats gpt-image-2 here — it holds the person's exact face AND their real outfit,
does a true back view, and (near-)obeys the "headless" body framing. The prior
**gpt-image-2** rail (`mint_image --role portrait`, `--rail gpt`) stays
selectable for A/B. Both are photoreal-safe. The Seedance avatar rail
(cast_avatar) REJECTS photoreal references with E005 by design — never route
this tool through it.

NANO HEADLESS FINISH: the "cropped at the shoulder line" wording reliably removes
the face but nano stops at the jaw, leaving a small chin/beard sliver at the top
of the body panels. We finish with a PIL top-crop (~7.5%) of the FRONT and BACK
panels — crop, never grey-fill (the vignetted backdrop seams under a fill).
OUTFIT CONSISTENCY: the FRONT result is also passed as an extra reference to the
independent BACK call so the wardrobe matches across the two views.

PROGRESS (--json): one JSON line per step on stdout, shape
  {"step": n, "of": N, "label": "<producer label>", "estimate_usd": <paid only>}
Labels are in producer voice; the app renders them verbatim. In --json mode
stdout is a PURE JSON stream — mint_image's own chatter is redirected to stderr.

DRY RUN (--dry-run): prints the full step plan + optional advisory estimate
(priced from cost.py) and exits 0 WITHOUT any paid call.

SPEND LOGGING (decision — FLAGGED): this tool can run OUTSIDE a chat job (the
whole point of the deterministic panel flow). The **nano** rail makes exactly
one gateway request per panel and books `estimate_usd` on its `gateway_call`
row — the one canonical cost carrier (#63); it never calls fal directly or
self-logs a second cost row. The **gpt** A/B rail delegates to `mint_image`,
which owns its canonical gateway/replicate call row. Placement:
  • --job <id> given  → that job dir is the metering home; spend folds into the
                        chat job's ledger (cost.py reconcile --job <id> sums it).
  • --job omitted     → a CHARACTERS-SCOPED work dir next to --out is used:
                        <out_parent>/.character_build/<sheet_stem>/ . mint_image
                        writes panels there and logs estimate_usd to its
                        run.log.jsonl; point cost.py reconcile at that dir to
                        sum spend. The dir is hidden + clearly temp-pathed, so a
                        failed run leaves inspectable partials without polluting
                        the deliverable.

Common failure modes:
  • No readable photos in --from-photos → clean non-zero exit, plain message.
  • A corrupt/unreadable image file → named in the error, non-zero exit.
  • Vendor error mid-sequence → friendly "please try again" line; the photos and
    any already-minted panels are untouched (kept under .character_build/).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cost import estimate as cost_estimate  # noqa: E402  single source of truth for $
from log import log_event  # noqa: E402

# Pillow — already a dep (pyproject: pillow>=10.0.0). HEIC/HEIF opener is
# registered when pillow-heif is present so iPhone photos read directly.
from PIL import Image  # noqa: E402
try:  # pillow-heif is a repo dep; guard anyway so import-smoke never breaks.
    import pillow_heif  # type: ignore  # noqa: E402
    pillow_heif.register_heif_opener()
except Exception:  # pragma: no cover - optional at import time
    pass

TOOL_NAME = "build_character_sheet.py"

# ── Recipe constants ─────────────────────────────────────────────────────────
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff",
              ".heic", ".heif"}
MAX_REFS = 8            # input_images cap we hold ourselves to (both rails)
PANEL_ROLE = "portrait"  # mint_image role — the photoreal-safe gpt-image-2 rail
PANEL_ASPECT = "2:3"     # gpt-image-2 does 1:1 / 3:2 / 2:3; panels are 2:3
SHEET_BG = (235, 235, 235)   # seamless light-grey studio backdrop
PANEL_HEIGHT = 1200          # normalized panel height for assembly (px)
SHEET_MARGIN = 48
SHEET_GAP = 48
TOTAL_STEPS = 6

# ── Rails ────────────────────────────────────────────────────────────────────
# nano      — DEFAULT. nano-banana-2/edit routed through the GATEWAY, so the
#             spend is metered against the user's account (vc_ key → spend limits
#             / topups). This is what alpha users get; they have no vendor key.
# gpt       — the prior gpt-image-2 portrait rail (via mint_image), kept for A/B.
RAILS = ("nano", "gpt")
DEFAULT_RAIL = "nano"

# The gateway route for the default rail. tool="mint_image" (the sheet panels fit
# the portrait role); model selects the nano-banana-2 edit engine server-side.
# CONTRACT (backend PR, verify against it): POST /v1/mint_image with
#   {mode:"portrait", model:"google/nano-banana-2/edit", prompt, references:[…],
#    params:{aspect_ratio:"2:3", output_format:"jpeg"}, client_job}
# references order = [face refs …, FRONT-result-for-the-BACK-call]; the fal
# adapter maps references→image_urls. Price $0.08/call, metered by the gateway.
NANO_GW_MODEL = "google/nano-banana-2/edit"

NANO_ASPECT = "2:3"          # portrait panels
NANO_OUTPUT_FORMAT = "jpeg"
# The headless wording removes the face but nano stops at the jaw; crop the top
# ~7.5% of the FRONT/BACK body panels to drop the chin/beard sliver (crop, never
# grey-fill — the vignetted backdrop seams under a fill). See HANDOFF.md.
NANO_TOP_CROP_FRAC = 0.075

# The three panels, in sheet order: LEFT face CU · CENTRE body FRONT · RIGHT body
# BACK (the molecule's layout). Prompts are MODEL-facing (not shown to the user);
# each is conditioned on the photos as references. "HEADLESS" on the body panels
# satisfies the molecule gotcha: one face only, for i2v to lock onto.
#   • `prompt`      — the gpt-image-2 rail prompt (--rail gpt).
#   • `nano_prompt` — the nano-banana-2 rail prompt (default), tuned verbatim in
#                     the 2026-07-22 eval HANDOFF (see evals/charsheet_ideogram).
#   • `top_crop`    — nano stops the headless crop at the jaw; PIL-crop the top
#                     ~7.5% of these panels to drop the chin/beard sliver.
# NOTE: the tuned nano prompts say "the SAME man" (they were tuned on a male
# subject). Kept verbatim per the eval handoff; generalising the gendered wording
# for non-male subjects is a tracked follow-up (the gpt prompts stay neutral).
PANELS: list[dict] = [
    {
        "key": "face",
        "label": "Building the face close-up",
        "friendly": "the face close-up",
        "top_crop": False,
        "prompt": (
            "Photoreal portrait of the SAME person shown in the reference photos, "
            "exact same face and identity. Tight head-and-shoulders close-up, "
            "neutral relaxed expression, looking straight at the camera, sharp "
            "focus. Seamless light-grey studio backdrop, even soft diffused light, "
            "no harsh shadows. Natural skin texture and realistic detail. "
            "High resolution."
        ),
        "nano_prompt": (
            "Photoreal studio portrait of the SAME man shown in the reference "
            "photos — exact same face, hair, and beard. Tight head-and-shoulders "
            "close-up, neutral relaxed expression, looking straight at the camera, "
            "sharp focus, seamless light-grey studio backdrop, even soft diffused "
            "light."
        ),
    },
    {
        "key": "body_front",
        "label": "Building the front full-body panel",
        "friendly": "the front full-body panel",
        "top_crop": True,
        "prompt": (
            "Photoreal full-body shot of the SAME person shown in the reference "
            "photos, same everyday outfit and same proportions, FRONT view, "
            "standing in a relaxed stance facing the camera, full outfit and shoes "
            "visible. Seamless light-grey studio backdrop, even soft diffused "
            "light. HEADLESS: crop the frame above the collar so the head is NOT "
            "shown — body and outfit only, no face. High resolution."
        ),
        "nano_prompt": (
            "Photoreal full-body studio shot of the SAME man from the reference "
            "photos, wearing the exact same outfit as in the reference photos, "
            "keep his real proportions. FRONT view, standing in a relaxed neutral "
            "pose, full outfit and shoes visible head to toe. Seamless light-grey "
            "studio backdrop, even soft light. This panel MUST be cropped at the "
            "shoulder line: absolutely NO head, neck, or face — headless mannequin "
            "framing, body and clothing only."
        ),
    },
    {
        "key": "body_back",
        "label": "Building the back full-body panel",
        "friendly": "the back full-body panel",
        "top_crop": True,
        "prompt": (
            "Photoreal full-body shot of the SAME person shown in the reference "
            "photos, same outfit and same proportions, BACK view, standing in the "
            "same relaxed stance facing away from the camera, full outfit and shoes "
            "visible. Seamless light-grey studio backdrop, even soft diffused "
            "light. HEADLESS: crop the frame above the collar so the head is NOT "
            "shown — body and outfit only, no face. High resolution."
        ),
        "nano_prompt": (
            "Photoreal full-body studio shot of the SAME man from the reference "
            "photos, wearing the exact same outfit as in the reference photos, "
            "keep his real proportions. BACK view, facing directly away from the "
            "camera, full outfit and shoes visible head to toe. Seamless light-grey "
            "studio backdrop, even soft light. This panel MUST be cropped at the "
            "shoulder line: absolutely NO head, neck, or face — headless mannequin "
            "framing, body and clothing only."
        ),
    },
]


class BuildError(Exception):
    """A clean, user-facing failure. Its message is printed verbatim (jargon-free)."""


# ── mint_image seam (the paid boundary — mocked in tests) ────────────────────
def _build_mint_argv(job: str, out_path: Path, prompt: str,
                     references: list[Path], aspect: str = PANEL_ASPECT) -> list[str]:
    """Construct the mint_image argv for ONE portrait panel (raw --output mode).

    Pure + deterministic → unit-testable without any vendor call.
    """
    argv = [
        "--job", str(job),
        "--role", PANEL_ROLE,
        "--output", str(out_path),
        "--aspect", aspect,
        "--prompt", prompt,
    ]
    for ref in references:
        argv += ["--reference", str(ref)]
    return argv


def _call_mint_image(argv: list[str], quiet_stdout: bool) -> int:
    """Invoke mint_image.main() with the given argv. THE paid boundary.

    Tests monkeypatch THIS function (module-level seam) so orchestration is
    exercised end-to-end with zero paid calls. mint_image handles its own
    gateway/vendor routing, retries and estimate_usd logging — we delegate
    metering to it entirely. In --json mode its stdout chatter is redirected to
    stderr so our stdout stays a pure JSON stream.
    """
    import mint_image  # lazy: keeps import-smoke free of vendor SDK requirements

    old_argv = sys.argv
    sys.argv = ["mint_image.py", *argv]
    try:
        if quiet_stdout:
            with redirect_stdout(sys.stderr):
                return int(mint_image.main() or 0)
        return int(mint_image.main() or 0)
    finally:
        sys.argv = old_argv


# Vendor-trouble retry for the deterministic pipeline (live QA 2026-07-17:
# a single transient gateway/vendor failure used to kill the whole sheet).
# mint_image already retries transient HTTP inside one call; this catches the
# failures that escape it (an exhausted throttle, a dropped connection).
PANEL_ATTEMPTS = 2
PANEL_RETRIEVE_ATTEMPTS = 3
PANEL_RETRY_SLEEP_S = 5.0


def _mint_panel(job: str, out_path: Path, prompt: str, references: list[Path],
                friendly: str, quiet_stdout: bool) -> Path:
    """Mint one portrait panel; retry once on vendor trouble, then raise a
    clean BuildError. Validation errors (SystemExit) never retry — they won't
    fix themselves."""
    argv = _build_mint_argv(job, out_path, prompt, references)
    last_cause: Exception | None = None
    for attempt in range(1, PANEL_ATTEMPTS + 1):
        try:
            rc = _call_mint_image(argv, quiet_stdout=quiet_stdout)
        except SystemExit as e:  # mint_image validation error
            raise BuildError(
                f"Couldn't create {friendly}: {e}. Your photos are safe — please try again."
            ) from e
        except Exception as e:  # vendor/network error after mint_image's own retries
            # `_Gateway.run()` uses this exact exception to mean the paid POST
            # may already have been accepted. The supported gpt A/B rail must
            # not turn that fail-closed signal into a duplicate paid request.
            from _gateway import GatewayAcceptedError
            if isinstance(e, GatewayAcceptedError):
                raise BuildError(
                    f"Something went wrong while creating {friendly}. Your photos "
                    f"are safe — check the host's in-flight status before trying again."
                ) from e
            last_cause = e
            rc = -1
        if rc == 0 and out_path.exists() and out_path.stat().st_size > 0:
            return out_path
        if attempt < PANEL_ATTEMPTS:
            print(f"  ! creating {friendly} failed (attempt {attempt}/"
                  f"{PANEL_ATTEMPTS}) — retrying", file=sys.stderr)
            time.sleep(PANEL_RETRY_SLEEP_S)
    raise BuildError(
        f"Something went wrong while creating {friendly}. Your photos are "
        f"safe — please try again."
    ) from last_cause


def _top_crop(path: Path, frac: float) -> None:
    """Crop the top `frac` of an image in place (drops nano's chin/beard sliver on
    the headless body panels). Crop — never grey-fill: the vignetted backdrop
    seams under a fill (HANDOFF.md)."""
    with Image.open(path) as im:
        im = im.convert("RGB")
        w, h = im.size
        top = max(0, min(h - 1, int(round(h * frac))))
        im.crop((0, top, w, h)).save(path, "PNG")


# ── nano-via-gateway seam (the DEFAULT paid boundary — mocked in tests) ───────
# The default rail: nano-banana-2/edit routed through videoclaw-backend so the
# user's account is metered. The gateway logs the cost event to run.log.jsonl
# itself (`_Gateway._log_cost` fires when `run(..., job=…)` is given) — so this
# rail does NOT self-log a cost line (that would double-count).
def _gateway_generate(work: Path, mode: str, prompt: str,
                      references: list[Path], out_path: Path) -> dict:
    """Submit one panel through the gateway and return its terminal receipt.

    This is THE paid boundary (monkeypatched in tests). Passing `job=work` makes
    the gateway log the metered cost event to run.log.jsonl. Download and local
    image processing deliberately happen elsewhere: once this returns, retries
    may reuse its asset but must never issue another paid generation.
    """
    from _gateway import gateway  # lazy: keeps import-smoke off the gateway module
    if not gateway.enabled():
        raise BuildError(
            "This machine isn't set up to charge your account (no gateway key). "
            "Ask an admin and try again. Your photos are safe."
        )
    res = gateway.run(
        "mint_image", mode=mode, model=NANO_GW_MODEL, prompt=prompt,
        references=list(references),   # Paths auto-upload → upload:<id> refs
        params={"aspect_ratio": NANO_ASPECT, "output_format": NANO_OUTPUT_FORMAT},
        job=work, client_job=Path(work).name,   # job=work → gateway logs the cost
        _delivery=[out_path],
        _replaces_existing=True,   # the panel is published via note_output (#273)
    )
    return res


def _normalise_downloaded_panel(download_path: Path, ready_path: Path) -> None:
    """Decode a downloaded gateway asset and save a fresh normalized PNG."""
    with Image.open(download_path) as im:
        im.convert("RGB").save(ready_path, "PNG")


def _retrieve_gateway_panel(asset: dict, out_path: Path, *,
                            friendly: str, top_crop: bool) -> Path:
    """Retry download/decode/save/crop against one accepted asset URL.

    All local work lands in temporary siblings and is atomically promoted only
    after every step succeeds. A retry therefore reuses the same paid asset and
    cannot double-crop or expose a partially decoded panel.
    """
    from _gateway import gateway

    out_path.parent.mkdir(parents=True, exist_ok=True)
    download_path = out_path.with_name(f".{out_path.name}.download")
    ready_path = out_path.with_name(f".{out_path.name}.ready")
    last_cause: Exception | None = None
    try:
        for attempt in range(1, PANEL_RETRIEVE_ATTEMPTS + 1):
            download_path.unlink(missing_ok=True)
            ready_path.unlink(missing_ok=True)
            try:
                gateway.download(asset["url"], download_path)
                _normalise_downloaded_panel(download_path, ready_path)
                if top_crop:
                    _top_crop(ready_path, NANO_TOP_CROP_FRAC)
                if not ready_path.exists() or ready_path.stat().st_size <= 0:
                    raise RuntimeError("processed gateway asset is empty")
                gateway.note_output(asset, out_path, pending_bytes=ready_path.read_bytes())
                ready_path.replace(out_path)
                return out_path
            except Exception as e:
                last_cause = e
                if attempt < PANEL_RETRIEVE_ATTEMPTS:
                    print(
                        f"  ! retrieving {friendly} failed (attempt {attempt}/"
                        f"{PANEL_RETRIEVE_ATTEMPTS}) — retrying the same asset",
                        file=sys.stderr,
                    )
                    time.sleep(PANEL_RETRY_SLEEP_S)
        raise BuildError(
            f"Something went wrong while retrieving {friendly}. Your photos are "
            f"safe — please try again."
        ) from last_cause
    finally:
        download_path.unlink(missing_ok=True)
        ready_path.unlink(missing_ok=True)


def _mint_panel_gateway(work: Path, out_path: Path, prompt: str,
                        references: list[Path], friendly: str,
                        top_crop: bool) -> Path:
    """Generate one panel without ever replaying an accepted paid request.

    Generation submission is attempted exactly once: without a backend stable
    idempotency key, even a timeout/5xx can mean the POST was accepted and its
    response was lost. Poll failures after a job id retry against that same id.
    Once the terminal receipt exists, download and local processing retry only
    the same asset URL. No self-metering — the gateway owns the cost row.
    """
    try:
        res = _gateway_generate(work, PANEL_ROLE, prompt, references, out_path)
    except BuildError:
        raise
    except Exception as e:
        # This includes ambiguous POST response loss and accepted-job failures.
        # There is intentionally no submission loop: a second POST could mint
        # and bill a duplicate panel.
        raise BuildError(
            f"Something went wrong while creating {friendly}. Your photos are "
            f"safe — please try again."
        ) from e

    assets = res.get("assets") or []
    if not assets or not assets[0].get("url"):
        # A succeeded gateway call without an asset is still accepted/billable.
        # Never return to the submission loop.
        raise BuildError(
            f"Something went wrong while retrieving {friendly}. Your photos are "
            f"safe — please try again."
        )
    result = _retrieve_gateway_panel(
        assets[0], out_path, friendly=friendly, top_crop=top_crop
    )
    from _gateway import gateway
    gateway.note_output(assets[0], out_path)
    return result


# ── Steps ────────────────────────────────────────────────────────────────────
def _collect_photos(from_photos: Path) -> list[Path]:
    """Validate the photo folder: count + readability (simple + honest, no face
    model). Returns the readable photos, sorted. Raises BuildError on failure."""
    if not from_photos.exists() or not from_photos.is_dir():
        raise BuildError(
            f"Couldn't find a photos folder at {from_photos}. "
            f"Point --from-photos at a folder of photos and try again."
        )
    candidates = sorted(
        p for p in from_photos.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )
    if not candidates:
        raise BuildError(
            f"No photos found in {from_photos}. Add a few clear photos "
            f"(JPG, PNG or HEIC) and try again."
        )
    for p in candidates:
        try:
            with Image.open(p) as im:
                im.load()  # force a real decode — verify() alone misses some corruption
        except Exception:
            raise BuildError(
                f"Couldn't read \"{p.name}\" — it may be corrupted or not a photo. "
                f"Remove it from the folder and try again."
            )
    return candidates


def _assemble_sheet(panel_paths: list[Path], out_path: Path) -> Path:
    """Compose the three panels side-by-side on a light-grey canvas (the
    molecule's layout: LEFT face CU · CENTRE body front · RIGHT body back)."""
    panels = []
    for p in panel_paths:
        im = Image.open(p).convert("RGB")
        w, h = im.size
        new_w = max(1, round(w * (PANEL_HEIGHT / h)))
        panels.append(im.resize((new_w, PANEL_HEIGHT), Image.LANCZOS))

    total_w = SHEET_MARGIN * 2 + sum(p.width for p in panels) + SHEET_GAP * (len(panels) - 1)
    total_h = SHEET_MARGIN * 2 + PANEL_HEIGHT
    canvas = Image.new("RGB", (total_w, total_h), SHEET_BG)

    x = SHEET_MARGIN
    for p in panels:
        canvas.paste(p, (x, SHEET_MARGIN))
        x += p.width + SHEET_GAP

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG")
    return out_path


def _save_face_refs(face_panel: Path, face_refs_out: Path) -> list[Path]:
    """Crop the face close-up → face_refs/. The face CU is the GOLD identity ref;
    it is already a tight head-and-shoulders panel, so we normalize it to PNG and
    land it as real_face_01.png (the molecule's naming)."""
    face_refs_out.mkdir(parents=True, exist_ok=True)
    ref_path = face_refs_out / "real_face_01.png"
    with Image.open(face_panel) as im:
        im.convert("RGB").save(ref_path, "PNG")
    return [ref_path]


# ── Progress emission ────────────────────────────────────────────────────────
def _emit(json_mode: bool, step: int, label: str, estimate_usd: float | None) -> None:
    if json_mode:
        rec: dict = {"step": step, "of": TOTAL_STEPS, "label": label}
        if estimate_usd is not None:
            rec["estimate_usd"] = estimate_usd
        print(json.dumps(rec), flush=True)
    else:
        money = f"  (~${estimate_usd:.2f})" if estimate_usd is not None else ""
        print(f"[{step}/{TOTAL_STEPS}] {label}{money}", flush=True)


def _panel_unit_usd(rail: str = DEFAULT_RAIL) -> float:
    """Per-panel $ for the chosen rail, straight from cost.py (single source of
    truth). The explicit GPT fallback has a separate rectangular-high row;
    Nano uses the published 1K flat rate."""
    return float(cost_estimate("build_character_sheet", rail, 1)["est_usd"])


def _plan(rail: str = DEFAULT_RAIL) -> tuple[list[dict], float]:
    """The fixed step plan + total estimate (priced from cost.py). Deterministic
    and FREE — used by --dry-run and the real run alike."""
    unit = _panel_unit_usd(rail)
    steps = [
        {"step": 1, "of": TOTAL_STEPS, "label": "Checking your photos", "estimate_usd": None},
        {"step": 2, "of": TOTAL_STEPS, "label": PANELS[0]["label"], "estimate_usd": unit},
        {"step": 3, "of": TOTAL_STEPS, "label": PANELS[1]["label"], "estimate_usd": unit},
        {"step": 4, "of": TOTAL_STEPS, "label": PANELS[2]["label"], "estimate_usd": unit},
        {"step": 5, "of": TOTAL_STEPS, "label": "Assembling the character sheet", "estimate_usd": None},
        {"step": 6, "of": TOTAL_STEPS, "label": "Saving the face references", "estimate_usd": None},
    ]
    total = round(sum(s["estimate_usd"] for s in steps if s["estimate_usd"]), 4)
    return steps, total


# ── Orchestration ────────────────────────────────────────────────────────────
def build(from_photos: Path, out: Path, *, name: str | None = None,
          face_refs_out: Path | None = None, job: str | None = None,
          work_dir: Path | None = None, json_mode: bool = False,
          rail: str = DEFAULT_RAIL) -> dict:
    """Run the full recipe. Returns a result dict. Raises BuildError on failure."""
    if rail not in RAILS:
        raise BuildError(f"Unknown rail '{rail}' — pick one of: {', '.join(RAILS)}.")
    out = out.expanduser().resolve()
    face_refs_out = (face_refs_out.expanduser().resolve() if face_refs_out
                     else out.parent / "face_refs")

    # Metering / work home (see the module docstring's SPEND LOGGING decision).
    if job:
        work = (work_dir.expanduser().resolve() if work_dir
                else _job_metering_dir(job).resolve())
    else:
        work = (work_dir.expanduser().resolve() if work_dir
                else out.parent / ".character_build" / out.stem)
    metering_job = str(work)
    work.mkdir(parents=True, exist_ok=True)
    panels_dir = work / "panels"
    panels_dir.mkdir(parents=True, exist_ok=True)

    steps, total = _plan(rail)
    started = time.perf_counter()
    log_event(work, tool=TOOL_NAME, event="build_started",
              extra={"name": name, "from_photos": str(from_photos), "out": str(out),
                     "face_refs_out": str(face_refs_out), "job": job, "rail": rail,
                     "total_estimate_usd": total, "steps": TOTAL_STEPS})

    # Step 1 — validate photos (free)
    _emit(json_mode, 1, "Checking your photos", None)
    photos = _collect_photos(from_photos.expanduser().resolve())
    references = photos[:MAX_REFS]
    log_event(work, tool=TOOL_NAME, event="photos_validated",
              extra={"readable": len(photos), "used_as_reference": len(references),
                     "files": [p.name for p in references]})

    # Steps 2-4 — the three identity-locked panels (paid). Metering by rail:
    #   nano (gateway) → the gateway logs the cost event; we do NOT self-log.
    #   gpt (mint_image) → mint_image logs its own estimate_usd.
    # Outfit consistency: the FRONT result is also passed to the BACK call.
    # Failures are logged to the work dir's run.log.jsonl WITH the underlying
    # cause — the friendly line the app shows is deliberately jargon-free, so
    # this log is the only place the real error survives (live QA 2026-07-17:
    # sheet failures left zero diagnosable trace anywhere).
    panel_paths: list[Path] = []
    front_path: Path | None = None
    for i, panel in enumerate(PANELS):
        step_no = i + 2
        _emit(json_mode, step_no, panel["label"], steps[step_no - 1]["estimate_usd"])
        panel_out = panels_dir / f"{panel['key']}.png"
        is_back = panel["key"] == "body_back"
        try:
            if rail == "gpt":
                _mint_panel(metering_job, panel_out, panel["prompt"], references,
                            friendly=panel["friendly"], quiet_stdout=json_mode)
            else:  # nano (gateway, default)
                refs = list(references)
                if is_back and front_path is not None:
                    refs.append(front_path)                      # outfit match
                _mint_panel_gateway(work, panel_out, panel["nano_prompt"], refs,
                                    friendly=panel["friendly"],
                                    top_crop=panel["top_crop"])
        except BuildError as e:
            log_event(work, tool=TOOL_NAME, event="build_failed",
                      extra={"step": step_no, "panel": panel["key"], "rail": rail,
                             "error": str(e),
                             "cause": repr(e.__cause__) if e.__cause__ else None})
            raise
        panel_paths.append(panel_out)
        if panel["key"] == "body_front":
            front_path = panel_out

    # Step 5 — assemble the sheet (free, REAL)
    _emit(json_mode, 5, "Assembling the character sheet", None)
    _assemble_sheet(panel_paths, out)
    assert out.is_relative_to(out.parent), f"sheet wrote outside its parent: {out}"

    # Step 6 — crop face references (free, REAL)
    _emit(json_mode, 6, "Saving the face references", None)
    face_refs = _save_face_refs(panel_paths[0], face_refs_out)

    duration = time.perf_counter() - started
    result = {
        "ok": True,
        "name": name,
        "rail": rail,
        "out": str(out),
        "face_refs": [str(p) for p in face_refs],
        "panels": [str(p) for p in panel_paths],
        "source_photos": [str(p) for p in references],
        "total_estimate_usd": total,
        "work_dir": str(work),
        "created_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    # Lightweight metadata sidecar next to the sheet (name + refs + spend). This
    # is intentionally minimal — the first-class characters/<slug>/ roster
    # convention (issue #13 item 2) is a separate, engine-wide follow-up.
    meta_path = out.with_suffix(out.suffix + ".json")
    meta_path.write_text(json.dumps(result, indent=2))
    result["meta"] = str(meta_path)

    log_event(work, tool=TOOL_NAME, event="build_completed",
              duration_seconds=duration, extra=result)
    return result


def _job_metering_dir(job: str) -> Path:
    """Resolve a --job id/path to its dir for metering (imports job.py lazily so
    import-smoke and dry-run stay free of any job-resolution side effects)."""
    from job import resolve_job_dir
    return resolve_job_dir(job)


# ── CLI ──────────────────────────────────────────────────────────────────────
def _dry_run(json_mode: bool, rail: str = DEFAULT_RAIL) -> int:
    steps, total = _plan(rail)
    paid = sum(1 for s in steps if s["estimate_usd"])
    if json_mode:
        print(json.dumps({
            "dry_run": True,
            "rail": rail,
            "steps": TOTAL_STEPS,
            "paid_steps": paid,
            "total_estimate_usd": total,
            "plan": steps,
        }), flush=True)
    else:
        print(f"Character-sheet build plan — rail: {rail} (nothing paid runs yet):")
        for s in steps:
            money = f"  ~${s['estimate_usd']:.2f}" if s["estimate_usd"] else ""
            print(f"  {s['step']}/{s['of']}  {s['label']}{money}")
        print(f"\nTotal estimate: ~${total:.2f}  ({paid} paid step(s))")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--from-photos", required=True,
                        help="Folder of the person's photos (JPG/PNG/HEIC/…).")
    parser.add_argument("--out", required=True,
                        help="Where to write the finished sheet PNG.")
    parser.add_argument("--name", default=None,
                        help="Display name for the character (stored in metadata).")
    parser.add_argument("--face-refs-out", default=None,
                        help="Folder for the cropped face reference(s). "
                             "Default: <out folder>/face_refs/.")
    parser.add_argument("--job", default=None,
                        help="Optional chat job id/dir. When given, spend folds "
                             "into that job's ledger; otherwise a characters-scoped "
                             "work dir next to --out holds the spend log.")
    parser.add_argument("--work-dir", default=None,
                        help="Override the metering/work dir (advanced).")
    parser.add_argument("--rail", choices=RAILS, default=DEFAULT_RAIL,
                        help="Image rail. 'nano' (default): nano-banana-2 via the "
                             "gateway, charged to your account. 'gpt': the "
                             "gpt-image-2 portrait rail (A/B).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the step plan + total estimate and exit 0 "
                             "WITHOUT any paid call.")
    parser.add_argument("--json", action="store_true",
                        help="Machine-readable output: one JSON line per step on "
                             "stdout (and a terminal result line).")
    args = parser.parse_args()

    if args.dry_run:
        return _dry_run(args.json, args.rail)

    try:
        result = build(
            Path(args.from_photos), Path(args.out),
            name=args.name,
            face_refs_out=Path(args.face_refs_out) if args.face_refs_out else None,
            job=args.job,
            work_dir=Path(args.work_dir) if args.work_dir else None,
            json_mode=args.json,
            rail=args.rail,
        )
    except BuildError as e:
        if args.json:
            print(json.dumps({"error": str(e)}), flush=True)
        else:
            print(f"Error: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # unexpected — still surface a clean line, non-zero exit
        msg = f"The character-sheet build hit an unexpected problem: {e}"
        if args.json:
            print(json.dumps({"error": msg}), flush=True)
        else:
            print(f"Error: {msg}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result), flush=True)
    else:
        print(f"\nSheet ready: {result['out']}")
        print(f"Face references: {', '.join(result['face_refs'])}")
        print(f"Spent (est): ~${result['total_estimate_usd']:.2f}  (rail: {result['rail']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
