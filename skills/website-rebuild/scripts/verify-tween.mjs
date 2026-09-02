#!/usr/bin/env node
/**
 * verify-tween.mjs — a NUMERIC gate for the tween slice.
 *
 * Pixel comparison judges a finished page. It cannot judge this slice: it needs
 * the whole page built, it answers late, and a wrong easing curve arrives as a
 * few differing grid cells rather than as a number you can read.
 *
 * So the slice gets its own gate. Feed both sides the same keyframe spec, drive
 * the same positions, and compare the values the engines actually wrote. A wrong
 * curve, a wrong clamp or a wrong attribute route fails here with the input that
 * produced it, long before anything is rendered.
 *
 * ⛔ Runs several specs, not one. A single linear tween agrees under almost any
 * implementation — including a wrong one. The suite covers the curve (linear vs
 * eased), the clamp outside [start,end], a multi-value attribute, and the
 * declarative disable path, because those are where the implementations can
 * differ while a single sample still matches.
 *
 * ⚠ Both sides get identical `range` overrides. Expression-resolved start/end
 * need live layout the probe page does not have, and applying the SAME override
 * to both cannot mask a difference between them (REBUILD_PLAN §6 D6).
 *
 *   node scripts/verify-tween.mjs --a <urlA> --b <urlB> [--tol 1e-9] [--probe scripts/probe.mjs]
 *   node scripts/verify-tween.mjs --a <urlA> --record docs/tween-baseline.json
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { cli } from "./lib/cli.mjs";

cli({ known: ["a", "b", "record", "tol", "probe"], bools: [], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const A = flag("a", null), B = flag("b", null), RECORD = flag("record", null);
const TOL = Number(flag("tol", 1e-9));
const PROBE = flag("probe", "scripts/probe.mjs");
if (!A) { console.error("usage: verify-tween.mjs --a <urlA> [--b <urlB>] [--record <file>]"); process.exit(2); }

// The cases. Each one is a place two implementations of the same engine can
// disagree while a single linear sample still matches.
// ⛔ Field names and values are COPIED from the source's own parseOptions
// (_pretty/main.built.js L3149), not guessed. The first draft of this suite used
// `ease: "easeInOutCubic"` and every case still reported `linear` — because
// `ease` is a NUMERIC weight and the curve is named by `easeFunction`, whose
// vocabulary is a table the engine looks the name up in (linear, easeInQuad,
// easeOutQuad, easeInOutQuad, …) with bezier(…)/spring(…) parsed separately.
// A suite written from intuition would have passed while testing one curve five
// times.
const CASES = [
  { name: "linear opacity", spec: { start: 0, end: 100, opacity: [0, 1] }, range: [0, 100] },
  // ⭐ The expression cases resolve start/end from LIVE LAYOUT rather than from
  // an override — `a0t`/`a0b` are the anchor's top and bottom as scroll t-values.
  // They are the only cases that exercise the parser at all, and they are what
  // retires the numeric-override deviation (REBUILD_PLAN §6 D6).
  { name: "anchor expression a0t..a0b", spec: { start: "a0t", end: "a0b", opacity: [0, 1], anchors: [".anchor"] }, anchor: {} },
  { name: "anchor expression, eased", spec: { start: "a0t", end: "a0b", currentTime: [0, 10], anchors: [".anchor"], easeFunction: "easeOutQuad" }, anchor: {} },
  { name: "easeInOutQuad opacity", range: [0, 100], spec: { start: 0, end: 100, opacity: [0, 1], easeFunction: "easeInOutQuad" } },
  { name: "easeOutQuad opacity", range: [0, 100], spec: { start: 0, end: 100, opacity: [0, 1], easeFunction: "easeOutQuad" } },
  { name: "reverse range", range: [0, 100], spec: { start: 0, end: 100, opacity: [1, 0] } },
  { name: "translate x", range: [0, 100], spec: { start: 0, end: 100, x: [0, 240] } },
  { name: "video currentTime", range: [0, 100], spec: { start: 0, end: 100, currentTime: [0, 10] } },
  { name: "currentTime eased", range: [0, 100], spec: { start: 0, end: 100, currentTime: [0, 10], easeFunction: "easeOutQuad" } },
  // ⛔ The pair below is the point. The same spec under two class masks MUST
  // give different answers — enabled under the default, fully disabled under
  // reduced-motion. A default-preference comparison can never see this, which is
  // exactly why it needs its own case (porting-discipline.md §0.3).
  { name: "disabledWhen, default classes", range: [0, 100], spec: { start: 0, end: 100, opacity: [0, 1], disabledWhen: ["reduced-motion"] }, classes: [] },
  { name: "disabledWhen, reduced-motion on", range: [0, 100], spec: { start: 0, end: 100, opacity: [0, 1], disabledWhen: ["reduced-motion"] }, classes: ["reduced-motion"] },
];

const evalOn = (url, expr) =>
  new Promise((res) => {
    const p = spawn("node", [PROBE, url, "--eval", expr], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", () => {
      const m = out.match(/^EVAL: (.*)$/m);
      if (!m) return res({ error: "no EVAL line", raw: out.slice(-400) });
      try { res(JSON.parse(JSON.parse(m[1]))); } catch (e) { res({ error: String(e), raw: m[1].slice(0, 300) }); }
    });
  });

// ⭐ The end-to-end case: real window scroll driving a video's currentTime. The
// cases above exercise the engine through its internals; this one exercises the
// path the PAGE uses, so a port that got every curve right while wiring the
// scroll system wrong still fails here.
const SCROLL_CASES = [
  { name: "scroll -> currentTime", spec: { start: "a0t", end: "a0b", currentTime: [0, 10], anchors: [".anchor"] } },
  { name: "scroll -> currentTime, eased", spec: { start: "a0t", end: "a0b", currentTime: [0, 10], anchors: [".anchor"], easeFunction: "easeOutQuad" } },
];

async function runSide(url) {
  const results = [];
  for (const c of CASES) {
    const expr = `JSON.stringify((()=>{try{return window.__tweenProbe(${JSON.stringify({ steps: 9, spec: c.spec, classes: c.classes || [], range: c.range || null, anchor: c.anchor || null })});}catch(e){return {error:String(e).slice(0,200)};}})())`;
    results.push({ case: c.name, ...(await evalOn(url, expr)) });
  }
  for (const c of SCROLL_CASES) {
    const expr = `JSON.stringify((()=>{try{return window.__scrollProbe(${JSON.stringify({ fracs: [0, 0.2, 0.3, 0.35, 0.4, 0.5, 0.75, 1], spec: c.spec })});}catch(e){return {error:String(e).slice(0,200)};}})())`;
    results.push({ case: c.name, scroll: true, ...(await evalOn(url, expr)) });
  }
  return results;
}

console.log(`=== verify-tween ===`);
const a = await runSide(A);
console.log(`  A ${A}`);
for (const r of a) console.log(`    ${r.error ? "ERR " : "ok  "} ${r.case.padEnd(32)} ${r.error ? r.error.slice(0, 70) : r.disabled ? `DISABLED (${r.ease})` : r.scroll ? `${r.attr} @ scroll [${(+r.start).toFixed(3)}, ${(+r.end).toFixed(3)}]` : `${r.attr} / ${r.ease}`}`);

if (RECORD) {
  await mkdir(path.dirname(path.resolve(RECORD)), { recursive: true });
  await writeFile(path.resolve(RECORD), JSON.stringify({ url: A, cases: a }, null, 2) + "\n");
  console.log(`\n  -> ${RECORD}  (baseline recorded; this is NOT a pass)`);
  console.log(`  ⚠ A baseline is what the port does, not what the source does. It only`);
  console.log(`    becomes a gate once --b names the other side.`);
  process.exit(a.some((r) => r.error) ? 1 : 0);
}

if (!B) { console.log(`\n  ⚠ no --b: nothing was COMPARED. One side alone cannot pass this gate.`); process.exit(2); }

const b = await runSide(B);
console.log(`  B ${B}`);
let fail = 0;
const ALL = [...CASES, ...SCROLL_CASES];
for (let i = 0; i < ALL.length; i++) {
  const x = a[i], y = b[i];
  if (x.error || y.error) { fail++; console.log(`\n  FAIL ${ALL[i].name}: ${x.error || ""} ${y.error || ""}`.slice(0, 160)); continue; }
  const diffs = [];
  if (x.attr !== y.attr) diffs.push(`attr ${x.attr} vs ${y.attr}`);
  if (!!x.disabled !== !!y.disabled) diffs.push(`disabled ${!!x.disabled} vs ${!!y.disabled}`);
  // Resolved start/end are part of the answer: a parser that resolves a
  // different range produces the same CURVE over a different span.
  if (x.start !== undefined && Math.abs((x.start ?? 0) - (y.start ?? 0)) > TOL) diffs.push(`start ${x.start} vs ${y.start}`);
  if (x.end !== undefined && Math.abs((x.end ?? 0) - (y.end ?? 0)) > TOL) diffs.push(`end ${x.end} vs ${y.end}`);
  if (x.ease !== y.ease) diffs.push(`ease ${x.ease} vs ${y.ease}`);
  for (let k = 0; k < Math.max(x.out.length, y.out.length); k++) {
    const p = x.out[k], q = y.out[k];
    if (!p || !q) { diffs.push(`step ${k} missing on one side`); continue; }
    if (Math.abs(p.value - q.value) > TOL) diffs.push(`pos ${p.pos}: ${p.value} vs ${q.value}`);
    if (Math.abs(p.curved - q.curved) > TOL) diffs.push(`pos ${p.pos} curve: ${p.curved} vs ${q.curved}`);
    // The written value is the one the page actually sees. Comparing only the
    // tween's internal `current` would pass a port whose DOM write path is wrong.
    if (String(p.written) !== String(q.written)) diffs.push(`pos ${p.pos} written: ${p.written} vs ${q.written}`);
  }
  if (diffs.length) { fail++; console.log(`\n  FAIL ${ALL[i].name}`); for (const d of diffs.slice(0, 6)) console.log(`         ${d}`); }
  else console.log(`  ok   ${ALL[i].name} — ${x.out.length} positions agree within ${TOL}`);
}
console.log(fail ? `\nFAIL — ${fail}/${ALL.length} case(s) differ.` : `\nPASS — ${ALL.length}/${ALL.length} cases agree within ${TOL}.`);
process.exit(fail ? 1 : 0);
