#!/usr/bin/env node
// verify-tokens.mjs — token 流等价门：排版/再发射件 ≟ 源站原件，逐 token（类型+值）相等，
// 忽略空白与位置。acorn@8.14.0 钉死（lib/tokens.mjs），不 import 任何生产者。
//
//   node verify-tokens.mjs <original.js> <emitted.js>
//   node verify-tokens.mjs --pairs pairs.tsv        # 每行: ORIGINAL <tab> EMITTED [<tab> TAG]
//
// 为什么存在（14islands F4）：js-beautify 会改变嵌套模板字面量的内容，而以排版字节
// 交付的路线上，像素门/CLEAN/probe 全部照绿——只有 token 流看得见。任一对不等即 FAIL，
// 打印首个分歧 token 的序号与两侧值。⛔ 退出码不许经过管道 tail（F10）。
import { readFileSync } from "node:fs";
import { tokenStream, firstDivergence, showToken, ACORN_VERSION } from "./lib/tokens.mjs";
import { cli } from "./lib/cli.mjs";

cli({ known: ["pairs"], file: import.meta.url, positional: "<original.js> <emitted.js>" });

const args = process.argv.slice(2);
const pi = args.indexOf("--pairs");
let pairs = [];
if (pi >= 0) {
  for (const line of readFileSync(args[pi + 1], "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || /^ORIGINAL\t/i.test(t)) continue;
    const [orig, emitted, tag] = t.split("\t");
    if (orig && emitted) pairs.push({ orig, emitted, tag: tag || emitted });
  }
} else if (args.length === 2) {
  pairs = [{ orig: args[0], emitted: args[1], tag: args[1] }];
}
if (!pairs.length) {
  console.error("usage: verify-tokens.mjs <original.js> <emitted.js> | --pairs pairs.tsv (ORIGINAL<tab>EMITTED[<tab>TAG])");
  process.exit(2);
}
let ok = 0, fail = 0;
for (const { orig, emitted, tag } of pairs) {
  let ta, tb;
  try { ta = tokenStream(orig); tb = tokenStream(emitted); }
  catch (e) { console.log(`FAIL ${tag}: ${e.message}`); fail++; continue; }
  const k = firstDivergence(ta, tb);
  if (k < 0) { console.log(`ok   ${tag}  ${ta.length} tokens`); ok++; }
  else { console.log(`FAIL ${tag}: ${ta.length} vs ${tb.length} tokens; first divergence at #${k}: ${showToken(ta[k])} vs ${showToken(tb[k])}`); fail++; }
}
console.log(`\n${fail ? "FAIL" : "PASS"} — ${ok} pair(s) token-identical, ${fail} differ (acorn@${ACORN_VERSION})`);
process.exit(fail ? 1 : 0);
