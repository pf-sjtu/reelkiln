// docs/36 W11: the Windows media-URL repair the preload installs into the original renderer's main world.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installWinVcmediaShim } from "../src/preload/win-vcmedia";
import { vcmediaFilePath } from "../src/main/media/media-ipc";

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
  } finally { g.fetch = saved; delete g.__videoclawPortFixWinVcmedia; }
});
