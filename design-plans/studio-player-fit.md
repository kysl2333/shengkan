# 播放器在窄窗内保留完整控件与进度条

Written against: fa42049

执行状态：已实现并验证。实际中栏 owner 为 .script-wrap；宽度不超过 540 CSS px 时收紧间距，不超过 440 CSS px 时分两行且波形独占末行。1280/1600、1.0/1.6 倍缩放、长队列、波形拖动和倍速验证均通过。

## Evidence chain

- Surface：工作台 1280×1000、1.6 倍缩放、日间与夜间。
- Problem：播放器 clientWidth 304，scrollWidth 329；倍速控件越出中栏，波形被压缩。
- Design evidence：AGENTS 播放器波形必须铺满点击区域、进度可拖动；现有三栏窄窗样式及用户提供截图。
- Owner：styles.css .player、.player-right、.wave；Studio.tsx 保持现有控件。
- Scope：播放器局部容器宽度适配。
- Uncertainty：窄窗阈值须以实际中栏尺寸验证，不能单靠窗口宽度。

## Design decision

现有 flex 播放器在中栏空间不足时换成两行：播放、时间、倍速等控件在首行，波形独占第二行。按中栏容器宽度触发；不隐藏播放、倍速、跟随或拖动功能，不缩小正文或修改全局缩放。

## Reuse

- 现有播放器控件、语义 token 和 range 波形；不引入依赖或新控件。
- Exemplar：现有 .player 与 .wave。

## Changes

1. styles.css：在工作台中栏建立局部 inline-size container；空间不足时播放器自动增高、允许换行，波形占完整行，减少必要间距。
2. 不改台词网格、侧栏宽度或播放逻辑。

## Scope

- Inherit：工作台单句与连续播放器。
- Verify：1280、1600 宽及 1.0/1.6 缩放，日间/夜间；连续模式跟随按钮可见。
- Exclude：成片播放器、顶栏、角色页与台词行整体重设计。

## Validation

- 所有播放器控件在容器内，scrollWidth 不大于 clientWidth，波形有实际宽度。
- 波形点击/拖动和倍速不受影响；build 和 check:studio 通过。

## Stop conditions

- 如需隐藏功能或改变整体三栏结构，应先确认产品取舍。

## Design documentation

- CHANGELOG 最新条目补一句，DEVLOG 记录中栏尺寸与缩放关系。
