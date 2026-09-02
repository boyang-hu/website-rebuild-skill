#!/usr/bin/env node
/**
 * cold-audit-decls.mjs — M(n) cold-head roll-call for FLAT (scope-hoisted) bundles.
 *
 * cold-audit-modules.mjs does the roll-call when the packer left module
 * boundaries in the file (webpack / Turbopack containers). A Vite / esbuild /
 * Rollup scope-hoisted bundle has none: the whole site is one scope, and the
 * unit of "did we port it" is the TOP-LEVEL DECLARATION — every `class X`,
 * `function X`, and every binding of a depth-0 `const|let|var` chain. This gate
 * lists those, restricts them to the application regions (vendor regions are
 * npm replacements, registered as such), and asks of each one: where did it
 * land in the port?
 *
 * Verdict per declaration, in order of strength:
 *   cited     a port file cites a `_pretty` line range that CONTAINS the
 *             declaration's line (`pretty L63486-L63732`, `@L60584`,
 *             `L30456-64` short-suffix form) — the port's own coordinate system
 *   override  registered in --overrides: `collapsed` (npm / library replaces it),
 *             `omitted` (registered dead code / not ported, with the reason),
 *             `ported` (a human verdict for a declaration the citation scan
 *             cannot see, with the file it lives in)
 *   named     the compressed name survives as a marker in a port COMMENT
 *             (`// Xx0`) — weak, listed for a human, never a pass by itself
 *   UNKNOWN   none of the above → exit 1. This is the roll-call's whole point:
 *             a function test cannot see a missing block; only a list can
 *             (gate-case-design.md §3). It reports `n/N examined` because a
 *             check that does not say how much it looked at is silent, not green
 *             (§0.24.0).
 *
 * Why a scan and not a person: the samsyninja M11.1 cold review checked 60
 * top-level classes of one region by hand and found a real gap (the editor
 * raycast-box factory). It never wrote down which OTHER regions it had read,
 * so nobody can rerun it. This is that review as a script, over every region.
 *
 *   node cold-audit-decls.mjs --pretty mirror/_pretty/main.pretty.js \
 *        --ranges 34-42,30432-30669,59956-70561 --port port \
 *        [--overrides docs/cold-audit-overrides.json] [--json docs/cold-audit.json]
 *        [--min-name 3] [--cite-tag pretty] [--slack 1]
 *
 * --slack N: a citation range may miss a declaration by N lines (a header that
 * cites `L60740-L60843` for a block whose singleton `t3 = new m80` sits on
 * L60844 — measured). Default 1; 0 for the strict reading.
 * Names shorter than --min-name (the `t3`, `Q0`, `$9` of a minified scope) are
 * still matched as markers, but only inside a comment that ALSO carries a
 * line citation (`pretty L…`) and only as a standalone token next to `/`, `(`,
 * `)`, `,`, `:` or whitespace — the alias form `t3/m80`, `(Ki)`, `Tu0 dp` — so
 * an English "On" or "Be" in prose cannot vouch for a declaration.
 *
 * Overrides file shape:
 *   { "ranges": [ { "from": 46397, "to": 47023, "bucket": "collapsed", "reason": "…",
 *                   "match": "= \\{\\s*\\n\\s*(class|ref|key):" } ],
 *     "decls":  [ { "name": "Ka0", "line": 47265, "bucket": "omitted", "reason": "…" } ] }
 * A range override with `match` applies only to declarations whose source line
 * (plus the next line) matches the regex — the way to register "the compiled
 * template's hoisted vnode-prop literals in this component region" without
 * excusing the component logic that sits between them.
 * A decl override needs name AND line (names repeat in a minified scope). An
 * override that names a declaration the scan cannot find is FATAL — a silently
 * inert override looks exactly like one that worked (readable-source.md §3.0.1.2).
 *
 * Zero-dependency: the tokenizer is a version-pinned `npx acorn` spawn
 * (lib/tokens.mjs's rule: parse on a token stream, never on text — F27).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ACORN_VERSION = "8.14.0";
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const KNOWN = new Set(["pretty", "ranges", "port", "overrides", "json", "min-name", "cite-tag", "slack"]);
for (const a of args) if (a.startsWith("--") && !KNOWN.has(a.slice(2))) { console.error(`FATAL: unknown flag ${a}`); process.exit(2); }
const PRETTY = flag("pretty", null);
const PORT = flag("port", null);
const RANGES_RAW = flag("ranges", null);
const OVERRIDES = flag("overrides", null);
const JSON_OUT = flag("json", null);
const MIN_NAME = Number(flag("min-name", 3));
const CITE_TAG = flag("cite-tag", "pretty");
const SLACK = Number(flag("slack", 1));
if (!PRETTY || !PORT || !RANGES_RAW) {
  console.error("usage: cold-audit-decls.mjs --pretty <file> --ranges a-b,c-d --port <dir> [--overrides f.json] [--json out.json] [--min-name 3] [--cite-tag pretty]");
  process.exit(2);
}
const ranges = RANGES_RAW.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
  const m = /^(\d+)-(\d+)$/.exec(s);
  if (!m || Number(m[1]) > Number(m[2])) { console.error(`FATAL: bad range "${s}" (want a-b)`); process.exit(2); }
  return { from: Number(m[1]), to: Number(m[2]) };
});
const inRanges = (line) => ranges.some((r) => line >= r.from && line <= r.to);

// --- 1. top-level declarations of the pretty file, on the token stream ---------
const src = readFileSync(PRETTY, "utf8");
const lineStarts = [0];
for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);
const lineOf = (off) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; };
const totalLines = lineStarts.length;

const r = spawnSync("npx", ["-y", `acorn@${ACORN_VERSION}`, "--ecma2022", "--module", "--tokenize", "--compact", PRETTY], { encoding: "utf8", maxBuffer: 2 ** 31 });
if (r.status !== 0) { console.error(`FATAL: acorn@${ACORN_VERSION} failed on ${PRETTY}: ${(r.stderr || "").split("\n")[0]}`); process.exit(2); }
const toks = JSON.parse(r.stdout).map((t) => ({ l: typeof t.type === "object" ? t.type.label : t.type, v: t.value, s: t.start }));
const OPEN = new Set(["{", "(", "[", "${"]);
const CLOSE = new Set(["}", ")", "]"]);
const STMT_KW = new Set(["class", "function", "const", "let", "var", "if", "for", "while", "do", "switch", "return", "export", "import", "try", "throw", "async"]);
const decls = []; // { name, kind, line }
let depth = 0;
for (let i = 0; i < toks.length; i++) {
  const t = toks[i];
  if (OPEN.has(t.l)) { depth++; continue; }
  if (CLOSE.has(t.l)) { depth--; continue; }
  if (depth !== 0) continue;
  const kw = t.l === "name" || t.l === "class" || t.l === "function" || t.l === "const" || t.l === "var" ? t.v : t.l;
  const word = typeof kw === "string" ? kw : "";
  // `export` prefix: fall through to the declaration that follows
  if (word === "class" && toks[i + 1]?.l === "name") { decls.push({ name: toks[i + 1].v, kind: "class", line: lineOf(toks[i + 1].s) }); continue; }
  if (word === "function") {
    let j = i + 1;
    if (toks[j]?.l === "*") j++;
    if (toks[j]?.l === "name") decls.push({ name: toks[j].v, kind: "function", line: lineOf(toks[j].s) });
    continue;
  }
  if (word === "const" || word === "let" || word === "var") {
    // walk the declarator chain at depth 0 until `;` or the next statement keyword
    let j = i + 1, expectName = true, d = 0;
    for (; j < toks.length; j++) {
      const u = toks[j];
      if (OPEN.has(u.l)) {
        if (expectName && d === 0 && (u.l === "{" || u.l === "[")) {
          // destructuring pattern: collect the LOCAL names at pattern depth 1
          let k = j + 1, pd = 1;
          for (; k < toks.length && pd > 0; k++) {
            const w = toks[k];
            if (OPEN.has(w.l)) { pd++; continue; }
            if (CLOSE.has(w.l)) { pd--; continue; }
            if (pd !== 1 || w.l !== "name") continue;
            const next = toks[k + 1], prev = toks[k - 1];
            // `a: b` → b is the local; `a` before `:` is a property key, skip it
            if (next && next.l === ":") continue;
            if (prev && (prev.l === "," || prev.l === "{" || prev.l === "[" || prev.l === ":" || prev.l === "...")) decls.push({ name: w.v, kind: `${word}-destructured`, line: lineOf(w.s) });
          }
          j = k - 1; // now at the closing bracket; the outer loop will see the next token
          expectName = false;
          continue;
        }
        d++; continue;
      }
      if (CLOSE.has(u.l)) { if (d === 0) break; d--; continue; }
      if (d !== 0) continue;
      if (u.l === ";") break;
      if (u.l === ",") { expectName = true; continue; }
      if (expectName && u.l === "name") { decls.push({ name: u.v, kind: word, line: lineOf(u.s) }); expectName = false; continue; }
      if (u.l === "name" && STMT_KW.has(u.v) && expectName) break;
      if ((u.l === "class" || u.l === "function" || u.l === "const" || u.l === "var") && expectName) break;
    }
    i = j - 1;
    continue;
  }
}
const examined = decls.filter((d) => inRanges(d.line));
const coveredLines = ranges.reduce((t, r) => t + (Math.min(r.to, totalLines) - r.from + 1), 0);

// --- 2. what the port cites ------------------------------------------------------
const portFiles = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "public" || e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(m?js|html|vue|ts)$/.test(e.name)) portFiles.push(p);
  }
})(PORT);
const intervals = []; // { from, to, file }
const commentText = []; // { file, text }
const CITE = /\b(pretty|baker|worker)?\s*@?L(\d{1,6})(?:\s*[-–]\s*L?(\d{1,6}))?\b/g;
for (const f of portFiles) {
  const text = readFileSync(f, "utf8");
  const comments = [...text.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|<!--[\s\S]*?-->/g)].map((m) => m[0]).join("\n");
  commentText.push({ file: f, text: comments });
  for (const m of comments.matchAll(CITE)) {
    const tag = (m[1] || "").toLowerCase();
    if (tag && tag !== CITE_TAG) continue; // a citation into another pretty file (the worker)
    const a = Number(m[2]);
    let b = m[3] ? Number(m[3]) : a;
    if (m[3] && m[3].length < m[2].length) b = Number(m[2].slice(0, m[2].length - m[3].length) + m[3]); // L30456-64 → 30456..30464
    if (b < a) b = a;
    intervals.push({ from: a, to: b, file: path.relative(PORT, f) });
  }
}
const citedBy = (line) => intervals.filter((iv) => line >= iv.from - SLACK && line <= iv.to + SLACK);
const esc = (name) => name.replace(/[$]/g, "\\$");
const namedIn = (name) => {
  if (name.length >= MIN_NAME) {
    const re = new RegExp(`(^|[^A-Za-z0-9_$])${esc(name)}(?![A-Za-z0-9_$])`);
    return commentText.filter((c) => re.test(c.text)).map((c) => path.relative(PORT, c.file));
  }
  // short name: marker context + a citation in the same comment line
  const re = new RegExp(`(^|[\\s(/,:→=])${esc(name)}(?=[\\s)/,:.;→=]|$)`);
  const out = [];
  for (const c of commentText) {
    for (const line of c.text.split("\n")) {
      if (/\bL\d{2,6}\b/.test(line) && re.test(line)) { out.push(path.relative(PORT, c.file)); break; }
    }
  }
  return out;
};

// --- 3. overrides ----------------------------------------------------------------
const ov = OVERRIDES ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : { ranges: [], decls: [] };
const BUCKETS = new Set(["collapsed", "omitted", "ported"]);
for (const o of [...(ov.ranges || []), ...(ov.decls || [])]) {
  if (!BUCKETS.has(o.bucket) || !o.reason) { console.error(`FATAL: override needs bucket ∈ {collapsed,omitted,ported} and a reason: ${JSON.stringify(o)}`); process.exit(2); }
}
const declOv = new Map((ov.decls || []).map((o) => [`${o.name}@${o.line}`, o]));
for (const o of ov.decls || []) {
  if (!decls.some((d) => d.name === o.name && d.line === o.line)) {
    const near = decls.filter((d) => d.name === o.name).map((d) => d.line);
    console.error(`FATAL: override names a declaration the scan cannot find: ${o.name}@${o.line}${near.length ? ` — did you mean ${o.name}@${near.join("/")}?` : ""}`);
    process.exit(2);
  }
}
const srcLines = src.split("\n");
const rangeOv = (line) => (ov.ranges || []).find((o) => {
  if (line < o.from || line > o.to) return false;
  if (!o.match) return true;
  const two = `${srcLines[line - 1] ?? ""}\n${srcLines[line] ?? ""}`;
  return new RegExp(o.match).test(two);
});

// --- 4. verdicts -------------------------------------------------------------------
const rows = examined.map((d) => {
  const c = citedBy(d.line);
  const o = declOv.get(`${d.name}@${d.line}`) || rangeOv(d.line);
  const n = namedIn(d.name);
  const verdict = c.length ? "cited" : o ? o.bucket : n.length ? "named" : "UNKNOWN";
  return { ...d, verdict, cites: [...new Set(c.map((x) => x.file))].slice(0, 3), override: o ? o.reason : null, named: n.slice(0, 3) };
});
const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`=== cold-audit-decls === ${path.basename(PRETTY)}: ${decls.length} top-level declarations in ${totalLines} lines`);
console.log(`  examined ${examined.length}/${decls.length} declarations — the ${ranges.length} range(s) cover ${coveredLines} of ${totalLines} lines`);
console.log(`  port: ${portFiles.length} file(s), ${intervals.length} line-range citation(s)`);
console.log(`  cited ${count("cited")}   collapsed ${count("collapsed")}   omitted ${count("omitted")}   ported(override) ${count("ported")}   named-only ${count("named")}   UNKNOWN ${count("UNKNOWN")}`);
const show = (v, cap = 40) => {
  const list = rows.filter((r) => r.verdict === v);
  if (!list.length) return;
  console.log(`\n  --- ${v} (${list.length}) ---`);
  for (const r of list.slice(0, cap)) console.log(`    L${String(r.line).padEnd(6)} ${r.kind.padEnd(18)} ${r.name.padEnd(14)} ${r.cites.length ? "← " + r.cites.join(", ") : r.override ? "(" + r.override.slice(0, 70) + ")" : r.named.length ? "name in comment: " + r.named.join(", ") : ""}`);
  if (list.length > cap) console.log(`    … ${list.length - cap} more`);
};
show("named");
show("UNKNOWN", 200);
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify({ pretty: PRETTY, ranges, examined: rows, totals: { decls: decls.length, examined: examined.length, cited: count("cited"), collapsed: count("collapsed"), omitted: count("omitted"), ported: count("ported"), named: count("named"), unknown: count("UNKNOWN") } }, null, 2)); console.log(`\n  wrote ${JSON_OUT}`); }
const unknown = count("UNKNOWN"), named = count("named");
console.log(`\n${unknown ? "FAIL" : "PASS"} — ${examined.length}/${decls.length} examined; ${unknown} UNKNOWN (must be cited, or registered in overrides)${named ? `; ${named} named-only — a human reads those` : ""}`);
process.exit(unknown ? 1 : 0);
