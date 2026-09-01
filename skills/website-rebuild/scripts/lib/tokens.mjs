// lib/tokens.mjs — token 流（acorn@8.14.0 钉死、spawn 不 import）与逐项比较。
//
// 出身（14islands F4，v0.3.10）：js-beautify 不止会"排坏到不可解析"（beautify-bundle
// 已守），还会**改变嵌套模板字面量的内容**——`${iW(e)}:${t};` 被排成
// `$ {  iW(e)  }: $ {  t  };`（各段换行），token 流 748,409 vs 748,398，而像素门/CLEAN/probe
// 全绿。凡把 `_pretty` 排版字节当交付物（再发射、切片拼接）的路线，token 流等价是
// 必需的门，不是可选的。本库被 beautify-bundle（产出后自查）与 verify-tokens（门）
// 共用；门不 import 生产者，两者只共享这份读法。
import { spawnSync } from "node:child_process";

export const ACORN_VERSION = "8.14.0";
const SEP = String.fromCharCode(1); // label 与 value 之间的分隔符（不会出现在任一侧）

/** 文件 → token 字符串数组（`label<SEP>value`），空白/位置无关。 */
export function tokenStream(file, { ecma = "2022" } = {}) {
  const r = spawnSync("npx", ["-y", `acorn@${ACORN_VERSION}`, `--ecma${ecma}`, "--tokenize", file], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0) throw new Error(`acorn@${ACORN_VERSION} failed on ${file}: ${(r.stderr || "").split("\n")[0]}`);
  return JSON.parse(r.stdout).map(
    (t) => `${typeof t.type === "object" ? t.type.label : t.type}${SEP}${t.value === undefined ? "" : String(t.value)}`,
  );
}

/** 首个分歧下标；两者全等返回 -1。 */
export function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  let k = 0;
  while (k < n && a[k] === b[k]) k++;
  return k === n && a.length === b.length ? -1 : k;
}

export const showToken = (t) => (t === undefined ? "<end>" : t.split(SEP).join(":").slice(0, 60));
