// PORT-NEW docs/23 M5: minimal Chrome DevTools Protocol client (Node >= 22 global WebSocket, no deps).
// Used to drive the ORIGINAL renderer of the running port app with REAL input events
// (Input.dispatchMouseEvent / Input.insertText / Input.dispatchKeyEvent / Input.dispatchDragEvent).
export async function listTargets(port, host = "127.0.0.1") {
  const r = await fetch(`http://${host}:${port}/json/list`);
  return r.json();
}

export async function waitForPageTarget(port, { timeoutMs = 60_000, match = (t) => t.type === "page" && /index\.html/.test(t.url) } = {}) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < timeoutMs) {
    try { const ts = await listTargets(port); const t = ts.find(match); if (t) return t; last = ts; } catch (e) { last = String(e); }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no page target on :${port} (${JSON.stringify(last)?.slice(0, 300)})`);
}

export class Cdp {
  constructor(ws, log) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map(); this.log = log || (() => {}); }
  static async connect(wsUrl, log) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error("ws error " + (e?.message || ""))); });
    return Cdp.fromSocket(ws, log);
  }
  /** wire an already-open WebSocket-like object ({send, close, onmessage, onclose}). */
  static fromSocket(ws, log) {
    const c = new Cdp(ws, log);
    ws.onmessage = (m) => c.#onMessage(JSON.parse(typeof m.data === "string" ? m.data : Buffer.from(m.data).toString()));
    ws.onclose = () => { for (const { rej } of c.pending.values()) rej(new Error("cdp socket closed")); c.pending.clear(); c.closed = true; };
    return c;
  }
  #onMessage(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id);
      if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`)); else p.res(msg.result);
      return;
    }
    for (const fn of this.listeners.get(msg.method) || []) { try { fn(msg.params); } catch {} }
  }
  send(method, params = {}) {
    const id = ++this.id;
    if (!/^(Runtime\.evaluate|Page\.captureScreenshot)$/.test(method)) this.log({ cdp: method, params: summarize(params) });
    return new Promise((res, rej) => { this.pending.set(id, { res, rej, method }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, fn) { const l = this.listeners.get(method) || []; l.push(fn); this.listeners.set(method, l); return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((x) => x !== fn)); }
  /** read-only page evaluation (state inspection / element geometry); never used to trigger app actions. */
  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

function summarize(p) {
  const s = JSON.stringify(p);
  return s.length > 300 ? JSON.parse(JSON.stringify(p, (k, v) => (typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : v))) : p;
}

// ---- real input helpers ------------------------------------------------------------------------
export async function mouseClick(cdp, x, y, { button = "left", clickCount = 1 } = {}) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount });
}
export async function mouseMove(cdp, x, y) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); }
export async function typeText(cdp, text) { await cdp.send("Input.insertText", { text }); }
export async function pressKey(cdp, key, { code = key, keyCode, modifiers = 0, text } = {}) {
  const vk = keyCode ?? { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Space: 32 }[key];
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...((text ?? { Enter: "\r" }[key]) ? { text: text ?? { Enter: "\r" }[key] } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}
/** OS-level drag of real files onto (x,y): dragEnter → dragOver → drop with DragData.files. */
export async function dropFiles(cdp, x, y, files) {
  const data = { items: [], files, dragOperationsMask: 1 | 2 | 16 };
  await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", x, y, data });
  await cdp.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
  await cdp.send("Input.dispatchDragEvent", { type: "drop", x, y, data });
}
export async function screenshot(cdp) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  return Buffer.from(r.data, "base64");
}
