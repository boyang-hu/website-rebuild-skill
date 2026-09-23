// lib/npx.mjs — 唯一的「钉死版本 npx 调用」拼写（acorn / js-beautify 等外挂工具）。
//
// 中文规格（本文件）
// 唯一的「钉死版本 npx 调用」拼写：POSIX 直接 `spawnSync("npx", …)`；Windows 上 npx 是 .cmd
// 垫片——直接 spawn 会 ENOENT，按 `npx.cmd` 名 spawn 又会 EINVAL，必须经 shell/cmd.exe。
// 这里把 argv 交给 `cmd.exe /d /s /c npx …` 执行：保留真实 argv（带空格的路径也不碎），
// 且不触发 Node 的 `shell:true` 弃用警告（DEP0190）。仍是零依赖，只 import node:child_process。
//
// 出身（Windows 移植修复）：beautify-bundle / module-map / slice-esm / cold-audit-decls /
// verify-module-map / lib/tokens 各自 `spawnSync("npx", …)`，在 Windows 上全员失败
// （acorn 与 js-beautify 的门成片假红）。收拢成一处，平台差异只有一个读法。
import { spawnSync } from "node:child_process";

/** `npx <args>`，在 Windows 上经 cmd.exe 执行。返回 spawnSync 的结果，调用方照旧读 status/stdout/stderr。 */
export function spawnNpx(args, options = {}) {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npx", ...args], options);
  }
  return spawnSync("npx", args, options);
}
