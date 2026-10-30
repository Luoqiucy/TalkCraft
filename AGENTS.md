# 项目开发约定

- 按 docs/PLAN.md、PRD.MD、docs/PROGRESS.md 和最新 reports 报告接续阶段开发，保护用户修改和未保存录音。
- Windows 开发应用只保留一个最新入口：`src-tauri/target/debug/TalkCraft.exe`。不要再交付带轮次或功能后缀的历史 EXE。
- 使用 `scripts/build-windows.ps1` 构建并更新这个入口：先在临时目录构建，成功后替换，再删除 debug 顶层旧的 TalkCraft / talkcraft-desktop / wireless-ai-mic 应用 EXE。失败时保留上一版。
- 若应用正在运行，停止替换并告知需保存录音后退出；不得为了清理或构建擅自结束用户进程。
- 不删除 `.tools`、`node_modules`、构建依赖及测试工具中的 EXE；本规则仅管理项目应用交付文件。
- 后续报告和启动说明统一链接最新入口。当前仅开发版，安装包按用户要求留到 Phase 4。
