# 开发记录

## 2026-11-17 · v1.0.1 品牌和截图

### 完成

- 窗口标题改为 `声栞 · Shiori Voices`；顶部品牌 `配音工作台` 改为 `台词配音工作台`
- 用最新 `logo/shiori-logo.png` 重新生成 `app/build/icon.ico`（16–256 共 8 档），重新打包
- 版本号改为 `1.0.1`，安装包名 `shengkan-1.0.1-setup.exe`
- 新增用户向 `RELEASES.md`，README 增加项目、工作台、角色与音色、成片四张截图
- 安装包通过 `extraResources` 附带 `LICENSE`

### 验证

- `npm.cmd run build` 和 `npm.cmd run dist` 通过
- 打包版窗口标题为 `声栞 · Shiori Voices`，顶部品牌为 `声栞 台词配音工作台`
- 从 EXE 和安装包提取的图标都是新版「卷边纸页」
- 用临时示例项目「雨夜书店」和临时 7860 mock Gradio 截取四个页面；截图保存在 `docs/screenshots/`
- 截图环境使用临时 profile、项目、音色和输出目录，不涉及真实项目和音色

## 2026-11-17 · 发行版提示词、设置页操作和 GitHub 准备

### 完成

- 设置页把「保存 AI 配置」放进当前 AI 分区的最后一个 `setting-group`，文本 AI 放在章节识别组末尾，TTS AI 放在云 TTS 组末尾
- 提示词输入框保留内置默认值回退，并在下方标明「当前使用内置/自定义提示词」
- 把旧 README 复制为 `docs/DEVELOPMENT.md`，根 README 改成用户安装和使用说明
- `.scratch/` 从 Git 索引移除，文件仍保留在本机；`.gitignore` 增加密钥和证书文件
- 安装版 `engine.cjs` 使用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 启动 Node 代理，避免要求用户安装 Node
- 品牌图标定稿为「折角纸页」：`logo/shiori-logo.png` 为唯一源文件，`logo/shiori-icon/` 输出 16–1024 十档尺寸，全部由源文件缩放

### 验证

- `npm.cmd run build` 通过
- `npm.cmd run dist` 通过，生成 `release/shengkan-0.1.0-setup.exe`（约 122 MB）和 `release/win-unpacked/`；已带新图标和 GPL-3.0 许可证
- 解包 `app.asar` 确认包含 `defaultPrompts`、两段内置提示词、`settings-save-row` 和 `ELECTRON_RUN_AS_NODE`
- 用独立用户目录启动打包版，设置页两个提示词输入框分别有 734 和 1193 个字符；项目库显示 0 个项目、0 句台词
- 截图检查保存按钮位于表单组末尾，父元素为 `setting-group`，不再是独立的 `settings-actions`
- `app/build/icon.ico` 由 `icon-16` 到 `icon-256` 合成 8 档尺寸，`build.win.icon` 已接入；从 EXE 和安装包提取的图标都是新 logo
- `LICENSE` 已作为 `extraResources` 打进安装包，`release/win-unpacked/resources/LICENSE` 为 GPL-3.0 全文
- `release/start-isolated.cmd` 已用临时 profile、项目、音色和输出目录启动；项目库为 0，引擎代理在 8290 启动并使用隔离音色目录
- 隐私扫描：64 个跟踪文件无真实 Key、无本机用户路径；打包产物未包含 `ai.json`、项目、音色、日志或参考音频

### 待办

- 安装包仍未做代码签名，Windows SmartScreen 会提示未知发布者
- 应用图标已接入打包；后续如果调整 logo，需要重新生成 `app/build/icon.ico`
- GitHub 远端尚未配置；许可证已定为 GPL-3.0，等待仓库名和可见性

## 2026-11-16 · 发行版准备：拼音路径、隐私清理和回收站

### 根因

- 安装版 `voices`、`engine/outputs`、`engine/config.json` 都指向 `resources`，Program Files 下可能只读
- `cloud-tts.cjs`、`engine.cjs`、`projects.cjs` 各自拼路径，开发版/打包版条件分散
- `engine/config.json` 被版本库跟踪，里面有作者局域网地址；`engine.log`、`outputs` 会进安装包
- 回收站彻底删除只删项目目录，`engine/outputs` 里的音频残留
- 设置页没有打开配置文件夹的入口
- 同源暂停/继续分支提前返回，保留连续试听的旧 `onended`；结束回调须在同源分支前更新，单句播放才能接管队列
- TTS HTTP 请求原先在 120 秒中断，早于工作台 4 分钟看门狗；对齐 240 秒后，缩放时钟的 150 秒模拟生成可完成，普通请求预算保持不变
- Node 引擎使用 `error`、FastAPI 使用字符串或校验数组 `detail`；前端与 MCP 在各自请求适配处提取原因，校验错误保留字段位置，避免 JSON 原文或只有 HTTP 状态
- 1.6 倍缩放下 1280 窗口只有 800 CSS px，中栏播放器宽 304 px、连续模式内容占 371 px；按中栏容器宽度改为两行后波形恢复 288 px，控件不越界。失败结果补显式 error 变体，统一使用现有朱砂 token
- 台词网格的默认最小内容宽度使连续英文撑出稿纸，固定角色列又挤压窄稿正文；正文列用 minmax(0, 1fr) 并允许长词换行，中栏不超过 540 CSS px 时角色名上置。窄稿正文从约 124 px 增至 201 px，长台词高度从 339 px 降至 243 px
- 默认整体缩放设为 0.9，保留组件字号和行高，避免全局放大挤压文稿与设置内容
- 项目直接覆盖写入会丢失外部修改，MCP 异步写回还曾依赖全局 currentFile；共享存储用原始字节摘要和锁内校验，MCP 按项目对象绑定文件/版本，前端串行保存并保留冲突草稿。旧音频清理后置，避免 JSON 保存被拒绝时旧引用失效；保存失败自动写恢复草稿，保留新音频的可追溯引用，草稿写入失败则明确提示
- 同项目重读必须隔离旧会话，显式重新载入要重置工作台临时状态，避免外部删章后旧稿落入其他章节；AI 标注取消也须复位 task，保证冲突后能结束收尾并重新载入
- AI 重拆不能把角色分析取消当作普通失败继续标注；拆句返回和 AI 阶段切换前检查停止标记，取消后直接收尾。隔离回归先红后绿 3/3，确认不发起后续请求且重载解禁
- 项目目录内的锁会随回收站移动而失去原路径保护；生命周期操作改用目录外稳定锁并按固定顺序持有源/目标锁。保存失败写唯一恢复草稿，保留新音频引用；锁持有进程确认退出后才允许显式恢复，未知或仍存活的锁拒绝处理。回收站恢复入口按严格校验的 trashName 定位；多锁释放逐个尝试，业务错误优先，无业务错误时汇总释放错误。临时 review 回归 2/2、recovery-locks/lifecycle/mcp 及构建通过，删除验证只用临时夹具和 fs stub
- `getHealth` 原先独立请求且沿用 120 秒预算；现在只共享在途 Promise，10 秒超时，成功或失败后释放、不缓存。真实 HTTP 验证 30 个并发调用只发 1 次请求，超时后可恢复；TTS 当前为 240 秒，导出为 120 秒，工作台 20/20、离线扩展 22/22 通过
- `productName` 是中文，会生成中文 exe、安装目录和快捷方式文件名

### 完成

- 新增 `app/electron/paths.cjs`：开发版用仓库路径，打包版用 `文档/shengkan-projects`、`文档/shengkan-voices`、`%APPDATA%/shengkan/outputs|engine.json|logs`
- `config.cjs`、`engine.cjs`、`cloud-tts.cjs`、`projects.cjs` 统一走 `paths.cjs`；引擎子进程通过 `OUTPUT_DIR`、`VOICE_LIB`、`SHENGKAN_ENGINE_CONFIG` 接收
- `node-server.mjs`、`server.py` 支持 `OUTPUT_DIR`；`server.py` 的代码/模型目录改为必填，不再写死作者路径
- `package.json` 的 `productName` 改为 `shengkan`，`shortcutName` 改为 `shengkan`，安装包 artifact 用拼音
- `extraResources` 排除 `config.json`、`engine.log`、`outputs`、`test_tts.py`、`start-engine.bat`、`__pycache__`
- `engine/config.json` 取消版本跟踪，新增 `engine/config.example.json`
- 新安装默认空项目/空音色；没有项目时默认停在项目库
- 回收站增加大小、章节、台词、删除时间，彻底删除清理音频，新增清空回收站
- 设置 → 开发与 MCP 增加「配置文件夹」，显示并打开 `%APPDATA%/shengkan`
- 云音色本地样本文件名改为 `voice-<id>.wav`，不再用中文音色名做文件名；上传远端参考音频也用 ASCII 临时名

### 验证

- `npm.cmd run build` 通过
- `npm.cmd run check:studio` 通过：20/20
- 回收站 Electron 测试 6/6：移入、大小、章节/台词、彻底删除音频、目录删除、清空
- `electron-builder --dir` 打包成功，`shengkan.exe`，`resources/engine` 只含代码和 `config.example.json`
- 打包版启动创建 `shengkan-projects`、`shengkan-voices`、`%APPDATA%/shengkan/outputs`、`logs`

### 坑

- `app.getPath("documents")` 在 OneDrive 机器上指向 OneDrive 下的 Documents，不能写死本地用户目录
- `electron-builder --dir` 对旧 `release/win-unpacked.tmp` 报 EPERM，换 `--config.directories.output=../release-check2` 可绕过；不要直接删旧目录
- `fs.rmSync` 只用于用户明确点「彻底删除/清空回收站」；项目普通删除仍走回收站
- 安装包文件名、exe、安装目录必须是拼音；中文只放窗口标题、界面和介绍

### 合并和清理

- `release/prepare` 已合并回 `main` 并删除；当前只有 `main`
- 旧中文目录 `声栞 Projects`、`声栞 Voices`，两个 `release-check*` 验证包和 `AGENTS.md.bak` 已移到回收站
- `engine/config.json` 不再进版本库，工作区保留本机配置；模板是 `engine/config.example.json`

## 2026-11-16 · TTS 卡片、云音色试听和 MCP 全流程

### 根因

- TTS AI 用勾选框，和文本 AI 的服务商卡片风格不一致
- 云音色试听每次点击都锁住全部按钮，播放中不能暂停，也不能直接切到别的卡片
- 「刷新」语义不清，设计音色只是重新合成试听，没有真正按描述重生成
- 连续试听每切一句都强制滚动，用户想边听边翻台词时会被拉回去
- MCP 只有 8 个工具，只能读、改单句和单句生成，做不了建项目、绑音色、整章生成和导出

### 完成

- TTS 服务商改为三张卡片，可多选，配置区随启用状态展开
- 云音色用独立的 `cloudAudioRef`：播放键支持暂停/继续，切卡片先停旧的再播新的；请求带序号，旧请求不会覆盖新点击
- 「重新生成」对设计音色调用 `designPreview` 按 `desc` 重新设计参考音频，旧文件进 `voices/.trash`；预置音色重新合成试听
- 播放条新增 `player-follow` 开关，`flashLine` 只在跟随时 `scrollIntoView`
- MCP 新增 `get_health`、`list_voices`、`create_project`、`update_project`、`add_chapter`、`update_chapter`、`replace_chapter_lines`、`add_line`、`delete_line`、`add_cast`、`update_cast`、`bind_voice`、`generate_chapter`、`generate_project`、`export_audio`、`trash_project`、`restore_project`、`open_app`
- MCP 建项目会自动规则拆句并补角色；改名角色会同步台词 speaker
- 云音色生成在 Electron 主进程，MCP 进程拿不到 Key 和代理，批量生成会跳过并返回原因

### 验证

- `npm.cmd run build` 通过
- `npm.cmd run check:studio` 通过：20/20
- MCP 全流程测试 11/11：建项目、拆句、补角色、绑定音色、改台词、回收站、恢复、健康检查、音色列表
- `node --check` 通过

### 坑

- 云音色不能用本地音色的 `audioRef`，否则两套播放状态互相覆盖；必须独立 audio + 请求序号
- MCP 的 `readProject` 会设置 `currentFile`，写入工具调用前必须先读项目
- MCP 生成只支持本地 `voicePath`；不要假装能调云 TTS
- 设计音色重新生成会覆盖 `cloud/<id>.wav`，必须先 `moveToTrash` 旧文件

## 2026-11-16 · 工作台状态、云音色试听和 IndexTTS 2.0

### 根因

- `App` 用 `page === "studio"` 条件渲染，切到「角色与音色」时 `Studio` 被卸载，章节、选中句、滚动位置全部回到初始值
- 云音色试听每次都调用 `cloudTTS` 重新合成，设计音色也不例外；没有本地样本缓存
- 本地 Python 封装写死 `indextts.infer_v2_5` 和 `IndexTTS 2.5` 标签
- 自定义文本 AI 沿用 MiMo 的 16384 输出上限，部分 OpenAI 兼容服务会拒绝；`response_format` 也无法关闭
- 设置页看不到当前实际生效的 `ai.json`

### 完成

- `Studio` 常驻挂载，`active` 控制 `page.active`；切页暂停音频，稿纸 `onScroll` 记录位置，切回恢复
- 新增 `cloud:sample`：缓存在 `voices/.cloud-samples/<id>.wav`；设计音色首次直接复制参考音频，预置/克隆音色才云合成；刷新按钮强制重新生成
- `materialize` 复用试听缓存；删除云音色时清理缓存
- `engine/server.py` 按 `INDEXTTS_VERSION` 加载 `infer_v2_5` / `infer_v2`，2.0 用 `use_fp16`，不传 `lang` / `duration_factor`
- 设置页新增 IndexTTS 2.0/2.5 选择；`/health`、顶栏和工作台显示实际版本
- `chatJSON` 非 MiMo 默认 8192，4xx 命中 `response_format` / `max_tokens` 时降级重试一次
- 设置页显示打码后的 `ai.json` 和路径

### 验证

- `npm.cmd run build` 通过
- `npm.cmd run check:studio` 通过：20/20
- `python -m py_compile engine/server.py` 通过

### 坑

- `Studio` 常驻后 `display:none` 会让 `.script` 的 `scrollTop` 归零，不能切走时读取；必须在 `onScroll` 持续记录
- 云音色缓存要放在 `voices/.cloud-samples` 并跳过隐藏目录，否则会混进本地音色库
- 本地 Python 的 `/v1/voice-audio` 只接受绝对路径，缓存是相对路径，必须先按 `VOICE_LIB` 解析

## 2026-11-11 · 时间轴、AI 长思考和自定义思考强度

### 根因

- 时间轴按角色分组后，把每个角色自己的台词宽度重新归一化到 100%，所以每一行都铺满整条；刻度还是写死的 00:00–06:12，行与行之间根本不在同一时间轴上
- 标注请求沿用全局 `TIMEOUT_MS = 5 分钟`，一章思考十几分钟必然被中断
- 582 句的章节整章一次发送时，模型会在思考里逐句罗列 id、角色、情绪、语速；用户看到 8 分钟还在列举，就以为卡死
- `finally` 无条件清空 `aiMsg / aiThinking / aiProgress`，失败后用户看到的界面是直接消失，思考内容也丢了
- 自定义文本 AI 没有发送 `reasoning_effort` 的入口，只能用模型默认

### 完成

- `Master` 的时间轴改为先按全章顺序累计估算时长，再给每句算 `left / width`；每个角色轨道只放自己的句子，位置与全章对齐
- 刻度按 `totalSec` 生成 7 个时间点，不再写死
- 色块悬停显示句号、起止时间和台词片段；标签改为「每行一个角色 · 横向按台词顺序估算」
- 标注超时放宽到 30 分钟，MiMo `max_completion_tokens` 提到 65536
- 大章节按 220 句切段，段间带前后各 8 句上下文；582 句会拆成 220 / 220 / 142，右栏显示第几段
- 提示词禁止逐句罗列 id/角色/情绪/语速和预演 JSON，思考控制在 500 字以内
- 失败时保留思考框和错误信息，新增「关闭提示」；思考框显示已思考时长
- AI 分析菜单、进度框和确认弹窗补充「2–10 分钟，准确度更高」的提醒，降低等待焦虑
- 自定义文本 AI 增加「思考强度」：`customThinking.enabled` 为真才发送 `reasoning_effort`，不勾选完全不传
- 设置页只在自定义服务商下显示这个选项；TTS 不参与
- `design/ui-refresh` 合并到 `main`，删除已合并的 `optimize/next`、`optimize/next-2`、`optimize/next-3`

### 验证

- 成片截图：旁白/周叔/林晚三条轨道的色块落在各自真实时间位置，刻度 00:00–01:15
- 自定义 AI mock：关闭时请求体没有 `reasoning_effort`，开启 high 时发送 `"high"`
- 分段 mock：500 句拆成 220 / 220 / 60 三段，段间带 8 句上下文
- 真实日志：582 句在 19:49 完成，修改 254 句；说明当时不是卡死，是整章一次思考太慢
- `npm.cmd run check:studio` 20/20
- `node --check app/electron/ai.cjs` 通过

### 坑

- 时间轴不能用「每个角色的总时长」做分母；必须用全章总时长和全局游标
- 一章几百句不能整章一次开着思考跑；模型会在思考里逐句罗列，必须限制行数并禁止预演 JSON
- AI 失败时不要在 `finally` 里清空思考内容；先判断是否失败，再决定是否收起面板
- `AbortSignal.timeout` 抛的是 `TimeoutError`，不是 `AbortError`；要单独翻译成中文提示
- `reasoning_effort` 只给自定义服务商按需发送；MiMo 走 `thinking`，不要同时塞两套参数

## 2026-11-11 · 生成状态、云端重试和连续试听修复

### 根因

- 「本次生成」「生成参数」用的是当前选中台词的 `selectedCast`，不是这次生成的目标台词；所以用云端音色生成时仍可能显示 `IndexTTS 2.5`
- 批量生成每句都调用 `saveChapterLines(..., persist=false)`，而它只在 `persist=true` 时 `setScript`，界面要等整批结束才刷新
- 自动重试沿用第一遍的并发数（云端 3），被限流后再次撞限；失败/重试成功也没有汇总
- 连续试听只排了音频 URL，没有记录对应台词；换句时 `selected` 不变，页面看起来一直停在那一句
- `loadAndPlay` 遇到相同 `audioSrc` 会切暂停/继续，队列里重复 URL 时可能触发旧的 `onended`，表现成同一句反复播
- 播放倍速在点击试听时被闭包捕获，换下一句仍用旧值
- 每句都 `new Audio(src)`，换句的 `play()` 不在用户手势里，Electron/Chromium 的自动播放策略会把下一句暂停
- `useEffect(..., [current])` 里无条件 `pause()`；连续试听每切一句都会改 `current`，刚播放的下一句立刻被这个 effect 暂停
- `audio.load()` 会把 `playbackRate` 重置回 `defaultPlaybackRate`，只在 load 前设置一次会被冲掉
- 波形只画了 120 根固定宽度竖条，占不满播放器宽度；点击映射却按整条宽度算，点在竖条上会跳错位置
- 倍速下拉用 `audioRate` state 控制，每次改倍速都触发整个工作台重渲染，快速切换会卡一下
- `switchAudio` 只改数据，没有提示、没有闪烁、也不播放，看起来像点了没反应
- `/v1/audio/` 一次性 `readFileSync` 返回整文件，不支持 Range，浏览器拖动进度条时会重新拉流

### 完成

- 新增 `castEngineInfo`：按 `cloudModel` 区分小米云 TTS / 千问 / 自定义 / IndexTTS 2.5
- 新增 `genTarget`，生成时记录当前目标句、角色和引擎；右栏卡片和生成参数都显示实际引擎
- 生成时在文稿上方显示 `gen-banner`：当前句、角色、引擎、进度、停止按钮
- `saveChapterLines` 即使 `persist=false` 也更新当前章节的 `script`，每句生成完立即刷新
- 批量生成记录失败句；重试改为 1 并发 + 700ms 间隔，最后显示重试成功和仍失败数量
- 云端并发 3 → 2
- 生成请求增加 4 分钟看门狗：超时按失败处理，批量继续往后跑，不会一直卡住
- `playCurrent` 连续模式改为按 `ProjectLine` 排队，跳过没有音频的句子；每句切换时 `setCurrent` + `flashLine`
- 新增台词的滚动/闪烁效果，复用 `source-flash` 动画
- `loadAndPlay` 增加 `force` 参数，连续换句不再触发同源暂停/继续
- 全局只创建一个 `Audio` 元素，换句只改 `src`，避免下一句被自动播放策略暂停
- `[current]` effect 在连续播放时跳过暂停；靠 `continuousRef` 区分手动切句和自动切句
- 波形竖条改成 flex 铺满，并叠加透明 `<input type="range">`，整条都能点/拖
- 波形改为 260 根圆角竖条、端点收窄、悬停高亮和播放头，保留 brass / ink 语义色
- 倍速下拉改成非受控，只更新 `audioRateRef` 和当前音频，不再 setState
- 倍速用 `audioRateRef` + `defaultPlaybackRate`，在 `load()` 后和 `onplay` 时重新应用
- `switchAudio` 增加 toast、当前行闪烁和自动播放上一版
- Node 音频接口支持 `Range`，返回 206 和 `Content-Range`

### 验证

- `npm.cmd run check:studio` 20/20
- 新增「生成参数显示实际引擎」「连续试听跳过缺音频并跟随当前句」「失败后串行重试并汇报结果」「切换历史配音有反馈」「连续换句保持倍速且复用同一个音频元素」「连续试听自动播完整条队列」
- Range 测试：完整请求 200 / 38444 字节；`Range: bytes=1000-1999` 返回 206 / 1000 字节
- 截图确认生成横幅和右栏实际引擎

### 坑

- 生成类卡片不能用 `selectedCast` 推断引擎；用户会在生成过程中点别的台词，必须记录 `genTarget`
- `persist=false` 只代表不落盘，不代表不刷新界面；每句完成要更新 `script`
- 连续试听不能只排 URL，必须保留台词 id，才能跟随、跳过和闪烁
- 重试不要沿用第一遍并发；云端限流时串行反而更快完成
- 播放倍速要用 ref，React 闭包里的 `audioRate` 在长队列里会一直是开始时的值
- 音频拖动依赖 Range；没有 206 时浏览器可能重新请求整个文件
- 连续播放不要每句 `new Audio`；换 src 复用同一个元素才不会被自动播放策略打断
- 任何监听 `current` 的 effect 都不能无条件 `pause()`，连续播放自己会改 `current`
- 波形点击区域要和视觉宽度一致；只画固定宽度竖条会让点击映射错位
- 只给播放器用的倍速值不要放进 React state，否则每调一次都重渲染整页台词列表
- `load()` 会重置倍速，必须同时设置 `defaultPlaybackRate`，并在 `onplay` 再兜一次
- 任何“切换/回退”操作都要有可见反馈，否则用户会以为按钮坏了

## 2026-11-11 · 整章 AI 标注、深度思考和思考过程展示

### 根因

- 标注按 60 句一批，模型看不到整章上下文，跨批的指代、连续对话和称呼容易判错
- MiMo 的结构化任务之前显式关闭 thinking，标注只能靠普通生成；同时非流式请求拿不到 reasoning
- 如果直接把 reasoning 和 content 拼在一起，思考内容会混进 JSON，导致解析失败
- 整本/整章标注没有可视反馈，用户只能看到进度条，不知道模型在想什么

### 完成

- `annotateLines` 默认整章一次发送；超过 6 万字符才按字符切段，切段只作为超长章节的兜底
- 标注请求开启 MiMo `thinking: enabled`、`stream: true`，并从 SSE 的 `delta.reasoning_content` 读取思考，从 `delta.content` 读取 JSON
- `chatJSON` 增加流式解析、`stream_options.include_usage`、`finish_reason` 截断提示；非 SSE 响应自动回退到普通 JSON
- 思考内容只通过 `onProgress.reasoning` 送到界面，不参与 JSON 解析；设置页新增「标注思考模式」开关，默认开
- 工作台 AI 分析进度新增「思考过程」框，流式追加、自动滚到底部、最多保留 12000 字；不显示最终输出
- 提示词要求模型只列关键疑点，不复述原文、不逐句解释，减少无意义的长思考
- 移除按 60 句批次的续跑确认，停止后保留已完成段的结果

### 验证

- SSE mock：请求体包含 `thinking: enabled`、`stream: true`、`max_completion_tokens: 32768`；reasoning 与 JSON 分开，changes 和 usage 正常
- `npm.cmd run check:studio` 14/14，新增「AI 标注显示思考过程」
- 截图确认右栏思考框显示流式文字，且不显示最终结果
- `node --check app/electron/ai.cjs`、`node --check engine/node-server.mjs`、`python -m py_compile engine/server.py` 通过

### 坑

- MiMo 在 thinking 模式下会强制使用 temperature 1.0 / top_p 0.95，传自定义值也不会生效，干脆不传
- `max_completion_tokens` 同时包含思考和回答；长思考会挤掉 JSON 输出，必须留足额度并处理 `finish_reason: length`
- SSE 的 `data:` 行可能被网络分片截断，必须按行缓冲后再 JSON.parse
- reasoning 只能用于展示，不能写进台词、不能参与 JSON 解析；否则会把思考过程当成角色数据
- 之前保存过自定义标注提示词的用户，需要点「恢复内置」才会用新的整章提示词

## 2026-11-11 · 跨段续句合并与规则重拆保留标注

### 根因

- 规则拆分按空行分段后各段独立处理，上一段结尾没有句末标点时，下一段其实还是同一句话，却会单独成句
- 只按「下一段以引号/的/地/得开头」判断续句，覆盖不了 `…特有的 / 可疑言行。`、`…传来了 / 轻快的主题曲`、`…还活着哦 / 没有昏睡哦。` 这类原文分段错误
- 规则重拆直接重建整章 `lines`，旧台词的角色、情绪、语速、音频全部被丢弃；这是实现方式导致，不是拆分规则本身有问题
- AI 标注每批只拿到 60 句和角色名，批与批交界处没有前后句，也没有角色表，跨批指代只能猜

### 完成

- Node 和 Python 拆分都在末尾增加续句合并：前一段是旁白且没有句末标点，后一段也是旁白时，合回同一句
- 续接时按上下文决定是否补逗号：紧接着名词、引号或「的/地/得/了」时直接拼，另起一句时补一个「，」当停顿
- 工作台新增 `segmentsToLines` 和 `carryOverLines`：规则重拆、整本重拆按台词文字精确匹配旧台词，沿用 speaker / emotion / speed / audio / audioHistory
- 只有没被复用的旧音频才调用 `/v1/audio-delete`；旧 speaker 是「未知」而新规则认出具体角色时，用新角色
- AI 标注每批额外带角色表（名字 + 描述）和前后各 4 句上下文；提示词说明 before / after 只作参考、不要返回它们的 id
- 音色页补本地音色 / 云音色说明：本地走 IndexTTS、不消耗云额度；云音色直接调服务商，可加入本地音色库
- 规则重拆确认文案和 AI 菜单说明写清：只拆句、不调用 AI、相同文字保留原标注
- 推荐流程条改为右对齐

### 验证

- 拆分样例：`现在……社团\n\n“blessing software” 的成员。` 合并成一条旁白；对讲机引号仍为「未知」；`她看着墙上“禁止吸烟”的牌子` 仍是整段旁白
- 真实章节 13–21 段：`…特有的 / 可疑言行。`、`…冲击性的 / 突发事件…`、`…传来了 / 轻快的主题曲…`、`…还活着哦 / 没有昏睡哦。` 都合成整句，且最后一句补成「还活着哦，没有昏睡哦。」
- `npm.cmd run check:studio` 13/13，新增用例「规则重拆保留相同文字的角色和音频」
- `node --check engine/node-server.mjs`、`python -m py_compile engine/server.py` 通过

### 坑

- `mergeContinuationSegments` 只处理连续旁白；台词后面跟旁白不能合并，否则会把对白吞掉
- 合并后的台词 `paragraph` 取第一段，切原文时高亮的是句子开头所在段
- 合并跨段时不能一律加逗号：`具有冲击性的 / 突发事件` 加逗号就断错了；只在另起一句时补停顿
- AI 标注不要发送整章原文，每批会重复计费；用角色表 + 前后各 4 句做上下文就够
- 保留旧音频必须先算出复用集合，不能先删后建；否则重拆成功但音频已经没了

## 2026-11-11 · 工作台流程、AI/TTS 拆分和绑定修复

### 根因

- 角色 id 用 `Date.now().toString(36)`，同一毫秒创建两个角色会得到同一个 id；`selected?.id === c.id` 让两个角色同时显示「当前」，`bindLocalToSelected` 按 id 匹配，绑定一个就改了两个
- AI 工具埋在右栏最底部，用户找不到；「生成」和「AI 拆分」的命名也没有区分「文本分析」和「配音」
- 文本 AI 与 TTS AI 混在同一组配置里；模型只能手填
- Node Gradio 代理的 `/health` 固定返回 `model_loaded: true`；远端断开时顶栏仍显示「已加载」
- 规则拆分只按「引号长度 ≤20 + 前面不是句号」判断内联引号，句首的 `"blessing software" 的成员` 会被拆成台词；AI 提示词又鼓励「根据引号里的名字判断说话人」，把对讲机里的加藤惠判给了加藤惠
- 原文视图没有把当前台词段落滚到视野里
- MCP 只在文档里写「客户端控制权限」，代码没有任何限制
- 日志轮转直接用 `rename` 覆盖 `.1`，Windows 上可能失败；设置页也没有大小和清理入口

### 完成

- 新增 `newCastId()`，加载项目时按 id 去重；回归测试覆盖「重复 id 只选中一个」「绑定只作用于一个角色」
- 工作台顶栏新增「AI分析」菜单，集中 AI 重拆、AI 标注、规则重拆；新增流程条；「生成」改名「生成配音」
- AI 进度/日志只在分析中显示，并移到右栏顶部
- 设置页 AI 服务拆成「文本 AI / TTS AI」；新增 `ai:list-models` IPC，支持 MiMo/千问/自定义；文本和 TTS 按名字过滤，分不清就全部显示
- 语音引擎改为「TTS 地址 / API」优先，本机 Python 收进高级折叠项
- Node `/health` 先检查远端 `/config` 可达性，再决定 `ok/model_loaded`；TopBar 失败时清掉 model
- 规则拆分增加「后接 的/地/得/，继续同一句」的内联引号判断；Python 拆分同步
- 重写角色标注/角色提取提示词：引号内名字不等于说话人，设备声音、叙述中的术语、拿不准保留未知
- 原文视图按台词 `paragraph` 定位并高亮；角色页重复 id 去重
- MCP 增加 `SHENGKAN_MCP_PERMISSION` 四档权限和 `get_permissions`；写/生成操作做第二道限制
- 日志 5MB 轮转 + 1 份备份 + 设置页清空

### 验证

- `npm.cmd run check:studio` 12/12
- 规则拆分样例：`"blessing software" 的成员。` 保持旁白；对讲机引号 speaker 为「未知」；`“你好。”他说。` 仍是独立台词
- 模型接口 mock：文本返回 `mimo-v2.6-flash/deepseek-chat`，TTS 返回 `mimo-v2.5-tts/gpt-4o-mini-tts`
- MCP `read` 权限启动，`tools/list` 正常；`get_permissions` 可见
- 日志临时 userData 下 6MB 触发轮转，`.1` 存在；清空释放 6291501 字节
- `node --check` 四个文件、`python -m py_compile` 通过

### 坑

- 同一个 React key/id 被两个角色共用时，所有按 id 的绑定、选中、删除都会双写；以后新增角色一律走 `newCastId`
- 拆分器不能只看引号长度；要看引号后是否还有「的/地/得/，」把句子接下去
- AI 提示词里「引号里的对话」这句话容易被模型理解成「引号里的名字是说话人」；必须明确写“名字在引号里不代表说话人”
- 模型列表接口返回的 `data` 可能是数组、对象或 `output.models`，不能只读一种
- 顶栏状态不要用“上一次成功”的 model 值；连接失败时要把 online/model/gpu 一起清掉

## 2026-11-11 · 浅色编辑室与双主题

### 设计决策

- 用户要「以白色为主」，但纯白界面容易变成通用 SaaS；所以把白色放在「纸」上，工作台底色用纸灰，文稿用纯白，形成书桌和纸的关系
- 主题不是简单的 `prefers-color-scheme` 反相：日间是纸白编辑室，夜间是关灯后的同一间编辑室，绿色和黄铜都要保留
- 项目库用书封而不是卡片：竖排书名、书脊、平涂封面色，既有识别度，也让「小说/剧本」这件事进入界面
- 颜色分工固定：装订绿 = 操作和当前项，黄铜 = 时间/播放头/改动，朱砂 = 错误和删除
- 不用渐变、发光、毛玻璃，避免常见的 AI 界面质感

### 完成

- 重写 `app/src/styles.css`：日间/夜间两套 token，浅色优先
- `app/index.html` 在 React 前读取主题，避免刷新时闪白
- `TopBar` 增加日间/夜间切换、主题持久化、品牌新结构
- 项目库书封增加 `cover-d`，四种封面色轮换
- 角色头像恢复彩色描边；删除按钮改为默认灰色、悬停才变红
- 时间轴色块改为实色填充，不再像线框
- 主按钮增加 `--on-accent`，夜间自动用深色字
- 主题、关闭、播放、台词/章节操作等图标按钮补 `aria-label`
- 台词行、章节行、项目卡补键盘操作
- `prompt.ts` 的弹窗去掉硬编码 z-index，补 dialog 语义
- 顶栏引擎状态每 20 秒刷新一次，启动后才连上的引擎不会一直显示未连接

### 修复与回归

- 根因：工作台的 `checked`、`editing`、`lineStatus` 只按 `line.id` 存，句号在每章都从 1 开始，切章后必然串线
- 修复：切章时清掉勾选/编辑/菜单/原文草稿，`lineStatus` 改成 `章节 id + 句 id` 的键
- 根因：`deleteLine` 先删音频再判断「至少保留一句」，最后一句拒绝删除时音频已经没了
- 修复：先算新数组并拦截，再删音频；同时清掉这句的勾选、状态、编辑态
- 根因：生成用开始时的 `script` 快照整章覆盖，生成期间改别的台词会被写回去
- 修复：`saveChapterLines` 只合并目标章节的目标句，绑到 `projectRef` 最新项目；生成期间目标句文本变了就丢弃旧音频并标记 dirty
- 根因：AI 重拆本章只替换台词，没有清理旧 wav；补上音频清理
- 生成/重拆期间禁止删除、插入、删章节、新建章节，避免异步结果把结构写回来
- 语速滑块拖动时 `updateLine(..., persist=false)`，只在 pointerup / blur / keyup 落盘
- 拖拽提示补 `.docx`；成片导出格式标签改为「导出格式」
- 顶栏引擎状态每 20 秒刷新，避免启动时未连接就一直显示未连接
- 回归脚本：`app/scripts/regression-studio.cjs`，`npm run check:studio`，9 项全绿

### 验证

- `npm.cmd run build` 通过
- `npm.cmd run check:studio` 通过 9/9
- Electron 离屏截图 1600×870：项目库、工作台、角色、成片、设置、导入弹窗，日间/夜间各一套
- 对比度脚本检查：浅色正文 16.3:1，次级 7.2:1，三级 5.3:1；夜间正文 12.4:1
- `gradient` / `letter-spacing` / `backdrop-filter` / `will-change` 检查为空
- 过渡时长检查：交互反馈 0.15–0.18s，没有动画 `width`
- `npx @google/design.md lint DESIGN.md` 通过：0 errors；1 个 warning（没有名为 `primary` 的 token，主色使用 `accent`）
- `npx @google/design.md export --format css-tailwind DESIGN.md` 正常输出 `--color-*`、`--font-*`、`--text-*`

### 坑

- 夜间模式如果直接复用浅色 token，浅绿按钮上的白字只有 1.9:1；需要单独的 `--on-accent`
- 深色主题里「白色卡片」反相后是深色，active 控件不能继续用 `--surface`，否则看起来像凹进去；补了 `--surface-4`
- 书封竖排标题用 `writing-mode: vertical-rl` + `text-orientation: upright`，长标题会从底部裁掉，需要限制高度
- 下拉箭头的旧写法是两个 `linear-gradient` 小三角；按基线要求改成内联 SVG 的 data URI
- `.play-btn` 和主题按钮都是图标按钮，没有 `aria-label` 时屏幕阅读器只会读到一个符号
- 章节操作按钮即使 `opacity: 0` 仍然占宽，1200px 下会把章节标题挤成「雨夜…」；改成绝对定位浮层后才正常
- 每章句号都从 1 开始，任何只按 `line.id` 存的临时状态都会在切章时串线；新增临时状态先问「它属于哪一章」
- 异步生成不能拿开始时的整章快照回写；要么按目标章节合并，要么在操作期间锁住结构修改

## 2026-11-10 · 界面重构

### 设计决策

- 保留「开盘机机壳 + 剧本稿纸」的概念，这是项目自己的识别，不换成通用深色卡片
- 减少方框：按钮默认无边框，用底色和文字色分层；只有输入框、下拉框和拖放区保留表面色
- 铜色只标「当前」：当前章节、当前句、当前角色、播放头，不拿来装饰标题
- 动效一次只做一件事：入场、当前句、弹窗、播放状态；不做全屏漂移或常驻呼吸

### 完成

- 重写 `app/src/styles.css`，合并 `styles-additions.css` 中所有历史覆盖规则；旧文件已移到回收站
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
