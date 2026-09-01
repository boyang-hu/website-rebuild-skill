---
name: website-rebuild
description: 1:1 rebuild of award-winning creative websites (WebGL / scroll-animation / portfolio sites). Evidence-driven pipeline - mirror-first forensics, line-number-traceable reverse engineering of minified bundles, verbatim porting, quantitative verification gates. Use when user asks to "复刻网站", "重建网站", "1:1 rebuild", "clone this site", or provides a URL of a creative/award site to reproduce.
compatibility: Requires Node 22+ (bundled scripts use built-in WebSocket to talk to CDP), npx, and a local Chrome/Chromium for headless comparison. POSIX shell optional - the Step 0 probe protocol has a zero-dependency Node equivalent (scripts/fingerprint.mjs) for shells without curl/cmp/tr/perl (e.g. Windows PowerShell). Agent-agnostic - works in any Agent Skills-compatible runtime.
metadata:
  version: "0.3.3"
---

# Website Rebuild（获奖创意站 1:1 复刻）

把一个获奖创意网站（WebGL / 滚动叙事 / 作品集站）以**取证式方法**复刻为可独立运行、可验证还原度的工程。不是"看着像"的仿制——是以源站 bundle 为唯一规格书、以量化验收门收口的逐行为移植。

本方法论提炼自六个连续实践项目（工期从 6.5 周收敛到 1 天），后经 **21 个完整复刻 + 3 个死站存档抢救**持续回填、43 站边界探测实测校准适用范围（清单见仓库 README「已验证过的网站」）。

## 使用前提与授权 ⛔ 必读

本 skill 面向**学习与研究目的**的保真复刻，用于研究获奖创意站的实现手法。适用对象是你**自有的、已获授权的，或公开可访问且允许学习临摹**的网站。它不是用于未授权地采集受保护内容、规避访问控制、或商业性盗用他人作品的工具。

执行时遵守下列边界：
- **尊重目标站规则**：遵守其 `robots.txt`、服务条款与版权；抓取保持低频、单会话，不对目标站施加异常负载。⛔ **`robots.txt` 是逐路径的许可声明，不是全站开关**——逐 URL 判定（选组 → 最长匹配 → 无匹配即允许），**不得因为存在任何 `Disallow` 行就判"整站禁止"**（几乎每个商业站都有 `/cart`、`/checkout`、`/admin` 的 `Disallow`）；禁令要按行为类别归类，**只有针对"抓取"的禁令才影响镜像范围**，针对交易的禁令只意味着"别去点结账"。⭐ **"读不懂 / 拿不准"不等于"禁止"**：走呈交，不走停工，更不自行缩小抓取范围。读法见 [references/legal-and-deploy.md](references/legal-and-deploy.md) §0.3。
- **不触碰受保护边界**：不采集需要登录态、付费墙或授权才能访问的内容；本 skill 只处理匿名可公开访问的资源。若目标站明确禁止此类复制，停止并告知用户——**何为"明确禁止"见 `legal-and-deploy.md` §0.3.6 写死的四条门槛，其余一切不确定性走呈交不走停工**。
- **产出默认私有**：默认 noindex、不公开部署。任何公开前必须完成逐资产版权取证，并显著标注"非官方复刻"与原作者归属（见 [references/legal-and-deploy.md](references/legal-and-deploy.md)）。

⛔ **法务判断归用户，skill 只取证与呈现**（三条，全程有效）：

1. **决定权在用户**：skill 收集事实（逐资产归属、许可状态、第三方权利人、源站是否仍在营业、产物内第三方标识符）、列出选项与各自的风险边界、给出建议与理由；凡涉及"能不能公开 / 部署 / 再分发 / 对外展示"，**必须用下文「User Input Tools」显式交回用户**，不许 agent 自行下法律结论后继续往下走。
2. **未获用户明确决定前按安全默认执行**：私有仓库 + `noindex` + 不公开部署 + 不再分发。写给用户时说明这是**默认动作**（"在你决定之前我不会把它发出去"），**不是** agent 已作出的法务结论——两者责任归属完全不同。agent 只能往保守侧执行默认，往公开侧走必须有用户的明确决定。
3. ⛔ **法务考量不得削减镜像完整性或门的覆盖面**：镜像是证据基座，**完整性是技术不变量**（四遍法、闭包门、GAP=0 全建立在它之上）。不抓只能有**技术性理由**（不是文件 / 服务端不提供 / 需授权或登录态 / 源站明令禁止），一律登记；**不得**以"反正不公开""不该多存一份"这类法务理由留洞。实证：某项目以"产出永不公开"为由对一类资产"登记、不补抓"，**缺了约 60% 的资产而五道门始终全绿**，藏了四个里程碑【objectarchive】。法务决定作用于**产出怎么被使用**，不是证据基座是否完整。

## 适用范围 ⛔ 必读

**主场（A 类）**：内容静态托管、签名行为（动画/交互）全部存放在客户端静态资产里的站——命令式 WebGL/Canvas 场景、GSAP 时间轴、烘焙数据文件（GLB/.buf/.riv）、minified 或未混淆的 bundle。绝大多数 Awwwards 风格创意站属于此类。

**有条件支持（B 类）**：管线成立但需要额外场景处理（Shopify 平台层剥离、第三方存储桶资产、运行时 API 快照、SSG payload 展开）。当前版本的指南覆盖大部分 B 类场景，遇到未覆盖的要向用户明示风险。

**明确拒绝（C/D 类）**：
- **C1（v0.3 起可做：重构式逆向）**：服务端组件源确实不下发，但**它的完整输出（flight 流）内联在每页 HTML 里，是可对拍的规格书**。路线：flight-decode 建坐标系 → 重构一个可构建的 Next 工程（客户端一方组件按 C2 逐字译，服务端组件从 flight 树反推为显式登记的推断物）→ verify-flight 语义门收口（模块 id 全局双射）。实测 rauchg.com（Next 16/Turbopack）：18/18 路由语义一致，盲逆向对答案结构 ≈95%/行为 ≈98%。⚠ C1 的 L2/L3 合并——第一份产物就是「人写的源码 + 门证明的等价」。全流程见 [references/rsc-reconstruction.md](references/rsc-reconstruction.md)。
- **C2（可做，按 A 类跑）**：⭐ 写法是声明式但**源码下发**（R3F / Theatre / Vue SFC 编译产物）。实测一个 R3F 站：`useFrame` 回调里就是 `MathUtils.damp(x, y, 7, t)` 这样的普通命令式代码，逐字切片 18 个模块换进页面后 **CLEAN、8 个 canvas 齐全、跨侧 99.5%**。**切片器不关心范式——它切的是字节。** 渲染器当平台层从镜像伺服。⛔ 判别器不是库名，是「客户端是否持有行为源」（`scope-and-fingerprint.md` §4.0.1）。
- **D**：行为主体在服务端（CMS 内容站、电商 cart/库存、A/B 实验分桶、个性化注水）——客户端没有可移植的目标物，且确定性验收无基准。

**X 类（可抢救）**：原站已消失（域名易主 / 平台回收 / 路径移除 / 原地被替换），但 Internet Archive 往往有捕获——`scripts/wayback-mirror.mjs` 从 CDX 索引按**锚点 + 时间窗**选一个连贯时刻、以 `id_` 原始字节抓成**标准镜像**（下游门原样工作），洞按既成事实登记进 `wayback-holes.txt`（读法与流程见 [references/archival-rescue.md](references/archival-rescue.md)）。CDX 无覆盖才是真不可做。历年获奖站实测消失率约 29%——这也是"第一时间镜像"是本 skill 第一纪律的原因。

判级由 Step 0 指纹侦察决定，完整判定树见 [references/scope-and-fingerprint.md](references/scope-and-fingerprint.md)。**拒绝时要解释原因并说明该站属于哪一类**，不要硬跑。

## User Input Tools

需要向用户提问时（确认范围、**法务决定**、外部依赖决策）：优先使用当前运行时的内置提问工具（如 `AskUserQuestion`）；没有则输出编号问题清单让用户回复编号。支持多问合并时一次问完。法务类提问按 `legal-and-deploy.md` §0.1 的五段式写：事实 / 查不清的 / 选项 / 每个选项的风险边界 / 建议与当前默认动作。

## 宪法（六条纪律，全程有效）

以下六条在六个源项目中被称为"宪法级"，违反任何一条都会在后续阶段以 bug 形式偿还：

1. **镜像神圣不可污染**：`mirror/` 磁盘文件永不修改；一切本地化适配（CDN 改写、外链 stub）在服务层响应时动态完成。
2. **源站代码是唯一裁决，不凭观感修**：每个改动先在 bundle/CSS/镜像 HTML 里找到归属行号再落地。Do not tune visuals, motion, or interaction by eye.
3. **源站有的都要有，源站没有的不做**：不自创补偿性 CSS/JS。宁可先不像，也不要发明规则——自创补丁会在机制对齐后反转成 bug。
4. **bug / 死代码 / 怪写法照抄不修**：压缩代码里的每个怪写法都可能是行为本身。"好心修正" no-op bug 曾导致转场崩溃（实证见 porting-discipline.md）。
5. **有意偏差必须登记**：写清"源站怎么做 / 我们怎么做 / 为什么 / 什么条件下重新考虑"。**没登记的差异一律视为 bug**。
6. **代码与文档同一次提交**：每个里程碑成对提交（`Port xxx` + `Update rebuild plan: xxx`），日志固定含产出 / 验收 / 教训 / 下一步断点（带行号）。

⭐ **纪律 3 在 M(n+1) 的边界**：`src/` 是显式登记的衍生物，不是对源站的断言，所以**在 `src/` 里重命名、拆模块、写注释不算"发明"**——纪律 3 约束的是"为了让它看起来像而自创行为"，不是"让已证明等价的代码变得可读"。但两条硬边界不动：**① 结构性重写默认禁止**（合并重复、提取公共函数、改算法——它们让等价不可判定）；**② 注释里的推测必须标注为推测**，不许把逆向笔记里的猜测写成陈述句。`port/` 与 `mirror/` 仍然一个字节都不许动。详见 [references/readable-source.md](references/readable-source.md) §3.4 与 §5。

## Workflow

### Progress Checklist

```
[ ] Step 0  指纹侦察与范围门 ⛔（判级 A/B/C/D/X；C/D/X 拒绝或引导，不进入下一步）
[ ] Step 1  开工评级（架构证否、分项难度打星、工期预估、与用户确认范围 + 终点 L1/L2/L3）
[ ] M0      镜像取证 ⛔（BFS 爬虫 + CDP 补录 + manifest 账本；GAP=0）
[ ] M0.5    镜像断网跑通 ⛔（零 404 / 零控制台错误 / 零外联；serve.mjs 伺服）← L1 镜像存档 终点
[ ] M1      逆向建坐标系 ⛔（_pretty 钉版本展开；engine-notes 先于任何代码；技术栈钉死；REBUILD_PLAN 建立）
[ ] M2+     严格溯源移植（依赖序里程碑推进；先竖切一条端到端链路；每里程碑冷启动实测 + CLEAN 门）
[ ] M(n-1)  对拍验收（按 verification-gates.md 决策树选门型；根因修复，不调参糊平）
[ ] M(n)    收口 ⛔（冷头评审 / 模块清单对账；版权取证 + 呈交用户决定——公开部署前必须完成）← L2 工程化复刻 终点
[ ] M(n+1)  源码化（port/ → src/：拆模块、去混淆重命名、补注释、自包含）← L3 源码化 终点
```

⛔ = 阻塞门：验收标准未达成不得进入下一阶段。

### Flow

**Step 0 — 指纹侦察与范围门**。加载 [references/scope-and-fingerprint.md](references/scope-and-fingerprint.md)，对用户给的 URL 执行探测协议（GET 到路径粒度、最终 URL 同一性、双抓 diff、物种/年代校验、bundle 初检），输出判级与依据。A/B 类继续；C/D/X 类向用户解释后停止或引导。

**Step 1 — 开工评级**。加载 [references/recon-and-rating.md](references/recon-and-rating.md)。架构假设先证否（依赖表会撒谎），分项难度打星（素材/3D/滚动编排/私有格式/平台层），向用户确认复刻范围（整站或指定页面）与预期。

⭐ **同一次提问里让用户选终点**（三级梯子，带着判级结论与分级成本估计问，不要干巴巴列选项）：

| 终点 | 回答的问题 | 止于 | 典型用途 |
|---|---|---|---|
| **L1 镜像存档** | 它长什么样 | M0.5 | 存档、离线欣赏（获奖站年消失率约 29%） |
| **L2 工程化复刻** | 它在做什么 | M(n) | 可部署、可验证的 1:1（含版权取证与部署评估） |
| **L3 源码化** | 它怎么做的 | M(n+1) | 研究与学习实现手法 |

**梯子单调，选低不亏**：每一级都是下一级的前缀，镜像纪律保证时间敏感的部分永远最先完成——今天选 L1，以后想升级随时续跑（向用户说明这一点）。**"拿它做自己的项目"（脚手架化）不是本 skill 的阶段**——用户问起时指向 [references/beyond-the-rebuild.md](references/beyond-the-rebuild.md) 交接，那是他的工程，skill 到"人能读懂的真实"为止。

**M0 / M0.5 — 镜像取证**。加载 [references/mirroring.md](references/mirroring.md)。用 `scripts/mirror-site.mjs` BFS 爬取 + `scripts/netcapture.mjs` 真实浏览器补录，manifest 逐文件登记 sha256，`redirect: manual` 纪律，外部依赖逐项决策。`scripts/verify-mirror.mjs` 是**镜像自己的门**（五项断言，跑在断网门之前——下游所有门问的都是"渲染得出来吗"，错的镜像能让它们全绿；**一个 HTTP 200 也不是"你拿到了那个资源"的证据**）。`scripts/serve.mjs` 伺服镜像，断网验收。**这一步永远最先做**——原站随时可能消失或改版，镜像是全项目唯一证据基准，也是后续一切对拍的参照服。

**M1 — 逆向建坐标系**。加载 [references/reverse-engineering.md](references/reverse-engineering.md)。⛔ **第一个动作是判 bundle 形态**（扁平拼接 / 模块化打包 / 多 chunk），再选工具——分层表扫顶层声明，而 webpack 打包产物的顶层声明数是 **0**，边界与依赖边由打包器给定（实测 24,378 行 → 569 个现成模块，用 `scripts/module-map.mjs`）。认不出容器时 FATAL，**禁止回退到分层表**（§0.5）。`scripts/beautify-bundle.mjs`（js-beautify 钉 1.15.1）展开 bundle 到 `_pretty/`，此后行号是全项目唯一溯源坐标系。先写 `docs/engine-notes.md`（模板：[assets/templates/engine-notes.md](assets/templates/engine-notes.md)）再写任何代码。技术栈从 bundle 取证钉死精确版本。数据驱动动画先 dump 数值账本。建立 `REBUILD_PLAN.md`（模板：[assets/templates/rebuild-plan.md](assets/templates/rebuild-plan.md)）。

**M2+ — 严格溯源移植**。加载 [references/porting-discipline.md](references/porting-discipline.md)，并按分支路由表加载对应场景指南。每个移植文件头部注明源行号区间；GLSL/魔数/数据逐字提取；数据资产脚本抽取入库不手抄。

**M(n-1) — 对拍验收**。加载 [references/verification-gates.md](references/verification-gates.md) 与 [references/determinism.md](references/determinism.md)。全站渲染**广度**用 `scripts/sweep-routes.mjs`（全路由一个浏览器,逐路由 0 错误/0 失败/0 外联 + 交互钩子与逐路由采集）,单路由**深度**才用 `probe.mjs`——⛔ 不要手搓逐路由起 Chrome 的循环,成本按浏览器启动次数计,且并发探针会互相收割孤儿。⚠ **归因残差之前先建自比带宽**（`pixelcompare --self`，逐侧 ≥4 次、交错跑）——没有带宽的残差一律 UNCLASSIFIED，而 UNCLASSIFIED 是失败不是通过。门型选择：有 SSR/静态 HTML 产物先建字节门 → DOM 静态场景冻结熵源走 byte-equal → 活场景（WebGL/视频/随机相位）降级量化指标 + 噪声归类 → 数据驱动动画补数值探针门 → CLEAN 门全程兜底。判定时序 bug 前先校准探针（[references/environment-traps.md](references/environment-traps.md)）。

**M(n) — 收口**。冷头评审：对 bundle 顶层类/模块清单逐一核对落点（功能测试测不出整块遗漏，只有清单式核对能）。加载 [references/legal-and-deploy.md](references/legal-and-deploy.md) 完成版权**取证**并把决定**呈交用户**——在用户决定之前按安全默认执行（**私有 + noindex + 不部署**），公开前必须逐资产取证、显著标注非官方复刻。

**M(n+1) — 源码化**。加载 [references/readable-source.md](references/readable-source.md)。到 M(n) 为止产物**已证明正确但人读不了**（实测：14,271 行挤在一个文件里，`e` 出现 2962 次，注释占 0.2%）。本阶段把 `port/` 重写成 `src/`：拆模块 → 作用域安全地去混淆重命名 → 补分档注释 → 复制资产做到自包含。⛔ **拆分粒度不是自由选择**——扁平脚本的声明顺序即求值顺序，粒度由三条硬约束决定（互相引用 / 求值顺序 / import 绑定不可赋值），**先出划分方案让人过目，再切**；遇到巨型模块时**先测「延迟绑定少数末尾单例」的收益曲线再决定**（实测 6 个绑定即从 11,246 行降到 1,013 行，而换模块系统要赔上整条工具链才换来同样粒度）。⭐ **"这件事做不到"这个判断极不可靠**——实测两次判为结构性不可能，两次真凶都是自己工具里的一行 bug；先怀疑测量它的工具，再怀疑对象（`readable-source.md` §3.1–3.1.3）。⛔ **前置条件不可协商：必须先有全绿的门。** 没有裁判的重构是盲改；有了 `meanAbsDiff 0.00` 的裁判，每一步都能被证死——**这是重构能有的最好条件，也是它必须排在最后的原因**。现有门全部原样复用（目标换成 `src/` 构建产物，**容差不许放宽**），另加符号映射门与自包含门。⛔ 结构性重写（合并重复、提取公共函数、改算法）**默认禁止**——它会让门从"证明等价"退化为"没测出不等价"。⭐ **纪律 4 在本阶段依然有效**：你现在读得懂了，"这明显是个 bug"的冲动会比任何阶段都强，而它依然可能是行为本身。

⭐ **无容器 scope-hoisted 产物（Vite/esbuild,逐字分层交付的站）走另一条路：不重写,切**——拼接式分解（`scripts/census-bundles.mjs` 出 chunk 图与坐标 → `scripts/slice-esm.mjs` 按声明切成语义命名的部件,按序拼接逐字节等于原件 → `scripts/verify-reassembly.mjs` 一门定案,字节等价成立时全部运行时门的裁决免费转移）。执行侧不变,浏览器继续跑原 chunk。详见 `readable-source.md` §3.0.6。

### 分支路由表

Step 1 侦察结果决定加载哪些场景指南（按需，不要全量加载）：

| 侦察发现 | 加载 |
|---|---|
| Next.js App Router / RSC(`self.__next_f` flight 流)——C1 重构式逆向 | [references/rsc-reconstruction.md](references/rsc-reconstruction.md) |
| WebGL / Canvas 场景（three.js、自研引擎、GLSL） | [references/webgl-scenes.md](references/webgl-scenes.md) |
| GSAP / 烘焙动画数据 / CSS 变量动画 / 自研输入状态机 | [references/animation-recovery.md](references/animation-recovery.md) |
| 私有二进制格式（.buf / .sog / VAT / GLB 时间线 / .riv） | [references/binary-formats.md](references/binary-formats.md) |
| Shopify 店铺（指纹见 `cdn/shop`、`Shopify.theme`、`cdn.shopify.com`） | [references/shopify-platform.md](references/shopify-platform.md) |
| DOM 层策略选型（所有站必经；Webflow 导出 / 静态单页 / 框架 SSR 分支不同，另有"DOM 被 3D 引擎当坐标源读"的正交约束） | [references/dom-shell-strategies.md](references/dom-shell-strategies.md) |
| 大体量资产（百 MB 级媒体 / 授权字体） | [references/asset-management.md](references/asset-management.md) |
| 无头探测行为异常 / 疑似环境问题 | [references/environment-traps.md](references/environment-traps.md) |

### Step Summary

| 阶段 | 关键动作 | 阻塞门验收 | 产出物 |
|---|---|---|---|
| Step 0 | 指纹探测判级 | 判级明确且已告知用户 | 判级结论与依据 |
| Step 1 | 证否 + 评级 + 确认范围 | 用户确认 | 难度评级表、范围共识 |
| M0/M0.5 | 镜像 + 账本 + 断网跑通 | **`verify-mirror` 五项全绿**；GAP=0；零 404/零错误/零外联 | `mirror/`（只读）、manifest、`serve.mjs` 参照服 |
| M1 | 展开 bundle、逆向笔记、钉栈 | engine-notes 完成；版本钉死表完成 | `_pretty/`、`docs/engine-notes.md`、`REBUILD_PLAN.md` |
| M2+ | 溯源移植、里程碑成对提交 | 每里程碑冷启动实测 + CLEAN 门绿 | 带行号注释的源码、三张登记表滚动更新 |
| M(n-1) | 对拍验收 | 所选门型全绿或差异全部登记 | 验证脚本 + 对拍产物入库（`docs/compare/`） |
| M(n) | 冷头评审 + 版权取证 + 呈交用户 | 清单对账零缺口；用户已作出部署决定（未决则维持安全默认） | 审计记录、DEPLOY.md |
| M(n+1) | 拆模块 + 去混淆 + 注释 + 自包含 | 现有门全绿且**容差未放宽**；符号门双向单射零孤儿；自包含门（复制出去、断网、构建）过 | `src/`（可读工程）、`docs/rename-map.json`、`src/README.md` |

## Script Directory

Node 22+，路径相对本 skill 目录。用法与成熟度详见 [scripts/README.md](scripts/README.md)。

⭐⭐ **依赖纪律是按阶段划的，不是按目录划的：源码化之前，整条流水线零依赖。**

Step 0 → M(n) 全程不装任何东西；**复刻项目要到 M(n+1) 才获得 devDependencies**（作用域安全的重命名需要真正的 parser）。`scripts/`（零依赖）与 `tools/`（允许 devDeps）只是这条阶段线在目录上的投影——**判据住 `scripts/`，源码化阶段的重构器住 `tools/`**。

⛔ **任何门不许 import 任何工具**（`verification-gates.md` §2.1.2）——检查者不能是生产者。

⭐ **前面的阶段需要真正的 parser 怎么办？外挂，不要 import。** `beautify-bundle.mjs`（js-beautify）与 `module-map.mjs`（acorn）都是 `spawn` 一个**钉死版本的 npx**，脚本自身仍然零依赖、仍然可独立审查。⛔ **不要改成手写词法器**——本 skill 里试过，一个含引号的正则字面量把它带偏了 16,177 行（F27）。**token 流上的括号匹配是精确的，文本上的括号匹配是对字符串/正则/注释的猜测。**

⚠ 这条线是**被违反之后才被发现的**：`module-map.mjs` 依赖 `@babel/*`，却在 `scripts/` 里住了整整八个版本，而同一份纪律的原话就写在它上面三行。**一条只写在文档里、没有任何东西去查的规矩，会安静地失效。**

| 脚本 | 用途 | 使用阶段 |
|---|---|---|
| `scripts/fingerprint.mjs` | Step 0 六步探测协议的跨平台等价实现（GET 存活 + 重定向链与终点域同一性、双抓 diff、物种/年代、HTML 技术指纹、bundle 初检；出现次数计数与 <1KB Referer 重试内置）。**只采证据不出判级**——判级仍走 scope-and-fingerprint.md §3 判定树 | Step 0（无 POSIX 工具链时） |
| `scripts/mirror-site.mjs` | BFS 爬虫镜像（资产白名单 + 迭代到不动点；`redirect:manual` + 三本账，含逐文件 sha256）。`--scope <前缀>` 把**页面**队列限制在目标路径下（微站挂在企业 CMS 域下时必用；⛔ 只限页面不限资产）。**账本累积**（`--seeds` 补漏不再截短上一轮的行）+ **off-host 普查**（不跟的主机逐个计数并告警——静默丢弃曾让 827 条媒体引用消失而报告写着"57 files saved"） | M0 第一遍 |
| `scripts/netcapture.mjs` | 真实浏览器 CDP 抓包对账补录运行时资源（**CDN 站必须传 `--hosts`**，否则只观测同源流量、会报假 GAP=0） | M0 第二遍 |
| `scripts/verify-mirror.mjs` | **镜像自己的门**，跑在断网门之前。五项断言：映射单射性 / 账本与磁盘 sha256 / **真实性（挑战页正文 + 声明类型对魔数——一个 200 不是"你拿到了那个资源"的证据）** / 闭包 / 可选抽样回源。下游所有门问的都是"渲染得出来吗"，**错的镜像能让它们全绿** | M0 关账前，每次重抓镜像后 |
| `scripts/gapfill-video.mjs` | HLS/DASH 流媒体阶梯补录（master → rendition → 分片），静态爬虫的结构性盲区 | M0（有流媒体时） |
| `scripts/reconcile-gaps.mjs` | **运行时缺口对账器**：把 netcapture 记下的 GAP 行与字节推导的全集清单（如 next/image 的 srcset 阶梯穷举——实测 1,078 vs 浏览器碰到 217）逐条补进镜像。⭐ **请求头梯子**（标准 profile 4xx → 裸 profile 重试：同一个 403 有两种相反的药，landonorris 要 Referer、video.twimg 恨 Referer）+ 逐 URL 容错 + 分批记账（一次崩溃不留账外文件） | M0（运行时资源多的站） |
| `scripts/flight-decode.mjs` | **C1 的坐标系**：把每页 `self.__next_f.push` 流解成模块引用表（I 行导出名=白送的 tier-1 命名证据）、HL 预载、已解引用的元素树 + JSX 式 outline。T 行按声明字节数走；`:HL` 空 id 行不许断链 | M1（C1） |
| `scripts/verify-flight.mjs` | **C1 语义门**：构建产物 flight 树 ≟ 镜像 flight 树。自带解析器（⛔ 不 import flight-decode——检查者不能是生产者）；规范化只收「证明不携带行为」的构建哈希命名空间（chunk 名/css-module 类/媒体哈希/可提升资源挂载点/编码自由度），**模块 id 做全局双射**（一对多即红）；站点登记项走 `--normalize-props`（ISR 纪元字段）与 `--normalize-class`（库渲染子树）；其余一切差异照红 | M(n-1)（C1） |
| `scripts/serve.mjs` | 零依赖静态服务器（MIME/Range/服务层改写/重定向回放），兼任源站参照服。`--rewrite FROM::TO` 是**登记式字面量替换**，为的是一类本地化触及不到的东西——**源程序按自己的域名分支**（`location.hostname=="x.com" && (CDN=...)`，镜像不在那个域名上于是整个子系统走空路径）；**首次命中打印**，因为沉默与生效此前无法区分。`--fallback-root` 让复刻侧只放产出、资产全部从只读镜像读（`asset-management.md` 的不复制策略）；**未知旗标响亮失败**——被静默忽略的旗标是一次没人知道的降级 | M0.5 起全程 |
| `scripts/build-site.mjs` | **策略 A 构建层**：按 `shell-config.mjs` 的登记变换表从镜像生成 `site/`，逐条命中下限 + `--check` 可复现性 + 目的断言（下限说明变换还活着，目的断言说明它达成了目的） | M2+（策略 A） |
| `scripts/verify-shell.mjs` | **外壳字节门**：逐文档 patience diff，每个差异块必须能被变换表**重放**解释。⛔ 不 import `build-site.mjs`——门不许生产它所审计之物（`verification-gates.md` §2.1.2） | M2+（策略 A） |
| `scripts/verify-payload.mjs` | **SSG payload 门**：把内联序列化数据块（Nuxt2 `window.__NUXT__` / Nuxt3 `__NUXT_DATA__` / **React flight `self.__next_f`**）**求值展开**再按结构对拍。字节门在这里不够用——payload 是一段"输出数据的程序"（参数去重、`\u002F` 转义），两份可以字节不同而语义相同，也可以字节相近而语义不同；且服务层要**改写它内部**的 URL。实测：它抓到两侧本地化实现不一致（一侧留 `href="http://host"`、另一侧写出 `href=""`），而外壳字节门全绿 | M0.5 起（有 SSG payload 时） |
| `scripts/verify-lenprefix.mjs` | **自带长度的载荷门**：走 React flight 流（Next.js App Router 每页内联的 `self.__next_f.push`），逐行按声明的 `T<十六进制>` 字节数前进，确认落点仍是一个行首。⭐ **长度前缀行没有终止符**——下一行的行首就贴在声明的末尾，长度本身即分隔符。因此任何**改变字节数的文本改写**（本地化外链）都会让读取者把下一行的行首吞成正文。实测 eightdesign：115 条路由里 2 条只渲染出 70 字（对侧 2,440），**零 404、零请求失败、HTML 字节数一致、其它门全绿**；定位它的是拿 `python3 -m http.server` 伺服同一个目录——两条路由完美渲染，于是错处在服务器而不在字节。⛔ 这道门要**先拿源站校准**：第一版断言"行末必须是换行"，把包括源站自身字节在内的每份文档都判为损坏 | M0.5 起（有 flight 载荷时） |
| `scripts/verify-refs-served.mjs` | **引用可达门**:把产出字节里的每一条资源引用**逐条问服务器**(一次 GET,不开浏览器)。⭐ 关键在于**问服务器,而不是再实现一遍它的解析**——一个自己走镜像的离线检查就是第二份 url→path 实现,而第二份实现就是一次等着被报成窟窿的分歧(实测它把 28 张在场的图报成缺失,只因不知道服务器的查询变体回退)。⚠ 它看不见运行时拼出来的 URL,那是资源级探针的活(§1.6 class 4) | M2+ 起每 commit |
| `scripts/verify-offline.mjs` | **零外联门的静态一半**：枚举产出字节里每个外部绝对 URL 并逐条裁决（§1.6 的四类断言面里，资源级探针看不见的那三类） | M0.5 起每 commit |
| `scripts/beautify-bundle.mjs` | js-beautify@1.15.1 钉死展开 bundle 到 `_pretty/` 并生成再生成说明。⛔ **撞名响亮告警 + 单射断言**——两个不同目录下的 `main.built.js` 曾静默互相覆盖，而 `_pretty/` 是全项目唯一溯源坐标系，覆盖之后每个行号都指向错误的文件 | M1 |
| `scripts/module-map.mjs` | **模块化 bundle 的分层表**：spawn 钉死的 `acorn --tokenize`（零依赖），逐模块给出行区间、`requires`、导出名。**认两种容器**：webpack 对象容器与 **Turbopack 扁平列表**（后者把导出名直接写在容器里，M(n+1) 命名因此几乎全是 tier-1 证据）。⛔ 认不出容器即 FATAL；⛔⛔ **认出来的还必须解释得了这个文件**——行覆盖率 <50%、或依赖边不足 require 调用数的 25%，一律 FATAL：读错容器时工具会「成功」（实测对一个真有 20 个工厂的 chunk 报了 2 个模块）。⛔ **容器可以重复定义同一个 id**——实测 597 条属性只有 569 个不同模块，且其中 4 条被遮蔽的定义**实现不同**；语义是**对象字面量后者胜出**，工具必须去重并报告，否则每份文档记的模块数都是错的，而下游拿到哪一份取决于迭代顺序 | M1（模块化打包产物） |
| `scripts/closure.mjs` | 从种子模块算**传递依赖闭包**，是竖切边界的唯一依据。⛔ **未知种子 ID 一律 FATAL** 并给出 did-you-mean——静默丢弃会产出一个“小一号但看似合理”的切片，失败推迟到运行时 | M2+（模块化打包产物） |
| `scripts/verify-tween.mjs` | **竖切的数值门**：同一关键帧规格喂两侧、逐点比补间值与缓动曲线。比像素门**早得多**判红，且失败会带上产生它的输入。⛔ 用例的字段名与值域必须从源码抄——第一版凭直觉写，六个用例全落在同一条曲线上、全绿、零区分力 | M2+（有补间/时间轴引擎时） |
| `scripts/harvest-cases.mjs` | **从源站活引擎采用例**：驱动源站到 N 个状态，逐状态记录它自己对象里的数值（站点侧写在 `harvest.config.mjs`，样例见 `harvest.config.example.mjs`）。手写用例编码的是**你相信引擎的参数是什么**——六个手写用例曾全落在同一条曲线上、全绿。⛔ 只产出 A 侧，必须配 `verify-harvest.mjs`。⚠ 采**解析完的数值**而非源文本 | M2+（源站引擎可达时） |
| `scripts/verify-harvest.mjs` | **采集基线的 B 侧**：把采到的身份逐条喂给移植，要求**恰好匹配一个**（零个=缺失，两个=移植里有重复行为、映射不成立）。⭐ 按**行为**匹配还能**把名字找回来**——源站的缓动函数全匿名，移植侧按可读键导出，指纹一对上就知道源页面在跑哪条曲线 | M2+（有采集基线时） |
| `scripts/verify-crossside.mjs` | **跨侧门**：同一份输入同时喂镜像与移植，逐条比结果（站点侧写在 `crossside.config.mjs`，样例见 `crossside.config.example.mjs`）。用在源站**公开了接缝**时——bundle 没有模块注册表也可能有 `window.<Name> =` 这类模块顶层副作用，抓住编排层的那一个接缝，覆盖面远大于它的体积。⛔ 两侧**串行**求值，且每次运行给两侧取指纹、**URL 相同直接 FATAL**——并发探针会让第二个接到第一个拉起的浏览器，把一侧量两遍并报告**完美一致**。⛔ 用例分 `judged`（条件无关，逐字必须相同）与 `info`（条件相关，只打印但两侧都得解析得出来） | M2+（源站有可直接调用的接缝时） |
| `scripts/slice-modules.mjs` | **按模块 id 逐字切片**：边界由打包器给定，所以切片表就是一串 id，且工具能自校（`--check` 重切须字节一致）。转写的 webpack 运行时在文件头登记为偏差 | M2+（模块化打包产物） |
| `scripts/extract-source.mjs` | 字节切片器：按钉死行号区间切 `_pretty/` 拼成生成文件（sha256 守卫 + 切片表 + 别名/桩表，`--check` 进门），逐字移植首选形式（§2.2；配置样例 `scripts/slices.config.example.mjs`） | M2+（逐字移植期） |
| `scripts/probe.mjs` | CDP 无头探针（console/异常/网络 CLEAN 判定，退出码进 CI；`--no-external` 断言零外联、`--walk` 全滚动走查） | M0.5 起每 commit |
| `scripts/verify-routes.mjs` | 路由/重定向/状态码契约门 | M2+ |
| `scripts/verify-ssr.mjs` | SSR/DOM 逐字节门 | M2+（有 SSR 产物时最先建） |
| `scripts/pixelcompare.mjs` | 量化像素对拍（粗网格相似度 + metric 输出）。**视口 ≳ 1500×900 时 PNG 过不了 CDP 载荷硬顶**，改 `--format jpeg --quality 92`。**产出前先过非空帧前置条件**——两张空帧对拍会报 `meanAbsDiff 0 / 相似度 100`，与完美结果同形（实测：冻结把引擎停在首帧之前，三条路由全报 0，而那是 201 色 99.5% 纯黑）；`--pump dt,frames` 是 probe-shim 的一等驱动入口，且**与真实时间交错地泵**——冻结页的启动仍在墙钟上等资产，settle 之后一次性泵完会让引擎永远拿不到"资产已到达"的那一帧（`determinism.md` §2.9.1）。`--self` 是**自比带宽的合法通道**（§1.3.2 要求的那次测量按定义是一侧与自己比，会被跨侧假绿守卫拦下）——产物标 `kind:"self-band"`，且 `--max-mean` 对它失效：带宽是分类的**输入**，不是判决 | M(n-1) |
| `scripts/side-by-side.mjs` | 双侧截图并排合成图（对拍产物留证） | M(n-1) |
| `scripts/frame-census.mjs` | **这一帧上有东西吗**：数截图的颜色数与主色占比。⛔ 像素门已内置同一判据作前置条件，本脚本用于事后复核任意截图——`§4.8`「全部的门拍在同一个状态里」的那个状态可能是**空的**，而此前没有任何一道门会问这句 | M(n-1) |
| `scripts/probe-shim.js` | 确定性驱动 shim（接管整个熵面：rAF/timer/`performance.now`/`Date.now`/定种 `Math.random`/**IntersectionObserver**，手动泵到任意 t，双侧同位注入）。⭐ **IO 也是一个时钟**——浏览器按自己的节奏投递交叉记录，滚动揭示站因此无法冻结；接管后实测带宽 0.31 → **0.04**，门的可用阈值从 0.5 收到 0.1 | M(n-1) |
| `scripts/dump-timelines.mjs` | GLB 动画曲线 dump 成 JSON 数值账本 | M1（数据驱动动画时） |
| `tools/name-modules.mjs` | **模块提名**：模块化 bundle 的 id 是内容哈希，文件名要从证据里来。按 0–4 级证据提名并把**依据的那句话**一起记下（人工裁决 / 自注册与全局 / 多消费方字段名 / 常量值与命名前缀 / 报错主语），⛔ **无证据保留 id——错名比哈希更糟**。⭐ 最强的证据在模块外面：属性名不被压缩，`this._chapterPlayer = new M(…)` 能给一个匿名 `class {}` 命名 | M(n+1)（模块化打包产物） |
| `scripts/cold-audit-modules.mjs` | **M(n) 冷头清点（模块化产物）**：逐模块对账，并查有没有**计算出来的 require**（认 webpack 与 Turbopack 两种工厂签名）。⛔⛔ **必须报出 `n/N examined` 并把覆盖率当判据**——它曾在一个模块都没查的情况下报绿；改成「仅 0 时报错」之后，又在查了 1/20 时报绿。⛔ 实测抓到一处条件 require（`require(t ? "a" : "b")`）导致闭包少算两个模块，**而 9 个检查点逐像素全零毫无察觉**。⚠ 零依赖阶段分辨不了作用域遮蔽，所以只**判定**"有没有未移植模块被已移植模块 require"，疑似动态 require **列出来交人读** | M(n)（模块化打包产物） |
| `scripts/verify-module-map.mjs` | **M(n+1) 等价门（模块化产物）**：一模块一文件，且每个文件与打包器字节 **token 级一致**（只允许包装重命名那组一一映射）。⛔ 用文本把重命名 undo 回去比对会失败——`module.exports` 里的 `exports` 是属性名；**门用捷径就会测到自己的捷径**。⛔ 门也不许重跑重命名来比对 | M(n+1)（模块化打包产物） |
| `scripts/pixelcompare.mjs` 的 `--freeze-css` | ⛔ **冻 JS 时钟冻不住 CSS 动画**——`animation` 跑在浏览器动画时间线上，不经过 JS。症状是**同侧对照比跨侧还大**且最差格相同。该旗标把所有动画 `paused` + 固定负延迟钉在同一相位（⚠ 它改变被渲染内容，这正是目的：两侧定格在同一位置）。实测带宽 0.31 → 0.20，**仍未归零**：剩下的是 IntersectionObserver 门控的 canvas，shim 尚未接管 | M(n-1)（CSS 驱动的站） |
| `scripts/pixel-walk.mjs` | **检查点巡航**：在 N 个滚动位置各跑一次像素门。⛔ **滚两次**（`load` 时 + 虚拟时间 +1.5s 再一次）——页面在自己的 init 里重置滚动会**吃掉** load 时那一次，于是所有检查点都拍页顶而两侧一致地全绿。⛔ **重复帧要逐格报出来**：全局 distinct 计数在「9 格里 3 格重复」时照样通过。⛔ **单个 0.00 是这套工具能产出的最误导的数字**——它是一帧，通常是页面顶部的头两秒。⚠ 先用 `--self` 在同样的检查点上测带宽：实测未冻结时自比 4.6–5.0、跨侧 2.6–3.4，**差异整个落在噪声里**；冻结后两者都归零 | M(n-1) |
| `scripts/verify-decls.mjs`（范式，非本 skill 提供） | **esbuild 形态的分类门**：模块体裹在 `var X = VA(() => {…})` 惰性包装里、绑定以逗号链出现，双射式符号门在这里成片假红。正确形状是把每个 port 声明分类进 `declarations` / `collapsed` / `plumbing` / `omitted` 恰好一个桶，反向要求每个 src 声明有来源或登记理由。⭐ **门的形状要跟着产物的形状走**（`readable-source.md` §3.0.5） | M(n)/M(n+1)（esbuild 产物） |
| `scripts/verify-symbols.mjs` | **符号映射门**：`port/` 每个顶层声明在 `src/` 中有且仅有一个对应符号（双向单射，读 `docs/rename-map.json`），且 `src/` 里没有无来源的孤儿声明。⛔ **必需不是可选**——门只跑有限条路由，没被跑到的代码改坏了门是绿的；这是冷启动清点在重构阶段的同构物。⛔ 只读 `rename-map.json` 与两侧文本，**不许 import 重构器的 parser** 来"确认"重命名 | M(n+1) |
| `scripts/verify-fresh.mjs` | **新鲜度门**：`src/` → `dist/` → `site/` 是否同步。⛔ 链条上**只要有一步缺 `--check`，整条链的绿灯就可能过期**——过期的产物照样伺服，下游门照样全绿（它们比的是产物对镜像，不是产物对源码）。⛔ **时间戳不是判据**：实测一次 mtime 显示过期而重建字节完全相同。⚠ 必须同时查「产物是不是源码现在构建出来的」与「伺服的是不是那一份」——只查前者，缺口只是往下游挪一步 | M(n+1)（有构建步骤时每次） |
| `scripts/verify-standalone.mjs` | **自包含门**：把 `src/` 复制到临时目录 → 断网 → 安装 → 构建 → 跑 CLEAN 与零外联。⛔ **必须复制出去跑**——原地跑会命中项目根的 `node_modules`/`mirror/`/根 `package.json`，而这三样恰好是自包含要证伪的东西 | M(n+1) |
| `scripts/verify-zerodep.mjs` | **依赖分界门**：`scripts/` 下不许出现 node: 之外的 import，且没有任何门 import `tools/`。⚠ 存在的理由是这条纪律**被违反了八个版本**都没人发现——它的原文就写在被违反的文件上方三行。**只写在文档里、没有东西去查的规矩会安静失效** | 每次新增脚本 |
| `scripts/lib/png.mjs` | 零依赖 PNG 编解码 | 对拍脚本依赖 |
| `scripts/lib/chrome.mjs` | 无头浏览器生命周期（**进程组**收割 + 全退出路径 + 启动前孤儿自检；漏子进程会抬高参照侧自比带宽，把像素门调松）与 CDP 载荷硬顶常量。`node scripts/lib/chrome.mjs --all/--reap` 可查/回收残留 | 所有 CDP 脚本依赖 |

## 复刻工程目录结构

三个阶段性产物，**单向依赖，读作「证据 → 移植 → 源码」**：

```
<site>-rebuild/
├── mirror/               # ① 只读证据：源站 URL 空间的字节级还原。永不修改
│   └── _pretty/          #    beautify 展开产物 + 再生成说明 README
├── port/                 # ② 逐字移植：机器读，extract-source --check 守着字节一致。永不手改
│   └── _gen/             #    切片器产物（行号头指回 mirror/_pretty/）
├── src/                  # ③ 人写的工程：可读、可改、自包含（复制到任何地方都能跑）
│   ├── package.json      #    ⛔ 自己的 package.json——自包含门要把它复制出去单独跑
│   ├── assets/           #    资产在这里（③ 阶段必须复制，见 readable-source.md §2）
│   └── README.md         #    怎么跑 / 坐标系怎么读 / 哪些注释是我们写的
├── docs/
│   ├── engine-notes.md   # 逆向笔记（事实/怪癖/复刻结论三段式）
│   ├── rename-map.json   # ③ 阶段符号映射（port 位置 → 旧名 → 新名 → 依据档位）
│   └── compare/          # 对拍产物留证
├── REBUILD_PLAN.md       # §0 纪律 / 阶段计划 / §6 偏差表 / §Q 怪癖表 / §7 里程碑日志
├── mirror-manifest.json  # 镜像账本（sha256 逐文件）
├── scripts/              # 判据与前置工序：零依赖，从本 skill 拷入
└── tools/                # 重构器：③ 阶段专用，允许 devDependencies（见下）
```

⛔ **`src/` 里发现行为不对，答案在 `port/` 或 `mirror/`，不在 `src/`。** 就地"改到对"会把移植 bug 变成无法追溯的本地补丁，**而且门会变绿**——这是纪律 2 在三段坐标系下的形式。`port/` 在 `src/` 建成后不删除，它是等价性的另一端。

⭐ **依赖分界按阶段**：**源码化之前零依赖**——项目到 M(n+1) 才有 devDependencies。`scripts/`（判据与前置工序）零依赖，必要时 spawn 钉死版本的 npx；`tools/`（源码化重构器）允许 devDependencies。任何门不许 import 任何重构器。由 `scripts/verify-zerodep.mjs` 守。

## References

按需加载（Step 0/1 与分支路由表决定），不要开局全量读入：

- [scope-and-fingerprint.md](references/scope-and-fingerprint.md) — 第 0 步判级与路由（必经）
- [recon-and-rating.md](references/recon-and-rating.md) — 开工侦察与难度评级（必经）
- [mirroring.md](references/mirroring.md) — 镜像取证全流程（必经）
- [reverse-engineering.md](references/reverse-engineering.md) — 行号坐标系与逆向笔记（必经）
- [porting-discipline.md](references/porting-discipline.md) — 溯源移植纪律（必经）
- [verification-gates.md](references/verification-gates.md) — 验收门选型与失效模式（必经）
- [determinism.md](references/determinism.md) — 确定性冻结协议与 probe-shim
- [dom-shell-strategies.md](references/dom-shell-strategies.md) — DOM 层策略选型（A/B/C + 正交约束 D）
- [webgl-scenes.md](references/webgl-scenes.md) — WebGL/GLSL 场景逆向
- [animation-recovery.md](references/animation-recovery.md) — 动画/输入逆向路径
- [binary-formats.md](references/binary-formats.md) — 私有二进制格式
- [shopify-platform.md](references/shopify-platform.md) — Shopify 平台层剥离（B 类）
- [asset-management.md](references/asset-management.md) — 资产不复制策略与字体决策
- [environment-traps.md](references/environment-traps.md) — 环境陷阱手册
- [legal-and-deploy.md](references/legal-and-deploy.md) — 版权取证与部署决断（取证归 skill，决定归用户）
- [readable-source.md](references/readable-source.md) — M(n+1) 源码化：port/ → src/ 的可读工程（拆模块、去混淆、注释纪律、自包含契约）
- [rsc-reconstruction.md](references/rsc-reconstruction.md) — C1（RSC）重构式逆向：flight 坐标系、MDX 反推、语义门、平台层工件
- [assets/templates/rebuild-plan.md](assets/templates/rebuild-plan.md)、[assets/templates/engine-notes.md](assets/templates/engine-notes.md) — 文档模板

## Notes

- **版权红线**：本 skill 用于学习目的的复刻。产出默认私有 + noindex（安全默认，不是法务结论）；公开部署前必须完成逐资产版权取证、把决定交回用户、并显著标注非官方复刻与原作者归属。最大风险是法务不是技术——但**法务判断由用户作出，且永不用于削减镜像完整性或门的覆盖面**。
- **工期预期**：方法论成熟形态下，单页创意站 1-3 天（数十个 commit）；多场景 WebGL 作品集站按周计。向用户给预估时参考 Step 1 的难度评级。
- **对拍失败先怀疑环境**：后台节流、HMR 幽灵模块、探针时钟、headless 字体缺失都会伪装成代码 bug。判定源码问题前先过 environment-traps.md 的校准清单。
- 遇到本 skill 未覆盖的场景（B 类缺口），明确告诉用户"这一段没有既成指南，按通用纪律推进"，并把新经验记入项目文档——它们是 skill 下一版的输入。
