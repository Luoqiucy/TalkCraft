# Living Fluid Orb HUD：核心架构与动效模块

## 当前集成状态（2026-09-18，第123轮）

第134轮待部署：声音用启动预加载的WebAudio双缓冲和固定0.45 Gain，首轮/后续同参数；结果预览只在内容变化时写DOM，常显完整滚动文本，阅读区可选择。完整复制快照走Windows原生Unicode剪贴板，避免隐藏工作台焦点限制；阅读区临时启用HUD交互能力。当前运行应用尚未替换，真实音量/选择/剪贴板及CPU仍待验收，不能沿用123轮待机采样作保证。

第124轮补充（代码完成，原生替换待退出）：HUD禁用系统阴影及焦点获取，胶囊去掉边框/黑色投影。外部录音的四模式最终文字自动提交到处理完成时的外部前台光标，工作台保留结果供失败复制；拒绝软件自身与无效窗口，不抢焦点、不自动重试。用户需要让目标编辑器的输入框保持光标，原生系统接受事件不等于目标软件已正确插入，实际兼容待验收。当前运行第123版仍无新接口，需退出后统一构建。

核心已挂载Windows原生HUD，最新入口为src-tauri/target/debug/TalkCraft.exe。原生初始化标识选择新渲染器，旧渲染器只保留兼容路径。384×360无边框透明置顶宿主承载七态胶囊、语言与快捷键浮层；按钮不参与非等比缩放，周围背景可以拖动。透明空白区域的穿透命中尚未实现或验收。

真实工作台capture-state驱动提示音，开始/停止各播放对应用户WAV一次；HUD不另建录音流、不重复播放声音。既有全局自定义快捷键继续生效，模式、真实音量、时间及上限从工作台广播。可选AltRight适配接口仍未默认启用，避免覆盖既有快捷键。

音量分析/绘制和状态广播约15Hz，隐藏HUD暂停CSS动效，减少空闲绘制。Windows实测待机30.04秒，初始应用/WebView2进程树加后台服务累计CPU 2秒，16逻辑核归一均值0.416%。这只是一次短时待机采样；录音/Thinking、长期运行、后台窗口波形及macOS仍待验证，不能保证全状态CPU低于0.5%。宽高和不规则半径仍有布局/绘制成本。

测试及限制见reports/2026-09-18-phase1-123.md。下文第122轮“未替换”描述仅为当时核心交付历史。

2026-09-18。用户最新悬浮条设计依据：悬浮栏_prd/code.html。本文为用户要求的“先输出核心架构和关键CSS/JS模块”交付，不代表已完成运行中HUD替换。工作台继续沿用现有Figma设计，Phase顺序及ESP32-S3/Wi-Fi不变。

## 架构

工作台继续拥有唯一录音会话、ASR和文字模型。CaptureState/ProcessingState/Result事件生成状态快照，通过已有同实例BroadcastChannel传给HUD。HUD只渲染与转发开始/停止/取消、语言选择和展开动作，不能创建第二个麦克风流。录音入口业务沿用118轮：工作台自动转写后手动整理，外部入口自动按四模式输出。

public/living-fluid.mjs提供fluidState纯状态归约、createFluidHud DOM渲染器、createCaptureSounds音频回调及bindAltPushToTalk可选键适配。public/living-fluid.css为独立命名空间样式；无远程字体或框架依赖。音效仅在工作台绑定一次，HUD不重复播放。

## 七态与真实触发

|状态|胶囊尺寸|触发|
|---|---|---|
|A|68×32|休眠、未唤醒|
|B|156×42|唤醒就绪；错误保留在状态文案|
|C|236×48|真实录音中，非翻译模式|
|D|148×40|权限获取/停止收尾/转写及模型处理中|
|E|236×48|翻译录音或已唤醒的翻译模式，260px语言浮层|
|F|236×48|快捷键指南展开，320px毛玻璃浮层|
|G|160×42|实际结果就绪；不宣称已经键入其他窗口|

录音和处理优先于普通指南/旧结果。以levels（10个0–1值）、energy（0–1总体能量）驱动波形scaleY与光球scale；没有随机波形或定时模拟成功。原型中的D→G演示定时器、示例识别文本和“已注入光标”均不当作产品逻辑。

## CSS关键机制

胶囊宽高使用320ms和cubic-bezier(0.34,1.25,0.64,1)。圆形按钮独立固定28×28、aspect-ratio:1，不放进拉伸父层；背景随胶囊尺寸变化，按钮只做均匀scale/opacity过渡。

orb-morph保留原始42/58、68/32、48/52百分比半径关键帧；ripple-expand保留scale(.8→2.4)与opacity(.9→0)。高光使用mix-blend-mode:screen，青蓝#06b6d4/#38bdf8，成功翠绿#22c55e。Thinking呼吸、多层旋转、水纹、翻译双色和对勾回弹分别独立层。

旋转、呼吸、波形和浮层主要使用transform/opacity，will-change只用于少量频繁变化层。静态发光替代不断动画的filter/box-shadow，休眠停止其他光层动画，隐藏时suspended暂停动画，支持prefers-reduced-motion。border-radius形变和宽高过渡仍涉及绘制/布局，不能称为全GPU零成本。

## 音效与按键接口

资源：public/assets/sounds/record-start.wav（用户按下音效.wav原样复制）、record-end.wav（用户松开音效.wav原样复制）。新建服务有明确audio/wav资源路由；当前运行服务需安全重启后才加载新增路由，不能把测试临时服务当作当前服务已更新。

```js
import {createCaptureSounds, bindCaptureSounds, createFluidHud} from '/living-fluid.mjs';
const sounds = createCaptureSounds({onError: error => console.debug('提示音未播放', error)});
const cleanupSounds = bindCaptureSounds(window, sounds); // 只在工作台
// sounds.PlayStartSound() / sounds.PlayEndSound() 可供原生按键适配调用。
// 声音播放失败不阻断录音；capture-state去重，真实recording/stopping才触发。
const hud = createFluidHud({root: document.querySelector('#orbHud'),
  onStart: () => channel.postMessage({type:'record'}),
  onFinish: () => channel.postMessage({type:'record'}),
  onCancel: () => channel.postMessage({type:'cancel'})});
hud.update({capture:'recording',mode:'dictation',energy:.4,levels:[.2,.5,.8,.4,.3,.5,.9,.3,.4,.2]});
```

示例levels仅展示API，接入必须替换为真实音频。AltRight本地按住/松开接口默认禁用，过滤重复按下、失焦释放，现有可定制原生全局键仍优先。要让Alt在其他软件前台也有效，需要原生按键按下/松开事件适配；不能把浏览器keydown称为全局监听。按键释放进入处理，真实结果到达才显示G；没有按键直接触发成功的假状态。

## 下一步窗口集成与验收

Tauri hud配置需transparent:true，页面及WebView背景透明，保留无边框/置顶/隐藏到后台/单实例。胶囊视觉尺寸与OS窗口尺寸分开，避免每帧原生resize；窗口要预留水纹发光及320px指南，面板显示时调整包络。透明空白区域命中测试、全圈拖动（控件除外）及多屏DPI需单独处理。macOS透明窗口能力、点击穿透与相关配置需在Mac验证，未拥有条件时标待验收。

接入现有HUD DOM与BroadcastChannel后需实测七态切换、重复开始/完成/取消、真实音量、语言选择、指南真实快捷键、提示音只响一次、关闭主界面仍可录音以及隐藏后恢复。G状态应提供继续下一轮操作，避免121已修复问题回归。

CPU<0.5%是验收目标，不是已完成指标：在固定Windows/macOS机器记录进程CPU归一口径、采样时长、刷新率、DPI、idle/recording/thinking/hidden状态及无动画基线，区别ASR/LLM成本与HUD增量。当前没有实机性能测量，不能保证达到该数值。
