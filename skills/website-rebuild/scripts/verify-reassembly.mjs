#!/usr/bin/env node
/**
 * verify-reassembly.mjs — the gate for concatenative decompositions.
 *
 * slice-esm.mjs's whole promise is "the parts ARE the chunk". This gate
 * re-derives that claim from bytes, every run: per-part sha256 against the
 * manifest, then the in-order concatenation against the pinned chunk hash,
 * then — when --against names the tree the chunks live in — against the LIVE
 * original file, so a manifest that drifted from a re-crawled chunk cannot
 * vouch for itself (the same two-sided rule as verify-mirror's recorded vs
 * computed mapping).
 *
 * Byte equality is the strongest gate this skill has: when it holds, every
 * runtime gate's verdict transfers to the readable tree for free — same
 * bytes, same program. That is why the readable layer can be edited without
 * fear: any edit that keeps this gate green changed nothing but presentation
 * (file boundaries, file names), and any edit that changed the program turns
 * it red at the exact part.
 *
 *   node scripts/verify-reassembly.mjs --dir src/readable [--against src/site]
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { cli } from "./lib/cli.mjs";

cli({ known: ["dir", "against"], bools: [], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const DIR = path.resolve(flag("dir", "src/readable"));
const AGAINST = flag("against", null) ? path.resolve(flag("against", null)) : null;
// Unknown flags are rejected by lib/cli.mjs (the one argv contract) before anything here runs.

const sha = (s) => createHash("sha256").update(s).digest("hex");
const manifests = [];
const walk = async (d) => {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.name === "slices.json") manifests.push(p);
  }
};
await walk(DIR);
if (!manifests.length) { console.error(`FAIL — no slices.json under ${DIR}; nothing to verify is not a pass.`); process.exit(1); }

console.log(`=== verify-reassembly  ${manifests.length} decomposition(s) under ${DIR} ===`);
let bad = 0, partsTotal = 0;
for (const mf of manifests) {
  const m = JSON.parse(await readFile(mf, "utf8"));
  const dir = path.dirname(mf);
  const label = path.relative(DIR, dir) || path.basename(dir);
  const texts = [];
  let ok = true;
  for (const p of m.parts) {
    const t = await readFile(path.join(dir, p.file), "utf8").catch(() => null);
    if (t === null) { console.log(`  FAIL ${label}: ${p.file} is missing`); ok = false; bad++; break; }
    if (sha(t) !== p.sha256) { console.log(`  FAIL ${label}: ${p.file} does not hash to its manifest entry — the part was edited; presentation edits are renames/moves, never content`); ok = false; bad++; break; }
    texts.push(t);
  }
  if (!ok) continue;
  partsTotal += m.parts.length;
  const joined = texts.join("");
  if (sha(joined) !== m.chunkSha256) { console.log(`  FAIL ${label}: parts verify individually but do not join to the pinned chunk (order or gaps)`); bad++; continue; }
  if (AGAINST) {
    const orig = await readFile(path.join(AGAINST, path.basename(m.chunk)), "utf8")
      .catch(async () => await readFile(path.join(AGAINST, m.chunk), "utf8").catch(() => null));
    if (orig === null) { console.log(`  FAIL ${label}: --against given but original ${m.chunk} not found there`); bad++; continue; }
    if (sha(orig) !== m.chunkSha256) { console.log(`  FAIL ${label}: pinned hash no longer matches the LIVE original — the chunk moved under the decomposition; re-slice`); bad++; continue; }
  }
  console.log(`  ok   ${label}: ${m.parts.length} part(s) -> ${m.chunkSha256.slice(0, 12)}…${AGAINST ? " (live original confirmed)" : ""}`);
}
console.log(bad ? `\nFAIL — ${bad} decomposition(s) do not reassemble.` : `\nPASS — ${manifests.length} decomposition(s), ${partsTotal} part(s), every one reassembles byte-exact.`);
process.exit(bad ? 1 : 0);
