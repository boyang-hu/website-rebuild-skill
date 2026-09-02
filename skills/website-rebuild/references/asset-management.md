# 资产管理：镜像即唯一资产库，不复制策略

> **何时加载本文件**：M0 镜像完成、开始搭建复刻工程骨架时——需要决定"运行工程如何消费镜像资产"；以及遇到授权字体、百 MB 级媒体的处置决策时。

⛔ **适用阶段：本文全部内容只作用于 ② `port/` 阶段（工作区）。** 到 ③ `src/` 阶段，不复制策略**反转**——自包含是那一阶段的定义性要求，资产必须完整复制进 `src/assets/`，否则"复制到任何地方都能跑"不成立。⚠ 反转的是**盘上复不复制**，不是**入不入 git**：git 里默认仍排除源站字节、只留账本，是否分发仍是用户的决定。见 [readable-source.md](readable-source.md) §2。

## 0. 核心原则

1. **镜像神圣不可污染**：`mirror/` 磁盘文件永不修改，一切本地化适配在服务层/中间件动态完成【samsy】【noomo】【lando】。
2. **镜像是唯一资产库**：manifest（sha256）是权威清单；复刻工程尽量不产生资产的第二份拷贝，让"这些不是我写的"在文件系统层面成立【kimi】【lando】。
3. **不做"找相似替代资源"**：字体、GLB、HDRI、视频全部用镜像原件，没有任何替代资源环节【lando】。

## 0.5 账本先行：manifest 是资产层的宪法

不复制策略成立的前提是账本可信，镜像阶段就要备好：

- 权威清单逐文件登记：`mirror-manifest.json`（url → path/bytes/type）【lando】、`manifest.tsv` 逐文件记 OK/FAIL/大小留证【samsy】、`inventory.tsv`（sha256）作为资产比对的唯一来源【kimi】；
- 多外部 host 的镜像按 `mirror/assets/<host>/<path>` 组织，URL 空间与磁盘一一对应【lando】；
- 后续一切"资产在不在、对不对"的判断只对账本，不对目测。

## 1. 选型：先量体量，再看构建器

决定因素只有两个：

- **资产体量**：百 MB 级资产**必须走不复制路线**；十几 MB 也建议不复制（实证：`case-studies/asset-management.md` §1）。
- **构建器能力**：dev server 能不能挂中间件（vite 可以）、框架有没有静态资产挂载点（nitro `publicAssets`）、`public/` 是否接受符号链接（Next 可以）。

## 2. 六种做法（六个项目各一种，按代际排列）

| 做法 | 项目 | 要点 |
|---|---|---|
| ① 全量复制 + 哈希验证 | 【rogier】 | `public/` 与源站逐字节一致，且真的验证过；约 111MB 媒体直接进 git，部署只上 `dist/`。**一代做法，后代全部演进为不复制**（实证：`case-studies/asset-management.md` §2） |
| ② 三目录分离 | 【oryzo】 | `mirror/`（只读逆向依据）→ `public/`（运行资产）→ `dist/`（部署产物）三层分离，镜像永远不动。仍有复制，但确立了"镜像 ≠ 运行资产"的边界 |
| ③ dev 中间件回落 | 【samsy】 | vite dev 中间件 `mirrorFallback()` 把根路径资产请求（/textures、/videos 等 11 个目录）回落到 `mirror/`，238MB 二进制不进 `public/` |
| ④ 符号链接 | 【kimi】 | `public/` 用符号链接指向 `mirror/`——"让『这些不是我写的』这件事在文件系统层面就成立"，资产比对只有一个 sha256 来源（inventory.tsv），登记为偏差 §6.4 |
| ⑤ nitro publicAssets 挂载 | 【noomo】 | 轻资产（images/audio/字体）复制进 `public/` 与 `app/assets/` 走 Vite 构建；重资产（models/textures/timelines/videos/libs）不复制入库，用 nitro `publicAssets` 把 `mirror/` 对应目录直接挂载到 URL 空间；构建时 nitro 自动拷入 `.output/public`，产物自包含 |
| ⑥ `/ext/<host>/` 映射 + rsync -L | 【lando】 | 资产按 `mirror/assets/<host>/<path>` 组织；dev 用 vite 插件 `extAssets()` 把 `/ext/<host>/` 映射回镜像；build 后 `postbuild.mjs` 建 `dist/ext → mirror/assets` 符号链接，部署时 `rsync -L` 解引用（登记为偏差 6.4）。适合资产分散在多个外部 CDN 域的站 |

**选型指令**：
- 资产分散在多个外部 host（CDN 跨域引用限制、第三方域）→ 走 ⑥（`/ext/<host>/` 统一收编，服务层把外部 URL 改写为该前缀，"same trick as samsyninja-rebuild"【lando】）。
- 同源资产 + 框架有静态挂载点 → 走 ⑤（noomo/nitro）或 ④（符号链接，最简单，Next/静态站首选）。
- vite 工程且资产按源站根路径组织 → 走 ③（中间件回落）。
- ① 只在资产总量小且需要"public 即镜像副本"的哈希审计语义时考虑，且必须配全量哈希验证【rogier】。
- 无论选哪种，凡与"源站直接伺服资产"不同的机制（符号链接、挂载、映射）**登记进偏差表**【kimi】【lando】。

## 3. 配套机制：CDN 跨域引用与服务层改写

不复制策略的前提是"镜像可被本地伺服"，跨域与外链问题一律在**服务层响应时**解决，磁盘镜像保持纯净：

- **抓取期补齐 Referer**：源站资产域要求同源 Referer、缺失时返回 403，抓取按其要求带 `Referer: {源站域}`【lando】。
- **运行期 CDN 基址改写**：samsy 的源 bundle 把音频路径无条件改写为 BunnyCDN 前缀且该 CDN 要求同源引用——`serve.mjs` 在响应层把 CDN 基址动态替换为 `/cdn/` 并按扩展名映射回本地目录【samsy】；复刻侧还可利用源站自带的 `?cdn=false` 查询参数分流到本地媒体【samsy】。
- **改写的副作用要登记**：lando 服务层改写文本响应后字节无法匹配原 SRI 哈希，因此剥离 integrity 属性并登记为偏差 6.10【lando】。
- **一代反例**：后代演进为"干脆不改磁盘"【rogier】。若被迫改磁盘，必须把每处重写登记在案并在对比时扣除（实证：`case-studies/asset-management.md` §3）。

## 4. 分层细则：轻资产可入库，重资产必不复制

noomo 的双通道是范本【noomo】：模板直接引用的轻资产（图片/音频/字体）进 `public/`、`app/assets/` 走构建管线；重资产（模型/纹理/时间线/视频/解码库）一律留在镜像、挂载消费。

第三方在线依赖也可本地化进运行资产（rogier 把 detect-gpu 的 unpkg benchmarks 本地化到 `public/vendor/detect-gpu/`）【rogier】，但改写 bundle 指向它的每一处都要登记（见 §3 一代反例；实证：`case-studies/asset-management.md` §4）。

数据类资产（作品列表、布局、i18n）如何反解入库不属于本文件范畴——那是"用脚本从 bundle 抽成 JSON"的移植问题【samsy】【kimi】。

## 4.5 移动端变体：规则要逆向，不要猜

移动端资产往往是同名变体，命名规则藏在 bundle 里，必须逆向出来再补抓（实证：`case-studies/asset-management.md` §4.5）。

## 5. 资产保真细则（复用镜像时逐条执行）

- **逐字节一致才算复用**：把复用的二进制与源站原件逐字节验证【rogier】（实证：`case-studies/asset-management.md` §5）。
- **模型原样使用，不做归一化**：不做旋转翻转/包围盒归一化——模型自带内在 scale，是行为的一部分【rogier】。
- **"坏资产"也要复刻**：源站 `favicon.svg` 是 404，rogier 删除本地占位文件但保留 head 里的 link——复刻"这个链接在源站就是坏的"【rogier】。
- **MSDF bitmap 字体直接镜像**：bmfont JSON+PNG 原件照用，`msdfunit = 6/图集尺寸` 等硬编码照抄；布局算法用同库同算法的 npm 包替代 vendored 版时登记偏差【samsy】。
- **第三方 WASM 也从镜像出**：Rive WASM 从本地镜像 `/ext/unpkg.com/...` 提供，使复刻离线自包含（登记为偏差 6.6）【lando】。
- **bundle 内联资产单独提取**：base64 内嵌的纹理/LUT 提取到 `mirror/_extracted/`；复刻侧反向内嵌时做字节级一致性验证【noomo】。

## 6. 字体决策

### 6.1 授权网页字体：默认保留原引用、不进运行资产——**这一决定归用户**

⚠ **先分清两件事**：**字体抓不抓进镜像**是技术问题（答案永远是抓，镜像完整性是技术不变量）；**能不能把这份二进制自托管到我们自己的 origin、能不能再分发**是法务问题，**归用户决定**。agent 的活是取证（许可条款原文、文件内 banner、文件名信号如 `*Unlicensed*.woff2`）+ 给建议 + 在用户决定前执行安全默认，**不是自己下结论**（`references/legal-and-deploy.md` §0.1/§0.2）。

**安全默认（用户决定之前照此执行）**：Adobe Fonts（Typekit）类商用授权字体不自托管——保留源站的 Typekit CSS 引用、接受离线时的字体回退【oryzo】；**镜像抓到的副本照常存 `mirror/external/typekit/` 供逆向复核**，只是不进运行资产【samsy】。

**取证要点**：源站自己有没有授权**不改变我们的处境**——把同一份二进制自托管到另一个 origin 是一次独立的、我们自己的使用行为；商用网页字体常按域名/流量计价。把这句连同证据一起呈给用户，让他决定，别替他决定。

### 6.2 自托管字体：默认照抄原件，拒绝"顺手优化"

自托管字体拒绝子集化的决策是偏差登记的范本【kimi】（实证：`case-studies/asset-management.md` §6.2）。拒绝子集化的五条理由按杀伤力排序：

1. **字体是首屏渲染门控**：deck 等 `document.fonts.ready` 才渲染，子集化会污染时序基线；
2. canvas `measureText` 折行结果会变；
3. 点阵字体对坐标舍入极敏感；
4. 538 个汉字是移动靶，缺字静默失败；
5. 私有仓库里体积收益为零。

并附"重新考虑的条件"。**指令**：任何"看起来该做的资产优化"（子集化、压缩、转格式）先按这五条的思路论证它是否破坏测量基准；做不做都写成偏差表条目（源站怎么做 / 我们怎么做 / 为什么 / 什么条件下重新考虑）。

## 7. 落地检查清单

- [ ] 镜像磁盘零改写；本地化适配全部在服务层/中间件【samsy】【noomo】【lando】
- [ ] 百 MB 级资产没有第二份拷贝（源码树、git、public 均不含）【samsy】【kimi】【lando】
- [ ] manifest/inventory（sha256）是资产比对的唯一权威来源【kimi】
- [ ] 外部 host 资产有统一消费路径（`/ext/<host>/` 或服务层改写）【lando】【samsy】
- [ ] 授权字体默认不进运行资产、保留原引用；**镜像侧副本完整**，自托管/再分发与否已取证并交用户决定【oryzo】【samsy】
- [ ] 字体/媒体的任何改动（或拒绝改动）已进偏差表【kimi】
- [ ] 部署路径已验证符号链接/挂载在产物中真实解引用（`rsync -L`、`.output/public` 实测）【lando】【noomo】
