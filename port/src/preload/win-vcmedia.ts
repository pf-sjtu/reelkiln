// PORT-WIN docs/36 (W11, found by the Windows S1 UI e2e): the ORIGINAL renderer builds media URLs as
//   `vcmedia://local${abs.split("/").map(encodeURIComponent).join("/")}`
// which is only correct for POSIX paths. With a native Windows path (`D:\a\…\v1.mp4`) the result is
// `vcmedia://localD%3A%5Ca%5C…` — the whole path lands in the URL host, Chromium rejects it, and every preview
// shows "This source is offline". The renderer bundle stays verbatim; on win32 only, this main-world shim rewrites such
// URLs at the DOM/fetch boundary to `vcmedia://local/D%3A/a/…/v1.mp4` (query kept), which the main-process handler maps
// back to `D:\a\…\v1.mp4` (vcmediaFilePath). POSIX: not installed, nothing changes.
// The installer is serialized into the main world (contextBridge.executeInMainWorld) — it must stay self-contained.
export function installWinVcmediaShim(): void {
  const fix = (url: unknown): unknown => {
    if (typeof url !== "string") return url;
    const m = /^vcmedia:\/\/local([A-Za-z])(?:%3A|:)((?:%5C|%2F|\\|\/)[^?#]*)([?#].*)?$/i.exec(url);
    if (!m) return url;
    let rest: string;
    try { rest = decodeURIComponent(m[2]); } catch { return url; }
    const segs = rest.replace(/\\/g, "/").split("/").filter((s, i) => i > 0 || s !== "");
    return `vcmedia://local/${encodeURIComponent(m[1].toUpperCase() + ":")}/${segs.map(encodeURIComponent).join("/")}${m[3] ?? ""}`;
  };
  const g: any = globalThis as any;
  g.__videoclawPortFixWinVcmedia = fix;
  const ATTRS = new Set(["src", "poster", "href"]);
  const wrapProp = (ctor: any, prop: string) => {
    const proto = ctor && ctor.prototype; if (!proto) return;
    let owner = proto; let d: PropertyDescriptor | undefined;
    while (owner && !(d = Object.getOwnPropertyDescriptor(owner, prop))) owner = Object.getPrototypeOf(owner);
    if (!d || !d.set) return;
    const set = d.set;
    Object.defineProperty(proto, prop, { ...d, set(v: unknown) { set.call(this, fix(v)); } });
  };
  for (const c of [g.HTMLMediaElement, g.HTMLImageElement, g.HTMLSourceElement, g.HTMLTrackElement]) wrapProp(c, "src");
  wrapProp(g.HTMLVideoElement, "poster");
  if (g.Element?.prototype?.setAttribute) {
    const setAttribute = g.Element.prototype.setAttribute;
    g.Element.prototype.setAttribute = function (name: string, value: unknown) {
      return setAttribute.call(this, name, ATTRS.has(String(name).toLowerCase()) ? fix(value) : value);
    };
  }
  if (typeof g.fetch === "function") {
    const fetch0 = g.fetch;
    g.fetch = function (input: unknown, init?: unknown) { return fetch0.call(this, fix(input), init); };
  }
}
