# 01：版本校验与排他写入

**Status:** resolved

**Blocked by:** None

- [x] 内容版本校验、排他锁、完整文件替换集中在共享 module。
- [x] Electron 和 MCP 接入，MCP 异步项目对象绑定原文件。
- [x] 临时项目与跨进程回归先红后绿，8 个竞争进程仅一个成功，错误注入保留原件。
