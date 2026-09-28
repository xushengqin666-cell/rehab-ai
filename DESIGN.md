---
version: alpha
name: 康复AI (Rehab AI)
description: 移动端优先的康复训练与体态分析应用。诊所手工风：暖纸底、青绿主色、火柴人线稿品牌；数据可信、提示克制、触控友好。
colors:
  primary: "#0e7c66"
  primary-strong: "#0a5f4e"
  primary-soft: "#2ba48a"
  primary-container: "#e6f2ee"
  on-primary: "#ffffff"
  success: "#158a5c"
  success-strong: "#0f6f49"
  success-container: "#e7f4ee"
  warning: "#b45309"
  warning-strong: "#8a3f07"
  warning-container: "#fdf1e0"
  danger: "#c8443f"
  danger-strong: "#9e3838"
  danger-container: "#f0d9d5"
  ink: "#22262e"
  ink-strong: "#14181f"
  ink-muted: "#5c6472"
  surface: "#ffffff"
  surface-soft: "#fbfaf6"
  background: "#f6f4ef"
  background-alt: "#efece4"
  border: "#e7e2d7"
  border-strong: "#ded9cf"
  info-container: "#e7edf3"
typography:
  hero:
    fontFamily: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.02em
  display:
    fontFamily: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
    fontSize: 26px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  title:
    fontFamily: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
    fontSize: 20px
    fontWeight: 650
    lineHeight: 1.3
  title-sm:
    fontFamily: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.01em
  micro:
    fontFamily: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0.03em
  numeric:
    fontFamily: ui-monospace, "Cascadia Mono", Consolas, monospace
    fontSize: 20px
    fontWeight: 650
    lineHeight: 1.2
    fontFeature: "tnum"
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  xl: 22px
  pill: 999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  button-primary-pressed:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 10px
    height: 40px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-soft:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 14px
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 44px
  nav-item:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
  nav-item-active:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.primary-strong}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
  chip-filter:
    backgroundColor: "{colors.background-alt}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 8px
  chip-filter-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 8px
  badge-success:
    backgroundColor: "{colors.success-container}"
    textColor: "{colors.success-strong}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
  badge-warning:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.warning-strong}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
  badge-danger:
    backgroundColor: "{colors.danger-container}"
    textColor: "{colors.danger-strong}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
  badge-info:
    backgroundColor: "{colors.info-container}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
  stat-value:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-strong}"
    typography: "{typography.numeric}"
  chart-accent:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  banner-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px
  focus-ring:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
---

## Overview

诊所手工风（clinic handcraft），不是健身房的霓虹风，也不是通用后台的灰蓝风。

- **可信优先**：这是康复/体态类工具，数字与判定必须有"仪器感"。数值用等宽字（`numeric`，开启 `tnum`），单位与角度符号紧跟数字，不写无意义小数。
- **暖纸底**：背景用暖纸色而非纯白，卡片用纯白形成"贴在纸上的卡片"层次；这让长时间阅读的评估/报告页不刺眼。
- **单一强调色**：青绿 `primary` 是全应用唯一的行动色——主按钮、当前导航、进度、选中态都用它。语义色（成功/警示/危险）只用于状态，不做装饰。
- **触控友好**：所有可点区域高度 ≥ 44px，圆角随尺度放大（小件 8–12px，卡片 16px，胶囊与过滤片 999px）。
- **克制动效**：动效只用于"状态变化有因有果"（按下、切换、计数、警报），时长 120–320ms；跟随系统「减少动态效果」。

## Colors

暖纸中性色打底 + 青绿主色 + 三档语义色。**深色变体用于文字，亮色变体只做填充**。

- **Primary (#0e7c66)**：唯一行动色。主按钮填充、当前导航项、进度条、选中胶囊。按下态用 `primary-strong`。
- **Primary Soft (#2ba48a)**：图表与骨架线的高亮描边，仅用于图形，不做文字色。
- **Primary Container (#e6f2ee)**：选中行的浅底、当前导航项底色。
- **Ink (#22262e) / Ink Muted (#5c6472)**：正文与次要文字。`ink-muted` 对比度 ≥ 4.5:1（对 `background` 与 `surface` 都成立），可安全用于小字说明。
- **Success / Warning / Danger**：语义三元组，各有一个"文字用深色"（`*-strong`）与一个"填充用浅底"（`*-container`）。**危险文字一律用 `danger-strong`**，`danger` 只用于填充与图标——`danger` 对白底只有 4.4:1，小字不合格。
- **Border (#e7e2d7) / Border Strong (#ded9cf)**：分隔线与输入框描边；`border-strong` 用于需要被看见的分组边界。
- **Background (#f6f4ef) / Background Alt (#efece4) / Surface (#ffffff) / Surface Soft (#fbfaf6)**：四层纸面。卡片内再分区块用 `surface-soft`，不要用灰色叠加透明度。

## Typography

系统字体栈（中文优先 PingFang SC / Microsoft YaHei），**九级音阶**，不再出现 11.5px、12.5px、13.5px 这类半像素字号。

- **hero (40px/700)**：单页唯一的结论数字（如运动指数总分）。
- **display (26px/700)**：模块大标题、报告总分。
- **title (20px/650) / title-sm (17px/600)**：卡片标题与区块标题。
- **body (15px/400)**：正文与说明；中文行高 1.55。
- **body-sm (13px/400)**：卡片内正文、列表项——本应用使用频率最高的一级。
- **caption (12px/500) / micro (11px/600)**：标签、单位、导航文字；micro 用大写间距 0.03em 提清晰度。
- **numeric**：等宽 + `tnum`，用于次数、角度、评分、百分比、时间。**禁止**给数字用比例字距。

## Layout

4px 基准的间距音阶，页面横向留白固定 `md`。

- **间距音阶**：4 / 8 / 12 / 16 / 20 / 24 / 32。组件内边距用 `xs`–`md`，卡片之间用 `md`–`lg`，章节之间用 `xxl`。
- **页面**：左右留白 16px；底部导航为固定层，内容区必须预留导航高度 + `env(safe-area-inset-bottom)`（iOS 刘海屏/手势条）。
- **触控目标**：高度 ≥ 44px、间距 ≥ 8px；图标按钮即使视觉小，热区也要 44px。
- **栅格**：统计数值 2–4 列自适应（`minmax`），窄屏 2 列、宽屏 4 列；不使用固定列宽。
- **单列优先**：正文与表单永远单列，长页面用分组卡片而非分割线堆叠。

## Elevation & Depth

四档高度 + 两个专用光晕。阴影颜色统一取 `ink` 的透明度，**不要用纯黑阴影**。

- **e1 静止卡片**：`0 1px 2px rgba(34,38,46,.05)`
- **e2 悬浮卡片（默认）**：`0 1px 2px rgba(34,38,46,.05), 0 10px 28px rgba(34,38,46,.06)`
- **e3 弹窗 / 底部抽屉**：`0 4px 12px rgba(34,38,46,.08), 0 18px 44px rgba(34,38,46,.12)`
- **e4 顶部导航与提示条**：`0 1px 0 rgba(34,38,46,.06)`（贴边，不做悬浮感）
- **品牌光晕**：主按钮与其激活态 `0 4px 14px rgba(14,124,102,.28)`；危险警报脉冲 `0 0 0 0 rgba(209,74,74,.4)` → `0 0 0 12px rgba(209,74,74,0)`
- **毛玻璃**：仅用于底部导航与模态遮罩（`backdrop-filter: blur(...)`），正文卡片不用。

## Shapes

圆角表达"可点性"：越大越像容器，越小越像内容。

- **pill (999px)**：胶囊按钮、过滤片、标签、进度条端点。
- **xl (22px)**：媒体卡片、示范图容器。
- **lg (16px)**：主卡片（默认）。
- **md (12px)**：按钮、输入框、小卡片、列表项。
- **sm (8px)**：导航项、内嵌小块、二维码容器。
- **禁止**：一半圆角一半直角的混搭；相邻嵌套圆角必须外大内小（外层 `lg` 内层 `md`）。
- 火柴人品牌图形与线稿图标保持 1.8px 圆头描边，与文字同色（`currentColor`）。

## Components

组件只允许使用上面的 token，不得写死颜色、字号、圆角。

- **button-primary**：`primary` 填充 + `on-primary` 文字 + `md` 圆角 + 44px 高；按下用 `primary-strong` + 轻微缩放（`transform: scale(.98)`）。
- **button-ghost**：白底 + `primary` 文字 + `border` 描边，用于次级操作；危险操作改用 `danger` 文字 + `danger-container` 底。
- **card / card-soft**：`surface` + e2 阴影 + `lg` 圆角为默认卡片；卡内次级区块用 `surface-soft` + `md`，不叠阴影。
- **input-field**：44px 高、`md` 圆角、`border` 描边；聚焦时描边变 `primary` + 2px 焦点环，不改变布局（用 `box-shadow` 画环，不占位）。
- **nav-item / nav-item-active**：未选中 `ink-muted`，选中 `primary-strong` + `primary-container` 底。导航文字用 `micro`。
- **chip-filter / chip-filter-active**：过滤与标签选择；选中态为 `primary` 填充。
- **badge-***：状态标签一律"浅底 + 深字"；危险状态文字用 `danger-strong`，填充才用 `danger`。
- **stat-value**：`numeric` + `ink-strong`；单位与对比箭头用 `body-sm` + `ink-muted`，不要把单位写进数值字号。
- **banner-danger**：危险横幅用 `danger` 填充 + 白字（4.5:1 以上），仅用于"受伤风险警报"这类必须打断的场景。

## Do's and Don'ts

**Do**

- 新样式的每一个颜色/字号/圆角/间距/时长都从本文件取 token；取值不在 token 里时，先补 token 再写样式。
- 数字一律 `numeric`（等宽 + tnum）；角度、次数、百分比带单位且不写无意义小数。
- 状态色成对使用：`*-container` 底 + `*-strong` 字。
- 焦点态始终可见：`:focus-visible` + 2px `primary` 环，且不因 hover 消失。
- 新动效必须落在 120 / 200 / 320ms 三档内，并遵守 `prefers-reduced-motion`。

**Don't**

- 不新增半像素字号（11.5 / 12.5 / 13.5px）或第 20 种圆角；不改用本文件外的阴影。
- 不用 `primary` 当大面积背景，也不用语义色做装饰（成功色不用于"好看"，只用于"确实成功"）。
- 不给正文用 `danger`（对比度不达标时改用 `danger-strong`）。
- 不用纯黑阴影、不用透明度叠加来做灰阶（用 `ink-muted` / `border` / `surface-soft`）。
- 不写"点击这里"这类无信息量的按钮文案；按钮文案是动词（开始分析 / 记训练前疼痛 / 导出报告）。

## 校验

```bash
npx -y -p "@google/design.md" designmd lint DESIGN.md      # 结构 + 断链 + WCAG 对比度
npx -y -p "@google/design.md" designmd export --format css-tailwind DESIGN.md   # → CSS 变量
npx -y -p "@google/design.md" designmd diff DESIGN-v1.md DESIGN-v2.md           # 改版前后 token 回归
```

当前状态：`errors 0 / warnings 2`。两条警告都是 `colors.border` 与 `colors.border-strong`
被判为「孤立 token」——**这是格式的已知局限**，不是遗漏：组件的合法属性只有底色与文字色，
描边色在本格式里没有位置。它们仍是本设计系统的正式 token，用于输入框描边与分组边界。
除此之外该文件不含任何其他提示，全部组件的底色/文字对通过 WCAG AA。

