# animation-recovery.md — 动画/交互逆向路径选择

> **何时加载本文件**：逆向笔记（engine-notes）完成后、开始移植任何动画、滚动编排、页面过渡、文本动效或输入手感之前加载。本文件决定你用哪条路径复原动画，以及每条路径的验收方式。

## 0. 唯一禁令（先读）

**禁止目测调参**。动画复刻的每个数值必须能回答"它在 bundle/数据文件/录制基准的哪一行"。

- rogier 明写 "Do not tune visuals, motion, audio, or interaction by eye"【rogier】。
- 目测版只允许作为临时 stub 存在，且必须显式标记生命周期（"将被溯源实现取代"）——每个 stub 标注对应源函数和行号区间，逐波替换【lando】。

（实证：`case-studies/animation-recovery.md` §0）

## 1. 核心判据：动画的事实来源在哪

动手前先在 `_pretty/` 和镜像资产里回答一个问题：**驱动这段动画的"事实"存放在哪里？** 答案决定路径：

| 事实来源 | 判定特征（grep/查证方法） | 走哪条路径 | 验收方式 |
|---|---|---|---|
| GSAP/JS 代码内联参数 | bundle 里能 grep 到 `gsap.timeline`、`ScrollTrigger`、`.to(/.fromTo(` 及字面量参数 | 路径 A：参数逐字抄录 | 时间轴逐事件对齐 + 阶段截图/DOM 身份断言 |
| 烘焙数据文件 | 镜像里有 GLB 时间线 / `.buf` 相机轨迹等二进制，bundle 只做插值播放 | 路径 B：dump 数值账本 | 数值全等（如插值小数点后三位） |
| CSS 变量 / 内部 state 推导 | 视觉由 CSS 自定义属性或框架 state 驱动，外部读不到内部值 | 路径 C：录基准 + 拟合/重放 | 拟合残差归零 + 事件重放轨迹一致 |
| 物理/程序化模拟 | 代码里是常量表 + 每帧积分（弹簧、粒子、二阶动力学） | 路径 D：常量表全抄 | 常量逐项对行号 + 数值探针 |

判定注意：

- 一段动画可能混合多种来源，**逐段判定、逐段选路径**，不要全站套一条路。（实证：`case-studies/animation-recovery.md` §1）
- 判定结论写进逆向笔记的"对复刻的直接结论"节，先于任何移植代码【noomo】【samsy】。
- 数据文件型 2D 动画（如 .riv）本体直接播放即可，难点转移到 DOM 集成层（预载缓存、resize 注册表、状态机接线）——把集成层的全局变量表逐字 dump 后照抄【lando】。

## 2. 路径 A：GSAP/JS 代码 → 参数逐字抄录

适用：编排全部写在 bundle 代码里。做法是把参数当数据抄，不是"照着效果重写"。

### 2.1 先在逆向笔记里逐字 dump 参数，再写代码

- 每个组件的 GSAP 参数逐字抄录：贝塞尔控制点公式、ScrollTrigger 的 `start "top top", end "bottom 25%", scrub true, invalidateOnRefresh`、文字揭示配方的 duration/ease 数值，全部带 pretty 行号【lando】。
- 全部页面过渡的秒数/缓动/延迟及行号同样逐条列进笔记【noomo】。
- 笔记同时产出**页面 init/destroy 矩阵**（每个 data-page 的初始化/销毁函数及行号），它直接就是移植任务清单【lando】。

（实证：`case-studies/animation-recovery.md` §2.1）

### 2.2 时间轴逐事件对齐，不是"总时长差不多"

- 事件的**触发者、门控条件、先后序**都是规格；preloader 最短展示时长这类门槛值也要抄【samsy】。
- 页面过渡链路按逆向笔记的 boot 时序图移植【lando】。

（实证：`case-studies/animation-recovery.md` §2.2）

### 2.3 路由过渡要搞清"谁被替换、谁常驻"

- 换页只替换视图容器内的内容，header/nav/声音开关这类常驻组件不许跟着重建。
- 修复后用 **DOM 身份测试**验证：跨 home→about→home→project 导航断言 `.ui-header` 是同一个 JS 对象【rogier】。
- 平台运行时的换页契约也是规格（如换页后必须调 `window.Webflow.destroy()+ready()`）【lando】。

（实证：`case-studies/animation-recovery.md` §2.3）

### 2.4 入场态从初始值开始

- 源站若以 CSS opacity 0 附加新视图再 `fromTo(0→1)`，重建直接置 1 就会闪帧；用阶段截图验证修复【rogier】。
- README 总结："时序即视觉：任何『先显示再动画』的偷懒都会闪"【rogier】。

（实证：`case-studies/animation-recovery.md` §2.4）

### 2.5 文本动效：拆分算法与不可见字符也是规格

- 自研 SplitText/行动画要逐字移植，含 CJK 分词逻辑；不可见字符逐码点核对（U+200B/U+00A0/U+202F）——拆分结果不同，动画单元就不同【samsy】。
- 悬停翻字（LetterFlippers）等交互组件各自对应独立源文件直译【oryzo】。

### 2.6 Checklist（路径 A）

- [ ] 每条 timeline/tween 的 duration、ease、delay、stagger 有行号出处
- [ ] ScrollTrigger 的 start/end/scrub/invalidateOnRefresh 逐字段抄录
- [ ] 事件触发链（谁 dispatch、谁监听、门控条件、最短展示门槛）与源站一致
- [ ] 常驻组件不随路由重建（DOM 身份断言）
- [ ] 动画初始态 = 源站初始态（不许先显示再动画）
- [ ] 文本拆分算法与源站逐码点一致
- [ ] 平台运行时的换页契约（destroy/ready 调用）保留

## 3. 路径 B：烘焙数据文件 → dump 数值账本

适用：动画曲线烘焙在 GLB/`.buf` 等数据文件里，代码只负责按进度采样。原则："compare recorded values, not screenshots"【noomo，脚本注释原话】。

操作步骤：

1. **先把数据文件 dump 成 JSON 数值账本，再写播放器**。本 skill 的 `scripts/dump-timelines.mjs` 即此用途。这份账本是后续一切验收和差异排查的基准。
2. **验收用数值全等，不用截图**。写明精度，如与基准插值小数点后三位全等【noomo】。
3. **差异排查也回到账本**。拿账本采样值逐项核对现场值，证明"参数绑定链无 bug"后才定性为已知差异登记【noomo】。
4. **把滚动→进度链逆向成纯函数**——逆向成纯函数后可以数值验证而不依赖手感【noomo】。
5. **相机轨迹类二进制同理**：先逆向出布局与量化公式，配调试页量化验收再接主站【oryzo】。私有格式细节见 `references/binary-formats.md`。
6. **bundle 内联的数据资产单独提取**。base64 LUT/纹理提取到 `_extracted/`，复刻侧内嵌后做**字节级一致性验证**【noomo】。

（1–6 各条的实证：`case-studies/animation-recovery.md` §3）

### Checklist（路径 B）

- [ ] 数据文件已 dump 成 JSON 数值账本并入库（先于播放器代码）
- [ ] 滚动→进度链已逆向成纯函数并写明映射公式（如"1 段 ≡ 1 秒"）
- [ ] 播放器验收 = 若干采样点与基准插值数值全等（写明精度，如小数点后三位）
- [ ] 内联 base64 数据资产已提取并做字节级一致性验证
- [ ] 后续视觉差异排查优先回账本核对参数链，再谈渲染层

## 4. 路径 C：CSS 变量/内部 state → 录基准 + 拟合/重放验证

适用：观感由 CSS 自定义属性或框架内部 state 驱动，值从外部读不到、代码是压缩推导式。kimi 的判词："CSS 变量曲线形状就是观感本身，**不看截图看数值**"【kimi】。

操作步骤：

1. **纯函数层与 DOM 层分离**。把编排数学抽成无 DOM、无框架的纯函数库（文件头逐函数映射 minified 名与行号），让数学可以脱离浏览器被验证，验证通过后再接组件层【kimi】。
2. **先在源站上录基准**。探针在镜像上录 CSS 变量随驱动量（滚动/deck 位置）变化的时间序列，存成 JSON 基准；录制探针与验证器成对出现（probe-* 录源站基准 / verify-* 验复刻）【kimi】。
3. **拟合验证**（内部 state 读不到时）：验证器对每个观测状态在参数域扫描找残差最小点——"如果移植是对的，每个观测状态都能把残差压到 0；只要有一项系数写错，就会有状态在任何位置都对不上"。
4. **接线后把同一套源站验证原封打回复刻**。纯函数验证通过 → 接进真 DOM → "整套针对源站的验证原封不动打在复刻上"再跑一遍【kimi】。
5. **坑：基准采样面要覆盖全部驱动通道**。录完基准先确认它在整个驱动域上有区分度。

（实证：`case-studies/animation-recovery.md` §4）

## 5. 路径 D：物理/程序化模拟 → 常量表全抄

适用：动画是常量 + 每帧积分，没有"曲线数据"可 dump。事实来源就是常量表本身。

- 物理常量全表照抄，文件头注明 pretty 行号区间——全部带 bundle 行号【samsy】。
- 复杂效果**先在笔记里拆成结构再移植**——"复刻时必须按此结构而非『打灯调像』"【samsy】。
- 确定性随机源（LCG 种子）、弹簧参数、限流等"手感参数"全部从 bundle 抄写【noomo】。
- 粒子/缓动直译不改算法：CPU 粒子的 O(n²) 接触解算、SecondOrderDynamics 鼠标缓动各自对应独立源文件逐字移植——**不许"优化"复杂度**【oryzo】。
- GPU 侧的动画数据管线（VAT 骨骼动画的 worker 烘焙协议）先在笔记里逆向出协议再移植【samsy】。

（前三条的实证：`case-studies/animation-recovery.md` §5）

## 6. 特殊模式：无全局时间轴，进度由 DOM 几何推出【oryzo】

滚动叙事站不一定有全局 timeline。进度可以完全由 DOM 元素几何位置推出，相机运镜另走数据文件按帧插值。（实证：`case-studies/animation-recovery.md` §6）

操作要点：

- 先证实"有没有全局时间轴"再动手，结论写进逆向笔记。
- 若进度源是 DOM 几何，则 DOM 骨架的字节级还原（见 `references/dom-shell-strategies.md`）就是动画正确性的前置条件——验收要含"浏览器 scrollHeight 与源站一致"【oryzo】；scrollHeight 不对，全站进度都错。
- **不要发明源站没有的全局 timeline 来"统一管理"**——"源站没有的不做"。

## 7. 输入/手感状态机

手感 = 状态机 + 魔数，两者都不许手调。

1. **魔数逐字照抄**：滚轮缓动系数、Lenis 配置逐字抄，连"两分支配置相同"的怪癖也照抄【oryzo】【lando】。
2. **状态机参数从 bundle 取证**：闩锁阈值与静默重置窗口、触摸离散滑动阈值、补间时长双段曲线【kimi】。
3. **用录制时间线重放验证，替代手调**：探针在镜像上注入带时间戳的输入序列录基准，验证器把控制器放进虚拟时钟按同一时间线重放，逐帧比轨迹。判据："闩锁、阈值、目标、时长、缓动**任何一环错，轨迹都会以远超容差的幅度发散**"——重放门天然对所有参数敏感【kimi】。
4. **状态机实现要做成环境注入可重放**（时钟、事件源可替换构造参数），否则重放验证无法搭建【kimi】。
5. 过渡过程的连续性也可量化：rogier 在换页过程中每 120ms 采样元素计算色，两站颜色时间轨迹逐点对齐（per-sample RGB delta ≤6）【rogier】。

（1–3 条的魔数与实测残差：`case-studies/animation-recovery.md` §7）

## 8. 常见坑

1. **目测近似沉淀成正版**：近似实现只能当 stub，必须显式标记生命周期并替换为溯源版【oryzo】【lando】。
2. **"先显示再动画"必闪帧**：初始态也是规格，"时序即视觉"【rogier】。
3. **"好心修正"怪写法**【rogier】【lando】："压缩代码里的每个怪写法都可能是行为本身"——照抄并登记怪癖表。
4. **冷启动才暴露的动画 bug**：每轮验收必须冷启动，"不手动切效果——手动切换会掩盖初始化状态 bug"【oryzo】【kimi】。
5. **检查点漏掉滚动两端**——**终检必须包含滚动两端**【noomo】。
6. **基准录制的覆盖盲区**：只录部分变量/部分驱动域会"失明"【kimi】；录完基准先验证覆盖度。
7. **常驻组件被路由重建**：入场动画反复重放是典型症状，用 DOM 身份断言抓【rogier】。
8. **手感验证依赖真实事件语义**：涉及用户激活门控（如 `experienceStarted` 需 isTrusted）时，驱动必须用真实点击而非合成事件【noomo】，详见 `references/determinism.md`。
9. **自创补偿性动画/CSS**：JS 机制没对齐时用自创 CSS 补观感，等 JS 对齐后补丁反转成 bug——"宁可先不像，也不要发明规则"【rogier】。

（3/4/5/6/9 条的实证：`case-studies/animation-recovery.md` §8）

## 9. 产出物

- 逆向笔记中的动画参数 dump（带行号）+ 路径判定结论——先于代码
- 数值账本/录制基准入库：`docs/timeline-baseline/`、`docs/deck-baseline/` 类目录
- 录制探针与验证器成对的脚本（probe-* / verify-*）
- 对应验证结果（拟合残差、重放残差、数值全等断言），验收门选型见 `references/verification-gates.md`
- 手感魔数与怪癖的登记条目（怪癖表 §Q）
