# Electron 桌面迁移与低延迟 Agent 路线

更新：2026-09-28。当前为 Phase 1 增量迁移，未完成桌面等价验收。

## 已运行的第一段闭环

在应用正常退出后运行 `npm run react:build` 更新 React 资源，然后以 `npm run electron:dev` 启动预览。预览命令本身不改写资源，以免影响仍在运行的 Tauri 窗口。Electron 启动独立的现有 Node 服务并载入 `http://127.0.0.1:4317/react/`。录音、ASR、四模式、历史和 Agent 仍复用同一 HTTP 实现，不复制密钥到渲染进程。Electron 窗口启用沙箱与上下文隔离，禁止 Node 集成、外部导航和弹出窗口；仅允许本机工作台请求麦克风权限。关闭预览时先确认，再只停止本实例启动的后台服务。

这只是迁移预览入口，**不是功能等价的 Electron 正式版**。现有 `src-tauri/target/debug/TalkCraft.exe` 仍是唯一 Windows 开发交付入口；没有生成 Electron 安装包或第二个 TalkCraft EXE。用户历史、录音设置和模型配置目录未迁移、未清空。

## 当前能力边界

| 能力 | Electron 预览 | Tauri 当前版 | 待迁移条件 |
| --- | --- | --- | --- |
| React 工作台、手动录音、ASR、四模式、历史、问答 | 复用同一页面和本机服务，已验证启动与页面 HTTP | 已接入 | Electron 真实麦克风与云端服务仍需人工验收 |
| 通用联网问答 | React 现在一次 `/api/agent` 请求完成搜索和回答；内部仍用旧搜索编排 | 同一 React 页面与 Node 服务 | 通用搜索迁入 LangGraph 前需证据质量、取消、用量回归 |
| 天气问答 | 单请求 LangGraph 天气流程 | 同一后端 | 真实天气与文字模型分别验收 |
| 全局快捷键、右 Alt 单/双击与长按 | 未迁移 | Tauri/Rust 已实现 | Electron 原生快捷键与右键手势必须等价验证 |
| 透明 HUD、穿透命中、独立问答/快捷键窗 | 未迁移 | Tauri/Rust 已实现 | Windows 实际透明区域、拖动和焦点回归 |
| 外部光标输入、托盘、最小化记忆 | 未迁移 | Tauri/Rust 已实现 | 原生权限、目标焦点、防重复输入和退出清理 |
| 安装包与自动更新 | 未实现 | Phase 4 待办 | 完成 Phase 1 验收后再决定默认入口与打包规则 |

## 低延迟的实际改动与测量

React 开启联网问答时，原先通用问题依次请求 `/api/search` 和 `/api/process`。现在只调用一次 `/api/agent`；后端在同一任务内串行执行原搜索工具和文字模型，持续推送真实工具事件，并回传 `firstProgressMs` 与墙钟 `totalElapsedMs`。天气继续走已有 LangGraph 图；普通听写、提示词和翻译不进入搜索。这个改动减少本机请求切换并统一任务取消和事件展示，**不能据此声称云端检索或模型推理已经达到 Daisy 的响应速度**。

下一轮按相同录音和问题分别记录：录音停止→原始转写、停止→最终结果、Agent 请求→首次真实进度、搜索/读页/模型各阶段、首次可见回答及总耗时；至少重复多次并给出 P50/P95。优先处理 ASR 音频上传节奏、无效补查、模型首字流式返回及网页读取超时。低延迟必须同时验证准确性和引用完整性，不能用缩短预算掩盖失败。

2026-09-28 单次真实请求基线（非 P95）：DeepSeek 产品搜索“帮我查一下理想i9的官方参数”总墙钟约16.5秒，1次搜索工具、8个返回来源、模型约6.5秒；Open-Meteo + DeepSeek “张家港市后天天气怎么样”总墙钟约4.6秒，1次天气工具、2个来源、模型约1.8秒。产品回答虽引用了搜索结果，也明确未读到官方配置表，具体参数的来源支持度尚未逐项人工核验。`firstProgressMs` 是首次工具事件时间，**不是回答首字时间**。这两次请求不能证明低延迟目标或 Daisy 对比已达标。

## 迁移顺序与回退

1. 先在 Electron 实现受控 preload/IPC、单实例、托盘和安全退出，复测工作台数据不丢失。
2. 迁移全局快捷键与右 Alt 手势，再迁移透明 HUD、独立窗口和外部目标输入。不能把 Electron 通用 `globalShortcut` 当成可区分右 Alt 单击/双击/长按的完整实现。
3. 完成 Windows 真机录音、快捷键、窗口穿透、外部输入、关闭/重启与性能验收，才允许默认入口由 Tauri 切换；macOS 单独验收。
4. 通用搜索仍在旧编排器，LangGraph 迁移以单任务预算、来源质量、取消和真实请求数为准，不同时运行两套模型。TTS 与本地 ASR 另行评估。

回退：继续使用现有 [TalkCraft.exe](../src-tauri/target/debug/TalkCraft.exe)；Electron 预览只由 `npm run electron:dev` 启动，不修改既有快捷键配置和历史。

参考：[Daisy 源码](https://github.com/forestai123456/Daisy-Voice-Agent)、[Daisy 依赖](https://github.com/forestai123456/Daisy-Voice-Agent/blob/main/package.json)、[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron 全局快捷键](https://www.electronjs.org/docs/latest/api/global-shortcut)。Daisy 的“按住说话”和 TalkCraft 已确认的“按一次开始、再按一次结束”交互不同，迁移时保持 TalkCraft 定义。
