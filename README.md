# TalkCraft｜AI 语音输入与联网问答桌面助手

TalkCraft 将桌面录音、语音转写、文本处理和联网问答连成一条流程。用户可以通过快捷键录音，将结果写入当前应用，也可以在工作台或独立问答窗口阅读回答和引用来源。

| 层级 | 技术与用途 |
| --- | --- |
| 桌面 | Tauri 2 + Rust，处理全局快捷键、悬浮录音状态、托盘与跨应用文本输入 |
| 界面 | React + TypeScript + Vite，提供工作台、设置、历史、来源及执行过程 |
| 语音与模型 | Node.js、火山引擎豆包 ASR、DeepSeek 等文字模型适配，覆盖原文听写、提示词改写、翻译和问答 |
| 联网问答 | DeepSeek Function Calling、Firecrawl 搜索和正文抓取、Open-Meteo 天气查询 |
| 本地数据与账号 | SQLite，支持账号隔离的个人记忆，以及开发版账号认证与额度事务 |

## 实现重点

- **四种语音处理模式**：听写保留原始转写，改写和翻译按模式调用文字模型。桌面层支持将处理结果插入目标应用。
- **带来源的联网问答**：模型规划工具调用，Node.js 执行搜索、读页或天气查询并返回结果。界面显示流式回答、可点击引用和执行轨迹。任务支持取消，默认查询上限为 45 秒、6 次工具调用。
- **多轮追问与个人记忆**：将对象、地点、日期和查询字段分开处理，追问时继承必要信息，切换对象时清除旧配置。个人记忆按账号或游客隔离，用户可查看、编辑和删除。
- **用量网关开发版**：提供注册登录与供应商 API 转发，使用 SQLite 事务处理额度检查、预留、结算与取消。

## 开发与状态

项目处于 Phase 2。Windows 开发入口使用 Tauri，Electron 为预览入口。公网订阅、支付与正式跨设备会员同步仍在规划或开发验证中。

- 安装依赖：Node.js 22 或以上，运行 `npm ci`。
- 开发与验证：`npm run desktop:dev`、`npm test`、`npm run react:check`。
- Windows 开发构建：[构建脚本](scripts/build-windows.ps1)。
- 更多信息：[项目进度](docs/PROGRESS.md) · [桌面开发](docs/DESKTOP.md) · [Agent 工具](docs/AGENT-TOOLS.md) · [账号网关](docs/COMMERCIAL-GATEWAY.md)。
