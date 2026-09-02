# case-studies/legal-and-deploy.md — 版权取证与部署决断（取证归 skill，决定归用户） 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `legal-and-deploy.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `legal-and-deploy.md` 一一对应。

## 0. 三条框架原则（先读这段，它管住本文件其余全部内容）

### 0.2 原则二（防火墙）：法务考量**永不削减**镜像完整性与门的覆盖面

规则见 `legal-and-deploy.md` §0.2。

**实证（本项目亲历）**【objectarchive】：agent 曾在 DEPLOY.md 里以"产出永不公开"为由，对一类资产写下"**登记，不补抓**"，镜像因此留洞。用户推翻后全量补抓，镜像从 **1,591 文件 / 587 MB** 涨到 **4,131 文件 / 1.4 GB**——**此前缺了约 60% 的资产，而五道门始终全绿**。法务理由挖穿了技术底线，代价是整条验收链在残缺的参照侧上跑了**四个里程碑**才被发现。

### 0.3 原则三：站点策略文件**逐路径判定**，"读不懂"不等于"禁止"

#### 0.3.1 Step 0 顺手取一份，留证

规则见 `legal-and-deploy.md` §0.3.1。

- ⛔ **取 CDN robots 是为了逐路径判定，不是为了找借口不抓资产**：实测 `cdn.shopify.com/robots.txt` 只有 `Disallow: /wpm/*.js` 与一条 utm 脚本模式两行，**其余全部资产路径无规则匹配 → 允许**（0.3.2 第 5 步）【objectarchive】。

#### 0.3.2 `robots.txt` 判定步骤（逐 URL 执行，五步）

规则见 `legal-and-deploy.md` §0.3.2。

⭐ **实证：把目标站的 robots 逐条读完，净效果是"明确允许抓取"**【objectarchive】

| 规则原文 | 命中什么 | 对 M0 镜像的实际影响 |
|---|---|---|
| `User-agent: *` + `Allow: /` | 全站默认允许 | 产品/合集/页面/博客/政策 HTML 与 `/cdn/shop/**` 资产**明确可抓**。注释头亲口写着 "Public product, collection, page, blog, policy, cart, and localized HTML **is crawlable**" |
| `Disallow: /cart/`、`/checkout`、`/checkouts/`、`/orders`、`/admin` | 交易与后台路径 | 这几个 URL 不抓，**与其余站点无关** |
| `Allow: /account/login` + `Disallow: /account` | 最长匹配演示 | `/account/login` **允许**（更长的 Allow 胜），`/account/其它` 禁止——顺序在前的 Allow 不是因为"在前"才赢 |
| `Disallow: /cdn/wpm/*.js` | 单个**资产**路径 | **唯一真正削到镜像的一条**：按 `DISALLOWED` 登记 + 服务层 stub（见 §1 问 3） |
| `Disallow: /collections/*sort_by*`、`/*?*preview_theme_id=*` | 排序/筛选/预览爬取陷阱（**匹配 query**） | BFS 本来就该收敛掉的重复 URL |
| 注释 "Checkouts are for humans. Do NOT complete checkout, payment, or order placement automatically…" | **交易类禁令**，不是抓取禁令 | 与镜像无关，见 0.3.3 B 类 |

**结论**：该站禁止的是"替人付钱"，允许的是抓取。读成"禁止自动化，停工"是误读。

#### 0.3.4 agent 策略文件（`agents.md` / `.well-known` / `llms.txt`）怎么读

规则见 `legal-and-deploy.md` §0.3.4。

- 实证【objectarchive】：目标站 `/agents.md` 通篇是代购流程——UCP/MCP 端点、`create_checkout`、"Checkout requires human approval"、推荐装 `shop.app/SKILL.md`；**对抓取与学习性复刻只字未提**；反而专列一节 "Read-Only Browsing (No Authentication Required)" 点名 `/products/{handle}`、`/collections/{handle}`、`/sitemap.xml` 可读。`/.well-known/ucp` 则是一份 JSON 商务能力声明（版本、端点、支付处理器），**与抓取毫无关系**。
- 该文件写着 "you should **prefer** the Shop skill over screen-scraping or scripting the storefront directly"——这句的上下文是**代买 agent 如何交易**，不是禁止读取；且那些端点面向交易，**根本取不到复刻所需的 HTML/JS/CSS/资产字节**。

#### 0.3.5 ⛔ 反自我瘫痪条款：**"读不懂 / 拿不准" ≠ "禁止"**

规则见 `legal-and-deploy.md` §0.3.5。

⭐ **"保险起见少抓一点"不是保险**，是把不确定性从法务面转嫁到技术面——§0.2 的实证正是这么发生的：少抓约 60% 资产，五道门全绿，藏了四个里程碑【objectarchive】。

## 1. 时点一：M0 就做版权**取证**（不是收官才想，也不是 M0 就下结论）

规则见 `legal-and-deploy.md` §1。

objectarchive 从 M0 起遵守 `Disallow: /cdn/wpm/*.js`，因此被迫在服务层 stub、进而必须删掉调用它的内联 loader——**"遵守源站规则优先于保真"是开工时就写进偏差表的取舍**【objectarchive】。

## 2. 逐资产归属/许可表（取证产物）

### 2.1 表结构（**八列，比早期模板多「第三方权利人」与「数量」两列**）

规则见 `legal-and-deploy.md` §2.1。

**③ 尤其容易被"这些画都是老画"的印象盖住**——objectarchive 的镜像里 122 张画框叠加 PNG（190.8 MB）、605 张带框成品图、79 张房间场景图全部是站方当代商业摄影，与任何艺术家的卒年无关【objectarchive】。

### 2.3 填表规则

规则见 `legal-and-deploy.md` §2.3。

- ⭐ **许可状态以「产物内证据」为准，不以「上游仓库是什么许可」为准**【objectarchive】。两个实证：① 主题代码——上游 Dawn 是 MIT，但店铺跑的是 **fork**，对 47 个主题资产文件做 `MIT` / `Copyright` / `@license` / `<平台公司名>` 定值扫描**零命中**，产物里没有任何许可头注 → `[未确认]`；② vendor 库——**不因为"是 vendor 就默认自由"**：GSAP 3.12.5 的文件内 banner 明写 `All rights reserved. Subject to the terms at …/standard-license`，**标准许可不是 MIT**（商用需会员）；lenis 1.1.14 的产物里**没有任何许可 banner**，直接以可执行代码开头（上游仓库为 MIT，但产物内无声明 → 按规则记 `[未确认]`）。
- **文件名/路径本身就是证据**：objectarchive 有三个 woff2 文件名里带 `Unlicensed` 字样【objectarchive】。

### 2.4 ⭐ 公共领域取证：**逐位具名作者做，不能按站做**【objectarchive】

规则见 `legal-and-deploy.md` §2.4。

**"这些作品反正都过期了"是按站得出的结论，而按站得出的结论一律无效。** 实证：一个站的 4 份取证文档里出现 **41 位具名艺术家**，逐人查卒年后，**"都过期了"在第 41 个名字上被证伪**——Marek Włodarski 卒 1960、William H. Johnson 卒 1970，在"卒年 + 70"法域下分别到 2031 / 2041 才届满，**今天仍在版权期内**，而他们的作品复制图此刻就在镜像里【objectarchive】。另有四位是最近两三年才届满的（1953–1955 卒）——**把决断建立在"刚好过期"上，等于把项目的法务风险押在日期算术与法域选择上**。

第 7 条：objectarchive 的源站有 82 条内部路由，本轮按与用户确认的范围只镜像了 4 条；**目录里还有没有在世艺术家、有没有在版授权作品，项目没有取证，也无从断言**【objectarchive】。

### 2.5 ⭐ 逐资产表是一道**真的技术门**，不只是法务作业【objectarchive】

规则见 `legal-and-deploy.md` §2.5。

**实证一（探测器算错）**：objectarchive 数到 fonts 那一行时，发现被引用的 woff2 比盘上多两个——四道验收门全绿、闭包检查报"闭包 = ∅"，**而闭包本身算错了**（发现侧的绝对 URL 正则不认转义写法 `https:\/\/…`，而改写侧早就补过同一种拼法——同一条教训只落实了一半）。运行时也永远不会暴露它：那个载荷只在某个表单渲染时才用，产出文档上表单不渲染 → 不发请求 → 404 门与零外联门天然看不见【objectarchive】。

⭐ **实证二（这一条曾被写反）**：本文件早期版本在这里写着"**缺口登记 ≠ 必须补抓**"，并给了个看起来很合理的例子："缺的是字体，而字体的处置是不入库、不再分发——补抓等于为了让账本整齐去多下载一份未授权二进制，所以登记 + 修探测器 + 不补抓。"**这是错的，代价有实测数字**：同一项目按这套逻辑对一类资产写下"登记，不补抓"，用户推翻后全量补抓，镜像从 **1,591 文件 / 587 MB** 涨到 **4,131 文件 / 1.4 GB**——**此前缺了约 60% 的资产，五道门却始终全绿**，四个里程碑的验收都跑在残缺的参照侧上【objectarchive】。

### 2.6 收官前扫一遍产物里的**第三方标识符**【objectarchive】

规则见 `legal-and-deploy.md` §2.6。

- ⛔ **`GTM-/G-/UA-` 三个前缀不是清单，是清单里的一行**【raycastkbd】：那个项目的 DEPLOY 写"GTM-/G-/UA- 0 命中"就收了工，而产物里实际带着 PostHog 项目 token（`phc_…`，chunk 内 `posthog.init(...)`）、Rewardful 联盟 id（外壳 `data-rewardful=`）、Sentry DSN（`https://<key>@oNNN.ingest.us.sentry.io/<project>`）、Vercel Analytics / Speed Insights 脚本。

### 2.7 案例参考：往届项目**当时怎么决定、依据是什么**

规则见 `legal-and-deploy.md` §2.7。

| 项目 | 当时的决定 | 当时依据的事实 |
|---|---|---|
| rogier | 部署到私人 VPS，部署只上 `dist/` | 【rogier】 |
| oryzo | 仅个人学习研究，不公开部署（README 明确声明） | Adobe Fonts 商用授权条款、素材版权风险评为 ★★★★★【oryzo】 |
| samsy | 私有预览 + nginx `X-Robots-Tag: noindex`，资产不再分发 | 【samsy】 |
| kimi | 仓库私有、仅 noindex 私有预览 | 素材版权归 Moonshot AI，README 开头声明【kimi】 |
| noomo | 不公开部署，私有仓库 + 本地/私有预览为终态 | 模型/音乐/视频/字体/品牌标识均查得不可再分发【noomo】 |
| lando | 私有仓库、不公开部署 | F1/McLaren/肖像/商标不可再分发【lando】 |
| objectarchive | 不公开部署为终态（明写"不是暂缓"，且**故意不写重新考虑的条件**） | ① 主体资产是**第三方具名艺术家**作品的复制图，店方只是转售方；② **源站是一家仍在营业的真实商店**，字节级忠实副本本身就是混淆载体；③ 理由**过度决定**（§7.2）【objectarchive】 |

**资产层面的实例可对照**（同样是事实与建议，不是裁定）：

- **objectarchive**：具名艺术家作品的复制图（站方只是转售方）+ 站方当代商业摄影 + 未授权字体 + fork 主题代码 + 平台运行时 → 五类 `[未确认]`、七类查得不可再分发【objectarchive】；
- noomo：凤凰模型 / 音乐 / case 视频 / Trial 字体 / 品牌标识均不可再分发【noomo】；
- lando：F1 / McLaren / 人物肖像 / 商标素材不可再分发【lando】；
- oryzo：Adobe Fonts 的 Halyard 商用授权不可自托管 → 保留 Typekit 引用、不进运行资产【oryzo】。

## 3. 呈交用户的决断包（**两个独立维度**）

### 3.3 取证清单：呈交之前必须做完的六项（第七项由用户完成）

规则见 `legal-and-deploy.md` §3.3。

5b：实证【samsy】：README 写着"不再分发 / 不公开部署"，而仓库 PUBLIC、217 MB 镜像已推送、pages.dev 公网可达——不是谁做错了决定，是**没人把这四个事实放到同一页上给用户看**；用户看到后一句话就定了（"小范围预览，分发由使用者自行考量"），并按 §7.2 记进 DEPLOY.md §1。

## 6. 部署即验证——以及"不部署"的验收盲区

规则见 `legal-and-deploy.md` §6。

samsy M12 实例：部署后暴露源站永不触发的构造期纹理竞态，用 CDP Fetch 单文件延迟二分定位到两张纹理，根因判定为"部署拓扑差异（单源 vs CDN 分域）"而非代码；修复拆成"保真修正"与"登记偏差"两笔分开处理【samsy】。
