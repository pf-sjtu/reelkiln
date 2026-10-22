// docs/36 W11: the Windows media-URL repair the preload installs into the original renderer's main world.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installWinVcmediaShim } from "../src/preload/win-vcmedia";
import { vcmediaFilePath } from "../src/main/media/media-ipc";

const URL_ORIG = globalThis.URL;
// the original renderer's mediaUrl()/encodeFilePath() (app/out/renderer, verbatim)
const encodeFilePath = (abs: string) => abs.split("/").map(encodeURIComponent).join("/");
const mediaUrl = (abs: string, sessionId?: string) => `vcmedia://local${encodeFilePath(abs)}${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`;

test("W11: original renderer URL for a Windows path → vcmedia://local/D%3A/…, main maps it back to the native path", () => {
  const g: any = globalThis; const saved = g.fetch; let fetched: unknown;
  g.fetch = (u: unknown) => { fetched = u; return Promise.resolve(); };
  try {
    installWinVcmediaShim();
    const fix = g.__videoclawPortFixWinVcmedia;
    const abs = "D:\\a\\_temp\\s1run\\Videoclaw\\jobs\\job-1\\versions\\v1.mp4";
    const bad = mediaUrl(abs, "sid 1");
    assert.match(bad, /^vcmedia:\/\/localD%3A%5C/);
    const good = fix(bad);
    assert.equal(good, "vcmedia://local/D%3A/a/_temp/s1run/Videoclaw/jobs/job-1/versions/v1.mp4?session=sid%201");
    const u = new URL(good);
    assert.equal(u.hostname, "local");
    assert.equal(vcmediaFilePath(decodeURIComponent(u.pathname), "win32"), abs);
    // names with spaces / unicode / '#' survive; POSIX and already-good URLs are untouched
    assert.equal(vcmediaFilePath(decodeURIComponent(new URL(fix(mediaUrl("C:\\Users\\a b\\视频#1.mp4"))).pathname), "win32"), "C:\\Users\\a b\\视频#1.mp4");
    for (const ok of [mediaUrl("/home/u/v1.mp4"), "vcmedia://local/D%3A/x.mp4", "https://example.com/a.mp4", 42]) assert.equal(fix(ok), ok);
    g.fetch(bad, { method: "HEAD" });
    assert.equal(fetched, good);
  } finally { g.fetch = saved; g.URL = URL_ORIG; delete g.__videoclawPortFixWinVcmedia; delete g.__videoclawPortFixWinFileUrl; }
});

// the original renderer's resolveDeliveryUrl() (app/out/renderer, verbatim) — the chat-reply link builder
function resolveDeliveryUrl(href: string, cwd2: string) {
  if (!href || /[\u0000-\u0020\\]/.test(href) || href.startsWith("//")) return null;
  try {
    const url = new URL(href, `file://${encodeFilePath(cwd2)}/`);
    if (url.protocol === "https:" || url.protocol === "http:") return url;
    if (url.protocol !== "file:" || url.hostname || url.search || url.hash) return null;
    const path2 = decodeURIComponent(url.pathname);
    if (!path2.startsWith("/") || /[\u0000-\u001f\\]/.test(path2)) return null;
    return url;
  } catch {
    return null;
  }
}

test("W11b: agent reply job link with a Windows cwd → 'Link unavailable' before, resolvable media path after the shim", () => {
  const g: any = globalThis; const URL0 = g.URL; const fetch0 = g.fetch;
  const cwd = "D:\\a\\_temp\\s1run\\Videoclaw";
  const href = "jobs/6-5-9-16-a-20261022-50721c/final.mp4";
  try {
    // NB: Node's WHATWG parser already accepts `file://D%3A%5C…/` (drive letter in host position); Chromium does not —
    // the before/after evidence is the Windows S1 `reply_link` verdict (docs/37), not this assertion.
    assert.notEqual(resolveDeliveryUrl(href, "/home/u/Videoclaw"), null);
    installWinVcmediaShim();
    const url = resolveDeliveryUrl(href, cwd)!;
    assert.ok(url, "resolved after the shim");
    const abs = decodeURIComponent(url.pathname);
    assert.equal(abs, "/D:/a/_temp/s1run/Videoclaw/jobs/6-5-9-16-a-20261022-50721c/final.mp4");
    assert.equal(vcmediaFilePath(abs, "win32"), "D:\\a\\_temp\\s1run\\Videoclaw\\jobs\\6-5-9-16-a-20261022-50721c\\final.mp4");
    const media = new URL(mediaUrl(abs, "s"));
    assert.equal(media.hostname, "local");
    assert.equal(vcmediaFilePath(decodeURIComponent(media.pathname), "win32"), vcmediaFilePath(abs, "win32"));
    // escapes stay refused; POSIX bases, https links and URL statics/instanceof are untouched
    assert.equal(resolveDeliveryUrl("https://e.com/a", cwd)?.href, "https://e.com/a");
    assert.equal(new URL("file:///home/u/").pathname, "/home/u/");
    assert.ok(new URL("https://e.com") instanceof URL0); assert.equal(typeof URL.createObjectURL, "function");
    installWinVcmediaShim(); // idempotent: URL not wrapped twice
    assert.equal(Object.getPrototypeOf(g.URL), URL0);
  } finally { g.URL = URL0; g.fetch = fetch0; delete g.__videoclawPortFixWinVcmedia; delete g.__videoclawPortFixWinFileUrl; }
});
