#!/usr/bin/env node
/**
 * flight-to-mdx.mjs — 从 flight 元素树反推 MDX 源。 [v0.3;在 rauchg.com 上实证:
 * 17 页全过,flight 语义门 18/18]
 *
 * ⚠ 站点侧适配(拷到复刻项目后改这些,像 harvest.config 一样属于站点):
 *   - LINK_CLASS:目标站链接组件的类名字节(从 flight 逐字取)
 *   - SHAPE:结构组件的 className 指纹(callout/figure/caption/…)
 *   - FIRST_PARTY:一方客户端组件 flight 引用 → (组件名, 文件) 映射
 *   - ROOT_TITLE / ROOT_DESC:根布局元数据(判"页面无 metadata"用)
 * 其余(markdown 构词、[#id] 标题、化石发射、MDX 陷阱规避)是通用机制。
 *
 * 输入:docs/flight/<slug>.json(flight-decode 产物,已解引用)
 * 输出:rebuild/app/(post)/<year>/<slug>/page.mdx 等
 *
 * 策略(保真优先):
 *  - 已识别的 markdown 构词(p/h2[#id]/h3/ul/ol/li/blockquote/pre>code/内联
 *    code/strong/em/链接)→ markdown 语法;
 *  - 站点组件形状(Callout/Figure/Caption/Tweet/Snippet/FootNotes/HR)→ JSX 组件调用;
 *  - 其余一切 → 带精确 className 的字面 JSX(兜底,不丢字节);
 *  - 不可序列化的 prop → 响亮失败,宁可停也不静默丢。
 *
 * 文本中的 "\n" 是源 markdown 的软换行化石,原样保留;
 * 标题文本尾部空格 + id → 还原为 `text [#id]`。
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const FLIGHT = flag("flight", "docs/flight");
const OUT = flag("out", "rebuild/app");
const MIRROR = flag("mirror", "mirror");
const ONLY = flag("only", null);

const LINK_CLASS =
  "border-b text-gray-600 border-gray-300 transition-[border-color] hover:border-gray-600 dark:text-white dark:border-stone-600 dark:hover:border-white ";

const isEl = (v) => Array.isArray(v) && v[0] === "$" && v.length >= 4;
const tagOf = (v) => (typeof v[1] === "string" ? v[1] : v[1] && (v[1].$component || v[1].$symbol) || "?");
const propsOf = (v) => v[3] || {};
const kidsOf = (v) => propsOf(v).children;

/** 页面种子:只沿并行路由结构([node, {children: seed}] 链)下潜,不进元素内部
 *  —— react-tweet 媒体网格里也有带 key 的 fragment,按"最深 fragment"选会採进
 *  推文肚子里(实测 next-for-vercel)。 */
function pageSeedOf(tree) {
  let cur = tree.f[0][1];
  let lastNode = null;
  while (cur) {
    let node = null, next = null;
    if (isEl(cur)) { node = cur; }
    else if (Array.isArray(cur)) {
      node = cur.find(isEl) || null;
      const cont = cur.find((x) => x && typeof x === "object" && !Array.isArray(x) && x.children !== undefined);
      next = cont ? cont.children : null;
    } else if (cur && typeof cur === "object" && cur.children !== undefined) {
      next = cur.children;
    }
    if (node) lastNode = node;
    cur = next;
  }
  return lastNode;
}

/** 收集树内全部文本。 */
function textOf(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (isEl(v)) return textOf(kidsOf(v));
  if (Array.isArray(v)) return v.map(textOf).join("");
  if (v && typeof v === "object" && v.children !== undefined) return textOf(v.children);
  return "";
}

function jsonOf(v) { return JSON.stringify(v); }

// ---------------------------------------------------------------------------
// JSX 序列化(兜底 + 组件调用共用)
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function jsxProps(props, ctx) {
  const parts = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === "children") continue;
    if (v === undefined) continue;
    if (v && typeof v === "object" && v.$undefined) continue;
    if (!IDENT.test(k) && !/^[a-zA-Z-]+$/.test(k)) throw new Error(`prop 名不可序列化: ${k}`);
    if (v === true) { parts.push(k); continue; }
    if (typeof v === "string") {
      // 含换行的值必须走 JSON 字符串字面量:MDX 的块解析会按缩进剥
      // 多行模板字面量的前导空格(实测 golf 页 pre 类名 6 空格被剥成 4)。
      if (v.includes("\n") || v.includes('"')) parts.push(`${k}={${jsonOf(v)}}`);
      else parts.push(`${k}="${v}"`);
      continue;
    }
    if (typeof v === "number" || v === false || v === null) { parts.push(`${k}={${jsonOf(v)}}`); continue; }
    if (typeof v === "object") {
      // 静态导入的图片对象:换成本页 import(资产从镜像拷贝)
      if (v.src && String(v.src).startsWith("/_next/static/media/")) {
        const imp = ctx.addStaticImage(v.src);
        parts.push(`${k}={${imp}}`);
        continue;
      }
      parts.push(`${k}={${jsonOf(v)}}`);
      continue;
    }
    throw new Error(`prop 不可序列化: ${k}=${typeof v}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}
function templ(s) {
  return "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
}

// ---------------------------------------------------------------------------
// 内联(markdown 行内)反推
function escapeMd(s) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/([*_`[\]<>{}])/g, "\\$1")
    .replace(/&(?=[a-zA-Z#])/g, "\\&");
}
function mdInlinable(kids) {
  const arr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
  return arr.every((k) =>
    typeof k === "string" ||
    (isEl(k) && ["strong", "em", "code", "b", "s"].includes(tagOf(k)) && mdInlinable(kidsOf(k)))
  );
}

function inline(v, ctx) {
  if (typeof v === "string") return escapeMd(v);
  if (typeof v === "number") return String(v);
  if (Array.isArray(v) && !isEl(v)) return v.map((x) => inline(x, ctx)).join("");
  if (!isEl(v)) {
    if (v && typeof v === "object" && v.$undefined) return "";
    throw new Error("内联遇到未知节点: " + jsonOf(v)?.slice(0, 120));
  }
  const t = tagOf(v);
  const p = propsOf(v);
  const kids = kidsOf(v);
  switch (t) {
    case "strong": return "**" + inline(kids, ctx) + "**";
    case "em": return "*" + inline(kids, ctx) + "*";
    case "b": return "<b>" + inline(kids, ctx) + "</b>";
    case "s": return "<s>" + inline(kids, ctx) + "</s>";
    case "br": return "<br/>";
    case "code": {
      // 无类名的 code = 作者手写的字面 JSX(markdown 反引号会走 Code 组件加类名)
      if (p.className === undefined || (p.className && p.className.$undefined)) {
        return `<code>{${jsonOf(textOf(kids))}}</code>`;
      }
      const txt = textOf(kids);
      const fence = txt.includes("`") ? "``" : "`";
      return fence + txt + fence;
    }
    case "a": {
      if (p.className === "relative text-xs top-[-5px] no-underline" && /^#f\d+$/.test(p.href || "")) {
        ctx.use("Ref");
        const n = textOf(kids).replace(/[^0-9]/g, "");
        return `<Ref id="${n}" />`;
      }
      const plain = mdInlinable(kids);
      const extras = Object.keys(p).filter((k) => !["href", "target", "rel", "className", "children"].includes(k));
      if (p.className === LINK_CLASS && plain && !extras.length) {
        if (/&[a-z#]+;/i.test(p.href)) return `<a href={${jsonOf(p.href)}} target="_blank" rel="noopener noreferrer" className=${jsonOf(LINK_CLASS)}>${inline(kids, ctx)}</a>`;
        return `[${inline(kids, ctx)}](${p.href})`;
      }
      return ctx.jsxCompact(v);
    }
    case "(default)#86796": { // next/link
      if (p.className === LINK_CLASS && mdInlinable(kids)) return `[${inline(kids, ctx)}](${p.href})`;
      return ctx.jsxCompact(v, "Link");
    }
    default:
      return ctx.jsxCompact(v);
  }
}

// ---------------------------------------------------------------------------
// 组件形状识别(className 指纹)
const SHAPE = {
  callout: "bg-gray-200 dark:bg-[#333] dark:text-gray-300 flex items-start p-3 my-6 text-base",
  figure: "my-5 flex flex-col items-center",
  caption: "block w-full text-xs my-3 font-mono text-gray-500 text-center leading-normal",
  footnotes: /^text-base before:w-\[200px\]/,
  footnote: "my-6",
  hr: /^my-8 text-center after:content/,
  snippet: /bg-gray-100[\s\S]*ml-\[-50vw\]/,
  tweetWrap: "tweet my-6",
};

function block(v, ctx) {
  if (typeof v === "string") {
    if (v.trim() === "") return null; // 块间 "\n" 化石:块之间统一空行
    return escapeMd(v);
  }
  if (Array.isArray(v) && !isEl(v)) {
    return v.map((x) => block(x, ctx)).filter((x) => x != null).join("\n\n");
  }
  if (!isEl(v)) throw new Error("块级未知节点: " + jsonOf(v)?.slice(0, 400));
  const t = tagOf(v);
  if (t === "script" && String((v[3] || {}).src || "").includes("/_next/")) return null;
  if (t === "link" && String((v[3] || {}).href || "").includes("/_next/")) return null;
  const p = propsOf(v);
  const kids = kidsOf(v);
  const cls = typeof p.className === "string" ? p.className : "";

  if (t === "p") {
    const arr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
    const INLINE_TAGS = new Set(["em", "strong", "a", "code", "b", "s", "br", "(default)#86796"]);
    const allBlockJsx =
      arr.some(isEl) &&
      arr.every((k) =>
        typeof k === "string" ? k.trim() === "" : isEl(k) && !INLINE_TAGS.has(tagOf(k))
      );
    if (allBlockJsx) {
      // 纯块级 JSX 内容的段落:MDX 会丢 p 外壳,用 <P> 保住(不含行内元素,
      // 否则 MDX 在 JSX 块内再生一层 p)
      ctx.use("P");
      return `<P>${arr.filter(isEl).map((k) => dispatchInsideJsx(k, ctx)).join("")}</P>`;
    }
    return inline(kids, ctx);
  }
  if (t === "h1") return "# " + headingText(kids, ctx);
  if (t === "h2") return "## " + headingText(kids, ctx);
  if (t === "h3") return "### " + headingText(kids, ctx);
  if (t === "blockquote") {
    const inner = block(kids, ctx);
    return inner.split("\n").map((l) => (l ? "> " + l : ">")).join("\n");
  }
  if (t === "ul" || t === "ol") {
    const items = (isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids]).filter(isEl);
    return items
      .map((li, i) => {
        const marker = t === "ul" ? "- " : `${i + 1}. `;
        const inner = liContent(li, ctx);
        return marker + inner.split("\n").join("\n" + " ".repeat(marker.length));
      })
      .join("\n");
  }
  if (t === "div" && cls === "my-6") {
    const arr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
    const els = arr.filter(isEl);
    if (els.length === 1 && tagOf(els[0]) === "pre") return block(els[0], ctx);
  }
  if (t === "pre") {
    // 围栏判据:pre>code>code 嵌套(markdown 围栏经 Pre+Code 双包装的指纹);
    // 其余(单层 code、内含元素)= 作者手写字面 JSX,逐字发射
    const outerCode = isEl(kids) ? kids : (Array.isArray(kids) ? kids.find(isEl) : null);
    const innerKids = outerCode ? kidsOf(outerCode) : null;
    const nested = innerKids && (isEl(innerKids) ? tagOf(innerKids) === "code" : Array.isArray(innerKids) && innerKids.length === 1 && isEl(innerKids[0]) && tagOf(innerKids[0]) === "code");
    if (nested) {
      const txt = textOf(kids);
      const fence = txt.includes("```") ? "````" : "```";
      return fence + "\n" + txt.replace(/\n$/, "") + "\n" + fence;
    }
    return ctx.jsx(v);
  }
  if (t === "div" && cls === SHAPE.callout) {
    const parts = (isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids]).filter(isEl);
    const emoji = textOf(parts[0]);
    let body = kidsOf(parts[1]); if (isEl(body)) body = [body];
    ctx.use("Callout");
    const bodyStr = typeof body === "string" && !/[<>{}]/.test(body)
      ? `text="${body.replace(/"/g, '&quot;')}"`
      : `text={<>${(Array.isArray(body) ? body : [body]).map((x) => inlineJsxText(x, ctx)).join("")}</>}`;
    return `<Callout emoji="${emoji}" ${bodyStr} />`;
  }
  if (t === "span" && cls === SHAPE.figure) { ctx.use("Figure"); return `<Figure>\n  ${jsxChildren(kids, ctx, "  ")}\n</Figure>`; }
  if (t === "span" && cls === SHAPE.caption) return captionOf(v, ctx);
  if (t === "div" && SHAPE.footnotes.test(cls)) {
    ctx.use("FootNotes");
    // 分隔符跟随镜像数据:同站两篇脚注一有 "\n" 文本节点一没有(作者手笔
    // 不一致,照抄)——字符串子节点显式发 {"json"},元素照译。
    const rawArr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
    const pieces = rawArr.map((n) => {
      if (typeof n === "string") return n === "" ? null : `{${jsonOf(n)}}`;
      if (!isEl(n)) return null;
      // 脚注 p:["1", ".", " ", <a href=#sN id=fN>^</a>, " ", 内容...]
      if (tagOf(n) === "p") {
        const arr = kidsOf(n);
        if (Array.isArray(arr) && typeof arr[0] === "string" && arr[1] === "." &&
            isEl(arr[3]) && tagOf(arr[3]) === "a" && /^#s\d+$/.test(propsOf(arr[3]).href || "")) {
          ctx.use("FootNote");
          const num = arr[0];
          const content = arr.slice(5);
          return `<FootNote id="${num}">${inline(content, ctx)}</FootNote>`;
        }
      }
      return block(n, ctx);
    }).filter((x) => x != null);
    return `<FootNotes>\n${pieces.join("\n")}\n</FootNotes>`;
  }
  if (t === "div" && SHAPE.hr.test(cls)) { ctx.use("HR"); return "<HR />"; }
  if (t === "div" && SHAPE.snippet.test(cls)) {
    ctx.use("Snippet");
    const inner = kidsOf(isEl(kids) ? kids : kids.find(isEl)); // max-w-2xl 内层
    // 内层保持字面 JSX:原组件内部不过 mdx 映射(镜像里这些 p 无 P 类名)
    return `<Snippet>\n  ${jsxChildren(inner, ctx, "  ")}\n</Snippet>`;
  }
  if (t === "div" && cls === SHAPE.tweetWrap) {
    const m = jsonOf(v).match(/status\\?\/(\d{8,})/);
    if (!m) throw new Error("tweet 包装里找不到 status id");
    ctx.use("Tweet");
    const arr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
    const cap = arr.find((k) => isEl(k) && tagOf(k) === "span" && propsOf(k).className === SHAPE.caption);
    if (cap) {
      let inner = kidsOf(cap);
      if (isEl(inner) && tagOf(inner) === "default#90777") inner = kidsOf(inner);
      if (isEl(inner) && tagOf(inner) === "span" && propsOf(inner).className === "[&>a]:post-link") inner = kidsOf(inner);
      const capStr = (Array.isArray(inner) && !isEl(inner) ? inner : [inner]).map((x) => inlineJsxText(x, ctx)).join("");
      if (/[<>{}]/.test(capStr)) return `<Tweet id="${m[1]}" caption={<>${capStr}</>} />`;
      return `<Tweet id="${m[1]}" caption="${capStr.replace(/"/g, '&quot;')}" />`;
    }
    return `<Tweet id="${m[1]}" />`;
  }
  // 兜底:字面 JSX
  return ctx.jsx(v);
}

function liContent(li, ctx) {
  const kids = kidsOf(li);
  // li 里可能是内联(紧凑项),也可能是块级内容(松散项:li > p 们)
  const arr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
  const hasBlock = arr.some((k) => isEl(k) && ["ul", "ol", "p", "blockquote", "pre", "div"].includes(tagOf(k)));
  if (!hasBlock) return inline(kids, ctx);
  // 松散项:逐块反推,块间空行(markdown 续行缩进由 ul 发射器补)
  const blocks = [];
  for (const k of arr) {
    if (typeof k === "string") { if (k.trim() !== "") blocks.push(escapeMd(k)); continue; }
    if (!isEl(k)) continue;
    blocks.push(block(k, ctx));
  }
  return blocks.filter((b) => b != null && b !== "").join("\n\n");
}

function headingText(kids, ctx) {
  // withHeadingId 的逆:span.relative[锚a, id a, 文本] → "文本[#id]";素串直出
  const arr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
  return arr
    .map((k) => {
      if (typeof k === "string") return escapeMd(k);
      if (isEl(k) && tagOf(k) === "span" && propsOf(k).className === "relative") {
        const inner = kidsOf(k);
        const parts = Array.isArray(inner) ? inner : [inner];
        const idA = parts.find((x) => isEl(x) && tagOf(x) === "a" && propsOf(x).id);
        const text = parts.filter((x) => typeof x === "string").join("");
        if (idA) return escapeMd(text) + `[#${propsOf(idA).id}]`;
        return escapeMd(text);
      }
      return inline(k, ctx);
    })
    .join("");
}

function captionOf(v, ctx) {
  // span.caption > Balancer > span.[&>a]:post-link > children
  ctx.use("Caption");
  let inner = kidsOf(v);
  if (isEl(inner) && tagOf(inner) === "default#90777") inner = kidsOf(inner);
  if (isEl(inner) && tagOf(inner) === "span" && propsOf(inner).className === "[&>a]:post-link") inner = kidsOf(inner);
  return `<Caption>${(Array.isArray(inner) ? inner : [inner]).map((x) => inlineJsxText(x, ctx)).join("")}</Caption>`;
}

/** JSX 上下文里的内联内容(不做 markdown 转义,链接保持 markdown 或 JSX)。 */
function inlineJsxText(v, ctx) {
  if (typeof v === "string") return v.replace(/([<>{}])/g, (c) => ({ "<": "&lt;", ">": "&gt;", "{": "&#123;", "}": "&#125;" }[c]));
  if (typeof v === "number") return `{${v}}`;
  if (Array.isArray(v) && !isEl(v)) return v.map((x) => inlineJsxText(x, ctx)).join("");
  if (!isEl(v)) { if (v && v.$undefined) return ""; throw new Error("JSX 内联未知节点"); }
  // 映射上下文(caption 等表达式内):MDX 会把小写标签映射到组件——
  // LINK_CLASS 的 a 发最小形,target/rel/className 由 A 组件补(实测双写)
  if (tagOf(v) === "a" && propsOf(v).className === LINK_CLASS) {
    const inner = kidsOf(v);
    const innerStr = (isEl(inner) ? [inner] : Array.isArray(inner) ? inner : [inner])
      .map((x) => inlineJsxText(x, ctx)).join("");
    return `<a href=${jsonOf(propsOf(v).href)}>${innerStr}</a>`;
  }
  return ctx.jsxCompact(v);
}

function jsxChildren(kids, ctx, pad) {
  const arr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
  return arr
    .map((k) => {
      if (typeof k === "string") {
        // 全部文本子节点发 {"json"} 表达式:裸文本会被 MDX 流处理包 p
        // (the-ai-cloud 表格);空白串在 pre 里是显著字节(2019 终端块),
        // 表达式形态下保留无副作用
        return `{${jsonOf(k)}}`;
      }
      if (typeof k === "number") return `{${k}}`;
      if (typeof k === "boolean") return `{${k}}`; // {cond && ...} 的布尔化石
      if (k && typeof k === "object" && !Array.isArray(k) && k.$undefined) return "{undefined}";
      if (k && typeof k === "object" && !Array.isArray(k) && k.$component === "DEMO_CODE#24956") { ctx.use("fp:DEMO_CODE#24956"); return "{DEMO_CODE}"; }
      return isEl(k) ? dispatchInsideJsx(k, ctx) : null;
    })
    .filter((x) => x != null && x !== "")
    .join("\n" + pad);
}

/** JSX 兜底里再遇到可识别形状(Caption 等)时仍走组件。 */
function dispatchInsideJsx(v, ctx) {
  const cls = typeof propsOf(v).className === "string" ? propsOf(v).className : "";
  const t = tagOf(v);
  if (t === "span" && cls === SHAPE.caption) return captionOf(v, ctx);
  if (t === "span" && cls === SHAPE.figure) { ctx.use("Figure"); return `<Figure>\n  ${jsxChildren(kidsOf(v), ctx, "  ")}\n</Figure>`; }
  if (t === "div" && cls === SHAPE.tweetWrap) return block(v, ctx);
  return ctx.jsx(v);
}

// ---------------------------------------------------------------------------
function indent(s, pad) { return s.split("\n").map((l) => (l ? pad + l : l)).join("\n"); }

// 一方客户端组件 → 组件名 + import 来源(相对 components/ 目录)
const FIRST_PARTY = {
  "Demo#33006": ["Demo", "pure-ui-demo"],
  "Demos#33006": ["Demos", "pure-ui-demo"],
  "Demo#24956": ["Demo", "golf-demo"],
  "DEMO_CODE#24956": ["DEMO_CODE", "golf-demo"],
  "YouTube#18165": ["YouTube", "youtube"],
  "Chart#92951": ["Chart", "chart"],
};

function makeCtx(slug) {
  const usedComponents = new Set();
  const staticImages = new Map(); // mirrorPath -> {name, file}
  const ctx = {
    use: (n) => usedComponents.add(n),
    usedComponents,
    staticImages,
    addStaticImage(src) {
      if (!staticImages.has(src)) {
        const base = path.basename(src).replace(/\.[0-9a-f]{8}(?=\.[a-z0-9]+$)/i, ""); // 去内容哈希
        const name = "img" + (staticImages.size + 1) + "_" + base.replace(/[^a-zA-Z0-9]/g, "_").replace(/_[a-z0-9]+$/, "");
        staticImages.set(src, { name, file: base });
      }
      return staticImages.get(src).name;
    },
    jsxCompact(v, forcedName) {
      const t = tagOf(v);
      let name = forcedName || t;
      if (FIRST_PARTY[t]) { name = FIRST_PARTY[t][0]; ctx.use("fp:" + t); }
      else if (t === "Image#60547") { name = "Image"; ctx.use("Image"); }
      else if (t === "(default)#86796") { name = "Link"; ctx.use("__nextlink"); }
      else if (t === "default#90777") { name = "Balancer"; ctx.use("__balancer"); }
      else if (t.includes("#")) throw new Error(`未识别客户端组件: ${t}`);
      const p = propsOf(v);
      const kids = kidsOf(v);
      const keyAttr2 = typeof v[2] === "string" && !/^\.?\d+$/.test(v[2]) ? ` key=${jsonOf(v[2])}` : "";
      const open = `<${name}${keyAttr2}${jsxProps(p, ctx)}`;
      if (kids === undefined || (Array.isArray(kids) && !isEl(kids) && kids.length === 0)) return open + " />";
      const arr = isEl(kids) ? [kids] : Array.isArray(kids) ? kids : [kids];
      const inner = arr.map((k) => {
        if (typeof k === "string") return inlineJsxText(k, ctx);
        if (typeof k === "number") return `{${k}}`;
        if (k && typeof k === "object" && !Array.isArray(k) && k.$component === "DEMO_CODE#24956") { ctx.use("fp:DEMO_CODE#24956"); return "{DEMO_CODE}"; }
        if (k && typeof k === "object" && !Array.isArray(k) && k.$undefined) return "{undefined}";
        if (isEl(k) && tagOf(k) === "a" && propsOf(k).className === LINK_CLASS) return inlineJsxText(k, ctx);
        return isEl(k) ? ctx.jsxCompact(k) : "";
      }).join("");
      if (!inner) return open + " />";
      return `${open}>${inner}</${name}>`;
    },
    jsx(v, forcedName) {
      const t = tagOf(v);
      let name = forcedName || t;
      if (FIRST_PARTY[t]) { name = FIRST_PARTY[t][0]; ctx.use("fp:" + t); }
      else if (t === "Image#60547") { name = "Image"; ctx.use("Image"); }
      else if (t === "(default)#86796") { name = "Link"; ctx.use("__nextlink"); }
      else if (t === "default#90777") { name = "Balancer"; ctx.use("__balancer"); }
      else if (t.includes("#")) throw new Error(`未识别客户端组件: ${t}(${slug})`);
      const p = propsOf(v);
      const kids = kidsOf(v);
      const keyAttr = typeof v[2] === "string" && !/^\.?\d+$/.test(v[2]) ? ` key=${jsonOf(v[2])}` : "";
      const open = `<${name}${keyAttr}${jsxProps(p, ctx)}`;
      if (kids === undefined || (Array.isArray(kids) && kids.length === 0)) return open + " />";
      const inner = jsxChildren(kids, ctx, "  ");
      if (!inner) return open + " />";
      return `${open}>${inner.includes("\n") ? "\n  " + inner + "\n" : inner}</${name}>`;
    },
  };
  return ctx;
}

// ---------------------------------------------------------------------------
async function invert(slugFile) {
  const j = JSON.parse(await readFile(path.join(FLIGHT, slugFile), "utf8"));
  const route = j.route; // e.g. /2020/static-hoisting/
  const seed = pageSeedOf(j.tree);
  if (!seed) throw new Error("找不到页面种子: " + slugFile);
  const kids = (Array.isArray(kidsOf(seed)) ? kidsOf(seed) : [kidsOf(seed)]).filter((k) => {
    if (isEl(k) && tagOf(k) === "script" && propsOf(k).async) return false;
    if (isEl(k) && tagOf(k) === "script" && String(propsOf(k).src || "").includes("/_next/")) return false;
    if (isEl(k) && tagOf(k) === "link" && String(propsOf(k).href || "").includes("/_next/")) return false;
    if (isEl(k) && String(tagOf(k)).startsWith("OutletBoundary")) return false;
    return true;
  });

  const ctx = makeCtx(route);
  const blocks = [];
  for (const k of kids) {
    const b = block(k, ctx);
    if (b != null && b !== "") blocks.push(b);
  }

  // metadata 反推(head f[0][2])
  const head = j.tree.f[0][2];
  const metas = {};
  (function walk(v) {
    if (isEl(v)) {
      const t = tagOf(v), p = propsOf(v);
      if (t === "title" && typeof p.children === "string") metas.title = p.children;
      if (t === "meta" && p.name === "description") metas.description = p.content;
      if (t === "meta" && p.property === "og:image") metas.ogImage = p.content;
      if (t === "meta" && p.property === "og:title") metas.ogTitle = p.content;
      if (t === "link" && p.rel === "alternate" && p.hrefLang) (metas.alternates ||= {})[p.hrefLang] = p.href;
      walk(kidsOf(v)); return;
    }
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object" && v.children !== undefined) walk(v.children);
  })(head);

  // 输出路径
  let rel;
  if (route === "/about/") rel = "about/page.mdx";
  else rel = path.join("(post)", route.replace(/^\/|\/$/g, ""), "page.mdx");
  const outFile = path.join(OUT, rel);
  await mkdir(path.dirname(outFile), { recursive: true });

  // 头部:imports + metadata
  const depth = rel.split("/").length - 1;
  const up = "../".repeat(depth);
  const compImports = [...ctx.usedComponents].filter((c) => !c.startsWith("__") && !c.startsWith("fp:") && c !== "Tweet" && c !== "Image");
  const lines = [];
  if (compImports.length) lines.push(`import { ${compImports.sort().join(", ")} } from "${up}components/mdx";`);
  if (ctx.usedComponents.has("Image")) lines.push(`import Image from "next/image";`);
  if (ctx.usedComponents.has("Tweet")) lines.push(`import { Tweet } from "${up}components/tweet";`);
  if (ctx.usedComponents.has("__nextlink")) lines.push(`import Link from "next/link";`);
  if (ctx.usedComponents.has("__balancer")) lines.push(`import Balancer from "react-wrap-balancer";`);
  for (const c of ctx.usedComponents) {
    if (c.startsWith("fp:")) {
      const [name, file] = FIRST_PARTY[c.slice(3)];
      lines.push(`import { ${name} } from "${up}components/${file}";`);
    }
  }
  for (const [src, { name, file }] of ctx.staticImages) {
    lines.push(`import ${name} from "./${file}";`);
    const mirrorFile = path.join(MIRROR, src.replace(/^\//, ""));
    await copyFile(mirrorFile, path.join(path.dirname(outFile), file)).catch((e) => {
      throw new Error(`静态图拷贝失败 ${mirrorFile}: ${e.message}`);
    });
  }
  if (route === "/2015/pure-ui/")
    lines.push(`import "${up}components/pure-ui.css"; // 页级样式(镜像 367b5958,该页 HL 多一条 css 为证)`);
  if (lines.length) lines.push("");
  const ROOT_TITLE = "Guillermo Rauch's blog";
  const ROOT_DESC = "Guillermo Rauch is the CEO and founder of Vercel, a software engineer, and the creator of Next.js, Mongoose, Socket.io and other open source libraries.";
  const md = { title: metas.title, description: metas.description };
  const og = metas.ogImage ? new URL(metas.ogImage).pathname : null;
  const inheritsAll = md.title === ROOT_TITLE && (md.description === ROOT_DESC || !md.description) && (!og || og === "/opengraph-image");
  if (inheritsAll) {
    // Q10:该页作者未写任何 metadata(golf 篇实测,头部全继承根)——照抄不补
  } else {
  lines.push("export const metadata = {");
  lines.push(`  title: ${jsonOf(md.title)},`);
  if (md.description && md.description !== ROOT_DESC) lines.push(`  description: ${jsonOf(md.description)},`);
  lines.push(`  openGraph: {`);
  lines.push(`    title: ${jsonOf(metas.ogTitle ?? md.title)},`);
  if (md.description && md.description !== ROOT_DESC) lines.push(`    description: ${jsonOf(md.description)},`);
  if (og) lines.push(`    images: [${jsonOf(og)}],`);
  lines.push(`  },`);
  if (metas.alternates) {
    lines.push(`  alternates: {`);
    lines.push(`    languages: ${jsonOf(metas.alternates)},`);
    lines.push(`  },`);
  }
  lines.push("};");
  lines.push("");
  }

  const body = blocks.join("\n\n");
  await writeFile(outFile, lines.join("\n") + "\n" + body + "\n");
  return { route, outFile, blocks: blocks.length, components: [...ctx.usedComponents] };
}

const { readdirSync } = await import("node:fs");
const files = readdirSync(FLIGHT)
  .filter((f) => f.endsWith(".json") && !["index.json", "csscss.json"].includes(f))
  .filter((f) => !ONLY || f.startsWith(ONLY));
let ok = 0, fail = 0;
for (const f of files.sort()) {
  try {
    const r = await invert(f);
    console.log(`ok   ${r.route}  blocks:${r.blocks}  comps:${r.components.filter((c) => !c.startsWith("__")).join(",") || "-"}`);
    ok++;
  } catch (e) {
    console.log(`FAIL ${f}: ${e.message}`); if (process.env.STACK) console.log(e.stack.split('\n').slice(1,8).join('\n'));
    fail++;
  }
}
console.log(`\n${ok} ok, ${fail} fail`);
if (fail) process.exit(1);
