# archival-rescue.md — X 类抢救:从 Wayback Machine 重建死站

X 类(原站已消失)占历年获奖站约 29%。站死了,但 Internet Archive 里往往躺着捕获——
本指南把它们变成**标准镜像**:`scripts/wayback-mirror.mjs` 产出与 `mirror-site.mjs` 同构的
`mirror/` + 账本,下游全部门(verify-mirror / serve / sweep / 外壳 / 对拍自比)原样工作。

⭐ **"标准镜像"不是修辞——X 类可以走完 L3 全程**。实测 first-launch.com(2013 Awwwards
死站,skrollr 滚动叙事):抢救镜像之上,策略 A 外壳(verify-shell 全 hunk 可重放)、
CLEAN/零外联、refs-served、数值门(32 检查点 × 146 选择器 9,856 样本全等)、像素巡航、
源码化自包含门,**一路全绿到 M(n+1)**,没有一道门需要为"参照是档案而非活站"改语义
【firstlaunch】。此前三个抢救止于 L1 是选择,不是天花板。

## 0. 三个决定,缺一个产出就是汤不是证据

1. ⭐ **只取原始字节**:一切抓取走 `id_`(identity)回放旗——
   `https://web.archive.org/web/<ts>id_/<原URL>` 返回捕获的原始字节,无改写、无工具条。
   **永远不要镜像回放 HTML**(它被注入了 archive 的脚本与 URL 改写,是另一个站)。
2. ⭐ **一个连贯的时刻**:`--anchor`(默认 auto:根页 200 捕获最密的年代取中位)+
   `--window-days` 逐 URL 选窗口内离锚点最近的 200 捕获。**从任意年代乱缝的镜像是一个
   从未存在过的站**;抢注者时代的 301 洪水靠状态码 + 窗口天然出局
   （实证:`case-studies/archival-rescue.md` §0）。
3. ⛔ **洞是既成事实,只能诚实记账**:活站的闭包门要求 ∅、补爬可以填洞;死站的洞
   **永远补不回来**。`mirror/wayback-holes.txt` 逐条登记(URL + 引用者),它同时就是
   `verify-mirror --allow-missing` 的清单——门对**已登记**的洞保持绿,对未登记的照红。
   账即交付物的一部分。

## 1. 别名回填:档案可能用另一个名字认识这个洞

`wayback-mirror` 对每个洞做一次 CDX 同名(basename
精确匹配)查询,窗口内命中则抓取并**存到被引用的路径**上,让引用得以解析（实证:`case-studies/archival-rescue.md` §1）。

⛔ **别名回填是推断,不是捕获**:"同名异路 ⇒ 同一文件"可能错(同名不同文件存在)。
所以它在 `wayback-holes.txt` 里单列 **FILLED BY ALIAS** 段(referencedAs ⇐ archivedAs
@timestamp),provenance 记 `aliasOf`,**逐个目验**,永不冒充原路径的真捕获。

## 1.5 ⛔ 铁律:抢救项目里永远不要对原域跑 mirror-site

死域的"死"有两种应答形态:3xx(跳走)与 **200(停车页夺舍)**。redirect:manual 纪律
只挡得住前者;停车页直接 200 应答,mirror-site 会**用停车字节覆写救回的真身,并把账
同步更新——五道门全绿地完成一次污染**（实证:`case-studies/archival-rescue.md` §1.5）。抢救项目的一切补种走
`wayback-mirror --seeds`;活的第三方 CDN(字体/jquery)也**问档案要当年的字节**,
不要问活 CDN 要今天的。verify-mirror 的 interstitial 表现已内置停车签名族,
但它只能事后抓——不犯是纪律,抓到是底网。

## 1.6 验尸三件套:死亡时刻、停车页时代、伪身捕获【firstlaunch】

锚点要选在真身时代,所以先给站验尸。三个 CDX 层面的判据,全部零成本:

1. ⭐ **停车页时代有 CDX 签名**:`.well-known/ai-plugin.json`、`.well-known/security.txt`、
   `ads.txt`、`app-ads.txt` 这类路径突然出现 200 捕获、且 mimetype 全是 `text/html`——
   真身不会拿 HTML 应答 `ads.txt`,停车页对任意路径都答同一张页。这些行冒出的年代
   就是夺舍年代;判死亡时刻、选锚点前先把它们剔出统计。
2. ⭐ **根页 digest 变迁史就是站的年表**:按 digest 分段,每段一个内容
   时代;深爬时刻(全站资产同日被爬)是最连贯的锚点候选。
3. ⛔ **同 digest 交叉鉴伪**:一个路径的孤本捕获若与**停车页时代的根页**同 digest,
   它是夺舍后的伪身,不采（实证:`case-studies/archival-rescue.md` §1.6）。

## 1.7 锚点偏置:一次罩住别的时代的孤本【firstlaunch】

有些文件只在**另一个内容时代**被捕获过(改版时摘掉的 awwwards.css、只挂过一个月的
节日子页)。逐 URL 取"窗内离锚点最近",所以**把锚点压向窗口一侧**能一次罩住（实证:`case-studies/archival-rescue.md` §1.7）。代价是跨时代混入,按偏差登记(provenance 逐文件时间戳
本来就记着)。**不必为孤本二次抓取或扩窗重跑。**

## 1.8 第三方 CDN 的两跳种子:字体【firstlaunch】

Google Fonts 是两跳:CSS(`fonts.googleapis.com/css?family=…`)→ 字体文件
(`fonts.gstatic.com/...ttf`)。都问档案要当年的字节(§1.5):先 `--seeds` 种 CSS,读
救回的 CSS 提取字体 URL,再 `--seeds` 种字体文件。⚠ CSS 捕获的 digest 逐次都不同是
**正常的**——Google 按 UA 出不同格式,档案存的是当年爬虫 UA 拿到的那份;任选窗内一份即当年字节,不要因 digest 不稳去找"更对的一份"（实证:`case-studies/archival-rescue.md` §1.8）。

## 1.9 ⛔⛔ 抢救深度要在锚点之前预判：运行时拼接的资产是档案的射杀区【mustachelab】

**IA 的爬虫不执行 JS。** 凡 URL 由代码在运行时拼出——加载器清单（CreateJS `LoadQueue(PATH)`）、
资源清单文件（`RESOURCE.dir + file`）、模板字面量——档案**从未请求过它们**。这不是洞多洞少
的问题，是**一整层内容成建制地不存在**（实证：`case-studies/archival-rescue.md` §1.9）。

**因此 §0 的三个决定之前，先做第四个判断——分层覆盖侦察**（Step 0 的一部分，成本三次查询）：

1. 读根页捕获的 HTML/JS 引用形态：资产是静态标签引用（`<img src>`/`<link>`/`<audio src>`，
   爬虫看得见），还是清单/拼接驱动（爬虫瞎）；
2. 对代码暗示的资产子树做 **CDX 前缀查询**（`matchType=prefix&collapse=urlkey` 一次问完
   整个 `/assets/` 子树）——`collapse=urlkey` 清单是全量 urlkey 目录，零行 = 任何年代都没
   被捕获过，权威；
3. 分层报告：代码层覆盖 x%、媒体层 y%——**"CDX 无覆盖才是真不可做"按层读，不按站读**。
   媒体层为零的站，抢救终点在锚点选定之前就该改判（L1 + 引擎文档），不要跑到 M0.5 撞白屏。

**镜像期的配套动作——洞账要人工补全集**：wayback-mirror 内建洞扫描走 extract-refs（静态
提取），对运行时拼接**整类失明**（实证：`case-studies/archival-rescue.md` §1.9）。做法是写一个**站点侧推导器**
（几十行，逐条带源码行号）把清单机械展开成 URL 全集 → 与 CDX/镜像对账 → 未捕获的整批
append 进 `wayback-holes.txt`——它同时就是"资产若回归"的 seeds 清单。这是 `reconcile-gaps`
的"字节推导全集"在死站上的同构物。

**外部档案没有备胎可自动化**：archive.today 有 CAPTCHA（agent 不代过验证码，⛔ 硬规则），
Memento TimeTravel 聚合器长期时好时坏——两者只能作为**登记给人工的线索**，不进管线。
真正可能补齐画面的往往是**权利人本人**——把"联系作者"写进
DEPLOY.md 的选项表，这是唯一现实的复活路径。

## 2. 礼貌是功能

web.archive.org 对高频访问限流(429/503)。默认 2 worker + 350ms 间隔 + 指数退避;
**抢救不是竞速**——档案馆是公共资源,一次被封整跑作废。CDX 枚举也要间隔。

## 3. 死站特有的门语义

- **抽样回源(--resample)无意义**:没有源可回。真实性(AUTHENTICITY)检查**照跑且更重要**
  ——archive 存的是当年爬虫看见的任何东西,**被存档的挑战页/拦截页是真实存在的危险**
  (魔数对声明类型、拦截正文模式,全部照常)。
- **provenance 取代"源站说的"**:`mirror/wayback-provenance.json`(锚点、窗口、逐文件
  捕获时间戳 + CDX digest)是死站复刻的坐标系;逆向笔记引用它,不引用不存在的源站。
- **救不回来的,登记**:从未捕获的运行时 API 响应、档案外的第三方 CDN(off-host census
  会点名,逐主机决策——死站的 CDN 可能也死了,也可能活着还能直抓)、POST 端点。
  与活站同一条纪律:不抓只能有技术性理由,一律登记。

## 4. 版权:站亡,权利不亡

站点下线**不改变**其内容的版权状态——作者/公司的权利在站死后继续存在。
抢救产物照旧:私有 + noindex + 不部署,逐资产取证,决定呈交用户
(`legal-and-deploy.md` 全套适用)。存档价值(防止创作永远消失)与再分发权是两件事。

## 4.5 CLEAN 门的死站语义:失败 ⊂ 洞账【firstlaunch】

抢救范围内的路由,断网门语义与活站完全一致(零 404/零错误/零外联)。但**引用着永久洞
的路由**(孤儿子页、洞在 CSS 里的页面)注定有 404——门的判据不是"零失败",而是
**"失败清单 ⊆ wayback-holes.txt,一条账外失败都没有"**。逐条比对（实证:`case-studies/archival-rescue.md` §4.5）,把比对结果写进里程碑日志。⚠ probe/sweep 目前没有
`--allow-404 <holes>` 通道,这一步是人工比对——比对时警惕"差不多都对上了":一条
账外失败就是一个真缺陷。

⭐ 另一面:**源站生产环境自己的 404 不是洞**。CDX 里 statuscode 就是 404 的引用
(死 CSS 引用不存在的图),是源站行为,照抄——镜像伺服它 404 正是保真【firstlaunch】（实证:`case-studies/archival-rescue.md` §4.5）。

## 5. 流程(与活站的差异点)

```
Step 0   判 X 类(域名易主/回收/路径移除/原地替换)→ CDX 覆盖侦察(有几条?哪些年代?)
M0       wayback-mirror(anchor auto → 人工确认年代合理)→ verify-mirror --allow-missing mirror/wayback-holes.txt
M0.5     serve + sweep-routes 照常(断网门语义不变:回放伺服的是本地字节)
M1+      逆向/外壳/对拍自比/源码化,全部标准 —— 参照系是镜像自身与 provenance
交付     DEPLOY.md 增加「存档抢救」一节:锚点、窗口、洞的账、别名回填清单
```
