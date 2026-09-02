# WebGL/GLSL 场景逆向指南

> **何时加载本文件**：侦察确认原站含 WebGL/WebGPU 渲染场景（Three.js、自研引擎、TSL 节点材质等），进入引擎逆向（M1）、场景移植或像素对拍验证阶段时加载。

## 1. shader 定位与逐字提取

**原则：shader 一律逐字提取（verbatim），禁止任何"顺手优化"。** 像素级还原的前提是放弃"我能写得更好"的冲动【oryzo】。

### 定位手段（按序尝试）
1. **grep 特征标记**：搜 `#define GLSLIFY 1` 定位 bundle 里全部内联 shader 字符串【oryzo】。
2. **搜值不搜名**：混淆 bundle 里 REVISION 等常量会被重命名——用值锚定：版本字符串、十进制颜色字面量、GLSL 特征串，都比标识符可靠【noomo】。
3. **bundle 内联 base64 资产也要提取**（光谱 LUT、SMAA area/search 纹理这类，缺了会整场变色）。复刻侧若反向内嵌 base64，需做字节级一致性验证【noomo】。

（实证：`case-studies/webgl-scenes.md` §1「定位手段（按序尝试）」）

### 提取纪律
- 集中存放 + 头注释声明来源与 "Do not edit by hand"【oryzo】。
- 连源站变量名照抄【noomo】。
- 死参数/错误赋值照抄——"修正它们反而会偏离源站的实际渲染结果"【oryzo】。
- 每个场景/pass 文件头注明源行号区间，逐 pass 一一列出【lando】。

（实证：`case-studies/webgl-scenes.md` §1「提取纪律」）

### 对拍与证同
- **ShaderChunk 展开对拍**：引擎（如 Three）会把 chunk 拼进最终 shader——从 bundle 提取的源 shader 文本，必须与重建运行时（含 ShaderChunk 展开后）对拍【rogier】。
- **离线 diff 证同后，差异排查聚焦编译参数/数据链**：先用 `node diff` 证明 shader 与源站逐字一致，此后像素差异就不必再怀疑 shader 文本本身。

（实证：`case-studies/webgl-scenes.md` §1「对拍与证同」）

## 2. 渲染管线审计方法

**顺序：先在逆向笔记里画完管线结构，再写任何材质代码。**

1. **列材质/pass 清单**：逆向笔记必须包含材质清单与后处理链逐步拆解【samsy】【oryzo】。
2. **按拓扑逐个 pass 移植，每加一个 pass 验收一轮**【oryzo】；多场景管线按源码结构重建【rogier】。
3. **复杂效果先拆成结构再移植**——"复刻时必须按此结构而非『打灯调像』"【samsy】。
4. **渲染器配置审计（含拒绝清单）**：静态 + 运行时审计渲染器状态，不只记录"要有什么"，还记录"不许有什么"（源构造器没调的调用，复刻侧也不许重新引入）【rogier】。
5. **动画/材质参数逐字取证到行号**——全部从 bundle 行号抄录，不目测调参【samsy】。
6. **逆向阶段做证伪**：指纹会骗人。证伪结论写成"不要发明"清单【samsy】。
7. **TSL/WebGPU 注意项**：
   - 源站用 dev 分支版本（r182dev）时，取最接近的正式版并**登记为偏差**【samsy】；
   - 第三方库魔改的识别用量化手段："数字字面量多重集 + 轴键结构对比"，洗掉正则假阳性后收敛出唯一真实增量【samsy】。
8. **暴露数值探针句柄**：
   - 复刻侧留 `__probe` 门控的引擎句柄，断言层数与层序、uniform 值、RT 尺寸精确值、相机位姿小数点后三位全等【noomo】；
   - 更进一步把源码语义编码成 mode 字符串，探针持同一组常量逐一比对（激活顺序数组逐项断言）——"实现遵循了哪条源码语义"成为可自动回归的断言【rogier】；
   - 具体到对象级数值：聚光灯探针断言贴图归属、位置/目标/强度、投影采样亮度【rogier】。

（1–8 各条的实证：`case-studies/webgl-scenes.md` §2）

管线审计 checklist：
- [ ] 材质清单逐项有落点，数量与源站清单对上【samsy】
- [ ] pass 链拓扑与源站一致，每个 pass 单独验收过一轮【oryzo】
- [ ] 渲染器状态审计通过，含"不许有什么"的拒绝清单【rogier】
- [ ] 数值探针句柄/mode 断言接入回归门，每次改动必跑【rogier】【noomo】

## 3. WebGL 对拍的特殊性

WebGL 场景对拍与 DOM 字节门有本质不同：**GPU 渲染有容差、活场景有随机相位，逐字节比对不可行**。按下面的规则降级门型。

**门型速查表**：

| 门型 | 指标与容差 | 适用 | 出处 |
|---|---|---|---|
| 行亮度剖面 | 按行采样灰度，差 ±4 灰阶为噪声级 | 静态构图整屏 | 【rogier】 |
| 多滚动点平均亮度 | 14 个滚动点、平均亮度差 ±0.5 | 滚动叙事站 | 【oryzo】 |
| 粗网格相似度 | 64×40 网格逐格色差 + 最差格目检归因 | 活场景（视频/glitch/粒子随机相位） | 【samsy】 |
| 同帧检查点对拍 | 6 个滚动检查点、双侧泵到同一 t 截图 | 滚动驱动 + 源站不可插桩 | 【noomo】 |
| readPixels 字节门 | WebGL canvas 直读像素、哈希相等 | 熵源可完全冻结的确定性场景 | 【kimi】 |
| 颜色时间轨迹 | 每 120ms 采样计算色、RGB delta ≤6 | 换页/过渡等时间过程 | 【rogier】 |

### 量化指标替代逐像素
- 静态构图：行亮度剖面（整屏按行采样灰度，x 取 20%–80% 区间，验收 ±4 灰阶噪声级）+ 逐 band delta 用数字关账【rogier】。
- 滚动叙事站：多滚动点对拍（同视口、按 section 对齐的滚动点，PIL 上下拼接逐组核对，平均亮度差 ±0.5 为验收）【oryzo】。
- **活场景（视频帧相位 / glitch 文字 / 粒子随机相位）：刻意用粗网格量化而非逐像素 diff**——64×40 网格逐格色差出相似度指标，**最差格逐一目检归因**，产物入库（截图 + 并排图 + metric.json）【samsy】。
- 换页等时间过程：颜色时间轨迹逐点对拍（每 120ms 采样计算色，per-sample RGB delta ≤6）【rogier】。

（实证：`case-studies/webgl-scenes.md` §3「量化指标替代逐像素」）

### 双侧同参数、同状态、同帧
- 镜像与复刻用同一脚本、同参数无头启动，驱动到同一状态再截图【samsy】【noomo】。**按状态量（`spreadT`/`progress`/`t`）对齐抓帧前，先量"单次截图耗时 / 被测运动全长"，≥1/10 就先修快门再谈相位**（`environment-traps.md` §7）【shopifydesign】。
- 驱动方式要抗噪：文本被 glitch 轮换时文本匹配不可用，改按索引点击【samsy】。（实证：`case-studies/webgl-scenes.md` §3「双侧同参数、同状态、同帧」）
- 滚动驱动 + 源站不可插桩 → probe-shim 路线【noomo】：约 90 行脚本在 `?__probe` 时接管 rAF/timer/visibility，手动泵 `__pump(dt, frames)` 把双侧驱动到同一 t；时间戳从 0 起，使 `Tick.seconds` 驱动的 shader 相位可对齐；**双侧同位注入**（镜像侧由静态服按 query 注入 `<head>` 首部、复刻侧用 Nitro `render:html` 钩子 unshift）——"gsap 在模块求值期捕获 rAF，注入太晚就失效，必须 head 首脚本"【noomo】。
- 驱动细节【noomo】：
  - `__drive` 真时钟配速泵 + MessageChannel yield（不受节流的宏任务边界，让 await 链推进）；
  - `experienceStarted` 需 isTrusted 真实点击触发；
  - `smoother.scrollTo(y,false)` 反复钉扎消动量残留。
- 截图前**资产预检**：先确认镜像服务能出图再对拍，否则截图会误导归因【rogier】。

### 渲染确定性与读回防呆
- headless 用 SwiftShader（`--use-gl=swiftshader`）保证可复现渲染【rogier】——**仅当站点没有 GPU 分级时才是无脑可用的**；必带 anti-throttling 旗标（`--disable-background-timer-throttling --disable-renderer-backgrounding`）【samsy】。
  > **⚠ 交叉警告**【shopifydesign】：`--use-gl=swiftshader` / `--disable-gpu` 属于 `determinism.md` §2.9 的**能力探测熵源**，会静默切换被测程序的分支——站点的 GPU 名黑名单正则里常常**就含 `swiftshader`**，而画质档被插值进 shader 源码：**加了这条 flag，你对拍的就是 low 档 shader，而其余门跑的是 high 档**（两侧一致所以不红）。另有一层代价：软件渲染下单次 `captureScreenshot` 要 1–2s，按状态量对齐抓帧会被采样偏差污染（`environment-traps.md` §7）。（实证：`case-studies/webgl-scenes.md` §3「渲染确定性与读回防呆」）
  > **决策与配套动作**（先 grep 应用区间有无 GPU 分级/能力探测，再决定用不用；用了就必须钉死画质档、断言实测档位、旗标与档位同行登记进偏差表）：见 `determinism.md` §5 的判定表。
- `readRenderTargetPixels` 读回前必查 `gl.getError`——全零缓冲是读回假象不是黑屏【noomo】。
- **无 `preserveDrawingBuffer` 的 WebGL canvas 不能用 `drawImage` 读**【kimi】；改用 `readPixels` 直读做字节门【kimi】。
- seek 后必须重新驱帧再截图【noomo】。

### 覆盖面与噪声归类
- 隔离 DOM 噪声：canvas-only 对比（隐藏 DOM 只比 WebGL 输出）【rogier】。
- **检查点必须覆盖滚动两端**——终检必须包含两端【noomo】。（实证：`case-studies/webgl-scenes.md` §3「覆盖面与噪声归类」）
- **显式归类噪声源再找真 bug**：对拍报告里把噪声显式归类（虚拟滚动缓动相位造成的构图偏移、动画相位不同的色温差、headless 字体缺失的换行差）——正因为有这个归类，才能在"噪声"里捞出真差异【oryzo】【samsy】。

## 4. sRGB/色彩管理：headless 盲区必须真机兜底

**headless 对拍存在结构性盲区，自动门全绿 ≠ 收工。** 两类已实证的盲区：
- **色彩管理**：纹理缺 sRGB→linear 解码会整场景偏亮发灰——headless 多轮对拍都归入"噪声"，**最后一轮真机对比才捞出**【oryzo】。
- **授权字体**：headless 下 Adobe Fonts 等授权字体不加载，换行/排版差异全是假象【oryzo】。

操作要求：
- [ ] 收官前至少一轮**真机浏览器对比**【oryzo】。
- [ ] 建议做**真机三方对拍**：线上 / 本地镜像 / 复刻三方并排，截图入库留证（命名区分 mirror-*/rebuild-*/dist-*，同机位对拍）【lando】。
- [ ] 剩余细微差异登记为已知残留，不假装 100%【lando】。

（实证：`case-studies/webgl-scenes.md` §4）

## 5. 常见坑

1. **后台标签 rAF 节流 + gsap lagSmoothing 伪装成站点假死**——三个项目独立踩过：（实证：`case-studies/webgl-scenes.md` §5）
   结论：判定时序 bug 前先校准探针；无头脚本必带 anti-throttling 旗标【samsy】。
2. **探针环境本身骗人**：vite HMR `?t=` 查询造出幽灵模块让探针读到假状态；探针时钟与页面时钟错位伪装成"计时器时间压缩"【samsy】。探针超时要与产品差异区分（"probe timing, not a product mismatch"，真 GPU tier 3 机器需要拉长 PROBE_WAIT）【rogier】。
3. **全局句柄会被引擎自己覆盖**：samsy 的 `window.camera` 被 ReflectorNode clone 覆盖成镜像相机——探针读到的不一定是主相机【samsy】。
4. **部署拓扑差异触发本地永不出现的竞态**【samsy】：
   - 真实网络延迟会暴露构造期纹理竞态——部署本身就是一道验证；
   - 定位手段：CDP Fetch 给单文件加延迟做**二分定位**，收敛到两张纹理；
   - 根因归为"单源 vs CDN 分域"的环境差而非代码；修复分"保真修正"与"登记偏差"两笔分开处理。
5. **CDP 工具坑**：调用必须带超时、单次多兆字节 `Runtime.evaluate` 会卡死管道要分块、headless Chrome 无视 SIGTERM 要 SIGKILL【kimi】。
6. **修"明显的 bug"反而崩溃**：（两例实证：`case-studies/webgl-scenes.md` §5）
   "压缩代码里的每个怪写法都可能是行为本身"——WebGL 死代码/怪写法照抄不修，登记为怪癖【rogier】【lando】。
7. **GLSL 版本默认值是隐形编译参数**：shader 文本逐字相同仍可能全军覆没（GLSL1 vs GLSL3），报错形态是"空场/NaN"而非醒目的编译日志【noomo】。
8. **NaN 类初始化 bug 只在冷启动暴露**：手动切换效果会掩盖它——每轮验收必须全新加载【oryzo】。（实证：`case-studies/webgl-scenes.md` §5）
9. **像素差异不许调参糊平**：必须追到取证级根因（GLSL 版本默认值、utility 族缺失），或用基准数据证明参数链无罪后登记为已知差异【noomo】。
