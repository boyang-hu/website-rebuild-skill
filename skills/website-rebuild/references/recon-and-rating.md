# 开工侦察与难度评级

> **何时加载本文件**：第 0 步判级为 A/B 之后、写下任何移植代码之前。侦察与 M0 镜像、M1 逆向并行推进，但 §5 的"开工问题清单"未全部回答前，禁止进入移植阶段（M2+）。本文件的目标只有一个：**在动手前证否错误的架构假设**——"这个误判如果没在动手前发现，会把绝大部分力气花在极小部分画面上"【kimi】。

## 0. 侦察的产出物

侦察阶段结束时必须落盘三样东西（写进 REBUILD_PLAN 阶段计划节 / engine-notes）：

1. **架构结论**（§1 证否后的事实，不是依赖表的说法）+ "不要发明"清单；
2. **分项难度评级表**（§3，含横向对标与工期预估）；
3. **开工问题清单的逐条回答**（§5）。

同时确立三层"事实来源"模型（rogier 制度，整个项目的地基）【rogier】：
- **实现规范** = 镜像里的压缩 bundle + CSS——每个行为、每个数值必须在这里找到归属；
- **视觉验收基线** = 线上站——bundle 字面值与线上实况冲突时以实况为准（判例见 `case-studies/recon-and-rating.md` §0）；
- **本地镜像** = 带已知改写的 oracle——服务层/登记过的改写不得当作产品需求。

## 1. 架构证否：依赖表会撒谎

**依赖表 ≠ 架构真相**。（实证：`case-studies/recon-and-rating.md` §1）

操作程序（对每个新站执行）：

1. **先写下架构假设清单**，来源是依赖表、script 清单、第一印象。典型假设："这是 WebGL 站"、"有 GPU compute"、"动画由全局 GSAP 时间轴驱动"、"加载了 X 库所以用了 X"。
2. **逐条找证否证据，而不是证实证据**。每条假设对应的取证动作：
   - "WebGL 站"假设：在展开后的 bundle（`scripts/beautify-bundle.mjs` 产物 `_pretty/`）里数 canvas/`<Canvas>` 出现位置与挂载条件（懒加载？条件渲染？）；数 shader 字符串数量；确认视觉主体的驱动层（CSS 变量？2D canvas？DOM 动画？）【kimi】。
   - "有 GPU compute"假设：命中字符串必须回溯归属：落在 vendor 区段还是应用区段（先画 bundle 区段地图再下结论，见 `references/reverse-engineering.md`）【samsy】。
   - "能力已挂载"假设：库里"有"不等于站点"用"【samsy】。
   - "无全局时间轴"这类结构性问题也在此阶段定案——这直接决定动画逆向路径【oryzo】。
3. **证否结论写成清单入逆向笔记**："不要发明"清单 / "对复刻的直接结论"【samsy】【noomo】。
4. **未坐实的一律标注"未确认"，不猜**——逆向笔记只陈述源站事实，不做"应该怎么改"的判断【kimi】【noomo】。
5. 结构性事实**从产物读出，不凭框架惯例猜**——惯例猜测在此类站上会猜错【kimi】。

（第 2、5 步四条取证动作的实证：`case-studies/recon-and-rating.md` §1）

证否记录格式（每条假设一行，随逆向笔记落盘）：

| 假设 | 来源 | 取证动作 | 证据（带 pretty 行号） | 结论 |
|---|---|---|---|---|
| （未取证的假设） | … | … | （空） | **未确认**——禁止当结论用 |

（两条已判实例：`case-studies/recon-and-rating.md` §1）

## 2. signature grep：只能提假设，不能当结论

grep 混淆/压缩 bundle 的输出是**假设生成器**，不是证据。规则：

1. **每条命中回上下文确认**。子串误命中真实存在。
2. **误命中的反向也存在**：grep 命不中不代表不存在（被内联即可命不中），API 指纹反而可坐实。
3. **搜值不搜名**：REVISION 等常量名会被混淆重命名。可靠锚点是值与特征串【noomo】【oryzo】：

```bash
# 单行 MB 级 bundle 先注入换行，防有界量词正则卡死【probe】
tr ';{}' '\n' < bundle.js > bundle.lines
grep -n 'const nv="179"' bundle.lines        # three 版本"值"（REVISION 名已被混淆）【noomo】
grep -n '15064825' bundle.lines              # 十进制颜色字面量 = 0xE5DEF9【noomo】
grep -n '#define GLSLIFY 1' bundle.lines     # GLSL 特征串定位 shader 段【oryzo】
grep -n 'WebGLRenderer\|dispatchWorkgroups' bundle.lines   # 命中后必须归属 vendor/应用区段
```

4. **命中归属靠 bundle 区段地图**："先画地图再挖矿"【lando】【samsy】。区段地图的完整做法见 `references/reverse-engineering.md`；侦察阶段至少要把 vendor 边界粗标出来，否则 §1 的归属判断无从谈起。
5. grep 输出统一整理成"假设表"，逐条走 §1 的证否程序后才能写进技术栈取证表。

（1/2/4 三条的实测命中与区段地图实例：`case-studies/recon-and-rating.md` §2）

技术栈版本的坐实标准（六项目一致【6/6】）：版本字符串、pnpm 路径泄漏、wasm URL、API 指纹（四类的原始出处见 `case-studies/recon-and-rating.md` §2）。每个版本号都要有 bundle 内证据，然后 `package.json` 钉死不带 `^`（`--save-exact`）【6/6】；传递依赖必要时用 overrides 钉死——"同一框架版本不等于同一输出"【noomo】。

## 3. 分项难度评级与横向对标【lando】

开工前按分项打星（★~★★★★★）并与前作横向对标（lando 做法，总评 ★★★☆☆），用于**预估工期、确定攻坚顺序、决定加载哪些分场景指南**。

评级维度（lando 用法）：

| 维度 | 评什么 | 对应加载的指南 |
|---|---|---|
| 素材获取 | 资产体量、跨域引用限制、第三方桶、运行时拼接路径比例 | `references/mirroring.md` |
| 3D/WebGL 复杂度 | 场景数、shader 数、渲染栈（WebGL1/2/WebGPU-TSL）、后处理链长度 | `references/webgl-scenes.md` |
| 滚动/动画编排 | 事实来源形态（GSAP 代码/烘焙数据/CSS 变量/物理常量）、编排层数 | `references/animation-recovery.md` |
| 私有格式 | 自研二进制格式有无、是否有开源参照（.sog = PlayCanvas SOG 可借开源比对【oryzo】） | `references/binary-formats.md` |
| 平台层 | Webflow/Shopify 等平台运行时的行为契约复杂度 | `references/dom-shell-strategies.md` |
| **素材版权** | 字体/媒体/人物肖像/商标授权 | `references/legal-and-deploy.md` |

打星纪律：

- 每一星级写一句"为什么"，引用镜像/bundle 证据，不凭平台名/框架名印象。
- **素材版权单独评估且经常是最高星**："最大风险是法务不是技术"，因此**开工就按安全默认执行"私有仓库 + 不公开部署"**并写进 DEPLOY.md【oryzo】【kimi】【lando】。⚠ 这一行写的是**风险量级与待决问题**，不是"已决定不公开"——**法务判断由用户作出**，agent 只取证、列选项、给建议，并在用户决定前执行安全默认（`references/legal-and-deploy.md` §0.1）。**它也不改变镜像范围**：镜像照四遍法抓全，法务考量不得削减完整性（§0.2）。
- （两条打星纪律的实证：`case-studies/recon-and-rating.md` §3）

对标方法：找出与目标站同型的前作（"3D 复杂度接近 samsy、平台层接近 lando"），按分项差值修正工期预估。首次执行按保守端估——工期收敛靠的是方法论成熟，不是站变简单。六项目谱系的规模/工期锚点表见 `case-studies/recon-and-rating.md` §3。

评级表落盘格式（写进 REBUILD_PLAN 难点表；素材版权行永远存在且单独决断）：

| 分项 | 星级 | 为什么（引用证据） | 对标前作 |
|---|---|---|---|
| 素材获取 | ★★★ | 例：外部 CDN 域要求同源 Referer、运行时拼接基址 ×2 | lando |
| 3D/WebGL | ★★ | 例：单场景、shader 全内联可提取 | rogier（多场景）之下 |
| 滚动/动画编排 | ★★★ | 例：GSAP 命令式 + 无全局时间轴 | oryzo 同型 |
| 私有格式 | ★ | 例：无自研二进制 | — |
| 平台层 | ★★★ | 例：Webflow 运行时行为契约 | lando 同型 |
| **素材版权** | ★★★★★ | 例：商用字体 + 人物肖像查得不可再分发 → 待用户决定，其间按安全默认（私有 + 不公开部署） | oryzo/kimi/lando 当时同样落私有 |

攻坚顺序：星多的分项先**竖切一条端到端链路**验证可行性【oryzo】。（实证：`case-studies/recon-and-rating.md` §3）

## 4. 三判据复核（与第 0 步衔接）

若第 0 步在框架标记（`__NUXT__`/`data-v-` 等）命中下judged A，侦察阶段用 bundle 实物复核三判据（定义见 `references/scope-and-fingerprint.md` §4）：签名动画确实以客户端命令式代码存在【probe】。复核不过 → 回到第 0 步重新判级，而不是硬做。（实证：`case-studies/recon-and-rating.md` §4）

## 5. 开工前必须回答的问题清单

逐条回答并落盘。**答不出的条目 = 回逆向取证，不许带着问号进移植**：

1. **架构主体是什么？**（§1 证否后的结论）视觉主体由哪一层驱动：WebGL / DOM+CSS 变量 / 2D canvas / 平台运行时？【kimi】
2. **签名行为的事实来源在哪？** GSAP 命令式代码 → 参数逐字抄录【rogier】【lando】；烘焙数据文件（GLB/.buf）→ dump 成数值账本【noomo】【oryzo】；CSS 变量 → 录基准拟合【kimi】；物理模拟 → 常量表照抄【samsy】。这决定 `references/animation-recovery.md` 里的路径选择。
3. **bundle 形态？** minified 可 beautify / 未混淆可跳过 beautify / 有公开 sourcemap 直取 sourcesContent【probe】。
4. **技术栈版本能否逐项钉死？** 每个版本号的 bundle 内证据是什么？传递依赖是否需要 overrides？【6/6】【noomo】
5. **DOM 层的生成方是谁？** 平台导出物 / 静态单页 / 框架编译产物 → 决定 shell 策略（零重写 / 脚本切组件 / 框架重建+字节对齐），见 `references/dom-shell-strategies.md`。
6. **有无私有二进制格式？** 有无开源参照可借来比对验证？→ `references/binary-formats.md`【oryzo】
7. **验收门型初选？** 有 SSR/静态 HTML 产物先建字节门 → DOM 静态场景走冻结+byte-equal → 活场景（视频/glitch/随机相位）降级为量化网格+噪声归类 → 数据驱动动画补数值门 → CLEAN 门全程兜底，见 `references/verification-gates.md`。
8. **源站可插桩吗？** 滚动驱动 + 源站混淆 bundle 不可插桩 → 必须走 probe-shim 双侧确定性驱动路线（`scripts/probe-shim.js`），见 `references/determinism.md`【noomo】。
9. **版权与部署边界？** 逐资产列归属/许可（**取证，不下结论**），把"是否公开部署"作为**待用户决定项**登记；其间按安全默认（私有 + noindex）【oryzo】【samsy】【kimi】【noomo】【lando】。
10. **镜像盲区预期清单建了吗？** worker fetch / 懒加载 / 移动端变体三类必漏资产的补录通道，见 `references/mirroring.md`【oryzo】【samsy】。

## 6. 常见坑

- **依赖表撒谎**：three.js 在依赖里但不是 WebGL 站——头号架构误判风险，动手前必须证否【kimi】。
- **grep 子串误命中**：`leva`/`swr` 型假阳性；以及 `zustand` 型假阴性（被内联）【kimi】。
- **vendor 字符串冒充应用行为**：`dispatchWorkgroups` 全部来自 three 内部，应用层零调用——命中必须归属到 bundle 区段【samsy】。
- **常量名被混淆**：搜 `REVISION` 搜不到不等于没有 three——搜值不搜名【noomo】。
- **凭框架惯例猜结构**：段树/布局边界要从产物（flight payload、`__NUXT_DATA__`）读出，不猜【kimi】。
- **"目测近似先跑通"的技术债**：侦察阶段把事实来源定清楚，能避免这次返工【oryzo】。
- **凭平台名/框架名预判难度**：评级只认取证【probe】。
- **把版权当收尾问题**：素材版权是最高风险项，取证最耗时（逐位具名作者查证尤甚），拖到收官会让整个收尾卡住，也让"产出怎么被使用"的选项在最后一刻才摆到用户面前【oryzo】【kimi】【lando】。
- **反向的坑：让法务判断跑到技术方案上游**。取证早做是对的，**据此改技术方案是错的**——法务考量作用于**产出怎么被使用**（是否公开/部署/再分发/入 git），**不作用于镜像抓多全、门断言多少格**。
- （后三条坑的实证：`case-studies/recon-and-rating.md` §6）

## 7. 侦察关账条件

- [ ] 假设表逐条有结论（证否/坐实/标注"未确认"），无裸猜
- [ ] 架构主体结论 + "不要发明"清单已入逆向笔记【samsy】【noomo】
- [ ] 技术栈取证表逐项有 bundle 内证据，版本可钉死【6/6】
- [ ] 分项难度评级表落盘，含对标与工期预估、素材版权取证进度与待用户决定项【lando】
- [ ] §5 十个问题全部有落盘回答，对应分场景指南已确定加载清单
- [ ] 三层事实来源模型（实现规范/验收基线/本地镜像）已写进 REBUILD_PLAN【rogier】

全部勾完才允许进入移植（M2+）。
