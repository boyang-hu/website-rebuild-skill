# tools/ — 源码化阶段的重构器

⭐ **依赖纪律按阶段划：源码化之前，整条流水线零依赖。** 复刻项目从 Step 0 到 M(n)
不装任何东西；**到 M(n+1) 才获得 devDependencies**，因为作用域安全的分析需要真正的
parser（`@babel/parser` / `@babel/traverse`）。这里放的就是那个阶段的工具。

⛔ 前面的阶段需要 parser 时，**外挂而不是 import**：spawn 一个钉死版本的 npx
（见 `scripts/beautify-bundle.mjs`、`scripts/module-map.mjs`）。

⛔ **`scripts/` 里的任何门都不许 import 这里的任何文件**——检查者不能是生产者
（`references/verification-gates.md` §2.1.2）。两条纪律都由 `scripts/verify-zerodep.mjs` 守。

| 工具 | 用途 |
|---|---|
| `name-modules.mjs` | 按 0–4 级证据给模块提名，并记下依据的那句话；无证据保留哈希 id——**错名比哈希更糟，因为哈希会让人去看** |
| `modules-to-src.mjs` | 把一份模块容器端口摊成可读树：每个模块一个文件（名字可带子目录）、带溯源头注（源 bundle 行区间 + 命名证据层级）、包装器形参作用域安全地重命名为 `(module, exports, require)`（webpack）或 `(ctx)`（Turbopack）。⛔ **不把 require 转成静态 import**——require 惰性且记忆化，ESM import 提升求值，转换会重排每个模块的顶层副作用。产出 `registry.js` + `runtime.js`（独立运行时）+ `index.js`；⚠ 跨 chunk require 的场景不用独立运行时，改用 **chunk 形交付**（见 `references/porting-discipline.md` §2.6） | 
| `make-standalone.mjs` | 给 src/ 配齐离开仓库所需的一切：按账本把产出引用的资产复制进 `src/public/`（⭐ 到这一步"不复制"纪律**反转**——交付物的要求恰恰是"拷到哪都能跑"）、生成 `package.json`（build/serve 脚本烤入 ext/stub/origin 主机参数）、`--replaced` 指定被端口替换的源 bundle **不随行**（被替换物躺在替换者旁边，"跑的是哪个"就要靠实验回答）、`--allow` 消费 `external.txt` 豁免源站自身 404、`--own` 声明端口自有构建产物。裸 `/ext/<host>`（本地化的 preconnect）不算资产缺口。⭐ **交付物自带字节清单**（`byte-manifest.json` + 生成的 `verify-bytes.mjs`）：逐文件 sha256 在生成时对**落盘后的字节**钉死,`npm run check/build/serve` 每次先重验——副本从"验过一次"变成"随时自证",端口自有构建产物列为 unpinned（每次 build 重生成） |
| `group-parts.mjs` | 把拼接式分解的平铺部件按**字面证据**折进域目录:仅共享标识符 token 计入——前导规则只认原名大写开头的类族(Camera*/Wave* → camera/ wave/),小写动词(get*/create*)拒分(字面但糊的桶比平铺更藏东西);尾缀族要更长的重复。先按新布局重拼验 sha **再**动盘,压缩名 chunk 证据不足即整体保持平铺。实测 hashgraphvc:场景 chunk 151 件 → 24 个域目录,33/33 chunk 重拼仍逐字节一致 |
| `flight-to-mdx.mjs` | C1 的正文反推器：flight 元素树 → MDX 源。markdown 构词（p/标题`[#id]`/列表/围栏/脚注对）回 markdown；站点组件形状回 JSX 调用；其余回带精确 className 的字面 JSX（不丢字节）。⚠ 站点侧适配区在文件头注明（LINK_CLASS/SHAPE/FIRST_PARTY，像 harvest.config 一样属于站点）；四个 MDX 陷阱的规避已内建（多行模板字面量被按块缩进剥空格→属性值一律 JSON 字面量；组件映射按上下文分；JSX 流里裸文本被包 p→文本一律 `{"json"}` 表达式；`pre>code>code` 嵌套=围栏指纹）。实测 rauchg 17 页全过、语义门 18/18 |

⚠ 复制到复刻项目时放在项目的 `tools/` 下，与项目 `package.json` 的 devDependencies 一起走。
