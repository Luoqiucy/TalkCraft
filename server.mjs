import http from 'node:http';
import {rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {processText,streamTextPreview} from './src/pipeline.mjs';
import {ProviderError} from './src/providers/ark.mjs';
import {loadProvider, providerStatus, requiresTextCloudConsent} from './src/config.mjs';
import {loadAsr,transcribeAudio} from './src/asr.mjs';
import {createWorkspaceStore} from './src/workspace.mjs';
import {createTelemetryStore} from './src/telemetry.mjs';
import {createTextSettings} from './src/text-settings.mjs';
import {createUserPreferencesStore} from './src/user-preferences.mjs';
import {createHistoryStore} from './src/local-history.mjs';
import {createHistoryHandler} from './src/history-http.mjs';
import {createPersonalMemoryStore,createPersonalMemoryHandler} from './src/personal-memory.mjs';
import {createLocalUsageStore} from './src/local-usage.mjs';
import {createDesktopCommercialBridge,createDesktopCommercialHandler} from './src/commercial/desktop-bridge.mjs';
import {answerQuestionGraph,orchestrateQuestion,resolveAgentEngine} from './src/agent/router.mjs';
import {answerDaisyQuestion} from './src/agent/daisy-question.mjs';
import {resolveQuestionContext,validateContextEvidence,validateLocationCoordinates} from './src/agent/question-context.mjs';
import {assessSearchEntity} from './src/agent/query-safety.mjs';
import {validateHistory} from './public/conversation.mjs';
import {createOpenMeteoWeatherTool} from './src/tools/weather.mjs';
import {createWebpageTool} from './src/tools/webpage.mjs';
const citedSourceIds=(answer,sources)=>{const ids=[];for(const match of String(answer||'').matchAll(/\[(\d{1,2})\]/g)){const source=sources?.[Number(match[1])-1];if(source?.sourceId&&!ids.includes(source.sourceId))ids.push(source.sourceId);}return ids;};
const assets = {'/': ['index.html', 'text/html; charset=utf-8'], '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'], '/recording.mjs': ['recording.mjs', 'text/javascript; charset=utf-8'], '/audio.mjs': ['audio.mjs', 'text/javascript; charset=utf-8'], '/conversation.mjs': ['conversation.mjs', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8']};
export function createServer({history,shutdownToken,onDesktopExit,provider = loadProvider(),asr = loadAsr(),weatherTool=createOpenMeteoWeatherTool(),webpageTool=createWebpageTool(),agentEngine=resolveAgentEngine(),searchLimits={maxFollowups:2,maxToolCalls:6,totalTimeoutMs:45000,maxResults:8},telemetry=createTelemetryStore(),usageStore=createLocalUsageStore(),commercialBridge=createDesktopCommercialBridge(),textSettings=createTextSettings(fileURLToPath(new URL('./.local/asr-test.env',import.meta.url))),workspace=createWorkspaceStore(fileURLToPath(new URL('./.local/workspace.json',import.meta.url))),userPreferencesStore} = {}) {
  const historyStore=history||createHistoryStore(undefined,{legacy:workspace});const userPreferences=userPreferencesStore||createUserPreferencesStore(join(historyStore.directory||join(tmpdir(),`talkcraft-settings-${randomUUID()}`),'user-preferences.json'));const ephemeralMemoryDir=historyStore.directory?null:join(tmpdir(),`talkcraft-memory-${randomUUID()}`);const personalMemoryStore=createPersonalMemoryStore(join(historyStore.directory||ephemeralMemoryDir,'personal-memory.sqlite'));
  const currentMemoryOwner=async()=>{if(typeof commercialBridge?.identity!=='function')return {ownerId:personalMemoryStore.guestOwner,kind:'guest'};const current=await commercialBridge.identity();if(!current)return null;if(current.kind==='guest')return {ownerId:personalMemoryStore.guestOwner,kind:'guest'};return current.ownerId?current:null;};
  const personalMemoryHandler=createPersonalMemoryHandler(personalMemoryStore,currentMemoryOwner,{syncRemote:commercialBridge?.syncMemories?.bind(commercialBridge)});
  const historyHandler=createHistoryHandler(historyStore,{onDelete:async recordId=>{const who=await currentMemoryOwner();return who?.ownerId?personalMemoryStore.removeBySource(who.ownerId,recordId):0;},onClear:async recordIds=>{const who=await currentMemoryOwner();if(!who?.ownerId)return 0;let removed=0;for(const recordId of recordIds)removed+=personalMemoryStore.removeBySource(who.ownerId,recordId);return removed;}});
  const commercialHandler=createDesktopCommercialHandler(commercialBridge);
  assets['/history-ui.mjs']=['history-ui.mjs','text/javascript; charset=utf-8'];
  assets['/shell.mjs']=['shell.mjs','text/javascript; charset=utf-8'];
  assets['/translation.mjs']=['translation.mjs','text/javascript; charset=utf-8'];
  for(const name of ['live-ui.mjs','live-state.mjs','model-settings.mjs'])assets['/'+name]=[name,'text/javascript; charset=utf-8'];
  assets['/figma.css']=['figma.css','text/css; charset=utf-8'];
  assets['/living-fluid.mjs']=['living-fluid.mjs','text/javascript; charset=utf-8'];
  assets['/living-fluid.css']=['living-fluid.css','text/css; charset=utf-8'];
  for(const name of ['record-start','record-end'])assets[`/assets/sounds/${name}.wav`]=[`assets/sounds/${name}.wav`,'audio/wav'];
  assets['/assets/source-page.svg']=['assets/source-page.svg','image/svg+xml'];
  const historyCleanup=setInterval(()=>historyStore.cleanup().catch(()=>{}),60000);historyCleanup.unref();
  const searchCache=new Map();
  const clearExpiredSearches=()=>{const cutoff=Date.now()-300000;for(const [id,item] of searchCache)if(item.at<cutoff)searchCache.delete(id);};
  const searchCleanup=setInterval(clearExpiredSearches,60000);searchCleanup.unref();
  const server=http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const controller = new AbortController();let historyContext;
    res.on('close', () => {if (!res.writableEnded) controller.abort();});
    try {
      if (!/^((127\.0\.0\.1)|(localhost))(:\d+)?$/.test(req.headers.host || '')) {res.writeHead(403); res.end(); return;}
      if(await commercialHandler(req,res))return;
      if(await personalMemoryHandler(req,res))return;
      if(await historyHandler(req,res))return;
      if(req.url==='/api/desktop-exit' && req.method==='POST'){
        if(!shutdownToken || req.headers.origin || req.headers['x-talkcraft-control']!==shutdownToken){res.writeHead(403);res.end();return;}
        res.writeHead(200);res.end('Closing');setImmediate(()=>onDesktopExit?.());return;
      }
      if(req.url==='/api/text-settings' && req.method==='GET'){
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(await textSettings.read()));return;
      }
      if(req.url==='/api/user-preferences'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(await userPreferences.read()));return;
      }
      if(req.url==='/api/user-preferences'&&req.method==='POST'){
        if(req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403);res.end();return;}
        if(req.headers['content-type']!=='application/json')throw new Error('请发送JSON设置');
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('设置格式无效');}
        const value=await userPreferences.update(input);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));return;
      }
      if(req.url==='/api/text-settings' && req.method==='POST'){
        if(req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403);res.end();return;}
        if(req.headers['content-type']!=='application/json')throw new Error('请发送JSON配置');
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('配置格式错误');}
        const result=await textSettings.update(input);provider=result.provider;searchCache.clear();
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result.state));return;
      }
      if(req.method==='GET' && req.url==='/api/telemetry'){
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({...telemetry.read(),service:{...providerStatus(provider,asr),weatherAvailable:weatherTool?.enabled===true,webpageReadAvailable:webpageTool?.enabled===true,agentEngine}}));return;
      }
      if(req.method==='GET' && req.url==='/api/local-usage'){
        const snapshot=await usageStore.read();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(snapshot));return;
      }
      if(req.method==='POST' && req.url==='/api/local-usage/clear'){
        if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403);res.end();return;}
        const result=await usageStore.clear();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));return;
      }
      if (req.method === 'GET' && req.url === '/api/status') {
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({...providerStatus(provider,asr),weatherAvailable:weatherTool?.enabled===true,webpageReadAvailable:webpageTool?.enabled===true,agentEngine,desktopService:!!shutdownToken})); return;
      }
      if(req.method==='GET' && req.url==='/api/workspace') {
        const state=await workspace.read();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));return;
      }
      if(req.method==='POST' && req.url==='/api/workspace') {
        if(req.headers.origin!==`http://${req.headers.host}`) {res.writeHead(403);res.end();return;}
        if(req.headers['content-type']!=='application/json') throw new Error('请发送JSON配置');
        const chunks=[];let size=0;for await(const chunk of req) {size+=chunk.length;if(size>8000000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('配置格式错误');}
        const state=await workspace.update(input);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));return;
      }
      if(req.method==='POST' && req.url==='/api/transcribe') {
        if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) {res.writeHead(403);res.end();return;}
        if(!asr.enabled) {res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'语音识别未启用，请显式配置提供器'}));return;}
        if(req.headers['content-type']!=='application/octet-stream') throw new Error('请发送原始PCM二进制音频');
        if(!asr.simulated && req.headers['x-audio-cloud-consent']!=='true') throw new Error('请确认将音频发送到云端识别');
        const format={sampleRate:Number(req.headers['x-audio-sample-rate']),channels:Number(req.headers['x-audio-channels']),bitDepth:Number(req.headers['x-audio-bit-depth'])};
        if(format.sampleRate!==16000 || format.channels!==1 || format.bitDepth!==16) throw new Error('识别输入必须是16kHz单声道16bit PCM');
        const chunks=[];let size=0;
        for await(const chunk of req) {
          size+=chunk.length;if(size>3840000) {res.writeHead(413);res.end();return;}chunks.push(chunk);
        }
        historyContext={provider:asr.id||'未记录',model:asr.model||'未记录'};const result=await transcribeAudio(Buffer.concat(chunks),format,asr,controller.signal);
        if(!controller.signal.aborted&&!result.simulated)await usageStore.record({taskId:req.headers['x-talkcraft-task-id'],kind:'transcription',text:result.text,speechSeconds:size/32000}).catch(()=>{});
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(req.headers['x-talkcraft-history-metadata']==='true'?{...result,historyContext}:result));return;
      }
      if(req.method==='POST'&&req.url==='/api/search'){
        const expectedOrigin=`http://${req.headers.host}`;
        if(req.headers.origin&&req.headers.origin!==expectedOrigin){res.writeHead(403);res.end();return;}
        if(req.headers['content-type']!=='application/json')throw new Error('请发送JSON请求');
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('请求格式错误');}
        if(input?.mode!=='chat'||typeof input?.query!=='string'||!input.query.trim()||input.query.length>4000)throw new Error('联网搜索仅支持不超过4000字符的问答');
        const taskProvider=provider;
        if(requiresTextCloudConsent(taskProvider)&&input.cloudConsent!==true){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'请确认将问题发送到云端搜索'}));return;}
        const originalQuestion=input.query.trim(),contextual=resolveQuestionContext(originalQuestion,validateHistory(input.history),{contextEvidence:validateContextEvidence(input.contextEvidence)}),entityCheck=assessSearchEntity({intent:contextual.intent,location:contextual.location||contextual.query.match(/^([^天气]+?)(?:天气|气温|温度)/)?.[1]});
        if(!entityCheck.safe){
          const taskId=randomUUID(),payload={searchId:randomUUID(),taskId,query:contextual.query,originalQuestion,performed:false,requested:true,status:'needs-confirmation',sources:[],elapsedMs:0,attempts:0,toolCalls:0,toolTrace:[],progress:[],needsClarification:entityCheck.reason,quality:{intent:contextual.intent,sufficient:false,reason:entityCheck.reason},engine:agentEngine,frameworks:{langchain:false,langgraph:false}};
          if(req.headers.accept==='application/x-ndjson'){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});res.end(JSON.stringify({type:'result',data:{text:entityCheck.reason,search:payload}})+'\n');}else{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({text:entityCheck.reason,search:payload}));}return;
        }
        const query=contextual.query,taskId=randomUUID(),progress=[],stream=req.headers.accept==='application/x-ndjson';
        if(stream)res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'});
        const seenEvents=new Set(),onStatus=event=>{const normalized={...event,eventId:event.eventId||`${taskId}:${event.sequence??progress.length+1}`};if(seenEvents.has(normalized.eventId))return;seenEvents.add(normalized.eventId);progress.push(normalized);if(stream&&!res.destroyed)res.write(JSON.stringify({type:'progress',event:normalized})+'\n');};
        let result;try{result=await orchestrateQuestion(taskProvider,query,{agentEngine,signal:controller.signal,weatherTool,webpageTool,taskId,onStatus,...searchLimits});}catch(error){if(stream&&!res.destroyed){res.end(JSON.stringify({type:'error',error:error.message,status:error.status||400,taskId})+'\n');return;}throw error;}
        clearExpiredSearches();while(searchCache.size>=32)searchCache.delete(searchCache.keys().next().value);
        const searchId=randomUUID();searchCache.set(searchId,{at:Date.now(),provider:taskProvider,query:originalQuestion,resolvedQuery:query,result,progress});
        const {performed,requested,status,sources,elapsedMs,usage,synthesis,attempts,quality,tool,needsClarification,capabilities,weather,currentDate,timezone,diagnostics,toolCalls,toolTrace,terminationReason,engine,frameworks,graph,migrationFallback}=result;
        const payload={searchId,taskId,query,originalQuestion,performed,requested,status,sources,elapsedMs,usage,attempts,quality,tool,needsClarification,capabilities,weather,currentDate,timezone,diagnostics,toolCalls,toolTrace,progress,terminationReason,engine,frameworks,graph,migrationFallback,synthesisAvailable:!!synthesis};
        if(stream)res.end(JSON.stringify({type:'result',data:payload})+'\n');else{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));}return;
      }
      if(req.method==='POST'&&req.url==='/api/agent'){
        const expectedOrigin=`http://${req.headers.host}`;
        if(req.headers.origin&&req.headers.origin!==expectedOrigin){res.writeHead(403);res.end();return;}
        if(req.headers['content-type']!=='application/json')throw new Error('请发送JSON请求');
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('请求格式错误');}
        if(input?.mode!=='chat'||input?.webSearch!==true||typeof input?.text!=='string'||!input.text.trim()||input.text.length>4000)throw new Error('Agent问答需要显式开启联网，且问题不超过4000字符');
        const taskProvider=provider;if(requiresTextCloudConsent(taskProvider)&&input.cloudConsent!==true){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'请确认将问题发送到云端模型'}));return;}
        const taskId=typeof input.taskId==='string'&&/^[0-9a-f-]{36}$/i.test(input.taskId)?input.taskId:randomUUID(),locationCoordinates=validateLocationCoordinates(input.locationCoordinates,{consented:input.locationConsent===true}),contextual=resolveQuestionContext(input.text,validateHistory(input.history),{contextEvidence:validateContextEvidence(input.contextEvidence),sessionId:typeof input.sessionId==='string'?input.sessionId:'',taskId,locationCoordinates,locationConsent:input.locationConsent===true}),entityCheck=contextual.intent==='personal-memory'||locationCoordinates?{safe:true}:assessSearchEntity({intent:contextual.intent,location:contextual.location||contextual.query.match(/^([^天气]+?)(?:天气|气温|温度)/)?.[1]});
        if(!entityCheck.safe){
          const search={allowed:true,taskId,query:contextual.query,originalQuestion:contextual.original,performed:false,requested:true,status:'needs-confirmation',sources:[],elapsedMs:0,totalElapsedMs:0,attempts:0,toolCalls:0,toolTrace:[],progress:[],needsClarification:entityCheck.reason,quality:{intent:contextual.intent,sufficient:false,reason:entityCheck.reason},engine:'langgraph',frameworks:{langchain:false,langgraph:false}};
          if(req.headers.accept==='application/x-ndjson'){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});res.end(JSON.stringify({type:'result',data:{text:entityCheck.reason,search}})+'\n');}else{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({text:entityCheck.reason,search}));}return;
        }
        const memoryStartedAt=performance.now(),owner=await currentMemoryOwner(),memoryQuery=contextual.intent==='personal-memory'?contextual.original:contextual.request.resolvedQuestion,remembered=owner?personalMemoryStore.relevant(owner.ownerId,memoryQuery):{memories:[],memoryIds:[],chars:0};remembered.elapsedMs=Math.max(0,Math.round(performance.now()-memoryStartedAt));
        const resolvedInput={...input,text:contextual.request.resolvedQuestion,originalText:contextual.original,request:contextual.request,personalMemories:remembered.memories};
        const progress=[],stream=req.headers.accept==='application/x-ndjson',seenEvents=new Set(),startedAt=performance.now();let firstProgressMs;
        if(stream)res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'});
        const onStatus=event=>{const normalized={...event,eventId:event.eventId||`${taskId}:${event.sequence??progress.length+1}`};if(seenEvents.has(normalized.eventId))return;if(firstProgressMs===undefined)firstProgressMs=Math.round(performance.now()-startedAt);seenEvents.add(normalized.eventId);progress.push(normalized);if(stream&&!res.destroyed)res.write(JSON.stringify({type:'progress',event:normalized})+'\n');};
        const onAnswerDelta=text=>{if(stream&&!res.destroyed&&!controller.signal.aborted)res.write(JSON.stringify({type:'answer_delta',taskId,text})+'\n');};
        const useDaisyTools=typeof taskProvider.streamWithTools==='function';
        const useWeatherGraph=!useDaisyTools&&agentEngine==='langgraph'&&contextual.intent==='weather'&&weatherTool?.enabled===true;
        let completed,deadline;
        try{
          if(useDaisyTools)completed=await answerDaisyQuestion(taskProvider,{...resolvedInput,webSearch:input.webSearch===true},{signal:controller.signal,weatherTool,webpageTool,taskId,onStatus,onDelta:onAnswerDelta,...searchLimits});
          else if(useWeatherGraph)completed=await answerQuestionGraph(taskProvider,resolvedInput,{signal:controller.signal,weatherTool,webpageTool,taskId,onStatus,...searchLimits});
          else if(contextual.intent==='personal-memory'){
            const answer=await processText({...resolvedInput,text:contextual.original,request:contextual.request},taskProvider,controller.signal);
            completed={result:{taskId,tool:'personal-memory',performed:false,requested:false,status:'memory-only',sources:[],elapsedMs:0,totalElapsedMs:Math.round(performance.now()-startedAt),attempts:0,toolCalls:0,toolTrace:[],quality:{intent:'personal-memory',sufficient:true,reason:'只读取当前会话与当前身份授权的私有记忆，没有执行公开搜索'},engine:'local-memory',frameworks:{langchain:false,langgraph:false},memory:{memoryIds:remembered.memoryIds,chars:remembered.chars,scanned:remembered.scanned||0,elapsedMs:remembered.elapsedMs}},answer};
          }
          else{
            deadline=AbortSignal.timeout(searchLimits.totalTimeoutMs||45000);const signal=AbortSignal.any([controller.signal,deadline]);
            const result=await orchestrateQuestion(taskProvider,contextual.query,{agentEngine,signal,weatherTool,webpageTool,taskId,onStatus,...searchLimits});
            if(signal.aborted)signal.throwIfAborted();
            if(result.status==='needs-input'||result.status==='needs-confirmation')completed={result,answer:{mode:'chat',text:result.needsClarification||'请补充查询信息'}};
            else{
              onStatus({taskId,sequence:Math.max(0,...progress.map(event=>Number(event.sequence)||0))+1,stage:'answering',status:'running'});
              const answer=await processText({...resolvedInput,text:contextual.original,webSearchResult:result},taskProvider,signal);
              if(signal.aborted)signal.throwIfAborted();
              onStatus({taskId,sequence:Math.max(0,...progress.map(event=>Number(event.sequence)||0))+1,stage:'answering',status:'completed',elapsedMs:answer.modelElapsedMs});
              completed={result,answer};
            }
          }
        }catch(error){const timedOut=deadline?.aborted&&!controller.signal.aborted||error.name==='TimeoutError';if(timedOut)onStatus({taskId,sequence:Math.max(0,...progress.map(event=>Number(event.sequence)||0))+1,stage:'task',status:'timeout',elapsedMs:searchLimits.totalTimeoutMs||45000});if(stream&&!res.destroyed){res.end(JSON.stringify({type:'error',error:controller.signal.aborted?'请求已取消':timedOut?'Agent执行超时':error.message,status:timedOut?504:error.status||400,taskId})+'\n');return;}throw error;}
        const {result:search,answer}=completed,usedSourceIds=citedSourceIds(answer.text,search.sources),totalElapsedMs=Math.round(performance.now()-startedAt);
        historyContext={provider:taskProvider.id||'未记录',model:taskProvider.model||'未记录',endpoint:taskProvider.endpoint||'未记录',transport:taskProvider.transport||'未记录'};
        const payload={...answer,historyContext,search:{allowed:true,taskId,query:contextual.query,originalQuestion:contextual.original,performed:search.performed,status:search.status,sources:search.sources,usedSourceIds,elapsedMs:search.elapsedMs,totalElapsedMs,firstProgressMs,usage:search.usage,attempts:search.attempts,toolCalls:search.toolCalls,toolTrace:search.toolTrace,progress,terminationReason:search.terminationReason,quality:search.quality,tool:search.tool,needsClarification:search.needsClarification,capabilities:search.capabilities,weather:search.weather,currentDate:search.currentDate,timezone:search.timezone,diagnostics:search.diagnostics,engine:search.engine,frameworks:search.frameworks,graph:search.graph,synthesisAvailable:!!search.synthesis,memory:{memoryIds:remembered.memoryIds,chars:remembered.chars,scanned:remembered.scanned||0,elapsedMs:remembered.elapsedMs,sessionFacts:contextual.request.sessionFacts}}};
        if(!controller.signal.aborted&&!answer.simulated&&search.status!=='needs-confirmation'&&search.status!=='needs-input')await usageStore.record({taskId:input.taskId,kind:'chat',text:contextual.original,answer:answer.text}).catch(()=>{});
        if(stream)res.end(JSON.stringify({type:'result',data:payload})+'\n');else{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));}return;
      }
      if (req.method === 'POST' && req.url === '/api/process-stream') {
        const expectedOrigin=`http://${req.headers.host}`;
        if(req.headers.origin&&req.headers.origin!==expectedOrigin){res.writeHead(403);res.end();return;}
        if(req.headers['content-type']!=='application/json'){res.writeHead(400);res.end(JSON.stringify({error:'请发送JSON请求'}));return;}
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('请求格式错误');}
        if(!['prompt','translate'].includes(input?.mode)||provider.id!=='deepseek'||typeof provider.streamWithTools!=='function'){
          res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'当前模式或模型不支持流式预览'}));return;
        }
        if(requiresTextCloudConsent(provider)&&input.cloudConsent!==true){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'请确认将文本发送到云端处理'}));return;}
        historyContext={provider:provider.id,model:provider.model||'未记录',endpoint:provider.endpoint||'未记录',transport:provider.transport||'未记录'};
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'});
        try{
          const result=await streamTextPreview(input,provider,controller.signal,chunk=>{if(!controller.signal.aborted&&!res.destroyed)res.write(JSON.stringify({type:'answer_delta',text:chunk})+'\n');});
          if(!controller.signal.aborted&&!res.destroyed)res.end(JSON.stringify({type:'result',data:{...result,historyContext}})+'\n');
        }catch(error){if(!res.destroyed)res.end(JSON.stringify({type:'error',error:controller.signal.aborted?'请求已取消':error instanceof ProviderError?error.message:'文字模型流式处理失败，请重试'})+'\n');}
        return;
      }
      if (req.method === 'POST' && req.url === '/api/process') {
        const expectedOrigin = `http://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== expectedOrigin) { res.writeHead(403); res.end(); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) {res.writeHead(413); res.end(); return;}
          chunks.push(chunk);
        }
        let input;
        try {input = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new Error('请求格式错误');}
        let taskProvider=provider,search;
        if(input?.webSearch===true){
          search=searchCache.get(input.searchId);searchCache.delete(input.searchId);
          if(!search||search.at<Date.now()-300000||input.mode!=='chat'||typeof input.text!=='string'||search.query!==input.text.trim()){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'联网搜索结果已失效或与当前问题不匹配，请重新搜索'}));return;}
          taskProvider=search.provider;input={...input,webSearchResult:search.result};
        }else{delete input.webSearchResult;delete input.searchId;}
        if(input.mode==='chat'&&!search){const contextual=resolveQuestionContext(input.text,validateHistory(input.history),{sessionId:typeof input.sessionId==='string'?input.sessionId:'',taskId:input.taskId});input={...input,originalText:contextual.original,request:contextual.request};}
        if (requiresTextCloudConsent(taskProvider) && input?.cloudConsent !== true) {res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'请确认将文本发送到云端处理'})); return;}
        const memoryStartedAt=performance.now(),owner=input.mode==='chat'?await currentMemoryOwner():null,memoryQuery=input.request?.intent==='personal-memory'?input.originalText||input.text:input.text,remembered=owner?personalMemoryStore.relevant(owner.ownerId,memoryQuery):{memories:[],memoryIds:[],chars:0};remembered.elapsedMs=Math.max(0,Math.round(performance.now()-memoryStartedAt));if(input.mode==='chat')input={...input,personalMemories:remembered.memories};
        historyContext={provider:taskProvider.id||'未记录',model:taskProvider.model||'未记录',endpoint:taskProvider.endpoint||'未记录',transport:taskProvider.transport||'未记录'};const result = await processText(input, taskProvider, controller.signal);if(input.mode==='chat'&&input.request?.sessionFacts?.length)result.sessionFacts=input.request.sessionFacts;
        if(search){const sequence=Math.max(0,...search.progress.map(event=>Number(event.sequence)||0))+1,answerEvent={eventId:`${search.result.taskId}:${sequence}`,taskId:search.result.taskId,sequence,stage:'answering',status:'completed'};result.search={allowed:true,taskId:search.result.taskId,query:search.resolvedQuery,originalQuestion:search.query,performed:search.result.performed,status:search.result.status,sources:search.result.sources,usedSourceIds:citedSourceIds(result.text,search.result.sources),elapsedMs:search.result.elapsedMs,usage:search.result.usage,attempts:search.result.attempts,toolCalls:search.result.toolCalls,toolTrace:search.result.toolTrace,progress:[...search.progress,answerEvent],terminationReason:search.result.terminationReason,quality:search.result.quality,tool:search.result.tool,needsClarification:search.result.needsClarification,capabilities:search.result.capabilities,weather:search.result.weather,currentDate:search.result.currentDate,timezone:search.result.timezone,diagnostics:search.result.diagnostics,engine:search.result.engine,frameworks:search.result.frameworks,graph:search.result.graph,migrationFallback:search.result.migrationFallback,synthesisAvailable:!!search.result.synthesis,memory:{memoryIds:remembered.memoryIds,chars:remembered.chars,scanned:remembered.scanned||0,elapsedMs:remembered.elapsedMs}};}
        else if(input.mode==='chat')result.search={memory:{memoryIds:remembered.memoryIds,chars:remembered.chars,scanned:remembered.scanned||0,elapsedMs:remembered.elapsedMs}};
        if(!controller.signal.aborted&&input.mode==='chat'&&!result.simulated)await usageStore.record({taskId:input.taskId,kind:'chat',text:input.text,answer:result.text}).catch(()=>{});
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(req.headers['x-talkcraft-history-metadata']==='true'?{...result,historyContext}:result)); return;
      }
      // Static pages ignore the query; API routes keep their exact matching above.
      const assetPath = new URL(req.url, 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && (assetPath === '/react/' || assetPath.startsWith('/react/'))) {
        const relative = assetPath === '/react/' ? 'index.html' : assetPath.slice('/react/'.length);
        if (!relative || relative.includes('..') || relative.includes('\\')) {res.writeHead(404); res.end('Not found'); return;}
        const file = fileURLToPath(new URL(`./public/react/${relative}`, import.meta.url));
        try {
          const content = await readFile(file);
          const type = relative.endsWith('.html') ? 'text/html; charset=utf-8' : relative.endsWith('.js') ? 'text/javascript; charset=utf-8' : relative.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
          res.writeHead(200, {'Content-Type': type}); res.end(content); return;
        } catch {res.writeHead(404); res.end('Not found'); return;}
      }
      const asset = assets[assetPath] || (/^\/assets\/figma\/img(?:Container\d*|Margin)\.svg$/.test(assetPath)?[assetPath.slice(1),'image/svg+xml']:undefined);
      if (req.method !== 'GET' || !asset) {res.writeHead(404); res.end('Not found'); return;}
      const content = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, {'Content-Type': asset[1]}); res.end(content);
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) return;
      res.writeHead(error.status || 400, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({error: error.message,historyContext,errorCode:String(error.status||'未记录')}));
    }
  });server.on('close',()=>{clearInterval(historyCleanup);clearInterval(searchCleanup);searchCache.clear();try{personalMemoryStore.close();}catch{}if(ephemeralMemoryDir)rmSync(ephemeralMemoryDir,{recursive:true,force:true});});return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer().listen(4317, '127.0.0.1', () => console.log('打开 http://127.0.0.1:4317'));
}
