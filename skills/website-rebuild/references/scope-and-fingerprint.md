# 第 0 步：范围判定与指纹路由（⛔ 阻塞门）

> **何时加载本文件**：拿到目标 URL 后、执行任何镜像/逆向动作之前。本步骤是阻塞门——判级未落地前，禁止进入 M0。全部判据来自 43 站边界探测实测【probe】，其中三个已复刻站（landonorris/lusion/noomo）作为阳性锚点全部通过校验。

## 1. 判级体系与 v0.1 范围政策

| 判级 | 定义 | v0.1 政策（判出后立即执行） |
|---|---|---|
| **A** | 完全适用：与六个已完成项目同物种，管线（镜像→beautify 行号逆向→转写移植→确定性验收）①→④无断点 | **主场，直接做**。进入 SKILL.md 主流程 M0，加载 `references/mirroring.md` |
| **B** | 适用但缺分场景指南：管线成立，断点全部是"缺某份操作指南" | **可做**。若对应分场景指南已存在则加载；尚缺则明确提示用户"该场景指南待补（v0.2+ roadmap），可继续但对应环节需自行摸索"，列出缺口名称后再动工 |
| **C** | 逆向模式需改变：声明式框架/资产化动画使"转写式移植"失效，需"重构式逆向" | **明确拒绝**并解释："该站为声明式架构（RSC/编译后组件树），本 skill 的转写式方法论不适用；需要的是重构式逆向（从运行时输出反推组件结构再重写），是另一门手艺，v0.1 不支持" |
| **D** | 方法论失效：行为主体在服务端，客户端无可移植目标 | **拒绝**。这是永久边界，不是待补指南 |
| **X** | 原站已消失：断在第 0 步，无镜像对象 | **引导用户**：告知原站已消亡及消亡形态，给 archive.org（Wayback Machine）抢救路径，或建议换目标 |

判级的真正变量不是框架名、年代或站点类型，而是**签名行为（让这个站获奖的那些效果）住在哪里**【probe】：
- 住在**静态资产**里（minified/未混淆 bundle、GLSL、GLB、视频、Rive 文件）→ A/B；
- 住在**声明式组件树/时间轴数据**里（RSC flight 流、R3F+Theatre 的场景即组件树、动画即数据）→ C。注意"框架是 Vue/Nuxt/React Router"本身**不构成** C——框架名与引擎范式是两个维度，见 §3/§4 二维表【shopifydesign】；
- 住在**服务端函数**里（WordPress、电商库存、A/B 分桶、个性化）→ D。

## 2. 指纹探测流程（六步，curl-only 可执行）

准备：统一 UA、请求间隔 ≥1s、产物落 `probe/` 目录留证。

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
TARGET='https://example.com/awarded-path'   # 必须是获奖/目标路径本身，不是只探根域
mkdir -p probe
```

> **无 POSIX 工具链时**（如 Windows PowerShell 缺 curl/cmp/fold/tr/perl；PowerShell 里 `curl` 是 `Invoke-WebRequest` 别名且默认跟随重定向，恰好抹掉 §3 的 X 信号）：用 [`scripts/fingerprint.mjs`](../scripts/fingerprint.mjs) 一条命令等价执行本节六步——`node <skill>/scripts/fingerprint.mjs --target "<TARGET>" [--bundle <bundle-url>]`。产物同样落 `probe/`（a.html / b.html / bundle-*.js / fingerprint-report.md），计数为出现次数语义（符合下文《计数硬约束》第 1 条），下载物逐个记 sha256。它**只采证据不出判级**——§3 判定树、§4 三判据与 §6 的解读仍须人工执行。

### 步骤 1：存活性（GET，路径粒度）

```bash
curl -sL -A "$UA" -o probe/a.html \
  -w 'code=%{http_code} final=%{url_effective} redirects=%{num_redirects} time=%{time_total}s\n' "$TARGET"
```

- **必须 GET，禁止用 HEAD（`curl -sIL`）作唯一判据**：API Gateway/CloudFront 前端对 HEAD 返回假 404【probe】。
- **路径粒度**：根域 200 不等于作品存活——根站活、获奖路径 404 是常见形态【probe】。
- **最终 URL 同一性校验**：`final` 落点域 ≠ 目标域即 X 信号【probe】。`curl -sIL` 表面 200 会掩盖 301 退役信号。

（三条的实证出处：`case-studies/scope-and-fingerprint.md` §2 步骤 1）

### 步骤 2：双抓 diff（确定性）

```bash
sleep 5
curl -sL -A "$UA" -o probe/b.html "$TARGET"
cmp -s probe/a.html probe/b.html && echo BYTE-IDENTICAL || { wc -c probe/a.html probe/b.html; diff <(fold -w 80 probe/a.html) <(fold -w 80 probe/b.html) | head -40; }
```

三分类，直接影响判级与后续验收门设计：
- **byte-identical**：理想镜像对象（SSR 输出连注水负载都可逐字节一致）【probe】。
- **token 级差异**：仅 nonce/随机装饰串（含 WAF/CDN 每次注入的轮换 token）→ 仍可镜像，验收门加掩码规则，**不要误判为动态渲染判 D**【probe】。
- **内容级差异**：文案/结构/数据随请求变（A/B 分桶、个性化注水）→ D 信号【probe】。

（三类的实证出处：`case-studies/scope-and-fingerprint.md` §2 步骤 2）

### 步骤 3：物种/年代校验（防"隐性下线"）

200 且确定 ≠ 是那个作品。**HTTP 200 的尸体**是五种消亡形态里最隐蔽的一种：

```bash
grep -io '<meta name="generator"[^>]*>' probe/a.html          # 平台/主题指纹
grep -c 'wp-content' probe/a.html                              # WordPress 密度
grep -oE '(Copyright|©)[^<]{0,80}(19|20)[0-9]{2}' probe/a.html | head   # license/版权年份
grep -ciE 'shopify|Prestige|Dawn|elementor' probe/a.html       # 商店主题替身
```

- **技术栈年代与获奖年份矛盾** → X（根站已是当代重建版）【probe】。
- **generator/依赖 license 年份晚于获奖期 + 获奖期技术栈残留 grep 为零** → 隐性下线判 X【probe】。
- 域名活 ≠ 作品活：获奖原版可能被重建版**原地偷换**（域名不变）——如需复刻"获奖那一版"，须提示用户走 Wayback【probe】。

（三条的实证出处：`case-studies/scope-and-fingerprint.md` §2 步骤 3）

### 步骤 4：技术指纹（HTML 层）

```bash
# script 枚举必须先剥 HTML 注释（注释内脚本会污染清单）
perl -0777 -pe 's/<!--.*?-->//gs' probe/a.html | grep -oE '<script[^>]*src="[^"]*"' | sort -u
# 现代站可能没有任何 <script src>（Shopify Editions 三代全靠内联 import()）——再搜内联动态导入
grep -oE 'import\("[^"]+"\)' probe/a.html | sort -u
# 维度① 框架模式（框架下不下发行为源）——这些标记单独命中一律不判级，见 §3/§4
grep -o 'self.__next_f'          probe/a.html | wc -l   # Next App Router RSC flight → 不下发组件源
grep -o '__reactRouterContext'   probe/a.html | wc -l   # React Router framework 模式 → 下发 route module
grep -o '__NUXT__'               probe/a.html | wc -l   # Nuxt → 下发组件源
grep -o 'data-v-[0-9a-f]\{6,8\}' probe/a.html | wc -l   # Vue scoped 密度
grep -o '<!--\[-->'              probe/a.html | wc -l   # Vue3 SSR fragment 注释
# 维度② 引擎范式（签名行为怎么写的）
grep -oiE 'theatre|@react-three' probe/a.html | wc -l   # R3F / Theatre.js → 声明式引擎 → C
```

> 出现次数一律 `grep -o … | wc -l`，**不用 `grep -c`**（数的是匹配行数，不是出现次数）——理由与实测见本节末《计数硬约束》【shopifydesign】。

### 步骤 5：bundle 可逆向性

```bash
BUNDLE='https://example.com/assets/main.xxxx.js'
curl -s -A "$UA" -o probe/bundle.js -w 'size=%{size_download}\n' "$BUNDLE"
# 响应 <1KB → 极可能是缺 Referer 的拒绝页（landonorris 返回 32 字节拒绝页造成假阴性），补齐 Referer 重试
[ "$(wc -c < probe/bundle.js)" -lt 1024 ] && curl -s -A "$UA" -e "${TARGET%/*}/" -o probe/bundle.js "$BUNDLE"
# minification 形态预检（未混淆产物可跳过 beautify，省一道工）
wc -lc probe/bundle.js
awk '{ if (length($0)>m) m=length($0) } END { print "longest_line=" m }' probe/bundle.js
grep -c 'sourceMappingURL' probe/bundle.js
# MB 级单行文件先注入换行再 grep，防有界量词正则卡死（tr 只替换分隔符，不改变 token 出现次数）
tr ';{}' '\n' < probe/bundle.js > probe/bundle.lines
grep -o 'WebGLRenderer'       probe/bundle.lines | wc -l  # three 认强签名（WebGLRenderer/REVISION），不认弱字符串 "three"
grep -o 'THREE.WebGLRenderer' probe/bundle.lines | wc -l  # 其中属 three 自带报错串的份额 = vendor 污染量
grep -o '/api/'               probe/bundle.lines | wc -l  # >0 ⇒ 镜像阶段强制做运行时 API 快照（B 信号）
```

- 有公开 sourcemap（`sourcesContent` 完整）→ 直取源码替代 beautify 流程，但 RSC 站仍按 C 处理（sourcemap 不改变行为归属）【probe】。
- 未混淆产物（esbuild 标识符全保留一类）→ 跳过 js-beautify，行号坐标系直接建在原文件上【probe】。

（两条的实证出处：`case-studies/scope-and-fingerprint.md` §2 步骤 5）

### ⛔ 计数硬约束（贯穿步骤 4/5；任何进难度评级表的数字必须先过这三条）【shopifydesign】

用 `tr ';{}' '\n' | grep -c` 数 token 会一次产出多个假数字，且**直接进了难度评级表**——整条星级可能建立在一个根本没被使用的库上（实证：`case-studies/scope-and-fingerprint.md` §2《计数硬约束》）。

1. **`grep -c` 数的是"匹配行数"，不是"出现次数"。** 同一行命中 5 次只记 1。**协议里凡是要"出现次数"的地方一律 `grep -o PATTERN FILE | wc -l`**；`grep -c` 只可用于回答"有没有"这种是非题。
2. **vendor 库自带字符串会污染计数**（three.js 自己的 `"THREE.WebGLRenderer: …"` 报错串、内置 shader chunk 库都会被计进来）。**任何要进评级表的数字，必须先做一次 vendor 归属剔除**：先定位应用区间（license banner 定起点、`class X extends Y` 收尾校准终点，并扣除中间的"vendor 岛"——方法见 `references/reverse-engineering.md` §2.2），**只在应用区间内计数**。Step 0 阶段若还没建区段地图，至少要把该数字标为"含 vendor，未剔除"。
3. **计数只提假设，不当结论。** 这条纪律原在 `references/reverse-engineering.md` §4.1，此处前移复述——因为**错误计数在 Step 0 就已经污染决策**（判级、评级、工期估算）。每个数字都是待证伪的假设：进评级表前至少回上下文确认一处**真实使用点**（构造调用 / `registerPlugin` / shader 被 material 消费），确认不了就在 verdict 里标"未确认"，不许拿它抬高或拉低星级。

### 步骤 6：行为归属 → 出判级

综合 1-5 步回答一个问题：**签名行为的行为源在客户端 chunk 里吗？** 按 §3 判定树落判级，写一句话断点（"最先断掉的是第几步、为什么"），落盘 `probe/verdict.md`。

## 3. 判定树（按序执行，命中即停）

```
1. X 硬判据（任一命中 → X，停止）：
   ├─ 最终落点域 ≠ 目标主体域（301/302 转发、域名易主/抢注/平台回收）
   ├─ 目标路径 GET 404（且已排除 HEAD 假 404）
   ├─ 技术栈年代与获奖年份矛盾（根站是当代重建版）
   └─ 隐性下线：generator/license 年份晚于获奖期 + 获奖期技术栈残留为零
2. D 信号（坐实任一 → D）：
   ├─ wp-content 高密度 + WordPress generator meta（内容与行为主体在服务端 PHP+DB）
   │    ⛔ **在目标路径上量，不在宿主域上量**。企业站的周年微站、活动页、发布会页
   │    常以**静态子目录**挂在 WordPress/Drupal 域下：宿主的 `/wp-admin/`、
   │    `/wp-sitemap.xml`、robots 里的 wp 痕迹**不构成目标的 D 信号**。
   │    实证【aimservices】：宿主 robots 三行全是 WordPress，而目标 `/50th/` 的
   │    `wp-content` 命中 **0**、无 generator meta、资产全在 `/50th/assets/` 下——
   │    地面真值是 A。判据本身没错（它量的是路径），错的是照着 robots 先看的读法。
   ├─ 双抓为内容级差异（A/B 实验分桶、个性化注水 → 确定性验收彻底断裂）
   └─ 签名行为依赖 cart/checkout/GraphQL 数据面（行为主体是服务端函数）
3. C 判定（**二维**，任何单信号命中都不判级）【shopifydesign】：先各取一维证据，再交叉查 §4 二维表
   ├─ 维度① 框架模式 —— 框架下不下发行为源（HTML 层取证，用 §4 三判据坐实）
   │    ├─ 下发 route module：__reactRouterContext（React Router framework 模式）/ Remix /
   │    │    __NUXT__ / __NUXT_DATA__ / data-v- 高密度 + <!--[--> fragment 注释
   │    └─ 不下发组件源：self.__next_f（Next App Router RSC flight 流）
   └─ 维度② 引擎范式 —— 签名行为用哪种范式写的（bundle 层取证）
        ├─ 命令式：three / GSAP / 裸 WebGL，渲染与交互逻辑本身在客户端 chunk 里
        └─ 声明式：@react-three/fiber、Theatre.js（场景即组件树、动画即数据）
   → 落"下发 route module × 命令式"格 → 继续按 4/5 判 A 或 B；其余三格 → C
4. A 类签名：
   ├─ 【必要】静态构建器产物（webpack/Vite/Astro/Browserify 皆可，年代无关——2019 老栈照样 A）
   ├─ 【必要】少数几个 bundle（而非上百个组件粒度 chunk）；单体 ≥1MB 是常见形态，不是门槛
   ├─ 【必要】双抓 byte-identical（或仅 token 级差异）
   ├─ 【必要】无内容级 API 依赖（⚠ `/api/` 为零**不足以**判定，见 §8 的假阴性实测；以 M0 补录观测到的实际请求为准）
   └─ 【⚠ 条件式，不是必要条件】**若站上有 3D**，three 必须认强签名
        （WebGLRenderer/REVISION 命中，弱字符串 "three" 不算）。
        ⛔ **无 3D 不影响判 A**：GSAP 时间轴 / Canvas 2D / 纯 CSS-JS 编排的滚动站
        本来就是 A 类主场（SKILL.md「适用范围」原文），它们的 three 计数必然是 0。
        实证【aimservices】：一个 GSAP+ScrollTrigger+Swiper 的静态微站，其余四条全中、
        three=0，按"全部命中"的旧写法落不进 A，而第 5 条 B 的附加条件清单里
        **一条都对不上**——最典型的纯 GSAP 滚动站在判定树里无家可归。
        A 类的实质判据是 §4 二维表那两格（行为源下不下发 × 命令式还是声明式），
        不是有没有 three。
5. 其余 → B：管线主线成立，但存在以下任一附加条件（即"缺哪份指南"）：
   多 chunk 大规模切片（stripe 74 分包）/ Shopify 平台层剥离（✅ 指南已就绪：
   `references/shopify-platform.md`；allbirds、mana-yerba-mate、
   pangram-pangram）/ SSR 快照锁定 + 端点 stub（hackernews）/ React-SSR 冻结与注水剥离 /
   行为外置进 Rive、glTF、KTX2 二进制资产的直搬与 runtime 锁定 / Nuxt-Vue SSG payload 展开
   （chungiyoo）/ 第三方 GCS 桶 + manifest 驱动资产发现（kodeclubs）/ 公开 sourcemap 直取 +
   WAF 轮换 token 掩码（orano）/ 运行时 API-headless CMS 快照（synchronized-studio）/ HAR 驱动镜像
   （persepolis）——逐项列名后按 §1 的 B 政策执行【probe】
```

杂交站可分层判级：整体 C 的站，其 three 子层（独立 chunk 的命令式代码）可局部按 A 手法转写【probe】（实证：`case-studies/scope-and-fingerprint.md` §3）。v0.1 政策仍按整体判级执行，分层结论写进 verdict 供用户参考。

## 4. 二维判定表 + 三判据规则（防 noomo / shopify.design 型误判，宪法级）

**"检测到 Vue/Nuxt/声明式框架 → 判 C"是被锚点站证伪的错误捷径**【probe】。**同一类错误在 `__reactRouterContext` 上重犯过一次**【shopifydesign】：**信号被记在了错误的维度上**——框架名带来的是"下不下发行为源"，引擎范式才决定"下发的东西能不能转写"。（两次误判的实证：`case-studies/scope-and-fingerprint.md` §4）

正确判据是 **框架模式 × 引擎范式** 二维：

|  | 命令式引擎（three / GSAP / 裸 WebGL） | 声明式引擎（R3F / Theatre） |
|---|---|---|
| **框架下发 route module**（React Router framework 模式、Nuxt、Remix） | **A**（shopify.design、noomo） | **C** |
| **框架不下发组件源**（Next App Router RSC） | **C**（opal-tadpole） | **C** |

#### 4.0.1 ⛔⛔ C 类要拆成两类：「源码不下发」≠「写法是声明式」【eightdesign】

上表把 R3F / Theatre 归进「声明式引擎 → C」，理由写的是「**行为源不在客户端可读代码里**」。⛔ **这个理由对 RSC 成立，对 R3F 不成立**；把两者并成一格，会拒掉一整类其实做得了的站。

实测一个 Next + Turbopack + R3F 的站：`useFrame` 回调里是普通命令式数学与状态写入，18 个模块逐字切片成功、换进页面 CLEAN、跨侧 99.5%（逐项观测：`case-studies/scope-and-fingerprint.md` §4.0.1）。

⭐ **组件树是脚手架，行为住在钩子里，两者都下发、都能逐字切片。** 切片器不关心范式——它切的是字节。

判据应当拆成：

| 子类 | 判据 | 处置 |
|---|---|---|
| **C1** | 组件源**根本不下发**（RSC 服务端组件，只下发 flight 序列化结果） | ⭐ **v0.3 起可做：重构式逆向**——flight 流是服务端组件的完整输出,内联在每页 HTML 里,即规格书。路线与门型见 `rsc-reconstruction.md`;实测 rauchg.com 18/18 路由语义一致。⚠ 没有逐字 port 可言,L2/L3 合并,产物是"人写的源码 + 语义门证明的等价" |
| **C2** | 组织方式声明式，但**源码下发**（R3F / Theatre / Vue SFC 编译产物） | ⭐ **按 A 类跑**；渲染器当平台层从镜像伺服，与 Next 运行时、Apple 的 `ac/*` 同型 |

⛔ **判别器不是库名，是 §4 判据③本身**——「客户端是否持有行为源」。本文件此前用**库的身份**当它的代理，而 §4 开头警告的正是同一个错误：**「信号被记在了错误的维度上」**。这次它在低一层重犯了：R3F 出现被当成「源码不在」的代理，而它不是。

⚠ 判 C2 之前仍要坐实两件事：① 站点**自有**代码用了那个库（不是 vendor 里躺着）；② 那些回调里确实是数学与状态写入，不是空壳。两条都可量化（量化样例见 `case-studies/scope-and-fingerprint.md` §4.0.1）。

读法：**只有"下发行为源 × 命令式引擎"这一格是 A**。任一维塌向声明式或不下发，转写式移植要抓的那个"行为源"就不在客户端可读代码里，判 C。

三判据规则**保留**——它是取维度①证据的操作方法（判定"框架是否下发行为源"），二维表是它的结论形式，二者并用不可省。框架标记命中后，必须逐条回答：

1. **内容可镜像性**：同 URL 短间隔 HTML 是否确定（byte-identical / 仅 token 级差异）？全部内容能否落成静态文件？
2. **签名交互的承载层**：获奖视觉/交互是否为可下载、可 beautify、行号稳定的**客户端命令式代码**（GSAP/three/WebGL）？
3. **客户端是否持有行为源本身**：客户端 chunk 包含渲染/交互逻辑本身，还是仅有服务端序列化结果（RSC flight）？

三判据全"是" → 维度①落"下发 route module"，再按维度②查表（声明式框架只是抬高脚手架复刻成本，不改变签名行为的转写可移植性）。判据③为"否" → 维度①落"不下发组件源"，无论维度②如何一律 C（opal-tadpole 反例：Next App Router + RSC，服务端组件源码不下发客户端，只下发 flight 序列化结果——这才是真 C）【probe】。

区分口诀：**框架用于组织 DOM/状态的是脚手架；判级看的是签名行为存放在哪一层、用哪种范式写的**。

## 5. 探测纪律（14 条协议修正，逐条为实测教训）【probe】【shopifydesign】

逐条的实测出处见 `case-studies/scope-and-fingerprint.md` §5。探测中的每一步都遵守本清单；违反任一条都产生过真实误判：

1. 存活性判定到**路径粒度**，且用 GET 不用 HEAD（API 网关对 HEAD 假 404）。
2. `curl -sIL` 表面 200 会掩盖 301 退役信号——必须校验**最终 URL 与目标主体同一性**。
3. 200 后必须做**物种/年代校验**：generator meta、主题 schema、依赖 license 版权年份、获奖期技术栈残留 grep。
4. bundle 响应 <1KB → 补齐 **Referer** 请求头重试（资产域缺 Referer 时会返回几十字节的拒绝页，造成假阴性）。
5. script 枚举要**排除 HTML 注释内的脚本**。
6. 现代站 HTML 可能**没有任何 `<script src>`**（全靠内联 `import()`）——只认 script 标签会漏掉全部 JS。
7. **catch-all 假 200**：请求 `.map` 返回 index.html——对下载物做 content-type 与哈希碰撞校验。
8. bundle 内出现 `/api/` 字符串 ⇒ 强制做**运行时 API 快照**（B 信号）。

   ⛔ **但零命中不能反过来当作"无接口"——这条判据假阴性高发**【airpodspro】。它测的是**命名习惯**，不是行为。大厂常按业务命名，运行时接口路径里可以一个 `/api/` 都没有（实证：`case-studies/scope-and-fingerprint.md` §5）。**M0 补录之前不得据此排除 B/D 类。** 但**同一个盲点用在别的站上可能把 D 类误判成 A 类**。
9. MB 级单行文件先 `tr` 注入换行再 grep，防有界量词正则卡死。
10. 未混淆产物可跳过 js-beautify——先做 **minification 形态预检**再决定流程。
11. 有公开 sourcemap 时直取 sourcesContent 源码，替代 beautify 流程。
12. WAF/CDN 每次注入的轮换 token 是 nonce 级差异，**不要误判为动态渲染判 D**（把它当可掩码噪声即可）。
13. **出现次数一律 `grep -o … | wc -l`，禁用 `grep -c`**——后者数的是匹配行数【shopifydesign】。
14. **计数只提假设，不当结论**：vendor 自带字符串会污染计数，进评级表的数字必须先做 vendor 归属剔除并回上下文确认一处真实使用点（见 §2《计数硬约束》）【shopifydesign】。

## 6. 常见坑

- **HEAD 假死 / GET 存活**：Lambda/API GW 托管静态站的常见形态，只用 `-I` 会把活站判 X【probe】。
- **平台名预判**：凭"这是 Webflow/大厂站"直接预判会错——平台站也可能是手写 GSAP/three.js bundle，判 A【probe】。判级只认指纹证据（实证：`case-studies/scope-and-fingerprint.md` §6）。
- **框架名单因子判级**：Nuxt 站可以是 A（noomo），Next RSC 站一定是 C（opal-tadpole）——差别在三判据③【probe】。同理 `__reactRouterContext` 不是 C 信号，只是"下发 route module"这一维的证据【shopifydesign】。
- **判级正确 ≠ 附带结论正确**：判级对了，同一份 verdict 附带的路由数、媒体文件数、漏抓归因仍可能整批被 M0 证伪（实证：`case-studies/scope-and-fingerprint.md` §6）。判级可以继承，**Step 0 的每个数字与每条附带结论都必须在 M0 逐条复核**【shopifydesign】。
- **把 token 噪声当动态渲染**：nonce/装饰性随机串/WAF 轮换 token 都是可掩码的确定性站【probe】。
- **只探根域**：获奖路径 404 而根域 200 的站会被误判存活【probe】。
- **拖延镜像**：历年获奖站里已消失的接近三成，五种消亡形态（域名易主/转发、平台回收、域名抢注、路径移除、原地替换）全都出现过（实证：`case-studies/scope-and-fingerprint.md` §6）。判级为 A/B 的瞬间，**第一时间全站镜像不是最佳实践，是抢救行为**——立即进入 `references/mirroring.md`【probe】。

## 7. 门判定与产出物

- 产出 `probe/verdict.md`：判级 + 一句话断点 + 关键指纹证据（命令输出摘录）+ B 类缺口清单（如适用）+ 三判据逐条回答（框架标记命中时必填）。
- **A** → 进入 M0，加载 `references/mirroring.md` 与 `references/recon-and-rating.md`。
- **B** → 同上，另按 §1 政策提示指南缺口。
- **C/D** → 按 §1 政策拒绝并解释，流程终止。
- **X** → 按 §1 政策引导 Wayback 或换目标，流程终止。
