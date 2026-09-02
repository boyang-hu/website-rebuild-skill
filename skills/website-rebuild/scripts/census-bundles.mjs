#!/usr/bin/env node
/**
 * census-bundles.mjs — chunk-level coordinate ledger for CONTAINER-LESS output.
 *
 * module-map.mjs reads the boundaries a packer wrote down; Vite/esbuild
 * scope-hoisted output has none to read, and per-chunk facts are the only
 * machine-extractable structure left: sha256 (the coordinate pin — every
 * "this logic lives in chunk X line N" claim in the reverse notes is anchored
 * against it), bytes/lines, and the CHUNK GRAPH from ESM import/export
 * statements — the counterpart of module-map's require edges, one level up.
 *
 * ⭐ Import clauses are naming evidence, not just edges: a minified export
 * name travels with its descriptive local alias (`import { ap as Vector2 }`),
 * which is exactly the tier-1 material name-modules/slice-esm feed on.
 *
 * Adapted from the hashgraphvc rebuild's project-local census (Codex runtime);
 * generalized: roots as flags, statement matching is line-anchored on the raw
 * bytes (a census is coordinates, not a gate — the reassembly gate is
 * verify-reassembly.mjs, and the mirror gate already proved the bytes).
 *
 *   node scripts/census-bundles.mjs --dir mirror/_nuxt --out docs/bundle-census.json
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { cli } from "./lib/cli.mjs";
import { sha256 } from "./lib/hash.mjs";

cli({ known: ["dir", "out", "md"], bools: [], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const DIR = path.resolve(flag("dir", "mirror/_nuxt"));
const OUT = path.resolve(flag("out", "docs/bundle-census.json"));
// Unknown flags are rejected by lib/cli.mjs (the one argv contract) before anything here runs.

const names = (await readdir(DIR)).filter((n) => /\.m?js$/.test(n)).sort();
if (!names.length) { console.error(`FATAL — no .js chunks under ${DIR}.`); process.exit(2); }

const chunks = [];
for (const name of names) {
  const buf = await readFile(path.join(DIR, name));
  const src = buf.toString("utf8");
  // Statement-anchored on `^`, `\n`, `;` or `}` — a MINIFIED chunk packs
  // `;import{...}from"./x.js"` mid-line, and pure line anchoring reported the
  // entry of one real target as imp:0/exp:0 while it carried both. `;` inside
  // a string can still false-positive; for a coordinates ledger that trade is
  // documented, not hidden (the reassembly gate is elsewhere).
  const imports = [];
  for (const m of src.matchAll(/(?:^|[\n;}])import\s*(?:([^;]*?)\s*from\s*)?["']([^"']+)["'];?/g)) {
    imports.push({ clause: m[1] ? m[1].trim().slice(0, 400) : null, source: m[2] });
  }
  const exportNames = [];
  for (const m of src.matchAll(/(?:^|[\n;}])export\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(",")) {
      const asIdx = piece.indexOf(" as ");
      const exp = (asIdx >= 0 ? piece.slice(asIdx + 4) : piece).trim();
      if (exp) exportNames.push(exp);
    }
  }
  if (/(?:^|[\n;}])export default /.test(src)) exportNames.push("default");
  chunks.push({
    file: name,
    sha256: sha256(buf),
    bytes: buf.length,
    lines: src.split("\n").length,
    imports,
    exports: exportNames,
  });
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedFrom: path.relative(process.cwd(), DIR), generatedAt: new Date().toISOString(), chunks }, null, 1));

console.log(`=== census-bundles  ${chunks.length} chunk(s) in ${path.relative(process.cwd(), DIR)} ===`);
const rows = [...chunks].sort((a, b) => b.lines - a.lines);
for (const c of rows.slice(0, 12)) {
  console.log(`  ${String(c.lines).padStart(8)} lines  imp:${String(c.imports.length).padStart(2)} exp:${String(c.exports.length).padStart(3)}  ${c.file}`);
}
if (rows.length > 12) console.log(`  … ${rows.length - 12} more`);
console.log(`  -> ${path.relative(process.cwd(), OUT)}`);
// --md: the chunk graph as a REVERSE-NOTES section — the coordinates page a
// container-less (Vite) target gets in place of module-map output. Import
// clauses ride along verbatim: the aliases in them are tier-1 naming
// evidence (\`ap as Vector2\`), which is exactly what engine-notes cites.
const MD = flag("md", null);
if (MD) {
  const lines = [
    "# chunk 依赖图(census-bundles 生成 — 无容器产物的坐标页)",
    "",
    `来源 \`${path.relative(process.cwd(), DIR)}\`,${chunks.length} 个 chunk。sha256 是逆向笔记引用行号时的坐标钉;import 别名是一级命名证据。`,
    "",
    "| chunk | 行数 | 字节 | 导出 | 引入(来源 ← 别名样本) |",
    "|---|---|---|---|---|",
  ];
  for (const c of [...chunks].sort((a, b) => b.lines - a.lines)) {
    const imps = c.imports.map((i) => {
      const al = (i.clause || "").match(/\b\w+ as (\w+)/g);
      return `\`${i.source.replace(/^\.\//, "")}\`${al ? " ← " + al.slice(0, 3).map((x) => x.split(" as ")[1]).join(",") : ""}`;
    }).join("<br>");
    lines.push(`| \`${c.file}\` | ${c.lines.toLocaleString()} | ${c.bytes.toLocaleString()} | ${c.exports.length} | ${imps || "—"} |`);
  }
  lines.push("", `sha 钉:见 \`${path.relative(process.cwd(), OUT)}\` 逐 chunk 的 sha256 字段。`);
  await (await import("node:fs/promises")).writeFile(path.resolve(MD), lines.join("\n") + "\n");
  console.log(`  -> ${MD}`);
}
