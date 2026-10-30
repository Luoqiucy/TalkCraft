# ASR阶段验收数据格式

跨配置选型、地名与长录音的新固定清单及测量口径见 [ASR-COMPARISON.md](ASR-COMPARISON.md)。本文件的 Phase 1 清单保持原样；新比较清单另存，不会拿两套不同音频直接排名。评估器现在同时给出 P50 和 P95。

Phase 1的普通话字错率、松键后等待P95、数字和否定保留使用同一份固定100条JSONL样本计算。每行字段如下：

```json
{"id":"sample-001","reference":"今天3点不要提前发布","hypothesis":"今天3点，不要提前发布。","latencyMs":1820}
```

- `reference`：人工核对的标准文本。
- `hypothesis`：ASR最终转写，不能填入文字模型整理后的结果。
- `latencyMs`：停止录音或发送最后音频包到收到ASR最终文本的等待时间。
- `id`：固定且唯一的样本编号，用于定位错误；缺失、空白或重复编号会拒绝整份数据。

运行：

```powershell
npm run benchmark:asr -- .\samples\phase1-asr.jsonl .\reports\phase1-asr-result.json
```

报告按全部参考字符合并计算CER，使用nearest-rank计算P95；空白、标点和符号不计入CER。`datasetSha256`由有序的样本编号和规范化参考文本生成，用来确认不同测试轮次使用同一套语料；修改ASR结果或延迟不会改变它。验收门槛为恰好100条、CER不高于8%、P95不高于5000毫秒，并逐条保持数字序列和中文否定词。退出码0表示全部门槛通过，2表示样本格式有效但至少一项未达标，1表示输入或输出错误。

工具只统计已提供的数据，不录音、不调用ASR或文字模型。自动测试生成的合成JSONL只验证计算器，不能作为真实语音验收结果。真实验收仍需固定普通话录音集、人工参考文本及完整测试条件。

## 从WAV批量采集真实结果
第069轮起，数字保留检查包含显式正负号，Unicode减号`−`与ASCII负号`-`视为一致。CER仍忽略标点，但丢失负号或正负号反转会独立使验收失败。语料摘要升级为`datasetSchemaVersion: 2`，包含参考数字语义（含符号）；新版摘要不能直接与旧版摘要比较，应使用同一版本工具重算旧结果。

项目已提供固定清单`samples/phase1-mandarin-100.jsonl`，覆盖日程、金额、否定、技术术语、地址、办公输入、英文缩写和自然停顿等场景。对应音频按清单路径录制到`samples/audio/`；这些WAV尚未创建，清单存在不代表完成真实录音。

录制过程中可随时执行只读审计，不需要ASR凭据，也不会调用云端：

```powershell
npm run audit:asr-corpus -- .\samples\phase1-mandarin-100.jsonl .\reports\asr-corpus-audit.json
```

报告一次列出已就绪、缺失和格式无效的样本编号。退出码0表示100条全部就绪，2表示仍有缺失或无效WAV，1表示输入或输出错误。输出报告使用独占创建，不覆盖已有证据；文件就绪不代表识别质量验收通过。

自定义清单也必须包含100行，每行包含固定ID、人工参考文本及相对清单文件的WAV路径：

```json
{"id":"sample-001","reference":"今天3点不要提前发布","audio":"audio/sample-001.wav"}
```

音频必须是16kHz、单声道、16bit PCM WAV。确认`.local/asr-test.env`已显式配置真实ASR后运行：

```powershell
npm run collect:asr -- .\samples\manifest.jsonl .\reports\asr-results.jsonl .\reports\asr-report.json
```

该命令会顺序调用真实ASR并产生费用或消耗服务时长，不会接受关闭状态或模拟提供器。开始前会校验100条清单，并预检全部待提交WAV的存在性、大小和16kHz/单声道/16bit PCM格式；全部通过后才创建输出文件并开始云端调用，避免在后续坏文件上浪费前面的调用费用。预检会额外读取一次本地WAV。输出文件以独占方式创建，避免覆盖旧证据；每完成一条就同步写入结果，途中失败时保留已完成的部分结果，同时删除不完整的汇总报告。自动测试只使用本机替身，没有发起云端调用。

途中失败后可使用同一清单、部分结果文件和一个尚不存在的汇总报告路径续跑：

```powershell
npm run collect:asr -- --resume .\samples\manifest.jsonl .\reports\asr-results.jsonl .\reports\asr-report.json
```

续跑会先逐条核对已有结果必须是当前清单的完整前缀，且ID、人工参考文本、转写和延迟均有效；随后只预检并提交尚未完成的WAV。任何结果不一致或剩余音频无效都会在云端调用前终止，避免重复调用和重复计费。若上次中断留下的最后一条完整JSON没有末尾换行，续跑会在首次追加前补充分隔换行，避免两条结果粘连。

运行中按`Ctrl+C`会把取消信号传给当前ASR连接，停止后续样本，关闭输出文件并删除不完整汇总报告；已经同步写入的逐条结果保留，可随后用`--resume`继续。
