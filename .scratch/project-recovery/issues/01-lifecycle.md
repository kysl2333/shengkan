# 01：遗留锁和项目生命周期

Status: resolved

- [x] 锁记录持有者，显式恢复可确认退出的进程；拒绝活锁、旧格式、未知来源。
- [x] 保存、回收站移动/还原/清理使用稳定路径、有序持锁。
- [x] 提交前再次检查外部修改；目标消失不得重新创建空项目。
- [x] 回收站通过严格校验的 trashName 显式恢复遗留锁，IPC、preload、ProjectsBridge 和 Library 入口接通，仅 PROJECT_BUSY 时显示按钮。
- [x] 多锁释放失败仍逐锁尝试；业务错误优先，无业务错误时汇总抛出释放错误。
- [x] 临时 review 回归 2/2、recovery-locks/lifecycle/mcp 和 npm.cmd run build 通过；不操作真实用户数据，不提交临时测试。
