#!/usr/bin/env node
/**
 * lib/ports.mjs — the port ALLOCATION + INSTANCE-IDENTITY registry shared by
 * every script in this directory that opens a listening socket (a static
 * server) or a headless-Chrome CDP debug port.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS — the crossed-wires failure it prevents
 * ===========================================================================
 * Each script used to pick its own port: `9222 + random*500`, `CDP_PORT || 9333`,
 * `PORT || 5175`, ... The random ranges overlapped and the fixed defaults were
 * global, so two scripts on one machine could land on the SAME port. Field case
 * (shopifydesign-rebuild §8.30): a foreground probe of the REBUILD attached to
 * the browser a background self-comparison had started on the MIRROR, and
 * reported "the rebuild makes 19 outbound requests to the mirror's port".
 *
 * Crossed wires fake BOTH colors, which is why this is a root-level defect for
 * a toolchain whose two headline gates are "zero outbound calls" and "compare
 * the two sides":
 *   FALSE RED   — normal behavior gets reported as an offline-gate violation
 *                 (that is the 19-requests report above), and it lands right
 *                 after you shipped new code, so it reads as the new code's bug.
 *   FALSE GREEN — the worse one. If both processes end up on the same browser
 *                 or the same server, you get a beautiful A/B report in which
 *                 both sides ARE THE SAME SIDE. Nothing in the numbers looks
 *                 wrong, because nothing IS wrong — you measured one side twice.
 *
 * ===========================================================================
 * THE SCHEME
 * ===========================================================================
 *   port = PORT_BASE + slot*1000 + lane*10 + side          (21000 .. 29999)
 *
 *   slot  0..8   one WORKSPACE (git root). Derived from a hash of the workspace
 *                path, so two checkouts on one machine get different ports
 *                without anyone configuring anything. Override: WRS_PORT_SLOT.
 *   lane  0..99  one SCRIPT ROLE (see LANES). Fixed numbers — treat them as an
 *                ABI: changing one renumbers every running project's ports.
 *   side  0..9   which SIDE of the comparison this process serves/drives:
 *                1 = mirror, 2 = rebuild, 3 = live origin, 0 = neither/both.
 *
 * Consequences, all of them deliberate:
 *   * DEFAULTS NEVER OVERLAP. Two different scripts cannot collide by default,
 *     because the lane digits differ; the same script on the two sides cannot
 *     collide, because the side digit differs; two projects cannot collide,
 *     because the slot digit differs.
 *   * THE PORT NAMES ITSELF. 21012 decodes to "slot 0 / probe.cdp / rebuild"
 *     and this module prints exactly that, everywhere a port is mentioned —
 *     including in probe.mjs's outbound-request report, so the field case above
 *     would now have printed "127.0.0.1:21001 = serve.mjs MIRROR" instead of an
 *     anonymous host that looks like a leak.
 *   * ALLOCATION NEVER DRIFTS. If the computed port is taken, scripts EXIT
 *     (code 3) and name the occupant. Silently sliding to the next free port is
 *     precisely the mechanism that manufactures false greens: a slid process is
 *     no longer where its partner expects it, and the partner then talks to
 *     whatever *is* there.
 *   * IDENTITY IS VERIFIED, NOT ASSUMED. Ports are a hint, never a proof:
 *     allocation can always be beaten by something outside this registry. So
 *     every CDP script launches its browser on a one-shot random SENTINEL page
 *     and refuses to attach to anything else (assertOwnBrowser), and serve.mjs
 *     stamps every response with a per-process identity token that A/B scripts
 *     compare to prove the two sides are two processes (assertDistinctSides).
 *
 * Overrides are allowed and stay loud: every script still honors its explicit
 * --port / CDP_PORT / PORT input, an explicit port is announced as EXPLICIT in
 * the log line, and it is preflighted and identity-checked exactly like a
 * computed one.
 *
 * CLI:  node scripts/lib/ports.mjs           # the whole table for this workspace
 *       node scripts/lib/ports.mjs 21012     # decode one port
 *
 * Zero dependencies (Node 22+ builtins only).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { cli } from "./cli.mjs";

export const PORT_BASE = 21000;
export const SLOT_COUNT = 9;
export const SLOT_STRIDE = 1000;
export const LANE_STRIDE = 10;

/**
 * Lane registry. `n` is the wire number — STABLE, never recycle or reorder.
 * 0..9 are this skill's shipped scripts, 10..49 are the per-project gates a
 * rebuild reliably grows (pre-assigned so projects do not invent colliding
 * numbers), 50..99 are free for anything else a project adds.
 */
export const LANES = {
  "serve": { n: 0, tool: "serve.mjs", what: "static server for one side" },
  "probe.cdp": { n: 1, tool: "probe.mjs", what: "headless Chrome debug port" },
  "pixelcompare.cdp": { n: 2, tool: "pixelcompare.mjs", what: "headless Chrome debug port" },
  "netcapture.cdp": { n: 3, tool: "netcapture.mjs", what: "headless Chrome debug port" },
  "verify-routes.server": { n: 4, tool: "verify-routes.mjs", what: "server under test" },
  "verify-ssr.server": { n: 5, tool: "verify-ssr.mjs", what: "SSR server under test" },
  "sweep.cdp": { n: 6, tool: "sweep-routes.mjs", what: "headless Chrome debug port (whole-site sweep)" },
  // Reserved for the per-project CDP gates (scroll/audio/scene-graph/...), so
  // a project that copies one in gets a lane instead of inventing 9600+random.
  "scroll-compare.cdp": { n: 10, tool: "(per-project)", what: "headless Chrome debug port" },
  "audio-compare.cdp": { n: 11, tool: "(per-project)", what: "headless Chrome debug port" },
  "scene-graph.cdp": { n: 12, tool: "(per-project)", what: "headless Chrome debug port" },
  "scene-content.cdp": { n: 13, tool: "(per-project)", what: "headless Chrome debug port" },
  "regression.cdp": { n: 14, tool: "(per-project)", what: "headless Chrome debug port" },
};

/** Which side of the comparison a process belongs to. The last digit of the port. */
export const SIDES = { unset: 0, mirror: 1, rebuild: 2, live: 3 };
const SIDE_NAMES = Object.fromEntries(Object.entries(SIDES).map(([k, v]) => [v, k]));

/** Identity endpoint + headers served by serve.mjs and read by the A/B scripts. */
export const IDENTITY_PATH = "/__wrs/identity";
export const IDENTITY_HEADER = "x-wrs-identity";
export const SIDE_HEADER = "x-wrs-side";

export function fatal(lines, code = 3) {
  for (const l of [].concat(lines)) console.error(l);
  process.exit(code);
}

// --- slot: one workspace ----------------------------------------------------

/** Nearest enclosing git workspace, so the slot does not depend on the cwd. */
function workspaceRoot() {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

let cachedSlot = null;
export function portSlot() {
  if (cachedSlot !== null) return cachedSlot;
  const raw = process.env.WRS_PORT_SLOT;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n >= SLOT_COUNT) {
      fatal(`FATAL: WRS_PORT_SLOT must be an integer 0..${SLOT_COUNT - 1}, got ${JSON.stringify(raw)}`, 2);
    }
    return (cachedSlot = n);
  }
  // Deterministic per workspace: same repo -> same ports every run (so a server
  // started in one terminal is findable from another), different repo -> almost
  // certainly different ports. Collisions are possible and are NOT papered
  // over: they surface as a named conflict, fixable with WRS_PORT_SLOT.
  const h = createHash("sha256").update(workspaceRoot()).digest();
  return (cachedSlot = h.readUInt32BE(0) % SLOT_COUNT);
}

export function slotSource() {
  return process.env.WRS_PORT_SLOT ? "WRS_PORT_SLOT" : workspaceRoot();
}

// --- allocation -------------------------------------------------------------

export function laneNumber(lane) {
  const rec = LANES[lane];
  if (!rec) fatal(`FATAL: unknown port lane ${JSON.stringify(lane)} (known: ${Object.keys(LANES).join(", ")})`, 2);
  return rec.n;
}

export function sideNumber(side) {
  if (side === undefined || side === null) return 0;
  if (typeof side === "number") return side;
  if (!(side in SIDES)) fatal(`FATAL: unknown side ${JSON.stringify(side)} (known: ${Object.keys(SIDES).join(", ")})`, 2);
  return SIDES[side];
}

/** The default port for (this workspace, this lane, this side). */
export function allocPort(lane, side = "unset", slot = portSlot()) {
  return PORT_BASE + slot * SLOT_STRIDE + laneNumber(lane) * LANE_STRIDE + sideNumber(side);
}

/** Reverse the scheme: what is supposed to be on this port? null if off-registry. */
export function describePort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < PORT_BASE || n >= PORT_BASE + SLOT_COUNT * SLOT_STRIDE) return null;
  const off = n - PORT_BASE;
  const slot = Math.floor(off / SLOT_STRIDE);
  const laneN = Math.floor((off % SLOT_STRIDE) / LANE_STRIDE);
  const sideN = off % LANE_STRIDE;
  const lane = Object.entries(LANES).find(([, r]) => r.n === laneN);
  return {
    port: n,
    slot,
    lane: lane ? lane[0] : `lane#${laneN}`,
    tool: lane ? lane[1].tool : "(unregistered lane)",
    side: SIDE_NAMES[sideN] ?? `side#${sideN}`,
    mine: slot === portSlot(),
  };
}

/** One-line human form, used in every log line and every error message. */
export function labelPort(port) {
  const d = describePort(port);
  if (!d) return `${port} (off-registry port)`;
  return `${d.port} = slot ${d.slot}${d.mine ? "" : " (ANOTHER WORKSPACE)"} / ${d.lane} / side ${d.side.toUpperCase()}`;
}

/**
 * Resolve the port a script will use: explicit input wins, registry default
 * otherwise. Returns {port, explicit, label} — never silently picks a free one.
 */
export function resolvePort({ lane, side = "unset", cli = null, env = null, envName = "PORT" }) {
  const raw = cli ?? env ?? null;
  if (raw !== null && raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      fatal(`FATAL: bad port ${JSON.stringify(raw)} (from ${cli !== null ? "--port" : envName})`, 2);
    }
    return { port: n, explicit: true, label: `${labelPort(n)} [EXPLICIT]` };
  }
  const port = allocPort(lane, side);
  return { port, explicit: false, label: labelPort(port) };
}

// --- loud failure on a taken port ------------------------------------------

/** Ask an occupied port what it is, so the error names the conflicting object. */
export async function describeOccupant(port) {
  const get = async (p) => {
    const c = AbortSignal.timeout(1500);
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { signal: c });
    return res;
  };
  try {
    const res = await get("/json/version");
    if (res.ok) {
      const v = await res.json();
      if (v.Browser) return `a headless-Chrome CDP endpoint (${v.Browser}) — another CDP script is using this port`;
    }
  } catch {}
  try {
    const res = await get(IDENTITY_PATH);
    if (res.ok) {
      const id = await res.json();
      return `${id.tool} serving side ${String(id.side).toUpperCase()} from ${id.root} (pid ${id.pid}, token ${id.token})`;
    }
  } catch {}
  try {
    const res = await get("/");
    const marks = [res.headers.get(IDENTITY_HEADER), res.headers.get("server")].filter(Boolean);
    return `an HTTP server (GET / -> ${res.status}${marks.length ? ", " + marks.join(", ") : ""})`;
  } catch {}
  return "a listening socket that did not answer HTTP";
}

/**
 * Preflight: the port must be free. If it is not, EXIT — naming both what was
 * supposed to be there and what actually is. Never fall through to another
 * port: a script that quietly moves is a script its partner can no longer find.
 */
export async function assertPortFree(port, { tool, note = null } = {}) {
  const busy = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (e) => resolve(e.code || String(e)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(null)));
  });
  if (!busy) return;
  const occupant = busy === "EADDRINUSE" ? await describeOccupant(port) : `unavailable (${busy})`;
  fatal([
    `FATAL: ${tool} needs port ${labelPort(port)}, and it is already taken.`,
    `       occupant: ${occupant}`,
    note ? `       ${note}` : null,
    `       NOT falling back to another port — a gate that moves is a gate whose`,
    `       partner talks to whatever is left behind (see lib/ports.mjs header).`,
    `       Fix: stop the occupant, or give this run its own slot:`,
    `         WRS_PORT_SLOT=<0..${SLOT_COUNT - 1}> ${tool} ...`,
  ].filter(Boolean));
}

// --- identity: prove you are talking to your own instance -------------------

/**
 * A one-shot landing page whose URL nobody else can be showing. Passed to
 * Chrome on the command line; assertOwnBrowser then refuses to attach to any
 * target that is not it.
 */
export function chromeSentinel() {
  const token = randomBytes(8).toString("hex");
  return { token, url: `data:text/html,wrs-sentinel-${token}` };
}

/**
 * THE LAST GATE AGAINST CROSSED WIRES. Port allocation is a convention and can
 * always be beaten (a stale browser, a foreign tool, an explicit override);
 * this cannot, because the sentinel URL is random and lives only on the command
 * line of the browser THIS process spawned.
 *
 * Waits for the sentinel target on `port`, returns it, and exits 3 if the
 * endpoint answers with anything else — that "anything else" is somebody
 * else's browser, and everything measured through it would be a measurement of
 * another program.
 *
 * `pid` (optional) is corroborating only: the sentinel already proves ownership,
 * while a launcher that forks instead of exec'ing would make the pid differ for
 * an innocent reason, so a mismatch warns rather than fails.
 */
export async function assertOwnBrowser({ port, sentinel, tool, pid = null, timeoutMs = 15000 }) {
  const deadline = Date.now() + timeoutMs;
  let seen = [];
  for (;;) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) })).json();
      seen = list.map((t) => `${t.type} ${t.url}`);
      const mine = list.find(
        (t) => t.type === "page" && (t.url === sentinel.url || t.url.includes(sentinel.token)),
      );
      if (mine) {
        if (pid) await warnOnForeignPid(port, pid, tool);
        return mine;
      }
      // The endpoint answered but has no sentinel: a browser is there and it is
      // not ours. Do not keep polling — polling would attach the moment a page
      // in that other browser happened to match something.
      if (list.length && Date.now() > deadline - timeoutMs / 2) break;
    } catch {}
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  fatal([
    `FATAL: ${tool} could not find its own browser on ${labelPort(port)}.`,
    `       expected the sentinel page ${sentinel.url}`,
    `       targets actually there:`,
    ...(seen.length ? seen.map((s) => `         ${s}`) : ["         (none — the CDP endpoint never came up)"]),
    `       Attaching to a browser this script did not start is how a run ends up`,
    `       measuring the OTHER side and reporting it as this one.`,
  ]);
}

async function warnOnForeignPid(port, pid, tool) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    const info = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" }));
      ws.onerror = () => (clearTimeout(timer), reject(new Error("ws")));
      ws.onmessage = (e) => (clearTimeout(timer), resolve(JSON.parse(e.data)));
    });
    ws.close();
    const browser = info?.result?.processInfo?.find((p) => p.type === "browser");
    if (browser && browser.id !== pid) {
      console.error(
        `[ports] NOTE: ${tool} spawned pid ${pid} but the browser on ${port} reports pid ${browser.id}. ` +
          `The sentinel matched, so this is ours (a launcher wrapper re-spawned it), not crossed wires.`,
      );
    }
  } catch {}
}

// --- identity: prove the two A/B sides are two instances --------------------

/** Read serve.mjs's identity for a base URL. null when the server is not ours. */
export async function fetchIdentity(baseUrl) {
  try {
    const u = new URL(IDENTITY_PATH, baseUrl);
    const res = await fetch(u, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return await res.json();
  } catch {}
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) });
    const token = res.headers.get(IDENTITY_HEADER);
    if (token) return { token, side: res.headers.get(SIDE_HEADER) ?? "unset", tool: "serve.mjs", root: "?", pid: null };
  } catch {}
  return null;
}

/**
 * The false-green gate for every two-sided comparison: A and B must be two
 * different processes. Same origin, or the same serve.mjs identity token behind
 * two different URLs (a proxy, a symlinked root, a copy-pasted command), means
 * the report about to be written compares one side with itself.
 */
export async function assertDistinctSides(a, b, { tool, labelA = "A", labelB = "B" }) {
  const originOf = (u) => {
    try { return new URL(u).origin; } catch { return fatal(`FATAL: ${tool}: ${u} is not a URL`, 2); }
  };
  if (originOf(a) === originOf(b)) {
    fatal([
      `FATAL: ${tool} was given the same origin for both sides:`,
      `       ${labelA} = ${a}`,
      `       ${labelB} = ${b}`,
      `       A comparison of one side against itself passes every gate it has.`,
    ]);
  }
  const [idA, idB] = await Promise.all([fetchIdentity(a), fetchIdentity(b)]);
  if (idA && idB && idA.token === idB.token) {
    fatal([
      `FATAL: ${tool}: ${labelA} and ${labelB} have different URLs but are THE SAME SERVER`,
      `       (identity token ${idA.token}, ${idA.tool} side ${idA.side}, root ${idA.root}).`,
      `       ${labelA} = ${a}`,
      `       ${labelB} = ${b}`,
      `       Every number this run would print would be one side measured twice.`,
    ]);
  }
  for (const [label, url, id] of [[labelA, a, idA], [labelB, b, idB]]) {
    console.log(
      id
        ? `[ports] ${label} ${url} -> ${id.tool} side ${String(id.side).toUpperCase()} root ${id.root} token ${id.token}`
        : `[ports] ${label} ${url} -> not a serve.mjs instance (identity unverifiable; origins differ, which is the weaker check)`,
    );
  }
  return { idA, idB };
}

/** Annotate a loopback host:port seen in traffic, e.g. in probe's outbound report. */
export function annotateHost(host) {
  const m = /^(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d+)$/.exec(host);
  if (!m) return "";
  const d = describePort(Number(m[1]));
  return d ? `  <- ${d.tool} ${d.lane} side ${d.side.toUpperCase()} (slot ${d.slot})` : "";
}

// --- CLI --------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  // Only the CLI mode validates argv; importers never pay for it.
  cli({ file: import.meta.url, positional: "[port]" });
  const arg = process.argv[2];
  if (arg) {
    const d = describePort(arg);
    console.log(d ? JSON.stringify(d, null, 2) : `${arg} is outside the registry range ${PORT_BASE}..${PORT_BASE + SLOT_COUNT * SLOT_STRIDE - 1}`);
  } else {
    console.log(`workspace: ${slotSource()}`);
    console.log(`slot:      ${portSlot()}${process.env.WRS_PORT_SLOT ? " (from WRS_PORT_SLOT)" : " (hashed from the workspace path)"}\n`);
    const sides = ["mirror", "rebuild", "live", "unset"];
    for (const [lane, rec] of Object.entries(LANES)) {
      const cells = sides.map((s) => `${s}=${allocPort(lane, s)}`).join("  ");
      console.log(`${lane.padEnd(22)} ${rec.tool.padEnd(20)} ${cells}`);
    }
  }
}
