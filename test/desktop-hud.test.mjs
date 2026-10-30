import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../public/shell.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
function harness({invokeError,fluid=false,geometry=false}={}){
 const calls=[],posted=[],elements=new Map(),classes=[],fluidUpdates=[];
 let fluidCallbacks;const fluidPre={},fluidCopy={},fluidControls={dataset:{},querySelector:selector=>selector==='pre'?fluidPre:fluidCopy};
 const detail={},logo={},mic={},bodyEvents=new Map(),capsule={hidden:false,classList:{contains:name=>name==='fluid-capsule'},getBoundingClientRect:()=>({left:204,top:26,right:272,bottom:58,width:68,height:32})},meta={hidden:false,classList:{contains:()=>false},getBoundingClientRect:()=>({left:145,top:72,right:331,bottom:88,width:186,height:16})};const bar={append(){},classList:{add(){}},style:{},removeAttribute(){},querySelector:s=>s==='small'?detail:s==='.logo img'?mic:geometry&&s==='.fluid-capsule'?capsule:geometry&&s==='.fluid-meta'?meta:logo,dataset:{}};
 if(geometry){fluidControls.hidden=false;fluidControls.classList={contains:()=>false};fluidControls.getBoundingClientRect=()=>({left:70,top:94,right:410,bottom:128,width:340,height:34});}
 for(const id of ['floatingBar','floatStatus','floatRecord','closeFloat','hudMode','hudTime','hudLimit','hudWave','hudSource','hudCancel','hudReady','hudOutput','hudExpand','hudCopy'])elements.set(id,id==='floatingBar'?bar:{dataset:{},querySelectorAll:()=>[]});
 let channel,timer,unload,now=100,nextTimeout=0;const keyListeners=new Map(),unloadListeners=[],timeouts=new Map();
 class Channel{constructor(){channel=this;}postMessage(value){posted.push(value);}close(){calls.push('closed');}}
 const context={location:{search:'?hud=1'},URLSearchParams,BroadcastChannel:Channel,Date:{now:()=>now},document:{createElement:()=>fluidControls,getElementById:id=>elements.get(id),querySelector:()=>({}),body:{addEventListener:(name,fn)=>bodyEvents.set(name,fn),removeEventListener:name=>bodyEvents.delete(name),style:{},classList:{add(){},toggle:(...args)=>classes.push(args)}}},createFluidHud:options=>{fluidCallbacks=options;return {update:value=>{fluidUpdates.push(value);const state=value.capture==='recording'?'C':value.processing?'D':value.ready?'G':value.awake?'B':'A',[width,height]={A:[68,32],B:[156,42],C:[236,48],D:[148,40],G:[160,42]}[state];return {state,width,height,duration:320};},dispose(){}};},window:{__TALKCRAFT_FLUID__:fluid,__TAURI__:{core:{invoke:(...args)=>{calls.push(args);return invokeError?Promise.reject(invokeError):Promise.resolve();}}},addEventListener:(name,fn)=>{if(name==='beforeunload')unloadListeners.push(fn);else keyListeners.set(name,fn);},removeEventListener:(name,fn)=>{if(keyListeners.get(name)===fn)keyListeners.delete(name);}},setInterval:fn=>{timer=fn;return 1;},clearInterval:()=>calls.push('timer cleared'),setTimeout:(fn,ms)=>{timeouts.set(++nextTimeout,{fn,ms});return nextTimeout;},clearTimeout:id=>timeouts.delete(id)};
 vm.runInNewContext(source,context);
 return {fluidControls,fluidUpdates,get fluidCallbacks(){return fluidCallbacks;},fluidPre,fluidCopy,calls,posted,elements,detail,logo,bodyEvents,keyListeners,get channel(){return channel;},classes,timeouts,tick:()=>timer(),setTime:value=>now=value,unload:()=>unloadListeners.forEach(fn=>fn())};
}
test('独立HUD不初始化录音，状态同步后转发操作且支持隐藏拖动',()=>{
 const h=harness();assert.equal(h.elements.get('floatRecord').disabled,true);
 h.channel.onmessage({data:{type:'state',status:'录音中',time:'00:06',level:'-18 dBFS',recordLabel:'停止录音',disabled:false,dark:true,capture:'recording'}});
 assert.equal(h.elements.get('floatStatus').textContent,'录音中');assert.equal(h.detail.textContent,'-18 dBFS');assert.equal(h.elements.get('floatRecord').disabled,false);
 h.elements.get('floatRecord').onclick();assert.equal(h.posted.at(-1).type,'record');
 h.elements.get('closeFloat').onclick();h.bodyEvents.get('pointerdown')({button:0});assert.ok(h.calls.some(call=>call[1]?.action==='hide'));assert.ok(h.calls.some(call=>call[1]?.action==='drag'));
 h.unload();assert.ok(h.calls.includes('closed'));assert.ok(h.calls.includes('timer cleared'));
});
test('工作台未响应或断开时HUD禁用录音，恢复同步后可操作',()=>{
 const h=harness();h.setTime(5000);h.tick();assert.equal(h.elements.get('floatStatus').textContent,'工作台已断开');assert.equal(h.elements.get('floatRecord').disabled,true);
 h.channel.onmessage({data:{type:'state',status:'就绪',time:'00:00',level:'音量未知',recordLabel:'开始录音',disabled:false,dark:false,capture:'idle'}});assert.equal(h.elements.get('floatRecord').disabled,false);
});

test('Figma就绪展开仅使用真实结果，处理态取消且不重复调整尺寸',()=>{
 const h=harness();const send=data=>h.channel.onmessage({data:{type:'state',capture:'idle',disabled:false,...data}});
 send({ready:true,output:'今天评审改到下午三点。'});
 assert.equal(h.elements.get('hudReady').hidden,false);assert.equal(h.elements.get('hudOutput').textContent,'今天评审改到下午三点。');assert.equal(h.calls.filter(call=>call[1]?.action==='expand').length,1);
 send({ready:true,output:'更新结果'});assert.equal(h.calls.filter(call=>call[1]?.action==='expand').length,1);
 h.elements.get('hudCopy').onclick();assert.equal(h.posted.at(-1).type,'copy');
 send({processing:true});assert.equal(h.elements.get('hudReady').hidden,true);assert.equal(h.elements.get('hudCancel').textContent,'终止并保留原文');h.elements.get('hudCancel').onclick();assert.equal(h.posted.at(-1).type,'cancel');
});
test('旧桌面接口和原生操作失败明确显示，不再静默忽略',async()=>{
 for(const [error,message] of [['不允许的悬浮窗操作',/桌面版本过旧/],['无法调整窗口',/悬浮窗操作失败：无法调整窗口/]]){
  const h=harness({invokeError:error});h.elements.get('hudExpand').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.elements.get('floatStatus').textContent,message);h.unload();
 }
});
test('悬浮窗Enter遵循按钮状态，Esc取消或隐藏且卸载移除监听',()=>{
 const h=harness();const key=(code,extra={})=>h.keyListeners.get('keydown')({code,preventDefault(){},...extra});
 const initial=h.posted.length;key('Enter');assert.equal(h.posted.length,initial);
 h.channel.onmessage({data:{type:'state',status:'录音中',time:'00:05',capture:'recording',disabled:false}});
 key('Enter');assert.equal(h.posted.at(-1).type,'record');const sent=h.posted.length;
 key('Enter',{repeat:true});key('Enter',{ctrlKey:true});assert.equal(h.posted.length,sent);
 key('Escape');assert.equal(h.posted.at(-1).type,'cancel');
 h.channel.onmessage({data:{type:'state',status:'处理中',capture:'ready',processing:true,disabled:true}});key('Escape');assert.equal(h.posted.at(-1).type,'cancel');
 h.channel.onmessage({data:{type:'state',status:'就绪',capture:'idle',disabled:false}});key('Escape');assert.ok(h.calls.some(call=>call[1]?.action==='hide'));
 h.unload();assert.equal(h.keyListeners.has('keydown'),false);
});

test('录音和处理时模式持续可见，收到切换后即时显示新模式',()=>{const h=harness();h.channel.onmessage({data:{type:'state',capture:'recording',mode:'翻译',disabled:false}});assert.equal(h.elements.get('hudMode').textContent,'翻译');assert.equal(h.elements.get('hudMode').hidden,false);h.channel.onmessage({data:{type:'state',processing:true,mode:'提示词',disabled:true}});assert.equal(h.elements.get('hudMode').textContent,'提示词');assert.equal(h.elements.get('hudMode').hidden,false);h.unload();});

test('悬浮条边缘空白与文字可拖动，按钮和结果文本保留操作',()=>{
 const h=harness();const drag=h.bodyEvents.get('pointerdown');const count=()=>h.calls.filter(call=>call[1]?.action==='drag').length;
 drag({button:0,target:{closest:()=>null}});assert.equal(count(),1);
 drag({button:0,target:{closest:()=>({classList:{contains:()=>true}})}});assert.equal(count(),2);
 drag({button:0,target:{closest:()=>({classList:{contains:()=>false}})}});assert.equal(count(),2);
 drag({button:2,target:{closest:()=>null}});assert.equal(count(),2);h.unload();assert.equal(h.bodyEvents.has('pointerdown'),false);
});

test('悬浮条显示结果后仍可继续录音，保留结果与复制',()=>{const h=harness();h.channel.onmessage({data:{type:'state',capture:'ready',ready:true,output:'本轮结果',recordLabel:'开始录音',disabled:false}});assert.equal(h.elements.get('floatRecord').hidden,false);assert.equal(h.elements.get('floatRecord').textContent,'继续录音');assert.equal(h.elements.get('hudOutput').textContent,'本轮结果');h.elements.get('floatRecord').onclick();assert.equal(h.posted.at(-1).type,'record');h.unload();});


test('新版原生窗口启用流体渲染，真实模式音量和结果同步并转发操作',()=>{const h=harness({fluid:true});h.channel.onmessage({data:{type:'state',capture:'recording',mode:'翻译',level:'-30 dBFS',wave:['22px','3px'],disabled:false,ready:false}});const state=h.fluidUpdates.at(-1);assert.equal(state.mode,'translate');assert.equal(state.capture,'recording');assert.equal(state.levels[0],1);assert.equal(state.levels[1],0);h.fluidCallbacks.onFinish();assert.equal(h.posted.at(-1).type,'record');h.fluidCallbacks.onCancel();assert.equal(h.posted.at(-1).type,'cancel');h.fluidCallbacks.onLanguage('zh');assert.equal(h.posted.at(-1).language,'zh');h.channel.onmessage({data:{type:'state',capture:'ready',mode:'听写',ready:true,output:'实际结果',disabled:false}});assert.equal(h.fluidPre.textContent,'实际结果');assert.equal(h.fluidCopy.disabled,false);h.unload();});

test('流体HUD只把实际可见胶囊与状态区域交给原生窗口命中',()=>{
 const h=harness({fluid:true,geometry:true});const call=h.calls.find(entry=>entry[0]==='hud_hit_regions');assert.ok(call);assert.deepEqual(Array.from(call[1].regions[0]),[204,26,272,58,16]);assert.deepEqual(Array.from(call[1].regions[1]),[145,72,331,88,8]);assert.equal(call[1].regions.length,2);h.unload();
});

test('鼠标进入时原生命中区域立即扩到目标尺寸，不等待下一次状态同步',()=>{
 const h=harness({fluid:true,geometry:true}),regions=()=>h.calls.filter(entry=>entry[0]==='hud_hit_regions').at(-1)[1].regions;
 h.elements.get('floatingBar').onpointerenter();assert.deepEqual(Array.from(regions()[0]),[160,21,316,63,21]);assert.equal(regions().length,3);assert.equal([...h.timeouts.values()].some(timer=>timer.ms===360),true);h.unload();
});

test('完整结果复制不依赖工作台焦点，重复快照不重写选中文本（DOM/IPC替身）',async()=>{
 const h=harness({fluid:true});let writes=0,text='';Object.defineProperty(h.fluidPre,'textContent',{configurable:true,get:()=>text,set:v=>{writes++;text=v;}});
 const output='完整中文🙂\n'.repeat(2000);const payload={type:'state',capture:'ready',ready:true,output,disabled:false};h.channel.onmessage({data:payload});const before=writes;h.channel.onmessage({data:payload});assert.equal(writes,before);
 await h.fluidControls.onclick({target:{closest:()=>({dataset:{fluidAction:'copy'}})}});const call=h.calls.find(c=>c[0]==='clipboard_write');assert.equal(call[1].text,output);assert.match(h.fluidCopy.textContent,/已复制/);assert.equal(h.posted.some(p=>p.type==='copy'),false);
 h.fluidPre.onpointerenter();assert.ok(h.calls.some(c=>c[0]==='hud_interactive'&&c[1].interactive));const dragCalls=h.calls.filter(c=>c[1]?.action==='drag').length;h.bodyEvents.get('pointerdown')({button:0,target:{closest:()=>({tagName:'PRE'})}});assert.equal(h.calls.filter(c=>c[1]?.action==='drag').length,dragCalls);h.unload();
});

test('结果拖选出界后松手释放焦点，失焦及开始录音不保留交互模式',()=>{
 const h=harness({fluid:true});const last=()=>h.calls.filter(c=>c[0]==='hud_interactive').at(-1)?.[1].interactive;
 h.fluidPre.onpointerenter();h.fluidPre.onpointerdown();h.fluidPre.onpointerleave();assert.equal(last(),true);
 h.keyListeners.get('pointerup')();assert.equal(last(),false);
 h.fluidPre.onpointerenter();h.keyListeners.get('blur')();assert.equal(last(),false);
 h.fluidPre.onpointerenter();h.fluidCallbacks.onStart();assert.equal(last(),false);
 h.unload();assert.equal(h.keyListeners.has('pointerup'),false);assert.equal(h.keyListeners.has('blur'),false);
});
