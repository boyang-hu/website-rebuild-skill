#!/usr/bin/env node
/**
 * sweep-routes.mjs — the RENDERED BREADTH gate: every route, ONE browser.
 *
 * Born from four projects' worth of the same hand-rolled shell loop
 * (`for route; do node probe.mjs ...; done`), which pays a full Chrome launch
 * per route — a 122-route site cost ~40 minutes and, run concurrently with
 * other probes, triggered the same-workspace orphan reaper against a LIVE
 * sibling's browser (measured: a walk's Chrome reaped mid-run by a sweep's
 * probe). verification-gates.md's own cost lesson says whole-site comparison
 * is priced in BROWSER LAUNCHES, not page loads — this gate launches one.
 *
 * Per route it records what probe.mjs records at the page level — page errors
 * (Runtime + Log + crash/renavigation lifecycle), request failures, external
 * requests — then optionally runs an INTERACTION hook (enter-with-sound
 * clicks, cookie dismissals: the states a load alone never reaches) and an
 * --eval expression whose result lands in the report.
 *
 * Division of labour: this is the BREADTH gate (every route, one state each,
 * cheap). probe.mjs remains the DEPTH tool (one route: scroll walk,
 * screenshots, long observation). Neither replaces the other.
 *
 * ⛔ EMBED hosts are the one legitimate external: content players
 * (YouTube/Vimeo) registered in mirror/external.txt still fire at runtime.
 * --allow-external names them; they are counted and reported but do not fail
 * the route. Every OTHER external request fails it — same contract as
 * probe --no-external.
 *
 *   node scripts/sweep-routes.mjs --base http://127.0.0.1:6571 --pages docs/pages.json
 *        [--wait 6000] [--interact "<js, runs after wait>"] [--interact-wait 4000]
 *        [--eval "<js, result recorded per route>"]
 *        [--allow-external vimeo.com,i.vimeocdn.com]
 *        [--out docs/sweep.tsv] [--cdp-port N] [--width 1280] [--height 800]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { resolvePort, chromeSentinel, assertOwnBrowser } from "./lib/ports.mjs";
import { launchChrome, preflightChrome } from "./lib/chrome.mjs";

// Chrome discovery: first existing candidate wins; override with CHROME_PATH.
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
async function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    try { await access(c); return c; } catch {}
  }
  console.error("FATAL: Chrome not found. Set CHROME_PATH.");
  process.exit(3);
}

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const KNOWN = new Set(["base", "routes", "pages", "wait", "interact", "interact-wait", "eval", "allow-external", "allow-errors", "allow-failures", "out", "cdp-port", "width", "height"]);
for (const a of args) if (a.startsWith("--") && !KNOWN.has(a.slice(2))) {
  console.error(`FATAL — unknown flag ${a}. Known: ${[...KNOWN].map((f) => "--" + f).join(" ")}`);
  process.exit(2);
}

const BASE = (flag("base", "") || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: sweep-routes.mjs --base <url> (--routes /,/a | --pages docs/pages.json) [...]"); process.exit(2); }
const WAIT = Number(flag("wait", "6000"));
const INTERACT = flag("interact", null);
const INTERACT_WAIT = Number(flag("interact-wait", "4000"));
const EVAL = flag("eval", null);
const ALLOW_EXTERNAL = new Set((flag("allow-external", "") || "").split(",").map((s) => s.trim()).filter(Boolean));
// --allow-errors <regex>: a REGISTERED page-error pattern (deviation/quirk
// table entry) counted and reported but not fatal. Exists for judgment calls a
// dead-site rescue cannot settle against a live origin (e.g. Vue Router's
// NavigationDuplicated on locale routes) — same contract as --allow-external:
// what is registered stays visible, what is not stays red.
const ALLOW_ERRORS = flag("allow-errors", null) ? new RegExp(flag("allow-errors", null)) : null;
// --allow-failures <regex>: same contract, for NETWORK failures. Exists for
// REGISTERED holes whose 404 is itself faithful — a dead avatar the live
// origin also 404s (external.txt row), a favicon the origin never had. The
// row stays visible in the report; only the verdict stops bleeding for what
// is registered. What is not registered stays red.
const ALLOW_FAILURES = flag("allow-failures", null) ? new RegExp(flag("allow-failures", null)) : null;
const OUT = flag("out", null);
const W = Number(flag("width", "1280")), H = Number(flag("height", "800"));

let routes = [];
if (flag("routes", null)) routes = flag("routes", "").split(",").filter(Boolean);
else {
  const pagesFile = flag("pages", "docs/pages.json");
  const pages = JSON.parse(readFileSync(path.resolve(pagesFile), "utf8"));
  routes = pages.map((rel) => "/" + String(rel).replace(/\/?index\.html$/, ""));
}
if (!routes.length) { console.error("FATAL — no routes to sweep; an empty sweep is not a pass."); process.exit(2); }

const SELF_ORIGIN = new URL(BASE).origin;
const { port, label: PORT_LABEL } = resolvePort({
  lane: "sweep.cdp",
  side: "unset",
  cli: flag("cdp-port", null),
  env: process.env.CDP_PORT || null,
  envName: "CDP_PORT",
});
console.log(`=== sweep-routes  ${routes.length} route(s) on ${BASE} ===`);
console.log(`[sweep] cdp port ${PORT_LABEL}; one browser for the whole sweep`);

await preflightChrome({ role: "sweep", port, tool: "sweep-routes.mjs" });
const CHROME = await findChrome();
const sentinel = chromeSentinel();
const chrome = launchChrome({
  bin: CHROME,
  role: "sweep",
  port,
  tool: "sweep-routes.mjs",
  args: [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--disable-gpu-sandbox",
    "--hide-scrollbars",
    "--mute-audio",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    `--window-size=${W},${H}`,
    sentinel.url,
  ],
});
const cleanup = (code) => {
  chrome.reap();
  const done = () => process.exit(code);
  if (process.stdout.write("")) done();
  else process.stdout.once("drain", done);
};

const target = await assertOwnBrowser({ port, sentinel, tool: "sweep-routes.mjs", pid: chrome.pid });
const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
let socketClose = null;
ws.onclose = (ev) => {
  socketClose = ev?.code ?? 1006;
  const err = new Error(`CDP socket closed (${socketClose}) with ${pending.size} call(s) in flight`);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
};
const send = (method, params = {}, timeoutMs = 60000) =>
  new Promise((resolve, reject) => {
    if (socketClose !== null) { reject(new Error(`CDP socket already closed (${socketClose}); cannot send ${method}`)); return; }
    const id = ++msgId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`)); }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

// Per-route collectors, reset before each navigation. Events between routes
// (trailing beacons from the previous document) land on whichever route is
// current — a sweep is a breadth census, and the probe is the tool that owns
// one route's timeline precisely.
let pageErrors = [], failures = [], allowedFailures = [], lifecycle = [], navigations = 0;
const requests = new Map();
const external = new Map(); // host -> count (disallowed)
const allowedExternal = new Map(); // host -> count (registered EMBED etc.)
let loadFired = null;

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    return;
  }
  switch (m.method) {
    case "Runtime.exceptionThrown":
      pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      break;
    case "Log.entryAdded": {
      const e = m.params.entry;
      // e.url names the failing resource; without it a network-echoed console
      // error ("Failed to load resource: ... 404") is unmatchable by any
      // registered --allow-errors pattern — the URL is the registration key.
      if (e.level === "error") pageErrors.push(`[${e.source}] ${e.text}${e.url ? ` <${e.url}>` : ""}`.slice(0, 300));
      break;
    }
    case "Network.requestWillBeSent": {
      const u = m.params.request.url;
      requests.set(m.params.requestId, u);
      if (/^https?:/.test(u) && new URL(u).origin !== SELF_ORIGIN) {
        const h = new URL(u).host;
        if (ALLOW_EXTERNAL.has(h)) allowedExternal.set(h, (allowedExternal.get(h) || 0) + 1);
        else external.set(h, (external.get(h) || 0) + 1);
      }
      break;
    }
    case "Network.responseReceived": {
      const s = m.params.response.status;
      // A 4xx from an ALLOWED external host is that host's off-origin
      // behavior, not the port's defect — a domain-locked Vimeo embed answers
      // 401 anywhere but the origin (measured, registered as a deviation).
      // Reported, never fatal; the same status from OUR origin stays fatal.
      if (s >= 400) {
        const h = (() => { try { return new URL(m.params.response.url).host; } catch { return ""; } })();
        (ALLOW_EXTERNAL.has(h) ? allowedFailures : failures).push(`HTTP ${s} ${m.params.response.url}`);
      }
      break;
    }
    case "Network.loadingFailed": {
      const u = requests.get(m.params.requestId) || "?";
      if (!m.params.canceled) {
        const h = (() => { try { return new URL(u).host; } catch { return ""; } })();
        (ALLOW_EXTERNAL.has(h) ? allowedFailures : failures).push(`FAILED ${m.params.errorText} ${u}`);
      }
      break;
    }
    case "Inspector.targetCrashed":
      lifecycle.push("TARGET CRASHED");
      break;
    case "Page.frameNavigated":
      if (m.params.frame && !m.params.frame.parentId) {
        navigations += 1;
        // First navigation per route is our own Page.navigate; more is the page
        // reloading itself (chunk-error reload loops arrive exactly here).
        if (navigations > 1) lifecycle.push(`RENAVIGATED (#${navigations}) -> ${(m.params.frame.url || "").slice(0, 90)}`);
      }
      break;
    case "Page.loadEventFired":
      if (loadFired) loadFired();
      break;
  }
};

await new Promise((r) => (ws.onopen = r));
await send("Network.enable");
await send("Inspector.enable");
await send("Log.enable");
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let failCount = 0;
const t0 = Date.now();

for (const route of routes) {
  pageErrors = []; failures = []; allowedFailures = []; lifecycle = []; navigations = 0;
  requests.clear(); external.clear(); allowedExternal.clear();

  const loaded = new Promise((r) => { loadFired = r; });
  await send("Page.navigate", { url: BASE + route });
  await Promise.race([loaded, sleep(30000)]);
  await sleep(WAIT);

  let interacted = "";
  if (INTERACT) {
    const r = await send("Runtime.evaluate", { expression: INTERACT, awaitPromise: true, returnByValue: true }).catch((e) => ({ result: { value: `INTERACT ERROR: ${e.message}` } }));
    interacted = String(r?.result?.value ?? "");
    await sleep(INTERACT_WAIT);
  }
  let evalResult = "";
  if (EVAL) {
    const r = await send("Runtime.evaluate", { expression: EVAL, awaitPromise: true, returnByValue: true }).catch((e) => ({ result: { value: `EVAL ERROR: ${e.message}` } }));
    evalResult = String(r?.result?.value ?? "");
  }

  let allowedErrors = 0;
  if (ALLOW_ERRORS) {
    const keep = pageErrors.filter((e) => !ALLOW_ERRORS.test(e));
    allowedErrors = pageErrors.length - keep.length;
    pageErrors = keep;
  }
  let allowedFailRows = 0;
  if (ALLOW_FAILURES) {
    const keep = failures.filter((f) => !ALLOW_FAILURES.test(f));
    allowedFailRows = failures.length - keep.length;
    failures = keep;
  }
  const extStr = [...external].map(([h, n]) => `${h}(x${n})`).join(",");
  const allowedStr = [...allowedExternal].map(([h, n]) => `${h}(x${n})`).join(",");
  const bad = pageErrors.length + failures.length + external.size + lifecycle.length;
  const row = {
    route,
    errors: pageErrors.length,
    failures: failures.length,
    external: extStr,
    allowedExternal: allowedStr,
    allowedFailures: allowedFailures.length,
    lifecycle: lifecycle.join("; "),
    eval: evalResult,
    verdict: bad ? "FAIL" : "ok",
  };
  rows.push(row);
  if (bad) {
    failCount++;
    console.log(`  FAIL ${route}  errors:${row.errors} failures:${row.failures}${extStr ? ` external:${extStr}` : ""}${row.lifecycle ? ` [${row.lifecycle}]` : ""}`);
    for (const e of pageErrors.slice(0, 3)) console.log(`         ${e.slice(0, 140)}`);
    for (const f of failures.slice(0, 5)) console.log(`         ${f.slice(0, 140)}`);
  } else {
    console.log(`  ok   ${route}${allowedStr ? `  (allowed: ${allowedStr}${allowedFailures.length ? `, ${allowedFailures.length} failing off-origin` : ""})` : ""}${allowedErrors ? `  (${allowedErrors} allowed error(s))` : ""}${allowedFailRows ? `  (${allowedFailRows} allowed failure(s))` : ""}${evalResult ? `  ${evalResult.slice(0, 80)}` : ""}`);
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
if (OUT) {
  const tsv = ["ROUTE\tVERDICT\tERRORS\tFAILURES\tEXTERNAL\tALLOWED_EXTERNAL\tALLOWED_FAILURES\tLIFECYCLE\tEVAL",
    ...rows.map((r) => [r.route, r.verdict, r.errors, r.failures, r.external, r.allowedExternal, r.allowedFailures, r.lifecycle, r.eval].join("\t"))].join("\n") + "\n";
  writeFileSync(path.resolve(OUT), tsv);
  console.log(`  -> ${OUT}`);
}
console.log(failCount
  ? `\nFAIL — ${failCount}/${routes.length} route(s) not clean (${secs}s, one browser).`
  : `\nPASS — ${routes.length}/${routes.length} route(s) clean (${secs}s, one browser).`);
cleanup(failCount ? 1 : 0);
