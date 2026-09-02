#!/usr/bin/env node
/**
 * probe.mjs — zero-dependency headless-Chrome probe (raw CDP over Node's
 * built-in WebSocket, Node 22+). Loads a URL, collects console messages, page
 * errors and failed/non-2xx requests, optionally screenshots and evaluates
 * expressions, then exits 0 only if the run was CLEAN — so it slots into CI.
 *
 *   node probe.mjs <url> [--shot out.png] [--wait 6000] [--width 1728]
 *        [--height 1080] [--scroll 0.5] [--eval "expr"]
 *        [--evalAfter "expr"] [--evalAfterDelay 2000] [--mobile]
 *        [--walk 24] [--walk-dwell 700] [--no-external]
 *        [--format png|jpeg] [--quality 92]
 *        [--side mirror|rebuild] [--expect-side mirror|rebuild] [--cdp-port N]
 *
 * BROWSER LIFECYCLE (scripts/lib/chrome.mjs — read its header once):
 *   The browser is spawned as a PROCESS GROUP and the whole group is reaped on
 *   every exit path, because `chrome.kill()` leaves the 6-8 renderer children
 *   running: measured 129 orphaned Chrome processes, oldest 2 days old. On a
 *   toolchain whose pixel tolerance is derived from the reference side compared
 *   with itself, that background load WIDENS the tolerance — a leak here makes
 *   the pixel gate quietly forgive real differences.
 *
 * SCREENSHOTS HAVE A HARD CEILING: `Page.captureScreenshot` returns the frame as
 *   one base64 WebSocket message, and Node's built-in WebSocket dies (close
 *   1006) above ~2.4 M chars — roughly a 1500x900 PNG. Past that, PNG simply
 *   cannot arrive. --format jpeg --quality 92 is the escape hatch (measured
 *   827,968 chars / 58 ms at 1728x1080). The failure used to be a silent hang;
 *   it is now a named error with this advice attached.
 *
 * PORTS AND IDENTITY (scripts/lib/ports.mjs — read its header once):
 *   The debug port is allocated per (workspace, script, side) instead of being
 *   randomized, --side is inferred from the target URL when that URL is one of
 *   this toolchain's servers, a taken port is a loud exit, and after launch the
 *   probe attaches ONLY to its own sentinel page. That last check is the real
 *   gate: a probe that attaches to another script's browser reports that
 *   browser's console and that browser's traffic as if they were this URL's —
 *   the field case (§8.30) was exactly a "the rebuild calls the mirror" report
 *   produced by a probe that had landed in the mirror's browser. The outbound
 *   report below also names any loopback port it recognizes, so a stray request
 *   to a sibling gate reads as what it is instead of as a leak.
 *
 * --no-external and --walk exist because the offline gate asks for things this
 * probe could not otherwise assert:
 *   --no-external: the gate says "zero outbound calls", but the probe only
 *     failed on 4xx/loadingFailed. A mirror that quietly still fetches the live
 *     CDN passes that as CLEAN. With the flag, any request off the served
 *     origin counts as a failure (data:/blob: are not requests and never do).
 *   --walk: the gate wants CLEAN "including a full scroll". --scroll jumps to
 *     one offset, which never mounts the scenes in between; --walk steps the
 *     whole page so lazily-mounted scenes actually boot and get observed.
 *
 * Adapted from landonorris-rebuild/scripts/probe.mjs.
 * Lineage: rogierdeboeve-rebuild (CDP probe family, quantified acceptance)
 *   -> samsyninja-rebuild regression.mjs (anti-throttling flags, state walks)
 *   -> landonorris-rebuild (~190 lines; Log-domain listener fix: security/SRI
 *      errors surface on the CDP Log domain, NOT Runtime — a probe without
 *      Log.enable is blind to them and reports a false CLEAN)
 *   -> shopifydesign-rebuild (--no-external assertion for the offline gate,
 *      --walk full-page scroll walk).
 */
import { writeFile } from 'node:fs/promises';
import {
  annotateHost,
  assertOwnBrowser,
  chromeSentinel,
  describePort,
  fatal,
  fetchIdentity,
  resolvePort,
} from './lib/ports.mjs';
import {
  findChrome,
  headlessArgs,
  launchChrome,
  preflightChrome,
  shotCeilingAdvice,
  shotLikelyTooBig,
} from './lib/chrome.mjs';
import { connectCdp } from './lib/cdp.mjs';
import { cli } from './lib/cli.mjs';

// ⛔ AN UNKNOWN FLAG MUST BE FATAL, NOT SILENCE. This tool sat in a toolchain
// whose sibling (netcapture.mjs) takes --settle; passing --settle HERE was
// silently ignored and every "long" observation quietly ran at the 6-second
// default. The cost was a multi-hour ghost hunt: a loader "stuck" at the same
// 6.2s frame every run, a timer that "never fired" (it was 2s away), a
// suspected reload loop, a suspected renderer crash, a suspected patched clock
// — all of it an artifact of one misspelled flag that nothing rejected.
// The check now lives in lib/cli.mjs (one contract for every script); this is
// the set it validates against. Bools take no value; every other flag consumes
// the next argument.
// ⛔ WALK THE ARGV; do not `find` the first token without dashes. With a flag
// ahead of the URL (`--wait 9000 http://…`) that token is the flag's VALUE, and
// the probe died on `new URL('9000')` with a bare TypeError — after the flag
// check, before saying what it was given. A value a known flag consumes is
// never inspected as a flag or as the URL; the first bare token left is the URL
// — cli() does that walk and hands the leftovers back as positionals.
const { positionals } = cli({
  known: ['shot', 'format', 'quality', 'wait', 'scroll', 'walk', 'walk-dwell',
    'eval', 'evalAfter', 'evalAfterDelay', 'side', 'expect-side', 'cdp-port', 'width', 'height'],
  bools: ['no-external', 'mobile'],
  file: import.meta.url,
  positional: '<url>',
});

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes('--' + name);
// The URL is the first bare token cli() left over once every known flag had
// taken its value (see the walk note at the top).
const url = positionals[0] ?? null;
if (!url) {
  console.error('usage: probe.mjs <url> [--shot out.png] [--format png|jpeg] [--quality 92] [--wait ms] [--scroll frac] [--walk steps] [--walk-dwell ms] [--no-external] [--eval expr] [--evalAfter expr] [--mobile] [--side mirror|rebuild] [--cdp-port N]');
  process.exit(2);
}
const WAIT = Number(flag('wait', 6000));
const W = Number(flag('width', has('mobile') ? 390 : 1728));
const H = Number(flag('height', has('mobile') ? 844 : 1080));
const SHOT = flag('shot', null);
// Format defaults to PNG (byte-faithful), but follows the output extension when
// one is given, so `--shot x.jpg` does not silently write PNG bytes into a .jpg.
const SHOT_FORMAT = String(
  flag('format', SHOT && /\.jpe?g$/i.test(SHOT) ? 'jpeg' : 'png'),
).toLowerCase();
const SHOT_QUALITY = Number(flag('quality', 92));
if (!['png', 'jpeg', 'webp'].includes(SHOT_FORMAT)) {
  console.error(`FATAL: --format must be png, jpeg or webp (got ${SHOT_FORMAT})`);
  process.exit(2);
}

// Which side this probe is looking at. It only selects the debug port, but that
// is what lets a mirror probe and a rebuild probe run at the same time — the
// case that produced the crossed-wires field report. Inferred from the target
// URL when it is a registry port (serve.mjs names its side in the port), so the
// common invocations need no new flag; --side overrides, unset is fine and just
// means "this run gets the side-less port".
const SIDE = flag('side', null) ?? describePort(new URL(url).port)?.side ?? 'unset';
const { port, label: PORT_LABEL, explicit: PORT_EXPLICIT } = resolvePort({
  lane: 'probe.cdp',
  side: SIDE,
  cli: flag('cdp-port', null),
  env: process.env.CDP_PORT || null,
  envName: 'CDP_PORT',
});
console.log(`[probe] target ${url} (side ${SIDE.toUpperCase()})`);
console.log(`[probe] cdp port ${PORT_LABEL}`);

// Optional: assert the server on the other end is the side we think it is.
// Cheap, and it catches the copy-pasted command that probes the mirror twice.
const EXPECT_SIDE = flag('expect-side', null);
if (EXPECT_SIDE) {
  const id = await fetchIdentity(url);
  if (!id) fatal(`FATAL: --expect-side ${EXPECT_SIDE} but ${url} is not a serve.mjs instance (no identity to check)`);
  if (id.side !== EXPECT_SIDE) {
    fatal([
      `FATAL: --expect-side ${EXPECT_SIDE}, but ${url} answers as side ${String(id.side).toUpperCase()}`,
      `       (${id.tool}, root ${id.root}, pid ${id.pid}, token ${id.token}).`,
    ]);
  }
  console.log(`[probe] server identity confirmed: side ${String(id.side).toUpperCase()} token ${id.token}`);
}

// Reap this role's orphans from a previous run BEFORE claiming the port (one of
// them may be what is holding it), then refuse to move if it is still taken.
await preflightChrome({
  role: 'probe',
  port,
  tool: 'probe.mjs',
  note: PORT_EXPLICIT ? 'this port came from --cdp-port/CDP_PORT' : null,
});

// Chrome discovery (candidate list, CHROME_PATH override) lives in lib/chrome.mjs;
// a miss is fatal here.
const CHROME = await findChrome().catch(() => {
  console.error('FATAL: Chrome not found. Set CHROME_PATH.');
  process.exit(3);
});
// One-shot landing page: the attach step below refuses anything else, so this
// probe cannot end up driving a browser some other script started.
const sentinel = chromeSentinel();
// launchChrome owns --user-data-dir (a temp profile it deletes) and the reaping:
// detached process group + teardown on exit/SIGINT/SIGTERM/SIGHUP/uncaught.
const chrome = launchChrome({
  bin: CHROME,
  role: 'probe',
  port,
  tool: 'probe.mjs',
  // headlessArgs carries the anti-throttling set (oryzo/samsy/noomo all hit this
  // independently: background rAF throttling masquerades as a dead site and
  // corrupts every measurement) plus the sentinel URL; the two below are ours.
  args: [
    ...headlessArgs({ port, width: W, height: H, sentinelUrl: sentinel.url }),
    '--disable-gpu-sandbox',
    '--hide-scrollbars',
  ],
});
// ⛔ process.exit() truncates whatever stdout has not drained. Piped to another
// process, stdout is async, so a single console.log larger than the 64 KiB pipe
// buffer is CUT AT EXACTLY 65,536 BYTES — and what the caller receives is a
// well-formed prefix, not an error. Measured: a 70,000-character --eval result
// arrived as 65,536, and the JSON parse failure was the only symptom.
//
// Wait for the write to drain, then exit. ⚠ Do not "fix" this by setting only
// process.exitCode: the browser's socket keeps the loop alive, so the process
// would hang instead.
const cleanup = (code) => {
  chrome.reap();
  const done = () => process.exit(code);
  // write("") resolves once everything queued before it has flushed.
  if (process.stdout.write("")) done();
  else process.stdout.once("drain", done);
};

// Attach ONLY to our own sentinel page. The old code took the first target of
// type "page", which on a busy endpoint is whatever page happens to be first —
// another script's page, or even chrome://newtab.
const target = await assertOwnBrowser({ port, sentinel, tool: 'probe.mjs', pid: chrome.pid });

// A dead socket must fail LOUDLY (an oversized screenshot closes it with 1006,
// see the header) and every call is bounded — both guards live in lib/cdp.mjs.
const cdp = await connectCdp(target.webSocketDebuggerUrl, {
  defaultTimeoutMs: 60000,
  closeHint: "if this happened on a screenshot, the frame exceeded Node's WebSocket payload ceiling",
});

const consoleMsgs = [];
const pageErrors = [];
const failures = [];
const requests = new Map();
const external = new Map(); // host -> count
const SELF_ORIGIN = new URL(url).origin;
const NO_EXTERNAL = has('no-external');

cdp.on('*', (m) => {
  switch (m.method) {
    case 'Runtime.consoleAPICalled': {
      const text = m.params.args
        .map((a) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties ?? a.type))
        .join(' ');
      consoleMsgs.push(`[${m.params.type}] ${text}`);
      break;
    }
    case 'Runtime.exceptionThrown':
      pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      break;
    case 'Network.requestWillBeSent': {
      const u = m.params.request.url;
      requests.set(m.params.requestId, u);
      // Anything leaving the served origin breaks the offline gate: the page is
      // still reaching for the live site. Counted here, fatal under --no-external.
      if (/^https?:/.test(u) && new URL(u).origin !== SELF_ORIGIN) {
        const h = new URL(u).host;
        external.set(h, (external.get(h) || 0) + 1);
      }
      break;
    }
    case 'Network.responseReceived': {
      const s = m.params.response.status;
      if (s >= 400) failures.push(`HTTP ${s} ${m.params.response.url}`);
      break;
    }
    case 'Network.loadingFailed': {
      const u = requests.get(m.params.requestId) || '?';
      if (!m.params.canceled) failures.push(`FAILED ${m.params.errorText} ${u}`);
      break;
    }
    // Landonorris lesson: security errors (e.g. SRI hash mismatches) arrive
    // here, not on the Runtime domain. Without this case the probe green-lights
    // pages whose scripts were silently blocked.
    // ⛔ A CRASHED-AND-AUTORELOADED RENDERER IS INVISIBLE without these. The
    // page dies (OOM under SwiftShader is the usual killer), Chrome reloads it,
    // timers and clocks silently belong to a new document — and the report
    // reads "0 errors, 0 failures" over a page that never survived long enough
    // to finish anything. Measured on hubtown: performance.now() said 6s after
    // a 180s settle, and nothing in the report explained why.
    case 'Inspector.targetCrashed': {
      lifecycle.push('TARGET CRASHED');
      break;
    }
    case 'Page.frameNavigated': {
      if (m.params.frame && !m.params.frame.parentId) {
        navigations += 1;
        if (navigations > 1) lifecycle.push(`RENAVIGATED (#${navigations}) -> ${(m.params.frame.url || '').slice(0, 90)}`);
      }
      break;
    }
    case 'Log.entryAdded': {
      const e = m.params.entry;
      if (e.level === 'error') pageErrors.push(`[${e.source}] ${e.text}`.slice(0, 300));
      break;
    }
  }
});

let navigations = 0;
const lifecycle = [];
await cdp.send('Network.enable');
await cdp.send('Inspector.enable');
await cdp.send('Log.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: 1,
  mobile: has('mobile'),
});
if (has('mobile'))
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });

const loaded = new Promise((r) => {
  cdp.on('Page.loadEventFired', () => r());
});
await cdp.send('Page.navigate', { url });
await Promise.race([loaded, new Promise((r) => setTimeout(r, 20000))]);
await new Promise((r) => setTimeout(r, WAIT));

const scroll = Number(flag('scroll', 0));
if (scroll > 0) {
  await cdp.send('Runtime.evaluate', {
    expression: `window.scrollTo({top: (document.documentElement.scrollHeight - innerHeight) * ${scroll}, behavior: 'instant'})`,
  });
  await new Promise((r) => setTimeout(r, 1500));
}

// Full scroll walk: step the page top-to-bottom so every lazily-mounted scene
// boots inside the observation window, then return to the top. Each step also
// dispatches a wheel event, for decks that advance on wheel rather than scroll.
const walk = Number(flag('walk', 0));
if (walk > 0) {
  const dwell = Number(flag('walk-dwell', 700));
  for (let i = 0; i <= walk; i += 1) {
    await cdp.send('Runtime.evaluate', {
      expression: `(() => { const max = document.documentElement.scrollHeight - innerHeight;
        window.scrollTo({ top: max * ${i} / ${walk}, behavior: 'instant' });
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true })); })()`,
    });
    await new Promise((r) => setTimeout(r, dwell));
  }
  await cdp.send('Runtime.evaluate', { expression: `window.scrollTo({ top: 0, behavior: 'instant' })` });
  await new Promise((r) => setTimeout(r, 1200));
}

const evalExpr = flag('eval', null);
if (evalExpr) {
  // ⛔ awaitPromise, or an async expression silently returns `{}`. JSON.stringify
  // of a pending Promise is an empty object, so the caller gets a well-formed
  // answer that contains nothing — and anything driving the page has to await a
  // frame, which means anything interesting here is async.
  const r = await cdp.send('Runtime.evaluate', { expression: evalExpr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    console.log('EVAL-THREW:', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  console.log('EVAL:', JSON.stringify(r.result?.value ?? r.result?.description, null, 1));
}

// second eval after a delay — for asserting on async outcomes (e.g. SPA nav)
const evalAfter = flag('evalAfter', null);
if (evalAfter) {
  await new Promise((r) => setTimeout(r, Number(flag('evalAfterDelay', 2000))));
  const r = await cdp.send('Runtime.evaluate', { expression: evalAfter, returnByValue: true, awaitPromise: true });
  console.log('EVAL-AFTER:', JSON.stringify(r.result?.value ?? r.result?.description, null, 1));
}

if (SHOT) {
  // The measured ceiling is a property of the transport, not of the page, so it
  // is knowable before the call — say so up front, then say it again with the
  // real numbers if the call actually dies.
  if (shotLikelyTooBig({ w: W, h: H, format: SHOT_FORMAT })) {
    for (const l of shotCeilingAdvice({ w: W, h: H, format: SHOT_FORMAT })) console.error(`[probe] ${l}`);
  }
  let data;
  try {
    ({ data } = await cdp.send('Page.captureScreenshot', {
      format: SHOT_FORMAT,
      ...(SHOT_FORMAT === 'png' ? {} : { quality: SHOT_QUALITY }),
    }, 120000));
  } catch (e) {
    console.error(`[probe] FATAL: screenshot failed: ${e.message}`);
    for (const l of shotCeilingAdvice({
      w: W, h: H,
      format: SHOT_FORMAT,
      quality: SHOT_FORMAT === 'png' ? null : SHOT_QUALITY,
      closeCode: cdp.closed,
    })) console.error(`[probe] ${l}`);
    cleanup(4);
  }
  await writeFile(SHOT, Buffer.from(data, 'base64'));
  console.log(`screenshot -> ${SHOT} (${W}x${H} ${SHOT_FORMAT}${SHOT_FORMAT === 'png' ? '' : ' q' + SHOT_QUALITY}, ${data.length.toLocaleString()} base64 chars)`);
}

console.log(`\n=== console (${consoleMsgs.length}) ===`);
for (const c of consoleMsgs.slice(0, 40)) console.log(c);
if (lifecycle.length) {
  console.log(`=== lifecycle (${lifecycle.length}) ===`);
  for (const l of lifecycle) console.log(l);
}
console.log(`=== page errors (${pageErrors.length}) ===`);
for (const e of pageErrors.slice(0, 20)) console.log(e);
console.log(`=== request failures (${failures.length}) ===`);
for (const f of failures.slice(0, 40)) console.log(f);
const extCount = [...external.values()].reduce((a, b) => a + b, 0);
console.log(`=== external requests (${extCount}${NO_EXTERNAL ? ', FATAL' : ''}) ===`);
// annotateHost names a loopback port that belongs to this toolchain, so a hit
// on a sibling gate reads as "that is the mirror's server" instead of as an
// anonymous outbound call to an unknown host (the §8.30 false red).
for (const [h, n] of [...external].sort((a, b) => b[1] - a[1])) console.log(`${n}x ${h}${annotateHost(h)}`);

const errCount =
  pageErrors.length +
  failures.length +
  (NO_EXTERNAL ? extCount : 0) +
  consoleMsgs.filter((c) => c.startsWith('[error]')).length;
console.log(`\nRESULT: ${errCount === 0 ? 'CLEAN' : errCount + ' problems'}`);
cleanup(errCount === 0 ? 0 : 1);
