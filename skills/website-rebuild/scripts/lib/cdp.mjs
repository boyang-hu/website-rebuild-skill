/**
 * lib/cdp.mjs — the one Chrome DevTools Protocol client (raw WebSocket, Node 22+).
 *
 *   import { connectCdp, cdpUrlFor } from "./lib/cdp.mjs";
 *   const cdp = await connectCdp(target.webSocketDebuggerUrl, { defaultTimeoutMs: 60000 });
 *   cdp.on("Runtime.consoleAPICalled", (params) => …);   // one method
 *   cdp.on("*", (msg) => { switch (msg.method) { … } });   // every event, raw
 *   await cdp.send("Page.navigate", { url });
 *   await cdp.send("Runtime.evaluate", { expression }, { timeoutMs: 5000, sessionId });
 *   const v = await cdp.evaluate("document.title");       // returnByValue, throws on exception
 *   cdp.close();
 *
 * Four scripts (probe, pixelcompare, netcapture, sweep-routes) each carried a
 * private copy of this — same pending map, same timeout, same loud-close hook —
 * and a fifth mini-client lived in lib/ports.mjs. Two of the copies had the
 * onclose handler, two did not; the ones without it hung silently when an
 * oversized screenshot killed the socket (close 1006). One client, both guards:
 *
 *   ⛔ EVERY CALL IS BOUNDED. A route whose scene never finishes booting leaves
 *      Page.navigate / Runtime.evaluate pending forever; an unbounded await
 *      wedges the whole run on one page.
 *   ⛔ A DEAD SOCKET FAILS LOUDLY. On close, every in-flight call rejects with
 *      the close code and a hint; a later send() rejects immediately instead
 *      of queueing into the void. lib/chrome.mjs `shotCeilingAdvice` explains
 *      the screenshot case.
 */

/** Poll `/json/version` on a debug port until the browser answers (or give up). */
export async function cdpUrlFor(port, { attempts = 80, intervalMs = 250 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
      const { webSocketDebuggerUrl } = await res.json();
      if (webSocketDebuggerUrl) return webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`could not reach CDP on port ${port}`);
}

export async function connectCdp(wsUrl, { defaultTimeoutMs = 60000, closeHint = "" } = {}) { // closeHint: "" = default screenshot hint, null = none, string = yours
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`CDP websocket failed to open: ${wsUrl}`)); });
  let msgId = 0;
  let socketClose = null;
  const pending = new Map();
  const listeners = new Map(); // method | "*" -> Set<fn>

  ws.onclose = (ev) => {
    socketClose = ev?.code ?? 1006;
    const err = new Error(
      `CDP socket closed (${socketClose}) with ${pending.size} call(s) in flight` +
        (closeHint === null ? "" : closeHint ? ` — ${closeHint}` : " — on a screenshot this means the frame exceeded Node's WebSocket payload ceiling"),
    );
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      return;
    }
    if (!m.method) return;
    for (const fn of listeners.get(m.method) || []) fn(m.params, m);
    for (const fn of listeners.get("*") || []) fn(m);
  };

  /** send(method, params?, { timeoutMs?, sessionId? } | timeoutMs) */
  const send = (method, params = {}, opts = {}) =>
    new Promise((resolve, reject) => {
      const { timeoutMs = defaultTimeoutMs, sessionId } = typeof opts === "number" ? { timeoutMs: opts } : opts;
      if (socketClose !== null) {
        reject(new Error(`CDP socket already closed (${socketClose}); cannot send ${method}`));
        return;
      }
      const id = ++msgId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });

  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, new Set()); listeners.get(method).add(fn); return () => listeners.get(method)?.delete(fn); };
  const off = (method, fn) => void listeners.get(method)?.delete(fn);

  /** Runtime.evaluate with returnByValue + awaitPromise; throws the page's exception text. */
  const evaluate = async (expression, opts = {}) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, opts);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "eval failed");
    return res.result?.value;
  };

  return {
    ws, send, on, off, evaluate,
    get closed() { return socketClose; },
    get inFlight() { return pending.size; },
    close() { try { ws.close(); } catch {} },
  };
}
