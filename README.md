# website-rebuild-skill

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.13-blue.svg)](CHANGELOG.md)
[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-compatible-brightgreen.svg)](https://agentskills.io/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933.svg)](#快速开始)

**中文** | [English](README.en.md)

给一个网址，让你的 AI agent 把那个网站**逐行复刻**出来，并且能**证明**复刻得对。

它不是"做一个看起来很像的页面"。它把源站的实现当作规格书：先把整站抓成只读证据，再从压缩过的代码里逐行还原逻辑，最后用一整套自动验收门证明"复刻侧和源站在做同一件事"——包括逐像素比对。

遵循 [Agent Skills 开放规范](https://agentskills.io/)，为**任何支持 skills 的智能体**设计。跨运行时不是口号而是实测：验证清单里既有 Claude Code 跑完的目标，也有 **Codex 全程跑完**的目标（Hashgraph VC，166/166 响应字节一致）——同一份 skill 目录，放进哪个 runtime 都能走完整条管线。

## 目录

- [特性](#特性)
- [效果对比：源站 vs 复刻](#效果对比源站-vs-复刻)
- [快速开始](#快速开始)
- [它怎么工作](#它怎么工作)
- [适用范围](#适用范围)
- [这和"扒站"有什么不一样](#这和扒站有什么不一样)
- [已验证过的网站](#已验证过的网站)
- [仓库结构](#仓库结构)
- [关于版权](#关于版权能不能做和该不该公开是两回事)
- [路线图](#路线图)
- [更新记录](#更新记录)
- [贡献](#贡献)
- [许可](#许可)
- [友情链接](#友情链接)

## 特性

- **判级先行**——开工前先探测目标属于哪一类、能不能做；做不了会直接说明原因，不会硬跑产出垃圾
- **取证式镜像**——整站抓成只读快照（逐文件 sha256 账本、引用闭包校验、真实性检查），断网也能跑
- **行号可溯源的逆向**——复刻里的每一行都能指回源站 bundle 的哪一行；bug 与怪写法照抄不修
- **量化验收**——控制台 / 网络 / DOM / 几何 / **逐像素**五层自动比对，差异要么修掉、要么登记，不许糊过去
- **源码化交付**——逐字移植的产物重写成人能读的工程（拆模块、按证据命名、补溯源头注），**复制到任何地方断网可跑**
- **零依赖工具链**——75 个 Node 脚本（51 个工序脚本与验收门 + 14 个共用库 + 10 个源码化/反推重构器），源码化之前整条流水线不装任何 npm 包
- **死站也能救**——Wayback 存档抢救：锚点+时间窗选一个连贯时刻、原始字节落成标准镜像、永久洞如实登记；五次死站抢救实测（四个复活、其一走完 L3；一个画面层确证全失,失败形态入册）
- **连 RSC 站也能重构**——服务端组件源不下发（React Server Components / Next.js App Router），但它的完整输出（flight 流）内联在每页 HTML 里就是规格书：从中重构一个可构建的 Next 工程，用 flight 语义门收口。实测一个 Next 16/Turbopack 博客站 18/18 路由语义一致，一个 144 路由重站 PASS 144/144；盲逆向对公开源码判卷，结构 ≈95%、行为 ≈98%
- **法务决定权归用户**——skill 只取证与呈交，产出默认私有 + noindex + 不部署

## 效果对比：源站 vs 复刻

每张图**左半是源站的只读镜像，右半是复刻侧**，均取自各项目验收时的对拍截图：同视口、同滚动位置、同动画时刻。除注明者外，所示帧均为**逐像素一致**（meanAbsDiff 0.00）。

![Lusion：源站与复刻对比](docs/showcase/lusion.jpg)
**[lusion.co](https://lusion.co/)** —— 1.25 MB 自研 WebGL 引擎 + 156 个 shader。3D 物理堆叠的姿态来自模拟本身，钉死模拟随机态后两侧逐像素一致。

![AirPods Pro：源站与复刻对比](docs/showcase/airpodspro.jpg)
**[apple.com/airpods-pro](https://www.apple.com/airpods-pro/)** —— 565 个 webpack 模块逐字移植，9 个滚动检查点逐像素一致，此为首屏。

![Hubtown：源站与复刻对比](docs/showcase/hubtown.jpg)
**[hubtown.co.in](https://hubtown.co.in/)** —— Theatre.js 驱动的全屏 WebGL 长镜头（Nuxt 3 + three.js）。实时渲染帧，像素差落在同侧噪声带内（meanAbsDiff 0.96）。

![Samsy：源站与复刻对比](docs/showcase/samsy.jpg)
**[samsy.ninja](https://samsy.ninja/)** —— 赛博朋克 WebGPU 实时场景，238 MB 重资产。两侧各自实时渲染同一时刻，胶片颗粒噪声为场景自带。

![ON.energy：源站与复刻对比](docs/showcase/onenergy.jpg)
**[www.on.energy](https://www.on.energy/)** —— Nuxt 3 + WebGL GLB 场景 + Storyblok headless CMS。页顶视频两侧钉到同一帧后，逐像素一致。

![Raycast Keyboard：源站与复刻对比](docs/showcase/raycastkbd.jpg)
**[raycast.com/keyboard](https://www.raycast.com/keyboard)** —— 判级到源码化单次会话跑完。注意键盘上方那条未加载的懒加载占位条：**两侧一模一样**——bug 与怪状态照抄不修，这正是纪律第 4 条。

## 快速开始

### 前提

| 依赖 | 版本 / 说明 |
|---|---|
| Node.js | ≥ 22（内置 fetch / WebSocket 直连 CDP） |
| Chrome / Chromium | 本机安装，无头对比用 |
| `npx` | 个别工序 spawn 钉死版本的外部工具（从不 import） |

### 安装

把 `skills/website-rebuild/` 整个目录放进你的 agent 的 skills 目录。以 Claude Code 为例：

```bash
# 用户级（或项目级 .claude/skills/）
cp -R skills/website-rebuild ~/.claude/skills/website-rebuild
```

其他支持 Agent Skills 规范的 runtime，按其各自的目录约定放置同一份目录即可。

### 使用

给你的 agent 一个网址，说"复刻这个站"或"1:1 rebuild 这个网站"。

**过程中它会来问你**：复刻范围（整站还是指定页面）、**做到哪一级**（L1 镜像存档 / L2 工程化复刻 / L3 源码化——梯子单调，选低不亏，以后随时续跑升级）、外部依赖怎么处置、以及所有涉及"能不能公开"的判断。这些是**你的决定**，agent 不会替你做。

**大概要多久**：工期随版本一路收敛——早期项目按周计，现在中小型站（几十条路由以内）**一次会话内无人值守跑完**判级到源码化全程，重 WebGL / 自研引擎的站约 1–3 天。agent 会在开工前给出难度评级与预估。

## 它怎么工作

你给一个网址，agent 会自己走完这条链路：

| 阶段 | 它做什么 | 你会看到 |
|---|---|---|
| **判级** | 先探测这个站属于哪一类，能不能做 | 判级结论与依据；不能做会直接说明原因，**不会硬跑产出垃圾**；已消失但有存档的站转入 Wayback 抢救 |
| **镜像取证** | 把整站抓成只读快照，断网也能跑起来 | 一份逐文件带校验和的镜像与账本 |
| **逆向** | 把压缩过的代码展开，让复刻里的每一行都能指回源站的哪一行 | 一份逆向笔记，说明这个站是怎么实现的 |
| **移植** | 逐行还原到你自己的工程里，每处改动都标注源码出处 | 可运行的复刻工程 + 逐条登记的差异表 |
| **验收** | 自动比对两侧：控制台、网络、DOM、几何、像素 | 量化报告；差异要么被修掉，要么被登记，**不许糊过去** |
| **收口** | 逐模块清点有无遗漏，并整理版权事实 | 审计记录 + 一份待你裁定的部署评估 |
| **源码化** | 把逐字移植的产物变成人能读的工程：拆模块、给变量命名、补注释、复制资产（无模块容器的产物走**拼接式分解**——切成语义命名的部件，按序拼回逐字节等于原件） | 一个**可以复制到任何地方独立运行**的源码工程，且每次启动前自动做逐文件字节自证 |

**它盯着的是"对不对"，不是"像不像"**。一个自研 WebGL 引擎站的复刻，三条路由做到了**跨侧逐像素一致**（`meanAbsDiff 0.00`），最终产出 389 个源码模块、中位数 18 行；一个 44.9 万行的 Nuxt/Vite 站，拆成 2,043 个语义命名部件、按域折进 scene/camera/wave 等目录后，**逐字节重拼一致**。

⭐ **最后一步是"源码化"，而它必须排在最后。** 重构最怕改完不知道有没有坏；这里在动手之前已经有了一个逐像素精确的裁判，所以每一次拆分、每一次改名都能被证死。**没有裁判的重构是盲改。**

⭐ **skill 的终点也在这里：到"人能读懂的真实"为止。** 拿产出去做你自己的项目（脚手架、fork、二次创作）是**你的工程，不是它的阶段**——它不替你起名字、写故事、换内容，因为那些决定只有你自己能做。但它留了一样别处没有的东西：交付物自带的字节清单与重拼门，让你 fork 之后**精确地知道自己每一步偏离了源站什么**。交接指南见 [`beyond-the-rebuild.md`](skills/website-rebuild/references/beyond-the-rebuild.md)。

### 全程遵守的六条纪律

它们不是风格偏好。这六条是从实践里挨个撞出来的，违反任何一条都会在后面的阶段以 bug 的形式偿还：

1. **镜像只读**，永不修改——它是全项目唯一的证据基准
2. **以源码为唯一裁决**，不凭肉眼调效果
3. **源站有的都要有，源站没有的不发明**——宁可先不像，也不自创补丁
4. **bug、死代码、怪写法照抄不修**——压缩代码里的每个怪写法都可能是行为本身
5. **有意的差异必须登记**，写清"源站怎么做 / 我们怎么做 / 为什么"——**没登记的差异一律算 bug**
6. **代码与文档同一次提交**

⚠ 第 3 条在最后的**源码化**阶段有一条明确边界：在人写的那份源码里重命名、拆模块、补注释**不算"发明"**——那一份是显式登记的衍生物，不是对源站的断言。但两条硬线不动：**不许顺手重构**（合并重复、提取公共函数、改算法都会让"等价"变得无法判定），以及**注释里的推测必须标注成推测**。

## 适用范围

### 已跑通的场景（A / B 类）

| 场景 | 覆盖情况 | 实测规模 |
|---|---|---|
| **命令式 WebGL / Canvas 场景** | three.js、自研引擎、GLSL/TSL 逐字提取 | 1.25 MB 单 bundle + 156 个 shader；另一站 47,224 行 three 引擎 |
| **GSAP 时间轴 / 滚动叙事** | 时间轴、ScrollTrigger、自研输入状态机 | 多个获奖作品集站 |
| **烘焙动画与私有二进制格式** | GLB / `.buf` / `.riv` / KTX2，反解成可校验的数值 | 53 个几何文件、170,289 顶点，格式从代码里逆出 |
| **静态构建器产物** | Astro / Nuxt SSG / Webflow 导出壳 / Vite / webpack | 单页站、SSG 站、导出壳站各若干 |
| **各种代码形态** | 压缩、混淆、未混淆都可以 | 全混淆 47k 行；未混淆 974 行；还有完全没有 bundle、逻辑写在模板内联块里的站 |
| **多语言 / RTL 站** | 双语路由成对对账、`dir=rtl` 布局、PJAX 转场 | 一个 en/ar 122 路由站（首个 RTL 样本） |
| **音频行为站** | 声音作为验收面：音频引擎池普查（全量 loaded、零音频 404、零外联）、运行时拼 URL 的音频族"池子即账本"采集 | 一个 98 音效池的游戏音频工作室站（主题音乐 + 逐控件交互音效，双编码） |
| **B 类：平台层剥离** | Shopify（平台 / 应用 / 上游主题 / 站点自研四层分离） | 两个 Shopify 店铺，其一是主题 fork 的定制店 |
| **B 类：第三方资产桶 / headless CMS** | Storyblok（`/m/` 变换接口）、Strapi 上传桶全量镜像 | 一个 ~1,800 图的 CMS 桶 + 一个 864 MB 的 Strapi 桶 |
| **B 类：序列化数据块展开** | Nuxt 等 SSG 把数据编码进页面的形态 | 一个 63.5 KB 的数据块（占文档 54%），展开为 566 KB 结构化数据并逐项比对 |
| **X 类：失效站存档抢救** | Wayback CDX 枚举 → 锚点+时间窗选连贯捕获 → `id_` 原始字节 → 标准镜像；永久洞如实登记，别名回填单列，停车页验尸挡 200 型夺舍 | 五次抢救、五种形态实测：域名易主（8/15 路由）、平台回收（9/9 全清）、原地停车替换（0 洞 0/0/0）、DNS 消亡+停车夺舍（first-launch，走完 L3 全程）、清单驱动站画面层全失（mustachelab，引擎救回+失败形态入册） |
| **C2 类：声明式组织的现代全栈站** | Next.js App Router（webpack / Turbopack）、Nuxt 3 + Vite、R3F、Theatre.js——RSC flight 与 devalue 载荷、服务端图片端点、会话态预取、编译组件的逐字图内嵌（转写微运行时）都有对应处理 | 七个 C2 目标：115 路由全站（115/115 跨侧一致）、Three r182 WebGPU/TSL 站、Theatre.js WebGL 长镜头站、产品页（4 检查点像素全零）、重 WebGL 工作室站（C1+C2 混合，144 路由）等 |

### 有条件或做不了的场景

| 类 | 类型 | 原因 |
|---|---|---|
| **C1** | 服务端组件站（RSC / Next.js App Router） | 服务端组件源不下发，但它的完整输出（flight 流）内联在每页 HTML 里就是规格书。⭐ **v0.3 起可做：重构式逆向**——重构一个可构建的 Next 工程，flight 语义门收口（实测 rauchg.com 18/18、basement.studio 144/144 路由一致）。没有逐字 port，产物是"人写的源码 + 门证明的等价" |
| **D** | 服务端行为站 | 行为主体在服务端（CMS、电商库存、A/B 分桶、个性化），**客户端没有可移植的目标**，也没有确定性的验收基准 |
| **X（无存档）** | 已消失且 Wayback 无覆盖的站 | 彻底没有可镜像的对象。⭐ **有存档的 X 站可以抢救**（见上表）；历年获奖站实测消失率约 **29%**——这也是"第一时间镜像"成为第一条纪律的原因 |

三类各自的实测样本见下文[已验证过的网站](#已验证过的网站)。

## 这和"扒站"有什么不一样

用 wget、HTTrack、SingleFile 之类的工具把网站抓到本地，也能双击打开、也能离线跑。**如果你只是想留个存档或本地看看，那些工具就够了，不必用这个。**

区别在于：**扒站回答"它长什么样"，复刻回答"它是怎么做到的"。**

| | 扒站 / 镜像 | 工程化复刻 |
|---|---|---|
| **你拿到的 JS** | 压缩混淆后的产物，一行几十万字符 | **模块树**：389 个文件、中位数 18 行，每个文件头标注它来自源站的哪几行 |
| **变量名** | `e`、`t`、`r`——压缩器抹掉的信息回不来 | 有证据可依的**逐个还原**；⛔ **没有证据的宁可不改**——错的名字比 `e` 更有害 |
| **第三方库** | 和业务代码糅在同一个文件里 | **剥离出来**，按源站声明的版本从 npm 装回（版本号是从代码里取证的，不是猜的） |
| **能不能改** | 能改，但你不知道改了什么、也不知道会坏什么 | 能改，而且**一整套自动检查会告诉你坏没坏** |
| **怎么知道对不对** | 打开看一眼，觉得像 | 控制台 / 网络 / DOM / 几何 / **逐像素**五层自动比对，差异要么修掉要么登记 |
| **学得到东西吗** | 学不到——你没有读懂任何一行 | 产出里包含一份**逆向笔记**：这个站的动画怎么编排、场景怎么组织、数据怎么烘焙 |
| **能不能带走** | 能，但它只是那堆文件 | **复制到任何地方、断网安装、直接跑**——资产、构建配置、开发服务器都在里面 |
| **典型产物** | 一堆文件 | 可运行工程 + 逆向笔记 + 差异登记表 + 验收报告 + 版权评估 |

**镜像是这套流程的起点，不是终点。** 第一步照样把整站抓成只读快照——但那份快照在这里的用途是**当裁判**：后面每一次"复刻侧对不对"的判断，都是拿它当标尺量出来的。扒站到此为止，复刻从这里开始。

## 已验证过的网站

### 已完整复刻

方法论的来源与试炼场——[更新记录](CHANGELOG.md)里的每一条，都来自其中某一个项目。

| 站名 | 网址 | 一句话 |
|---|---|---|
| Rogier de Boeve | [rogierdeboeve.com](https://rogierdeboeve.com/) | 摄影师作品集，GLB 模型 + 滚动叙事，方法论的第一个原型 |
| ORYZO | [oryzo.ai](https://oryzo.ai/) | 产品站，自研 WebGL 场景；移动端纹理的命名规则要从代码里逆出来，不能猜 |
| Samsy | [samsy.ninja](https://samsy.ninja/) | 创意开发者作品集，238 MB 重资产，确立了"镜像是唯一资产库、绝不复制第二份" |
| Kimi Careers | [careers.kimi.com](https://careers.kimi.com/) | 招聘站，4.8 MB 中文点阵字体"拒绝优化"的五条理由，成了差异登记的范本 |
| Noomo Storytelling | [storytelling.noomoagency.com](https://storytelling.noomoagency.com/) | Nuxt SSR + GLB 烘焙滚动叙事，确立了服务端渲染产物的逐字节比对 |
| Lando Norris | [landonorris.com](https://landonorris.com/) | 车手官网，资产分散在多个外部 CDN，确立了统一收编外部资源的做法 |
| Racing.shop | [racing.shop](https://racing.shop/) | 第一个实战项目，Shopify 店铺，催生了平台层剥离指南与流媒体补录 |
| Shopify Editions Design | [shopify.design](https://shopify.design/) | 47,224 行命令式 three.js 引擎单页，本系列难度最高的一次逆向 |
| Object & Archive | [objectandarchive.com](https://objectandarchive.com/) | Shopify 主题 fork 定制店，逻辑住在模板内联块里；催生了"无 bundle"分支与整个版权取证流程 |
| AIM Services 50th | [aimservices.co.jp/50th](https://www.aimservices.co.jp/50th/) | 日文企业周年微站，第一次**全程无人介入**的实测目标 |
| ChungiYoo | [chungiyoo.com](https://chungiyoo.com/) | 设计师作品集，Nuxt 2 SSG，页面里的数据块占文档 54%、展开后膨胀 8.9 倍 |
| Apple AirPods Pro | [apple.com/airpods-pro](https://www.apple.com/airpods-pro/) | 判级的基准物种，第一个 webpack 模块容器目标；565 个模块逐字移植，**9 个滚动检查点逐像素一致**，仓库外断网重建仍是 0.00 |
| Optimus（v0 生成） | [v0-optimus-delta.vercel.app](https://v0-optimus-delta.vercel.app/) | Next.js + **Turbopack** 容器，第二种模块打包形态；⭐ 打包器自带导出名，命名从推断变成转写（16/20 tier-1） |
| Lusion | [lusion.co](https://lusion.co/) | 创意工作室官网，1.25 MB 自研 WebGL 引擎 + 156 个 shader；三条路由**逐像素一致**，并走完了**源码化**——389 个模块、可独立复制运行 |
| EIGHT DESIGN | [eightdesign.co.jp](https://eightdesign.co.jp/) | 日本设计公司**115 路由全站**（Next.js App Router + Turbopack），第一个 C2 类目标；278 个模块逐字移植，**115/115 路由跨侧渲染一致** |
| Raycast Keyboard | [raycast.com/keyboard](https://www.raycast.com/keyboard) | Raycast × NuPhy 联名产品页（Turbopack + DRACO 3D 模型），判级到源码化**单次会话跑完**；v0.3.15 按新标尺复审补齐：13 个懒加载 chunk + 42 条 next/image 阶梯（浏览器 Accept 独立记账树）+ 预取载荷里 51 MB 内容图入镜像，61 chunk / 879 模块 token 门 61/61，状态对齐像素门 4+4 自比带宽 ≤0.11、跨侧 5 检查点 ≤0.01 |
| Hubtown | [hubtown.co.in](https://hubtown.co.in/) | Unseen Studio 出品的全屏 WebGL 长镜头站（Nuxt 3 + three.js + **Theatre.js**），授权动画状态随包下发的 C2 范本；landing 像素差落在同侧噪声带内 |
| ON.energy | [www.on.energy](https://www.on.energy/) | 能源公司官网（Nuxt 3 + WebGL GLB 场景 + **Storyblok headless CMS**），首个 CMS 资产桶全量镜像样本（约 1,800 图）；55/55 路由零报错，页顶视频钉帧后像素归零 |
| Milk Network | [milknetwork.com](https://milknetwork.com/) | 沙特品牌代理官网（webpack + GSAP + **Strapi CMS 桶**），首个**双语 RTL** 站（en/ar 122 路由成对）；main 15 模块全量源码化、chunk 形交付，动画完结态像素精确零 |
| Hashgraph VC | [hashgraphvc.com](https://hashgraphvc.com/) | 风投官网（Nuxt 3 + Three r182 **WebGPU/TSL** + Sanity CMS），⭐ **首个由非 Claude runtime（Codex）全程执行**的复刻——166/166 响应字节一致；也是**拼接式分解**的诞生地：44.9 万行切成 2,043 个语义命名部件、逐字节重拼一致 |
| Overworld Audio | [overworldaudio.com](https://overworldaudio.com/) | 游戏音频工作室官网（Nuxt 3 + THREE/Theatre + **Howler**），⭐ **声音第一次成为验收面**——98/98 音效池全量 loaded、零音频 404；"池子即账本"采集法的诞生地 |
| Guillermo Rauch's blog | [rauchg.com](https://rauchg.com/) | ⭐ **首个 C1（RSC）重构式逆向**——从 flight 流重构一个可构建的 Next 工程，**18/18 路由语义门一致**；也是**盲逆向对答案**的诞生地：结构 ≈95%、行为 ≈98%，7 个依赖版本从字节证据精确命中 |
| basement.studio | [basement.studio](https://basement.studio/) | 重 WebGL 设计工作室官网（Next 16.3 + React 19 流式 + three/R3F + Sanity），C1+C2 混合周级战役，**功能面已收口**：flight 语义门 **PASS 144/144**、模块双射 50 对零违背；3D 办公室场景、16.5k 行 ScreenUI 街机引擎、双 offscreen worker、mux/tweet 惰性家族全部经**逐字图 + 转写微运行时**（v0.3.7 第四交付形态的诞生地）跑进重建工程，12 路由清扫 10 CLEAN |
| First Launch 七點半的太空人 | —（已消失） | ⭐ **首个走完 L3 全程的 X 类死站**——2013 Awwwards 站（jQuery + skrollr 滚动叙事），从 Wayback 锚点 2015-01 重建：27 永久洞如实登记，数值门 **9,856 样本全等**，像素 7/9 检查点精确零，自包含交付物断网复活 |

### 边界样本与死站抢救

43 站探测里划出边界的代表——**边界是测出来的，不是声明出来的**；五次死站抢救实测：四个复活（三个止于 L1，first-launch 走完 L3 全程，见上表），一个引擎救回、画面确证全失——**失败形态也入册**。

| 站名 | 网址 | 判级 | 一句话 |
|---|---|---|---|
| Linear | [linear.app](https://linear.app/) | **C1** | 服务端组件源不下发；v0.3 起属可做的重构式逆向（flight 流即规格书） |
| Duolingo | [duolingo.com](https://www.duolingo.com/) | **C1** | 同上——RSC 流不下发源码，但内联的 flight 输出可对拍重构 |
| TechCrunch | [techcrunch.com](https://techcrunch.com/) | **D** | WordPress 内容站，行为主体在服务端 |
| Airbnb | [airbnb.com](https://www.airbnb.com/) | **D** | 个性化注水 + 服务端数据，没有确定性的验收基准 |
| darknetflix.io | — | **X→已抢救** | 域名易主；⭐ 已从 Wayback 救回（锚点 2020-07，8/15 路由复活，92 永久洞如实登记） |
| umamiland | — | **X→已抢救** | 平台回收；⭐ 已从 Wayback 救回（**sweep 9/9 路由全清**，探针→种子迭代收敛） |
| jiouhe.com | — | **X→已抢救** | 原地替换（域名活着，应答停车页）；⭐ 锚 2018 救回，**0 永久洞、0/0/0**，滚轮帧动画完整复活——停车页验尸与拼写孪生归一的诞生地 |
| Merlin's Mustache LAB | —（已消失） | **X→引擎救回，画面确证全失** | ⭐ X 类第二种失败形态的命名样本：**镜像可完整而站不可复活**——代码层 100%（CreateJS 加载器 + Swiffy + 清单驱动电路板引擎全量可读），画面层 157/160 资产任何档案零捕获（IA 不执行 JS）；157 洞逐条带行号推导登记，止于 L1 + 引擎文档 |

## 仓库结构

```
skills/website-rebuild/    # 技能本体，目录结构遵循 agentskills.io 规范
├── SKILL.md               #   主流程 + 判级 + 纪律（激活时整体加载）
├── references/            #   23 份分场景指南（按需加载）
├── assets/templates/      #   文档模板
├── scripts/               #   零依赖 Node 工序脚本与验收门 + lib/ 共用模块
│                          #     判级与源码化之前的全部工序都住这里
└── tools/                 #   源码化阶段的重构器，允许 devDependencies
selftest/                  # 仓库冒烟自检（npm test；不随 skill 分发）
.github/workflows/         # CI：push/PR 自动跑 npm test
CHANGELOG.md               # 更新记录
README.md                  # 本文件
README.en.md               # 英文版 README
```

⭐ **两个目录的分界是阶段，不是角色**：源码化之前整条流水线**零依赖**——复刻项目要到最后一步才装东西。前面的工序需要真正的 parser 时，`spawn` 一个钉死版本的 npx（`js-beautify` / `acorn`），脚本自身仍然零依赖、仍然可被独立审查。这条线由 `scripts/verify-zerodep.mjs` 看着，因为它曾经**只写在文档里、被违反了八个版本没人发现**。

## 关于版权：能不能做，和该不该公开，是两回事

本 skill 面向**学习与研究**用途。产出**默认私有 + noindex + 不部署**——这是一个**保守的默认动作**，不是 agent 替你下的法律结论。

公开之前必须完成逐资产的版权**取证**，而**决定权始终在你**：skill 只负责收集事实、列出选项与各自的风险边界、给出建议，凡涉及"能不能公开 / 部署 / 再分发"，一律显式交回给你。

⛔ 有一条硬规矩写死在 skill 里：**法务考量永远不能削减镜像的完整性**。曾经有一轮以"反正不公开"为由少抓了约 60% 的资产，而所有验收门全程显示通过——从那以后，"不抓"只允许有技术性理由。

## 路线图

- **v0.3 已落地**：C1（RSC）重构式逆向——flight 坐标系（flight-decode）、语义门（verify-flight，模块 id 全局双射）、正文反推器（flight-to-mdx）、运行时缺口对账器（reconcile-gaps）、指南 `rsc-reconstruction.md`；实测 rauchg.com 18/18 路由语义一致，盲逆向对答案判卷。v0.3.2–0.3.7 系列在 basement 等战役中继续演进：语义门重站淬炼（144 路由、双射审计换脊柱）、turbopack 三暗形态入图、X 类首个 L3 全程与"镜像可完整而站不可复活"失败形态入册、Sanity 场景入册、第四交付形态「逐字图 + 转写微运行时」。
- **v0.2 已全部落地**：拼接式分解（v0.2.0）及其目录分组与 chunk 图谱（v0.2.8）、三级终点与交接边界（v0.2.1）、声音验收面（v0.2.2）、渲染广度门（v0.2.3）、存档抢救（v0.2.4–0.2.6）、冒烟自检 CI（v0.2.7）。
- **源码化的两块空白**：命名的还原率取决于代码本身留下多少线索——实测一个扁平站有 63% 的局部变量没有任何可依据的证据，一个模块化站有 27/46 个模块只能保留哈希 id。这不是欠账，**错名比哈希更糟，因为哈希会让人去看**。另一块是模块头目前只写事实与溯源，**"这个模块是干什么的"仍然需要人来写**——工具写不出，而写错比留白更糟。
- **远期**：C1 的更难形态——服务端**逻辑**（不只是渲染结果）的推断深度、隐藏路由空间的枚举、动态图片/OG 生成器的重建；以及 D 类（个性化注水、无确定性验收基准）是否存在可对拍的子集。

## 更新记录

版本随真实复刻项目递进：每个版本发布的功能与修复，都先在至少一个完整项目上验证过。

完整记录见 **[CHANGELOG.md](CHANGELOG.md)**。最新版本 **v0.3.18**：lib 收拢——四份 CDP 客户端、三份 findChrome、五份 UA、四份请求头梯子、23 处 sha256、四写六读的账本 TSV 各收成一份（`lib/cdp` / `lib/hash` / `lib/ledger` / `lib/negotiate` / `lib/chrome`），scripts + tools 净减 219 行；账本与服务回放 before/after 逐字节一致，真 Chrome 冒烟 probe CLEAN / sweep 2/2 / pixelcompare 0.00；损坏的账本不再被当空账本覆盖；selftest 114→140。

## 贡献

欢迎 issue 与 PR。两条与一般项目不同的约定：

- **每条功能与修复都要有实测出处**——本仓的版本历史全部来自真实复刻项目里撞出来的问题，PR 请说明它在哪个目标上被验证过；
- **`scripts/` 保持零依赖**（`node:` 之外不许 import，门不许 import 生产者）——`scripts/verify-zerodep.mjs` 会在评审时执行这条纪律；
- 提交前跑 **`npm test`**（秒级冒烟：语法 / 零依赖 / 共享库实测教训 fixture / 微型镜像端到端）——CI 会在 PR 上自动执行同一套。

## 许可

本项目基于 [MIT License](LICENSE) 发布。

**许可管的是这个 skill 本身，不管你拿它去复刻什么。** 复刻他人网站涉及的版权与合规判断由使用者自行承担——skill 内的授权前提（`SKILL.md`「使用前提与授权」）与本文的[版权一节](#关于版权能不能做和该不该公开是两回事)，才是关于**用途**的约束。

## 友情链接

- [linux.do](https://linux.do/u/80yan9/)
- [v2ex](https://www.v2ex.com/member/Boyang)
- [NodeSeek](https://www.nodeseek.com/space/69434#/)

## Star History

<a href="https://www.star-history.com/?repos=boyang-hu%2Fwebsite-rebuild-skill&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=boyang-hu/website-rebuild-skill&type=date&theme=dark&legend=top-left&sealed_token=w8uJfrl9ZDcglvDnQkhhJ4OX7nQdNyB6LUwItnfs7w95mFca7AHZJk9xezWFgdUmncju8b9kmMylPt6gqS_EQCoBwHN5yAnxoWBVk6-hyIFBxyqJZorLzhIM0rDd0iTIUxI6HVVHm6j4OiNpQZkAM0VVhKQMF5qJWkPO6CrSz66Bp96c_SFX0IHfdcQL" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=boyang-hu/website-rebuild-skill&type=date&legend=top-left&sealed_token=w8uJfrl9ZDcglvDnQkhhJ4OX7nQdNyB6LUwItnfs7w95mFca7AHZJk9xezWFgdUmncju8b9kmMylPt6gqS_EQCoBwHN5yAnxoWBVk6-hyIFBxyqJZorLzhIM0rDd0iTIUxI6HVVHm6j4OiNpQZkAM0VVhKQMF5qJWkPO6CrSz66Bp96c_SFX0IHfdcQL" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=boyang-hu/website-rebuild-skill&type=date&legend=top-left&sealed_token=w8uJfrl9ZDcglvDnQkhhJ4OX7nQdNyB6LUwItnfs7w95mFca7AHZJk9xezWFgdUmncju8b9kmMylPt6gqS_EQCoBwHN5yAnxoWBVk6-hyIFBxyqJZorLzhIM0rDd0iTIUxI6HVVHm6j4OiNpQZkAM0VVhKQMF5qJWkPO6CrSz66Bp96c_SFX0IHfdcQL" />
 </picture>
</a>
