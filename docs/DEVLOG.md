# 开发记录

## 2026-11-10 · 界面重构

### 设计决策

- 保留「开盘机机壳 + 剧本稿纸」的概念，这是项目自己的识别，不换成通用深色卡片
- 减少方框：按钮默认无边框，用底色和文字色分层；只有输入框、下拉框和拖放区保留表面色
- 铜色只标「当前」：当前章节、当前句、当前角色、播放头，不拿来装饰标题
- 动效一次只做一件事：入场、当前句、弹窗、播放状态；不做全屏漂移或常驻呼吸

### 完成

- 重写 `app/src/styles.css`，合并 `styles-additions.css` 中所有历史覆盖规则
- `main.tsx` 只引入一份样式
- 顶栏改成图标 + 文字导航，补上引擎离线状态；删掉假的「队列 0」
- 工作台：当前台词与生成参数合并并前置；AI 工具默认收起、移到最下；播放条加 `playing` 类，VU 只在播放时动
- 角色页操作按钮改成文字工具栏，音色卡改成无边框卡片
- 成片页修好顶栏下拉框被 `width: 100%` 挤成三行的问题
- 项目库、角色页、设置页统一页面标题、留白和表面层级

### 验证

- `npm.cmd run build` 通过
- 用 Electron `offscreen` + mock IPC 截图，逐页检查 1600×1000
- 检查 1360px 和 1180px 断点，左右栏按预期收窄

### 坑

- 旧 `styles.css` 和 `styles-additions.css` 互相覆盖，字号被抬到 21px、右栏被改到 420px；只改一处会导致另一半页面回退
- `.select` 的 `width: 100%` 放进 flex 行会让每个下拉框各占一行；成片页需要单独设 `width: auto`
- 旧样式里的 `.playing .wave i` 从来没有生效，因为播放条没加 `playing` 类；这次一并修正，但改成只让 VU 动
- `content-visibility: auto` 先加在原文段落上；台词列表要去掉，因为角色跳转需要稳定的真实高度

## 2026-11-09 · 播放 404、AI 服务商和 EPUB 分章

### 根因

- 导出文件用中文名「书名-章节名.wav」后，`/v1/audio/` 拿到的 `url.pathname` 是 percent-encoded，`path.basename` 用编码后的字符串找文件，必然 404；播放键和导出历史都因此失效
- 规则拆句把 `「假睡」` 这种句中短引号当对话，导致一段旁白被拆成「旁白 + 角色 + 旁白」
- AI 分章旧提示词允许纯数字 1、2、3 作为章节，且没有利用 EPUB 目录，导致 41 章的误切
- `duration_factor` 是时长系数，不是语速；时长为 1.2 等于语速变慢

### 完成

- `/v1/audio/` 先 `decodeURIComponent` 再取 basename
- 播放器和历史播放恢复；播放条总时长、拖动、0.5-3.0 倍速
- 句中短引号不再拆台词；新增 `paragraph` 段号并显示在台词标签
- AI 分章提示词禁止纯数字/页码/小节标题；支持传入 EPUB 目录
- AI 提示词带书名和章节名；已出版作品可结合 AI 已知角色名
- 整本角色标注先做整本角色预分析；无名字路人允许 OL女性/店员 这类身份名
- 千问 TTS（DashScope）接入：qwen3-tts-flash / qwen-audio-*，支持 rate
- 自定义 OpenAI 兼容 TTS 支持 speed
- EPUB TOC 解析增强，导入界面显示目录条数，目录存在时不再自动跑 AI
- AI 服务商可选 MiMo/千问百炼/DeepSeek/自定义；MiMo TTS 配置独立
- 自定义 OpenAI 兼容 TTS `/audio/speech`
- AI 操作结束弹 token 统计窗
- 停顿说明、整本编辑规则/AI 说明、章节生成确认
- 缩放 1.6

### 验证

- 中文导出 WAV 通过 `/v1/audio/` 返回 200，大小 25,822,124 字节
- 规则拆分测试：`命名为「假睡」作战` 保持一句旁白，段号 1
- `/v1/export` + `/v1/zip` 中文文件名通过
- `npm.cmd run build` 和 `tsc --noUnusedLocals --noUnusedParameters` 通过
- `server.py` 语法检查通过

### 坑

- FastAPI 的 path 参数会自动解码，Node 的 `URL.pathname` 不会，两个引擎要区别处理
- 纯数字标题可能是目录页码，也可能是真正的章节；没有目录时必须依赖「第X章」等明确标记
- 语速和时长系数方向相反，云端说「语速 1.2 倍」，本地要传 `duration_factor=0.833`
- AI token 的 cached 字段在不同服务商字段名不同，要同时兼容 `prompt_tokens_details.cached_tokens` 和 `cached_tokens`

## 2026-11-09 · 生成并发、播放器、成片历史和 160% 界面

### 完成

- 导入弹窗禁止点遮罩关闭，保留上次导入状态
- 批量生成用 `runPool`：全云 3 并发、混合 2 并发、全本地串行
- 生成弹窗：未生成/全部/取消；生成中「取消生成」
- 试听单句/连续切换；连续播放从当前句往后
- 播放条增加总时长事件、点击跳转和 0.5-3.0 倍速下拉
- AI 拆分/标注集中到右侧 `details` 二级菜单
- 本章角色快速跳转：上下箭头 + 数字输入 + scrollIntoView
- 语速改成 0.5-2.0 数字，AI/界面/MCP 全部统一
- 本地 `duration_factor = 1 / speed`，云 TTS 用自然语言倍数
- 成片导出历史存 `localStorage`，按项目保留；支持整本单轨和整本分章 ZIP
- `/v1/zip` 新增到 Node 代理和 Python 本机引擎
- 导出返回绝对 `file`，Electron `shell.showItemInFolder` 定位
- 角色音色历史 `voiceHistory`，可单条移除
- 缩放 1.6，窗口 1600×1000

### 验证

- `npm.cmd run build` 通过
- `tsc --noUnusedLocals --noUnusedParameters` 无报错
- Node 引擎实测 `/v1/export` 输出中文文件名 WAV/SRT，`/v1/zip` 打包成功
- Python `server.py` 语法检查通过

### 坑

- `IndexTTS` 的 `duration_factor` 是时长系数，不是语速；语速 1.2 要传 0.833
- 云 TTS 没有独立 speed 参数，只能写进 user 指令或 SSML，不能假装有接口参数
- 并发生成时不能在生成前统一标 dirty，否则取消后未生成的好音频也会被当成待生成
- 导出历史必须存 localStorage，Master 组件切页会卸载，state 会丢
- 160% 缩放下 Studio 顶栏会换行，需要 `flex-wrap`

## 2026-11-09 · 角色识别、音色绑定和 Word 导入

### 根因

规则拆分用「引号前最后 2-5 个汉字 + 说/道/问/答」猜说话人，导致：

- `傅聿之下意识看向她，后\n者却先一步：` 被拆成「者却先一步」
- `声音里带：笑一笑` 被拆成「声音里带」
- `江宁回过神：你打算…` 被拆成「江宁回过神」
- `她回：明天早点起` 被拆成「她回」
- `张兵接茬：` 被拆成「张兵接茬」

这些名字进入 `project.casts` 后，绑定菜单里就会出现一堆奇怪角色。

### 完成

- 规则拆分增加人名形状校验：2-4 个汉字、排除代词/副词/动作开头和结尾、跨行拼接后再匹配
- 去掉裸「道」作为说话动词，避免「吼道」「笑道」被截成假名字
- 导入时按全书统计，只保留出现 2 次以上的人名；单次动作片段回到「未知」
- `refineSpeakers` 用到单章重拆、AI 重拆和整本重拆
- `isRealCharacter` 同步收紧，允许 2-6 个汉字以保留日式长名
- AI 分章提示词去掉字数门槛和角色要求，补中/英/日章节标记
- 角色标注提示词补中/英/日说话标记
- 本章角色卡片点击不再改当前句，新增「设为当前句」，排序稳定
- 云/本音色统一「绑定到角色」，再点取消；本地克隆只加入本地库
- 音色编辑合并成一个弹窗
- 项目库右键「编辑整本」：整本重拆章节（不动角色）、整本角色标注 + 情绪 + 语速
- 支持 `.docx` 导入
- 窗口缩放 1.3

### 验证

- `npm.cmd run build` 通过
- `tsc --noUnusedLocals --noUnusedParameters --noEmit` 无报错
- 规则拆分《晚风落法境》前 12 章，假名字从 40 多个降到 0；主要角色保留 江宁、江奕、傅聿之、妈妈
- DOCX 的 `w:p` / `w:t` 解析用 `@xmldom/xmldom` 验证通过

### 坑

- 只按「引号前 2-5 字」取名字一定会把动作片段当角色；必须先判断人名形状，再做全书频次过滤
- 裸「道」不能当说话动词，否则「吼道/笑道/接茬道」都会截出假名字
- 工作台角色卡片点击直接改说话人会造成列表重排和误改；改成显式按钮
- 云音色绑定和本地克隆是两件事，本地克隆不能顺手绑角色
- 本地 IndexTTS 的音色参考音频越长，克隆稳定性越好；设计试听文本不能太短

## 2026-11-09 · Git 基线和 MCP 红点

### 完成

- 安装 Git for Windows 2.56.0，确认 `git --version` 正常
- `git init -b main`，提交基线 `c38a2b2`，创建 `optimize/next`
- `.gitignore` 排除用户数据、音频、构建产物和迁移包
- 按 `mp-setup-matt-pocock-skills` 写入 `docs/agents/issue-tracker.md`、`docs/agents/domain.md`，并在 `AGENTS.md` 增加 `## Agent skills`
- MCP 依赖 `mcp/node_modules` 缺失，执行 `npm.cmd install`，安装 95 个包
- MCP 新增 `list_projects`，修复无活动项目时的 ENOENT，补引擎超时、音频历史和 `note` 字段
- 删除 `app/src/data.ts`、`app/src/defaultVoices.ts` 到回收站

### 验证

- `node __test-client.mjs`（MCP stdio 客户端）：7 个工具注册成功
- `list_projects(includeTrash: true)`：2 个回收站项目
- 临时复制 `p-mw7phvqs__1794154807729/project.json` 测试 `read_project` / `read_lines`：9 章、首章 33 句
- `npm.cmd run build` 通过

### 坑

- MCP 红点不是配置语法错误，而是 `mcp/node_modules` 不存在；SDK import 失败时进程立即退出，前端只看到红点
- OpenCode 修改 MCP 配置后必须重启才会重新拉起进程
- 仓库当前没有 remote；issue tracker 用本地 `.scratch/`，不依赖 GitHub
- Git 默认 `core.autocrlf` 会把 LF 转 CRLF；已在仓库内设 `core.autocrlf false`

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
