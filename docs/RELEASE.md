# 版本管理与发布

私有仓库：`https://github.com/Luoqiucy/TalkCraft`。默认分支 `main` 只通过拉取请求更新。

## 日常改动

1. 从最新 `main` 建分支，名字带类型前缀：`feat/…` 新功能、`fix/…` 修复、`docs/…` 文档、`chore/…` 构建与杂项、`ci/…` 流水线。
2. 提交信息用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：`feat(agent): …`、`fix(webpage): …`、`docs: …`。正文写清原因和验证结果。
3. 用户能感受到的变化写进 `CHANGELOG.md` 的 `[Unreleased]`，分“新增 / 修复 / 变更 / 移除”。
4. 推送分支并开拉取请求。`CI` 工作流会自动运行版本一致性检查、语法检查、`npm test` 和 React 类型检查与构建；全部通过后再合并。
5. 合并方式用 Squash merge，合并标题沿用 Conventional Commits 格式。

## 发布新版本

版本号遵循 SemVer：`MAJOR.MINOR.PATCH`。1.0.0 之前，新功能升 MINOR，只有修复升 PATCH。

1. 在发布分支上统一改版本号（package.json、package-lock.json、tauri.conf.json、两个 Cargo.toml 和 Cargo.lock 一起改）：

   ```bash
   node scripts/release-version.mjs set 0.3.0
   ```

2. 把 `CHANGELOG.md` 的 `[Unreleased]` 内容移到新小节 `## [0.3.0] - YYYY-MM-DD`，更新文末对比链接，提交为 `chore(release): 0.3.0`，经拉取请求合并。
3. 在合并后的 `main` 上打标签并推送：

   ```bash
   git tag -a v0.3.0 -m "TalkCraft v0.3.0"
   git push origin v0.3.0
   ```

4. `Release` 工作流会再次核对标签、版本号与 CHANGELOG，跑测试，然后用该版本的 CHANGELOG 小节创建 GitHub Release。1.0.0 之前的版本标记为预发布。

## 更新通知

GitHub Release 本身就是更新通知：仓库的关注者（Watch 设为 All Activity 或 Custom → Releases）会在网页、邮件和 GitHub 手机 App 收到新版本提醒。仓库所有者默认关注自己的仓库。

## 当前限制

- Windows 开发版 EXE 仍在本机用 `scripts/build-windows.ps1` 构建，依赖本机 `.tools`，尚未作为发布附件自动上传。
- macOS 开发构建仍是手动触发的 `macOS development build` 工作流，产物发布为独立的 `mac-dev-*` 预发布，不与 `v*` 版本标签绑定。
- 安装包与自动更新留到 Phase 4。
