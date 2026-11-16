# 失败反馈统一使用朱砂

Written against: fa42049

执行状态：已实现并验证。日间/夜间失败颜色与成功恢复、build、check:studio 均通过；Settings 两处失败结果的文字与状态点使用 --danger，单句生成失败 toast 显式使用 error。

## Evidence chain

- Surface：工作台单句生成失败、设置文本 AI 与当前引擎连接测试失败。
- Problem：设置失败文字沿用成功绿，失败 toast 强调边也为绿色；与同次失败的行内朱砂状态矛盾。
- Design evidence：根目录 DESIGN.md Colors，绿色用于操作/当前/成功，朱砂用于错误；docs/DESIGN.md 颜色表约束失败。
- Owner：Settings.tsx 两处 test-result；Studio.tsx showToast 和 toast；styles.css 对应样式。
- Scope：只补显式失败变体，不改测试或生成逻辑。
- Uncertainty：须用隔离 Electron 触发失败，验证计算颜色。

## Design decision

失败结果文字和状态点、单句生成失败 toast 强调边使用既有 --danger；成功样式保持原状。

## Reuse

- 复用 --danger、--ok、现有 test-result 与 toast，不新建提示系统。
- Exemplar：.line-status.error。

## Changes

1. Settings.tsx：两处连接结果 ok:false 应用 error 变体，状态点使用失败色。
2. Studio.tsx：showToast 支持显式错误语义，仅单句生成失败传入；保留现有文本消费与自动消失行为。
3. styles.css：局部 error 变体，不覆盖成功或普通提示。

## Scope

- Inherit：两个连接检查及单句生成失败。
- Verify：成功测试与普通 toast、连续播放回归。
- Exclude：其他页面、配置保存逻辑、主题重设计。

## Validation

- 隔离失败响应验证文字/点/边线等于 --danger；成功恢复为 --ok。
- 日间/夜间都验证；build、check:studio 及离线播放回归通过。

## Stop conditions

- 修复需要改配置/真实请求或增加新依赖时停止。

## Design documentation

- CHANGELOG 最新条目补一句，DEVLOG 对应根因补一句，不改设计规范。
