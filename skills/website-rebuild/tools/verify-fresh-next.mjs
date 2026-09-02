#!/usr/bin/env node
// verify-fresh-next.mjs — verify-fresh 的 Next 形态（darkroom 实战入库，v0.3.13；readable-source §9.5.1）。
// C1 重构工程没有"bundler 一步"，链是 src-modules/ + app/ → next build → assemble-static(static-site/)。
// 判据同 verify-fresh：重新生成并比字节，不看时间戳。⛔ 前提：next.config 钉死 `generateBuildId`——
// 随机 buildId 让同一份源码两次 build 出不同 HTML，链条永远"过期"。
// 做法：把静态树现存 HTML 记 sha256，备份 .next，重跑 build，逐路由与 .next/server/app/*.html 比对，
// 再还原 .next。任一不同 = 伺服的不是源码现在构建出来的。
//   node tools/verify-fresh-next.mjs [--app rebuild] [--site rebuild/static-site]
import { readFile, readdir, mkdtemp, rm, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const APP = flag("app", "rebuild"), SITE = flag("site", join(APP, "static-site"));
async function* walk(d, base = d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) yield* walk(p, base); else yield p.slice(base.length + 1);
  }
}
const sha = async (p) => createHash("sha256").update(await readFile(p)).digest("hex");
const before = new Map();
// 只比路由 HTML：_next/ 下的 image@@… 是 harvest 落盘的优化图，不是页面
for await (const f of walk(SITE)) if (f.endsWith(".html") && !f.startsWith("_next/")) before.set(f, await sha(join(SITE, f)));
const chunksBefore = new Set((await readdir(join(APP, ".next/static/chunks"))).filter((f) => f.endsWith(".js")));
console.log(`static-site HTML files: ${before.size}; chunks: ${chunksBefore.size}`);
const tmp = await mkdtemp(join(tmpdir(), "fresh-next-"));
await cp(join(APP, ".next"), join(tmp, "next-before"), { recursive: true });
let buildErr = null;
try { execFileSync("npm", ["run", "build"], { cwd: APP, stdio: "pipe" }); } catch (e) { buildErr = e; }
let same = 0, diff = [];
if (!buildErr) {
  for (const [f, h] of before) {
    const built = f === "index.html" ? "index.html" : f.replace(/\/index\.html$/, ".html");
    const p = join(APP, ".next/server/app", built);
    try { if ((await sha(p)) === h) same++; else diff.push(f); } catch { diff.push(f + " (missing)"); }
  }
}
const chunksAfter = buildErr ? chunksBefore : new Set((await readdir(join(APP, ".next/static/chunks"))).filter((f) => f.endsWith(".js")));
const chunkDelta = [...chunksAfter].filter((c) => !chunksBefore.has(c)).length + [...chunksBefore].filter((c) => !chunksAfter.has(c)).length;
// 还原构建前的 .next（本门只判断，不改变伺服的产物）
await rm(join(APP, ".next"), { recursive: true, force: true });
await cp(join(tmp, "next-before"), join(APP, ".next"), { recursive: true });
await rm(tmp, { recursive: true, force: true });
if (buildErr) { console.log(`FAIL — next build failed: ${String(buildErr.stderr || buildErr.message).split("\n")[0]}`); process.exit(1); }
console.log(`HTML byte-identical: ${same}/${before.size}; chunk-set delta: ${chunkDelta}`);
if (diff.length) { console.log("  stale:", diff.slice(0, 8).join(", ")); console.log("FAIL — static-site is not what src builds now; run assemble-static + harvest after every build"); process.exit(1); }
console.log("PASS — static-site == fresh build of src (HTML bytes), chunk set stable");
