# 01：合并正在进行的健康检查

**What to build:** 顶栏、工作台和设置同时检查时共享一次请求；完成后下一次检查重新获取状态。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 多个并发调用只发一次请求，所有等待者收到结果。
- [x] 成功、HTTP 失败和连接失败后，下一次调用均重新请求。
- [x] 保留健康检查 interface 和调用点，不缓存结果。
- [x] 先运行失败测试，再实现；相关测试和构建通过。

## Answer

- `app/src/api.ts` 仅复用 `getHealth()` 的在途 Promise，`finally` 在成功或失败后释放；未调整超时（留给工单 02）。
- 临时脚本 `C:\Users\kybox\AppData\Local\Temp\opencode\health-01-inflight-regression.cjs` 用 Node `stripTypeScriptTypes` + `vm.SourceTextModule` 加载真实源码，通过公开 `getHealth()` 验证三个并发等待者的结果/错误传播与下一轮重新请求。
- 红灯：原实现并发请求数 `3 !== 1`；绿灯：成功、HTTP 503、网络失败三种情形全部通过。运行：`node --experimental-vm-modules <脚本路径> <worktree根目录>`。
- worktree 无依赖，`npm.cmd run build` 因找不到 `tsc` 无法直接执行；使用主仓库已有 TypeScript/Vite 和系统临时配置完成等价类型检查与生产构建，均退出 0，无新增依赖或仓库配置修改。
- 隐藏 Electron 窗口使用独立系统临时 profile 验证当前 worktree 构建：工作台回归 20/20，已有播放回归 21/21，均退出 0。测试与构建辅助脚本保留系统临时目录，不提交。
