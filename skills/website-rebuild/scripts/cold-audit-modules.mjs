#!/usr/bin/env node
/**
 * cold-audit-modules.mjs — M(n) closeout for a module-container bundle.
 *
 * Functional tests cannot see a whole missing module: the routes you drive
 * exercise what you built, and what you never built is never asked for. The
 * closeout answer is a LIST RECONCILIATION — every module the bundle defines,
 * matched against where it landed.
 *
 * For a packed bundle that is mechanical, and it asks two questions:
 *
 *   1. Which modules are NOT in the port, and are they genuinely unreachable?
 *   2. Does anything require a module by a COMPUTED id? A static closure is
 *      only complete if every require argument is a literal. One `r(someVar)`
 *      and the closure silently under-approximates — the port boots, the routes
 *      pass, and a feature reachable only through that call path is absent.
 *
 * ⛔ Only question 1 is DECIDED here; question 2 is REPORTED. This tool is
 * zero-dependency by stage rule, and deciding question 2 needs scope analysis:
 * the require parameter is routinely shadowed by an inner function's parameter
 * of the same one-letter name, so a text scan reports `i(i) { i.preventDefault()`
 * as a computed require. Thirteen such candidates on one bundle, none of them
 * real. ⚠ A check that cannot be decided must be printed for a human, never
 * dressed up as a verdict — an audit that cries wolf thirteen times is an audit
 * nobody reads the fourteenth time.
 *
 * ⚠ "Unreachable from the entry" is a claim about THIS entry. A bundle can have
 * several (lazy chunks, a second page's entry); this reconciles against the
 * entries you name and says so.
 *
 *   node scripts/cold-audit-modules.mjs --map docs/module-map.json \
 *        --closure docs/app-closure.json [--entry 14]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const MAP = JSON.parse(await readFile(path.resolve(flag("map", "docs/module-map.json")), "utf8"));
const CLO = JSON.parse(await readFile(path.resolve(flag("closure", "docs/app-closure.json")), "utf8"));
// ⭐ A SITE is many chunks. A Next/Turbopack build ships dozens of chunk files,
// and a site-wide map (merged from per-chunk maps) tags every module with the
// chunk it lives in. Read each module's own chunk; a single-file map still
// works unchanged (no `chunk` field -> MAP.source).
// ⭐ A MERGED map (tools/merge-module-maps.mjs) tags a module with `locations[]`
// — one entry per chunk it is packed into, each carrying its own `source` path
// and line/char span — instead of a flat `chunk` + `startLine`. This audit used
// to accept only the flat shape and to name the file `<chunk>.pretty.js` beside
// MAP.source, so a merged darkroom map (339 modules / 60 chunks) needed a
// flattening pass plus a directory of symlinks just to be read (darkroom §F-9).
// Normalize once: the canonical location (first) supplies chunk/source/lines.
for (const m of MAP.modules) {
  if (Array.isArray(m.locations) && m.locations.length && m.startLine == null) {
    const loc = m.locations[0];
    Object.assign(m, { chunk: loc.chunk, source: loc.source, startLine: loc.startLine, endLine: loc.endLine, startChar: loc.startChar, endChar: loc.endChar });
  }
}
const srcCache = new Map();
const srcOf = async (m) => {
  // A module that names its own source file wins; otherwise the flat-map
  // convention (`<chunk>.pretty.js` beside MAP.source) still applies.
  const file = m.source ? path.resolve(m.source)
    : m.chunk ? path.join(path.dirname(path.resolve(MAP.source)), `${m.chunk}.pretty.js`) : path.resolve(MAP.source);
  if (!srcCache.has(file)) srcCache.set(file, (await readFile(file, "utf8")).split("\n"));
  return srcCache.get(file);
};
const SRC = (MAP.chunks || MAP.modules.some((m) => m.source)) ? null : await srcOf({});

const ported = new Set(CLO.modules.map(String));
const all = MAP.modules;
const byId = new Map(all.map((m) => [String(m.id), m]));
const missing = all.filter((m) => !ported.has(String(m.id)));

console.log(`=== cold-audit-modules ===`);
console.log(`  bundle defines   ${all.length} module(s)`);
console.log(`  port contains    ${ported.size}`);
console.log(`  unaccounted for  ${missing.length}\n`);

// --- 1. dynamic requires ----------------------------------------------------
// A literal argument is a string or a number. Anything else means the closure
// cannot be computed statically.
let dynamic = [];
const resolved = [];
const KNOWN = new Set(all.map((m) => String(m.id)));
// ⛔⛔ COUNT WHAT WAS ACTUALLY EXAMINED. This check reported
// "no call site resembles a require with a computed id" after scanning ZERO of
// 20 modules: its signature probe only matched webpack's `function(m, e, r)`,
// and a Turbopack factory is `ctx => {…}`, so every module fell through the
// `continue` and the loop found nothing to look at. A check that examined
// nothing must SAY SO — reporting ok is the most expensive thing it can do.
let examined = 0;
for (const m of all) {
  const SRC = await srcOf(m);
  const body = SRC.slice(m.startLine - 1, m.endLine).join("\n");
  // ⛔ Take the signature from the module's FIRST LINE, not from the first match
  // anywhere in its body. The body is full of inner functions, and the first
  // three-argument one is often a callback whose third parameter is unrelated —
  // which made this audit report `i(this.xhr.responseText, …)` as a computed
  // require. A regex that finds A match is not a regex that finds THE match.
  // Two packers, two signatures. webpack: `function (module, exports, require)`,
  // and the third parameter is the require. Turbopack: `ctx => {…}` or
  // `(ctx, …) => {…}`, and requires go through `ctx.i(id)` / `ctx.r(id)`.
  // ⚠ A map can point past the end of the file (stale map, wrong source). Fail
  // that loudly rather than throwing on `undefined.match`.
  const head = SRC[m.startLine - 1];
  if (head === undefined) {
    console.error(`FATAL — module ${m.id} starts at line ${m.startLine} but ${MAP.source} has ${SRC.length}.`);
    console.error(`        The map and the source disagree; regenerate the map.`);
    process.exit(5);
  }
  let R = null, viaCtx = false;
  const wsig = head.match(/function\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
  if (wsig) R = wsig[3];
  else {
    // webpack under a newer target emits ARROW factories: `"key": (t, e, s) => {`.
    // The third parameter is still the require — this is webpack's contract in
    // arrow spelling, NOT Turbopack's (whose single ctx requires via ctx.i/.r).
    // Keyed on the `:` so a Turbopack array element can't match it.
    const wArrow = head.match(/:\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)\s*=>/);
    if (wArrow) R = wArrow[3];
    else if (/:\s*(?:function\s*)?\(\s*(?:\w+\s*(?:,\s*\w+\s*)?)?\)\s*(?:=>|\{)|:\s*\w+\s*=>/.test(head)) {
      // A webpack factory with 0–2 parameters NEVER BINDS the require — the
      // packer only passes what the module was compiled to use. No binding, no
      // computed require: the module is examined and vacuously clean, and
      // counting it as "unrecognised" would report a 100%-covered chunk as 40%.
      examined++;
      continue;
    }
    else {
      const tsig = head.match(/(?:^|[,[]\s*)(?:\(\s*(\w+)[^)]*\)|(\w+))\s*=>/);
      if (tsig) { R = tsig[1] || tsig[2]; viaCtx = true; }
    }
  }
  if (!R) continue;
  examined++;
  // For Turbopack the call shape is `ctx.i(` / `ctx.r(`, not `ctx(`.
  const re = viaCtx ? new RegExp(`\\b${R}\\.[ir]\\s*\\(`, "g") : new RegExp(`\\b${R}\\s*\\(`, "g");
  for (const hit of body.matchAll(re)) {
    const after = body.slice(hit.index + hit[0].length, hit.index + hit[0].length + 60);
    // Literal string or number -> static. `R.d(`, `R.n(` etc are runtime helpers
    // and were already excluded by requiring `(` immediately after the name.
    if (/^\s*["'`]/.test(after) || /^\s*\d/.test(after)) continue;
    if (/^\s*\)/.test(after)) continue;

    // ⭐ Full scope analysis is not needed to clear most false positives — the
    // require's CONTRACT rules them out. Reading the thirteen candidates this
    // produced on one bundle, every single one was the name shadowed by an
    // inner callback, and each broke one of these:
    const before = body.slice(Math.max(0, hit.index - 12), hit.index);
    //   • a require is never constructed
    if (/\bnew\s+$/.test(before)) continue;
    //   • a require is never tested for existence; it is always there
    if (/(?:if\s*\(|&&\s*|\|\|\s*|\?\s*)$/.test(before)) continue;
    //   • a require takes EXACTLY ONE argument. `i(this.xhr, this.status)` is a
    //     callback, and arity alone settles it without knowing what `i` is.
    let depth = 1, commas = 0, k = hit.index + hit[0].length;
    for (; k < body.length && depth > 0 && k - hit.index < 400; k++) {
      const c = body[k];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "," && depth === 1) commas++;
    }
    if (commas > 0) continue;
    //   • and the name must not have been redeclared inside this module
    if (new RegExp(`function\\s+${R}\\s*\\(|function\\s*\\(\\s*${R}\\s*[,)]`).test(body)) continue;
    // ⛔ Report the CALL SITE's line, not the module's. A review list that
    // points at the top of a 1,500-line module is a list nobody can act on.
    const lineNo = m.startLine + body.slice(0, hit.index).split("\n").length - 1;
    // ⭐ A computed argument is not automatically an unknown one. `i(t ? "a" : "b")`
    // is computed, but both branches are literal ids — once the layer map records
    // them as edges the site is ACCOUNTED FOR, and leaving it on the review list
    // just trains the reader to skip the list.
    const argText = body.slice(hit.index + hit[0].length, k);
    const lits = [...argText.matchAll(/["']([0-9a-f]{16,}|\d{1,6})["']/g)].map((x) => x[1]).filter((v) => KNOWN.has(v));
    const recorded = lits.length > 0 && lits.every((v) => m.requires.map(String).includes(v));
    (recorded ? resolved : dynamic).push({
      id: String(m.id), line: lineNo, lits,
      snippet: (R + "(" + after).replace(/\s+/g, " ").slice(0, 70),
    });
  }
}

if (resolved.length) {
  console.log(`  ok   ${resolved.length} computed require(s) whose literal branches are all recorded as edges:`);
  for (const r of resolved.slice(0, 6)) console.log(`         ${r.id}  L${r.line}  -> ${r.lits.join(", ")}`);
}
const review = [...dynamic];
dynamic = [];   // question 2 does not decide the exit code; see the header
if (review.length) {
  console.log(`  ⚠    ${review.length} call site(s) LOOK like a require with a computed id (${examined}/${all.length} module(s) examined). Read each one:`);
  for (const d of review.slice(0, 12)) console.log(`         ${d.id}  L${d.line}  ${d.snippet}`);
  if (review.length > 12) console.log(`         … ${review.length - 12} more`);
  console.log(`       Most are the require parameter SHADOWED by an inner function's parameter of`);
  console.log(`       the same name. A genuine one means the static closure under-approximates:`);
  console.log(`       resolve what it can reach and add those ids to the closure seeds.`);
} else if (examined < all.length * 0.8) {
  // ⛔ "Did it examine ANYTHING" is the wrong threshold. A version guarding only
  // on zero reported `ok` after examining 1 of 20 modules — as blind as zero,
  // and now wearing a green tick. What a check has to state is COVERAGE, and a
  // check that reached under four fifths of its subjects has not looked.
  console.log(`  FAIL the computed-require check examined only ${examined} of ${all.length} module(s) — it could`);
  console.log(`       not recognise this packer's factory signature on the rest, so its silence`);
  console.log(`       covers ${Math.round((examined / all.length) * 100)}% of the bundle and means nothing about the other ${all.length - examined}.`);
  dynamic.push({ id: "-", line: 0, snippet: `check examined ${examined}/${all.length}` });
} else {
  console.log(`  ok   no call site resembles a require with a computed id (${examined}/${all.length} module(s) examined)`);
}

// --- 2. account for the leftovers ------------------------------------------
if (missing.length) {
  console.log(`\n  ${missing.length} module(s) not in the port. Each needs a reason, not a shrug:\n`);
  console.log(`    ${"id".padEnd(22)} ${"lines".padStart(6)}  ${"requires".padStart(8)}  required-by`);
  for (const m of missing.sort((a, b) => b.lines - a.lines)) {
    const requiredBy = all.filter((x) => x.requires.map(String).includes(String(m.id))).map((x) => String(x.id));
    const inPort = requiredBy.filter((r) => ported.has(r));
    console.log(`    ${String(m.id).padEnd(22)} ${String(m.lines).padStart(6)}  ${String(m.requires.length).padStart(8)}  ${requiredBy.length === 0 ? "(nobody)" : `${requiredBy.length}, ${inPort.length} of them ported`}`);
    // ⛔ A module nothing requires is dead. A module a PORTED module requires is
    // a hole in the closure, and the closure claimed to be closed.
    if (inPort.length) {
      console.log(`      ⛔ required by ported module(s): ${inPort.slice(0, 4).join(", ")} — the closure is NOT closed`);
      dynamic.push({ id: m.id, line: m.startLine, snippet: "required by a ported module but absent from the closure" });
    }
  }
  const orphans = missing.filter((m) => !all.some((x) => x.requires.map(String).includes(String(m.id))));
  console.log(`\n  ${orphans.length}/${missing.length} are required by NOTHING in the bundle — dead code the packer kept.`);
}

const decided = dynamic.length;   // only closure-not-closed sets this
console.log(decided
  ? `\nFAIL — the module list does not reconcile.`
  : `\nPASS — ${ported.size} ported; ${missing.length} unported and none of them required by a ported module.`
    + (review.length ? `\n       ⚠ ${review.length} call site(s) still need a human read (above) — this PASS does not cover them.` : ""));
process.exit(dynamic.length ? 1 : 0);
