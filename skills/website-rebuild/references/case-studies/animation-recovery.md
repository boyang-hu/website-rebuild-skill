# case-studies/animation-recovery.md — 动画/交互逆向路径选择 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `animation-recovery.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `animation-recovery.md` 一一对应。

## 0. 唯一禁令（先读）

规则见 `animation-recovery.md` §0。

- oryzo 曾用目测近似实现先跑通，随后被强制替换为溯源版（M2.3 commit 明言"全部逻辑溯源 bundle，替换了此前的近似实现"）【oryzo】。
- 目测版只允许作为临时 stub 存在，且必须显式标记生命周期（"将被溯源实现取代"），如 lando 的 `stubs-notes.md` 骨架清单——每个 stub 标注对应源函数和行号区间，逐波替换【lando】。

## 1. 核心判据：动画的事实来源在哪

规则见 `animation-recovery.md` §1。

- 一段动画可能混合多种来源（noomo：GLB 曲线驱动相机 + GSAP 驱动页面过渡 + 弹簧驱动插值），**逐段判定、逐段选路径**，不要全站套一条路。

## 2. 路径 A：GSAP/JS 代码 → 参数逐字抄录

### 2.1 先在逆向笔记里逐字 dump 参数，再写代码

规则见 `animation-recovery.md` §2.1。

- lando 的 `04-dom-components.md` 把每个组件的 GSAP 参数逐字抄录：heroflip 的两段三次贝塞尔控制点公式（`CP1=(p0.x, p0.y+(p1.y-p0.y)*0.4)`…）、ScrollTrigger 的 `start "top top", end "bottom 25%", scrub true, invalidateOnRefresh`、三大文字揭示配方的 duration/ease 数值，全部带 pretty 行号【lando】。
- noomo 的 engine-notes §10.4 列出全部页面过渡的秒数/缓动/延迟及行号【noomo】。

### 2.2 时间轴逐事件对齐，不是"总时长差不多"

规则见 `animation-recovery.md` §2.2。

- rogier 的 preloader 编排逐事件复刻：镜像 HTML 带 `<body style="opacity: 0;">`（FOUC 防线）照抄，由 preloader `init` 清除；预加载阶段只跑 `animateVersionIn/animateNameIn` + canvas `animateIn`，其余全部等 Enter 点击触发的 `ANIMATE_IN` 事件（重建用自定义事件对应）【rogier】。
- 事件的**触发者、门控条件、先后序**都是规格；preloader 最短展示时长这类门槛值（samsy 的 4000ms）也要抄【samsy】。
- 页面过渡链路按逆向笔记的 boot 时序图移植：lando 的 taxi 生命周期 → Rive 遮罩 → 1000ms 揭开【lando】。

### 2.3 路由过渡要搞清"谁被替换、谁常驻"

规则见 `animation-recovery.md` §2.3。

- rogier 源站换页只替换 `.ui-main` 内视图，header/nav/声音开关是常驻组件；重建曾整块替换导致入场动画重放。
- 平台运行时的换页契约也是规格：lando 必须保留 "webflow 三连（jQuery→schunk→entry）"，因为 taxi 换页后要调 `window.Webflow.destroy()+ready()`【lando】。

### 2.4 入场态从初始值开始

规则见 `animation-recovery.md` §2.4。

- 源站以 CSS opacity 0 附加新视图再 `fromTo(0→1, 0.5s linear)`；重建直接置 1 造成闪帧，用 700ms/1200ms 阶段截图验证修复【rogier】。

## 3. 路径 B：烘焙数据文件 → dump 数值账本

规则见 `animation-recovery.md` §3。

1. noomo 用手写 GLB 解析器（对应本 skill `scripts/dump-timelines.mjs`）把三条时间线 GLB 的全部动画曲线 dump 进 `docs/timeline-baseline/`（2.4MB：dev.glb 38 条参数轨道×481 帧、cam.glb 相机 601 帧 + 7 个 project 空物体 TRS）【noomo】。
2. noomo M4a 的验收是"相机位置在 t=0/5/10/19 与基准插值**小数点后三位全等**"【noomo】。
3. 收官期排查弱视觉差 F3 时，拿 dev.json 采样值逐项核对 8 个现场弹簧值，证明"参数绑定链无 bug"后才定性为已知差异登记【noomo】。
4. **把滚动→进度链逆向成纯函数**。noomo 的滚动链是 scrollTop → 段索引+比例 → [0,20] 直接当秒喂 mixer scrub（"1 段 ≡ 1 秒"硬耦合）——逆向成纯函数后可以数值验证而不依赖手感【noomo】。
5. **相机轨迹类二进制同理**。oryzo 的相机运镜烘焙在 `.buf`（Points，每 vertex = 一帧的 position/orient/focal），播放器按帧插值（lerp + slerp + focal→fov）——先逆向出布局与量化公式（`value = (raw + half) * q * delta + from`），配调试页量化验收（25/25 模型解析成功）再接主站【oryzo】。私有格式细节见 `references/binary-formats.md`。
6. **bundle 内联的数据资产单独提取**。base64 LUT/纹理提取到 `_extracted/`，复刻侧内嵌后做**字节级一致性验证**（noomo 的 colorsMap 1024×2 光谱 LUT，缺了玻璃会变灰白）【noomo】。

## 4. 路径 C：CSS 变量/内部 state → 录基准 + 拟合/重放验证

规则见 `animation-recovery.md` §4。

1. **纯函数层与 DOM 层分离**。把编排数学抽成无 DOM、无框架的纯函数库（kimi 的 `deck.ts`：纯几何 + 18 个 CSS 变量推导，文件头逐函数映射 minified 名与行号），让数学可以脱离浏览器被验证，验证通过后再接组件层【kimi】。
2. **先在源站上录基准**。探针在镜像上录 CSS 变量随驱动量（滚动/deck 位置）变化的时间序列，存成 JSON 基准（kimi 的 `docs/deck-baseline/source-*.json`）；录制探针与验证器成对出现（probe-* 录源站基准 / verify-* 验复刻）【kimi】。
3. kimi 实绩：deck 661/661 通过、最大残差 4.75e-7；clip-path 擦除几何（Sutherland–Hodgman 半平面裁剪）439/439、残差 8.53e-14 px【kimi】。
5. kimi 曾只采 `<main>` 上 18 个变量，在位置 3.2 后"完全失明"（变量饱和，场景 3-7 由容器 opacity 驱动）——把 opacity 采进基准后覆盖立刻到 8.2【kimi】。

## 5. 路径 D：物理/程序化模拟 → 常量表全抄

规则见 `animation-recovery.md` §5。

- 玩家物理常量全表照抄（samsy 的 MOVE/JUMP 对象，文件头注明 pretty 行号区间）、bloom strength 0.34 / radius 0.27×DPR、雾 IDLE 700/800——全部带 bundle 行号【samsy】。
- 复杂效果**先在笔记里拆成结构再移植**：samsy 的零光照氛围 = 黑雾 × 烘焙贴图 × 0.3 × 高度渐变 + bloom 只吃 emissive MRT，"复刻时必须按此结构而非『打灯调像』"【samsy】。
- 确定性随机源（LCG 种子 1111111114）、弹簧参数 (50,15)、限流（1s 内 5 次）等"手感参数"全部从 bundle 抄写【noomo】。

## 6. 特殊模式：无全局时间轴，进度由 DOM 几何推出【oryzo】

规则见 `animation-recovery.md` §6。

oryzo 逆向确认：一切进度由 DOM 元素几何位置推出（`getDomRange` 映射），各 section 把 `showScreenOffset` 映射到场景 `animation` 值；相机运镜另走 `.buf` 按帧插值【oryzo】。

- 若进度源是 DOM 几何，则 DOM 骨架的字节级还原（见 `references/dom-shell-strategies.md`）就是动画正确性的前置条件——oryzo 的验收含"浏览器 scrollHeight 46410px 与源站一致"【oryzo】；scrollHeight 不对，全站进度都错。

## 7. 输入/手感状态机

规则见 `animation-recovery.md` §7。

1. **魔数逐字照抄**：`wheelEaseCoeff=12`【oryzo】；Lenis 配置逐字 `{lerp:0.1, touchMultiplier:1.25, syncTouch:true…}`，连"两分支配置相同"的怪癖（Q7）也照抄【lando】。
2. **状态机参数从 bundle 取证**：kimi 的滚轮闩锁（阈值 6 累积、180ms 静默重置）、触摸离散滑动（阈值 48px、不跟手）、补间时长双段曲线【kimi】。
3. **用录制时间线重放验证，替代手调**：探针在镜像上注入带时间戳的输入序列录基准（kimi 录了 6892 帧），验证器把控制器放进虚拟时钟按同一时间线重放，逐帧比轨迹，p95 残差 0.0019。

## 8. 常见坑

规则见 `animation-recovery.md` §8。

3. **"好心修正"怪写法**：带符号取模被修成正取模后 About 页浮动方块全部消失【rogier】；lando "修好" `scene.remove(Q.name)` 的 no-op 后真删除反而破坏遍历导致转场崩溃，最终回抄（Q13）【lando】。
4. **冷启动才暴露的动画 bug**：oryzo 的 NaN 传染（滚动指示器未初始化字段 → `u_pulseCenter.y = NaN` → 整屏恒定色）只在全新加载下暴露；
5. **检查点漏掉滚动两端**：noomo 探针没测滚动终点 t=20，HomeFooter 揭示动画整段缺失漏网，靠用户直连源站目视才发现——**终检必须包含滚动两端**【noomo】。
6. **基准录制的覆盖盲区**：只录部分变量/部分驱动域会"失明"（kimi 位置 3.2 后饱和）【kimi】；录完基准先验证覆盖度。
9. **自创补偿性动画/CSS**：JS 机制没对齐时用自创 CSS 补观感，等 JS 对齐后补丁反转成 bug（rogier 十余个视觉 bug 的共同根源）——"宁可先不像，也不要发明规则"【rogier】。
