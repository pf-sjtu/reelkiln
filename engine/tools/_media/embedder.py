"""Embedding backends — native multimodal (text/image/video share one space).

Adapted from ssrajadh/sentrysearch (Apache-2.0).

Backends:
  · gemini  — Gemini Embedding 2 (gemini-embedding-2-preview) via google-genai.
              Needs GEMINI_API_KEY. Best quality; the default.
  · local   — local Qwen3-VL (no API key, offline). DEFERRED: raises a helpful
              error until torch/transformers are wired (the Mac-app path).
  · dummy   — deterministic hash pseudo-vectors. TEST-ONLY: proves the
              chunk→store→search→trim→reindex plumbing without spending on
              embeddings or needing a key. Never mixes with real vectors
              (its own collection). NOT semantically meaningful.
"""

from __future__ import annotations

import hashlib
import os
import sys
import time
from abc import ABC, abstractmethod
from collections import deque
from pathlib import Path

DEFAULT_DIMENSIONS = 768
EMBED_MODEL = "gemini-embedding-2-preview"
DEFAULT_RPM = 55


class BaseEmbedder(ABC):
    @abstractmethod
    def embed_video_chunk(self, chunk_path: str, verbose: bool = False) -> list[float]: ...
    @abstractmethod
    def embed_query(self, query_text: str, verbose: bool = False) -> list[float]: ...
    @abstractmethod
    def embed_image(self, image_path: str, verbose: bool = False) -> list[float]: ...
    @abstractmethod
    def dimensions(self) -> int: ...


class GeminiAPIKeyError(RuntimeError):
    pass


class GeminiQuotaError(RuntimeError):
    pass


# ── dummy (plumbing test only) ───────────────────────────────────────────────

class DummyEmbedder(BaseEmbedder):
    """Deterministic pseudo-embeddings from a content hash. Same input → same
    vector; different input → different vector. Semantically meaningless; for
    validating the pipeline only."""

    def __init__(self, dimensions: int = DEFAULT_DIMENSIONS):
        self._dims = dimensions

    def _vec(self, seed: bytes) -> list[float]:
        import math
        out: list[float] = []
        counter = 0
        while len(out) < self._dims:
            h = hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
            for i in range(0, len(h), 2):
                out.append((int.from_bytes(h[i:i + 2], "big") / 65535.0) * 2 - 1)
            counter += 1
        out = out[: self._dims]
        norm = math.sqrt(sum(x * x for x in out)) or 1.0
        return [x / norm for x in out]

    def embed_video_chunk(self, chunk_path: str, verbose: bool = False) -> list[float]:
        with open(chunk_path, "rb") as f:
            return self._vec(b"vid:" + hashlib.sha256(f.read()).digest())

    def embed_image(self, image_path: str, verbose: bool = False) -> list[float]:
        with open(image_path, "rb") as f:
            return self._vec(b"img:" + hashlib.sha256(f.read()).digest())

    def embed_query(self, query_text: str, verbose: bool = False) -> list[float]:
        return self._vec(b"qry:" + query_text.encode("utf-8"))

    def dimensions(self) -> int:
        return self._dims


# ── gemini ───────────────────────────────────────────────────────────────────

class _RateLimiter:
    def __init__(self, max_per_minute: int = DEFAULT_RPM):
        self._max = max_per_minute
        self._ts: deque[float] = deque()

    def wait(self) -> None:
        now = time.monotonic()
        while self._ts and now - self._ts[0] >= 60:
            self._ts.popleft()
        if len(self._ts) >= self._max:
            sleep_for = 60.0 - (now - self._ts[0])
            if sleep_for > 0:
                time.sleep(sleep_for)
        self._ts.append(time.monotonic())


def _retry(fn, *, max_retries: int = 5, initial: float = 2.0, cap: float = 60.0):
    delay = initial
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            retryable = status in (429, 503) or "resource exhausted" in msg \
                or "503" in msg or "429" in msg
            if not retryable or attempt == max_retries:
                if "resource exhausted" in msg or status == 429:
                    raise GeminiQuotaError(
                        "Gemini API rate limit exceeded. Wait a minute, use a larger "
                        "--chunk-duration, or upgrade at https://aistudio.google.com"
                    ) from exc
                raise
            wait = min(delay, cap)
            print(f"  retryable (attempt {attempt + 1}/{max_retries}), waiting {wait:.0f}s: {exc}",
                  file=sys.stderr)
            time.sleep(wait)
            delay *= 2


_IMAGE_MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif",
}


def _truthy(v: str | None) -> bool:
    return (v or "").strip().lower() in ("1", "true", "yes", "on")


class GeminiEmbedder(BaseEmbedder):
    """Native multimodal embeddings via the Google GenAI SDK.

    Two auth modes, selected from env (NOT OpenRouter — its /embeddings is text-only):
      · Vertex AI / GCP project (recommended; proven for video on gemini-embedding-2):
          GOOGLE_GENAI_USE_VERTEXAI=true
          GOOGLE_CLOUD_PROJECT=<project-id>
          GOOGLE_CLOUD_LOCATION=global            (default)
          GOOGLE_APPLICATION_CREDENTIALS=/abs/sa.json   (service-account key; ADC)
          GOOGLE_GENAI_ENTERPRISE=true            (optional; flips Client(enterprise=True))
      · AI Studio dev key (simplest, but video-embed availability varies):
          GEMINI_API_KEY=<key>
    Override the model with MEDIA_EMBED_MODEL (default: gemini-embedding-2 on Vertex,
    gemini-embedding-2-preview on the dev key).
    """

    def __init__(self, dimensions: int = DEFAULT_DIMENSIONS):
        from google import genai  # noqa
        use_vertex = _truthy(os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"))
        api_key = os.environ.get("GEMINI_API_KEY")
        if use_vertex:
            project = os.environ.get("GOOGLE_CLOUD_PROJECT")
            location = os.environ.get("GOOGLE_CLOUD_LOCATION") or "global"
            if not project:
                raise GeminiAPIKeyError(
                    "GOOGLE_GENAI_USE_VERTEXAI=true but GOOGLE_CLOUD_PROJECT is unset. "
                    "Add GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS to .env."
                )
            kw = {"project": project, "location": location}
            self._client = (genai.Client(enterprise=True, **kw)
                            if _truthy(os.environ.get("GOOGLE_GENAI_ENTERPRISE"))
                            else genai.Client(vertexai=True, **kw))
            self._model = os.environ.get("MEDIA_EMBED_MODEL", "gemini-embedding-2")
        elif api_key:
            self._client = genai.Client(api_key=api_key)
            self._model = os.environ.get("MEDIA_EMBED_MODEL", "gemini-embedding-2-preview")
        else:
            raise GeminiAPIKeyError(
                "No Gemini creds found. For Vertex/GCP set GOOGLE_GENAI_USE_VERTEXAI=true + "
                "GOOGLE_CLOUD_PROJECT (+ GOOGLE_APPLICATION_CREDENTIALS); or set GEMINI_API_KEY "
                "for AI Studio. (OpenRouter cannot do multimodal embeddings — proven.) "
                "Or use --backend dummy for a plumbing test."
            )
        self._dims = dimensions
        self._limiter = _RateLimiter()

    def _embed(self, *, parts=None, text=None, task_type: str):
        from google.genai import types
        self._limiter.wait()
        contents = text if text is not None else types.Content(parts=parts)
        resp = _retry(lambda: self._client.models.embed_content(
            model=self._model, contents=contents,
            config=types.EmbedContentConfig(task_type=task_type,
                                            output_dimensionality=self._dims),
        ))
        return list(resp.embeddings[0].values)

    @staticmethod
    def _part(path: str, mime: str):
        from google.genai import types
        with open(path, "rb") as f:
            data = f.read()
        if hasattr(types.Part, "from_bytes"):
            return types.Part.from_bytes(data=data, mime_type=mime)
        return types.Part(inline_data=types.Blob(data=data, mime_type=mime))

    def embed_video_chunk(self, chunk_path: str, verbose: bool = False) -> list[float]:
        return self._embed(parts=[self._part(chunk_path, "video/mp4")],
                           task_type="RETRIEVAL_DOCUMENT")

    def embed_image(self, image_path: str, verbose: bool = False) -> list[float]:
        if not os.path.isfile(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")
        ext = os.path.splitext(image_path)[1].lower()
        if ext not in _IMAGE_MIME:
            raise ValueError(f"Unsupported image {ext!r}; Gemini accepts {sorted(_IMAGE_MIME)}.")
        # RETRIEVAL_DOCUMENT when indexing a still; callers pass it as a doc.
        return self._embed(parts=[self._part(image_path, _IMAGE_MIME[ext])],
                           task_type="RETRIEVAL_DOCUMENT")

    def embed_image_query(self, image_path: str) -> list[float]:
        ext = os.path.splitext(image_path)[1].lower()
        return self._embed(parts=[self._part(image_path, _IMAGE_MIME[ext])],
                           task_type="RETRIEVAL_QUERY")

    def embed_query(self, query_text: str, verbose: bool = False) -> list[float]:
        return self._embed(text=query_text, task_type="RETRIEVAL_QUERY")

    def dimensions(self) -> int:
        return self._dims


# ── local (deferred) ─────────────────────────────────────────────────────────

class LocalEmbedder(BaseEmbedder):
    def __init__(self, *a, **k):
        raise NotImplementedError(
            "The local Qwen3-VL backend is scaffolded but not wired yet "
            "(needs torch + transformers + a model download). For now use "
            "--backend gemini (set GEMINI_API_KEY) or --backend dummy (plumbing test). "
            "See MEDIA_LIBRARY_PLAN.md Phase 1."
        )

    def embed_video_chunk(self, *a, **k): ...
    def embed_query(self, *a, **k): ...
    def embed_image(self, *a, **k): ...
    def dimensions(self): ...


# ── factory ──────────────────────────────────────────────────────────────────

class GatewayEmbedder(BaseEmbedder):
    """Routes embeds through the videoclaw-backend gateway (same Vertex model,
    same vector space — the gateway runs it in the videoclaw-backend GCP project
    and meters the spend under the caller's VIDEOCLAW_API_KEY)."""

    def __init__(self, dimensions: int = DEFAULT_DIMENSIONS, *, job: Path | str | None = None):
        import sys
        tools_dir = str(Path(__file__).resolve().parent.parent)
        if tools_dir not in sys.path:
            sys.path.insert(0, tools_dir)
        from _gateway import gateway  # noqa
        self._gw = gateway
        self._dims = dimensions
        self._job = job

    def _run(self, mode: str, *, text: str | None = None,
             path: str | None = None, task_type: str) -> list[float]:
        params: dict = {"dims": self._dims, "task_type": task_type}
        kwargs: dict = {"params": params}
        if text is not None:
            params["input"] = text
        else:
            kwargs["references"] = [path]
            if mode == "image":
                ext = os.path.splitext(path)[1].lower()
                params["mime_type"] = _IMAGE_MIME.get(ext, "image/jpeg")
        res = self._gw.run("embed", mode=mode, job=self._job, **kwargs)
        return res["output"]["embeddings"][0]

    def embed_video_chunk(self, chunk_path: str, verbose: bool = False) -> list[float]:
        return self._run("video", path=chunk_path, task_type="RETRIEVAL_DOCUMENT")

    def embed_image(self, image_path: str, verbose: bool = False) -> list[float]:
        return self._run("image", path=image_path, task_type="RETRIEVAL_DOCUMENT")

    def embed_image_query(self, image_path: str) -> list[float]:
        return self._run("image", path=image_path, task_type="RETRIEVAL_QUERY")

    def embed_query(self, query_text: str, verbose: bool = False) -> list[float]:
        return self._run("text", text=query_text, task_type="RETRIEVAL_QUERY")

    def dimensions(self) -> int:
        return self._dims


def get_embedder(backend: str = "gemini", *, dimensions: int = DEFAULT_DIMENSIONS,
                 job: Path | str | None = None, **kwargs) -> BaseEmbedder:
    if backend == "gemini":
        # dual mode: VIDEOCLAW_API_KEY present → same model via the gateway
        if os.environ.get("VIDEOCLAW_API_KEY"):
            return GatewayEmbedder(dimensions=dimensions, job=job)
        return GeminiEmbedder(dimensions=dimensions)
    if backend == "dummy":
        return DummyEmbedder(dimensions=dimensions)
    if backend == "local":
        return LocalEmbedder(**kwargs)
    raise ValueError(f"Unknown backend: {backend!r} (gemini | local | dummy)")
