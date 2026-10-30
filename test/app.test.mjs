import {importPcmWav,pcmToWav} from '../public/audio.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRecordingSession,createMicrophonePicker} from '../public/recording.mjs';
import {createConversation} from '../public/conversation.mjs';

const appCode = (await readFile(new URL('../public/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
test('悬浮条四模式自动提交最终结果到当前光标，工作台处理不触发注入（原生替身）',async()=>{
 for(const mode of ['dictation','prompt','translate','chat']){
  const sent=[];const h=await harness({agreement:true,remembered:true,asrEnabled:true,nativeInvoke:async(command,args)=>{sent.push({command,args});return {status:'submitted'};}});
  h.element(mode).events.click();const hud=h.listeners.get('hud-record');await hud();h.captures[0].data();await hud();h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.length,1);assert.equal(sent[0].command,'output_send_current');assert.equal(sent[0].args.text,mode==='dictation'?'【模拟转写：未识别音频】测试':'测试替身结果');assert.match(h.element('status').textContent,/Windows已接受/);
  await h.element('process').events.click();assert.equal(sent.length,1);
 }
});
test('光标注入失败只提交一次，保留结果与复制入口（原生替身）',async()=>{
 let attempts=0;const h=await harness({agreement:true,remembered:true,asrEnabled:true,nativeInvoke:async()=>{attempts++;throw new Error('目标焦点已变化');}});
 const hud=h.listeners.get('hud-record');await hud();h.captures[0].data();await hud();h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(attempts,1);assert.equal(h.element('result').textContent,'【模拟转写：未识别音频】测试');assert.equal(h.element('copy').disabled,false);assert.match(h.element('status').textContent,/光标输出失败.*不会自动重试/);
});
async function harness({historyBridge,nativeInvoke,agreement=false,remembered=false,permissionGate,shortcutEditing=false,windowFocused=true,microphoneDevices,simulated=true, local=false, failStatus=false, readStatus, asrEnabled=false, asrSimulated=true, webSearchAvailable=false, weatherAvailable=false, agentEngine='legacy', search, complete, transcribe=async () => ({ok:true,async json(){return {text:'【模拟转写：未识别音频】测试',simulated:true};}}), decode=async () => ({pcm:new ArrayBuffer(32000),wav:new ArrayBuffer(32044),sampleRate:16000,channels:1,bitDepth:16,duration:1})} = {}) {
  const elements = new Map(), listeners = new Map(), captures = [], calls = [], revoked = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id,{value:'',checked:false,hidden:false,disabled:false,textContent:'',dataset:{},events:{},children:[],click(){return this.events.click?.();},addEventListener(name,fn){this.events[name]=fn;},setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},pause(){this.paused=true;},load(){}});
    return elements.get(id);
  }
  const stored=new Map(remembered?[['talkcraft-agreement-v1','accepted']]:[]);if(agreement){const dialog=element('usageAgreement');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};}
  const buttons=['dictation','prompt','translate','chat'].map(mode => {const b=element(mode);b.dataset.mode=mode;return b;});
  class Recorder {
    constructor(stream){this.stream=stream;this.state='inactive';this.mimeType='audio/webm';captures.push(this);}
    start(){this.state='recording';} stop(){this.state='inactive';}
    data(){this.ondataavailable({data:new Blob(['audio'])});} finish(){this.onstop();}
  }
  let stream,captureConstraints;
  element('microphoneSource').replaceChildren=function(...options){this.options=options;};
  const appWindow={__talkcraftHistory:historyBridge,__TAURI__:nativeInvoke?{core:{invoke:nativeInvoke}}:undefined,MediaRecorder:Recorder,addEventListener:(name,fn)=>listeners.set(name,fn)};
  vm.runInNewContext('"use strict";\n'+appCode,{localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
    document:{hasFocus:()=>windowFocused,activeElement:shortcutEditing?{closest:()=>true}:undefined,getElementById:element,querySelectorAll:() => buttons,createElement:tag=>{const dataset={};return {tag,get dataset(){return dataset;},children:[],append(...children){this.children.push(...children);}};}},
    navigator:{mediaDevices:{...(microphoneDevices?{enumerateDevices:async()=>microphoneDevices}:{}),async getUserMedia(constraints){if(permissionGate)await permissionGate;captureConstraints=constraints;stream={stops:0,getTracks(){return [{stop:() => stream.stops++}];}};return stream;}},clipboard:{async writeText(text){calls.push({copied:text});}}},
    window:appWindow,
    createRecordingSession,createConversation,createMicrophonePicker,importPcmWav,decodeRecording:decode,AbortController,AbortSignal,Blob,TextDecoder,
    URL:{createObjectURL:() => 'blob:test',revokeObjectURL:url => revoked.push(url)},
    async fetch(url,options){
      calls.push({url,options});
      if (url === '/api/status' && readStatus) return readStatus();
      if (url === '/api/status') return {ok:!failStatus,async json(){return {simulated,local,audioTranscription:asrEnabled,asrSimulated,webSearchAvailable,weatherAvailable,agentEngine};}};
      if (url.startsWith('/api/history/audio'))return {ok:true,async blob(){return new Blob(['test-only-audio']);}};
      if (url === '/api/transcribe') return transcribe(options);
      if (url === '/api/search'&&search)return search(options);
      if (complete) return complete(options);
      return {ok:true,async json(){return {text:'测试替身结果',simulated};}};
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return {retry:(...args)=>appWindow.__talkcraftRetry(...args),element,captures,calls,revoked,listeners,get stream(){return stream;},get captureConstraints(){return captureConstraints;}};
}

test('工作台选择麦克风实际传入录音，录音期间锁定且不清空文字',async()=>{
  const h=await harness({microphoneDevices:[{kind:'audioinput',deviceId:'usb',label:'USB麦克风'}]});
  h.element('transcript').value='保留这段文字';h.element('microphoneSource').value='usb';h.element('microphoneSource').events.change();
  await h.element('record').events.click();assert.deepEqual(h.captureConstraints,{audio:{deviceId:{exact:'usb'}}});assert.equal(h.element('microphoneSource').disabled,true);
  assert.equal(h.element('transcript').value,'保留这段文字');h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();
});

test('HUD重复放弃不重新保存取消的录音，保留旧音频和文字且可再次录音',async()=>{
 const h=await harness();
 await h.element('record').events.click();h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();
 const oldPlayback=h.element('playback').src;h.element('transcript').value='保留原文';
 await h.element('record').events.click();h.captures[1].data();
 h.listeners.get('hud-discard')();h.listeners.get('hud-discard')();h.captures[1].finish();
 assert.match(h.element('status').textContent,/已放弃本次录音/);
 assert.equal(h.element('playback').src,oldPlayback);assert.equal(h.revoked.length,0);assert.equal(h.element('transcript').value,'保留原文');
 await h.element('record').events.click();h.captures[2].data();await h.element('record').events.click();h.captures[2].finish();
 assert.doesNotMatch(h.element('status').textContent,/已放弃本次录音/);assert.equal(h.revoked.length,1);
 h.listeners.get('beforeunload')();
});
test('云端未授权时就近提示并聚焦授权，确认后才提交且同步结果状态',async()=>{
  const h=await harness({simulated:false});let focused=false,scrolled=false;
  h.element('cloudConsent').focus=()=>{focused=true;};h.element('consentLabel').scrollIntoView=()=>{scrolled=true;};
  h.element('prompt').events.click();h.element('transcript').value='今天评审改为下午三点';await h.element('process').events.click();
  assert.equal(h.calls.filter(c=>c.url==='/api/process').length,0);assert.equal(focused,true);assert.equal(scrolled,true);assert.equal(h.element('cloudConsent').checked,false);
  assert.match(h.element('processStatus').textContent,/尚未开始处理/);assert.equal(h.element('processStatus').textContent,h.element('status').textContent);
  h.element('cloudConsent').checked=true;await h.element('process').events.click();assert.equal(h.calls.filter(c=>c.url==='/api/process').length,1);assert.match(h.element('processStatus').textContent,/处理完成/);
});
test('问答联网搜索分阶段请求并只在真实证据后展示来源，失败不静默回答',async()=>{
 const h=await harness({agreement:true,remembered:true,simulated:false,webSearchAvailable:true,
  search:async()=>({ok:true,json:async()=>({searchId:'evidence-1',performed:true,status:'searched',elapsedMs:1200,attempts:1,quality:{intent:'weather',sufficient:true,reason:'已取得具体天气'},usage:{webSearchRequests:1},sources:[{title:'官方结果',url:'https://example.com/source'}]})}),
  complete:async()=>({ok:true,json:async()=>({text:'带引用回答',simulated:false,search:{allowed:true,performed:true,status:'searched',elapsedMs:1200,attempts:1,quality:{intent:'weather',sufficient:true,reason:'已取得具体天气'},usage:{webSearchRequests:1},sources:[{title:'官方结果',url:'https://example.com/source'}]}})})});
 h.element('chat').events.click();h.element('webSearchToggle').checked=true;h.element('transcript').value='今天有什么更新';await h.element('process').events.click();
 assert.deepEqual(h.calls.filter(c=>c.url==='/api/search'||c.url==='/api/process').map(c=>c.url),['/api/search','/api/process']);
 const processBody=JSON.parse(h.calls.find(c=>c.url==='/api/process').options.body);assert.equal(processBody.searchId,'evidence-1');assert.equal(processBody.webSearch,true);
 assert.match(h.element('webSearchEvidence').textContent,/已取得联网搜索执行证据.*1 条来源.*1 轮检索.*证据检查通过.*1\.2 秒.*1 次工具请求/);assert.equal(h.element('webSearchSources').children.length,1);

 const failed=await harness({agreement:true,remembered:true,simulated:false,webSearchAvailable:true,search:async()=>({ok:false,json:async()=>({error:'搜索暂时不可用'})})});
 failed.element('chat').events.click();failed.element('webSearchToggle').checked=true;failed.element('transcript').value='实时问题';await failed.element('process').events.click();
 assert.equal(failed.calls.some(c=>c.url==='/api/process'),false);assert.match(failed.element('status').textContent,/未把模型知识标记为实时结果/);
});
test('天气工具可用时问答默认联网，用户关闭后不让普通模型猜测实时天气',async()=>{
 const h=await harness({agreement:true,remembered:true,simulated:false,weatherAvailable:true,
  search:async()=>({ok:true,json:async()=>({searchId:'weather-1',performed:true,status:'weather-data',tool:'weather',elapsedMs:80,attempts:1,quality:{intent:'weather',sufficient:true,reason:'结构化数据完整'},weather:{location:'南京，江苏，中国',observedAt:'2026-09-19T13:15'},sources:[{title:'天气接口',url:'https://example.com/weather'}]})}),
  complete:async()=>({ok:true,json:async()=>({text:'南京当前28℃',simulated:false,search:{allowed:true,performed:true,status:'weather-data',tool:'weather',sources:[{title:'天气接口',url:'https://example.com/weather'}]}})})});
 h.element('chat').events.click();assert.equal(h.element('webSearchToggle').checked,true);h.element('transcript').value='南京天气怎么样';await h.element('process').events.click();assert.deepEqual(h.calls.filter(c=>c.url==='/api/search'||c.url==='/api/process').map(c=>c.url),['/api/search','/api/process']);
 h.element('webSearchToggle').checked=false;h.element('webSearchToggle').events.change();h.element('transcript').value='南京明天天气怎么样';const before=h.calls.length;await h.element('process').events.click();assert.equal(h.calls.length,before);assert.match(h.element('status').textContent,/联网天气查询已关闭/);
});
test('LangGraph开关下天气问答只提交一次Agent请求',async()=>{
 const h=await harness({agreement:true,remembered:true,simulated:false,weatherAvailable:true,agentEngine:'langgraph',complete:async()=>({ok:true,headers:{get:()=> 'application/json'},async json(){return {text:'南京当前25℃，晴。[1]',simulated:false,historyContext:{provider:'deepseek',model:'deepseek-flash'},search:{engine:'langgraph',frameworks:{langchain:true,langgraph:true},taskId:'graph-task',query:'南京天气怎么样',performed:true,status:'weather-data',tool:'weather',sources:[{sourceId:'weather-1',title:'Open-Meteo',url:'https://api.open-meteo.com/v1/forecast'}],usedSourceIds:['weather-1'],progress:[],graph:{steps:['understand','execute_weather','check_evidence','generate_answer'],toolCalls:1}}};}})});
 h.element('chat').events.click();h.element('transcript').value='南京天气怎么样';await h.element('process').events.click();assert.deepEqual(h.calls.filter(c=>['/api/agent','/api/search','/api/process'].includes(c.url)).map(c=>c.url),['/api/agent']);assert.equal(h.element('copy').disabled,false);assert.ok(h.element('result').children.some(child=>child.tag==='a'&&child.textContent==='[1]'));assert.match(h.element('executionSummary').textContent,/LangGraph/);
});
test('执行过程面板保留用户展开状态并区分摘要、正文和最终引用',async()=>{
 const source1={sourceId:'source-111111111111',title:'官方公告',domain:'example.com',url:'https://example.com/official',evidenceState:'read',snippet:'官方公告相关片段',publishedAt:'2026-09-16',fetchedAt:'2026-09-19T10:00:00Z'},source2={sourceId:'source-222222222222',title:'搜索命中',domain:'news.example',url:'https://news.example/item',evidenceState:'hit'};
 const progress=[{eventId:'task:1',taskId:'task',callId:'call-1',sequence:1,stage:'searching',tool:'search_web',status:'running',input:{query:'理想i9参数'}},{eventId:'task:2',taskId:'task',callId:'call-1',sequence:2,stage:'searching',tool:'search_web',status:'completed',resultCount:2,elapsedMs:20}];
 const searchData={searchId:'evidence',taskId:'task',query:'理想i9参数',performed:true,status:'searched',elapsedMs:20,toolCalls:1,toolTrace:[{callId:'call-1',tool:'search_web',status:'completed'}],progress,sources:[source1,source2]};
 const h=await harness({agreement:true,remembered:true,simulated:false,webSearchAvailable:true,search:async()=>({ok:true,json:async()=>searchData}),complete:async()=>({ok:true,json:async()=>({text:'官方已确认发布。[1]',simulated:false,search:{...searchData,usedSourceIds:[source1.sourceId],progress:[...progress,{eventId:'task:3',taskId:'task',sequence:3,stage:'answering',status:'completed'}]}})})});
 h.element('executionPanel').open=true;h.element('chat').events.click();h.element('webSearchToggle').checked=true;h.element('transcript').value='理想i9参数';await h.element('process').events.click();
 assert.equal(h.element('executionPanel').open,true);assert.match(h.element('executionSummary').textContent,/完成.*1 个工具步骤/);assert.equal(h.element('executionEvents').children.length,3);assert.equal(h.element('webSearchSources').children.length,2);assert.match(h.element('webSearchSources').children[0].children[1].textContent,/已读取正文/);assert.match(h.element('webSearchSources').children[1].children[1].textContent,/仅搜索命中/);assert.ok(h.element('result').children.some(child=>child.tag==='a'&&child.textContent==='[1]'));
});
test('服务检查在途禁用提交并合并重复检查，保留音频文字',async()=>{
  let finish,counter=0;
  const response=()=>({ok:true,async json(){return {simulated:true,audioTranscription:true,asrSimulated:true};}});
  const h=await harness({readStatus:()=>++counter===1?Promise.resolve(response()):new Promise(resolve=>{finish=resolve;})});
  await prepare(h);h.element('transcript').value='保留原文';
  const pending=h.element('refreshAsrService').events.click();assert.equal(h.element('process').disabled,true);assert.equal(h.element('transcribeAudio').disabled,true);
  await h.element('refreshAsrService').events.click();await h.element('process').events.click();await h.element('transcribeAudio').events.click();
  assert.equal(counter,2);assert.equal(h.calls.some(c=>c.url==='/api/process'||c.url==='/api/transcribe'),false);
  finish(response());await pending;assert.equal(h.element('process').disabled,false);assert.equal(h.element('transcribeAudio').disabled,false);assert.equal(h.element('transcript').value,'保留原文');assert.equal(h.revoked.length,0);
});
test('转写等待耗时显示并明确区分模拟和真实响应',async()=>{
  for(const simulated of [true,false]){
    const h=await harness({asrEnabled:true,asrSimulated:simulated,transcribe:async()=>({ok:true,json:async()=>({text:'测试文本',simulated})})});
    await prepare(h);h.element('audioConsent').checked=true;await h.element('transcribeAudio').events.click();
    assert.match(h.element('status').textContent,simulated?/模拟请求耗时 \d+\.\d 秒/:/转写等待 \d+\.\d 秒（含上传与识别，不含录音）/);
  }
});
test('界面模拟状态、模式选择、处理与复制结果（模拟DOM）',async () => {
  const h=await harness();assert.equal(h.element('process').disabled,false);assert.equal(h.element('consentLabel').hidden,true);
  h.element('translate').events.click();assert.equal(h.element('languageLabel').hidden,false);assert.equal(h.element('translate')['aria-pressed'],'true');
  h.element('language').value='en';h.element('transcript').value='你好';await h.element('process').events.click();
  const submitted=JSON.parse(h.calls.find(c => c.url === '/api/process').options.body);assert.equal(submitted.mode,'translate');assert.equal(submitted.targetLanguage,'en');
  assert.equal(h.element('result').textContent,'测试替身结果');assert.equal(h.element('copy').disabled,false);await h.element('copy').events.click();assert.equal(h.calls.at(-1).copied,'测试替身结果');
});
test('恢复上一版后复制内容同步，不继续复制新版',async()=>{
  let count=0;const h=await harness({complete:async()=>({ok:true,async json(){return {text:`结果${++count}`,simulated:true};}})});h.element('prompt').events.click();h.element('transcript').value='内容';await h.element('process').events.click();await h.element('process').events.click();assert.equal(h.element('result').textContent,'结果2');h.element('restoreResult').events.click();await h.element('copy').events.click();assert.equal(h.calls.at(-1).copied,'结果1');
});
test('F8权限等待期间松开，不遗留持续录音',async()=>{
 const h=await harness();const start=h.listeners.get('keydown')({code:'F8',repeat:false,preventDefault(){}});h.listeners.get('keyup')({code:'F8',preventDefault(){}});await start;assert.equal(h.captures[0].state,'inactive');assert.equal(h.element('record').disabled,true);h.captures[0].data();h.captures[0].finish();h.listeners.get('beforeunload')();
});

test('带修饰键的F8不再同时触发页面默认录音',async()=>{
 const h=await harness();
 for(const modifier of ['ctrlKey','altKey','shiftKey','metaKey'])await h.listeners.get('keydown')({code:'F8',[modifier]:true,preventDefault(){throw new Error('不应处理组合键');}});
 assert.equal(h.captures.length,0);h.listeners.get('beforeunload')();
});
test('界面连续问答带历史，切换模式隔离，清空后新会话无历史',async () => {
  const h=await harness();h.element('chat').events.click();h.element('transcript').value='预算1200';await h.element('process').events.click();
  h.element('transcript').value='预算多少？';await h.element('process').events.click();
  const requests=() => h.calls.filter(c => c.url==='/api/process').map(c => JSON.parse(c.options.body));
  assert.equal(requests()[1].history.length,2);assert.equal(requests()[1].history[0].content,'预算1200');
  h.element('prompt').events.click();await h.element('process').events.click();assert.equal(requests()[2].history.length,0);
  h.element('chat').events.click();h.element('clearChat').events.click();assert.equal(h.element('chatHistory').textContent,'');assert.equal(h.element('copy').disabled,true);
  await h.element('process').events.click();assert.equal(requests()[3].history.length,0);
});
test('清空会话取消在途问答，迟到回答不回填会话和结果',async () => {
  let finish,signal;const h=await harness({complete:options => {signal=options.signal;return new Promise(resolve => {finish=resolve;});}});
  h.element('chat').events.click();h.element('transcript').value='问题';const pending=h.element('process').events.click();
  h.element('clearChat').events.click();assert.equal(signal.aborted,true);finish({ok:true,async json(){return {text:'迟到回答',simulated:true};}});await pending;
  assert.equal(h.element('chatHistory').textContent,'');assert.equal(h.element('result').textContent,'会话已清空');assert.equal(h.element('process').disabled,false);
});
test('失败问答不加入历史，重试没有失败的用户消息',async () => {
  const h=await harness({complete:async () => ({ok:false,async json(){return {error:'服务错误'};}})});h.element('chat').events.click();h.element('transcript').value='失败问题';await h.element('process').events.click();await h.element('process').events.click();
  const requests=h.calls.filter(c => c.url==='/api/process').map(c => JSON.parse(c.options.body));assert.equal(requests[1].history.length,0);assert.equal(h.element('chatHistory').textContent,'');
});
async function prepare(h) {
  await h.element('record').events.click();h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();await h.element('prepareAudio').events.click();
}
test('识别默认关闭，准备音频后仍不能提交',async () => {
  const h=await harness();await prepare(h);assert.equal(h.element('transcribeAudio').disabled,true);assert.match(h.element('asrNotice').textContent,/未启用/);
});
test('模拟音频转写发送PCM而非WAV，预览不会自动覆盖文本',async () => {
  const h=await harness({asrEnabled:true});await prepare(h);h.element('transcript').value='手动内容';
  await h.element('transcribeAudio').events.click();const request=h.calls.find(c => c.url==='/api/transcribe');
  assert.equal(request.options.body.byteLength,32000);assert.equal(request.options.headers['X-Audio-Sample-Rate'],'16000');
  assert.equal(h.element('transcript').value,'手动内容');assert.match(h.element('status').textContent,/未识别音频/);
  h.element('applyAsr').events.click();assert.equal(h.element('transcript').value,'手动内容');
  h.element('replaceTranscript').checked=true;h.element('transcript').events.input();h.element('applyAsr').events.click();assert.equal(h.element('transcript').value,'手动内容');
  h.element('replaceTranscript').checked=true;h.element('applyAsr').events.click();assert.match(h.element('transcript').value,/模拟转写/);
  h.element('prompt').events.click();await h.element('process').events.click();assert.match(JSON.parse(h.calls.find(c => c.url==='/api/process').options.body).text,/模拟转写/);
});
test('取消转写按钮传递信号并恢复界面，不交付迟到结果',async () => {
  let signal,finish;const h=await harness({asrEnabled:true,transcribe:options => {signal=options.signal;return new Promise(resolve => {finish=resolve;});}});await prepare(h);
  const pending=h.element('transcribeAudio').events.click();h.element('cancelAsr').events.click();assert.equal(signal.aborted,true);
  finish({ok:true,async json(){return {text:'迟到结果',simulated:true};}});await pending;
  assert.equal(h.element('asrPreviewPanel').hidden,true);assert.equal(h.element('transcribeAudio').disabled,false);assert.equal(h.element('cancelAsr').disabled,true);
});
test('重复转换音频时识别按钮禁用，转换后恢复',async () => {
  let calls=0,finish;const audio={pcm:new ArrayBuffer(32000),wav:new ArrayBuffer(32044),sampleRate:16000,channels:1,bitDepth:16,duration:1};
  const h=await harness({asrEnabled:true,decode:async () => {calls++;if(calls===1)return audio;return new Promise(resolve => {finish=resolve;});}});await prepare(h);
  assert.equal(h.element('transcribeAudio').disabled,false);const pending=h.element('prepareAudio').events.click();assert.equal(h.element('transcribeAudio').disabled,true);
  finish(audio);await pending;assert.equal(h.element('transcribeAudio').disabled,false);
});
test('丢弃时取消识别，迟到结果不能出现或覆盖文本',async () => {
  let finish;const h=await harness({asrEnabled:true,transcribe:() => new Promise(resolve => {finish=resolve;})});await prepare(h);
  h.element('transcript').value='保持';const pending=h.element('transcribeAudio').events.click();assert.equal(h.element('cancelAsr').disabled,false);
  h.element('discard').events.click();finish({ok:true,async json(){return {text:'迟到结果',simulated:true};}});await pending;
  assert.equal(h.element('asrPreviewPanel').hidden,true);assert.equal(h.element('transcript').value,'保持');assert.equal(h.element('transcribeAudio').disabled,true);
});
test('云端识别界面单独检查音频授权（仅测试替身）',async () => {
  const h=await harness({asrEnabled:true,asrSimulated:false});await prepare(h);await h.element('transcribeAudio').events.click();assert.ok(!h.calls.some(c => c.url==='/api/transcribe'));
  h.element('audioConsent').checked=true;await h.element('transcribeAudio').events.click();assert.equal(h.calls.find(c => c.url==='/api/transcribe').options.headers['X-Audio-Cloud-Consent'],'true');
});
test('识别请求失败恢复按钮且不产生预览',async () => {
  const h=await harness({asrEnabled:true,transcribe:async () => ({ok:false,async json(){return {error:'服务未启用'};}})});await prepare(h);await h.element('transcribeAudio').events.click();assert.match(h.element('status').textContent,/服务未启用/);assert.equal(h.element('asrPreviewPanel').hidden,true);assert.equal(h.element('record').disabled,false);
});
test('音频准备后显示格式与下载，丢弃会移除转换结果（模拟解码）',async () => {
  const h=await harness();await h.element('record').events.click();h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();
  assert.equal(h.element('prepareAudio').disabled,false);await h.element('prepareAudio').events.click();
  assert.match(h.element('audioInfo').textContent,/16000 Hz/);assert.equal(h.element('downloadAudio').hidden,false);
  h.element('discard').events.click();assert.equal(h.element('downloadAudio').hidden,true);assert.equal(h.element('prepareAudio').disabled,true);
});
test('丢弃音频取消转换，迟到结果不生成下载（模拟解码）',async () => {
  let finish;
  const h=await harness({decode:() => new Promise(resolve => {finish=resolve;})});
  await h.element('record').events.click();h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();
  const pending=h.element('prepareAudio').events.click();assert.equal(h.element('record').disabled,true);
  h.element('discard').events.click();finish({wav:new ArrayBuffer(46),sampleRate:16000,bitDepth:16,duration:1});await pending;
  assert.equal(h.element('downloadAudio').hidden,true);assert.equal(h.element('prepareAudio').disabled,true);assert.equal(h.element('record').disabled,false);
});
test('云端模式未经勾选不发送文本（模拟DOM）',async () => {
  const h=await harness({simulated:false});assert.equal(h.element('consentLabel').hidden,false);h.element('prompt').events.click();
  h.element('transcript').value='测试';await h.element('process').events.click();assert.equal(h.calls.length,1);assert.match(h.element('status').textContent,/勾选/);
  h.element('cloudConsent').checked=true;await h.element('process').events.click();assert.equal(JSON.parse(h.calls.at(-1).options.body).cloudConsent,true);
});
test('配置读取失败保持处理禁用（模拟DOM）',async () => {
  const h=await harness({failStatus:true});assert.equal(h.element('process').disabled,true);assert.match(h.element('status').textContent,/读取失败/);
});
test('录音停止等待、回放、丢弃与页面退出释放（模拟DOM与录音器）',async () => {
  const h=await harness();await h.element('record').events.click();assert.equal(h.element('record').textContent,'停止录音');assert.equal(h.element('discard').disabled,true);
  h.captures[0].data();await h.element('record').events.click();assert.equal(h.element('record').disabled,true);
  h.captures[0].finish();assert.equal(h.element('record').disabled,false);assert.equal(h.element('playback').src,'blob:test');assert.equal(h.element('discard').disabled,false);
  h.element('discard').events.click();assert.equal(h.element('playback').hidden,true);assert.deepEqual(h.revoked,['blob:test']);
  await h.element('record').events.click();h.listeners.get('beforeunload')();assert.equal(h.stream.stops,1);
});


test('转写预览一键串联当前模式文字处理与复制（全链路模拟DOM）',async()=>{
 const h=await harness({asrEnabled:true});await prepare(h);await h.element('transcribeAudio').events.click();h.element('translate').events.click();h.element('language').value='en';
 await h.element('applyAndProcessAsr').events.click();const body=JSON.parse(h.calls.find(c=>c.url==='/api/process').options.body);assert.match(body.text,/模拟转写/);assert.equal(body.mode,'translate');assert.equal(body.targetLanguage,'en');await h.element('copy').events.click();assert.equal(h.calls.at(-1).copied,'测试替身结果');h.element('discard').events.click();assert.equal(h.element('applyAndProcessAsr').disabled,true);
});
test('串联入口保留原文替换确认；缺云端文字授权不改原文或发请求',async()=>{
 const h=await harness({simulated:false,asrEnabled:true});await prepare(h);await h.element('transcribeAudio').events.click();h.element('prompt').events.click();h.element('transcript').value='用户原文';h.element('replaceTranscript').checked=true;
 await h.element('applyAndProcessAsr').events.click();assert.equal(h.element('transcript').value,'用户原文');assert.ok(!h.calls.some(c=>c.url==='/api/process'));h.element('cloudConsent').checked=true;h.element('replaceTranscript').checked=false;await h.element('applyAndProcessAsr').events.click();assert.equal(h.element('transcript').value,'用户原文');assert.ok(!h.calls.some(c=>c.url==='/api/process'));h.element('replaceTranscript').checked=true;await h.element('applyAndProcessAsr').events.click();assert.ok(h.calls.some(c=>c.url==='/api/process'));
});
test('本机Ollama串联无需云端确认；在途处理不可被新转写覆盖',async()=>{
 let finish;const h=await harness({simulated:false,local:true,asrEnabled:true,complete:()=>new Promise(r=>finish=r)});await prepare(h);await h.element('transcribeAudio').events.click();h.element('prompt').events.click();assert.equal(h.element('consentLabel').hidden,true);
 const pending=h.element('applyAndProcessAsr').events.click();h.element('transcript').value='新编辑文字';h.element('replaceTranscript').checked=true;await h.element('applyAndProcessAsr').events.click();assert.equal(h.element('transcript').value,'新编辑文字');assert.equal(h.calls.filter(c=>c.url==='/api/process').length,1);finish({ok:true,async json(){return {text:'本机替身结果',simulated:false};}});await pending;
});


test('录音后自动显示转写区域，并明确未配置时只能下载',async()=>{
 const h=await harness();await prepare(h);assert.equal(h.element('audioDrawer').open,true);assert.equal(h.element('transcribeAudio').textContent,'转写未启用');assert.match(h.element('status').textContent,/无法转写/);assert.match(h.element('asrNotice').textContent,/文字 AI 配置不能代替/);assert.equal(h.element('downloadAudio').hidden,false);
});


test('导入WAV可提交PCM转写，保留原文且不自动上传（模拟DOM）',async()=>{
 const h=await harness({asrEnabled:true});h.element('transcript').value='已有文字';const bytes=pcmToWav(new ArrayBuffer(32000));h.element('importWav').files=[{size:bytes.byteLength,arrayBuffer:async()=>bytes}];await h.element('importWav').events.change();assert.equal(h.element('transcript').value,'已有文字');assert.ok(!h.calls.some(c=>c.url==='/api/transcribe'));assert.equal(h.element('transcribeAudio').disabled,false);await h.element('transcribeAudio').events.click();assert.equal(h.calls.find(c=>c.url==='/api/transcribe').options.body.byteLength,32000);
});


test('导入WAV可本地回放及丢弃，丢弃禁用转写并释放URL',async()=>{
 const h=await harness({asrEnabled:true});const bytes=pcmToWav(new ArrayBuffer(32000));h.element('importWav').files=[{size:bytes.byteLength,arrayBuffer:async()=>bytes}];await h.element('importWav').events.change();assert.equal(h.element('playback').hidden,false);assert.equal(h.element('discard').disabled,false);assert.equal(h.element('prepareAudio').disabled,false);assert.ok(h.element('playback').src);
 h.element('discard').events.click();assert.equal(h.element('playback').hidden,true);assert.equal(h.element('transcribeAudio').disabled,true);assert.equal(h.element('downloadAudio').hidden,true);assert.equal(h.element('prepareAudio').disabled,true);assert.equal(h.revoked.length,2);
});


test('重试转写失败或取消保留上一份预览，成功后才替换',async()=>{
 let count=0;const h=await harness({asrEnabled:true,transcribe:async()=>{count++;if(count===2)return {ok:false,async json(){return {error:'504测试超时'};}};if(count===3)throw new DOMException('取消','AbortError');return {ok:true,async json(){return {text:`成功预览${count}`,simulated:true};}};}});await prepare(h);
 await h.element('transcribeAudio').events.click();assert.equal(h.element('asrPreview').textContent,'成功预览1');
 for(let i=0;i<2;i++){await h.element('transcribeAudio').events.click();assert.equal(h.element('asrPreview').textContent,'成功预览1');assert.equal(h.element('asrPreviewPanel').hidden,false);assert.equal(h.element('applyAsr').disabled,false);}
 await h.element('transcribeAudio').events.click();assert.equal(h.element('asrPreview').textContent,'成功预览4');h.element('discard').events.click();assert.equal(h.element('asrPreviewPanel').hidden,true);
});


test('空白或超长输入在本机提示，不发文字请求、不改已有结果',async()=>{
 const h=await harness();h.element('prompt').events.click();h.element('transcript').value='有效输入';await h.element('process').events.click();const result=h.element('result').textContent;
 for(const text of ['', '   ', 'x'.repeat(12001)]){h.element('transcript').value=text;await h.element('process').events.click();assert.equal(h.element('result').textContent,result);}
 h.element('chat').events.click();h.element('transcript').value='x'.repeat(4001);await h.element('process').events.click();assert.equal(h.calls.filter(c=>c.url==='/api/process').length,1);assert.match(h.element('status').textContent,/4000/);
});


test('重新检查服务保留音频和文字，切换服务清除旧上传确认',async()=>{
 let live=false;const h=await harness({readStatus:async()=>({ok:true,async json(){return {provider:live?'openai':'mock',simulated:!live,audioTranscription:live,asrProvider:live?'volcengine':undefined,asrSimulated:false};}})});await prepare(h);h.element('transcript').value='原文';h.element('cloudConsent').checked=true;h.element('audioConsent').checked=true;live=true;
 await h.element('refreshAsrService').events.click();assert.equal(h.element('transcribeAudio').disabled,false);assert.equal(h.element('transcript').value,'原文');assert.equal(h.element('downloadAudio').hidden,false);assert.equal(h.element('cloudConsent').checked,false);assert.equal(h.element('audioConsent').checked,false);assert.equal(h.revoked.length,0);
});
test('重新检查失败禁用处理但保留录音，可再次恢复服务',async()=>{
 let fail=false;const h=await harness({readStatus:async()=>({ok:!fail,async json(){return {simulated:true,audioTranscription:true,asrSimulated:true};}})});await prepare(h);fail=true;await h.element('refreshAsrService').events.click();assert.equal(h.element('process').disabled,true);assert.equal(h.element('transcribeAudio').disabled,true);assert.equal(h.element('downloadAudio').hidden,false);fail=false;await h.element('refreshAsrService').events.click();assert.equal(h.element('process').disabled,false);assert.equal(h.element('transcribeAudio').disabled,false);
});


test('桌面全局快捷键锁定首次录音模式，停止后才能切换',async()=>{
 const h=await harness();const trigger=h.listeners.get('talkcraft-shortcut');
 await trigger({detail:{action:'translate'}});assert.equal(h.captures.length,1);assert.equal(h.captures[0].state,'recording');
 await trigger({detail:{action:'prompt'}});assert.equal(h.captures[0].state,'inactive');assert.equal(h.element('translate')['aria-pressed'],'true');assert.notEqual(h.element('prompt')['aria-pressed'],'true');assert.equal(h.captures.length,1);
 h.captures[0].data();h.captures[0].finish();
 await trigger({detail:{action:'chat'}});assert.equal(h.captures.length,2);assert.equal(h.element('chat')['aria-pressed'],'true');
 await trigger({detail:{action:'process'}});assert.match(h.element('status').textContent,/请先结束录音/);assert.equal(h.calls.filter(c=>c.url==='/api/process').length,0);
 h.captures[1].data();await trigger({detail:{action:'chat'}});h.captures[1].finish();
 h.element('transcript').value='测试整理';await trigger({detail:{action:'process'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.filter(c=>c.url==='/api/process').length,1);h.listeners.get('beforeunload')();
});
test('编辑框焦点只在工作台当前获得焦点时阻止全局录音，切到其他应用后可触发',async()=>{
 const editing=await harness({shortcutEditing:true,windowFocused:true});await editing.listeners.get('talkcraft-shortcut')({detail:{action:'dictation'}});assert.equal(editing.captures.length,0);editing.listeners.get('beforeunload')();
 const background=await harness({shortcutEditing:true,windowFocused:false});await background.listeners.get('talkcraft-shortcut')({detail:{action:'dictation'}});assert.equal(background.captures.length,1);background.listeners.get('beforeunload')();
});

test('全局录音等待权限时再次触发立即取消，授权迟到不启动录音',async()=>{
 let grant;const permissionGate=new Promise(resolve=>{grant=resolve;});const h=await harness({permissionGate});const trigger=h.listeners.get('talkcraft-shortcut');
 const pending=trigger({detail:{action:'dictation'}});assert.equal(h.captures.length,0);await trigger({detail:{action:'dictation'}});
 grant();await pending;assert.equal(h.captures.length,0);assert.equal(h.stream.stops,1);assert.match(h.element('status').textContent,/已放弃本次录音/);
 await trigger({detail:{action:'dictation'}});assert.equal(h.captures.length,1);assert.equal(h.captures[0].state,'recording');h.listeners.get('beforeunload')();
});

test('首次协议拒绝前不录音，同意后云端授权记住且可撤回',async()=>{
 const h=await harness({agreement:true,simulated:false,asrEnabled:true,asrSimulated:false});
 assert.equal(h.element('usageAgreement').open,true);await h.element('record').events.click();assert.equal(h.captures.length,0);
 h.element('acceptAgreement').events.click();assert.equal(h.element('cloudConsent').checked,true);assert.equal(h.element('audioConsent').checked,true);assert.equal(h.element('consentLabel').hidden,true);
 await h.element('refreshAsrService').events.click();assert.equal(h.element('audioConsent').checked,true);
 h.element('revokeAgreement').events.click();assert.equal(h.element('cloudConsent').checked,false);assert.equal(h.element('usageAgreement').open,true);
 const remembered=await harness({agreement:true,remembered:true});assert.equal(remembered.element('usageAgreement').open,undefined);assert.equal(remembered.element('audioConsent').checked,true);
});
test('已同意协议后一键完成音频转换与转写，不自动调用文字模型',async()=>{
 const h=await harness({agreement:true,remembered:true,asrEnabled:true,asrSimulated:false});
 await h.element('record').events.click();h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.filter(c=>c.url==='/api/transcribe').length,1);assert.equal(h.calls.filter(c=>c.url==='/api/process').length,0);assert.equal(h.element('applyAsr').disabled,false);
});


test('一键转写重新转换失败不能提交上一次准备的音频',async()=>{let attempts=0;const h=await harness({agreement:true,remembered:true,asrEnabled:true,decode:async()=>{if(++attempts>1)throw new Error('转换失败');return {pcm:new ArrayBuffer(2),wav:new ArrayBuffer(44),sampleRate:16000,channels:1,bitDepth:16,duration:1};}});await h.element('record').events.click();h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));await h.element('prepareAudio').events.click();assert.equal(h.calls.filter(c=>c.url==='/api/transcribe').length,1);assert.match(h.element('status').textContent,/转换失败/);});

test('工作台听写结束自动转写且不调用文字模型',async()=>{const h=await harness({agreement:true,remembered:true,asrEnabled:true});h.element('transcript').value='已有草稿';await h.element('record').events.click();h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.filter(c=>c.url==='/api/transcribe').length,1);assert.equal(h.calls.filter(c=>c.url==='/api/process').length,0);assert.match(h.element('transcript').value,/已有草稿\n/);await h.element('process').events.click();assert.equal(h.calls.filter(c=>c.url==='/api/process').length,0);});
test('全局快捷键四模式结束后自动转写，听写直出且其他模式调用文字模型',async()=>{for(const mode of ['dictation','prompt','translate','chat']){const h=await harness({agreement:true,remembered:true,asrEnabled:true});const key=h.listeners.get('talkcraft-shortcut');await key({detail:{action:mode,phase:'toggle'}});h.captures[0].data();await key({detail:{action:mode,phase:'toggle'}});h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));const calls=h.calls.filter(c=>c.url==='/api/process');assert.equal(calls.length,mode==='dictation'?0:1);if(calls.length)assert.equal(JSON.parse(calls[0].options.body).mode,mode);assert.equal(h.element('copy').disabled,false);}});
test('悬浮条听写录音直接输出，放弃或转写失败不进入文字处理',async()=>{const h=await harness({agreement:true,remembered:true,asrEnabled:true});const hud=h.listeners.get('hud-record');await hud();h.captures[0].data();await hud();h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.filter(c=>c.url==='/api/process').length,0);assert.equal(h.element('copy').disabled,false);for(const discard of [false,true]){const bad=await harness({agreement:true,remembered:true,asrEnabled:true,transcribe:async()=>{throw new Error('识别失败');}});await bad.listeners.get('hud-record')();bad.captures[0].data();if(discard)bad.listeners.get('hud-discard')();else await bad.listeners.get('hud-record')();bad.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(bad.calls.filter(c=>c.url==='/api/process').length,0);if(discard)assert.equal(bad.calls.filter(c=>c.url==='/api/transcribe').length,0);assert.equal(bad.element('record').disabled,false);}});


test('自动转写追加严格保留草稿空格换行，超长草稿留预览不覆盖',async()=>{for(const draft of ['  原草稿 \n\n','x'.repeat(12000)]){const h=await harness({agreement:true,remembered:true,asrEnabled:true});h.element('transcript').value=draft;await h.element('record').events.click();h.captures[0].data();await h.element('record').events.click();h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));if(draft.length===12000){assert.equal(h.element('transcript').value,draft);assert.equal(h.element('asrPreviewPanel').hidden,false);}else assert.equal(h.element('transcript').value.startsWith(draft+'\n'),true);assert.equal(h.calls.filter(c=>c.url==='/api/process').length,0);}});

test('右Alt系列按一次开始、再次按下结束并处理（事件替身）',async()=>{const h=await harness({agreement:true,remembered:true,asrEnabled:true});const key=h.listeners.get('talkcraft-shortcut');await key({detail:{action:'translate',phase:'toggle'}});assert.equal(h.captures[0].state,'recording');h.captures[0].data();await key({detail:{action:'translate',phase:'toggle'}});assert.equal(h.captures[0].state,'inactive');h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.parse(h.calls.find(c=>c.url==='/api/process').options.body).mode,'translate');});
test('录音期间任意模式快捷键只结束首次模式，不切换成听写',async()=>{for(const initial of ['chat','translate','prompt']){const h=await harness({agreement:true,remembered:true,asrEnabled:true});const key=h.listeners.get('talkcraft-shortcut');await key({detail:{action:initial,phase:'toggle'}});assert.equal(h.element(initial)['aria-pressed'],'true');h.captures[0].data();await key({detail:{action:'dictation',phase:'toggle'}});assert.equal(h.captures[0].state,'inactive');assert.equal(h.element(initial)['aria-pressed'],'true');assert.notEqual(h.element('dictation')['aria-pressed'],'true');h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.parse(h.calls.find(c=>c.url==='/api/process').options.body).mode,initial);assert.match(h.element('status').textContent,/处理完成|已完成|已接受/);}});

test('外部翻译录音锁定停止时语言，ASR等待期间切换界面不改本次请求（服务替身）',async()=>{let release;const gate=new Promise(resolve=>release=resolve);const h=await harness({agreement:true,remembered:true,asrEnabled:true,transcribe:async()=>{await gate;return {ok:true,json:async()=>({text:'保留这句话',simulated:true})};}});h.element('translate').events.click();h.element('language').value='en';const hud=h.listeners.get('hud-record');await hud();h.captures[0].data();await hud();h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));h.element('language').value='zh';release();await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.parse(h.calls.find(c=>c.url==='/api/process').options.body).targetLanguage,'en');});


test('历史录音/转写/AI使用同一ID，工作台与HUD不创建第二条（事件替身）',async()=>{
 const trace=[];const bridge={begin:v=>trace.push(['begin',v]),patch:v=>trace.push(['patch',v]),audio:(blob,id)=>trace.push(['audio',{id}]),saved:async()=>{}};
 const h=await harness({historyBridge:bridge,agreement:true,remembered:true,asrEnabled:true});
 const hud=h.listeners.get('hud-record');await hud();h.captures[0].data();await hud();h.captures[0].finish();await new Promise(r=>setImmediate(r));
 assert.equal(trace.filter(([t])=>t==='begin').length,1);const id=trace[0][1].id;assert.ok(trace.every(([,v])=>v.id===id));assert.ok(trace.some(([,v])=>v.originalTranscript));assert.ok(trace.some(([,v])=>v.attempt?.stage==='dictation'&&v.aiResult===''));
});

test('主动历史AI/ASR重试不覆盖工作台草稿、当前音频与结果（服务/录音替身）',async()=>{
 const trace=[];const h=await harness({historyBridge:{begin:v=>trace.push(v),patch:v=>trace.push(v),saved:async()=>{}},agreement:true,remembered:true,asrEnabled:true});
 h.element('transcript').value='当前草稿';h.element('result').textContent='当前结果';h.element('playback').src='blob:current';
 const record={id:'saved-record',mode:'translate',originalTranscript:'旧转录',revisedText:'历史修订',targetLanguage:'en'};
 await h.retry(record,'ai');await h.retry(record,'asr');assert.equal(h.element('transcript').value,'当前草稿');assert.equal(h.element('result').textContent,'当前结果');assert.equal(h.element('playback').src,'blob:current');assert.ok(trace.every(v=>v.id==='saved-record'));assert.ok(trace.some(v=>v.attempt?.stage==='asr'));assert.ok(trace.some(v=>v.attempt?.stage==='ai'));
});
test('四种模式的转写阶段都可由任意录音快捷键立即打断',async()=>{
 for(const initial of ['dictation','prompt','translate','chat']){
  let aborted=false;const h=await harness({agreement:true,remembered:true,asrEnabled:true,transcribe:options=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('取消','AbortError'));},{once:true}))});const key=h.listeners.get('talkcraft-shortcut');
  await key({detail:{action:initial}});h.captures[0].data();await key({detail:{action:initial}});h.captures[0].finish();await new Promise(resolve=>setImmediate(resolve));
  await key({detail:{action:'dictation'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(aborted,true);assert.equal(h.captures.length,1);assert.match(h.element('status').textContent,/已取消转写|正在取消/);
 }
});
test('提示词、翻译和问答的AI思考阶段可由任意录音快捷键打断',async()=>{
 for(const initial of ['prompt','translate','chat']){
  let aborted=false;const h=await harness({agreement:true,remembered:true,complete:options=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('取消','AbortError'));},{once:true}))});h.element(initial).events.click();h.element('transcript').value='需要处理的文字';const pending=h.element('process').events.click();await new Promise(resolve=>setImmediate(resolve));
  await h.listeners.get('talkcraft-shortcut')({detail:{action:'dictation'}});await pending;assert.equal(aborted,true);assert.equal(h.captures.length,0);assert.match(h.element('status').textContent,/已取消处理/);
 }
});

test('历史重新查询显式执行联网工具并保存独立尝试，不覆盖工作台（服务替身）',async()=>{
 const trace=[];const searchResult={searchId:'history-requery',taskId:'task-requery',performed:true,status:'searched',sources:[{sourceId:'source-one',title:'来源',url:'https://example.com/source'}],progress:[]};
 const h=await harness({historyBridge:{begin:v=>trace.push(v),patch:v=>trace.push(v),saved:async()=>{}},agreement:true,remembered:true,webSearchAvailable:true,search:async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>searchResult}),complete:async()=>({ok:true,json:async()=>({text:'重新查询回答[1]',simulated:true,search:{...searchResult,usedSourceIds:['source-one']}})})});
 h.element('transcript').value='当前草稿';h.element('result').textContent='当前结果';
 await h.retry({id:'saved-chat',mode:'chat',originalTranscript:'理想i9详细参数',webSearchAllowed:false},'requery');
 const searchCall=h.calls.find(c=>c.url==='/api/search'),processCall=h.calls.find(c=>c.url==='/api/process');assert.ok(searchCall);assert.equal(JSON.parse(searchCall.options.body).query,'理想i9详细参数');assert.equal(JSON.parse(processCall.options.body).searchId,'history-requery');assert.equal(h.element('transcript').value,'当前草稿');assert.equal(h.element('result').textContent,'当前结果');assert.ok(trace.some(v=>v.attempt?.stage==='requery'&&v.attempt?.search?.searchId==='history-requery'));
});


test('HUD自动天气问答在只读dataset下渲染流式事件并保存成功或失败尝试',async()=>{
 for(const fail of [false,true]){
  const patches=[];
  const event={eventId:'weather:1',taskId:'weather-task',callId:'weather-call',sequence:1,stage:'weather',tool:'get_weather',status:'running',input:{location:'张家港'}};
  const evidence={searchId:'weather-evidence',taskId:'weather-task',performed:true,status:'weather-data',sources:[],progress:[event]};
  const messages=[{type:'progress',event},fail?{type:'error',taskId:'weather-task',status:502,error:'天气服务暂时不可用'}:{type:'result',data:evidence}];
  let delivered=false;
  const h=await harness({agreement:true,remembered:true,asrEnabled:true,weatherAvailable:true,
   historyBridge:{begin(){},audio(){},patch:v=>patches.push(v)},
   transcribe:async()=>({ok:true,json:async()=>({text:'张家港最近这一周天气。',simulated:true})}),
   search:async()=>({ok:true,headers:{get:()=> 'application/x-ndjson'},body:{getReader:()=>({read:async()=>{if(delivered)return {done:true};delivered=true;return {done:false,value:new TextEncoder().encode(messages.map(v=>JSON.stringify(v)).join('\n')+'\n')};}})}}),
   complete:async()=>({ok:true,json:async()=>({text:'天气回答测试替身',simulated:true,search:evidence})})});
  h.element('chat').events.click();const hud=h.listeners.get('hud-record');await hud();h.captures[0].data();await hud();h.captures[0].finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(patches.some(v=>v.attempt?.stage==='asr'&&v.attempt.status==='completed'));
  const attempt=patches.find(v=>v.attempt?.stage==='ai');assert.ok(attempt);
  assert.equal(attempt.attempt.status,fail?'failed':'completed');
  assert.equal(h.element('executionEvents').children[0].dataset.status,'running');
  assert.equal(h.element('process').disabled,false);
  assert.doesNotMatch(h.element('status').textContent,/dataset|自动处理失败/);
  if(fail){assert.match(attempt.error,/天气服务暂时不可用/);assert.ok(!h.calls.some(v=>v.url==='/api/process'));}
  else assert.equal(attempt.aiResult,'天气回答测试替身');
 }
});
