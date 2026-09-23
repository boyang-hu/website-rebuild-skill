# scripts/ — 零依赖工具脚本

全部为零依赖 Node 脚本（Node 22+ 内置 fetch / WebSocket 直连 CDP，不装任何 npm 包；个别工序 spawn 钉死版本的 npx，但从不 import）——六项目一致的工具哲学："避免工具链自身版本漂移污染比对"。站点相关常量已提升为 CLI 参数或文件顶部 CONFIG 块（各文件头部有用法示例与传承注释）。

## ⚠ 端口与实例身份（`lib/ports.mjs`，凡起服务/起浏览器的脚本都受此约束）

**串台既造假红也造假绿**，而假绿是不可见的：两个进程连到同一个浏览器/服务时，你会拿到一份完美的双侧对拍报告，而它测的是同一侧。旧版每个脚本各自 `9222 + random*500` / `CDP_PORT || 9333` / `PORT || 5175`，区间重叠且默认值全局固定（实战事故见 shopifydesign §8.30：前台探针连上后台自比脚本的浏览器，报回"复刻侧有 19 次到镜像端口的外联"）。现在统一为：

    端口 = 21000 + slot×1000 + lane×10 + side        # 21000..29999

- **slot（0..8）= 一个工作区**：由 git 根路径哈希得到，同机多项目并发默认不撞；`WRS_PORT_SLOT` 可显式指定（同一项目要并发跑两份同名脚本时也用它）。
- **lane（0..99）= 一个脚本角色**：编号写死在 `lib/ports.mjs` 的 `LANES` 里，**当 ABI 对待**；10–49 已为项目自带的 CDP 门（scroll/audio/scene-graph…）预留，50–99 留给项目自定义。
- **side（0..9）= 对拍的哪一侧**：`1=mirror 2=rebuild 3=live 0=不分侧`。所以**端口自己说明自己是谁**：`25001` 是镜像服务、`25002` 是复刻服务、`25012` 是探针在探复刻侧。
- **占用即响亮失败**（退 3，并打印占用方是谁：CDP 端点/serve.mjs 的 side+root+pid+token/普通 HTTP）。**绝不静默换端口**——换了端口的进程，伙伴脚本就会去跟留在原地的东西说话，这正是假绿的成因。
- **显式覆盖照常支持**（`--port` / `--cdp-port` / `PORT` / `CDP_PORT`），覆盖值一样走占用预检与身份校验，日志里标 `[EXPLICIT]`。
- **最后一道闸是身份校验，不是端口**：CDP 脚本用随机 sentinel 页启动浏览器，attach 时只认自己那一页，认不出立刻退 3 并打印实际看到的 target 列表；`serve.mjs` 每个响应带 `x-wrs-identity` token 并提供 `GET /__wrs/identity`，`pixelcompare.mjs` 据此断言 A/B 确实是两个进程（同 origin、或两个 URL 同一 token，都判死）。

    node scripts/lib/ports.mjs          # 打印本工作区的完整端口表
    node scripts/lib/ports.mjs 25012    # 反解某个端口是谁

## ⚠ 浏览器进程与 CDP 载荷（`lib/chrome.mjs`，凡起无头 Chrome 的脚本都受此约束）

**漏一个渲染进程 = 把像素门调松了。** 旧版收尾一律 `chrome.kill('SIGKILL')`——那只杀浏览器主进程，它已经 fork 的 6–8 个 renderer/GPU/network 子进程不在信号范围内，父进程一死就被 reparent 到 pid 1 继续跑（实测：129 个存活 Chrome / 约 16 个泄漏 profile，最老 2 天 1 小时，"什么都没在跑"而 load average 8.7）。这不是整洁问题：像素门的容差不是手挑的 epsilon，而是**参照侧自己跟自己跑 N 次**得到的自比带宽，背景负载让这 N 次彼此更不一致 → 带宽变宽 → `cross ≤ selfBand + k` 静默原谅真实的跨侧残差。**一个进程泄漏 bug 会让整道像素门变松。**（带宽还有一条"测量中途不许改仪器"的规矩，所以持续增长的泄漏不止是抬高带宽，而是让 N 次会话不可比。）

现在统一为 `lib/chrome.mjs`：

- **收进程组，不收进程**：`spawn(..., { detached: true })` 让 Chrome 成为进程组长，子进程继承同组，收尾 `process.kill(-pid, …)` 一次带走全部；**先 SIGTERM 后 SIGKILL**（留出关 profile 的时间）。
- **覆盖全部退出路径**：`exit` / `SIGINT` / `SIGTERM` / `SIGHUP` / `uncaughtException` / `unhandledRejection` 都收割。正常收尾是这几条里**最不重要**的一条——现场泄漏全部来自另外几条。`exit` 处的收割必须同步（用 `Atomics.wait` 而非 Promise）。
- **临时 user-data-dir 即身份**：`<tmp>/wrs-chrome-s<slot>-<role>-p<port>-XXXXXX`，收尾删除。这个名字才让"这 129 个 Chrome 里哪些是我的"成为可判定问题，也把清扫范围限死在本工具链自己起的实例上（永远碰不到你自己的浏览器）。
- **启动前自检**：每个脚本先扫本工作区同角色的**孤儿**实例（`ppid == 1`，即启动它的脚本已死），**响亮报出**（pid / 存活时长 / profile 路径 + 上面那条因果）再回收，然后才做端口预检——顺序反了的话，自己上一轮留下的残骸会变成一句要手工清理的"端口被占"。**判据是孤儿而不是同名**：活着的兄弟进程有活着的父进程，一律不碰，那种情况归 `lib/ports.mjs` 的端口闸响亮裁决。

<!-- -->

    node scripts/lib/chrome.mjs          # 列出本工作区的实例（ORPHAN 会标出来）
    node scripts/lib/chrome.mjs --all    # 本机所有工作区
    node scripts/lib/chrome.mjs --reap   # 回收列出的孤儿（连同其进程组）

**截图有传输层硬顶，且旧版表现为无声超时。** `Page.captureScreenshot` 把整帧作为**一条** base64 WebSocket 消息回传，而 Node 内置 WebSocket 会在消息过大时直接 `close 1006`——此后每条 CDP 调用都超时且没有自己的错误信息。实测（objectandarchive D-G6，同机同 Chrome）：`1280×800 png` = 2,395,616 字符可用（280ms）；`390×844 png` = 734,240 可用；`1728×1080 jpeg q100` = 1,995,384 可用（106ms）、`q92` = 827,968 可用（**58ms**）；**`1728×1080 png ≈ 3.6M` → 直接 1006**。可用上界在 2.40M–2.72M 之间。换一台机器（Chrome 150 / Node 22）复测：入站 3.33M 可用、出站 4.37M 可用，而 1728×1080 的**噪声** PNG（≈7M）照样死——**上界随机器/版本浮动，2.4M 是可以依赖的线，不是断裂点**。处置三条：

- **失败必须响亮**：所有 CDP 客户端都装 `onclose`（拒绝在飞的调用）**加**逐调用超时，截图失败打印"载荷超限：`<size>`，视口 `<w×h>` 格式 `<fmt>`"+ 可操作的降级清单，退 4。**无声超时是最坏的失败形态**——它不告诉你任何事。
- **可行的规避**：`probe.mjs` / `pixelcompare.mjs` 新增 `--format png|jpeg --quality N`（默认仍 PNG 以保字节保真；`probe.mjs` 的 `--shot x.jpg` 会按扩展名自动切 jpeg）。**什么时候必须降**：视口 ≳ 1500×900 且内容是照片/噪声类时 PNG 到不了岸，改 `--format jpeg --quality 92`（58ms/张）。字节门保持 PNG；像素/指标门用 q92 已实测无编码噪声（同一静止态连拍两帧逐字节相同）。
- **注意二次放大**：`pixelcompare.mjs` 的指标与合成步骤把**两帧**内联进一条 `Runtime.evaluate` 再取回结果，所以那条消息约为单帧的 2 倍——两张截图都过了却死在指标步是正常的，这两步失败时会点名是哪一步、内联了多少字符。

## ⚠ 镜像有自己的门（`verify-mirror.mjs`）

下游每一道门问的都是**"渲染得出来吗"**——零 404、零控制台错误、零外联、像素差多少。没有一道问**"字节对不对"**。所以一个错的镜像可以让所有门全绿：查询参数化的图片 CDN 上 `x.jpg?width=320/600/1200` 是三份不同字节，按 pathname 映射会把它们坍缩成一个文件（谁最后写谁赢），服务端每个 `?width=` 都回同一个文件，srcset 给 1200px 的槽选了 32px 的图，**页面照样渲染**。抓包那一遍按 url+search 记账、按 pathname 查盘，于是从第二个变体起全报 HAVE——GAP=0，假的。

结论写成纪律：**镜像层的缺陷只能在镜像层抓**。抓完镜像先跑 `verify-mirror.mjs`（映射单射性 / 账本一致性 / **真实性** / 闭包 / 可选抽样回源），它绿了，下游的门才有意义。四方共用 `lib/urlpath.mjs`（映射）与 `lib/extract-refs.mjs`（引用提取 + "什么算文本"）也是同一条纪律的结构形式：**门不能自带一份被审对象的实现**，否则它继承的正是它要抓的盲区。

**再往下一层同样成立：门的输入本身可能是错的，而门会在错的输入上正确地报绿。** 闭包门实测**三次**假绿都不在判据上——① 引用集少了一整类**转义拼写**的引用（`https:\/\/host\/…`），差集在一个短了 60 条的集合上算出"= ∅"；② **豁免的匹配粒度**过宽，一条基址豁免按前缀吞掉了整个子树；③ **"什么算文本文件"是一张扩展名白名单**，`.atom` / `.xml` / `.rss` / `.txt` 全在名单外，**爬虫与门共用同一个盲区**所以谁也看不出来（实测 16 份 `.atom`，引用集 3,109 → 3,521）。三条都修在这一层（详见下表两行），教训写成一句话：**"= ∅"只说明这两个集合相减为空，它说不出这两个集合本身是不是齐的**——所以对着门看"它断言了什么"不够，还要问"它拿到的是什么"。

**再往下还有一层，而这一层与上面全部正交：一个 HTTP 200 不是"你拿到了那个资源"的证据。** 上面每一项——单射性、账本 sha256、覆盖度、闭包——校验的都是"**账本与磁盘是否自洽**"，而它们可以在**每一份字节都是 bot 挑战页**的情况下诚实地全绿。实测（objectandarchive M0b）：3 workers 的整站重抓触发源站挑战，**43 份挑战页被写在各自页面的 URL 下**，包括整个逆向工作所依据的那份文档；`verify-mirror` 全程 **PASS 0 而且没有错**——账本记的是"你抓到了什么"，从不记"它是不是你要的那个"。当时唯一的反对者是**构建层的逐条变换命中下限**（挑战页里没有那个平台脚本，命中 4 < 下限 5）。所以现在有第三项断言（AUTHENTICITY）：**挑战正文匹配**（硬红，可 `--interstitial-extra` 扩展）+ **声明类型对魔数字节**（硬红，判据的依据是**源站声明的 content-type**，不是 URL 扩展名）+ **同类体量离群**（只报线索，不判红）。

## 命令行约定（`lib/cli.mjs`，v0.3.17 起全部脚本一致）

每个脚本第一件事是 `cli({ known, bools, file: import.meta.url })`：**`--help`/`-h`** 打印文件头注（用法一直住在那里）+ 旗标清单 + skill 版本，退 0；**`--version`** 打印 skill 版本（项目里的 `scripts/` 是拷贝，这个数字是判断它有没有落后的唯一依据）；**未知旗标一律 FATAL 退 2** 并列出已知集（此前 57 个脚本里只有 9 个这么做，`--settle` 给了只认 `--wait` 的工具、静默跑在 6 秒默认值上买过三小时追凶，`verification-gates.md` §2.1.3）。它只校验 argv 的形状，各脚本自己的 `flag()` 读法一个字不改。selftest 对每个脚本扫 `--help` 退 0 与未知旗标退 2，并断言头注用法行里出现的每个旗标都在已知集里。

## 退出码约定（`lib/cli.mjs` 的 `EXIT`）

| 码 | 含义 | 谁在用 |
|---|---|---|
| 0 | 门绿 / 任务完成 | 全部 |
| 1 | 门红：被测对象不对（或工具读不到自己的账本） | verify-*、make-standalone、netcapture `--fetch` |
| 2 | 调用错误：缺参 / 参数无效 / 未知旗标 / 配置坏 | 全部（`lib/cli.mjs` + 各脚本 usage） |
| 3 | 身份：端口被占、side 不符、attach 到别人的浏览器 | `lib/ports.mjs` 家族 |
| 4 | CDP 传输死了（载荷硬顶、close 1006、超时） | probe / pixelcompare |
| 5 | 前置条件不成立：认不出容器、一个都没查到、空帧 | module-map / name-modules / cold-audit / pixelcompare 空帧 |
| 6 | 页面没到达要求的状态（`--ready` / `--hold`） | pixelcompare / pixel-walk |
| 130 | Ctrl-C，账本已落盘 | mirror-site |

⚠ 5 在 pixelcompare 里是"空帧"、在 module-map 里是"认不出容器"——同为"前置条件不成立"，读退出码时按表里的含义读，不要按脚本名猜。新脚本从 `EXIT` 取常量，不要再写裸数字。

## 脚本索引

一行一个脚本。**这张表回答「选哪个」；「怎么跑」由脚本自己回答**——每个脚本的完整规格（旗标、断言、语义）住在它的文件头注里，`node scripts/<x>.mjs --help` 原样打印；**为什么这么设计**的实证见 [references/case-studies/scripts.md](../references/case-studies/scripts.md)。三处各归一处：表里不再复述头注，头注不再讲故事。

| 脚本 | 用途 | 阶段 | 出处 | 成熟度 |
|---|---|---|---|---|
| `scripts/fingerprint.mjs` | Step 0 六步探测协议的跨平台等价实现（无 curl/cmp 也能跑） | Step 0（无 POSIX 工具链时） | 新写（把 §2 手工协议脚本化，协议内容零发明） | 中（逐条对照 §2 实现 + 实站冒烟三路：byte-identical / 301 链 / <1KB Referer 重试；未经完整项目实战） |
| `scripts/mirror-site.mjs` | BFS 爬虫镜像：资产白名单迭代到不动点，三本账逐文件 sha256 | M0 第一遍 | lando 版（rogier→noomo→lando→shopifydesign→objectandarchive 五代传承） | 高 |
| `scripts/wayback-mirror.mjs` | X 类抢救：把死站从 Wayback 抢成标准镜像 | M0（X 类死站抢救） | darknetflix/umamiland 版(v0.2.4) | 高(两个死站实跑:312+123 文件、0 抓取失败、洞账如实) |
| `scripts/netcapture.mjs` | 真实浏览器 CDP 抓包，对账补录运行时资源（CDN 站必传 --hosts） | M0 第二遍 | kimi 版（+shopifydesign host 白名单，+objectandarchive 共享映射） | 高 |
| `scripts/verify-mirror.mjs` | 镜像自己的门：单射 / 账本 / 真实性 / 闭包，跑在一切下游门之前 | M0 关账前，每次重抓镜像后 | 新写（objectandarchive M0 的五条镜像层缺陷是它的需求书 + M(n) 的 D-T10） | 高（本仓 fixture 实跑：旧爬虫产出的真实坍缩被映射与账本两项逐条抓出；错误 `--query-ignore` 当场判死；豁免语义 fixture 修前把基址下两个真缺文件静默豁免、修后逐条报出，整 host 豁免与 `*` 显式前缀各自照常。**AUTHENTICITY 与文本判定 fixture**：挑战页 + 声明 `image/png` 而正文是 HTML 的文件各自逐条报红，声明 `font/woff2` 的 `.woff` **不误报**；360 KB 真页面里嵌 reCAPTCHA + PerimeterX **不误报**；同一份完整镜像上旧门扫 1 个文件报 "= ∅"、新门扫 3 个文件看见 5 条引用，**人为删掉两个真资产后旧门照样 PASS 0、新门逐条报红**） |
| `scripts/gapfill-video.mjs` | HLS / DASH 流媒体阶梯补录 | M0（有流媒体时） | racingshop 版（通用化：递归下降 + 相对 URI 解析 + 备用轨道/fMP4 分支） | 高（racingshop 实战验证扁平阶梯；递归与备用轨道分支为通用化新增，已用 fixture + 原站数据回归） |
| `scripts/reconcile-gaps.mjs` | 运行时缺口对账器：GAP 行 + 字节推导全集，逐条补进镜像 | M0（运行时资源多的站） | rauchg 版 | 高（rauchg 实战 1,600+ URL 零失败） |
| `scripts/flight-decode.mjs` | C1 的坐标系：把每页内联的 flight 流解成可寻址的树 | M1（C1） | rauchg 版 | 高（19 文档全解；selftest 合成流夹具） |
| `scripts/verify-flight.mjs` | C1 语义门：重构工程与镜像 flight 树逐语义比对 | M(n-1)（C1） | rauchg 版 | 高（18/18 路由收口；selftest 绿/红双面夹具） |
| `scripts/serve.mjs` | 零依赖静态服务器：MIME / Range / 重定向回放 / ext 改写 / 桩主机，带实例身份 | M0.5 起全程 | noomo+lando 合并版（samsy→kimi→noomo→lando→racingshop→shopifydesign→objectandarchive；kimi 的 RSC 层需按项目自加） | 高 |
| `scripts/probe.mjs` | CDP 无头探针：404 / 控制台错误 / 外联 / 截图，一页一报 | M0.5 起每 commit | lando 版（rogier 探针家族→samsy regression→lando→shopifydesign） | 高 |
| `scripts/verify-routes.mjs` | 路由 / 重定向 / <head> 契约门，状态码也比 | M2+ | kimi 版 | 高（CONFIG 需按项目填写） |
| `scripts/verify-ssr.mjs` | SSR 逐字节契约门：body DOM / 载荷 / 运行时配置对镜像 | M2+（有 SSR 产物时最先建） | noomo 版 | 高（提取器为 Nuxt 专用，换框架需替换） |
| `scripts/pixelcompare.mjs` | 量化像素对拍：自比带宽 + 跨侧残差，非空帧与双进程前置 | M(n-1)；`--freeze-css` 时 M(n-1)（CSS 驱动的站） | samsy 版为主 | 高（驱动到特定状态的逻辑属调用方） |
| `scripts/side-by-side.mjs` | 双侧截图并排合成图（展示用，不是门） | M(n-1) | kimi 版 | 高 |
| `scripts/probe-shim.js` | 确定性驱动 shim：冻 rAF / 时钟 / 随机，让两侧采到同一时刻 | M(n-1) | noomo 版（+shopifydesign 熵面补全） | 高 |
| `scripts/dump-timelines.mjs` | GLB 动画曲线 dump 成 JSON 数值账本 | M1（数据驱动动画时） | noomo 版 | 中（GLB 专用，范式可泛化） |
| `scripts/beautify-bundle.mjs` | 钉版本 js-beautify 展开 bundle 到 _pretty/，行号即溯源坐标 | M1 | 新写薄封装（oryzo 引入流程、samsy 钉版本、kimi/noomo/lando 统一 1.15.1） | 中（新写，未经项目实战） |
| `scripts/extract-source.mjs` | 字节切片器：按 _pretty/ 行号区间逐字取出源 | M2+（逐字移植期） | shopifydesign 版（原脚本切片表硬编码，通用化为配置驱动） | 高（shopifydesign 实战：M2 33 段/2,475 行，M3 增至 41 段；配置化 + `--balance-check` 为通用化新增，已 fixture 验证切片/守卫/`--check`/边界错四路） |
| `scripts/module-map.mjs` | 模块化 bundle 的分层表：认容器、列模块、连依赖边 | M1（模块化打包产物） | airpodspro 版 | 中 |
| `scripts/closure.mjs` | 从种子模块算传递依赖闭包，竖切边界的唯一依据 | M2+（模块化打包产物） | airpodspro 版 | 中 |
| `scripts/slice-modules.mjs` | 按模块 id 逐字切片，gen 头带完整再生成命令 | M2+（模块化打包产物） | raycastkbd 版 | 中 |
| `scripts/harvest-cases.mjs` | 从源站活引擎采用例（基线的 A 侧） | M2+（源站引擎可达时） | airpodspro 版 | 中 |
| `scripts/verify-harvest.mjs` | 采集基线的 B 侧：港口按行为复现源站的用例 | M2+（有采集基线时） | airpodspro 版 | 中 |
| `scripts/verify-crossside.mjs` | 跨侧门：两侧同一输入，比输出 | M2+（源站有可直接调用的接缝时） | airpodspro 版 | 中 |
| `scripts/verify-zerodep.mjs` | 依赖分界门：scripts/ 只许 node: 与相对导入，门不引生产者 | 每次新增脚本 | airpodspro 版 | 中 |
| `scripts/build-site.mjs` | 策略 A 构建层：按变换表把镜像外壳变成复刻外壳 | M2+（策略 A） | racingshop 版（v0.1.17 无人值守闭环） | 高 |
| `scripts/verify-shell.mjs` | 外壳字节门：每个差异 hunk 必须能由变换表重放 | M2+（策略 A） | racingshop 版（v0.1.17） | 高 |
| `scripts/verify-offline.mjs` | 零外联门的静态一半：预连接 / 内联信标 / 回退路径 | M0.5 起每 commit | racingshop 版（v0.1.17） | 高 |
| `scripts/verify-payload.mjs` | SSG payload 门：把内联数据当数据比，不当文本比 | M0.5 起（有 SSG payload 时） | noomo 版谱系（v0.1.19；v0.1.71 Nuxt 3 外置载荷；v0.1.73 `--allow-absent`） | 高 |
| `scripts/verify-lenprefix.mjs` | 自带长度的载荷门：flight T 行声明多少字节就得有多少 | M0.5 起（有 flight 载荷时） | eightdesign 版（v0.1.61） | 高 |
| `scripts/verify-refs-served.mjs` | 引用可达门：产出里每条资源引用逐条问服务器 | M2+ 起每 commit | eightdesign 版（v0.1.68；v0.1.72 `--allow`） | 高 |
| `scripts/verify-standalone.mjs` | 自包含门：src/ 复制到任何地方断网可跑 | M(n+1) | eightdesign 版（v0.1.64） | 高 |
| `scripts/verify-fresh.mjs` | 新鲜度门：dist 是否等于此刻从 src 重建的字节 | M(n+1)（有构建步骤时每次） | eightdesign 版（v0.1.64） | 中 |
| `scripts/verify-symbols.mjs` | 符号映射门：port/ 每个顶层声明在 src/ 里恰有一个去处 | M(n+1) | airpodspro 版（v0.1.24） | 高 |
| `scripts/verify-module-map.mjs` | M(n+1) 等价门：src/modules 每个文件与打包器字节 token 级一致 | M(n+1)（模块化打包产物） | airpodspro 版（v0.1.46） | 高 |
| `scripts/cold-audit-modules.mjs` | M(n) 冷头清点：闭包里每个模块都被 port 覆盖，报 n/N examined | M(n)（模块化打包产物） | airpodspro 版（v0.1.46；v0.1.73 箭头工厂；v0.3.15 单参工厂） | 高 |
| `scripts/cold-audit-decls.mjs` | M(n) 冷头点名：扁平 bundle 的顶层声明逐个归桶 | M(n)（扁平产物；手写移植形态的第一段裁判） | samsy 版（v0.3.14） | 高 |
| `scripts/verify-tween.mjs` | 竖切的数值门：同一关键帧规格喂两个引擎，比写出的值 | M2+（有补间/时间轴引擎时） | airpodspro 版（v0.1.36） | 中（切片专用范式） |
| `scripts/frame-census.mjs` | 这一帧上有东西吗：事后复核任意截图是不是空帧 | M(n-1) | racingshop 版（v0.1.21） | 高 |
| `scripts/census-bundles.mjs` | 无容器产物的 chunk 级坐标账本 | M1（无容器产物） | hashgraphvc 版（v0.2.0） | 高（对原项目 33/33 sha 交叉一致） |
| `scripts/slice-esm.mjs` | 拼接式分解切片器：parts 逐字节拼回 chunk | M2+（拼接式分解） | hashgraphvc 版（v0.2.0） | 高（33 chunk / 44.9 万行 → 2,043 件全数重拼一致） |
| `scripts/verify-reassembly.mjs` | 重拼门：每个 part 的 sha256 与拼接后的 chunk 哈希都对得上 | M(n+1)（拼接式分解） | hashgraphvc 版（v0.2.0） | 高 |
| `scripts/sweep-routes.mjs` | 渲染广度门：全路由一个浏览器跑完，逐路由记错误 / 失败 / 外联 | M0.5 起（全路由广度） | overworld/milknetwork 版(v0.2.3) | 高(20 路由含音频钩子 4.4 分钟全清;122 路由 7.5 分钟,正确复认已登记的 Vimeo 401) |
| `scripts/pixel-walk.mjs` | 检查点巡航：N 个滚动位置上跑像素门，先测自比带宽 | M(n-1) | shopifydesign 版（v0.1.52） | 高 |
| `scripts/lib/ports.mjs` | 端口分配 + 实例身份注册表（slot / lane / side） | 所有起服务 / 起浏览器的脚本依赖 | 新写（shopifydesign §8.30 串台事故的根治） | 高（本仓 fixture 实跑验证：并发不冲突 / 占用响亮失败 / 双侧各连各的） |
| `scripts/lib/chrome.mjs` | 无头浏览器生命周期：进程组收割、孤儿回收、载荷硬顶 | 所有 CDP 脚本依赖 | 新写（objectandarchive Mn-1a 仪器教训 #5 + D-G6） | 高（实跑验证：正常收尾 / SIGINT / SIGTERM 后零残留；SIGKILL 制造 11 个孤儿后下一轮自检全数回收并清 profile；1728×1080 PNG 复现 close 1006 并响亮退 4；jpeg q92 全程跑通） |
| `scripts/lib/urlpath.mjs` | 唯一的 url→本地路径映射（查询感知），爬虫与门共用 | mirror-site / netcapture / serve / verify-mirror 共用 | objectandarchive 版（D-T1） | 高（本仓 fixture 实跑：同路径不同 query 落到不同文件；排序无关；敏感字符不撞名） |
| `scripts/lib/extract-refs.mjs` | 唯一的资产引用提取器 + 唯一的「什么算文本」判定 | 爬虫与 verify-mirror / verify-refs-served 共用 | objectandarchive 版（D-T2 + D-T10） | 高（本仓 fixture 实跑：5 候选 srcset + imagesrcset 全数提取，旧版同页只提到 1 条 `src=`；6 种转义拼写修前引用集 1、修后 8。**真镜像差分实跑**：objectandarchive 的 197 个文本文件上 1,587 → 1,767，**0 丢失**，新增里含该项目版权审计手工找出的那 2 个 woff2；对着该项目自己那版"补两条转义正则"的修法再差分，仍多出 **121 条**——JSON-LD 里 `"image":"https:\/\/host\/….jpg?v=…\u0026width=1920"` 这种**一条字符串里两种转义**，按 `\/` 写的形状会在 `\u0026` 处停下，于是引用不是丢失而是被**截断**成 `?v=…`，而那个 URL 在查询感知映射下是**另一个确实在盘上的文件**——门照绿） |
| `scripts/lib/negotiate.mjs` | 内容协商 Accept 策略与 std→bare 请求头梯子 | mirror-site / reconcile-gaps / fingerprint 依赖 | basement D5（v0.3.9）+ v0.3.18 收拢 | 高（selftest 钉合同 + 回环 403/404/302 梯子） |
| `scripts/lib/png.mjs` | 零依赖 PNG 编解码 + 图像统计 / 比对，恒输出 RGBA | 对拍脚本依赖 | kimi 版 | 高 |
| `scripts/lib/cli.mjs` | 唯一的 argv 合同：--help / --version / 未知旗标 FATAL / 退出码表 | 全部脚本 | v0.3.17 新写（评审回哺） | 高（selftest 逐脚本扫） |
| `scripts/lib/hash.mjs` | 唯一的 sha256 拼写 | 全部账本与门 | v0.3.18 收拢 | 高（selftest 往返） |
| `scripts/lib/ledger.mjs` | 镜像三本账的唯一读写实现 | mirror-site / verify-mirror / make-standalone 共用 | v0.3.18 收拢（四个写入方 / 六个读取方归一） | 高（selftest 往返 + mirror-site 回环爬取） |
| `scripts/lib/cdp.mjs` | 唯一的 CDP 客户端：有界调用，断连响亮 | 所有 CDP 脚本依赖 | v0.3.18 收拢（probe / pixelcompare / netcapture / sweep-routes / ports） | 高（真 Chrome 冒烟：probe / sweep / pixelcompare 跨侧与自比） |
| `scripts/verify-tokens.mjs` | token 流等价门 | M2+（排版字节交付时每 commit） | v0.3.10 新写（14islands L2 收口回哺） | 高（selftest 绿/红双面） |
| `scripts/verify-nextdata.mjs` | pages router 载荷门（__NEXT_DATA__） | M0.5 起（pages router 站） | v0.3.10 新写（14islands L2 收口回哺） | 高（selftest 绿/红双面） |
| `scripts/emit-webpack-chunk.mjs` | 多 chunk webpack 站的逐字再发射 | M2+（webpack 多 chunk 站） | v0.3.10 新写（14islands L2 收口回哺） | 中 |
| `scripts/lib/tokens.mjs` | token 流读法（verify-tokens / verify-module-map 共用） | beautify-bundle / verify-tokens 依赖 | v0.3.10 新写（14islands L2 收口回哺） | 高（selftest） |
| `scripts/lib/flight.mjs` | flight 流的解析与寻址（flight-decode / verify-flight / verify-refs-served 共用） | C1 与 flight 载荷门依赖 | rauchg 版谱系 | 高（selftest 合成流夹具） |
| `scripts/lib/shell-build.mjs` | 策略 A 的变换表执行器（build-site 与 verify-shell 共用同一份，门不自带实现） | M2+（策略 A） | racingshop 版（v0.1.17） | 高（selftest 绿/红双面） |
| `scripts/lib/version.mjs` | 这份 scripts/ 拷贝自哪个 skill 版本；`--help` / `--version` 都打印它 | 全部脚本 | v0.3.17 新写 | 高（selftest 钉 SKILL.md frontmatter） |
| `scripts/lib/npx.mjs` | 唯一的「钉死版本 npx 调用」拼写：POSIX 直接 spawn，Windows 经 `cmd.exe /d /s /c npx`（.cmd 垫片不能直接 spawn） | beautify-bundle / module-map / slice-esm / cold-audit-decls / verify-module-map / lib/tokens 依赖 | Windows 兼容修复 | 中（Windows 上 selftest 实跑 acorn / js-beautify 用例） |

范式行——本 skill 不提供实现，写在这里是因为它定义了一种门的形状：

| 范式 | 形状 | 阶段 | 出处 | 成熟度 |
|---|---|---|---|---|
| `scripts/verify-decls.mjs`（范式，非本 skill 提供） | **esbuild 形态的分类门**：模块体裹在 `var X = VA(() => {…})` 惰性包装里、绑定以逗号链出现，双射式符号门在这里成片假红。正确形状是把每个 port 声明分类进 `declarations` / `collapsed` / `plumbing` / `omitted` 恰好一个桶，反向要求每个 src 声明有来源或登记理由。⭐ **门的形状要跟着产物的形状走**（`readable-source.md` §3.0.5） | M(n)/M(n+1)（esbuild 产物） | — | — |

## TODO（未打包的缺口，需要时去源项目手工移植）

- **extract-i18n.mjs**（括号配平 + 隔离 vm 求值抽取 bundle 内数据成 JSON，键集交叉校验）——抽取式移植范式，但解析逻辑绑定具体 bundle 结构。移植自 `careers-kimi-rebuild/scripts/extract-i18n.mjs`。
- **regression.mjs**（状态全遍历 CDP 回归：localStorage 预种、逐状态截图断言）——状态机定义站点专用，probe.mjs 已覆盖单页探测。移植自 `samsyninja-rebuild/scripts/regression.mjs`。
- **gen-shells.mjs / gen_components.py**（DOM 外壳生成：零重写流水线 vs 保守切组件）——策略绑定站点类型（见 dom-shell-strategies 分支），不宜做成单一通用脚本。移植自 `landonorris-rebuild/scripts/gen-shells.mjs` / oryzo 的 `gen_components.py`。
- **dump-scene-graph.mjs（运行时场景图 dump 成数值账本）**——评估后不纳入：shopifydesign 那份是源站 bundle 里某个内部函数的逐字转写，换个站点连挂载点都不存在。范式（先 dump 源站数值再移植再数值验收）已由 `dump-timelines.mjs` 代表；需要时按目标站的引擎重写一份。
- **rogier 的 capture.mjs / analyze-home-bands.mjs**（行亮度剖面分析）——依赖 sharp，违反零依赖哲学，未纳入；等价能力可用 `lib/png.mjs` + 自写剖面重做。
- **racingshop 的 gapfill.mjs（协议相对 URL 归一重解）**——评估后不纳入：它修的是爬虫把 `//host/path` 拼成 `https://origin//host/path` 的 bug，而 `mirror-site.mjs` 已在提取阶段就把协议相对 URL 归一成 `https://host/path`，根因不再产生，留着只会诱导别人跑一个针对不存在故障的补丁。若历史镜像里已有这类损坏条目，一次性重解那份 manifest 即可，不需要常备脚本。
- **kimi 确定性冻结协议（八协议表）**——是文档/协议不是脚本，应进 references/，不在本目录范围。
- **layer-report.mjs（内联块四层归属门）**——`shopify-platform.md` §0.3 步骤 5 把它定为 M1 关账条件，但本 skill 暂未提供实现。机械部分通用（枚举 `<script>`、先掩 HTML 注释、块正文 sha256、与归属表 join、UNCLASSIFIED/AMBIGUOUS 非零退出），站点专用的是那张归属表本身与 §0.2 的判层判据。移植参照 `objectarchive-rebuild/scripts/layer-report.mjs` + `docs/layer-map.json`。
