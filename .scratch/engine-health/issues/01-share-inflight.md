# 01：合并正在进行的健康检查

**What to build:** 顶栏、工作台和设置同时检查时共享一次请求；完成后下一次检查重新获取状态。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 多个并发调用只发一次请求，所有等待者收到结果。
- [ ] 成功、HTTP 失败和连接失败后，下一次调用均重新请求。
- [ ] 保留健康检查 interface 和调用点，不缓存结果。
- [ ] 先运行失败测试，再实现；相关测试和构建通过。
