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

| 工具 | 作用 |
|---|---|
| `list_projects` | 列出活动项目，可选包含回收站 |
| `read_project` | 读项目标题、章节、角色 |
| `read_lines` | 读某一章全部台词 |
| `update_line` | 改台词、角色、情绪、语速，写审计 |
| `split_chapter` | 调引擎拆原文，只返回结果不写入 |
| `generate_line` | 调 IndexTTS 为某句生成音频 |
| `get_audit` | 查看最近 AI 操作 |

`update_line` 会把句子标成 `dirty`，软件里只重生成改动过的句子。
`generate_line` 会把上一版音频推进 `audioHistory`，最多保留 2 个版本。
`list_projects` 默认只列 `projects/` 下的活动项目；项目在回收站时加 `includeTrash: true` 才能看到。

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

- 读取 `projects/<目录>/project.json`；项目在 `projects/.trash/` 时默认不可读，需要先在应用回收站还原。
- 每次修改写 `mcp/data/audit.jsonl`，软件设置页可回滚。
- `generate_line` 会占用显存，建议在软件里把权限设为「可改台词和角色」时不要开放生成。
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
