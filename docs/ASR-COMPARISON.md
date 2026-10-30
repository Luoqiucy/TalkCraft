# ASR 选择与同音频对比（开发版）

本轮把“识别服务选择”和“如何证明哪一个更好”分开。当前 TalkCraft 真正接入的 ASR 是火山/豆包；`mock` 只供流程测试，不能参加真实排名。文字模型提供器与 ASR 独立。比较工具允许给不同服务配置文件分别运行同一套音频，但新 ASR 只有完成真实适配、授权和回归测试后才可列入应用选项。账号模式仍由服务端选供应商，桌面不能通过本地配置绕过账号额度。

参考 [SayIt 项目](https://github.com/crosswk/SayIt) 的提供器分层和单段样本测速思路；没有复制其服务器或模型。SayIt 公布的 GPU/延迟数据来自它自己的测试条件，不能用作本机 TalkCraft 成绩。

## 固定样本与读数

- `samples/asr-comparison-100.jsonl` 是新增对比清单，与 Phase 1 原有清单分开。100 条包括原有日程、数字/金额、否定和其他口述，以及新加的 10 条地名、10 条较长口述。张家港、江阴、昆山等原名称不可在识别前改写。
- 所有提供器必须读取清单中同一个 WAV 文件，不能各自重新录音。人工参考文本在首次正式测试前审校并冻结；修改后须重新跑全部方案。
- WAV 要求 16 kHz、单声道、16 bit PCM，每条不超过 120 秒。长录音应自然录出，并记下实测秒数。当前音频文件尚未创建，不能计算真实字错率或 P50/P95。
- CER 是与人工参考全文比对的字错率；另列数字和否定词错误的样本 ID。地名和长录音单独列分组 CER。识别原文参与比较，不用 AI 润色文本。
- 批量工具的 `latencyMs` 从提交完整 PCM 开始计到 ASR 最终文本；这不是实际停止录音到界面显示。React 工作台现在在每次成功转写的历史尝试中记录 `stopToFinalMs`，包含录音封口、转换、传输与识别。仅在同一批样本的这个字段全部齐全时，比较报告才给停录到转写的 P50/P95。
- `peakNodeProcessRssBytes` 只反映该测试 Node 进程的采样峰值，不能代表桌面总内存、外部推理进程或 GPU 显存。费用使用用户填入的单价估算，不等于账单。

## 执行顺序

先审计音频。报告会列出缺失与格式错误，不会向云端发送数据：

```powershell
npm run audit:asr-corpus -- .\samples\asr-comparison-100.jsonl .\reports\asr-comparison-audit.json
```

用单条样本验证真实服务连接、速度和输出格式。`--confirm-upload` 表示明确允许这条音频发往配置的云端；结果只新建，不覆盖：

```powershell
npm run sample:asr -- --config .\.local\asr-test.env --id places-001 --out .\reports\asr-one.jsonl --confirm-upload .\samples\asr-comparison-100.jsonl
```

录齐 100 条且单条测试正常后，对每份服务配置顺序采集。`--config` 用来选择配置文件；目前若两份文件均为豆包，只能比较不同豆包配置，不能称为“多家 ASR”排名。请勿把密钥写进 `runs.json` 或报告。

```powershell
npm run collect:asr -- --config .\.local\asr-test.env --profile-memory .\samples\asr-comparison-100.jsonl .\reports\asr-doubao.jsonl .\reports\asr-doubao-acceptance.json
npm run compare:asr -- .\samples\asr-comparison-100.jsonl .\reports\asr-runs.json .\reports\asr-comparison.json
```

`asr-runs.json` 示例（结果路径相对于该文件）：

```json
{"runs":[{"name":"豆包配置A","providerId":"volcengine","runKind":"real","results":"asr-doubao.jsonl","priceCnyPerMinute":0.1}]}
```

单价只是示例，正式报告应填写当时实际合同单价或留空。`runKind` 由采集者声明，不会仅因写了 `real` 就自动证明真实云端调用。原始转写结果可能含私人语音内容，应放在受控位置，不把原始结果公开提交。

## 本地 ASR 决策门槛

在候选模型进入默认配置前，对同一台 Windows 机器分别记录：下载包与最终安装包增加多少、模型文件大小、CPU 模式能否启动、显卡驱动及显存需求、首次启动到可识别的冷启动、第二次热启动、处理时系统总内存与 GPU 显存。用上述同一组 100 条真实 WAV 比较 CER、地名/数字/否定词、长录音和停录到文字 P50/P95，再评估离线隐私与维护成本。

本机只读条件快照（2026-09-29）：Ryzen 7 3700X、约 32 GiB 内存、RTX 2070 8 GiB 显存、NVIDIA 驱动 576.80。开发版 `TalkCraft.exe` 为 13,571,072 字节，**不是安装包大小**，也未包含本地 ASR 模型。尚未安装和运行候选本地模型，CPU/GPU 兼容、冷启动、模型体积和真实速度均为**未测**，不能据此指定默认本地模型。云端豆包仍为当前唯一真实 ASR 适配；实际准确率/延迟也因没有录音样本而未测。
