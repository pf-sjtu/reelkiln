# SFX library

This directory is intentionally empty in a clean Videoclaw engine package.

Rights-cleared catalog assets are fetched by stable ID into `jobs/<id>/sfx/` and
content-hash attested in the job provenance manifest. Licensed user files remain
job-local too. Audio bytes are not source code and are never shipped from a
developer's private library. The tracked README keeps `_paths.SFX_LIBRARY_DIR`
present for compatibility; use `tools/sfx_catalog.py`, not this directory, for
global discovery.
