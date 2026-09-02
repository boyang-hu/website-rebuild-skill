# case-studies/binary-formats.md — 私有二进制格式逆向指南 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `binary-formats.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `binary-formats.md` 一一对应。

## 0. 首要原则

规则见 `binary-formats.md` §0。

- **资产原件从镜像直接搬运**——绝不"找相似替代资源"（lando 的字体/GLB/HDRI/KTX2/.riv 全部来自镜像原件，没有任何替代环节）【lando】。
- 版本从 bundle 取证：lando 的 Rive 版本从 bundle 内 wasm URL 取证，钉 @rive-app/canvas-lite@2.26.4【lando】；
- 源站 vendored 的库若有 npm 同款，先证明"同库同算法"再替换并登记偏差（samsy 的 layout-bmfont-text、word-wrapper 等 9 项）【samsy】；
- oryzo 的 three-msdf-text-utils 即源站 vendored 的同一库【oryzo】。
- **解码逻辑就在 bundle 里 → 1:1 移植解码器**，而非黑盒猜格式（oryzo 的 BufLoader 是从 bundle 直译的）【oryzo】。

## 1. 分诊：三个判断

规则见 `binary-formats.md` §1。

- 问 1：oryzo 的 `.sog` 被识别为 **PlayCanvas SOG 标准格式**（无压缩 ZIP + webp 平面 + codebook）——可借开源实现比对验证，不必从零逆向【oryzo】。
- 问 2：lando 的 `.riv` 就是数据文件，"直接播放即可；**难点在 DOM 集成层**"——预载缓存、resize 注册表、状态机接线，做法是把 bundle 里的全局变量表逐字 dump 后照抄，页面过渡链路（taxi 生命周期 → Rive 遮罩 → 1000ms 揭开）按 boot 时序图移植【lando】。
- 问 2：**需解析的格式**：消费端逻辑要自己重建时才需要理解布局（oryzo 的 `.buf` 由自研引擎解码消费，必须移植解码器）【oryzo】。
- 问 3：Web Worker 里 → 把 worker 也 beautify 进 `_pretty/`（samsy 的 baker worker 展开 33,458 行），**逆向 worker 协议**写进逆向笔记，再移植烘焙管线（samsy M6 的 VRM/VAT worker 烘焙管线）【samsy】。

## 2. 完整逆向流程（以 oryzo `.buf` 为范本）【oryzo】

规则见 `binary-formats.md` §2。

**步骤 1**——oryzo 逆向结论：
- 布局：`[uint32 头长][JSON 头][顺序属性载荷]`；
- 量化解包公式：`value = (raw + half) * q * delta + from`；
- 同格式的非显然用法也要挖出来：相机轨迹同样是 `.buf`（Points 类型，每 vertex = 一帧的 position/orient/focal），运镜按帧插值（lerp + slerp + focal→fov）【oryzo】。

**步骤 2**——`BufLoader.ts` 是源站解码逻辑的直译；死参数（`mipFilter`）、错误赋值（`format="R8"`）照抄不修——"修正它们反而会偏离源站的实际渲染结果"【oryzo】。

**步骤 3**——每个格式解析器配一个可视化调试路由（oryzo：`/debug/buf`，模型下拉 + OrbitControls + 贴图验证 + 相机轨迹可视化）——"比在主站里调试快得多"【oryzo】。

**步骤 4**——验收标准必须是可数的：oryzo 的门是 **25/25 模型全部解析成功**【oryzo】。

## 3. 标准格式的非标准用法：GLB 时间线【noomo】

规则见 `binary-formats.md` §3。

- 标准容器（GLB）被当作私有数据载体时（noomo：三条 Blender 烘焙的动画时间线 GLB，相机 + 约 40 条参数曲线），处置方式不是"重实现"，而是**先 dump 成数值账本**：
- **手写最小解析器 dump 曲线成 JSON**：`scripts/dump-timelines.mjs`（手写 GLB 二进制解析器）把全部动画曲线 dump 成 JSON 数值基准入库 `docs/timeline-baseline/`（2.4MB：dev.glb 38 条参数轨道×481 帧、cam.glb 相机 601 帧 + 7 个 project 空物体 TRS）。脚本注释点明动机："careers-kimi lesson: **compare recorded values, not screenshots**"【noomo】。
- **账本兼任排障 oracle**：F3 残差排查用 dev.json 采样值逐项核对 8 个现场弹簧值，**证明参数绑定链无 bug 后**才定性为弱视觉差登记【noomo】。

## 4. worker 协议与烘焙管线【samsy】

规则见 `binary-formats.md` §4。

- 数据不在磁盘文件里，而在 **worker 协议**中——把 baker worker 与主 bundle 一样用钉死版本的 js-beautify 展开进 `_pretty/`（samsy：33,458 行），协议全量写进 engine-notes 再移植【samsy】。
- 验收走引擎状态数值断言（15 NPC / 7 舞者 / instancer / 25 作品）而非目测【samsy】。

## 6. 常见坑

规则见 `binary-formats.md` §6。

1. **worker / WASM 是运行时才 fetch 的，静态镜像必漏**：oryzo 的 `.sog` WASM 排序 worker、samsy 的 baker.worker 都是事后用真实浏览器实跑抓 network 补录的。
2. **数据类资产用脚本抽取，不手抄**：
   - samsy：works.json（25 条）、cityLayout.json（35 处摆放，L65917-66615 逐字反解）、animations.json（1.64MB）、mixamoRig.json、preloaderFrames.json【samsy】；
   - kimi：i18n 用括号配平 + 隔离 vm 求值抽取，键集交叉校验（80=80），生成物不手改——"连源站的拼写错误都免费保真"【kimi】。
3. **bundle 内联 base64 资产容易漏**：noomo 的 colorsMap 光谱 LUT 藏在 bundle base64 里，缺了玻璃整体变灰白；提取到 `_extracted/`，复刻侧再内嵌时要做字节级一致性验证【noomo】。
5. **移动端变体有独立命名规则**：oryzo 的 `getMobileUrl(url)` 在扩展名前插 `_MOBILE`（纹理上限 800px vs 桌面 2560px）——镜像时按规则补全变体，否则移动分支 404（oryzo 曾一次补录 16 个移动端文件）【oryzo】。
6. **动态拼接的资产 URL 正则抓不到**：`` `/models/crystal${e}.glb` `` 类模板字面量要人工静态求解后逐个补抓（noomo 把 `${e}` 解为 0–6）；lando 的 GL 资产基址 `vQ`、Rive 基址 `mj` 都是变量拼接，靠人工从 bundle 求解【noomo】【lando】。
7. **自写二进制工具必须对参照实现验证**：
   - kimi 的零依赖 PNG 编解码器对 Pillow 逐格验证过才可信；
   - 起因是 M7.3 事故——Chrome 截图是 colorType 2 三通道而临时诊断代码硬编码 `*4` 索引，画出一整轮几何假象；
   - 诊断工具与验收门要用不同的正确性标准，一份解码代码同时服务两者时，坏账会藏在全绿里【kimi】。
9. **模型的内在变换不要"归一化"**：rogier 的 `me.gltf` 按源站原样使用，不做旋转翻转/包围盒归一化——模型自带 31.17 的内在 scale 是行为的一部分【rogier】。
