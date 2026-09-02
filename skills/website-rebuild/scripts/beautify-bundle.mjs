#!/usr/bin/env node
// beautify-bundle.mjs — expand minified bundles with a PINNED js-beautify into
// mirror/_pretty/, so beautified line numbers form a stable coordinate
// system for provenance notes ("ported from bundle.js:14032"). A beautifier
// version bump shifts line numbers and INVALIDATES every recorded reference —
// samsyninja lesson: "版本漂移作废坐标系" — hence the hard pin and the
// auto-generated _pretty/README.md recording the version and the exact
// regeneration command per file.
//
//   node beautify-bundle.mjs <bundle.js> [...more files] [--out mirror/_pretty]
//
// The wrapper itself is zero-dependency; it shells out to
//   npx -y js-beautify@1.15.1
// (the version careers-kimi / storytellingnoomo / landonorris all pinned;
// oryzo introduced the _pretty/ convention, samsy first pinned the version).
//
// New thin wrapper written for the website-rebuild skill: the six projects
// carried this as a documented command + README convention, not a script.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tokenStream, firstDivergence, showToken } from "./lib/tokens.mjs";
import { cli } from "./lib/cli.mjs";
import { sha256 } from "./lib/hash.mjs";

cli({ known: ["out"], bools: [], file: import.meta.url, positional: "<bundle.js> [...more files]" });

// The pinned beautifier version. NEVER bump mid-project: regenerate everything
// and re-verify every recorded line reference if you must change it.
const JS_BEAUTIFY_VERSION = "1.15.1";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const FILES = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
if (FILES.length === 0) {
  console.error("usage: beautify-bundle.mjs <bundle.js> [...more] [--out mirror/_pretty]");
  process.exit(2);
}
const OUT = path.resolve(flag("out", "mirror/_pretty"));
mkdirSync(OUT, { recursive: true });

// basename -> the source that claimed it, so a repeat is caught rather than lost.
const takenNames = new Map();

const typeFor = (f) =>
  /\.css$/i.test(f) ? "css" : /\.html?$/i.test(f) ? "html" : "js";

const entries = [];
let tokenTrouble = 0; // files whose beautified tokens differ from the source (coordinates only)
for (const file of FILES) {
  const src = path.resolve(file);
  // ⛔ Flattening to the basename is not injective, and the coordinate system
  // this file exists to create is built on the assumption that it is. Two
  // bundles named `main.built.js` under different directories
  // (`overview/` and `hearing-health/`) landed on ONE output: the second
  // silently overwrote the first, the ledger recorded both rows pointing at the
  // same destination with different sha256, and nothing reported it. Every line
  // number cited after that would have named the wrong file.
  //
  // So disambiguate with the parent directory when a basename repeats. This is
  // the same assertion verify-mirror makes about the mirror's own mapping —
  // the pretty tree needs it too, and did not have it.
  let dest = path.join(OUT, path.basename(src));
  if (takenNames.has(path.basename(src))) {
    const parent = path.basename(path.dirname(src));
    dest = path.join(OUT, `${parent}--${path.basename(src)}`);
    console.log(`[beautify] ⚠ basename collision: ${path.basename(src)} already written from`);
    console.log(`           ${takenNames.get(path.basename(src))}`);
    console.log(`           -> this one becomes ${path.basename(dest)}`);
  }
  takenNames.set(path.basename(src), path.relative(process.cwd(), src));
  const type = typeFor(src);
  console.log(`[beautify] ${path.basename(src)} (${type}) -> ${path.relative(process.cwd(), dest)}`);
  // ⛔ js-beautify's CLI globs its -f argument. A Next dynamic-route chunk is
  // named `[slug]-<hash>.js`, and `[slug]` is a character class that matches
  // nothing — the tool "succeeded" and left the file untouched, with no
  // message (14islands: four page chunks sat at 8 raw lines until module-map
  // reported "29 lines inside a 9-line file"). Feed it a glob-free copy.
  let feed = src;
  if (/[\[\]{}*?]/.test(path.basename(src))) {
    const tmpDir = path.join(OUT, ".feed");
    mkdirSync(tmpDir, { recursive: true });
    feed = path.join(tmpDir, `${entries.length}.${type}`);
    writeFileSync(feed, readFileSync(src));
  }
  const r = spawnSync(
    "npx",
    ["-y", `js-beautify@${JS_BEAUTIFY_VERSION}`, "--type", type, "-f", feed, "-o", dest],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) {
    console.error(`[beautify FAIL] ${src} (exit ${r.status})`);
    process.exit(1);
  }
  // ⛔ "Output === input" is the silent-failure signature above; on a minified
  // input it can never be legitimate. Do not ship a coordinate system that is
  // the bundle itself while the ledger says it was beautified.
  {
    let outBuf = null;
    try { outBuf = readFileSync(dest); } catch {}
    const srcBuf = readFileSync(src);
    const longest = srcBuf.toString("utf8").split("\n").reduce((m, l) => Math.max(m, l.length), 0);
    if (!outBuf) { console.error(`[beautify FAIL] ${src}: no output written`); process.exit(1); }
    if (outBuf.equals(srcBuf) && longest > 5000) {
      console.error(`[beautify FAIL] ${src}: output is byte-identical to a minified input (longest line ${longest}) — js-beautify did nothing`);
      process.exit(1);
    }
  }
  // ⛔ VERIFY THE OUTPUT STILL PARSES. js-beautify can corrupt a file: a
  // backtick INSIDE a double-quoted string ("`forbidden()`…") reads to it as a
  // template-literal opener, and it then line-wraps mid-string — an
  // unterminated string constant in what is supposed to be the project's
  // coordinate system. Everything downstream reads _pretty/ as ground truth,
  // so a corrupt file here poisons every line number after it. On failure the
  // ORIGINAL bytes ship as the coordinates — minified but valid.
  if (type === "js") {
    const chk = spawnSync("npx", ["-y", "acorn@8.14.0", "--ecma2022", "--silent", dest], { encoding: "utf8" });
    if (chk.status !== 0) {
      console.error(`  ⚠ beautified output DOES NOT PARSE (js-beautify corruption) — shipping the`);
      console.error(`    original bytes verbatim as this file's coordinates instead:`);
      console.error(`    ${(chk.stderr || "").split("\n")[0]}`);
      writeFileSync(dest, readFileSync(src));
    }
  }
  // ⛔⛔ PARSES is not ENOUGH. js-beautify can change the CONTENT of a nested
  // template literal — `${iW(e)}:${t};` came out as `$ {\n iW(e)\n }: $ {\n t\n };`
  // — and the result parses, renders, and passes every pixel/CLEAN gate
  // (14islands _app module 99150; 748,409 vs 748,398 tokens). The token stream
  // is the only witness. A file whose tokens differ is still usable as
  // COORDINATES, but its bytes must never be DELIVERED (re-emitted/sliced):
  // the ledger says so, and this run exits non-zero so nobody misses it.
  let tokens = "n/a";
  if (type === "js") {
    try {
      const k = firstDivergence(tokenStream(src), tokenStream(dest));
      if (k < 0) tokens = "equal";
      else {
        tokens = `DIFFER@${k}`;
        tokenTrouble++;
        console.error(`  ⛔ token stream differs from the source at #${k} — this _pretty file is coordinates only,`);
        console.error(`     NOT delivery bytes (slice from the minified original for that span; verify-tokens gate)`);
      }
    } catch (e) {
      tokens = `unchecked (${e.message.split("\n")[0].slice(0, 60)})`;
      console.error(`  ⚠ token check skipped: ${tokens}`);
    }
  }
  const sha = sha256(readFileSync(src));
  entries.push({
    pretty: path.basename(dest),
    source: path.relative(process.cwd(), src),
    sha256: sha,
    type,
    tokens,
  });
}

// The regeneration ledger. Anyone touching _pretty/ must be able to reproduce
// it byte-for-byte from this file alone.
const readme = `# _pretty/ — beautified bundle coordinate system

Beautified with **js-beautify@${JS_BEAUTIFY_VERSION}** (PINNED — a version bump shifts
line numbers and invalidates every recorded \`file:line\` provenance reference;
never regenerate with a different version).

Generated ${new Date().toISOString()} by scripts/beautify-bundle.mjs.

| pretty file | source | source sha256 | tokens vs source | regenerate |
|---|---|---|---|---|
${entries
  .map(
    (e) =>
      `| ${e.pretty} | ${e.source} | \`${e.sha256.slice(0, 16)}…\` | ${e.tokens} | \`npx -y js-beautify@${JS_BEAUTIFY_VERSION} --type ${e.type} -f ${e.source} -o mirror/_pretty/${e.pretty}\` |`,
  )
  .join("\n")}

Token column: \`equal\` = safe to deliver these bytes (re-emit / slice); \`DIFFER@n\` = js-beautify
changed content (nested template literal) — COORDINATES ONLY, deliver from the minified original.

Rules:
- Files in _pretty/ are READ-ONLY reference material; never edit them.
- If a source bundle changes upstream (sha256 mismatch), re-mirror first,
  regenerate, and re-audit every line-number citation that pointed into it.
`;
writeFileSync(path.join(OUT, "README.md"), readme);
const dests = entries.map((e) => e.pretty);
if (new Set(dests).size !== dests.length) {
  console.error(`FATAL: ${dests.length} inputs produced ${new Set(dests).size} distinct outputs — the pretty tree is not injective and every line number cited against it would be ambiguous.`);
  process.exit(5);
}
console.log(`[beautify] ${entries.length} file(s) done; ${new Set(dests).size} distinct output(s); ledger -> ${path.relative(process.cwd(), path.join(OUT, "README.md"))}`);
if (tokenTrouble) {
  console.error(`[beautify] ⛔ ${tokenTrouble} file(s) have a token stream that differs from the source — see the ledger's tokens column. Exit 1 so this is not skimmed.`);
  process.exitCode = 1;
}
