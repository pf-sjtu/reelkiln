import { appendFileSync } from 'node:fs';

// Loaded with NODE_OPTIONS before the HyperFrames CLI. The compiler currently
// resolves missing font faces with global fetch; an offline Videoclaw render
// must never silently do that. Loopback remains available for the CLI's local
// producer/browser transport. Every refused attempt is recorded for the Python
// boundary to turn into a hard render failure, even if upstream catches fetch.
const auditPath = process.env.VIDEOCLAW_HF_NETWORK_AUDIT;
const pinnedVersion = process.env.VIDEOCLAW_HF_PINNED_VERSION;
const originalFetch = globalThis.fetch;

function isLoopback(url) {
  try {
    const parsed = new URL(typeof url === 'string' ? url : url?.url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '::1')
    );
  } catch {
    return false;
  }
}

function localUpstreamMetadata(url) {
  try {
    const parsed = new URL(typeof url === 'string' ? url : url?.url);
    if (
      parsed.href === 'https://registry.npmjs.org/hyperframes/latest' &&
      /^\d+\.\d+\.\d+$/.test(pinnedVersion ?? '')
    ) {
      // HyperFrames 0.7.90 calls checkForUpdate() even when its documented
      // HYPERFRAMES_NO_UPDATE_CHECK opt-out is set. Return only the engine's
      // separately attested exact pin. This is local metadata, not a network
      // allowlist: no registry socket is opened and every other URL still
      // reaches the audited refusal path below.
      return new Response(JSON.stringify({ version: pinnedVersion }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'raw.githubusercontent.com' &&
      /^\/heygen-com\/hyperframes\/(?:main|[0-9a-f]{40})\/skills-manifest\.json$/.test(
        parsed.pathname,
      )
    ) {
      // HyperFrames 0.7.90 performs this non-rendering compatibility lookup
      // even when HYPERFRAMES_SKIP_SKILLS is set. Supply the smallest valid
      // deterministic manifest at the process boundary; no socket is opened.
      return new Response('{"skills":{}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
  } catch {
    // The normal refusal path below records malformed/non-URL inputs.
  }
  return null;
}

if (auditPath && typeof originalFetch === 'function') {
  globalThis.fetch = async function videoclawOfflineFetch(input, init) {
    const raw = typeof input === 'string' ? input : input?.url;
    if (isLoopback(raw)) return originalFetch.call(this, input, init);
    const local = localUpstreamMetadata(raw);
    if (local) return local;
    const target = String(raw ?? '<unparseable>');
    appendFileSync(auditPath, `${target}\n`, { encoding: 'utf8', mode: 0o600 });
    throw new Error(`Videoclaw offline render blocked outbound fetch: ${target}`);
  };
}
