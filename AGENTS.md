# 声栞 · 项目记忆

给后续接手的人或 AI 看的长期约定。改功能前先读这里，再看 `docs/HANDOFF.md`。

> 2026-11-08 发生过一次严重事故：清理文件时误删 D 盘，工程源码和 `voices/*.wav` 丢失。当前工程是从 `声栞迁移包` 恢复初始版本后，按会话记录重建的。**任何删除、移动、覆盖操作前必须先打印绝对路径、列出内容、向用户确认；默认删到回收站，禁止 `rd /s /q`、`Remove-Item -Recurse -Force`。**

## 一句话

本地 AI 配音工作台：导入小说 → 拆章节和台词 → 匹配音色 → 逐句生成 → 合成整章。

核心不是功能多，是「改台词不烦、生成只跑改动句、AI 做了什么看得见」。

## 文档分工

| 文件 | 用途 |
|---|---|
| `README.md` | 用户视角的安装、启动、接口 |
| `docs/HANDOFF.md` | 当前状态、配置、已知限制、待办 |
| `docs/DESIGN.md` | 视觉和交互原则，改 UI 前必读 |
| `docs/DEVLOG.md` | 每次开发的验证结果和踩坑 |
| `CHANGELOG.md` | 用户可见的改动记录 |

改完功能要同步 `CHANGELOG.md`；状态或限制变了同步 `docs/HANDOFF.md`；踩到新坑同步 `docs/DEVLOG.md`。

## Git

- 仓库根目录就是本目录，主分支 `main`；当前 UI 重构分支 `design/ui-refresh`（`optimize/next-3` 已合并前保留），不要直接改 `main`。
- 每次提交前更新 `CHANGELOG.md`（用户可见改动）和 `docs/DEVLOG.md`（验证结果、踩坑）。
- 提交信息用 `type: 简述`，例如 `fix: 生成失败不再删除旧音频`、`docs: 记录 MCP 配置`。
- 不提交 `projects/`、`voices/`、`engine/outputs/`、`mcp/data/`、`node_modules/`、`dist/`、`release/`。
- 不要把 API Key、`%APPDATA%/shengkan/ai.json` 或任何密钥写进仓库。

## 架构

```
Electron (React UI)
   │  HTTP 127.0.0.1:8290
   ▼
engine/node-server.mjs        ← 当前默认，远端 Gradio 代理
   │  /gradio_api/call/gen_single
   ▼
IndexTTS WebUI (192.168.3.68:7860)

可选：engine/server.py → 本机 IndexTTS 2.5

云 TTS：小米 MiMo / 千问 TTS（DashScope）/ 自定义 OpenAI 兼容
   │  角色绑定 cloudVoice 时，Electron 主进程 cloud-tts.cjs 直接调用
   ▼
engine/outputs/*.wav
```

- 本机没有 IndexTTS 模型，默认必须连远端 WebUI。
- `engine/config.json` 决定用 `gradio` 还是 `local`，设置页写它，**重启生效**。
- 环境变量 `GRADIO_URL` / `GRADIO_API` / `VOICE_LIB` 可临时覆盖。
- `/v1/split` 是本地规则拆分，不依赖远端、不调用大模型。
- 远端只负责 TTS；拆章、拆台词、AI 分章都在本机完成。

## 启动

```bat
start.bat
```

逻辑：依赖缺失才 `npm install`；`dist` 不存在或源码比 `dist` 新才 `npm run build`；然后启动 Electron。不需要每次打包安装版。

开发：

```powershell
cd app
npm.cmd run dev
# 另开终端
$env:SHENGKAN_DEV_URL="http://127.0.0.1:5173"
npx.cmd electron .
```

发布安装包才用：

```powershell
cd app
npm.cmd run dist
```

Windows 上优先用 `npm.cmd` / `npx.cmd`，`npm.ps1` 常被 PowerShell 执行策略拦截。

## 数据位置

| 数据 | 位置 |
|---|---|
| 项目 | `projects/<项目名>/project.json` |
| 项目回收站 | `projects/.trash/<目录名>__<时间戳>/` |
| 生成音频 | `engine/outputs/*.wav` |
| 参考音频 | `voices/*.wav` + `voices/meta.json` |
| 设计音色 | `voices/cloud/*.wav` + `voices/cloud.json` |
| 引擎配置 | `engine/config.json` |
| AI 配置 | `%APPDATA%/shengkan/ai.json`（打包版是 `%APPDATA%/声栞/ai.json`） |
| 开发日志 | `%APPDATA%/shengkan/logs/app.log` |
| MCP 审计 | `mcp/data/audit.jsonl` |

项目 JSON 结构：`{ id, title, createdAt, updatedAt, settings, casts[], chapters[] }`，章节里是 `lines[]`。台词任一字段变化就标 `dirty`，批量生成只跑 `pending` / `dirty`。

## 关键代码

| 文件 | 作用 |
|---|---|
| `app/src/App.tsx` | 页面切换、项目加载、导入时逐章拆台词、汇总角色、全局拖拽 |
| `app/src/pages/Library.tsx` | 项目库、拖拽导入、导入预览、AI 分章、回收站、右键菜单 |
| `app/src/pages/Studio.tsx` | 工作台、台词编辑、章节管理、勾选/单句生成、AI 重拆、播放器 |
| `app/src/pages/Cast.tsx` | 角色管理、音色绑定、音色播放/暂停 |
| `app/src/pages/Settings.tsx` | AI 配置、提示词、引擎配置、开发日志 |
| `app/src/import/epub.ts` | EPUB 解析、目录锚点、tocCount |
| `app/src/import/docx.ts` | DOCX 段落提取 |
| `app/src/import/text.ts` | 编码识别、规则分章、角色名过滤、AI 章节标记落地 |
| `app/src/ai.ts` | 渲染端 AI 桥接、token usage |
| `app/electron/ai.cjs` | AI 服务商配置、分章、角色标注、角色提取、分块、取消 |
| `app/electron/cloud-tts.cjs` | 小米 MiMo / 千问 TTS / 自定义 TTS、预置音色、克隆 |
| `app/src/cloud.ts` | 渲染端云音色桥接 |
| `app/electron/log.cjs` | 文件日志 |
| `app/electron/projects.cjs` | 项目 JSON 读写、回收站 |
| `app/electron/engine.cjs` | 启动 Node 代理或本机 Python |
| `engine/node-server.mjs` | Gradio 代理、规则拆分、音色列表、音频删除 |
| `mcp/server.mjs` | 外部 AI 读写项目，默认最近项目 |

## 导入和 AI

- 支持 `.txt / .md / .epub / .docx`，项目库整页可拖，其他页面拖入会切到项目库。
- TXT 编码顺序：BOM → UTF-8 严格 → GBK → UTF-8 宽松。
- EPUB 走 `container.xml → OPF → spine`，标题取 EPUB3 nav 或 EPUB2 NCX；返回 `tocCount` 供导入页判断目录是否存在。
- **EPUB 必须按目录锚点切分，不能按文件切**。一个 XHTML 里可能有多章。
- 文件导入后保留 `baseChapters`。「自动识别」优先恢复它，只有直接粘贴文本时才重新跑规则；否则会把 EPUB 目录覆盖成 1 章。
- 规则分章认：`第X章/回/节/卷`、序章、楔子、引子、前言、后记、尾声、终章、番外、`Chapter N`。
- AI 分章只识别「章」级结构，制作信息、目录、简介、登场人物、插图页要在提示词和后处理里过滤。
- AI 分章只返回「标题 + 正文起始片段」，本地按片段在原文定位切分。**不要改成让模型返回正文**。
- AI 分章、角色分析、标注要带书名/章节名 context；用户可选择 MiMo、千问百炼、DeepSeek 或自定义。
- MiMo 的 Base URL 是 `https://api.xiaomimimo.com/v1`，`response_format: json_object`，请求头用 `api-key`；**MiMo 仍要带 `thinking: { type: "disabled" }`**，非 MiMo 服务商不要发这个字段。
- 超长文本按 15 万字符分块，每块独立识别，再按全局偏移合并。
- 角色识别必须有「名字 + 说/道/问/答/喊/笑…」或「句首短名 + 冒号」，不能把引号前任意短词当名字。
- 角色列表用 `isRealCharacter` 过滤作者、插画、制作信息、目录、译者等非人物；无名字路人允许「OL女性」「店员」这类身份名。
- 「AI 重拆本章」先 `extractCasts` 分析本章角色，再 `annotateLines` 标注角色、情绪、语速。
- 整本角色标注会先做一次整本角色预分析，再逐章标注；整本重拆章节只用规则，不碰角色。
- AI 标注按 60 句一批，支持停止和从批次续跑。
- 提示词存在 `userData/ai.json` 的 `prompts.chapter` / `prompts.annotate`；留空用内置。

## 约定

- 界面和文档全中文，代码标识符用英文。
- 每章台词保存时整本 `project.json` 重写，暂时没有增量保存。
- 删除项目一律走 `projects.cjs` 的 `trashProject`，不要直接 `fs.rm` 项目目录。彻底删除只在回收站里做。
- 页面不要引入重型状态库，现有 `useState` + props 足够。
- 不引入原生模块依赖；Electron 打包要跨机器可用，纯 JS 优先。
- 新增 UI 先看 `docs/DESIGN.md`：深炭灰外壳、米白稿纸、铜色强调、台词用宋体。
- 假按钮和假数据不要留。新增占位 UI 要标注「未接入」。
- 音频播放必须复用同一个 `HTMLAudioElement`，否则没法暂停。底部播放条要和真实音频的 `currentTime / duration / paused` 绑定，不能写死时间。
- 默认音色不能用「中文男声」这类搜索词，必须读 `/v1/voices` 的 `gender / age` 字段匹配。
- 生成类操作必须有可见反馈：行内「生成中 / 生成失败」或 toast。
- 删除台词、删除章节、重新拆分或整本重拆时，用 `/v1/audio-delete` 清掉被替换的旧 wav。
- **生成前不要删除当前音频**。生成成功后由 `nextAudio` 把当前版本推进历史，再淘汰最旧版本；生成失败必须保留旧音频。
- 所有 MCP 修改写 `mcp/data/audit.jsonl`。
- 云音色通过 `ProjectCast.cloudModel/cloudVoice/cloudName` 绑定；绑定本地音色时必须清空这三个字段。
- 小米云 TTS 用 `mimo-v2.5-tts`（预置）、`mimo-v2.5-tts-voicedesign`（设计）、`mimo-v2.5-tts-voiceclone`（克隆）。
- 千问 TTS 走 DashScope 原生 `multimodal-generation`，model 用 `qwen:` 前缀；自定义 TTS 走 OpenAI 兼容 `/audio/speech`，model 用 `custom:` 前缀。
- 预置云音色是内置的，不能删除或改名；前端隐藏编辑/删除，`cloud-tts.cjs` 的 `remove/update` 也会拒绝。
- `ai.cjs` 的 `suggestVoice` 把用户提示扩写成 `name/description/previewText`；`designPreview` 在传入 `prompt` 时调用它。
- AI 生成的音色和手动设计的音色都保存到 `voices/cloud`，绑定角色时用 voiceclone。
- 云音色「加入本地音色库」由 `cloud-tts.cjs` 的 `materialize` 完成：把样本复制到 `voices/<名字>-<id>.wav`，返回 `localPath`（文件名）。前端把 `voicePath` 设为 `localPath`，并清空 `cloudModel/cloudVoice/cloudName`，生成时走 IndexTTS。
- 本地样本按 `-<音色 id>.wav` 后缀查找，不要用 `localSample(name, id)` 重新拼路径，音色改名后会找不到。
- 设计音色必须走「预览 → 保存」：`designPreview` 只写 `voices/.preview`，`saveDesign` 才写入 `cloud.json` 和 `meta.json`。取消不能落库。
- `/v1/voices` 只扫描本地音色，跳过 `voices/cloud`。设计音色保存后先在云音色列表，点「加入本地音色库」才复制到 `voices/` 并进入本地音色列表。
- 删除音色统一移到 `voices/.trash`，不永久删除。本地音色用 `/v1/voice-delete`，云音色用 `cloud.remove`。
- 云音色和本地音色分开：`/v1/voices` 不扫描 `voices/cloud`。`materialize` 会把云样本复制到 `voices/<名字>-<id>.wav`，删除云不影响本地副本。
- Electron 不支持 `window.prompt`，会返回 null。所有需要输入的地方用 `app/src/prompt.ts` 的 `askText`，不要用 `window.prompt`。
- 每句台词最多保留 2 个音频：`audio` 是当前使用，`audioHistory` 最多 1 个。生成第三个时删除最旧的未选中版本；重新绑定音色不会删除已有音频。
- 整本操作在项目库右键「编辑整本」：`rebuildAllLines` 只拆章节不改角色；`annotateAllChapters` 逐章分析角色、情绪、语速，会新增识别到的角色。
- 角色页管理 `project.casts` 全量角色；工作台右侧「本章角色」从当前章节台词里的 speaker 推导。工作台「移除本章」只把本章台词改成「未知」，不删项目角色。
- 角色绑定状态统一用 `castVoiceLabel`：云绑定看 `cloudName / cloudVoice`，本地绑定看 `voicePath`，不要只看 `voicePath`。
- 音色按钮只作用于左侧当前选中的角色：云/本地都叫「绑定到角色」，再点变成「取消绑定」；不要弹出角色列表。
- 「加入本地音色库」只复制样本到 `voices/`，不绑定角色；要使用本地 TTS 时再到本地音色卡点「绑定到角色」。
- 角色名必须过 `isRealCharacter` / `isNameShape`：2-6 个汉字，排除代词、副词、动作片段和「的她着得地过了」这类结尾，不要只按引号前 2-5 字猜。
- 规则拆分不能把裸「道」当说话动词；「吼道/笑道/接道」会截出假名字，必须用完整动词。
- 工作台本章角色卡片点击不能直接改当前句；要改说话人必须点显式的「设为当前句」，避免列表重排和误改。
- 整本重拆章节只拆章节，不新增、不删除、不改名项目角色；整本角色标注才允许新增角色和改情绪/语速。
- 支持 `.docx` 导入：`app/src/import/docx.ts` 按 `word/document.xml` 的段落提取正文，再走规则分章。
- 导入弹窗只能点 ✕ / 关闭退出，不能点遮罩关闭；关闭后保留上次文本、AI 分章结果，避免重新识别。
- 语速统一存 0.5-2.0 数字：1 正常，小于 1 更慢，大于 1 更快。本地 IndexTTS 传 `duration_factor = 1 / speed`，云 TTS 写进自然语言指令。
- 批量生成用 `runPool`：全云 3 并发、混合 2 并发、全本地 1 并发；取消时已发出的请求返回后停止。
- 成片导出历史存 `localStorage`（`shengkan:exports:<projectId>`），因为 Master 切页会卸载；文件名用「书名-章节名」。
- `voiceHistory` 记录角色用过的音色，绑定/解绑/删除音色时写入，最多 12 条，可单条移除。
- 界面缩放 1.6，窗口 1600×1000；顶栏和 master head 必须允许换行。
- 音色库分组：本地音色按 `category`，云音色按 `model`（小米预置 / 设计音色）。
- EPUB 解析跳过 `img / figure / figcaption`，避免插图说明混进正文。
- 成片导出走 `engine/node-server.mjs` 的 `/v1/merge` / `/v1/export` / `/v1/zip`，WAV 读写、重采样、响度归一和分轨 ZIP 在 `engine/wav.mjs`，不要引入原生音频依赖。
- 工作台 `script` 必须在 `project.chapters` 变化时同步当前章节 `lines`，否则整本 AI 或别的页面修改后界面会显示旧台词。
- 设置页只保留实际实现的标签页：AI 服务、语音引擎、开发与 MCP。不要加空标签。
- 语速滑块和数字输入对云 TTS、本地 IndexTTS 都生效；不要再写「本地不支持语速」。
- AI 服务商存在 `ai.json` 的 `provider / baseUrl / model / apiKey`；MiMo TTS 单独用 `mimoTts`，不要复用其他服务商的 Key。
- 自定义 TTS 是 OpenAI 兼容 `/audio/speech`，配置在 `customTts`，云音色卡片用 `custom:` 前缀的 model 区分。
- 千问 TTS 走 DashScope 原生 `multimodal-generation`，配置在 `qwenTts`，model 用 `qwen:` 前缀；不要塞进 OpenAI 兼容接口。
- AI 分章/角色分析/标注要带书名和章节名 context；已出版作品可以结合 AI 已知角色名，但不确定必须保留「未知」。
- 没有名字但有台词的路人允许用「OL女性」「店员」这类身份描述，不要强行编人名。
- 整本角色标注先做整本角色预分析，再逐章标注；不要只按当前章节猜名字。
- `/v1/audio/` 的 Node 代理必须先 `decodeURIComponent(url.pathname)` 再取 basename，否则中文导出文件会 404。
- 规则拆句遇到句中短引号（如「假睡」）要合并回旁白；只有独立成段、带说话标记或长引文才当台词。
- 台词保留 `paragraph` 段号，工作台显示「第 N 段」，不要丢掉原文分段。
- 成片页「导出句间停顿」只控制拼接静音，不是 TTS 内部断句；不要把两者混在一起解释。
- 阿里 CosyVoice 还没接入，需要单独的 DashScope API Key；不要放假按钮。

## 不要做

- **不要用不可恢复命令删除任何东西**：`rd /s /q`、`del /f /q`、`Remove-Item -Recurse -Force`、`format`、`diskpart clean`。
- 删除前必须打印绝对路径、列出内容、向用户确认；默认删到回收站。
- 不要把 API Key 写进源码、`engine/config.json` 或安装包。Key 只放 `userData/ai.json`。
- 不要改回「按 spine 文件一章」的 EPUB 解析。
- 不要给结构化任务重新打开 MiMo 深度思考。
- 不要按文件名 `voice_03` 之类自动猜音色的性别和年龄，以 `voices/meta.json` 为准。
- 不要改 `engine/node-server.mjs` 的 Gradio 参数发现逻辑去写死顺序。
- 不要随便杀 `electron.exe` 主进程，先确认是不是声栞。

## 已知坑

- 2026-11-08 D 盘被误清空，`voices/*.wav` 丢失，当前 `voices` 只有 `meta.json`。没有音色文件时生成会报「音色库是空的」。
- 生成前先 `deleteAudio(line.audio)` 会导致 TTS 失败时旧音频和历史版本一起失效；已修复，不要再加回来。
- `Master` 的 `/v1/export` 在 Gradio 代理模式曾经没有实现，按钮一直 404；现在由 `engine/wav.mjs` 处理。
- 本地样本文件名带音色名，改名后不能按名字拼路径，否则会误判为「没有本地克隆」并重复生成样本。
- `Cast` 删除音色只解绑当前选中角色是旧 bug；必须解绑所有引用该音色的角色。
- 之前的 41 章项目 `p-mw7nitpe` 已丢失；`p-mw7phvqs`（9 章 3 角色）和 `p-mw81gv9b` 在 `projects/.trash/`，活动项目是 `p-mw91apwo`（20 章）。
- `npm.ps1` / `npx.ps1` 被执行策略拦截 → 用 `.cmd`。
- 中文路径在 PowerShell 输出里可能乱码，但文件操作正常。
- `npm install` 后 Electron 的 `dist` 可能没下载，需要 `node node_modules/electron/install.js`。
- 迁移包 `app/electron` 初始没有 `config.cjs`，`main.cjs` 依赖它，必须保留。
- 远端 WebUI 关掉后生成报连接失败，拆章和导入不受影响。
- `release/` 里的安装包是旧构建，改了代码要重新 `npm run dist`。
- 旧项目不会自动过滤 EPUB 版权页；需要重新导入，或对正文章节用「AI 重拆本章」。
- 旧项目里的假角色不会自动消失，用角色页「清理无效角色」或「整本角色标注」重建。
- MCP 默认读最近修改的项目，可用 `project` 参数指定 id 或标题。
- 整本角色标注会调用很多次 AI，3974 句会跑很久，也会消耗较多 token；token 统计会在结束时弹窗显示。

## 验证

改完至少跑：

```powershell
cd app
npm.cmd run build
```

涉及导入时，用一个小 EPUB 走一遍：拖入 → 预览章数和标题 → 导入 → 工作台能看到章节和台词。

涉及 AI 时，设置页「测试」会真实请求当前 AI 服务商一次，别反复点。

## Agent skills

### Issue tracker

Issues and specs live as markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`, created lazily when needed. See `docs/agents/domain.md`.
