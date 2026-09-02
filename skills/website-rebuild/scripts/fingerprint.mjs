#!/usr/bin/env node
// fingerprint.mjs — Step 0 指纹侦察（references/scope-and-fingerprint.md §2 的
// 六步 curl 协议）的跨平台等价实现。为无 POSIX 工具链的环境而写：Windows
// PowerShell 没有 curl(-sL 语义)/cmp/fold/tr/perl，文档协议在那里一条都跑不了，
// 而 skill 自身的 compatibility 声明是 "Agent-agnostic"。
//
// ⛔ 本脚本是【证据采集器】，不出判级。判级必须由人/agent 按 §3 判定树执行——
//    "计数只提假设，不当结论"（§2 计数硬约束第 3 条）。报告里凡标注"信号提示"
//    的行都只是把 §3 的硬判据对应的证据摆到你面前，不替你下结论。
//
//   node fingerprint.mjs --target https://example.com/awarded-path \
//        [--bundle https://example.com/assets/main.xxx.js[,more.js]] \
//        [--out probe] [--gap-ms 5000]
//
// 六步对应关系（与文档逐条对齐）：
//   1 存活性：GET（绝不 HEAD——kprverse 假 404），手动跟随重定向并记录每一跳，
//     终点域同一性校验（darknetflix 301→netflix.com 型 X 信号）
//   2 双抓 diff：间隔 --gap-ms 再抓一次，字节比对 + 首批分歧点取证
//   3 物种/年代：generator meta、wp-content 密度、版权年份、商店主题替身 grep
//   4 技术指纹：剥 HTML 注释后枚举 <script src> 与内联 import()，
//     框架模式 × 引擎范式标记计数——一律出现次数语义（= grep -o | wc -l，
//     绝不用 grep -c 的行数语义；§2 计数硬约束第 1 条）
//   5 bundle 初检：<1KB 自动补 Referer 重试（landonorris 32 字节拒绝页假阴性）、
//     minification 形态预检、three 强签名与 /api/ 计数、catch-all 假 200 告警
//   6 出报告：probe/fingerprint-report.md——判级留给你
//
// 账本纪律：每个下载物记 sha256 + 字节数；请求间隔 ≥1s、单会话、UA 钉死为
// 文档协议里的同一字符串。
//
// 新写（v0.1.5）：把 scope-and-fingerprint.md §2 的手工协议脚本化，
// 协议内容零发明——每一步的判据与坑都以该文档为准。

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "./lib/hash.mjs";
// UA 钉死为协议里的同一字符串——lib/negotiate.mjs 的 BROWSER_UA（抓取侧同款）。
import { sanityEvidence, BROWSER_UA as UA } from "./lib/negotiate.mjs";
import { cli } from "./lib/cli.mjs";

cli({ known: ["target", "bundle", "out", "gap-ms"], file: import.meta.url });

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const TARGET = flag("target");
if (!TARGET) {
  console.error(
    "usage: fingerprint.mjs --target <url> [--bundle <url>[,<url>...]] [--out probe] [--gap-ms 5000]",
  );
  process.exit(2);
}
const OUT = path.resolve(flag("out", "probe"));
const GAP_MS = Math.max(1000, Number(flag("gap-ms", "5000")) || 5000);
const BUNDLES = (flag("bundle", "") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 出现次数语义（= grep -o | wc -l）。§2 计数硬约束：绝不数"匹配行数"。
const count = (s, re) => (s.match(re) || []).length;
const uniq = (arr) => [...new Set(arr)];
const stripWww = (h) => h.replace(/^www\./i, "");

const ledger = []; // {file, bytes, sha256, url}
const report = [];
const say = (line = "") => {
  report.push(line);
  console.log(line);
};

/** GET with manual redirect following (each hop recorded), 30s timeout. */
async function getManual(url, extraHeaders = {}) {
  const hops = [];
  let cur = url;
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) {
    const res = await fetch(cur, {
      redirect: "manual",
      headers: { "user-agent": UA, ...extraHeaders },
      signal: AbortSignal.timeout(30000),
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location") || "";
      hops.push({ url: cur, status: res.status, location: loc });
      await res.arrayBuffer().catch(() => {});
      if (!loc) break;
      cur = new URL(loc, cur).href;
      await sleep(1100);
      continue;
    }
    const body = Buffer.from(await res.arrayBuffer());
    return {
      finalUrl: cur,
      status: res.status,
      body,
      contentType: res.headers.get("content-type") || "",
      hops,
      ms: Math.round(performance.now() - t0),
    };
  }
  return {
    finalUrl: cur,
    status: 0,
    body: Buffer.alloc(0),
    contentType: "",
    hops,
    ms: Math.round(performance.now() - t0),
    error: "redirect chain >10 hops or missing Location",
  };
}

function saveArtifact(name, buf, url) {
  const p = path.join(OUT, name);
  writeFileSync(p, buf);
  ledger.push({ file: name, bytes: buf.length, sha256: sha256(buf), url });
}

/** Naive positional diff: only for locating the FIRST divergence points.
 *  An insertion shifts everything after it — fine as evidence, not as a diff tool. */
function diffSpans(a, b, max = 5) {
  const spans = [];
  const n = Math.min(a.length, b.length);
  let k = 0;
  while (k < n && spans.length < max) {
    if (a[k] !== b[k]) {
      const start = k;
      let equalRun = 0;
      let end = k;
      while (end < n && equalRun < 40) {
        equalRun = a[end] === b[end] ? equalRun + 1 : 0;
        end++;
      }
      const ctx = (s) =>
        s
          .slice(Math.max(0, start - 30), Math.min(s.length, end))
          .replace(/\s+/g, " ")
          .slice(0, 160);
      spans.push({ at: start, a: ctx(a), b: ctx(b) });
      k = end;
    } else k++;
  }
  return spans;
}

async function main() {
  say(`# fingerprint report — ${TARGET}`);
  say();
  say(`- 探测时间：${new Date().toISOString()}`);
  say(`- UA：协议钉死串（Chrome/126 桌面）；请求间隔 ≥1s；单会话`);
  say(
    `- ⛔ 本报告只提供证据与"信号提示"。判级按 references/scope-and-fingerprint.md §3 判定树人工执行；`,
  );
  say(
    `  全部计数为出现次数（非行数），且未做 vendor 归属剔除——进评级表前先过 §2《计数硬约束》。`,
  );
  say();

  // ---------- 步骤 1：存活性（GET，路径粒度，手动重定向链） ----------
  say(`## 步骤 1：存活性（GET，路径粒度）`);
  let first;
  try {
    first = await getManual(TARGET);
  } catch (e) {
    say(`- GET 失败：${e.message}`);
    say(`- 信号提示：连接层面不可达（DNS/TLS/超时）→ 结合 §3 的 X 硬判据人工核实`);
    finish(2);
    return;
  }
  say(
    `- code=${first.status} final=${first.finalUrl} redirects=${first.hops.length} time=${first.ms}ms bytes=${first.body.length}`,
  );
  for (const h of first.hops) say(`  - hop: ${h.status} ${h.url} -> ${h.location}`);
  if (first.error) say(`- ⚠ ${first.error}`);
  const tHost = stripWww(new URL(TARGET).hostname);
  const fHost = stripWww(new URL(first.finalUrl).hostname);
  if (tHost !== fHost)
    say(
      `- ⚠ 信号提示：最终落点域(${fHost}) ≠ 目标域(${tHost})——§3 X 硬判据之一（域名易主/平台回收型），请人工核实`,
    );
  if (first.status === 404)
    say(`- ⚠ 信号提示：目标路径 GET 404（本脚本用的就是 GET，已排除 HEAD 假 404）——§3 X 硬判据之一`);
  saveArtifact("a.html", first.body, TARGET);
  const aText = first.body.toString("utf8");
  say();

  // ---------- 步骤 2：双抓 diff（确定性） ----------
  say(`## 步骤 2：双抓 diff（间隔 ${GAP_MS}ms）`);
  await sleep(GAP_MS);
  let second;
  try {
    second = await getManual(TARGET);
    saveArtifact("b.html", second.body, TARGET);
  } catch (e) {
    say(`- 第二抓失败：${e.message}（确定性未取证）`);
  }
  if (second) {
    if (first.body.equals(second.body)) {
      say(`- BYTE-IDENTICAL（理想镜像对象；apple/noomo 型）`);
    } else {
      const bText = second.body.toString("utf8");
      const mismatch = diffSpans(aText, bText, 5);
      say(`- 不逐字节相同：a=${first.body.length}B b=${second.body.length}B（差 ${Math.abs(first.body.length - second.body.length)}B）`);
      for (const s of mismatch) {
        say(`  - 首个分歧点@${s.at}:`);
        say(`    a: ${s.a}`);
        say(`    b: ${s.b}`);
      }
      say(
        `- 分类留给人工（§2 步骤 2 三分类）：仅 nonce/轮换 token 级差异 → 仍可镜像加掩码，**不要误判为动态渲染判 D**；文案/结构/数据随请求变 → D 信号。`,
      );
      say(`  （以上为位置对齐的朴素 diff，插入会使后续错位——细致比对请对 a.html/b.html 跑真 diff 工具。）`);
    }
  }
  say();

  // ---------- 步骤 3：物种/年代校验 ----------
  say(`## 步骤 3：物种/年代校验（防"HTTP 200 的尸体"）`);
  const generators = aText.match(/<meta[^>]+name=["']generator["'][^>]*>/gi) || [];
  say(`- generator meta：${generators.length ? "" : "无"}`);
  for (const g of generators.slice(0, 5)) say(`  - ${g.replace(/\s+/g, " ").slice(0, 160)}`);
  say(`- wp-content 出现次数：${count(aText, /wp-content/g)}`);
  const years = uniq(
    (aText.match(/(?:Copyright|©|&copy;)[^<]{0,80}(?:19|20)\d{2}/gi) || []).map((s) =>
      s.replace(/\s+/g, " ").trim().slice(0, 120),
    ),
  );
  say(`- 版权/年份字串（前 8 条）：${years.length ? "" : "无"}`);
  for (const y of years.slice(0, 8)) say(`  - ${y}`);
  say(
    `- 商店主题替身 grep（shopify|Prestige|Dawn|elementor，忽略大小写）：${count(aText, /shopify|prestige|dawn|elementor/gi)}`,
  );
  say(
    `- Shopify 平台指纹：cdn/shop/=${count(aText, /cdn\/shop\//g)}  Shopify.theme=${count(aText, /Shopify\.theme/g)}  cdn.shopify.com=${count(aText, /cdn\.shopify\.com/g)}  myshopify.com=${count(aText, /myshopify\.com/g)}（命中 → B 类路由候选，见 references/shopify-platform.md）`,
  );
  // Sanity 证据采集（lib/negotiate.mjs；三种拼写归一后计数——裸写/\/ 转义/%2F 编码）
  const sanity = sanityEvidence(aText);
  if (sanity.projects.length || sanity.apiHosts.length || sanity.cdnRefs) {
    say(`- Sanity CMS 指纹（命中 → 加载 references/sanity-platform.md；判级看内容烘焙时点 §0，不看库名）：`);
    say(`  - cdn.sanity.io 出现 ×${sanity.cdnRefs}${sanity.cdnRefs && !sanity.projects.length ? " —— ⚠ 有主机引用（如 flight :HC preconnect）但本页无资产路径：在栈里但首页未用，projectId 去深层路由取证" : ""}`);
    for (const p of sanity.projects)
      say(`  - projectId=${p.projectId} dataset=${p.dataset}（引用 ×${p.n}）`);
    for (const h of sanity.apiHosts)
      say(`  - API 主机 ${h.host} ×${h.n} —— ⚠ HTML 里出现 API 主机 ≠ 运行时装配；是否 D 因素看断网首屏有无 GROQ 流量（§0 三形态）`);
    say(`  - auto=format ×${sanity.autoFormat}${sanity.autoFormat ? " —— ⛔ 内容协商：镜像必须发浏览器图片 Accept，否则拿到回退格式字节（sanity-platform.md §1.2；mirror-site/reconcile-gaps 已内置）" : ""}`);
    say(`  - "_key" 字段 ×${sanity.keyFields}（Sanity 数组项化石——C1 照抄，不进 normalize 名单）`);
    say(`  - M0 提醒：--hosts 需含 cdn.sanity.io 与上列 API 主机；next/image 代理 URL 先解码 url= 再判主机`);
  } else {
    say(`- Sanity CMS 指纹：无`);
  }
  say(
    `- 人工核对项：技术栈年代 vs 获奖年份是否矛盾；generator/license 年份晚于获奖期 + 获奖期技术栈残留为零 → 隐性下线判 X（§2 步骤 3）。`,
  );
  say();

  // ---------- 步骤 4：技术指纹（HTML 层） ----------
  say(`## 步骤 4：技术指纹（HTML 层，已剥注释；计数=出现次数）`);
  const noComment = aText.replace(/<!--[\s\S]*?-->/g, "");
  const scripts = uniq(
    [...noComment.matchAll(/<script\b[^>]*?\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]),
  );
  say(`- <script src> 枚举（${scripts.length} 条）：`);
  for (const s of scripts.slice(0, 40)) say(`  - ${s}`);
  if (scripts.length > 40) say(`  - …（其余 ${scripts.length - 40} 条见 a.html）`);
  const inlineImports = uniq(noComment.match(/import\(\s*["'][^"']+["']\s*\)/g) || []);
  say(`- 内联动态 import()（${inlineImports.length} 条；现代站可能没有任何 <script src>）：`);
  for (const s of inlineImports.slice(0, 20)) say(`  - ${s}`);
  say(`- 维度① 框架模式标记（单独命中一律不判级，见 §3/§4 二维表）：`);
  say(`  - self.__next_f（Next RSC flight）        = ${count(noComment, /self\.__next_f/g)}`);
  say(`  - __reactRouterContext（RR framework 模式）= ${count(noComment, /__reactRouterContext/g)}`);
  say(`  - __NUXT__（Nuxt）                         = ${count(noComment, /__NUXT__/g)}`);
  say(`  - data-v-xxxxxxxx（Vue scoped 密度）       = ${count(noComment, /data-v-[0-9a-f]{6,8}/g)}`);
  say(`  - <!--[-->（Vue3 SSR fragment 注释，剥注释前计数）= ${count(aText, /<!--\[-->/g)}`);
  say(`- 维度② 引擎范式标记：`);
  say(`  - theatre|@react-three（声明式引擎 → C 信号）= ${count(noComment, /theatre|@react-three/gi)}`);
  say();

  // ---------- 步骤 5：bundle 可逆向性 ----------
  say(`## 步骤 5：bundle 可逆向性初检`);
  if (!BUNDLES.length) {
    say(`- 未传 --bundle。从上面 <script src>/import() 清单里挑主 bundle 后复跑：`);
    say(`  node fingerprint.mjs --target "${TARGET}" --bundle <bundle-url> --out ${path.basename(OUT)}`);
  }
  for (let i = 0; i < BUNDLES.length; i++) {
    const url = BUNDLES[i];
    say(`### bundle ${i + 1}: ${url}`);
    await sleep(1100);
    let r;
    try {
      r = await getManual(url);
    } catch (e) {
      say(`- GET 失败：${e.message}`);
      continue;
    }
    let refererUsed = false;
    if (r.body.length < 1024) {
      // <1KB 极可能是缺 Referer 的拒绝页（landonorris 32 字节假阴性）——补 Referer 重试
      const refDir = TARGET.slice(0, TARGET.lastIndexOf("/") + 1);
      say(`- ⚠ 响应 ${r.body.length}B <1KB，疑似拒绝页——补 Referer(${refDir}) 重试`);
      await sleep(1100);
      try {
        r = await getManual(url, { referer: refDir });
        refererUsed = true;
      } catch (e) {
        say(`- Referer 重试失败：${e.message}`);
      }
    }
    saveArtifact(`bundle-${i + 1}.js`, r.body, url);
    const text = r.body.toString("utf8");
    const lines = text.split("\n");
    let longest = 0;
    for (const l of lines) if (l.length > longest) longest = l.length;
    say(
      `- code=${r.status} bytes=${r.body.length} content-type=${r.contentType}${refererUsed ? "（带 Referer）" : ""}`,
    );
    if (/text\/html/i.test(r.contentType))
      say(`- ⚠ 信号提示：.js 请求返回 HTML——疑似 catch-all 假 200（§5.7），对下载物做哈希碰撞校验`);
    // 形态预检：只印适用的那一支。两支都印时读者要自己判断哪半句成立，
    // 而图例挂在计数后面就会被当成结论读——本条与下面的 sourcemap 同族。
    say(`- 形态预检：lines=${lines.length} longest_line=${longest}`);
    say(
      longest > 5000
        ? `  → 单行 ${longest} 字符：minified，走 beautify 建行号坐标系`
        : `  → 最长行仅 ${longest} 字符、共 ${lines.length} 行：自带换行，**未压缩**，跳过 beautify 直接以原文行号建坐标系`,
    );

    // sourcemap：标记不是证据。三件事分开说——有没有标记 / 标记指向哪 / 那个 URL
    // 到底取不取得到。实测过一个 vendor bundle 报 sourceMappingURL=1，而那行是被
    // 拼进来的某个库 dist 残留的注释，指向的 .map 与 bundle 同名的 .map 双双 404。
    const smMatches = [...text.matchAll(/[#@]\s*sourceMappingURL=(\S+)/g)].map((m) => m[1]);
    if (!smMatches.length) {
      say(`- sourceMappingURL：无`);
    } else {
      say(`- sourceMappingURL ×${smMatches.length}：${smMatches.slice(0, 3).join("  ")}`);
      for (const rel of smMatches.slice(0, 3)) {
        let mapUrl = null;
        try {
          mapUrl = new URL(rel, url).href;
        } catch {}
        if (!mapUrl || rel.startsWith("data:")) { say(`  - ${rel} → 内联或不可解析，人工确认`); continue; }
        await sleep(1100); // politeness: the protocol is one session, low rate
        const mr = await getManual(mapUrl).catch(() => null);
        const okMap = !!mr && mr.status === 200;
        const hasContent = okMap && /"sourcesContent"\s*:\s*\[/.test(mr.body.toString("utf8").slice(0, 400000));
        say(
          `  - ${mapUrl} → HTTP ${mr ? mr.status : "ERR"}` +
            (okMap
              ? `，sourcesContent ${hasContent ? "完整 → 可直取源码替代 beautify" : "缺失 → 只有映射，仍需 beautify"}`
              : `，取不到 → 这个标记是残留，不是可用的 sourcemap`),
        );
        if (!/[/\\]/.test(rel)) {
          say(`    ⚠ 相对文件名且本 bundle 是拼接产物时，该标记可能属于被拼进来的某个库，不属于它`);
        }
      }
    }
    say(`- three 强签名（弱字符串 "three" 不算）：`);
    say(`  - WebGLRenderer        = ${count(text, /WebGLRenderer/g)}`);
    say(`  - THREE.WebGLRenderer  = ${count(text, /THREE\.WebGLRenderer/g)}（vendor 自带报错串份额 = 污染量）`);
    say(`- /api/ = ${count(text, /\/api\//g)}（>0 ⇒ 镜像阶段强制做运行时 API 快照，B 信号）`);
    say(`- ⚠ 以上计数含 vendor 未剔除——进难度评级表前必须回上下文确认真实使用点（§2 计数硬约束第 2/3 条）。`);
    say();
  }

  // ---------- 账本 ----------
  say(`## 下载物账本（sha256）`);
  for (const l of ledger) say(`- ${l.file}  ${l.bytes}B  sha256=${l.sha256}`);
  say();
  say(`## 下一步`);
  say(`1. 按 references/scope-and-fingerprint.md §3 判定树逐条走（命中即停），落判级写 probe/verdict.md；`);
  say(`2. 框架标记命中时必答 §4 三判据（框架模式 × 引擎范式二维表）；`);
  say(`3. 判级 A/B → 立即进 M0 镜像（历年获奖站消失率约 29%，镜像是抢救行为）。`);

  finish(0);
}

function finish(code) {
  const p = path.join(OUT, "fingerprint-report.md");
  writeFileSync(p, report.join("\n") + "\n");
  console.log(`\n[fingerprint] report -> ${path.relative(process.cwd(), p)}`);
  process.exitCode = code;
}

main().catch((e) => {
  say(`\nFATAL: ${e.stack || e.message}`);
  finish(2);
});
