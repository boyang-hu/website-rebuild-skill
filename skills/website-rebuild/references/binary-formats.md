# 私有二进制格式逆向指南

> **何时加载本文件**：镜像或逆向阶段发现原站使用非标准/私有二进制资产（`.buf`、`.sog`、VAT 烘焙数据、`.riv`、MSDF bmfont、被非常规使用的 GLB 等），需要决定"搬运、解析还是重实现"时加载。

## 0. 首要原则

**"数据文件直接搬运 + 播放器行为对齐"优先于"重实现格式"。** 处置顺序（从省力到费力，逐级降级）：

1. **资产原件从镜像直接搬运**——绝不"找相似替代资源"【lando】。（实证：`case-studies/binary-formats.md` §0）
2. **播放器用同版本现成库**：
   - 版本从 bundle 取证（版本字符串、wasm URL）【lando】；
   - 源站 vendored 的库若有 npm 同款，先证明"同库同算法"再替换并登记偏差【samsy】【oryzo】。
3. **解码逻辑就在 bundle 里 → 1:1 移植解码器**，而非黑盒猜格式【oryzo】。
4. 只有以上都不可行，才走"推导布局与量化公式"的完整逆向（§2）。

## 1. 分诊：三个判断

处置路线一图流：

```
未知二进制文件
├── 有现成播放器消费（.riv 等）
│     → 原件搬运 + 同版本播放器 + 攻坚集成层【lando】
├── 有开源参照（.sog = PlayCanvas SOG）
│     → 解析器对照开源实现写，开源实现当验证 oracle【oryzo】
├── 解码逻辑在 bundle / worker 里（.buf、VAT）
│     → 解码器 1:1 移植【oryzo】；worker 协议逆向【samsy】
└── 标准容器被当私有数据载体（GLB 时间线）
      → 数据 dump 成 JSON 数值账本 + 数据文件直接播放【noomo】
```

拿到未知二进制文件，先回答三问再动手：

**问 1：格式是否有开源参照？**
grep 文件魔数/结构特征，对照开源生态。判据：能找到开源参照 → 解析器对照开源实现写，验证用开源实现当 oracle。【oryzo】（实证：`case-studies/binary-formats.md` §1）

**问 2：它是"数据文件"还是"需要理解的格式"？**
- **数据文件**（有现成播放器消费）：直接搬运 + 播放即可。**难点在 DOM 集成层**——预载缓存、resize 注册表、状态机接线，做法是把 bundle 里的全局变量表逐字 dump 后照抄【lando】。（实证：`case-studies/binary-formats.md` §1）
- **需解析的格式**：消费端逻辑要自己重建时才需要理解布局【oryzo】。

**问 3：消费者代码在哪？**
- 主 bundle 里 → 从 `_pretty/` 行号定位解码函数，1:1 移植【oryzo】。
- Web Worker 里 → 把 worker 也 beautify 进 `_pretty/`，**逆向 worker 协议**写进逆向笔记，再移植烘焙管线【samsy】。注意 worker 文件本身是运行时才 fetch 的，静态镜像抓不到，需实跑补录【oryzo】【samsy】。（实证：`case-studies/binary-formats.md` §1）

分诊 checklist：
- [ ] 三问均有书面答案，写进逆向笔记（只陈述事实，未坐实标"未确认"）
- [ ] 该格式的 worker/解码器/WASM 已确认在镜像里（否则先补录）【oryzo】【samsy】
- [ ] 播放器/解码库版本已从 bundle 取证（版本字符串、wasm URL）【lando】【samsy】
- [ ] vendored 库若用 npm 替代，已证明"同库同算法"并登记偏差【samsy】

## 2. 完整逆向流程（以 oryzo `.buf` 为范本）【oryzo】

当必须解析格式时，按以下四步走：

**步骤 1：从消费端代码推导布局与量化公式。**
不做黑盒 hexdump 猜测——bundle 里的解码逻辑就是格式规格书。同格式的非显然用法也要挖出来【oryzo】。（实证：`case-studies/binary-formats.md` §2）
逆向结论先写进 `docs/engine-notes.md`（含"对复刻的直接结论"），再写解析器代码【oryzo】。

**步骤 2：解析器 1:1 移植，不重新设计。**
死参数（`mipFilter`）、错误赋值（`format="R8"`）照抄不修——"修正它们反而会偏离源站的实际渲染结果"【oryzo】。（实证：`case-studies/binary-formats.md` §2）

**步骤 3：配专用调试页。**
每个格式解析器配一个可视化调试路由——"比在主站里调试快得多"【oryzo】。（实证：`case-studies/binary-formats.md` §2）

**步骤 4：量化验收。**
验收标准必须是可数的（全量资产 N/N 解析成功）【oryzo】。"看起来能渲染"不是验收。（实证：`case-studies/binary-formats.md` §2）

Checklist：
- [ ] 布局/公式结论带 pretty 行号写进逆向笔记
- [ ] 解析器头注释标源行号区间；怪写法照抄并登记
- [ ] 专用调试路由可跑
- [ ] 全量资产 N/N 解析成功的量化门

## 3. 标准格式的非标准用法：GLB 时间线【noomo】

标准容器（GLB）被当作私有数据载体时，处置方式不是"重实现"，而是**先 dump 成数值账本**（实证：`case-studies/binary-formats.md` §3）：

1. **手写最小解析器 dump 曲线成 JSON**：把全部动画曲线 dump 成 JSON 数值基准入库。脚本注释点明动机："careers-kimi lesson: **compare recorded values, not screenshots**"【noomo】。
2. **数值账本先于任何引擎代码产出**（数据基准先行，在 M1 逆向阶段完成）【noomo】。
3. **验收用数值全等而非截图**：复刻引擎的验收是"相机位置在 t=0/5/10/19 与基准插值**小数点后三位全等**"【noomo】。
4. **账本兼任排障 oracle**：**证明参数绑定链无 bug 后**才定性为弱视觉差登记【noomo】。
5. 运行时消费仍然直接播放原 GLB 文件（重资产挂载镜像，不复制入库）——账本只是验证基准，不替代数据文件本身【noomo】。

这个模式可泛化：**一切被数据文件驱动的动画，先把数据 dump 成 JSON 数值账本，再谈移植与验收**【noomo】。

## 4. worker 协议与烘焙管线【samsy】

VAT（Vertex Animation Texture）类"运行时烘焙"格式的要点：
- 数据不在磁盘文件里，而在 **worker 协议**中——把 baker worker 与主 bundle 一样用钉死版本的 js-beautify 展开进 `_pretty/`，协议全量写进 engine-notes 再移植【samsy】。
- 关联硬编码常量照抄：MSDF bmfont 字体（JSON+PNG 4 套）直接镜像，布局算法用 npm 同库替代并登记，`msdfunit = 6/图集尺寸` 等硬编码照抄【samsy】。
- 验收走引擎状态数值断言而非目测【samsy】。（实证：`case-studies/binary-formats.md` §4）

## 5. 各格式速查表

| 格式 | 项目 | 定性 | 做法 | 验收 |
|---|---|---|---|---|
| `.buf`（Lusion 自研） | 【oryzo】 | 需解析的私有格式 | 从 bundle 推布局+量化公式，解码器 1:1 移植，配 `/debug/buf` 调试页 | 25/25 全解析成功 |
| `.sog`（Gaussian Splats） | 【oryzo】 | 有开源参照（PlayCanvas SOG） | 借开源实现比对验证；WASM 排序 worker 运行时 fetch，需补录 | 与开源实现比对 |
| VAT 烘焙（worker 协议） | 【samsy】 | worker 内私有协议 | worker beautify 进 `_pretty/`，协议逆向进 engine-notes，移植烘焙管线 | 引擎状态数值断言 |
| GLB 时间线 | 【noomo】 | 标准容器非标准用法 | 手写解析器 dump 曲线成 JSON 数值账本，数据文件直接播放 | 采样值小数点后三位全等 |
| `.riv`（Rive） | 【lando】 | 数据文件 + 现成播放器 | 直接播放（同版本 canvas-lite，版本从 wasm URL 取证）；攻坚集成层：全局变量表逐字 dump 照抄 | 探针 CLEAN + 真机对拍 |

## 6. 常见坑

1. **worker / WASM 是运行时才 fetch 的，静态镜像必漏**：发现私有格式时立即检查其 worker/解码器是否已在镜像里【oryzo】【samsy】。（实证：`case-studies/binary-formats.md` §6）
2. **数据类资产用脚本抽取，不手抄**：bundle 内嵌的数据一律脚本反解成 JSON 入库。生成物不手改——"连源站的拼写错误都免费保真"【samsy】【kimi】。（实证：`case-studies/binary-formats.md` §6）
3. **bundle 内联 base64 资产容易漏**：提取到 `_extracted/`，复刻侧再内嵌时要做字节级一致性验证【noomo】。（实证：`case-studies/binary-formats.md` §6）
4. **格式里的死参数/错误赋值照抄**：`mipFilter`、`format="R8"` 修掉才是偏离【oryzo】。
5. **移动端变体有独立命名规则**：oryzo 的 `getMobileUrl(url)` 在扩展名前插 `_MOBILE`——镜像时按规则补全变体，否则移动分支 404【oryzo】。（实证：`case-studies/binary-formats.md` §6）
6. **动态拼接的资产 URL 正则抓不到**：`` `/models/crystal${e}.glb` `` 类模板字面量要人工静态求解后逐个补抓；变量拼接的资产基址同样靠人工从 bundle 求解【noomo】【lando】。（实证：`case-studies/binary-formats.md` §6）
7. **自写二进制工具必须对参照实现验证**：诊断工具与验收门要用不同的正确性标准，一份解码代码同时服务两者时，坏账会藏在全绿里【kimi】。（实证：`case-studies/binary-formats.md` §6）
8. **别在主站里调试格式解析器**：没有专用调试页时，格式 bug 与场景 bug 混在一起无法归因——先建调试路由再接主站【oryzo】。
9. **模型的内在变换不要"归一化"**：按源站原样使用，不做旋转翻转/包围盒归一化——模型自带的内在 scale 是行为的一部分【rogier】。（实证：`case-studies/binary-formats.md` §6）
