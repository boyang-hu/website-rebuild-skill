#!/usr/bin/env node
/**
 * verify-lenprefix.mjs — NO REWRITE MAY CHANGE A PAYLOAD'S LENGTH WITHOUT
 * RE-DECLARING IT.
 *
 * WHY THIS GATE EXISTS
 * ---------------------------------------------------------------------------
 * Both layers of this toolchain localise absolute URLs in text: the BUILD layer
 * bakes it into the port's bytes (T-LOCALIZE), the SERVE layer applies it to the
 * mirror on the way out. Both are string replacements, and both are safe in the
 * places they were designed for — href/src attributes, CSS url(), JSON blobs.
 *
 * ⛔ They are NOT safe inside a payload that carries its own length. React's
 * flight stream, which every Next.js App Router page embeds, is rows of
 *
 *     <id>:T<hex>,<exactly that many UTF-8 BYTES of text>
 *
 * Rewriting `https://media.host/x` to `/ext/media.host/x` inside such a row
 * shortens the text while `T<hex>` still claims the old count. The reader takes
 * the declared number of bytes, swallows the next row's header as content, and
 * dies somewhere unrelated:
 *
 *     TypeError: t.reason.enqueueModel is not a function
 *
 * ⭐ What makes this gate necessary rather than nice: EVERY OTHER GATE WAS
 * GREEN. Zero 404s. Zero request failures. The mirror's own ledger reconciled.
 * The chunk bytes were identical. The HTML was the right size. Two of 115
 * routes simply rendered 70 characters instead of 2,440, and the only reason it
 * was caught at all is that a `python3 -m http.server` on the same directory
 * rendered them perfectly — which located the fault in the SERVER, not in the
 * bytes it was serving.
 *
 * The check is cheap and exact, so it should run on both sides, always: walk
 * each row by its declared length and confirm the byte that follows is the row
 * separator. A correct stream lands on a newline every time; a corrupted one
 * lands mid-text on the first row a rewrite touched.
 *
 *   node scripts/verify-lenprefix.mjs --dir site
 *   node scripts/verify-lenprefix.mjs --base http://127.0.0.1:8081 --routes /,/careers
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cli } from "./lib/cli.mjs";

cli({ known: ["dir", "base", "routes"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const DIR = flag("dir", null);
const BASE = flag("base", null);
const ROUTES = flag("routes", "/").split(",").map((s) => s.trim()).filter(Boolean);

if (!DIR && !BASE) {
  console.error("FATAL: need --dir <built site> or --base <origin> [--routes a,b]");
  process.exit(2);
}

// The push shape every Next.js App Router page uses to stream the payload in.
const PUSH = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

/** Reassemble the flight stream. A row may straddle two pushes — the client
 *  concatenates before parsing, so push boundaries carry no meaning. */
function streamOf(html) {
  PUSH.lastIndex = 0;
  let s = "", m, n = 0;
  while ((m = PUSH.exec(html))) {
    n++;
    try { s += JSON.parse(m[1]); } catch { return { stream: null, pushes: n }; }
  }
  return { stream: n ? s : null, pushes: n };
}

/** Walk by declared length; a correct row is followed by "\n" or the end. */
function audit(stream) {
  const buf = Buffer.from(stream, "utf8");
  let i = 0, rows = 0, bad = [];
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i);
    const comma = buf.indexOf(0x2c, i);
    if (comma < 0 || (nl >= 0 && nl < comma)) { i = nl < 0 ? buf.length : nl + 1; continue; }
    const header = buf.subarray(i, comma).toString("utf8");
    const m = /^([0-9a-f]+):T([0-9a-f]+)$/i.exec(header);
    if (!m) { i = nl < 0 ? buf.length : nl + 1; continue; }
    rows++;
    const declared = parseInt(m[2], 16);
    const start = comma + 1, stop = start + declared;
    if (stop > buf.length) {
      bad.push(`row ${m[1]}: declares ${declared} B but only ${buf.length - start} B remain`);
      break;
    }
    // ⛔ A length-prefixed row is NOT newline-terminated. The next row's header
    // starts immediately at its declared end — the length IS the separator.
    // The first version of this gate asserted a trailing newline and reported
    // every document as corrupt, INCLUDING the live origin's own bytes. That a
    // gate fails the source it is auditing is the cheapest possible signal that
    // the gate, not the source, is wrong; it is worth spending one fetch on.
    if (stop < buf.length) {
      const after = buf.subarray(stop, stop + 24).toString("utf8");
      if (after[0] !== "\n" && !/^[0-9a-f]+:/i.test(after)) {
        bad.push(`row ${m[1]}: declares ${declared} B, and nothing that follows starts a row — ${JSON.stringify(after.slice(0, 20))}`);
      }
    }
    i = stop;
  }
  return { rows, bad };
}

async function* htmlFiles(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(p);
    else if (e.name.endsWith(".html")) yield p;
  }
}

const targets = [];
if (DIR) for await (const f of htmlFiles(path.resolve(DIR))) targets.push({ label: path.relative(path.resolve(DIR), f), get: () => readFile(f, "utf8") });
if (BASE) for (const r of ROUTES) targets.push({ label: r, get: () => fetch(new URL(r, BASE)).then((x) => x.text()) });

console.log(`=== verify-lenprefix ===`);
console.log(`  ${targets.length} document(s) from ${DIR ? path.resolve(DIR) : BASE}\n`);

let withStream = 0, totalRows = 0, broken = 0;
for (const t of targets) {
  const html = await t.get();
  const { stream, pushes } = streamOf(html);
  if (!stream) {
    if (pushes) { broken++; console.log(`  FAIL ${t.label}: ${pushes} push(es) but the literal would not decode`); }
    continue;
  }
  withStream++;
  const { rows, bad } = audit(stream);
  totalRows += rows;
  if (bad.length) {
    broken++;
    console.log(`  FAIL ${t.label}  (${rows} length-prefixed row(s))`);
    for (const b of bad.slice(0, 4)) console.log(`         ${b}`);
    if (bad.length > 4) console.log(`         … ${bad.length - 4} more`);
  }
}

// ⭐ Report the coverage, not just the verdict: a gate that examined nothing and
// a gate that examined everything both print no failures.
console.log(`  ${withStream}/${targets.length} document(s) carry a flight stream; ${totalRows} length-prefixed row(s) walked`);
if (!withStream) console.log(`  note — nothing here declares its own length; this gate had nothing to check`);
console.log(broken ? `\nFAIL — ${broken} document(s) declare a length they do not have.` : `\nPASS — every declared length matches its content.`);
process.exit(broken ? 1 : 0);
