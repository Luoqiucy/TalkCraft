# TalkCraft macOS 开发测试版

这是当前Tauri架构的Mac开发测试版，不是正式安装包或完成等价验收的商业版本。Windows唯一入口及原有配置不变。

## 下载与首次打开

- Apple芯片（M1/M2/M3等）下载 `TalkCraft-macOS-AppleSilicon-dev.zip`；Intel处理器下载 `TalkCraft-macOS-Intel-dev.zip`。最低目标为macOS 14。
- 解压后将 `TalkCraft.app` 放入“应用程序”，再打开。附带Node和后台依赖，不需要自己安装Node或Rust。
- 开发版只有临时本机签名，没有Apple开发者签名或公证。下载来源应为自己的私有GitHub仓库；若系统阻止打开，需要用户本人按macOS“隐私与安全性”提示处理，不提供绕过系统检查的自动命令。
- 主动点击开始录音时，允许麦克风权限。构建机器没有实际录音、听音或语义验证，首次使用必须实测。
- 首次没有服务凭据，模拟/未配置状态会如实显示。Windows密钥、历史和录音没有随应用上传；模型可从设置页配置。豆包ASR等开发配置需由你通过本地方式配置在 `~/Library/Application Support/TalkCraft/runtime/asr-test.env`，不要把密钥写入GitHub或发到聊天中。

## 本批范围

工作台、四模式、Agent和历史复用同一份React/Node代码。应用后台从`.app`内部启动；可写配置在 `~/Library/Application Support/TalkCraft/runtime/`，历史/记忆沿用 `~/Library/Application Support/TalkCraft/history/`。移动应用后不再依赖GitHub runner编译目录。可用Mac原生复制。标准组合快捷键默认使用Command+Shift系列，Windows绑定没有改变。

尚未完成Mac实机验收：麦克风与ASR、语音播放、默认浏览器、权限、全局组合键、关闭重启和设置持久化。右侧Option单击/双击/长按、跨应用自动光标输入及原生保存对话框尚未接入，不能当作Windows功能等价版。HUD的Windows局部命中适配不能复用于Mac，因此默认隐藏；需要后续单独完成透明区域交互验收。

## 构建与验证

GitHub仓库Actions手动运行“macOS development build”，分别在AppleSilicon和Intel的Mac runner构建。普通push不会自动启动昂贵构建。流程使用锁文件，执行离线测试、React检查、Rust测试、架构检查及签名结构检查；通过后启动自己的隔离测试实例，验证后台、React页面及设置接口。它不等于实际操作WebView、物理按键、麦克风或录音验收。

两个架构成功后发布带`mac-dev-`前缀的预发布版本和SHA-256校验文件。只有构建真实通过才会产生下载文件；没有支付、正式公网服务、云端用户凭据或自动更新功能。私有仓库使用标准runner及当前账号可用额度，额度不足时流程会失败，不会替你购买额度。

在Mac本机从源码构建：安装Node24和Rust/Xcode命令行工具，运行 `npm ci` 后执行 `node scripts/build-macos.mjs`。此脚本只在Mac运行，产物位于`dist/`，不会更新Windows EXE。

参考：Tauri macOS Application Bundle https://v2.tauri.app/distribute/macos-application-bundle/；GitHub runner支持 https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job。
