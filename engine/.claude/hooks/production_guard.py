#!/usr/bin/env python3
"""PreToolUse guard: classify production commands; route the owned job itself."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


_FALLBACK_PROTECTED_RE = re.compile(
    r"(?:^|/)tools/(?:assemble|build_carousel|build_character_sheet|cast_avatar|"
    r"clean_audio|compose_render|densify|frame_insert|fx_parallax|lipsync_footage|"
    r"mint_image|mint_video|perform_avatar|remotion_render|replicate_safe|sam3|"
    r"score_bed|scrub_reference_vo|synth_voice)\.py(?:\s|[;&|()]|$)"
)
_FALLBACK_DIRECT_RE = re.compile(
    r"(?:\bffmpeg\b[^\n]*\bjobs/[A-Za-z0-9][A-Za-z0-9._-]*/"
    r"|\b(?:npx|bunx|npm|pnpm)\b[^\n]*\bremotion\s+(?:render|still)\b"
    r"[^\n]*\bjobs/[A-Za-z0-9][A-Za-z0-9._-]*/"
    r"|(?:api\.replicate\.com|fal\.(?:ai|run)|api\.openai\.com|"
    r"generativelanguage\.googleapis\.com|api\.elevenlabs\.io|"
    r"\breplicate\s+run\b))",
    re.IGNORECASE,
)


def _strict_error_json(code: str, message: str) -> str:
    """Keep the one-object contract even when the validator cannot import."""
    return json.dumps(
        {
            "schema": "videoclaw.production-verdict/v1",
            "classification": "ambiguous",
            "routeCurrent": False,
            "jobIds": [],
            "actionFamily": "none",
            "spendRisk": "unknown",
            "actions": [],
            "jobs": [],
            "error": {"code": code, "message": message},
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def strict_verdict_main() -> int:
    """Desktop subprocess interface: one JSON object on stdout, always."""
    try:
        data = json.loads(sys.stdin.read() or "{}")
        if not isinstance(data, dict):
            raise ValueError("verdict input must be one JSON object")
        tool_name = data.get("tool_name")
        if tool_name not in {"Bash", "mcp__device__bash"}:
            raise ValueError("tool_name must be Bash or mcp__device__bash")
        command = data.get("tool_input", {}).get("command")
        if not isinstance(command, str):
            raise ValueError("tool_input.command must be a string")
        raw_cwd = data.get("cwd")
        if not isinstance(raw_cwd, str) or not raw_cwd.strip():
            raise ValueError("cwd must be a trusted absolute workspace path")
        if not Path(raw_cwd).expanduser().is_absolute():
            raise ValueError("cwd must be a trusted absolute workspace path")

        required = {
            name: os.environ.get(name, "").strip()
            for name in (
                "VIDEOCLAW_ENGINE",
                "VIDEOCLAW_WORKSPACE",
                "VIDEOCLAW_JOBS_DIR",
            )
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError(
                "strict verdict context is missing " + ", ".join(missing)
            )
        relative = [
            name
            for name, value in required.items()
            if not Path(value).expanduser().is_absolute()
        ]
        if relative:
            raise ValueError(
                "strict verdict context paths must be absolute: "
                + ", ".join(relative)
            )

        engine = Path(required["VIDEOCLAW_ENGINE"]).resolve()
        workspace = Path(required["VIDEOCLAW_WORKSPACE"]).resolve()
        output = Path(required["VIDEOCLAW_JOBS_DIR"]).resolve()
        cwd = Path(raw_cwd).resolve()
        sys.path.insert(0, str(engine / "tools"))
        from prepare_production import (  # noqa: PLC0415
            bash_production_verdict,
            production_verdict_json,
        )

        verdict = bash_production_verdict(
            command,
            engine_root=engine,
            workspace_root=workspace,
            output_root=output,
            cwd=cwd,
        )
        print(production_verdict_json(verdict))
        return 0 if verdict["routeCurrent"] else 2
    except Exception as exc:
        print(_strict_error_json("verdict_error", str(exc)))
        return 2


def main() -> int:
    command = ""
    try:
        data = json.loads(sys.stdin.read() or "{}")
        tool_name = str(data.get("tool_name", ""))
        if tool_name not in {"Bash", "mcp__device__bash"}:
            return 0
        command = str(data.get("tool_input", {}).get("command", ""))
        engine = Path(
            os.environ.get("VIDEOCLAW_ENGINE")
            or Path(__file__).resolve().parents[2]
        ).resolve()
        workspace = Path(
            os.environ.get("VIDEOCLAW_WORKSPACE")
            or data.get("cwd")
            or engine
        ).resolve()
        output = Path(
            os.environ.get("VIDEOCLAW_JOBS_DIR")
            or workspace / "jobs"
        ).resolve()
        sys.path.insert(0, str(engine / "tools"))
        from prepare_production import evaluate_bash_command  # noqa: PLC0415

        allowed, reason = evaluate_bash_command(
            command,
            engine_root=engine,
            output_root=output,
            cwd=Path(data.get("cwd") or workspace),
        )
        if allowed:
            return 0
        try:
            actionable = json.loads(reason)
        except (TypeError, ValueError, json.JSONDecodeError):
            actionable = None
        if (
            isinstance(actionable, dict)
            and actionable.get("status") == "authorization_required"
        ):
            # This is the paid operation boundary, not a bootstrap-route failure.
            # Preserve the host-neutral object so any terminal or adapter can
            # render alternatives without scraping Electron-specific prose.
            print(
                json.dumps(
                    actionable,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                file=sys.stderr,
            )
            return 2
        # A missing or stale route is recorded automatically for the job this
        # session owns, so this refusal is about the command itself (or a job
        # the session does not own). Say only what the guard found; the old
        # blanket "run prepare_production, then retry" sent agents into
        # retries that could never succeed.
        print(
            "VIDEOCLAW PRODUCTION GUARD — blocked before execution.\n"
            f"{reason}",
            file=sys.stderr,
        )
        return 2
    except Exception as exc:
        # Do not brick unrelated shell work if the hook itself is damaged, but
        # fail closed for obvious canonical production paths.
        if _FALLBACK_PROTECTED_RE.search(command) or _FALLBACK_DIRECT_RE.search(
            command
        ):
            print(
                "VIDEOCLAW PRODUCTION GUARD — blocked because the guard "
                f"could not validate this production action: {exc}",
                file=sys.stderr,
            )
            return 2
        return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--verdict-json"]:
        sys.exit(strict_verdict_main())
    sys.exit(main())
