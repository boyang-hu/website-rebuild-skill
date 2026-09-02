#!/usr/bin/env node
/**
 * pixel-walk.mjs — run the pixel gate at N scroll checkpoints, not one.
 *
 * ⛔ A single 0.00 is the most misleading number this toolchain produces. It is
 * one frame, usually the top of the page in the first couple of seconds, on a
 * document that may be tens of thousands of pixels tall — and §4.8 of
 * verification-gates.md exists because a whole suite once photographed one
 * state and reported the site correct.
 *
 * This drives both sides to the same scroll fraction before capturing, and
 * repeats. It is a thin loop over pixelcompare.mjs on purpose: the comparison,
 * the determinism shim, the non-empty-frame precondition and the
 * distinct-sides guard all stay in one place.
 *
 * ⚠ Establish the SELF-BAND at these same checkpoints first (--self on one
 * side). A cross-side number is only meaningful against the band: measured on
 * one target, the unfrozen self-band was 4.6-5.0 while the unfrozen cross-side
 * was 2.6-3.4 — the "difference" was entirely the page's own session noise, and
 * both numbers were useless until the shim brought the band to 0.00.
 *
 *   node scripts/pixel-walk.mjs --a <rebuild-url> --b <mirror-url> [--steps 9]
 *                               [--pump 16.7,120] [--max-mean 1.0] [--self]
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const A = flag("a", null), B = flag("b", null);
const STEPS = Number(flag("steps", "9"));
const PUMP = flag("pump", "16.7,120");
const OUT = flag("out", "docs/pixelcompare");
const MAX_MEAN = flag("max-mean", null);
const SELF = args.includes("--self");
const FMT = flag("format", "jpeg"), Q = flag("quality", "92");
// How long after load to RE-ISSUE the scroll. Virtual milliseconds: the shim
// replaces setTimeout with a pumped queue, so this lands after the page's own
// init has run rather than at some wall-clock moment.
const RESCROLL_MS = Number(flag("rescroll-ms", "1500"));
// ⚠ Passed straight through to pixelcompare. A site whose readiness has no cheap
// observable needs a wall-clock settle, and that is a deviation from
// "settle must be a page state" (§2.2) that has to be stated, not hidden in a
// default: measured on one target, the states available before a renderable
// frame (canvas sized, preloader removed) are all TOO EARLY.
const SETTLE = flag("settle", null);
const READY = flag("ready", null);
// --hold / --hold-grace: passed through (pixelcompare: wait in REAL time for an
// arrival state before the first pump — the GLB-on-a-worker case).
const HOLD = flag("hold", null);
const HOLD_GRACE = flag("hold-grace", null);
const HOLD_AFTER = flag("hold-after", null);
if (!A || !B) { console.error("usage: pixel-walk.mjs --a <rebuild-url> --b <mirror-url> [--steps N] [--pump dt,frames] [--max-mean N] [--self] [--ready expr] [--hold expr] [--hold-grace ms] [--hold-after N]"); process.exit(2); }
if (STEPS < 2) { console.error("FATAL — --steps must be >= 2. One checkpoint is the problem this tool exists to fix."); process.exit(2); }

// ⛔ Scroll TWICE: at load, and again after the page's own init has run.
//
// One scroll at load looks sufficient and is not. A page whose init resets the
// scroll position — restoring a saved offset, mounting a scroll controller,
// calling scrollTo(0,0) itself — SWALLOWS the one issued at load, and every
// checkpoint then photographs the top of the page. Measured on a target where
// eight desktop checkpoints across two pages were all the same frame while the
// gate reported them as passes: the two sides agreed because both were showing
// the same wrong thing.
//
// ⚠ The re-issue rides the pump, not the wall clock, so it still lands after
// init on a frozen page.
const seedFor = (f) =>
  `window.addEventListener("load", () => {
     // ⛔ FIND THE SCROLLER. The document is not always what scrolls. A site
     // using a smooth-scroll library often scrolls an inner
     // \`overflow-y: auto\` container, and there
     // \`documentElement.scrollHeight - innerHeight\` is ZERO — so a seed that
     // scrolls the document computes 0 * f = 0 for EVERY checkpoint and drives
     // nothing. Measured: five checkpoints, five captures, one position, and
     // meanAbsDiff inside the band at all of them. Only the duplicate-frame
     // report showed it.
     var pick = function () {
       var doc = document.scrollingElement || document.documentElement;
       if (doc.scrollHeight - doc.clientHeight > 200) return doc;
       var best = null, gap = 200;
       var all = document.querySelectorAll("*");
       for (var i = 0; i < all.length; i++) {
         var e = all[i], g = e.scrollHeight - e.clientHeight;
         if (g <= gap) continue;
         var ov = getComputedStyle(e).overflowY;
         if (ov === "auto" || ov === "scroll") { best = e; gap = g; }
       }
       return best || doc;
     };
     var go = function () {
       var el = pick();
       var m = el.scrollHeight - el.clientHeight;
       // ⛔ Nothing to scroll is a FACT the gate must see, not a silent 0.
       var target = Math.round(m * ${f});
       if (m > 0) {
         if (el === document.scrollingElement || el === document.documentElement) window.scrollTo(0, target);
         else el.scrollTop = target;
       }
       // ⛔ RECORD WHERE IT ACTUALLY LANDED. A smooth-scroll library owns the
       // scroll value and re-asserts it, so setting scrollTop is a REQUEST, not
       // a result — and the two sides then settle at different positions while
       // the gate compares their pixels as if they matched. Measured: the same
       // checkpoint gave meanAbsDiff 115 because one side was elsewhere.
       // ⭐ A driver that quietly reports the wrong position costs far more than
       // one that throws (verification-gates.md §2.1.1).
       var landed = (el === document.scrollingElement || el === document.documentElement)
         ? Math.round(window.scrollY) : Math.round(el.scrollTop);
       window.__walkScroll = { tag: el.tagName, max: m, target: target, landed: landed };
     };
     go();
     setTimeout(go, ${RESCROLL_MS});
   });`;

// Re-applied after every pump chunk, so it takes effect as soon as the scroller
// exists. ⚠ Idempotent by construction: it recomputes the target each time.
const driveFor = (f) => `
  var doc = document.scrollingElement || document.documentElement;
  var el = null;
  if (doc.scrollHeight - doc.clientHeight > 200) el = doc;
  else {
    var best = null, gap = 200, all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var e = all[i], g = e.scrollHeight - e.clientHeight;
      if (g <= gap) continue;
      var ov = getComputedStyle(e).overflowY;
      if (ov === "auto" || ov === "scroll") { best = e; gap = g; }
    }
    el = best;
  }
  if (el) {
    var m = el.scrollHeight - el.clientHeight;
    var t = Math.round(m * ${f});
    if (el === doc) window.scrollTo(0, t); else el.scrollTop = t;
    window.__walkScroll = { tag: el.tagName, max: m, target: t,
      landed: (el === doc) ? Math.round(window.scrollY) : Math.round(el.scrollTop) };
  }
`;

const run = (a) =>
  new Promise((res) => {
    const p = spawn("node", [path.join(path.dirname(new URL(import.meta.url).pathname), "pixelcompare.mjs"), ...a], { stdio: ["ignore", "pipe", "pipe"] });
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.stderr.on("data", (d) => (o += d));
    p.on("close", (code) => res({ code, out: o }));
  });

console.log(`=== pixel-walk — ${STEPS} checkpoint(s)${SELF ? " (SELF-BAND SAMPLE, not a verdict)" : ""} ===`);
console.log(`  A ${A}\n  B ${B}\n`);
console.log(`  ${"checkpoint".padEnd(12)} ${"colours".padStart(8)} ${"meanAbsDiff".padStart(12)} ${"worstCell".padStart(10)}  similarity`);

const rows = [];
let fail = 0;
for (let i = 0; i < STEPS; i++) {
  const f = i / (STEPS - 1);
  const name = `walk-${String(Math.round(f * 100)).padStart(3, "0")}`;
  const a = ["--a", A, "--b", B, "--name", name, "--pump", PUMP, "--seed", seedFor(f), "--out", OUT, "--format", FMT, "--quality", Q];
  // ⭐ Drive INSIDE the pump loop, not from a load-time seed: on a site whose
  // scroll container appears only after its preloader, a seed fires too early
  // and every checkpoint lands at 0.
  a.push("--drive", driveFor(f));
  if (SETTLE) a.push("--settle", SETTLE);
  if (READY) a.push("--ready", READY);
  if (HOLD) a.push("--hold", HOLD);
  if (HOLD_GRACE) a.push("--hold-grace", HOLD_GRACE);
  if (HOLD_AFTER) a.push("--hold-after", HOLD_AFTER);
  if (SELF) a.push("--self");
  const { code, out } = await run(a);
  // ⭐ Forward the alignment diagnostics. pixelcompare says "ready after N pumped
  // frame(s)" / "--hold satisfied after N" per side, and swallowing them left a
  // walk whose READY never fired indistinguishable from one that aligned
  // (raycastkbd: a constant 1.7 band with no line saying why).
  for (const line of out.split("\n")) if (/^\[pixel\]\s+(REBUILD|MIRROR|[AB]):.*(ready after|--hold satisfied|never satisfied)/.test(line)) console.log(`  ${line.trim()}`);
  // Landing positions, reported by the seed on each side.
  const m = out.match(/\{"meanAbsDiff":[^}]+\}/);
  const census = out.match(/REBUILD: (\d+) colours/);
  if (!m) {
    fail++;
    rows.push({ name, error: (out.match(/FATAL[^\n]*/) || ["no metric line"])[0] });
    console.log(`  ${name.padEnd(12)} ${"-".padStart(8)} ${"FAIL".padStart(12)}  ${(out.match(/FATAL[^\n]*/) || ["no metric"])[0].slice(0, 60)}`);
    continue;
  }
  const j = JSON.parse(m[0]);
  const colours = census ? Number(census[1]) : null;
  rows.push({ name, f, colours, ...j, code });
  const bad = MAX_MEAN !== null && !SELF && j.meanAbsDiff > Number(MAX_MEAN);
  if (bad) fail++;
  console.log(`  ${name.padEnd(12)} ${String(colours ?? "?").padStart(8)} ${String(j.meanAbsDiff).padStart(12)} ${String(j.worstCellDiff).padStart(10)}  ${j.similarityPct}%${bad ? "   <- over --max-mean" : ""}`);
}

// ⛔ Checkpoints that all photograph the same frame are one checkpoint repeated.
// The colour census is the cheapest evidence that the page actually moved.
const withFrames = rows.filter((r) => r.colours != null);
const distinct = new Set(withFrames.map((r) => r.colours));
console.log("");
if (distinct.size === 0) {
  console.log(`FATAL — no checkpoint produced a frame at all. Nothing below is a measurement.`);
  process.exit(5);
}

// ⛔ "Some checkpoints differ" is not "every checkpoint is its own state". A
// GLOBAL distinct count passes while a SUBSET is stuck: nine checkpoints, three
// of them the same frame, still reports "7 distinct" and a reassuring sentence.
// The duplicates are the ones that matter — each cost a full capture and
// measured a state that was already measured.
//
// ⚠ Equal colour counts are strong evidence of an identical frame, not proof.
// So report them as duplicates to explain, and FAIL only when they dominate: a
// page really can look the same at two positions (a tall flat footer), but half
// the walk collapsing is the signature of scroll never landing.
const byColour = new Map();
for (const r of withFrames) byColour.set(r.colours, (byColour.get(r.colours) || []).concat(r.name));
const dupeGroups = [...byColour.values()].filter((g) => g.length > 1);
const dupeCheckpoints = dupeGroups.reduce((t, g) => t + g.length - 1, 0);

console.log(`  ${distinct.size} distinct frame(s) across ${withFrames.length} checkpoint(s)`);
if (dupeGroups.length) {
  console.log(`  ⚠    ${dupeCheckpoints} checkpoint(s) repeat a frame already captured:`);
  for (const g of dupeGroups) console.log(`         ${g.join(" = ")}`);
  console.log(`       Either the page really is identical there, or the scroll did not land —`);
  console.log(`       a page that resets scroll in its own init swallows the one issued at load.`);
  console.log(`       ⛔ Until each is explained, this walk covers ${distinct.size} states, not ${withFrames.length}.`);
}
if (withFrames.length > 1 && distinct.size <= Math.ceil(withFrames.length / 2)) {
  console.log(`\nFATAL — ${distinct.size} distinct frame(s) out of ${withFrames.length} checkpoint(s): at most half`);
  console.log(`        the walk moved the page. Re-check the driving before reading any number above.`);
  process.exit(5);
}

const means = rows.filter((r) => r.meanAbsDiff != null).map((r) => r.meanAbsDiff);
if (means.length) {
  const worst = Math.max(...means);
  console.log(`  worst meanAbsDiff ${worst}${SELF ? "  (this is the BAND; cross-side results must be read against it)" : ""}`);
}
if (SELF) {
  console.log(`\n⚠ SELF-BAND SAMPLE — not a pass. Collect several per side and interleave them;`);
  console.log(`  a band from one side lets that side's luck set the tolerance.`);
  process.exit(0);
}
console.log(fail ? `\nFAIL — ${fail} checkpoint(s) failed.` : `\nPASS — ${rows.length} checkpoint(s)${MAX_MEAN !== null ? ` within --max-mean ${MAX_MEAN}` : ""}.`);
process.exit(fail ? 1 : 0);
