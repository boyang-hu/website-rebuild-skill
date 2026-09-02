#!/usr/bin/env node
// assemble-static.mjs — 把 `next build` 的静态预渲染产物摊成 serve.mjs 能伺服的静态树，
// 让像素门的两侧**同经 serve.mjs**（darkroom 实撞入库，v0.3.12）。
//
// 为什么存在：serve.mjs 只对自己伺服的 HTML 注入 probe-shim（`?__probe` 冻结时钟）；
// 重建侧若直接跑 `next start`，它那一侧不冻结——镜像帧 BLANK / 重建帧有画，自比带宽
// 不可比，跨侧差异全是"冻结不对称"制造的。把 `.next/server/app/**.html` 摊成
// `<route>/index.html`、`_next/static` 与 `public/*` 软链进去，两侧就都是 serve.mjs
// 伺服的静态树，同一份 shim、同一个 t。
//
//   node tools/assemble-static.mjs [--app rebuild/.next/server/app] [--static rebuild/.next/static]
//        [--public rebuild/public] [--out rebuild/static-site]
//
// ⚠ 只供对拍：软导航的 `?_rsc=` 载荷不在此树（next start 拓扑才有），sweep 仍跑 next start。
// ⚠ 文件约定的图标/OG 图由 Next 在运行时按路由生成，静态树里没有；像素门不依赖它们。
import { mkdir, readdir, symlink, copyFile, rm } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const APP = flag("app", "rebuild/.next/server/app");
const STATIC = flag("static", "rebuild/.next/static");
const PUBLIC = flag("public", "rebuild/public");
const OUT = flag("out", "rebuild/static-site");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
let pages = 0;
async function walk(dir, rel = "") {
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) { await walk(dir, r); continue; }
    if (!e.name.endsWith(".html")) continue;
    const route = r.replace(/\.html$/, "");
    const target = route === "index" ? path.join(OUT, "index.html") : path.join(OUT, route, "index.html");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(dir, r), target);
    pages++;
  }
}
await walk(APP);
await mkdir(path.join(OUT, "_next"), { recursive: true });
await symlink(path.resolve(STATIC), path.join(OUT, "_next/static"));
let linked = 0;
for (const e of await readdir(PUBLIC).catch(() => [])) {
  await symlink(path.resolve(PUBLIC, e), path.join(OUT, e)).then(() => linked++).catch(() => {});
}
console.log(`static-site assembled: ${OUT} — ${pages} page(s), _next/static linked, ${linked} public entr${linked === 1 ? "y" : "ies"} linked`);
console.log(`serve it with: node scripts/serve.mjs --side rebuild --root ${OUT}`);
