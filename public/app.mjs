import {createCaptureSounds,bindCaptureSounds} from './living-fluid.mjs';
import {createRecordingSession,createMicrophonePicker} from './recording.mjs';
import {decodeRecording,importPcmWav} from './audio.mjs';
import {createConversation} from './conversation.mjs';
if (!/[?&](?:hud=1|panel=)(?:[^&]*)/.test(globalThis.location?.search || '')) {
if(typeof globalThis.Audio==='function'){const cleanup=bindCaptureSounds(window,createCaptureSounds());window.addEventListener('beforeunload',cleanup,{once:true});}
const $ = id => document.getElementById(id);
let discardCapture=false;
let historyTaskId,historyTextId,captureStarted=0;window.addEventListener('history-reuse',event=>{historyTextId=event.detail.id;});
const newHistoryTask=(taskMode=mode)=>{historyTaskId=globalThis.crypto?.randomUUID?.()||`task-${Date.now()}-${Math.random().toString(16).slice(2)}`;window.__talkcraftHistory?.begin({id:historyTaskId,mode:taskMode,status:'acquiring'});return historyTaskId;};
const historyPatch=input=>window.__talkcraftHistory?.patch({...input,id:input.id||historyTaskId,mode:input.mode||mode});
let recordingOrigin='workbench',automaticBusy=false;
let mode = 'dictation', recordingUrl, recordingBlob, preparedUrl, preparedAudio, audioController, asrController, asrPreview, controller, output = '', previousOutput='', service, checkingService=false;
const status = text => {$('status').textContent = text;if($('processStatus'))$('processStatus').textContent=text;};
const agreementDialog=$('usageAgreement');
const agreementUi=typeof agreementDialog?.showModal==='function';
let agreementAccepted=false;
try{agreementAccepted=globalThis.localStorage?.getItem('talkcraft-agreement-v1')==='accepted';}catch{}
function syncAgreement(){if(!agreementUi)return;$('cloudConsent').checked=agreementAccepted;$('audioConsent').checked=agreementAccepted;$('consentLabel').hidden=true;$('audioConsentLabel').hidden=true;}
function requireAgreement(){if(!agreementUi||agreementAccepted)return true;if(!agreementDialog.open)agreementDialog.showModal();return false;}
if(agreementUi){
 agreementDialog.addEventListener('cancel',event=>event.preventDefault());
 $('acceptAgreement').addEventListener('click',()=>{agreementAccepted=true;try{globalThis.localStorage?.setItem('talkcraft-agreement-v1','accepted');}catch{}syncAgreement();agreementDialog.close();});
 $('reviewAgreement').addEventListener('click',()=>agreementDialog.showModal());
 $('revokeAgreement').addEventListener('click',()=>{agreementAccepted=false;try{globalThis.localStorage?.removeItem('talkcraft-agreement-v1');}catch{}syncAgreement();controller?.abort();asrController?.abort();if(!agreementDialog.open)agreementDialog.showModal();});
 syncAgreement();requireAgreement();
}
const conversation=createConversation();let chatGeneration=0;
const isWeatherQuestion=text=>/(天气|气温|温度|下雨|降雨|降雪|风力|湿度|空气质量|紫外线|穿衣指数)/.test(text);
let searchPreferenceTouched=false;
$('webSearchToggle').addEventListener('change',()=>{searchPreferenceTouched=true;if(!$('webSearchToggle').checked)renderSearchEvidence();});
const executionState={taskId:null,query:'',startedAt:0,events:[],eventIds:new Set(),sources:[],weather:null,finished:false,status:'idle',usedSourceIds:[]};
const toolNames={search_web:'搜索网页',read_webpage:'读取网页',get_weather:'查询天气'};
const eventStatusNames={running:'开始',completed:'完成',failed:'失败',cancelled:'已取消',timeout:'超时',limit:'达到调用上限'};
function safeExternalUrl(value){if(typeof value!=='string'||!/^https?:\/\//i.test(value))return'';const authority=value.match(/^https?:\/\/([^/]+)/i)?.[1]||'';return authority.includes('@')?'':value;}
function sourceDomain(url){return String(url).match(/^https?:\/\/([^/:?#]+)/i)?.[1]||'';}
function resetExecution(query=''){executionState.taskId=null;executionState.query=query;executionState.startedAt=Date.now();executionState.events=[];executionState.eventIds=new Set();executionState.sources=[];executionState.weather=null;executionState.finished=false;executionState.status='running';executionState.usedSourceIds=[];}
function executionSnapshot(){return {allowed:true,taskId:executionState.taskId,query:executionState.query,performed:executionState.events.some(event=>event.status==='completed'),status:executionState.status||'not-invoked',sources:executionState.sources,weather:executionState.weather,progress:[...executionState.events],toolTrace:[],elapsedMs:Math.max(0,Date.now()-executionState.startedAt),toolCalls:new Set(executionState.events.map(event=>event.callId).filter(Boolean)).size};}
function addExecutionEvent(event){if(!event||typeof event!=='object')return;if(executionState.taskId&&event.taskId&&event.taskId!==executionState.taskId)return;if(!executionState.taskId&&event.taskId)executionState.taskId=event.taskId;const id=event.eventId||`${event.taskId||''}:${event.sequence??''}:${event.callId||''}:${event.status||''}`;if(executionState.eventIds.has(id))return;executionState.eventIds.add(id);executionState.events.push({...event,eventId:id});executionState.events.sort((a,b)=>(a.sequence??999)-(b.sequence??999));}
function renderAnswer(text,search){const target=$('result'),sources=Array.isArray(search?.sources)?search.sources:[];if(!sources.length||typeof target.replaceChildren!=='function'){target.textContent=text;return;}const parts=[],pattern=/\[(\d{1,2})\]/g;let offset=0,match;while((match=pattern.exec(text))){const span=document.createElement('span');span.textContent=text.slice(offset,match.index);parts.push(span);const source=sources[Number(match[1])-1];if(source?.sourceId){const link=document.createElement('a');link.href=`#${source.sourceId}`;link.textContent=match[0];link.title=`定位来源：${source.title||source.domain||source.url}`;parts.push(link);}else{const raw=document.createElement('span');raw.textContent=match[0];parts.push(raw);}offset=pattern.lastIndex;}const tail=document.createElement('span');tail.textContent=text.slice(offset);parts.push(tail);target.replaceChildren(...parts);}
function renderExecution(search){
  const panel=$('executionPanel'),summary=$('executionSummary'),query=$('executionQuery'),events=$('executionEvents'),sourcesList=$('webSearchSources'),structured=$('structuredEvidence'),empty=$('executionEmpty');if(!panel||!summary||!events||!sourcesList)return;
  const data=search||executionState,sources=Array.isArray(data.sources)?data.sources:executionState.sources,trace=Array.isArray(data.progress)&&data.progress.length?data.progress:executionState.events,weather=data.weather||executionState.weather,used=new Set(data.usedSourceIds||executionState.usedSourceIds);
  query.textContent=data.query||executionState.query||'未记录';$('copyExecutionQuery').disabled=!(data.query||executionState.query);
  events.replaceChildren();for(const event of trace){const li=document.createElement('li');li.dataset.status=event.status||'';const name=toolNames[event.tool]||({answering:'整理回答',task:'任务'}[event.stage]||event.stage||'任务');let detail='';if(event.tool==='search_web'&&event.input?.query)detail=`：${event.input.query}`;else if(event.tool==='read_webpage'&&event.input?.url)detail=`：${event.input.url}`;else if(event.tool==='get_weather'&&event.input?.location)detail=`：${event.input.location}`;if(Number.isInteger(event.resultCount))detail+=` · 返回 ${event.resultCount} 条`;if(Number.isFinite(event.elapsedMs))detail+=` · ${(event.elapsedMs/1000).toFixed(1)} 秒`;if(event.error)detail+=` · ${event.error}`;li.textContent=`${name} · ${eventStatusNames[event.status]||event.status||'状态未知'}${detail}`;events.append(li);}
  sourcesList.replaceChildren();for(const [index,source] of sources.entries()){const url=safeExternalUrl(source.url);if(!url)continue;const li=document.createElement('li');li.id=source.sourceId||`source-${index+1}`;li.className='source-card';const heading=document.createElement('div'),a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`[${index+1}] ${source.title||source.domain||url}`;heading.append(a);if(used.has(source.sourceId)){const badge=document.createElement('span');badge.className='source-used';badge.textContent='回答已引用';heading.append(badge);}li.append(heading);const state={hit:'仅搜索命中',summary:'已取得摘要',read:'已读取正文', 'read-failed':'正文读取失败'}[source.evidenceState]||'仅搜索命中',meta=document.createElement('small');meta.textContent=`${source.domain||sourceDomain(url)} · ${state} · 发布时间：${source.publishedAt||'未提供'} · 获取时间：${source.fetchedAt||'未提供'}`;li.append(meta);if(source.snippet){const details=document.createElement('details'),s=document.createElement('summary'),pre=document.createElement('pre');s.textContent=source.evidenceState==='read'?'本次读取的相关片段':'搜索返回的相关摘要';pre.textContent=source.snippet;details.append(s,pre);li.append(details);}const copy=document.createElement('button');copy.type='button';copy.textContent='复制链接';copy.onclick=async()=>{try{await navigator.clipboard.writeText(url);copy.textContent='已复制';}catch{copy.textContent='复制失败';}};li.append(copy);sourcesList.append(li);}
  if(structured){if(weather){structured.hidden=false;const current=weather.current||{},forecast=weather.forecast||{},days=Array.isArray(weather.forecasts)?weather.forecasts:[];structured.textContent=`数据提供方：${weather.provider||'未记录'}\n地点：${weather.location||'未记录'}\n数据时间：${weather.observedAt||weather.forecastDate||'未记录'}${weather.current?`\n当前：${current.condition||'未记录'}${Number.isFinite(current.temperature)?` · ${current.temperature}℃`:''}`:''}${days.length?`\n未来七天：\n${days.map(day=>`${day.date} ${day.condition||'未记录'} ${day.temperatureMin}–${day.temperatureMax}℃`).join('\n')}`:`\n预报：${forecast.condition||'未记录'}${Number.isFinite(forecast.temperatureMax)?` · ${forecast.temperatureMin}–${forecast.temperatureMax}℃`:''}`}`;}else{structured.hidden=true;structured.textContent='';}}
  const terminal=[...trace].reverse().find(event=>['failed','cancelled','timeout','limit'].includes(event.status)),elapsed=Number.isFinite(data.totalElapsedMs)?data.totalElapsedMs:Number.isFinite(data.elapsedMs)?data.elapsedMs:Math.max(0,Date.now()-executionState.startedAt),steps=Array.isArray(data.toolTrace)?data.toolTrace.length:new Set(trace.map(x=>x.callId).filter(Boolean)).size;
  const engine=data.engine==='langgraph'?' · LangGraph':data.engine==='legacy'?' · 旧流程':'';summary.textContent=(terminal?`${eventStatusNames[terminal.status]} · ${steps} 个工具步骤 · ${(elapsed/1000).toFixed(1)} 秒`:data.finished||executionState.finished?`完成 · ${steps} 个工具步骤 · ${(elapsed/1000).toFixed(1)} 秒`:`处理中 · 当前${trace.length?toolNames[trace.at(-1).tool]||'整理回答':'准备工具'} · 已用 ${(elapsed/1000).toFixed(1)} 秒`)+engine;
  empty.hidden=trace.length>0||sourcesList.children.length>0||!!weather;
}
$('copyExecutionQuery').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(executionState.query);$('copyExecutionQuery').textContent='已复制';}catch{$('copyExecutionQuery').textContent='复制失败';}});
function renderSearchEvidence(search){
  const box=$('webSearchEvidence'),list=$('webSearchSources');if(!box||!list)return;
  const sources=Array.isArray(search?.sources)?search.sources:[];
  if(!search){box.textContent='联网搜索默认关闭。只有取得真实工具执行证据时才会标记已联网。';renderExecution();return;}
  if(search.state==='searching'){box.textContent='正在等待真实搜索工具执行证据…';renderExecution();return;}
  if(search.state==='reading'){box.textContent='搜索结果正文不足，正在安全读取公开网页…';renderExecution();return;}
  if(search.state==='weather'){box.textContent='正在查询结构化天气数据…';renderExecution();return;}
  if(search.state==='failed'){box.textContent=`联网搜索失败：${search.error||'没有取得执行证据'}`;executionState.status='failed';renderExecution();return;}
  const elapsed=Number.isFinite(search.elapsedMs)?` · ${(search.elapsedMs/1000).toFixed(1)} 秒`:'';
  const requests=Number.isFinite(search.usage?.webSearchRequests)?` · ${search.usage.webSearchRequests} 次工具请求`:'';
  const rounds=Number.isInteger(search.attempts)?` · ${search.attempts} 轮检索`:'';
  const quality=search.quality?` · ${search.quality.sufficient?'证据检查通过':`证据仍不足：${search.quality.reason}`}`:'';
  if(search.status==='needs-input')box.textContent=`需要补充地点：${search.needsClarification||search.quality?.reason||'请说明城市或地区'}`;
  else if(search.status==='not-needed')box.textContent='已识别为一般知识问题，无需调用联网工具';
  else if(search.status==='unsupported-url-read')box.textContent='当前服务没有启用安全网页正文读取工具，未读取指定网址';
  else if(search.status==='read-failed')box.textContent=`网页读取失败：${search.quality?.reason||'没有取得可用正文'}`;
  else if(search.status==='page-read')box.textContent=`已读取公开网页正文 · ${sources.length} 条来源${quality}${elapsed}`;
  else if(search.tool==='weather'&&search.performed)box.textContent=`已取得结构化天气数据 · ${search.weather?.location||''} · ${search.weather?.observedAt||search.weather?.forecastDate||''}${quality}${elapsed}`;
  else if(search.performed&&sources.length)box.textContent=`已取得联网搜索执行证据 · ${sources.length} 条来源${search.synthesisAvailable?' · 可读检索摘要已用于回答':''}${rounds}${quality}${elapsed}${requests}`;
  else if(search.performed)box.textContent=`已执行联网搜索，但没有可引用结果${elapsed}${requests}`;
  else box.textContent=`已允许联网搜索，但本次模型没有执行搜索${elapsed}`;
  Object.assign(executionState,{taskId:search.taskId||executionState.taskId,query:search.query||executionState.query,sources,weather:search.weather||null,usedSourceIds:search.usedSourceIds||[],finished:!search.state,status:search.status||executionState.status});for(const event of search.progress||[])addExecutionEvent(event);renderExecution(search);
}
async function requestWebSearch(question,active){
  const weather=isWeatherQuestion(question);resetExecution(question);status(weather?'正在查询天气…':'正在搜索并读取可用资料…');renderSearchEvidence({state:weather?'weather':'searching',query:question,sources:[]});
  const response=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({mode:'chat',query:question,cloudConsent:$('cloudConsent').checked}),signal:active.signal});
  let data;const type=response.headers?.get?.('content-type')||'';
  if(type.includes('application/x-ndjson')&&response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){if(!line.trim())continue;const message=JSON.parse(line);active.signal.throwIfAborted();if(message.type==='progress'){const event=message.event||{};addExecutionEvent(event);renderExecution();if(event.stage==='weather'&&event.status==='running')status('正在查询天气…');else if(event.stage==='searching'&&event.status==='running')status('正在搜索…');else if(event.stage==='reading'&&event.status==='running')status('正在读取资料…');else if(event.stage==='answering')status('正在整理回答…');else if(event.status==='failed')status(`${event.tool==='read_webpage'?'资料读取':'工具执行'}失败，正在检查已有证据…`);}else if(message.type==='result')data=message.data;else if(message.type==='error'){const terminal={eventId:`${message.taskId}:error`,taskId:message.taskId,sequence:999,stage:'task',status:message.status===504?'timeout':'failed',error:message.error};addExecutionEvent(terminal);renderExecution();throw Object.assign(new Error(message.error||'联网工具失败'),{status:message.status});}}if(done)break;}}
  else data=await response.json();active.signal.throwIfAborted();if(!response.ok)throw Error(data?.error||'联网搜索失败');
  if(!data)throw Error('联网工具没有返回最终结果');
  if(typeof data.searchId!=='string'||typeof data.performed!=='boolean'||!Array.isArray(data.sources))throw Error('联网搜索结果格式无效');
  renderSearchEvidence(data);status(data.status==='needs-input'?'天气查询需要补充地点，正在整理追问…':data.status==='not-needed'?'无需联网工具，正在回答…':data.status==='unsupported-url-read'?'网页读取未启用，正在说明限制…':data.status==='read-failed'?'网页读取失败，正在说明限制…':data.status==='page-read'?'网页资料已读取，正在整理回答…':data.tool==='weather'&&data.performed?'天气数据已取得，正在整理回答…':data.performed&&data.sources.length?'搜索完成，正在整理回答…':data.performed?'搜索完成但没有可引用结果，正在整理回答…':'工具没有取得数据，正在生成明确说明…');return data;
}
async function requestAgentGraph(input,active){
  resetExecution(input.text);status('正在由 LangGraph 查询天气…');renderSearchEvidence({state:'weather',query:input.text,sources:[]});
  const response=await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-TalkCraft-History-Metadata':'true'},body:JSON.stringify(input),signal:active.signal});
  let data;const type=response.headers?.get?.('content-type')||'';
  if(type.includes('application/x-ndjson')&&response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){if(!line.trim())continue;const message=JSON.parse(line);active.signal.throwIfAborted();if(message.type==='progress'){const event=message.event||{};addExecutionEvent(event);renderExecution();if(event.stage==='weather'&&event.status==='running')status('正在查询天气…');else if(event.stage==='answering'&&event.status==='running')status('资料已取得，正在整理回答…');}else if(message.type==='result')data=message.data;else if(message.type==='error'){addExecutionEvent({eventId:`${message.taskId}:error`,taskId:message.taskId,sequence:999,stage:'task',status:message.status===504?'timeout':'failed',error:message.error});executionState.finished=true;renderExecution();throw Object.assign(new Error(message.error||'Agent执行失败'),{status:message.status});}}if(done)break;}}
  else data=await response.json();active.signal.throwIfAborted();if(!response.ok)throw Error(data?.error||'Agent执行失败');
  if(!data||typeof data.text!=='string'||!data.text.trim()||typeof data.simulated!=='boolean'||data.search?.engine!=='langgraph')throw Error('LangGraph回答结果无效');
  executionState.finished=true;renderSearchEvidence(data.search);return data;
}
const microphonePicker=createMicrophonePicker({mediaDevices:navigator.mediaDevices,select:$('microphoneSource'),refreshButton:$('refreshMicrophones'),notice:$('microphoneNotice'),document});
function updateConversation() {
  $('chatHistory').textContent=conversation.history.map(message => `${message.role==='user' ? '你' : 'AI'}：${message.content}`).join('\n\n');
  $('chatCount').textContent=`已保留 ${conversation.history.length/2} 轮，仅保存在当前页面`;
}
updateConversation();
$('process').disabled = true;
async function refreshService() {
  if(checkingService)return;
  if(controller || audioController || asrController){status('请等待当前处理完成后再检查服务');return;}
  checkingService=true;
  $('refreshAsrService').disabled=true;
  const previous=service;
  service=undefined;$('process').disabled=true;$('transcribeAudio').disabled=true;
  status('正在检查服务配置…');
  try {
    const response = await fetch('/api/status',{signal:AbortSignal.timeout(10000)}); if (!response.ok) throw new Error('无法读取服务配置');
    service = await response.json();
    const identity=value=>JSON.stringify([value?.provider,value?.simulated,value?.local,value?.audioTranscription,value?.asrProvider,value?.asrSimulated,value?.webSearchAvailable,value?.weatherAvailable]);
    if(previous && identity(previous)!==identity(service)){$('cloudConsent').checked=false;$('audioConsent').checked=false;}
    const audioState=!service.audioTranscription ? '语音识别未启用：目前只能回放或下载录音，不能生成转写文字。需配置火山语音识别凭据后重启服务；文字 AI 配置不能代替语音识别。' : service.asrSimulated ? '语音识别为模拟，主动提交仅发送到本机服务，不上传云端，也不会真正识别音频。' : '语音识别将调用云端，首次协议同意后，主动转写会将音频发送至已配置的云端服务。';
    $('providerNotice').textContent = `${service.simulated ? '文字处理为模拟，未调用真实 AI。' : service.local ? '文字处理为本机 Ollama，不上传云端。' : `文字处理已配置 ${service.provider}，提交文本后将发送至云端。`} ${audioState}`;
    $('asrNotice').textContent=audioState;
    $('audioConsentLabel').hidden=!service.audioTranscription || service.asrSimulated;
    $('consentLabel').hidden = service.simulated || service.local===true;
    const onlineTools=service.webSearchAvailable||service.weatherAvailable;$('webSearchToggle').disabled=!onlineTools;if(onlineTools&&!searchPreferenceTouched)$('webSearchToggle').checked=true;$('webSearchAvailability').textContent=service.webSearchAvailable&&service.weatherAvailable?'已默认开启 · DeepSeek 搜索 + 结构化天气可用':service.weatherAvailable?'已默认开启 · 结构化天气可用；当前模型不支持通用搜索':service.webSearchAvailable?'已默认开启 · DeepSeek 原生搜索可用':'当前提供器不支持联网工具';if(!onlineTools)$('webSearchToggle').checked=false;
    status(service.simulated ? '就绪 · 模拟模式' : service.local ? '就绪 · 本机 Ollama' : '就绪 · 云端文本模式'); $('process').disabled = false;
    syncAgreement();syncAsrButtons();
  } catch (error) {service=undefined;$('cloudConsent').checked=false;$('audioConsent').checked=false;$('process').disabled=true;$('webSearchToggle').disabled=true;$('webSearchAvailability').textContent='服务状态不可用';status(`服务状态读取失败：${error.message}；录音已保留，可重新检查`);syncAsrButtons();}
  finally {checkingService=false;$('refreshAsrService').disabled=false;}
}
refreshService();
$('refreshAsrService').addEventListener('click',refreshService);
window.addEventListener('text-service-changed',()=>{service=undefined;$('cloudConsent').checked=false;$('audioConsent').checked=false;$('process').disabled=true;syncAsrButtons();refreshService();});
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  $('languageLabel').hidden = mode !== 'translate';
  $('promptPreset').hidden = mode !== 'prompt';
  $('chatPanel').hidden=mode!=='chat';
}));
async function processCurrentText(options={}) { if(automaticBusy&&!options.automatic)return;if(!requireAgreement())return;syncAgreement();
  const requestMode=options.mode||mode;
  const inputText=options.text??$('transcript').value;
  if(!inputText.trim()){status('请先输入文字，或完成音频转写后使用预览');return;}
  if(inputText.length>12000 || (requestMode==='chat' && inputText.length>4000)){status(requestMode==='chat'?'单次问答不能超过4000字符':'文本不能超过12000字符');return;}
  if(requestMode==='dictation'){
    const taskId=options.historyId||historyTextId||historyTaskId||newHistoryTask(requestMode);
    historyPatch({id:taskId,mode:requestMode,status:'completed',revisedText:inputText,aiResult:'',error:'',attempt:{stage:'dictation',status:'completed',result:inputText,elapsedMs:0}});
    previousOutput=output;output=inputText;renderAnswer(output);$('copy').disabled=false;
    if($('restoreResult'))$('restoreResult').disabled=!previousOutput;
    window.dispatchEvent?.(new CustomEvent('text-result',{detail:{mode:requestMode,input:inputText,output,simulated:false,localPassThrough:true}}));
    status('听写完成 · 已保留原始转写，不调用文字模型');
    if(options.automatic){if(window.__TAURI__?.core){try{const submitted=await window.__TAURI__.core.invoke('output_send_current',{text:output});status(submitted?.status==='submitted'?'Windows已接受听写文字，请检查目标位置':'输入返回状态异常；听写文字已保留，不会自动重试');}catch(error){status(`光标输出失败：${String(error)}；听写文字已保留，可复制，不会自动重试`);}}else status('听写完成 · 浏览器不能写入外部光标，请复制文字');}
    return;
  }
  if (!service) return;
  if (!service.simulated && service.local!==true && !$('cloudConsent').checked) {status('尚未开始处理：请先勾选上方“同意将本次文本发送至云端”，再点击 AI 智能整理。');$('cloudConsent').focus?.();$('consentLabel').scrollIntoView?.({block:'nearest'}); return;}
  if(controller) return;
  const active=new AbortController();controller=active;
  const question=inputText,requestLanguage=options.language??$('language').value,generation=chatGeneration;
  const wantsSearch=requestMode==='chat'&&$('webSearchToggle').checked;
  if(requestMode==='chat'&&isWeatherQuestion(question)&&!wantsSearch){status($('webSearchToggle').disabled?'当前服务没有可用的天气查询工具，未提交普通模型回答':'联网天气查询已关闭；请开启“联网搜索”后重试，避免普通模型猜测实时天气');$('webSearchToggle').focus?.();return;}
  $('process').disabled = true; $('cancel').disabled = false;
  const taskId=options.historyId||historyTextId||historyTaskId||newHistoryTask(requestMode);historyPatch({id:taskId,mode:requestMode,status:'processing',revisedText:question,targetLanguage:requestLanguage,webSearchAllowed:wantsSearch});
  let modelContext={provider:service.provider,model:service.model},modelErrorCode;const processingStarted=Date.now();window.dispatchEvent?.(new CustomEvent('processing-state',{detail:{busy:true}}));
  status(service.simulated ? '正在处理 · 模拟模式' : service.local ? '正在处理 · 本机 Ollama' : '正在处理 · 云端文本模式');
  let searchEvidence;
  try {
    const graphWeather=wantsSearch&&requestMode==='chat'&&service.agentEngine==='langgraph'&&isWeatherQuestion(question);
    let data;
    if(graphWeather)data=await requestAgentGraph({mode:requestMode,text:question,tone:$('tone')?.value||'business',history:conversation.history,targetLanguage:requestLanguage,cloudConsent:$('cloudConsent').checked,webSearch:true},active);
    else{const search=wantsSearch?await requestWebSearch(question,active):undefined;searchEvidence=search;const response=await fetch('/api/process',{method:'POST',headers:{'Content-Type':'application/json','X-TalkCraft-History-Metadata':'true'},body:JSON.stringify({mode:requestMode,text:question,tone:$('tone')?.value||'business',history:requestMode==='chat'?conversation.history:[],targetLanguage:requestLanguage,cloudConsent:$('cloudConsent').checked,...(search?{webSearch:true,searchId:search.searchId}:{})}),signal:active.signal});data=await response.json();active.signal.throwIfAborted();if(!response.ok)throw new Error(data.error);}
    searchEvidence=data.search||searchEvidence;modelContext=data.historyContext||modelContext;modelErrorCode=data.errorCode;
    if(typeof data.text!=='string' || !data.text.trim() || typeof data.simulated!=='boolean') throw new Error('文字处理结果无效');
    if(requestMode==='chat' && generation!==chatGeneration) return;
    if(data.search){data.search.totalElapsedMs=Date.now()-processingStarted;executionState.finished=true;renderSearchEvidence(data.search);}
    historyPatch({id:taskId,mode:requestMode,status:'completed',aiResult:data.text,simulated:data.simulated,error:'',attempt:{stage:'ai',status:'completed',result:data.text,elapsedMs:Date.now()-processingStarted,modelElapsedMs:data.modelElapsedMs,provider:modelContext.provider,model:modelContext.model,responseModel:data.responseModel,endpoint:modelContext.endpoint,transport:modelContext.transport,errorCode:modelErrorCode,usage:data.usage,search:data.search}});
    previousOutput=output;output = data.text; renderAnswer(output,data.search); $('copy').disabled = false;
    if($('restoreResult')) $('restoreResult').disabled=!previousOutput;
    window.dispatchEvent?.(new CustomEvent('text-result',{detail:{mode:requestMode,input:question,output,simulated:data.simulated,targetLanguage:requestLanguage}}));
    let retained=true;
    if(requestMode==='chat') {retained=conversation.addTurn(question,output);updateConversation();}
    status(`${data.simulated ? '处理完成 · 模拟结果，未调用 AI' : '处理完成'}${data.citationWarning?`；${data.citationWarning}`:''}${retained ? '' : '；回答过长，已清空上下文'}`);
    if(options.automatic){
      if(window.__TAURI__?.core){
        try{
          const submitted=await window.__TAURI__.core.invoke('output_send_current',{text:output});
          status(submitted?.status==='submitted'?'Windows已接受光标输入，请检查目标文字':'输入返回状态异常；结果已保留，不会自动重试');
        }catch(error){status(`光标输出失败：${String(error)}；结果已保留，可复制，不会自动重试`);}
      }else status('处理完成 · 浏览器不能写入外部光标，请复制结果');
    }
  } catch (error) {if(wantsSearch){if(error.name==='AbortError'){addExecutionEvent({eventId:`${executionState.taskId||taskId}:client-cancel`,taskId:executionState.taskId||taskId,sequence:999,stage:'task',status:'cancelled'});executionState.finished=true;renderExecution();}else if(!searchEvidence)renderSearchEvidence({state:'failed',error:error.message,sources:[]});}const savedSearch=wantsSearch?(searchEvidence||executionSnapshot()):undefined;historyPatch({id:taskId,mode:requestMode,status:error.name==='AbortError'?'cancelled':'ai-failed',error:error.message,attempt:{stage:'ai',status:'failed',error:error.message,elapsedMs:Date.now()-processingStarted,provider:modelContext.provider,model:modelContext.model,errorCode:modelErrorCode,...(savedSearch?{search:savedSearch}:{})}});status(error.name === 'AbortError' ? '已取消处理' : wantsSearch?(searchEvidence?`联网搜索已完成，但回答失败：${error.message}；搜索证据仍保留`:`联网搜索失败：${error.message}；未把模型知识标记为实时结果，可关闭联网搜索后重试`):`处理失败：${error.message}`);}
  finally {$('process').disabled = false; $('cancel').disabled = true; if(controller===active)controller = undefined;window.dispatchEvent?.(new CustomEvent('processing-state',{detail:{busy:false,elapsedMs:Date.now()-processingStarted}}));}
}
$('process').addEventListener('click',processCurrentText);
$('clearChat').addEventListener('click',() => {
  chatGeneration++;conversation.clear();controller?.abort();updateConversation();
  if(mode==='chat') {output='';previousOutput='';$('result').textContent='会话已清空';$('copy').disabled=true;if($('restoreResult'))$('restoreResult').disabled=true;window.dispatchEvent?.(new CustomEvent('result-restored',{detail:{output}}));}
  status('问答上下文已清空');
});
$('cancel').addEventListener('click', () => controller?.abort());
$('copy').addEventListener('click', async () => {try {await navigator.clipboard.writeText(output); status('已复制结果');} catch {status('复制失败，请选中结果手动复制');}});
const recording = createRecordingSession({
  getUserMedia: navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices),
  Recorder: window.MediaRecorder,
  onStream(stream){window.dispatchEvent?.(new CustomEvent('capture-stream',{detail:{stream}}));},
  onState(state) {
    microphonePicker.setLocked(['acquiring','recording','stopping','disposed'].includes(state));
    window.dispatchEvent?.(new CustomEvent('capture-state',{detail:{state}}));
    $('record').disabled = ['acquiring','stopping','disposed'].includes(state) || !!asrController;
    $('record').textContent = state === 'recording' ? '停止录音' : state === 'stopping' ? '正在结束录音…' : state === 'acquiring' ? '等待麦克风权限…' : '开始录音';
    $('discard').disabled = ['acquiring','recording','stopping','disposed'].includes(state) || !recordingUrl;
    $('prepareAudio').disabled = ['acquiring','recording','stopping','disposed'].includes(state) || !recordingBlob || !!audioController || !!asrController;
    syncAsrButtons(state);
    if(state==='recording'){captureStarted=Date.now();historyPatch({status:'recording'});}
    if (state === 'recording') status('正在本地录音 · 尚未提交识别，最多 2 分钟');
  },
  onComplete(blob) {
    if(discardCapture){historyPatch({status:'cancelled'});discardCapture=false;status('已放弃本次录音，原有内容保留');return;}
    const taskId=historyTaskId||newHistoryTask();window.__talkcraftHistory?.audio(blob,taskId);historyPatch({id:taskId,status:'recorded',duration:captureStarted?(Date.now()-captureStarted)/1000:undefined});
    clearPreparedAudio();recordingBlob=blob;
    $('playback').pause();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = URL.createObjectURL(blob);
    $('playback').src = recordingUrl; $('playback').hidden = false; $('discard').disabled = false;
    $('prepareAudio').disabled=false;
    $('audioDrawer').open=true;
    status(service?.audioTranscription ? '录音已停止，请在下方准备音频并提交转写' : '录音已停止；语音识别未启用，当前只能回放或下载');
    if(agreementUi&&agreementAccepted&&service?.audioTranscription){
      const origin=recordingOrigin,selectedMode=mode,language=$('language').value;
      automaticBusy=true;$('record').disabled=true;$('process').disabled=true;
      (async()=>{
        try{
          const text=await prepareAndTranscribe();
          if(!text)return;
          const existing=$('transcript').value;
          const combined=existing.length?`${existing}\n${text}`:text;
          if(combined.length<=12000){$('transcript').value=combined;$('transcript').dispatchEvent?.(new Event('input'));$('asrPreviewPanel').hidden=true;}
          else status('转写已完成，现有文字较长，新增文字保留在转写预览中');
          if(origin==='external')await processCurrentText({text,mode:selectedMode,language,automatic:true});
          else if(combined.length<=12000)status('转写完成 · 可编辑文字，再点击 AI 智能整理');
        }catch(error){status(`自动处理失败：${error.message}；音频和文字已保留`);}
        finally{automaticBusy=false;$('record').disabled=automaticBusy||recording.state==='disposed';$('process').disabled=!service||checkingService;}
      })();
    }
  },
  onError(error) {historyPatch({status:'asr-failed',error:error.message});discardCapture=false;status(`无法录音：${error.message}`);}
});
microphonePicker.refresh();
async function startSelectedRecording(origin='workbench'){ if(automaticBusy||!requireAgreement())return false;
  const options=microphonePicker.getStartOptions();if(options.error){status(options.error);return false;}
  recordingOrigin=origin;historyTextId=undefined;newHistoryTask();return recording.start(options);
}
function clearPreparedAudio() {
  audioController?.abort();
  asrController?.abort();preparedAudio=undefined;clearAsrPreview();syncAsrButtons();
  if (preparedUrl) URL.revokeObjectURL(preparedUrl);preparedUrl=undefined;
  $('downloadAudio').hidden=true;$('downloadAudio').removeAttribute('href');
  $('audioInfo').textContent='音频仅在本地转换，尚未接入自动转写。';
}
async function prepareAndTranscribe() {
  if(!requireAgreement())return;syncAgreement();let converted=false;
  if (!recordingBlob || audioController || asrController) return;
  clearAsrPreview();
  const active=new AbortController();audioController=active;
  $('prepareAudio').disabled=true;$('record').disabled=true;syncAsrButtons();status('正在本地转换音频，不上传');
  try {
    const audio=await decodeRecording(recordingBlob,{signal:active.signal});active.signal.throwIfAborted();preparedAudio=audio;converted=true;historyPatch({duration:audio.duration});
    if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    preparedUrl=URL.createObjectURL(new Blob([audio.wav],{type:'audio/wav'}));
    $('downloadAudio').href=preparedUrl;$('downloadAudio').hidden=false;
    $('audioInfo').textContent=`识别音频已准备：${audio.sampleRate} Hz · 单声道 · ${audio.bitDepth} bit · ${audio.duration.toFixed(2)} 秒`;
    status(service?.audioTranscription ? '音频已准备，请点击转写音频；云端识别需确认上传' : '音频已准备，可下载；尚未配置语音识别，无法转写');
  } catch(error) {historyPatch({status:error.name==='AbortError'?'cancelled':'conversion-failed',error:error.message,attempt:{stage:'conversion',status:'failed',error:error.message}});status(error.name==='AbortError' ? '已取消音频转换' : `音频转换失败：${error.message}`);}
  finally {
    if (audioController===active) audioController=undefined;
    $('record').disabled=automaticBusy||recording.state==='disposed';$('prepareAudio').disabled=!recordingBlob || recording.state==='disposed';
    syncAsrButtons();
  }
  if(converted&&agreementUi&&agreementAccepted&&preparedAudio&&service?.audioTranscription)return await transcribeAudio();
}
$('prepareAudio').addEventListener('click',prepareAndTranscribe);
function syncAsrButtons(state=recording.state) {
  const busy=['acquiring','recording','stopping','disposed'].includes(state);
  $('transcribeAudio').disabled=!service?.audioTranscription || !preparedAudio || !!audioController || !!asrController || busy;
  $('transcribeAudio').textContent=!service ? '检查识别配置中…' : !service.audioTranscription ? '转写未启用' : service.asrSimulated ? '模拟转写（不识别音频）' : '转写音频';
  $('transcribeAudio').title=!service?.audioTranscription ? '请先配置语音识别服务' : !preparedAudio ? '请先准备识别音频' : '';
  $('importWav').disabled=busy || !!audioController || !!asrController;
  $('cancelAsr').disabled=!asrController&&!audioController;
}
$('importWav').addEventListener('change',async()=>{
  const file=$('importWav').files?.[0];if(!file || $('importWav').disabled)return;
  const active=new AbortController();audioController=active;syncAsrButtons();$('record').disabled=true;
  try {
    newHistoryTask();
    if(file.size>3905536)throw new Error('WAV文件过大');
    const bytes=await file.arrayBuffer();active.signal.throwIfAborted();const audio=importPcmWav(bytes);
    clearAsrPreview();preparedAudio=audio;
    recordingBlob=new Blob([audio.wav],{type:'audio/wav'});window.__talkcraftHistory?.audio(recordingBlob);historyPatch({duration:audio.duration,status:'recorded'});
    $('playback').pause();if(recordingUrl)URL.revokeObjectURL(recordingUrl);
    recordingUrl=URL.createObjectURL(recordingBlob);$('playback').src=recordingUrl;$('playback').hidden=false;$('discard').disabled=false;
    if(preparedUrl)URL.revokeObjectURL(preparedUrl);
    preparedUrl=URL.createObjectURL(new Blob([audio.wav],{type:'audio/wav'}));$('downloadAudio').href=preparedUrl;$('downloadAudio').hidden=false;
    $('audioDrawer').open=true;$('audioInfo').textContent=`已导入识别音频：16000 Hz · 单声道 · 16 bit · ${audio.duration.toFixed(2)} 秒`;
    status(service?.audioTranscription ? 'WAV已导入，尚未上传；请确认后提交转写' : 'WAV已导入；语音识别未启用，可保留或下载');
  } catch(error){historyPatch({status:error.name==='AbortError'?'cancelled':'conversion-failed',error:error.message});status(error.name==='AbortError'?'已取消WAV导入':`WAV导入失败：${error.message}`);}
  finally {if(audioController===active)audioController=undefined;$('importWav').value='';$('record').disabled=automaticBusy||recording.state==='disposed';$('prepareAudio').disabled=!recordingBlob || recording.state==='disposed';syncAsrButtons();}
});
function clearAsrPreview() {
  asrPreview=undefined;$('asrPreview').textContent='';$('asrPreviewPanel').hidden=true;$('applyAsr').disabled=true;$('applyAndProcessAsr').disabled=true;
  $('replaceTranscript').checked=false;
}
async function transcribeAudio() {
  if(!requireAgreement())return;syncAgreement();
  if ($('transcribeAudio').disabled) return;
  if (!service.asrSimulated && !$('audioConsent').checked) {status('请确认将音频发送至云端识别');return;}
  $('replaceTranscript').checked=false;const active=new AbortController();asrController=active;
  const taskId=historyTaskId||newHistoryTask();historyPatch({id:taskId,status:'transcribing'});
  let asrContext={provider:service.asrProvider,model:service.asrModel},asrErrorCode;const audio=preparedAudio,asrStarted=Date.now();syncAsrButtons();$('record').disabled=true;$('prepareAudio').disabled=true;
  status(service.asrSimulated ? '正在模拟转写，未调用真实识别' : '正在云端识别音频');
  try {
    const response=await fetch('/api/transcribe',{method:'POST',headers:{'X-TalkCraft-History-Metadata':'true','Content-Type':'application/octet-stream','X-Audio-Sample-Rate':String(audio.sampleRate),'X-Audio-Channels':String(audio.channels),'X-Audio-Bit-Depth':String(audio.bitDepth),'X-Audio-Cloud-Consent':String($('audioConsent').checked)},body:audio.pcm,signal:active.signal});
    const data=await response.json();asrContext=data.historyContext||asrContext;asrErrorCode=data.errorCode;active.signal.throwIfAborted();if(!response.ok) throw new Error(data.error || '识别请求失败');
    if(typeof data.text!=='string' || !data.text.trim() || data.text.length>12000 || typeof data.simulated!=='boolean') throw new Error('识别结果无效');
    historyPatch({id:taskId,status:'transcribed',originalTranscript:data.text,simulated:!!data.simulated,error:'',attempt:{stage:'asr',status:'completed',transcript:data.text,elapsedMs:Date.now()-asrStarted,provider:asrContext.provider,model:asrContext.model,errorCode:asrErrorCode}});
    clearAsrPreview();asrPreview=data.text;$('asrPreview').textContent=asrPreview;$('asrPreviewPanel').hidden=false;$('applyAsr').disabled=false;$('applyAndProcessAsr').disabled=false;
    const elapsed=((Date.now()-asrStarted)/1000).toFixed(1);
    status(service.asrSimulated || data.simulated ? `模拟转写完成，未识别音频；模拟请求耗时 ${elapsed} 秒，可预览并手动使用` : `识别完成，请预览后使用；本次转写等待 ${elapsed} 秒（含上传与识别，不含录音）`);
    return data.text;
  } catch(error) {historyPatch({id:taskId,status:error.name==='AbortError'?'cancelled':/有效语音|没有.*语音|空/.test(error.message)?'no-speech':'asr-failed',error:error.message,attempt:{stage:'asr',status:'failed',error:error.message,elapsedMs:Date.now()-asrStarted,provider:asrContext.provider,model:asrContext.model,errorCode:asrErrorCode}});status(error.name==='AbortError' ? '已取消转写' : `转写失败：${error.message}`);}
  finally {
    if(asrController===active) asrController=undefined;
    $('record').disabled=automaticBusy||recording.state==='disposed';$('prepareAudio').disabled=!recordingBlob || recording.state==='disposed';syncAsrButtons();
  }
}
window.__talkcraftRetry=async(r,kind)=>{
 if(automaticBusy||controller||audioController||asrController||['acquiring','recording','stopping'].includes(recording.state))throw Error('当前任务未结束，请稍后重试');
 if(!requireAgreement()||!service)throw Error('请先同意协议并检查服务配置');syncAgreement();
 const aiLike=kind==='ai'||kind==='requery';
 if(aiLike&&!service.simulated&&!service.local&&!$('cloudConsent').checked)throw Error('尚未授权云端文字处理');
 if(kind==='requery'&&(r.mode!=='chat'||!(service.webSearchAvailable||service.weatherAvailable)))throw Error('当前服务没有可用的联网查询工具');
 if(kind==='asr'&&(!service.audioTranscription||!service.asrSimulated&&!$('audioConsent').checked))throw Error('识别未启用或尚未授权音频上传');
 const active=new AbortController(),started=Date.now();let context={},errorCode,retrySearch;
 automaticBusy=true;$('record').disabled=true;
 if(aiLike){controller=active;$('process').disabled=true;$('cancel').disabled=false;}else{asrController=active;syncAsrButtons();}
 historyPatch({id:r.id,mode:r.mode,status:aiLike?'processing':'transcribing'});
 try{
  let response;
  if(aiLike){
   const retryText=r.revisedText||r.originalTranscript,wantsSearch=kind==='requery'||r.mode==='chat'&&r.webSearchAllowed&&(service.webSearchAvailable||service.weatherAvailable);retrySearch=wantsSearch?await requestWebSearch(retryText,active):undefined;
   response=await fetch('/api/process',{method:'POST',headers:{'Content-Type':'application/json','X-TalkCraft-History-Metadata':'true'},body:JSON.stringify({mode:r.mode,text:retryText,targetLanguage:r.targetLanguage||'en',tone:$('tone')?.value||'business',history:[],cloudConsent:$('cloudConsent').checked,...(retrySearch?{webSearch:true,searchId:retrySearch.searchId}:{})}),signal:active.signal});
  }
  else{const source=await fetch('/api/history/audio?id='+encodeURIComponent(r.id),{signal:active.signal});if(!source.ok)throw Error((await source.json()).error);const audio=await decodeRecording(await source.blob(),{signal:active.signal});response=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-TalkCraft-History-Metadata':'true','X-Audio-Sample-Rate':'16000','X-Audio-Channels':'1','X-Audio-Bit-Depth':'16','X-Audio-Cloud-Consent':String($('audioConsent').checked)},body:audio.pcm,signal:active.signal});}
  const data=await response.json();context=data.historyContext||{};errorCode=data.errorCode;active.signal.throwIfAborted();if(!response.ok||typeof data.text!=='string'||!data.text.trim())throw Error(data.error||'重试没有返回有效文字');
  if(data.search){data.search.totalElapsedMs=Date.now()-started;renderSearchEvidence(data.search);}
  historyPatch({id:r.id,mode:r.mode,status:aiLike?'completed':'transcribed',...(aiLike?{aiResult:data.text}:{originalTranscript:data.text}),error:'',simulated:!!data.simulated,attempt:{stage:kind,status:'completed',...(aiLike?{result:data.text,usage:data.usage,search:data.search}:{transcript:data.text}),elapsedMs:Date.now()-started,provider:context.provider,model:context.model}});status(kind==='requery'?'重新查询完成；新过程已保存，工作台草稿和录音保持原状':'历史重试完成，工作台草稿和录音保持原状');
 }catch(error){const savedSearch=aiLike&&(retrySearch||kind==='requery')?(retrySearch||executionSnapshot()):undefined;historyPatch({id:r.id,mode:r.mode,status:error.name==='AbortError'?'cancelled':aiLike?'ai-failed':'asr-failed',error:error.message,attempt:{stage:kind,status:'failed',elapsedMs:Date.now()-started,error:error.message,errorCode,provider:context.provider,model:context.model,...(savedSearch?{search:savedSearch}:{})}});throw error;}
 finally{if(aiLike){controller=undefined;$('process').disabled=!service;$('cancel').disabled=true;}else asrController=undefined;automaticBusy=false;$('record').disabled=recording.state==='disposed';syncAsrButtons();await window.__talkcraftHistory?.saved();}
};
$('transcribeAudio').addEventListener('click',transcribeAudio);
$('cancelAsr').addEventListener('click',() => {audioController?.abort();asrController?.abort();});
$('transcript').addEventListener('input',() => {$('replaceTranscript').checked=false;});
function applyAsrPreview() {
  if(!asrPreview || controller || asrController) return false;
  if($('transcript').value.trim() && !$('replaceTranscript').checked) {status('转写框已有内容，请勾选确认替换，或先清空文本');return false;}
  $('transcript').value=asrPreview;$('transcript').dispatchEvent?.(new Event('input'));$('replaceTranscript').checked=false;status('已使用转写预览，尚未提交文字处理');return true;
}
$('applyAsr').addEventListener('click',applyAsrPreview);
$('applyAndProcessAsr').addEventListener('click',async()=>{
  if(!service || controller || asrController || !asrPreview) return;
  if(!service.simulated && service.local!==true && !$('cloudConsent').checked){status('请先确认将文本发送至云端；转写预览已保留');return;}
  if(applyAsrPreview()) await processCurrentText();
});
$('record').addEventListener('click', async () => {
  if (automaticBusy || audioController || asrController || controller) return;
  if (recording.state === 'recording') recording.stop(); else await startSelectedRecording();
});
window.addEventListener('hud-record',async()=>{
  if(automaticBusy||audioController||asrController||controller){interruptCurrentTask();return;}
  if(recording.state==='recording')recording.stop();else await startSelectedRecording('external');
});
window.addEventListener('hud-discard',()=>{
  interruptCurrentTask();
});
$('discard').addEventListener('click', () => {
  clearPreparedAudio();recordingBlob=undefined;$('prepareAudio').disabled=true;
  $('playback').pause(); $('playback').removeAttribute('src'); $('playback').load(); $('playback').hidden = true;
  if (recordingUrl) URL.revokeObjectURL(recordingUrl); recordingUrl = undefined;
  $('discard').disabled = true; status('已丢弃录音');
});
window.addEventListener('beforeunload', () => {microphonePicker.dispose();recording.dispose(); controller?.abort();clearPreparedAudio();recordingBlob=undefined;if (recordingUrl) URL.revokeObjectURL(recordingUrl);});
$('restoreResult')?.addEventListener('click',()=>{if(!previousOutput || controller)return;[output,previousOutput]=[previousOutput,output];$('result').textContent=output;status('已恢复上一版结果');window.dispatchEvent?.(new CustomEvent('result-restored',{detail:{output}}));});
function interruptCurrentTask(){
 const captureCancelled=recording.cancel();
 if(captureCancelled){historyPatch({status:'cancelled',error:''});discardCapture=false;status('已放弃本次录音，未提交转写');return true;}
 const busy=!!(controller||audioController||asrController||automaticBusy);
 controller?.abort();audioController?.abort();asrController?.abort();
 if(busy){historyPatch({status:'cancelled'});status('正在取消本次转写或处理，原有文字和录音保留');return true;}
 return false;
}
window.addEventListener('talkcraft-shortcut',async event=>{
 if(document.hasFocus?.()&&document.activeElement?.closest?.('#shortcutSettings'))return;
 const action=event.detail?.action;
 if(['dictation','chat','translate','prompt'].includes(action)){
  if(automaticBusy||controller||audioController||asrController){interruptCurrentTask();return;}
  if(recording.state==='recording'){status(`正在结束${({dictation:'听写',chat:'问答',translate:'翻译',prompt:'提示词预设'})[mode]||'当前模式'}录音`);recording.stop();return;}
  if(['acquiring','stopping'].includes(recording.state)){interruptCurrentTask();return;}
  if(recording.state==='disposed')return;
  document.querySelectorAll('[data-mode]').forEach(button=>{if(button.dataset.mode===action)button.click();});
  await startSelectedRecording('external');
 }else if(action==='process'){
  if(['acquiring','recording','stopping'].includes(recording.state)){status('请先结束录音并完成转写，再处理文字');return;}
  if(!$('process').disabled)$('process').click();
 }
});
let held=false,hotkeyRecording=false;
window.addEventListener('keydown',async event=>{
  if(event.code!=='F8' || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.repeat)return;
  if(automaticBusy||controller||audioController||asrController){event.preventDefault();interruptCurrentTask();return;}
  event.preventDefault();if(recording.state==='recording' || held)return;
  held=true;hotkeyRecording=true;await startSelectedRecording();if(!held && recording.state==='recording') recording.stop();
});
function releaseHotkey(){held=false;if(hotkeyRecording && recording.state==='recording')recording.stop();hotkeyRecording=false;}
window.addEventListener('keyup',event=>{if(event.code==='F8'){event.preventDefault();releaseHotkey();}});
window.addEventListener('blur',releaseHotkey);

}
