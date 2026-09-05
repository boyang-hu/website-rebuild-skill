# 更新记录

## v0.3.20 — 判红覆盖：每道离线门都有一个反例（selftest 143 → 193，变异测试三门五抓）

**问题**：143 项断言里只有 **6 条**断言"门必须判红"（verify-mirror 的 WAF 体与单字节、verify-flight 单字节、
verify-nextdata 改 pageProp、textref 非文本、negotiate 无 accept 的 Vary）。其余 130 项问的都是"好输入下门会不会绿"。
一道悄悄失去牙齿的门从绿侧不可见——它产出的不是错误报告，是一份完美的绿报告（scripts/README 说端口串台时
"**假绿是不可见的**"，这句原样适用于套件自己）。连续三个大手术版本（0.3.17 CLI 收拢、0.3.18 lib 收拢净减 219 行、
0.3.19 战史外置）之后，这个洞正敞着；61 个脚本里 43 个从未进过测试。npm 分发面刚接上（`npx` 一条命令、tag 触发
CI 自动发布），`npm test` 成了坏版本与使用者之间的最后一道闸。

**做法**：每道离线门从**同一份 fixture** 驱动两次——原样必须退 0 并说 PASS；改坏**一处**必须退 1 且消息**点名**那处。
有"没东西可查"分支的门钉死退 5，永不退 0。节内的 `green()` / `red()` 助手同时断言退出码与消息：只看退出码，
"打印 FAIL 但退 0"看不见；只看消息，"退 1 但没说为什么"看不见。

| 门 | 绿 | 红 | 钉住的语义 |
|---|---|---|---|
| verify-zerodep | 1 | 3 | 裸说明符点名到文件；门引 `tools/` 是"检查者不能是生产者"；空目录 FATAL 5 |
| verify-reassembly | 2 | 4 | 改一字节红**在那个 part**；顺序错红在 join；重抓过的 chunk 让旧 manifest 失效（`--against`）；没有 slices.json 是 FAIL |
| verify-symbols | 3 | 5 | 掉一个声明点名；无来源声明点名；`allow_orphans` 放行；rename map 解析；非单射；未知形状 map FATAL 5（不是"零重命名"）；0 声明 FATAL 5 |
| verify-lenprefix | 2 | 2 | 一个 `é` 让 `T5` 下多出一字节即红；声明超过剩余；无 flight 流是 note |
| verify-shell | 2 | 2 | 一个未登记字节红并显示两侧；**与镜像逐字节相同的 shell 过 HUNKS 但红 PORT-SUBSTITUTION**——否则每道下游门都在拿源站和自己比 |
| verify-fresh | 3 | 3 | 桩 esbuild 逐字节复制：src 比 dist **新**但字节相同仍绿（mtime 不是裁判）；src 改了 dist 陈旧；site 不是 dist；无 esbuild FATAL 2；无 bundle 步 SKIPPED 退 0 |
| verify-refs-served | 2 | 1 | （loopback `serve.mjs`）404 的引用带状态码列出；`--allow` 把洞变成登记洞 |
| verify-offline | 1 | 3 | （loopback）外域 preconnect 是 class 1；内联 `sendBeacon` 是 class 2/3；没人监听 FATAL 5 且消息带 serve 命令 |
| verify-payload | 2 | 6 | （两个 loopback）只差在资产路径**不红**；值差红在叶路径 `$.hero.n`；单侧缺叶；单侧无岛；求值失败（字节 diff 会说"一个字符"的地方）；`--allow-absent` 两侧一致才过 |
| lib/png.compare | 1 | 2 | 全同 0.00；一像素差不为 0；尺寸不同**拒绝**而非比较重叠 |

**变异测试**（证明反例会咬，不只是绿）：三门改哑——reassembly 永远退 0、symbols 删掉 orphans 断言、fresh 把 sha
比较改成恒等——跑套件得 **5 FAIL，每条点名到门**。reassembly 那个仍在打印 `FAIL — 1 decomposition(s) do not
reassemble` 却退 0：v0.3.16 修过的病，老套件从绿侧永远看不见。

**范围外**（按套件头注保持离线）：浏览器门 probe / pixelcompare / pixel-walk / verify-routes / verify-crossside /
verify-tween / verify-harvest，与 verify-module-map（`npx acorn`）。可分离的算术（lib/png）已覆盖。verify-ssr 是
项目内配置形态，未进。

**登记而未改的一条语义**：verify-lenprefix 对没有 flight 流的文档打 note 并退 0。对非 Next 站这是对的；但"没东西可查
退 0"与 verify-zerodep / verify-reassembly 的"没东西可查是 FATAL / FAIL"不一致。这次钉住现状，去留待定。

耗时 37 s（4 个 loopback serve + ~45 次脚本 spawn）。

## v0.3.19 — 战史外置：规则留在文档里，实证搬进 case-studies/（零丢失，逐句可证）

评审清单的最后一项。每份 reference 里，规则与支撑它的实战故事是混写的——"实证 / 实测 / 【代号】"行在
webgl-scenes 占 88%、animation-recovery 71%、mirroring 57%、verification-gates 33%。故事是规则可信的来源，
不能删；但 agent 每次开工都要为它付 token，而它只在"这条规则为什么存在"被问到时才有用。

**做法**：24 份文档（23 份 references + SKILL.md）各拆成两半——正文只留规则、判据、阈值、流程、决策表、
代码块与一句话理由，故事逐字搬进 `references/case-studies/<name>.md`，章节号与母文档一一对应；规则原处留
`（实证：case-studies/<name>.md §x.y）`，【代号】留在规则上，出处不丢。case-studies/ **不在任何必经集合里**，
只在需要证据时读。

**零丢失是可证的，不是承诺**：`selftest/check-cases.mjs` 把改动前（HEAD）的正文按 。；！？ 与表格单元切成
句子（≥10 字），要求每一句**逐字**出现在新正文或案例文件之一。24 份全部 `missing 0`，共 6,800+ 句。
⚠ 这道检查在过程中救了两次：一次是子代理中途失败，正文已改写而案例文件没落盘（shopify-platform，从
HEAD 与工作树的差异重建）；一次是 8 句在改写中被吞（verification-gates）。**"我搬完了"和"一个字没少"是两件事，
只有逐句比对能分辨。**

**预算**（CJK 1–1.5 tok/字）：

| 集合 | 改前 | 改后 |
|---|---|---|
| SKILL.md | 1.26–1.76 万 | 1.25–1.74 万 |
| SKILL + 六必经 + scripts/README | 12.6–17.8 万 | 11.3–15.9 万 |
| + Flow 实际要求的 dom-shell / determinism / legal / env-traps | 18.2–25.8 万 | 16.2–22.9 万 |

references/ 总计 724 → 621 KB；case-studies/ 274 KB 移出必经集合。收缩比 0.72–0.90——**故事多在规则句内部
（规则 + `：` + 实证同一行），拆到"只剩规则"就会伤到判据**，所以裁剪在每份文档都停在规则边界上，宁可少省。
SKILL.md 本身只降 0.2 KB：它的战史本就只占 3%，其余是表格与流程。

**新门**（selftest 140 → 143）：case-studies 的三条不变量——每份案例文件都有母文档；案例文件里每个编号标题都
在母文档中存在；母文档里每个 `（实证：… §x.y）` 指针都落在案例文件真有的小节上。**指向空处的指针 = 规则的
证据悄悄没了**，这正是本版最怕的失效形态。

## v0.3.18 — lib 收拢：一份 CDP 客户端、一份 sha256、一份账本读写、一份请求头梯子、一份 findChrome

评审清单最后一项工具级债。`verification-gates.md` §2.1.1 说"两处以上要算出同一个答案的逻辑必须单一实现"，
而 scripts/ 自己有四份 CDP 客户端、三份 findChrome、五份 UA（两种 Chrome 版本）、四份请求头梯子、19 个文件 23 处
sha256、四个账本写入方六个读取方各带一份 TSV 格式。本版把它们各收成一份；scripts + tools 净减 219 行，行为按
"字节一致"验证（fixture 三本账 before/after 逐字节相同，除 `mirroredAt`）。

**四个新 lib + 两个扩展**：
- `lib/hash.mjs`：`sha256` / `sha256Short` / `sha256File`（流式）。19 文件 23 处 + 三份流式实现 → 1。
- `lib/cdp.mjs`：`connectCdp(url)` → `send(m, p, {timeoutMs, sessionId})` / `on(method | "*")` / `evaluate` / `close`；
  `cdpUrlFor(port)` 轮询 `/json/version`。probe / pixelcompare / netcapture / sweep-routes 四份私有客户端 + ports.mjs
  迷你客户端 → 1。此前四份里两份没有 onclose：截图超过 WebSocket 载荷硬顶时静默挂死；现在每次调用有界、断连时在途
  调用全部响亮拒绝。**真 Chrome 冒烟**（本机，不进 CI）：probe `--shot --walk 3 --no-external` CLEAN、sweep 2/2、
  pixelcompare 跨侧 `meanAbsDiff 0` / `--self` self-band、`chrome.mjs --all` 零残留。
- `lib/ledger.mjs`：manifest / inventory.tsv / redirects.tsv 的格式、排序、去重、追加、`writeLedgers` 一次写三本；
  `LEDGER_FILES` + `isBookkeeping` 成为"哪些文件不是镜像"的唯一清单（verify-mirror 与 make-standalone 各存一份且已
  漂移：后者缺 closure-gap.txt 与 wayback-*；点文件判定统一为任意层级）。⛔ `readManifest` 对**损坏**的账本抛错而不是
  当空账本——mirror-site 此前会在损坏账本上新建一份并在结束时覆盖它。wayback-mirror 的 inventory 此前按插入序、
  两个 worker 下不确定且对 carry-over 错误行会写出 `undefined` 单元格，现在与其它写入方同一形状。
- `lib/negotiate.mjs` 扩展：`BROWSER_UA` / `BARE_UA`（五份 UA、Chrome/126 与 /128 混用 → 1）；`fetchProfiles` /
  `fetchLadder`（std→bare 梯子：2xx 赢；3xx 原样交回调用方登记；std 上 401/403 才降到 bare；其它状态停）。mirror-site
  与 netcapture `--fetch` 直接用梯子；reconcile-gaps 的规则不同（任何非 2xx 都降 bare、3xx 即停）——保留它的循环，
  只从 `fetchProfiles` 取梯级，不改它试哪一级。
- `lib/chrome.mjs` 扩展：`findChrome` / `CHROME_CANDIDATES`（三份候选表 + pixelcompare 写死的 macOS 路径 → Linux 上
  ENOENT → 1；`CHROME_PATH` 优先）；`headlessArgs()` 公共无头参数（节流/后台化相关旗标两侧不许不同）。

**可察觉的行为变化**（都是收拢的必然）：mirror-site 在 std 级抛传输异常时现在降到 bare 再试（此前直接抛）；
`readManifest` 对缺 `files` 的文档抛错（此前 mirror-site / verify-mirror / serve 容忍）；fingerprint UA `126.0.0.0` → `126.0`、
reconcile-gaps UA 128 → 126；pixelcompare 多了 `--disable-backgrounding-occluded-windows`（只防节流）；
netcapture `--fetch` 显式 `redirect: "follow"`（此前也跟随，只是没写出来——镜像红线是爬虫的 `manual`，`--fetch` 补漏一直是跟随的）。

**selftest 114 → 140**：hash 往返；ledger 往返（追加只加未知路径、损坏账本必抛、`redirectsText([])` 逐字节 `CODE\tFROM\tTO\n`）；
negotiate 合同 + 回环服务器上的 403→bare / 404 不重试 / 302 原样 / 端口不通；chrome `headlessArgs`；cdp 两个负例。
lib/ledger 与 lib/cdp 的正例还由 mirror-site 回环爬取、serve 回落链、真 Chrome 冒烟覆盖。

## v0.3.17 — 一份 argv 合同：`--help` / `--version` / 未知旗标 FATAL 全覆盖，退出码表，tools 依赖钉版本，历史 tag

上一版评审里"只写在文档里的规矩"又一条落成门：**"未知参数必须 FATAL"** 从 v0.1.x 就写在 verification-gates 里，实现它的脚本 57 个里只有 9 个。

**`scripts/lib/cli.mjs`**：每个脚本（51 个工序脚本 + 10 个 tools + `lib/chrome.mjs` / `lib/ports.mjs` 的 CLI 模式）第一件事是
`cli({ known, bools, file: import.meta.url })`——`--help`/`-h` 打印文件头注（用法一直住在那里）+ 旗标清单 + skill 版本；`--version`
打印 skill 版本（`lib/version.mjs`，项目里的 `scripts/` 是拷贝，这个数字是判断它有没有落后的唯一依据，selftest 钉它等于
SKILL.md frontmatter）；**未知旗标一律 FATAL 退 2 并列出已知集**。它只校验 argv 的形状，各脚本自己的 `flag()` 读法一个字不改；
此前 9 个脚本各自的 KNOWN 检查删掉归一。迁移时清出 **30 余处"代码读了但头注没写"的旗标**（pixelcompare 一个脚本就有 11 个：
`--self --pump --after-ready --hold --hold-grace --hold-after --drive --chunk --freeze-css --freeze-at --cdp-port`；make-standalone 13 个；
probe 的 `--expect-side`；serve 的 `--host --fallback-root --query-ignore --query-only --rewrite`）全部补进头注用法行；
cold-audit-modules 头注里的 `[--entry 14]` 从未被读取——删掉而不是登记成一个无事可做的旗标；extract-source 的 `--h` 别名退役。

**退出码约定**（`cli.mjs` 的 `EXIT`，表见 scripts/README）：0 绿 / 1 门红 / 2 调用错误 / 3 身份 / 4 CDP 传输 / 5 前置条件不成立 /
6 状态未到达 / 130 Ctrl-C 已落盘。5 在 pixelcompare 是空帧、在 module-map 是认不出容器，按含义读不按脚本猜；新脚本取常量不写裸数字。

**selftest 110 → 114**：版本常量钉 frontmatter；对 57 个脚本逐个扫 `--help` 退 0 且有 `flags:` 清单、未知旗标退 2、
**头注用法行里出现的每个旗标都在已知集里**（正是 probe `--expect-side` 那类 bug 的门）。tools 里 import babel 的两个在本仓无依赖，扫描明示跳过。

**其它**：`tools/package.json` 首次声明并钉死 `@babel/parser` / `@babel/traverse`（7.29.8——darkroom 7.25 / raycastkbd 7.26 /
storytellingnoomo 7.29 实跑过的那条线；basement 在 8.0.4 上跑过一次，一个样本）；`verify-fresh` 不再 `npx esbuild`（本地没装就静默拉最新，
拉来的和 `dist/` 用的不是同一个 bundler），改用项目自己的 `node_modules/.bin/esbuild` 或 `--esbuild <path>`，缺失退 2；SKILL.md
compatibility 写明 Step 0 之后 POSIX-only；本地为 v0.1.1–v0.3.16 共 98 个历史版本按 CHANGELOG 打了 git tag（未推送）。

## v0.3.16 — 瘦身版：拆 verification-gates、重编号、SKILL 表瘦身、八条已核实 bug（全仓冷头评审回哺）

对 v0.3.13–0.3.15 做了一次全仓冷头评审（报告留在 analyses/，不入库），本版只做**减法与修正**，不引入新方法论。

**预算**：SKILL.md 55.2 → 40.9 KB——Script Directory 从 24 KB 的战史表缩成"一句话用途 + 阶段"表，完整版整表迁入
`scripts/README.md`「速查表」与 `tools/README.md`；顺手补齐此前表里缺席的 sweep-routes / census-bundles / slice-esm /
verify-reassembly / wayback-mirror / lib/ports / lib/urlpath / lib/extract-refs / modules-to-src / flight-to-mdx / group-parts。
verification-gates.md 158 KB 按四道天然缝拆成四份：`verification-gates.md`（门型 / 决策树 / 运行纪律 / 分层体系，81 KB）、
`gate-failure-modes.md`（失效模式 / 根因修复 / 残差归类，50 KB）、`gate-case-design.md`（用例设计 / 清单式核对，19 KB）、
`payload-gates.md`（载荷与外壳变换的门，9.5 KB）——后三份按需加载，M(n-1) 开局只读第一份。

**重编号**：verification-gates §4.9–4.12 各两个、determinism §0.1.2 / §6 / §7 各两个、readable-source §4–4.5 两套与 §3.0.1.1
两个——全部消歧。失效模式 §4.x → gate-failure-modes §1.x（§4.7.1 → §1.9、§4.13 → §1.14、§4.20 → §1.15，§4.8.x 按序）、
§5 / §6 → §2 / §3；前插块 §0.2x → gate-case-design §1–5；尾追块 §4.9–4.19 → payload-gates §1–7（§4.14 进 verification-gates
§2.3、§4.17 进 §2.1.3；§4.16 与"顺带"删除——那是 CHANGELOG 内容）；旧 §7 常见坑 / §8 产出物 → §4 / §5。determinism 的状态对齐
协议正式成为 §7（§7.1 不变），旧常见坑 / 自检 / 产出物顺延为 §8 / §9 / §10，§0.1 与 §0.2 的子节按序排好。readable-source 的
交付物块成为 §9（9.1–9.6.1），§2.x 与 §3.0.4 / §3.0.5 按序排好，多 chunk 站一节改为 §3.0.1.4。全仓文件限定引用与文档内裸 §
引用按映射表改写；一处悬空（VG §3.4）指向 gate-case-design §3，一处错文件（readable-source "§0.3"）指向 legal §0.2。
SKILL.md 补标记图例（⛔ / ⛔⛔ / ⭐ / ⭐⭐ / ⚠ / 【代号】），References 列表补齐 archival-rescue / beyond-the-rebuild 与三份新文档，
路由表加三行。

**八条已核实 bug**（selftest 86 → 110）：
1. `pixelcompare`：metric.json 的 `kind` 被旧文件的值覆盖（spread 顺序）——现在开拍前就拒绝在同一 `--out` 混用 `--self` 与跨侧（exit 2）。
2. `lib/extract-refs`：扩展名 `{2,5}` 在五处各写一份，`.webmanifest` / `.jsonld` / `.geojson` 被当页面丢弃而闭包门报 ∅——统一为导出的
   `EXT = {1,12}`，与 `lib/urlpath` 同一把尺。
3. `netcapture`：跳过 206，Range 请求的 video / audio 从不进 GAP 对账——200 与 206 都算命中。
4. `netcapture`：账本追加的 manifest 半段裹在裸 `catch {}` 里——读不到 manifest 直接 FATAL（exit 1），`--fetch` 开抓前先验账本；
   `--fetch` 改走 `lib/negotiate` 的浏览器图片 Accept + std → bare 梯子，行记 `profile` / `vary`。
5. `mirror-site`：绝对 `--out` 被拼到 cwd 下；非数字 `--rounds` / `--workers` 变 NaN、零轮仍报 Done（现 exit 2）；三本账只在结束写一次
   （现每 100 个文件与 Ctrl-C 都落盘，exit 130）；瞬时 fetch 错误覆盖仍在盘上的好行（现保留）；重扫抽出的同源 `.html` 绕过 `--scope`
   （现统一走 `enqueueRef` 页面守卫并当页面爬）。
6. `probe`：KNOWN_FLAGS 漏了自家文档里的 `--expect-side` / `--evalAfterDelay`；URL 取第一个非 `--` 参数，`--wait 9000 <url>` 把 9000
   当 URL——改为逐参数走。
7. `lib/urlpath`：写入侧把同源 path-past-file URL 落成 `<flat>/index.html`，伺服侧只查裸文件——`serveCandidates` 现在给出
   `localRelPath` 能产出的每一种拼写（含带查询后缀的 flat 形）。
8. `lib/chrome`：把活着的兄弟浏览器的 renderer 判为孤儿——改为沿匹配树走到根、根的父进程没了才算孤儿。

另：`make-standalone` 打印 FAIL 后退出 0（现 exit 1）；`serve` 的 `--redirects` / `--cdp-port` 从"接受但忽略"改为拒绝；`pixel-walk`
usage 补 `--hold-after`；selftest 修掉一条永真断言（`serveCandidates` 第二参传错位）；`make-standalone` 一处指向不存在的
asset-management §2.2 改指 §0.5。

**新门**：selftest 新增文档结构自检——references/ 任何文档不得有重复章节号；SKILL.md / references / scripts / tools 里每一处
`<文档> §x.y` 引用必须能解析到一个标题；SKILL.md References 列表必须列出 references/ 下每一份文档。这三条此前只在评审里查过一次，
按本 skill 自己的话说：只写在文档里、没有东西去查的规矩会安静失效。

## v0.3.15 — 到达与相位是两种状态：raycastkbd 复审补齐（镜像门的三处失明 + 切片的容器外字节）

raycastkbd（Turbopack / Next 16.3 / R3F，v0.1.69 单会话跑完的 L3）按 v0.3.14 复审：**移植本体
经得起最新仪器**（module-map 860 模块一致、verify-module-map 54/54、cold-audit 54/54），但证据基座
按新标尺有四处阻塞——19 个 `/_next/image` 变体是 `*/*` 回退字节且 srcset 阶梯 42 只抓 19（双 Accept
采样 3/3 分叉、`Vary: Accept`）；13 个懒加载 chunk + 7 个 loader-stub 目标模块从未进镜像；滚动走查触发
10× `misc-assets.raycast.com` 未登记外联（changelog 路由预取载荷里的 release 图，51 MB）+ Sentry 桩造成
的 console error；像素自比带宽不为 0（3D 场景到达帧）。同日补齐：懒 chunk 13 + release 图 10 + robots/
sitemap 入镜像（首轮即闭）、42 条阶梯以浏览器 Accept 进独立记账树 `mirror-negotiated/`（verify-mirror
两树全绿）、61 chunk / 879 模块重切、**verify-tokens 61/61 对压缩原件不剥前奏**、probe 两侧 CLEAN +
external 0、像素门 4+4 交错自比带宽 ≤0.11（走查 25% 检查点从 1/3 概率 2.91 归零）+ 跨侧 5 检查点 ≤0.01 PASS。REBUILD_PLAN / engine-notes / DEPLOY 七节 / `docs/gates.sh` 补写。八条工具级 +
四条文档级回哺：

**镜像门的三处失明（都在"闭包 = ∅ 且五项全绿"底下）**：
1. `lib/extract-refs`：**srcset 候选按构造是资产，`?url=` 图片代理是资产**——"同源无扩展名 = 页面"
   规则把 `/_next/image?url=…&w=640` 整族丢掉，srcset 形态找到 42 条、同一函数里全部丢弃。现在 srcset
   候选带 `{asset:true}` 直通、`[?&]url=` 视为资产、裸 `src=` 属性另有 4a 形态；`/about?tab=2` 仍是页面。
2. mirroring §8 checklist 新增三行：Turbopack **loader-stub 家族**（`e.v(t=>Promise.all([css,js].map(e.l))
   .then(()=>t(id)))` 只在交互态请求；从 module-map 聚合"require 全集 − 定义全集"查，路径按 runtime 常量
   `r="/_next/"` 拼）、**路由预取载荷是外联的载体**（`?_rsc=` 载荷在镜像里、其内绝对 URL 由浏览器直接去要；
   netcapture 没传 `--hosts` 连同注册域子域也看不见）、**next/image 阶梯按字节穷举且按浏览器 Accept 抓**。
3. legal §2.6：`GTM-/G-/UA-` 是清单里的一行不是清单——PostHog token / Rewardful id / Sentry DSN / Vercel
   Insights 各是一条，附 grep 形状。

**切片与服务层**：
4. `slice-modules`：**容器不是整个文件**——每个 chunk 开头 285 B 的 Sentry `_debugIds` 前奏与 `//# debugId`
   尾注逐字带走，gen 头写 prologue/epilogue 字符数与**完整**再生成命令行（此前只写 `--closure`，照抄即
   ENOENT）；verify-tokens 由 0/54（恒差 87 token）直接到 61/61，不加任何对齐旗标（VG §4.20：门不给生产者
   开豁免口）。
5. `serve`：`--fallback-root` 成**回落链**（`mirror-negotiated,mirror`，两侧同链）；**桩主机的 DSN 保持是
   DSN**——`https://<key>@oNNN.ingest.us.sentry.io/<id>` 改写成 `http://<key>@127.0.0.1:<port>/ext/<host>/<id>`，
   SDK 按源站那样初始化、信封打进桩（此前归一化成裸路径 → 两侧 `Invalid Sentry Dsn`，CLEAN 红而无静态门能见）。
   `make-standalone --mirror a,b` 同一份链合同（交付物带的是浏览器字节，不是回退字节）。
6. `pixelcompare --hold <expr> --hold-after N --hold-grace ms` + pixel-walk 透传与诊断转发（determinism §7.1）：
   **状态分两种——泵到的用 `--ready/--after-ready`，等到的用 `--hold`**。GLB 在 worker 里解码是真实时间事件，
   轴体动画走虚拟时钟：绝对泵 → 1/3 概率拍到未到达（2.91）；状态相对泵 → 两侧绝对泵数不同、相位错开
   （恒 1.7）；泵前 hold → 请求永不发出（60s 超时，页面要在泵的世界里才开口要）；`--hold-after 30
   --hold-grace 1500` + 绝对泵 → 带宽归零。grace 是墙钟 settle，登记为偏差。pixel-walk 此前吞掉
   pixelcompare 的 "ready after N" 行，READY 没触发的走查与对齐了的走查无法区分——现在逐行转发。
7. `cold-audit-modules`：认 Turbopack 的**经典单参工厂** `function(C){ C.n(C.i(id)) }`（loader-stub 家族的入口 chunk
   用它注册 stub 目标的再导出）——此前落在两种签名之外，7 个补抓 chunk 里 6 个报"只查了 2/3"。
8. selftest 71→86：srcset/代理阶梯 3 条、切片前奏/尾注/命令行/token 往返 5 条、serve 回落链 + DSN 6 条
   （loopback 起服务，无浏览器）、cold-audit 单参工厂 1 条。

**文档级**：VG §4.20（切片交付的 token 门对整个文件）；determinism §7.1（到达 vs 相位协议表）；
legal §2.6 标识符清单扩展；mirroring §8 三行。方法论一句话：**"闭包 = ∅"只对提取器看得见的形状成立——
每次新形状（代理 URL、loader stub、预取载荷）都要追溯重验旧绿。**

## v0.3.14 — 旧项目对新标尺：点名扁平产物、门订阅的域、活世界的骰子（samsyninja 复审回哺）

samsyninja-rebuild（2026-08，M0–M15，采纳时 skill 还是 v0.1.68）拿 v0.3.12/13 复审：L3 形状成立、
门全绿，但按新标尺有四处阻塞——分发面与 README 自述矛盾（用户裁定：小范围预览、分发由使用者考量，
原话入 §D）、镜像账本无 sha256 且**规格书本身不在账**、CDN 变体字节等价从未证、像素残差无带宽。
同日补齐 M16–M21：账本重建 + `verify-mirror` 五项全绿（含回源抽样 6/6、origin 对 `/about*` `/works*`
的 301 首次入 `redirects.tsv`）、CDN 74/74 长度 + 26/26 sha256、CLEAN 门补 Network/Log 域 + 外联白名单
+ 音频面、冻结像素门 4+4 交错自比带宽三视图 PASS + DOM 文本 4/4 一致、冷头点名 964/4770 零 UNKNOWN、
REBUILD_PLAN 归模板（§6 偏差 20 条 / §Q 怪癖 35 条 / §D 6 条）。回哺一件工具、五条文档：

**新工具 `scripts/cold-audit-decls.mjs`（M(n) 冷头点名，扁平产物）**：Vite/esbuild/Rollup scope-hoisted
产物没有模块容器，`cold-audit-modules` 无处下手；点名单位改为**深度 0 声明**（class / function /
const-let-var 链每个绑定，含解构），在 acorn token 流上列出、限定到应用区间，逐条判 cited（port 注释的
`pretty L…` 区间含它，`--slack 1`）> override（`collapsed` / `omitted` / `ported`，范围级可带 `match`
只收编译期常量）> named > UNKNOWN，报 `n/N examined`，找不到的 override 即 FATAL。实测首跑 349 条
UNKNOWN **零缺口**：vuex / vue-router / TSL 别名块 / partysocket+uuid / three addon 模块级作用域、SFC
编译器提升常量、一整段**主线程重复打包的 worker 模块**——归桶的过程就是那份人工评审第一次被写下来。
它也是"手写移植 + 冻结快照当 port/"形态里 mirror→port 那一段唯一的机器裁判（readable-source §3.0.7）。
selftest 66→71（深度 0 收集 / slack / match / FATAL / 严格模式）。

**文档级**：verification-gates §4.12 **门订阅的 CDP 域不覆盖它声称的断言面**（只订 Runtime 的"零 404"门
跑了十四个里程碑全绿——三项断言只做了最不会红的 1/3）；legal-and-deploy §3.3 5b **分发面事实**（仓库
可见性 / 推送 / 本体入库 / 公网可达是四个事实，与"产物里有什么"是两个维度——没人把它们放到同一页给用户
看）；determinism §2.6 **媒体钉帧**（hook `createElement` 抓不挂 DOM 的 `<video>`，pause + currentTime=0
等齐 seeked）、**`Network.setBlockedURLs` 挡不住 WebSocket**（`--host-resolver-rules` 才是）、**reseed 是归类
实验不是调参**（残差格 34→2 / 61→0 证明是骰子相位，同侧带宽照旧）；environment-traps §9.6 **`npx` 两层进程**
（杀 npx 留 vite——:5199 上一个 8 天 18 小时的孤儿，ppid 1）。

## v0.3.13 — 梯顶的最后一段：状态对齐、优化器产物、多 chunk 可读树（darkroom 收官回哺）

darkroom.engineering 无人值守跑到**梯顶**：三处 UNCLASSIFIED 像素残差全部归类到 0.00（/about 走马灯、
/work 场景挂载 = 泵分块内的相位差，`--chunk 1 --ready --after-ready` 归零；looped/badomens = 重建
静态树缺 next/image 优化器产物，镜像字节优先补齐后归零）；M(n+1) 可读树 **278 模块/43 chunk
token 级精确**（105 个 tier-1 命名），verify-fresh-next 10/10，verify-standalone static + `--full`
PASS（复制出去断网装/建，副本 sweep 8/8）。v0.3.12 的 module-map 修复实弹：6 模块补回异步边，
项目侧文本补边退役为断言。§F 11–17 本版全部落地：

**工具级**：`pixelcompare --after-ready N` / `--chunk N`（状态对齐协议：两侧各自 READY 后再泵 N 帧，
分块粒度 = 对齐分辨率，determinism §7）；四个 darkroom 工具入 tools/——`sourcify-chunk.mjs`
（多 chunk 站按 canonical 位逐 chunk 跑三件套，闭包 id 与 map 同型）、`accept-names.mjs`
（name-modules 只提名，接受步默认只收 tier-1）、`harvest-optimized-images.mjs`（优化器产物是像素门
的一层资产：镜像字节优先，本机优化器兜底并登记）、`verify-fresh-next.mjs`（Next 链的新鲜度门，
前提 `generateBuildId` 钉死）；modules-to-src 对 Turbopack 三参工厂按 `(ctx, module, exports)` 命名
（此前套 webpack 名：位置对、可读性反）；verify-standalone 静态扫描跳过 `.next/`（构建产物里的
构建机绝对路径不是泄漏）。

**文档级**：readable-source §3.0.1.1（多 chunk 三件套 + 接受步）、§4.5.1（Next 链 verify-fresh）、
§4.6.1（`.npmrc` 是交付物的一部分）；determinism §7（状态对齐协议）；rsc-reconstruction §3.5
（优化器产物层 + `images` 配置从 srcset 反推，`qualities` 默认 [75] 会把 90 静默压回 75）。

## v0.3.12 — 声明体里的边：React Compiler 把模块塞进了 e.s()（darkroom C1 收口回哺）

darkroom.engineering（Next 16.3.2/Turbopack + React 19.3 experimental + React Compiler + StyleX +
three r185 WebGPU/R3F，8 路由，Satus 半开卷靶）无人值守跑到 M(n)：**verify-flight 8/8 双射 32 对**、
28 客户端组件逐字图（158 模块/5.1MB）经 `next start` 拓扑 sweep 8/8 CLEAN、像素门 home/contact/
developers/privacy/about 0.00（自比带宽 0）、冷头审计 PASS、DEPLOY 权利表；三处像素残差如实登记
UNCLASSIFIED（=未过）交下一段续跑。§F 十条回哺，本版落五条工具级 + 五条文档级：

**核心新知——`e.s()` 不再是声明，是模块本身**（§F-1）：React Compiler 下 Turbopack 把导出的
**整个实现内联进声明**——`e.s(["useTheatre", 0, function(o,a,s,l){ …整个组件… }], 59278)`。
module-map 的 `s` 分支"收完导出名跳过调用体"于是跳过了整个模块：体内每个 `.A(id)`/`.i(id)`
从 `requires` 消失，闭包看似闭合，运行时报"依赖未映射"（12712 藏在 useEffect 的 `e.A` 后）。
修法：导出名只在声明数组的**元素起始位**（深度 2 扁平形 / 深度 3 配对形）读，体内字符串不再被
当导出名；扫描**继续进入调用体**。实弹：59278 requires 从 3 条到 5 条（+12712/+2074），导出名
精确到 `useTheatre`。这条与 v0.3.7 的"三形态同权"是同一课的下半句——同权的前提是扫得到。

**其余工具级**：verify-flight N2 css-module 哈希位宽 `{8}`→`{6,8}`（Turbopack 7 位 hash + 下划线
开头 local 段被判"有行为"）+ LayoutRouter `notFound/loading` 元组尾部空样式槽剥除（镜像的槽被
N5 strip 成 null、重建侧 `[]` 化石保留 → `[tree]` vs `[tree, []]` 假红）；cold-audit-modules 认
merged map（`locations[]` 取 canonical 位，`source` 优先于 `<chunk>.pretty.js` 命名——此前要摊平
+ 软链目录才能读）；新 `tools/assemble-static.mjs`（像素门两侧同经 serve.mjs：`next start` 侧
不注入 probe-shim → 镜像帧 BLANK/重建有画的冻结不对称）。selftest 62→66。

**文档级**：rsc-reconstruction §3.3 从 flight 反推 next.config 的行为证据（`cacheComponents` 由
`ClientPageRoot.serverProvidedParams===null` 发射、experimental React 四旗）+ §3.4 flight-to-tsx
四陷阱；porting-discipline §2.5.2 逐字图三条硬规则（全站单图单例、T-SSRGUARD 浏览器≠服务端
chunk、坏字节用同形抛错工厂顶替）；determinism §6 像素门两侧同经 serve.mjs。

## v0.3.11 — 正签名的下半句：单模块 chunk 也是容器（14islands L3 收口回哺）

14islands 续跑到 **L3**：`7753`（token 流上切 652 个压缩原字节部件，覆盖 99.8%）与 `2186`
入港，verify-tokens 25/25；像素巡航 12 路由×5 检查点（`/culture` 0.04 稳定残留登记不算过）；
25 chunk 摊成 `src/chunks/*` 1,231 模块文件（name-modules + 17 条 tier-0 裁决附"读到了什么"，
作用域安全重命名 1,225），**verify-module-map 25/25**；`standalone/` 自足交付物
verify-standalone `--full` PASS、byte-manifest 2,808/2,808、像素 home/culture 0.00。第二轮
七条回哺，全部工具级：

**v0.3.10 的正签名读法当天就被实弹修正**（F12/F13）：签名找到了容器，下游 `members.length < 2`
的门槛却把**单模块 chunk** 当"没找到"——3163 / 57f4964f（各一个工厂）报"no container"，
7871（一个工厂里装着 troika 的 `[function(){…},…]` worker 表）回退到数组读法报 31 模块。
fork 的初判"签名只认文件开头"是表象。修法与 Turbopack 单工厂那课同形：**正签名定位的
容器在任何成员数下都是容器**，不再回退。**行数不变量改为字符不变量**（F11）：压缩原件
（js-beautify 解析失败时的坐标）652 个正确模块全落在第 1 行，"模块行数 > 文件行数"是
恒假红；工厂在任何容器形态下都不共享字符，字符和才是不变量。

**其余**：verify-module-map 两个边界分支同一套剥键逻辑（F16：合成 char 边界指到 id 起点时
每模块恒差 2 token）+ 键正则认压缩器的指数记法 id `71e3:`（F14，modules-to-src 同修）；
make-standalone **无 `--shell` 即打印 usage 退出**（F15①：一次 usage 试探把 1.27GB 镜像拷进
src/public）、引用提取解 HTML 实体（F15②：srcset 的 `&amp;w=` 让 628 个在场变体报"落范围外"）、
无 index.js 或 `--no-build` 不生成 esbuild 构建脚本（F15③）、新增 `--keep-own`（F17：`--own`
的"单一构建产物"语义把 25 个再发射 chunk 的外壳全改写到同一个 gen 文件，首屏空白而 CLEAN/
请求失败全绿——像素门的非空帧前置条件是唯一说话的门）。selftest 59→62。

## v0.3.10 — 排版字节不是原件：token 门与 webpack 正签名（14islands L2 收口回哺）

14islands.com（Next 13.4 pages router + Sanity 直连 + R3F/scroll-rig，104 路由）无人值守跑到
L2：L1 关账（全路由 netcapture 1,243 GAP 全补 + 三条字节推导阶梯；verify-mirror 2,782 行
五项 PASS；断网 sweep 104/104）→ M1 钉栈 → M2 策略 A 外壳（verify-shell 121 hunk 全可重放、
verify-offline 104/104、verify-refs-served 5,670/5,670）→ **23 个站点 chunk 逐字再发射**、
token 门 23/23、`__NEXT_DATA__` 门 104/104、像素门三路由 0.00 → 冷头审计 + DEPLOY 取证草案。
战役产出十条回哺，本版落六条工具级 + 三条文档级：

**核心新知——js-beautify 会改变嵌套模板字面量的内容，且所有渲染门照绿**（F4）：
`${iW(e)}:${t};` 被排成 `$ {\n iW(e)\n }: $ {\n t\n };`，能解析、能渲染、像素 0.00，token
流 748,409 vs 748,398。**排版字节不是原件**——凡以 `_pretty` 交付（再发射/切片）的路线，
token 流等价是必需门。落地：`lib/tokens.mjs` + `verify-tokens.mjs`（门）+ beautify-bundle
产出后自查（账本新增 tokens 列，`DIFFER@n` 的文件只能当坐标、退出码 1）。

**module-map 的 webpack 读法换脊柱（F1/F9）**：容器改由 `webpackChunk*/webpackJsonp` 的
`push([[ids],{…}])` **正签名**定位——此前"属性最多的对象"这个计数在 three.js 400+ 导出映射
面前输了（256 模块的 `_app` 报成 406 个 3 行模块），另一 chunk 报"1,864 行落在 1,213 行文件
里"却不 FATAL（require 边碰巧在内）。对象/数组容器**模块行数 > 文件行数一律 FATAL**。

**其余工具级**：`verify-nextdata.mjs`（F2：pages router 载荷门，verify-payload 的空白；`--a/--b`
认目录，selftest 可离线钉）；`emit-webpack-chunk.mjs`（F3：多 chunk webpack 站的逐字再发射
出口，Turbopack 路线的同构物，拼接门 + `--raw`）；beautify-bundle 对 `[slug]` 文件名喂无
括号副本 + "输出 === 压缩输入"直接 FAIL（F5：CLI 对 -f 做 glob，四个页 chunk 静默停留 8 行
raw）；mirror-site `redirects.tsv` 跨运行累积（F6：`--scope` 补页把它截成表头，`/work` 308
消失）。selftest 50→59。

**文档级**：JSON 数据岛里的 URL 是内容不是地址，T-LOCALIZE 不许进岛（F7，dom-shell §6.0）；
pages router 的 chunk 全集从 webpack runtime `h.u`/`h.miniCssF`/`_buildManifest` 推导、
`_next/data` 按路由表推导（F8，sanity-platform §4）；门的退出码不许经过管道 `tail`（F10，
verification-gates）。

## v0.3.9 — 标尺只有一把：镜像开始发浏览器的图片 Accept（basement D5 定案回哺）

v0.3.6 入册的 `auto=format` 协商陷阱，本版从"文档警告"落成"工具行为"。定案数据
（basement 镜像，全部盘上实测 + 双 Accept 采样）:魔数普查 391 个变体 59 个扩展名↔魔数
分叉,但**双 Accept 采样 6/6 全分叉**——jpg/png 源在浏览器 Accept 下同样返回 webp
(1.13MB png→61KB webp,体积差 18×),**分叉面是全部栅格变体**,魔数普查只看得见协商
跨过扩展名边界的尖角。配套事实:响应 `Vary: origin, accept` 自声明协商;裸 Accept
重抓 6/6 sha256 与镜像一致 = profile 级分叉,非时间漂移。偏差以 D5 登记进 basement
项目(census 脚本与采样证据入库)。

**工具落地(新共用库 `lib/negotiate.mjs`,合同 selftest 钉住,36→45)**:

1. `mirror-site.mjs` / `reconcile-gaps.mjs`:图片 URL 的标准 profile 改发**浏览器同款
   图片 Accept**(`IMG_ACCEPT` 逐字照抄 Chrome——标尺只有一把,不自创格式偏好);
   判"是图片"优先信 CDP TYPE 列(reconcile-gaps 现在读 netcapture TSV 第 5 列),
   其次 URL 拼写,next/image 代理**先解码 `url=` 再判**;裸 profile 保持 `*/*`
   (它的职责是头过敏兜底,极简即本分)。
2. **账本盲区补上**:manifest 每条新记 `profile` 与 `vary`——没有这两个字段,协商
   响应与普通响应在账本里不可区分,分叉对一切审计不可见。
3. `fingerprint.mjs` Step 0 采 Sanity 证据:projectId/dataset/API 主机/auto=format/
   `_key` 计数,裸写/`\/` 转义/`%2F` 编码三种拼写归一(与 D1a 四形态同课),命中即
   指路 sanity-platform.md——只采证据,判级仍看内容烘焙时点。

sanity-platform.md §1.2 同步改写(处置第一条"已内置");SKILL.md version 与脚本表
同步(0.3.7/0.3.8 期间 metadata 停在 0.3.6,本版归位)。

**同日实弹回哺(darkroom / 14islands 双站开工)**:

- fingerprint 的 Sanity 采集器首战即暴露覆盖缺口:darkroom 的 flight 只有
  `:HC"https://cdn.sanity.io"` **preconnect 提示、零资产路径**——Sanity 在栈里
  (Satus 脚手架)而页面不用其 CDN。sanityEvidence 增 `cdnRefs`(裸主机计数),
  "有主机引用但无资产路径 = 去深层路由取证 projectId",selftest 45→46。
- **协商面不止图片**:darkroom 全部路由有 `.md` 孪生 + `llms.txt`(`Vary: Accept`,
  同 URL 按 Accept 返回 HTML/markdown),部分路由 `Vary: rsc, next-router-*`
  (flight 的 header 协商形态)——账本 `vary` 字段第一天就把三族协商面照全了。
- **Next + Vercel + Sanity 栈开工速查卡**入 sanity-platform.md §4:指纹速判
  (App Router vs pages router × Sanity 三种接法)、--hosts 预设、协商面三族、
  运行时资源族清单(darkroom 实测 well-known 五件套含 openapi.json)、
  verify-flight 常用旗标。四站实测素材(basement/hashgraphvc/darkroom/14islands)。
- **存量镜像的协商变体重抓落地形态——独立记账树**(basement D5 处置,用户裁定"重抓但
  保留旧变体"):`mirror-negotiated/` 自有账本、同一套 urlpath 映射、记 profile/vary/
  baseline;旧树零改动(git status 空),新树五项全绿。391/391,311 webp/79 avif,
  217MB→39.5MB——**avif 份额随站与资产尺寸变**(14islands 4/616 vs basement 79/391),
  协商结果只能写成分布。
- **verify-mirror 弱标记误伤 404 模板**(darkroom M0 实撞):weak "refusal wording"
  匹配到的是 flight 错误边界槽位名 `"forbidden":"$undefined"`——404 模板是全站
  最小 HTML,唯独它躲不过 WEAK_MAX。修法有边界:**模板对弱标记豁免、强标记保留**
  (WAF 拦下 404 探针把 Cloudflare 体写进模板的真场景仍然报红,那是要登记的镜像
  失败)。selftest 双向钉住(46→48)。darkroom M0/M0.5 全绿收口(L1),顺带实测
  "引用在案而源站不提供"族的闭包门表现:chunk 内嵌纹理目录表 71 个 .bmp 全 404,
  逐 URL 进 external.txt 而非静默漏抓。

## v0.3.8 — 门看不见的债：CSS 对账与 worker 供片链（basement 用户实测四连修回哺)

basement 功能面收口后,用户在真浏览器里连报四障:顶栏无 logo 且换行、machine
模式黑屏、Contact 电话浮层点了没反应、对讲机屏字体错。四障三根,全部入册:

**CSS 面对账(rsc-reconstruction §3.2)——语义门只看 flight 树,看不见 CSS**:
- ⛔ 逐字图交付下 DOM 外壳的类名活在 verbatim JS 编译串里,tailwind content
  漏扫 = JIT 全不生成,塌法极具迷惑性(白 logo 黑底黑字"消失"、grid 塌、
  reveal 幕布盖死全页);
- ⛔ token 台账是**相对扫描面的**——"JIT 只编译用到的,这就是全集"在扫描面
  扩大时作废;字体链三层全在、独缺 token 一层照样回退系统字体(flauta);
- ⭐ carry-css 方法论:代表路由 SSR DOM 类名并集为需求面(**必须覆盖每个
  路由家族,含备用模式家族**),镜像编译 CSS 机器搬运 tailwind 生成不了的
  规则(@media 保留、keyframes 连带、body 基础规则单独一道),幂等可重跑;
  源站自身死类照抄不修;数字开头类名的 CSS 转义分词陷阱(`\33 xl\:` 尾随空格)。

**worker 供片链(porting-discipline §2.5.1 增补三条)**:
- ⛔ worker runtime 的 registerChunk 以**烤死前缀**转等待键——换前缀供片 =
  entry 静默不执行(全注册、零监听、零报错,死状签名要背下来);
- ⭐ Worker 对象上**空字段 error 事件的第一嫌疑是脚本 URL 本身**(加载失败
  的事件没有 message/filename,长得和跨域脱敏一模一样——先 curl 再理论);
- worker 静默死的解剖:CDP 平铺 auto-attach + 恢复执行前注入三层消息账本。

**环境陷阱 §9.5**:npm 生命周期钩子不跟人走——`npx next build` 直调不触发
postbuild,钩子负责的产物(软链)悄悄消失,间歇性 404 伪装成"上轮修好又坏"。
对策:关键产物挂多生命周期点双保险;自查清单加一条。

## v0.3.7 — 第四交付形态：逐字图 + 转写微运行时（basement 收官回哺）

basement 战役收官:34 个 DOM 外壳、ScreenUI(16.5k 行 preact-signals 引擎)、
双 offscreen worker、mux/tweet 惰性家族全部以「逐字工厂 + 微运行时」跑进重建
的 Next 应用——§2.5 的三种交付形态都接不上这个场景(端口活在**另一个应用的
外壳里**,没有页面级替换点),故入册第四形态,判别器与做法进表。

**核心新知——runtime 助手字母的语义只能从源站 runtime chunk 逐字转写,从调用
点反推的"看起来能跑"错语义会在远处以无关形状爆炸**(porting-discipline §2.5.1):

- `u.A=function(e){return this.r(e)(g.bind(this))}`:A 边是"resolve 后**以模块
  require 为参调用**"——目标恒为 loader stub。shim 只 resolve 不调用,
  next/dynamic 把 stub 当组件渲染,React 深处 `t is not a function`,栈不指 shim。
- `u.n` 是 exportNamespace(exports **整体设为**该命名空间),不是 default 互操作
  getter——猜错则重导出模块导出空,远处 React #306。
- `e.v(值)` 三形态靠消费方消歧:worker 工厂(经 `i` 调用)/ css-module 表
  (对象)/ loader stub(经 `A` 调用)。**修正 v0.3.3**:stub 会出现在组件
  闭包里,"不进叶图"是错的;其 resolve 目标闭包必须同图在场。

三个配套陷阱(各有实证):**registry 顶替前读该 id 在每个 chunk 作用域的注册体**
(847851 主 chunk 证据像 hls.js,懒 chunk 里是 18.5k 行 mux 播放器组件——顶替
成 npm 后文章视频死于 React #306);**id 碰撞**(自家 turbopack 构建对相同
node_modules 派生与源站相同的数字 id,调试编译产物时判据是 chunk 注册表归属,
不是数字);**闭包走查 `.i(`/`.r(`/`.A(` 三形态同权**(临时 grep 只匹配 `.i(`
= 运行时"依赖未映射"补课)。

## v0.3.6 — Sanity 场景入册：同一个 URL、两种字节（hashgraphvc / basement 回哺）

Next/Nuxt 创意站的主流内容层 Sanity CMS 此前在 skill 里只有一行脚本注释。本版从两个
已复刻项目（hashgraphvc L2 收口、basement 战役中）+ 一次 Step 0 探测（franshalsmuseum）
回填出 `references/sanity-platform.md`，进分支路由表。

**核心新知——`auto=format` 是内容协商，镜像与浏览器就此分叉**：带 `auto=format` 的
Sanity 图片 URL 按请求 Accept 头选格式，而 mirror-site / reconcile-gaps 的全部 profile
都是 `accept: */*`，从不声明图片格式支持——CDN 一律回退 JPEG，真浏览器同一 URL 拿
avif/webp。实证（basement 镜像盘上现捞）：`…-1920x833@@auto=format&w=1200.webp`
扩展名 `.webp`、魔数 JPEG——**源资产本身是 webp，被协商转码回 JPEG 落盘**，391 个
`@@auto=format` 变体无一幸免。两侧都从镜像读，跨侧门与像素门照绿；这是"错的镜像能让
下游门全绿"的又一实例，查法（魔数 vs 扩展名 vs 账本三方对照）与处置（浏览器同款
Accept 补抓 / 存量登记偏差）入 §1.2。

**判级纪律**：Sanity 本身不定级，**内容烘焙时点才定级**——构建期烘焙（不改判级）/
局部 fallback 查询（B 类 API 快照，query-keyed 应答）/ 运行时装配 + 内容漂移（D 因素，
对象改述为"某时点快照"）三形态，franshalsmuseum 的 C/D 判定就是第三形态。

**其余入册**：变体阶梯两层展开（直连 + next/image 代理，代理 URL 要先解码 `url=` 再判
主机，否则 off-host 普查整批失明）；运行时拼接 API base 普通 host 改写命不中（hashgraphvc
偏差 6.2 的服务层模板改写 + 404 壳重试行为照抄）；`_key` 是化石不进 normalize 名单；
`<sha1>-<W>x<H>` 文件名自带源尺寸与内容地址，变体归并按 hash 段做（13,870 引用收敛
722 源资产）；`cdn.sanity.io/robots.txt` 按 project 路径逐条判定。

待落地（下一个 Sanity 站实战时）：reconcile-gaps 请求头梯子加图片 Accept profile、
fingerprint.mjs 认 Sanity 指纹并报 projectId、Next+Vercel+Sanity 栈开工速查卡。

## v0.3.5 — X 类的另一半真相：镜像可完整而站不可复活（mustachelab）

v0.3.4 证明抢救镜像能走完 L3;本版记录**它的对偶失败形态**并命名入册。
Merlin's Mustache LAB(2014 Awwwards,"电路板即作品集",CreateJS 加载器 + Swiffy +
清单驱动 DOM 引擎):代码层 22/22 全捕获、引擎逐行可读,而**画面层 157/160 资产在
任何档案、任何年代、任何 host 拼写下零捕获**——IA 爬虫不执行 JS,凡 `LoadQueue(PATH)` /
`RESOURCE.dir+file` 拼出来的 URL 从未被请求过。断网跑起来是一张纯白页。

**规则修正(SKILL.md X 类 + archival-rescue §1.9)**:"CDX 无覆盖才是真不可做"**按资产层
读,不按站读**。Step 0 新增分层覆盖侦察——读引用形态(静态标签 vs 清单拼接)→ 对代码
暗示的资产子树做 CDX 前缀查询(collapse=urlkey 零行 = 任何年代零捕获,权威)→ 分层
报告覆盖率;媒体层为零的站在锚点选定前就改判终点,不要跑到 M0.5 撞白屏。

**洞账的补全集纪律**:wayback-mirror 内建洞扫描走静态提取,对 class-4(运行时拼接)
整类失明——157 个洞一条没报。做法:站点侧推导器把清单机械展开(逐条带 init.js 行号)
→ 对账 → 整批 append 进 wayback-holes.txt,它同时就是资产若回归的 seeds 清单。
断网门语义照 §4.5:36 个去重失败 URL 逐条 ⊆ 洞账、账外为零——**门在全损的站上照样
能证明"损失被完整登记"**。

**外部档案没有可自动化的备胎**:archive.today 有 CAPTCHA(agent 不代过验证码),
TimeTravel 聚合器不可达——都只能登记给人工。唯一现实的复活路径是**权利人本人**
(该站母公司 bremen.com.tw 仍在线):"联系作者"进 DEPLOY.md 选项表。

顺带入册两条小刺:`assets/<host>/` 跨 host 约定与源站自己的 `/assets/` 目录共用命名
空间(本站 www 别名树落进了真实 assets 目录,无碰撞但属既存隐患);serve 端口按槽位
分配,别的会话占 0-3 槽时 mirror 落 25001——探针别硬编码 21001。

## v0.3.4 — X 类的成人礼：死站第一次走完 L3 全程（first-launch）

此前三个死站抢救止于 L1。first-launch.com（2013 Awwwards Honorable Mention,
jQuery + skrollr 七幕滚动叙事,约 2022 死亡、域名被停车页夺舍）从 Wayback 锚点
2015-01 重建后,**整条下游管线原样跑通**:策略 A 外壳(T-LOCALIZE=4/T-NOINDEX=1,
verify-shell 全 hunk 可重放)、数值门 32 检查点 × 146 选择器 **9,856 样本全等**、
像素巡航在 0.1 自比带宽内(7/9 检查点精确零)、src/ 自包含交付物复制出 repo 断网
CLEAN——没有一道门为"参照是档案"改语义。"标准镜像"从口号变成实测。

**X 类新经验入 archival-rescue.md**:§1.6 验尸三件套(停车页 CDX 签名:
`.well-known/*`/`ads.txt` 冒 text/html 200;根页 digest 断代;同 digest 交叉鉴伪——
mobile.html 孤本与停车页根页同 digest,伪身不采)、§1.7 锚点偏置一次罩住别时代孤本、
§1.8 Google Fonts 两跳种子(CSS→TTF 都问档案要当年字节)、§4.5 CLEAN 门死站语义
(**失败 ⊆ 洞账**,且源站生产环境自己的 404 不是洞,照抄即保真)。

**三个被数据抓住的工具缺陷,全部修复 + 自检钉死(33→36)**:

1. ⛔ **wayback-mirror 的 off-host 普查从第一天起静默失效**——extract-refs 合同是
   `onOffHost(host, href)` 传裸主机名,消费侧拿它 `new URL()` 必抛、`catch {}` 吞掉,
   普查恒空:引用 Google Fonts 和 Vimeo 播放器的页面报"无 off-host"。**沉默的 catch
   包住一个接口,是普查死亡的标准姿势**;selftest 现在钉着这份合同。
2. verify-standalone 把 Compass 盖进 CSS 的 `/* line N, ../../x.scss */` 出处注释当
   逃逸引用(注释跳过正则不认 `/*` 开头的行)——5 个假阳性全落在**神圣不可改的内容
   字节**上。修门不修字节;自检双向断言(注释不报 + 真逃逸照报)。
3. pixelcompare 的 pump 协议要求 `?__probe` 但没人自动补,裸 URL 报
   "__pump never appeared" 且 pixel-walk 的 60 字符截断把提示裁掉、指向 serve 配置。
   现在 pixelcompare 自动补参。

**首个"源码已可读"的目标**(reverse-engineering / readable-source / dom-shell 各补):
手写多文件站跳过 beautify 要**显式登记**;vendor 逐字节鉴真(skrollr 与上游 tag diff
为空、jquery sha1 官方一致)一次杀掉整棵"魔改库"假设树;L3 不拆不重命名,等价门退化
为一条 suffix 断言(src = 出处头 + 镜像字节的精确拼接);"可读"不是"可改写"的许可。
verify-crossside 同步合同的边界立此存照(§0.26.1):rAF 循环引擎走 async 采样——
force-jump 语义先读源码、jQuery trigger 同步驱动命令式层、三重 rAF 后采 inline style。

## v0.3.3 — turbopack 的三个暗形态：闭包不再对场景失明（basement C2 坐标系）

basement 的 3D 场景在静态 require 图里**完全不存在**——CanvasLayer 经
`e.A(724681)` 异步加载一个 loader stub,stub 拉 10 个 chunk 再 resolve 真场景
模块。closure 从种子算出 173 模块"已闭合",而 office 场景、街机小游戏、KTX2
管线一行都不在里面。三个未识别的 turbopack 形态,全部入图(module-map.mjs):

1. **scope hoisting 合并子模块**:一个 factory 内 `e.s([exports], subId)` 把多个
   源模块的导出注册在各自 id 下,这些 subId 可被其它 chunk require——87 个
   "幽灵缺失 id"全是这种,现作为 aliases 入图;
2. **`e.A(id)` 异步加载边**:`import()` 编译产物,和 `e.i` 一样是依赖边;
3. **`e.v(cb)` loader stub**:异步模块定义,resolve 目标 `cb(<id>)` 是 stub 的
   真实载荷。

配套:closure.mjs 按别名索引并**按所有权去重**(此前一个模块按别名被计多次,
行数虚报 3 倍且切片会重复切);别名解析失败不再报幽灵缺失。修完重算:闭包
173 → **308 模块 / 109,355 行**,场景图整个浮出水面——顺带钉出 **31 个懒加载
chunk 从未进镜像**(L1 静态爬虫的结构性盲区:异步 loader 家族)。

自检 30 → 33:三形态 + 别名去重各有断言。

## v0.3.2 — 语义门在重站上的成人礼（basement.studio C1 层收口）

rauchg 18 路由的门,拿到 basement.studio(144 路由、Vercel 动态流、React 19 流式
渲染、三层嵌套路由组)上淬了一遍。**verify-flight PASS 144/144,模块双射 50 对
零违背**——每一条都是真实假红逼出来的规范化,或真实漏网逼出来的审计加固:

**verify-flight 规范化 N11–N16**:N11 row-0 平台字段(b/u/r/s/a/h/l/p/d——Vercel
动态流 vs 本地静态构建的部署指纹,先删后按固定序重加,否则键序比较照红)、
N12 seed/routerState 尾槽、N13 children 深展平(渲染等价;数组分组=构建切分不是
源形状)内嵌 N15 无键 fragment 展开与 N9 相邻字符串合并、N14 数字自动 key→null、
N16 undefined-prop 键删除;default 导出编码归一("default"≡""≡"(default)");
N1/N3/N5 chunk 路径放宽到 `/_next/static/immutable/chunks/`。

**双射审计换了脊柱**:原按 resolve 序配对、全长相等才入表——平台包装节点
(*Boundary)在剥离前就被解析,两侧引用数差 1,**审计在 144 路由上静默空转
(0 对也算过)**。改为两树比对相等后在规范化等树上并行行走、按树位置一一配对
($c 节点自带 $mid,firstDiff 无视)。长牙当天就咬到真violation:源站单文件多
导出(528233 = SocialLinks/InternalLinks/Copyright footer 三件套)被生成器拆成
三个文件——**一个模块 id 挂多个导出名,就是源站单文件多组件的化石**。

**两个新化石**(rsc-reconstruction 谱系):① optimistic routing 的动态段元组第
4 元 `staticSiblings` 是**源 app 树结构快照**——basement 靠它钉出未链接暗路由
`/showcase/showcase-list`(线上 404,app 树里真实存在);② 流式行 X/C 之后,
路径化自引用(`$id:seg:seg`)要在**原始行 json** 上走叶,整行重解会栈溢出,
cycle guard 误杀则把 `{"$cycle":"6"}` 字面量烤进产物(v0.3.1 的修补在此定型)。

自检 28 → 30:双射审计必须真收集到对(空转即红)、同源模块拆开必须红。
(v0.3.1 为纯脚本补丁:X/C 流式 sentinel 容错进两个解析器 + sweep 外链后缀匹配。)

## v0.3.0 — C1 攻克：RSC 重构式逆向（rauchg.com 远征）

**判级修订**：C1 从「拒绝」改为「可做：重构式逆向」。服务端组件源确实不下发,
但它的完整输出(flight 流)内联在每页 HTML 里——那就是规格书。重构一个可构建的
Next 工程,语义门收口。实测 rauchg.com(Next 16.1.1/Turbopack/React 19 canary):
**18/18 路由 flight 语义一致、模块 id 双射 19 对、运行时 sweep 18/18**;盲逆向对
答案(rauchg/blog)判卷:结构 ≈95%、行为 ≈98%、字面 ≈90%,7 个依赖版本从字节
证据精确命中,`withHeadingId` 连函数名都对上;盲区 3 处全是无入链路由。

**新工具**:`scripts/flight-decode.mjs`(C1 坐标系:flight 流 → 已解引用元素树,
I 行导出名=白送的 tier-1 命名证据)、`scripts/verify-flight.mjs`(语义门:自带
解析器,规范化只收构建哈希命名空间,模块 id 全局双射;站点登记项走
`--normalize-props`/`--normalize-class`)、`scripts/reconcile-gaps.mjs`(运行时
缺口对账器:请求头梯子 + 逐 URL 容错 + 分批记账)、`tools/flight-to-mdx.mjs`
(正文反推器:markdown 构词回 markdown、组件形状回 JSX、其余字面 JSX 兜底)。

**新指南**:`references/rsc-reconstruction.md`——flight 保真神谕(键序=JSX prop
序、false/undefined/尾空格化石、作者不一致本身是保真面)、MDX 反推四陷阱、
语义门规范化族的论证、平台层工件(Vercel / → /index 重写正是线上 React #418
水合错误的根源)、原理性不可恢复面、盲逆向纪律。

**既有工具回填**:`mirror-site` 请求头梯子(同一个 403 两种相反的药:landonorris
要 Referer,video.twimg 恨 Referer);`netcapture --fetch` 逐 URL 容错 + 分批记账
(一次异常曾让 725 个已落盘文件全部账外);`verify-mirror` 魔数表认 fMP4 盒族
(.m4s 无 ftyp,45 个真分片曾被判损坏);`extract-refs` 根相对引用按**文档宿主**
解析(m3u8 里的 /path 属于 video.twimg.com,不属于站点);`sweep-routes` 增
`--allow-failures`(契约同 --allow-errors:登记可见不判死)+ 控制台记录带 URL
(否则网络回声错误无法按注册键匹配)。

**镜像盲区 checklist 新增三行**:App Router 运行时面(`?_rsc=` 载荷、next/image
变体从 srcset 穷举——1,078 vs 浏览器碰到 217)、爬虫专供 OG 路由、无入链
well-known 路由(/atom /rss /feed /sitemap.xml——对答案暴露的盲区)。

selftest 22 → 27:合成 flight 流夹具(T 行长度、空 id HL 行、I 行导出名)+
语义门绿/红双面(哈希命名空间归一 = 绿;一个文本字节 = 红)。

## 目录分组与 chunk 图谱(v0.2.8)

- **v0.2.8**:拼接式分解的下一档落地——新增 `group-parts`:平铺部件按**字面证据**(共享标识符 token)折进域目录;前导规则只认大写类族(Camera*/Wave* → camera/ wave/),小写动词族拒分(字面但糊的桶比平铺更藏东西),压缩名 chunk 证据不足即整体保持平铺;**先按新布局重拼验 sha 再动盘**。`census-bundles` 新增 `--md`:chunk 依赖图直接生成逆向笔记坐标页(import 别名样本随行——一级命名证据)。实测 hashgraphvc:场景 chunk 151 件 → scene/camera/wave/sun/cascade/sky 等 24 个域目录,33 chunk / 2,043 件重拼仍逐字节一致;overworld 的压缩名入口正确地整体拒分。v0.2 路线图至此全部落地。

## 冒烟自检与 CI（v0.2.7）

- **v0.2.7**：仓库获得可一键运行的护栏——`npm test`(`selftest/run.mjs`,零依赖、离线、秒级):全部 55 个脚本语法解析、零依赖门、共享库的**实测教训 fixture**(逐条标注为哪个版本流过血:查询变体不坍缩、Storyblok 拍平不误伤带点目录、括号配平、实体解码边界、srcset 逐候选、模板字面量拒收、第六形态双闸、拼写孪生归一)、verify-mirror 微型镜像端到端(自洽必绿,坏一个字节必红)、SKILL.md 引用完整性。附 GitHub Actions workflow(push/PR 自动跑)。测试住仓库根 `selftest/`,skill 载荷不带一行测试代码。

## 相对引用与输入通道（v0.2.6）

- **v0.2.6**：用户目视复查抓出两类假绿——引用提取新增**第六形态:文档相对属性引用**(带两道实测闸:值须含 `/`——HTML data 属性里的缓动名/版本号会伪装扩展名;仅文档语境——JS 内相对字符串按 chunk URL 解析是猜测)（`src="./content/x/thumb.png"`、`href="content/.../1.jpg"` 这类不带斜杠的老派拼写,原五形态全盲,闭包门对着缺了整个画廊的镜像报 ∅;属性锚定 + 按文档 URL 解析 + 扩展名闸,实测一站 133 洞现形、130 个从档案救回）;门手册新增 **§4.8.4 驱动器要匹配站点的输入通道**（scrollTop 走查开不动 wheel 监听的站——0/0/0 报在从未开动的体验上;走查前先问站听什么,用 WheelEvent 实驱并以帧推进观察量确认在动）。另:死 API 的登记式护栏范式(Maps key 已死 → serve --rewrite 在 map_init 入口守卫,降级留白,登记于 DEPLOY)。**追溯审计**:新形态对全部 9 个既有镜像重跑闭包——5 个旧绿变红,分拣出真洞(hubtown faqs 图标)、范围外搭车引用(raycast store 预取,登记声明式前缀豁免而非扩爬)与档案无捕获(darknetflix 洞账 92→190 如实扩容),全部收敛回绿;**新形态上线必须追溯重验旧绿**,否则每个旧 ∅ 都成了未验证的断言。

## 停车页与拼写孪生（v0.2.5）

- **v0.2.5**：存档抢救经第三个死站（jiouhe.com@2018,"原地替换"型:域名活着,应答的是停车页）淬火:`wayback-mirror` 抓取段新增**停车页验尸 + 逐候选回退**（停车服务 200 应答,状态码滤不掉——每份字节对停车签名族检查,命中则退到同 URL 次近捕获;⛔ 域可以死在窗口里）;选择段按 `canonicalUrl` 归一去重**拼写孪生**（`:80` 显式默认端口、`f.eot?` 空查询 IE hack、尾斜杠——各自都会两 URL 撞一路径,账描述败者）;洞查账同样走规范化（别名回填不再把 `?` 拼写塞回账本）;seeds 模式接受显式 `--window-days` 回溯（稳定文件只在自己被抓的那天有捕获——2018 的页合法依赖唯一捕获在 2015 的 JS,放宽即登记）。`verify-mirror` interstitial 表新增**域名停车族**（Sedo/Rakko/generic for-sale——停车页是"URL 下不是这个站"的 interstitial）。⛔ 新铁律入 `archival-rescue.md`:**抢救项目永不对原域跑 mirror-site**——200 型停车会覆写救回的真身且账同步更新,五门全绿地完成污染(实测,被一条外联当场戳穿)。jiouhe 终态:0 永久洞、单页全站 0/0/0、滚轮帧动画机器完整复活,并与用户当年的手工恢复版结构互验一致。

## 失效站点的存档抢救（v0.2.4）

- **v0.2.4**：X 类不再等于"做不了"——新增 `wayback-mirror`:从 Internet Archive 把死站救成**标准镜像**（CDX 枚举 → 锚点+时间窗选连贯捕获,auto 锚点让抢注者时代的 301 洪水靠状态码+窗口出局 → `id_` 旗抓原始字节,绝不镜像被注入改写的回放页 → 与 mirror-site 同构的账本 + `wayback-provenance.json` 逐文件捕获坐标）。⛔ **洞是既成事实,登记即交付**:`wayback-holes.txt` 同时是 verify-mirror 的豁免清单;⭐ **别名回填**（同名异路捕获按推断回填,字节合理性校验挡住 SPA catch-all 假捕获,单列 FILLED BY ALIAS）;**seeds 模式**（探针/sweep 的 404 清单当种子问档案要,`web/<锚点>id_/` 自动落到最近捕获——死站版的抓包补录,迭代到不动点）。配套:`serve` 文本改写门改为账本 content-type 优先（无扩展名落盘的字体 CSS 曾绕过改写外呼）;`sweep-routes` 新增 `--allow-errors`（登记的怪癖放行不判红——死站无源可对拍时的判断登记通道）;新指南 `references/archival-rescue.md`。实测两个死站:darknetflix.io（2020 SOTY,8/15 路由复活,92 永久洞如实登记——含 7 个任何时代都未被捕获的懒 chunk）与 umamiland.withgoogle.com（Google 体验站,**9/9 路由全清**,探针→种子三轮迭代收敛,窗口放宽决策登记在案）。

## 渲染广度门（v0.2.3）

- **v0.2.3**：新增 `sweep-routes`——全站渲染广度门：**全部路由,一个浏览器**（此前是逐路由起一个 Chrome 的手搓循环:122 路由约 40 分钟,且并发探针会互相收割同工作区的孤儿实例;现在 7.5 分钟,单实例后事故面消失）。逐路由记录页面错误/请求失败/外联,`--interact` 交互钩子驱动 load 到不了的状态（入场点击等）,`--eval` 逐路由采集（音频池普查在此搭车）,`--allow-external` 放行已登记的 EMBED 主机——允许主机上的 4xx 是它的离域行为（域名锁 Vimeo 实测）,报告不判红。与 probe 明确分工:sweep 管广度,probe 管深度。

## 音频输出面与 Content-Signal(v0.2.2)

- **v0.2.2**:**声音成为验收面**——新增音频普查判据(驱动入声音上下文后,音频引擎池内全量 loaded + 零音频 404 + 零外联,三侧一致;headless 的 suspended 属自动播放策略不判红),并确立"池子即账本"的镜像采集法(从 Howler 池倒出全部 src 作种子,实测不猜——运行时拼接的音频 URL 族对静态提取整类不可见);`legal-and-deploy` 新增 **Cloudflare Content-Signal** 托管 robots 的读法(匹配语义不变、信号按用途归类、⛔ 意图如实呈交不许消化);`census-bundles` 锚定类扩为 `^ \n ; }`(压缩 chunk 的 `;import`/`}export{` 中缝形态曾骗过行首锚定);`make-standalone` 不再对无自有构建的项目报幻影 unpinned 路径。实测 overworldaudio.com:98/98 Howl、20 chunk/435 部件重拼一致、379/379 字节自证。

## 终点分级与交接边界（v0.2.1）

- **v0.2.1**：开工评级时向用户呈交**三级终点选择**（L1 镜像存档 / L2 工程化复刻 / L3 源码化,带判级结论与分级成本;梯子单调,选低不亏、随时续跑升级）;新增交接文档 `references/beyond-the-rebuild.md`——**脚手架化明确划出 skill 边界**（"到人能读懂的真实为止"）,交接三样东西:衍生层原则（另起一层,发明才合法）、带裁判的 fork 工作法（把变红的字节清单/重拼门当偏离台账,防"近似漂移不可见"）、权利地图（资产与内容最重,先换占位物;代码著作权随偏离度渐变）。

## 无容器产物的语义源码层（v0.2.0）

- **v0.2.0**：v0.2 线开篇——**拼接式分解**：Vite/esbuild 这类 scope-hoisted 无容器产物（模块边界被打包器抹掉,重写式拆分必然静默重排副作用）现在有了自己的源码化路径。新增三件套:`census-bundles`（chunk 级坐标账本:逐 chunk sha256/行数 + ESM import/export 依赖图,import 别名即命名证据）、`slice-esm`（把 chunk 切成按声明命名的部件文件,**按序拼接逐字节等于原件**——切点只在可证明安全处下刀,写盘前先自证重拼）、`verify-reassembly`（重拼门:逐部件 sha + 拼接 sha + 对活原件三重比对;字节等价成立时,全部运行时门的裁决免费转移到可读层）。实测 hashgraphvc（Nuxt 3 + Three WebGPU/TSL,33 chunk / 44.9 万行）:2,043 个部件全数重拼一致,18.9 万行的 worker chunk 拆出 751 件、场景 chunk 拆出 CameraSplineSystem / WebGPUWaveSimulation / Gerstner 等 151 件——名字全部来自代码自身。

版本随真实复刻项目递进：每个版本发布的功能与修复，都先在至少一个完整项目上验证过。经验教训的完整记录在 `references/` 各文档中，此处只列变更。

## 流程与验收体系（v0.1.0 – v0.1.11）

- **v0.1.0**：首个版本。四阶段流程（判级 → 镜像 → 逆向移植 → 验收）、六条纪律、判级门。
- **v0.1.1**：新增 Shopify 平台指南与流媒体（HLS/DASH）补录；修复爬虫对协议相对 URL 的处理；扩大零外联检查的覆盖面。
- **v0.1.2**：新增场景数值比对、设备能力冻结协议、镜像闭包校验；判级升级为"框架模式 × 引擎范式"二维判定。
- **v0.1.3**：新增打包字节切片移植工具；修复冻结协议对挂在被冻结分支上的子系统的漏检。
- **v0.1.4**：修复截图耗时过长时产生的稳定假差异（新增快门速度判据）。
- **v0.1.5**：验收改进：检查点区分位置与状态两个维度、统一清点粒度、禁止剔除差异区域；调试端口改为确定性分配。
- **v0.1.6**：新增镜像自检：检测参数化图片 CDN 导致的多 URL 坍缩为单文件。
- **v0.1.7**：外壳变换守卫改为逐条改动各带命中次数下限。
- **v0.1.8**：期望值改由浏览器实算获取；文档新增仪器校准与排查顺序指南。
- **v0.1.9**：新增登记表复核步骤；修复时变量（时钟）被写入验收记录导致的单侧假绿。
- **v0.1.10**：新增浏览器进程组回收（残留实例会悄悄放宽像素容差）；文档补充更正记录的取证要求。
- **v0.1.11**：噪声基线改为两侧分别测量；新增逐帧着色清单；移除工具链中的重复实现。

## 版权取证与镜像完整性（v0.1.12 – v0.1.16）

- **v0.1.12**：版权取证层重写：逐资产表新增"第三方权利人"列；公共领域判定要求逐位作者具名。
- **v0.1.13**：变更：版权判断交还使用者；镜像完整性不再受版权考量影响，资产一律全量抓取。
- **v0.1.14**：新增镜像真实性检查：识别以 HTTP 200 返回的挑战页、登录墙等冒充资产的响应。
- **v0.1.15**：新增 `robots.txt` 解读指南（逐路径许可、按行为类别归类禁令）。
- **v0.1.16**：变换守卫新增目的断言（命中下限之外验证改动达成目的）；修复两处静默挂起。

## 无人值守流程加固（v0.1.17 – v0.1.23）

- **v0.1.17**：修复判级树对纯 GSAP 站的覆盖缺口；补齐三件检查工具；确立门与生产代码隔离原则（检查不得 import 其审计对象的生成代码）。
- **v0.1.18**：爬虫对白名单外主机改为记录普查（不再静默丢弃）；引用提取支持代码字符串里的路径（含 Service Worker）；修复补漏运行截短账本的问题。
- **v0.1.19**：新增 SSG 数据块比对门（`verify-payload`）；URL 本地化新增 unicode 转义写法支持。
- **v0.1.20**：serve 新增 `--rewrite` 登记式改写，处理按自身域名分支的源码；每条规则首次命中入日志。
- **v0.1.21**：像素比对新增非空画面前置条件（拒绝在空白帧上给出比较结果）。
- **v0.1.22**：修复冻结页面的驱动时机：驱动与真实时间交错，等待资源就绪。
- **v0.1.23**：改进残差归因流程（逐残差追溯到具体代码行）。

## 源码化阶段（v0.1.24 – v0.1.31）

- **v0.1.24**：新增源码化阶段。产物分为三段：只读证据（`mirror/`）→ 逐字移植（`port/`）→ 可读源码（`src/`）。
- **v0.1.25**：文档：扁平脚本的拆分粒度约束（声明顺序即求值顺序等三条硬约束）。
- **v0.1.26**：修复切分工具中导致"不可再拆"误判的缺陷。
- **v0.1.27**：修复作用域安全重命名的四类运行时错误；修复检查工具在声明了 `toString` 的代码库上的误报。
- **v0.1.28**：新增仓库外自包含验证（复制、断网安装、构建、运行对拍）；交付物自带验证钩子（`serve.mjs` + `probe-shim.js`）。
- **v0.1.29**：文档：变量命名的证据分级与人工抽查清单。
- **v0.1.30**：构建复现改为逐字节比对产物，不再依赖 shell 历史。
- **v0.1.31**：验收记录绑定审计对象版本，防止对象再生成后绿灯过期。

## webpack 模块容器支持（v0.1.32 – v0.1.39）

- **v0.1.32**：修复词法分析器被含引号的正则字面量带偏的问题；修复三处镜像层缺陷。
- **v0.1.33**：新增 webpack 模块容器读取（`module-map`）：竖切边界由打包器给定；认不出容器时报错，不回退到扁平分层。
- **v0.1.34**：文档：模块定位方法（关键词计数仅产生候选，需交叉证据确认）。
- **v0.1.35**：`closure` 对未知种子 id 报错并给出相近建议，不再静默丢弃；新增编排表达式解析支持。
- **v0.1.36**：测试改进：用例须覆盖多条代码路径。
- **v0.1.37**：测试改进：对照输出并排打印。
- **v0.1.38**：文档：门与手算分歧时的核查流程。
- **v0.1.39**：文档：移植缺前置动作的判别方法（读源站真实调用点的调用序）。

## 跨侧门与用例采集（v0.1.40 – v0.1.45）

- **v0.1.40**：新增跨侧门（`verify-crossside`）：同一输入同时喂两侧；用例分"必须相同"与"仅记录"两组，每次运行自证测量了两侧。
- **v0.1.41**：`name-modules`：模块命名按证据分级，支持从消费方代码取证（属性名不被压缩）。
- **v0.1.42**：`scripts/` 全面零依赖（外部工具经钉版本的 npx 调用）；新增 `verify-zerodep` 门；修复模块容器重复 id 的去重（按对象字面量语义，后者胜出）。
- **v0.1.43**：验收记录连同调用命令与豁免清单一并入库。
- **v0.1.44**：新增 `harvest-cases` / `verify-harvest`：门用例从源站活引擎采集；缓动函数按取值采样识别。
- **v0.1.45**：修复探针 stdout 在 64 KiB 处被静默截断的问题（进程退出前等待 flush）。

## Turbopack 支持与门加固（v0.1.46 – v0.1.53）

- **v0.1.46**：新增冷审计模块清点（`cold-audit-modules`，检出条件 require 造成的漏移植）；`make-standalone` 改为按账本复制。
- **v0.1.47**：`module-map` 新增 Turbopack 扁平容器支持；新增容器读取合理性判据（读出的结构必须解释得了整个文件）。
- **v0.1.48**：`pixelcompare` 新增 `--freeze-css`；文档：CSS 动画不受 JS 时钟冻结影响的场景按带宽受限处理。
- **v0.1.49**：修复源码化发射器把数字模块 id 写成字符串导致页面空白的问题。
- **v0.1.50**：所有逐对象遍历的检查统一报告覆盖率（`n/N examined`）；修复冷审计在未覆盖打包形态上误报通过。
- **v0.1.51**：确定性 shim 接管 `IntersectionObserver`；像素门可用阈值由 0.5 收紧到 0.1。
- **v0.1.52**：新增声明分类门（`verify-decls`，适配 esbuild 惰性包装）；`pixel-walk` 新增双滚动（load 后与 init 后各一次），修复检查点驱动被页面初始化吞掉的问题。
- **v0.1.53**：`make-standalone` 参数化（`--own` / `--build-out` / `--externals` / `--serve-port` 等），清除硬编码；流水线各步补齐 `--check` 可复现性。

## C 类细分与 WebGL 对拍仪器（v0.1.54 – v0.1.59）

- **v0.1.54**：判级细分为 C1 / C2：客户端持有行为源的声明式引擎站（如 R3F）按 A 类移植，仅 C1（如 RSC 服务端组件）拒绝；修复服务器路径穿越守卫误杀含 `..` 的合法文件名；修复 Turbopack 容器依赖前言丢失。
- **v0.1.55–58**：修复多 id 模块的别名注册、内层滚动容器识别、就绪与驱动的交错泵；新增重复帧判据。
- **v0.1.59**：`pixelcompare` 报告实际测量位置（`measured at`）；新增同位置同侧对照的残差归类方法。

## Next.js App Router 全站支持（v0.1.60 – v0.1.68）

- **v0.1.60**：CDP 补录改为按路由执行；文档：`next/image` 等服务端缩放端点属于运行时接口，静态提取不可见。
- **v0.1.61**：新增长度前缀载荷门（`verify-lenprefix`）；新增 `lib/flight.mjs`（长度感知的 React flight 流改写，服务层与构建层共享）；修复 URL 本地化缩短 flight 行导致的页面解析失败。
- **v0.1.62**：修复引用提取在 flight push 边界截断 URL 产生幻影引用的问题（先重组再扫描）；`netcapture --fetch` 同步写入镜像账本；引用扫描排除账本文件。
- **v0.1.63**：本地化保护文本位置的 URL（锚文本不再被改写）；全部站点变换统一走长度感知路径；`make-standalone` 支持多外壳站点，引用检查改用共享的 url→path 映射。
- **v0.1.64**：`verify-fresh` 支持无打包步骤的项目并明示未检查项；`verify-standalone` 支持指定交付物目录。
- **v0.1.65**：`verify-payload` 新增 React flight 载荷支持（判据：结构一致且值差异限于引用）；`stubExtHosts` 覆盖运行时注入的遥测脚本。
- **v0.1.66**：引用提取丢弃模板字面量前缀（含 `${` 的候选不再被当作 URL 抓取）。
- **v0.1.67**：文档：全站对拍的成本估算按浏览器启动次数计，并给出并发建议。
- **v0.1.68**：新增引用可达门（`verify-refs-served`，把产出字节里每条引用逐条向服务器验证）；引用提取支持嵌在查询参数里的 URL；serve 按 `url=` 参数解析图片优化端点、新增唯一查询变体回退；修复含括号文件名被截断的问题。

## Turbopack 分层交付（v0.1.69）

- **v0.1.69**：新增分层交付方案（移植件以原名置于 `site/`，原件留在镜像，经 `--fallback-root` 分层），适配运行时内嵌 chunk 清单的 Turbopack 站点；修复 `notice` 配置为布尔值时被渲染为页面文本；serve 对会话态 `_rsc` 令牌按同字节变体应答；URL 本地化支持带 userinfo 的地址（如 Sentry DSN）；`beautify-bundle` 输出回验可解析性；`verify-mirror` 的闭包缺口全量落盘为种子文件；`name-modules` 支持 Turbopack 容器。

## Nuxt 3 / Vite 支持（v0.1.70 – v0.1.71）

- **v0.1.70**：所有探针脚本严格校验命令行参数，未知参数直接报错；`probe` 新增生命周期报告（渲染器崩溃、主框架重导航）；引用提取支持 Vite 相对模块说明符（`__vite__mapDeps`、`import("./x.js")`）；serve 按镜像账本记录的 content-type 伺服无扩展名路由；字体真实性校验接受 `.ttf` 后缀下的 OpenType/CFF。
- **v0.1.71**：URL 本地化豁免 Nuxt `__NUXT_DATA__` 数据岛（其内容是运行时解析的程序输入）；`verify-payload` 支持 Nuxt 3 外置 `_payload.json` 载荷并优先于内联形状识别。

## Headless CMS 资产桶（v0.1.72）

- **v0.1.72**：支持 Storyblok 式图片变换 URL（`/x.jpg/m/110x110/filters:...` 这类"文件名后还有路径"的形态）——URL 落盘时对已知资产扩展名后的路径段拍平，伺服端对同形态请求做同一变换回查；修复绝对 URL 提取时以括号收尾的地址被误剪（如 `quality(70)`）；`verify-refs-served` 与 `make-standalone` 新增 `--allow`，接受与镜像门同一份豁免清单（源站自身 404 的引用不再逼门变红）。

## webpack 箭头工厂与双语站（v0.1.73）

- **v0.1.73**：模块图谱与冷审支持 webpack 箭头工厂（`"key":(t,e,s)=>{}`，新编译目标的产物）；模块图谱新增跨 chunk 依赖记录（`externalRequires`）——依赖 vendor 分包的 chunk 不再被闭包误判为自洽；引用提取修复两类越界（内联 `url(...)` 尾随 CSS 声明、实体解码引入的引号边界）；爬虫台账修剪无人引用的陈旧失败行；`verify-mirror` 将"另一种已知图片格式挂错扩展名"降为线索（源站自身的标注习惯）；`verify-payload` 新增 `--allow-absent`（无数据岛的纯标记 SSG，两侧一致缺席才放行）；模块落源支持带目录的模块名；`make-standalone` 不再把本地化的 preconnect 裸主机当资产缺口。

## 自证型交付物（v0.1.74）

- **v0.1.74**：`make-standalone` 生成的自足副本现在自带**字节清单**（逐文件 sha256，对落盘后的字节钉死）与零依赖校验器 `verify-bytes.mjs`；生成的 `npm run check / build / serve` 每次先重验清单，副本在任何机器上都能自证"这仍是验收过的那份字节"（被静默编辑或位腐坏的文件当场判红），端口自有构建产物列为 unpinned；`serve` 拒绝伺服 `.git` 路径段（防误配 root 时泄漏仓库对象库）。