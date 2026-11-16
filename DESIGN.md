---
version: alpha
name: 声栞
description: 本地 AI 配音工作台，浅色纸白编辑室，支持日间与夜间主题。
colors:
  canvas: "#F4F2EC"
  surface: "#FFFFFF"
  surface-2: "#FAF9F5"
  surface-3: "#EFEDE6"
  line: "#E3DFD5"
  ink: "#1D211D"
  ink-2: "#525950"
  ink-3: "#666D63"
  accent: "#2F6B57"
  accent-soft: "#E9F1EC"
  on-accent: "#FFFFFF"
  brass: "#A9763C"
  brass-text: "#8F5F2E"
  danger: "#B24A35"
  ok: "#3D7A63"
  sheet: "#FFFFFF"
  cover-green: "#2F6B57"
  cover-red: "#A94F38"
  cover-ochre: "#9A6A30"
  cover-slate: "#465A6B"
typography:
  sans:
    fontFamily: Noto Sans SC
    fontSize: 13.5px
    lineHeight: 1.6
  serif:
    fontFamily: Noto Serif SC
    fontSize: 19px
    lineHeight: 1.95
  mono:
    fontFamily: Cascadia Mono
    fontSize: 10px
    lineHeight: 1.6
---

## Overview

声栞把小说和剧本变成多角色有声剧。界面的工作是让人长时间读稿、改一句、只重跑改动过的句子。

视觉方向是「日间编辑室」：工作台是纸灰色，文稿是桌面上的白纸，章节是书脊，播放头是黄铜。界面给阅读让路，操作只在需要时出现。默认日间，可切到夜间；夜间不是反相，仍是同一间编辑室。

## Colors

- 装订绿只承担操作和当前状态：主按钮、当前章节、当前角色、成功。
- 黄铜只承担时间和改动：播放头、当前句、待更新。
- 朱砂只承担错误和删除，不做普通强调。
- 文稿正文使用 `{colors.ink}`，纸张使用 `{colors.sheet}`；工作台底色使用 `{colors.canvas}`，让文稿和桌面分开。
- 一个视图只保留一个主色。书封颜色属于内容，不算界面强调色。

## Themes

夜间主题沿用同一组语义 token，值如下。切换即时生效，选择记忆在本地；首次进入使用日间。

| Token | 日间 | 夜间 |
|---|---|---|
| canvas | `#F4F2EC` | `#111412` |
| surface | `#FFFFFF` | `#191D19` |
| surface-2 | `#FAF9F5` | `#1F241F` |
| surface-3 | `#EFEDE6` | `#262C26` |
| line | `#E3DFD5` | `#2D342D` |
| ink | `#1D211D` | `#E8E9E1` |
| ink-2 | `#525950` | `#B0B6AB` |
| ink-3 | `#666D63` | `#858D82` |
| accent | `#2F6B57` | `#93C4AC` |
| accent-soft | `#E9F1EC` | `rgba(147, 196, 172, 0.12)` |
| on-accent | `#FFFFFF` | `#10211A` |
| brass | `#A9763C` | `#D6A268` |
| brass-text | `#8F5F2E` | `#E0B27A` |
| danger | `#B24A35` | `#E08A75` |
| ok | `#3D7A63` | `#8CC5AB` |
| sheet | `#FFFFFF` | `#171B17` |

主按钮在夜间使用深色文字落在浅绿底上；不要在两个主题里都写白字。

## Typography

- 界面使用 `{typography.sans}`；正文保持短行，长说明使用 `text-wrap: pretty`。
- 台词和页面标题使用 `{typography.serif}`；台词行高固定为 1.95，保证连续阅读。
- 时间码、参数、统计数字使用 `{typography.mono}`，并开启等宽数字。
- 标题使用 `text-wrap: balance`，不要额外加大字距。

## Layout

顶栏 60px；工作台左侧章节树 232px，中间文稿最大 860px，右侧参数栏 372px，底部播放条 66px。文稿必须从工作台底色中露出来，不能铺满中间列。项目库是一排书封，不是等宽卡片墙。

以上为 CSS 尺寸，桌面默认整体缩放 0.9。工作台中栏不超过 540px 时角色名放在正文上方；不超过 440px 时播放器分两行，波形独占一行并允许播放条增高。宽中栏保留角色名与正文并排。长角色名、连续英文和网址允许换行，不撑出稿纸。

## Elevation & Depth

只允许两种深度：文稿和弹窗的轻阴影，以及悬停卡片抬起的 2px。禁止全屏毛玻璃、发光和装饰性渐变。分隔优先用 1px 边线或表面色差。

## Shapes

控件使用小圆角，文稿、面板和书封使用较大圆角；同一层级不要混用不同圆角。台词行保持直角，标签使用更小的圆角。

## Components

- 按钮默认没有边框。主操作使用装订绿填充，普通操作使用浅绿底，次级操作只改文字颜色；删除操作默认收敛，悬停才变朱砂。
- 输入框保留 1px 边线和聚焦绿环，是少数需要明确边界的控件。
- 当前项使用 2px 装订绿或黄铜线加极浅底色，不用整块深色高亮。
- 项目卡使用书封：平涂封面色、竖排书名、左侧书脊；悬停只抬起 2px。

## Do's and Don'ts

- Do 用表面色差和 1px 边线建立层级。
- Do 保持一个视图只有一个主色；绿色是操作，黄铜是时间，朱砂是危险。
- Don't 使用渐变、发光、紫色或全屏 `backdrop-filter`。
- Don't 给按钮加默认边框；需要边界时用底色。
- Don't 用动画 `width`、`height` 或 `letter-spacing` 制造效果。
