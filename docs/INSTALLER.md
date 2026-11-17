# 安装器目录保护

面向开发和发布流程。用户安装说明看根目录 [README.md](../README.md)。

## 背景

electron-builder 的 NSIS 卸载器在卸载时执行：

```nsis
RMDir /r $INSTDIR
```

它会递归删除整个安装目录，不区分声栞文件和用户后来放进去的文件。默认安装目录 `%LOCALAPPDATA%\Programs\shengkan` 是专用目录，所以正常安装/卸载没有问题；但如果用户把声栞装进一个已经有其他文件的目录，卸载会误删那些文件。

实测结果：

- 临时安装目录里的无关文件会被卸载器一起删除
- `%APPDATA%\shengkan\ai.json`、`Documents\shengkan-projects`、`Documents\shengkan-voices` 默认不会被删除
- 桌面快捷方式、开始菜单项和卸载注册表项会正常清理

## 方案 B

源码已加入 `app/build/installer.nsh`，做四件事：

1. **安装目录强制子目录**
   - 自定义目录如果不是以 `\shengkan` 结尾，自动追加 `\shengkan`
   - 静默安装 `/S /D=路径` 也走同一套逻辑
   - 这样 `D:\Tools` 会变成 `D:\Tools\shengkan`，不会直接占用 `D:\Tools`

2. **非空目录拒绝**
   - 目标目录非空时，只有两种情况允许继续：
     - 存在 `.shengkan-install` 标记
     - 同时存在 `shengkan.exe` 和 `Uninstall shengkan.exe`（兼容 v1.0.1 旧安装）
   - 其他非空目录直接退出安装，并提示改用默认目录或空目录
   - 退出码为 1，需要重新运行安装器并选择默认目录或空目录

3. **目录标记**
   - 安装完成后在 `$INSTDIR` 写入 `.shengkan-install`
   - 标记隐藏，卸载器用它确认目录属于声栞

4. **卸载前检查标记**
   - 普通卸载时，如果缺少 `.shengkan-install`，停止卸载并提示，避免误删非声栞目录
   - 升级安装时跳过检查，旧版本安装目录仍可正常覆盖

## 改动文件

- `app/build/installer.nsh`：新增安装目录准备、非空检查、标记写入、卸载标记检查
- `app/package.json`：`build.nsis.include` 指向 `build/installer.nsh`

## 当前状态

**源码已改，但还没有构建。** 已发布的 v1.0.1 安装包不包含这套保护，仍然只有 README 和 Release 说明里的警告。

下次加功能、重新执行 `npm.cmd run dist` 时，这套脚本才会进入新的安装包。构建后需要重新验证，并发布新版本号。

## 构建后的测试清单

1. 默认目录安装，确认成功，目录里有 `.shengkan-install`
2. 自定义目录 `D:\Tools`，确认实际安装到 `D:\Tools\shengkan`
3. 自定义目录 `D:\已有文件\shengkan`（非空且不是声栞），确认安装被拒绝
4. 已有 v1.0.1 安装目录升级，确认不误判、不删除旧目录
5. 静默安装 `/S /D=<空目录>`，确认成功并写入标记
6. 静默安装 `/S /D=<非空无关目录>`，确认拒绝
7. 正常卸载，确认安装目录被删除，`Documents` 项目和音色、`%APPDATA%\shengkan` 保留
8. 删除 `.shengkan-install` 后再卸载，确认卸载停止，不删除目录

## 边界

- 安装完成后，用户如果又把其他文件放进安装目录，卸载仍会删除它们
- 从 v1.0.1 升级时，旧卸载器仍按旧逻辑处理旧安装目录；新保护从新安装包开始生效
- 卸载器被复制到其他目录运行时，缺少标记会拒绝删除
