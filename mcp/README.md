# 声栞 MCP 服务器

让外部 AI（Claude Desktop、OpenCode、Cursor）直接读写声栞项目：发现台词、角色、情绪有问题时自己改，并留下审计日志。

## 启动

```powershell
cd "D:\AI工作空间\声栞\mcp"
npm install
node server.mjs
```

MCP 走 stdio，不需要端口。引擎地址默认 `http://127.0.0.1:8290`，可用 `SHENGKAN_ENGINE` 覆盖。

## 工具

| 工具 | 作用 |
|---|---|
| `read_project` | 读项目标题、章节、角色 |
| `read_lines` | 读某一章全部台词 |
| `update_line` | 改台词、角色、情绪、语速，写审计 |
| `split_chapter` | 调引擎拆原文，只返回结果不写入 |
| `generate_line` | 调 IndexTTS 为某句生成音频 |
| `get_audit` | 查看最近 AI 操作 |

`update_line` 会把句子标成 `dirty`，软件里只重生成改动过的句子。

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

- 默认只读写 `mcp/data/project.json`，不碰其他文件。
- 每次修改写 `mcp/data/audit.jsonl`，软件设置页可回滚。
- `generate_line` 会占用显存，建议在软件里把权限设为「可改台词和角色」时不要开放生成。
