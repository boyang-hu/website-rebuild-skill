# 逆向建坐标系（阶段 1：Reverse）

> **何时加载本文件**：镜像已完成且本地断网跑通（M0/M0.5 阻塞门通过）之后、写下任何复刻代码之前，进入逆向阶段时加载。本阶段产出**唯一溯源坐标系**（bundle 分支为 `_pretty/` 行号，无 bundle 分支为内容哈希，见 §0）、`docs/engine-notes.md` 逆向笔记、技术栈取证表、数值基准——它们是移植与验证的全部地基。

## 0.35 ⚠ 诊断输出不要截断标识符【airpodspro】

工具为可读把模块 id 截到 10 位打印，那个截断值随后被当作完整 id 写进了配置。**截断的标识符会被原样复制回去**——这不是使用者不小心，是输出的诱导。

⛔ 而下游**静默丢弃了未知 id**（`filter(map.has)`），于是它照常打印一个合理的模块数、切片照常成功，失败推迟到运行时的 `Cannot read properties of undefined`，离根因隔了三层。

**两条都要**：① 打印完整标识符；② **未知的输入 ID 一律 FATAL**，并按前缀给出"你是不是想找 X"。⭐ 修完之后的那行报错，正是排查时最想看到的：`FATAL: 048cb669e0  did you mean: 048cb669e0708ebf9629`。

## 0.4 ⛔ 关键词计数只缩小范围，不下定位结论【airpodspro】

用计数找签名行为的落点是对的，**把计数结果当成定位结论是错的**。实测一次完整的误判：

- 按 `scrubber=27` 把签名行为定位到一个 85 行的模块，写进了竖切计划；
- 读代码后发现那是**视频播放器进度条的缩略图预览**，平台层的播放器 UI，与滚动无关；
- ⭐ **否证就在同一张表的同一行里：`scrubber=27  scroll=0`。** 一个"滚动驱动视频"的候选出现 `scroll=0`，本身就是结论——数字被读到了，含义没有。

**同形词是这类计数的系统性风险**：`scrubber` 在视频语境里指播放器拖动条，在滚动语境里指滚动洗刷；同一个词，两个毫不相干的子系统。`scroll`、`timeline`、`track`、`player`、`stage`、`frame` 都有同样的问题。

⭐ **而真实机制藏在一个 11 行的模块里**——一张补间引擎的属性表：

```js
domAttributes: ["scrollLeft", "scrollTop", "scrollBy", "scrollTo", "currentTime"]
```

`currentTime` 只是一个**可补间属性**，和 `opacity` 走同一条通路。所谓"视频洗刷子系统"根本不存在。**信息密度最高的模块可能是最小的那个，而计数会把它排到最后。**

**做法**：计数用来产出**候选清单**；每个候选**必须读代码确认**；且**读计数表要横着读**——其他列常常已经在否证当前这一列。

## 0.45 ⚠ "自研 vs 用库"，bundle 外部计数给不出答案【airpodspro】

Step 0 依据"81 处 `requestAnimationFrame`、0 处 `gsap`"判为"自研命令式引擎"。没错，但**不完整**：站点建立在源站自己的组件框架上（13 个模块引用框架对象、65 个模块是组件式继承/注册），**框架层与业务层打进了同一个 bundle**。

⚠ 这是 **B 类特征**（平台层需先剥离），而 Step 0 的判据里没有一项能看到它——它只在**读了模块结构之后**才显形。**判级可以先行，分层必须等到 M1。**


## 0.5 ⛔ 先判 bundle 形态，再选工具【airpodspro】

分层表扫的是**顶层声明**，而那个前提只对**扁平拼接**的 bundle 成立。前四个实测项目恰好都是那一种，于是这个前提从未被检验。换成 webpack 打包产物后它**零命中**——不是少扫，是一个都没有。

**M1 的第一个动作是判形态**：

| 形态 | 识别 | 工具 | 单位 |
|---|---|---|---|
| **扁平拼接** | 几百个顶层 `class`/`const`/`function`，共享一个作用域 | `layer-map`（分层表） | 行号区间 |
| **模块化打包**（webpack/rollup/Turbopack 运行时） | `!function(m){…}([…])` 或 `({…})`，**顶层声明数 = 0** | `scripts/module-map.mjs` | **模块** |
| **多 chunk** | 跨文件 import/export 重命名 | 分层表 + 跨 chunk 重命名表（§2.1） | 行号区间 + 别名表 |

#### 0.5.1 ⛔ 两种模块容器语法，一个读错会**安静地**给你一张小得离谱的表【airpodspro】【v0-optimus】

| 打包器 | 容器 | 模块签名 | 依赖 | 导出 |
|---|---|---|---|---|
| webpack 4 | `!function(m){…}({ "id": function(…) })` —— **对象属性** | `function(module, exports, require)` | `require("id")` | `module.exports = …` |
| Turbopack | `(globalThis.TURBOPACK\|\|=[]).push([currentScript, id, factory, id, factory, …])` —— **扁平交替列表** | `ctx => {…}` 或 `(ctx, …) => {…}` | `ctx.i(id)` / `ctx.r(id)` | `ctx.s([[name, () => binding], …], ownId)` |

⭐ **Turbopack 把导出名写在容器里**（`e.s(["HeroSection", …])`），所以在这种产物上，M(n+1) 的命名几乎每个模块都是 tier-1 证据——webpack 那边要从全局发布、自注册、消费方字段名里一点点推的东西，这里打包器直接给了。

⛔ 三个必须处理的形状差异，漏掉任一条都产出错表：

1. **工厂可能是箭头函数，且单参数时没有括号**（`e => {…}`）。按"找下一个 `(`"去取参数会一路走过箭头、跨进下一个模块，产出**一个巨大的假模块**。
2. **相邻模块共用边界行**（`}, 12345, e => {` 一行既闭合上一个又开启下一个），所以逐模块行数之和会**超过文件总行数**。这不是 bug，但要说出来，否则读起来像读错了。
3. ⛔⛔ **读错容器时工具会"成功"。** 实测：webpack 读取器指向一个 Turbopack chunk，找到两处不相干的 `key: function` 属性，报告 **2 个模块**并打印愉快的摘要——而该文件真实有 20 个工厂、45 处 require 调用。

⭐ 因此**"认不出即 FATAL"不够，还要"认出来的东西必须解释得了这个文件"**。两条便宜的覆盖率判据（`module-map.mjs` 已内置，且**已被真实数据触发验证过**）：

- 模块跨度覆盖的行数 **< 文件的 50%** → FATAL；
- 文件里 require 形状的调用 > 8 处，而记录到的依赖边 **< 其 25%** → FATAL。

实测在一个无容器的 vendor chunk 上：覆盖 7%、239 处 require 调用对 0 条边 → 正确 FATAL（exit 5）。

⛔ **两个读取器必须都跑完再裁决，不能让第一个先 exit。** 第一版把 Turbopack 探测放在 webpack 分支之后，而 webpack 分支找不到容器时直接 `process.exit`——于是一个 Turbopack chunk 因为"webpack 形状的属性不足两处"被判成无容器，而它的容器就在第 1 行。⚠ 更糟的是：**其余 chunk 之所以能通过，只是因为它们恰好含有两处不相干的 `key: function`**——那是巧合，不是代码路径。

⛔⛔ **Turbopack 容器有一段前言，必须原样带走。** `currentScript` 之后、第一个 id/工厂对之前，是一串**裸 id 没有工厂**——这个 chunk 声明的跨 chunk 依赖：

```js
push([currentScript, 66256, 68812, 48737, 20852, e => { … }, …])
//                   ~~~~~~~~~~~~~~~~~~~  前言：依赖 id
```

⚠ 它们不是模块（读取器正确地跳过了），但**切片器把它们丢掉就会破坏加载时序**：运行时在依赖尚未注册时就求值某个模块，抛

```
Module 66256 was instantiated because it was required from module 42195,
but the module factory is not available.
```

⛔ **报错的栈指着移植产物，一个字都不会提"少了个头"**——而且它**不在加载时失败，在求值时才失败**，所以静态门全绿。判别方式：容器数组里，`num` 后面跟着另一个 `num` 的是依赖，后面跟着函数的才是模块。

⛔⛔ **一个模块可以有多个 id。** 容器不是严格的 `id, factory` 交替——**一串 id 后面跟一个工厂**，那些 id 全部解析到同一个模块体（打包器把相同模块去重后挂了多个 id）：

```js
}, 73692, 24109, 34281, 24850, 29053, 41630, 77117, e => { … }
//  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  六个别名 + 一个规范 id
```

⚠ 只取紧挨工厂的那一个，会**静默丢掉其余全部**。实测一个站的 5 个 chunk 里有 **10 个别名 id** 被丢；症状是运行时抛 `module 73692 … the module factory is not available`，**而那个 chunk 切片是字节一致的、静态门全绿**——因为丢的不是字节，是**注册表里的键**。

⭐ 三条一起构成 Turbopack 容器的完整模型：

```
[ currentScript, ...前言依赖id, (id+ , factory)... ]
```

⚠ 解析这三段时有一个共同的坑：**元素必须以 `,` 或 `[` 开头才算数**。否则 `void 0`（currentScript 表达式里的零）会被当成一个 id，于是每个 chunk 的首模块都"额外答应 id 0"。

⭐ 副产品：**Turbopack 只给站点自有模块写导出名，vendor 模块没有。** 实测 192 个模块里 18 个有导出名，而这 18 个恰好就是站点自己的组件（`HeroSection` / `Navigation` / `PricingSection` …）。这比任何"按体积/按目录"的启发式都干净——**分层证据由打包器直接给出**。

⭐ **模块化打包产物的模块边界与依赖边是给定的**——打包器已经写下了它们。实测一个 24,378 行的 bundle：**569 个不同模块**（容器里 597 条属性，28 条被同名键遮蔽），181 个叶子、416 个有依赖，最大 1,544 行，`requires` 直接可读。

⛔ **推论，且它一路影响到最后**：`readable-source.md` §3.1 那整套 SCC / 求值顺序 / 连续区间划分，**对这类 bundle 不需要**。那套机制存在的唯一理由是"扁平作用域里模块边界不存在，必须重建"；这里不存在这个问题。

⚠ **认不出容器时必须 FATAL，且禁止回退到分层表。** 分层表对模块化 bundle 会安静地返回"0 个声明"，下游会读成"这个 bundle 是空的"。**一个错的单位边界是静默的 65% 误差**（四层模型那次实证）。


## ⭐ 分层表必须认「顶层裸语句」，否则一行配置会继承邻居的层【lusion】

按**声明**建行区间的分层表有一个结构性盲区：**声明之间的裸语句**会被并进前一个声明的区间，
因此**继承那个声明的层**。若前一个声明恰好属于某个 vendor 库，这行自研配置就永远不会被切进移植产物。

**实测代价**【lusion】：

```
_pretty L16964:  ColorManagement.enabled = !1;     ← 站点关掉 three 的色彩管理
```

它落在 detect-ua 那段 vendor 区间的**最后一行**。移植产物里没有它，three r158 的默认色彩管理生效：

| | 症状 |
|---|---|
| 网格差异 | **2,335 / 2,560** 格 |
| 通道均值差 | R **−11.3** / G **−13.3** / B **−7.5**（不等比 → 色彩管理签名，不是亮度常数） |
| 差异形状 | **整帧**普遍偏移 + 一个热点，**没有任何一处指向"一行赋值"** |
| 可复现性 | 跨侧三次 `10.56 / 30.7 / [46,11]` **逐位相同** |

⭐ **一行赋值造出的差异，长得和"某个子系统没移植"一模一样**——而且更难查，因为整帧都在动。

**两条纪律**：

1. **扫描器要同时认声明与顶层裸语句**（`X.y = …` / `f(…)` 在第 0 列）。本 bundle 里有 **151 条**
   这样的语句——它们不是边角料，配置、注册、单例初始化都长这样。
2. **vendor 区间的边界要精确到行**，且**边界处的裸语句默认归自研**：库的结尾之后紧跟一行配置
   是极常见的打包形态。本例区间多划一行，代价是整个复刻站的色彩。

**归因手法**（比逐块排查快得多）：差异铺满整帧时，**先量两侧的通道均值**。
等比偏移 → 亮度/曝光；**不等比** → 色彩管理 / 色调映射 / 色彩空间，直接去 bundle 里
grep `ColorManagement` / `outputColorSpace` / `toneMapping` / `useLegacyLights`，
并**核对它们各自属于哪一层**。


## 0. 预检：先问"有没有 bundle"，再判 bundle 形态

**本文件的主干（`_pretty/` 行号坐标系、混淆别名表、区段地图、vendor 岛、字节切片器）整体建立在"签名行为住在可下载的 bundle 里"这个前提上。** 前八个项目无一例外满足它；objectandarchive 第一次不满足——行为住在 Liquid 渲染出来的 62 个内联 `<script>` 块里，且是**带作者注释的未压缩源码**【objectarchive】。所以预检先问载体，再问形态；命中"无 bundle"就走 §0.1 的**平行分支**。

有 bundle 时，先判形态，再决定是否需要 beautify：

```bash
head -c 600 mirror/<path-to-bundle>.js          # 看开头形态
awk '{ if (length($0) > m) m = length($0) } END { print m }' <bundle>.js   # 最长行
grep -c 'sourceMappingURL' <bundle>.js                 # 有无 sourcemap 指针
```

| 形态 | 判据 | 流程分支 |
|---|---|---|
| minified/混淆产物（常态） | 单行或数万字符长行；标识符压成 1–2 字符 | 走 §1 beautify 流程 |
| **未混淆 esbuild 产物** | 标识符全保留、自带换行缩进——开头即 `var __defProp = Object.defineProperty;`、内部函数名（如 `copyAttributeData`）原样可读 | **跳过 beautify**，直接以原文件行号为坐标系（边界探测实录：bruno-simon 4.86MB 产物、star-atlas 均属此类） |
| 带公开 sourcemap 且 sourcesContent 完整 | map 可下载且含完整源码 | 直取 sourcesContent 替代 beautify（边界探测实录：orano） |
| **手写多文件站（2013 时代，无打包器）** | 每 `<script>` 一文件、原始命名；CoffeeScript 特征（`_i/_len/_ref`、`(function(){}).call(this)`）、Compass 行号注释 | **跳过 beautify 并把这次跳过登记进日志**（"行号指 \_pretty"是全库默认约定，静默跳过会让后来者找错文件）；坐标系 = mirror 原文件行号。⭐ **先做 vendor 逐字节鉴真**：站上的库文件与上游官方 release 直接 diff（skrollr 0.6.11 diff 为空、jquery.min sha1 与官方 CDN 一致）——一次 diff 杀掉整棵"站方魔改库"假设树，剩下的应用文件就是全部逆向面【firstlaunch】 |
| **无 bundle：行为在 HTML 内联块里** | 站点自己的 js 只有 vendor 与主题存量，签名行为的字面量只在 HTML 的 `<script>` 块内命中 | **走 §0.1 平行分支**：坐标系建在内联块上，主坐标是**内容哈希**而非行号【objectarchive】 |

无论走哪个分支，**"坐标系是全项目唯一溯源坐标"的制度不变**——唯一、贯穿四处引用（§1.3）、笔记先行（§2）、取证钉版本（§3）、假设先证否（§4）全部照旧；变的只是坐标落在哪份字节上、以什么做主键（行号 / 内容哈希）。

### 0.1 无 bundle 站：平行分支（不是替代分支）【objectarchive】

**两条分支并列。** 判据是"签名行为的**载体**是什么"，不是站的好坏、也不是方法论偏好。同一个项目里两者常常并存——objectandarchive 的 vendor（gsap / ScrollTrigger / lenis / jQuery）是 CDN 上的独立文件，自研行为在内联块里——此时**按载体分别建坐标系**：需要读的 vendor 文件按 §1 走 `_pretty/`，内联块按本节走内容哈希。这不违反 §1.3 的"不允许第二套坐标系"——那条禁的是**同一份字节有两种坐标**，不是禁止不同载体各有各的坐标；要求是**每条引用一眼能看出落在哪个载体上**（`B:` 前缀 vs `pretty L`）。

**识别判据**（四条同时成立才判；有一条不成立要回头核，别急着删步骤）：

1. **签名行为的字面量只在 HTML 里命中**：对镜像全量 grep 行为特征（`new Lenis` / `gsap.` / `ScrollTrigger` / `addEventListener("pointerdown"` / 自研类名前缀），命中集落在 `*.html` 的 `<script>` 块内，站点自己的 `.js` 文件里没有。
2. **vendor 走 CDN 且 URL 内即钉版本**：`cdn.jsdelivr.net/npm/gsap@3.12.5/…`、`lenis@1.1.14/…`、`code.jquery.com/jquery-3.7.1.min.js`——版本无需逆向，照 URL 钉即可（§3.1）。
3. **内联块未压缩且带作者注释**：框线注释（`/* ── Drag-to-scroll (carousel) ── */`）、完整标识符、正常缩进——这是源码风格，不是构建产物。
4. **页面由服务端模板渲染**（Liquid / ERB / Blade / 各类 PHP 模板）：块的位置与顺序由模板与平台注入决定，不由构建器决定——这正是下面坐标不稳的根源。

**直接删掉的步骤**（bundle 分支的专属成本，无 bundle 站一项都不需要）：

| 删掉 | 因为 |
|---|---|
| §1 的 `js-beautify` 展开与版本钉死（`_pretty/`、`scripts/beautify-bundle.mjs`） | 代码本来就是格式化好的源码；再 beautify 一遍等于**凭空造出一份与源站字节不同的产物**，逐字移植的字节门会失去基准 |
| §2.1 的混淆名对照表、跨 chunk 导入/导出重命名表 | 标识符与注释都在，没有混淆，也没有 chunk |
| §0 的 minification 形态预检（最长行、`sourceMappingURL`） | 没有被压缩的对象 |
| §2.2 的 vendor 区段地图与 vendor 岛边界校准 | vendor 是独立的 CDN 文件，边界即文件边界；"应用层规模"改由内联块归属表给出（见下） |

**替换掉的步骤**（形式变了，制度没变）：

| bundle 分支 | 无 bundle 分支 |
|---|---|
| `_pretty/` 行号坐标系 | **内容哈希坐标系 `B:<sha12>`**（§0.1.1） |
| `_pretty/README.md` 钉死 beautifier 版本 | **快照 sha256 钉死表 + 漂移守卫命令**（§0.1.1） |
| §2.1 的 bundle 区段地图 | **内联块普查表 + 逐块层归属**（Shopify 站按 `shopify-platform.md` §0.3 的四层；零 UNCLASSIFIED 才算完成） |
| `scripts/extract-source.mjs` 按行号切 `_pretty/` | 同一把切片器改切**镜像 HTML 的内联块**：切片表的 `source` 变成 HTML 文件，sha256 守卫照旧 |

#### 0.1.1 坐标系：内容哈希作主坐标，行号降级为快照内导航

**朴素方案"行号建在镜像 HTML 上"实测不成立。** objectandarchive 抓了六份同一路由的 HTML（同时刻双抓 / 60 秒间隔三抓 / 移动 UA / `Accept-Language: fr-FR` / 隔一天），全部 486,622 字节 10,410 行，逐块比：

| 比较 | 块数（首页全部 `<script>`，含外链） | sha 不同 | 起始行不同 |
|---|---|---|---|
| 同时刻双抓 · 60 秒间隔 · 换语言 | 80 | 0 | 0 |
| 换移动 UA | 80 | 4（**全是 nonce 字段**） | 0 |
| **隔一天（跨 CDN 缓存条目）** | 80 | 12 | **4** |

隔天那 4 处行号差异不是内容变化，**是两个平台 app-embed 块换了注入顺序**：Hulk Form Builder 昨天是第 44 块（L850），今天是第 41 块（L817）。掩掉 nonce 后整页 diff 只有 87 行、全部落在 app-embed 区段内、总行数不变——**同一份内容，两种注入顺序**。

三条结论直接决定坐标系形状：**① 块序号不是稳定标识**；**② 行号在被平台注入的区段内不稳定**；**③ 区段外这次没漂是运气不是保证**——两个 app 块恰好占用同样多的行，所以后面的行号回到原位；多一个 app 或某个 app 改版，整页后半段就整体位移。**行号可以用来找路，不可以用来当契约。**

定案：

| 用途 | 形式 | 稳定性 |
|---|---|---|
| **主坐标（权威）** | `B:<sha12>` = 块正文字节的 sha256 前 12 位；块内定位写 `B:<sha12>+<行内偏移>`（1-based，块首行为 1） | 内容寻址：跨渲染、跨页面、跨抓取不变 |
| 辅坐标（导航） | `<page> L<起>-<止>` | **仅对钉死的快照有效**，不得进契约类文档的证据位 |
| 漂移守卫 | `inline-scripts.mjs <新抓> <钉死快照> --compare`：逐块比 sha / 字节 / 起始行，有差异即退非零 | 等价于 bundle 分支"钉死 beautifier 版本"那条红线 |

配套三件，缺一不可：

1. **快照钉死表**：每份镜像 HTML 的 sha256 / 字节数 / 行数写进 REBUILD_PLAN（等价于 `_pretty/README.md` 的版本声明），并写明红线——**重抓镜像后 sha256 一变，全部 `L####` 引用作废；`B:` 引用不受影响**。
2. **漂移守卫进流程**：每次重抓镜像后必跑 `--compare`。sha 变了是**响亮失败**，该块的全部 `B:` 引用必须重新定位，而不是静默漂走。
3. **块名带语义**：普查表里每块起描述性 id（`oa-lenis-gsap-orchestration`、`oa-pdp-frame-compositor`），**不要 `block-37`**——序号会漂，而这些名字要直接当移植任务表的行标题用。

**旁证（免费得到的正确性检查）**：同一个块在三条路由上出现在完全不同的行号——Lenis+GSAP 脊柱 `B:41e7f747ed2a` 在首页 L9564-9687 / collection L8468-8591 / product L11658-11781——而 `B:` 值一致。按行号编目会记成 9 条互不相干的条目；按内容哈希编目自动收敛成 3 条，且"三页共用同一份实现"这个事实白送。

**先掩 nonce 再谈任何字节门**：逐请求变化但**长度固定**的字段（`<meta name="shopify-y">` UUID、`__st.reqid`、`eventMetadataId`、`requestId`）不引起行号位移，却会让哈希变。做法是在归属表里给这类块标 `nonce` 并改用锚点字面量匹配（`shopify-platform.md` §0.3 步骤 4）。**注意"跨请求"和"跨缓存条目"是两个不同的自变量**——只有后者会动结构；只抓前者会得出"完全稳定"的错误结论。

## 1. 建立 `_pretty/` 行号坐标系

> **分支提示**：§1.1–§1.3 属 **bundle 分支**；无 bundle 站按 §0.1 建内容哈希坐标系后跳到 **§1.4**（该节两个分支通用）。

### 1.1 展开命令（版本钉死 1.15.1）

```bash
mkdir -p mirror/_pretty
npx --yes js-beautify@1.15.1 mirror/<path>/<bundle>.js \
  -o mirror/_pretty/<bundle>.pretty.js
```

- 多 chunk 站（Next 等）把**全部 chunk 逐个展开**（kimi 展开 21 个 chunk 共 57,068 行）【kimi】。
- 版本沿革：samsy 首次把版本钉死制度明文化（当时 2.0.3），kimi/noomo/lando 三代统一 1.15.1——本 skill 钉 **1.15.1**，不要用别的版本【samsy】【kimi】【noomo】【lando】。

### 1.2 `_pretty/README.md`（必写，与展开同一次完成）

内容必须包含：

1. beautifier 精确版本（`js-beautify@1.15.1`）；
2. 逐文件的**再生成命令**（照抄上面的命令行，可直接复制执行）；
3. 警告原文级别的红线声明：**换 beautify 版本行号会漂移，整套引用作废**【samsy】【noomo】；
4. 原件纪律：镜像原件目录（`_nuxt/`、`assets/` 等）保持字节纯净，`_pretty/` 是分析产物，二者永不混淆【noomo】。

### ⛔ 红线

**beautifier 版本漂移 = 整个溯源体系作废。** 行号一漂，全项目所有 `LNNNN` 引用（逆向笔记、移植文件头注释、里程碑待办、怪癖/偏差登记表）一次性失效且无法自动修复。任何人重新生成 `_pretty/` 只许用 README 里登记的命令与版本。

### 1.3 行号引用格式（全项目唯一坐标系）

- 单 bundle 站：`pretty LNNNN`（如 "BufItem，pretty 行 29722–29809"【oryzo】）。
- 多 chunk 站：`<chunk-hash> Lnnnn`（如 `_pretty/7020daab554f970c` L13231）【kimi】。
- 行号引用**贯穿四处**，不允许第二套坐标系：
  1. 逆向笔记 `engine-notes.md` 的每条结论；
  2. 每个移植文件的头注释（阶段 2 使用，见 porting-discipline.md）；
  3. 里程碑日志的"下一步断点待办"——如 samsy M7a 待办直接写 "字体管理器 **pretty L60740-L60844（未读）**"，跨会话交接靠它【samsy】；
  4. 怪癖表与偏差表的每条证据。
- 实践规模参考：oryzo 107 处 / samsy 276 处 / noomo 161 处 / lando 400+ 处行号引用【oryzo】【samsy】【noomo】【lando】。
- **无 bundle 站**：把上面四处的"行号"整体替换为 `B:<sha12>`（块内定位 `B:<sha12>+<n>`），格式与制度同构；行号只能作为**快照内导航**出现在这四处之外【objectarchive】。

### 1.4 坐标系稳定性是 M1 的第一道必答题（两个分支通用）【objectarchive】

bundle 分支的坐标稳定性是**买来的**：文件字节固定 + beautifier 版本钉死 ⇒ 行号是不变量，红线只需一句"别换版本"。**只要坐标载体不是"钉死的文件"，稳定性就变成必须实测的经验问题**——无 bundle 站（内联块随模板与平台注入漂）、每请求重渲染的 SSR 页面、随 A/B 分桶变化的产物，都属此类。

纪律（硬规则）：

1. **Step 0 就预登记**：判级时若发现坐标载体不是固定文件，把"坐标系是否稳定"写进 `probe/verdict.md` 的待验风险清单。
2. **M1 第一件事就是验它**——**在写任何移植代码、落下任何坐标引用之前**。验法：同一路由多次抓取，**把自变量拆开分别抓**：同时刻双抓 / 分钟级间隔 / **跨天（跨 CDN 缓存条目）** / 换 UA / 换 `Accept-Language`；逐块比 sha、字节、起始行（objectandarchive 的实现是 `inline-scripts.mjs --compare`）。
3. **结论写成区段级，不是全局级**：objectandarchive 的答案不是"稳/不稳"，而是"**平台 app-embed 区段不稳，其余（含全部 26 个自研块）稳**"。这个更细的答案才可用——自研块的行号可以放心当导航坐标；而它只有把"同缓存条目 / 跨缓存条目"当成两个自变量分开抓才看得见。
4. **结论进 `engine-notes.md` 第一节 + REBUILD_PLAN 的坐标系节**，并配一条可复跑的守卫命令（重抓镜像后必跑）。

**为什么必须前置**：objectandarchive 在 Step 0 预登记、M1 开头证伪，于是**在写第一行移植代码之前**就换掉了坐标方案，代价是半天。**同样的发现若拖到 M2 中途才撞上，笔记、移植文件头注释、里程碑待办、怪癖/偏差表里的坐标引用早已铺开（前作规模 107–400+ 处），一次性全部作废且无法自动修复**——与"beautifier 版本漂移"是同一类灾难（§1 ⛔），只是触发源不同。

## 2. 逆向笔记 `docs/engine-notes.md` 先行

**独立里程碑，产出并提交这份笔记之前不写任何复刻代码**——oryzo 把它列为 M2.0，"文档先行显著降低了后面每轮的返工"【oryzo】；后四代全部沿用【samsy】【kimi】【noomo】【lando（6 份笔记 00-05）】。

### 2.1 三段式内容结构

**第一段：源站事实**（全部带坐标：bundle 分支为行号，无 bundle 分支为 `B:<sha12>`）

- **bundle 区段地图**：vendor 边界逐段标行号——lando 给 47k 行画了全区段地图（GSAP 5043-6743、three 10334-30143、Lenis 46469-47010、应用代码各段），"先画地图再挖矿"【lando】；samsy 同样逐段标 vendor 边界【samsy】。**边界怎么划见 §2.2——只按 license banner 划会错**【shopifydesign】；
- 启动链 / 路由 / store（逐字段用途）；
- 渲染管线、RenderTarget 清单、材质清单（samsy 26 项 TSL 材质、后处理链逐步拆解）【samsy】；
- 协议与数据 schema（VAT worker 协议、PartyKit 协议全量【samsy】；i18n/数据 schema【kimi】）；
- 混淆名对照表（noomo：`nn`=RenderingPipeline、`X`=Root…）【noomo】；
- **跨 chunk 导入/导出重命名表**（多 chunk 站必写）【shopifydesign】：同一个符号在两个 chunk 里叫两个名字——`SiteHeader` chunk 里写 `export { Ye as R }`，主 chunk L8 写 `import { R as Pa }`，于是笔记、bundle、移植代码要靠三个名字（`Ye` / `R` / `Pa`）对上号。**逐条记"符号 → 源 chunk → 导出名 → 主 chunk 内名 → 两侧行号"**：它是阶段 2 跨 chunk 字节切片的直接输入——切片器要靠这张表把那两句 import/export 转写成一句绑定（`porting-discipline.md` §2.2）。没有它，跨 chunk 的符号在笔记里表现为"来历不明的自由标识符"；
- 页面 init/destroy 矩阵（每个页面的初始化/销毁函数及行号）——它直接变成移植阶段的任务清单【lando】。
- **无 bundle 站的等价物**：区段地图换成**内联块普查表**（逐块：语义 id / 层归属 / 字节 / `B:<sha12>` / 各页行号 / 首条作者注释）。它同时承担 §2.2 的职责——**应用层规模 = 归属为"站点自研"的那些块**，平台层与上游主题存量都要从规模统计里扣掉，否则任务表虚高（objectandarchive 若把 Dawn 存量算进去，虚高 65%）【objectarchive】。

**第二段：怪癖清单（照抄不修）**：源站 bug / 死代码 / 怪写法逐条登记并带坐标（行号或 `B:`），移植时逐字照抄。规模参考：noomo Q1–Q14、samsy 13 条、kimi 26 条【noomo】【samsy】【kimi】。

**第三段：对复刻的直接结论**：如 noomo 的 10 条（"先实现三个元系统再写任何材质"、"缺 colorsMap 玻璃会变灰白"）【noomo】；samsy 的"不要发明"清单（engine-notes §16）【samsy】。

### 2.2 区段地图的边界校准（license banner 只给起点）【shopifydesign】

**vendor 区不是连续的一块，license banner 也不标终点。** shopify.design 初版按"最后一段 license banner"定 vendor 边界，把应用起点标在 L28141，**错了 5,832 行**——真实边界是 L22309：three.js 的**后处理 addon**（`Pass` L22057 / `ShaderPass` L22091 / `EffectComposer` L22128 / `RenderPass` L22198 / `OutputPass` L22293）整段排在最后一段 license 之后，而应用区间内部还夹着三座 **vendor 岛**（troika-three-text L23527–L26525、SVGLoader L28869–L29895、GLTFLoader+DRACOLoader L31727–L33785）。

三条操作规则：

1. **起点用 banner，终点用 `class X extends Y` 的收尾校准**：banner 之后继续往下扫到最后一个 vendor 类定义的闭合处（本站 `class c3 extends sc` L22292），再往下第一处**应用配置常量/魔数**才是真起点（本站 `const ac = 800, Pn = 0, v1 = 50 …` L22309——设计基准高度、相机 Y 这类值只可能是应用配置）。
2. **应用区间内要标出 vendor 岛**：构建器会把按需引入的 vendor（loader、字体引擎、后处理 addon）散插在应用代码之间。岛内代码不属应用层，规模统计与计数都要扣掉；岛的边界同样用 `class X extends Y` / `self.xxxDefine` 这类库自身入口锚点定。
3. **地图先于计数**：所有"多少段 GLSL / 多少次 X"的数字都必须**在应用区间内**数。Step 0 的原始计数含 vendor，必然虚高——见 `references/scope-and-fingerprint.md` §2《计数硬约束》。

**下游代价**（为什么这不是洁癖）：区段地图错 → 应用层规模误判（本站虚高 5,832 行）→ **难度评级与工期估算一起偏**；且后续每一次"这段要不要移植"的判断都建在错的坐标上，返工时整片行号引用作废。

### 2.3 笔记纪律

- **只陈述源站事实，不做"应该怎么改"的判断**——决策写进 REBUILD_PLAN，不写进笔记【kimi】【noomo】；
- **未坐实的一律标注"未确认"，不猜**【kimi】；
- 事实与决策分离，防止"边看边写"导致的臆造【samsy】；
- **上一阶段（Step 0）的数字与附带结论一律当假设复核**，不要直接抄进笔记——shopify.design 的 Step 0 判级正确，但附带的路由数、资产数、漏抓归因三条全被 M0 证伪【shopifydesign】。

## 3. 技术栈从 bundle 取证、精确钉死【6/6】

### 3.1 取证指纹类型（每个版本号都要有出处）

| 指纹类型 | 实例 |
|---|---|
| bundle 内版本字符串 | `hN="3.5.25"`（Vue）、`versions:{get nuxt(){return"4.2.1"}`、GSAP `version:"3.13.0"` ×6【noomo】 |
| 全局变量 | `window.next={version:"16.1.6",appDir:!0}`、`window.__THREE__="184"`【kimi】 |
| pnpm 路径泄漏 | 一条路径一次性钉死 next/react/babel/sass 四个版本【kimi】 |
| wasm/CDN URL | Rive 版本从 bundle 内 wasm URL 取证【lando】 |
| **CDN URL 内即钉版本**（无 bundle 站常态） | `cdn.jsdelivr.net/npm/gsap@3.12.5/…`、`lenis@1.1.14/…`、`code.jquery.com/jquery-3.7.1.min.js`——URL 给版本，**下载到的文件里再复核一次**（`gsap.min.js` banner `GSAP 3.12.5`、`ScrollTrigger.min.js` 内 `version="3.12.5"`、文件内 `jQuery v3.7.1`），两处对得上才算取证【objectarchive】 |
| API 指纹 | zustand `getInitialState` 无 `destroy` ⇒ v5【kimi】 |
| CSS 特征 | `@property --tw-drop-shadow-alpha` ⇒ Tailwind v4.1.0+【kimi】 |
| 响应头 | `x-powered-by: Nuxt`【noomo】 |

### 3.2 钉死落地

- 安装用 `npm i --save-exact`，`package.json` 不带 `^`【kimi】【lando】；
- **传递依赖也要钉**：noomo 用 `overrides` 钉 unhead 2.0.17——2.1.17 会反转 bodyClose 脚本顺序、破坏与源站的尾部字节序，"同一 Nuxt 版本不等于同一输出，传递依赖也要对齐"【noomo】；
- 源站用 dev 分支时取最接近正式版并**登记为偏差**（samsy：源站 three r182dev → 复刻 0.182.0）【samsy】；
- 逐项证据写成技术栈取证表（REBUILD_PLAN §2 格式：项 / 版本 / 取证方式）【noomo】。

## 4. 证伪流程：假设必须先证否

### 4.1 signature grep 只提假设，不当结论

grep 命中只是假设，**每条必须回上下文确认**；**计数同理**——`grep -c` 数的是匹配行数不是出现次数，且 vendor 自带字符串（报错串、内置 shader chunk）会把应用层用量抬高一个数量级（shopify.design：`ScrollTrigger ×8` 实为 0 次真实使用、`GLSL ×107` 实为应用层 27 段）。这条纪律已前移复述到 Step 0，见 `references/scope-and-fingerprint.md` §2《计数硬约束》【shopifydesign】。逐条实例：kimi 站 grep 到 `leva` 实为 React SVG 属性列表里 `…decelerate|descent…` 的子串误命中，`swr` 同类；`zustand` 反而真实存在只是被内联【kimi】。samsy 早期指纹误判"有 GPU compute"，M1 证伪——`dispatchWorkgroups` 字符串全部来自 three 内部；KTX2/meshopt 能力在 GLTFLoader 里但从未挂载【samsy】。

### 4.2 架构假设先证否再动工

最强案例【kimi】：依赖表里有 three.js + r3f，但**这不是 WebGL 站**——视觉主体是 DOM + 18 个 CSS 自定义属性 + `clip-path` 擦除 + 三个 2D canvas 软件渲染器；`<Canvas>` 只有两个且都懒加载，唯一真 3D 是正交相机 + 32 个 plane、零着色器。"这个误判如果没在动手前发现，会把绝大部分力气花在极小部分画面上"。

操作化：

1. 写下架构假设（"这是 WebGL 站 / GSAP 时间轴站 / …"）；
2. 列出"若为真必然成立"的可检验推论（Canvas 实例数、着色器数量、视觉主体由什么驱动）；
3. 逐条到 bundle / 运行时验证，**先找证否证据**；
4. 证否成本远低于沿错误方向移植的成本。

## 5. grep 混淆代码：搜值不搜名

- **常量名会被混淆重命名**：three 的 `REVISION` 在 noomo 的 bundle 里搜不到，最终靠常量值 `const nv="179"`（`_pretty` L19973）锁定版本【noomo】。
- 比标识符可靠的锚点：**版本号字符串值、十进制颜色字面量**（`15064825` = 0xE5DEF9）、**GLSL 特征串**【noomo】。
- 实操：MB 级单行文件先 `tr` 注入换行再 grep，防有界量词正则卡死（边界探测协议教训）。

## 6. 数据驱动动画：先 dump 成数值账本

原则："**compare recorded values, not screenshots**"（noomo `dump-timelines.mjs` 注释，显式引用 careers-kimi 教训）【noomo】【kimi】。凡被数据驱动的动画，逆向阶段就把数据源 dump 成 JSON 数值基准入库，之后验收用数值全等而非截图目测：

- **GLB 烘焙曲线**：手写解析器 dump 全部动画曲线（noomo `docs/timeline-baseline/` 2.4MB：dev.glb 38 条参数轨道 ×481 帧、cam.glb 相机 601 帧）；后续验收即"相机位置在 t=0/5/10/19 与基准插值小数点后三位全等"【noomo】；
- **CSS 变量时间序列**：探针在镜像上录基准（kimi `probe-deck-vars.mjs` → `docs/deck-baseline/source-*.json`）【kimi】；
- **bundle 内联 base64 资产**提取到 `mirror/_extracted/`（noomo：colorsMap 1024×2 光谱 LUT、SMAA 纹理——缺 colorsMap 玻璃会变灰白）【noomo】。

**基准覆盖面判据**：录之前先确认"观感由哪些量驱动"，把全部驱动量采进基准——kimi 只采 `<main>` 上 18 个变量，位置 3.2 之后变量饱和、场景 3-7 实由容器 opacity 驱动，基准"完全失明"；补采 opacity 后覆盖立刻到 8.2【kimi】。

## 7. 常见坑（逆向坑）

1. **beautifier 版本不钉死 → 行号漂移 → 整个溯源体系作废**【samsy】【noomo】。对策：§1.2 的 README 制度，任何再生成只用登记的命令。
2. **signature grep 子串误命中**（`leva` 命中 SVG 属性列表）【kimi】。对策：每条命中回上下文确认后才能写进笔记。
3. **依赖表撒谎**（three.js 在依赖里但不是 WebGL 站）【kimi】；指纹误判"有 GPU compute"【samsy】。对策：§4.2 架构假设先证否。
4. **搜名搜不到**：REVISION 等常量被重命名【noomo】。对策：§5 搜值不搜名。
5. **数值基准覆盖不全导致后段失明**（18 变量在 3.2 后饱和）【kimi】。对策：§6 先确认全部驱动量。
6. **正则假阳性污染 diff/取证**：`.15` 无前导零、十六进制色值记法差异造成两轮假阳性，samsy 改用"数字字面量多重集 + 结构对比"才收敛出真实增量【samsy】。对策：数值比较先归一化记法。
7. **逆向笔记混入改进判断**导致移植阶段"顺手修 bug"。对策：§2.3 事实/判断分离 + 怪癖单列"照抄不修"。
8. **区段地图只按 license banner 划**：vendor 尾部的 addon 段与散插的"vendor 岛"被算进应用层，应用规模虚高（shopify.design 虚高 5,832 行），评级与工期跟着偏【shopifydesign】。对策：§2.2 的收尾校准 + vendor 岛标注。
9. **把坐标系稳定性拖到 M2 才发现**：坐标载体不是钉死文件时（内联块 / 每请求渲染的 SSR），行号会随平台注入顺序漂，而"同一时刻双抓完全一致"极易让人提前收工【objectarchive】。对策：§1.4——M1 开头多自变量实测，结论按区段记录，主坐标改内容寻址。
10. **在无 bundle 站上照跑 bundle 流程**：对已经是源码的内联块跑 beautify（凭空造出与源站不同的字节，字节门失基准）、用块序号当标识（序号会漂）、按 license banner 找 vendor 边界（vendor 根本在别的文件里）【objectarchive】。对策：§0.1 的"删掉/替换"两张表逐条对照。

## 8. 阶段产出物与通过判据

- [ ] `mirror/_pretty/`：全部 bundle/chunk 已展开（或按 §0 预检登记"无需 beautify，坐标系 = 原文件行号"；**无 bundle 站按 §0.1 登记"坐标系 = 内容哈希 `B:<sha12>`"**）
- [ ] `_pretty/README.md`：含 js-beautify@1.15.1 版本声明 + 逐文件再生成命令 + 版本漂移警告（**无 bundle 站的等价物**：快照 sha256 钉死表 + 漂移守卫命令 + "重抓即全部行号引用作废"警告）
- [ ] **坐标系稳定性有实测结论**（§1.4）：多自变量抓取比对已跑（含跨缓存条目），结论按**区段**写进 engine-notes，守卫命令可复跑
- [ ] 无 bundle 站：**内联块普查表 + 逐块层归属**完成，每块有语义 id，归属门零 UNCLASSIFIED（Shopify 站见 `shopify-platform.md` §0.3）
- [ ] `docs/engine-notes.md`：三段式齐全（事实带坐标 / 怪癖清单 / 复刻直接结论），全文无"应该怎么改"，未坐实处标"未确认"
- [ ] 多 chunk 站：**跨 chunk 导入/导出重命名表**已进笔记（符号 → 源 chunk → 导出名 → 主 chunk 内名 → 行号），供阶段 2 的多源切片消费
- [ ] 技术栈取证表：每个依赖版本都有镜像内证据（bundle 内字符串，或**无 bundle 站的 CDN URL + 文件内复核**，§3.1），`package.json` 计划为 `--save-exact`，传递依赖风险已评估
- [ ] 架构假设已做过一轮显式证否（记录证否手段与结论）
- [ ] 数据驱动动画的数值基准已 dump 入库（`docs/*-baseline/`），驱动量覆盖已确认
- [ ] bundle 内联资产已提取到 `_extracted/`（如有）
- [ ] 阶段计划（REBUILD_PLAN）已按 engine-notes 的"复刻直接结论"排出依赖序里程碑

全部勾选后才进入阶段 2（加载 `porting-discipline.md`）。

## §0.5.2 ⛔ Turbopack 的运行时自带按文件名索引的 chunk 清单【raycastkbd】

eightdesign 的容器图是**平的**:每个 chunk 的名字都出现在 HTML 的 flight 清单里,
把外壳里的名字改成 `.port.js` 就完成了移植交付,跨侧 0.00。

raycast.com 不是。它的 **Turbopack 运行时 chunk(`turbopack-*.js`)内部嵌着一份
按原始文件名索引的 chunk 清单**,动态导入按它解析路径;另有 chunk 之间按原名交叉引用
(实测 8 处)。把外壳与 flight 里的名字改成 `.port.js` 之后:

- flight 驱动的水合加载 `.port.js`(移植件)
- 运行时清单驱动的动态导入**仍按原名再加载一遍原件**
- 同一批模块**被求值两次**,单例状态分裂

⚠ 症状与病灶隔了三层:导航的登录/下载按钮消失、一个 canvas 不再挂载、
**控制台零报错**——没有崩溃,只有两份互不相识的 store。二分 22 个 chunk 全都"有问题",
才看清不是某个 chunk 坏了,是**改名机制本身**在这个形状下不成立。

### ⭐ 解法:分层交付,不改名

移植件以**原名**落在 `site/_next/.../chunks/`,镜像原件留在 `mirror/` 作证据;
`serve --root site --fallback-root mirror` 让每个被移植的名字由移植件应答、其余回落。
外壳零 chunk 变换。移植的证据链改由 `slice --check`(可复现)、模块表门(token 级)
与渲染对拍(像素 0)承担。

⛔ 判据:**看到运行时 chunk 内部引用兄弟 chunk 文件名,就不要用改名交付。**
一条 grep 就能判:`grep -l "chunks/" <runtime-chunk>`。
