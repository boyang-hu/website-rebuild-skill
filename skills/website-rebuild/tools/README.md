# tools/ — 源码化阶段的重构器

⭐ **依赖纪律按阶段划：源码化之前，整条流水线零依赖。** 复刻项目从 Step 0 到 M(n)
不装任何东西；**到 M(n+1) 才获得 devDependencies**，因为作用域安全的分析需要真正的
parser（`@babel/parser` / `@babel/traverse`）。这里放的就是那个阶段的工具。

⛔ 前面的阶段需要 parser 时，**外挂而不是 import**：spawn 一个钉死版本的 npx
（见 `scripts/beautify-bundle.mjs`、`scripts/module-map.mjs`）。

⛔ **`scripts/` 里的任何门都不许 import 这里的任何文件**——检查者不能是生产者
（`references/verification-gates.md` §2.1.2）。两条纪律都由 `scripts/verify-zerodep.mjs` 守。

⭐ **这里的依赖钉在 `tools/package.json`**（`@babel/parser` / `@babel/traverse`，精确版本）：项目到 M(n+1) 时把这两条抄进自己的 `package.json` 再 `npm install`；此前 skill 从未在任何地方声明过它们，版本靠运气。

| 工具 | 用途 |
|---|---|
| `name-modules.mjs` | 按 0–4 级证据给模块提名，并记下依据的那句话；无证据保留哈希 id——**错名比哈希更糟，因为哈希会让人去看** |
| `modules-to-src.mjs` | 把一份模块容器端口摊成可读树：每个模块一个文件（名字可带子目录）、带溯源头注（源 bundle 行区间 + 命名证据层级）、包装器形参作用域安全地重命名为 `(module, exports, require)`（webpack）或 `(ctx)`（Turbopack）。⛔ **不把 require 转成静态 import**——require 惰性且记忆化，ESM import 提升求值，转换会重排每个模块的顶层副作用。产出 `registry.js` + `runtime.js`（独立运行时）+ `index.js`；⚠ 跨 chunk require 的场景不用独立运行时，改用 **chunk 形交付**（见 `references/porting-discipline.md` §2.6） | 
| `make-standalone.mjs` | 给 src/ 配齐离开仓库所需的一切：按账本把产出引用的资产复制进 `src/public/`（⭐ 到这一步"不复制"纪律**反转**——交付物的要求恰恰是"拷到哪都能跑"）、生成 `package.json`（build/serve 脚本烤入 ext/stub/origin 主机参数）、`--replaced` 指定被端口替换的源 bundle **不随行**（被替换物躺在替换者旁边，"跑的是哪个"就要靠实验回答）、`--allow` 消费 `external.txt` 豁免源站自身 404、`--own` 声明端口自有构建产物。裸 `/ext/<host>`（本地化的 preconnect）不算资产缺口。⭐ **交付物自带字节清单**（`byte-manifest.json` + 生成的 `verify-bytes.mjs`）：逐文件 sha256 在生成时对**落盘后的字节**钉死,`npm run check/build/serve` 每次先重验——副本从"验过一次"变成"随时自证",端口自有构建产物列为 unpinned（每次 build 重生成） |。v0.3.16：有资产缺失时 exit 1（此前打印 FAIL 仍退 0）
| `group-parts.mjs` | 把拼接式分解的平铺部件按**字面证据**折进域目录:仅共享标识符 token 计入——前导规则只认原名大写开头的类族(Camera*/Wave* → camera/ wave/),小写动词(get*/create*)拒分(字面但糊的桶比平铺更藏东西);尾缀族要更长的重复。先按新布局重拼验 sha **再**动盘,压缩名 chunk 证据不足即整体保持平铺。实测 hashgraphvc:场景 chunk 151 件 → 24 个域目录,33/33 chunk 重拼仍逐字节一致 |
| `flight-to-mdx.mjs` | C1 的正文反推器：flight 元素树 → MDX 源。markdown 构词（p/标题`[#id]`/列表/围栏/脚注对）回 markdown；站点组件形状回 JSX 调用；其余回带精确 className 的字面 JSX（不丢字节）。⚠ 站点侧适配区在文件头注明（LINK_CLASS/SHAPE/FIRST_PARTY，像 harvest.config 一样属于站点）；四个 MDX 陷阱的规避已内建（多行模板字面量被按块缩进剥空格→属性值一律 JSON 字面量；组件映射按上下文分；JSX 流里裸文本被包 p→文本一律 `{"json"}` 表达式；`pre>code>code` 嵌套=围栏指纹）。实测 rauchg 17 页全过、语义门 18/18 |

⚠ 复制到复刻项目时放在项目的 `tools/` 下，与项目 `package.json` 的 devDependencies 一起走。

## 速查表：用途与使用阶段（自 SKILL.md 迁入）

| 脚本 | 用途 | 使用阶段 |
|---|---|---|
| `tools/assemble-static.mjs` | **像素门两侧同经 serve.mjs**：把 `next build` 的 `.next/server/app/**.html` 摊成 `<route>/index.html`、`_next/static` 与 `public/*` 软链进静态树，用 `serve --side rebuild` 伺服——`next start` 侧不注入 probe-shim，镜像帧 BLANK/重建有画是冻结不对称不是差异（darkroom）。只供对拍，sweep 仍跑 next start | M(n-1)（C1 重构工程） |
| `tools/accept-names.mjs` | **命名的接受步**：name-modules 只提名不决定；默认只接受 tier-1（打包器声明的导出名），其余保留 id——"错名比哈希更糟"在这一步才真正生效（darkroom 278 模块接受 105） | M(n+1) |
| `tools/sourcify-chunk.mjs` | **多 chunk 站的 M(n+1) 驱动**：按 merged map 的 canonical 位切子闭包（⛔ id 与 map 同型：字符串），逐 chunk 跑 name-modules → accept-names → modules-to-src → verify-module-map（darkroom 43/43） | M(n+1)（多 chunk 站） |
| `tools/harvest-optimized-images.mjs` | **next/image 优化器产物补齐**：像素门重建侧的静态树没有优化器，serve 回落原图 → 重采样残差；镜像字节优先，本机 `next start` 优化器兜底并登记为重建侧生成物（rsc-reconstruction §3.5） | M(n-1)（C1 重构工程） |
| `tools/verify-fresh-next.mjs` | **verify-fresh 的 Next 形态**：src → `next build` → assemble-static 链重建比字节；⛔ 前提 `generateBuildId` 钉死，否则链条永远"过期" | M(n+1)（C1 重构工程） |
| `tools/name-modules.mjs` | **模块提名**：模块化 bundle 的 id 是内容哈希，文件名要从证据里来。按 0–4 级证据提名并把**依据的那句话**一起记下（人工裁决 / 自注册与全局 / 多消费方字段名 / 常量值与命名前缀 / 报错主语），⛔ **无证据保留 id——错名比哈希更糟**。⭐ 最强的证据在模块外面：属性名不被压缩，`this._chapterPlayer = new M(…)` 能给一个匿名 `class {}` 命名 | M(n+1)（模块化打包产物） |
