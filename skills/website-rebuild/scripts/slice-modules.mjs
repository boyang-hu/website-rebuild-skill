#!/usr/bin/env node
/**
 * slice-modules.mjs — cut a webpack bundle's modules out verbatim, by id.
 *
 * The flat-bundle projects needed extract-source.mjs: a line-range slicer with a
 * hand-maintained slice table, because module boundaries had to be RECONSTRUCTED
 * and a wrong boundary is a silent error. Here the packer wrote the boundaries
 * down, so the slice table is just a list of module ids and the tool can verify
 * itself against the map.
 *
 * ⛔ Byte-verbatim. Each module's text is copied between the offsets the parser
 * reported; nothing is retyped, reformatted or corrected (porting-discipline.md
 * §1.3). The generated file re-declares the webpack runtime so the slice runs on
 * its own, and that runtime is the ONE thing here that is transcribed rather
 * than sliced — it is registered as such in the header.
 *
 *   node scripts/slice-modules.mjs --closure docs/slice-closure.json
 *                                [--map docs/module-map.json]
 *                                [--in mirror/_pretty/main.built.js]
 *                                [--out port/_gen/tween.gen.js] [--check]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const CHECK = args.includes("--check");
// ⛔ How the port is LOADED is part of the port. The source's bundle is a
// classic script — parser-blocking, executed where it sits. An ESM build of the
// same bytes is deferred by default, so swapping one for the other changes when
// every module top-level side effect runs, and that difference has nothing to do
// with the transcription being right. `--format classic --entry <id>` emits an
// IIFE that boots exactly like the original instead of registering a deviation
// for a difference that did not have to exist.
const FORMAT = flag("format", "esm");
// ⭐ A Turbopack port does not need a transcribed runtime at all. Its modules are
// registered into the SAME `globalThis.TURBOPACK` array the origin's own runtime
// drains, so re-emitting the container verbatim lets the real runtime resolve
// ids that live in OTHER chunks — which is exactly what the site's modules do
// when they require React. No re-implementation, therefore no deviation to
// register for one, and the module bodies stay byte-identical.
//
// ⛔ This is only available because the port replaces ONE chunk and the rest of
// the packer's output stays in place. A port that replaces the whole bundle has
// no runtime to lean on and must transcribe one.
const PACKER = flag("packer", "auto");
const ENTRY = flag("entry", null);
if (FORMAT !== "esm" && FORMAT !== "classic") {
  console.error(`FATAL — --format must be "esm" or "classic" (got ${JSON.stringify(FORMAT)}).`);
  process.exit(2);
}
if (FORMAT === "classic" && !ENTRY) {
  console.error(`FATAL — --format classic needs --entry <module-id>: a classic script that`);
  console.error(`        defines modules and never calls one does nothing at all.`);
  process.exit(2);
}
const IN = path.resolve(flag("in", "mirror/_pretty/main.built.js"));
const MAP = path.resolve(flag("map", "docs/module-map.json"));
const CLOSURE = path.resolve(flag("closure", "docs/slice-closure.json"));
const OUT = path.resolve(flag("out", "port/_gen/tween.gen.js"));

const src = await readFile(IN, "utf8");
const lines = src.split("\n");
const map = JSON.parse(await readFile(MAP, "utf8"));
const closure = JSON.parse(await readFile(CLOSURE, "utf8"));
const byId = new Map(map.modules.map((m) => [m.id, m]));

// ⛔ The map is an input, and an input can go stale. Re-derive the source's
// sha256 and refuse if it moved — a slice table pointing into a file that has
// changed is the F26 failure (a recorded green whose input was regenerated).
const srcHash = createHash("sha256").update(src).digest("hex");

const wanted = closure.modules.filter((id) => byId.has(id));
const missing = closure.modules.filter((id) => !byId.has(id));
if (missing.length) {
  console.error(`FATAL: ${missing.length} module id(s) in the closure are not in the map: ${missing.slice(0, 5).join(", ")}`);
  console.error(`       Re-run module-map.mjs, or the closure was computed against a different bundle.`);
  process.exit(5);
}

const packer = PACKER === "auto"
  ? (map.container === "TurbopackChunk" ? "turbopack" : "webpack")
  : PACKER;

// Emit in SOURCE ORDER — the packer's own order, which is also the order the
// runtime would evaluate them in if it walked the container.
const mods = wanted.map((id) => byId.get(id)).sort((a, b) => a.startLine - b.startLine);

const parts = [];
for (const m of mods) {
  // ⭐ Prefer character offsets when the map recorded them: a factory can begin
  // mid-line, and a line slice would then carry its neighbour's tail with it.
  const text = (m.startChar != null && m.endChar != null)
    ? src.slice(m.startChar, m.endChar)
    : lines.slice(m.startLine - 1, m.endLine).join("\n");
  parts.push({ id: m.id, aliases: m.aliases || [], from: m.startLine, to: m.endLine, lines: m.lines, text });
}

const header = [
  `// AUTO-GENERATED by scripts/slice-modules.mjs — DO NOT EDIT BY HAND.`,
  `//`,
  `// Verbatim webpack modules cut from ${path.relative(process.cwd(), IN)}`,
  `//   sha256 ${srcHash}`,
  `// ${parts.length} module(s), ${parts.reduce((t, p) => t + p.lines, 0)} source lines, in packer order.`,
  `//`,
  `// Regenerate:  node scripts/slice-modules.mjs --closure ${path.relative(process.cwd(), CLOSURE)}`,
  `// Verify:      node scripts/slice-modules.mjs --closure ${path.relative(process.cwd(), CLOSURE)} --check`,
  `//`,
  `// ⛔ Nothing below the runtime was retyped, reformatted or corrected. Source-site`,
  `// bugs, dead code and odd spellings are present ON PURPOSE — they are the port.`,
  `//`,
  `// ⚠ REGISTERED DEVIATION: the webpack runtime below is TRANSCRIBED, not sliced.`,
  `// The original is one closure wrapping the whole 597-module container; carrying`,
  `// it verbatim would carry all 597. This is the smallest re-implementation that`,
  `// preserves the contract the modules were compiled against: require by id,`,
  `// memoised exports, module/exports objects. Registered in REBUILD_PLAN §6 D4.`,
  ``,
  `const __modules = {};`,
  `const __cache = {};`,
  `function __req(id) {`,
  `  if (__cache[id]) return __cache[id].exports;`,
  `  const m = (__cache[id] = { i: id, l: false, exports: {} });`,
  `  __modules[id].call(m.exports, m, m.exports, __req);`,
  `  m.l = true;`,
  `  return m.exports;`,
  `}`,
  `__req.d = (exports, name, getter) => { if (!Object.prototype.hasOwnProperty.call(exports, name)) Object.defineProperty(exports, name, { enumerable: true, get: getter }); };`,
  `__req.r = (exports) => { if (typeof Symbol !== "undefined" && Symbol.toStringTag) Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" }); Object.defineProperty(exports, "__esModule", { value: true }); };`,
  `__req.n = (mod) => { const g = mod && mod.__esModule ? () => mod.default : () => mod; __req.d(g, "a", g); return g; };`,
  `__req.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);`,
  ``,
  `Object.assign(__modules, {`,
].join("\n");

// A classic script must not leak the runtime into global scope, so everything
// goes inside an IIFE. ⚠ Inserted after the comment header so the provenance
// block stays the first thing anyone reads.
const openIife = FORMAT === "classic" ? "(function () {\n" : "";

const body = parts.map((p) =>
  `\n// ===== ${path.relative(process.cwd(), IN)} L${p.from}-L${p.to}  (${p.lines} lines) =====\n${p.text}`
).join("\n");

const footer = FORMAT === "esm"
  ? [``, `});`, ``, `export { __req, __modules };`, `export default __req;`, ``].join("\n")
  : [
      ``,
      `});`,
      ``,
      `// Boot the way the original did: the packer's runtime ends with`,
      `// \`i(i.s = <entry>)\`, so the entry module runs as the script is executed.`,
      `__req(${JSON.stringify(ENTRY)});`,
      ``,
      `// ⚠ Exposed for probes and gates only. The source does not publish this;`,
      `// nothing in the port may reach for it.`,
      `window.__req = __req;`,
      `})();`,
      ``,
    ].join("\n");

let out;
if (packer === "turbopack") {
  // Re-emit the packer's own container, verbatim. ⭐ No runtime is transcribed:
  // these modules register into the same globalThis.TURBOPACK array the origin's
  // runtime drains, so ids that live in other chunks (React, Next) resolve
  // exactly as before.
  // Cross-chunk dependency ids the map recorded from the container's prologue.
  const deps = (map.chunkDeps || []).map(String);
  // ⛔ THE CONTAINER IS NOT THE WHOLE FILE. Bytes before the push call (a Sentry
  // `_debugIds` registration — 285 B on every raycastkbd chunk) and after it
  // (`//# debugId=` / sourceMappingURL) are bytes the browser executed. A slice
  // that keeps only the container re-emits a chunk 87 tokens short of the
  // original: verify-tokens 0/54 red with nothing to point at, and the drop is
  // registered nowhere. Carry both ends verbatim and say so in the header.
  const first = mods[0], last = mods[mods.length - 1];
  const head = first.startChar != null ? src.slice(0, first.startChar) : lines.slice(0, first.startLine - 1).join("\n");
  const kOpen = head.search(/\(?\s*globalThis\.TURBOPACK\s*\|\|/);
  const prologue = kOpen > 0 ? head.slice(0, kOpen).replace(/\s+$/, "") : "";
  const tail = last.endChar != null ? src.slice(last.endChar) : lines.slice(last.endLine).join("\n");
  const kClose = tail.indexOf("]);");
  const epilogue = kClose >= 0 ? tail.slice(kClose + 3).replace(/^\s*\n/, "").replace(/\s+$/, "") : "";
  const CLI = `--in ${path.relative(process.cwd(), IN)} --map ${path.relative(process.cwd(), MAP)} --closure ${path.relative(process.cwd(), CLOSURE)} --out ${path.relative(process.cwd(), OUT)}`;
  const tHeader = [
    `// AUTO-GENERATED by scripts/slice-modules.mjs — DO NOT EDIT BY HAND.`,
    `//`,
    `// Verbatim Turbopack modules cut from ${path.relative(process.cwd(), IN)}`,
    `//   sha256 ${srcHash}`,
    `// ${parts.length} module(s), ${parts.reduce((t, p) => t + p.lines, 0)} source lines, in packer order.`,
    `// prologue ${prologue.length} char(s) / epilogue ${epilogue.length} char(s) carried verbatim (bytes outside the container).`,
    `//`,
    `// Regenerate:  node scripts/slice-modules.mjs ${CLI}`,
    `// Verify:      node scripts/slice-modules.mjs ${CLI} --check`,
    `//`,
    `// ⭐ NO RUNTIME IS TRANSCRIBED HERE. This file is a Turbopack chunk like the`,
    `// one it replaces: it pushes (id, factory) pairs into globalThis.TURBOPACK,`,
    `// and the origin's own runtime — still served from the mirror — resolves`,
    `// them, including ids that live in other chunks.`,
    `//`,
    `// ⛔ Nothing below was retyped, reformatted or corrected. Source-site bugs,`,
    `// dead code and odd spellings are present ON PURPOSE — they are the port.`,
    ``,
    ...(prologue
      ? [
          `// ⛔ PROLOGUE — bytes that precede the container in the original chunk,`,
          `// carried verbatim (${prologue.length} chars). The browser ran them; the token`,
          `// gate counts them. Typically a Sentry debug-id registration.`,
          prologue,
          ``,
        ]
      : []),
    `(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([`,
    `    "object" == typeof document ? document.currentScript : void 0,`,
    ...(deps.length
      ? [
          ``,
          `    // ⛔ The container's PROLOGUE: bare ids this chunk DEPENDS on, carried`,
          `    // verbatim from the original. They declare "these must already be`,
          `    // registered before my modules evaluate". Dropping them does not fail`,
          `    // at load — it fails later, when a module evaluates and the runtime`,
          `    // throws "module ${deps[0]} … the module factory is not available",`,
          `    // from a stack that points at this file and never mentions a header.`,
          `    ${deps.join(", ")},`,
        ]
      : []),
    ``,
  ].join("\n");
  // ⛔ Each entry is `<id>, <factory>` — the container is a flat alternating
  // list, so emitting only the factories produces a chunk the runtime reads as
  // ids and drops on the floor.
  // ⛔ Emit EVERY id the module answers to. A Turbopack entry can be
  // `id, id, …, id, factory` — several ids sharing one body. Emitting only the
  // canonical one leaves the others unregistered, and the runtime throws
  // "module <alias> … the module factory is not available" from a chunk that
  // otherwise slices byte-identically.
  const tBody = parts.map((p) => {
    const ids = [...(p.aliases || []), p.id].join(", ");
    const note = (p.aliases || []).length ? `  (also answers to ${p.aliases.join(", ")})` : "";
    return `\n// ===== ${path.relative(process.cwd(), IN)} L${p.from}-L${p.to}  (${p.lines} lines)${note} =====\n${ids}, ${p.text}`;
  }).join(",\n");
  // The EPILOGUE (`//# debugId=…`, sourceMappingURL) is comment-only in
  // practice, but it is still the original's bytes: carry it, so a byte diff
  // against the origin chunk names only the beautifier.
  out = tHeader + tBody + "\n]);\n" + (epilogue ? epilogue + "\n" : "");
} else {
  out = FORMAT === "classic"
    ? header.replace(/\nconst __modules = \{\};/, "\n" + openIife + "const __modules = {};") + body + footer
    : header + body + footer;
}

if (CHECK) {
  const have = await readFile(OUT, "utf8").catch(() => null);
  if (have === null) { console.error(`FATAL: ${path.relative(process.cwd(), OUT)} does not exist.`); process.exit(1); }
  const same = have === out;
  console.log(`=== slice-modules --check ===`);
  console.log(`  ${parts.length} module(s) re-sliced from a source at sha256 ${srcHash.slice(0, 16)}`);
  console.log(same ? `  ok   the generated file is byte-identical to a fresh slice` : `  FAIL the generated file differs from a fresh slice`);
  process.exit(same ? 0 : 1);
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, out);
console.log(`=== slice-modules ===`);
console.log(`  ${parts.length} module(s), ${parts.reduce((t, p) => t + p.lines, 0)} verbatim source lines`);
console.log(`  source sha256 ${srcHash.slice(0, 16)}`);
console.log(`  -> ${path.relative(process.cwd(), OUT)}`);
