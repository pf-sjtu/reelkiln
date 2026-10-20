#!/usr/bin/env python3
"""Resolve scoped Taste into a locked production constraint and QA receipt.

This module is intentionally stdlib-only.  Planning reads the exact library,
user, and project Taste bytes, resolves commitments most-specific-last, and
embeds inspectable evidence in ``promise.json``.  QA consumes observations
produced by the real media-analysis/render path; it does not inspect pixels or
pretend an editorial preference is objectively measurable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable


PLAN_SCHEMA = "videoclaw.taste-plan/v2"
REQUIREMENTS_SCHEMA = "videoclaw.taste-requirements/v2"
OBSERVATIONS_SCHEMA = "videoclaw.taste-observations/v4"
QA_SCHEMA = "videoclaw.taste-qa/v4"
RENDER_MANIFEST_SCHEMA = "videoclaw.render-manifest/v4"
EXTRACTOR_VERSION = "videoclaw.taste-extractor/v4"
SCENE_THRESHOLD = 8.0
FACE_SAMPLE_INTERVAL_SEC = 1.0
MAX_FACE_SAMPLES = 300
FACE_DETECTOR_MAX_DIMENSION = 960
FINAL_RENDER_NAME = "final.mp4"

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_TENANT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_TAG_RE = re.compile(r"^\s*\[([a-z0-9][a-z0-9._-]{0,63})\]\s*", re.I)

MECHANICAL_NA_CODES = {
    "cadence": "single-static-presentation",
    "safe-framing": "no-visible-person-or-face",
    "contain-landscape": "no-full-frame-landscape-placement",
}


class TasteContractError(ValueError):
    """A user-correctable Taste planning or QA contract error."""


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp_path = Path(temporary)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        temp_path.unlink(missing_ok=True)
        raise


def _section_bullets(text: str, section: str) -> list[str]:
    """Return Markdown bullets from one level-2 section, joining continuations."""
    heading = re.compile(rf"^##\s+{re.escape(section)}(?:\s|$)", re.I)
    in_section = False
    items: list[str] = []
    current: list[str] = []
    for raw in text.splitlines():
        if raw.startswith("## "):
            if in_section:
                break
            in_section = bool(heading.match(raw))
            continue
        if not in_section:
            continue
        # Draft packs often put unconfirmed proposals below this label inside
        # COMMITMENTS.  They are not promises and must never become constraints.
        if section.upper() == "COMMITMENTS" and re.match(
            r"^\s*\*\*Proposed\b", raw, re.I
        ):
            break
        match = re.match(r"^\s*-\s+(.*)$", raw)
        if match:
            if current:
                items.append(" ".join(current).strip())
            current = [match.group(1).strip()]
        elif current and raw.strip():
            current.append(raw.strip())
    if current:
        items.append(" ".join(current).strip())
    return [item for item in items if item and "_(none" not in item.lower()]


def _plain_commitment(text: str) -> str:
    plain = re.sub(r"[*_`]", "", text)
    plain = re.sub(r"\s*\([^)]*(?:20\d\d|standing|source|from)[^)]*\)\s*$", "", plain, flags=re.I)
    return re.sub(r"\s+", " ", plain).strip(" .")


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:64]


def _semantic_key(text: str) -> tuple[str, str]:
    plain = _plain_commitment(text)
    lowered = plain.lower().replace("–", "-").replace("—", "-")
    if re.search(r"(?:scene|shot|cut).{0,35}(?:2\s*-\s*3|two\s+to\s+three).{0,12}(?:s|sec|second)", lowered):
        return "cadence", "mechanical"
    if (
        re.search(r"(?:face|subject).{0,45}(?:cent(?:er|re)|in frame|not crop|uncropped|safe framing)", lowered)
        or re.search(r"(?:keep).{0,30}(?:face|subject).{0,30}(?:frame|cent)", lowered)
    ):
        return "safe-framing", "mechanical"
    if (
        "blurred fill" in lowered
        or "blur fill" in lowered
        or re.search(r"(?:contain|full (?:horizontal|landscape|frame)).{0,45}(?:blur|crop)", lowered)
    ):
        return "contain-landscape", "mechanical"
    tag = _TAG_RE.match(plain)
    if tag:
        return tag.group(1).lower(), "subjective"
    # Untagged real Taste entries commonly use a stable field label (for
    # example ``**Captions:** ...``).  Resolve those field-by-field without
    # guessing that every sentence containing the same broad noun conflicts.
    labelled = re.match(r"^([A-Za-z][A-Za-z0-9 &/+_-]{0,47}):\s+", plain)
    if labelled:
        return f"field-{_slug(labelled.group(1))}", "subjective"
    # The older user file also contains concise, untagged field statements such
    # as "Captions must use sentence case".  Keep this deliberately narrow:
    # only a grammatical subject before an explicit must/shall/use contract is
    # a field.  Free-form prose retains an exact fingerprint below.
    subject = re.match(
        r"^(captions?|caption case|engine routing|music(?:\s*&\s*sfx)? sourcing|"
        r"font(?:s| family)?|typography|voice|framing|grade|palette)\s+"
        r"(?:must|shall|should|uses?|is|are)\b",
        plain,
        re.I,
    )
    if subject:
        return f"field-{_slug(subject.group(1))}", "subjective"
    # An anti-commitment often negates a previously proposed concrete choice
    # rather than replacing an entire field.  Map only the symmetric, explicit
    # "always use X" / "never (propose|use) X" forms to the same choice ID.
    # This lets "never propose serif captions" suppress that proposal without
    # suppressing every caption commitment.
    choice = re.match(r"^(?:always\s+use|never\s+(?:propose|use))\s+(.+)$", plain, re.I)
    if choice:
        return f"choice-{hashlib.sha256(choice.group(1).lower().encode('utf-8')).hexdigest()[:16]}", "subjective"
    return f"commitment-{hashlib.sha256(plain.encode('utf-8')).hexdigest()[:16]}", "subjective"


def _source_paths(
    engine_root: Path, workspace_root: Path, tenant: str
) -> list[tuple[str, Path, str]]:
    return [
        (
            "library",
            engine_root / "taste" / "packs" / "_default" / "README.md",
            "taste/packs/_default/README.md",
        ),
        ("user", workspace_root / "taste" / "GLOBAL.md", "taste/GLOBAL.md"),
        (
            "project",
            workspace_root / "taste" / "packs" / tenant / "README.md",
            f"taste/packs/{tenant}/README.md",
        ),
    ]


def _source(scope: str, path: Path, logical_path: str) -> dict[str, Any]:
    exists = path.is_file()
    return {
        "scope": scope,
        "path": logical_path,
        "exists": exists,
        "sha256": file_sha256(path) if exists else None,
    }


def _structured_na_reason(commitment_id: str, value: Any) -> dict[str, str]:
    expected_code = MECHANICAL_NA_CODES.get(commitment_id)
    if expected_code is None:
        raise TasteContractError(
            f"mechanical commitment {commitment_id!r} has no supported N/A proof"
        )
    if not isinstance(value, dict) or not set(value) <= {"code", "detail"}:
        raise TasteContractError(
            f"N/A reason for {commitment_id} must be an object with reason code "
            f"{expected_code!r} and optional detail"
        )
    if value.get("code") != expected_code:
        raise TasteContractError(
            f"N/A reason for {commitment_id} must use reason code {expected_code!r}"
        )
    result = {"code": expected_code}
    if "detail" in value:
        detail = value["detail"]
        if not isinstance(detail, str) or not detail.strip() or len(detail.strip()) > 1000:
            raise TasteContractError(
                f"N/A detail for {commitment_id} must be a non-empty string of at most 1000 characters"
            )
        result["detail"] = detail.strip()
    return result


def _normalize_na_reason(commitment_id: str, kind: str, value: Any) -> Any:
    if kind == "mechanical":
        return _structured_na_reason(commitment_id, value)
    # Subjective commitments retain their editorial disposition. They do not
    # waive a mechanical check, so a concise human explanation remains enough.
    if not isinstance(value, str) or not value.strip():
        raise TasteContractError(
            f"N/A reason for subjective commitment {commitment_id} must be non-empty text"
        )
    return value.strip()


def _validate_disposition(item: dict[str, Any]) -> None:
    commitment_id = item.get("id")
    kind = item.get("kind")
    status = item.get("status")
    qa_check = item.get("qaCheck")
    if kind not in {"mechanical", "subjective"}:
        raise TasteContractError(f"taste commitment {commitment_id!r} has invalid kind")
    if status not in {"applied", "not_applicable", "subjective_review"}:
        raise TasteContractError(f"taste commitment {commitment_id!r} has invalid status")
    if status == "applied":
        if kind != "mechanical" or qa_check != commitment_id:
            raise TasteContractError(
                f"taste commitment {commitment_id!r} cannot claim an uncheckable applied disposition"
            )
    elif status == "subjective_review":
        if kind != "subjective" or qa_check is not None:
            raise TasteContractError(
                f"taste commitment {commitment_id!r} has an invalid subjective disposition"
            )
    else:
        _normalize_na_reason(str(commitment_id), str(kind), item.get("reason"))
        if qa_check is not None:
            raise TasteContractError(
                f"N/A taste commitment {commitment_id!r} cannot carry a QA check"
            )


def resolve_taste(
    engine_root: Path,
    workspace_root: Path,
    tenant: str,
    *,
    applicable: Iterable[str] = (),
    not_applicable: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not _TENANT_RE.fullmatch(tenant):
        raise TasteContractError(f"invalid tenant: {tenant!r}")
    applicable_set = {str(value) for value in applicable}
    not_applicable = dict(not_applicable or {})
    if applicable_set & not_applicable.keys():
        both = ", ".join(sorted(applicable_set & not_applicable.keys()))
        raise TasteContractError(f"commitments cannot be both applicable and N/A: {both}")

    paths = _source_paths(engine_root, workspace_root, tenant)
    sources = [_source(scope, path, logical) for scope, path, logical in paths]
    effective: dict[str, dict[str, Any]] = {}
    resolution: list[dict[str, Any]] = []
    for (scope, path, _logical), identity in zip(paths, sources):
        if not identity["exists"]:
            continue
        text = path.read_text(encoding="utf-8")
        for raw in _section_bullets(text, "COMMITMENTS"):
            key, kind = _semantic_key(raw)
            previous = effective.get(key)
            effective[key] = {
                "id": key,
                "text": raw,
                "scope": scope,
                "sourceSha256": identity["sha256"],
                "kind": kind,
            }
            resolution.append(
                {
                    "id": key,
                    "action": "selected",
                    "scope": scope,
                    "kind": kind,
                    "replacedScope": previous.get("scope") if previous else None,
                }
            )
        # A same-scope explicit decline wins over a commitment, and a later
        # (more-specific) scope can still intentionally reintroduce the ID.
        for raw in _section_bullets(text, "ANTI-COMMITMENTS"):
            key, kind = _semantic_key(raw)
            previous = effective.pop(key, None)
            resolution.append(
                {
                    "id": key,
                    "action": "suppressed",
                    "scope": scope,
                    "text": raw,
                    "kind": kind,
                    "replacedScope": previous.get("scope") if previous else None,
                }
            )

    unknown = (applicable_set | not_applicable.keys()) - effective.keys()
    if unknown:
        raise TasteContractError(
            "requirements reference unknown effective commitment(s): "
            + ", ".join(sorted(unknown))
        )

    commitments: list[dict[str, Any]] = []
    for key in sorted(effective):
        item = dict(effective[key])
        if key in applicable_set and item["kind"] == "mechanical":
            item.update(
                status="applied",
                reason="declared applicable to this production",
                qaCheck=key,
            )
        elif key in not_applicable:
            reason = _normalize_na_reason(key, item["kind"], not_applicable[key])
            item.update(status="not_applicable", reason=reason, qaCheck=None)
        elif item["kind"] == "mechanical":
            raise TasteContractError(
                f"mechanical commitment {key!r} must be declared applicable "
                "or given a concrete notApplicable reason"
            )
        else:
            item.update(
                status="subjective_review",
                reason="carried into planning; requires honest human/editorial review",
                qaCheck=None,
            )
        commitments.append(item)

    evidence = {
        "schema": PLAN_SCHEMA,
        "tenant": tenant,
        "precedence": ["library", "user", "project"],
        "sources": sources,
        "commitments": commitments,
        "resolution": resolution,
    }
    evidence["evidenceSha256"] = canonical_sha256(evidence)
    return evidence


def load_requirements(path: Path | None) -> tuple[list[str], dict[str, Any]]:
    if path is None:
        return [], {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TasteContractError(f"requirements are unreadable or invalid: {exc}") from exc
    if not isinstance(value, dict) or value.get("schema") != REQUIREMENTS_SCHEMA:
        raise TasteContractError(f"requirements must use schema {REQUIREMENTS_SCHEMA}")
    applicable = value.get("applicable", [])
    not_applicable = value.get("notApplicable", {})
    if not isinstance(applicable, list) or not all(isinstance(x, str) for x in applicable):
        raise TasteContractError("requirements.applicable must be an array of IDs")
    if not isinstance(not_applicable, dict) or not all(
        isinstance(key, str) for key in not_applicable
    ):
        raise TasteContractError(
            "requirements.notApplicable must map IDs to structured mechanical reasons or subjective text"
        )
    return applicable, not_applicable


def validate_plan_evidence(
    evidence: Any, engine_root: Path, workspace_root: Path
) -> tuple[bool, str]:
    try:
        if not isinstance(evidence, dict) or evidence.get("schema") != PLAN_SCHEMA:
            raise TasteContractError(f"taste evidence must use schema {PLAN_SCHEMA}")
        allowed_evidence_keys = {
            "schema",
            "tenant",
            "precedence",
            "sources",
            "commitments",
            "resolution",
            "evidenceSha256",
        }
        if set(evidence) != allowed_evidence_keys:
            raise TasteContractError("taste evidence contains unknown or missing fields")
        tenant = evidence.get("tenant")
        if not isinstance(tenant, str) or not _TENANT_RE.fullmatch(tenant):
            raise TasteContractError("taste evidence tenant is invalid")
        if evidence.get("precedence") != ["library", "user", "project"]:
            raise TasteContractError("taste precedence must be library, user, project")
        expected_paths = {
            "library": engine_root / "taste" / "packs" / "_default" / "README.md",
            "user": workspace_root / "taste" / "GLOBAL.md",
            "project": workspace_root / "taste" / "packs" / tenant / "README.md",
        }
        sources = evidence.get("sources")
        if not isinstance(sources, list) or [s.get("scope") for s in sources if isinstance(s, dict)] != [
            "library",
            "user",
            "project",
        ]:
            raise TasteContractError("taste evidence must identify library, user, and project sources")
        for source in sources:
            if set(source) != {"scope", "path", "exists", "sha256"}:
                raise TasteContractError("Taste source identity contains unknown fields")
            current = expected_paths[source["scope"]]
            exists = current.is_file()
            if source.get("exists") is not exists:
                raise TasteContractError(f"Taste source existence changed: {source['scope']}")
            expected_hash = file_sha256(current) if exists else None
            if source.get("sha256") != expected_hash:
                raise TasteContractError(f"Taste source changed: {source['scope']}")
        supplied_hash = evidence.get("evidenceSha256")
        unsigned = dict(evidence)
        unsigned.pop("evidenceSha256", None)
        if not isinstance(supplied_hash, str) or supplied_hash != canonical_sha256(unsigned):
            raise TasteContractError("taste evidence hash is missing or stale")
        commitments = evidence.get("commitments")
        if not isinstance(commitments, list):
            raise TasteContractError("taste commitments must be an array")
        ids = [item.get("id") for item in commitments if isinstance(item, dict)]
        if len(ids) != len(commitments) or len(ids) != len(set(ids)):
            raise TasteContractError("taste commitments are malformed or duplicated")
        for item in commitments:
            if set(item) != {
                "id",
                "text",
                "scope",
                "sourceSha256",
                "kind",
                "status",
                "reason",
                "qaCheck",
            }:
                raise TasteContractError(
                    f"taste commitment {item.get('id')!r} contains unknown fields"
                )
            if not str(item.get("reason", "")).strip():
                raise TasteContractError(f"taste commitment {item.get('id')!r} has no honest disposition")
            _validate_disposition(item)
            if item.get("scope") not in expected_paths:
                raise TasteContractError(f"taste commitment {item.get('id')!r} has invalid scope")
            if item.get("sourceSha256") is not None and not _SHA256_RE.fullmatch(
                str(item.get("sourceSha256"))
            ):
                raise TasteContractError(f"taste commitment {item.get('id')!r} has invalid source hash")
        resolution = evidence.get("resolution")
        if not isinstance(resolution, list):
            raise TasteContractError("taste resolution must be an array")
        allowed_resolution = {"id", "action", "scope", "text", "kind", "replacedScope"}
        if any(not isinstance(row, dict) or not set(row) <= allowed_resolution for row in resolution):
            raise TasteContractError("taste resolution contains malformed or unknown fields")
        applicable = [
            item["id"] for item in commitments if item.get("status") == "applied"
        ]
        not_applicable = {
            item["id"]: item["reason"]
            for item in commitments
            if item.get("status") == "not_applicable"
        }
        expected = resolve_taste(
            engine_root,
            workspace_root,
            tenant,
            applicable=applicable,
            not_applicable=not_applicable,
        )
        if evidence != expected:
            raise TasteContractError(
                "taste evidence does not match the commitments resolved from current sources"
            )
        return True, f"current {PLAN_SCHEMA} evidence"
    except (OSError, TypeError, TasteContractError) as exc:
        return False, str(exc)


def write_plan(
    promise_path: Path,
    engine_root: Path,
    workspace_root: Path,
    tenant: str,
    requirements_path: Path | None,
) -> dict[str, Any]:
    try:
        promise = json.loads(promise_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TasteContractError(f"promise.json is unreadable or invalid: {exc}") from exc
    if not isinstance(promise, dict):
        raise TasteContractError("promise.json root must be an object")
    applicable, not_applicable = load_requirements(requirements_path)
    evidence = resolve_taste(
        engine_root,
        workspace_root,
        tenant,
        applicable=applicable,
        not_applicable=not_applicable,
    )
    promise["taste"] = evidence
    _atomic_json(promise_path, promise)
    return evidence


def contract_roots() -> tuple[Path, Path]:
    """The (engine, workspace) roots every Taste contract operation resolves in.

    Taste evidence hashes the exact scoped source files, so planning and QA MUST
    agree on where those files live or a freshly written lock reads as stale.
    This is the one definition: `CLAUDE_PROJECT_DIR` (what the app injects),
    then `VIDEOCLAW_WORKSPACE` (what bootstrap sets), then the current
    directory — the historical `qa_gate` behavior plus the workspace fallback
    that `tools/_paths.py` already uses for every other user-data path.
    """
    engine = Path(
        os.environ.get("VIDEOCLAW_ENGINE") or Path(__file__).resolve().parents[1]
    ).resolve()
    workspace = Path(
        os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("VIDEOCLAW_WORKSPACE")
        or os.getcwd()
    ).resolve()
    return engine, workspace


# A valid tenant id (`_TENANT_RE` forbids a leading underscore) reserved for a
# production that names no tenant of its own. No pack exists at
# `taste/packs/default/README.md` unless a workspace deliberately creates one,
# so the default scope resolves to library + user Taste and nothing invented.
DEFAULT_TENANT = "default"


def job_tenant(promise: dict[str, Any]) -> str:
    """The Taste scope this production resolves against.

    A production may name its tenant in ``promise.json``; otherwise it resolves
    against the workspace's default pack. Both are deterministic, so a locked
    plan never depends on an agent remembering to pass a scope.

    Absence and invalidity are NOT the same thing. A production that names no
    tenant is asking for the default scope. A production that DECLARES one the
    contract cannot read is asking for a scope that does not exist, and
    silently substituting ``default`` would resolve it against the wrong Taste,
    lock that plan and render it — the declaration is exactly what the operator
    would then believe had been honoured. So only genuine absence falls back;
    anything supplied must satisfy the same ``_TENANT_RE`` every other tenant
    in this contract does, or production preparation fails closed here, before
    any Taste is resolved, locked or rendered.
    """
    if not isinstance(promise, dict) or "tenant" not in promise:
        return DEFAULT_TENANT
    value = promise["tenant"]
    if isinstance(value, str) and _TENANT_RE.fullmatch(value):
        return value
    raise TasteContractError(
        f"promise.json declares an unusable tenant: {value!r}. A tenant id must "
        "start with a letter or digit and contain only letters, digits, '.', "
        "'_' or '-' (max 128). Fix the declaration, or remove the field "
        f"entirely to resolve against the reserved {DEFAULT_TENANT!r} scope."
    )


def _library_drift_declarations(
    evidence: Any, engine_root: Path, workspace_root: Path, tenant: str
) -> tuple[list[str], dict[str, Any], str] | None:
    """The recorded choices of an intact lock whose ONLY drift is the engine-shipped library."""
    if not isinstance(evidence, dict) or evidence.get("schema") != PLAN_SCHEMA:
        return None
    if evidence.get("tenant") != tenant:
        return None
    unsigned = {key: value for key, value in evidence.items() if key != "evidenceSha256"}
    if evidence.get("evidenceSha256") != canonical_sha256(unsigned):
        return None
    current = [_source(*entry) for entry in _source_paths(engine_root, workspace_root, tenant)]
    sources = evidence.get("sources")
    if not isinstance(sources, list) or len(sources) != len(current):
        return None
    if sources[0] == current[0] or sources[1:] != current[1:]:
        return None
    if not isinstance(sources[0], dict) or sources[0].get("scope") != "library":
        return None
    commitments = evidence.get("commitments")
    if not isinstance(commitments, list):
        return None
    applicable: list[str] = []
    not_applicable: dict[str, Any] = {}
    for item in commitments:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            return None
        if item.get("status") == "applied":
            applicable.append(item["id"])
        elif item.get("status") == "not_applicable":
            not_applicable[item["id"]] = item.get("reason")
    return applicable, not_applicable, str(sources[0].get("sha256"))


def ensure_locked_plan(
    job_dir: Path, engine_root: Path, workspace_root: Path
) -> dict[str, Any] | None:
    """Lock scoped Taste into a promise-bearing production, deterministically.

    Locked Taste evidence used to depend on an agent remembering a separate CLI
    call. A real production could therefore reach render and paid QA carrying
    none, and `qa_gate` would then correctly refuse it with "promise.json has no
    locked Taste plan evidence" — after the money was spent. Production
    preparation owns it now:

      · a pre-plan job with no ``promise.json`` stays outside the contract;
      · a current lock is left exactly as it is;
      · an ABSENT lock is resolved from the current scoped sources and written;
      · a PRESENT but stale or tampered lock fails closed. It is never silently
        re-resolved, because that would erase the declarations it carried and
        would hide exactly the drift the contract exists to detect;
      · the one exception is an intact lock whose only drift is the
        engine-shipped library (an engine update, not a user change): it is
        re-resolved with its recorded choices, or fails closed if they no
        longer cover the new library;
      · a plan that genuinely needs a human declaration (an undeclared
        mechanical commitment) fails closed here, before any render.
    """
    promise_path = job_dir / "promise.json"
    if not promise_path.is_file():
        return None
    try:
        promise = json.loads(promise_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TasteContractError(f"promise.json is unreadable or invalid: {exc}") from exc
    if not isinstance(promise, dict):
        raise TasteContractError("promise.json root must be an object")
    tenant = job_tenant(promise)
    requirements = job_dir / "taste-requirements.json"
    howto = (
        "  uv run python tools/taste_contract.py plan "
        f"--job {job_dir.name} --tenant {tenant} --requirements {requirements}"
    )
    if "taste" in promise:
        ok, reason = validate_plan_evidence(promise["taste"], engine_root, workspace_root)
        if ok:
            return promise["taste"]
        recorded = _library_drift_declarations(promise["taste"], engine_root, workspace_root, tenant)
        if recorded is not None:
            try:
                evidence = resolve_taste(
                    engine_root, workspace_root, tenant,
                    applicable=recorded[0], not_applicable=recorded[1],
                )
            except TasteContractError as exc:
                reason = f"{reason}; the updated library cannot carry the recorded choices: {exc}"
            else:
                promise["taste"] = evidence
                _atomic_json(promise_path, promise)
                print(
                    f"Taste library changed; lock refreshed with recorded choices "
                    f"({recorded[2][:12]}… → {(evidence['sources'][0]['sha256'] or 'absent')[:12]}…)",
                    file=sys.stderr,
                )
                return evidence
        raise TasteContractError(
            f"promise.json carries Taste evidence that is no longer current: {reason}\n"
            "It is not re-resolved automatically, because that would discard the\n"
            "declarations it recorded. Re-resolve it deliberately:\n"
            f"{howto}"
        )
    try:
        return write_plan(
            promise_path, engine_root, workspace_root, tenant,
            requirements if requirements.is_file() else None,
        )
    except TasteContractError as exc:
        raise TasteContractError(
            f"scoped Taste could not be locked for this production: {exc}\n\n"
            f"Declare each mechanical commitment in {requirements} "
            f"(schema {REQUIREMENTS_SCHEMA}) as applicable or with its structured\n"
            "notApplicable reason, then run:\n"
            f"{howto}"
        ) from exc


def _display_dimensions(stream: dict[str, Any], path: Path) -> tuple[int, int]:
    try:
        width, height = int(stream["width"]), int(stream["height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise TasteContractError(
            f"ffprobe returned incomplete visual metadata for {path.name}"
        ) from exc
    rotation: Any = None
    side_data = stream.get("side_data_list", [])
    if isinstance(side_data, list):
        rotation = next(
            (
                row.get("rotation")
                for row in side_data
                if isinstance(row, dict) and row.get("rotation") is not None
            ),
            None,
        )
    tags = stream.get("tags")
    if rotation is None and isinstance(tags, dict):
        rotation = tags.get("rotate")
    if rotation is not None:
        try:
            raw_degrees = float(rotation)
        except (TypeError, ValueError) as exc:
            raise TasteContractError(
                f"video rotation metadata is invalid for {path.name}"
            ) from exc
        if not math.isfinite(raw_degrees):
            raise TasteContractError(
                f"video rotation metadata is invalid for {path.name}"
            )
        degrees = raw_degrees % 360.0
        nearest_quarter = round(degrees / 90.0) * 90.0
        if abs(degrees - nearest_quarter) > 0.01:
            raise TasteContractError(
                f"video rotation for {path.name} is not a supported 90-degree increment"
            )
        if int(round(nearest_quarter / 90.0)) % 2:
            width, height = height, width
    if width <= 0 or height <= 0:
        raise TasteContractError(f"visual metadata is invalid for {path.name}")
    return width, height


def _probe_video(path: Path) -> tuple[float, int, int]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:stream_tags=rotate:stream_side_data=rotation:format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise TasteContractError(f"ffprobe failed for {path.name}: {result.stderr[-300:]}")
    try:
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        duration = float(data["format"]["duration"])
        width, height = _display_dimensions(stream, path)
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise TasteContractError(f"ffprobe returned incomplete video metadata for {path.name}") from exc
    if duration <= 0:
        raise TasteContractError(f"video metadata is invalid for {path.name}")
    return duration, width, height


def _probe_dimensions(path: Path) -> tuple[int, int]:
    """Probe visual dimensions for either a video clip or a still image."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:stream_tags=rotate:stream_side_data=rotation",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise TasteContractError(
            f"ffprobe failed for {path.name}: {result.stderr[-300:]}"
        )
    try:
        stream = json.loads(result.stdout)["streams"][0]
        width, height = _display_dimensions(stream, path)
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise TasteContractError(
            f"ffprobe returned incomplete visual metadata for {path.name}"
        ) from exc
    return width, height


def _cover_visible_fraction(
    source_width: float,
    source_height: float,
    output_width: float,
    output_height: float,
) -> float:
    scale = max(output_width / source_width, output_height / source_height)
    visible = (output_width * output_height) / (
        scale * scale * source_width * source_height
    )
    return round(min(1.0, visible), 6)


def _render_identity(path: Path, job_dir: Path) -> dict[str, Any]:
    resolved = path.resolve()
    try:
        logical = resolved.relative_to(job_dir.resolve()).as_posix()
    except ValueError as exc:
        raise TasteContractError("render evidence must stay inside the job directory") from exc
    stat = resolved.stat()
    duration, width, height = _probe_video(resolved)
    return {
        "path": logical,
        "sha256": file_sha256(resolved),
        "sizeBytes": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
        "durationSec": round(duration, 6),
        "width": width,
        "height": height,
    }


def _canonical_final_path(job_dir: Path) -> Path:
    """Return the one render artifact that can authorize final delivery."""
    return job_dir.resolve() / FINAL_RENDER_NAME


def _require_canonical_final(video_path: Path, job_dir: Path) -> Path:
    canonical = _canonical_final_path(job_dir)
    if video_path.resolve() != canonical:
        raise TasteContractError(
            f"Taste QA must inspect the canonical {FINAL_RENDER_NAME}, not {video_path.name}"
        )
    if not canonical.is_file():
        raise TasteContractError(f"canonical {FINAL_RENDER_NAME} is missing")
    return canonical


def write_render_manifest(
    job_dir: Path,
    output_path: Path,
    source_path: Path,
    props: dict[str, Any],
    post_compose_broll: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Persist the exact successful canonical-render treatment for Taste QA.

    This is written only after compose_render has finished all post-processing,
    so the output identity describes the bytes QA will inspect rather than an
    intended render.  It is provenance, not a user-authored verdict.
    """
    output = _render_identity(_require_canonical_final(output_path, job_dir), job_dir)
    source = _render_identity(source_path, job_dir)
    transform = props.get("videoTransform")
    if not isinstance(transform, dict):
        transform = {}
    requested_fit = transform.get("fit", "contain")
    blur_px = transform.get("background_blur_px", 0)
    if isinstance(blur_px, bool) or not isinstance(blur_px, (int, float)):
        blur_px = 0
    zoomed = bool(transform.get("ken_burns") or transform.get("punch_zooms") or transform.get("focus_track"))
    # Captioned's browser-card branch always renders the source with
    # objectFit="cover".  Record the effective behavior, not a conflicting
    # top-level `fit: contain` request, so containment QA cannot attest pixels
    # the renderer may have cropped inside the card.
    framed = isinstance(transform.get("frame"), dict)
    treatment = {
        "fit": "cover" if framed else requested_fit,
        "backgroundBlurPx": 0.0 if framed else float(blur_px),
        "layout": "browser_card" if framed else "canvas",
        "zoomed": zoomed,
    }
    broll_placements = []
    for insert in post_compose_broll or []:
        start = max(0.0, float(insert["start"]))
        end = min(output["durationSec"], float(insert["end"]))
        if end <= start:
            continue
        width, height = _probe_dimensions(Path(insert["clip"]))
        broll_placements.append(
            {
                "startSec": round(start, 6),
                "endSec": round(end, 6),
                "sourceWidth": width,
                "sourceHeight": height,
                # overlay_broll_inserts always scale+crop fills the output.
                "fit": "cover",
                "visibleFraction": _cover_visible_fraction(
                    width, height, output["width"], output["height"]
                ),
            }
        )
    manifest = {
        "schema": RENDER_MANIFEST_SCHEMA,
        "output": output,
        "source": source,
        "treatment": treatment,
        "postComposeBroll": broll_placements,
    }
    manifest["manifestSha256"] = canonical_sha256(manifest)
    _atomic_json(job_dir / "render-manifest.json", manifest)
    return manifest


def _detect_scenes(video_path: Path, duration: float) -> list[dict[str, float]]:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(video_path),
            "-vf",
            f"scdet=threshold={SCENE_THRESHOLD}",
            "-an",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise TasteContractError(f"scene detection failed: {result.stderr[-300:]}")
    cuts: list[float] = []
    for line in result.stderr.splitlines():
        if "lavfi.scd.time" not in line:
            continue
        try:
            timestamp = float(line.split("lavfi.scd.time:", 1)[1].split()[0].rstrip(","))
        except (IndexError, ValueError):
            continue
        if 0.15 <= timestamp <= duration - 0.15:
            if cuts and abs(timestamp - cuts[-1]) < 0.2:
                continue
            cuts.append(round(timestamp, 6))
    boundaries = [0.0, *cuts, round(duration, 6)]
    return [
        {"startSec": start, "endSec": end}
        for start, end in zip(boundaries, boundaries[1:])
        if end - start >= 0.15
    ]


def _face_sample_timestamps(scenes: list[dict[str, float]]) -> list[float]:
    """Return deterministic interval midpoints with at most a one-second gap.

    A single scene midpoint is enough to inspect framing when a face is already
    known to be present, but it cannot prove that an entire scene contains no
    person. Sampling the midpoint of every at-most-one-second partition gives
    the absence claim a bounded observation interval without decoding every
    frame. Very long renders fail closed instead of silently widening the gap.
    """
    timestamps: list[float] = []
    for scene in scenes:
        start = float(scene["startSec"])
        end = float(scene["endSec"])
        partitions = max(1, math.ceil((end - start) / FACE_SAMPLE_INTERVAL_SEC))
        width = (end - start) / partitions
        timestamps.extend(
            round(start + (index + 0.5) * width, 6)
            for index in range(partitions)
        )
    if len(timestamps) > MAX_FACE_SAMPLES:
        raise TasteContractError(
            "safe-framing observation would exceed the deterministic "
            f"{MAX_FACE_SAMPLES}-sample limit"
        )
    return timestamps


def _face_samples(
    video_path: Path, scenes: list[dict[str, float]]
) -> tuple[list[dict[str, Any]], bool]:
    timestamps = _face_sample_timestamps(scenes)
    try:
        import cv2  # type: ignore

        capture = cv2.VideoCapture(str(video_path))
        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        people_detector = cv2.HOGDescriptor()
        people_detector.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        if not capture.isOpened() or cascade.empty():
            raise RuntimeError("OpenCV could not open the render or face cascade")
        samples: list[dict[str, Any]] = []
        every_frame_read = True
        try:
            for timestamp in timestamps:
                capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
                ok, frame = capture.read()
                if not ok or frame is None:
                    every_frame_read = False
                    samples.append(
                        {
                            "timestampSec": timestamp,
                            "detected": False,
                            "personDetected": False,
                        }
                    )
                    continue
                source_height, source_width = frame.shape[:2]
                scale = min(
                    1.0,
                    FACE_DETECTOR_MAX_DIMENSION / max(source_width, source_height),
                )
                if scale < 1.0:
                    frame = cv2.resize(
                        frame,
                        (
                            max(1, round(source_width * scale)),
                            max(1, round(source_height * scale)),
                        ),
                        interpolation=cv2.INTER_AREA,
                    )
                height, width = frame.shape[:2]
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                people, _weights = people_detector.detectMultiScale(
                    frame, winStride=(8, 8), padding=(8, 8), scale=1.05
                )
                person_detected = len(people) > 0
                faces = cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
                )
                if len(faces) == 0:
                    samples.append(
                        {
                            "timestampSec": timestamp,
                            "detected": False,
                            "personDetected": person_detected,
                        }
                    )
                    continue
                x, y, face_width, face_height = max(
                    faces, key=lambda box: int(box[2]) * int(box[3])
                )
                samples.append(
                    {
                        "timestampSec": timestamp,
                        "detected": True,
                        "personDetected": person_detected,
                        "x": round(float(x) / width, 6),
                        "y": round(float(y) / height, 6),
                        "width": round(float(face_width) / width, 6),
                        "height": round(float(face_height) / height, 6),
                    }
                )
        finally:
            capture.release()
        return samples, every_frame_read
    except Exception:
        # Absence of a detector is an explicit warning for every sampled scene,
        # never a fabricated safe-framing pass.
        return (
            [
                {
                    "timestampSec": timestamp,
                    "detected": False,
                    "personDetected": False,
                }
                for timestamp in timestamps
            ],
            False,
        )


def _render_manifest_snapshot(
    job_dir: Path,
) -> tuple[dict[str, Any], bytes | None]:
    """Read one manifest snapshot and return its exact current file identity."""
    path = job_dir / "render-manifest.json"
    missing = {
        "path": path.name,
        "exists": False,
        "sha256": None,
        "sizeBytes": None,
        "mtimeNs": None,
    }
    try:
        with path.open("rb") as stream:
            before = os.fstat(stream.fileno())
            payload = stream.read()
            after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            return missing, None
        return (
            {
                "path": path.name,
                "exists": True,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "sizeBytes": after.st_size,
                "mtimeNs": after.st_mtime_ns,
            },
            payload,
        )
    except OSError:
        return missing, None


def _landscape_placements(
    job_dir: Path, render: dict[str, Any], manifest_payload: bytes | None
) -> list[dict[str, Any]]:
    unverified = {
        "startSec": 0.0,
        "endSec": render["durationSec"],
        "fullFrameRequired": True,
        "mode": "unverified",
        "visibleFraction": 0.0,
    }
    try:
        manifest = json.loads(manifest_payload) if manifest_payload is not None else None
        if (
            not isinstance(manifest, dict)
            or set(manifest) != {
                "schema",
                "output",
                "source",
                "treatment",
                "postComposeBroll",
                "manifestSha256",
            }
            or manifest.get("schema") != RENDER_MANIFEST_SCHEMA
        ):
            return [unverified]
        supplied = manifest.get("manifestSha256")
        unsigned = dict(manifest)
        unsigned.pop("manifestSha256", None)
        if supplied != canonical_sha256(unsigned) or manifest.get("output") != render:
            return [unverified]
        source = manifest.get("source")
        treatment = manifest.get("treatment")
        broll = manifest.get("postComposeBroll")
        if (
            not isinstance(source, dict)
            or not isinstance(treatment, dict)
            or not isinstance(broll, list)
        ):
            return [unverified]
        source_logical = source.get("path")
        if (
            not isinstance(source_logical, str)
            or Path(source_logical).is_absolute()
            or _render_identity(job_dir / source_logical, job_dir) != source
        ):
            return [unverified]
        placements: list[dict[str, Any]] = []
        if source.get("width", 0) > source.get("height", 0):
            framed = treatment.get("layout") == "browser_card"
            contained = (
                treatment.get("fit") == "contain"
                and not treatment.get("zoomed")
                and not framed
            )
            blurred = treatment.get("backgroundBlurPx", 0) > 0
            mode = "contain_blur" if contained and blurred else "crop"
            placements.append(
                {
                    "startSec": 0.0,
                    "endSec": render["durationSec"],
                    "fullFrameRequired": True,
                    "mode": mode,
                    "visibleFraction": 1.0 if contained else 0.0,
                }
            )
        for insert in broll:
            if not isinstance(insert, dict) or set(insert) != {
                "startSec",
                "endSec",
                "sourceWidth",
                "sourceHeight",
                "fit",
                "visibleFraction",
            }:
                return [unverified]
            width = insert.get("sourceWidth")
            height = insert.get("sourceHeight")
            if (
                isinstance(width, bool)
                or isinstance(height, bool)
                or not isinstance(width, (int, float))
                or not isinstance(height, (int, float))
                or width <= 0
                or height <= 0
            ):
                return [unverified]
            if width <= height:
                continue
            start = insert.get("startSec")
            end = insert.get("endSec")
            if (
                isinstance(start, bool)
                or isinstance(end, bool)
                or not isinstance(start, (int, float))
                or not isinstance(end, (int, float))
                or start < 0
                or end <= start
                or end > render["durationSec"] + 0.02
                or insert.get("fit") != "cover"
            ):
                return [unverified]
            visible = _cover_visible_fraction(
                width, height, render["width"], render["height"]
            )
            if insert.get("visibleFraction") != visible:
                return [unverified]
            placements.append(
                {
                    "startSec": round(float(start), 6),
                    "endSec": round(float(end), 6),
                    "fullFrameRequired": True,
                    "mode": "crop",
                    "visibleFraction": visible,
                }
            )
        # A current, internally consistent manifest with no landscape source or
        # insert is positive evidence for the structured N/A claim. Missing or
        # malformed manifests still return the explicit unverified placement.
        return placements
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, TasteContractError):
        return [unverified]


def _observation_checks(evidence: dict[str, Any]) -> set[str]:
    checks: set[str] = set()
    for item in evidence.get("commitments", []):
        if not isinstance(item, dict) or item.get("kind") != "mechanical":
            continue
        if item.get("status") == "applied" and item.get("qaCheck"):
            checks.add(str(item["qaCheck"]))
        elif item.get("status") == "not_applicable":
            # N/A is a claim to prove, not permission to skip observation.
            checks.add(str(item.get("id")))
    return checks


def capture_production_observations(
    promise_path: Path, video_path: Path, output_path: Path
) -> dict[str, Any]:
    """Extract deterministic observations from the exact canonical render."""
    try:
        promise = json.loads(promise_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TasteContractError(f"promise.json is unreadable or invalid: {exc}") from exc
    evidence = promise.get("taste") if isinstance(promise, dict) else None
    if not isinstance(evidence, dict) or evidence.get("schema") != PLAN_SCHEMA:
        raise TasteContractError("promise.json has no locked Taste plan evidence")
    job_dir = promise_path.resolve().parent
    canonical_final = _require_canonical_final(video_path, job_dir)
    render = _render_identity(canonical_final, job_dir)
    active_checks = _observation_checks(evidence)
    scene_detection = bool(active_checks & {"cadence", "safe-framing"})
    scenes = (
        _detect_scenes(canonical_final, render["durationSec"])
        if scene_detection
        else [{"startSec": 0.0, "endSec": render["durationSec"]}]
    )
    face_samples: list[dict[str, Any]] = []
    face_detection_succeeded: bool | None = None
    if "safe-framing" in active_checks:
        face_samples, face_detection_succeeded = _face_samples(canonical_final, scenes)
    manifest_identity: dict[str, Any] | None = None
    landscape_placements: list[dict[str, Any]] = []
    if "contain-landscape" in active_checks:
        manifest_identity, manifest_payload = _render_manifest_snapshot(job_dir)
        landscape_placements = _landscape_placements(
            job_dir, render, manifest_payload
        )
    observations = {
        "schema": OBSERVATIONS_SCHEMA,
        "tasteEvidenceSha256": evidence.get("evidenceSha256"),
        "extractor": {
            "version": EXTRACTOR_VERSION,
            "sceneThreshold": SCENE_THRESHOLD,
            "faceSampleStrategy": "haar-face-and-hog-person-at-max-one-second-intervals",
            "faceSampleIntervalSec": FACE_SAMPLE_INTERVAL_SEC,
            "maxFaceSamples": MAX_FACE_SAMPLES,
            "faceDetectorMaxDimension": FACE_DETECTOR_MAX_DIMENSION,
            "activeChecks": sorted(active_checks),
            "sceneDetectionRan": scene_detection,
            "faceDetectionSucceeded": face_detection_succeeded,
        },
        "render": render,
        "renderManifest": manifest_identity,
        "scenes": scenes,
        "faceSamples": face_samples,
        "landscapePlacements": landscape_placements,
    }
    _atomic_json(output_path, observations)
    return observations


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TasteContractError(f"{label} must be a JSON number")
    result = float(value)
    if not (result >= 0 and result < 1e9):
        raise TasteContractError(f"{label} is out of range")
    return result


def _coordinate(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TasteContractError(f"{label} must be a JSON number")
    result = float(value)
    if not (-2 <= result <= 2):
        raise TasteContractError(f"{label} is out of normalized-coordinate range")
    return result


def _fraction(value: Any, label: str) -> float:
    result = _number(value, label)
    if result > 1:
        raise TasteContractError(f"{label} must be between 0 and 1")
    return result


def _cadence_check(observations: dict[str, Any]) -> dict[str, Any]:
    scenes = observations.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise TasteContractError("cadence QA captured zero scenes")
    failures = []
    previous_end = 0.0
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            raise TasteContractError(f"scenes[{index}] must be an object")
        start = _number(scene.get("startSec"), f"scenes[{index}].startSec")
        end = _number(scene.get("endSec"), f"scenes[{index}].endSec")
        if end <= start:
            raise TasteContractError(f"scenes[{index}] must have endSec > startSec")
        if abs(start - previous_end) > 0.02:
            raise TasteContractError("cadence scenes do not continuously cover the render")
        previous_end = end
        scene_duration = end - start
        if scene_duration < 2.0 or scene_duration > 3.0:
            failures.append(
                {
                    "startSec": start,
                    "endSec": end,
                    "durationSec": round(scene_duration, 3),
                    "detail": f"{start:.3f}-{end:.3f}s is {scene_duration:.3f}s; expected 2.000-3.000s",
                }
            )
    if abs(previous_end - _number((observations.get("render") or {}).get("durationSec"), "render.durationSec")) > 0.02:
        raise TasteContractError("cadence scenes do not cover the render tail")
    return {
        "id": "cadence",
        "status": "fail" if failures else "pass",
        "sampleCount": len(scenes),
        "failures": failures,
    }


def _safe_framing_check(observations: dict[str, Any]) -> dict[str, Any]:
    samples = observations.get("faceSamples")
    if not isinstance(samples, list) or not samples:
        raise TasteContractError("safe-framing QA captured zero face samples")
    failures = []
    warnings = []
    for index, sample in enumerate(samples):
        if not isinstance(sample, dict):
            raise TasteContractError(f"faceSamples[{index}] must be an object")
        timestamp = _number(sample.get("timestampSec"), f"faceSamples[{index}].timestampSec")
        if sample.get("detected") is not True:
            warnings.append({"timestampSec": timestamp, "detail": "face not detected; framing is unverified"})
            continue
        x = _coordinate(sample.get("x"), f"faceSamples[{index}].x")
        y = _coordinate(sample.get("y"), f"faceSamples[{index}].y")
        width = _fraction(sample.get("width"), f"faceSamples[{index}].width")
        height = _fraction(sample.get("height"), f"faceSamples[{index}].height")
        center_x = x + width / 2
        cropped = x < 0.02 or y < 0.02 or x + width > 0.98 or y + height > 0.98
        off_center = center_x < 0.35 or center_x > 0.65
        if cropped or off_center:
            failures.append(
                {
                    "timestampSec": timestamp,
                    "cropped": cropped,
                    "centerX": round(center_x, 4),
                    "detail": "face touches the crop boundary" if cropped else "face center is outside the 35%-65% safe band",
                }
            )
    status = "fail" if failures else ("warn" if warnings else "pass")
    return {
        "id": "safe-framing",
        "status": status,
        "sampleCount": len(samples),
        "failures": failures,
        "warnings": warnings,
    }


def _contain_check(observations: dict[str, Any]) -> dict[str, Any]:
    placements = observations.get("landscapePlacements")
    if not isinstance(placements, list) or not placements:
        raise TasteContractError("contain-landscape QA captured zero placements")
    applicable = []
    failures = []
    for index, placement in enumerate(placements):
        if not isinstance(placement, dict):
            raise TasteContractError(f"landscapePlacements[{index}] must be an object")
        if placement.get("fullFrameRequired") is not True:
            continue
        start = _number(placement.get("startSec"), f"landscapePlacements[{index}].startSec")
        end = _number(placement.get("endSec"), f"landscapePlacements[{index}].endSec")
        if end <= start:
            raise TasteContractError(f"landscapePlacements[{index}] must have endSec > startSec")
        visible = _fraction(placement.get("visibleFraction"), f"landscapePlacements[{index}].visibleFraction")
        mode = placement.get("mode")
        if mode not in {"contain_blur", "crop", "unverified"}:
            raise TasteContractError(f"landscapePlacements[{index}].mode is invalid")
        row = {"startSec": start, "endSec": end, "mode": mode, "visibleFraction": visible}
        applicable.append(row)
        if mode != "contain_blur" or visible < 0.995:
            failures.append(
                {
                    **row,
                    "detail": "full landscape frame requires contain_blur with at least 99.5% visible",
                }
            )
    if not applicable:
        raise TasteContractError("contain-landscape QA captured zero full-frame-required placements")
    return {
        "id": "contain-landscape",
        "status": "fail" if failures else "pass",
        "sampleCount": len(applicable),
        "failures": failures,
    }


_CHECKS = {
    "cadence": _cadence_check,
    "safe-framing": _safe_framing_check,
    "contain-landscape": _contain_check,
}


def _verify_not_applicable(
    commitment: dict[str, Any], observations: dict[str, Any]
) -> dict[str, Any]:
    commitment_id = str(commitment.get("id"))
    reason = _structured_na_reason(commitment_id, commitment.get("reason"))
    code = reason["code"]
    failures: list[dict[str, Any]] = []
    evidence: dict[str, Any]

    if commitment_id == "cadence":
        scenes = observations.get("scenes")
        if not isinstance(scenes, list) or not scenes:
            raise TasteContractError("cadence N/A proof captured zero scenes")
        evidence = {"sceneCount": len(scenes)}
        if len(scenes) != 1:
            failures.append(
                {
                    "detail": (
                        f"{code} contradicted: extractor observed {len(scenes)} scenes"
                    )
                }
            )
    elif commitment_id == "safe-framing":
        samples = observations.get("faceSamples")
        extractor = observations.get("extractor")
        if not isinstance(samples, list) or not samples:
            raise TasteContractError("safe-framing N/A proof captured zero face samples")
        detector_succeeded = (
            isinstance(extractor, dict)
            and extractor.get("faceDetectionSucceeded") is True
        )
        detected = sum(
            1 for sample in samples
            if isinstance(sample, dict) and sample.get("detected") is True
        )
        detected_people = sum(
            1 for sample in samples
            if isinstance(sample, dict) and sample.get("personDetected") is True
        )
        evidence = {
            "sampleCount": len(samples),
            "detectedFaceCount": detected,
            "detectedPersonCount": detected_people,
            "faceDetectionSucceeded": detector_succeeded,
        }
        if not detector_succeeded:
            failures.append(
                {"detail": f"{code} is unverified because face detection did not succeed"}
            )
        elif detected or detected_people:
            failures.append(
                {
                    "detail": (
                        f"{code} contradicted: extractor detected a face in "
                        f"{detected} and a person in {detected_people} sampled scene(s)"
                    )
                }
            )
    elif commitment_id == "contain-landscape":
        placements = observations.get("landscapePlacements")
        if not isinstance(placements, list):
            raise TasteContractError("contain-landscape N/A proof is malformed")
        evidence = {"fullFrameLandscapePlacementCount": len(placements)}
        if placements:
            failures.append(
                {
                    "detail": (
                        f"{code} contradicted or unverified: extractor reported "
                        f"{len(placements)} full-frame landscape placement(s)"
                    )
                }
            )
    else:
        raise TasteContractError(f"no N/A verifier for {commitment_id}")

    return {
        "id": commitment_id,
        "status": "fail" if failures else "not_applicable",
        "reasonCode": code,
        "evidence": evidence,
        "failures": failures,
    }


def _validate_observations(
    evidence: dict[str, Any], observations: Any, job_dir: Path
) -> None:
    if not isinstance(observations, dict) or observations.get("schema") != OBSERVATIONS_SCHEMA:
        raise TasteContractError(f"observations must use schema {OBSERVATIONS_SCHEMA}")
    if set(observations) != {
        "schema",
        "tasteEvidenceSha256",
        "extractor",
        "render",
        "renderManifest",
        "scenes",
        "faceSamples",
        "landscapePlacements",
    }:
        raise TasteContractError("Taste observations contain unknown or missing fields")
    if observations.get("tasteEvidenceSha256") != evidence.get("evidenceSha256"):
        raise TasteContractError("observations were captured for different Taste plan evidence")
    active_checks = _observation_checks(evidence)
    applied_checks = {
        item.get("qaCheck")
        for item in evidence.get("commitments", [])
        if isinstance(item, dict)
        and item.get("status") == "applied"
        and item.get("qaCheck")
    }
    extractor = observations.get("extractor")
    if extractor != {
        "version": EXTRACTOR_VERSION,
        "sceneThreshold": SCENE_THRESHOLD,
        "faceSampleStrategy": "haar-face-and-hog-person-at-max-one-second-intervals",
        "faceSampleIntervalSec": FACE_SAMPLE_INTERVAL_SEC,
        "maxFaceSamples": MAX_FACE_SAMPLES,
        "faceDetectorMaxDimension": FACE_DETECTOR_MAX_DIMENSION,
        "activeChecks": sorted(active_checks),
        "sceneDetectionRan": bool(active_checks & {"cadence", "safe-framing"}),
        "faceDetectionSucceeded": (
            extractor.get("faceDetectionSucceeded")
            if isinstance(extractor, dict)
            else None
        ),
    }:
        raise TasteContractError("Taste observations were not produced by the canonical extractor")
    face_detection_succeeded = extractor.get("faceDetectionSucceeded")
    if "safe-framing" in active_checks:
        if not isinstance(face_detection_succeeded, bool):
            raise TasteContractError("Taste observations have invalid face-detector status")
    elif face_detection_succeeded is not None:
        raise TasteContractError("inactive safe-framing cannot claim face-detector execution")
    render = observations.get("render")
    expected_render_keys = {
        "path", "sha256", "sizeBytes", "mtimeNs", "durationSec", "width", "height"
    }
    if not isinstance(render, dict) or set(render) != expected_render_keys:
        raise TasteContractError("Taste observations have malformed render identity")
    logical = render.get("path")
    if logical != FINAL_RENDER_NAME:
        raise TasteContractError(
            f"Taste observations must be bound to canonical {FINAL_RENDER_NAME}"
        )
    current_path = _canonical_final_path(job_dir)
    if not current_path.is_file() or _render_identity(current_path, job_dir) != render:
        raise TasteContractError("Taste observations belong to a different or changed render")
    render_manifest = observations.get("renderManifest")
    if "contain-landscape" in active_checks:
        if not isinstance(render_manifest, dict) or set(render_manifest) != {
            "path", "exists", "sha256", "sizeBytes", "mtimeNs"
        }:
            raise TasteContractError("Taste observations have malformed render-manifest identity")
        current_manifest, manifest_payload = _render_manifest_snapshot(job_dir)
        if render_manifest != current_manifest:
            raise TasteContractError(
                "Taste observations belong to a missing, stale, or changed render manifest"
            )
        if observations.get("landscapePlacements") != _landscape_placements(
            job_dir, render, manifest_payload
        ):
            raise TasteContractError(
                "Taste observations belong to a stale render manifest or source identity"
            )
    elif render_manifest is not None:
        raise TasteContractError(
            "inactive contain-landscape cannot claim render-manifest evidence"
        )
    for name in ("scenes", "faceSamples", "landscapePlacements"):
        if not isinstance(observations.get(name), list):
            raise TasteContractError(f"Taste observations {name} must be an array")
    scenes = observations["scenes"]
    if not scenes:
        raise TasteContractError("Taste observations captured zero scenes")
    previous_end = 0.0
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict) or set(scene) != {"startSec", "endSec"}:
            raise TasteContractError(f"scenes[{index}] is malformed")
        start = _number(scene["startSec"], f"scenes[{index}].startSec")
        end = _number(scene["endSec"], f"scenes[{index}].endSec")
        if end <= start or abs(start - previous_end) > 0.02:
            raise TasteContractError("Taste scenes do not continuously cover the render")
        previous_end = end
    if abs(previous_end - _number(render["durationSec"], "render.durationSec")) > 0.02:
        raise TasteContractError("Taste scenes do not cover the render tail")

    face_samples = observations["faceSamples"]
    if "safe-framing" in active_checks:
        expected_timestamps = _face_sample_timestamps(scenes)
        if len(face_samples) != len(expected_timestamps):
            raise TasteContractError(
                "safe-framing must preserve the bounded samples for every observed scene"
            )
        for index, (sample, timestamp) in enumerate(
            zip(face_samples, expected_timestamps)
        ):
            if not isinstance(sample, dict) or not isinstance(sample.get("detected"), bool):
                raise TasteContractError(f"faceSamples[{index}] is malformed")
            expected_keys = {"timestampSec", "detected", "personDetected"}
            if not isinstance(sample.get("personDetected"), bool):
                raise TasteContractError(f"faceSamples[{index}] has invalid person-detection evidence")
            if sample["detected"] is True:
                expected_keys |= {"x", "y", "width", "height"}
            if set(sample) != expected_keys:
                raise TasteContractError(f"faceSamples[{index}] contains unknown or missing fields")
            if abs(
                _number(sample["timestampSec"], f"faceSamples[{index}].timestampSec")
                - timestamp
            ) > 0.02:
                raise TasteContractError(
                    "safe-framing sample timestamps do not match bounded scene intervals"
                )
    elif face_samples:
        raise TasteContractError("inactive safe-framing observations must be empty")

    placements = observations["landscapePlacements"]
    if "contain-landscape" in active_checks:
        if "contain-landscape" in applied_checks and not placements:
            raise TasteContractError("active contain-landscape QA has no placement evidence")
        for index, placement in enumerate(placements):
            if not isinstance(placement, dict) or set(placement) != {
                "startSec", "endSec", "fullFrameRequired", "mode", "visibleFraction"
            }:
                raise TasteContractError(f"landscapePlacements[{index}] is malformed")
    elif placements:
        raise TasteContractError("inactive contain-landscape observations must be empty")


def _evaluate_taste(
    evidence: dict[str, Any], observations: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    checks = []
    warnings = []
    for commitment in evidence.get("commitments", []):
        if not isinstance(commitment, dict):
            raise TasteContractError("taste commitment is malformed")
        _validate_disposition(commitment)
        if commitment.get("status") == "applied" and commitment.get("qaCheck"):
            check_id = commitment["qaCheck"]
            checker = _CHECKS.get(check_id)
            if checker is None:
                raise TasteContractError(f"no mechanical QA implementation for {check_id}")
            checks.append(checker(observations))
        elif commitment.get("status") == "not_applicable":
            if commitment.get("kind") == "mechanical":
                checks.append(_verify_not_applicable(commitment, observations))
            else:
                warnings.append(
                    {
                        "id": commitment.get("id"),
                        "detail": "subjective commitment declared not applicable; no mechanical pass claimed",
                    }
                )
        elif commitment.get("status") == "subjective_review":
            warnings.append(
                {
                    "id": commitment.get("id"),
                    "detail": "subjective commitment carried into plan; no mechanical pass claimed",
                }
            )
    if not checks and not warnings:
        warnings.append({"id": "no-applicable-checks", "detail": "no applicable Taste QA constraints"})
    return checks, warnings


def _build_qa_receipt(
    evidence: dict[str, Any], observations: dict[str, Any], observations_path: Path
) -> dict[str, Any]:
    checks, warnings = _evaluate_taste(evidence, observations)
    failed = any(check["status"] == "fail" for check in checks)
    warned = warnings or any(check["status"] == "warn" for check in checks)
    receipt = {
        "schema": QA_SCHEMA,
        "status": "fail" if failed else ("warn" if warned else "pass"),
        "tasteEvidenceSha256": evidence["evidenceSha256"],
        "tasteSources": evidence["sources"],
        "render": observations["render"],
        "renderManifest": observations["renderManifest"],
        "observationsPath": observations_path.name,
        "observationsSha256": file_sha256(observations_path),
        "checks": checks,
        "warnings": warnings,
    }
    receipt["receiptSha256"] = canonical_sha256(receipt)
    return receipt


def run_qa(promise_path: Path, observations_path: Path, output_path: Path) -> dict[str, Any]:
    try:
        promise = json.loads(promise_path.read_text(encoding="utf-8"))
        observations = json.loads(observations_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TasteContractError(f"Taste QA input is unreadable or invalid: {exc}") from exc
    evidence = promise.get("taste") if isinstance(promise, dict) else None
    if not isinstance(evidence, dict) or evidence.get("schema") != PLAN_SCHEMA:
        raise TasteContractError("promise.json has no locked Taste plan evidence")
    job_dir = promise_path.resolve().parent
    if observations_path.resolve().parent != job_dir:
        raise TasteContractError("Taste observations must be one direct file inside the job directory")
    _validate_observations(evidence, observations, job_dir)
    receipt = _build_qa_receipt(evidence, observations, observations_path)
    _atomic_json(output_path, receipt)
    return receipt


def validate_qa_receipt(job_dir: Path) -> tuple[bool, str, dict[str, Any] | None]:
    try:
        promise_path = job_dir / "promise.json"
        receipt_path = job_dir / "taste-qa.json"
        promise = json.loads(promise_path.read_text(encoding="utf-8"))
        evidence = promise.get("taste") if isinstance(promise, dict) else None
        if not isinstance(evidence, dict) or evidence.get("schema") != PLAN_SCHEMA:
            raise TasteContractError("promise.json has no locked Taste plan evidence")
        if not receipt_path.is_file():
            raise TasteContractError("no taste-qa.json; run taste_contract.py qa on current observations")
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if not isinstance(receipt, dict) or receipt.get("schema") != QA_SCHEMA:
            raise TasteContractError(f"taste-qa.json must use schema {QA_SCHEMA}")
        if set(receipt) != {
            "schema",
            "status",
            "tasteEvidenceSha256",
            "tasteSources",
            "render",
            "renderManifest",
            "observationsPath",
            "observationsSha256",
            "checks",
            "warnings",
            "receiptSha256",
        }:
            raise TasteContractError("taste-qa.json contains unknown or missing fields")
        if receipt.get("tasteEvidenceSha256") != evidence.get("evidenceSha256"):
            raise TasteContractError("taste-qa.json belongs to different Taste plan evidence")
        if receipt.get("tasteSources") != evidence.get("sources"):
            raise TasteContractError("taste-qa.json source identities do not match the plan")
        receipt_render = receipt.get("render")
        if (
            not isinstance(receipt_render, dict)
            or receipt_render.get("path") != FINAL_RENDER_NAME
            or receipt_render != _render_identity(_canonical_final_path(job_dir), job_dir)
        ):
            raise TasteContractError(
                f"taste-qa.json is not bound to the current canonical {FINAL_RENDER_NAME}; "
                "it belongs to a different or changed render"
            )
        observations_name = receipt.get("observationsPath")
        if (
            not isinstance(observations_name, str)
            or Path(observations_name).name != observations_name
        ):
            raise TasteContractError("taste-qa.json observations path is invalid")
        observations_path = job_dir / observations_name
        if (
            not observations_path.is_file()
            or receipt.get("observationsSha256") != file_sha256(observations_path)
        ):
            raise TasteContractError("Taste observations changed after QA")
        observations = json.loads(observations_path.read_text(encoding="utf-8"))
        _validate_observations(evidence, observations, job_dir)
        expected = _build_qa_receipt(evidence, observations, observations_path)
        if receipt != expected:
            raise TasteContractError(
                "taste-qa.json contradicts the deterministic checks recomputed from current observations"
            )
        if receipt.get("status") == "fail":
            failed_ids = [
                check.get("id")
                for check in receipt["checks"]
                if check.get("status") == "fail"
            ]
            raise TasteContractError("Taste QA failed: " + ", ".join(map(str, failed_ids)))
        return True, f"current {QA_SCHEMA} receipt ({receipt.get('status')})", receipt
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, TasteContractError) as exc:
        return False, str(exc), None


def _roots(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    engine = Path(args.engine or os.environ.get("VIDEOCLAW_ENGINE") or Path(__file__).resolve().parents[1]).resolve()
    workspace = Path(args.workspace or os.environ.get("VIDEOCLAW_WORKSPACE") or Path.cwd()).resolve()
    jobs = Path(args.jobs or os.environ.get("VIDEOCLAW_JOBS_DIR") or workspace / "jobs").resolve()
    return engine, workspace, jobs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine")
    parser.add_argument("--workspace")
    parser.add_argument("--jobs")
    sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan", help="resolve Taste and embed it in promise.json")
    plan.add_argument("--job", required=True)
    plan.add_argument("--tenant", required=True)
    plan.add_argument("--requirements", type=Path)
    qa = sub.add_parser("qa", help="grade mechanical Taste observations")
    qa.add_argument("--job", required=True)
    qa.add_argument("--observations", type=Path)

    args = parser.parse_args(argv)
    _engine, workspace, jobs = _roots(args)
    job_dir = (jobs / args.job).resolve()
    if job_dir.parent != jobs:
        raise TasteContractError("--job must be one direct child of the jobs directory")
    promise = job_dir / "promise.json"
    if args.command == "plan":
        evidence = write_plan(promise, _engine, workspace, args.tenant, args.requirements)
        print(
            f"taste plan locked for {args.job}: {len(evidence['commitments'])} commitment(s), "
            f"{evidence['evidenceSha256'][:12]}…"
        )
        return 0
    observations = args.observations or job_dir / "taste-observations.json"
    receipt = run_qa(promise, observations, job_dir / "taste-qa.json")
    print(
        f"taste QA {receipt['status']} for {args.job}: {len(receipt['checks'])} mechanical check(s)"
    )
    return 1 if receipt["status"] == "fail" else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except TasteContractError as error:
        print(f"taste_contract: {error}", file=os.sys.stderr)
        raise SystemExit(2)
