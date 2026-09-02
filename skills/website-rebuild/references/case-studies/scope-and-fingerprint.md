# case-studies/scope-and-fingerprint.md — 第 0 步：范围判定与指纹路由（⛔ 阻塞门） 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `scope-and-fingerprint.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `scope-and-fingerprint.md` 一一对应。

## 2. 指纹探测流程（六步，curl-only 可执行）

规则见 `scope-and-fingerprint.md` §2；下列各步只记实测出处。

### 步骤 1：存活性（GET，路径粒度）

- **必须 GET，禁止用 HEAD（`curl -sIL`）作唯一判据**：API Gateway/CloudFront 前端对 HEAD 返回假 404（kprverse：HEAD 404 / GET 200）【probe】。
- **路径粒度**：根域 200 不等于作品存活——dontboardme 根站 200 但获奖路径 404【probe】。
- **最终 URL 同一性校验**：`final` 落点域 ≠ 目标域即 X 信号（darknetflix 301→netflix.com、umami-land 整域 301→google.com）【probe】。`curl -sIL` 表面 200 会掩盖 301 退役信号。

### 步骤 2：双抓 diff（确定性）

- **byte-identical**：理想镜像对象（apple、noomo 的 SSR 输出连 26KB 注水负载都逐字节一致）【probe】。
- **token 级差异**：仅 nonce/随机装饰串（kprverse 全文只差 12 个字符的装饰性编号；某些 WAF/CDN 每次注入的轮换 token 同类）→ 仍可镜像，验收门加掩码规则，**不要误判为动态渲染判 D**【probe】。
- **内容级差异**：文案/结构/数据随请求变（A/B 分桶、个性化注水）→ D 信号（airbnb）【probe】。

### 步骤 3：物种/年代校验（防"隐性下线"）

- **技术栈年代与获奖年份矛盾** → X（dontboardme 根站已是 Nuxt3 重建版）【probe】。
- **generator/依赖 license 年份晚于获奖期 + 获奖期技术栈残留 grep 为零** → 隐性下线判 X（prometheus-fuels 域名 200 但已换成 WordPress+Elementor，原 WebGL 站残留为零；simply-chocolate 原域名原品牌但代码已是 Shopify Prestige 主题；koox 根 200 是 Shopify 替身）【probe】。
- 域名活 ≠ 作品活：star-atlas 获奖原版被重建版**原地偷换**（域名不变）——如需复刻"获奖那一版"，须提示用户走 Wayback【probe】。

### 步骤 5：bundle 可逆向性

- 有公开 sourcemap（`sourcesContent` 完整，如 orano/linear）→ 直取源码替代 beautify 流程，但 linear 型 RSC 站仍按 C 处理（sourcemap 不改变行为归属）【probe】。
- 未混淆产物（bruno-simon 4.86MB esbuild 标识符全保留、star-atlas）→ 跳过 js-beautify，行号坐标系直接建在原文件上【probe】。

### ⛔ 计数硬约束（贯穿步骤 4/5；任何进难度评级表的数字必须先过这三条）【shopifydesign】

shopify.design 的 Step 0 用 `tr ';{}' '\n' | grep -c` 数 token，一次产出三个假数字，且**直接进了难度评级表**——"滚动/动画编排 ★★★"整条建立在一个根本没被使用的 ScrollTrigger 上：

| Step 0 报的 | 逆向后的实际 |
|---|---|
| `ScrollTrigger` ×8 | **0 次真实使用**——全是 gsap core 对未注册插件的兜底钩子，插件从未 `registerPlugin` |
| `WebGLRenderer` ×33 | **1 处真实构造**；其余多为 three.js 自带的 `"THREE.WebGLRenderer: …"` 报错字符串 |
| 内联 GLSL ×107 | 应用层 **27 段**——`gl_FragColor` / `gl_Position` 命中了 three.js 自带的 shader chunk 库 |

- 第 1 条的复核数字：独立复核实测同一 bundle：`ScrollTrigger` 原始字面量出现 **2** 次而 `grep -c` 报 1；`WebGLRenderer` 出现 **34** 次而 `grep -c` 报 33。
- 第 2 条的归属数字：**vendor 库自带字符串会污染计数。** 上述 34 次 `WebGLRenderer` 里 **7** 次是 three.js 自己的 `"THREE.WebGLRenderer: …"` 报错串；GLSL 命中绝大多数来自 three 内置 shader chunk 库。

## 3. 判定树（按序执行，命中即停）

规则见 `scope-and-fingerprint.md` §3。

- 分层判级的实例：杂交站可分层判级：kprverse 整体 C，但 three 子层（独立 chunk 的命令式代码）可局部按 A 手法转写【probe】。

## 4. 二维判定表 + 三判据规则（防 noomo / shopify.design 型误判，宪法级）

规则见 `scope-and-fingerprint.md` §4。

**"检测到 Vue/Nuxt/声明式框架 → 判 C"是被锚点站证伪的错误捷径**【probe】。noomo 是 Nuxt3 SSR 站（`__NUXT__`、74 处 `data-v-`），按单因子规则会误判 C，而地面真值是 A——它的签名动画（GSAP ScrollSmoother 滚动叙事）全在客户端 chunk 里，已被成功 1:1 复刻。

**同一类错误在 `__reactRouterContext` 上重犯过一次**【shopifydesign】：该信号此前被本文件列为 C 信号，出处是 Shopify Editions spring2026——但那站判 C 的**真因是 R3F + Theatre.js（声明式引擎）**，与 React Router 本身无关。shopify.design 命中同一信号，逆向后确认为 **A**：47,224 行**命令式** three.js 引擎全在客户端 chunk 里（无 R3F、无 Theatre），React Router framework 模式**下发 route module**，1.24MB `_index` chunk 就是引擎本体。**信号被记在了错误的维度上**——框架名带来的是"下不下发行为源"，引擎范式才决定"下发的东西能不能转写"。

#### 4.0.1 ⛔⛔ C 类要拆成两类：「源码不下发」≠「写法是声明式」【eightdesign】

规则见 `scope-and-fingerprint.md` §4.0.1。

实测（eightdesign.co.jp，Next + Turbopack + R3F 9.6.0）：

| 观测 | 结果 |
|---|---|
| R3F 是否真在用 | 是——`rendererPackageName: "@react-three/fiber"`，且**站点自有代码**调 `useFrame`/`useThree` |
| 行为源在不在客户端 | **在**。`useFrame` 回调里是 `MathUtils.damp(x, y, 7, t)`、阈值 `0.01`、`1.02 * scrollDistortionWidth`——普通命令式代码 |
| 该 chunk 的构成 | JSX 调用 557、命令式数学与状态写入 99、**三位以上小数的魔数 7,216** |
| 逐字切片 | **18 个模块切片成功，`--check` 字节一致** |
| 换进页面 | **CLEAN**，8 个 canvas 与镜像一致，跨侧 **99.5%**（残差 1.18 / 自比带宽 0.68，同量级） |

⚠ 判 C2 之前仍要坐实两件事：① 站点**自有**代码用了那个库（不是 vendor 里躺着）；② 那些回调里确实是数学与状态写入，不是空壳。两条都可量化，如上表。

## 5. 探测纪律（14 条协议修正，逐条为实测教训）【probe】【shopifydesign】

规则见 `scope-and-fingerprint.md` §5；编号与之对应，只列有实测出处的条目。

1. 存活性判定到**路径粒度**，且用 GET 不用 HEAD（kprverse API 网关对 HEAD 假 404）。
4. bundle 响应 <1KB → 补齐 **Referer** 请求头重试（landonorris 的资产域缺 Referer 时返回 32 字节拒绝页，造成假阴性）。
6. 现代站 HTML 可能**没有任何 `<script src>`**（Shopify Editions 三代全靠内联 `import()`）——只认 script 标签会漏掉全部 JS。
7. **catch-all 假 200**：请求 `.map` 返回 index.html（other-side-of-truth）——对下载物做 content-type 与哈希碰撞校验。
8. bundle 内出现 `/api/` 字符串 ⇒ 强制做**运行时 API 快照**（synchronized-studio 的导航数据在 Contentful，实测 5 个运行时 API）。

   零命中假阴性的实测【airpodspro】：实测一个大厂产品页 Step 0 报 `/api/` = **0**，而 M0 的真实浏览器补录抓到：

   ```
   /us/shop/mcm/product-price?parts=…      /us/shop/bag/status?apikey=…
   /search-services/suggestions/defaultlinks/…    /api-www/global-elements/…/flyouts
   ```

   **全是运行时接口，前三条路径里没有 `/api/`**（大厂常按业务命名），第四条带 `/api` 但不在主 bundle 里。**M0 补录之前不得据此排除 B/D 类。** 那次签名行为仍在客户端所以判 A 不变，只是漏了一项 B 侧工作；但**同一个盲点用在别的站上可能把 D 类误判成 A 类**。
10. 未混淆产物（bruno-simon、star-atlas）可跳过 js-beautify——先做 **minification 形态预检**再决定流程。
11. 有公开 sourcemap（orano、linear）时直取 sourcesContent 源码，替代 beautify 流程。
13. **出现次数一律 `grep -o … | wc -l`，禁用 `grep -c`**——后者数的是匹配行数（shopify.design 实测：`ScrollTrigger` 真实 2 次报 1、`WebGLRenderer` 真实 34 次报 33）【shopifydesign】。

## 6. 常见坑

规则见 `scope-and-fingerprint.md` §6。

- **平台名预判**：凭"这是 Webflow/大厂站"直接预判会错——webflow.com 预判不适用，实测有手写 GSAP/three.js bundle，判 A【probe】。判级只认指纹证据。
- **拖延镜像**：31 个历年获奖站 29% 已消失，集齐五种消亡形态（域名易主/转发、平台回收、域名抢注、路径移除、原地替换）。
- **判级正确 ≠ 附带结论正确**：shopify.design 判 A 是对的，但同一份 verdict 附带的三条结论全被 M0 证伪——"单页站 / 1 条路由"实为 **3 条路由**（`/dap` 在 HTML 里写成绝对 URL，BFS 的 `href="/..."` 正则看不见）、"243 个媒体 URL"实为 **322 文件**、"漏抓因媒体 URL 埋在转义 JSON 里"也不成立（转义态独占仅 1 个），真因是**运行时构造的路径**。判级可以继承，**Step 0 的每个数字与每条附带结论都必须在 M0 逐条复核**【shopifydesign】。
