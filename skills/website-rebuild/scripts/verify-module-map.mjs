#!/usr/bin/env node
/**
 * verify-module-map.mjs — src/ is the port, one module per file, and nothing else.
 *
 * verify-symbols.mjs asks "does every top-level declaration in port/ map to
 * exactly one symbol in src/". That premise belongs to a FLAT-CONCATENATION
 * port, where top-level declarations are the units. A module-container port has
 * three top-level names in total and hundreds of units, so the symbol gate
 * reports the runtime's declarations as unmapped and every file as an orphan,
 * and means nothing by it.
 *
 * ⭐ At this shape the unit is the MODULE, and the check can be exact:
 *
 *   1. every module in the closure has exactly one file, and every file has
 *      exactly one module — no extras, duplicates, or silently dropped ids;
 *   2. each file's body is TOKEN-FOR-TOKEN the bytes the packer emitted, except
 *      where an identifier was renamed — and those renames must form one
 *      consistent bijection, the packer's own wrapper contract.
 *
 * ⛔ Compared as TOKENS, not as text with the rename undone. The first version
 * undid the rename by string replacement and reported 392 of 565 modules as
 * mismatched — because `module.exports` has `exports` as a PROPERTY, and a text
 * replace cannot tell a property from the binding. That is the same distinction
 * the splitter needed an AST for; a gate that reintroduces it is measuring its
 * own shortcut. A token stream separates them for free: a property token and a
 * binding token both appear, but the property's value is identical on both
 * sides, so it simply matches.
 *
 * ⛔ And the gate does NOT re-run the renamer to compare. A gate may not
 * reimplement the thing it audits (verification-gates.md §2.1.2) — it reads
 * both artefacts and checks a property that holds between them.
 *
 * Zero-dependency: the tokenizer is a PINNED npx spawn, never an import.
 *
 *   node scripts/verify-module-map.mjs --closure docs/app-closure.json --src src
 */
import { readFile, readdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const ACORN_VERSION = "8.14.0"; // PINNED — token shapes are the contract here.

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const MAP = JSON.parse(await readFile(path.resolve(flag("map", "docs/module-map.json")), "utf8"));
const CLO = JSON.parse(await readFile(path.resolve(flag("closure", "docs/app-closure.json")), "utf8"));
const SRCDIR = path.resolve(flag("src", "src"));
const MODDIR = path.join(SRCDIR, "modules");
const SRCTEXT = await readFile(path.resolve(MAP.source), "utf8");
const SRC = SRCTEXT.split("\n");

const byId = new Map(MAP.modules.map((m) => [String(m.id), m]));
const ids = CLO.modules.map(String);
// Recursive: a named tree carries directories (`vendor/swup/…/index.js`), and
// a flat readdir silently reports "0 files" against a full closure.
const files = (await readdir(MODDIR, { recursive: true })).filter((f) => f.endsWith(".js"));

let fail = 0;
console.log(`=== verify-module-map ===`);
console.log(`  closure ${ids.length} module(s)   src/modules ${files.length} file(s)\n`);

if (files.length !== ids.length) {
  fail++;
  console.log(`  FAIL count mismatch: ${ids.length} in the closure, ${files.length} on disk`);
} else console.log(`  ok   one file per module`);

// Index files by the module id their provenance header names — a renamed file
// is found by what it CLAIMS, never by its filename.
const claims = new Map();
for (const f of files) {
  const head = (await readFile(path.join(MODDIR, f), "utf8")).slice(0, 800);
  const m = head.match(/module `([^`]+)`/);
  if (m) claims.set(m[1], f);
}

// --- tokenize both sides in one batch --------------------------------------
// ⚠ One spawn per module would be ~600 process launches. Concatenate with a
// unique separator, tokenize once, split on the separator's token.
const tmp = await mkdtemp(path.join(tmpdir(), "modmap-"));
const SEP = "\n;\"__MODULE_BOUNDARY__\";\n";

const bodies = [];   // { id, file, srcText, origText }
const mismatches = [];
for (const id of ids) {
  const m = byId.get(id);
  // ⛔ Character offsets when the map has them. A Turbopack factory starts
  // mid-line, so a line slice carries the container prefix in with it — which
  // showed up here as every module being ~10 tokens longer on the packer's side
  // than in src/, a difference entirely manufactured by this gate.
  // ⛔ Both branches strip a leading `<id>:` key and a trailing comma with ONE
  // regex. module-map's startChar is the FACTORY start (nothing to strip), but a
  // synthesized char boundary that points at the id start — a minified-original
  // bounds table — used to keep the key on the packer's side and every module
  // came out exactly 2 tokens longer (14islands F16). The id may be written in
  // exponent form by the minifier (`71e3:` for 71000) — accept the full numeric
  // literal shape (F14).
  const KEY = /^\s*(?:"[^"]+"|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?(?:e\d+)?)\s*:\s*/;
  const origText = ((m.startChar != null && m.endChar != null)
    ? SRCTEXT.slice(m.startChar, m.endChar)
    : SRC.slice(m.startLine - 1, m.endLine).join("\n"))
        .replace(KEY, "").replace(/,\s*$/, "");
  const file = claims.get(id);
  if (!file) { fail++; mismatches.push(`${id}: no file claims it`); continue; }
  const text = await readFile(path.join(MODDIR, file), "utf8");
  const srcText = text.replace(/^[\s\S]*?\nexport default /, "").replace(/\n$/, "");
  bodies.push({ id, file, srcText, origText });
}

const tokenize = async (chunks, label) => {
  const file = path.join(tmp, label + ".js");
  await writeFile(file, chunks.map((c) => `(${c})`).join(SEP));
  const r = spawnSync("npx", ["-y", `acorn@${ACORN_VERSION}`, "--ecma2022", "--tokenize", file], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`FATAL — could not tokenize ${label}:\n${(r.stderr || "").slice(0, 400)}`); process.exit(5); }
  const all = JSON.parse(r.stdout);
  const out = [];
  let cur = [];
  for (const t of all) {
    if (t.type.label === "string" && t.value === "__MODULE_BOUNDARY__") { out.push(cur); cur = []; continue; }
    if (t.type.label === ";" && out.length !== bodies.length && cur.length === 0) continue;
    cur.push(t);
  }
  out.push(cur);
  return out;
};

const srcToks = await tokenize(bodies.map((b) => b.srcText), "src");
const origToks = await tokenize(bodies.map((b) => b.origText), "orig");
await rm(tmp, { recursive: true, force: true });

if (srcToks.length !== origToks.length || srcToks.length !== bodies.length) {
  console.error(`FATAL — boundary split disagreed: ${bodies.length} bodies, ${srcToks.length} src chunks, ${origToks.length} orig chunks.`);
  process.exit(5);
}

// The wrapper names a port is allowed to introduce, across both packers:
// webpack's (module, exports, require) and Turbopack's single (ctx).
// ⛔ Anything else renamed is not a wrapper rename and must fail — that is the
// whole point of the check.
const WRAP = new Set(["module", "exports", "require", "ctx"]);
let renamedModules = 0;
for (let i = 0; i < bodies.length; i++) {
  const b = bodies[i];
  const a = srcToks[i].filter((t) => t.type.label !== ";"), o = origToks[i].filter((t) => t.type.label !== ";");
  if (a.length !== o.length) { fail++; mismatches.push(`${b.file}: ${a.length} tokens vs ${o.length} in the packer's bytes`); continue; }
  const map = new Map();   // src identifier -> original identifier
  let bad = null, renamed = false;
  for (let k = 0; k < a.length; k++) {
    if (a[k].type.label !== o[k].type.label) { bad = `token ${k}: ${a[k].type.label} vs ${o[k].type.label}`; break; }
    if (String(a[k].value) === String(o[k].value)) continue;
    if (a[k].type.label !== "name") { bad = `token ${k}: literal ${JSON.stringify(a[k].value)} vs ${JSON.stringify(o[k].value)}`; break; }
    // An identifier may differ only as part of the wrapper rename, and the
    // mapping must be consistent across the whole module.
    if (!WRAP.has(String(a[k].value))) { bad = `token ${k}: renamed ${JSON.stringify(o[k].value)} to ${JSON.stringify(a[k].value)}, which is not a wrapper name`; break; }
    const prev = map.get(a[k].value);
    if (prev !== undefined && prev !== o[k].value) { bad = `${a[k].value} maps to both ${JSON.stringify(prev)} and ${JSON.stringify(o[k].value)}`; break; }
    map.set(a[k].value, o[k].value);
    renamed = true;
  }
  if (bad) { fail++; mismatches.push(`${b.file}: ${bad}`); continue; }
  if (renamed) renamedModules++;
}

console.log(`  ${bodies.length} module(s) compared token-for-token; ${renamedModules} carry a wrapper rename`);
if (mismatches.length) {
  console.log(`\n  FAIL ${mismatches.length} module(s) do not reconcile:`);
  for (const s of mismatches.slice(0, 8)) console.log(`         ${s}`);
  if (mismatches.length > 8) console.log(`         … ${mismatches.length - 8} more`);
} else console.log(`  ok   every module is token-identical to the packer's bytes, up to the wrapper rename`);

const claimed = new Set([...claims.values()]);
const unclaimed = files.filter((f) => !claimed.has(f));
if (unclaimed.length) {
  fail++;
  console.log(`\n  FAIL ${unclaimed.length} file(s) in src/modules with no module behind them:`);
  for (const f of unclaimed.slice(0, 8)) console.log(`         ${f}`);
} else console.log(`  ok   no file in src/modules is unaccounted for`);

console.log(fail ? `\nFAIL — ${fail} problem(s).` : `\nPASS — ${ids.length} module(s), one file each, token-exact.`);
process.exit(fail ? 1 : 0);
