# 发布到 GitHub

这份文档只说明仓库命名、可见性、许可证和发布流程。当前已经安装 GitHub CLI（`gh`），按官方 OAuth 方式连接 GitHub，并已发布到公开仓库。

## 当前状态

- `gh` 版本：2.104.0，安装路径 `C:\Program Files\GitHub CLI\gh.exe`
- GitHub 账号：已通过 OAuth 登录，`gh auth status` 可查看当前账号
- OpenCode GitHub MCP：已配置为 `github`，连接状态 `connected`
- 当前工具组：`repos,users,context`（建仓库、读仓库、用户信息、当前账号）；需要 Issue/PR/Actions 时再扩展
- 仓库：[kysl2333/shengkan](https://github.com/kysl2333/shengkan)（公开）
- 本地分支：`main`，远端 `origin` 已配置
- 安装包：`release/shengkan-1.0.1-setup.exe`，带最新 logo 和 GPL-3.0 `LICENSE`
- 安装器目录保护：源码已写入 `app/build/installer.nsh`，尚未构建；v1.0.1 Release 不含
- Release：[v1.0.1](https://github.com/kysl2333/shengkan/releases/tag/v1.0.1)，已上传安装程序

## 在 OpenCode 里查看连接器

OpenCode 没有 WorkBuddy 那种「连接器」卡片，GitHub 是以 **MCP server** 的形式接入的：

1. 在 OpenCode 里运行 `/mcps`，列表里应看到 `github`，状态为已连接。
2. 命令行查看：

   ```powershell
   & "$env:LOCALAPPDATA\Programs\ai.opencode.desktop\resources\opencode-cli.exe" mcp list
   ```

   输出里应有 `✓ github connected`。
3. 配置位置：`%USERPROFILE%\.config\opencode\opencode.json` 的 `mcp.servers.github`。
4. Token 位置：`%USERPROFILE%\.config\opencode\secrets\github-token`，只在用户目录，不进入仓库。
5. `gh` 和 OpenCode 是两条并行的认证链路：`gh` 用于命令行推送和 Release，OpenCode MCP 用于会话内直接读写 GitHub。

当前限制为 `repos,users,context` 工具组，避免 GitHub 的几十个工具占用上下文。需要更多能力时，把配置里的 `X-MCP-Toolsets` 改成：

```json
"X-MCP-Toolsets": "repos,users,issues,pull_requests,actions"
```


## 仓库命名

两个候选：

| 名称 | 适合 | 说明 |
|---|---|---|
| `shengkan` | 技术仓库、安装包、目录和 appId 一致 | 拼音稳定，不会因为中文名或英文品牌调整而变；安装包和用户数据目录已经用这个名字 |
| `shiori-voices` | 品牌展示、面向普通用户 | 和界面上的「声栞 / Shiori Voices」一致，更容易被记住 |

建议：**仓库名用 `shengkan`，README 标题继续用「声栞 · Shiori Voices」**。这样代码、安装包、数据目录和仓库地址保持同一套命名；品牌名只出现在界面和文档里。

## 公开还是私有

### 公开仓库

- 任何人都能查看代码、下载 Release
- 适合让用户下载安装包、提交 Issue
- 发布前必须确认没有 API Key、项目数据、参考音频、日志和本机路径
- 当前隐私检查已通过：63 个跟踪文件 0 命中；`.scratch/` 已从索引移除

### 私有仓库

- 只有你和被邀请的协作者能看到
- 仍然可以创建 Release，但下载需要登录 GitHub
- 适合还在打磨、暂时不想公开代码的阶段

建议：**先私有跑通仓库和 Release，确认安装包没问题后再转公开**。GitHub 支持在仓库设置里随时切换可见性。

## 许可证

已选择 **GPL-3.0**。

| 许可证 | 特点 | 适合 |
|---|---|---|
| GPL-3.0 | 强 copyleft：保留版权声明，衍生作品必须继续开源，分发时提供源代码 | 希望别人使用或修改后继续开源；当前选择 |
| Apache-2.0 | 允许闭源衍生，要求保留声明和 NOTICE | 只要求署名，不限制闭源 |
| MIT | 最宽松，只保留版权声明 | 不限制闭源 |

GPL-3.0 的要求：

- 分发源码或二进制时附带 `LICENSE`
- 保留原项目的版权声明
- 修改过的版本标明修改日期
- 衍生作品继续使用 GPL-3.0，并提供对应的源代码
- 不提供担保

仓库根目录已经有 `LICENSE`（GPL-3.0 全文），README 末尾有许可证说明。安装包通过 `extraResources` 附带 `LICENSE`。

## 创建仓库

确认名称和可见性后，在项目根目录执行：

```powershell
gh repo create shengkan --public --source=. --remote=origin --push
```

私有仓库把 `--public` 换成 `--private`。

如果仓库已经在 GitHub 网页上创建好：

```powershell
git remote add origin https://github.com/<用户名>/shengkan.git
git push -u origin main
```

## 发布 Release

等 logo 定稿、重新打包后：

```powershell
gh release create v1.0.1 `
  "release/shengkan-1.0.1-setup.exe" `
  --title "声栞 v1.0.1" `
  --notes "首个公开版本"
```

Release 附件只放最终安装包，不要放测试构建。安装包未签名，Windows 可能提示「未知发布者」，可以在 Release 说明里写清楚。

## 发布前检查

- [x] logo 已选定，源文件为 `logo/shiori-logo.png`
- [x] 生成 `.ico`、配置 `build.icon`
- [x] `npm.cmd run build` 通过
- [x] `npm.cmd run dist` 通过
- [x] 安装包在干净用户目录启动，项目库为空、默认提示词正常
- [x] 仓库没有 API Key、`ai.json`、`projects/`、`voices/`、日志或参考音频
- [x] README 的下载链接、系统要求、数据位置和许可证已更新
- [x] 决定仓库名和可见性：`kysl2333/shengkan` · 公开
- [x] 决定许可证并添加 `LICENSE`
- [x] 发布 v1.0.1 并上传 `shengkan-1.0.1-setup.exe`

## 和 WorkBuddy 的关系

WorkBuddy 的 GitHub 连接器使用 GitHub OAuth 授权，读取类操作走 GitHub MCP，写操作通常用 `gh` CLI 兜底。这里采用同一套官方组件，并且已经接好：

- OAuth：`gh auth login --web`，账号已完成授权
- 读仓库、Issue、PR：OpenCode 的 `github` MCP server（当前 `repos,users,context`）
- 建仓库、推送、发 Release：`gh`

不需要安装 WorkBuddy 客户端，也不需要在代码里保存 Token。OpenCode 里的入口是 `/mcps`，不是「连接器」页。
