# 项目开发约定

- 按 docs/PLAN.md、PRD.MD、docs/PROGRESS.md 和最新 reports 报告接续阶段开发，保护用户修改和未保存录音。
- Windows 开发应用只保留一个最新入口：`src-tauri/target/debug/TalkCraft.exe`。不要再交付带轮次或功能后缀的历史 EXE。
- 使用 `scripts/build-windows.ps1` 构建并更新这个入口：先在临时目录构建，成功后替换，再删除 debug 顶层旧的 TalkCraft / talkcraft-desktop / wireless-ai-mic 应用 EXE。失败时保留上一版。
- 若应用正在运行，停止替换并告知需保存录音后退出；不得为了清理或构建擅自结束用户进程。
- 不删除 `.tools`、`node_modules`、构建依赖及测试工具中的 EXE；本规则仅管理项目应用交付文件。
- 后续报告和启动说明统一链接最新入口。当前仅开发版，安装包按用户要求留到 Phase 4。
- 源码同步到私有仓库 `Luoqiucy/TalkCraft`，流程见 `docs/RELEASE.md`：从 `main` 建 `feat/` `fix/` `docs/` `chore/` 分支，提交信息用 Conventional Commits，用户可见改动记入 `CHANGELOG.md` 的 `[Unreleased]`，推送后开拉取请求并等 CI 通过；不直接推送 `main`。
- 发版用 `node scripts/release-version.mjs set X.Y.Z` 统一改版本号，合并后推送 `vX.Y.Z` 标签，由 Release 工作流生成 GitHub Release 作为更新通知。合并、打标签和发布前先征得用户同意，除非用户已明确授权自动发布。
