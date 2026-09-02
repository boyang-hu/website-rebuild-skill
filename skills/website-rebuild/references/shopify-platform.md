# Shopify 平台层剥离（B 类场景）

> **何时加载本文件**：Step 0 判级为 **B** 且指纹命中 Shopify（HTML 里 `cdn/shop`、`Shopify.theme = {...}`、`cdn.shopify.com`、`window.Shopify`、`myshopify.com`）时——在 M0 镜像动工前读完 §0/§3，在 M2 写构建/服务脚本时按 §1/§2 逐条对账。

## 0. 分层模型（本指南的组织逻辑）

一个 Shopify 店铺的产物必须拆成**四层**看，**四层的复刻策略完全不同**，混作一团是 B 类最常见的失控源。**主题层必须再切一刀**，把被 fork 的上游主题带来的**存量样板**与**店铺自研**分开【objectarchive】（实证：`case-studies/shopify-platform.md` §0）。

| 层 | 代号 | 归属 | 各店是否相同 | 复刻策略 |
|---|---|---|---|---|
| **平台层** | `P` | Shopify 厂商 | **相同**（版本漂移，形态不变） | 按 §1 清单**剥离**：加载期脚本换 no-op stub、运行期端点服务层 stub。本层是不变量，本指南给确定规格 |
| **应用层** | `A` | 店家装的第三方 App | **各店不同** | 逐个甄别，三分处置（见 §0.1） |
| **主题层·上游存量** | `T-上游` | 被 fork 的上游主题（Dawn / Prestige / Ella …） | 同一上游的店之间**相同** | **原样带过**：既不是剥离目标（它不是 Shopify 运行时），也不是移植目标（不是店主写的）。判据见 §0.2 |
| **主题层·站点自研** | `T-站点` | 店铺自己 | **各店不同** | 签名交互全部住这里。按 A 类手法**逐字移植**（`porting-discipline.md` + `dom-shell-strategies.md` 策略 A）。形态变量见 §4 |

**为什么第四层非切不可**：`T-上游` 混进任一边都会直接损坏工作量估算——混进 `T-站点` 让移植任务表虚高，混进 `P` 则让剥离清单多出一批**本该原样保留**的块，删了就是未登记偏差。四层模型的直接产出就是"**你要移植多少东西**"（实测规模见 `case-studies/shopify-platform.md` §0.3）。主题若非 fork 而来（从零定制），`T-上游` 为空集，四层退化回三层——但**"为空"必须是核验后的结论，不是默认假设**（§4 读法）。

判层的机械判据（对每个 `<script src>` / 每条网络请求执行）：

- 路径含 `/cdn/shopifycloud/`、`/.well-known/shopify/`、`/checkouts/`、`/cart/*.js`、`/shopify_pay/`、`cdn.shopify.com/storefront/`、`shop.app`、`monorail-edge.shopifysvc.com` → **平台层 `P`**。
- 路径形如 `/cdn/shop/t/<主题号>/assets/*` → **主题层**——落到 `T-上游` 还是 `T-站点` 再按 §0.2 判（各站主题号实例：`case-studies/shopify-platform.md` §0）。
- 路径形如 `cdn.shopify.com/extensions/<uuid>/<app>-<ver>/assets/*`，或指向第三方域（klaviyo / weglot / wunderkind / stape …）→ **应用层 `A`**。

**上面这组判据只对"有 URL 的东西"有效。** 内联 `<script>` 块没有 URL，四层可以**交织在同一批内联块里**，分离方法见 §0.3。

### 0.1 应用层三分处置

| 类型 | 例 | 处置 |
|---|---|---|
| 改变视觉/内容 | Weglot 运行时翻译文案【probe】、rimix-product-badges 徽章【probe】、shoplift A/B（上传了主题在用的 GTStandard 字体）【racingshop】 | **必须复刻**：镜像其产物，且对拍前固定其状态（否则出文案级伪差异）【probe】 |
| 纯遥测/营销 | Klaviyo、stape、gtag、wunderkind-api【probe】 | stub 并登记为偏差（同 D5 一族） |
| 后端依赖型 | 年龄验证 avp-age-verification【probe】、hCaptcha 表单保护【racingshop】 | 资产照抄入库；其后端调用按 §1 服务层 stub |

### 0.2 `T-上游` vs `T-站点`：主题层内部怎么判【objectarchive】

被 fork 的主题会往页面里塞一批**店主一行没碰过**的块与资产。总判据是**这段字节是谁写的，不是它作用在谁的 DOM 上**——一段专门去改 Dawn 组件的代码是店主写的（`T-站点`），一段 Dawn 原样带来的 JSON-LD 是上游写的（`T-上游`）。按序执行，前一条能定就不必用后一条：

1. **上游对照（最硬）**：取 `Shopify.theme.schema_version` 与血统年代（§4.1），去上游仓库（Dawn 直接读 `github.com/Shopify/dawn`）找同名 snippet/section 与块正文对照。**只有 Liquid 插值出来的值不同（文案、商品 JSON、路由前缀）→ `T-上游`**；结构、函数、类名有增删改 → `T-站点`。
2. **资产名清单**：`/cdn/shop/t/<N>/assets/` 里上游标准件与店主自加件并存。Dawn 标准件名固定：`constants.js` / `pubsub.js` / `global.js` / `cart-drawer.js` / `cart-notification.js` / `details-disclosure.js` / `details-modal.js` / `quantity-popover.js` / `localization-form.js` / `predictive-search.js` / `animations.js`；店主自加件带站点前缀（实证：`case-studies/shopify-platform.md` §0.2）。
3. **命名前缀**：自研代码几乎必然带站点前缀（`oa-*` 类名、`oa-*` CSS 变量、`OA` 全局），上游存量不带。
4. **注释里的人称（最强的一手证据）**：开发者注释**用第三人称提上游主题**（原文实证：`case-studies/shopify-platform.md` §0.2）。**"提到 Dawn" = 站在 Dawn 外面写的 = `T-站点`**；上游自己的代码不会这样称呼自己。
5. **角色**：只向上游组件**发布数据/文案**（`window.routes`、`cartStrings`、`variantStrings`、`accessibilityStrings`、JSON-LD、designMode class、selected-variant JSON 岛）→ `T-上游`；**动上游的 DOM / 打补丁 / 覆盖其行为**（搬 `<quantity-input>` 节点以保住 cart.js 的 handler、强显隐私横幅、用自定义事件把 scroll lock 与上游解耦）→ `T-站点`。

**边界情形**：上游块里被店主改过 Liquid 插值**值**的（如把 `Add to cart` 改成 `Add to Bag`）仍记 `T-上游`——代码形状是上游的，文案是内容不是行为；在归属表里加一条 note 说明即可。**判不出来的不许猜**：归属门要把它报成 UNCLASSIFIED / AMBIGUOUS 并挡住关账（§0.3 步骤 5），因为猜错一块就是几十 KB 在两层之间无声搬家。

### 0.3 内联交织形态：没有文件边界时怎么分层【objectarchive】

**四层不一定分处不同文件。** 无 bundle 的站上四层可以混装在同一批内联块里；`P` 层的字节大头往往是数据块，**剥离成本与字节数无关**，别被总量吓到；把上游存量误记成自研，工期估算与里程碑切分一起偏（62 块四层交织的普查表与虚高比例：`case-studies/shopify-platform.md` §0.3）。

分离按下列步骤执行，**产出必须是机器可校验的归属表，不是文档里的一句话**：

1. **普查**：枚举每个在范围内页面的全部 `<script>`（含无 `src` 的），**先掩掉 HTML 注释再枚举**（注释里的脚本会被当成真块，`mirroring.md` §9 有实录）。逐块记：内联/外链、字节、**块正文 sha256 前 12 位**、起止行、第一条作者注释、正文头 140 字符。
2. **按内容哈希建表，不按块序号或行号**：内联块的序号与行号会随渲染漂（证据与坐标系定义见 `reverse-engineering.md` §0.1）。哈希做主键还有一个副产品——同一块在三条路由上出现在三组不同行号，按哈希编目自动收敛成一行记录。
3. **逐块判层**：`P` 用平台特征字面量（`Shopify.analytics` / `wpmLoader` / `trekkie` / `__st` / `monorailEndpoint` / `ShopifyAnalytics.meta`）；`A` 用 App 名与其外部域；`T-上游` vs `T-站点` 用 §0.2。**每块起一个语义 id**（`oa-lenis-gsap-orchestration`、`oa-pdp-frame-compositor`，不要 `block-37`）——序号会漂，而这些名字要直接当移植任务表的行标题用。
4. **带 nonce 的块用锚点兜底**：少数平台块含逐请求 nonce（`eventMetadataId` / `requestId` / `reqid`），字节一变哈希就变。给这类条目补一条**只在该块出现、别处不出现的字面量**作探针；探针会**嵌套**（trekkie 引导块包含 shim 队列全文、analytics 载荷里含整个商品 JSON），所以要支持"必须出现在块首"的锚点形式。
5. **归属门**：写脚本把普查结果与归属表 join，**任何未归属的块打印 UNCLASSIFIED、任何匹配到两条的打印 AMBIGUOUS，两者非零即退非零码**，并把它列进 M1 关账条件。这道门**本 skill 尚未提供现成脚本**（见 `scripts/README.md` TODO），按上面的判据自己写一个即可（项目侧样例：`case-studies/shopify-platform.md` §0.3）。**歧义不许用启发式自动消解**——猜一次就是几百 KB 在层间无声搬家。**归属门要跑在"构建层实际产出的每一份文档"上，不是"约定的那几条路由"上**（实证：`case-studies/shopify-platform.md` §0.3）。

6. **把归属表当门用，不要止步于分类**：分层的结论必须落成**对产物字节的断言**，否则 `T-上游`「原样带过」只是一句口号——没人能证明它真的没被动过。断言的形状（objectandarchive 的 `verify-shell.mjs` BLOCKS 门，逐块按内容哈希 join 归属表）：

   对镜像里的**每个**内联块，在产物里找它的下落——
   - 哈希相同 → **逐字保留**，通过；
   - 哈希不同 → 把**登记变换表**在这块的镜像正文上重放一遍，结果等于产物里的某块 → 通过，并记下**这次重放用到了哪几条变换**；
   - 两者都不成立 → 这块**消失了、或被改成了变换表之外的形态**，判 fail。

   层规则就写在"用到了哪几条变换"这个集合上：**`T-上游` / `T-站点` / `A` 三层只允许该集合为空（逐字保留）或只含 URL 本地化那一条**（§2 的 D1a/D1b/D1c 同属 URL 本地化这一族，objectandarchive 把它们实现为一条 `T-LOCALIZE`），出现任何其它变换即 fail；**`P` 是唯一允许整块消失的层，且只允许消失 §2 D5b 登记过的那些块**（objectandarchive 全站唯一合法移除 = wpmLoader，D-P1b）。

   它挡住的是三件 hunk 级 diff 看不清的事：
   - **构建层在改移植目标**：无 bundle 的站上**外壳就是行为源**（签名行为住在内联 `<script>` 里，见 `reverse-engineering.md` §0.1），构建层动 `T-站点` 一个字节，就是构建层在改源程序——这也是这类站上策略 A 不是"省事的做法"而是唯一自洽做法的原因；
   - **上游存量被"顺手修好"**：`T-上游` 的字节是上游写的，改它等于为零收益污染上游产物。正解是**在 `external.txt` 里逐条判定，而不是"修"**（实证：`case-studies/shopify-platform.md` §0.3）；判据仍是 §0.2 那句"这段字节是谁写的，不是它作用在谁的 DOM 上"（该拼写为什么会漏判，见 `verification-gates.md` §1.6 第 4 类）；
   - **整块无声消失**：这恰恰是 hunk 级 diff 最不可读的一种失败——删掉一个 18 KB 的块只是"一个巨大的 hunk"，只有块级门报得出"哪个语义 id 没了"。

   **与步骤 5 的分工**：步骤 5 断言**每块都归了层**（零 UNCLASSIFIED），本步断言**每层都按自己的规则被处置了**；两道门都要，且都进关账（实证：`case-studies/shopify-platform.md` §0.3；变换表侧的下限纪律见 `dom-shell-strategies.md` §2 步骤 3）。

这条与 §6 坑 1（"内联遥测只能按属性或唯一起始字面量定位，不要凭印象删"）是同一件事的两端：**先有全量归属表，才谈得上删哪块**；而步骤 6 是第三端——**删完之后还要能证明只删了该删的那块**。

---

## 1. 平台层清单（实测确定规格）

以下两张表逐条来自 `racingshop-rebuild` 项目侧的 `serve-rebuild.mjs` 与 `build-site.mjs` 实际代码 + 镜像 HTML 取证【racingshop】（这两个是**项目脚本、不在本 skill 的 `scripts/` 里**——它们是每个项目按本表自己写的产物）。**先照此表建 stub，再用探针反查你的目标是否有表外项**。

### 1.1 运行期端点（服务层 stub，`serve-rebuild.mjs` 的 STUBS 表，首个命中生效）

| 端点 / 前缀 | 作用 | 处置 | 依据 |
|---|---|---|---|
| `/.well-known/shopify/monorail/**`（实见 `unstable/produce_batch`） | web-pixels-manager 的同源遥测批量上报口（HTML 内联配置 `monorailEndpoint`） | 服务层 200 `{}` | D5 |
| `/api/collect` | `shopify-perf-kit-3.8.0` 的 RUM beacon 口（脚本属性 `data-shs-beacon-endpoint`），sendBeacon + fetch 双通道 | 服务层 200 `{}` | D5；allbirds 亦见此端点【probe】 |
| 路径含 `web-pixels` 或 `/wpm@` | Web Pixels manager 沙箱与 loader | 200 `export {};`（JS） | D5 |
| `/cdn/shopifycloud/shop-js/**` | shop-js loader 及其运行时 chunk 图（chunk 数与 feature 清单实证：`case-studies/shopify-platform.md` §1.1） | 整前缀 200 `export {};` | D6 |
| `/cdn/shopifycloud/storefront/assets/storefront/{load_feature,event_observer_reporter}*` | 特性加载器与其动态 import 的遥测 reporter chunk | 200 `export {};` | D5 |
| `/cart.js` | Ajax Cart 读取 | 200 空车 JSON | D2 |
| `/cart/{add,update,change,clear}(.js)?` | 加购 / 改量 / 清空 | 200 空车 JSON | D2 |
| `/search/suggest*` | predictive-search（拼 `${Shopify.routes.root}search/suggest?q=…&section_id=predictive-search`） | 200 —— **形状须核，见坑 2** | D4 |
| `/recommendations/products*` | product-recommendations | 200 空 section —— **形状须核，见坑 2** | D2 |
| `/cdn/shopifycloud/portable-wallets/**` | Shop Pay 加速结算按钮资源 | 200 空 `<svg/>` | D3 |
| `/cdn/shopifycloud/checkout-web/**` | 结算 web 运行时 | 200 `export {};` | D3 |
| `/shopify_pay/**`（含 `accelerated_checkout`） | Shop Pay 会话 / 钱包 | 200 `{}` | D3 |
| `/checkouts/**`（含 `internal/preloads.js`） | 结算流程 | 200 `export {};` | D3 |
| `/cdn-shopify/storefront/web-components/account/**` | 客户账号 web components 懒加载 chunk | 200 `export {};` | D6 |
| 未命中任何静态文件 | —— | 回落 `404.html` 且**真返回 HTTP 404**（复刻 Shopify 语义，不要 200） | —— |

（theme.js 调用点坐标见 `case-studies/shopify-platform.md` §1.1。）

空车 JSON 用 Shopify Cart 对象的完整字段形状（`token/note/attributes/original_total_price/total_price/total_discount/total_weight/item_count/items/requires_shipping/currency/items_subtotal_price`），不要只回 `{}`——调用方会读字段。

### 1.2 加载期 `<script src>`（构建层换 no-op stub，`build-site.mjs` 的 STUB_SCRIPTS）

按**改写后**的 src 做子串匹配，命中则整个 `<script>` 标签替换为 `/stubs/noop.js` 并保留 `type="module"`（保住 importmap / 模块图合法）：

`/cdn/shopifycloud/shop-js/`（D6）· `/cdn/shopifycloud/storefront/assets/shopify_pay/`（D3）· `/cdn/shopifycloud/storefront/assets/storefront/load_feature`（D5）· `/checkouts/internal/preloads.js`（D3）· `/cdn-shopify/storefront/web-components/account.js`（D6）· `googletagmanager.com/gtag/js`（D5，外部）· `shop.app/checkouts/internal/preloads.js`（D6，外部）。

### 1.3 **不要**一并 stub 的平台脚本（verbatim 保留清单）

过度 stub 会改变 DOM 与时序，本身就是未登记偏差。racingshop 显式留下且实测无害的 11 项【racingshop】：

`theme.js`、`vendor.min.js`（主题层本体）· `importmap-polyfill/es-modules-shim.2.4.0.js` · `storefront/assets/storefront/origin_trials-*.js` · `cdn.shopify.com/storefront/standard-actions.js` · `shopifycloud/perf-kit/shopify-perf-kit-3.8.0.min.js`（beacon 由 §1.1 `/api/collect` 兜）· `shopifycloud/privacy-banner/storefront-banner.js` · `storefront/assets/shop_events_listener-*.js` · `storefront/assets/storefront/autosizes-*.js`（内联条件注入的 polyfill）· `storefront-forms-hcaptcha/*.iife.js`（内联 `captcha-bootstrap` 注入）· `cdn/s/trekkie.storefront.<40hex>.min.js`（内联 analytics 块注入——**留着它反而更安全，见 §3**）。

---

## 2. 构建层登记变换清单

对每个镜像 HTML 只做**登记在案**的变换，其余逐字保留（策略 A）【lando】【racingshop】：

1. **D1a 同源绝对/协议相对 → 根相对**：`https://<host>/`、`http://<host>/`、`//<host>/` → `/`。**必须同时处理 JSON 转义形式** `https:\/\/<host>\/` → `\/`（内联 JSON-LD / 配置块里全是这种写法，漏了就留下真实外域引用）。**四种形态一个都不能少**：绝对 / 协议相对 / **转义绝对** `https:\/\/host\/` / **转义协议相对** `\/\/host\/`【objectarchive】（漏掉第四种的后果实证：`case-studies/shopify-platform.md` §2）。另见 D1c。
2. **D1b 外部 Shopify CDN / 其它外部主机 → 本地目录**：`https://cdn.shopify.com/` 与 `//cdn.shopify.com/` → `/cdn-shopify/`（含转义形式），对应镜像的 `assets/cdn.shopify.com/` 树。**转义形式对外部主机同样成立，别只给源站主机开**【objectarchive】（实证：`case-studies/shopify-platform.md` §2；为什么每一道门都看不见它，见 `verification-gates.md` §1.6 第 4 类）。
3. **D1c 裸主机基址常量 → 本地基址**【objectarchive】：遥测与主题代码常把基址写成**不带尾斜杠**的常量再拼路径（`"https://otlp-http-production.shopifysvc.com"`、`window.shopUrl='https://<host>'`）。**改写规则按主机匹配，不要求尾斜杠**（只匹配尾斜杠形式的漏网实证：`case-studies/shopify-platform.md` §2）；验收侧的配套要求见 `mirroring.md` §8。
   > **D1c 与"转义写法"是同族不同格，两格都要单独想过**：D1c 是**没有尾斜杠**（`"https://host"` + 代码自己拼路径），D1a/D1b 的转义形式是**斜杠被转义**（`https:\/\/host\/`）。两者都会让"只匹配 `https://host/`"的提取 / 改写 / 断言规则天然失明，且失明时的表现都是绿灯。断言面见 `verification-gates.md` §1.6（第 4 类给了可执行查法）。
4. **D5b 内联遥测块移除**：按 `data-source-attribution="shopify.event_observer.bootstrap"` 属性、以及 `<script>(function(){var wpmLoader=` 起始字面量定位删除。这两块是纯分析、无视觉/行为角色；wpmLoader 在其后端模块被 stub 后还会 `.init` on undefined 抛错，不删则污染 CLEAN 门。
5. **D3/D5/D6 脚本 stub**：§1.2 清单。
6. **SRI 剥离**：被改写的标签响应字节已变，`integrity="..."` 必须去掉——否则 Chrome **静默拦截**该资源，且报错只走 CDP Log 域，探针不监听 Log 就会误报 CLEAN【lando】。
7. **D8 注入 noindex + 非官方声明**：`<head>` 后立刻插 `<meta name="robots" content="noindex,nofollow">` 与一段声明注释（"非官方学习复刻 / 与 Shopify Inc. 及店主无关 / 未经决定不公开部署"）。这是**安全默认动作**（用户就公开与否作出决定之前一律如此，见 `legal-and-deploy.md` §0.1），不可省。
8. **Q1 dev-port 探测片段 verbatim 保留**：见 §5。

**"变换没发生就 throw"防御（硬规则）**：`applyTransforms` 统计变换次数，**逐条**校验命中数——任一条为 0 或低于其登记下限 → 直接抛错终止构建【lando】【racingshop】【objectarchive】。意义：镜像/主题结构一变（换主题、Shopify 改 head 契约），脚本会**立刻大声失败**，而不是静默产出一批引用真实外域、没有 noindex 的坏 shells。没有这道防御的生成脚本不许合入。

⛔ **计数必须逐条，不能用"总数 `n === 0` 才抛"这个弱形式**：本表的 D1a/D1b 在一个页面里就可能命中数千次，URL 本地化一条就让"有变换发生"永远为真，而 **D8 noindex 注入失效不会有任何人发现**——弱形式在 Shopify 站上基本恒绿（命中数实证：`case-studies/shopify-platform.md` §2）。完整判据、下限怎么量、以及"验收要从产物字节反推而不是读构建脚本的计数器"见 `dom-shell-strategies.md` §2 步骤 3；块级的配套断言见本文 §0.3 步骤 6。

---

## 3. 零外联的完整断言面（本次实测发现的门盲区）

**`零外联` 不等于"资源级探针没抓到外部请求"。** 构建产物里实际残留三类联网面【racingshop】（实证：`case-studies/shopify-platform.md` §3）：

**① 连接意图（无资源请求，探针天然抓不到）** —— 实测残留两条：

```html
<link rel="preconnect" href="https://shop.app" crossorigin="anonymous">
<link href="https://monorail-edge.shopifysvc.com" rel="dns-prefetch">
```

浏览器一联网就会为这两条做 DNS 解析 / TLS 握手。资源级探针只看 `Network.requestWillBeSent`，完全看不见。→ **必须清理并登记，或至少登记为已知潜伏。**

**② 内联自包含遥测块（潜伏 beacon）** —— 每页内联着两处打外部域的代码：

- **弃单 beacon**：`pagehide` 监听器 → `navigator.sendBeacon("https://monorail-edge.shopifysvc.com/v1/produce", {schema_id:"online_store_buyer_site_abandonment/1.1", …})`。它自带 guard「performance 条目里没有 monorail 记录才发」——**离线复刻恰好满足该条件，所以是必发不是可能发**。load-time 探针从不触发 `pagehide`，一次都抓不到。
- **trekkie 加载失败兜底**：内联的完整 Monorail 实现（`Monorail.produce(monorailDomain, schemaId, payload)` → sendBeacon → XHR 兜底），挂在 `script.onerror → scriptFallback.onerror` 路径上，上报 `trekkie_storefront_load_errors/1.1` 到 `monorail-edge.shopifysvc.com`。trekkie 文件在盘时不触发；**被广告拦截器按文件名 `trekkie.storefront.*` 拦掉时会触发**——这正是"§1.3 建议把 trekkie 文件留在盘上"的理由，也是它必须登记为潜伏外联的理由。

**③ 出站 `<a href>` 锚点** —— 如页脚的 `https://www.shopify.com/legal/privacy`。这是**源站内容**，按宪法第 3 条（源站有的都要有）**保留，不算外联**。断言脚本必须按元素类型判定，不能"字符串里含外部域即红"，否则会逼出删内容的错误修法。

**因此零外联门的断言面 = 四项，缺一不可：**

- [ ] **资源级**：全路由 × 桌面/移动，probe 记录的请求 host 只有本地；带 `--scroll` 走完懒加载。
- [ ] **静态 grep 级**（对构建产物，不是对镜像）：`rel="preconnect"|rel="dns-prefetch"|rel="preload".*//` 无外部域；`sendBeacon\(|new Image\(|fetch\(["'`]https` 无外部字面量；残存 `https?://` 白名单只剩命名空间（schema.org / w3.org / json-schema.org）与出站锚点，逐条点名。⚠ **只 grep `https?://` 会天然漏掉转义写法**（`https:\/\/host\/`，Liquid `| json` 与 JSON-LD 产物里全是这种）——四种拼写的完整查法与解码扫描见 `verification-gates.md` §1.6 第 4 类【objectarchive】。
- [ ] **交互 / 生命周期态**：探针内 `window.dispatchEvent(new Event('pagehide'))`（或真导航离开）后再采一次网络；另外打开 cart drawer、在搜索框输入、进商品页触发 recommendations。
- [ ] **拦截器模拟**：把 trekkie（及其他"在盘才安全"的脚本）临时改名/返回 404，确认不触发外联；不可消除的写进偏差表"已知潜伏"。

---

## 4. 主题层变量矩阵（已观察形态，非确定规格）

> **置信度声明**：§1 平台层是**实测确定规格**（同一套 Shopify 运行时，各店一致）。本节是**已观察形态的样本集**，不是穷举——Shopify 主题生态没有上界。遇到表外形态：现场按 §4.1 判据核验，处置完成后**回填本表**。

| 目标 | 主题（`schema_name` / 版本） | 前端栈 | 出处 |
|---|---|---|---|
| racing.shop | **Stretch 1.13.0**，主题商店 #1765，实例名 "V1 Launch 022626" | 原生 Web Components ×78（`class extends HTMLElement` ×71、IntersectionObserver ×13）+ `vendor.min.js` 72KB。**无** three / gsap / lenis / react / vue | 【racingshop】 |
| allbirds | 未取 schema 名，主题号 `t/4159` | **ESM + Vite**（bundle 头 `__vite__mapDeps`）+ **GSAP ScrollTrigger** + **Swiper**；section 粒度切分共 20 个脚本（header / cart-drawer-section / full-bleed-hero / category-row …） | 【probe】 |
| mana-yerba-mate | 定制主题（非 Dawn），`t/18` | 单 bundle `global.js` **1.16MB**：**three.js 整库内联**（`THREE`×203、自写 shader）+ **GSAP**（×322）+ **lottie-web** + Swiper；Weglot 运行时翻译 | 【probe】 |
| pangram-pangram | 定制主题 `pp.com` 3.0.0，**`theme_store_id: null`** | **Alpine.js**（`x-data` 组件 40+：customFont / parallax / carousel / tabs）+ **Swiper**，Vite 单 bundle `index-<hash>.js` 488KB。无 gsap/three/react/vue | 【probe】 |
| simply-chocolate | **Prestige 10.11.0**（Maestrooo 商业主题），`t/126` | Web Components（effect-carousel / scroll-carousel / marquee-text / cart-*，esbuild 产物）+ PhotoSwipe 5.4.4 / focus-trap / tabbable。**动画库指纹为 0**。`theme.js.map` **公网可取** | 【probe】 |
| ch.maswitzerland | **Dawn**（Shopify 官方开源） | Dawn 全家桶 16 脚本：`global.js` / `cart-drawer.js` / `predictive-search.js` / `pubsub.js` / `quantity-popover.js` / `animations.js` … 带 sourceMappingURL | 【probe】 |
| koox.co.uk | **Ella 6.5.4**（商业主题） | 未取样 | 【probe】 |
| object & archive | **Dawn fork 后改名深度定制**：`schema_name` 已被改写为 `Object & Archive`、`schema_version` `1.0.0`、**`theme_store_id: null`**、实例名 `[LIVE] with GALLERY WALL w pins`，`t/11`（47 个资产）。血统 **Dawn ≥ 15.x**（`global.js` 里 `class SectionId{static#separator="__"}`，SectionId 助手是 Dawn 15 引入） | Dawn 全家桶 + `oa-*` 自加件（`oa-wishlist.js` / `oa-color-library.js` / `color-swatches.js`）；**无 bundle**——签名行为在 62 个内联块里，四层交织（§0.3）；gsap 3.12.5 + ScrollTrigger 3.12.5 + lenis 1.1.14 走 jsDelivr，**版本钉在 URL 里** | 【objectarchive】 |

**读法**：`theme_store_id: null` = 主题不来自主题商店（创意站常见，逆向价值最高）；命中官方/商业主题（Dawn、Prestige、Ella、Stretch）= 主题层不是店主原创，**逆向可能退化为读上游源码**，且引入主题版权问题——立项前就要向用户讲清。

**⚠ `theme_store_id: null` + 一个原创的 `schema_name` ≠ 从零定制。** 现实中最常见的拓扑是 **fork 官方/商业主题 → 改 `schema_name` → 深度定制**（objectandarchive 即 Dawn fork 改名 `Object & Archive`）——**此时 `schema_name` 会撒谎**，必须反查血统【objectarchive】：

- **成套的上游标准件名**：`t/<N>/assets/` 里是否整套躺着上游九件套（§0.2 判据 2）。单个同名文件可能是巧合，**成套出现不是**。
- **有版本切面的 API 取证**：从上游标准件里挑一个随上游版本演进的构造取年代（objectandarchive：`global.js` 的 `SectionId` 助手 ⇒ Dawn ≥ 15.x）。它同时是 §0.2 判据 1 做对照时要取的上游版本。
- **开发者注释的人称**（§0.2 判据 4）——最强的一手证据，且比从文件名推断可靠得多。

**fork 拓扑的两个后果**：① 主题层**不是单一归属**，必须按 §0.2 切成 `T-上游` / `T-站点` 再排移植任务；② 版权**取证**要把上游主题与店主自研部分**分开**取证（许可以产物内证据为准，结论交用户，见 `legal-and-deploy.md`）。

### 4.1 现场判定序列（按顺序执行，四步定型）

1. **取主题身份**：从 HTML 抠 `Shopify.theme = {...}`，读 `schema_name` / `schema_version` / `theme_store_id`（null = 不来自主题商店；**≠ 从零定制**，按上文 ⚠ 反查血统）/ 实例 `name`（运营迭代痕迹）。
2. **列主题资产**：`/cdn/shop/t/<N>/assets/` 下所有 js/css 全量下载；同时看是"单 bundle"还是"section 粒度多脚本"——这决定 M1 的坐标系粒度。**第三种可能：主题资产里根本没有承载签名行为的东西**（只有 vendor 与上游存量），行为全在页面内联块里 → 走 `reverse-engineering.md` §0.1 的**无 bundle 平行分支**建坐标系【objectarchive】。
3. **栈判定 grep 序列**（对下载的 bundle）：`customElements.define|class extends HTMLElement`（Web Components）· `x-data=|alpine:init|\$persist`（Alpine）· `gsap|ScrollTrigger|GreenSock`（GSAP）· `THREE|WebGLRenderer|gl_FragColor`（three + 自写 shader）· `Swiper|swiper` · `lottie|bodymovin` · `__vite__mapDeps`（Vite 分块）· `sourceMappingURL`。
4. **抄近路检查**：有 sourcemap 就先 curl `.map` 验证可取（simply-chocolate 的 432KB map 带完整 `sourcesContent`）；是 Dawn 或其 fork 就直接读 `github.com/Shopify/dawn`——这两种情况下 M1 的 beautify 环节近乎免费。**对 fork 站，读上游源码不只是抄近路，它同时是 §0.2 判据 1 的对照基准**（拿哪个版本对照由第 1 步的血统年代决定）【objectarchive】。

---

## 5. localhost 语义分叉（Shopify 主题的 dev 逃生门）

Shopify 主题（尤其 Vite 工作流的定制主题）常在页面尾部内联按 host 分叉的 dev 探测，实测原文【racingshop】（出现位置实证：`case-studies/shopify-platform.md` §5）：

```js
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  const ports = [5173, 5174, 5175];            // 另一块是 [5176, 5177]
  (async () => {
    for (const port of ports) { try { await import(`http://localhost:${port}/src/main.ts`); return; } catch {} }
    console.warn('[Carousel3D] Vite dev server not found, falling back to asset');
    import('//<host>/cdn/shop/t/17/assets/carousel-3d.js?v=…');
  })();
} else {
  import('//<host>/cdn/shop/t/17/assets/carousel-3d.js?v=…');   // 与上面回落路径同一个文件
}
```

复刻工程本地跑 = hostname 就是 localhost → **被迫走进一条线上永不执行的分支**。两条路线，**都必须登记**：

| 路线 | 做法 | 代价 | 适用条件 |
|---|---|---|---|
| **保持 verbatim**（默认，racingshop 选此 = Q1） | 一字不改，登记进 §Q 怪癖表 | 每页产生 2-5 个 `ERR_CONNECTION_REFUSED` 到 localhost dev 端口 + `console.warn` 噪声；**probe 的 `Network.loadingFailed` 会计入 failures，CLEAN 门必须为其开白名单并写明理由**，此后该门的信噪比永久下降 | 追求字节级忠实；且已确认探测**无外联**（目标是 localhost，不出机器）、无副作用、不阻塞渲染 |
| **强制走 production 分支** | 改写条件使其恒 false | 属**自创改动**，违反"源站有的都要有"的字面纪律，必须登记进 §6 偏差表并写"何时重新考虑" | 噪声污染验收门到无法判读；或探测有真实副作用（打外部域、抛错、阻塞首屏） |

**Shopify 特有的成本判据**：注意上面两条分支**最终 import 的是同一个主题资产**——dev 分支只是多了一段探测前奏。这意味着强制走 production 的**行为后果为零**，代价纯粹是"多了一条自创改动记录"。所以这里的取舍是纪律取舍，不是功能取舍：默认仍选 verbatim（无副作用 → 一律不动），只有当 CLEAN 门被噪声淹没时才翻。**绝不允许直接删掉分支而不登记**——那是未登记偏差 = bug。通用规则见 `dom-shell-strategies.md` §4.5。

---

## 6. 常见坑

1. **内联遥测比 `<script src>` 难删，且极易漏**：src 能按 URL 前缀批量 stub，内联块只能按 `data-source-attribution` 属性或唯一起始字面量正则定位（漏删实证：`case-studies/shopify-platform.md` §6 坑 1）。做法：先枚举全部无 src 的 `<script>`，逐个分类为"配置 / 结构化数据 / 主题逻辑 / 遥测"，再删——不要凭印象删。**这份枚举与 §0.3 的归属表是同一件事，做一次即可**：归属表落到层（`P`/`A`/`T-上游`/`T-站点`），删哪块是在层内再做的处置决定。
2. **stub 的响应形状必须按调用方的解析路径确定，不是"回 200 就行"**（两处形状不匹配的实证：`case-studies/shopify-platform.md` §6 坑 2）。**这类错只在交互态出现，load-time 探针全绿**——所以 §3 的交互态断言不是可选项。写 stub 前先去 bundle 里读一遍调用方怎么解析响应。
3. **no-op stub 必须同时是合法的 classic script 与 module**（实证：`case-studies/shopify-platform.md` §6 坑 3）。硬规则与判定方法见 `porting-discipline.md` §6.1。
4. **协议相对 URL 会被爬虫拼错**：`//<host>/x` 被误拼成 `https://<host>//<host>/x`。修法是**旁路 gapfill 归一重解**，**不要改共享爬虫脚本**（实证：`case-studies/shopify-platform.md` §6 坑 4）。
5. **HLS 视频阶梯是静态爬取的盲区**：`.m3u8` 的 renditions 与 segments 不在 HTML 里，只有运行时才拉取——需单独补录（实证：`case-studies/shopify-platform.md` §6 坑 5）。
6. **nonce 类字节不是内容差异，别判 D**：`<meta name="shopify-y">` 每请求变 UUID，`__st` 里的 `reqid` / 用户 token `u` 也逐请求变【probe】（实证：`case-studies/shopify-platform.md` §6 坑 6）。冻结镜像值 + 对拍掩码即可。
7. **`section_id` 查询参数请求会命中静态页的假 200**：facets-form 发 `/collections/x?section_id=…` 期待 section 片段，静态服务器忽略 query 返回整页——**200 但内容错，探针不报错**。要么在服务层为带 `section_id` 的请求单独 stub，要么登记为已知降级。
8. **过度 stub 平台脚本**：perf-kit / privacy-banner / hcaptcha / origin_trials / standard-actions / es-modules-shim 该留则留（§1.3）。一律 stub 会改变 DOM 与加载时序，本身即未登记偏差。
9. **后端 stub 区的像素差是预期噪声，别用自创 CSS 去补**（实证：`case-studies/shopify-platform.md` §6 坑 9）。归因到 stub 就结案，动 CSS 就是发明。

---

## 7. 关账 checklist（B 类 Shopify 平台层）

- [ ] **四层已分清**：每个 `<script src>`、每条运行时请求**以及每个内联块**都归了 `P` / `A` / `T-上游` / `T-站点`（§0 判据 + §0.2 + §0.3）；应用层每项有三分处置结论；`T-上游` 为空集时，"空"是核验过的结论而非默认假设
- [ ] §1.1 运行期端点逐条有 stub 或"确认本站无此端点"的记录；空车 JSON 用完整字段形状
- [ ] §1.2 加载期脚本逐条换 no-op stub，`type="module"` 保留；stub 文件双模式合法（`porting-discipline.md` §6.1）
- [ ] §1.3 verbatim 保留清单逐条核对过，无过度 stub
- [ ] 构建层变换 = 偏差表条目数（D1a/D1b/**D1c**/D5b/D3·D5·D6/SRI/D8），一一对应；**防御在位且是逐条下限形式**（任一条为 0 或低于下限即 throw，不是"总数非零即通过"）；每条变换都在产物 diff 里被实际观测到
- [ ] 内联 `<script>` 已逐个分类，遥测块处置有据（删 / 留 / 登记为潜伏）
- [ ] **内联块归属表机器可校验**（§0.3 步骤 1–5）：按内容哈希索引、每块有语义 id、归属门跑出 **零 UNCLASSIFIED / 零 AMBIGUOUS** 且退出码进 M1 关账，**跑遍构建层实际产出的每一份文档**（含 404 页与被动入镜的路由）；移植任务表 = 归属为 `T-站点` 的那些行
- [ ] **归属表当门用**（§0.3 步骤 6）：块级断言跑绿——`T-上游` / `T-站点` / `A` 三层每块只有"逐字保留"或"只被 URL 本地化动过"两种结局，`P` 层消失的块 = 登记过的那些；配套 hunk 级门里每个差异都能被变换表重放
- [ ] **零外联四项断言全绿**（§3）：资源级 / 静态 grep 级 / 交互与 pagehide 态 / 拦截器模拟；出站锚点已点名豁免
- [ ] 交互态无控制台异常：cart drawer、predictive-search 输入、product recommendations 均实跑过（坑 2）
- [ ] noindex + 非官方复刻声明在**每一页**产物中（不只是首页）
- [ ] localhost 分叉的路线已选定并登记（Q 表或 D 表），CLEAN 门白名单写明理由
- [ ] 主题层身份钉死进 `docs/engine-notes.md`：`schema_name` / 版本 / `theme_store_id` / 主题资产目录 / 栈判定 grep 结果 / **是否 fork 及上游血统年代（§4 读法）**；**若为 §4 表外新形态，已回填本文件 §4 矩阵**
