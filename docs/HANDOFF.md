# 声栞 · 交接档案

最后更新：2026-11-11

长期约定看 `AGENTS.md`，本文件看当前状态，改动看 `CHANGELOG.md`。

## 当前状态

| 项 | 状态 |
|---|---|
| 前端 | 可用。五个页面，项目持久化 |
| 导入 | 可用。拖拽或选择 `.txt / .md / .epub / .docx`，自动分章 |
| AI 分章 | 可用。可选小米 / 千问百炼 / DeepSeek / 自定义，只识别章节，不分析角色 |
| AI 服务 | 可用。文本 AI / TTS AI 分开配置；文本、千问 TTS、自定义 TTS 可获取云端模型列表 |
| AI 标注 | 可用。整章一次发送并开启思考，右栏实时显示思考过程；可停止、逐章/整本标注 |
| AI token | 可用。分章、重拆、标注结束显示输入/输出/缓存/总计 |
| 角色页 | 可用。管理项目全部角色，音色按左侧选中角色绑定/取消绑定；重复 id 加载时自动去重 |
| 本章角色 | 可用。工作台右侧只显示本章角色，可添加/移除本章、不改项目角色 |
| 工作台 | 可用。顶栏「AI分析」二级菜单；顶部推荐流程；「生成配音」 |
| 语音引擎 | 可用。优先 TTS 地址 / Gradio API；本机 Python 收在高级项；状态区分在线和模型已加载 |
| 音频版本 | 可用。生成失败保留旧音频；每句最多 2 个，可切换回退 |
| 批量生成 | 可用。全云 3 并发、混合 2 并发、全本地串行；有「未生成/全部/取消」 |
| 试听 | 可用。单句 / 连续切换；中文导出文件可正常播放；播放条支持拖动和 0.5-3.0 倍速 |
| 云音色 | 可用。小米 MiMo + 千问 TTS（DashScope）+ 自定义 OpenAI 兼容 TTS；设计音色卡、加入本地音色库 |
| 音色历史 | 可用。每个角色记录用过的音色，可单条移除 |
| 章节 | 可用。新建、重命名、删除、编辑原文、单章生成 |
| 成片导出 | 可用。按章节 / 整本单轨 / 整本分章节 ZIP；时间轴按全章顺序估算，悬停看句子和时间；历史保存在本地 |
| 整本编辑 | 可用。项目库右键 → 编辑整本：只拆章节 / 角色标注+情绪+语速 |
| 界面 | 可用。2026-11-11 改为浅色编辑室，支持日间/夜间主题；项目库为书封视图 |
| 生成 | 代码可用，但 2026-11-08 丢失的原始参考音频仍需补齐 |
| 音色 | `meta.json`、`cloud.json` 和 7 条本地样本 |
| 项目数据 | 活动项目 `p-mw91apwo`（20 章）；`projects/.trash/` 里还有 `p-mw7phvqs` 和 `p-mw81gv9b` |
| MCP | 可用。依赖已安装，支持 `list_projects`、读写、生成、审计；权限四档，默认 generate；OpenCode 需重启后重新连接 |
| 日志 | 可用。`%APPDATA%/shengkan/logs/app.log`，5 MB 轮转，保留 1 份备份，设置页可清空 |
| Git | 已初始化。`main` 已合并 `optimize/next-2`；当前 UI 重构分支 `design/ui-refresh` |

## 事故说明

2026-11-08，清理文件时误删 D 盘，工程源码和 `voices/*.wav` 丢失。当前工程从 `D:\AI工作空间\声栞\声栞迁移包` 恢复初始版本，再按会话记录重建。

丢失且无法从代码恢复：

- `voices/voice_01.wav`、`voice_03.wav`、`voice_05.wav`、`voice_07.wav`、`voice_09.wav`、`voice_11.wav`
- `engine/outputs/*.wav`
- 之前的 41 章项目 `p-mw7nitpe`

`voices/meta.json` 已按实际听感重建，但没有音频文件时音色库为空。

## 启动

双击 `start.bat`。它会检查依赖、按需构建前端，然后启动 Electron。

Git 工作流：

```powershell
git switch design/ui-refresh  # 当前 UI 重构分支
git status
git add -A
git commit -m "feat: 说明改了什么"
```

`main` 保留稳定基线；功能分支合并回 `main` 前先跑构建。

开发：

```powershell
cd app
npm.cmd run dev
# 另一个终端
$env:SHENGKAN_DEV_URL="http://127.0.0.1:5173"
npx.cmd electron .
```

工作台回归检查（需要先能启动 Electron）：

```powershell
cd app
npm.cmd run check:studio
```

## 配置

`engine/config.json`：

```json
{
  "mode": "gradio",
  "gradioUrl": "http://192.168.3.68:7860",
  "gradioApi": "gen_single",
  "voiceLib": "",
  "python": "",
  "indexttsCodeDir": "",
  "indexttsModelDir": ""
}
```

设置页可以改，保存后重启生效。环境变量 `GRADIO_URL` / `GRADIO_API` / `VOICE_LIB` 可临时覆盖。

## 数据

| 数据 | 位置 |
|---|---|
| 项目 | `projects/<项目名>/project.json` |
| 项目回收站 | `projects/.trash/` |
| 生成音频 | `engine/outputs/*.wav` |
| 参考音频 | `voices/*.wav` + `voices/meta.json` |
| 设计音色 | `voices/cloud/*.wav` + `voices/cloud.json` |
| 引擎配置 | `engine/config.json` |
| AI 配置 | `%APPDATA%/shengkan/ai.json` |
| 开发日志 | `%APPDATA%/shengkan/logs/app.log` |
| MCP 审计 | `mcp/data/audit.jsonl` |

## 已知限制

- 音色 wav 丢失，生成前必须恢复参考音频
- 之前的 41 章项目丢失
- 整本编辑在项目库右键「编辑整本」；重拆章节是规则、不调用 AI，角色标注会调用很多次 AI
- 规则拆分为了不出假名字，只保留全书出现 2 次以上的人名；单次出场的小配角会先标成「未知」，用 AI 标注补回
- 规则重拆只按原文文字精确匹配保留旧标注；改过标点或文字的句子会按新结果重建，需要重新 AI 标注
- 跨段续句会合并成一句旁白，`paragraph` 取第一段，切原文时高亮句子开头所在段
- 云 TTS 已接入小米 MiMo、千问 TTS（DashScope）和自定义 OpenAI 兼容服务；DeepSeek 目前只用于文本分析
- 模型列表依赖服务商 `/models`；不提供或无法区分文本/TTS 时显示全部，仍可手填
- 深度思考开关只对 MiMo 等支持 `thinking` 的服务商生效；其他服务商不传该字段，有 reasoning_content 时仍会显示
- 云端生成并发默认 2，失败后串行重试并留 700ms 间隔；仍失败会在本次生成卡片里显示数量
- 连续试听只播有音频的句子；没有音频的句子会跳过并继续
- 标注思考最长等待 30 分钟；超时或失败会保留思考过程和错误提示
- 自定义文本 AI 的思考强度只在勾选后发送 `reasoning_effort`；不勾选使用模型默认，TTS 不参与
- 整章标注超过 220 句或 6 万字符会分段，段间带前后各 8 句上下文；每段独立判断，跨段指代可能丢失
- MCP 权限由启动环境变量 `SHENGKAN_MCP_PERMISSION` 控制，默认 generate；应用内只能查看说明
- 旧项目里两个角色已经绑到同一个音色时，需要手动解绑一个；重复 id 会在加载时去重
- 开发日志 5 MB 轮转，保留 1 份备份；设置页可清空
- 给 AI 书名是合理的上下文，但没有自动联网搜索角色名；AI 只结合自身已知信息和原文
- 语速范围 0.5-2.0；云 TTS 用自然语言指令，本地 IndexTTS 用 `duration_factor`
- 成片历史只记录本机导出结果，不会同步到别的机器
- 主题选择只保存在本机 `localStorage`，换机器或清缓存后回到日间
- 安装包模式下的 `voices` 路径还没验证，目前按源码目录运行
- 旧项目的错误角色不会自动清理，用「清理无效角色」或整本角色标注
- 远端 WebUI 关掉后生成报连接失败
- `release/` 里的安装包是旧构建

## 待办

1. 恢复 `voices/*.wav` 参考音频
2. 重新导入之前那本书，或恢复 41 章项目
3. 确认后删除无引用的 `app/src/data.ts`、`app/src/defaultVoices.ts`
4. 重新构建安装包，并验证安装版 `voices` / `engine/outputs` 路径
5. 应用图标
6. MCP 修改后界面实时刷新
7. 暂停/继续生成
