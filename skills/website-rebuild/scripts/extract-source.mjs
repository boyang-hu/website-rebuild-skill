#!/usr/bin/env node
/**
 * extract-source.mjs — verbatim BYTE SLICER. Builds a ported source file by
 * cutting pinned line ranges out of a beautified source bundle and
 * concatenating them IN SOURCE ORDER, instead of retyping them.
 *
 *   node extract-source.mjs --slices slices.config.mjs            # (re)generate
 *   node extract-source.mjs --slices slices.config.mjs --check    # gate: fail if stale
 *   node extract-source.mjs --slices slices.config.mjs --balance-check
 *
 * WHY THIS EXISTS
 * ---------------
 * "源站代码是唯一裁决" (references/porting-discipline.md §1.1). The strongest
 * form of that discipline for a minified bundle is not "retype it carefully" —
 * it is "copy the bytes". Nothing is renamed, reformatted or "improved" (source
 * bugs and dead code ride along verbatim, §1.3), so the generated file is
 * directly `diff`-able against the bundle and transcription typos are
 * physically impossible.
 *
 * ===> READ references/porting-discipline.md §2.2 BEFORE USING THIS. <===
 * That section is the contract this script implements: the mandatory trio
 * (slice table / source sha256 guard / symbol alias table), the `--check` gate,
 * the feasibility test for a slice boundary (a symbol is sliceable only if its
 * whole top-level declaration is), what to slice vs. what to transcribe
 * statement-by-statement, and the one violation no gate can catch —
 * **绝不偷偷补 keyword**: if a slice does not parse on its own, fix the
 * boundary, transcribe and register the deviation, or keep the symbol stubbed
 * (§6.2) — never add a `const` to make it parse.
 *
 * MACHINE vs DATA
 * ---------------
 * This file is the machine only: sha256 guard, line-range slicing, source-order
 * concatenation, `--check`, and the AUTO-GENERATED header. Everything
 * site-specific — paths, the pinned sha256, the slice table, the alias/stub
 * import tables — lives in the config file. Start from
 * `scripts/slices.config.example.mjs` (annotated).
 *
 * EXIT CODES (all designed to be used as gates)
 *   0  generated / in sync
 *   1  --check: the file on disk is missing or stale -> rerun without --check
 *   2  usage or config error (bad flags, malformed slice table, range out of file)
 *   3  SOURCE SHA256 MISMATCH — the coordinate system moved; every L#### note
 *      in engine-notes.md / REBUILD_PLAN is void until re-derived
 *   4  --balance-check: the concatenated slices do not parse (a slice boundary
 *      is wrong — see porting-discipline.md §6.2 (c) step 2)
 *
 * Zero dependencies (Node 22+ builtins only).
 *
 * Adapted from shopifydesign-rebuild/scripts/extract-source.mjs, where 41
 * pinned slices of a beautified Vite bundle are assembled into
 * src/engine/_gen/engine.gen.js. Generalized here: the slice table, alias
 * table, pending-stub table, source/output paths and pinned sha256 were all
 * hardcoded there and are now config data; imports are an arbitrary list of
 * groups (alias table, stub file, anything else) instead of two fixed ones;
 * per-symbol provenance notes and the `--balance-check` boundary test are new.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { cli } from "./lib/cli.mjs";
import { sha256 } from "./lib/hash.mjs";

cli({ known: ["slices", "source", "out", "sha256"], bools: ["check", "balance-check"], file: import.meta.url });

const USAGE = `usage: extract-source.mjs --slices <config.mjs|config.json> [options]

  --slices <path>   slice-table config (.mjs/.js exporting default, or .json).
                    See scripts/slices.config.example.mjs.
  --check           do not write; exit 1 if the file on disk differs from what
                    this config would generate (acceptance gate).
  --balance-check   parse the concatenated slices with new Function() to catch
                    a wrong slice boundary (porting-discipline.md §6.2 (c)).
  --source <path>   override config.source
  --out <path>      override config.out
  --sha256 <hex>    override config.sha256 (use when re-pinning deliberately)
`;

const args = process.argv.slice(2);
const has = (n) => args.includes("--" + n);
const flag = (n, dflt) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : dflt;
};
const die = (code, msg) => {
  console.error(msg);
  process.exit(code);
};

// --help / -h are answered by lib/cli.mjs before this runs; a bare invocation
// still gets the usage block and exit 2.
if (args.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

const CHECK = has("check");
const BALANCE = has("balance-check");
const cfgArg = flag("slices", null);
if (!cfgArg) die(2, USAGE);
const CFG_PATH = path.resolve(cfgArg);

// ---------------------------------------------------------------- config ---

/** .json is parsed; .mjs/.js is imported (so the slice table can carry comments). */
async function loadConfig(p) {
  if (/\.json$/i.test(p)) return JSON.parse(await readFile(p, "utf8"));
  const mod = await import(pathToFileURL(p).href);
  return mod.default ?? mod.config ?? mod;
}

const cfg = await loadConfig(CFG_PATH).catch((e) =>
  die(2, `FATAL: cannot load slice config ${CFG_PATH}\n       ${e.message}`),
);

// Relative paths in the config resolve against the config file's own directory
// (override with config.root), so the config is movable and the generated
// header is independent of the cwd the script was invoked from.
const ROOT = path.resolve(path.dirname(CFG_PATH), cfg.root ?? ".");
const rel = (p) => path.relative(ROOT, p) || path.basename(p);

const SRC = path.resolve(flag("source", null) ?? path.resolve(ROOT, cfg.source ?? ""));
const OUT = path.resolve(flag("out", null) ?? path.resolve(ROOT, cfg.out ?? ""));
const PINNED_SHA256 = (flag("sha256", null) ?? cfg.sha256 ?? "").toLowerCase();
// How the generated header tells the next person to rerun this. Kept in config
// so the command is correct wherever the project keeps the script.
const GENERATOR = cfg.generator ?? "scripts/extract-source.mjs";

if (!cfg.source && !flag("source", null)) die(2, "FATAL: config.source (the beautified bundle to slice) is required");
if (!cfg.out && !flag("out", null)) die(2, "FATAL: config.out (the generated file to write) is required");
if (!/^[0-9a-f]{64}$/.test(PINNED_SHA256))
  die(
    2,
    "FATAL: config.sha256 must be the sha256 of the source file (64 hex chars).\n" +
      "       This guard is not optional — porting-discipline.md §2.2 trio #2.\n" +
      `       Get it with:  shasum -a 256 ${cfg.source ?? "<source>"}`,
  );
if (!Array.isArray(cfg.slices) || cfg.slices.length === 0)
  die(2, "FATAL: config.slices must be a non-empty array of {from, to, note, symbols}");

/** imports: [{from, note?, symbols:[string | {name, note}]}] — alias table, stubs, … */
const IMPORTS = (cfg.imports ?? []).map((g, i) => {
  if (!g || typeof g.from !== "string")
    die(2, `FATAL: config.imports[${i}].from must be a module specifier string`);
  const symbols = (g.symbols ?? []).map((s) =>
    typeof s === "string" ? { name: s, note: "" } : { name: s.name, note: s.note ?? "" },
  );
  for (const s of symbols)
    if (!s.name) die(2, `FATAL: config.imports[${i}] has a symbol without a name`);
  return { from: g.from, note: g.note ?? "", symbols };
});

// ------------------------------------------------------- sha256 guard (§2.2) ---

const raw = await readFile(SRC, "utf8").catch((e) =>
  die(2, `FATAL: cannot read source ${SRC}\n       ${e.message}`),
);
const sha = sha256(raw);
if (sha !== PINNED_SHA256) {
  die(
    3,
    `FATAL: ${rel(SRC)} sha256 ${sha}\n` +
      `       expected ${PINNED_SHA256}\n` +
      "       THE COORDINATE SYSTEM MOVED (坐标系已移动). Every L#### reference in\n" +
      "       the slice table, engine-notes.md and REBUILD_PLAN.md is VOID until\n" +
      "       re-derived. Do not re-pin the hash to make this pass unless you have\n" +
      "       re-derived the line ranges (a beautifier bump or a re-mirror shifts\n" +
      "       them silently). See porting-discipline.md §2.2.",
  );
}

// ------------------------------------------------------------ slice table ---

const lines = raw.split("\n");
// A trailing newline yields a phantom empty element; it is not a line an
// editor would show, and no slice may end on it.
const lineCount = raw.endsWith("\n") ? lines.length - 1 : lines.length;
const slices = cfg.slices.map((s, i) => {
  const where = `config.slices[${i}]`;
  if (!Number.isInteger(s.from) || !Number.isInteger(s.to))
    die(2, `FATAL: ${where}: from/to must be integer line numbers (1-based, 'to' inclusive)`);
  if (s.from < 1 || s.to < s.from)
    die(2, `FATAL: ${where}: bad range L${s.from}-L${s.to}`);
  if (s.to > lineCount)
    die(2, `FATAL: ${where}: L${s.from}-L${s.to} runs past the end of ${rel(SRC)} (${lineCount} lines)`);
  return { from: s.from, to: s.to, note: s.note ?? "", symbols: s.symbols ?? [] };
});

for (let i = 1; i < slices.length; i++) {
  const prev = slices[i - 1];
  const cur = slices[i];
  if (cur.from <= prev.to)
    die(
      2,
      `FATAL: config.slices[${i}] L${cur.from}-L${cur.to} overlaps config.slices[${i - 1}] ` +
        `L${prev.from}-L${prev.to} — the same bytes would be emitted twice`,
    );
  if (cur.from < prev.from)
    console.error(
      `WARN: config.slices[${i}] L${cur.from} precedes config.slices[${i - 1}] L${prev.from} — ` +
        "slices are meant to be concatenated in SOURCE ORDER (porting-discipline.md §2.2)",
    );
}

// --------------------------------------------------------------- generate ---

const sourceLines = slices.reduce((a, s) => a + (s.to - s.from + 1), 0);
const cfgRel = rel(CFG_PATH);

const importBlock = IMPORTS.filter((g) => g.symbols.length > 0)
  .map((g) => {
    const head = g.note ? `// ${g.note}\n` : "";
    const annotated = g.symbols.some((s) => s.note);
    if (!annotated) return `${head}import { ${g.symbols.map((s) => s.name).join(", ")} } from ${JSON.stringify(g.from)};`;
    // One symbol per line when the alias table carries provenance — §2.2 trio
    // #3 requires every alias to record HOW it was resolved.
    const body = g.symbols
      .map((s) => `  ${s.name},${s.note ? ` // ${s.note}` : ""}`)
      .join("\n");
    return `${head}import {\n${body}\n} from ${JSON.stringify(g.from)};`;
  })
  .join("\n\n");

const extraHeader = (cfg.header ?? []).map((l) => (l ? `// ${l}` : "//")).join("\n");

const header = [
  `// AUTO-GENERATED by ${GENERATOR} — DO NOT EDIT BY HAND.`,
  "//",
  `// Verbatim byte slices of ${rel(SRC)}`,
  `//   sha256 ${PINNED_SHA256}`,
  `// concatenated in source order: ${slices.length} slices, ${sourceLines} source lines.`,
  "// Regenerate with:",
  `//   node ${GENERATOR} --slices ${cfgRel}`,
  "// Verify against the source with:",
  `//   node ${GENERATOR} --slices ${cfgRel} --check`,
  "//",
  extraHeader,
  extraHeader ? "//" : "",
  "// Nothing below this header was retyped, reformatted or corrected. Source-site",
  "// bugs, dead code and odd spellings are present ON PURPOSE — they are the port",
  "// (porting-discipline.md §1.3; register them in REBUILD_PLAN §Q).",
]
  .filter((l) => l !== "")
  .join("\n");

const exported = new Set();
const sliceParts = [];
for (const s of slices) {
  const body = lines.slice(s.from - 1, s.to).join("\n");
  sliceParts.push(
    `\n// ===== ${rel(SRC)} L${s.from}-L${s.to} =====\n` +
      (s.note ? `// ${s.note}\n` : "") +
      body,
  );
  for (const sym of s.symbols) exported.add(sym);
}

const parts = [header];
if (importBlock) parts.push(`\n${importBlock}\n`);
parts.push(...sliceParts);
if (exported.size > 0) {
  parts.push(
    "\n\n// ===== exports (not present in the source bundle; the bundle is one scope) =====\n" +
      `export { ${[...exported].join(", ")} };\n`,
  );
}
const out = parts.join("\n");

// ------ slice-boundary parse test (porting-discipline.md §6.2 (c) step 2) ---
// Strips the generated import/export scaffolding and parses the slices alone:
// this is what catches a range that ends one line before its closing brace.
if (BALANCE) {
  // ⚠ AND the whole file, scaffolding included. Stripping the scaffolding is
  // right for finding a bad slice boundary, but it makes this check
  // structurally blind to errors the SCAFFOLDING itself causes. Field case: the
  // generated `export {...}` block is fine in a module and a hard
  // `SyntaxError: Unexpected token 'export'` when the shell loads the output as
  // a CLASSIC <script src> — the whole page then runs nothing, and the failure
  // surfaced two steps downstream in a CLEAN probe instead of here.
  if (exported.size > 0) {
    console.log(
      `  note: ${exported.size} symbol(s) are exported, so ${rel(OUT)} is an ES MODULE.\n` +
        `        If the shell loads it as a classic <script src> (no type="module"),\n` +
        `        the browser throws SyntaxError and NOTHING on the page runs. Either\n` +
        `        the consumer imports it, or the slice table should export nothing\n` +
        `        (symbols: []) — retagging the shell as type="module" would "fix" it\n` +
        `        by changing the loading semantics of the source program, which is\n` +
        `        not a fix.`,
    );
  }
  try {
    new Function(sliceParts.join("\n"));
  } catch (e) {
    die(
      4,
      `FATAL: the concatenated slices do not parse — a slice boundary is wrong.\n` +
        `       ${e.name}: ${e.message}\n` +
        "       Bisect the slice table to find it (porting-discipline.md §6.2 (c)).\n" +
        "       DO NOT add a missing keyword to make it parse (§2.2): fix the range,\n" +
        "       slice the whole enclosing declaration, transcribe and register the\n" +
        "       deviation, or keep the symbol stubbed.",
    );
  }
}

if (CHECK) {
  const cur = await readFile(OUT, "utf8").catch(() => null);
  if (cur !== out) {
    die(
      1,
      `FATAL: ${rel(OUT)} is ${cur === null ? "missing" : "stale"} — rerun:\n` +
        `       node ${GENERATOR} --slices ${cfgRel}`,
    );
  }
  console.log(`${rel(OUT)} is in sync with the pinned slices of ${rel(SRC)}.`);
  process.exit(0);
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, out);
console.log(
  `${rel(OUT)} <- ${slices.length} verbatim slices, ${sourceLines} source lines, ` +
    `${exported.size} exported symbols` +
    (IMPORTS.length ? `, ${IMPORTS.reduce((a, g) => a + g.symbols.length, 0)} imported aliases/stubs` : ""),
);
