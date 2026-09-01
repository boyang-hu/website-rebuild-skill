# 更新记录

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