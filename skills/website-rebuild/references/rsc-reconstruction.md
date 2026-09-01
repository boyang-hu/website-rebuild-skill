# RSC 重构式逆向(C1)— flight 载荷到可构建源码

> v0.3 全程在 rauchg.com(Next 16.1.1 / Turbopack / React 19 canary)上实证:
> 18/18 路由 flight 语义门 PASS、模块 id 双射 19 对、运行时 sweep 18/18;
> 盲逆向对答案(rauchg/blog)判卷:结构 ≈95%、行为 ≈98%、字面 ≈90%
> (docs/recovery-report.md 型报告是本路线的标准收口产物)。

## §0 判级语义的修订

C1(服务端组件源不下发)从"拒绝"改为**可做:重构式逆向**。定义本身没变——
确实没有可转写的服务端源码;变的是结论:**服务端组件的完整输出(flight 流)
就内联在每页 HTML 里,它是可对拍的规格书**。重构出一个 Next 工程,使其构建
产物通过对镜像的语义门,这就是 C1 的 L2/L3——在 C1 语境下这两级**合并**:
没有"逐字 port"可言,第一份产物就是"人写的源码 + 门证明的等价"。

⭐ **纪律 3 在 C1 的读法**:「源站有的」= flight 树/HTML/资产字节;「源站没有的」=
任何 flight 推不出来的服务端行为。重构出的服务端源码是**显式登记的推断物**,
每个文件头注引用它依据的镜像证据坐标(flight 行、chunk 行号、CSS 字节)。

## §1 坐标系:flight 流(C1 的 `_pretty/`)

`scripts/flight-decode.mjs` 把每页的 `self.__next_f.push` 流解成:模块引用表
(I 行)、HL 预载、**已解引用的元素树** + JSX 式 outline。此后一切重构决定
引用这棵树,如同 A 类引用 `_pretty/` 行号。

线格式(react-server-dom,Next 15/16 实测):
- 行 `<hexId?>:<payload>`,**id 可为空**(`:HL` 行)——行走器漏掉这条会在首个
  HL 处断链;
- `T<hex>,` 行按声明字节数走、无终止符(verify-lenprefix 的老课);
- 行 `0:` = 路由载荷 `{P,b,c,q,i,f,m,G,S}`;`b`=buildId(用 generateBuildId 钉死),
  `f[i]=[routerState, seed 元素树, head 元素树, isPartial]`;
- 元素 `["$",type,key,props]`;`I[turbopackId,[chunks],导出名]` 是客户端组件引用——
  **导出名是白送的 tier-1 命名证据**(Logo/Posts/Header 直接写在载荷里)。

### §1.1 flight 是保真神谕(比 DOM 更细的证据面)

1. ⭐ **键序 = JSX prop 序**。flight 按源码 prop 顺序序列化,两侧键序不同 =
   你的 prop 写序和作者不同(实测靠它照出脚注反链的 href/className/id 顺序)。
2. ⭐ **化石全下发**:`{cond && x}` 的 `false`/`undefined`、`{" "}` 显著空白、
   模板字符串类名里的换行缩进与**尾空格**——全部要照抄发射,门会验。
3. ⭐ **`(post)` 这样的路由组名字面出现在 routerState 里**;segment 全是纯字符串
   = 字面目录(动态段是 `[param,value,"d"]` 元组)——目录结构无损恢复。
4. ⭐ 标题文本尾空格 + 独立 id 锚 → 还原 `## 标题 [#custom-id]` 源约定
   (99/101 个标题带作者自选 id,剥离 `[#id]` 后的空格就是化石)。
5. ⭐ **作者的不一致本身是保真面**:同站两篇脚注一有 `"\n"` 分隔一没有、
   一页整个忘写 metadata、og:title 写错——照抄,不"修好"。线上 bug 也一样
   (对活源站复测是最强豁免证据)。

## §2 镜像层的 C1 特有面

- **`?_rsc=` 载荷**(客户端导航预取)与 **next/image 变体**是运行时资源;
  ⭐ 变体阶梯**从 SSR HTML 的 srcset 穷举**(闭包全集),不靠浏览器碰运气
  (实测 srcset 穷举 1,078 vs 浏览器只碰到 217)。`scripts/reconcile-gaps.mjs`
  逐条容错 + 分批记账地补进镜像。
- **爬虫专供路由**要主动抓:`og:image` 指向的动态 OG 图(`/og/<slug>`、
  `/opengraph-image`)只有爬虫访问,BFS 与 CDP 都看不见。
- ⛔ **well-known 路由探测**(对答案暴露的盲区):`/atom` `/rss` `/feed`
  `/sitemap.xml` 无入链即不可达——M0 收尾时逐个 GET 一次,200 就入镜。
  纯隐藏路由空间(短链系统、未链接页面)原理不可枚举,如实登记为盲区。
- API 快照按 B 类办;⚠ 镜像各页可能是 **ISR 不同再生时刻**(每页一份数据纪元,
  源站自己就在发不一致的数据)——重构架构用单一数据源,门对纪元字段做
  `--normalize-props` 归一并登记偏差。

## §3 重构工程(rebuild/ = 可构建的 Next 工程)

- 版本从字节钓:`window.next={version:...}`、库的 sdkv/版本串、css 产物形态
  (Tailwind v3 无 @layer/@property)、**字体管线看 css-module 名**
  (`geist_<hash>-module` = next/font/google;geist npm 包的字体字节 sha 对不上
  即排除——实测 7 个依赖版本精确命中)。
- 客户端一方组件是 C2 情形:源码就在 chunk 里(module-map 认 Turbopack 容器),
  逐字翻译并头注 `_pretty/` 行号。
- 服务端组件从 flight 树反推;正文用 `tools/flight-to-mdx.mjs`(站点侧适配
  LINK_CLASS/SHAPE/FIRST_PARTY,机制通用)。
- 平台注入物从镜像快照入 `public/`(`/_vercel/insights` 脚本);动态 OG 图
  以路由伺服快照字节(登记:不再生)。

### §3.1 MDX 反推的四个陷阱(全部实测流血)

1. ⛔ **MDX 按块缩进剥多行模板字面量的前导空格**(6 空格类名被剥成 4)——
   含换行的属性值一律发 **JSON 字符串字面量** `className={"\n      p-4…"}`。
2. ⛔ **组件映射按上下文分**:markdown 段落里的字面 `<a>` 不映射(要发全 props);
   JSX 表达式里的字面 `<a>` 映射(发最小形,组件补 props)——发错方向就是
   类名翻倍或裸链接。
3. ⛔ **多行 JSX 流里的裸文本被当 markdown 包 p**(表格 th 里长出 `<p>`)——
   文本子节点一律发 `{"json"}` 表达式。
4. ⭐ **围栏指纹**:`pre>code>code` 嵌套 = markdown 围栏(Pre+Code 双包装);
   单层 code 或内含元素/`{" "}` 串 = 作者手写字面 JSX,逐字发射(围栏路径的
   textOf 会把内嵌链接压扁——先判形再选路)。

### §3.2 CSS 面:tailwind 扫描面与 token 必须对着镜像编译 CSS 对账【basement】

语义门只看 flight 树,**看不见 CSS**——重建工程的样式面是独立债务,且塌法极具
迷惑性:白色 SVG logo 因 `text-*` 未生成变黑底黑字"消失"、grid 塌成换行、
自定义字体回退系统 sans、reveal 幕布类缺失导致整页盖黑(machine 模式黑屏
= `.machine-reveal` 只有 keyframes 没有类规则)。四轮用户实测报障同一根因:

1. ⛔ **扫描面**:逐字图交付(porting-discipline §2.5 第四形态)下,DOM 外壳的
   类名活在 verbatim JS 的编译串里——tailwind `content` 不含 `verbatim/**/*.js`
   = JIT 全部不生成。凡类名所在的每种文件形态都要进 glob。
2. ⛔ **token 台账是相对扫描面的**:"JIT 只编译站上用到的,这就是全集"这句话
   在扫描面扩大时作废——f-* 字号桌面档(藏在 `.lg\:text-f-*` 媒体查询里)、
   z-navbar、备用模式配色族(machine-*)、自定义字体(fontFamily.sans/mono
   被源站覆写到 next/font 变量 + 站点私有字体如 flauta)都要从镜像编译规则
   重新取证。字体链尤险:ttf/localFont/CSS 变量三层全在,独缺 token 一层,
   照样回退系统字体。
3. ⭐ **carry-css 方法论**(tailwind 生成不了的规则,机器搬运不手抄):
   需求面 = 代表路由 SSR DOM 类名并集——**必须覆盖每个路由家族,含备用
   模式家族**(basement 的 /ai 机器可读镜像有独立配色与幕布,漏采样 = 该
   家族类全缺);减去构建产物已有的类;剩余到镜像 CSS 逐条找规则原文搬运:
   @media 上下文保留、@keyframes 随 animation-name 连带、元素级 base 规则
   (`body{background:#000;font-family:…}`,缺它 = 水合前白闪)单独一道;
   工具要幂等(上一轮产物已编进构建 CSS,重跑前先从 have 集剔除自身贡献)。
4. **镜像里也无规则的类 = 源站自身死类**(`bg-brank-k` 拼写错、`text-caption`
   等 16 个实测)——照抄不修(§1.3),报告里点名即可。
5. ⛔ 选择器分词陷阱:数字开头类名的 CSS 转义带尾随空格(`.\33 xl\:…` =
   `3xl:…`),naive 的 `\\.` 分词在空格处截断——`2xl/3xl` 断点变体整族漏判。

## §4 语义门(scripts/verify-flight.mjs)

字节门到不了 C1 收口:chunk 名/模块 id/css-module 类/媒体哈希是**构建哈希
命名空间**,不携带行为。门自带解析器(⛔ 不 import flight-decode——检查者
不能是生产者),把两侧流解开、规范化、逐节点深比较;**其余一切差异照红**。

内建规范化族(每条对应一类"证明不携带行为"的论证):
- N1 chunk 路径、N2 css-module 类哈希(两种命名形态)、N3 媒体文件哈希;
- N4 **模块 id 全局双射**——同一导出名处处对应同一对 id,一对多即红
  (符号门在 C1 的同构物);
- N5 预载 script 与 precedence 样式链接 = **可提升资源**,挂载点归打包器
  (react-tweet 的 css 两侧内容哈希相同、挂载点不同);
- N7 children 尾部空白化石、N8 直接元素≡单元素数组、N9 相邻字符串合并
  (DOM 渲染等价的编码自由度);
- N6 首页 `c:["","index"]`(见 §5)。
站点登记项走旗标:`--normalize-props`(纪元字段)、`--normalize-class`
(库渲染子树,如 react-tweet)。

⭐ 配套:verify-lenprefix 跑构建侧;sweep 跑 `next start` 拓扑(外链按
"忠实于源站"豁免——重建引用原 CDN 是正确行为,和镜像侧的本地化目标不同)。

## §5 平台层工件(登记,不复刻)

- ⭐ **Vercel 边缘把 / 重写到 /index**:镜像首页 `c:["","index"]`、SSR 里
  usePathname 撞见 "/index"(Logo 渲染成回链)、客户端水合撞 "/" → **线上的
  React #418 就是这么来的**。静态预渲染侧 `c:["",""]`、无水合错误——登记
  D 类偏差;要逐字节复刻线上 bug 得加边缘重写,通常不值得。
- PPR/动态渲染的 `BAILOUT_TO_CLIENT_SIDE_RENDERING` 模板 vs 全静态输出。
- Turbopack chunk 切分粒度(preload 数量、I 行 chunk 表长度)。

## §6 原理性不可恢复面(如实写进恢复率报告)

- 错误路径的响应形状(镜像只有 happy path);
- 数据层实现(Redis/DB——方向可推断,凭据与写路径不可见);
- 服务端缓存层(推文缓存等);
- 动态图片生成器源码(只拿得到输出字节);
- TS 类型(JS 是保真下界);无入链路由空间。

## §7 盲逆向纪律(有公开源码的目标)

答案钥匙存在时:收口之前一个字节不看;每个重构决定在头注引用镜像证据坐标
(这是"盲"的操作性定义——模型训练数据可能含目标仓库印象,诚实性条款要写进
报告);对答案产出恢复率报告(结构/行为/字面三轴 + 盲区清单)。**先打有答案的
校准靶,再打闭源实战靶**——差距本身是方法论的下一版输入。
