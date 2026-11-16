# 01：对齐 TTS 等待预算

**What to build:** 两至四分钟的生成不被两分钟客户端超时中断。

**Blocked by:** None

**Status:** resolved

- [x] TTS 为 240 秒，普通请求为 120 秒。
- [x] 预算断言和缩放时钟的 150 秒生成先红后绿。
- [x] 构建通过，提交 a24acc8。
