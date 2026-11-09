# 声栞 · 交接档案

最后更新：2026-11-09

长期约定看 `AGENTS.md`，本文件看当前状态，改动看 `CHANGELOG.md`。

## 当前状态

| 项 | 状态 |
|---|---|
| 前端 | 可用。五个页面，项目持久化 |
| 导入 | 可用。拖拽或选择 `.txt / .md / .epub`，自动分章 |
| AI 分章 | 可用。MiMo `mimo-v2.6-flash`，规则认不出时兜底 |
| AI 标注 | 可用。角色、情绪、语速，可停止、续跑、逐章标注 |
| 角色页 | 可用。管理项目全部角色、绑定/解绑、清理无效角色 |
| 本章角色 | 可用。工作台右侧只显示本章角色，可添加/移除本章、不改项目角色 |
| 音频版本 | 可用。生成失败保留旧音频；每句最多 2 个，可切换回退 |
| 云音色 | 可用。小米预置、AI 试听设计、保存/删除、转本地克隆；预置不可删除/编辑 |
| 章节 | 可用。新建、重命名、删除、编辑原文、单章生成 |
| 成片导出 | 可用。Gradio 代理模式也支持 WAV / SRT / 分轨 ZIP |
| 生成 | 代码可用，但 **音色 wav 丢失**，需要恢复 `voices/*.wav` |
| 音色 | 当前只有 `meta.json`、`cloud.json` 和一条冰糖本地样本 |
| 项目数据 | `projects/.trash/` 里有 `p-mw7phvqs`（9 章 3 角色）和 `p-mw81gv9b`，需在回收站还原 |
| MCP | 可用。默认最近修改项目，支持 `project` 参数 |

## 事故说明

2026-11-08，清理文件时误删 D 盘，工程源码和 `voices/*.wav` 丢失。当前工程从 `D:\AI工作空间\声栞\声栞迁移包` 恢复初始版本，再按会话记录重建。

丢失且无法从代码恢复：

- `voices/voice_01.wav`、`voice_03.wav`、`voice_05.wav`、`voice_07.wav`、`voice_09.wav`、`voice_11.wav`
- `engine/outputs/*.wav`
- 之前的 41 章项目 `p-mw7nitpe`

`voices/meta.json` 已按实际听感重建，但没有音频文件时音色库为空。

## 启动

双击 `start.bat`。它会检查依赖、按需构建前端，然后启动 Electron。

开发：

```powershell
cd app
npm.cmd run dev
# 另一个终端
$env:SHENGKAN_DEV_URL="http://127.0.0.1:5173"
npx.cmd electron .
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
- 整本 AI 分两阶段：先拆台词，再逐章标注角色，仍会调用很多次
- 本地 IndexTTS 暂不支持单独调节语速；云 TTS 支持语气和语速
- 安装包模式下的 `voices` 路径还没验证，目前按源码目录运行
- 旧项目的错误角色不会自动清理，用「清理无效角色」或「整本 AI 重拆」
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
