# 声栞 MCP 服务器

让外部 AI（Claude Desktop、OpenCode、Cursor）直接读写声栞项目：发现台词、角色、情绪有问题时自己改，并留下审计日志。

## 启动

```powershell
cd "D:\AI工作空间\声栞\mcp"
npm install
node server.mjs
```

MCP 走 stdio，不需要端口。引擎地址默认 `http://127.0.0.1:8290`，可用 `SHENGKAN_ENGINE` 覆盖；项目目录默认是仓库下的 `projects/`，可用 `SHENGKAN_PROJECTS` 指向安装版的项目目录。

## 工具

| 工具 | 作用 | 最低权限 |
|---|---|---|
| `list_projects` | 列出活动项目，可选包含回收站 | read（回收站 full） |
| `read_project` | 读项目标题、章节、角色 | read |
| `read_lines` | 读某一章全部台词 | read |
| `update_line` | 改台词、角色、情绪、语速，写审计 | edit |
| `split_chapter` | 调引擎拆原文，只返回结果不写入 | edit |
| `generate_line` | 调 IndexTTS 为某句生成音频 | generate |
| `get_audit` | 查看最近 AI 操作 | read |
| `get_permissions` | 查看当前权限和可用工具 | read |

`update_line` 会把句子标成 `dirty`，软件里只重生成改动过的句子。
`generate_line` 会把上一版音频推进 `audioHistory`，最多保留 2 个版本。
`list_projects` 默认只列 `projects/` 下的活动项目；项目在回收站时加 `includeTrash: true`，并且需要 `full` 权限。

## 权限

通过环境变量 `SHENGKAN_MCP_PERMISSION` 控制，默认 `generate`：

| 级别 | 能做什么 |
|---|---|
| `read` | 列项目、读项目、读台词、查审计 |
| `edit` | 只读 + 修改台词/角色/情绪/语速 + 拆句预览 |
| `generate` | 可改 + 调 TTS 生成音频（默认） |
| `full` | 可生成 + 查看回收站项目列表 |

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
