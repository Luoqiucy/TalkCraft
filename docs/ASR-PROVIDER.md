# 火山语音识别提供器（Phase 1）

默认 ASR_PROVIDER=disabled，不连接云端。ASR_PROVIDER=mock 只返回明确标记的模拟文本，不识别音频。

显式启用火山：设置 `ASR_PROVIDER=volcengine`，新版控制台填写 `VOLC_ASR_API_KEY`，旧版填写 `VOLC_ASR_APP_KEY`、`VOLC_ASR_ACCESS_KEY`，然后重启本地服务。新版Key存在时仅发送 `X-Api-Key`，不混发旧凭据；非法新版Key直接报错，不静默回退旧凭据。Key仅保存在本机服务配置，不通过状态接口返回。ASR_TIMEOUT_MS 可选，默认30000毫秒，范围1–120000；覆盖连接、初始化、按100ms节奏发包和最终结果等待。较长录音需自行设置足够预算，120秒录音受相同最大超时限制，实际支持时长待云端实测。

2026-11-05 新版Key流式实测：初始化成功，程序生成7.1秒英文测试音频经生产提供器返回完整正确句子（包括120美元），单次请求4427ms。并非用户真实麦克风测试或P95成绩。本轮接入新版鉴权，未切换录音文件HTTP接口：用户提供的 `/auc/bigmodel/submit` 示例使用外部音频URL，不能直接替换当前本机PCM流程，也没有新增公开录音托管。官方流式API确认支持新版单Key：https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh 。

2026-09-29 起，可在执行 ASR 的服务配置文件中另写 `ASR_HOTWORDS=张家港,DeepSeek`。最多 20 个不重复词，每词不超过 10 字；重启服务后，启用的火山 ASR 会在**该服务的每一次转写请求**的 `request.corpus.context` 中传入这些词，听写仍输出 ASR 原文，不做事后替换。词条会随录音发给当前火山语音服务，未设置时请求体保持原样。账号模式由独立网关执行 ASR，桌面本机配置的热词不会自动同步到网关；若要账号模式使用同一词条，需在网关配置或后续建设有授权的词典同步。此配置暂属开发入口，个人词典编辑与账号网关动态同步尚未接通；协议单测通过，但真实云端热词效果仍须同录音 A/B 测量。火山官方流式文档中 `context` 是 JSON 字符串，直传热词可能受到服务版本和词数限制；配置不是准确率保证。

React 工作台已将历史写入与 ASR 请求解耦，保存音频不再挡在识别前；状态依次说明“正在准备录音数据”和“正在等待语音识别”。当前仍是录完后才发送整段 PCM，遵守火山官方 100–200ms 发包间隔；这次没有未经实测地进一步缩短协议节奏。新增停录到最终文字、音频准备、ASR 请求各段耗时记录，见本轮报告。

1.0地址为 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`；2.0为 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`。新版Key默认资源 `volc.seedasr.sauc.duration`，旧版凭据默认 `volc.bigasr.sauc.duration`；可显式设置VOLC_ASR_RESOURCE_ID为1.0/2.0小时版或并发版的官方编号。每次请求创建独立连接与随机请求ID，不自动重试整段录音。缺凭据或非法配置启动失败，不降级模拟。状态接口不含密钥。

音频准备为16kHz单声道16bit PCM后，由用户单独确认上传并手动提交；文字云端授权不能替代音频授权。默认不保存原始音频，失败时页面内音频仍可重试或主动下载，关页后不能恢复，不承诺加密草稿缓存。转写结果先预览，再由用户确认使用，不自动覆盖编辑文本。

取消传递到WebSocket并释放连接；超时安全返回504，其他上游失败返回502，不回显上游秘密。

## 验证边界
第021轮使用本机WebSocket替身验证HTTP授权、协议往返、PCM完整性、请求ID、超时、取消及密钥不回显，126项全量测试通过。没有实际云端调用；simulated=false在替身测试里只表示真实提供器代码路径，不表示测试文本由模型识别。真实凭据/官方兼容/准确率/音频质量仍待验收。

协议依据见 reference/VOLCENGINE-TERMINATION.md 与固定来源记录。部署本身不自动发起付费测试。

第022轮：预览支持“使用转写并处理”，按当前听写/提示词/翻译/问答模式发起文字处理。已有文本需替换确认；云端文字需额外授权，本机Ollama无需云端文字授权。按钮不会启动音频上传，不会绕过预览。模拟DOM串联测试通过，真实浏览器录音仍待验收。


## 用户已开通2.0小时版（2026-09-14）
用户截图显示2.0小时版试用包运行中。已核实资源VOLC_ASR_RESOURCE_ID=volc.seedasr.sauc.duration；并发版为volc.seedasr.sauc.concurrent。旧1.0默认保持，不自动切换用户配置。

用户提供优化版协议：https://docs.volcengine.com/docs/6561/2630027?lang=zh（bigmodel_async）。现有协议文档https://www.volcengine.com/docs/6561/1354869?lang=zh同样列出2.0资源，并支持已实现的bigmodel地址，因此本轮保持现有传输/协议，不宣称完成新优化版适配。正文经r.jina.ai只读代理核实。

运行 scripts/start-asr-test.ps1，在本机输入APP ID和隐藏的Access Token，不需要Secret Key。脚本只设置当前进程环境，退出恢复，凭据不保存文件。测试服务端口4318，保留4317现有服务；文字设为mock，只有用户确认提交的音频调用真实ASR，可能消耗试用额度。按Ctrl+C退出。端口被占用需先退出已有测试服务。

本轮132项自动测试通过，验证2.0资源传到本机WebSocket替身；启动脚本仅做PowerShell语法解析，未输入真实凭据或实际模型调用。真实兼容和额度扣减仍待用户测试。

## 实际联调修正
2026-09-14同一份本机配置，1.0旧接口拒绝2.0资源：resourceId is not allowed；2.0资源调用bigmodel_async握手成功。已按资源选择接口，1.0保留bigmodel，2.0使用bigmodel_async。仅真实握手验证，未验证完整识别。此前仅文档判断旧接口支持2.0的结论已被真实请求纠正。

第025轮：2.0优化版只在结果变化时回复，不能依赖初始化ACK。2.0初始化发送完成后立即开始音频；1.0保留现有ACK等待。无初始化回复的本机WebSocket集成通过，真实服务完整识别仍待复测。

第026轮：start-asr-file.ps1改用scripts/asr-file.mjs独立读取.local/asr-test.env，文字与ASR提供器只取文件，不让旧进程环境覆盖。文件明文仅本机保管，读取失败输出固定安全提示，不打印凭据。当前运行服务不自动重启。

第028轮：音频准备区域支持导入项目下载的16kHz单声道16bit PCM WAV，成功后直接可手动提交转写，无需重复准备；导入本身不上传、不覆盖原文字。当前不支持MP3、WebM或其他采样率WAV导入。坏文件导入失败保留此前已准备音频。
