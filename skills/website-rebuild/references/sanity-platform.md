# Sanity CMS 场景（Next/Nuxt 创意站的主流内容层）

> **何时加载本文件**：Step 0 指纹命中 Sanity——HTML/flight/payload 里出现
> `cdn.sanity.io/images/<projectId>/<dataset>/`、`*.api.sanity.io` / `*.apicdn.sanity.io`
> 请求、载荷里成片的 `_key`/`_type`/`_ref` 字段、或 `/studio` 路由——时。
> 在判级前读完 §0，在 M0 镜像动工前读完 §1。
>
> **置信度声明**：本文实证来自三个样本——hashgraphvc（Nuxt 3 + Sanity，L2 收口）
> 【hashgraphvc】、basement.studio（Next + Sanity，战役进行中）【basement】、
> franshalsmuseum（Step 0 探测判 C/D）【franshalsmuseum】。URL 参数全集
> （`w/h/fit/crop/q/fm/dpr/auto…`）是公开语法、未逐项实测；表外形态现场核验后回填本文。

## 0. 指纹与判级：Sanity 本身不定级，内容烘焙时点才定级

**指纹语法**（确定规格）：

- 图片：`https://cdn.sanity.io/images/<projectId>/<dataset>/<sha1-40>-<W>x<H>.<ext>[?w=&h=&fit=&auto=format…]`
  （basement=`9syto90m`、hashgraphvc=`diak0tmr`、franshalsmuseum=`r35o2ddl`；dataset 常为 `production`）
- 文件/视频：`https://cdn.sanity.io/files/<projectId>/<dataset>/<sha1-40>.<ext>`
- 内容 API：`https://<projectId>.api.sanity.io/v<日期>/data/query/<dataset>?query=<GROQ>`；
  `apicdn.sanity.io` 是它的 CDN 缓存层
- 管理端：`/studio` 路由 = 站内嵌 Sanity Studio（basement 实见，robots 排除）【basement】

⭐ **文件名自带元数据**：`<sha1>-<W>x<H>` 里的 WxH 是**源资产内在尺寸**（查询参数只做缩放裁剪），
sha1 是内容地址——"多少个不同图"的清点、变体归并、资产去重对账，直接按 hash 段做
（basement：13,870 条响应式引用按 hash 收敛成 722 个源资产）【basement】。

**判级判据不是"有没有 Sanity"，是内容在哪个时点被烘进客户端可见的字节**。三形态：

| 形态 | 判据 | 处置 | 实证 |
|---|---|---|---|
| **构建期烘焙** | 内容全部已在 SSR HTML / flight / `__NUXT_DATA__` 里；运行时零 GROQ 流量 | 不改判级，A/B/C1 照跑；Sanity 只是资产 CDN + 载荷里的数据形状 | 【basement】【hashgraphvc】主路径 |
| **局部 fallback 查询** | 特定路径（404 壳、预览态）才打 `*.api.sanity.io` | B 类 API 快照：镜像实测响应、按**完整 query 键**应答（见 §1.4） | 【hashgraphvc】未知路由的法律页查询 |
| **运行时装配** | 首屏内容靠运行时 GROQ / `?_rsc=` 端点，且内容实体持续漂移（展讯、日程、库存） | **D 因素**：复刻对象必须改述为"某时点快照"，否则对象错位按 D 拒绝 | 【franshalsmuseum】 |

操作化：断网伺服镜像看首屏是否发 `*.api(cdn)?.sanity.io` 请求；对照 flight/payload
里内容是否已齐。判定结论连同 projectId/dataset 钉入 `engine-notes.md`。

## 1. 镜像层

### 1.1 `--hosts` 清单（CDN 站假 GAP=0 的老课，Sanity 版）

netcapture / mirror-site 的外部主机清单必含（按站取舍）：`cdn.sanity.io`、
`<projectId>.api.sanity.io`、`<projectId>.apicdn.sanity.io`。hashgraphvc 实例：
`--ext-hosts cdn.sanity.io,diak0tmr.api.sanity.io`【hashgraphvc】。

⚠ **next/image 代理形态里 Sanity 主机是被编码嵌套的**：
`/_next/image?url=https%3A%2F%2Fcdn.sanity.io%2F…&w=1200&q=75`——off-host 普查与
`--hosts` 判定都要**先解码 `url=` 参数再判主机**，否则 Sanity 引用整批被计成同源流量。

### 1.2 ⛔ `auto=format` 是内容协商：裸 fetch 与浏览器拿到的是两种字节

带 `auto=format` 的 URL，CDN 按请求的 `Accept` 头选返回格式。本 skill 的
`mirror-site.mjs` / `reconcile-gaps.mjs` 全部 profile 都是 `accept: */*`——**从不声明
图片格式支持**，于是 Sanity 一律回退 JPEG/PNG；而真浏览器（`Accept: image/avif,image/webp,…`）
同一 URL 拿到 avif/webp。**同一 URL、两种字节，镜像与浏览器运行时就此分叉。**

实证【basement】：镜像里 `…-1920x833@@auto=format&w=1200.webp` 扩展名 `.webp`、
**魔数是 JPEG**——源资产本身是 webp，裸 Accept 下被 CDN 转码回 JPEG；该镜像 391 个
`@@auto=format` 变体全以 `*/*` profile 落盘。后果三连：

1. 镜像伺服的字节 ≠ 浏览器在源站拿到的字节（jpeg 压痕 vs webp/avif），**对源站保真
   这一维度上是静默偏差**；
2. 两侧都从镜像读时，跨侧门、像素门**照绿**——这是"错的镜像能让下游门全绿"的又一实例；
3. `serve.mjs` 按扩展名猜 MIME 会报 `image/webp` 而实发 JPEG 字节（浏览器嗅探兜住了
   渲染，兜不住保真）。

**查法**（对存量镜像，一条命令级）：枚举含 `auto=format` 的镜像文件，魔数 vs URL 扩展名
vs 账本 content-type 三方对照，不一致逐条列出。**处置**：

- 新镜像：`auto=format` 资产用**浏览器同款 Accept** 抓（照抄 netcapture 实际 UA/Accept，
  不要自创第三种 profile——保真目标是"浏览器会拿到的字节"，标尺只有一把）；或整批交给
  netcapture 真浏览器通道。fetch profile 逐条进账本。
- 存量镜像：**镜像神圣，不许原地改字节**——分叉登记为偏差（源站怎么发 / 镜像存了什么 /
  为什么 / 何时重抓），重抓走新一轮 M0 记账。

### 1.3 变体阶梯：字节推导全集，两层展开

next/image 的 srcset 穷举课（1,078 vs 浏览器碰到 217）在 Sanity 站有两条通路，**都要展开**：

1. **直连**：`cdn.sanity.io/…?auto=format&fit=max&w=<档>`——阶梯从 SSR HTML / flight 的
   srcset 逐条穷举；
2. **代理**：`/_next/image?url=<encoded sanity url>&w=<deviceSizes 档>&q=`——外层按
   next/image 的 deviceSizes 档位穷举，内层解码后即直连形态，**两层各自入账**。

⭐ 已观察形态（两样本，可当线索不当规格）：`@sanity/image-url` builder 拼出的查询参数呈
字母序（`auto=format&fit=max&h=…&w=…`）——参数序稳定意味着阶梯 URL 可精确预生成，
也是"这批 URL 出自官方 builder 而非手拼"的弱指纹【basement】。

### 1.4 ⛔ 运行时拼接的 API base：普通 host 改写命不中

Sanity client 由 `projectId + dataset` 在**运行时拼出** `https://<projectId>.api.sanity.io/…`
——镜像本地化的字面量 host 改写对拼接结果无效（字符串在源字节里不存在）。hashgraphvc
的登记做法（偏差 6.2）：服务层把 client 的**URL 构造模板**改写为 `${location.origin}/ext/…`，
GROQ query 原样保留；断网下 404 壳会**反复重试同一查询**（怪癖 Q3，照抄行为、只本地化
endpoint），应答按**完整 query 字符串为键**返回镜像实测的那份 JSON【hashgraphvc】。
这与 `serve.mjs --rewrite` 的"源程序按自己的域名分支"是同族问题——先 grep bundle 里的
`api.sanity.io` / `projectId` 构造点，再决定改写落在哪层。

### 1.5 robots 与授权边界

- `cdn.sanity.io/robots.txt` 按 project 路径逐条声明（hashgraphvc 实测：允许
  `/files/<projectId>/`，PDF 类 Disallow 未命中本站资产）——SKILL.md 的**逐路径判定
  纪律**在第三方 CDN 上同样适用，不因存在 Disallow 行判全站禁止【hashgraphvc】。
- `/studio` 是管理端：登录墙之内 + robots 排除，**不抓**，登记为技术性排除【basement】。

## 2. C1/重构层的 Sanity 面

- ⭐ **`_key` 是化石**：Sanity 数组项的随机 `_key` 串原样进 flight/payload——照抄发射，
  `verify-flight.mjs` 会照比。它是内容数据不是构建噪声，**不进任何 normalize 名单**。
- **ISR 纪元 = 内容漂移的投影**：`rsc-reconstruction.md` §2 的"各页可能是不同再生时刻"
  在 Sanity 站是常态（编辑随时发布）。镜像**单会话紧凑抓完**压小纪元差；残余纪元字段走
  `--normalize-props` 并登记偏差。
- **重构侧数据源**：C1 重构工程用单一数据快照（从 flight 反推的内容树）替代 GROQ 数据层
  ——数据层实现属"原理性不可恢复面"（`rsc-reconstruction.md` §6），方向可推断、
  凭据与查询不可见，如实写进恢复率报告。

## 3. 复刻侧与部署决策

- **忠实拓扑**（C1 `next start` sweep）引用原 `cdn.sanity.io` 是正确行为（外链按"忠实于
  源站"豁免）；**镜像/断网拓扑**必须本地化。两个拓扑两套断言，别混。
- ⚠ **产物引用原 projectId = 内容仍挂在权利人的 Sanity 账上**：源项目改内容/删 dataset，
  产物跟着漂移或断图；公开部署还持续消耗对方带宽配额。这条作为**事实**列进
  `legal-and-deploy.md` 的呈交材料，决定归用户。
- 版权取证照常逐资产：Sanity 上的图/视频是站主（或其客户）的内容资产，CDN 只是载体。

## 4. 关账 checklist（Sanity 场景）

- [ ] projectId / dataset / 内容烘焙时点（§0 三形态之一）钉入 `engine-notes.md`，判据留痕
- [ ] `--hosts` 含 cdn / api / apicdn 三主机；next/image 代理 URL 解码后计入 off-host 普查
- [ ] `auto=format` 魔数普查跑过（魔数 vs 扩展名 vs 账本三方对照），fetch profile 逐条入账；
      存量分叉已登记为偏差
- [ ] 变体阶梯从 srcset/flight 字节推导，直连 + 代理两层各自入账，对账 GAP=0
- [ ] 运行时拼接 API base 的改写落在服务层并登记；断网 fallback 查询有 query-keyed 应答，
      重试行为照抄
- [ ] `/studio` 等授权边界排除已登记；cdn robots 逐路径判定记录在案
- [ ] `_key` 未进 normalize 名单；ISR 纪元字段的 normalize 已逐字段登记
- [ ] 部署呈交材料含"内容仍在权利人账上"事实项
