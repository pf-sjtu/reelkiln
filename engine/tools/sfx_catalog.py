"""Discover and cache exact rights-cleared SFX catalog assets.

This is a $0 authenticated retrieval primitive, not generative media. Durable
artifacts contain stable IDs, versions, hashes and rights metadata only. Bearer
capabilities are sent exclusively to the gateway; signed storage URLs are sent
exclusively to the storage host and are never logged or persisted.

    sfx_catalog.py --job <id> --mode search --query click
    sfx_catalog.py --job <id> --mode fetch --id ui.click.soft --version 1
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

from _gateway import GatewayError, gateway
from job import add_job_arg, resolve_job_dir
from log import job_lock_at, log_event

TOOL = "sfx_catalog.py"
PROVENANCE_NAME = "catalog-provenance.json"
MAX_ASSET_BYTES = 20 * 1024 * 1024
_ID_RE = re.compile(r"^[a-z0-9]+(?:[._][a-z0-9]+)+$")
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_STORAGE_HOST = "storage.googleapis.com"
_ALLOWED_LICENSES = frozenset({"videoclaw-owned", "commissioned", "cc0"})


class CatalogError(RuntimeError):
    pass


class ExpiredResolution(CatalogError):
    pass


def _require_gateway() -> None:
    if not gateway.enabled():
        raise CatalogError(
            "the VideoClaw SFX catalog requires an authenticated gateway session; "
            "omit the cue or ask the user if the catalog is unavailable"
        )


def search(*, query: str = "", category: str | None = None,
           tags: list[str] | None = None, limit: int = 20) -> list[dict]:
    _require_gateway()
    try:
        response = gateway.search_sfx_catalog(
            query=query, category=category, tags=tags, limit=limit
        )
    except GatewayError as exc:
        # Queries are user-controlled and travel in the request URL. Never let
        # a transport exception reflect that URL into stderr or agent logs.
        raise CatalogError(
            "catalog search is temporarily unavailable; omit the cue or retry later"
        ) from exc
    if response.get("schema") != "videoclaw.sfx-catalog/v1":
        raise CatalogError("gateway returned an unsupported SFX catalog contract")
    items = response.get("items")
    if not isinstance(items, list):
        raise CatalogError("gateway returned a malformed SFX catalog response")
    return items


def _validated_resolution(response: dict, asset_id: str, version: int) -> dict:
    if response.get("schema") != "videoclaw.sfx-resolution/v1":
        raise CatalogError("gateway returned an unsupported SFX resolution contract")
    asset = response.get("asset")
    url = response.get("download_url")
    if (not isinstance(asset, dict) or asset.get("id") != asset_id
            or asset.get("version") != version):
        raise CatalogError("gateway changed the requested SFX identity")
    if not _HASH_RE.fullmatch(str(asset.get("sha256", ""))):
        raise CatalogError("gateway returned an invalid SFX content hash")
    if asset.get("format") != "wav" or asset.get("content_type") != "audio/wav":
        raise CatalogError("gateway returned an unsupported SFX media format")
    if not isinstance(asset.get("byte_size"), int) or not 0 < asset["byte_size"] <= MAX_ASSET_BYTES:
        raise CatalogError("gateway returned an invalid SFX byte size")
    rights = asset.get("rights")
    if (not isinstance(rights, dict)
            or not isinstance(rights.get("source_owner"), str)
            or not rights["source_owner"].strip()
            or rights.get("attribution_required") is not False
            or rights.get("license") not in _ALLOWED_LICENSES
            or not isinstance(rights.get("provenance"), str)
            or not rights["provenance"].strip()
            or not isinstance(rights.get("ingest_date"), str)
            or _DATE_RE.fullmatch(rights["ingest_date"]) is None
            or rights.get("usage_restrictions") != []):
        raise CatalogError("gateway returned incomplete SFX rights metadata")
    parsed = urlparse(url) if isinstance(url, str) else None
    try:
        invalid_locator = (
            parsed is None or parsed.scheme != "https"
            or parsed.hostname != _STORAGE_HOST or parsed.port is not None
            or parsed.username is not None or parsed.password is not None
        )
    except ValueError:
        invalid_locator = True
    if invalid_locator:
        raise CatalogError("gateway returned an invalid SFX storage locator")
    return {"asset": asset, "download_url": url}


def resolve_exact(asset_id: str, version: int) -> dict:
    """Resolve one exact catalog identity through the authenticated gateway."""
    _require_gateway()
    try:
        response = gateway.resolve_sfx_catalog(asset_id, version)
    except GatewayError as exc:
        raise CatalogError(
            f"could not resolve exact catalog cue {asset_id}@{version}; "
            "omit it or ask the user rather than substituting or generating"
        ) from exc
    return _validated_resolution(response, asset_id, version)


def _download_once(url: str, pending: Path) -> None:
    """Download without Authorization and without reflecting URL/body on error."""
    try:
        response = requests.get(
            url, stream=True, timeout=120, allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise CatalogError("SFX storage download transport failed") from exc
    try:
        if response.status_code in {401, 403}:
            raise ExpiredResolution("the short-lived SFX storage locator expired")
        if 300 <= response.status_code < 400:
            raise CatalogError("SFX storage download refused an untrusted redirect")
        if response.status_code != 200:
            raise CatalogError(f"SFX storage download failed with HTTP {response.status_code}")
        total = 0
        try:
            with pending.open("xb") as output:
                for chunk in response.iter_content(64 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_ASSET_BYTES:
                        raise CatalogError("SFX storage response exceeded the catalog size limit")
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        except CatalogError:
            raise
        except OSError as exc:
            raise CatalogError("could not write the job SFX cache") from exc
    finally:
        response.close()


def _safe_sfx_dir(job: Path) -> Path:
    sfx_dir = job / "sfx"
    if sfx_dir.is_symlink():
        raise CatalogError("job SFX directory must not be a symlink")
    try:
        sfx_dir.mkdir(mode=0o700, exist_ok=True)
        if not stat.S_ISDIR(sfx_dir.stat(follow_symlinks=False).st_mode):
            raise CatalogError("job SFX destination is not a directory")
    except CatalogError:
        raise
    except OSError as exc:
        raise CatalogError("job SFX destination is unavailable") from exc
    return sfx_dir


def _filename(asset_id: str, version: int) -> str:
    if not _ID_RE.fullmatch(asset_id) or version < 1:
        raise CatalogError("SFX id/version is invalid")
    return f"{asset_id.replace('.', '_')}__v{version}.wav"


def _write_provenance(job: Path, record: dict) -> None:
    job_fd = os.open(job, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        with job_lock_at(job_fd):
            manifest = job / "sfx" / PROVENANCE_NAME
            current = {"schema": "videoclaw.sfx-provenance/v1", "assets": []}
            if manifest.exists():
                loaded = json.loads(manifest.read_text(encoding="utf-8"))
                if loaded.get("schema") != current["schema"] or not isinstance(loaded.get("assets"), list):
                    raise CatalogError("existing SFX provenance manifest is malformed")
                current = loaded
            identity = (record["id"], record["version"])
            current["assets"] = [
                item for item in current["assets"]
                if (item.get("id"), item.get("version")) != identity
            ] + [record]
            current["assets"].sort(key=lambda item: (item["id"], item["version"]))
            pending = manifest.with_name(f".{PROVENANCE_NAME}.{uuid.uuid4().hex}.tmp")
            try:
                pending.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                os.replace(pending, manifest)
            finally:
                pending.unlink(missing_ok=True)
    finally:
        os.close(job_fd)


def fetch(asset_id: str, *, version: int, job: Path) -> Path:
    _require_gateway()
    if not _ID_RE.fullmatch(asset_id) or version < 1:
        raise CatalogError("SFX id/version is invalid")
    sfx_dir = _safe_sfx_dir(job)
    destination = sfx_dir / _filename(asset_id, version)
    if destination.is_symlink():
        raise CatalogError("SFX cache destination must not be a symlink")

    resolution = resolve_exact(asset_id, version)
    expected = resolution["asset"]
    cache_hit = destination.exists()
    if cache_hit:
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        if digest != expected["sha256"] or destination.stat().st_size != expected["byte_size"]:
            raise CatalogError("existing job SFX cache does not match its catalog identity")

    pending = sfx_dir / f".{destination.name}.{uuid.uuid4().hex}.part"
    started = time.perf_counter()
    if not cache_hit:
        try:
            for attempt in range(2):
                try:
                    _download_once(resolution["download_url"], pending)
                    break
                except ExpiredResolution:
                    pending.unlink(missing_ok=True)
                    if attempt == 1:
                        raise CatalogError("SFX storage locator expired twice")
                    refreshed = resolve_exact(asset_id, version)
                    if refreshed["asset"]["sha256"] != expected["sha256"]:
                        raise CatalogError("SFX content identity changed during re-resolution")
                    resolution = refreshed
            digest = hashlib.sha256(pending.read_bytes()).hexdigest()
            if digest != expected["sha256"] or pending.stat().st_size != expected["byte_size"]:
                raise CatalogError("downloaded SFX failed content integrity verification")
            os.replace(pending, destination)
        finally:
            pending.unlink(missing_ok=True)

    relative = str(destination.relative_to(job))
    record = {
        "id": asset_id,
        "version": version,
        "sha256": expected["sha256"],
        "byte_size": expected["byte_size"],
        "destination": relative,
        "source_owner": expected["rights"]["source_owner"],
        "license": expected["rights"]["license"],
        "provenance": expected["rights"]["provenance"],
        "ingest_date": expected["rights"]["ingest_date"],
        "attribution_required": False,
        "usage_restrictions": expected["rights"].get("usage_restrictions", []),
        "cached_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    _write_provenance(job, record)
    log_event(
        job,
        tool=TOOL,
        event="sfx_catalog_cached",
        duration_seconds=time.perf_counter() - started,
        extra={
            "catalog_id": asset_id,
            "asset_version": version,
            "sha256": expected["sha256"],
            "outcome": "cache_hit" if cache_hit else "cached",
            "destination": relative,
            "cost_usd": 0.0,
            "approval_required": False,
        },
    )
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Search/fetch the $0 VideoClaw SFX catalog")
    add_job_arg(parser)
    parser.add_argument("--mode", choices=("search", "fetch"), required=True)
    parser.add_argument("--query", default="")
    parser.add_argument("--category")
    parser.add_argument("--tags", default="", help="comma-separated required tags")
    parser.add_argument("--id", dest="asset_id")
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    job = resolve_job_dir(args.job)
    try:
        if args.mode == "search":
            items = search(
                query=args.query,
                category=args.category,
                tags=[tag.strip() for tag in args.tags.split(",") if tag.strip()],
                limit=args.limit,
            )
            log_event(
                job, tool=TOOL, event="sfx_catalog_search",
                extra={"category": args.category,
                       "result_ids": [item.get("id") for item in items],
                       "cost_usd": 0.0, "approval_required": False},
            )
            if not items:
                print("No catalog cue matched. Omit the SFX or ask the user; do not scrape or generate one.")
                return
            for item in items:
                print(f"{item['id']}@{item['version']}  {item['duration_seconds']:.3f}s  "
                      f"tags={','.join(item.get('tags', []))}")
            return
        if not args.asset_id:
            parser.error("--id is required for --mode fetch")
        path = fetch(args.asset_id, version=args.version, job=job)
        print(f"Cached {args.asset_id}@{args.version} → {path}")
    except CatalogError as exc:
        print(f"SFX catalog: {exc}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
