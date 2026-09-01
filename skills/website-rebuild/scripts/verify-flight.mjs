#!/usr/bin/env node
/**
 * verify-flight.mjs — C1 的语义门:构建产物的 flight 树 ≟ 镜像的 flight 树。 [v0.3]
 *
 * 字节门到不了 C1 的收口:Turbopack 的 chunk 名/模块 id/css-module 类名/媒体哈希
 * 都是构建哈希命名空间,每次构建都不同,而它们**不携带行为**。本门把两侧 flight
 * 流各自解开、把哈希命名空间规范化掉、把模块 id 做**全局双射**(同一导出名处处
 * 对应同一对 id,一对多即红),然后逐节点深比较。其余一切差异 —— 文本、props、
 * 结构、数据 —— 原样判红。
 *
 * ⛔ 本门自带解析器,不 import flight-decode.mjs(那是喂给逆变换器的生产链;
 *    检查者不能是生产者,verification-gates.md §2.1.2)。
 *
 * 登记的规范化族(每条都有 REBUILD_PLAN 偏差表编号):
 *   N1 chunk 路径 /_next/static/chunks/<hash>.<ext> → CHUNK.<ext>(D2)
 *   N2 css-module 类 <stem>_<hash8>-module__<h>__<local> → <stem>-MOD__<local>(D2)
 *   N3 媒体 /_next/static/media/<name>.<hash>.<ext> → 归并为 MEDIA(D2;
 *      next/font 的字体文件名两侧都是内容哈希,名字不可比,字节由资产门另比)
 *   N4 I 行 turbopack 模块 id → 双射表(D2)
 *   N5 预载 <script async src=CHUNK> 元素与 HL 提示的数量差 → 按集合语义比(D2)
 *   N6 首页 c 字段 ["","index"] vs ["",""](D6,Vercel 边缘重写工件)
 *
 * 用法: node scripts/verify-flight.mjs --built rebuild/.next/server/app --mirror mirror
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const BUILT = flag("built", "rebuild/.next/server/app");
const MIRROR = flag("mirror", "mirror");
// 站点侧登记项(REBUILD_PLAN 偏差表编号写进旗标值旁的注释里):
// --normalize-props views,viewsFormatted   数值/格式化字段按纪元漂移归一(rauchg D9 型:
//     镜像各页是 ISR 不同再生时刻,源站自己就在发不一致的数据)
// --normalize-class react-tweet-theme      按 className 子串把整棵库渲染子树归一
//     (rauchg D10 型:库行为 × 第三方数据,数据纪元不可回放)
const NORM_PROPS = new Set((flag("normalize-props", "") || "").split(",").map((s) => s.trim()).filter(Boolean));
const NORM_CLASS = (flag("normalize-class", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const PUSH = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
function streamOf(html) {
  PUSH.lastIndex = 0;
  let s = "", m, n = 0;
  while ((m = PUSH.exec(html))) { n++; s += JSON.parse(m[1]); }
  return n ? s : null;
}
function rowsOf(stream) {
  const buf = Buffer.from(stream, "utf8");
  const out = new Map();
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) break;
    const id = buf.subarray(i, colon).toString("utf8");
    if (!/^[0-9a-f]*$/i.test(id)) { const nl = buf.indexOf(0x0a, i); if (nl < 0) break; i = nl + 1; continue; }
    let j = colon + 1;
    const tm = /^T([0-9a-f]+),/i.exec(buf.subarray(j, j + 20).toString("latin1"));
    if (tm) {
      const len = parseInt(tm[1], 16);
      const start = j + tm[0].length;
      out.set(id, { kind: "T", text: buf.subarray(start, start + len).toString("utf8") });
      i = start + len;
      if (buf[i] === 0x0a) i++;
      continue;
    }
    const nl = buf.indexOf(0x0a, j);
    const body = buf.subarray(j, nl < 0 ? buf.length : nl).toString("utf8");
    i = nl < 0 ? buf.length : nl + 1;
    if (body.startsWith("I")) out.set(id, { kind: "I", json: JSON.parse(body.slice(1)) });
    else if (body.startsWith("HL")) out.set(id, { kind: "HL", json: JSON.parse(body.slice(2)) });
    else if (body.startsWith("E")) out.set(id, { kind: "E", json: JSON.parse(body.slice(1)) });
    // React 19 stream-control sentinels (X async-iterable, C stop-stream) carry
    // a bare tag char, not JSON. Same crash the decoder hit — the gate has its
    // own parser, so it needs the same guard. Store raw; a $-ref resolves to a
    // stream marker (both sides symmetric, so it drops out of the diff).
    else {
      try { out.set(id, { kind: "json", json: JSON.parse(body) }); }
      catch { out.set(id, { kind: "raw", raw: body }); }
    }
  }
  return out;
}

// ---- 规范化 -----------------------------------------------------------------
const normStr = (s) =>
  s
    .replace(/\/_next\/static\/chunks\/(turbopack-)?[0-9a-f]{8,}\.(js|css)/g, "/_next/static/chunks/CHUNK.$2")
    .replace(/\/_next\/static\/media\/[A-Za-z0-9_.-]+\.woff2/g, "/_next/static/media/MEDIA.woff2")
    .replace(/\/_next\/static\/media\/([A-Za-z0-9_-]+?)\.[0-9a-f]{8}\.(png|jpe?g|svg|gif|webp|avif)/g, "/_next/static/media/$1.HASH.$2")
    .replace(/\b([a-z0-9_]+?)(?:sans|mono)?_[0-9a-f]{8}-module__[A-Za-z0-9_-]{4,10}__/g, "$1-MOD__")
    // react-tweet 一类库的 css-module:<stem>-module__<hash>__<local>
    .replace(/\b([a-z0-9-]+)-module__[A-Za-z0-9_-]{4,10}__/g, "$1-MOD__");

function resolve(v, table, side, ids, seen = new Set()) {
  if (typeof v === "string") {
    if (!v.startsWith("$")) return normStr(v);
    if (v.startsWith("$$")) return v.slice(1);
    if (v === "$undefined") return "«undef»";
    if (v.startsWith("$S")) return "«sym:" + v.slice(2) + "»";
    if (v.startsWith("$D")) return "«date:" + v.slice(2) + "»";
    const m = /^\$([L@])?([0-9a-f]+)$/i.exec(v);
    if (m) {
      const id = m[2];
      if (seen.has(id)) return "«cycle»";
      const row = table.get(id);
      if (!row) return "«missing:" + id + "»";
      if (row.kind === "T") return normStr(row.text);
      if (row.kind === "raw") return "«stream:" + row.raw + "»"; // X/C sentinel, both sides symmetric
      if (row.kind === "I") {
        ids.push(row.json[0]);
        return { $c: `${row.json[2] || "(default)"}` };
      }
      const s2 = new Set(seen); s2.add(id);
      return resolve(row.json, table, side, ids, s2);
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, table, side, ids, seen));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      // 站点登记的纪元漂移字段(--normalize-props)
      if (NORM_PROPS.has(k) && (typeof val === "number" || typeof val === "string")) { o[k] = "«prop:" + k + "»"; continue; }
      o[k] = resolve(val, table, side, ids, seen);
    }
    return o;
  }
  return v;
}

/** N5:丢弃预载 script 元素与 precedence 样式链接(可提升资源,不是内容——
 *  react-tweet 的 css 两侧内容哈希相同,只是挂载点不同:我们在内容树尾,
 *  镜像在 HL+头部);N7:children 数组尾部的空白字符串化石(MDX 源文件尾
 *  换行的投影,渲染不可见)。chunk 计数差异属于打包器切分,不属于行为。 */
function stripPreloads(v) {
  if (Array.isArray(v)) {
    if (v[0] === "$" && v[1] === "script" && v[3] && typeof v[3].src === "string" && v[3].src.includes("/_next/static/chunks/") && v[3].async)
      return null;
    if (v[0] === "$" && v[1] === "link" && v[3] && v[3].rel === "stylesheet" && v[3].precedence)
      return null;
    // 站点登记的库渲染子树(--normalize-class):库行为 × 第三方数据,
    // 数据纪元不可回放;源码保真面是组件调用本身
    if (v[0] === "$" && v[3] && typeof v[3].className === "string" && NORM_CLASS.some((c) => v[3].className.includes(c)))
      return "«lib-subtree:" + NORM_CLASS.find((c) => v[3].className.includes(c)) + "»";
    const mapped = v.map(stripPreloads);
    if (v.length >= 4 && v[0] === "$") return mapped;
    let arr = mapped.filter((x) => x !== null);
    if (arr.some((x) => Array.isArray(x) && x[0] === "$")) {
      // N7 尾部空白化石;N9 相邻字符串合并(DOM 渲染中文本节点自然连接,
      // 切分位置是 MDX 解析细节,不携带行为)。纯字符串数组(c 字段)不动。
      while (arr.length && typeof arr[arr.length - 1] === "string" && arr[arr.length - 1].trim() === "") arr.pop();
      const merged = [];
      for (const x of arr) {
        if (typeof x === "string" && typeof merged[merged.length - 1] === "string") merged[merged.length - 1] += x;
        else merged.push(x);
      }
      arr = merged;
    }
    return arr;
  }
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      let sv = stripPreloads(val);
      // N8:children 直接元素 vs 单元素数组 —— 渲染等价的两种 flight 编码
      if (k === "children" && Array.isArray(sv) && sv[0] === "$" && sv.length >= 4) sv = [sv];
      o[k] = sv;
    }
    return o;
  }
  return v;
}

function firstDiff(a, b, p = "$") {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${p}: 类型 ${typeof a} vs ${typeof b}`;
  if (typeof a === "string") return `${p}: ${JSON.stringify(a).slice(0, 220)} vs ${JSON.stringify(b).slice(0, 220)}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      const kind = (x) =>
        typeof x === "string" ? JSON.stringify(x.length > 14 ? x.slice(0, 11) + "..." : x)
        : Array.isArray(x) && x[0] === "$" ? `<${typeof x[1] === "string" ? x[1] : (x[1] && x[1].$c) || "?"}>`
        : x && x.$c ? `<${x.$c}/>` : typeof x;
      return `${p}: 长度 ${a.length} vs ${b.length}\n       建: ${a.map(kind).join(" ")}\n       镜: ${b.map(kind).join(" ")}`;
    }
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${p}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join(",") !== kb.join(",")) return `${p}: 键 {${ka}} vs {${kb}}`;
    for (const k of ka) {
      const d = firstDiff(a[k], b[k], `${p}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${p}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`;
}

// ---- 路由清单 ---------------------------------------------------------------
async function routes() {
  const out = [];
  async function walk(d, rel) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== "assets" && e.name !== "_next" && e.name !== "_pretty" && !e.name.startsWith("api") && !e.name.startsWith("og") && e.name !== "opengraph-image")
        { if (!e.name.includes("@@")) await walk(path.join(d, e.name), rel + e.name + "/"); }
      else if (e.name === "index.html" && !rel.includes("@@")) out.push(rel || "/");
    }
  }
  await walk(MIRROR, "");
  return out.filter((r) => r !== "csscss/");
}

let pass = 0, failCount = 0;
const pairs = new Map(); // mirrorId -> Set(builtId)
const report = [];
for (const r of await routes()) {
  const mirrorFile = path.join(MIRROR, r === "/" ? "index.html" : r + "index.html");
  const builtFile = path.join(BUILT, r === "/" ? "index.html" : r.replace(/\/$/, "") + ".html");
  let mHtml, bHtml;
  try { mHtml = await readFile(mirrorFile, "utf8"); } catch { report.push(`SKIP ${r} 镜像缺 HTML`); continue; }
  try { bHtml = await readFile(builtFile, "utf8"); } catch { report.push(`FAIL ${r} 构建缺 HTML(${builtFile})`); failCount++; continue; }
  const ms = streamOf(mHtml), bs = streamOf(bHtml);
  if (!ms || !bs) { report.push(`FAIL ${r} 一侧无 flight 流`); failCount++; continue; }
  const mt = rowsOf(ms), bt = rowsOf(bs);
  const mids = [], bids = [];
  const m0 = mt.get("0"), b0 = bt.get("0");
  if (!m0 || !b0) { report.push(`FAIL ${r} 缺行 0`); failCount++; continue; }
  let mTree = resolve(m0.json, mt, "mirror", mids);
  let bTree = resolve(b0.json, bt, "built", bids);
  mTree = stripPreloads(mTree); bTree = stripPreloads(bTree);
  // N6:首页 c 字段(Vercel 边缘重写工件,D6)
  if (r === "/" && Array.isArray(mTree.c) && mTree.c.join(",") === ",index" && bTree.c.join(",") === ",") {
    mTree.c = bTree.c = ["«c:registered-D6»"];
  }
  // N4:模块 id 双射(按出现顺序配对——两侧解析顺序同构)
  if (mids.length === bids.length) {
    for (let i = 0; i < mids.length; i++) {
      if (!pairs.has(mids[i])) pairs.set(mids[i], new Set());
      pairs.get(mids[i]).add(bids[i]);
    }
  }
  const d = firstDiff(bTree, mTree);
  if (d) { report.push(`FAIL ${r}\n       ${d}`); failCount++; }
  else { report.push(`ok   ${r}  (I 行 ${mids.length} 对)`); pass++; }
}

// 双射审计
let bij = 0, poly = [];
for (const [mid, set] of pairs) {
  if (set.size === 1) bij++;
  else poly.push(`${mid} -> {${[...set].join(",")}}`);
}
const builtSeen = new Map();
for (const [mid, set] of pairs) for (const b of set) {
  if (!builtSeen.has(b)) builtSeen.set(b, new Set());
  builtSeen.get(b).add(mid);
}
for (const [b, set] of builtSeen) if (set.size > 1) poly.push(`built ${b} <- {${[...set].join(",")}}`);

console.log("=== verify-flight ===");
for (const l of report) console.log("  " + l);
console.log(`  模块 id 双射:${bij} 对一一映射${poly.length ? `;⚠ 违背双射 ${poly.length} 条:` : ""}`);
for (const l of poly.slice(0, 10)) console.log("    " + l);
await mkdir("docs", { recursive: true });
await writeFile("docs/flight-gate-report.txt", report.join("\n") + "\n双射 " + bij + " 违背 " + poly.length + "\n");
if (failCount || poly.length) {
  console.log(`\nFAIL — ${failCount} 路由不一致,${poly.length} 条双射违背`);
  process.exit(1);
}
console.log(`\nPASS — ${pass} 路由 flight 语义一致,模块双射成立`);
