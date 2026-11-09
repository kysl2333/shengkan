# 声栞

本地 AI 配音工作台。把小说、剧本拆成多角色台词，按角色匹配音色和情绪，生成音频，最后合成整章。

## 目录

```
声栞/
├─ design/preview.html   静态视觉稿
├─ app/                  Electron + React 桌面应用
│  ├─ src/               页面、组件、导入解析、AI 桥接
│  └─ electron/          主进程、项目读写、引擎管理、AI 调用、日志
├─ engine/               IndexTTS 本地引擎 + 远端 Gradio 代理
├─ mcp/                  MCP 服务器
├─ projects/             项目文件夹
├─ voices/               参考音频 + meta.json
├─ docs/                 设计决策、开发日志、交接档案
├─ AGENTS.md             长期约定，AI 和接手的人先读
├─ CHANGELOG.md          改动记录
├─ start.bat             启动入口
└─ README.md             本文件
```

## 启动

双击 `start.bat`。它会检查依赖、按需构建前端，然后启动 Electron。

开发模式：

```powershell
cd app
npm.cmd run dev
# 另一个终端
$env:SHENGKAN_DEV_URL="http://127.0.0.1:5173"
npx.cmd electron .
```

## 版本管理

仓库主分支是 `main`，日常优化在 `optimize/next`。

```powershell
git switch optimize/next
git status
git commit -am "fix: 说明改了什么"
```

不提交 `projects/`、`voices/`、`engine/outputs/`、`mcp/data/`、`node_modules/`、`dist/`、`release/`。每次提交前同步 `CHANGELOG.md` 和 `docs/DEVLOG.md`。

## 已实现

### 导入

- 拖拽或选择 `.txt / .md / .epub / .docx`
- EPUB 按目录锚点分章，DOCX 按段落提取正文，过滤版权页、目录、制作信息
- TXT 自动识别 UTF-8 / UTF-16 / GBK
- 导入前预览章节、字数、预计句数
- 「合并 800 字以下短章」

### AI

- AI 分章：MiMo `mimo-v2.6-flash`，只识别章节，不分析角色，可停止、复用上次结果
- AI 角色提取：过滤作者、插画、制作信息等非人物，支持中/英/日说话标记
- AI 重拆本章：规则拆句 → AI 分析角色 → 标注角色、情绪、语速
- 整本编辑在项目库右键：「整本重拆章节」只拆章节不动角色；「整本角色标注 + 情绪 + 语速」逐章处理
- AI 标注按 60 句分批，可停止、可续跑
- 提示词可在设置页查看、编辑、恢复内置

### 工作台

- 台词双击编辑，回车保存，自动标 dirty
- 勾选生成、单句生成、整章生成、停止生成
- 换角色、新建角色、插入台词、删除台词
- 章节新建、重命名、删除、编辑原文、单章生成
- 系统语音临时试听
- 真实播放条：暂停、拖动进度、倍速
- 批量生成只跑待生成或改动过的句子

### 角色和音色

- 角色来自项目 `casts`，跨章节共享
- 新建、重命名、右键删除、清理无效角色
- 音色绑定、播放/暂停
- 音色显示名和描述来自 `voices/meta.json`
- 云音色可转本地克隆：样本复制到 `voices/<名字>-<id>.wav`，绑定后走 IndexTTS
- AI 设计音色：先生成试听，满意再保存；保存后进入云音色，点「本地克隆」才进本地音色
- 云音色和本地音色都可以删除，文件移到 `voices/.trash`；预置云音色不能删除或改名
- 角色页管理整个项目的角色；工作台右侧只管理本章角色
- 音色按钮只作用于左侧当前选中的角色：云/本地都叫「绑定到角色」，再点取消绑定
- 「加入本地音色库」只复制样本，不绑角色；到本地音色卡再绑定
- 音色名称和介绍在同一个编辑弹窗里修改
- 每句台词最多保留 2 个音频，可切换回退；生成失败保留旧音频
- 音色库按分类分组，字体整体加大；窗口缩放 1.3

### 项目

- 项目右键：打开、重命名、移到回收站
- 回收站：还原、彻底删除
- 删除台词/章节、重新拆分时删除被替换的旧音频
- 成片页可按章节导出整轨 WAV、SRT 和分轨 ZIP

## 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | 引擎状态 |
| GET | `/v1/voices` | 扫描音色库 |
| GET | `/v1/voice-audio?path=` | 播放参考音频 |
| POST | `/v1/split` | 规则拆分台词 |
| POST | `/v1/tts` | 生成音频 |
| POST | `/v1/merge` | 按句拼接音频 |
| POST | `/v1/export` | 导出整轨 WAV / SRT / 分轨 ZIP |
| POST | `/v1/audio-delete` | 删除生成的音频 |
| GET | `/v1/audio/{name}` | 播放生成的音频 |

MCP 工具和客户端配置见 `mcp/README.md`。

## 已知限制

- 2026-11-08 D 盘误删事故后，`voices/*.wav` 丢失，当前只有 `voices/meta.json`，生成前需要恢复参考音频
- 之前的 41 章项目丢失；`p-mw7phvqs` 和 `p-mw81gv9b` 目前在 `projects/.trash/`，需要在回收站还原
- 整本 AI 拆台词和逐章标注仍会调用很多次，耗时长、消耗 token
- 本地 IndexTTS 暂不支持单独调节语速，语速按钮只对云 TTS 生效
- 旧项目的错误角色需要「清理无效角色」或整本重拆
- `release/` 里的安装包是旧构建
- 应用图标还是 Electron 默认
