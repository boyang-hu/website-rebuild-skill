#!/usr/bin/env node
/**
 * verify-symbols.mjs — did every ported declaration survive the rewrite?
 *
 * M(n+1) rewrites port/ into src/: split into modules, rename mangled locals,
 * add comments. Every runtime gate (CLEAN, pixel, DOM, geometry) can stay green
 * through that rewrite while a whole class quietly vanishes — because the gates
 * only exercise a handful of routes, and nothing on those routes constructs it.
 * That is the same structural blindness coldhead-audit.mjs answers at M(n); this
 * is its refactor-stage twin.
 *
 * Three assertions:
 *   1. injective   every port/ top-level declaration maps to exactly one src/ symbol
 *   2. surjective  no port/ declaration is missing from src/
 *   3. no orphans  no src/ top-level declaration lacks a port/ origin
 *
 * (3) is the one that catches invention. A refactor that "cleans things up" by
 * extracting a helper produces a declaration with no source-site ancestor —
 * readable-source.md §3.4 forbids exactly that, and this is where it shows up.
 *
 * ⛔ Presence and identity, not behaviour. A declaration can be present, renamed
 * correctly, and still broken. The runtime gates answer that half; this gate
 * answers the half they structurally cannot.
 *
 * ⛔ This gate reads only rename-map.json and the two sides' text. It must never
 * import the refactoring tools' parser to "confirm" a rename — a gate that runs
 * its subject's machinery is testing that the machinery agrees with itself
 * (verification-gates.md §2.1.2).
 *
 *   node scripts/verify-symbols.mjs [--port port/_gen] [--src src] [--map docs/rename-map.json]
 *
 * rename-map.json:
 *   { "declarations": { "<portName>": "<srcName>", ... },   // identity renames may be omitted
 *     "allow_orphans": ["<srcName>", ...] }                 // must be registered in REBUILD_PLAN §6
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { cli } from "./lib/cli.mjs";

cli({ known: ["port", "src", "map"], bools: [], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const PORT = path.resolve(flag("port", "port/_gen"));
const SRC = path.resolve(flag("src", "src"));
const MAP = path.resolve(flag("map", "docs/rename-map.json"));

// Same shape as coldhead-audit's matcher: a top-level declaration is one that
// starts a line. Anything indented is a member or a nested binding and is not
// this gate's business.
const DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/;

async function jsFiles(dir) {
  const out = [];
  const walk = async (d) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(m?js|ts)$/.test(e.name)) out.push(p);
    }
  };
  if ((await stat(dir).catch(() => null))?.isDirectory()) await walk(dir);
  else out.push(dir);
  return out;
}

// Declarations, with the file and line they were found on, so a failure names a
// place to go rather than just a symbol.
async function declarations(root) {
  const found = new Map();
  for (const f of await jsFiles(root)) {
    const lines = (await readFile(f, "utf8")).split("\n");
    lines.forEach((l, i) => {
      const m = DECL.exec(l);
      if (m) found.set(m[1], { file: path.relative(process.cwd(), f), line: i + 1 });
    });
  }
  return found;
}

const map = await readFile(MAP, "utf8").then(JSON.parse).catch(() => ({}));

// ⛔ A plain object inherits from Object.prototype, so `renames["toString"]`
// answers with a native function for a codebase that never mentioned it. This
// gate reported exactly that on its first real run — `toString` missing from
// src, "mapped to function toString() { [native code] }" — and it would fire on
// any project declaring toString / valueOf / constructor / hasOwnProperty.
const renames = Object.assign(Object.create(null), map.declarations || {});
const allowOrphans = new Set(map.allow_orphans || []);

// ⚠ The map is allowed to be absent, but not to be a DIFFERENT shape. A rename
// file written to another schema reads as "zero renames" and the gate then
// passes by knowing nothing — which is the failure this whole file exists to
// prevent one level up.
if (Object.keys(map).length && !("declarations" in map) && !("allow_orphans" in map)) {
  console.log(`FATAL: ${path.relative(process.cwd(), MAP)} has neither "declarations" nor "allow_orphans".`);
  console.log(`       A map in an unexpected shape reads as zero renames, and this gate`);
  console.log(`       would then pass while knowing nothing. Keys seen: ${Object.keys(map).join(", ")}`);
  process.exit(5);
}

const portDecls = await declarations(PORT);
const srcDecls = await declarations(SRC);

console.log(`=== verify-symbols ===`);
console.log(`  port  ${path.relative(process.cwd(), PORT)}  ${portDecls.size} top-level declarations`);
console.log(`  src   ${path.relative(process.cwd(), SRC)}  ${srcDecls.size} top-level declarations`);
console.log(`  map   ${Object.keys(renames).length} renames, ${allowOrphans.size} registered orphans\n`);

if (portDecls.size === 0) {
  console.log(`FATAL — 0 declarations found in port/. A gate that finds nothing agrees with everything.`);
  process.exit(5);
}

// 1+2. every port declaration present in src, exactly once
const missing = [];
const collisions = new Map();
for (const [name, at] of portDecls) {
  const want = Object.hasOwn(renames, name) ? renames[name] : name;
  if (!srcDecls.has(want)) missing.push({ name, want, at });
  else {
    const key = want;
    collisions.set(key, (collisions.get(key) || []).concat(name));
  }
}
const manyToOne = [...collisions].filter(([, from]) => from.length > 1);

// 3. no src declaration without a port origin
const claimed = new Set([...portDecls.keys()].map((n) => (Object.hasOwn(renames, n) ? renames[n] : n)));
const orphans = [...srcDecls.keys()].filter((n) => !claimed.has(n) && !allowOrphans.has(n));

let fail = 0;
if (missing.length) {
  fail++;
  console.log(`  FAIL ${missing.length} port declaration(s) absent from src/:`);
  for (const m of missing.slice(0, 20)) {
    const via = m.want !== m.name ? `  (mapped to "${m.want}")` : "";
    console.log(`         ${m.name}${via}   ${m.at.file}:${m.at.line}`);
  }
  if (missing.length > 20) console.log(`         … ${missing.length - 20} more`);
} else console.log(`  ok   all ${portDecls.size} port declarations present in src/`);

if (manyToOne.length) {
  fail++;
  console.log(`\n  FAIL ${manyToOne.length} src symbol(s) claimed by more than one port declaration:`);
  for (const [to, from] of manyToOne.slice(0, 20)) console.log(`         ${to}  ←  ${from.join(", ")}`);
  console.log(`         two declarations collapsed into one is a structural rewrite (readable-source.md §3.4)`);
} else console.log(`  ok   mapping is injective — no two port declarations share a src symbol`);

if (orphans.length) {
  fail++;
  console.log(`\n  FAIL ${orphans.length} src declaration(s) with no port origin:`);
  for (const n of orphans.slice(0, 20)) console.log(`         ${n}   ${srcDecls.get(n).file}:${srcDecls.get(n).line}`);
  if (orphans.length > 20) console.log(`         … ${orphans.length - 20} more`);
  console.log(`         invented code, or a rename missing from the map. Register it in`);
  console.log(`         REBUILD_PLAN §6 and add to allow_orphans, or remove it.`);
} else console.log(`  ok   no orphan declarations in src/`);

console.log(`\n  ⚠    identity only — this gate does not claim any of them behave correctly`);
console.log(`  ⚠    invented NAMES are invisible here: a wrong-but-plausible rename passes every`);
console.log(`       gate forever. Spot-check tier 2-4 entries by hand (readable-source.md §3.2).`);
console.log(fail ? `\nFAIL — ${fail} assertion(s) failed.` : `\nPASS — 3/3 assertions.`);
process.exit(fail ? 1 : 0);
