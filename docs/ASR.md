# 语音识别接入边界（真实识别尚未实现）

第012轮增加src/providers/volcengine-protocol.mjs，依据固定官方Arkitect源码编写初始化/音频编码及响应解析，有严格帧长和解压上限。当前为独立协议模块，没有接入loadAsr或真实WebSocket上传。终止与会话流程下一轮核对；来源与许可见docs/reference/VOLCENGINE-NOTICE.md。
第013轮新增asr-session.mjs，接收on/off/connect/send/close传输接口，要求显式已核实terminalFrame，实现初始化等待、PCM分块与整体超时/取消。尚未提供真实WebSocket传输，也未接入loadAsr；测试专用终止帧不代表官方格式。
第014轮新增asr-transport.mjs（ws 8.21.3），已通过本机真实WebSocket网络测试，固定云端地址、参数白名单、消息上限及强制关闭；仍未接入loadAsr。终止格式与真实鉴权/云端验收待完成。完整开发与测试前先运行npm ci安装锁定依赖。

ASR_PROVIDER 默认 disabled，显式设为 mock 后启用流程模拟。其他值启动失败，不能把未知服务静默当模拟。模拟固定返回明确声明“未识别音频”的测试文本，不具备任何语音识别能力。

POST /api/transcribe 接收原始有符号PCM16小端二进制，不能发送WAV头或WebM容器：
- Content-Type: application/octet-stream
- X-Audio-Sample-Rate: 16000
- X-Audio-Channels: 1
- X-Audio-Bit-Depth: 16
- 仅真实识别提供器需要 X-Audio-Cloud-Consent: true（目前真实提供器无法通过环境配置启用）。

音频支持0.1—120秒，3200—3840000字节，长度必须为偶数。成功返回 text、simulated 和 duration；默认关闭返回503，格式无效400，体积超限413，跨来源403。状态接口仅在识别启用时增加asrProvider和asrSimulated，audioTranscription表示流程启用，不表示真实模型可用。

提供器接口为 transcribe(pcm, {sampleRate,channels,bitDepth,duration,signal})，返回转写字符串；需遵守取消信号并自行处理连接、超时和错误脱敏。当前仅测试替身，未来官方适配器在此接口内实现，不应从浏览器读取密钥或服务地址。音频只在内存暂存，不落盘。

页面已接识别按钮：先停止录音、准备音频，再主动提交；使用pcm字段而不是wav字段。默认关闭时按钮禁用，显式模拟时结果标记未识别音频，仅发往本机。结果单独预览，点击使用才填入转写框，已有内容需勾选替换；用户编辑后重新确认。取消/丢弃/页面关闭不交付迟到结果。使用转写后还需手动点击文字处理，不自动发送至LLM。
