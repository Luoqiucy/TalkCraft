# Kokoro 本机音色

在「设置 → 语音回答」点击「安装 Kokoro 音色包」，或者选择 GitHub 官方下载。完成后选择音色、试听，再保存设置。语音摘要和手动播放共用所选音色。下载约 140 MiB，解压和校验需要额外的临时空间。

使用 [Kokoro 1.1 中文模型](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)（Apache 2.0）及 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)。音色包包含 100 个中文音色和 3 个英文音色。未收录的英文专有词可能被跳过。语音合成在本机进行；联网回答的口播摘要仍使用当前配置的文字模型。

默认镜像入口为 [GitHub 下载加速源](https://gh-proxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2)。部署时可在启动后台的环境中设置 `TALKCRAFT_KOKORO_MIRROR_URL`，指向同一个原始压缩包的 HTTPS 镜像。安装前固定核对官方包字节数和 SHA-256，重打包文件会被拒绝。

模型安装到当前运行数据目录的 `voice-packs/kokoro-int8-multi-lang-v1_1`，源码开发版默认在项目的 `.local` 下。应用包和源码提交不包含模型数据。
