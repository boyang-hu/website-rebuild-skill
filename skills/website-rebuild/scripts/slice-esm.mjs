#!/usr/bin/env node
/**
 * slice-esm.mjs — CONCATENATIVE decomposition of a scope-hoisted ESM chunk.
 *
 * The problem: Vite (and esbuild) erase module boundaries. A webpack container
 * WRITES boundaries down and modules-to-src.mjs just reads them; a
 * scope-hoisted chunk is one shared scope where hundreds of source modules
 * were concatenated, renamed, and interleaved — there is no boundary evidence
 * to read, and readable-source.md §3.1's three constraints (declaration order
 * = evaluation order, shared minified names, TDZ) make any REWRITING split a
 * silent-reorder machine.
 *
 * The escape is to not rewrite: SLICE the chunk into ordered files whose
 * concatenation reproduces the original BYTE FOR BYTE. The parts stay the same
 * program text, so evaluation order and scope are untouched by construction,
 * and the gate is one hash comparison (verify-reassembly.mjs) instead of a
 * semantic-equivalence argument. What is left to decide is only WHERE to cut
 * and WHAT to call each piece — evidence work, this skill's home ground.
 *
 * ⛔ Cut points must be PROVABLY safe, and provable is cheap here:
 *   depth 0  +  previous token is `;` or `}`  +  next token begins a
 *   declaration/import/export statement. Missing a boundary only makes a
 *   coarser slice; a wrong boundary would corrupt the program — so the rule
 *   only fires where it cannot be wrong, and everything else attaches to the
 *   preceding slice.
 * ⛔ Parts carry NO added headers. One added comment breaks reassembly; all
 *   metadata lives in the sidecar manifest (slices.json) and the chunk README.
 * ⭐ The tool re-concatenates and compares sha256 BEFORE writing anything —
 *   it refuses to emit a decomposition it cannot itself reassemble.
 *
 * File-grouping policy (presentation only — reassembly ignores it):
 *   a new file starts at each top-level `class X` / `const X = class` /
 *   license banner (`/*!`), or a named `function X` of >= --fn-lines lines;
 *   the leading import run becomes 000-imports.js, a trailing `export {…}`
 *   becomes the last part. Everything between anchors belongs to the anchor
 *   before it. Names are the declaration's own identifiers — tier-1 literal
 *   evidence, never invented (a wrong name is worse than a hash).
 *
 *   node scripts/slice-esm.mjs --in src/site/_nuxt/DqcYvDA3.js \
 *        --out src/readable/DqcYvDA3 [--fn-lines 12]
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { cli } from "./lib/cli.mjs";
import { sha256 } from "./lib/hash.mjs";

cli({ known: ["in", "out", "fn-lines"], bools: [], file: import.meta.url });

const ACORN_VERSION = "8.14.0"; // PINNED — token shapes are the contract.

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const IN = flag("in", null);
const OUT = flag("out", null);
const FN_LINES = Number(flag("fn-lines", "12"));
if (!IN || !OUT) {
  console.error("usage: slice-esm.mjs --in <chunk.js> --out <dir> [--fn-lines 12]");
  process.exit(2);
}
// Unknown flags are rejected by lib/cli.mjs (the one argv contract) before anything here runs.

const SRC = await readFile(path.resolve(IN), "utf8");
const CHUNK_SHA = sha256(SRC);

// Tokenize with the same pinned-npx pattern as module-map.mjs — never a
// hand-rolled lexer (a regex literal containing a quote once desynced one by
// 16,177 lines). --module: these are ESM chunks, import/export are statements.
const r = spawnSync("npx", ["-y", `acorn@${ACORN_VERSION}`, "--ecma2024", "--module", "--tokenize", path.resolve(IN)], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 1024,
});
if (r.status !== 0) {
  console.error(`FATAL — acorn@${ACORN_VERSION} could not tokenize ${IN}.`);
  console.error((r.stderr || "").split("\n").slice(0, 8).join("\n"));
  process.exit(5);
}
let T;
try { T = JSON.parse(r.stdout); } catch (e) {
  console.error(`FATAL — acorn output unreadable: ${e.message}`);
  process.exit(5);
}
const lab = (i) => T[i]?.type?.label ?? T[i]?.type?.keyword;
const kw = (i) => T[i]?.type?.keyword;
const val = (i) => T[i]?.value;

// Depth BEFORE each token. `${` opens a brace context closed by a plain `}` —
// counting only `{` drifts negative once per template interpolation.
const OPEN = new Set(["{", "[", "(", "${"]);
const CLOSE = new Set(["}", "]", ")"]);
const depthBefore = new Int32Array(T.length);
{
  let d = 0;
  for (let i = 0; i < T.length; i++) {
    depthBefore[i] = d;
    const l = lab(i);
    if (OPEN.has(l)) d++;
    else if (CLOSE.has(l)) d--;
  }
  if (d !== 0) {
    console.error(`FATAL — token depth ended at ${d}, not 0; every boundary derived from it would be wrong.`);
    process.exit(5);
  }
}

// A statement-starting token this tool recognises as a SAFE cut target.
const STMT_KW = new Set(["import", "export", "class", "function", "const", "var", "let"]);
const startsStatement = (i) => {
  const k = kw(i) ?? lab(i);
  if (STMT_KW.has(k)) return true;
  // `async function` — acorn emits `async` as a name token.
  if (lab(i) === "name" && val(i) === "async" && (kw(i + 1) ?? lab(i + 1)) === "function") return true;
  return false;
};

// ---- collect cut candidates -------------------------------------------------
// cuts[k] = index of the token that begins slice k (token 0 implicit).
const cuts = [];
for (let i = 1; i < T.length; i++) {
  if (depthBefore[i] !== 0) continue;
  const prev = lab(i - 1);
  if (prev !== ";" && prev !== "}") continue;
  if (!startsStatement(i)) continue;
  cuts.push(i);
}

// ---- describe what each candidate declares ---------------------------------
const declOf = (i) => {
  let j = i;
  const k0 = kw(j) ?? lab(j);
  if (k0 === "export") { j++; if ((kw(j) ?? lab(j)) === "default") j++; }
  let k = kw(j) ?? lab(j);
  if (lab(j) === "name" && val(j) === "async") { j++; k = kw(j) ?? lab(j); }
  if (k === "class") return { kind: "class", name: lab(j + 1) === "name" ? String(val(j + 1)) : null };
  if (k === "function") {
    const star = lab(j + 1) === "*" ? 1 : 0;
    return { kind: "function", name: lab(j + 1 + star) === "name" ? String(val(j + 1 + star)) : null };
  }
  if (k === "const" || k === "let" || k === "var") {
    const name = lab(j + 1) === "name" ? String(val(j + 1)) : null;
    // const X = class …  — a class in const clothing anchors like a class.
    if (name && lab(j + 2) === "=" && (kw(j + 3) ?? lab(j + 3)) === "class") return { kind: "class", name };
    return { kind: "var", name };
  }
  if (k0 === "import") return { kind: "import", name: null };
  if (k0 === "export") return { kind: "export", name: null };
  return { kind: "stmt", name: null };
};

// ---- choose FILE anchors ----------------------------------------------------
// Trivia between two tokens is by definition only whitespace + comments, so a
// cut may be moved anywhere inside it. It lands just after the last newline
// preceding the anchor token: full comment lines (license banners, doc runs)
// travel WITH the declaration they document, same-line trailing trivia stays
// with the previous slice.
const cutOffset = (i) => {
  const trivia = SRC.slice(T[i - 1].end, T[i].start);
  const nl = trivia.lastIndexOf("\n");
  return nl < 0 ? T[i].start : T[i - 1].end + nl + 1;
};
const lineOf = (off) => { let n = 1; for (let p = 0; p >= 0 && p < off; p = SRC.indexOf("\n", p + 1)) n++; return n; };

const anchors = []; // {tok, off, name, kind}
for (const i of cuts) {
  const d = declOf(i);
  const off = cutOffset(i);
  const trivia = SRC.slice(T[i - 1].end, T[i].start);
  const banner = trivia.includes("/*!");
  let isAnchor = false;
  if (d.kind === "class" && d.name) isAnchor = true;
  else if (banner) isAnchor = true;
  else if (d.kind === "function" && d.name) {
    // body length in lines decides — a 3-line helper does not deserve a file.
    const end = (() => { let dd = 0; for (let j = i; j < T.length; j++) { const l = lab(j); if (OPEN.has(l)) dd++; else if (CLOSE.has(l)) { dd--; if (dd === 0 && l === "}") return T[j].end; } } return T[i].end; })();
    const lines = SRC.slice(off, end).split("\n").length;
    if (lines >= FN_LINES) isAnchor = true;
  } else if (d.kind === "import" && anchors.length === 0) isAnchor = false; // leading imports stay in the preamble
  else if (d.kind === "export") {
    // a trailing `export {…}` / `export default` run gets its own part.
    isAnchor = true; d.name = d.name || "exports";
  }
  if (isAnchor) anchors.push({ tok: i, off, name: d.name || "part", kind: d.kind });
}

// ---- emit -------------------------------------------------------------------
const base = path.basename(IN).replace(/\.m?js$/, "");
const outDir = path.resolve(OUT);
const bounds = [0, ...anchors.map((a) => a.off), SRC.length];
const names = ["imports", ...anchors.map((a) => a.name)];
const kinds = ["preamble", ...anchors.map((a) => a.kind)];
const seen = new Map();
const parts = [];
for (let k = 0; k + 1 < bounds.length; k++) {
  const [s, e] = [bounds[k], bounds[k + 1]];
  if (s >= e) continue;
  const text = SRC.slice(s, e);
  let nm = String(names[k]).replace(/[^A-Za-z0-9_$-]/g, "_");
  const dup = seen.get(nm) || 0; seen.set(nm, dup + 1);
  if (dup) nm = `${nm}-${dup + 1}`;
  parts.push({
    file: `${String(parts.length).padStart(3, "0")}-${nm}.js`,
    kind: kinds[k], start: s, end: e, startLine: lineOf(s),
    lines: text.split("\n").length, bytes: Buffer.byteLength(text), sha256: sha256(text), text,
  });
}

// ⭐ Prove reassembly BEFORE writing: the tool never emits a decomposition it
// cannot put back together.
if (sha256(parts.map((p) => p.text).join("")) !== CHUNK_SHA) {
  console.error("FATAL — reassembled slices do not hash back to the input. Nothing written.");
  process.exit(5);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
for (const p of parts) await writeFile(path.join(outDir, p.file), p.text);
await writeFile(path.join(outDir, "slices.json"), JSON.stringify({
  note: "Concatenative decomposition: parts joined in order reproduce the chunk byte-for-byte. verify-reassembly.mjs is the gate.",
  chunk: path.relative(path.dirname(outDir), path.resolve(IN)),
  chunkSha256: CHUNK_SHA, chunkBytes: Buffer.byteLength(SRC),
  acorn: ACORN_VERSION,
  parts: parts.map(({ text, ...rest }) => rest),
}, null, 1));

console.log(`=== slice-esm  ${path.basename(IN)} ===`);
console.log(`  ${SRC.split("\n").length} lines -> ${parts.length} part(s); ${cuts.length} safe boundaries seen, ${anchors.length} anchored`);
const top = [...parts].sort((a, b) => b.lines - a.lines).slice(0, 5);
for (const p of top) console.log(`    ${String(p.lines).padStart(7)} lines  ${p.file}`);
console.log(`  reassembly self-check PASS (sha256 ${CHUNK_SHA.slice(0, 12)}…)`);
console.log(`  -> ${OUT}/slices.json`);
