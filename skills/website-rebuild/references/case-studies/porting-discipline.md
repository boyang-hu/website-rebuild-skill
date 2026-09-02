# case-studies/porting-discipline.md — 严格溯源移植（阶段 2：Port） 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `porting-discipline.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `porting-discipline.md` 一一对应。

## 0.25 ⭐ 门报出你没料到的数时，先假设错的是你【airpodspro】

规则见 `porting-discipline.md` §0.25。

实测：把表达式解析接上活布局后，`a0t`/`a0b` 解析成 `[0.25, 0.65]`，而我手算是 `[0.1667, 0.4333]`（按容器高度归一化）。**第一反应是"解析器移植错了"。** 回去读源码里的归一化函数——分母是**可滚动距离**，不是容器高度。**引擎是对的，心算是错的。**

⛔ **如果当时去"修"解析器迎合手算，就会把一个正确的移植改坏，而门会变绿。**

## 0.3 ⭐ 编排可能是一门表达式语言，而不是一组数值【airpodspro】

规则见 `porting-discipline.md` §0.3。

✅ **实测已接通**：按源站自己的调用序（先 `refreshMetrics()` 让组自行构造元素集合——**不要手调 `refreshCollection`**，再 `evaluateConstraints()`），并给锚点选择器一个**真实布局的元素**，`a0t`/`a0b` 就解析成真实的滚动 t 值。⚠ 锚点数组为空时解析器读不到盒子，报 `reading 'top'`——**那不是解析器坏了，是它缺输入**。

实测把它算进依赖闭包后，切片从 31 模块 / 1,179 行变成 **41 模块 / 2,100 行**。

⚠ 这与 v0.1.3「被冻结分支上挂着的子系统会以通过的形式消失」同型，但更难发现：那次至少有个分支可以去查，这次**缺失的是一个数据字段**。

## 1. 宪法级纪律（五条）

### 1.1 源站代码是唯一裁决，不凭观感修

规则见 `porting-discipline.md` §1.1。

- **实证**：oryzo M2.3 曾用目测近似实现先跑通，随后整批替换——commit 明写"全部逻辑溯源 bundle，**替换了此前的近似实现**"。

### 1.2 源站有的都要有，没有的不做；不自创补偿性 CSS/JS

规则见 `porting-discipline.md` §1.2。

- **实证**：rogier 十余个视觉 bug **全部**源于"JS 机制没对齐时用自创 CSS 补观感"——等 JS 对齐后，这些补丁反转成 bug【rogier】。

### 1.3 bug / 死代码 / 怪写法照抄不修

规则见 `porting-discipline.md` §1.3。

- **最强实证【lando Q13】**：源站 `World.destroy` 里 `scene.remove(Q.name)` 传字符串——在 three 中是 no-op。复刻时曾"修好"改成真删除，结果**真删除破坏了场景遍历，导致转场崩溃**，最终按怪癖回抄 no-op。"bug 照抄不修"不是洁癖，是工程安全绳【lando】。
- **其余实证**：
  - rogier：`pz % 250 + 10` 带符号取模被"好心修正"为正取模后，About 页浮动方块全部消失【rogier】；
  - oryzo：`mipFilter` 死参数、光场 RT 错误的 `format="R8"` 照抄——"修正它们反而会偏离源站的实际渲染结果"【oryzo】；
  - samsy：`isSprinting` 恒为 true、事件名拼错导致监听器泄漏、三个调用即崩的死方法（引用全 bundle 无定义的标识符）逐字入库——"修好它们才是偏离"【samsy】；
  - kimi：`lineWidth 0.30000000000000004` 浮点残迹、被读不被写的 CSS 变量、硬编码英文 aria-label 等 26 条怪癖照抄并注明行号【kimi】；
  - noomo Q13：采样数切换事件把 define 大小写写错、从未生效——连这个"无效重编译"都照抄【noomo】；
  - 死代码同样移植：rogier 保留零引用的 `.ts-split` 规则【rogier】；kimi 移植九种轨道形状里八种死代码【kimi】。

### 1.4 有意偏差必须登记

规则见 `porting-discipline.md` §1.4。

samsy 用 "REGISTERED DEVIATION" 注释 + 计划文档同步登记【samsy】；rogier 为 "Open Decisions" 表【rogier】；noomo 终版 14 项、lando 12 条、kimi 6 条【noomo】【lando】【kimi】。

- **范本**：kimi 的"4.8MB 字体拒绝子集化"——可压四十余倍但拒绝，理由按杀伤力排五条（首屏渲染门控时序、`measureText` 折行、点阵舍入敏感、538 字是移动靶、私有仓库收益为零），并附"重新考虑的条件"。

## 2. 移植文件头注释规范与逐字落地形式

### 2.2 逐字移植的首选实现形式：字节切片，不是重打字【shopifydesign】

规则见 `porting-discipline.md` §2.2。

实测规模：M2 时 33 段 / 2,475 行源站字节，收官时 **61 段 / 21,996 行**【shopifydesign】。

shopifydesign M2/M3 累计 5 次边界错，全部被平衡检查当场抓出，单次定位约 5 分钟——`scripts/extract-source.mjs --balance-check` 已内置该检查（原理与实证见 §6.2 删桩流程），不必自写。

> **实证**：M2/M3 累计 **5 次**切片边界错，**全部**是切**单个应用函数**时收尾少一行；M4a 一次切了 **13,147 行、四段大 vendor 岛**（troika 4,702 行 / opentype.js 8,154 行 / 文字模块 281 行 / 两段小补丁），`--balance-check` **一次没红**。

#### 跨 chunk 切片：一个源 chunk 一个输出模块（模块作用域是硬约束）【shopifydesign】

规则见 `porting-discipline.md` §2.2。

- **两个 chunk 是两个 ES 模块作用域，压平就会撞标识符。** 实证：M4c 跨 chunk 切 SiteHeader 的 blossom carousel（L58–L493，436 行），**第一次加载就 `SyntaxError: Identifier '$' has already been declared`**——SiteHeader 把某个 helper 压成了 `$`（它的 L93），主 chunk 的 `$` 是一个 three.js 类。**两个都没错**：它们在各自的模块作用域里都是唯一的，撞车完全是切片器把两个 ES 模块拼进一个文件造成的。

- **判据（什么时候必须建独立模块）**：**当你要从第二个 chunk 取的东西超过"一张常量表"时，先给它建自己的输出模块，再切。** 实证：M4b 跨 chunk 只取了 8 行（一张文案表），压平无事；M4c 取 436 行，第一次加载就炸。

#### 切片可行性判据：边界受源站**声明结构**约束【shopifydesign】

规则见 `porting-discipline.md` §2.2。

- 实证 1：`J1`（选曲，L28271–L28284）是纯函数，本该一切了事。切不了——它的数据 `Ev`（30 首曲目，L28182–L28266）焊在一个从 **L28176** 开始的 `const` 块里，而该块的前三个成员是 `De.createContext(...)`（React）。从 L28182 切会得到一段以 `Ev = [{` 开头的孤儿，**要补一个 `const` 才能解析**（**这正是 `wrap` 存在的理由**，见下）。
- 实证 2：`hx`/`dx`（L45169–L45170）是模块级可变量，与它的 `const` 邻居同块，且 importer 侧无法赋值。
- 实证 3（**边界形态**）：**一行里同时装着上一个声明的收尾和下一个模块的 banner**，这是压缩产物的常态——`CU`（尚未移植的透明视频 dispose）的收尾 `}` 与 opentype 岛的 license banner **同在 L34086**。

**推论：起点/终点按语句判断，不按行判断。** 上例的处理是把岛的起点后移到 **L34087**，把 banner 留给尚未移植的邻居；将来切 `CU` 时终点写 L34086 会把 banner 一起带进来（可接受）。

#### 切片表的两种扩展形态：多源钉版与 `wrap`【shopifydesign】

规则见 `porting-discipline.md` §2.2。

- 实证：`Pa`（工作室浮层的文案表）住在 `SiteHeader-DOgAl6Q_.js`，主 chunk 只 import 它。

- 实证：全表 61 段里**只有 2 段**用它——一段的链头三个成员是 React context 绑定（按 D9 不跑），另一段的链头是引擎根本不读的文案。

### 2.3 GLSL / 魔数 / 数据逐字提取

规则见 `porting-discipline.md` §2.3。

- **GLSL 逐字拷贝、集中存放、头注声明**：oryzo 的 `glsl/index.ts`（845 行、118 段 shader）头部声明 "GLSL extracted verbatim from … **Do not edit by hand**"【oryzo】；lando 流体六 pass 注明 "All GLSL verbatim" 并逐 pass 列源行号【lando】；noomo 连源站变量名 `yeahRaytracingBroWhySoComplex` 都照抄【noomo】。

- **逐字的直接收益**：noomo 离线 `node diff` 证明 shader 与源站逐字一致后，像素差异排查即可**聚焦到编译参数/数据链**（M7a F1 全屏竖纹最终定案为 GLSL 版本默认值差异，一行修复级联解决三个表观 bug）【noomo】。

- **魔数照抄**：`wheelEaseCoeff=12`【oryzo】、bloom strength 0.34 / radius 0.27×DPR（带行号）【samsy】、"噪声种子、灰阶表、4×4 与 8×8 抖动矩阵、量化级数全是硬编码魔数，目测调不出来，只能逐字抄"【kimi】、LCG 种子 1111111114、弹簧参数 (50,15)【noomo】、GSAP 贝塞尔控制点公式与 ScrollTrigger 配置逐字抄录【lando】。

### 2.5 端口怎么被加载，是端口的一部分：三种交付形态【milknetwork】【raycastkbd】【hubtown】

规则见 `porting-discipline.md` §2.5。

**实证（milknetwork）**：main chunk 的 15 个模块闭包门报"自洽",但 module-map 的 `externalRequires` 列出 10 个跨 chunk id（gsap/three/swiper 全在 vendor 分包）——独立运行时形态在 app 第一次动画时必然 `module ./node_modules/gsap/index.js is not in the registry`。按 chunk 形交付后,原 runtime + 三个 vendor 原件不动,像素逐档与带宽全同。

#### 2.5.1 转写微运行时：字母语义从 runtime chunk 抄，不从调用点猜【basement】

规则见 `porting-discipline.md` §2.5.1。

实证:847851 按主 chunk
证据是 hls.js,但懒 chunk 里它是 18.5k 行 mux 播放器组件模块(内嵌 hls);
顶替成 npm hls.js,文章视频以 React #306 死在 next/dynamic。

## 3. 数据资产：脚本从 bundle 抽取入库，禁止手抄

规则见 `porting-discipline.md` §3。

副产品：源站英文文案自己的拼写错误（"Leaining rate" / "Senquential"）经管道原样保留——"抽取式移植的免费收益：连错都不用自己抄"。

- **同类实践【samsy】**：`src/data/` 下 works.json（25 条）、cityLayout.json（bundle L65917-66615 逐字反解，35 处摆放）、animations.json（1.64MB）、mixamoRig.json、preloaderFrames.json。

## 4. 三张登记表制度

### 4.1 ⭐ 每张表都要有一道反查它的门：表会悄悄漂在现实前面【objectarchive】

规则见 `porting-discipline.md` §4.1。

它们的共同点是——**表声明的是"现实的某一部分已经如何"，而现实变了不会来通知它。** 这条最初是作为变换表的局部论证写下的，实测证明它与"变换"无关，是关于**表这个东西本身**的。

> **实证【objectarchive】**：M3a 建 `runtimeGates` 销账表（哪一块由哪道门证明"真的在跑"）时，任务书把 `oa-hero-bg-scale`（`B:fd64182e34da`）记为"M2 已做"。按纪律逐条回查，**不成立**：M2 的脊柱门断言的是**脊柱自己的** hero 视差补间（trigger 为 `#MainContent > .shopify-section:first-child`），而 `B:fd64182e34da` 是另一个东西——分层 hero 轮播 + `calcBgScale()` 覆盖度计算，宿主 `#hero-layered-*`，脊柱门一个字都没碰。**两者共用同一个宿主 section，所以表面看像已覆盖。** 该项退回后续里程碑队列——**销账表建起来的第一天就抓到一条虚报。**

### 4.2 ⭐ 复核必须是阶段固定动作：登记错误率是稳定量，不是偶发【objectarchive】

规则见 `porting-discipline.md` §4.2。

**五轮**连续实证说明这不够——**每一轮都抓到，而且抓到的是不同的错法**：

| 轮 | 抓到什么 | 那条登记是谁写的 |
|---|---|---|
| M3a | **进度虚报**：销账表把 `oa-hero-bg-scale` 记为"上一里程碑已做"，实测那块的分层轮播与 `calcBgScale()` 一个字没碰——它与脊柱**共用宿主 section**，所以表面看像已覆盖（详见 §4.1 实证） | 本轮任务书 |
| M3b | **§Q 的内容错**：Q1 说"三份 `OPENINGS` 几何表相同"，实为 **18 / 16 / 16** 两种；Q2 说"某尺寸预览静默消失"根本不成立——该项就在 PDP 那份表里，`render()` 还**显式**把它并入无框分支 | 早期登记，**且已被当成地面真相下过硬指令**（上一轮的断点待办照它写着"门要断言 `buildFrameUrl` 返回 null、预览静默消失"） |
| M3c | **同两条的坐标仍错**：Q1 的表区间应为 `+50..+67`（原写 `+50..+76`）、Q2 的 `'30x40'` 在 `+18`（原写 `+14`，那一行其实是 `'18x24'`）；分层归属表里"the same 16-entry OPENINGS table"同样过时 | **M3b 刚刚更正过内容的那两条** |
| M(n-1)a | **Q2 的坐标第三次错**：`if (!spec) return;` 的区间原写 `+143..+144`（那指的是"空行 + 查表"），实为 `+144..+145`——**恰好把守卫本身漏在区间外**；同一段逻辑的姊妹条目 `B:735c258faf0a+109..+110` 一直是对的，两者本该平行 | **M3c 刚刚更正过坐标的那一条**（同一条目连错三轮、被更正三次） |
| M(n-1)b | **抽 5 条抓到 2 条，两条都落在"上一轮刚改 / 刚加"那一格**：① **坐标指错了文件**——某条 §Q 登记引的那段 `<750px` 覆盖 CSS 不在主题样式表里，而在该商品页文档自己的内联 `<style>`（`L5511` 横幅 / `L5514–L5521` 规则）；主题样式表里**确有**一条同名规则，但被另一个商品类目的类限定，本页根本不命中。**内容字段逐字正确、坐标字段指到了另一个文件里一条同名不同义的规则**；② **数字差 1 px**——逆向笔记里上一轮刚补的那一列滚动几何写成 `14,443 / 13,599`，实为 `14,442 / 13,598`（把 `14442.047` 的小数位往上进了一格），而 `maxY` 正是像素门位置维的**末检查点**，差 1 px 等于"滚动终点"那一格永远对不上 | **上一轮刚新增的那条登记 + 上一轮刚补的那一列数** |

**最贵的是第三、四行**：同一条登记（Q2）连错三轮——M3b 更正了**内容**、M3c 更正了**坐标**、M(n-1)a 抽验发现坐标**还是错**。而**更正过的条目看起来是最可信的**——它刚被人认真读过。

**第五行把规律收紧了两处**：① **抽验 5 条抓到 2 条，两条都落在"上一轮刚改 / 刚加"那一格**——**"刚新增"与"刚更正"是同一格**，而且刚新增的更危险：刚更正的至少被人认真读过一遍，刚新增的**一次复核都没经历过就已经开始被引用**；② **两条的错法完全一致——内容对、坐标 / 数字错**，都是"改对（写对）了被质疑的那个字段、整条其余字段原样照抄"留下的（纪律 3 的症状）。**反面证据同样有力**：同一轮里 Q2 的**七处坐标逐行数过、全对——四轮以来第一次不用更正**，因为这一轮是按纪律 3 回**源站字节**重新取证的，不是照上一版改。规矩生效的样子就是这样。

⭐ **更正必须回一手来源重新取证，禁止基于上一版做增量修正。** 同一条登记连错三轮，机理不是"人不小心"，是**更正这个动作本身的做法错了**：每一轮都照着**上一版登记**去改那个被质疑的字段，而不是回源重数一遍。

- **坐标逐行数到边界那一行，不按印象取区间。** Q2 的 `+143..+144` 与 `+144..+145` 差的正是 `if (!spec) return;` 那一行本身——区间少一行，"这条早退到底存不存在"就没有任何门盯着。

实证：Q2 被抓的三次里后两次落在这一格；M(n-1)b 抓到的 2 条**两条都在**这一格（一条上一轮新增的登记、一条上一轮新补的一列几何数）。

**⭐ 错误形态学：坐标比内容更容易错，抽验时按这个分配注意力【objectarchive】**——五轮抓到的错分布很不均匀：**进度/结论错一次（M3a）、内容错一次（M3b），其余三轮全是坐标 / 数字错**。

**为什么必须是开工时**：M3b 那条错登记不是"文档里的一句错话"，它已经变成了下一轮的任务书。

## 5. 里程碑推进与提交纪律

### 5.1 依赖序推进 + 先竖切

规则见 `porting-discipline.md` §5.1。

noomo 遵循 engine-notes 结论"先移植三大自研元系统（provider 注入器 / ShaderRegistry / 时间线绑定原语）再写任何材质"【noomo】；lando 按 M3 站点 chrome 层 → M4 Rive 层 → M5 Three GL 层 → M6 页面专属逻辑分层【lando】；samsy M2→M9 同理【samsy】。

- **先竖切一条端到端链路**：oryzo 先把 hero 场景从加载到渲染整条链打通，再横向铺其余场景集群【oryzo】——竖切最早暴露架构级错误。

### 5.2 每里程碑验收后才进下一个

规则见 `porting-discipline.md` §5.2。

- 已建立的底层验收门保持全绿：noomo 的 git log 里几乎每条 commit message 以 "SSR gates green" 收尾【noomo】。

## 6. 临时代码生命周期标记

规则见 `porting-discipline.md` §6。

- oryzo：`phase1-shims.css` 每条 shim 注明"**将在 phase 2 被引擎逻辑取代**"，后续果然全部删除【oryzo】；
- lando：`stubs-notes.md` 是"临时骨架清单（逐波替换为溯源实现）"，每个 stub 文件标注对应源函数与行号区间【lando】；

### 6.2 竖切期的 pending 桩：两种形状、两本清单、删桩流程【shopifydesign】

#### (a) 桩的两种形状

规则见 `porting-discipline.md` §6.2 (a)。

- **实证**：shopifydesign M2 立 26 条桩，boot 期连续抓出 3 处"以为不会走到"的路径，每次都是带行号的失败；M3 全程（桌面 + 移动、全滚动走查）无一 throw 被触发——这本身就是"这些子系统在当前可达状态下确实全走空分支"的正面证据。

#### (b) ⭐ 缺失清单要有两本：桩文件不是全部

规则见 `porting-discipline.md` §6.2 (b)。

> **实证**【shopifydesign】：`R5`（DOM 标题揭示，L45024–L45071）在复刻侧**完全缺失，跨越两个里程碑无人发现**。它只被一个 React effect（`D5` L45073–L45085）调用，而那个 effect 本身没被移植——**没有调用点就没有未定义符号，就没有桩**。（它同时对确定性冻结下的数值门隐身，两层原因叠加才拖了两个里程碑：`gate-failure-modes.md` §1.7 / `determinism.md`。）

#### (c) 删桩流程

规则见 `porting-discipline.md` §6.2 (c)。

> **实证**【shopifydesign】：M2 关账时 102 个字段延后，归因写的是 hero 砌砖 + 倒计时舞台——**这两个东西在桩文件里一个都没有**（它们是 React effect，正是 (b) 的佐证）。M3 的第一步因此是"移植两个不在清单上的东西"：桩文件一条没动，门就全绿了。反着做（先挑最小的桩删）会让里程碑的关账条件一直悬着，而且删掉的桩多半与门无关。

实证：`Q5` 的切片写成 L45530–L45553，少了收尾的 `}`（正确是 L45554），报 `Unexpected token ')'`，逐片二分 30 秒定位。

实证：一次性列出 7 个待解析别名，全部在写代码之前补进别名表。

这两道检查就是"删了才发现依赖没接上"的实际拦截点——shopifydesign 第一次执行删桩，全程零此类返工。

> **实证**【shopifydesign】：`tP`（线层深度剔除）的桩此前从未 throw，正说明 `lineLayers` 一直是空的；`LB`（网格 builder）一落地 `lineLayers` 立刻非空——若漏切 `tP`，得到的是一个**带行号的 throw**，而不是"线层不做深度剔除"的静默错画面。per-frame 桩的价值**在被删之前的最后一刻才兑现**。
