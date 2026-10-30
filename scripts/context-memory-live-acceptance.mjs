import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from '../server.mjs';
import {providersFromConfigPath} from '../src/file-config.mjs';
import {createHistoryStore} from '../src/local-history.mjs';
import {createTelemetryStore} from '../src/telemetry.mjs';
import {createLocalUsageStore} from '../src/local-usage.mjs';

if(process.env.TALKCRAFT_LIVE_ACCEPTANCE!=='1'){
 console.error('真实模型/联网验收需要显式设置 TALKCRAFT_LIVE_ACCEPTANCE=1；默认命令不会产生外部请求。');
 process.exitCode=2;
}else{
 const loaded=await providersFromConfigPath('./.local/asr-test.env'),baseProvider=loaded.provider;
 if(baseProvider.simulated||baseProvider.local||typeof baseProvider.streamWithTools!=='function'){
  console.log(JSON.stringify({status:'skipped',reason:'当前配置不是已配置的云端工具调用提供器；未进行真实联网调用',provider:baseProvider.id||'unknown',simulated:baseProvider.simulated===true,local:baseProvider.local===true}));
 }else{
  const root=await mkdtemp(join(tmpdir(),'talkcraft-live-context-memory-'));
  let server;
  try{
   const history=createHistoryStore(join(root,'history'));
   const usageStore=createLocalUsageStore(join(root,'usage','events.json'));
   const workspace={read:async()=>({version:1,revision:0,preferences:{theme:'light',saveHistory:false},history:[]}),update:async()=>{throw new Error('测试禁止修改工作区设置')}};
   const textSettings={read:async()=>({}),update:async()=>{throw new Error('测试禁止修改文字提供器配置')}};
   const provider={...baseProvider};
   const serverOptions={provider,history,usageStore,telemetry:createTelemetryStore(),workspace,textSettings,commercialBridge:{identity:async()=>({kind:'guest'})},agentEngine:loaded.agentEngine,searchLimits:{maxFollowups:2,maxToolCalls:6,totalTimeoutMs:45000,maxResults:8}};
   server=createServer(serverOptions);
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const base=`http://127.0.0.1:${server.address().port}`;
   const outcomes=[];let sameFailure=0,lastFailure='';
   const historyBySession=new Map();
   const uuid=()=>randomUUID();
   async function ask(sessionId,text){
    const messages=historyBySession.get(sessionId)||[];
    const started=Date.now();
    const response=await fetch(`${base}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({mode:'chat',webSearch:true,cloudConsent:true,sessionId,taskId:uuid(),text,history:messages})});
    const data=await response.json();
    const outcome={question:text,httpStatus:response.status,status:data.search?.status||'http-error',performed:data.search?.performed===true,termination:data.search?.terminationReason||'',elapsedMs:data.search?.totalElapsedMs??Date.now()-started,toolCalls:data.search?.toolCalls??0,attempts:data.search?.attempts??0,modelCalls:data.search?.diagnostics?.modelCalls??null,responseModels:data.search?.diagnostics?.responseModels||[],usage:data.search?.usage||null,queries:data.search?.diagnostics?.queries||[],tools:(data.search?.toolTrace||[]).map(item=>({tool:item.tool,status:item.status,elapsedMs:item.elapsedMs,input:item.input,resultCount:item.resultCount})),sources:(data.search?.sources||[]).map(item=>({sourceId:item.sourceId,title:item.title,domain:item.domain,url:safeUrl(item.url),evidenceState:item.evidenceState,publishedAt:item.publishedAt||'未提供'})),answerChars:typeof data.text==='string'?data.text.length:0,answerHasText:typeof data.text==='string'&&data.text.trim().length>0,...(data.search?.memory?{memory:{memoryIds:data.search.memory.memoryIds,chars:data.search.memory.chars,scanned:data.search.memory.scanned}}:{})};
    outcomes.push(outcome);
    if(response.ok&&typeof data.text==='string'&&data.text.trim()){
     messages.push({role:'user',content:text},{role:'assistant',content:data.text});historyBySession.set(sessionId,messages);
     sameFailure=0;lastFailure='';
    }else{
     const category=`${response.status}:${outcome.status}:${outcome.termination}`;
     sameFailure=category===lastFailure?sameFailure+1:1;lastFailure=category;
    }
    if(sameFailure>=3)throw new Error(`连续三次相同基础失败(${lastFailure})，按验收规则停止真实请求`);
    return outcome;
   }
   const groups=[
    {name:'天气地点切换与日期纠正',turns:['南京今天的天气怎么样？','那杭州呢？','哦不对，未来一周。']},
    {name:'产品补充与换对象',turns:['请查一下华为Mate 80 Pro的价格和主要配置。','内存版本有哪些？','那iPhone 17 Pro Max呢？']},
    {name:'公司新闻和时间范围修订',turns:['比亚迪最近三天有什么新闻？','小米汽车呢？','只看最近七天。']},
    {name:'隔离记忆、跨轮读取与临时覆盖',turns:['这次请详细说明。','你记得我喜欢什么回答风格吗？','那我长期偏好的回答风格是什么？']}
   ];
   for(const group of groups){
    const sessionId=uuid();
    if(group.name.startsWith('隔离记忆')){
     const mem=await fetch(`${base}/api/memories/create`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({type:'preference',content:'我喜欢简短回答',reason:'隔离验收账号的合成测试记忆，不进入生产数据',confirmed:true,independent:true})});
     if(!mem.ok)throw new Error('隔离记忆写入失败，终止真实验证');
     const savedMemoryId=(await mem.json()).memory?.memoryId;
     const override=await ask(sessionId,'这次请详细回答：你记得我喜欢什么回答风格吗？');
     if(savedMemoryId&&!override.memory?.memoryIds?.includes(savedMemoryId))throw new Error('已确认记忆没有出现在隔离的新请求检索结果中');
     const followup=await ask(sessionId,'那我长期偏好的回答风格是什么？');
     if(savedMemoryId&&!followup.memory?.memoryIds?.includes(savedMemoryId))throw new Error('跨轮追问没有命中隔离记忆');
     await ask(sessionId,'以后我还是更喜欢哪种回答风格？');
    }else for(const text of group.turns)await ask(sessionId,text);
   }
   console.log(JSON.stringify({status:'completed',provider:baseProvider.id||'unknown',requestModel:baseProvider.model||'未记录',endpointHost:new URL(baseProvider.endpoint).host,simulated:false,environment:'isolated-temp-history-memory-usage-workspace',realTasks:outcomes.length,maxToolCallsPerTask:6,totalTimeoutMs:45000,results:outcomes},null,2));
  }catch(error){
   console.log(JSON.stringify({status:'stopped',reason:String(error?.message||'验收中止').slice(0,220)}));process.exitCode=1;
  }finally{
   if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
   await rm(root,{recursive:true,force:true});
  }
 }
}

function safeUrl(value){try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return'';url.search='';url.hash='';return url.href;}catch{return'';}}
