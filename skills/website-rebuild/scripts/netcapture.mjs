#!/usr/bin/env node
// netcapture.mjs — second mirror pass: drive the live site in a real headless
// Chrome, record every request it actually makes to the recorded hosts, then
// diff that against what the static crawler (mirror-site.mjs) pulled to disk.
//
// A regex crawl cannot see assets whose URLs are computed at runtime — scene
// textures built from an id, locale-suffixed sprites, media a component only
// requests once it mounts. This pass is how those get found.
//
// Zero npm dependencies: raw CDP over Node's built-in WebSocket (needs Node 22+).
//
// PORTS AND IDENTITY (scripts/lib/ports.mjs — read its header once): the debug
// port is allocated per (workspace, script) on the "live" side instead of a
// fixed 9333, a taken port is a loud exit, and the browser must be the one this
// script launched (sentinel page). Identity matters most here: this capture is
// the evidence base for the whole mirror, and a session that recorded another
// script's browser would produce a HAVE/GAP ledger for another program.
//
// BROWSER LIFECYCLE (scripts/lib/chrome.mjs — read its header once): Chrome is
// spawned as a detached PROCESS GROUP and the group is reaped on every exit
// path. `chrome.kill()` alone leaves the 6-8 renderer/GPU/network children
// running (measured: 129 orphans, oldest 2 days), and this pass is the one that
// runs longest and gets Ctrl-C'd most. Leaked renderers are not just untidy:
// downstream, the pixel gate derives its tolerance from the reference side
// compared with itself, so background load WIDENS that band and makes the gate
// forgive real differences.
//
// Usage:
//   node netcapture.mjs --origin https://example.com [--mirror mirror]
//     [--routes /,/about,/contact]      routes to visit (default "/")
//     [--viewports desktop,mobile]      which emulated viewports to run
//     [--steps 12] [--dwell 1500]       scroll-walk: wheel steps and per-step dwell (ms)
//     [--settle 9000]                   post-navigation settle before scrolling (ms)
//     [--hosts cdn.x.com,media.y.net]   extra hosts to record besides the origin
//     [--out <mirror>/netcapture.tsv]   HAVE/GAP ledger destination
//     [--fetch]                         also download anything the mirror is missing
//
// --hosts IS NOT OPTIONAL ON A CDN-BACKED SITE. Records are keyed by absolute
// URL over an allow-list of hosts, whose semantics match mirror-site.mjs's
// ASSET_HOSTS: pass this pass the same host list you passed the crawler. An
// earlier version filtered on startsWith(ORIGIN), so on a site serving its
// assets from a separate CDN host it recorded the HTML and nothing else and
// then reported a triumphant GAP=0 having observed ~2% of the traffic (field
// case: 208 of 246 URLs on cdn.shopify.com). Any host left off the list is
// counted and printed at the end, and running without --hosts while off-list
// traffic dominates prints a loud warning — a GAP=0 under that warning means
// nothing.
//
// The scroll walk dispatches WheelEvents AND window.scrollTo per step: covers
// both wheel-hijacking scene decks (advance one scene per wheel, then lock) and
// normal scroll pages. Dwell long enough for each newly mounted scene to start
// fetching, otherwise deep scenes' assets look like they do not exist.
//
// Adapted from careers-kimi-rebuild/legacy-mirror/_scripts/netcapture.mjs
// (samsyninja had the same real-browser capture idea; storytellingnoomo
// cross-checked with performance.getEntriesByType('resource'))
//   -> shopifydesign-rebuild (--hosts allow-list replacing the same-origin
//      filter, off-host census + under-observation warning, disk diff that
//      knows the assets/<host>/ layout).

import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { assertOwnBrowser, chromeSentinel, resolvePort } from "./lib/ports.mjs";
import { launchChrome, preflightChrome } from "./lib/chrome.mjs";
// Shared, query-aware url -> local path. This pass keys its records by url+search
// but used to resolve disk by pathname alone, so on a query-parameterised image
// CDN every responsive variant after the first reported HAVE against a file that
// is a DIFFERENT image — a false GAP=0 with no symptom. See lib/urlpath.mjs.
import { localRelPath, loadPolicy, describePolicy } from "./lib/urlpath.mjs";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};

const ORIGIN_RAW = flag("origin", null);
if (!ORIGIN_RAW) {
  console.error("usage: netcapture.mjs --origin https://example.com [--mirror mirror] [--routes /,/a] [--viewports desktop,mobile] [--steps 12] [--dwell 1500] [--settle 9000] [--hosts cdn.x.com,media.y.net] [--out file.tsv] [--fetch] [--swiftshader]");
  process.exit(2);
}
const ORIGIN = ORIGIN_RAW.replace(/\/+$/, "");
const ROOT = path.resolve(flag("mirror", "mirror"));
const ROUTES = flag("routes", "/").split(",").filter(Boolean);
const STEPS = Number(flag("steps", 12));
const DWELL = Number(flag("dwell", 1500));
const SETTLE = Number(flag("settle", 9000));
const OUT_TSV = path.resolve(flag("out", path.join(ROOT, "netcapture.tsv")));
const ORIGIN_HOST = new URL(ORIGIN).hostname;
const HOSTS_FLAG = flag("hosts", "").split(",").map((s) => s.trim()).filter(Boolean);
// Same semantics as mirror-site.mjs's ASSET_HOSTS: origin + whatever you name.
const RECORD_HOSTS = new Set([ORIGIN_HOST, ...HOSTS_FLAG]);
// This pass drives the LIVE origin, which is its own side of the ledger.
const { port: CDP_PORT, label: CDP_LABEL } = resolvePort({
  lane: "netcapture.cdp",
  side: "live",
  cli: flag("cdp-port", null),
  env: process.env.CDP_PORT || null,
  envName: "CDP_PORT",
});
// Opt-in software GL — see the flag list below for why it is not the default.
const SWIFTSHADER = args.includes("--swiftshader");
const DO_FETCH = args.includes("--fetch");

// Emulated viewports; select with --viewports (comma list of these keys).
const VIEWPORT_DEFS = {
  desktop: { width: 1440, height: 900, mobile: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 },
};
const VIEWPORTS = Object.fromEntries(
  flag("viewports", "desktop,mobile")
    .split(",")
    .filter((v) => VIEWPORT_DEFS[v])
    .map((v) => [v, VIEWPORT_DEFS[v]]),
);

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
    try {
      await fs.access(c);
      return c;
    } catch {}
  }
  throw new Error("Chrome not found. Set CHROME_PATH.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const { webSocketDebuggerUrl } = await res.json();
      const ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      return ws;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("could not reach CDP");
}

function client(ws) {
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };
  return {
    // Every call is bounded. A route whose scene never finishes booting leaves
    // Page.navigate / Runtime.evaluate pending forever, and an unbounded await
    // wedges the whole capture on one page.
    send(method, params = {}, sessionId, timeoutMs = 30000) {
      id += 1;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      const myId = id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(myId);
          reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
        }, timeoutMs);
        pending.set(myId, {
          resolve: (v) => (clearTimeout(timer), resolve(v)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
      });
    },
    on(fn) {
      listeners.push(fn);
    },
  };
}

// ---------------------------------------------------------------------------

console.log(`[netcapture] cdp port ${CDP_LABEL}`);
// Orphans from a previous run get reported and reaped BEFORE the port check —
// one of them is the most likely occupant of this port.
await preflightChrome({ role: "netcapture", port: CDP_PORT, tool: "netcapture.mjs" });

const chromePath = await findChrome();
const sentinel = chromeSentinel();

// launchChrome owns --user-data-dir (fresh temp profile, deleted on teardown)
// and the reaping: detached process group, torn down on exit / SIGINT / SIGTERM
// / SIGHUP / uncaught exception. Nothing this script starts can outlive it.
const chrome = launchChrome({
  bin: chromePath,
  role: "netcapture",
  port: CDP_PORT,
  tool: "netcapture.mjs",
  stdio: ["ignore", "ignore", "pipe"],
  args: [
    `--remote-debugging-port=${CDP_PORT}`,
    "--headless=new",
    // Software GL is OPT-IN (--swiftshader), not the default. The flag makes
    // the page render headlessly on GPU-less machines, but it is also a
    // capability-detection input: a site that tiers on the GPU name will read
    // "SwiftShader", drop to its low tier, and you are then capturing a
    // different program than the one you are rebuilding (determinism.md §2.9,
    // environment-traps.md "快门速度"). For capture specifically the risk is
    // narrow — a tier usually changes geometry/shader parameters, not which
    // files are fetched — but verify that on your target before relying on it,
    // because if the tier DOES switch asset variants your GAP=0 is measured
    // against the wrong asset set.
    ...(SWIFTSHADER ? ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] : []),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--mute-audio",
    // One-shot landing page whose URL only this browser can be showing; the
    // ownership check below refuses to drive an endpoint that lacks it.
    sentinel.url,
  ],
});

// Ownership before protocol: connect() would happily attach to whatever CDP
// endpoint answers on this port, and every request recorded through a foreign
// browser would be filed as this origin's traffic.
await assertOwnBrowser({ port: CDP_PORT, sentinel, tool: "netcapture.mjs", pid: chrome.pid });

const ws = await connect(CDP_PORT);
const cdp = client(ws);

// requestId -> record, so the response event can complete what the request started
const inflight = new Map();
const requests = new Map(); // absolute url -> {path, status, type, bytes}
const consoleErrors = [];
const offHost = new Map(); // host -> count, for hosts not on the allow-list
// Unparseable request URLs. NOT swallowed silently: the page building a bad URL
// is a real finding about the source program and a candidate quirk-table entry.
const malformed = new Map();

cdp.on((msg) => {
  const p = msg.params || {};
  if (msg.method === "Network.requestWillBeSent" && p.request?.url?.startsWith("http")) {
    // startsWith("http") is NOT a parseability test. The browser faithfully
    // reports a request the PAGE built badly, and one such URL used to take the
    // whole capture down with an uncaught TypeError — losing every route, not
    // just the bad request. A capture tool must survive its subject.
    // Field case: a tag manager built https://senses%20trackingscript.<host>/…
    // — a percent-encoded SPACE inside the hostname, 8x per session.
    let u;
    try {
      u = new URL(p.request.url);
    } catch {
      malformed.set(p.request.url, (malformed.get(p.request.url) || 0) + 1);
      return;
    }
    if (!RECORD_HOSTS.has(u.hostname)) {
      offHost.set(u.hostname, (offHost.get(u.hostname) || 0) + 1);
      return;
    }
    // Key by absolute URL: two hosts can serve the same pathname, and the disk
    // diff needs the host to find the file under assets/<host>/.
    inflight.set(p.requestId, u.origin + u.pathname + u.search);
  } else if (msg.method === "Network.responseReceived") {
    const sitePath = inflight.get(p.requestId);
    if (!sitePath) return;
    requests.set(sitePath, {
      path: sitePath,
      status: p.response.status,
      type: (p.response.headers?.["content-type"] || p.response.mimeType || "").split(";")[0],
      bytes: 0,
    });
  } else if (msg.method === "Network.loadingFinished") {
    const sitePath = inflight.get(p.requestId);
    const rec = sitePath && requests.get(sitePath);
    if (rec) rec.bytes = p.encodedDataLength || 0;
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "?");
  }
});

const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
const send = (m, p, timeoutMs) => cdp.send(m, p, sessionId, timeoutMs);

await send("Network.enable");
await send("Page.enable");
await send("Runtime.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  await send("Emulation.setDeviceMetricsOverride", { ...vp, screenWidth: vp.width, screenHeight: vp.height });
  for (const route of ROUTES) {
    process.stdout.write(`  ${name} ${route} ... `);
    const before = requests.size;
    await send("Page.navigate", { url: ORIGIN + route }).catch((e) => console.log(`[nav] ${e.message}`));
    await sleep(SETTLE);
    await send("Runtime.evaluate", {
      expression: `(async () => {
        const target = document.querySelector('main') || window;
        for (let i = 0; i < ${STEPS}; i++) {
          target.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
          window.scrollTo(0, i * window.innerHeight);
          await new Promise(r => setTimeout(r, ${DWELL}));
        }
        window.scrollTo(0, 0);
      })()`,
      awaitPromise: true,
    }, STEPS * DWELL + 15000).catch((e) => console.log(`[scroll] ${e.message}`));
    await sleep(4000);
    console.log(`+${requests.size - before} new`);
  }
}

await cdp.send("Target.closeTarget", { targetId });
// Reap the whole process group (not just the browser process) and delete the
// temp profile — the disk diff below can take a while and there is no reason to
// hold 8 renderers open through it.
chrome.reap();

// --- Diff against what is on disk ------------------------------------------

// The same mapping the crawler wrote with and the server reads with — one
// module, loaded with the policy this mirror was written under, so the three
// cannot drift (scripts/lib/urlpath.mjs).
const QUERY_POLICY = await loadPolicy(ROOT);
console.log(`[urlpath] ${describePolicy(QUERY_POLICY)}`);
function localPathFor(absUrl) {
  return localRelPath(absUrl, ORIGIN_HOST, QUERY_POLICY);
}

const rows = [...requests.values()].sort((a, b) => a.path.localeCompare(b.path));
const missing = [];
for (const r of rows) {
  if (r.status !== 200) continue;
  const rel = localPathFor(r.path);
  try {
    await fs.access(path.join(ROOT, rel));
  } catch {
    missing.push(r);
  }
}

await fs.mkdir(path.dirname(OUT_TSV), { recursive: true });
await fs.writeFile(
  OUT_TSV,
  // URL, not PATH: records are keyed by absolute URL now that more than one
  // host can be recorded, and two hosts can serve the same pathname.
  ["STATUS", "CODE", "BYTES", "URL", "TYPE"].join("\t") +
    "\n" +
    rows
      .map((r) => [missing.includes(r) ? "GAP" : "HAVE", r.status, r.bytes, r.path, r.type].join("\t"))
      .join("\n") +
    "\n",
);

const offHostTotal = [...offHost.values()].reduce((a, b) => a + b, 0);

console.log(`\nrequests observed: ${rows.length} (hosts: ${[...RECORD_HOSTS].join(", ")})`);
console.log(`already mirrored:  ${rows.filter((r) => r.status === 200).length - missing.length}`);
console.log(`MIRROR GAPS:       ${missing.length}`);
for (const m of missing) console.log(`  ${m.status} ${m.path}`);
if (offHost.size) {
  console.log(`\noff-list hosts seen (NOT recorded, decide each in the external table):`);
  for (const [h, n] of [...offHost].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${h}`);
}
// A GAP=0 that was computed while most of the traffic went unobserved is worse
// than no answer, because it reads as a pass. Say so, loudly, before the caller
// records the number.
if (offHostTotal && (offHostTotal >= rows.length || offHostTotal >= 10) && !HOSTS_FLAG.length) {
  const pct = Math.round((offHostTotal / (offHostTotal + rows.length)) * 100);
  console.log(
    `\n!! UNDER-OBSERVED: ran without --hosts and ignored ${offHostTotal} requests (${pct}% of all\n` +
      `!! traffic) to ${offHost.size} other host(s), listed above. This capture only covered ${ORIGIN_HOST},\n` +
      `!! so the GAP count above is NOT a verdict on the mirror. Re-run with the asset hosts:\n` +
      `!!   --hosts ${[...offHost.keys()].slice(0, 4).join(",")}`,
  );
}
if (consoleErrors.length) console.log(`\npage exceptions: ${consoleErrors.length}`);

if (malformed.size) {
  console.log(`\nmalformed request URL(s) the page issued — ${malformed.size} distinct:`);
  for (const [u, n] of malformed) console.log(`  x${n}  ${JSON.stringify(u).slice(0, 300)}`);
}

const fetched = [];
if (DO_FETCH && missing.length) {
  // ⭐ ONE MIRROR, ONE LEDGER. This used to write bytes and no ledger row, with
  // a note recommending mirror-site.mjs --seeds instead. The note was correct
  // and it did not help: a run of --fetch left files that verify-mirror reports
  // forever as "nobody can name a URL for", and a second ledger that records
  // URLs without the PATHS they were written to cannot be reconciled against
  // disk at all. Measured on eightdesign: 324 files, every one of them fetched
  // deliberately, none of them blessable by any gate.
  //
  // ⛔ A tool that can leave the artefact in a state no gate accepts is a
  // footgun with a comment on it. Appending the row is fifteen lines.
  console.log("\nfetching gaps... (bytes AND ledger rows)");
  for (const m of missing) {
    // m.path is an absolute URL (records are keyed by host + path).
    // ⛔ PER-URL TOLERANCE + PERIODIC LEDGERING. The first version had neither:
    // one thrown fetch (DNS, TLS, reset) aborted the WHOLE loop before
    // appendLedger ever ran, stranding every file already written as
    // off-the-books state — the exact condition appendLedger's own comment
    // promises to prevent, one failure mode over. Measured on rauchg: 725
    // /_next/image variants on disk, zero in the manifest.
    let res;
    try {
      res = await fetch(m.path, {
        headers: { "user-agent": "Mozilla/5.0 local static mirror", accept: "*/*", referer: ORIGIN + "/" },
      });
    } catch (e) {
      console.log(`  FAIL ${e.message} ${m.path}`);
      continue;
    }
    if (!res.ok) {
      console.log(`  FAIL ${res.status} ${m.path}`);
      continue;
    }
    const rel = localPathFor(m.path);
    const out = path.join(ROOT, rel);
    const body = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, body);
    // ⭐ Carry the DECLARED TYPE into the ledger. serve.mjs answers extensionless
    // paths (Nuxt server routes) with the manifest's recorded type; a row
    // without one gets extension-guessed into text/html, and ofetch — which
    // parses by content-type — hands the app a string where it awaited JSON.
    fetched.push({ rel, url: m.path, bytes: body.length, sha: createHash("sha256").update(body).digest("hex"),
      type: (res.headers.get("content-type") || "").split(";")[0] || undefined });
    console.log(`  OK ${m.path}`);
    if (fetched.length % 100 === 0) await appendLedger(fetched.splice(0, fetched.length));
  }
  await appendLedger(fetched);
}

/**
 * Append what --fetch landed to the mirror's ONE ledger, in its format
 * (SHA256 / BYTES / PATH / URL), skipping paths already recorded.
 */
async function appendLedger(rows) {
  if (!rows.length) return;
  // BOTH ledgers. The first version appended inventory.tsv only;
  // mirror-manifest.json is the authority verify-mirror audits, so every
  // --fetch left files the manifest could not name - the same off-the-books
  // state this function was added to prevent, one ledger over. Worse: any later
  // mirror-site run rewrites both ledgers from the manifest, so rows that only
  // ever reached inventory.tsv are silently dropped again.
  const mfPath = path.join(ROOT, "mirror-manifest.json");
  try {
    const mf = JSON.parse(await fs.readFile(mfPath, "utf8"));
    let n = 0;
    for (const r of rows) {
      if (mf.files[r.url]) continue;
      mf.files[r.url] = { path: r.rel, bytes: r.bytes, sha256: r.sha, ...(r.type ? { type: r.type } : {}) };
      n++;
    }
    if (n) await fs.writeFile(mfPath, JSON.stringify(mf, null, 2));
  } catch {}
  const inv = path.join(ROOT, "inventory.tsv");
  let text = await fs.readFile(inv, "utf8").catch(() => "");
  if (!text) text = "SHA256\tBYTES\tPATH\tURL\n";
  const known = new Set(text.trim().split("\n").slice(1).map((l) => l.split("\t")[2]));
  const add = rows.filter((r) => !known.has(r.rel));
  if (!add.length) return void console.log(`  ledger — all ${rows.length} path(s) already recorded`);
  if (!text.endsWith("\n")) text += "\n";
  text += add.map((r) => `${r.sha}\t${r.bytes}\t${r.rel}\t${r.url}`).join("\n") + "\n";
  await fs.writeFile(inv, text);
  console.log(`  ledger — ${add.length} row(s) appended to ${path.relative(process.cwd(), inv)}`);
}
