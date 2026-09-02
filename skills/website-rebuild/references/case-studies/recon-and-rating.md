# case-studies/recon-and-rating.md — 开工侦察与难度评级 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `recon-and-rating.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `recon-and-rating.md` 一一对应。

## 0. 侦察的产出物

规则见 `recon-and-rating.md` §0。

- **视觉验收基线** = 线上站——bundle 字面值与线上实况冲突时以实况为准（rogier 判例：bundle 写 `depthBuffer:false` 但线上人头背面遮挡正常 → 开深度缓冲并登记为有意偏差）；

## 1. 架构证否：依赖表会撒谎

规则见 `recon-and-rating.md` §1。

**判例（本条纪律的来源）**：careers.kimi.com 的依赖表里有 three.js + @react-three/fiber，按直觉会判"WebGL 站"并把主力投进 3D 管线。逆向坐实的事实是：视觉主体是 DOM + 18 个 CSS 自定义属性 + `clip-path` 擦除 + 三个 2D canvas 软件像素渲染器；`<Canvas>` 只有两个且都懒加载，唯一真 3D 是正交相机 + 32 个 plane、零着色器。README 把"误判架构"列为头号风险【kimi】。

取证动作与结构性事实的实证（对应 §1 操作程序第 2、5 步）：

- "有 GPU compute"假设：samsy 早期指纹误判"有 GPU compute"，M1 证伪——`dispatchWorkgroups` 字符串**全部来自 three 内部**，应用层从未调用【samsy】。命中字符串必须回溯归属：落在 vendor 区段还是应用区段（先画 bundle 区段地图再下结论，见 `references/reverse-engineering.md`）。
- "能力已挂载"假设：KTX2/meshopt 能力在 GLTFLoader 里但**从未挂载**；作品数是 25 条不是 26（derivative.mp4 是城市装饰屏）【samsy】。库里"有"不等于站点"用"。
- "无全局时间轴"这类结构性问题也在此阶段定案：oryzo 逆向确认滚动编排没有全局时间轴，一切进度由 DOM 几何位置推出——这直接决定动画逆向路径【oryzo】。
- 结构性事实**从产物读出，不凭框架惯例猜**：kimi 的 Next 段树形状从 RSC flight payload 读出（根 layout 挂在 `"(lang)"` 边界而非默认位置）——惯例猜测在此类站上会猜错【kimi】。

两条已判实例（证否记录格式的填法）：

| 假设 | 来源 | 取证动作 | 证据（带 pretty 行号） | 结论 |
|---|---|---|---|---|
| "这是 WebGL 站" | 依赖表含 three/r3f | 数 Canvas 挂载条件、shader 数、视觉主体驱动层 | `<Canvas>` ×2 皆懒加载、零着色器 | **证否**：DOM+CSS 变量站【kimi】 |
| "有 GPU compute" | grep 命中 dispatchWorkgroups | 命中回溯 bundle 区段归属 | 全部落在 three vendor 区段 | **证否**：应用层零调用【samsy】 |

## 2. signature grep：只能提假设，不能当结论

规则见 `recon-and-rating.md` §2。

1. **每条命中回上下文确认**。实测误命中：`leva` 命中的是 React SVG 属性列表里的 `…decelerate|descent…`；`swr` 同为子串误命中【kimi】。
2. **误命中的反向也存在**：`zustand` 确实在用，只是被 r3f 内联——grep 命不中不代表不存在（API 指纹反而可坐实：`getInitialState` 无 `destroy` ⇒ zustand v5）【kimi】。
4. **命中归属靠 bundle 区段地图**：判断"命中在 vendor 还是应用区段"的前提是先画区段地图——lando 对全 47k 行 pretty bundle 逐段标行号（GSAP 5043-6743、three 10334-30143、Lenis 46469-47010 为 vendor；home 44665-45000、taxi 装配 46377-46467 为应用代码），"先画地图再挖矿"【lando】【samsy】。区段地图的完整做法见 `references/reverse-engineering.md`；侦察阶段至少要把 vendor 边界粗标出来，否则 §1 的归属判断无从谈起。

四类版本证据各自的原始出处：

技术栈版本的坐实标准（六项目一致【6/6】）：版本字符串（`versions:{get nuxt(){return"4.2.1"}`【noomo】、`window.next={version:"16.1.6"}`【kimi】）、pnpm 路径泄漏（一次钉死 next/react/babel/sass 四个版本【kimi】）、wasm URL（Rive 版本取证【lando】）、API 指纹。传递依赖必要时用 overrides 钉死（unhead 2.0.17 vs 2.1.17 会反转脚本顺序——"同一框架版本不等于同一输出"）【noomo】。

## 3. 分项难度评级与横向对标【lando】

规则见 `recon-and-rating.md` §3。

打星纪律的实证：

- 每一星级写一句"为什么"，引用镜像/bundle 证据，不凭平台名/框架名印象（webflow.com 被预判不适用，实测有手写 GSAP/three.js bundle 判 A【probe】）。
- **素材版权单独评估且经常是最高星**：oryzo 与 kimi 都评 ★★★★★，"最大风险是法务不是技术"【oryzo】【kimi】；lando 同样"素材版权 ★★★★★ 远大于技术"，因此**开工就按安全默认执行"私有仓库 + 不公开部署"**并写进 DEPLOY.md【lando】。

注意工期从 6.5 周收敛到 1 天靠的是方法论成熟，不是站变简单——首次执行按保守端估。

横向对标锚点（六项目谱系，用于工期预估）：

| 前作 | 原站类型 | 规模/工期 |
|---|---|---|
| rogierdeboeve | Three.js 多场景 WebGL 作品集 | 699 commits / 约 6.5 周【rogier】 |
| oryzo | Lusion WebGL2 滚动叙事单页（46,000px） | 47 commits / 约 3 天【oryzo】 |
| samsyninja | Vue3 + WebGPU/TSL 3D 小城（78,409 行 bundle） | 41 commits / 2 天【samsy】 |
| careers-kimi | Next.js 16 像素风 DOM 站（非 WebGL） | 33 commits / 2 天【kimi】 |
| storytellingnoomo | Nuxt 4 SSR + GLB 烘焙滚动叙事 | 30 commits / 2 天【noomo】 |
| landonorris | Webflow 外壳 + 1.3MB 自定义 bundle | 15 commits / 1 天【lando】 |

攻坚顺序：星多的分项先**竖切一条端到端链路**验证可行性（oryzo 先打通 hero 场景完整链路再铺开【oryzo】）。

## 4. 三判据复核（与第 0 步衔接）

规则见 `recon-and-rating.md` §4。

若第 0 步在框架标记（`__NUXT__`/`data-v-` 等）命中下judged A，侦察阶段用 bundle 实物复核三判据（定义见 `references/scope-and-fingerprint.md` §4）：签名动画确实以客户端命令式代码存在（noomo：GSAP 在 entry.js 与独立 chunk，40 处命中）【probe】。复核不过 → 回到第 0 步重新判级，而不是硬做。

## 6. 常见坑

规则见 `recon-and-rating.md` §6。

- **"目测近似先跑通"的技术债**：oryzo 曾用目测近似实现先跑通，随后必须整体替换为溯源版（M2.3 三轮 commit 重做）——侦察阶段把事实来源定清楚，能避免这次返工【oryzo】。
- **凭平台名/框架名预判难度**：webflow.com 被预判不适用，实测判 A【probe】；Nuxt 站也可以完全适用（noomo 三判据）【probe】。评级只认取证。
- 实证：某项目以"产出永不公开"为由少抓一类资产，**缺了约 60% 而五道门全绿**（`mirroring.md` §5.1）【objectarchive】。
