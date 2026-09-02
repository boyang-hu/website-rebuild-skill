# determinism.md — 确定性协议（对拍门的前置条件）

> **何时加载本文件**：搭建任何像素对拍 / byte-equal / 同帧对拍门之前必须加载（与 `references/verification-gates.md` 配套）；以及当对拍结果不稳定、双侧截图"每次都不一样"时回来排查。核心命题：**先把双侧驱动到可复现的同一状态，比对才有意义**。
>
> **⚠ 回答"距对拍验收还差什么"时别去数脚本**：`pixelcompare` / `side-by-side` / `probe-shim` 都在盘上 ≠ 协议就绪。objectandarchive 在行为侧 26/26 块全绿（两侧各 PASS 0、跨侧 0 差异）之后清点这一问，缺口正是本文件这套东西——九条熵源里**三条本轮之前不存在或没登记**（`Math.random()` 选首屏底色、两条 `localStorage` 跨会话持久状态），而那三个脚本一次都没跑过。**脚本齐备 ≠ 协议就绪；开工前先按 §1 冻结熵源清单，再谈跑哪个脚本。**【objectarchive】

## 0.1 ⛔⛔ 冻结 JS 时钟冻不住 CSS 动画【v0-optimus】

`probe-shim.js` 接管的是**每一个经过 JavaScript 的时钟**：rAF、`setTimeout`/`setInterval`、
`performance.now`、`Date.now`、`new Date`、定种 `Math.random`。

⛔ **CSS 动画不经过 JS。** `animation: marquee 30s infinite` 跑在浏览器自己的动画时间线上，
一个"完全冻结"的页面里它照样在走。

⭐ **症状是"同侧对照比跨侧还大"**，再加上残差**在两次运行之间换位置**，两条独立证据都指向同一结论：**不可归因于移植**（`gate-failure-modes.md` §3.1 (D)）。（实证：`case-studies/determinism.md` §0.1）

⚠ 别把它误读成"移植很好"。正确的读法是**这道门在这个目标上带宽受限**——它此刻分辨不出
比 0.3 更小的差异，所以阈值必须写成"实测带宽"，且计划里要注明它是带宽不是精度。

### 0.1.1 补法与它的边界

`pixelcompare.mjs --freeze-css` 给所有元素（含 `::before`/`::after`）加：

```css
animation-play-state: paused !important;
animation-delay: -1s !important;   /* 同一相位，两侧一致 */
transition: none !important;
```

⚠ 它**改变被渲染的内容**（marquee 被定格在行程中间而不是各自漂到的位置），这正是目的：
**两侧定格在同一位置**。（实证：`case-studies/determinism.md` §0.1.1）

### 0.1.2 ⭐⭐ IntersectionObserver 也是一个时钟，而且在滚动揭示站上是最要紧的那个

剩下的熵源是 **IO 的投递时机**：浏览器按自己的
节奏投递交叉记录，不在主线程的帧循环上。于是同一个"已冻结"页面的两次抓取，其入场动画
可能从不同的泵计数开始——**这种残差会在两次运行之间换位置**，正是它让残差无法归类。

⭐ **修法是把它接管过来**：记录每个 observer，在**泵里**同步投递记录，按注册顺序，
且**只在状态变化时投递**（每帧都投递就成了另一种 observer，会让一次性揭示反复触发）。
两侧于是在同一个虚拟帧上看到同一批回调。

（各阶段自比带宽 / 跨侧最差 / 可用阈值的实测表与回归验证：`case-studies/determinism.md` §0.1.2）

⚠ 它改变的是回调**何时**触发，不是**是否**触发；只在 `?__probe` 下生效。

### 0.1.3 ⚠ 冻结页上的探针不许用真实计时器

shim 把 `setTimeout` 换成了受泵驱动的队列。所以在 `?__probe` 页上写
`await new Promise(r => setTimeout(r, 3000))` **永远不会返回**——探针挂死，而看起来像页面卡住。
在冻结页上等待，只能用 `window.__pump(dt, n)` 推进，或者干脆去掉 `?__probe` 再测。

## 0.2 ⛔⛔ `--ready` 必须是**泵循环的退出条件**，不能是泵之前的等待【eightdesign】

像素门原来在导航之后、泵之前等 `--ready`。⛔ 那样它**只能表达「不需要任何驱动就已就绪」**——而冻结页上值得等的状态，恰恰都是泵才能产生的：预加载走完、WebGL canvas 被定尺、入场动画结束——**在一个前置条件尚未运行的条件上等待。**

⭐ 改成泵循环的退出条件：**泵到状态达成为止，以帧预算封顶**。状态早到就早停，永远不到就**响亮失败**——⛔ 不许拿一张"还在加载"的画面去比对，**两张加载屏会完美一致**。（实证：`case-studies/determinism.md` §0.2）

### 0.2.1 ⚠ 找 ready 判据时，容易挑到**太早**的状态

判据在"画面可判"之前就为真的情形，靠**非空画面前置条件**拦下来——⭐ 这道防呆是唯一知道"这张画面配不配拿去比"的东西。（实证：`case-studies/determinism.md` §0.2.1）

⚠ 当一个站找不到便宜的可观测就绪态时，**退回墙钟 settle 是允许的，但要登记**：它偏离了「settle 必须是页面状态」（§2.2），理由要写清楚——本例是"该站在可渲染帧之前的所有可观测状态都太早"。⛔ 不要把这种偏差藏在默认值里。

### 0.2.2 ⚠ 这个站需要**真实时间与泵同时**推进

**两者交错才前进**——资源在墙钟上到达，进度在 rAF 上推进。这正是 v0.1.22 那条的又一个实例，
而它也解释了为什么 `--ready` 必须住在**交错循环内部**：只有那里两个时钟才同时在走。（实证：`case-studies/determinism.md` §0.2.2）

### 0.2.3 ⛔⛔ 驱动也必须住在泵循环里——**就绪需要驱动，驱动需要就绪**【eightdesign】

`--ready` 要进泵循环（`gate-case-design.md` §1），而**驱动同样要**，理由是同一个。

⭐ 结论：**一次性的 `load` 种子，对任何"目标物由页面自己异步创建"的站都从根上太早。** 驱动要成为泵循环里每轮重算的表达式（`pixelcompare --drive`），写成幂等的——它会被执行很多次。（实证：`case-studies/determinism.md` §0.2.3）

### 0.2.4 ⚠ 平滑滚动库会把你的落点抢回去

平滑滚动库**拥有**那个滚动值，`scrollTop = x` 只是一个**请求**，不是结果；两侧各自动画到不同位置，而门把它们当成同一位置比较。（实证：`case-studies/determinism.md` §0.2.4）

⭐ 这正是 §2.1.1 早就写过的那句：**「一个悄悄给出错误位置的驱动，比一个抛异常的驱动贵得多」**——本例是它的实证。所以驱动必须**读回落点并断言**（已做进 `pixel-walk`：种子记录 `landed`，像素门比较两侧落点，差超过 4px 直接 FATAL）。

⚠ 完整的解法是**按站写驱动**：发滚动 → 泵 → 读回 → 未达目标就响亮失败。skill 不提供成品，因为驱动语义按站而异。

## 0. byte-equal 的前提假设与失效条件

- **前提假设**："同机同版本 Chrome 的 DOM 渲染是逐字节确定的"【kimi，M5.2 确立】——这个事实使"整页 byte-equal"成为可行的常规验收。但它只在**同一台机器、同一版本 Chrome、全部熵源被冻结**时成立。
- **失效条件**（任一命中则该画面降级为量化对拍门，见 `references/verification-gates.md` §1.3）：
  1. 画面含本性不可冻的随机源（视频帧相位、glitch/粒子随机相位）【samsy】——或对局部用"同等隐藏"协议（§2.8）剥离后其余部分仍走 byte-equal；
  2. 跨机器/跨 Chrome 版本比对（渲染不再逐字节确定）；WebGL 场景在无头下用 SwiftShader（`--use-gl=swiftshader`）保证可复现渲染【rogier】，但与真机输出仍有差异（sRGB 色彩管理、授权字体），须真机兜底【oryzo】。**⚠ 交叉警告：这条 flag 本身是 §2.9 的能力探测熵源**——站点若有 GPU 分级，GPU 名黑名单常直接含 `swiftshader`，加了它等于把被测程序静默切到低画质分支（shader 源码都不同）；且软件渲染会让单次截图慢到 1–2s，按状态对齐抓帧的门会被采样偏差污染（`references/environment-traps.md` §7）。**适用边界与配套动作见 §5**【shopifydesign】；
  3. 熵源没有枚举完（症状：同侧连续两次截图哈希就不相等——先自拍两次验证单侧确定性，再谈双侧对拍）；
  4. **双侧的能力探测结果不同**（画质档、编解码器分支、设备分支）——此时两侧跑的根本不是同一个程序（shader 源码都可能不同），任何门都无意义；先按 §2.9 在两侧钉死同一探测结果再谈对拍【shopifydesign】；
  5. 字体加载时序被改动。kimi 拒绝子集化 4.8MB 字体的首要理由：字体是首屏渲染门控（deck 等 `document.fonts.ready` 才渲染），子集化会污染时序基线；canvas `measureText` 折行会变、点阵字体对坐标舍入极敏感【kimi】。**测量基准的稳定性优先于"看起来该做的优化"**。

**⚠ 还有一个熵面整个落在本文件射程之外：取样时刻。** 冻结协议管的是"**跑起来之后**的熵"；"**什么时候算测完**"——网络到达顺序、媒体元数据解码完成顺序、字体就绪——九种协议一条也覆盖不到。（实证【shopifydesign】：`case-studies/determinism.md` §0）**settle 必须是页面状态判据，不能是墙钟**——判据、三条做法与"先让基准侧连跑两次"的自检见 `references/verification-gates.md` §2.2。

## 1. 方法内核：枚举熵源，逐个消掉

kimi M4.3 日志原话："**找出渲染器的全部熵源，逐个用环境补丁消掉**"【kimi】。熵源按类型分型，每型对应一种冻结手段：

| 熵源类型 | 表现 | 对应协议（§2） |
|---|---|---|
| 墙钟（`performance.now`/`Date.now`） | 旋转积分、计时驱动的位置 | `clock`、`__warp` |
| rAF 时间戳 | 时间戳驱动的累积器、跑马灯 | `clock+raf`、`framebudget` |
| 媒体时钟 | 视频帧推进 | 媒体层补丁 |
| `Math.random` | 洗牌、字符瀑布 | 种子化随机 |
| 定时器（`setTimeout`/`setInterval`） | 倒计时、定时编排 | 泵驱定时队列（§3） |
| **能力探测**（第四类熵源）【shopifydesign】 | GPU 微基准定画质档、codec 探测选资源、硬件参数/媒体查询分支——**随机器甚至随同机两次运行而变** | 探测结果钉死（§2.9） |
| 合成层光栅缓存 | transform 过渡留下的历史次像素光栅 | 重光栅归一化 |
| 本性不可冻 | 无法钉死的局部 | 同等隐藏 + 专门门 |

**操作顺序**：
1. 读 `_pretty/` 找出这块画面消费了哪些时间/随机/探测源（grep `performance.now`、`Date.now`、`new Date`、rAF 回调签名、`setInterval`、`Math.random`、`video.currentTime`、`canPlayType`、`deviceMemory`、`hardwareConcurrency`、`matchMedia`、`WEBGL_debug_renderer_info`…）——**这份清单是本站专属的，不能套用上一个项目的**（§3 覆盖面验收）；
2. **逐条问"它的运动由谁驱动"（§1.1）**：泵管不到的（合成器 / CSS transition）直接走非冻结手段，别进下一步；
3. 对**泵得到**的那些按 §2 协议表选冻结组合，位姿表里**每条位姿显式声明 freeze 模式**【kimi】；
4. **为每个即将冻结的源列出它下游的入口**（从它里面派发的事件、resolve 的 promise、翻转的就绪标志，以及这些信号的消费者），逐个决定"探针泵到 / 补不冻结抽查"——**冻结会让挂在被冻分支上的子系统对门隐身**，这一步是冻结的配套纪律而不是可选建议（§2.10）【shopifydesign】；
5. 双侧同协议注入（同一份补丁代码打在镜像与复刻两侧，注入点按 §3 的分支判据选服务层还是 CDP）；
6. 跑 §4 防呆断言，确认冻结与驱动都真的生效了。

> **⚠ 这份清单是"输入侧的账"，它不能代替"输出侧的账"【objectarchive】**：熵源表回答"**什么输入会变**"，回答不了"**这一帧上到底有哪些面在上色**"（DOM 文本与背景、`<img>` 解码结果、`<canvas>` 位图、`<video>` 帧、SVG、CSS 生成内容与伪元素、滤镜与合成层）。**两张账都要有**——**在补齐记录之前，所有归因都是在猜**。建账方法与实证见 `gate-failure-modes.md` §3.1.1。（实证：`case-studies/determinism.md` §1）

### 1.1 ⭐ 选冻结手段之前先问：这条熵源的运动由谁驱动【objectarchive】

§2.10 的"冻得越狠盲区越大"容易被读成**"先全冻，再逐条补盲区"**。反了：那句话的操作含义是**能不冻就别冻**，而**冻结的正确答案有时就是"这一条不冻"**。判据四步，全部在开冻之前问完：

1. **这条熵源的运动，最终由谁在推？** 顺着它的下游读到运动落地的那一行，分两类：
   - **引擎时钟**：rAF / `setTimeout` / `setInterval` / `performance.now` 累积器 / gsap ticker / `video.currentTime` —— 全都跑在页面的 JS 里；
   - **合成器时钟**：CSS `transition` / `animation`、`scroll-behavior: smooth`、原生滚动惯性 —— 跑在浏览器进程里，页面 JS 只是**发起**它。
2. **泵管不管得到？** 引擎时钟归泵管（§3 的 `__pump` 换掉的就是页面的 rAF/timer），按 §2 选协议；**合成器时钟泵不到**——把 JS 侧的时间冻到 0，transition 照样按墙钟插值，你既停不住它也拨不动它。
3. **泵不到的熵源上冻结是净损失**：确定性没买到（运动照跑），盲区照付全额（§2.10——挂在被冻分支上的一切子系统对门隐身）。此时改用非冻结手段，四选一：
   - **状态化**：把两条分支当成两个**显式状态**，各跑一整套检查点（首访/回访、已保存/未保存）；
   - **断机制不断读数**：断言"源站自己的判据在这一帧已经成立"，墙钟只作**派生判定**入库（`gate-failure-modes.md` §1.11）；
   - **清存储 + 补状态抽查**：跨会话持久状态（`localStorage`）清掉，再对有像素后果的那几条各补一个种好值的状态；
   - **靠 settle 消化**：把**正在插值的计算值**写进页面状态签名，过渡在跑时签名就一直在变，settle 自然不会落在中途（`verification-gates.md` §2.2）。
4. **反向检查（可以直接免冻的两种）**：这条熵源的下游产物**没有消费者**（死码）或**不进像素、不写 DOM**——它根本不需要冻，在清单里写"明确不需要"并注明理由。

> **实证【objectarchive】**（`case-studies/determinism.md` §1.1）：九条熵源只冻了一条——**九条冻一条，不是纪律打折，是判据的结果。**

**别走岔的两个方向**：手上有 shim 就把所有源都打上（付了全额盲区、买到一半确定性）；或反过来，因为"泵不到"就宣布这条熵源没法处理（它有四条非冻结出路，全都要逐条登记进 §2.10 的那本账）。

## 2. 冻结协议：kimi 八种 + 第九种（能力探测钉死）

前八种是 kimi README 自评"本项目最值得带走的东西"；第九种由 shopifydesign 补上——它冻的既不是时间也不是随机数，而是"这台机器有多强"。**§2.10 不是第十种协议，是前九种共用的配套纪律**（冻结的盲区），每次动用任一协议都要一起执行。总表：

| 协议 | 钉住什么 | 用在哪 |
|---|---|---|
| `clock` | `performance.now → 0`（rAF 真实，入场动画播完） | 大多数静止位姿 |
| `clock+raf` | 再把 rAF 时间戳喂 0 | 跑马灯、轨道环、reduced-motion 判别 |
| `framebudget` | rAF 时间戳改发 `帧序号×16.67ms`，n 帧后停摆 | 过渡中间帧 |
| `__warp(t)` | 冻结时钟可拨动，damp/blend 一帧确定性收敛 | 轮盘 detail 态 |
| 种子化 `Math.random` | mulberry32(42) 双侧同流 | 头像洗牌、字符瀑布 |
| 媒体层补丁 | `play()` 假成功、`paused` 谎报 false | pixel-flow 视频 |
| 重光栅归一化 | display 抖动强制重绘，清合成层缓存 | 带 transform 过渡的标题层 |
| 同等隐藏 | 不可冻区域双侧同规则隐藏 | SwipeHint、LetterGlitch、星云 |
| 能力探测钉死【shopifydesign】 | GPU 微基准结果 / `canPlayType` / `deviceMemory`·`hardwareConcurrency` / `matchMedia` | 画质分级、编解码器分支、设备分支 |

逐条要点：

### 2.1 `clock`
钉 `performance.now → 0`，rAF 保持真实——入场动画正常播完后画面静止。静止位姿的默认协议。

### 2.2 `clock+raf`
在 `clock` 之上把 rAF 时间戳也喂 0。用于**rAF 时间戳直接驱动**的持续动画（跑马灯、轨道环）。注意有的渲染器需要**双冻**：rAF 时间戳驱动的累积器，单冻 clock 不够【kimi】。（实证：`case-studies/determinism.md` §2.2）

### 2.3 `framebudget`
rAF 时间戳改发 `帧序号×16.67ms`、n 帧后停摆——一切 rAF 消费者变成帧序号的纯函数。为"静止态门对过渡组件结构性失明"补的洞（M7.5 ASCII 瀑布事故）：使**过渡中间帧**（第 24 帧、u=0.5、字符带扫至半屏）也能字节比对【kimi】。

### 2.4 `__warp(t)`
冻结时钟但可拨动（如 `__warp(100000)`），让 damp/blend 类惰性追赶在一帧内确定性收敛。用于含阻尼收敛的终态画面（轮盘 detail 态）【kimi】。

### 2.5 种子化 `Math.random`
mulberry32(42) 替换 `Math.random`，双侧同流——随机序列相同则洗牌/瀑布结果逐字节同。只对"启动后拉固定次数随机"的消费者有效；随机消费次数本身不确定的场景仍属不可冻。

### 2.6 媒体层补丁
`play()` 假成功、`paused` 谎报 false——视频停在 seek 帧，同时防止站点的"卡死检测循环"发现视频没在播而进入异常分支（"自己失明"）【kimi】。seek 后必须重新驱帧再截图【noomo】。


⭐ **视频不走 JS 时钟，冻结页里它照播**【samsy】；且作品墙的 `<video>` 是 `document.createElement` 出来**不挂 DOM** 的，`querySelectorAll('video')` 找不到。做法：在 shim 之后 hook `Document.prototype.createElement` 记下每个 video；每次截图前 `pause()` + `currentTime = 0`、等齐 `seeked`（用 shim 暴露的 `__nativeSetTimeout` 兜底超时，页面的 `setTimeout` 已被泵接管）、再泵 2 帧让 VideoTexture 采到第 0 帧。（实证：`case-studies/determinism.md` §2.6）

⛔ **多人房间不是任一侧的属性，而 `Network.setBlockedURLs` 挡不住 WebSocket 握手**。对握手生效的是 DNS 层：Chrome 启动旗标 `--host-resolver-rules=MAP <host> 127.0.0.1`，两侧同加，登记为仪器条件（§2.8 同等隐藏）。

⭐ **活世界的带宽来自它自己的骰子，reseed 是归类实验不是调参**【samsy】：NPC 随机游走、粒子 spawn、CRT 屏的随机内容全走 `Math.random`——shim 把它定种了，但两侧在到达同一状态前消耗的次数不同（three 双拷贝 / vendored 库各消耗一串），于是跨侧残差成片。在每个视图截图前两侧同时 `__reseed(n)`，残差归零证明它们是**骰子相位**不是移植差异；而同侧自比带宽照旧（活世界的骰子在截图前已经掷过了），门的容差就是这个带宽 + 常数，不许因为看见了残差再去动。
### 2.7 重光栅归一化
display 抖动强制重绘，清掉合成层缓存的历史次像素光栅——带 transform 过渡的层会在合成器里留下与过渡路径相关的光栅残迹，导致同终态不同字节【kimi】。

### 2.8 同等隐藏
本性不可冻的区域**双侧同规则隐藏**，使整页门可以 byte-equal；被隐藏的部分**必须另建专门门覆盖**（kimi 的星云有自己的画布字节门），否则就是给自己挖 `gate-failure-modes.md` §1.3 的覆盖空洞【kimi】。

### 2.9 能力探测钉死【shopifydesign】

**这是第四类熵源：它不在时钟里，也不在随机数里，在能力探测里。** 站点问一句"这台机器有多强 / 支持什么"，答案随机器、甚至随同机两次运行而变，而这个答案会一路流进渲染参数、资源选择，乃至 **shader 源码字节**。上面八种协议一条也覆盖不到它。

微基准是活体计时，**同一台机器两次运行都可能翻档**。两侧不锁同一档，比的不是同一个程序——这比 `performance.now()` 严重得多。（实证：`case-studies/determinism.md` §2.9）

**必查清单**（在应用区间 grep，连阈值常量一起抄进笔记）：

| 探测 | 典型形态 | 后果 |
|---|---|---|
| GPU 微基准 / `WEBGL_debug_renderer_info` GPU 名匹配 | 计时绘制返回 ms/draw；GPU 名黑名单正则（intel hd/uhd/iris、mali、adreno、swiftshader） | 画质档 → shader 源码、渲染分辨率、几何数量 |
| `canPlayType` / `MediaSource.isTypeSupported` | `canPlayType('video/mp4; codecs="hvc1"')` 决定走 mp4 还是 webm | 两侧加载**不同的资源文件**，像素门必红且归因困难 |
| `deviceMemory` / `hardwareConcurrency` / `maxTouchPoints` | `hardwareConcurrency<=2 → low`；`maxTouchPoints>1 && innerWidth<1024 → 移动分支` | 画质档；桌面/移动分支决定整块场景存在与否 |
| `matchMedia` | `(hover:hover) and (pointer:fine)`、`prefers-reduced-motion` | 交互分支、动画是否播放 |

⚠ **第三行那个 `innerWidth` 还有一条与"能力"无关的陷阱：它在 document-start 恒为 980**（`<meta viewport>` 还没解析），真实宽度异步落地。**同步读一次 `innerWidth` 就定分支的代码会永久停在桌面态**，而 `screen.*` 全程正确、事后再读也正确——识别信号、取证手段（document-start 探针）与三种补救的实测对比见 `environment-traps.md` §8【objectarchive】。**这两件事要分开做**：宽度对了不等于能力分支对了（`setDeviceMetricsOverride({mobile:true})` 不动 `hover`）。

**做法**：

1. **对拍前把探测点全部枚举出来**，别等门红了再找——它伪装成"复刻侧画质不对"，实际是两侧程序不同。
2. **两侧同一位置强制同一结果**：让 shim 直接返回钉死值（本例 `?__probe` 时强制 `high` 档），**不要去改站点的判级逻辑**；正常运行保持源站原逻辑不动（宪法第 3、4 条）。
3. **强制值登记为偏差**，注明"仅对拍时生效的仪器类偏差"，并写上重新考虑条件：**若要验收分级逻辑本身，需另建"三档各跑一次"的门**——钉死一档会让另外两档的代码路径完全无门覆盖。
4. **探测的失败路径也要看**：本例微基准 `catch` 返回 `999`（必判 low）且无告警——只要一侧抛错，两侧就静默分道扬镳。
5. **⚠ 你自己的无头旗标就是探测输入。** `--use-gl=swiftshader` / `--enable-unsafe-swiftshader` / `--disable-gpu` 会改变 `UNMASKED_RENDERER_WEBGL` 的返回值与微基准耗时，**直接命中上表第一行的 GPU 名黑名单**（那条正则里就写着 `swiftshader`）。
   > **纪律**：无头旗标与画质档**必须钉死在一起登记**——旗标写进偏差表的同一行，注明"该旗标下两侧实测档位 = X"。**任何一次改旗标都要重跑一次档位断言**（门脚本里直接断言 `quality.tier`，不要靠记忆）。适用边界与"仍然值得用 SwiftShader"的判据见 §5。（实证：`case-studies/determinism.md` §2.9）

### 2.9.1 ⭐⭐ 泵的**时机**：冻结页仍在真实时间里启动【lusion】

**冻结不改变资产什么时候到达。** XHR、解码、字体加载走的是墙钟；页面能观测到的**每一个时钟**只在被泵时前进。于是有一个很容易踩、且症状极具欺骗性的写法：

```
navigate → settle(N 秒) → __pump(dt, frames) → 截图        ⛔ 错
```

引擎在 settle 期间拿不到任何一帧（时间没动），等泵开始时资产早已到达但**启动序需要的是"资产到达那一帧"**——它永远等不到。

**正确写法是把泵摊进 settle 窗口，与真实时间交错**：

```
navigate → [ __pump(dt, chunk) → 真实等待 gap ] × N → 截图   ✅
```

（实证【lusion】：`case-studies/determinism.md` §2.9.1）

⭐ **判据**：泵完之后先问一句「**这一帧上有东西吗**」。像素门已内置非空帧前置条件（`gate-failure-modes.md` §1.8），但更早的信号是**引擎自己的产物**——canvas 尺寸、实例数、场景对象数：**默认尺寸的 canvas 意味着 init 没跑**，而那比任何像素数字都早、都便宜。

### 2.10 ⚠ 冻结的盲区：被冻分支上的子系统对门隐身【shopifydesign】

**这不是第十种协议，是前九种的配套纪律。** 冻结换来的是可复现，付出的是覆盖面：

> **冻掉的那条分支上挂着的一切子系统，都从验收门的视野里消失了——而且是以"通过"的形式消失。冻得越狠，盲区越大。**

**⚠ 这句话不是"先全冻、再补盲区"**：动用任一协议之前先过 §1.1——**泵不到的熵源（合成器 / CSS transition 驱动）上冻结是净损失**，确定性没买到而盲区照付，正确答案是这一条不冻、改走非冻结手段【objectarchive】。本节管的是**决定要冻之后**怎么把账付清。

机理：双侧对拍是**差分门**，只看得见**不对称**的差异。冻结造成的缺席是**对称**的——两侧都不执行，逐字段 diff 恒为 0、逐字节哈希恒相等，门稳定地、对称地错着。

（实证【shopifydesign】：`case-studies/determinism.md` §2.10）

**操作要求（冻结前做，不是事后补）**：

1. **列出所有挂在被冻熵源上的入口，并把粒度追到产物。** 对每个要冻的源（rAF / timer / clock / random / visibility）做两跳 grep + 一跳粒度追问：
   - 第一跳：在**应用区间**内 grep 该源的调用点（`requestAnimationFrame(`、`setTimeout(`、`setInterval(`…）；
   - 第二跳：在每个调用点的函数体里找**向外发出的信号**——`dispatchEvent` / `new CustomEvent` / promise `resolve(` / 回调调用 / 就绪标志翻转（`xxxReady = true`）；
   - 反向再 grep 一次这些信号的消费者（`addEventListener("<名>"`、`.then(`、读该标志的地方），得到的清单就是**这个源的下游入口**。
   - **第三跳（粒度）：对每个入口再问一句"它的产物是什么形态，写进 DOM 了吗？"** 只枚举到"入口"粒度会漏掉整块子系统——⚠ **这是本纪律第一次实战时暴露的粒度错误**：
     > 实证：`case-studies/determinism.md` §2.10。
   - **一句话判据：产物写不写 DOM？不写 → 数值门天然看不见 → 必须有不冻结的绝对断言。** 属于"不写 DOM"的常见产物：WebGL/WebGPU 场景图对象、Canvas 2D 像素、Web Audio 图、worker 内状态、只存在于 JS 内存里的模型/缓存。
   - **枚举产物写成表**：清单每行 = 入口 → **产物类别** → **哪道门看得见它**。答案是"没有"的那一行，就是本轮必须新建绝对断言的地方；**一旦开始铺 WebGL 内容，就默认每落地一个子系统加一节断言，没有例外**。
2. **逐个入口做处置决定，二选一**（不允许留"没想到"的）：
   - **在探针里泵到该事件**——首选。泵够帧数或主动派发，让被冻侧仍然走到那条分支，覆盖面不缩；
   - **补一条不冻结的结构性抽查**——不冻结加载一次，对该子系统的产物做**绝对断言**（本例：`.wr` span 数 == 18 且 innerHTML 与镜像逐字相同），而不是双侧 diff。**对称缺席只有绝对断言（或像素/人眼）看得见。**

   **⚠ 绝对断言的必填项是"期望值的出处"，不是断言本身。** 最容易写坏的一步：从复刻侧读一次然后钉死——那门就变成"复刻等于它自己"，永远绿，等于没测。三条纪律【shopifydesign】：
   - **(1) 期望值从"镜像基线 + 源站自己的计数规则"推导，绝不从被测方读。** **"第一次跑出来就对"才是移植正确的证据；抄来的数跑出来必然对，什么也证明不了。**（实证：`case-studies/determinism.md` §2.10）
   - **(2) 推导过程写进脚本，每一步带源行号。** 期望值不是常量表，是 `expectations(baseline)` 函数（入参就是镜像基线 JSON），换视口、换镜像版本它自己跟着变；每条断言的注释里写清依据的源行号。
   - **(3) 同一个脚本要能在源站/镜像侧跑，哪怕只跑得动一半。** 源站通常没有调试句柄（本例只有 `window.__threeCtx` L43173），镜像侧就只验事件与 DOM 那一半（`sdf-ready` 派发过、`span.wr == 18`）。**这一半仍然必须跑**：它证明这套期望描述的是**源站可达的真实状态**，而不是复刻侧特有的形状。
   - 归档要求：每条绝对断言在清单里都要有"期望值来源"一栏（镜像基线文件名 + 源站行号），**空着的一律视为自比，不算门**。
3. **清单入库**：被冻源 → 下游入口 → **产物类别（写不写 DOM）→ 哪道门看得见它** → 处置（泵到 / 不冻结抽查 / 明确不需要）逐条写进本站熵源清单（§10），与 shim 覆盖面验收记录同一本账。**冻结项每加一条，就得补一条处置**——这是"冻得越狠盲区越大"的收费口。
4. **推论：不冻结的对拍不可省。** 数值门与像素门不是替代关系，数值门原理上看不见被冻住的分支；每个里程碑至少保留一条不冻结的截图对拍或结构性抽查（见 `references/verification-gates.md` §1.4.1、`gate-failure-modes.md` §1.7）。

**新子系统落地时复查**：移植进来的子系统若挂在 `site-ready` / rAF / 定时器之后，它一进来就落在盲区里——建门时先回到本节第 1 步重新枚举，别假设上一轮的入口清单还是全的。**是"每落地一个子系统重做一次枚举"，不是"复用上一轮的清单"**：上一轮的清单是按上一轮的产物形态写的，新子系统的产物可能根本不写 DOM（实证见第 1 步第三跳）【shopifydesign】。

## 3. probe-shim 双侧确定性驱动【noomo】

**适用条件**：滚动驱动的 WebGL/动画站 + **源站是别人的混淆 bundle、不可插桩**。问题：浏览器后台标签 rAF/timer 节流使这类站不可确定性驱动，而你不能改源站代码。

**机制**（对应本 skill `scripts/probe-shim.js`，约 90 行，仅在 URL 带 `?__probe` 时激活）：

1. 把 rAF 换成手动泵 `__pump(dt, frames)`——测试脚本主动喂帧，页面不再依赖浏览器调度。**⚠ 泵是有覆盖面的**：凡是从 rAF 里派发的东西（事件、promise resolve、就绪标志），探针不泵到那一帧就永远不发生，且两侧对称不发生（§2.10）；
2. `document.hidden` / `visibilityState` / `hasFocus` 钉死为可见——绕开一切可见性门控；
3. `setTimeout` 接管进泵驱定时队列——定时器随泵推进而非墙钟；
4. 时间戳从 0 起——使双侧 `Tick.seconds` 驱动的 shader 相位可对齐。

**⚠ 这四项是 noomo 那个站的熵源清单，不是通用清单**【shopifydesign】（实证：`case-studies/determinism.md` §3）：

> **硬规则：不要套用固定的一套冻结项。** 冻结前先按 §1 步骤 1 grep 出**本站应用区间**的熵源清单，再拿这份清单逐项验收 shim 的覆盖面：清单上有而 shim 没冻的，要么补进 shim，要么写明为什么不需要冻。清单上没有的，冻了也只是心理安慰。`scripts/probe-shim.js` 现已扩展到接管 `performance.now` / `Date.now` / `new Date()` / `Math.random`（mulberry32 定种）/ `setInterval`——这是更好的**起点**，不是验收标准。
>
> **同一份清单还要走第二遍**：对每个确定要冻的项，按 §2.10 列出它下游的入口并逐个处置。**覆盖面验收要验两件事：冻得够不够，以及冻掉之后谁看不见了。**

**双侧同位注入**（关键在"同位"）：**注入点有两条路线，先按下表判，再照选中那条的做法执行。**

| 注入路线 | 什么情况下用 | 前提与代价 |
|---|---|---|
| **服务层按 query 注入**（`?__probe`，noomo 原始做法） | ① 两侧是**各自独立的服务器**（镜像侧 `serve.mjs` + 复刻侧框架 SSR/dev）；② 需要"不带开关时**产物字节一字不变**"这条可验证性质（字节门/SSR 门要终身全绿） | 两侧各写一处注入点，"同位"靠人对齐并复验；**URL 上多一个 query 参数**——服务端的 url→路径映射必须对它无感 |
| **CDP `Page.addScriptToEvaluateOnNewDocument`** | ① **两侧共用同一个服务器 / 同一份驱动脚本**；② 服务层的 url→路径映射是**查询感知**的（`x.jpg?width=600` 与 `?width=320` 是两份不同字节）；③ 需要**严格同位**（同一份字节、在任何页面脚本之前） | 只在门跑的时候存在，**磁盘与响应字节都没动**，字节门天然不受污染；代价是仪器绑在 CDP 驱动上，人工打开页面复现不出门里的状态 |

（实证【objectarchive】：`case-studies/determinism.md` §3）

- **一句话判据**：先问"两侧是不是同一个服务器 / URL 映射认不认 query"。**是同一个服务器、或映射查询感知 → CDP 注入**；**两侧各自独立、且要求产物字节门不受污染 → 服务层 query 注入**。
- **教训**："gsap 在模块求值期捕获 rAF，Nuxt 插件太晚，必须 head 首脚本"【noomo】——shim 必须先于一切消费者求值。这条对两条路线同样成立：服务层注入要落在 `<head>` **首部**，CDP 注入要用 `addScriptToEvaluateOnNewDocument`（不是 `Runtime.evaluate`，那已经晚了）。
- 服务层路线：镜像侧由 `scripts/serve.mjs` 按 query 注入、磁盘镜像文件保持字节纯净；复刻侧由框架 hook 在同一位置注入（noomo 用 Nitro `render:html` 钩子 `html.head.unshift`）。
- **两条路线共同的硬要求**：不跑门时两侧输出**字节不变**（SSR/字节门不受污染），且**注入方式本身登记进偏差表**——登记里要写清用的是哪条路线、为什么（选 CDP 就写明"两侧同服务器 / 映射查询感知"这个理由）【noomo】【objectarchive】。

**驱动方法论**（M7a 日志）：

- `__drive` 用真时钟配速泵帧 + **MessageChannel yield**（不受节流的宏任务边界，让页面内 await 链能推进）；
- 用户激活门控的状态（`experienceStarted`）需要 **isTrusted 真实点击**，合成事件不算；
- `smoother.scrollTo(y, false)` **反复钉扎**消滚动动量残留；
- seek 后重新驱帧再截图【noomo】。

（结果与同类做法【noomo】【rogier】：`case-studies/determinism.md` §3）

## 4. 防呆断言（冻结/驱动是否真的生效）

冻结协议最大的敌人是"没生效但门照样绿"：

1. **同会话位姿哈希必须互异**：不同位姿的截图哈希相同 = 驱动步骤没生效（kimi M5.3：eclipse 位姿截的还是 hero，门全绿）【kimi】。
2. **jump 后补发同位跳转唤醒事件**：源站 jump-immediate 会让事件门控内容休眠，需补发唤醒事件，否则截到的是休眠态【kimi】。
3. **自拍两次先验证单侧确定性**：同侧同协议连续两次哈希不等 → 熵源没枚举完，回 §1 补。
4. **资产预检**：先确认镜像服务能出图再截图，否则截图误导归因【rogier】。
5. **状态到达要有独立证据**：等语义条件（IDLE、`hasStarted`）而不是裸 sleep【samsy】【oryzo】。**"等够了"本身也要有判据**：连续 N 次采样的页面状态签名不变才算 settle；没 settle 就非零退出、绝不落盘；settle 指纹写进产物，两侧指纹不同时判**"不可比、重采"**而不是判红或判绿（`verification-gates.md` §2.2）【shopifydesign】。

## 5. 无头驱动的通用旗标与手段清单

搭无头对拍环境时逐项过：

- **anti-throttling 旗标必带**：`--disable-background-timer-throttling --disable-renderer-backgrounding`——后台标签 rAF 节流 + gsap `lagSmoothing` 会把启动链冻成假死。（实证【samsy】【oryzo】【noomo】：`case-studies/determinism.md` §5）
- **SwiftShader**：`--use-gl=swiftshader` 保证 WebGL 无头渲染可复现【rogier】——**这条建议在没有 GPU 分级的站上仍然成立，但不是默认项**。⚠ 它同时是 §2.9 的能力探测熵源与 `environment-traps.md` §7 的快门瓶颈，**加它之前先按下表判**【shopifydesign】：

  | 先 grep 应用区间 | 结论 |
  |---|---|
  | `WEBGL_debug_renderer_info` / GPU 名黑名单正则 / 计时型微基准 / `deviceMemory` / `hardwareConcurrency` **全部无命中** | 站点不分级 → **SwiftShader 可用**，rogier 的原建议直接适用（仍受下面第 3 条快门约束） |
  | 命中任意一项 | 站点分级 → SwiftShader 会把被测程序切到 low 档（shader 源码不同）→ **优先用真 GPU 跑无头**；确实只有软件渲染可用时，按下面三件事配套 |

  **一旦用了（含 CI 机器天然只有 SwiftShader 的情形），必须同时做三件事**：
  1. **按 §2.9 钉死能力探测结果**，并在门脚本里直接断言实测档位（如 `quality.tier`），不能默认 `high`；
  2. **旗标与档位钉死在偏差表的同一行**登记（"该旗标下两侧实测档位 = X"），改旗标即重跑档位断言；
  3. **若这道门要按状态对齐抓帧**，先量"单次截图耗时 / 被测运动全长"（`environment-traps.md` §7）：软件渲染下 1728×1080 单次 `captureScreenshot` 实测 1–2s，2000ms 的入场动画根本采不到相位——不达标就换真 GPU，或改突发采样 + 取最近帧。

  **CI 提醒**：无 GPU 的 CI 上会自然退回 SwiftShader → tier low。**两侧同档，对拍仍然成立**，但报告里必须写明档位，且不能与本机 high 档的基准混着比【shopifydesign】。
- **localStorage 预种**：`Page.addScriptToEvaluateOnNewDocument` 预种教程完成态等前置状态，跳过引导流程；配页内 gsap ticker 泵【samsy】。
- **query 开关跳过阻塞流程**：复刻侧 `?skip-preloader`；源站侧没有开关就模拟真实点击过 preloader（rogier 的对拍脚本对 original 模拟点击 Enter）【rogier】。
- **真实 DOM 点击驱动状态**：samsy 按 `#topmenu` 索引点击驱动三视图——菜单文字被 glitch 轮换、文本匹配不可用；真实点击同时绕过 router 探针问题【samsy】。
- **视口/窗口锁定**：量化对拍必须同视口；文字块随窗口高度命中相邻组，"复检需锁窗口"【noomo】。
- **双侧同参数启动**：复刻与镜像两个服务器同时起、无头参数一致、驱动脚本同一份【samsy】【kimi】。镜像参照服即 `scripts/serve.mjs`（终身兼任对拍基准端，如 `PORT=3200 SERVE_ROOT=mirror`）【noomo】。
- **hover 类位姿用 CDP 真实鼠标**（Input 域射线），不用 CSS 类模拟【kimi】。

## 6. ⛔ 像素门两侧必须同经 serve.mjs【darkroom】

`serve.mjs` 只对**自己伺服**的 HTML 注入 probe-shim(`?__probe` 冻结时钟)。重建侧若直接跑
`next start`,它那一侧不冻结——镜像帧 BLANK、重建帧有画,自比带宽不可比,跨侧差异全是
"冻结不对称"制造的。解法:`tools/assemble-static.mjs` 把 `next build` 的 `.next/server/app/**.html`
摊成 `<route>/index.html`、`_next/static` 与 `public/*` 软链进去,用 `serve --side rebuild`
伺服——两侧同一份 shim、同一个 t。（实证：`case-studies/determinism.md` §6）
⚠ 只供对拍;`?_rsc=` 软导航载荷不在静态树,sweep 仍跑 `next start` 拓扑。

## 7. ⭐ 状态对齐协议：先对齐状态，再等时推进（`--ready` + `--after-ready N` + `--chunk N`）【darkroom】

等"绝对泵数"（两侧都泵到第 240 帧）与等"状态相对时间"（两侧各自 READY 之后再泵 N 帧）差一个
**挂载相位**：它周期性出现，这是相位噪声不是移植缺口。
⛔ 而对齐的**分辨率 = 泵分块帧数**（默认 total/40 ≈ 6 帧）：8–16 帧的相位差整个落在一个分块里，
钉不到同一帧。协议：`--ready <表达式>` 定义状态、`--chunk 1` 把分辨率提到 1 帧、`--after-ready N`
在两侧 READY 为真的那一帧之后各泵 N 帧再截图。⚠ `--self` 自比带宽要在同一协议下重建。（实证：`case-studies/determinism.md` §7）

### 7.1 ⛔ 状态分两种：泵到的，和等到的——各自的协议不同【raycastkbd】

§7 的 `--ready` + `--after-ready` 对齐的是**由泵抵达**的状态（挂载相位，虚拟时间里的事件）。
另一种状态**由真实时间抵达**：GLB 在 worker 里解码、纹理到达、字体解析——泵再多帧也快不了它。
raycastkbd 的 25% 检查点两边都撞过：

| 协议 | 自比带宽（walk-025） | 发生了什么 |
|---|---|---|
| 绝对泵 120 帧（无对齐） | 0 / **2.91** 各约 2/3、1/3 | 一帧场景到了、一帧没到——到达是真实时间事件 |
| `--ready 到达 --after-ready 120`（状态相对） | **恒 1.7** | 两侧 READY 时的绝对泵数不同 → 轴体爆炸动画（虚拟时钟驱动）相位不同：一帧展开、一帧合拢 |
| `--hold 到达`（泵前）| 60s 超时 5/5 | 请求本身要从泵的世界里发出（IO 记录、滚动驱动到该节）——钟钉在 0 时页面根本没开口要 |
| `--hold 到达 --hold-after 30 --hold-grace 500` | **2.91** | 到达 ≠ 解码完成：worker 解码与挂载在 500ms 里没做完 |
| `--hold 到达 --hold-after 30 --hold-grace 1500` + 绝对泵 120 | **0.01** | 先泵 30 帧让页面发出请求，真实时间等到达 + 1.5s，再两侧同样绝对泵完 |

规则：**到达用 `--hold`（真实时间，`--hold-after N` 让页面先开口要），相位用 `--ready/--after-ready`（虚拟时间，泵之中）**；
一个页面可能两者都要。⛔ **hold 的谓词要按名点名**：`≥5 条匹配 glb|hdr|wasm 的资源条目` 在 switch.glb 还没被请求时就被别的条目凑满了，复刻侧 1/3 概率拍到空轴体（2.91）；改成五个文件名逐一 `some(includes)` 后逐次 0.01。`--hold-grace` 是对"解码完成没有页面可见信号"的让步——它是 §2.2
"settle 必须是页面状态"的一条登记偏差，写进 §6，不许藏在默认值里。

## 8. 常见坑

1. **把环境问题当代码 bug 修**：后台节流假死、探针时钟与页面时钟错位（伪装成"计时器时间压缩"）、vite HMR `?t=` 幽灵模块让探针读到假状态——**判定时序 bug 前先校准探针**【samsy】；环境陷阱全表见 `references/environment-traps.md`。
2. **shim 注入晚于消费者**：gsap 等库在模块求值期捕获 rAF——shim 必须是 head 首脚本，框架插件时机都太晚【noomo】。
3. **录制巧合进规格**：冻结环境下录的基准值可能编码了加载时序巧合（"首帧 anchor == 585px"），断言机制而非环境量【kimi】——详见 `references/gate-failure-modes.md` §1.4。
4. **诊断解码器的正确性**：门只要求"确定性 + 双侧同函数"，但诊断要求绝对正确；PNG 解码 colorType 事故（Chrome 截图是三通道而代码硬编码 `*4` 索引）画出几何假象【kimi】。用 `scripts/lib/png.mjs`（对 Pillow 逐格验证过，恒输出 RGBA）。
5. **WebGL 读回**：`readRenderTargetPixels` 前必查 `gl.getError`（全零缓冲是读回假象）【noomo】；无 `preserveDrawingBuffer` 不能 `drawImage` 读 canvas【kimi】。
6. **CDP 工程坑**：调用带超时、多兆 payload 分块取回、headless Chrome 无视 SIGTERM 要 SIGKILL【kimi】。
7. **探针等待时长是环境量**：真 GPU tier 3 机器需要 `PROBE_WAIT=25000/45000`，超时先判 "probe timing, not a product mismatch" 再查代码【rogier】。
8. **改动加载架构后要复验位姿哈希不变**：任何"应当不影响画面"的改动都用"位姿哈希不变"关账（kimi M7.1 动态加载改造后桌面 8 位姿哈希不变）【kimi】。
9. **无 `?__probe` 时必须字节无痕**：验证仪器不得污染被测输出（SSR 门保持全绿），且仪器本身登记进偏差表【noomo】【rogier】。

## 9. 上门前快速自检

对拍门接入 CI 前逐项确认：

- [ ] 该画面的熵源清单已从 `_pretty/` 取证列出（不是凭印象），**含能力探测点**
- [ ] **每条熵源都回答过"它的运动由谁驱动"**：合成器 / CSS transition 驱动的**没有**被泵冻，而是走了状态化 / 断机制 / 清存储 / settle 四条出路之一，逐条登记（§1.1）【objectarchive】
- [ ] shim 覆盖面已**逐项对照该清单验收**，未冻项写明理由（不是套用出厂那套冻结项）【shopifydesign】
- [ ] **每个被冻源的下游入口已枚举**（从它里面派发的事件 / resolve 的 promise / 就绪标志及其消费者），每条入口有处置：探针泵到 / 不冻结结构性抽查 / 明确不需要（§2.10）【shopifydesign】
- [ ] 枚举**到产物类别粒度**，每类都回答了"哪道门看得见它"；**产物不写 DOM 的（WebGL 场景图 / canvas / worker 内状态）已建绝对断言**（§2.10 第 1 步第三跳）【shopifydesign】
- [ ] 本里程碑保留了**至少一条不冻结的对拍**（截图或 DOM 结构绝对断言）——它是唯一能抓"两侧对称缺席"的手段【shopifydesign】
- [ ] 每条绝对断言都写明了**期望值出处**（镜像基线 + 源站计数规则 + 行号），没有一条是从复刻侧读出来钉死的自比（§2.10 第 2 步）【shopifydesign】
- [ ] 能力探测（GPU 基准 / codec / 硬件参数 / matchMedia）在两侧被强制为同一结果，强制值已登记为偏差【shopifydesign】
- [ ] 每条位姿的 freeze 协议已显式声明在位姿表里
- [ ] **每次采样有 settle 判据**（页面状态签名 + 地板时长，不是固定 sleep），未 settle 的采样直接丢弃不落盘，产物里带 settle/可比性指纹（`verification-gates.md` §2.2）【shopifydesign】
- [ ] 单侧连续两次截图哈希相等（单侧确定性成立）
- [ ] 同会话不同位姿哈希互异（驱动确实生效）
- [ ] 同等隐藏剥离的区域已有专门门覆盖
- [ ] 无头旗标齐全：anti-throttling；SwiftShader **按 §5 的判据决定用不用**（站点有 GPU 分级时它会切档），用了则档位已断言并与旗标同行登记【shopifydesign】
- [ ] **注入点按 §3 的分支判据选定并登记**（两侧同服务器 / URL 映射查询感知 → CDP `addScriptToEvaluateOnNewDocument`；两侧独立服务器 + 要求产物字节门不受污染 → 服务层 `?__probe`）【objectarchive】
- [ ] shim/探针在无开关时对输出字节无痕，且已登记进偏差表
- [ ] 不可冻场景已明确降级为量化门并写入噪声归类清单

## 10. 产出物

- 位姿表：每条位姿 = 路由 + 视口 + 驱动步骤 + **显式 freeze 协议声明**【kimi】 + **settle 判据**（页面状态签名，不是 sleep 毫秒数）【shopifydesign】
- **本站熵源清单**（时钟 / 随机 / 定时器 / 媒体 / 能力探测点及其阈值常量）+ 逐项对照的 shim 覆盖面验收记录【shopifydesign】。**每条另记两栏：运动由谁驱动（引擎时钟 / 合成器）→ 处置（冻 / 状态化 / 断机制 / 清存储 / settle / 明确不需要）**，非冻结处置同样要写理由（§1.1）【objectarchive】
- **被冻源的下游入口清单**：被冻源 → 挂在其上的事件/promise/就绪标志 → 消费它的子系统（带源行号）→ **产物类别（写不写 DOM）** → **哪道门看得见它** → 处置（泵到 / 不冻结抽查 / 不需要），每次新增冻结项或新移植子系统落地时**重做枚举**（不是复用）【shopifydesign】
- **不冻结结构性抽查脚本**（如 `verify-scene-content.mjs`）：绝对断言逐条带**期望值出处**（镜像基线文件 + 源站计数规则行号），期望值以 `expectations(baseline)` 函数形式推导而非常量表，且脚本在镜像侧也能跑（哪怕只跑事件/DOM 那一半）【shopifydesign】
- `scripts/probe-shim.js` 的双侧注入配置，**含选用的注入路线与判据**（服务层 query：镜像侧 serve query + 复刻侧框架 hook；或 CDP `addScriptToEvaluateOnNewDocument`——两侧同服务器 / 映射查询感知时用它），登记进偏差表【noomo】【objectarchive】
- 能力探测钉死值（画质档、codec 分支等）连同"若要验收分级逻辑本身需另建三档门"的重新考虑条件，登记进偏差表【shopifydesign】
- 确定性自检记录：单侧两次哈希相等 + 同会话位姿哈希互异
- 无头启动参数清单（旗标、视口、预种脚本）写进门脚本，环境变量参数化
- 对拍产物成对入库（见 `references/verification-gates.md` §5）
