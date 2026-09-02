#!/usr/bin/env node
/**
 * verify-crossside.mjs — ask BOTH sides the same question and compare answers.
 *
 * Most gates in this skill measure one side. That is a baseline, not a verdict:
 * a ported engine that is confidently wrong produces confidently stable numbers,
 * and a one-sided gate records them as the specification. This gate exists for
 * the case where the source publishes a seam you can drive directly — a global
 * class, a module you can reach, an exported function — so the mirror and the
 * port can be handed identical input and their outputs diffed.
 *
 * ⭐ Look for the seam before assuming there is none. A bundle that exposes no
 * `webpackJsonp` may still assign two or three globals as module top-level side
 * effects; grep the pretty-printed bundle for `window.<Name> =` and each hit is
 * a candidate. One seam through the orchestration layer (an expression parser,
 * a layout solver, an easing table) covers far more behaviour than its size
 * suggests, because everything else is specified in terms of it.
 *
 * Three failure modes this gate is built to avoid — all three were observed on
 * its first real run, and NONE of them was a porting defect:
 *
 *   1. It measured one side twice. Two CDP probes launched concurrently and the
 *      second attached to the browser the first started. ⛔ That failure REPORTS
 *      PERFECT AGREEMENT — the most convincing way for this gate to be wrong.
 *      Defences: evaluation is SERIAL, and every run fingerprints both sides and
 *      refuses to grade if the fingerprints match.
 *
 *   2. One side was missing a prerequisite action. A value read 0 on the port
 *      and 1080 on the mirror because the field is filled by a resize handler
 *      the probe page never triggers (gate-case-design.md §4). ⭐ This is
 *      the gate EARNING ITS KEEP: one-sided, 0 looks like the answer.
 *
 *   3. The two sides differ in measurement conditions, not in behaviour. Page
 *      coordinates differ because one page is 29,556px tall and the other 1,080.
 *      ⛔ Grading those as FAIL makes the gate red on every run, and a gate that
 *      is always red gets ignored. Hence two case lists:
 *
 *        judged  condition-independent — must match exactly
 *        info    condition-dependent   — printed, not graded, but BOTH sides
 *                                        must still resolve them (otherwise
 *                                        "unsupported" hides inside "expected")
 *
 * ⚠ Before adding a case, ask: does this quantity have the same domain on both
 * sides? Page size, scroll offset, timestamps, RNG seeds, devicePixelRatio and
 * anything derived from them do not — normalise them into ratios or file them
 * under `info`.
 *
 *   node scripts/verify-crossside.mjs --a <mirror-url> --b <port-url> \
 *        --config scripts/crossside.config.mjs [--probe scripts/probe.mjs]
 *
 * The config module supplies what is target-specific:
 *
 *   export const name   = "expression parser";
 *   export const judged = ["100vh", "(a0b - a0t) * 0.5"];
 *   export const info   = ["a0t", "a0b"];
 *   export function build(cases) { return `...JS returning {out:{case:value}}...`; }
 *
 * See crossside.config.example.mjs.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cli } from "./lib/cli.mjs";

cli({ known: ["a", "b", "config", "probe"], bools: [], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const A = flag("a", null), B = flag("b", null);
const CONFIG = flag("config", "scripts/crossside.config.mjs");
const PROBE = flag("probe", "scripts/probe.mjs");

if (!A || !B) {
  console.error("usage: verify-crossside.mjs --a <mirror-url> --b <port-url> [--config <file>]");
  process.exit(2);
}

let cfg;
try {
  cfg = await import(pathToFileURL(path.resolve(CONFIG)).href);
} catch (e) {
  console.error(`FATAL — cannot load config ${CONFIG}: ${e.message}`);
  process.exit(5);
}
const JUDGED = cfg.judged ?? [];
const INFO = cfg.info ?? [];
const CASES = [...JUDGED, ...INFO];

if (JUDGED.length === 0) {
  // ⛔ A gate with nothing to judge passes unconditionally. That is worse than
  // no gate, because it appears in the record as evidence.
  console.error(`FATAL — config exports no \`judged\` cases. A gate that grades nothing agrees with everything.`);
  process.exit(5);
}
if (typeof cfg.build !== "function") {
  console.error(`FATAL — config exports no \`build(cases)\` function.`);
  process.exit(5);
}

// Identity fingerprint, evaluated on each side alongside the real cases. Its
// only job is to prove the two evaluations landed on two different pages.
const WRAP = (cases) => `JSON.stringify((()=>{
  const __id = {
    href: String(location.href),
    title: String(document.title || ""),
    docH: document.documentElement.scrollHeight,
    innerH: innerHeight, innerW: innerWidth,
  };
  try {
    const r = (function(){ return (${cfg.build(cases)}); })();
    return { __id, ...(r && typeof r === "object" ? r : { error: "build() returned " + typeof r }) };
  } catch (e) { return { __id, error: String(e).slice(0, 200) }; }
})())`;

const evalOn = (url, expr) =>
  new Promise((res) => {
    const p = spawn("node", [PROBE, url, "--eval", expr], { stdio: ["ignore", "pipe", "pipe"] });
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.stderr.on("data", (d) => (o += d));
    p.on("close", () => {
      const m = o.match(/^EVAL: (.*)$/m);
      if (!m) return res({ error: "no EVAL line (probe produced no result)", raw: o.slice(-400) });
      try { res(JSON.parse(JSON.parse(m[1]))); } catch (e) { res({ error: String(e), raw: m[1].slice(0, 240) }); }
    });
  });

console.log(`=== verify-crossside — ${cfg.name || "unnamed seam"} ===`);
console.log(`  A ${A}\n  B ${B}\n`);

// ⛔ SERIAL, never Promise.all. Both calls drive CDP; concurrently, the second
// attaches to the browser the first started and the gate measures one side
// twice — reporting perfect agreement. See the header, failure mode 1.
const a = await evalOn(A, WRAP(CASES));
const b = await evalOn(B, WRAP(CASES));

if (a.error || b.error) {
  console.log(`  FATAL A: ${a.error || "-"}`);
  if (a.raw) console.log(`         ${String(a.raw).replace(/\n/g, "\n         ").slice(0, 400)}`);
  console.log(`  FATAL B: ${b.error || "-"}`);
  if (b.raw) console.log(`         ${String(b.raw).replace(/\n/g, "\n         ").slice(0, 400)}`);
  process.exit(5);
}

// --- identity: prove these are two pages, not one page twice ---------------
const ia = a.__id || {}, ib = b.__id || {};
console.log(`  A  ${ia.href}`);
console.log(`     ${ia.innerW}x${ia.innerH} viewport, ${ia.docH}px document`);
console.log(`  B  ${ib.href}`);
console.log(`     ${ib.innerW}x${ib.innerH} viewport, ${ib.docH}px document\n`);
if (ia.href && ia.href === ib.href) {
  console.log(`FATAL — both sides report the same URL. This gate measured ONE page twice;`);
  console.log(`        any agreement below is an artefact. Run the two probes serially and`);
  console.log(`        check that no other CDP session is attached.`);
  process.exit(5);
}
if (ia.docH !== ib.docH || ia.innerH !== ib.innerH) {
  console.log(`  ⚠    the two pages differ in size. Condition-dependent quantities WILL differ;`);
  console.log(`       that is why they belong in \`info\`, not \`judged\`.\n`);
}

let fail = 0, same = 0;
const bothErr = [];
const isErr = (v) => String(v).startsWith("ERR:") || v === undefined;
const w = Math.max(24, ...CASES.map((c) => c.length));

console.log(`  ${"case".padEnd(w)} A                 B`);
for (const c of JUDGED) {
  const x = a.out?.[c], y = b.out?.[c];
  if (isErr(x) && isErr(y)) bothErr.push(c);
  const agree = String(x) === String(y);
  if (agree) same++; else fail++;
  console.log(`  ${agree ? "ok  " : "FAIL"} ${c.padEnd(w)} ${String(x).slice(0, 16).padEnd(18)}${String(y).slice(0, 16)}`);
}

if (INFO.length) {
  console.log(`\n  info — condition-dependent, NOT graded on value (both sides must still resolve):`);
  for (const c of INFO) {
    const x = a.out?.[c], y = b.out?.[c];
    const resolved = !isErr(x) && !isErr(y);
    if (!resolved) fail++;
    console.log(`  ${resolved ? "    " : "FAIL"} ${c.padEnd(w)} ${String(x).slice(0, 16).padEnd(18)}${String(y).slice(0, 16)}${resolved ? "" : "   <- one side failed to resolve"}`);
  }
}

// ⛔ Every case erroring on both sides is agreement about failure, not about a
// value. Left ungraded it prints as a clean pass.
if (bothErr.length === JUDGED.length) {
  console.log(`\nFATAL — every judged case errored on BOTH sides. Agreement about failure is not agreement.`);
  process.exit(5);
}
if (bothErr.length) console.log(`\n  ⚠    ${bothErr.length} judged case(s) errored on both sides — counted as agreement, but they prove nothing.`);

console.log(fail
  ? `\nFAIL — ${fail} problem(s). ⚠ Before calling it a porting defect, rule out §0.25 (a`
    + `\n       prerequisite action one side performs and the other does not) and §0.26`
    + `\n       (a quantity whose domain differs between the two pages).`
  : `\nPASS — ${same}/${JUDGED.length} judged case(s) agree${INFO.length ? `; ${INFO.length} condition-dependent case(s) resolved on both sides` : ""}.`);
process.exit(fail ? 1 : 0);
