# 开发记录

## 2026-11-09 · 代码审查和 Bug 修复

### 完成

- 去掉生成前删除当前音频的逻辑，失败不再丢旧音频
- 音频历史统一由 `nextAudio` 处理：保留当前 + 1 个历史
- 修复残留的 `window.prompt`（说话人菜单新角色）
- 本章角色解绑改为按名字；「未知」「旁白」不再显示无意义操作
- 删除音色时解绑所有绑定角色
- 编辑音色名同步角色显示
- 本地样本按 id 后缀查找，云音色改名不再丢本地克隆
- 预置云音色隐藏编辑/删除，后端拒绝删除预置
- 工作台 `script` 跟随当前章节 `lines` 同步，整本 AI 后不再显示旧台词
- 成片页改为真实章节选择、真实质检、真实导出设置
- `node-server.mjs` 新增 `/v1/merge` 和 `/v1/export`，配套 `engine/wav.mjs`
- 本地模式传递 IndexTTS 路径；`server.py` 默认音色库改为项目 `voices`
- 音色名取消 14 字截断
- 清理 `Cast`、云设计、`api`、`ai`、`import`、工作台、成片、设置页的死代码和假 UI

### 验证

- `npm.cmd run build` 通过
- `tsc --noUnusedLocals --noUnusedParameters --noEmit` 无报错
- `/v1/merge`：2 个云 TTS 样本合成 4.2 秒 WAV，24 kHz
- `/v1/export`：3 句 → 9.14 秒 WAV、SRT 时间轴正确、分轨 ZIP 可解压
- `readWav` 读回导出文件：24 kHz、219360 帧、峰值 0.980

### 坑

- `deleteAudio` 在生成前调用是破坏性操作：一旦 TTS 失败，旧音频和历史记录都会失效
- `nextAudio` 依赖当前音频仍然存在，不能再提前删除
- 本地样本文件名带名字，改名后不能用 `localSample(name, id)` 重新拼路径，必须按 id 查找
- `Master` 的 `/v1/export` 在 Gradio 代理模式没有实现，必须补后端，否则按钮永远 404
- 工作台 `script` 是本地 state，`project` 更新不会自动同步，必须监听当前章节 `lines`

## 2026-11-09 · 项目角色 / 本章角色分离

### 完成

- 角色页负责项目全部角色；工作台右侧只显示本章角色
- 工作台「添加角色」从项目角色选择或新建，并插入一条该角色台词
- 工作台「移除本章」只把本章台词改成「未知」，不删除项目角色
- 绑定音色先弹角色列表，不再默认绑当前角色；角色页增加解绑
- 绑定状态统一用 `castVoiceLabel`，云绑定不再显示「未配音」
- 云音色和本地音色分开；本地克隆复制到 `voices/<名字>-<id>.wav`
- 音色名称/介绍可编辑，删除移到 `voices/.trash`
- 每句最多 2 个音频，行内 `⇄` 切换
- 整本 AI 分「拆台词」和「逐章标注角色」两个阶段
- 图片解析跳过 `img/figure/figcaption`
- 全局缩放 1.25，字号整体加大
- 音色库按分类分组

### 验证

- `npm.cmd run build` 通过（35 modules，427.86 kB）
- 云音色 `materialize` 复制到 `voices/冰糖-mimo-bingtang.wav`，本地列表显示
- `/v1/voice-update` 修改名称/介绍成功
- `/v1/voices` 不再返回 `cloud/` 路径

### 坑

- Electron 的 `window.prompt` 返回 null，所有输入必须用 `askText`
- 只判断 `voicePath` 会把云绑定误判成「未配音」，要同时看 `cloudName/cloudVoice`
- 角色页所有卡片都有背景色，看起来像多选；当前角色要单独加标记和高亮

## 2026-11-08 深夜 · 灾难恢复

### 背景

- 清理文件时误删 D 盘，`app/src`、`app/electron`、`engine`、`docs`、`mcp`、`design`、`voices` 丢失
- 从 `D:\AI工作空间\声栞\声栞迁移包` 恢复初始版本，再按会话记录重建
- 保留现有 `projects` 和 `app/node_modules`，没有删除任何用户数据

### 恢复过程

- 复制迁移包的 `app/electron`、`app/src`、`design`、`docs`、`engine`、`mcp`、`README`、`start.bat`
- `npm install jszip`，补回 Electron dist（`node node_modules/electron/install.js`）
- 重建 `ai.cjs`、`log.cjs`、`config.cjs`、`main.cjs`、`preload.cjs`、`projects.cjs`、`engine.cjs`
- 重建 `ai.ts`、`log.ts`、`config.ts`、`import/*`、`App`、`Library`、`Studio`、`Cast`、`Settings`
- 重建 `engine/node-server.mjs`、`engine/config.json`、`voices/meta.json`
- 重建 `mcp/server.mjs`，补回 `start.bat` 自动构建
- 新增 `styles-additions.css`，在主样式后追加本次所有新样式

### 验证

- `npm.cmd run build` 通过
- Electron 启动，8290 监听，node-server 日志正常
- 项目 `p-mw7phvqs` 能读取

### 坑

- 迁移包 `app/electron` 没有 `config.cjs`，`main.cjs` require 它会导致主进程崩溃
- `npm install` 后 Electron 的 `dist` 可能没下载，需要手动跑 `node node_modules/electron/install.js`
- 用 `ELECTRON_RUN_AS_NODE` spawn `node-server.mjs` 没起来，改用系统 `node.exe`
- `voices/*.wav` 无法从代码恢复，当前只有 `meta.json`
- 之前的 41 章项目 `p-mw7nitpe` 丢失

## 2026-11-08 凌晨


### 完成

- 视觉稿 `design/preview.html`：五个页面、快速模式、AI 拆分进度、MCP 设置、导入模态、音色筛选模式
- React 应用 `app/`：React 19 + Vite 8 + TS 7，五个页面拆成组件，视觉稿 1:1 迁移
- Electron 壳：单实例、1440×900、自动拉起引擎、生产模式加载 `dist`
- 引擎 `engine/server.py`：FastAPI，端口 8290，复用 `D:\APP\IndexTTS-2.0\.venv`，懒加载 IndexTTS 2.5
- MCP `mcp/server.mjs`：6 个工具，stdio，审计日志
- 真实链路：前端点「生成 3 句」→ `/v1/tts` → IndexTTS 2.5 → 返回 wav → 浏览器播放

### 验证

- `npm run build` 通过（TS 7 + Vite 8）
- 浏览器 console 无错误
- `/health` 返回 RTX 4070 Ti、显存、模型状态
- `/v1/voices` 返回 247 条真实音色
- 真实生成：「你迟到了。」→ 1.27 秒 wav，55 秒（含首次加载）
- MCP：initialize、tools/list、read_project、update_line、get_audit 均正常
- Electron 生产模式加载 `dist` 正常，顶栏显示真实显存 5.3/12 GB

### 坑

- PowerShell 管道把中文传给 Node 会变成 `??`，测试 MCP 时用 UTF-8 文件重定向，不要用 `echo | node`
- `require("node:electron")` 错误，主进程必须 `require("electron")`
- TS 7 需要 `src/vite-env.d.ts` 声明 CSS 导入
- 文件夹 `音湖` 被 OpenCode 句柄占用，改名为 `声栞` 时重建目录并迁移 session

## 2026-11-08 凌晨（续）

### 新增

- 项目持久化：`projects/<项目名>/project.json`，Electron IPC 读写，刷新/重启不丢
- 批量生成：只跑 `pending` 或 `dirty` 的句子，逐句更新状态，显示第几句、谁、失败原因
- 成片合成：引擎 `/v1/merge` 用 soundfile 拼接，按标点自动加停顿，返回整轨 wav
- 默认音色包：16 条，4 条角色声线 + 4 条官方示例 + 8 条 AISHELL-3，角色页默认只展示这些
- 双击编辑：台词双击变 textarea，回车保存、Esc 取消，自动标 dirty
- 导入文本：项目库粘贴文本 → 调 `/v1/split` 规则拆分 → 创建项目并写入台词
- 窗口默认最大化，解决 125% 缩放下三栏挤压
- GPU 显存显示改为「已用 / 总量」，修复 Windows WDDM 下 free 超过 total 的假数据

### 验证

- 浏览器批量生成 9 句全部成功，单句 2–7 秒
- 成片合成 34.5 秒，9 句，播放正常
- Electron 最大化后工作台布局正常，项目文件加载 9 句已生成
- 角色页默认 16 条，切换「全部 247 条」正常

### 续二

- `/v1/export`：一次导出整轨 WAV + SRT 字幕 + 分轨 ZIP，按标点加停顿，RMS 归一到 −16 dB
- 批量生成失败自动重试一次
- electron-builder 安装包：`release/声栞 Setup 0.1.0.exe`（122 MB）
- 绿色版：`release/win-unpacked/声栞.exe`
- 打包后引擎在 `resources/engine`，项目目录改为 `文档/声栞 Projects`
- 验证：导出 34.5 秒 wav、SRT 时间轴正确、分轨 zip 1.1 MB；安装包启动 UI 正常

### 下一步

1. 项目持久化：SQLite，项目文件夹 `project.db + audio/ + exports/`
2. 批量生成队列：只跑 dirty，失败重试，暂停/继续
3. 成片合成：停顿、响度、WAV/MP3/分轨/SRT
4. 音色库整理：过滤情绪参考，中文优先，人工命名 12–16 条默认包
5. electron-builder 安装包

### 授权提醒

- 音色库里 `情绪参考/`、`官方示例/` 部分音频是 CC BY-NC 或未单独标注，自用可以，商用要换成 AISHELL-3、voice-donations、VCTK、voice-zero、alba-mackenna 这几组
- IndexTTS 2.5 本身是 bilibili Model Use License，禁止合成公众人物或未授权个人声音
