// lib/negotiate.mjs — 内容协商的 Accept 策略 + Sanity CMS 证据提取。
//
// 出身（basement D5，v0.3.9）：Sanity 的 `auto=format` 按请求 Accept 头选返回格式，
// 而本 skill 全部抓取 profile 曾是 `accept: */*`——从不声明图片格式支持。实测后果：
// 391 个 auto=format 变体全以回退格式落盘（webp 源被转码回 JPEG；png 1.13MB 的
// URL 浏览器实拿 61KB webp），采样 6/6 与浏览器字节分叉，而两侧都从镜像读、
// 下游门全绿。响应自己声明了这件事：`Vary: origin, accept`。
//
// ⛔ 标尺只有一把：IMG_ACCEPT 逐字照抄 Chrome 图片子资源请求的 Accept 头。
//    不要自创第三种 profile——保真目标是"浏览器会拿到的字节"，不是"更好的格式"。
// ⛔ 判定"这是图片请求"优先信 CDP 的资源类型（netcapture TSV 的 TYPE 列），
//    其次才是 URL 拼写（扩展名 / next/image 代理——代理 URL 的 Sanity 主机
//    编码嵌在 url= 参数里，判定前必须先解码）。
//
// sanityEvidence() 是 Step 0 的证据采集器（fingerprint.mjs 消费）：只采证据，
// 不出判级——判级看内容烘焙时点（references/sanity-platform.md §0 三形态）。
// 三种拼写都要认：裸写、JSON 转义（\/）、URL 编码（%2F，next/image 代理）——
// 与 D1a 四形态改写是同一课（只认一种拼写的规则天然失明，失明时表现是绿灯）。
//
// 本文件的合同由 selftest 钉住（沉默失效过八个版本的教训——没人查的规矩会安静失效）。

/** Chrome 图片子资源请求的 Accept 头，逐字照抄。 */
export const IMG_ACCEPT =
  "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

/**
 * 给定 URL（与可选的 CDP 资源类型提示）返回抓取应发的 Accept 头。
 * 图片 → IMG_ACCEPT（浏览器同款），其余 → "*" + "/*"（既有行为不变）。
 */
export function imageAcceptFor(url, typeHint = "") {
  if (/^image$/i.test(String(typeHint).trim())) return IMG_ACCEPT;
  try {
    const u = new URL(url);
    if (/\.(avif|webp|png|jpe?g|gif|svg|ico)$/i.test(u.pathname)) return IMG_ACCEPT;
    // next/image 代理：外层无扩展名，内层 url= 参数里才是真实图片 URL
    if (/\/_next\/image$/.test(u.pathname)) return IMG_ACCEPT;
    const inner = u.searchParams.get("url");
    if (inner && /\.(avif|webp|png|jpe?g|gif|svg)(\?|$)/i.test(inner)) return IMG_ACCEPT;
  } catch {
    /* 非法 URL：按非图片处理，调用方自会在 fetch 处失败 */
  }
  return "*/*";
}

/** 响应头 Vary 是否声明了按 Accept 协商（= 该 URL 的字节随请求 profile 变）。 */
export function isNegotiated(varyHeader) {
  return /(^|,)\s*accept\s*(,|$)/i.test(String(varyHeader || ""));
}

/**
 * 从 HTML/flight/payload 文本提取 Sanity CMS 证据（出现次数语义）。
 * 返回 { projects: [{projectId, dataset, n}], apiHosts: [{host, n}],
 *        autoFormat: n, keyFields: n }。
 */
export function sanityEvidence(text) {
  // 归一三种拼写：JSON 转义 \/ → /；URL 编码 %2F→/ %3A→:（只解这两个，
  // 整段 decodeURIComponent 会在孤立 % 上抛异常）
  const norm = String(text)
    .replace(/\\\//g, "/")
    .replace(/%2F/gi, "/")
    .replace(/%3A/gi, ":");
  const projects = new Map();
  for (const m of norm.matchAll(
    /cdn\.sanity\.io\/(?:images|files)\/([a-z0-9]+)\/([A-Za-z0-9_-]+)\//g,
  )) {
    const k = `${m[1]}/${m[2]}`;
    projects.set(k, (projects.get(k) || 0) + 1);
  }
  const apiHosts = new Map();
  for (const m of norm.matchAll(/([a-z0-9]+\.api(?:cdn)?\.sanity\.io)/g)) {
    apiHosts.set(m[1], (apiHosts.get(m[1]) || 0) + 1);
  }
  return {
    projects: [...projects].map(([k, n]) => {
      const [projectId, dataset] = k.split("/");
      return { projectId, dataset, n };
    }),
    apiHosts: [...apiHosts].map(([host, n]) => ({ host, n })),
    // 裸主机引用（含路径引用在内的全部出现）：flight 的 :HC preconnect 提示只写
    // `"https://cdn.sanity.io"`，不带 /images/<projectId>/ 路径——首页可以零资产
    // 引用而栈里有 Sanity（实测 darkroom.engineering：HC 提示在、projectId 要到
    // 深层路由才见）。cdnRefs>0 且 projects 空 = "在栈里但本页未见资产"，去深层
    // 路由取证 projectId。
    cdnRefs: (norm.match(/cdn\.sanity\.io/g) || []).length,
    autoFormat: (norm.match(/auto=format/g) || []).length,
    keyFields: (norm.match(/"_key"/g) || []).length,
  };
}
