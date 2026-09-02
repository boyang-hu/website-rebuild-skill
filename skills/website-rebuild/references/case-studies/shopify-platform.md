# case-studies/shopify-platform.md — Shopify 平台层剥离（B 类场景） 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `shopify-platform.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `shopify-platform.md` 一一对应。

## 0. 分层模型（本指南的组织逻辑）

规则见 `shopify-platform.md` §0。

一个 Shopify 店铺的产物必须拆成**四层**看，**四层的复刻策略完全不同**，混作一团是 B 类最常见的失控源。前三层由 racing.shop 立起，第四层由 objectandarchive 实测补入：**主题层必须再切一刀**，把被 fork 的上游主题带来的**存量样板**与**店铺自研**分开【objectarchive】。

**为什么第四层非切不可**：`T-上游` 混进任一边都会直接损坏工作量估算——混进 `T-站点` 让移植任务表虚高（objectandarchive 实测 **+65%**），混进 `P` 则让剥离清单多出一批**本该原样保留**的块，删了就是未登记偏差。四层模型的直接产出就是"**你要移植多少东西**"（实测规模见 §0.3）。主题若非 fork 而来（从零定制），`T-上游` 为空集，四层退化回三层——但**"为空"必须是核验后的结论，不是默认假设**（§4 读法）。

- 路径形如 `/cdn/shop/t/<主题号>/assets/*` → **主题层**（`racing.shop` 是 `t/17`、allbirds `t/4159`、pangram `t/52`、simply-chocolate `t/126`、mana `t/18`、objectandarchive `t/11`）——落到 `T-上游` 还是 `T-站点` 再按 §0.2 判。

### 0.2 `T-上游` vs `T-站点`：主题层内部怎么判【objectarchive】

规则见 `shopify-platform.md` §0.2（判据 2 的自加件实例、判据 4 的注释原文）。

2. **资产名清单**：`/cdn/shop/t/<N>/assets/` 里上游标准件与店主自加件并存。Dawn 标准件名固定：`constants.js` / `pubsub.js` / `global.js` / `cart-drawer.js` / `cart-notification.js` / `details-disclosure.js` / `details-modal.js` / `quantity-popover.js` / `localization-form.js` / `predictive-search.js` / `animations.js`；店主自加件带站点前缀（objectandarchive：`oa-wishlist.js` / `oa-color-library.js` / `color-swatches.js`）。
4. **注释里的人称（最强的一手证据）**：开发者注释**用第三人称提上游主题** —— objectandarchive 原文 `wraps Dawn's #CartDrawer`、`use oa-* classes to avoid Dawn's cart CSS`、`--- Currency: kill all Dawn disclosure def…`。**"提到 Dawn" = 站在 Dawn 外面写的 = `T-站点`**；上游自己的代码不会这样称呼自己。

### 0.3 内联交织形态：没有文件边界时怎么分层【objectarchive】

规则见 `shopify-platform.md` §0.3。

**四层不一定分处不同文件。** racing.shop 三层各有各的 `<script src>`，按 §0 的路径判据即可分层；objectandarchive **既没有 bundle、也没有分层的文件边界**——三条路由合计 **62 个唯一内联 `<script>` 块**，四层混装其中：

| 层 | 块数 | 字节（逐块取各页最大值） | 备注 |
|---|---|---|---|
| `P` 平台 | 26 | 814,361 | **96% 是两块数据**（collection 页 629 KB 的 analytics 商品元数据、product 页 162 KB 的 wpmLoader）——**剥离成本与字节数无关**，别被总量吓到 |
| `A` 第三方 App | 4 | 15,259 | Klaviyo ×3 + Hulk Form Builder |
| `T-上游`（Dawn 存量） | 6 | 87,548 | JSON-LD ×3、`window.routes`/`cartStrings` 块、designMode class、selected-variant JSON 岛 |
| `T-站点`（自研） | **26** | **134,532** | **这 26 块就是移植任务表** |

把 87.5 KB 的 Dawn 存量误记成自研，任务表就是 222 KB 而不是 134.5 KB（**虚高 65%**），工期估算与里程碑切分一起偏。

**步骤 5——项目侧样例，以及「跑遍每一份文档」这条要求的由来：**

5. **归属门**：写脚本把普查结果与归属表 join，**任何未归属的块打印 UNCLASSIFIED、任何匹配到两条的打印 AMBIGUOUS，两者非零即退非零码**，并把它列进 M1 关账条件。这道门**本 skill 尚未提供现成脚本**（见 `scripts/README.md` TODO），按上面的判据自己写一个即可；可参照 objectandarchive 项目侧的 `layer-report.mjs` + `docs/layer-map.json`（三页 **0 UNCLASSIFIED / 0 AMBIGUOUS**）。**歧义不许用启发式自动消解**——猜一次就是几百 KB 在层间无声搬家。**归属门要跑在"构建层实际产出的每一份文档"上，不是"约定的那几条路由"上**——objectandarchive 的 404 页与被动入镜的 vendor 页因此在 M1 从未过门，直到 M2 的块级门把它们报成 UNCLASSIFIED 才补上。

**步骤 6 的两条实证：**

- **上游存量被"顺手修好"**：`T-上游` 的字节是上游写的，改它等于为零收益污染上游产物。objectandarchive 实测差点修掉 Dawn JSON-LD 里的一处转义绝对 URL（`"url":"https:\/\/<源站主机>"`），正解是**在 `external.txt` 里逐条判定，而不是"修"**；判据仍是 §0.2 那句"这段字节是谁写的，不是它作用在谁的 DOM 上"（该拼写为什么会漏判，见 `verification-gates.md` §1.6 第 4 类）；

**与步骤 5 的分工**：步骤 5 断言**每块都归了层**（零 UNCLASSIFIED），本步断言**每层都按自己的规则被处置了**；两道门都要，且都进关账。objectandarchive M2 实测：`T-站点` 26 / `T-上游` 6 / `A` 4 唯一块全部"逐字或只被本地化"，唯一被移除的块 = wpmLoader，0 UNCLASSIFIED；配套的 hunk 级门 5 页 **1,048 个差异 hunk 全部可由变换表重放**（变换表侧的下限纪律见 `dom-shell-strategies.md` §2 步骤 3）。

## 1. 平台层清单（实测确定规格）

### 1.1 运行期端点（服务层 stub，`serve-rebuild.mjs` 的 STUBS 表，首个命中生效）

规则见 `shopify-platform.md` §1.1；下列各行为该表对应行的实测取证（chunk 数 / feature 清单 / theme.js 调用点坐标）。

| 端点 / 前缀 | 作用 | 处置 | 依据 |
|---|---|---|---|
| `/cdn/shopifycloud/shop-js/**` | shop-js loader 及其运行时 chunk 图。loader 文件内静态列出 `./chunk.*.esm.js` 约 37 个 + `client.*.esm.js`；HTML 的 `window.Shopify.featureAssets['shop-js']` 声明 **22 个 feature**（cart-sync、follow-button、login、toast-manager、avatar、windoid、fed-cm、cash-offers、checkout-modal、pay-button、payment-terms、lead-capture、user-recognition、customer-accounts…） | 整前缀 200 `export {};` | D6 |
| `/cart.js` | Ajax Cart 读取（theme.js L1122 / L2237） | 200 空车 JSON | D2 |
| `/cart/{add,update,change,clear}(.js)?` | 加购 / 改量 / 清空（theme.js add L2199·L2222、change L1248·L1275、update L1165·L1230·L1377） | 200 空车 JSON | D2 |
| `/search/suggest*` | predictive-search（theme.js L3003 拼 `${Shopify.routes.root}search/suggest?q=…&section_id=predictive-search`） | 200 —— **形状须核，见坑 2** | D4 |
| `/recommendations/products*` | product-recommendations（theme.js L4357-4364） | 200 空 section —— **形状须核，见坑 2** | D2 |

## 2. 构建层登记变换清单

规则见 `shopify-platform.md` §2。

1. **D1a 同源绝对/协议相对 → 根相对**：`https://<host>/`、`http://<host>/`、`//<host>/` → `/`。**必须同时处理 JSON 转义形式** `https:\/\/<host>\/` → `\/`（内联 JSON-LD / 配置块里全是这种写法，漏了就留下真实外域引用）。**四种形态一个都不能少**：绝对 / 协议相对 / **转义绝对** `https:\/\/host\/` / **转义协议相对** `\/\/host\/`——objectandarchive 的主题注入脚本正是最后这种写法，只处理前三种时它会在 127.0.0.1 上解析成 `http://<源站>/…`，**离线镜像向线上真站要图**【objectarchive】。另见 D1c。
2. **D1b 外部 Shopify CDN / 其它外部主机 → 本地目录**：`https://cdn.shopify.com/` 与 `//cdn.shopify.com/` → `/cdn-shopify/`（含转义形式），对应镜像的 `assets/cdn.shopify.com/` 树。**转义形式对外部主机同样成立，别只给源站主机开**：objectandarchive 的 D1a 一开始只处理了源站主机的转义写法，外部主机漏掉，5 页共 25 处 `"input_custom_font_url":"https:\/\/cdn.shopify.com\/s\/files\/…woff2"` 就这样留在了一个已经关账、断言全绿的镜像里（登记为 D-T8；为什么每一道门都看不见它，见 `verification-gates.md` §1.6 第 4 类）【objectarchive】。
3. **D1c 裸主机基址常量 → 本地基址**【objectarchive】：遥测与主题代码常把基址写成**不带尾斜杠**的常量再拼路径（`"https://otlp-http-production.shopifysvc.com"`、`window.shopUrl='https://<host>'`）。只改写"带尾斜杠"形式时，objectandarchive 实测漏了 4 个遥测外联 + 2 个到线上源站的主题资产请求（那份资产一直在盘上）。**改写规则按主机匹配，不要求尾斜杠**；验收侧的配套要求见 `mirroring.md` §8。

⛔ **计数必须逐条，不能用"总数 `n === 0` 才抛"这个弱形式**：本表的 D1a/D1b 在一个页面里就可能命中数千次（objectandarchive 单次构建 5 条变换命中 15 / 5 / **2,540** / 20 / 5），URL 本地化一条就让"有变换发生"永远为真，而 **D8 noindex 注入失效不会有任何人发现**——弱形式在 Shopify 站上基本恒绿。完整判据、下限怎么量、以及"验收要从产物字节反推而不是读构建脚本的计数器"见 `dom-shell-strategies.md` §2 步骤 3；块级的配套断言见本文 §0.3 步骤 6。

## 3. 零外联的完整断言面（本次实测发现的门盲区）

规则见 `shopify-platform.md` §3。

**`零外联` 不等于"资源级探针没抓到外部请求"。** racingshop 的全页型 probe 报告零外联、零缺失资产，但构建产物里实际残留三类联网面【racingshop】：

（三类各是什么见 `shopify-platform.md` §3。）

## 5. localhost 语义分叉（Shopify 主题的 dev 逃生门）

规则见 `shopify-platform.md` §5。

Shopify 主题（尤其 Vite 工作流的定制主题）常在页面尾部内联按 host 分叉的 dev 探测。racing.shop 每页至少 1 处（首页 2 处：carousel-3d 与 pixel-footer），实测原文【racingshop】：

## 6. 常见坑

规则见 `shopify-platform.md` §6，编号一一对应。

1. **内联遥测比 `<script src>` 难删，且极易漏**：src 能按 URL 前缀批量 stub，内联块只能按 `data-source-attribution` 属性或唯一起始字面量正则定位。racingshop 删了 2 块（event_observer.bootstrap、wpmLoader），**漏了 analytics/trekkie 块与 pagehide 弃单块**（§3②）。做法：先枚举全部无 src 的 `<script>`（racing.shop 首页 **38 个**、objectandarchive 首页 **51 个**），逐个分类为"配置 / 结构化数据 / 主题逻辑 / 遥测"，再删——不要凭印象删。**这份枚举与 §0.3 的归属表是同一件事，做一次即可**：归属表落到层（`P`/`A`/`T-上游`/`T-站点`），删哪块是在层内再做的处置决定。
2. **stub 的响应形状必须按调用方的解析路径确定，不是"回 200 就行"**。racingshop 实测两处形状不匹配：`/recommendations/products` 回 `<div class="product-recommendations">`，而 theme.js L4364 用 `querySelector("product-recommendations")`（**标签名**）→ null → 读 `.childElementCount` 抛错；`/search/suggest` 回 JSON，而 theme.js L3003 走 `DOMParser` + `querySelector(".shopify-section")` → null → `importNode(null)` 抛错。**这类错只在交互态出现，load-time 探针全绿**——所以 §3 的交互态断言不是可选项。写 stub 前先去 bundle 里读一遍调用方怎么解析响应。
3. **no-op stub 必须同时是合法的 classic script 与 module**：racingshop 曾用 `export {}` 导致 classic script SyntaxError，改为纯注释文件才对。硬规则与判定方法见 `porting-discipline.md` §6.1。
4. **协议相对 URL 会被爬虫拼错**：`//<host>/x` 被误拼成 `https://<host>//<host>/x`，racingshop M0 因此产生 77 个假 404。修法是**旁路 gapfill 归一重解**（确认 76 个真实路径已在盘、1 个是目录基址属预期 404），**不要改共享爬虫脚本**。
5. **HLS 视频阶梯是静态爬取的盲区**：`.m3u8` 的 renditions 与 segments 不在 HTML 里，只有运行时才拉取——需单独补录（racingshop 补 3 renditions + 12 segments）。
6. **nonce 类字节不是内容差异，别判 D**：`<meta name="shopify-y">` 每请求变 UUID（racingshop、simply-chocolate 均实测），`__st` 里的 `reqid` / 用户 token `u` 也逐请求变（koox 实测）【probe】。冻结镜像值 + 对拍掩码即可。
9. **后端 stub 区的像素差是预期噪声，别用自创 CSS 去补**：racingshop 静态页对拍 FAQ 99% / Terms 96.9%，worstCell 精确落在 header 的账号头像（`shopify-account` 由被 stub 的 `account.js` 渲染）。归因到 stub 就结案，动 CSS 就是发明。
