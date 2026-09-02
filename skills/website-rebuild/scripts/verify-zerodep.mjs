#!/usr/bin/env node
/**
 * verify-zerodep.mjs — scripts/ stays zero-dependency, and gates stay gates.
 *
 * The skill states two disciplines: everything in scripts/ is a criterion and
 * must run anywhere with no install, and no gate may import a producer
 * (verification-gates.md §2.1.2 — the checker cannot be the producer).
 *
 * Both were already broken when this was written. `module-map.mjs` imported
 * @babel/* and sat in scripts/ for eight releases, three lines below the
 * paragraph forbidding it. ⛔ A rule that lives only in prose, with nothing
 * checking it, fails silently — and the check costs almost nothing.
 *
 *   node scripts/verify-zerodep.mjs [--dir scripts] [--tools tools]
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cli } from "./lib/cli.mjs";

cli({ known: ["dir", "tools"], bools: [], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const DIR = path.resolve(flag("dir", "scripts"));
const TOOLS = flag("tools", "tools");

const walk = async (d, out = []) => {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
};

const files = await walk(DIR);
if (files.length === 0) {
  console.log(`FATAL — no scripts found under ${DIR}. A check that finds nothing agrees with everything.`);
  process.exit(5);
}

// Static import + dynamic import() + require(). A bare specifier is anything
// that is not node:, not relative, and not absolute.
const SPECIFIER = /(?:^|\s)(?:import\s[^;]*?from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

let fail = 0;
const deps = [], producers = [];

for (const f of files) {
  const text = await readFile(f, "utf8");
  const rel = path.relative(process.cwd(), f);
  // Strip comments so prose about a forbidden import is not itself a violation.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const m of code.matchAll(SPECIFIER)) {
    const spec = m[1];
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) {
      // ⛔ A gate reaching into tools/ is the §2.1.2 violation, not a dep one.
      if (spec.includes(`/${TOOLS}/`) || spec.startsWith(`../${TOOLS}/`)) producers.push({ rel, spec });
      continue;
    }
    deps.push({ rel, spec });
  }
}

console.log(`=== verify-zerodep ===`);
console.log(`  ${files.length} file(s) under ${path.relative(process.cwd(), DIR) || DIR}\n`);

if (deps.length) {
  fail++;
  console.log(`  FAIL ${deps.length} external import(s) in a directory that must install nothing:`);
  for (const d of deps) console.log(`         ${d.rel}  ->  ${d.spec}`);
  console.log(`\n       Move the file to ${TOOLS}/ if it PRODUCES something. Criteria stay here.`);
} else console.log(`  ok   no external imports (node: / relative only)`);

if (producers.length) {
  fail++;
  console.log(`\n  FAIL ${producers.length} gate(s) import a producer — the checker cannot be the producer:`);
  for (const p of producers) console.log(`         ${p.rel}  ->  ${p.spec}`);
} else console.log(`  ok   no gate imports ${TOOLS}/`);

console.log(fail ? `\nFAIL — ${fail} assertion(s) failed.` : `\nPASS — scripts/ is zero-dependency and imports no producer.`);
process.exit(fail ? 1 : 0);
