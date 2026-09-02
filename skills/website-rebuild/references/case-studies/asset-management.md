# case-studies/asset-management.md — 资产管理：镜像即唯一资产库，不复制策略 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `asset-management.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `asset-management.md` 一一对应。

## 1. 选型：先量体量，再看构建器

规则见 `asset-management.md` §1。

- **资产体量**：百 MB 级资产**必须走不复制路线**（samsy 238MB、lando 37MB/508 文件都没有进源码树）；十几 MB 也建议不复制（kimi 15MB 用符号链接，"源站字节不复制两遍"）。

## 2. 六种做法（六个项目各一种，按代际排列）

规则见 `asset-management.md` §2。

| 做法 | 项目 | 要点 |
|---|---|---|
| ① 全量复制 + 哈希验证 | 【rogier】 | `public/` 与源站逐字节一致，且真的验证过：116 个非视频文件 byte-identical、23 个视频 size 匹配、3 个不一致的 png 替换为源站字节；约 111MB 媒体直接进 git，部署只上 `dist/`。**一代做法，后代全部演进为不复制** |

## 3. 配套机制：CDN 跨域引用与服务层改写

规则见 `asset-management.md` §3。

- **一代反例**：rogier 直接改磁盘 bundle（禁 service worker、detect-gpu benchmarks 本地化），但把每处重写登记在案（PHASE1_AUDIT "Known local JS rewrites"）并在对比时扣除——后代演进为"干脆不改磁盘"【rogier】。若被迫改磁盘，必须照此逐处登记。

## 4. 分层细则：轻资产可入库，重资产必不复制

规则见 `asset-management.md` §4。

kimi 的"省力路径"同理【kimi】：美术资产直接复用镜像；职位数据、i18n、metadata 从 bundle 抽成 JSON——"自己只重写编排层"。第三方在线依赖也可本地化进运行资产（rogier 把 detect-gpu 的 unpkg benchmarks 本地化到 `public/vendor/detect-gpu/`）【rogier】，但改写 bundle 指向它的每一处都要登记（见 §3 一代反例）。

## 4.5 移动端变体：规则要逆向，不要猜

规则见 `asset-management.md` §4.5。

移动端资产往往是同名变体，命名规则藏在 bundle 里，必须逆向出来再补抓：oryzo 逆向出 `properties.getMobileUrl(url)` 在扩展名前插 `_MOBILE`、纹理上限 800px vs 桌面 2560px【oryzo】——静态爬取漏掉的 16 个移动端专属文件正是靠真实运行路径 404 才暴露、再从源站补录的【oryzo】。lando 的镜像同样含桌面 webp + 移动 ktx2 双端纹理变体（后补提交）【lando】。

## 5. 资产保真细则（复用镜像时逐条执行）

规则见 `asset-management.md` §5。

- **逐字节一致才算复用**：rogier 镜像漏抓的字体补齐后，验证二进制与源 `/fonts/*` 逐字节一致——About 页的排版差异正是靠这个定位的【rogier】。
- **模型原样使用，不做归一化**：`me.gltf` 不做旋转翻转/包围盒归一化——模型自带 31.17 的内在 scale，是行为的一部分【rogier】。

### 6.2 自托管字体：默认照抄原件，拒绝"顺手优化"

规则见 `asset-management.md` §6.2。

kimi 的"4.8MB 像素字体不子集化"决策是偏差登记的范本（全项目最完整的一次决策记录）【kimi】。字体含 35,825 字形而全站只用 538 个汉字，可压四十余倍，但拒绝子集化的五条理由按杀伤力排序：
