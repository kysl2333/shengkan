# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, or
- **`GLOSSARY-MAP.md`** at the repo root if it exists: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this repo):

```
/
├── GLOSSARY.md
├── docs/adr/
├── app/                 ← Electron + React UI
├── engine/              ← Gradio 代理 / IndexTTS 本地引擎
├── mcp/                 ← MCP stdio server
├── projects/            ← 用户数据，不进 Git
└── voices/              ← 音色数据，不进 Git
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

## 声栞的固定词汇

- **项目 / project**：`projects/<目录>/project.json`
- **章节 / chapter**：项目里的 `chapters[]`
- **台词 / line**：章节里的 `lines[]`
- **角色 / cast**：项目级 `casts[]`；工作台右侧只显示本章出现的角色
- **音色 / voice**：`voices/` 下的参考音频；云音色在 `voices/cloud`
- **音频版本 / audioHistory**：每句最多 2 个，当前 `audio` + 1 个历史
