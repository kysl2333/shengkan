# 🚀 声栞 v1.0.1

首个公开版本。1.0.0 是内部整理版本，不单独发布。

## ✨ 能做什么

- 📚 导入 `.txt / .md / .epub / .docx`，按章节整理文本
- 🎭 规则拆句，文本 AI 标注说话人、情绪和语速
- 🎙️ 角色跨章节管理，本地音色和云端音色按角色绑定
- 🖥️ 本地 IndexTTS 2.0 / 2.5，或小米 MiMo / 千问 / 自定义 TTS
- 🎧 单句、勾选、整章、整本生成配音，失败保留旧音频
- 🎬 按章节导出 WAV、SRT 和分轨 ZIP，也支持整本导出

## 🎨 这个版本的变化

- 新品牌图标「卷边纸页」，EXE 和安装包都已使用
- 窗口标题改为「声栞 · Shiori Voices」，顶部品牌改为「声栞 台词配音工作台」
- 首次安装会显示完整的默认分章提示词和角色标注提示词
- 安装包附带 GPL-3.0 许可证
- 项目库、音色库、AI 配置和日志都从空白开始，不附带示例数据

## 📦 安装

- 下载 `shengkan-1.0.1-setup.exe`，Windows 10 / 11 x64
- 安装包未签名，Windows SmartScreen 可能提示「未知发布者」
- SHA-256：

```text
4953EEBCEE12F12EFF7B906A8164EE13B0DFE447418B93921A30E5F4E026BA3E
```

## 🔒 隐私

- API Key 只保存在本机 `%APPDATA%/shengkan/ai.json`
- 项目、音色和生成音频不会上传到声栞的服务器
- 只有你主动调用 AI 时，相关文本或音频才会发送给你配置的服务商

## ⚠️ 已知限制

- 不附带 IndexTTS 模型权重和参考音频，需要自己准备
- 本地配音需要先启动 IndexTTS WebUI，或在本机 Python 模式配置好环境
- 云 TTS 需要自己的 API Key
- 整本角色标注会消耗较多 token，耗时取决于章节数量

## 📖 相关链接

- [README](https://github.com/kysl2333/shengkan#readme)
- [版本里程碑](https://github.com/kysl2333/shengkan/blob/main/RELEASES.md)
- [许可证 GPL-3.0](https://github.com/kysl2333/shengkan/blob/main/LICENSE)
