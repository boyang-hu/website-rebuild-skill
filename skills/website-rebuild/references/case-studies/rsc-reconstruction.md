# case-studies/rsc-reconstruction.md — RSC 重构式逆向(C1)— flight 载荷到可构建源码 的实证记录

> **何时加载本文件**：不在必经集合里。只在想知道 `rsc-reconstruction.md` 某条规则**为什么存在**、或要核对它的实证强度时读；章节号与 `rsc-reconstruction.md` 一一对应。

## §1 坐标系:flight 流(C1 的 `_pretty/`)

### §1.1 flight 是保真神谕(比 DOM 更细的证据面)

规则见 `rsc-reconstruction.md` §1.1。

1. ⭐ **键序 = JSX prop 序**。flight 按源码 prop 顺序序列化,两侧键序不同 =
   你的 prop 写序和作者不同(实测靠它照出脚注反链的 href/className/id 顺序)。

4. ⭐ 标题文本尾空格 + 独立 id 锚 → 还原 `## 标题 [#custom-id]` 源约定
   (99/101 个标题带作者自选 id,剥离 `[#id]` 后的空格就是化石)。

5. ⭐ **作者的不一致本身是保真面**:同站两篇脚注一有 `"\n"` 分隔一没有、
   一页整个忘写 metadata、og:title 写错——照抄,不"修好"。线上 bug 也一样
   (对活源站复测是最强豁免证据)。

## §3 重构工程(rebuild/ = 可构建的 Next 工程)

### §3.2 CSS 面:tailwind 扫描面与 token 必须对着镜像编译 CSS 对账【basement】

规则见 `rsc-reconstruction.md` §3.2。

语义门只看 flight 树,**看不见 CSS**——重建工程的样式面是独立债务,且塌法极具
迷惑性:白色 SVG logo 因 `text-*` 未生成变黑底黑字"消失"、grid 塌成换行、
自定义字体回退系统 sans、reveal 幕布类缺失导致整页盖黑(machine 模式黑屏
= `.machine-reveal` 只有 keyframes 没有类规则)。四轮用户实测报障同一根因:

3. ⭐ **carry-css 方法论**(tailwind 生成不了的规则,机器搬运不手抄):
   需求面 = 代表路由 SSR DOM 类名并集——**必须覆盖每个路由家族,含备用
   模式家族**(basement 的 /ai 机器可读镜像有独立配色与幕布,漏采样 = 该
   家族类全缺);减去构建产物已有的类;剩余到镜像 CSS 逐条找规则原文搬运:

4. **镜像里也无规则的类 = 源站自身死类**(`bg-brank-k` 拼写错、`text-caption`
   等 16 个实测)——照抄不修(§1.3),报告里点名即可。

### §3.5 next/image 优化器产物是像素门的一层资产【darkroom】

规则见 `rsc-reconstruction.md` §3.5。

镜像侧持有的是 **Vercel 优化器的输出**（`/_next/image?url=…&w=1440&q=…`,实测 naturalWidth 1280);
重建的静态树没有优化器,serve 回落到原图(2592 宽)——两侧源分辨率不同,浏览器重采样差就是
looped/badomens 0.2 的残差。两件事分开做:① `images.deviceSizes/imageSizes/qualities` 从镜像
srcset 普查**反推**进 next.config(⚠ `qualities` 默认 `[75]` 会把源站的 `quality=90` 静默压回 75);
② `tools/harvest-optimized-images.mjs` 把静态树引用的全部 `/_next/image` 档位补齐——**镜像字节
优先**(源站发了什么才是参照,动态图片生成器只拿得到输出字节,§6),镜像没有的档位才向本机
`next start` 的优化器取并登记为重建侧生成物(darkroom:镜像 55 + 本机 936 → 0.00)。

## §5 平台层工件(登记,不复刻)

规则见 `rsc-reconstruction.md` §5。

- ⭐ **Vercel 边缘把 / 重写到 /index**:镜像首页 `c:["","index"]`、SSR 里
  usePathname 撞见 "/index"(Logo 渲染成回链)、客户端水合撞 "/" → **线上的
  React #418 就是这么来的**。静态预渲染侧 `c:["",""]`、无水合错误——登记
  D 类偏差;要逐字节复刻线上 bug 得加边缘重写,通常不值得。
