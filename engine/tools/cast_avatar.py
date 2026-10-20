"""
cast_avatar — mint the synthetic performer's identity sheet.

Canonical, self-contained consolidation of the legacy `generate_avatar.py`
backend. Generates the identity-anchor stills (`front`, optional `profile`) that
lock the performer's face, wardrobe, lighting, room and ACCENT across every
downstream `perform_avatar` (Seedance) chunk.

    # Mint the front anchor (after authoring avatar/character_sheet.json):
    uv run python tools/cast_avatar.py --job <id> --role spokesperson

    # Mint front + profile:
    uv run python tools/cast_avatar.py --job <id> --role spokesperson --with-profile

    # Re-roll one angle only (leave the other untouched). The new still
    # replaces avatar_<angle>.png; the old one moves to
    # <job_dir>/previous_takes/<UTC time>/avatar/ (videoclaw#283):
    uv run python tools/cast_avatar.py --job <id> --role spokesperson --regen-front
    uv run python tools/cast_avatar.py --job <id> --role spokesperson --regen-profile

    # On-demand identity-locked variant (text-to-image; restate identity yourself):
    uv run python tools/cast_avatar.py --job <id> --role spokesperson \
        --add-shot tight_close_up_smile \
        --prompt "Same 45yo man, salt-and-pepper beard, navy merino crewneck,
                  walnut bookshelf behind. Tight close-up, gentle confiding smile,
                  slow push-in feel. 85mm, shallow DOF, super realistic pores. 2:3."

Reads:  <job_dir>/avatar/character_sheet.json   (you author this — see schema below)
Writes: <job_dir>/avatar/avatar_front.png
        <job_dir>/avatar/avatar_profile.png      (when --with-profile / --regen-profile)
        <job_dir>/avatar/avatar_<shot_name>.png   (one per --add-shot call)
        <job_dir>/avatar/character_sheet.json     (rewritten with BytePlus URLs)

CHARACTER DESIGN IS DONE BY CLAUDE, NOT BY THIS TOOL.
There is no interim LLM design call. Before running this tool, write the
character sheet yourself based on company.json + website_context.txt + the
per-job vision.md. Schema:

    {
      "company": "<company name>",
      "character_description": "<2-3 sentences: who the avatar is>",
      "brand_alignment": "<one sentence: why this character fits the brand>",
      "accent": "American" | "British" | ...,        # locked voice accent
      "seedance_anchor_description": "<1-2 sentences used VERBATIM at the start of
         every Seedance prompt to lock character continuity. MUST name the accent
         so voice doesn't drift between Seedance chunks.>",
      "prompts": {
        "front":   "<full Seedream prompt for the canonical forward portrait —
                     this is THE identity anchor.>",
        "profile": "<optional full Seedream prompt for the 3/4 / profile angle.
                     If absent, --with-profile derives one from `front`.>"
      }
    }

Why Seedream 5 Lite + return_byteplus_urls=True (REQUIRED, load-bearing):
  Direct photorealistic face uploads can be rejected by Seedance's
  face-detection moderation. Generate the face with Seedream 5 Lite and request
  BytePlus URLs instead. The returned URL is recognised as a TRUSTED INPUT by
  Seedance. These BytePlus URLs expire
  after ~24h — after that the avatar must be regenerated. seedance.py reads the
  URLs from character_sheet.json and refuses to fall back to local upload (a
  local PNG fails E005). There is no working fallback for a photoreal avatar.

  In the shipped app this route runs through the gateway on Fal. The direct
  Replicate call below is retained only for unkeyed local development while the
  migration drains.

--add-shot <name> --prompt "<text>":
  Mints ONE additional shot via TEXT-TO-IMAGE (no image_input). Seedance only
  trusts text-to-image BytePlus URLs, so identity continuity is YOUR job:
  re-state face/hair/beard/wardrobe/room in the prompt. The generated image gets
  a fresh BytePlus URL keyed under `<name>` in character_sheet.json. Prefer
  in-shot camera direction (push-in / pull-back / rotate) over a new shot where
  possible — a single avatar URL is the strongest identity lock across chunks.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path

import replicate
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from job import resolve_job_dir, add_job_arg, billing_input_path  # noqa: E402
from _billing_manifest import job_path as billing_job_path  # noqa: E402
from log import log_event  # noqa: E402
from _gateway import gateway, GatewayNotSubmittedError  # noqa: E402  dual mode: VIDEOCLAW_API_KEY set → gateway routes Seedream
from _takes import PaidTake, write_atomic  # noqa: E402

load_dotenv()

os.environ["REPLICATE_API_TOKEN"] = os.environ.get("REPLICATE_API_TOKEN", "")

TOOL_NAME = "cast_avatar.py"
SEEDREAM_MODEL = "bytedance/seedream-5-lite"
BYTEPLUS_URL_TTL_HOURS = 24
DEFAULT_ASPECT_RATIO = "2:3"


def _slug(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_]+", "_", s).strip("_").lower()
    return s or "shot"


# ---------------------------------------------------------------------------
# Seedream generation — the load-bearing BytePlus-trusted-URL flow.
# ---------------------------------------------------------------------------
def _byteplus_url(raw) -> str:
    first = raw[0] if isinstance(raw, list) and raw else raw
    return first if isinstance(first, str) else str(first or "")


def _reusable_take(take: PaidTake, *, waiting: bool, sheet_url: str | None) -> tuple[str, datetime] | None:
    """The BytePlus URL of a take an interrupted run already paid for, if still live.

    The PNG alone is not the product: Seedance needs its trusted URL, which
    only the saved gateway result carries. Past the URL's TTL the take can't
    serve the request, so it is kept aside and a fresh one is bought.

    Two interrupted runs qualify: one stopped before publishing its take
    (``waiting``: the app saved it under ``.takes/``), and one stopped after
    publishing it but before saving the sheet (killed or failed on the next
    anchor): the still in place is then this request's paid take, and the
    sheet still names another URL. Once the sheet carries that URL, the same
    command is a deliberate re-roll and pays.
    """
    record = take.saved_record() if waiting else take.published_record()
    url = _byteplus_url(((record or {}).get("result") or {}).get("output"))
    if not record or not url.startswith("http") or (not waiting and url == sheet_url):
        return None
    issued = datetime.fromtimestamp(record["created_at"], timezone.utc)
    if (datetime.now(timezone.utc) - issued).total_seconds() / 3600 >= BYTEPLUS_URL_TTL_HOURS:
        return None
    return url, issued


def generate_image(
    prompt: str,
    out_path: Path,
    job: Path,
    slot: str,
    *,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    image_input: list[str] | None = None,
    usage_role: str | None = None,
    replace: bool = False,
    sheet_url: str | None = None,
) -> tuple[str, datetime] | None:
    """Generate one image with seedream-5-lite. Returns (BytePlus URL, issued at).

    `image_input` is a list of input image URLs. When non-empty, seedream
    operates in image-to-image mode. NOTE: image-to-image does NOT yield a
    Seedance-trusted URL, so the front/profile/add-shot paths all pass
    image_input=None (text-to-image) on purpose.

    Always writes the PNG bytes to ``out_path`` for local review. The local PNG
    cannot be used as a Seedance reference (E005); only the returned BytePlus
    URL is trusted by Seedance.

    ``replace`` (the front/profile anchors, videoclaw#283): the paid still is
    saved as a take owned by this exact request and then replaces
    ``out_path``; the previous still moves to ``previous_takes/``. A re-run of
    the same request reuses a take an interrupted run already paid for while
    its BytePlus URL is still live, instead of buying it again. ``sheet_url``
    is the URL the character sheet records for this still.
    """
    print(f"  Generating {out_path.name}...")
    start = time.perf_counter()
    held = ExitStack()
    try:
        inp = {
            "prompt": prompt,
            "size": "2K",
            "aspect_ratio": aspect_ratio,
            "output_format": "png",
            "max_images": 1,
            "image_input": image_input or [],
            "sequential_image_generation": "disabled",
        }
        take = (PaidTake(job, [out_path], {"model": SEEDREAM_MODEL, "slot": slot, **inp},
                         tool=TOOL_NAME) if replace else None)
        if take:
            held.enter_context(take.hold())
        waiting = take is not None and take.ready()
        reused = _reusable_take(take, waiting=waiting, sheet_url=sheet_url) if take else None
        if waiting and not reused:
            for path in take.set_aside():
                print(f"  An earlier paid {out_path.name} has no live BytePlus URL any more; "
                      f"kept unused at {path}")
        destination = take.paths[0] if take else out_path
        issued_at = datetime.now(timezone.utc)
        if reused:
            byteplus_url, issued_at = reused
            print(f"  Reusing the paid {out_path.name} of an interrupted run (nothing charged now)")
        elif gateway.enabled():
            # DUAL MODE: route through the gateway. Same input dict rides as
            # `params`, minus return_byteplus_urls — the SERVER adds that flag
            # via route defaults, and the route is _raw_output so the vendor's
            # BytePlus URLs come back VERBATIM under res["output"]. https URLs
            # in image_input pass through untouched; local paths become
            # "upload:<id>" refs the server deep-resolves in place.
            inp["image_input"] = [
                r if isinstance(r, str) and r.startswith(("http", "upload:"))
                else gateway.upload(r)
                for r in (image_input or [])
            ]
            try:
                res = gateway.run(
                    "cast_avatar",
                    mode=slot if slot in ("front", "profile") else "add_shot",
                    params=inp,
                    slot=slot,            # registry mode_param — server reads body["slot"]
                    job=job, _delivery=[destination],
                    timeout_s=600,
                )
            except GatewayNotSubmittedError as exc:
                raise (take.refusal(exc) if take else exc) from exc
            byteplus_url = _byteplus_url(res.get("output"))
            if not byteplus_url:
                raise RuntimeError(
                    "gateway returned no BytePlus URL in res['output'] — "
                    "Seedance needs the trusted URL; check the cast_avatar route.")
            gateway.download_asset(res["assets"][0], destination)
        else:
            inp["return_byteplus_urls"] = True   # CRITICAL: trusted Seedance input
            output = replicate.run(SEEDREAM_MODEL, input=inp)
            first = output[0]
            byteplus_url = first.url if hasattr(first, "url") else str(first)
            if take:
                write_atomic(destination, first.read())
            else:
                out_path.write_bytes(first.read())
        kept = (take.publish() or []) if take else []
        image_data = out_path.read_bytes()
        print(f"  ✓ Saved {out_path.name} ({len(image_data)//1024}KB)")
        for path in kept:
            print(f"    previous take kept → {path}")
        print(f"    URL: {byteplus_url[:90]}...")
        extra = {
            "model": SEEDREAM_MODEL,
            "slot": slot,
            "usage_role": usage_role,
            "aspect_ratio": aspect_ratio,
            "output_path": str(out_path.relative_to(job)),
            "byteplus_url": byteplus_url,
            "image_input_count": len(image_input or []),
            "size_bytes": len(image_data),
        }
        if reused:
            extra["reused_paid_take"] = True
        if take and take.adopted_from:
            extra.update(reused_from_other_inputs=True, adopted_take_key=take.adopted_from)
        if kept:
            extra["previous_take"] = [str(path.relative_to(take.root)) for path in kept]
        if gateway.enabled():
            # The shared gateway_call row owns cost, including recovery.
            extra["gateway"] = True
        log_event(
            job, tool=TOOL_NAME, event="seedream_image_generated",
            prompt=prompt,
            duration_seconds=time.perf_counter() - start,
            extra=extra,
        )
        return byteplus_url, issued_at
    except Exception as e:
        print(f"  ✗ Failed {out_path.name}: {e}")
        log_event(
            job, tool=TOOL_NAME, event="seedream_image_failed",
            prompt=prompt,
            duration_seconds=time.perf_counter() - start,
            extra={
                "slot": slot,
                "usage_role": usage_role,
                "error": type(e).__name__,
                "error_message": str(e)[:300],
            },
        )
        return None
    finally:
        held.close()


# ---------------------------------------------------------------------------
# Character sheet I/O
# ---------------------------------------------------------------------------
def _load_sheet(sheet_path: Path) -> dict:
    if not sheet_path.exists():
        raise FileNotFoundError(
            f"{sheet_path} not found.\n\n"
            "Claude writes the character sheet directly — no interim LLM call.\n"
            "Author it based on company.json + website_context.txt + vision.md\n"
            "before running this tool. See the docstring at the top of\n"
            "cast_avatar.py for the schema."
        )
    return json.loads(sheet_path.read_text())


def _save_sheet(sheet: dict, sheet_path: Path) -> None:
    sheet_path.write_text(json.dumps(sheet, indent=2))


def _stamp_ttl(sheet: dict, issued_at: datetime | None = None) -> str:
    # A reused paid take's URL is as old as its request, not as old as now.
    generated_at = (issued_at or datetime.now(timezone.utc)).isoformat()
    sheet["byteplus_urls_generated_at_utc"] = generated_at
    sheet["byteplus_urls_ttl_hours"] = BYTEPLUS_URL_TTL_HOURS
    return generated_at


def _byteplus_url_expired(sheet: dict) -> bool:
    """True if the existing BytePlus URLs were minted >24h ago."""
    stamp = sheet.get("byteplus_urls_generated_at_utc")
    if not stamp:
        return False
    try:
        issued = datetime.fromisoformat(stamp)
    except ValueError:
        return False
    elapsed_hours = (datetime.now(timezone.utc) - issued).total_seconds() / 3600
    return elapsed_hours > BYTEPLUS_URL_TTL_HOURS


def _record_file(sheet: dict, key: str, out_path: Path) -> None:
    """Store a repo-relative path when possible, else absolute (job dirs may
    live outside the repo, e.g. a reproduction working dir)."""
    try:
        sheet["avatar_files"][key] = str(out_path.relative_to(Path(".").resolve()))
    except ValueError:
        sheet["avatar_files"][key] = str(out_path.resolve())


def _profile_prompt(sheet: dict) -> str | None:
    """Profile prompt: explicit prompts.profile, else derive from prompts.front
    by appending a 3/4-angle direction so identity is restated verbatim."""
    prompts = sheet.get("prompts") or {}
    if prompts.get("profile"):
        return prompts["profile"]
    front = prompts.get("front")
    if not front:
        return None
    return (
        front.rstrip(". ")
        + ". Three-quarter / side-profile angle of the SAME person, same wardrobe, "
        "same lighting, same room, head turned ~30 degrees, eyes toward camera."
    )


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------
def _mint_anchor(
    sheet: dict, sheet_path: Path, avatar_dir: Path, job: Path, *,
    key: str, prompt: str, aspect_ratio: str, regen: bool, usage_role: str,
) -> datetime | None:
    """Mint one canonical anchor (`front` / `profile`).

    Returns when its BytePlus URL was issued, or None if nothing was minted.
    A new take replaces `avatar_<key>.png`; the previous still is kept under
    `previous_takes/` (videoclaw#283).
    """
    out_path = avatar_dir / f"avatar_{key}.png"
    existing = sheet["avatar_byteplus_urls"].get(key)
    if out_path.exists() and not regen and existing:
        if _byteplus_url_expired(sheet):
            print(
                f"⚠ Existing `{key}` BytePlus URL expired (>{BYTEPLUS_URL_TTL_HOURS}h since "
                f"{sheet.get('byteplus_urls_generated_at_utc')}). Auto-regenerating to mint a fresh URL."
            )
            # fall through to regenerate
        else:
            print(f"`{key}` already minted. Pass --regen-{key} to replace it "
                  "(the current still is kept under previous_takes/).")
            return None

    minted = generate_image(
        prompt, out_path, job, key,
        aspect_ratio=aspect_ratio, image_input=None, usage_role=usage_role,
        replace=True, sheet_url=existing,
    )
    if not minted:
        raise RuntimeError(
            f"`{key}` avatar generation failed (reason above). seedance.py REQUIRES a fresh "
            f"BytePlus URL for the {key} avatar — there is no working fallback."
        )
    url, issued_at = minted
    sheet["avatar_byteplus_urls"][key] = url
    _record_file(sheet, key, out_path)
    return issued_at


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description="Mint the synthetic performer's identity sheet (front + optional profile).",
    )
    add_job_arg(parser)
    parser.add_argument(
        "--role",
        required=True,
        help="Casting role for this avatar (e.g. 'spokesperson', 'endorser'). "
             "Logged as usage_role on every event.",
    )
    parser.add_argument(
        "--accent",
        default=None,
        help="Lock the spoken accent (e.g. 'American', 'British'). Written into "
             "character_sheet.json:accent so voice doesn't drift across Seedance "
             "chunks. Overrides any accent already in the sheet.",
    )
    parser.add_argument(
        "--character-sheet",
        default=None,
        metavar="JSON",
        help="Path to the character sheet JSON. Default: "
             "<job_dir>/avatar/character_sheet.json.",
    )
    parser.add_argument(
        "--with-profile",
        action="store_true",
        help="Also mint the profile anchor (avatar_profile.png) alongside front.",
    )
    parser.add_argument(
        "--regen-front",
        action="store_true",
        help="Force-regenerate `front` even if it already exists. The new still "
             "replaces it; the old one is kept under previous_takes/.",
    )
    parser.add_argument(
        "--regen-profile",
        action="store_true",
        help="Force-regenerate `profile` even if it already exists (implies the "
             "profile is minted; leaves `front` untouched). The old still is "
             "kept under previous_takes/.",
    )
    parser.add_argument(
        "--add-shot",
        metavar="NAME",
        help="Mint an additional identity-locked variant (e.g. 'tight_close_up_smile'). "
             "Requires --prompt. Uses TEXT-TO-IMAGE — restate identity in the prompt.",
    )
    parser.add_argument(
        "--prompt",
        help="Seedream prompt for --add-shot. Restate face/hair/wardrobe/room "
             "(text-to-image carries no image conditioning).",
    )
    parser.add_argument(
        "--aspect-ratio",
        default=DEFAULT_ASPECT_RATIO,
        help=f"Aspect ratio for new shots. Default {DEFAULT_ASPECT_RATIO} matches the anchors.",
    )
    return parser


def billing_manifest(args: argparse.Namespace, cwd: Path) -> dict:
    job = billing_job_path(args.job, cwd)
    sheet = ((Path(args.character_sheet) if Path(args.character_sheet).is_absolute()
              else cwd / args.character_sheet) if args.character_sheet
             else job / "avatar" / "character_sheet.json")
    count = 1 if args.add_shot else (2 if args.with_profile or (
        args.regen_front and args.regen_profile) else 1)
    return {"role": args.role, "count": count,
            "inputs": [{"path": str(sheet), "kind": "cast_sheet",
                        **({"dest": "character_sheet", "map_only": True}
                           if args.character_sheet else {})}]}


def main():
    args = build_parser().parse_args()

    job = resolve_job_dir(args.job)
    usage_role = args.role
    avatar_dir = job / "avatar"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    sheet_path = Path(args.character_sheet) if args.character_sheet else avatar_dir / "character_sheet.json"

    sheet = _load_sheet(billing_input_path(sheet_path))
    print(f"Role:      {usage_role}")
    print(f"Character: {sheet.get('character_description', '')[:120]}")
    print(f"Anchor:    {sheet.get('seedance_anchor_description', '')[:120]}")

    sheet.setdefault("avatar_byteplus_urls", {})
    sheet.setdefault("avatar_files", {})
    sheet.setdefault("shots", {})

    # --accent override → lock into the sheet.
    if args.accent:
        sheet["accent"] = args.accent
    accent = sheet.get("accent")
    if not accent:
        print(
            "⚠ No accent locked in character_sheet.json. Pass --accent or set "
            "`accent` in the sheet so voice doesn't drift across Seedance chunks "
            "(MEMORY: lock accent in seedance_anchor_description)."
        )

    log_event(
        job, tool=TOOL_NAME, event="cast_avatar_started",
        extra={
            "usage_role": usage_role,
            "accent": accent,
            "character_sheet": str(sheet_path),
            "mode": "add_shot" if args.add_shot else "generate",
        },
    )

    # ------------------------------------------------------------------
    # --add-shot mode — mint one variant via TEXT-TO-IMAGE
    # ------------------------------------------------------------------
    if args.add_shot:
        if not args.prompt:
            raise SystemExit("--add-shot requires --prompt")

        name = _slug(args.add_shot)
        out_path = avatar_dir / f"avatar_{name}.png"
        # No image_input — Seedance only trusts text-to-image BytePlus URLs.
        minted = generate_image(
            args.prompt, out_path, job, slot=name,
            aspect_ratio=args.aspect_ratio, image_input=None, usage_role=usage_role,
        )
        if not minted:
            raise SystemExit(f"Failed to mint shot '{name}'")
        url, _ = minted
        sheet["avatar_byteplus_urls"][name] = url
        _record_file(sheet, name, out_path)
        sheet["shots"][name] = {
            "prompt": args.prompt,
            "aspect_ratio": args.aspect_ratio,
            "mode": "text_to_image",
            "usage_role": usage_role,
        }
        generated_at = _stamp_ttl(sheet)
        _save_sheet(sheet, sheet_path)
        log_event(
            job, tool=TOOL_NAME, event="shot_added",
            extra={"name": name, "url": url[:120], "usage_role": usage_role,
                   "generated_at_utc": generated_at},
        )
        print(f"\n✓ Shot '{name}' minted. Reference it from script.json as image_ref: \"{name}\".")
        return

    # ------------------------------------------------------------------
    # generate mode — front (+ optional profile)
    # ------------------------------------------------------------------
    prompts = sheet.get("prompts") or {}

    # --regen-profile alone: mint/refresh profile only, leave front untouched.
    profile_only = args.regen_profile and not args.regen_front and not args.with_profile

    issued: list[datetime | None] = []

    if not profile_only:
        if "front" not in prompts:
            raise ValueError("character_sheet.json missing prompts.front")
        issued.append(_mint_anchor(
            sheet, sheet_path, avatar_dir, job,
            key="front", prompt=prompts["front"],
            aspect_ratio=args.aspect_ratio,
            regen=args.regen_front,
            usage_role=usage_role,
        ))

    if args.with_profile or args.regen_profile:
        profile_prompt = _profile_prompt(sheet)
        if not profile_prompt:
            raise ValueError(
                "Cannot mint profile: character_sheet.json has neither "
                "prompts.profile nor prompts.front to derive it from."
            )
        issued.append(_mint_anchor(
            sheet, sheet_path, avatar_dir, job,
            key="profile", prompt=profile_prompt,
            aspect_ratio=args.aspect_ratio,
            regen=args.regen_profile,
            usage_role=usage_role,
        ))

    minted = [at for at in issued if at is not None]
    if not minted:
        # Nothing newly minted (everything already present + fresh). Still persist
        # any accent override that came in via --accent.
        _save_sheet(sheet, sheet_path)
        return

    generated_at = _stamp_ttl(sheet, min(minted))
    _save_sheet(sheet, sheet_path)
    log_event(
        job, tool=TOOL_NAME, event="character_sheet_saved",
        extra={
            "usage_role": usage_role,
            "accent": accent,
            "front_url": sheet["avatar_byteplus_urls"].get("front"),
            "profile_url": sheet["avatar_byteplus_urls"].get("profile"),
            "ttl_hours": BYTEPLUS_URL_TTL_HOURS,
            "generated_at_utc": generated_at,
        },
    )
    print(f"\nCharacter sheet updated: {sheet_path}")
    print(f"BytePlus URLs valid until ~{BYTEPLUS_URL_TTL_HOURS}h after {generated_at}")
    print("\nNext:")
    print("  • Read the PNG(s) inline and verify face/accent before perform_avatar.")
    print("  • Mint additional shots as your script needs them:")
    print("      cast_avatar.py --job <id> --role <role> --add-shot <name> --prompt \"<seedream prompt>\"")
    print("  • Then write script.json (referencing image_ref per chunk) and run perform_avatar.")


if __name__ == "__main__":
    main()
