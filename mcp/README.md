# 声栞 MCP 服务器

让外部 AI（Claude Desktop、OpenCode、Cursor）直接读写声栞项目：发现台词、角色、情绪有问题时自己改，并留下审计日志。

## 启动

```powershell
cd "D:\AI工作空间\声栞\mcp"
npm install
node server.mjs
```

MCP 走 stdio，不需要端口。引擎地址默认 `http://127.0.0.1:8290`，可用 `SHENGKAN_ENGINE` 覆盖；项目目录默认是仓库下的 `projects/`，可用 `SHENGKAN_PROJECTS` 指向安装版的项目目录。

建项目、规则拆句、生成和导出需要声栞引擎在线：先打开软件，或用 `open_app`（full 权限）启动。只读项目和改台词不依赖引擎。

## 工具

### 读取

| 工具 | 作用 | 最低权限 |
|---|---|---|
| `get_permissions` | 查看当前级别和可用工具 | read |
| `get_health` | 查看引擎、IndexTTS 版本、显存 | read |
| `list_voices` | 列出本地音色，可按名字/性别/年龄过滤 | read |
| `list_projects` | 列出活动项目，可选包含回收站 | read（回收站 full） |
| `read_project` | 读项目标题、settings、章节、角色 | read |
| `read_lines` | 读某一章全部台词和音频版本 | read |
| `get_audit` | 查看最近 AI 操作 | read |

### 项目、章节和台词

| 工具 | 作用 | 最低权限 |
|---|---|---|
| `create_project` | 新建项目，可带章节原文并规则拆句 | edit |
| `update_project` | 改项目标题 | edit |
| `add_chapter` | 加一章；传 `source` 规则拆句，或传 `lines` 直接写入 | edit |
| `update_chapter` | 改章节标题或原文 | edit |
| `replace_chapter_lines` | 覆盖整章台词，并清理被替换台词的旧音频 | edit |
| `add_line` | 插入一句台词 | edit |
| `update_line` | 改台词、角色、情绪、语速 | edit |
| `delete_line` | 删除一句台词并清理音频 | edit |
| `split_chapter` | 调引擎规则拆句，只返回结果不写入 | edit |

### 角色和音色

| 工具 | 作用 | 最低权限 |
|---|---|---|
| `add_cast` | 新增角色，可直接绑定音色 | edit |
| `update_cast` | 改名、描述、颜色或音色；改名同步台词 | edit |
| `bind_voice` | 给角色绑定本地或云音色，旧绑定进 `voiceHistory` | edit |
| `list_voices` | 找本地参考音频路径 | read |

### 生成和导出

| 工具 | 作用 | 最低权限 |
|---|---|---|
| `generate_line` | 为一句台词生成音频 | generate |
| `generate_chapter` | 生成整章待生成/改动的台词 | generate |
| `generate_project` | 按章节顺序分批生成，默认最多 50 句 | generate |
| `export_audio` | 导出 WAV、SRT 或分轨 ZIP | generate |

### 完全控制

| 工具 | 作用 | 最低权限 |
|---|---|---|
| `trash_project` | 项目移进回收站 | full |
| `restore_project` | 从回收站恢复 | full |
| `open_app` | 启动 `start.bat`（Windows） | full |

`update_line` 会把句子标成 `dirty`，软件里只重生成改动过的句子。
`generate_line` / `generate_chapter` 会把上一版音频推进 `audioHistory`，最多保留 2 个版本。
`generate_chapter` / `generate_project` 只支持已绑定本地音色的角色；云音色会跳过，返回 `skippedLines`，因为云 TTS 的 Key 和代理在 Electron 主进程里，MCP 进程无法直接调用。
`export_audio` 只导出已有音频的句子；缺音频的句子会跳过。
`list_projects` 默认只列 `projects/` 下的活动项目；项目在回收站时加 `includeTrash: true`，并且需要 `full` 权限。

## 全流程示例

让 AI 从零做一本：

1. `open_app` 启动软件（可选，也可以手动开）
2. `create_project({ title, chapters: [{ title, source }] })` 建项目和章节，规则拆句并自动补角色
3. `read_project` 看角色和章节；`read_lines` 读台词
4. `list_voices` 找本地音色，`bind_voice({ cast, voicePath })` 绑定
5. `generate_chapter({ chapterId })` 先生成一批，或 `generate_project({ limit })` 分批跑
6. `export_audio({ chapterId, formats: ["wav", "srt"] })` 导出
7. `get_audit` 汇报做过什么

AI 分章、角色判断和台词改写由 MCP 客户端自己完成，再用 `add_chapter` / `replace_chapter_lines` / `update_line` 写回。声栞只负责存储、规则拆句、TTS 和导出。

## 权限

通过环境变量 `SHENGKAN_MCP_PERMISSION` 控制，默认 `generate`：

| 级别 | 能做什么 |
|---|---|
| `read` | 列项目、读项目、读台词、查音色和审计 |
| `edit` | 只读 + 建项目/章节/台词/角色/音色 + 拆句预览 |
| `generate` | 可改 + 生成单句/整章/整本 + 导出音频（默认） |
| `full` | 可生成 + 回收站 + 一键启动软件 |

启动前设置，例如只读：

```powershell
$env:SHENGKAN_MCP_PERMISSION = "read"
node server.mjs
```

MCP 客户端仍然决定要不要调用某个工具；声栞这一侧再按级别做第二道限制。用 `get_permissions` 可以在会话里直接确认当前级别。

## Claude Desktop

`claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "shengkan": {
      "command": "node",
      "args": ["D:/AI工作空间/声栞/mcp/server.mjs"]
    }
  }
}
```

## OpenCode

项目或全局 `opencode.json`：

```json
{
  "mcp": {
    "shengkan": {
      "type": "local",
      "command": ["node", "D:/AI工作空间/声栞/mcp/server.mjs"],
      "enabled": true
    }
  }
}
```

## 建议给 AI 的提示词

> 你是声栞的台词校对。先用 read_project 和 read_lines 读第三章，检查：
> 1. 角色是否分错（尤其引号前后的“XX说”）
> 2. 情绪是否和上下文冲突
> 3. 是否有断句导致语义不通
> 只改有问题的句子，用 update_line，一次改一句。改完用 get_audit 汇报。

## 安全

- 读取 `projects/<目录>/project.json`；项目在 `projects/.trash/` 时默认不可读，需要 `full` 权限才能列出回收站摘要。
- 每次修改写 `mcp/data/audit.jsonl`，软件设置页可查看。
- MCP 与桌面应用共用内容版本校验和排他锁；异步写回绑定原项目，检测到外部修改时拒绝覆盖。回收站移动、还原同时持有源/目标锁，操作被拒绝时不会移动项目。
- 保存失败会尝试在项目根 `.recovery/` 留下唯一恢复草稿，错误中返回路径；草稿保留新音频引用。旧音频清理仅在项目保存成功后执行，不自动合并或强制覆盖。
- 遇到 `PROJECT_BUSY`，可在应用冲突提示或回收站中显式恢复已退出进程的遗留锁；活锁、权限不明或未知格式锁不抢占。工具列表和权限级别保持不变。
- 权限由 `SHENGKAN_MCP_PERMISSION` 控制，默认 `generate`；只想校对文本时用 `edit`，只读时用 `read`。
- `generate_line` 会占用显存，建议在不需要生成时用 `edit` 或 `read` 启动。
- 不要把 API Key 写进 MCP 配置或仓库；MiMo Key 只在 `%APPDATA%/shengkan/ai.json`。

## 排错：OpenCode 里 MCP 显示红点

红点表示 MCP 进程没有成功启动，最常见原因是 `mcp/node_modules` 还没安装：

```powershell
cd "D:\AI工作空间\声栞\mcp"
npm.cmd install
node server.mjs
```

`node server.mjs` 会停在 stdio 等待，不报错就说明依赖和代码都能启动；按 `Ctrl+C` 退出。

然后确认 OpenCode 配置：

```json
{
  "mcp": {
    "servers": {
      "shengkan": {
        "type": "local",
        "enabled": true,
        "command": [
          "C:/Program Files/nodejs/node.exe",
          "D:/AI工作空间/声栞/mcp/server.mjs"
        ]
      }
    }
  }
}
```

改完配置需要重启 OpenCode 才会重新拉起 MCP。仍然红点时看 OpenCode 的 MCP 日志，通常是 `Cannot find package '@modelcontextprotocol/sdk'`，重跑 `npm.cmd install` 即可。

当前活动项目是 `p-mw91apwo`。`p-mw7phvqs` 和 `p-mw81gv9b` 在 `projects/.trash/`，MCP 默认只列活动项目；需要在应用回收站还原后才能读写。
