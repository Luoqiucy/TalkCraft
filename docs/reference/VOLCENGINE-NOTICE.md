# ASR协议参考及许可

官方仓库：volcengine/ai-app-lab，固定提交88c983d70a098110fc839f8cd05e29fa7715e6ce。

- 协议源：https://github.com/volcengine/ai-app-lab/blob/88c983d70a098110fc839f8cd05e29fa7715e6ce/arkitect/utils/binary_protocol.py
- 客户端：https://github.com/volcengine/ai-app-lab/blob/88c983d70a098110fc839f8cd05e29fa7715e6ce/arkitect/core/component/asr/asr_client.py
- 模型与默认参数：同一提交arkitect/core/component/asr/model.py、constants.py。
- 许可范围：https://github.com/volcengine/ai-app-lab/blob/88c983d70a098110fc839f8cd05e29fa7715e6ce/README.md#license

README明确arkitect目录采用Apache 2.0；demohouse另用限制商业用途的许可，本项目未使用其代码。协议源文件头版权为Copyright (c) 2025 Bytedance Ltd. and/or its affiliates。
原协议源码保存为volcengine-binary-protocol.py.txt（仅参考，不执行）；Apache许可全文保存为APACHE_LICENSE.txt。

本项目volcengine-protocol.mjs为协议相关JavaScript改写，增加严格长度/版本/类型校验、1MiB响应和解压上限、UTF8错误检查，并固定16000Hz单声道PCM。客户端源码默认采样率1600未被照抄；终止包发送及会话生命周期尚未实现。
这里没有引入Arkitect运行时或Demohouse代码。后续分发应保留本说明、源文件版权及Apache许可。
