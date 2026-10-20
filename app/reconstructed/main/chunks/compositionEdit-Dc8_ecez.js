function attr(html, name) {
  const m = html.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}
function num(v, fallback = 0) {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function escapeText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
function decodeText(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}
const ROLE_BY_CLASS = [
  [/\bcap-word\b|\bcap-inner\b/, "caption"],
  [/\bov-/, "overlay"],
];
function roleFor(cls) {
  for (const [re, role] of ROLE_BY_CLASS) if (re.test(cls)) return role;
  return "text";
}
const LEAF_RE = /<(div|span|p|h[1-6])\b([^>]*\bid\s*=\s*"[^"]+"[^>]*)>([^<]*)<\/\1>/gi;
function idOf(attrs) {
  const m = attrs.match(/\bid\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}
function classOf(attrs) {
  const m = attrs.match(/\bclass\s*=\s*"([^"]*)"/);
  return m ? m[1] : "";
}
function parseComposition(html) {
  const compositionId = attr(html, "data-composition-id");
  if (!compositionId) return null;
  const editable = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of html.matchAll(LEAF_RE)) {
    const attrs = m[2];
    const inner = m[3];
    const id = idOf(attrs);
    if (!id || seen.has(id)) continue;
    const text = decodeText(inner).trim();
    if (!text) continue;
    seen.add(id);
    editable.push({ id, text: decodeText(inner), role: roleFor(classOf(attrs)) });
  }
  return {
    compositionId,
    width: num(attr(html, "data-width"), 1080),
    height: num(attr(html, "data-height"), 1920),
    durationSeconds: num(attr(html, "data-duration")),
    fps: num(attr(html, "data-fps"), 30),
    editable,
  };
}
function applyTextEdit(html, elementId, newText) {
  if (typeof newText !== "string" || /[<>]/.test(newText) || newText.length > 2e3) {
    return { ok: false, error: "invalid-text" };
  }
  let matches = 0;
  let out = html;
  out = html.replace(LEAF_RE, (full, tag, attrs, _inner) => {
    if (idOf(attrs) !== elementId) return full;
    matches++;
    return `<${tag}${attrs}>${escapeText(newText)}</${tag}>`;
  });
  if (matches !== 1) return { ok: false, error: "element-not-found" };
  return { ok: true, html: out };
}
export { applyTextEdit as a, parseComposition as p };
