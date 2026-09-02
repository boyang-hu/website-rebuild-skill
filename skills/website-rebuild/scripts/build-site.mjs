#!/usr/bin/env node
/**
 * build-site.mjs — the STRATEGY-A build layer: generate site/ from the pristine
 * mirror by applying ONLY the registered transforms in your shell-config.
 *
 * dom-shell-strategies.md §2: on a strategy-A target the platform-generated DOM
 * IS the byte-level specification, so every changed byte is an edit to the
 * source program and has to be registered, counted, and floored.
 *
 *   node scripts/build-site.mjs --config scripts/shell-config.mjs
 *   node scripts/build-site.mjs --config scripts/shell-config.mjs --check
 *   node scripts/build-site.mjs [--config scripts/shell-config.mjs] [--mirror mirror] [--out site] [--check]
 *
 *   --check   rebuild into site.check/ and diff against site/; exits non-zero on
 *             any difference. This is what makes "just regenerate it" a safe
 *             instruction rather than a hope.
 *
 * Config shape and every rule about it: scripts/shell-config.example.mjs.
 */
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { transformPage, transformIds } from "./lib/shell-build.mjs";
import { cli } from "./lib/cli.mjs";

cli({ known: ["config", "mirror", "out"], bools: ["check"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const CONFIG = flag("config", "scripts/shell-config.mjs");
const MIRROR = path.resolve(flag("mirror", "mirror"));
const OUT = path.resolve(flag("out", "site"));
const CHECK = args.includes("--check");

const cfg = (await import(pathToFileURL(path.resolve(CONFIG)).href)).default;
const PAGES = cfg.pages || [];
if (!PAGES.length) {
  console.error(`FATAL: ${CONFIG} lists no pages.`);
  process.exit(2);
}

const target = CHECK ? OUT + ".check" : OUT;
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

const ids = transformIds(cfg);
const totals = new Map(ids.map((id) => [id, 0]));
const subTotals = new Map();
const identical = [];
const survivors = [];
const report = { config: CONFIG, pages: [] };

for (const page of PAGES) {
  const src = await readFile(path.join(MIRROR, page.rel), "utf8");
  const { text, hits, sub } = transformPage(src, cfg);
  if (text === src) identical.push(page.rel);
  for (const [k, n] of hits) totals.set(k, (totals.get(k) || 0) + n);
  for (const [k, n] of sub) subTotals.set(k, (subTotals.get(k) || 0) + n);

  // Purpose checks: what a remove/replace transform is FOR cannot be stated by
  // a hit count. Values come from the MIRROR at build time, never hard-coded.
  for (const chk of cfg.purposeChecks || []) {
    for (const v of chk.values(src) || []) {
      if (v && text.includes(v)) survivors.push(`${page.rel}: ${chk.name} — ${String(v).slice(0, 16)}… survived`);
    }
  }

  const dst = path.join(target, page.rel);
  await mkdir(path.dirname(dst), { recursive: true });
  await writeFile(dst, text);
  report.pages.push({
    rel: page.rel,
    mirrorBytes: Buffer.byteLength(src),
    builtBytes: Buffer.byteLength(text),
    transforms: Object.fromEntries([...hits].sort()),
  });
}

for (const x of cfg.extras || []) {
  const body = await readFile(path.resolve(x.from));
  const dst = path.join(target, x.to);
  await mkdir(path.dirname(dst), { recursive: true });
  await writeFile(dst, body);
}

await writeFile(path.join(target, "build-report.json"), JSON.stringify(report, null, 2) + "\n");

// ---------------------------------------------------------------------------
// THE DEFENCE (dom-shell-strategies.md §2 step 3). "Zero transforms => throw"
// stated as a PER-TRANSFORM floor: "some transform fired" is not the property
// that matters. Without this a changed mirror ships shells that quietly point
// at the live origin and carry no noindex.
// ---------------------------------------------------------------------------
const problems = [];
for (const id of ids) {
  const min = (cfg.floors || {})[id];
  if (min === undefined) { problems.push(`transform ${id} has no floor in ${CONFIG} — an unfloored transform is an unguarded one`); continue; }
  const n = totals.get(id);
  if (n < min) problems.push(`transform ${id} fired ${n}x, floor ${min}`);
}
if (survivors.length) {
  problems.push(`${survivors.length} purpose-check survivor(s) — the hit counts above say nothing about this:\n       ` + survivors.join("\n       "));
}
if (identical.length) {
  problems.push(`${identical.length} page(s) came out byte-identical to the mirror: ${identical.join(", ")}`);
}

console.log(`=== build-site -> ${path.relative(process.cwd(), target)} ===`);
for (const p of report.pages) {
  console.log(`  ${p.rel}\n     ${p.mirrorBytes} B -> ${p.builtBytes} B   ${Object.entries(p.transforms).map(([k, n]) => `${k}=${n}`).join(" ")}`);
}
console.log(`  totals:  ${ids.map((id) => `${id}=${totals.get(id)}`).join("  ")}`);
if (subTotals.size) console.log(`  rules:   ${[...subTotals].sort().map(([k, n]) => `${k}=${n}`).join("  ")}`);

if (CHECK) {
  let diffs = 0;
  const walk = async (dir, base = "") => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const rel = path.join(base, e.name);
      if (e.isDirectory()) { await walk(path.join(dir, e.name), rel); continue; }
      const a = await readFile(path.join(target, rel)).catch(() => null);
      const b = await readFile(path.join(OUT, rel)).catch(() => null);
      if (!a || !b || !a.equals(b)) { diffs++; console.log(`  DIFF ${rel}`); }
    }
  };
  await walk(target);
  await rm(target, { recursive: true, force: true });
  if (diffs) problems.push(`--check: ${diffs} file(s) differ from ${path.relative(process.cwd(), OUT)}`);
  else console.log("  ok --check: the build reproduces site/ byte for byte");
}

if (problems.length) {
  console.log("");
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\nFAIL — ${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`\nPASS — ${report.pages.length} shells, every registered transform above its floor.`);
