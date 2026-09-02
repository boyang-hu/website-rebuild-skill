# case-studies/webgl-scenes.md — WebGL/GLSL 场景逆向指南 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `webgl-scenes.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `webgl-scenes.md` 一一对应。

## 1. shader 定位与逐字提取

### 定位手段（按序尝试）

规则见 `webgl-scenes.md` §1「定位手段（按序尝试）」。

1. **grep 特征标记**：搜 `#define GLSLIFY 1` 定位 bundle 里全部内联 shader 字符串（oryzo 以此定位 118 段 shader）【oryzo】。
2. **搜值不搜名**：混淆 bundle 里 REVISION 等常量会被重命名——用值锚定：版本字符串（`const nv="179"` 锁定 Three 0.179.0）、十进制颜色字面量（`15064825` = 0xE5DEF9）、GLSL 特征串，都比标识符可靠【noomo】。
3. **bundle 内联 base64 资产也要提取**：noomo 从 bundle 提出 base64 的 `colorsMap` 1024×2 光谱 LUT 和 SMAA area/search 纹理到 `_extracted/`——缺 colorsMap 玻璃会整体变灰白。复刻侧若反向内嵌 base64，需做字节级一致性验证【noomo】。

### 提取纪律

规则见 `webgl-scenes.md` §1「提取纪律」。

- 集中存放 + 头注释声明来源与 "Do not edit by hand"（oryzo：`glsl/index.ts` 单文件 845 行 118 段）【oryzo】。
- 连源站变量名照抄（noomo 连 `yeahRaytracingBroWhySoComplex` 都保留）【noomo】。
- 死参数/错误赋值照抄：`mipFilter` 死参数、光场 RT 错误的 `format="R8"` 原样保留——"修正它们反而会偏离源站的实际渲染结果"【oryzo】。
- 每个场景/pass 文件头注明源行号区间（lando：`fluid.ts` 注明 "All GLSL verbatim"，Advection/Viscous/Divergence/Poisson/Pressure 各 pass 行号一一列出）【lando】。

### 对拍与证同

规则见 `webgl-scenes.md` §1「对拍与证同」。

- **ShaderChunk 展开对拍**：引擎（如 Three）会把 chunk 拼进最终 shader——rogier 的 `dump-va-shader.mjs` 从 bundle 提取源 shader 文本，与重建运行时（含 ShaderChunk 展开后）对拍，确认"源 bundle 光照 chunk 与本地 Three chunk 零差异，含 spotlight-map 乘法"【rogier】。
- noomo F1（全屏竖纹）即以此定案：shader 逐字相同，根因是 GLSL 版本默认值——源站默认 GLSL1、复刻误设 GLSL3 → 全部 shader 编译失败 → 空场 → NaN，一行修复级联解决三个表观 bug【noomo】。

## 2. 渲染管线审计方法

规则见 `webgl-scenes.md` §2。

1. **列材质/pass 清单**：逆向笔记必须包含材质清单与后处理链逐步拆解（samsy：26 项 TSL 节点材质 + 后处理链 + RenderTarget 清单；oryzo：MRT → TAA → SMAA/FXAA → Bloom → Bokeh → BlurBox → ScreenPaint → Final 十余 pass）【samsy】【oryzo】。
2. **按拓扑逐个 pass 移植，每加一个 pass 验收一轮**【oryzo】；多场景管线（rogier：sky/work/thumb/main/wavves/media/character）按源码结构重建【rogier】。
3. **复杂效果先拆成结构再移植**：samsy 把"零光照氛围"拆解为"黑雾 × 烘焙贴图 × 0.3 × 高度渐变 + bloom 只吃 emissive MRT"，并明写"复刻时必须按此结构而非『打灯调像』"【samsy】。
4. **渲染器配置审计（含拒绝清单）**：静态 + 运行时审计渲染器状态，不只记录"要有什么"，还记录"不许有什么"——rogier 的 `audit-renderer-output.mjs` 明确**拒绝在构造函数里重新引入 `setClearColor`**，因为源构造器（`qw`）没有这一调用【rogier】。
5. **动画/材质参数逐字取证到行号**：bloom strength 0.34 / radius 0.27×DPR（L69161）、雾 IDLE 700/800、玩家物理常量全表——全部从 bundle 行号抄录，不目测调参【samsy】。
6. **逆向阶段做证伪**：指纹会骗人——samsy 早期误判"有 GPU compute"，M1 证伪（`dispatchWorkgroups` 字符串全部来自 three 内部）；KTX2/meshopt 能力在 GLTFLoader 里但从未挂载；作品是 25 条不是 26 条。证伪结论写成"不要发明"清单【samsy】。
7. **TSL/WebGPU 注意项**：
   - 第三方库魔改的识别用量化手段：源站 TransformControls fork 与官方 addon 的 diff 用"数字字面量多重集 + 轴键结构对比"，洗掉正则假阳性（`.15` 无前导零、十六进制色值记法差异）后收敛出唯一真实增量（平移 gizmo 只留三支箭头）【samsy】。
8. **暴露数值探针句柄**：
   - 复刻侧留 `__probe` 门控的引擎句柄（noomo：`window.__sweet3`），断言层数与层序（"42 层与源站 `X.create` 全序一致"）、uniform 值、RT 尺寸精确值（"3650×1930→1460×772 = 视口×dpr×padding"）、相机位姿小数点后三位全等【noomo】；
   - rogier 更进一步把源码语义编码成 68 处 mode 字符串（如 `source-yD-onProjectActive-spotlight-reveal-woosh-uReveal-before-look-directional`），探针持同一组常量逐一比对（16 步激活顺序数组逐项断言）——"实现遵循了哪条源码语义"成为可自动回归的断言【rogier】；
   - 具体到对象级数值：rogier 的聚光灯探针断言 `SpotLight.map` 归属、位置 `(0,0,3.7)`/目标 `(0,0,-8)`/强度 220、3×3 投影采样亮度【rogier】。

管线审计 checklist 里的规模实证：

- [ ] 材质清单逐项有落点，数量与源站清单对上（samsy：26 项 TSL 材质）【samsy】

## 3. WebGL 对拍的特殊性

### 量化指标替代逐像素

规则见 `webgl-scenes.md` §3「量化指标替代逐像素」。

- 静态构图：行亮度剖面（整屏按行采样灰度，x 取 20%–80% 区间，验收 ±4 灰阶噪声级）+ 逐 band delta 用数字关账（rogier 修 blocks-color fallback：band 0.35 delta +0.0691 → -0.0011）【rogier】。
- 滚动叙事站：多滚动点对拍（oryzo：同视口 1456×830、按 section 对齐的 14 个滚动点，PIL 上下拼接逐组核对，平均亮度差 ±0.5 为验收）【oryzo】。
- **活场景（视频帧相位 / glitch 文字 / 粒子随机相位）：刻意用粗网格量化而非逐像素 diff**——samsy 用 1280×800 截图 64×40 网格逐格色差出相似度指标（home 99.4% / works 98.3% / about 98.6%），**最差格逐一目检归因**，产物入库（截图 + 并排图 + metric.json）【samsy】。

### 双侧同参数、同状态、同帧

规则见 `webgl-scenes.md` §3「双侧同参数、同状态、同帧」。

- 驱动方式要抗噪：samsy 的菜单文字被 glitch 轮换、文本匹配不可用，改按 `#topmenu` 索引点击【samsy】。

### 渲染确定性与读回防呆

规则见 `webgl-scenes.md` §3「渲染确定性与读回防呆」。

**⚠ 交叉警告**【shopifydesign】：`--use-gl=swiftshader` / `--disable-gpu` 属于 `determinism.md` §2.9 的**能力探测熵源**，会静默切换被测程序的分支——站点的 GPU 名黑名单正则里常常**就含 `swiftshader`**（shopify.design 的 `z3`/`H3` L22746–L22752 把 `"SwiftShader"` 直判 low），而画质档被插值进 shader 源码：**加了这条 flag，你对拍的就是 low 档 shader，而其余门跑的是 high 档**（该项目两个里程碑无人发现，两侧一致所以不红；已登记为偏差 D16）。另有一层代价：软件渲染下 1728×1080 单次 `captureScreenshot` 要 1–2s，按 `spreadT` 之类的状态量对齐抓帧会被采样偏差污染（`environment-traps.md` §7）。

- **无 `preserveDrawingBuffer` 的 WebGL canvas 不能用 `drawImage` 读**【kimi】；kimi 唯一的 WebGL 场景（Dither）用 `readPixels` 直读做字节门【kimi】。

### 覆盖面与噪声归类

规则见 `webgl-scenes.md` §3「覆盖面与噪声归类」。

- **检查点必须覆盖滚动两端**：noomo 探针没测滚动终点 t=20，导致 HomeFooter 整段揭示动画缺失漏网——终检必须包含两端【noomo】。

## 4. sRGB/色彩管理：headless 盲区必须真机兜底

规则见 `webgl-scenes.md` §4。

- **色彩管理**：oryzo 的 8 处纹理缺 sRGB→linear 解码，整场景偏亮发灰——headless 多轮对拍都归入"噪声"，**最后一轮真机对比才捞出**【oryzo】。
- [ ] 收官前至少一轮**真机浏览器对比**（oryzo 真机抽查揪出 sRGB bug）【oryzo】。
- [ ] 建议做**真机三方对拍**：线上 / 本地镜像 / 复刻三方并排，截图入库留证（lando：`docs/compare/` 23 张，命名区分 mirror-*/rebuild-*/dist-*，同机位对拍）【lando】。
- [ ] 剩余细微差异登记为已知残留，不假装 100%（lando：wireframe 扫描层 uTime 相位细微差登记在案）【lando】。

## 5. 常见坑

规则见 `webgl-scenes.md` §5。

1. 后台标签 rAF 节流 + gsap lagSmoothing 伪装成站点假死，三个项目独立踩过：
   - oryzo：人肉盯屏不可靠，因此建无头回归【oryzo】；
   - samsy：误判为源码 bug 并错误"修复"，取证后撤销【samsy】；
   - noomo：M0 镜像阶段亲历【noomo】。
4. 部署拓扑差异触发本地永不出现的竞态：
   - samsy 上线后真实网络延迟暴露构造期纹理竞态——部署本身就是一道验证；
6. 修"明显的 bug"反而崩溃：
   - lando Q13——源站 `scene.remove(Q.name)` 传字符串（three 中 no-op），"修好"后真删除破坏遍历导致转场崩溃，最终按怪癖回抄【lando】；
   - rogier 的 `pz % 250 + 10` 带符号取模被"好心修正"成正取模后 About 页浮动方块全部消失【rogier】。
8. **NaN 类初始化 bug 只在冷启动暴露**：oryzo 的滚动指示器未初始化字段 → `u_pulseCenter.y = NaN` → 整屏恒定色，手动切换效果会掩盖它——每轮验收必须全新加载【oryzo】。
