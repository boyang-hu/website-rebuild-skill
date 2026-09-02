# case-studies/sanity-platform.md — Sanity CMS 场景（Next/Nuxt 创意站的主流内容层） 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `sanity-platform.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `sanity-platform.md` 一一对应。

## 0. 指纹与判级：Sanity 本身不定级，内容烘焙时点才定级

规则见 `sanity-platform.md` §0。

- 图片：`https://cdn.sanity.io/images/<projectId>/<dataset>/<sha1-40>-<W>x<H>.<ext>[?w=&h=&fit=&auto=format…]`
  （basement=`9syto90m`、hashgraphvc=`diak0tmr`、franshalsmuseum=`r35o2ddl`；dataset 常为 `production`）

⭐ **文件名自带元数据**：`<sha1>-<W>x<H>` 里的 WxH 是**源资产内在尺寸**（查询参数只做缩放裁剪），
sha1 是内容地址——"多少个不同图"的清点、变体归并、资产去重对账，直接按 hash 段做
（basement：13,870 条响应式引用按 hash 收敛成 722 个源资产）【basement】。

## 1. 镜像层

### 1.1 `--hosts` 清单（CDN 站假 GAP=0 的老课，Sanity 版）

规则见 `sanity-platform.md` §1.1。

netcapture / mirror-site 的外部主机清单必含（按站取舍）：`cdn.sanity.io`、
`<projectId>.api.sanity.io`、`<projectId>.apicdn.sanity.io`。hashgraphvc 实例：
`--ext-hosts cdn.sanity.io,diak0tmr.api.sanity.io`【hashgraphvc】。

### 1.2 ⛔ `auto=format` 是内容协商：裸 fetch 与浏览器拿到的是两种字节

规则见 `sanity-platform.md` §1.2。

实证【basement，D5 全量定案】：魔数普查 391 个 `@@auto=format` 变体，59 个扩展名↔魔数
分叉（56 `webp→jpeg`、3 `webp→png`——webp 源被转码回退，如 `…-1920x833@@auto=format
&w=1200.webp` 魔数 JPEG）；**双 Accept 采样 6/6 全分叉**——jpg/png 源在浏览器 Accept
下同样返回 webp（645KB png→54KB、**1.13MB png→61KB**）。即**分叉面是全部栅格变体，
不止扩展名穿帮的那 59 个**：魔数普查只看得见协商跨过扩展名边界的尖角，量化全貌必须
双 Accept 采样。三个配套事实：

- **浏览器协商结果是一个分布，不是一种格式**：14islands 616 变体 604 webp / 4 avif / 8 png；
  basement 全量重抓 391 变体 **311 webp / 79 avif** / 1 svg（3840×2160 大图多，avif 份额
  随站与资产尺寸变）——basement 采样 6 全 webp 曾让"未见 avif"成为论断，样本放大即修正
  【14islands】【basement】。

实测 391/391、217MB→39.5MB、新树五项全绿（项目侧 `scripts/regrab-negotiated.mjs` 可参照）。

## 4. 开工速查卡：Next + Vercel + Sanity 创意栈

规则见 `sanity-platform.md` §4。

（遥测，通常 D5 登记不抓）。⚠ **预设不会自己进命令行**——14islands 实测：本卡写着
mux 族，netcapture 命令里漏传，断网 sweep 才在 100/100 路由上把它报出来。开工时把

**运行时资源族清单**（BFS 看不见、netcapture/推导要补的；⭐ **能从字节推导的先推导，再拿
netcapture 对账**——14islands 实测：webpack runtime 的 `h.u`（chunk id→hash 表）+ `h.miniCssF`
+ `_buildManifest` 推出 28 chunk + 11 css + 9 页 chunk，其中 28 条是预览分支的死 chunk，任何路由
都跑不到；`_next/data/<buildId>/<route>.json` 按路由表推导 98 条得 95）：`?_rsc=` 预取载荷、
