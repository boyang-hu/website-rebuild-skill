#!/usr/bin/env node
// sourcify-chunk.mjs — 多 chunk 站的 M(n+1) 驱动（darkroom 实战入库，v0.3.13）。
// name-modules / modules-to-src / verify-module-map 三件套按【单文件 map】工作；多 chunk 站
// 用 merged map（tools/merge-module-maps.mjs 的 locations[]）。做法：模块以其 canonical location
// 归属 chunk，按 chunk 切闭包，逐 chunk 用 <modules-dir>/<chunk>.json 跑三件套 + 接受步，
// 产物落 <out-root>/<chunk>/。⛔ 子闭包的 id 与 map 同型（字符串）——数字 id 整批"not in map"。
//   node tools/sourcify-chunk.mjs <chunk> [--closure docs/app-closure.json] [--merged docs/module-map.json]
//        [--modules-dir docs/modules] [--out-root src-modules] [--work docs/sourcify] [--max-tier 1]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const chunk = process.argv[2];
if (!chunk || chunk.startsWith("--")) { console.error("usage: sourcify-chunk.mjs <chunk> [--closure f] [--merged f] [--modules-dir d] [--out-root d] [--work d] [--max-tier n]"); process.exit(2); }
const args = process.argv.slice(3);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const CLO = JSON.parse(await readFile(flag("closure", "docs/app-closure.json"), "utf8"));
const MERGED = JSON.parse(await readFile(flag("merged", "docs/module-map.json"), "utf8"));
const MODDIR = flag("modules-dir", "docs/modules"), OUTROOT = flag("out-root", "src-modules"), WORK = flag("work", "docs/sourcify");
const canon = new Map(MERGED.modules.map((m) => [String(m.id), (m.locations && m.locations[0] ? m.locations[0].chunk : m.chunk)]));
const ids = CLO.modules.map(String).filter((id) => canon.get(id) === chunk);
if (!ids.length) { console.log(`${chunk}: no closure modules canonical here`); process.exit(0); }
await mkdir(WORK, { recursive: true });
const cloFile = path.join(WORK, `closure-${chunk}.json`);
await writeFile(cloFile, JSON.stringify({ ...CLO, modules: ids }, null, 1));
const map = path.join(MODDIR, `${chunk}.json`), names = path.join(WORK, `names-${chunk}.json`), out = path.join(OUTROOT, chunk);
const run = (cmd) => { try { return execFileSync(process.execPath, cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return (e.stdout || "") + "\n" + (e.stderr || ""); } };
const tool = (f) => path.join(HERE, f), gate = path.join(HERE, "..", "scripts", "verify-module-map.mjs");
const n1 = run([tool("name-modules.mjs"), "--map", map, "--closure", cloFile, "--out", names]);
const n1b = run([tool("accept-names.mjs"), "--in", names, "--max-tier", flag("max-tier", "1")]);
const n2 = run([tool("modules-to-src.mjs"), "--map", map, "--closure", cloFile, "--names", names, "--out", out]);
const n3 = run([gate, "--map", map, "--closure", cloFile, "--src", out]);
const last = (s) => s.trim().split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 220);
console.log(`${chunk}: ${ids.length} modules\n  names: ${last(n1)} | ${last(n1b)}\n  src:   ${last(n2)}\n  gate:  ${last(n3)}`);
if (!/PASS/.test(n3)) process.exit(1);
