export const FLUID_STATES=Object.freeze({A:[68,32],B:[156,42],C:[236,48],D:[148,40],E:[236,48],F:[236,48],G:[160,42]});
export const FLUID_MOTION=Object.freeze({duration:320,easing:'cubic-bezier(0.34, 1.25, 0.64, 1)'});
export function fluidState(value={}){
 if(value.capture==='recording')return value.mode==='translate'?'E':'C';
 if(value.processing||['acquiring','stopping'].includes(value.capture))return 'D';
 if(value.error)return 'B';
 if(value.keymap)return 'F';
 if(value.ready)return 'G';
 if(value.mode==='translate'&&value.awake)return 'E';
 return value.awake?'B':'A';
}
export function createCaptureSounds({AudioClass=globalThis.Audio,ContextClass=globalThis.AudioContext||globalThis.webkitAudioContext,fetchAudio=globalThis.fetch,startUrl='/assets/sounds/record-start.wav',endUrl='/assets/sounds/record-end.wav',onError=()=>{},volume=.45,enabled=true}={}){
 let last='idle',disposed=false,active=enabled,level=Math.min(1,Math.max(0,volume));
 if(ContextClass&&fetchAudio){
  try{
   const context=new ContextClass(),gain=context.createGain();gain.gain.value=level;gain.connect(context.destination);let source,sequence=0;
   const ready=Promise.all([startUrl,endUrl].map(async url=>{const response=await fetchAudio(url);if(!response.ok)throw Error('提示音加载失败');return context.decodeAudioData(await response.arrayBuffer());}));
   ready.catch(onError);
   async function play(name){const ticket=++sequence;if(disposed||!active)return;try{const [buffers]=await Promise.all([ready,context.resume()]);if(disposed||!active||ticket!==sequence)return;source?.stop();source=context.createBufferSource();source.buffer=buffers[name==='start'?0:1];gain.gain.setValueAtTime(level,context.currentTime);source.connect(gain);source.start();}catch(error){onError(error);}}
   return {PlayStartSound:()=>play('start'),PlayEndSound:()=>play('end'),setOptions(options={}){if(typeof options.enabled==='boolean')active=options.enabled;if(Number.isFinite(options.volume))level=Math.min(1,Math.max(0,options.volume));},update(capture){if(capture===last)return;if(capture==='recording')void play('start');if(last==='recording'&&capture==='stopping')void play('end');last=capture;},dispose(){disposed=true;sequence++;try{source?.stop();}catch{}void context.close().catch(onError);}};
  }catch(error){onError(error);}
 }
 const sounds=AudioClass?{start:new AudioClass(startUrl),end:new AudioClass(endUrl)}:{};
 for(const sound of Object.values(sounds)){sound.preload='auto';sound.volume=level;sound.load?.();}
 function play(name){if(disposed||!active||!sounds[name])return;const sound=sounds[name];try{sound.pause();sound.currentTime=0;sound.volume=level;Promise.resolve(sound.play()).catch(onError);}catch(error){onError(error);}}
 return {PlayStartSound:()=>play('start'),PlayEndSound:()=>play('end'),setOptions(options={}){if(typeof options.enabled==='boolean')active=options.enabled;if(Number.isFinite(options.volume)){level=Math.min(1,Math.max(0,options.volume));for(const sound of Object.values(sounds))sound.volume=level;}},update(capture){if(capture===last)return;if(capture==='recording')play('start');if(last==='recording'&&capture==='stopping')play('end');last=capture;},dispose(){disposed=true;for(const sound of Object.values(sounds))sound.pause();}};
}
// Main workbench owns sounds; HUD is a renderer, so events never play twice.
export function bindCaptureSounds(target,sounds){const listener=event=>sounds.update(event.detail?.state);target.addEventListener('capture-state',listener);return ()=>{target.removeEventListener('capture-state',listener);sounds.dispose();};}
export function createFluidHud({root,onStart=()=>{},onFinish=()=>{},onCancel=()=>{},onOpenWorkbench=()=>{},onLanguage=()=>{},onHide=()=>{}}){
 root.classList.add('fluid-hud');
 root.innerHTML=`<section class="fluid-panel" hidden><strong>快捷键指南</strong><pre></pre></section><section class="fluid-language" hidden><label>译为 <select><option value="en">English</option><option value="zh">简体中文</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="ko">한국어</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="es">Español</option><option value="pt">Português</option><option value="ru">Русский</option><option value="ar">العربية</option><option value="hi">हिन्दी</option><option value="th">ไทย</option><option value="vi">Tiếng Việt</option></select></label></section><div class="fluid-capsule" data-state="A"><div class="fluid-backdrop"></div><button class="fluid-left" aria-label="取消或隐藏">×</button><div class="fluid-center"><div class="fluid-bars fluid-bars-left">${'<i></i>'.repeat(5)}</div><div class="fluid-orb"><div class="fluid-ripple"></div><div class="fluid-layer"></div><div class="fluid-sheen"></div><span class="fluid-check">✓</span></div><span class="fluid-label"></span><div class="fluid-bars fluid-bars-right">${'<i></i>'.repeat(5)}</div></div><button class="fluid-right" aria-label="开始或完成录音">●</button></div><div class="fluid-meta" role="status"></div>`;
 const get=selector=>root.querySelector(selector),capsule=get('.fluid-capsule'),label=get('.fluid-label'),meta=get('.fluid-meta'),orb=get('.fluid-orb');let current={};
 get('.fluid-left').onclick=()=>current.capture==='recording'||current.processing?onCancel():onHide();
 get('.fluid-right').onclick=()=>current.capture==='recording'?onFinish():onStart();
 get('.fluid-language select').onchange=event=>onLanguage(event.target.value);
 capsule.ondblclick=event=>{if(!event.target.closest('button,select'))onOpenWorkbench();};
 return {update(value){current=value;const state=fluidState(value),[width,height]=FLUID_STATES[state];capsule.dataset.state=state;capsule.style.setProperty('--fluid-width',`${width}px`);capsule.style.setProperty('--fluid-height',`${height}px`);root.dataset.suspended=String(!!value.suspended);
 label.textContent=state==='D'?'Thinking':state==='G'?'完成':({dictation:'听写',prompt:'提示词预设',translate:'翻译',chat:'问答'})[value.mode]||'听写';
 meta.textContent=value.error||(value.capture==='recording'?`${value.time||'00:00'} · ${value.limitStatus||'上限 02:00 · 到时自动停止'}`:value.status)||'';meta.dataset.warning=String(!!value.limitWarning);get('.fluid-right').disabled=!!value.disabled;get('.fluid-right').textContent=value.capture==='recording'?'■':'●';
 get('.fluid-panel').hidden=state!=='F';get('.fluid-panel pre').textContent=value.keymapText||'请在个人定制中配置快捷键';get('.fluid-language').hidden=state!=='E';get('.fluid-language select').value=value.language||'en';
 const levels=value.levels||[];root.querySelectorAll('.fluid-bars i').forEach((bar,index)=>{const level=Number.isFinite(levels[index])?Math.max(0,Math.min(1,levels[index])):0;bar.style.transform=`scaleY(${.12+.88*level})`;});const energy=Number.isFinite(value.energy)?Math.max(0,Math.min(1,value.energy)):0;orb.style.setProperty('--voice-scale',String(1+energy*.2));return {state,width,height,duration:FLUID_MOTION.duration};
 },dispose(){root.replaceChildren();}};
}
// Optional key adapter: default existing configured shortcuts remain authoritative.
export function bindAltPushToTalk(target,{onPress,onRelease,enabled=false}){
 let held=false;const down=event=>{if(!enabled||event.code!=='AltRight'||event.repeat||held)return;event.preventDefault();held=true;onPress();};const up=event=>{if(event.code!=='AltRight'||!held)return;held=false;onRelease();};const blur=()=>{if(held){held=false;onRelease();}};
 target.addEventListener('keydown',down);target.addEventListener('keyup',up);target.addEventListener('blur',blur);
 return ()=>{target.removeEventListener('keydown',down);target.removeEventListener('keyup',up);target.removeEventListener('blur',blur);blur();};
}
