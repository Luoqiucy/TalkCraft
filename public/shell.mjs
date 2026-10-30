import {initializeHistory} from './history-ui.mjs';
import {createFluidHud} from './living-fluid.mjs';
import {initializeOutputUi,initializeCloseUi,shortcutFromKeyEvent} from './live-state.mjs';
import {initializeModelSettings} from './model-settings.mjs';

import {createTranslationActions} from './translation.mjs';
const windowParams=new URLSearchParams(globalThis.location?.search||'');
const panelKind=windowParams.get('panel');
if (!/[?&]hud=1(?:&|$)/.test(globalThis.location?.search || '')&&!panelKind) {
initializeModelSettings();
const $=id=>document.getElementById(id);
if(window.__TAURI__?.core){
 const dialog=document.createElement('dialog');dialog.className='close-choice';dialog.innerHTML='<h2>关闭 TalkCraft？</h2><p data-close-message></p><label><input type="checkbox" data-close-remember> 记住我的选择</label><div class="row"><button data-close-action="cancel">取消</button><button data-close-action="minimize">最小化窗口</button><button class="primary" data-close-action="exit">退出程序</button></div>';document.body.append(dialog);
 const desktopInvoke=command=>window.__TAURI__.core.invoke(command);
 const closeUi=initializeCloseUi({dialog,beforeExit:async()=>{await desktopInvoke('desktop_prepare_exit');await window.__talkcraftHistory?.saved();},afterExitFailure:()=>desktopInvoke('desktop_restore_after_exit_failure'),remember:dialog.querySelector('[data-close-remember]'),message:dialog.querySelector('[data-close-message]'),invoke:desktopInvoke,storage:globalThis.localStorage,hasUnsaved:()=>['acquiring','recording','stopping'].includes(document.body.dataset.capture)||!$('cancel').disabled||!!$('playback').getAttribute('src')});
 dialog.querySelector('[data-close-action=cancel]').onclick=()=>dialog.close();for(const action of ['exit','minimize'])dialog.querySelector('[data-close-action='+action+']').onclick=()=>closeUi.choose(action);
 window.addEventListener('talkcraft-close-request',event=>closeUi.request({force:!!event.detail?.force}));
 $('quitDesktop').hidden=false;$('quitDesktop').addEventListener('click',()=>closeUi.request({force:true}));
 const reset=document.createElement('button');reset.textContent='重新选择关闭行为';reset.type='button';reset.onclick=()=>{closeUi.reset();toast('下次关闭时将重新询问');};$('quitDesktop').after(reset);
}
const names={dictation:'听写',prompt:'提示词预设',translate:'翻译',chat:'问答'};
let workspace,selected,deleted,lastResult,busy=false,toastTimer;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function page(name){document.body.dataset.page=name;document.querySelectorAll('[data-view]').forEach(el=>el.hidden=el.dataset.view!==name);document.querySelectorAll('nav [data-page]').forEach(el=>{if(el.dataset.page===name)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});$('pageTitle').textContent={workbench:'智能转写与处理',history:'历史记录',device:'硬件与四键状态',custom:'个人定制',settings:'硬件与系统配置',onboarding:'首次使用引导'}[name];if(name==='history')renderHistory();}
document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',()=>page(el.dataset.page)));
const media=window.matchMedia('(prefers-color-scheme: dark)');
 function theme(value){const dark=value==='dark'||value==='system'&&media.matches;document.body.classList.toggle('dark',dark);$('themeIcon').textContent=dark?'☀':'☾';$('themeToggle').setAttribute('aria-label',dark?'切换到浅色模式':'切换到深色模式');}
media.addEventListener('change',()=>theme($('themePreference').value));
$('themePreference').addEventListener('change',()=>theme($('themePreference').value));
$('themeToggle').addEventListener('click',()=>{const value=document.body.classList.contains('dark')?'light':'dark';$('themePreference').value=value;theme(value);toast('外观已预览；在设置保存后生效到下次启动');});
async function load(){try{const response=await fetch('/api/workspace');if(!response.ok)throw new Error('无法读取本地设置');workspace=await response.json();$('themePreference').value=workspace.preferences.theme;theme(workspace.preferences.theme);$('preferencesStatus').textContent='已读取本地设置';renderHistory();}catch(error){$('preferencesStatus').textContent=error.message;toast(error.message);}}
async function save(next){if(!workspace || busy)throw new Error('设置未就绪或正在保存，请稍后重试');busy=true;try{const response=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...next,revision:workspace.revision})});const data=await response.json();if(!response.ok)throw new Error(data.error);workspace=data;renderHistory();return data;}finally{busy=false;}}
$('reloadPreferences').addEventListener('click',()=>{if(!busy)load();});
$('savePreferences').addEventListener('click',async()=>{try{await save({...workspace,preferences:{...workspace.preferences,theme:$('themePreference').value}});toast('外观已保存；历史设置请使用下方专用保存按钮');}catch(error){$('preferencesStatus').textContent=error.message;}});
const historyUi=initializeHistory({toast,onReuse:item=>{if($('transcript').value.trim()&&!window.confirm('替换工作台已有输入？'))return;window.dispatchEvent(new CustomEvent('history-reuse',{detail:{id:item.id}}));$('transcript').value=item.revisedText||item.originalTranscript||'';$('transcript').dispatchEvent(new Event('input'));document.querySelector(`[data-mode="${item.mode}"]`).click();page('workbench');}});
function renderHistory(){historyUi.refresh();}
window.addEventListener('text-result',event=>{$('resultTitle').textContent=`${names[event.detail.mode]}结果`;$('saveDraft').disabled=false;});
window.addEventListener('text-result',event=>{if(event.detail.mode==='chat'&&window.__TAURI__?.core)window.__TAURI__.core.invoke('panel_window',{panel:'chat',action:'show'}).catch(error=>toast(`问答窗口打开失败：${String(error)}`));});
window.addEventListener('result-restored',()=>{$('saveDraft').disabled=true;});
$('saveDraft').addEventListener('click',async()=>{await window.__talkcraftHistory.saved();page('history');toast('历史按保存设置自动归档；保存失败时工作台内容仍保留');});
$('reprocess').addEventListener('click',()=>$('process').click());
$('clearInput').addEventListener('click',()=>{if($('transcript').value && !window.confirm('清空输入文字？结果和录音将保留。'))return;$('transcript').value='';$('transcript').dispatchEvent(new Event('input'));});
function counts(){$('charCount').textContent=`字数：${$('transcript').value.length}`;$('outputCount').textContent=`${$('result').textContent==='处理结果会显示在这里'?0:$('result').textContent.length} 字`;}
$('transcript').addEventListener('input',counts);new MutationObserver(counts).observe($('result'),{childList:true,characterData:true,subtree:true});
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{$('resultTitle').textContent={dictation:'听写文字',prompt:'提示词预设结果',translate:'目标译文',chat:'简洁回答'}[button.dataset.mode];$('process').textContent={dictation:'听写不调用文字模型',prompt:'✧ 生成预设提示词',translate:'文 翻译文本',chat:'▢ 发送问题'}[button.dataset.mode];$('tone').disabled=button.dataset.mode!=='prompt';$('process').hidden=button.dataset.mode==='dictation';}));
$('tone').addEventListener('change',()=>{$('toneLabel').textContent=$('tone').selectedOptions[0].textContent;});
async function service(){try{const response=await fetch('/api/status');if(!response.ok)throw new Error('服务状态读取失败');const data=await response.json();$('serviceBadge').textContent=data.simulated?'● 模拟文字服务':`● ${data.provider} 已配置`;$('textProvider').value=data.simulated?'本地模拟 · 未调用 AI':`${data.provider} · ${data.local?'本机模型':'云端环境配置'}`;$('audioProvider').value=!data.audioTranscription?'关闭 · 未接入真实 ASR':data.asrSimulated?'模拟 · 不识别音频':'云端识别';$('settingsServiceStatus').textContent='已读取配置状态；未发起付费测试，也不代表真实服务验收。';}catch(error){$('settingsServiceStatus').textContent=error.message;}}
$('checkService').addEventListener('click',service);
document.querySelectorAll('[data-key]').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('[data-key]').forEach(x=>x.classList.toggle('active',x===el));$('keyPreview').textContent=`按键 ${el.dataset.key} · ${el.textContent.split('·')[1]} · 默认映射预览`;}));

const outputUi=initializeOutputUi({element:$,invoke:window.__TAURI__?.core? (command,args)=>window.__TAURI__.core.invoke(command,args):undefined});
const outputObserver=new MutationObserver(()=>outputUi.sync());
outputObserver.observe($('copy'),{attributes:true,attributeFilter:['disabled']});
outputObserver.observe($('result'),{childList:true,subtree:true,characterData:true});
window.addEventListener('beforeunload',()=>{outputObserver.disconnect();outputUi.dispose();});
let outputTargetBusy=false;
async function checkOutputTarget(){
 if(outputTargetBusy)return;
 outputTargetBusy=true;$('checkOutputTarget').disabled=true;
 $('outputTargetStatus').textContent='正在检查目标应用…';
 try{
  const target=await window.__TAURI__.core.invoke('output_target');
  $('outputTargetStatus').textContent=target.available?`已记录目标：${target.title||'未命名窗口'} · 输出前请切回目标窗口`:`无有效输入目标：${target.reason||'请在目标应用中触发全局快捷键后重试'}`;
 }catch(error){$('outputTargetStatus').textContent=`目标检查失败：${String(error)}；请使用支持目标记录的新版桌面程序`;
 }finally{outputTargetBusy=false;$('checkOutputTarget').disabled=false;}
}
if(window.__TAURI__?.core){$('checkOutputTarget').disabled=false;$('checkOutputTarget').addEventListener('click',checkOutputTarget);$('outputTargetStatus').textContent='在目标应用中触发全局快捷键，再点击检查；输出前请切回目标窗口';}
else{$('outputTargetStatus').textContent='浏览器预览仅支持复制文字，无法记录系统输入目标';}
const shortcutActions=['dictation','chat','translate','prompt','process','hud'];
let shortcutConfig,shortcutBusy=false;
function shortcutLock(value){shortcutBusy=value;$('saveShortcuts').disabled=value||!shortcutConfig;$('reloadShortcuts').disabled=value;for(const action of shortcutActions)$('shortcut-'+action).disabled=value;document.querySelectorAll('[data-clear-shortcut]').forEach(button=>button.disabled=value);}
 const shortcutNames={dictation:'听写',chat:'问答',translate:'翻译',prompt:'提示词预设',process:'处理当前文字',hud:'显示 / 隐藏悬浮条'};
 const shortcutLabel=key=>key==='RightAltDouble'?'右 Alt 快速双击':key?.replaceAll('RightAlt','右 Alt').replaceAll('RightShift','右 Shift').replaceAll('+',' + ')||'已禁用';
 const publishShortcutGuide=()=>{window.__TALKCRAFT_KEYMAP_BINDINGS__=Object.fromEntries(Object.entries(shortcutConfig?.bindings||{}).map(([name,key])=>[name,shortcutLabel(key)]));window.__TALKCRAFT_KEYMAP_TEXT__=Object.entries(shortcutConfig?.bindings||{}).map(([name,key])=>`${shortcutNames[name]||name}：${shortcutLabel(key)}`).join('\n');};
 async function readShortcuts(){if(shortcutBusy)return;shortcutLock(true);$('shortcutStatus').textContent='正在读取快捷键…';try{shortcutConfig=await window.__TAURI__.core.invoke('shortcuts_read');for(const action of shortcutActions)$('shortcut-'+action).value=shortcutConfig.bindings[action];window.__TALKCRAFT_HUD_KEY__=shortcutConfig.bindings.hud;publishShortcutGuide();$('shortcutStatus').textContent=shortcutConfig.status;}catch(error){shortcutConfig=undefined;$('shortcutStatus').textContent=`读取失败：${String(error)}；请使用支持快捷键的新版桌面程序`;}finally{shortcutLock(false);}}
if(window.__TAURI__?.core){
 $('reloadShortcuts').addEventListener('click',readShortcuts);
 for(const action of shortcutActions){
  const input=$('shortcut-'+action),held={rightAlt:false,rightShift:false,lastRightAltUp:0};
  input.addEventListener('keyup',event=>{if(event.code==='AltRight'){held.rightAlt=false;held.lastRightAltUp=Date.now();}if(event.code==='ShiftRight')held.rightShift=false;});
  input.addEventListener('blur',()=>{held.rightAlt=false;held.rightShift=false;held.lastRightAltUp=0;});
  input.addEventListener('keydown',event=>{
   if(event.code==='Tab')return;event.preventDefault();event.stopPropagation();if(shortcutBusy||event.repeat)return;
   let key;if(event.code==='AltRight'&&held.lastRightAltUp&&Date.now()-held.lastRightAltUp<=320){key='RightAltDouble';held.lastRightAltUp=0;}else{if(event.code==='AltRight')held.rightAlt=true;if(event.code==='ShiftRight')held.rightShift=true;key=shortcutFromKeyEvent(event,held);}
   if(!key){if(!/^(Alt|Shift|Control|Meta)(Left|Right)$/.test(event.code))$('shortcutStatus').textContent='请按一个功能键，或同时按下两个及以上按键';return;}
   if(key.startsWith('RightAlt')&&['process','hud'].includes(action)){$('shortcutStatus').textContent='右侧按键用于录音模式；此功能请选择Ctrl或Alt组合键';return;}
   input.value=key;$('shortcutStatus').textContent=key.includes('+')||key==='RightAltDouble'?'组合键修改尚未保存，点击保存并启用':'单键会在全局占用该按键；确认后点击保存并启用';
  });
 }
 document.querySelectorAll('[data-clear-shortcut]').forEach(button=>button.addEventListener('click',()=>{if(!shortcutBusy){$('shortcut-'+button.dataset.clearShortcut).value='';$('shortcutStatus').textContent='禁用尚未保存';}}));
  $('saveShortcuts').addEventListener('click',async()=>{if(shortcutBusy||!shortcutConfig)return;shortcutLock(true);try{const bindings=Object.fromEntries(shortcutActions.map(action=>[action,$('shortcut-'+action).value]));shortcutConfig=await window.__TAURI__.core.invoke('shortcuts_save',{bindings,revision:shortcutConfig.revision});window.__TALKCRAFT_HUD_KEY__=shortcutConfig.bindings.hud;publishShortcutGuide();$('shortcutStatus').textContent=shortcutConfig.status;}catch(error){$('shortcutStatus').textContent=`保存失败：${String(error)}`;}finally{shortcutLock(false);}});
 readShortcuts();
}else{$('shortcutStatus').textContent='浏览器预览不支持全局快捷键，请打开Windows桌面程序';shortcutLock(true);}
const defaultCustom=$('customContent').innerHTML;
document.querySelectorAll('[data-custom]').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('[data-custom]').forEach(x=>x.setAttribute('aria-pressed',String(x===el)));if(el.dataset.custom==='keys')$('customContent').innerHTML=defaultCustom;else{$('customContent').replaceChildren();const h=document.createElement('h2');h.textContent=el.dataset.custom==='dictionary'?'个人专有词典':'应用配置';const p=document.createElement('p');p.className='empty';p.textContent=el.dataset.custom==='dictionary'?'暂无词条。词条编辑、导入导出与识别注入将在 Phase 3 接通。':'暂无应用规则。自动选择模式与输出规则将在 Phase 3 接通。';$('customContent').append(h,p);}}));
document.querySelectorAll('[data-setting]').forEach(el=>el.addEventListener('click',()=>{document.querySelectorAll('[data-setting]').forEach(x=>x.setAttribute('aria-pressed',String(x===el)));if(el.dataset.setting==='privacy' || el.dataset.setting==='appearance')document.querySelector('.privacy-settings').scrollIntoView({block:'center'});else if(el.dataset.setting==='recording')toast('录音最多120秒；本地准备16kHz单声道PCM，原始音频不落盘。');else $('settingsContent').scrollIntoView({block:'start'});}));
$('showFloat').addEventListener('click',()=>{if(window.__TAURI__?.core)window.__TAURI__.core.invoke('hud_window',{action:'toggle'}).catch(error=>toast(String(error)));else $('floatingBar').hidden=false;});$('reopenHud').addEventListener('click',()=>{if(window.__TAURI__?.core)window.__TAURI__.core.invoke('hud_window',{action:'show'}).catch(error=>toast(String(error)));else $('floatingBar').hidden=false;});$('closeFloat').addEventListener('click',()=>$('floatingBar').hidden=true);$('floatRecord').addEventListener('click',()=>$('record').click());
new MutationObserver(()=>{$('floatStatus').textContent=$('status').textContent;$('floatRecord').disabled=$('record').disabled;$('floatRecord').textContent=$('record').textContent;}).observe($('status'),{childList:true,characterData:true,subtree:true});
load();service();
const translationActions=createTranslationActions({clipboard:text=>navigator.clipboard.writeText(text),notify:toast,download(text,name){
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);
  try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}});
const translationRow=document.createElement('div');translationRow.className='row';translationRow.hidden=true;
const bilingualCopy=document.createElement('button'),translationExport=document.createElement('button');
bilingualCopy.id='copyBilingual';bilingualCopy.textContent='▢ 双语复制';translationExport.id='exportTranslation';translationExport.textContent='↓ 导出双语文本 (.txt)';
translationRow.append(bilingualCopy,translationExport);document.querySelector('.output-panel').append(translationRow);
bilingualCopy.addEventListener('click',()=>translationActions.copy());translationExport.addEventListener('click',()=>translationActions.export());
window.addEventListener('text-result',event=>{translationRow.hidden=!translationActions.set(event.detail);});
window.addEventListener('result-restored',()=>{translationActions.clear();translationRow.hidden=true;});
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{if(lastResult && lastResult.mode!==button.dataset.mode)$('resultTitle').textContent=`上次结果 · ${names[lastResult.mode]}`;}));




}

// Auxiliary panels are independent windows. They render state broadcast by the workbench
// and never own the microphone or trigger network work while being viewed.
if(panelKind&&window.__TAURI__?.core&&typeof BroadcastChannel!=='undefined'){
 document.querySelector('.sidebar').hidden=true;document.querySelector('.shell').hidden=true;document.querySelector('#usageAgreement').hidden=true;document.querySelector('#floatingBar').hidden=true;
 document.body.className='aux-window';document.body.dataset.panel=panelKind;
 const root=document.createElement('section');root.className='aux-card';root.innerHTML=panelKind==='keymap'
  ?'<header data-panel-drag><div><strong>快捷键提示</strong><small>按一次开始，再按一次结束</small></div><button data-panel-close aria-label="关闭快捷键提示">×</button></header><p class="aux-hint">长按右 Alt 可再次打开此窗口。</p><dl class="keymap-list" aria-live="polite"></dl>'
  :'<header data-panel-drag><div><strong>问答对话</strong><small>独立窗口 · 可随时关闭</small></div><button data-panel-close aria-label="关闭问答窗口">×</button></header><div class="chat-window-status" role="status">等待问答结果</div><pre class="chat-window-history" tabindex="0"></pre><div class="aux-actions"><button data-chat-copy disabled>复制完整回答</button><button data-chat-main>打开工作台</button></div>';
 document.body.append(root);
 const invoke=(action)=>window.__TAURI__.core.invoke('panel_window',{panel:panelKind,action}).catch(()=>{});
 root.querySelector('[data-panel-close]').onclick=()=>invoke('hide');root.querySelector('[data-panel-drag]').onpointerdown=event=>{if(!event.target.closest('button'))invoke('drag');};
 const channel=new BroadcastChannel(`talkcraft-desktop-hud-v1-${window.__TALKCRAFT_SESSION__||'legacy'}`);
 const labels={dictation:'听写',chat:'问答',translate:'翻译',prompt:'提示词预设',process:'处理当前文字',hud:'显示 / 隐藏悬浮条'};
 const render=value=>{document.body.classList.toggle('dark',!!value.dark);if(panelKind==='keymap'){const list=root.querySelector('.keymap-list');list.replaceChildren();for(const [name,key] of Object.entries(value.keymapBindings||{})){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=labels[name]||name;dd.textContent=key||'已禁用';list.append(dt,dd);}if(!list.children.length){const p=document.createElement('p');p.textContent='正在读取快捷键配置…';list.append(p);}}
  else{const history=root.querySelector('.chat-window-history'),text=value.chatHistory||value.mode==='问答'&&value.output||'';root.querySelector('.chat-window-status').textContent=value.processing&&value.mode==='问答'?'正在生成回答…':text?'问答已更新':'暂无问答内容';history.textContent=text||'完成一次问答后，完整对话会显示在这里。';const copy=root.querySelector('[data-chat-copy]');copy.disabled=!text;copy.onclick=async()=>{try{await window.__TAURI__.core.invoke('clipboard_write',{text});copy.textContent='已复制';}catch{copy.textContent='复制失败';}};root.querySelector('[data-chat-main]').onclick=()=>window.__TAURI__.core.invoke('panel_window',{panel:'chat',action:'main'}).catch(error=>{root.querySelector('.chat-window-status').textContent=`打开工作台失败：${String(error)}`;});}}
 channel.onmessage=event=>{if(event.data?.type==='state')render(event.data);};channel.postMessage({type:'sync'});window.addEventListener('beforeunload',()=>channel.close(),{once:true});
}
// Only the workbench owns the microphone; the separate HUD forwards user actions.
else if (window.__TAURI__?.core && typeof BroadcastChannel !== 'undefined') {
 const hud=new URLSearchParams(location.search).get('hud')==='1';
 const channel=new BroadcastChannel(`talkcraft-desktop-hud-v1-${window.__TALKCRAFT_SESSION__||'legacy'}`);
 const byId=id=>document.getElementById(id);
 let observer, heartbeat, lastUpdate=Date.now(),lastHudState;
 const invoke=action=>window.__TAURI__.core.invoke('hud_window',{action}).catch(error=>{
  const status=byId('floatStatus');
  if(status)status.textContent=String(error).includes('不允许的悬浮窗操作')
   ?'桌面版本过旧，请打开悬浮窗修正版'
   :`悬浮窗操作失败：${String(error)}`;
 });
 if(hud&&window.__TALKCRAFT_FLUID__){
  document.querySelector('.sidebar').hidden=true;document.querySelector('.shell').hidden=true;
  document.body.classList.add('native-hud','fluid-active');document.body.style.cssText='margin:0;background:transparent;overflow:hidden';
  const root=byId('floatingBar');root.hidden=false;root.className='fluid-host';
   let selecting=false,overPreview=false;
  const interactive=value=>window.__TAURI__.core.invoke('hud_interactive',{interactive:value}).catch(()=>{});
  const releasePreview=()=>{selecting=false;overPreview=false;interactive(false);};
   const send=type=>{if(type==='record')releasePreview();channel.postMessage({type});};let current={capture:'idle',disabled:true},awake=false;
  const renderer=createFluidHud({root,onStart:()=>send('record'),onFinish:()=>send('record'),onCancel:()=>send('cancel'),onHide:()=>invoke('hide'),onOpenWorkbench:()=>invoke('main'),onLanguage:language=>channel.postMessage({type:'language',language})});
  const controls=document.createElement('div');controls.className='fluid-controls';
   controls.innerHTML='<button data-fluid-action="guide">快捷键</button><button data-fluid-action="chat" hidden>查看问答</button><button data-fluid-action="copy">复制结果</button><button data-fluid-action="main">工作台</button><button data-fluid-action="hide">隐藏</button><pre></pre>';
  root.append(controls);
   let lastHudLayout,hitRegionSettleTimer;
   const syncHitRegions=layout=>{
    const candidates=[root.querySelector('.fluid-capsule'),root.querySelector('.fluid-panel'),root.querySelector('.fluid-language'),root.querySelector('.fluid-meta'),...(awake||controls.dataset.ready==='true'?[controls]:[])];
    const regions=candidates.filter(element=>element&&!element.hidden&&typeof element.getBoundingClientRect==='function').map(element=>{const r=element.getBoundingClientRect(),capsule=element.classList?.contains?.('fluid-capsule');if(capsule&&layout){const width=Math.max(r.width,layout.width),height=Math.max(r.height,layout.height),cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2;return [cx-width/2,cy-height/2,cx+width/2,cy+height/2,Math.min(width,height)/2];}return [r.left,r.top,r.right,r.bottom,capsule?Math.min(r.width,r.height)/2:8];}).filter(r=>r[2]-r[0]>1&&r[3]-r[1]>1);
    if(regions.length)window.__TAURI__.core.invoke('hud_hit_regions',{regions}).catch(()=>{});
   };
  root.onpointerenter=()=>{awake=true;render();};root.onpointerleave=()=>{awake=false;render();};
  const preview=controls.querySelector('pre');preview.tabIndex=0;preview.setAttribute?.('aria-label','完整处理结果，可选择文字或滚动查看');
  preview.onpointerenter=()=>{overPreview=true;interactive(true);};
  preview.onpointerdown=()=>{selecting=true;};
  preview.onpointerleave=()=>{overPreview=false;if(!selecting)interactive(false);};
  const endSelection=()=>{selecting=false;if(!overPreview)interactive(false);};
  window.addEventListener('pointerup',endSelection);window.addEventListener('pointercancel',releasePreview);window.addEventListener('blur',releasePreview);
   controls.onclick=async event=>{const action=event.target.closest('button')?.dataset.fluidAction;if(action==='guide'){window.__TAURI__.core.invoke('panel_window',{panel:'keymap',action:'show'}).catch(()=>{});}else if(action==='chat'){window.__TAURI__.core.invoke('panel_window',{panel:'chat',action:'show'}).catch(()=>{});}else if(action==='copy'){
   const text=preview.textContent||'';const button=controls.querySelector('[data-fluid-action=copy]');
   if(!text)return;try{await window.__TAURI__.core.invoke('clipboard_write',{text});button.textContent=`已复制 ${text.length} 字`;}catch(error){button.textContent='复制失败，点击重试';button.title=String(error);}
  }else if(action==='main')invoke('main');else if(action==='hide')invoke('hide');};
    const render=()=>{const previous=lastHudLayout,layout=renderer.update({...current,awake,suspended:document.hidden,keymap:false,mode:({听写:'dictation',翻译:'translate','提示词预设':'prompt',问答:'chat'})[current.mode]||current.mode||'dictation',levels:(current.wave||[]).slice(0,10).map(height=>Math.max(0,Math.min(1,(parseFloat(height)-3)/19))),energy:Math.max(0,Math.min(1,(parseFloat(current.level)+60)/60)),error:current.capture==='error'?current.status:current.error});lastHudLayout=layout;const chat=current.mode==='问答',text=current.ready&&!chat?current.output||'':'';if(preview.textContent!==text){preview.textContent=text;controls.querySelector('[data-fluid-action=copy]').textContent='复制完整结果';}controls.querySelector('[data-fluid-action=chat]').hidden=!(chat&&current.ready);preview.hidden=chat;controls.dataset.ready=String(!!text||chat&&current.ready);controls.querySelector('[data-fluid-action=copy]').hidden=chat;controls.querySelector('[data-fluid-action=copy]').disabled=!text;const envelope=previous&&layout?{width:Math.max(previous.width,layout.width),height:Math.max(previous.height,layout.height)}:layout;syncHitRegions(envelope);if(previous&&layout&&(previous.width!==layout.width||previous.height!==layout.height)){clearTimeout(hitRegionSettleTimer);hitRegionSettleTimer=setTimeout(()=>syncHitRegions(lastHudLayout),layout.duration+40);}};
  channel.onmessage=event=>{if(event.data?.type!=='state')return;lastUpdate=Date.now();current=event.data;if(!document.hidden)render();};
  const drag=event=>{if(event.button===0&&!event.target.closest('button,a,input,select,textarea,pre')){event.preventDefault();invoke('drag');}};
  document.body.addEventListener('pointerdown',drag);
  const key=event=>{if(event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;if(event.code==='Escape'){event.preventDefault();if(current.capture==='recording'||current.processing)send('cancel');else invoke('hide');}else if(event.code==='Enter'&&current.capture==='recording'&&!current.disabled){event.preventDefault();send('record');}};
  window.addEventListener('keydown',key);render();
  heartbeat=setInterval(()=>{channel.postMessage({type:'sync'});if(Date.now()-lastUpdate>5000){current={...current,disabled:true,error:'工作台已断开'};render();}},2000);
  channel.postMessage({type:'sync'});
   window.addEventListener('beforeunload',()=>{clearTimeout(hitRegionSettleTimer);renderer.dispose();document.body.removeEventListener('pointerdown',drag);window.removeEventListener('keydown',key);window.removeEventListener('pointerup',endSelection);window.removeEventListener('pointercancel',releasePreview);window.removeEventListener('blur',releasePreview);},{once:true});
 }else if(hud){
  document.querySelector('.sidebar').hidden=true;document.querySelector('.shell').hidden=true;
  document.body.style.cssText='margin:0;overflow:hidden;background:var(--bg)';
  const bar=byId('floatingBar');bar.hidden=false;
  document.body.classList.add('native-hud');
  bar.innerHTML=`<div class="hud-line"><button class="logo hud-icon" title="拖动悬浮条" aria-label="拖动悬浮条"><img src="/assets/figma/imgContainer90.svg" alt=""></button><span id="hudMode" class="hud-mode">听写</span><span id="hudTime" class="hud-time" hidden>00:00</span><span id="hudLimit" class="capture-limit" title="单次录音最多2分钟，到时自动停止">上限 02:00</span><div id="hudWave" class="hud-wave" hidden>${'<i></i>'.repeat(12)}</div><div class="hud-text"><strong id="floatStatus">正在连接工作台</strong><small></small></div><span id="hudSource" class="hud-source">电脑麦</span><button id="floatRecord" class="hud-primary" disabled>录音</button><button id="hudCancel" class="hud-secondary" hidden>放弃 Esc</button><button id="hudExpand" class="hud-icon" aria-label="打开工作台"><img src="/assets/figma/imgContainer91.svg" alt=""></button><button id="closeFloat" class="hud-icon" aria-label="隐藏悬浮条"><img src="/assets/figma/imgContainer92.svg" alt=""></button></div><div id="hudReady" class="hud-ready" hidden><pre id="hudOutput"></pre><div><button disabled title="全局输出前请切回目标窗口">直接键入 · 待接入</button><button id="hudCopy">复制文本</button></div></div>`;
  bar.removeAttribute('style');
  byId('floatStatus').textContent='正在连接工作台';
  const detail=bar.querySelector('small');detail.textContent='独立置顶录音条';
  byId('floatRecord').disabled=true;
  byId('floatRecord').onclick=()=>channel.postMessage({type:'record'});
  byId('closeFloat').onclick=()=>invoke('hide');
  byId('hudExpand').onclick=()=>invoke('main');
  byId('hudCopy').onclick=()=>channel.postMessage({type:'copy'});
  byId('hudCancel').onclick=()=>channel.postMessage({type:'cancel'});
  const onHudKey=event=>{
   if(event.repeat||event.ctrlKey||event.altKey||event.shiftKey||event.metaKey)return;
   if(event.code==='Enter'&&bar.dataset.hudState==='recording'&&!byId('floatRecord').hidden&&!byId('floatRecord').disabled){
    event.preventDefault();byId('floatRecord').onclick();
   }else if(event.code==='Escape'){
    event.preventDefault();
    if(!byId('hudCancel').hidden)byId('hudCancel').onclick();else invoke('hide');
   }
  };
  window.addEventListener('keydown',onHudKey);
  window.addEventListener('beforeunload',()=>window.removeEventListener('keydown',onHudKey),{once:true});
  const onHudDrag=event=>{
   if(event.button!==0)return;
   const interactive=event.target?.closest?.('button,a,input,textarea,select,[contenteditable],pre');
   if(interactive&&!interactive.classList?.contains('logo'))return;
   event.preventDefault?.();invoke('drag');
  };
  // The page includes the outer padding; controls retain their own click/selection behavior.
  document.body.addEventListener('pointerdown',onHudDrag);
  window.addEventListener('beforeunload',()=>document.body.removeEventListener('pointerdown',onHudDrag),{once:true});
  bar.querySelector('.logo').title='拖动悬浮窗';
  channel.onmessage=event=>{
   const value=event.data;if(value?.type!=='state')return;
   lastUpdate=Date.now();byId('floatStatus').textContent=value.status;
   const state=value.capture==='recording'?'recording':value.processing?'processing':value.capture==='error'?'error':value.ready?'ready':'standby';
   bar.dataset.hudState=state;
   const currentMode=value.mode||'听写';if(byId('hudMode').textContent!==currentMode){bar.dataset.modeChange=String(Date.now());byId('hudMode').animate?.([{opacity:.2,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:240});}byId('hudMode').textContent=currentMode;byId('hudMode').hidden=false;
   byId('hudLimit').textContent=value.limitLabel||'上限 02:00';byId('hudLimit').title=value.limitStatus||'单次录音最多2分钟，到时自动停止';byId('hudLimit').dataset.warning=String(!!value.limitWarning);
   byId('hudTime').textContent=value.time;byId('hudTime').hidden=state!=='recording';
   byId('hudWave').hidden=state!=='recording';
   byId('hudWave').querySelectorAll('i').forEach((element,index)=>{element.style.height=value.wave?.[index]||'4px';});
   byId('hudSource').hidden=state!=='standby';
   detail.textContent=state==='processing'?`${value.elapsed||'处理中'} · 可取消` : state==='recording'?value.level : value.hudShortcut?`${value.hudShortcut} · 显示 / 隐藏`:'在个人定制中设置快捷键';
   byId('hudCancel').hidden=!['recording','processing'].includes(state);
   byId('hudCancel').textContent=state==='processing'?'终止并保留原文':'放弃 Esc';
   byId('hudReady').hidden=state!=='ready';byId('hudOutput').textContent=value.ready?value.output||'':'';
   if(state!==lastHudState){invoke(state==='ready'?'expand':'compact');lastHudState=state;}
   byId('floatRecord').textContent=state==='recording'?'完成 ↵':state==='ready'?'继续录音':value.recordLabel;byId('floatRecord').disabled=value.disabled;byId('floatRecord').hidden=state==='processing';
   document.body.classList.toggle('dark',value.dark);
   bar.dataset.capture=value.capture;
   const mic=bar.querySelector('.logo img');mic.src=state==='processing'?'/assets/figma/imgContainer93.svg':'/assets/figma/imgContainer90.svg';
  };
  heartbeat=setInterval(()=>{channel.postMessage({type:'sync'});if(lastUpdate && Date.now()-lastUpdate>3500){byId('floatStatus').textContent='工作台已断开';byId('floatRecord').disabled=true;}},1000);
  channel.postMessage({type:'sync'});
 }else{
   const publishNow=()=>channel.postMessage({type:'state',status:byId('status').textContent,time:byId('captureTime').textContent,level:byId('captureLevel').textContent,recordLabel:byId('record').textContent,disabled:byId('record').disabled,dark:document.body.classList.contains('dark'),capture:document.body.dataset.capture||'idle',limitLabel:byId('captureLimit').dataset.compact,limitStatus:byId('captureLimit').textContent,limitWarning:byId('captureLimit').dataset.warning==='true',hudShortcut:window.__TALKCRAFT_HUD_KEY__,keymapText:window.__TALKCRAFT_KEYMAP_TEXT__,keymapBindings:window.__TALKCRAFT_KEYMAP_BINDINGS__,language:byId('language').value,mode:({dictation:'听写',translate:'翻译',prompt:'提示词预设',chat:'问答'})[document.body.dataset.mode]||'听写',processing:!byId('cancel').disabled||!byId('cancelAsr').disabled,ready:!byId('copy').disabled,output:byId('copy').disabled?'':byId('result').textContent,chatHistory:byId('chatHistory').textContent,elapsed:byId('processingTime').textContent,wave:Array.from(byId('audioWave').querySelectorAll('i')).slice(0,12).map(element=>element.style.height)});
  let publishTimer;const publish=()=>{if(!publishTimer)publishTimer=setTimeout(()=>{publishTimer=undefined;publishNow();},66);};
  window.addEventListener('beforeunload',()=>clearTimeout(publishTimer),{once:true});
   channel.onmessage=event=>{if(event.data?.type==='language'&&['en','zh','zh-TW','ja','ko','fr','de','es','it','pt','ru','ar','hi','th','vi','id','ms','tr','nl','pl','uk'].includes(event.data.language)){byId('language').value=event.data.language;publish();}else if(event.data?.type==='record'){if(!byId('record').disabled)window.dispatchEvent(new Event('hud-record'));}else if(event.data?.type==='copy'){byId('copy').click();}else if(event.data?.type==='cancel'){if(document.body.dataset.capture==='recording')window.dispatchEvent(new Event('hud-discard'));else{if(!byId('cancel').disabled)byId('cancel').click();if(!byId('cancelAsr').disabled)byId('cancelAsr').click();}}else if(event.data?.type==='sync')publish();};
  observer=new MutationObserver(publish);
   for(const id of ['status','captureTime','captureLevel','record','result','chatHistory','copy','cancel','cancelAsr','processingTime','audioWave','captureLimit'])observer.observe(byId(id),{subtree:true,childList:true,characterData:true,attributes:true});
  observer.observe(document.body,{attributes:true,attributeFilter:['class','data-capture','data-mode']});
  heartbeat=setInterval(publish,1000);publish();
 }
 window.addEventListener('beforeunload',()=>{observer?.disconnect();clearInterval(heartbeat);channel.close();},{once:true});
}









