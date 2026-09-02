#!/usr/bin/env node
/**
 * verify-refs-served.mjs — every asset reference in the built site must be
 * ANSWERED BY THE SERVER.
 *
 * ⭐ Asks the server, not a reimplementation of it. An offline check that walks
 * the mirror by hand is a second copy of url->path resolution, and a second
 * copy is a disagreement waiting to be reported as a hole — measured here: it
 * called 28 present images missing because it did not know the server's
 * query-variant fallback.
 *
 * ⚠ This is cheap on purpose: one HEAD per distinct reference, no browser. It
 * cannot see a URL assembled at runtime; that is the resource-level probe's job
 * (verification-gates.md §1.6 class 4).
 *
 *   node scripts/verify-refs-served.mjs --base http://127.0.0.1:6376 --dir site [--allow mirror/external.txt]
 */
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { joinFlightPushes } from "./lib/extract-refs.mjs";
import { cli } from "./lib/cli.mjs";

cli({ known: ["base", "dir", "allow"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const BASE = flag("base", "http://127.0.0.1:6376").replace(/\/$/, "");
const DIR = path.resolve(flag("dir", "site"));

// --allow FILE — the SAME registered-deviation list verify-mirror consumes
// (mirror/external.txt): a URL the ORIGIN ITSELF cannot answer (its own 404)
// is a deviation to record, not a hole this port must invent a file for.
// Matching is exact, on the excused URL's pathname; no prefix wildcards here.
const ALLOW = new Set();
{
  const f = flag("allow", null);
  if (f && existsSync(f)) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      try { ALLOW.add(new URL(s).pathname); } catch { if (s.startsWith("/")) ALLOW.add(s); }
    }
  }
}

const files = [];
await (async function walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) await walk(p); else if (e.name.endsWith(".html")) files.push(p);
  }
})(DIR);

const refs = new Set();
for (const f of files) {
  let t = await readFile(f, "utf8");
  t = joinFlightPushes(t) ?? t;
  const dec = t.replace(/\\u002[fF]/g, "/").replace(/&amp;/g, "&").replace(/\\"/g, '"');
  for (const src of [t, dec]) {
    // ⚠ ")" allowed, trimmed only when unbalanced — a filename really can be
    // "… (1).jpg", and excluding ")" outright truncates the reference into one
    // the server rightly cannot answer. Same trap as lib/extract-refs.mjs.
    for (const m of src.matchAll(/\/_next\/image\?[^"'\\\s<>]+/g)) {
      let r = m[0].replace(/&amp;/g, "&");
      while (r.endsWith(")") && (r.match(/\(/g) || []).length < (r.match(/\)/g) || []).length) r = r.slice(0, -1);
      refs.add(r);
    }
    for (const m of src.matchAll(/"(\/[\w./~@%+-]+\.(?:lottie|json|mp4|webm|ktx2|wasm|glb|hdr|bin|png|jpe?g|gif|svg|webp|avif|woff2?|css|js)(?:\?[^"]*)?)"/gi)) refs.add(m[1]);
  }
}

console.log(`=== verify-refs-served ===`);
console.log(`  ${files.length} document(s), ${refs.size} distinct reference(s), served from ${BASE}\n`);

const bad = [];
let n = 0;
const list = [...refs];
const LANES = 12;
let idx = 0;
await Promise.all(Array.from({ length: LANES }, async () => {
  while (idx < list.length) {
    const ref = list[idx++];
    let code = 0;
    try { code = (await fetch(BASE + ref, { method: "GET", headers: { range: "bytes=0-0" } })).status; } catch { code = -1; }
    n++;
    if ((code >= 400 || code < 0) && !ALLOW.has(ref.split("?")[0])) bad.push(`${code} ${ref}`);
  }
}));

console.log(`  ${n} reference(s) requested; ${bad.length} not answered`);
for (const b of bad.slice(0, 15)) console.log(`    ${b.slice(0, 120)}`);
if (bad.length > 15) console.log(`    … ${bad.length - 15} more`);
console.log(bad.length ? `\nFAIL — ${bad.length} reference(s) the server cannot answer.` : `\nPASS — every reference in the built site is answered.`);
process.exit(bad.length ? 1 : 0);
