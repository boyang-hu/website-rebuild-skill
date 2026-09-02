# 更新记录

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