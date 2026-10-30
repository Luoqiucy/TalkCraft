2026-09-21当前入口：`src-tauri/target/debug/TalkCraft.exe`。Right Alt单击启停听写、320ms内快速双击启停提示词预设、650ms长按打开独立指南；自定义快捷键支持单键和组合键，单键会提示全局占用风险。浅色/深色保持相同布局比例。Node350项、Rust30项及统一构建通过，真实系统按键仍待用户人工测试。下方轮次内容为历史记录，冲突处以本条及`docs/PHASE1-DESKTOP-ACCEPTANCE.md`为准。

第140轮最新入口src-tauri/target/debug/TalkCraft.exe已成功更新，含本机历史、音频保留/系统导出、本地反馈ZIP及诊断；281 Node/语法复测及Windows构建通过。旧运行阻碍已解除，当前未启动，手动打开后验证新服务与真实功能。安装包留Phase 4。

第139轮源码更新待交付：用户数据目录本机历史、音频保留/系统导出、本地反馈和诊断已实现，281 Node/27 Rust通过；PID30832运行，统一脚本未替换TalkCraft.exe。先保存退出，再构建重开加载新后台，真实操作待验收。

第138轮最新入口src-tauri/target/debug/TalkCraft.exe已更新，包含137文本拖选与焦点释放修复；269 Node及语法检查通过，Windows统一构建成功。音量、选区/粘贴、真实光标输出、退出和CPU仍待验收。未自动启动，请手动打开最新入口。仅开发版，安装包留Phase 4。

第125轮当前版本：唯一入口src-tauri/target/debug/TalkCraft.exe已更新。右Alt按住口述、右Alt+右Shift翻译、右Alt+Space问答，松开右Alt自动处理，结果提交到外部前台光标；保留提示词/处理文字/显隐原配置。禁用HUD阴影及焦点获取，视觉/真实输入仍待验收。旧版状态见下方历史。

最新入口统一为src-tauri/target/debug/TalkCraft.exe（第123轮Living Fluid Orb集成版，已构建并启动）。七态HUD使用透明置顶窗口、真实录音状态/音量及用户两份提示音；Alt+Shift+M或自定义绑定切换显隐，背景拖动，悬浮条可展开工作台。工作台录音结束自动转写，外部录音入口按当前四模式自动处理。真实声音、后台波形和跨应用端到端仍待实测。本机短时待机CPU均值约0.42%，录音/处理不作达标承诺。以下后缀EXE路径及旧业务描述仅历史记录，勿再尝试打开。后续使用scripts/build-windows.ps1更新统一入口，失败保留原版，运行中先保存录音并退出。

第117轮（2026-09-18）：最新开发版为src-tauri/target/debug/TalkCraft-background-fixed.exe。关闭工作台只隐藏到后台，不销毁录音和HUD同步；Alt+Shift+M或自定义绑定切换同一个HUD，HUD右侧展开恢复工作台，个人定制中的退出TalkCraft才真正退出。旧版本全部退出后再开新版，单实例锁不能迁移正在运行的旧版。实际窗口/后台录音仍待验收。

# 桌面开发准备
第107轮：工作台结果区新增“检查输入目标”，需106的`TalkCraft-output-target.exe`或后续新版原生接口。在外部目标应用中触发已配置全局快捷键，再回工作台点击检查，会显示记录的窗口或失效原因；旧原生程序提示接口失败，浏览器明确不支持。检查只读取，不键入；光标输入仍未接通。前端动态更新，保存录音后安全刷新加载。
第106轮原生前置能力：`TalkCraft-output-target.exe`记录全局快捷键触发时的外部前台窗口，原生output_target接口校验窗口存在及原进程身份；暂不执行键入，UI光标输入按钮仍禁用。此次只验证原生规则和构建，实际外部窗口记录/焦点恢复待验收。不会自动覆盖或启动用户现有程序。
第102轮：工作台和HUD显示单次录音上限02:00、正计时及剩余时间，最后20秒突出提醒，到时自动停止。实际录音器与显示共用RECORDING_MAX_MS常量；已结束时保留本次时长，重新申请录音时复位。仅前端动态资源修改，当前快捷键版EXE可使用；先保存音频后刷新/重开窗口加载，不需要安装新程序。
第101轮补充：组合键必须包含Ctrl或Alt，或使用Shift+F1–F24；Shift+字母/数字/空格/Enter会占用正常输入，已禁止。补丁开发程序`src-tauri/target/debug/TalkCraft-hotkeys.exe`已构建，未自动启动/覆盖原程序。原系统快捷键配置若含被禁止的组合会显示校验失败、保留文件，不自动覆盖；需保留文件后手动纠正这些组合。
第100轮当前新版：`src-tauri/target/debug/TalkCraft.exe`，包含系统全局快捷键。个人定制页面的“桌面全局快捷键”支持录入、禁用、保存与读取，配置保存到应用系统配置目录shortcuts.json，与API凭据和硬件按键配置独立。录音默认Alt+Shift+1/2/3/4对应听写/问答/翻译/提示词，按一次开始、再按一次停止；Alt+Shift+Enter处理当前文字，Alt+Shift+M显示HUD。音频不自动转写或上传，文字处理遵循现有授权。退出进程后释放全局键，重启尝试重新注册；被其他程序占用会提示失败。浏览器不支持全局快捷键。新版已构建但自动启动被审批策略拒绝，用户手动打开后需实测；保存录音后再退出旧开发程序。本轮不打包安装包。
第097轮修正版：`src-tauri/target/debug/talkcraft-hud-preview.exe`。修复HUD查询参数404，实际4317服务已更新并确认HTTP 200；新程序紧凑高度52px、结果展开132px。运行中的旧EXE未覆盖或强制结束：先保存需要的录音，再关闭旧开发窗口、打开修正版。旧页面需要刷新才能载入新版脚本，刷新会释放未保存录音。
第096轮：当前开发程序为`src-tauri/target/debug/talkcraft-desktop.exe`，Windows开发及正式构建均使用GUI子系统，不弹出CMD窗口。已创建独立置顶录音HUD，主窗口中的悬浮条入口显示它；拖动左侧麦克风图标移动，×隐藏。工作台持有唯一录音会话，悬浮条转发操作并同步状态；工作台关闭/失联后悬浮条禁用录音。普通应用窗口可置顶，不能覆盖Windows安全桌面、锁屏，独占全屏覆盖仍待实测。运行仍依赖本地Node服务；正式安装包留待Phase 4，本轮不打包。旧wireless-ai-mic.exe是旧开发版，不建议继续打开。
2026-09-17第094轮：Windows开发可执行文件已完整构建并启动，路径为`src-tauri/target/debug/wireless-ai-mic.exe`；已接入用户选择的第1款图标。原生进程存在且窗口句柄非零，现有4317服务返回HTTP 200。以下“未构建/未启动”表述仅为历史记录，以本条为准。当前开发版依赖运行中的本地服务，尚未做窗口内真实录音、模型调用及光标输入验收，正式安装包仍未开放。

复现本轮构建：在PowerShell中将`CARGO_HOME`设为项目`.tools/cargo`绝对路径、`RUSTUP_HOME`设为项目`.tools/rustup`绝对路径，然后运行项目`.tools/cargo/bin/cargo.exe build --locked --manifest-path src-tauri/Cargo.toml`。已有4317服务时直接打开上述开发可执行文件；没有服务时优先使用`npm run desktop:dev`。不要在已有服务占用端口时重复启动受管服务。
2026-09-17第093轮更新：doctor所有检查通过、rebootRequired=false，待重启阻碍已解除。补齐开发版Windows图标后cargo check --locked通过；尚未完成可执行文件链接、窗口启动或实机录音验收。以下待重启说明为先前状态，当前优先继续原生开发构建。
2026-09-17当前状态：用户修复已恢复MSVC普通x64运行库文件，Visual Studio安装器仍提示待重启，doctor返回missing=[]、rebootRequired=true。保存工作并手动重启后重新检查；当前无需重复安装或再次修复。旧报告中的SDK补装建议已撤销。
第068轮：doctor增加rebootRequired、blockedBy及nextAction。Visual Studio C++实例待重启时，不把默认实例查询返回空误报为组件缺失；启动器提示手动重启并保持退出，不启动自有服务/Tauri，也不自动重启系统。
2026-09-16最新更正：第058轮文件归属诊断错误。SDK中的UCRT库为`ucrt.lib`，现场SDK及`um/x64/kernel32.lib`均存在。实际缺少MSVC 14.44.35207普通`lib/x64/msvcrt.lib`；其他onecore/uwp目录副本不能替代普通桌面库。doctor已纠正，当前missing=msvcRuntime。用户可在Visual Studio Installer中对Community 2022选择“更多→修复”恢复安装文件。旧repair-desktop.ps1不再执行SDK补装，只显示手动修复指引。

第048轮起请使用npm run desktop:dev：启动器管理本地服务，等待ready后启动Tauri，CLI退出后关闭自有服务。beforeDevCommand已移除，直接运行tauri dev需自行提供服务。4317被占用会明确失败，不自动关闭或复用现有进程。真实原生运行与完整进程树清理尚未验收。

第042轮：开发外壳使用文件服务启动。首次没有.local/asr-test.env时可启动模拟文字/关闭ASR，再在设置界面填写文字模型；已有无效配置仍明确报错。此项只解决开发服务首次启动，不代表原生程序已构建或侧车打包完成。

当前新增最小Tauri开发外壳，独立编写，未复制Handy源码。Handy参考版本固定于docs/upstream-handy.json，随后从该提交评估原生录音、输入和权限模块，核对相关依赖许可后选择性集成。

先运行 npm ci 安装锁定开发依赖，再运行 npm run desktop:doctor。
Windows检查cargo、rustc、MSVC C++构建组件及WebView2；macOS检查Rust与Xcode路径。检查只确认开发条件，不能证明SDK完整性、编译成功或平台权限正常。doctor缺少条件时返回1，这是预期反馈，不是测试失败。

条件齐备后 npm run desktop:dev 启动开发外壳及本地Node服务。请先保存或下载已有录音，再自行停止占用4317的原型服务；否则受管服务启动会明确失败，不会自动关闭其他程序。此开发外壳依赖安装好的Node与本机服务，开发模式下页面使用同源API，无暴露原生IPC命令或远程能力。

第009轮通过官方rustup安装项目隔离Rust 1.98.1到.tools，CARGO_HOME和RUSTUP_HOME由桌面脚本传递，不修改系统PATH。Cargo.lock固定首次解析依赖。第058轮曾误判运行库归属；SDK UCRT应检查`ucrt.lib`，`msvcrt.lib`属于MSVC普通x64目录。历史LNK1104尚需重启后重新构建验证，不按旧SDK补装建议操作。scripts/repair-desktop.ps1目前只显示手动修复说明，不安装组件。未启动原生应用，也没有成功原生编译证据。

正式构建显式阻止：静态前端在生产模式不能调用目前的相对/api路径，Node服务还没有打包后的生命周期与侧车管理；因此bundle关闭且beforeBuildCommand返回失败。下一步待重启后完成实际原生构建，再实现原生后端或受管理侧车、录音/输入/系统凭据存储。不能将本轮外壳文件写成可分发桌面软件。

参考资料：
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/reference/config/
- https://github.com/cjpais/Handy/blob/2bdf9ac05724fd6fa22f28dabb664c54a43fae3c/src-tauri/Cargo.toml



第128轮自定义快捷键说明：个人定制→桌面全局快捷键，点击听写/问答/翻译/提示词/处理文字/显隐输入框并按键，点击保存并启用。可单独禁用或重新读取，配置在本机shortcuts.json保留。右Alt系列用于按住录音，Ctrl/Alt普通录音组合按一次开始、再次停止。已修复左右Alt录入误判，261项Node/24项Rust及构建通过；真实注册和重启仍待实测。唯一TalkCraft.exe已更新到128版，旧后台重启阻碍仍见127轮。



