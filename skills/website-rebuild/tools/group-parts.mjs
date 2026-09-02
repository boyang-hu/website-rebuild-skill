#!/usr/bin/env node
/**
 * group-parts.mjs — fold a chunk's flat part list into DIRECTORIES, on
 * literal evidence only.
 *
 * slice-esm.mjs leaves one flat directory per chunk (151 files for a scene
 * chunk). This tool clusters parts whose NAMES share an identifier token —
 * Camera{OrbitController,SplineSystem} -> camera/, {Wave,Sun,Cloud}Uniforms
 * -> uniforms/ — which is the same tier-1 evidence the names themselves came
 * from: the shared token is IN the code's own identifiers, nothing is
 * invented. Parts whose name shares no token with ≥ --min-run siblings stay
 * where they are; a wrong grouping is worse than a flat list for exactly the
 * reason a wrong name is worse than a hash.
 *
 * Reassembly is untouched BY CONSTRUCTION and re-proved anyway: order lives
 * in slices.json (and the NNN- prefixes travel with the files), this tool
 * only rewrites each part's `file` field to its new relative path, and it
 * joins the tree back together and compares sha256 against the pinned chunk
 * BEFORE writing a single move. Presentation edits are licensed by the gate
 * staying green (readable-source.md §3.0.6).
 *
 *   node tools/group-parts.mjs --dir src-readable/<chunk> [--min-run 2]
 *   node tools/group-parts.mjs --all src-readable [--min-run 2]
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { cli } from "../scripts/lib/cli.mjs";

// Unknown flags are fatal — the check lives in lib/cli.mjs; this is its known set.
cli({ known: ["dir", "all", "min-run"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const MIN_RUN = Number(flag("min-run", "2"));

const targets = [];
if (flag("all", null)) {
  const root = path.resolve(flag("all", null));
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory() && existsSync(path.join(root, e.name, "slices.json"))) targets.push(path.join(root, e.name));
  }
} else if (flag("dir", null)) {
  targets.push(path.resolve(flag("dir", null)));
} else {
  console.error("usage: group-parts.mjs --dir <chunk-parts-dir> | --all <readable-root> [--min-run 2]");
  process.exit(2);
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
// Leading identifier token of a part name: the first CamelCase word, or the
// first segment before a separator (`CameraSplineSystem` -> camera).
const tokensOf = (name) => {
  const stem = name.replace(/^\d+-/, "").replace(/\.js$/, "");
  const words = stem.split(/(?=[A-Z])|[-_.]/).filter(Boolean).map((w) => w.toLowerCase());
  // Class families only for the LEADING rule: a capitalized first word
  // (CameraX, WaveUniforms) names a domain; a lowercase verb (getX, createY)
  // names an ACTION shared across unrelated domains, and grouping by verb
  // produces literal-but-mushy bins ("get/", "create/") that hide more than
  // a flat list does.
  return { stem, words, classy: /^[A-Z]/.test(stem) };
};

for (const dir of targets) {
  const mfPath = path.join(dir, "slices.json");
  const m = JSON.parse(readFileSync(mfPath, "utf8"));
  const label = path.basename(dir);

  // Evidence pass: count leading tokens (strong) and trailing tokens (family
  // suffixes like …Uniforms, …Material — need a longer run to count).
  const lead = new Map(), trail = new Map();
  for (const p of m.parts) {
    const { words } = tokensOf(p.file);
    if (!words.length) continue;
    if (words[0].length >= 3 && tokensOf(p.file).classy) lead.set(words[0], (lead.get(words[0]) || 0) + 1);
    const last = words[words.length - 1];
    if (words.length >= 2 && last.length >= 4) trail.set(last, (trail.get(last) || 0) + 1);
  }

  const dirFor = (p) => {
    const { words } = tokensOf(p.file);
    if (!words.length) return null;
    if (tokensOf(p.file).classy && words[0].length >= 3 && (lead.get(words[0]) || 0) >= MIN_RUN) return words[0];
    const last = words[words.length - 1];
    if (words.length >= 2 && last.length >= 4 && (trail.get(last) || 0) >= Math.max(MIN_RUN, 3)) return last;
    return null;
  };

  // Plan, prove, then move: join the WOULD-BE tree in manifest order and
  // require the pinned hash before touching the filesystem.
  const plan = m.parts.map((p) => {
    const g = dirFor(p);
    return { p, from: p.file, to: g ? path.join(g, p.file) : p.file };
  });
  const joined = plan.map(({ p }) => readFileSync(path.join(dir, p.file), "utf8")).join("");
  if (sha(joined) !== m.chunkSha256) {
    console.error(`FATAL ${label} — parts on disk no longer join to the pinned chunk; refusing to group a broken tree.`);
    process.exit(1);
  }
  let moved = 0;
  const usedDirs = new Set();
  for (const { p, from, to } of plan) {
    if (from === to) continue;
    mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
    renameSync(path.join(dir, from), path.join(dir, to));
    p.file = to.split(path.sep).join("/");
    usedDirs.add(path.dirname(to));
    moved++;
  }
  writeFileSync(mfPath, JSON.stringify(m, null, 1));
  // Post-move proof from the NEW paths.
  const joined2 = m.parts.map((p) => readFileSync(path.join(dir, p.file), "utf8")).join("");
  if (sha(joined2) !== m.chunkSha256) {
    console.error(`FATAL ${label} — post-move reassembly broke. This should be impossible; inspect ${mfPath}.`);
    process.exit(1);
  }
  console.log(`  ${label}: ${moved}/${m.parts.length} part(s) grouped into ${usedDirs.size} dir(s)${usedDirs.size ? ` (${[...usedDirs].slice(0, 6).join(", ")}${usedDirs.size > 6 ? ", …" : ""})` : ""}`);
}
console.log("Done. Re-run verify-reassembly to certify the tree.");
