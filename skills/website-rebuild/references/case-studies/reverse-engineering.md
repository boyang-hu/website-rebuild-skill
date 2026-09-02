# case-studies/reverse-engineering.md — 逆向建坐标系（阶段 1：Reverse） 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `reverse-engineering.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `reverse-engineering.md` 一一对应。

## 0.35 ⚠ 诊断输出不要截断标识符【airpodspro】

规则见 `reverse-engineering.md` §0.35。

工具为可读把模块 id 截到 10 位打印，那个截断值随后被当作完整 id 写进了配置。**截断的标识符会被原样复制回去**——这不是使用者不小心，是输出的诱导。

⛔ 而下游**静默丢弃了未知 id**（`filter(map.has)`），于是它照常打印一个合理的模块数、切片照常成功，失败推迟到运行时的 `Cannot read properties of undefined`，离根因隔了三层。

## 0.4 ⛔ 关键词计数只缩小范围，不下定位结论【airpodspro】

规则见 `reverse-engineering.md` §0.4。

用计数找签名行为的落点是对的，**把计数结果当成定位结论是错的**。实测一次完整的误判：

- 按 `scrubber=27` 把签名行为定位到一个 85 行的模块，写进了竖切计划；
- 读代码后发现那是**视频播放器进度条的缩略图预览**，平台层的播放器 UI，与滚动无关；
- ⭐ **否证就在同一张表的同一行里：`scrubber=27  scroll=0`。** 一个"滚动驱动视频"的候选出现 `scroll=0`，本身就是结论——数字被读到了，含义没有。

⭐ **而真实机制藏在一个 11 行的模块里**——一张补间引擎的属性表：

```js
domAttributes: ["scrollLeft", "scrollTop", "scrollBy", "scrollTo", "currentTime"]
```

`currentTime` 只是一个**可补间属性**，和 `opacity` 走同一条通路。所谓"视频洗刷子系统"根本不存在。**信息密度最高的模块可能是最小的那个，而计数会把它排到最后。**

## 0.45 ⚠ "自研 vs 用库"，bundle 外部计数给不出答案【airpodspro】

规则见 `reverse-engineering.md` §0.45。

Step 0 依据"81 处 `requestAnimationFrame`、0 处 `gsap`"判为"自研命令式引擎"。没错，但**不完整**：站点建立在源站自己的组件框架上（13 个模块引用框架对象、65 个模块是组件式继承/注册），**框架层与业务层打进了同一个 bundle**。

## 0.5 ⛔ 先判 bundle 形态，再选工具【airpodspro】

规则见 `reverse-engineering.md` §0.5。

分层表扫的是**顶层声明**，而那个前提只对**扁平拼接**的 bundle 成立。前四个实测项目恰好都是那一种，于是这个前提从未被检验。换成 webpack 打包产物后它**零命中**——不是少扫，是一个都没有。

#### 0.5.1 ⛔ 两种模块容器语法，一个读错会**安静地**给你一张小得离谱的表【airpodspro】【v0-optimus】

规则见 `reverse-engineering.md` §0.5.1。

3. ⛔⛔ **读错容器时工具会"成功"。** 实测：webpack 读取器指向一个 Turbopack chunk，找到两处不相干的 `key: function` 属性，报告 **2 个模块**并打印愉快的摘要——而该文件真实有 20 个工厂、45 处 require 调用。

实测在一个无容器的 vendor chunk 上：覆盖 7%、239 处 require 调用对 0 条边 → 正确 FATAL（exit 5）。

⛔ **两个读取器必须都跑完再裁决，不能让第一个先 exit。** 第一版把 Turbopack 探测放在 webpack 分支之后，而 webpack 分支找不到容器时直接 `process.exit`——于是一个 Turbopack chunk 因为"webpack 形状的属性不足两处"被判成无容器，而它的容器就在第 1 行。⚠ 更糟的是：**其余 chunk 之所以能通过，只是因为它们恰好含有两处不相干的 `key: function`**——那是巧合，不是代码路径。

⚠ 只取紧挨工厂的那一个，会**静默丢掉其余全部**。实测一个站的 5 个 chunk 里有 **10 个别名 id** 被丢；症状是运行时抛 `module 73692 … the module factory is not available`，**而那个 chunk 切片是字节一致的、静态门全绿**——因为丢的不是字节，是**注册表里的键**。

⭐ 副产品：**Turbopack 只给站点自有模块写导出名，vendor 模块没有。** 实测 192 个模块里 18 个有导出名，而这 18 个恰好就是站点自己的组件（`HeroSection` / `Navigation` / `PricingSection` …）。这比任何"按体积/按目录"的启发式都干净——**分层证据由打包器直接给出**。

⭐ **模块化打包产物的模块边界与依赖边是给定的**——打包器已经写下了它们。实测一个 24,378 行的 bundle：**569 个不同模块**（容器里 597 条属性，28 条被同名键遮蔽），181 个叶子、416 个有依赖，最大 1,544 行，`requires` 直接可读。

⚠ **认不出容器时必须 FATAL，且禁止回退到分层表。** 分层表对模块化 bundle 会安静地返回"0 个声明"，下游会读成"这个 bundle 是空的"。**一个错的单位边界是静默的 65% 误差**（四层模型那次实证）。

## ⭐ 分层表必须认「顶层裸语句」，否则一行配置会继承邻居的层【lusion】

规则见 `reverse-engineering.md` 同名节。

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

## 0. 预检：先问"有没有 bundle"，再判 bundle 形态

规则见 `reverse-engineering.md` §0。

**本文件的主干（`_pretty/` 行号坐标系、混淆别名表、区段地图、vendor 岛、字节切片器）整体建立在"签名行为住在可下载的 bundle 里"这个前提上。** 前八个项目无一例外满足它；objectandarchive 第一次不满足——行为住在 Liquid 渲染出来的 62 个内联 `<script>` 块里，且是**带作者注释的未压缩源码**【objectarchive】。所以预检先问载体，再问形态；命中"无 bundle"就走 §0.1 的**平行分支**。

边界探测实录（形态表的原始行）：

| 形态 | 判据 | 流程分支 |
|---|---|---|
| **未混淆 esbuild 产物** | 标识符全保留、自带换行缩进——开头即 `var __defProp = Object.defineProperty;`、内部函数名（如 `copyAttributeData`）原样可读 | **跳过 beautify**，直接以原文件行号为坐标系（边界探测实录：bruno-simon 4.86MB 产物、star-atlas 均属此类） |
| 带公开 sourcemap 且 sourcesContent 完整 | map 可下载且含完整源码 | 直取 sourcesContent 替代 beautify（边界探测实录：orano） |
| **手写多文件站（2013 时代，无打包器）** | 每 `<script>` 一文件、原始命名；CoffeeScript 特征（`_i/_len/_ref`、`(function(){}).call(this)`）、Compass 行号注释 | **跳过 beautify 并把这次跳过登记进日志**（"行号指 \_pretty"是全库默认约定，静默跳过会让后来者找错文件）；坐标系 = mirror 原文件行号。⭐ **先做 vendor 逐字节鉴真**：站上的库文件与上游官方 release 直接 diff（skrollr 0.6.11 diff 为空、jquery.min sha1 与官方 CDN 一致）——一次 diff 杀掉整棵"站方魔改库"假设树，剩下的应用文件就是全部逆向面【firstlaunch】 |

### 0.1 无 bundle 站：平行分支（不是替代分支）【objectarchive】

规则见 `reverse-engineering.md` §0.1。

**两条分支并列。** 判据是"签名行为的**载体**是什么"，不是站的好坏、也不是方法论偏好。同一个项目里两者常常并存——objectandarchive 的 vendor（gsap / ScrollTrigger / lenis / jQuery）是 CDN 上的独立文件，自研行为在内联块里——此时**按载体分别建坐标系**：需要读的 vendor 文件按 §1 走 `_pretty/`，内联块按本节走内容哈希。

#### 0.1.1 坐标系：内容哈希作主坐标，行号降级为快照内导航

规则见 `reverse-engineering.md` §0.1.1。

**朴素方案"行号建在镜像 HTML 上"实测不成立。** objectandarchive 抓了六份同一路由的 HTML（同时刻双抓 / 60 秒间隔三抓 / 移动 UA / `Accept-Language: fr-FR` / 隔一天），全部 486,622 字节 10,410 行，逐块比：

| 比较 | 块数（首页全部 `<script>`，含外链） | sha 不同 | 起始行不同 |
|---|---|---|---|
| 同时刻双抓 · 60 秒间隔 · 换语言 | 80 | 0 | 0 |
| 换移动 UA | 80 | 4（**全是 nonce 字段**） | 0 |
| **隔一天（跨 CDN 缓存条目）** | 80 | 12 | **4** |

隔天那 4 处行号差异不是内容变化，**是两个平台 app-embed 块换了注入顺序**：Hulk Form Builder 昨天是第 44 块（L850），今天是第 41 块（L817）。掩掉 nonce 后整页 diff 只有 87 行、全部落在 app-embed 区段内、总行数不变——**同一份内容，两种注入顺序**。

**旁证（免费得到的正确性检查）**：同一个块在三条路由上出现在完全不同的行号——Lenis+GSAP 脊柱 `B:41e7f747ed2a` 在首页 L9564-9687 / collection L8468-8591 / product L11658-11781——而 `B:` 值一致。按行号编目会记成 9 条互不相干的条目；按内容哈希编目自动收敛成 3 条，且"三页共用同一份实现"这个事实白送。

## 1. 建立 `_pretty/` 行号坐标系

### 1.1 展开命令（版本钉死 1.15.1）

规则见 `reverse-engineering.md` §1.1。

- 多 chunk 站（Next 等）把**全部 chunk 逐个展开**（kimi 展开 21 个 chunk 共 57,068 行）【kimi】。
- 版本沿革：samsy 首次把版本钉死制度明文化（当时 2.0.3），kimi/noomo/lando 三代统一 1.15.1——本 skill 钉 **1.15.1**，不要用别的版本【samsy】【kimi】【noomo】【lando】。

### 1.3 行号引用格式（全项目唯一坐标系）

规则见 `reverse-engineering.md` §1.3。

- 里程碑日志的"下一步断点待办"——如 samsy M7a 待办直接写 "字体管理器 **pretty L60740-L60844（未读）**"，跨会话交接靠它【samsy】；
- 实践规模参考：oryzo 107 处 / samsy 276 处 / noomo 161 处 / lando 400+ 处行号引用【oryzo】【samsy】【noomo】【lando】。

### 1.4 坐标系稳定性是 M1 的第一道必答题（两个分支通用）【objectarchive】

规则见 `reverse-engineering.md` §1.4。

- **结论写成区段级，不是全局级**：objectandarchive 的答案不是"稳/不稳"，而是"**平台 app-embed 区段不稳，其余（含全部 26 个自研块）稳**"。这个更细的答案才可用——自研块的行号可以放心当导航坐标；而它只有把"同缓存条目 / 跨缓存条目"当成两个自变量分开抓才看得见。

**为什么必须前置**：objectandarchive 在 Step 0 预登记、M1 开头证伪，于是**在写第一行移植代码之前**就换掉了坐标方案，代价是半天。**同样的发现若拖到 M2 中途才撞上，笔记、移植文件头注释、里程碑待办、怪癖/偏差表里的坐标引用早已铺开（前作规模 107–400+ 处），一次性全部作废且无法自动修复**——与"beautifier 版本漂移"是同一类灾难（§1 ⛔），只是触发源不同。

## 2. 逆向笔记 `docs/engine-notes.md` 先行

规则见 `reverse-engineering.md` §2。

**独立里程碑，产出并提交这份笔记之前不写任何复刻代码**——oryzo 把它列为 M2.0，"文档先行显著降低了后面每轮的返工"【oryzo】；后四代全部沿用【samsy】【kimi】【noomo】【lando（6 份笔记 00-05）】。

### 2.1 三段式内容结构

规则见 `reverse-engineering.md` §2.1。

- **bundle 区段地图**：vendor 边界逐段标行号——lando 给 47k 行画了全区段地图（GSAP 5043-6743、three 10334-30143、Lenis 46469-47010、应用代码各段），"先画地图再挖矿"【lando】；samsy 同样逐段标 vendor 边界【samsy】。**边界怎么划见 §2.2——只按 license banner 划会错**【shopifydesign】；
- 渲染管线、RenderTarget 清单、材质清单（samsy 26 项 TSL 材质、后处理链逐步拆解）【samsy】；
- **无 bundle 站的等价物**：区段地图换成**内联块普查表**（逐块：语义 id / 层归属 / 字节 / `B:<sha12>` / 各页行号 / 首条作者注释）。它同时承担 §2.2 的职责——**应用层规模 = 归属为"站点自研"的那些块**，平台层与上游主题存量都要从规模统计里扣掉，否则任务表虚高（objectandarchive 若把 Dawn 存量算进去，虚高 65%）【objectarchive】。

**第二段：怪癖清单（照抄不修）**：源站 bug / 死代码 / 怪写法逐条登记并带坐标（行号或 `B:`），移植时逐字照抄。规模参考：noomo Q1–Q14、samsy 13 条、kimi 26 条【noomo】【samsy】【kimi】。

**第三段：对复刻的直接结论**：如 noomo 的 10 条（"先实现三个元系统再写任何材质"、"缺 colorsMap 玻璃会变灰白"）【noomo】；samsy 的"不要发明"清单（engine-notes §16）【samsy】。

### 2.2 区段地图的边界校准（license banner 只给起点）【shopifydesign】

规则见 `reverse-engineering.md` §2.2。

**vendor 区不是连续的一块，license banner 也不标终点。** shopify.design 初版按"最后一段 license banner"定 vendor 边界，把应用起点标在 L28141，**错了 5,832 行**——真实边界是 L22309：three.js 的**后处理 addon**（`Pass` L22057 / `ShaderPass` L22091 / `EffectComposer` L22128 / `RenderPass` L22198 / `OutputPass` L22293）整段排在最后一段 license 之后，而应用区间内部还夹着三座 **vendor 岛**（troika-three-text L23527–L26525、SVGLoader L28869–L29895、GLTFLoader+DRACOLoader L31727–L33785）。

1. **起点用 banner，终点用 `class X extends Y` 的收尾校准**：banner 之后继续往下扫到最后一个 vendor 类定义的闭合处（本站 `class c3 extends sc` L22292），再往下第一处**应用配置常量/魔数**才是真起点（本站 `const ac = 800, Pn = 0, v1 = 50 …` L22309——设计基准高度、相机 Y 这类值只可能是应用配置）。

**下游代价**（为什么这不是洁癖）：区段地图错 → 应用层规模误判（本站虚高 5,832 行）→ **难度评级与工期估算一起偏**；且后续每一次"这段要不要移植"的判断都建在错的坐标上，返工时整片行号引用作废。

### 2.3 笔记纪律

规则见 `reverse-engineering.md` §2.3。

- **上一阶段（Step 0）的数字与附带结论一律当假设复核**，不要直接抄进笔记——shopify.design 的 Step 0 判级正确，但附带的路由数、资产数、漏抓归因三条全被 M0 证伪【shopifydesign】。

## 3. 技术栈从 bundle 取证、精确钉死【6/6】

### 3.2 钉死落地

规则见 `reverse-engineering.md` §3.2。

- **传递依赖也要钉**：noomo 用 `overrides` 钉 unhead 2.0.17——2.1.17 会反转 bodyClose 脚本顺序、破坏与源站的尾部字节序，"同一 Nuxt 版本不等于同一输出，传递依赖也要对齐"【noomo】；
- 源站用 dev 分支时取最接近正式版并**登记为偏差**（samsy：源站 three r182dev → 复刻 0.182.0）【samsy】；

## 4. 证伪流程：假设必须先证否

### 4.1 signature grep 只提假设，不当结论

规则见 `reverse-engineering.md` §4.1。

grep 命中只是假设，**每条必须回上下文确认**；**计数同理**——`grep -c` 数的是匹配行数不是出现次数，且 vendor 自带字符串（报错串、内置 shader chunk）会把应用层用量抬高一个数量级（shopify.design：`ScrollTrigger ×8` 实为 0 次真实使用、`GLSL ×107` 实为应用层 27 段）。这条纪律已前移复述到 Step 0，见 `references/scope-and-fingerprint.md` §2《计数硬约束》【shopifydesign】。逐条实例：kimi 站 grep 到 `leva` 实为 React SVG 属性列表里 `…decelerate|descent…` 的子串误命中，`swr` 同类；`zustand` 反而真实存在只是被内联【kimi】。samsy 早期指纹误判"有 GPU compute"，M1 证伪——`dispatchWorkgroups` 字符串全部来自 three 内部；KTX2/meshopt 能力在 GLTFLoader 里但从未挂载【samsy】。

### 4.2 架构假设先证否再动工

规则见 `reverse-engineering.md` §4.2。

最强案例【kimi】：依赖表里有 three.js + r3f，但**这不是 WebGL 站**——视觉主体是 DOM + 18 个 CSS 自定义属性 + `clip-path` 擦除 + 三个 2D canvas 软件渲染器；`<Canvas>` 只有两个且都懒加载，唯一真 3D 是正交相机 + 32 个 plane、零着色器。"这个误判如果没在动手前发现，会把绝大部分力气花在极小部分画面上"。

## 5. grep 混淆代码：搜值不搜名

规则见 `reverse-engineering.md` §5。

- **常量名会被混淆重命名**：three 的 `REVISION` 在 noomo 的 bundle 里搜不到，最终靠常量值 `const nv="179"`（`_pretty` L19973）锁定版本【noomo】。

## 6. 数据驱动动画：先 dump 成数值账本

规则见 `reverse-engineering.md` §6。

- **GLB 烘焙曲线**：手写解析器 dump 全部动画曲线（noomo `docs/timeline-baseline/` 2.4MB：dev.glb 38 条参数轨道 ×481 帧、cam.glb 相机 601 帧）；后续验收即"相机位置在 t=0/5/10/19 与基准插值小数点后三位全等"【noomo】；

**基准覆盖面判据**：录之前先确认"观感由哪些量驱动"，把全部驱动量采进基准——kimi 只采 `<main>` 上 18 个变量，位置 3.2 之后变量饱和、场景 3-7 实由容器 opacity 驱动，基准"完全失明"；补采 opacity 后覆盖立刻到 8.2【kimi】。

## §0.5.2 ⛔ Turbopack 的运行时自带按文件名索引的 chunk 清单【raycastkbd】

规则见 `reverse-engineering.md` §0.5.2。

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
