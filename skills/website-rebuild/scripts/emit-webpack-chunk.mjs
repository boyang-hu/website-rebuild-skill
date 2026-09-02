#!/usr/bin/env node
// emit-webpack-chunk.mjs — 多 chunk webpack 站的逐字切片交付形态（14islands 实战入库，F3）。
//
// slice-modules.mjs 只有两种出口：转写一个独立 webpack 运行时的 IIFE（整包替换，
// 解析不了住在别的 chunk 里的 id——本站 _app 有 24 个这样的 require）或 ESM。Next 的
// 多 chunk 拓扑要的是第三种：**把 chunk 按源站容器形态原样再发射**——
//   (self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([[2888], { <id>: function… }, runtimeCb])
// 模块体逐字、容器逐字、chunk 尾部的 runtime 回调逐字；解析交给镜像里源站自己的
// webpack-*.js 运行时（rsc/turbopack 路线里"再发射容器让真运行时解析"的 webpack 同构物）。
//
// ⛔ 先决条件：--map 必须是 module-map.mjs（webpack push 正签名读法，v0.3.10）或同形边界表；
//   --in 必须是 beautify 产出且 verify-tokens 通过（或对 token 不等的模块用 --raw 代入压缩原字节）。
// 产出：<parts>/<NNN>-<id>.js 逐模块部件（含首/尾两个非模块部件）+ <out> 按序拼接件。
// ⛔ 自校（--check 或每次都跑）：拼接件 === `_pretty` 原件逐字节 —— 这就是
//   readable-source.md §3.0.6 的拼接式分解语义：字节等价成立时全部运行时门的裁决免费转移。
//
//   node scripts/emit-webpack-chunk.mjs --in <pretty.js> --map <lines.json> --out <gen.js> --parts <dir> [--raw <min.js> --raw-bounds <bounds.json>] [--check]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cli } from "./lib/cli.mjs";

cli({ known: ["in", "map", "out", "parts", "raw", "raw-bounds"], bools: ["check"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const IN = flag("in"), MAP = flag("map"), OUT = flag("out"), PARTS = flag("parts");
// --raw <minified.js>:<id,id> — 这些模块的部件改用源站压缩原件的精确字节（bounds 由
// minified-module-bounds.mjs 用 token 流定位，JSON 经 --raw-bounds 传入）：用于 js-beautify 改坏
// 模板字面量的模块（14islands _app 模块 99150 实撞：嵌套模板 `${…}` 被排成 `$ {\n … }`，token 门抓住）。
// 拼接门对 raw 部件的断言改为：该字节串是压缩原件的精确子串。
const RAW_FILE = flag("raw", null), RAW_BOUNDS = flag("raw-bounds", null);
const RAW = RAW_FILE && RAW_BOUNDS ? JSON.parse(readFileSync(RAW_BOUNDS, "utf8")) : {};
const RAW_SRC = RAW_FILE ? readFileSync(RAW_FILE, "utf8") : "";
if (!IN || !MAP || !OUT || !PARTS) { console.error("usage: emit-webpack-chunk.mjs --in <pretty.js> --map <lines.json> --out <gen.js> --parts <dir> [--check]"); process.exit(2); }
const src = readFileSync(IN, "utf8");
const lines = src.split("\n");
const map = JSON.parse(readFileSync(MAP, "utf8"));
// --map 接受两种字段名：module-map.mjs 的 startLine/endLine 与项目侧 webpack-map 的 start/end。
const mods = map.modules
  .map((m) => ({ ...m, start: m.start ?? m.startLine, end: m.end ?? m.endLine, exports: m.exports ?? m.exportNames ?? [] }))
  .sort((a, b) => a.start - b.start);
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

// 部件切分：头（第 1 行到首模块前一行）、每个模块（start..end，含模块间的空行归前一个模块的尾部？
// ——不：模块间若有间隔行，归入下一部件的头部，保证覆盖无缝）、尾（末模块后到文件末尾）。
const parts = [];
let cursor = 1;
const head = lines.slice(0, mods[0].start - 1);
parts.push({ name: "000-head", text: head.join("\n") + "\n" }); cursor = mods[0].start;
mods.forEach((m, i) => {
  const gapBefore = lines.slice(cursor - 1, m.start - 1);
  const body = lines.slice(m.start - 1, m.end);
  const text = (gapBefore.length ? gapBefore.join("\n") + "\n" : "") + body.join("\n") + "\n";
  if (RAW[m.id]) {
    const raw = RAW_SRC.slice(RAW[m.id].start, RAW[m.id].end);
    parts.push({ name: `${String(i + 1).padStart(3, "0")}-${m.id}.raw`, id: m.id, text: (gapBefore.length ? gapBefore.join("\n") + "\n" : "") + "        " + raw + ",\n", exports: m.exports, lines: m.lines, raw: true, prettyText: text });
  } else
  parts.push({ name: `${String(i + 1).padStart(3, "0")}-${m.id}`, id: m.id, text, exports: m.exports, lines: m.lines });
  cursor = m.end + 1;
});
const tail = lines.slice(cursor - 1);
parts.push({ name: "999-tail", text: tail.join("\n") });

const joined = parts.map((p) => p.text).join("");
// 拼接门：非 raw 部件按序拼接（raw 位置代入其 pretty 文本）=== pretty 原件；raw 部件 = 压缩原件精确子串
const joinedPretty = parts.map((p) => (p.raw ? p.prettyText : p.text)).join("");
const rawOk = parts.filter((p) => p.raw).every((p) => RAW_SRC.includes(p.text.trim().replace(/,$/, "")));
const identical = joinedPretty === src && rawOk;
const CHECK = args.includes("--check");
if (!identical) {
  // 定位第一处分歧，便于修切分规则；不写盘。
  let k = 0; while (k < Math.min(joinedPretty.length, src.length) && joinedPretty[k] === src[k]) k++;
  if (!rawOk) console.log("  raw part(s) are not exact substrings of the minified source");
  console.log(`FATAL — reassembly differs from ${IN} at byte ${k} (joined ${joined.length} vs src ${src.length})`);
  console.log(`  src:    ${JSON.stringify(src.slice(Math.max(0, k - 40), k + 40))}`);
  console.log(`  joined: ${JSON.stringify(joinedPretty.slice(Math.max(0, k - 40), k + 40))}`);
  process.exit(1);
}
if (!CHECK) {
  rmSync(PARTS, { recursive: true, force: true }); mkdirSync(PARTS, { recursive: true });
  for (const p of parts) writeFileSync(join(PARTS, p.name + ".js"), p.text);
  writeFileSync(OUT, joined);
  writeFileSync(join(PARTS, "MANIFEST.tsv"), "PART\tMODULE\tLINES\tEXPORTS\tSHA12\n" + parts.map((p) => [p.name, p.id || "-", p.lines || p.text.split("\n").length, (p.exports || []).join(",") || "-", sha(p.text)].join("\t")).join("\n") + "\n");
} else {
  // --check：盘上部件重拼必须仍等于原件，且等于已写出的拼接件
  const onDisk = readdirSync(PARTS).filter((f) => f.endsWith(".js")).sort().map((f) => readFileSync(join(PARTS, f), "utf8")).join("");
  const outNow = readFileSync(OUT, "utf8");
  if (onDisk !== joined || outNow !== joined) { console.log("FATAL — on-disk parts or gen file drifted from the emitted assembly"); process.exit(1); }
}
const nraw = parts.filter((p) => p.raw).length;
console.log(`${CHECK ? "check " : ""}ok — ${mods.length} module part(s) + head + tail; reassembly === ${IN} (${src.length} bytes, sha12 ${sha(src)})${nraw ? `; ${nraw} raw part(s) = exact minified substrings` : ""}`);
