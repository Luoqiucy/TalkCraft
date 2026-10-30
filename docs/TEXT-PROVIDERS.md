# 文字 AI 提供器

Phase 1 已接入非流式文字请求；听写整理、提示词、翻译、问答共用当前提供器。ASR 单独配置，切换文字提供器不会开启真实语音识别。

| TEXT_PROVIDER | 必填环境变量 | 请求地址 |
|---|---|---|
| mock（默认） | 无 | 本机模拟，不调用 AI |
| ark | ARK_API_KEY、ARK_MODEL | https://ark.cn-beijing.volces.com/api/v3/chat/completions |
| openai | OPENAI_API_KEY、OPENAI_MODEL | https://api.openai.com/v1/chat/completions |
| deepseek | DEEPSEEK_API_KEY、DEEPSEEK_MODEL | https://api.deepseek.com/chat/completions |
| ollama | OLLAMA_MODEL | http://127.0.0.1:11434/api/chat |

设置环境后重新启动本地服务。OpenAI 使用支持 Chat Completions 的 API 模型及独立 API 凭据；不会登录 ChatGPT 网页。模型名称由用户账户可用模型确定，不保证所有模型支持本请求结构。Ollama 模型需提前安装并启动本机 Ollama 服务。

已有火山语音文件配置时，在项目目录运行 `powershell -ExecutionPolicy Bypass -File scripts/configure-text.ps1`，选择提供器、模型并隐藏输入 API Key；保留语音配置。凭据写入本机 `.local/asr-test.env`（明文、忽略版本提交，系统密钥链尚未实现），不会打印密钥。配置后重启服务才生效。Windows桌面开发版也读取此文件，但仍需安装好的Node和完整MSVC环境。

可选 TEXT_TIMEOUT_MS 为 1–120000 毫秒，默认30000。OLLAMA_BASE_URL 可指定本机 HTTP 根地址与端口，允许 localhost、127.0.0.1、[::1]，拒绝远程主机、用户信息、路径、查询参数和片段；默认11434端口。当前不支持远程 Ollama 或自定义云端代理。

云端需勾选文字上传确认；服务端也强制校验。Ollama 不上传云端，不发送 Authorization，不会因错误切换云端。API Key 不回传浏览器或状态接口；当前从环境读取，系统密钥链尚待 Phase 3。状态检查仅读取配置，不发起模型调用。

响应限1MiB，网络及正文读取共用超时，取消传递上游，禁止重定向，错误不回显上游秘密。首次使用需实际验证所选模型的准确性和响应延迟。

## 延迟策略

录音结束后的火山流式识别使用100毫秒音频分片节奏；相较旧版200毫秒节奏，可明显缩短已录制音频的提交时间，但仍保留服务端流式协议的节奏约束。听写、翻译和提示词属于编辑任务，DeepSeek Chat Completions 显式关闭思考模式；问答保留低强度思考。OpenAI、方舟和Ollama不接收DeepSeek专用思考参数。短语音任务设置保守输出预算，超过2000字符的手动输入不因该策略被静默截断。

模型响应会记录上游处理耗时，历史仍同时保存端到端耗时。云端排队和网络波动不可消除，单次实测不代表每次都能达到同一速度。后续可继续增加流式文字显示，以缩短用户看到首字的等待，但自动写入外部光标仍需等待完整结果。

## DeepSeek 问答联网搜索

普通文字处理继续使用 Chat Completions。只有问答模式中用户主动开启“联网搜索”时，服务才会先请求官方 Anthropic 兼容端点 `https://api.deepseek.com/anthropic/v1/messages`，并传入原生 `web_search_20250305` 工具；听写、提示词、翻译和默认问答不会搜索。Responses API 的内置工具当前会被忽略，因此本项目不把 Responses 请求成功当作搜索成功。

界面把“允许搜索”和“实际搜索”分开：只有响应中真实出现 `web_search_tool_result` 才标记已执行；来源仅从该工具结果提取。没有工具结果、没有来源或请求失败都会如实显示。搜索证据使用短期、一次性服务端令牌绑定原问题，浏览器不能自行提交来源。回答阶段仅接收服务端缓存的搜索材料，并将网页内容视为不可信资料。

搜索结果中的网页条目通常不直接携带摘要。服务会优先按URL合并 `text.citations[].cited_text`；若上游本次没有返回 citations，则使用同一真实搜索轮生成的可读检索摘要，连同真实工具来源目录一起交给回答阶段。检索摘要不会冒充网页原文，回答仍需注明日期、来源冲突和证据限制。这一降级用于天气等需要具体数值的实时问题，不会触发额外的隐藏搜索。

天气问题启用有界证据检查：必须同时取得真实来源、带单位的具体温度和天气状况。首轮不足且搜索工具确实执行时，最多增加一次定向检索；首轮充分、普通问题、工具未执行时不会增加轮次。界面和历史记录实际检索轮次、工具请求数、总耗时及证据检查结果。两轮后仍不足会明确提示，不继续循环或猜测。

官方当前推荐模型名为 `deepseek-flash`。旧 `deepseek-v4-flash` 暂时路由至 V4.1 Flash；项目不会自动改写已有模型名，也不会覆盖第三方或用户自定义配置。搜索会产生额外模型请求与令牌消耗；历史尝试记录可获得的搜索耗时、工具请求数、令牌用量和来源标题/链接，不保存密钥或搜索摘要。

## 测试边界

第035轮新增系统设置内文字模型配置表单及 `/api/text-settings`。保存成功即时切换文字提供器，不重启服务；不调用模型，仅保存本机明文配置。更换提供商需新密钥，同一提供商留空保留旧密钥。密钥不回填、不进入历史。用户可前往工作台确认文字上传后测试四模式，保存成功不等于真实模型验证通过。
119 项自动测试通过，其中新增8项使用本机 HTTP 上游替身及取消模拟，验证传输和授权行为。没有真实云端调用或本机模型推理证据，不构成模型质量、macOS、硬件验收。

## 官方协议依据
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
- [DeepSeek Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek Claude Code 联网搜索](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/)
- [DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response/)
- [deepseek-harness 搜索实现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web-search-deepseek/src/provider.ts)
- [Ollama Chat](https://docs.ollama.com/api/chat)
