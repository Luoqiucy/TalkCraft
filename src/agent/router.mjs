import {randomUUID} from 'node:crypto';
import {classifyQuestionIntent,orchestrateSearch} from '../search-orchestrator.mjs';

let weatherGraphModule;
const loadWeatherGraph=()=>weatherGraphModule||=(import('./langgraph-weather.mjs'));

export const AGENT_ENGINES=Object.freeze(['legacy','langgraph']);
export function resolveAgentEngine(value=process.env.TALKCRAFT_AGENT_ENGINE){return value==='langgraph'?'langgraph':'legacy';}

export async function orchestrateQuestion(provider,query,{agentEngine=resolveAgentEngine(),signal,maxResults=8,weatherTool,webpageTool,registry,now=new Date(),maxFollowups=2,maxToolCalls=6,totalTimeoutMs=45000,onStatus,taskId=randomUUID(),graphRecursionLimit=12}={}){
  const intent=classifyQuestionIntent(query);
  if(agentEngine!=='langgraph'||intent.intent!=='weather'||weatherTool?.enabled!==true){const result=await orchestrateSearch(provider,query,{signal,maxResults,weatherTool,webpageTool,registry,now,maxFollowups,maxToolCalls,totalTimeoutMs,onStatus,taskId});return {...result,engine:'legacy',frameworks:{langchain:false,langgraph:false},...(agentEngine==='langgraph'?{migrationFallback:intent.intent==='weather'?'weather-tool-unavailable':'intent-not-migrated'}:{})};}
  maxToolCalls=Math.max(1,Math.min(8,Number(maxToolCalls)||6));totalTimeoutMs=Math.max(1000,Math.min(60000,Number(totalTimeoutMs)||45000));graphRecursionLimit=Math.max(4,Math.min(30,Number(graphRecursionLimit)||12));
  let sequence=0;const nextSequence=()=>++sequence,deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),totalTimeoutMs),combined=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  try{const {runWeatherGraph}=await loadWeatherGraph(),result=await runWeatherGraph(provider,query,{signal:combined,weatherTool,webpageTool,registry,taskId,onStatus,nextSequence,maxToolCalls,recursionLimit:graphRecursionLimit,now});onStatus?.({taskId,sequence:nextSequence(),stage:'answering',status:'running',toolCalls:result.toolCalls});return {...result,eventCount:sequence};}
  catch(error){if(signal?.aborted){onStatus?.({taskId,sequence:nextSequence(),stage:'task',status:'cancelled'});signal.throwIfAborted();}if(deadline.signal.aborted){onStatus?.({taskId,sequence:nextSequence(),stage:'task',status:'timeout',elapsedMs:totalTimeoutMs});const timeout=new Error('联网工具执行超时，已停止后续查询');timeout.status=504;throw timeout;}throw error;}
  finally{clearTimeout(timer);}
}

export async function answerQuestionGraph(provider,input,{signal,weatherTool,webpageTool,registry,now=new Date(),maxToolCalls=6,totalTimeoutMs=45000,onStatus,taskId=randomUUID(),graphRecursionLimit=12}={}){
  if((input?.request?.intent||classifyQuestionIntent(input?.text||'').intent)!=='weather'||weatherTool?.enabled!==true)throw new Error('该问题尚未迁移到LangGraph端到端流程');
  maxToolCalls=Math.max(1,Math.min(8,Number(maxToolCalls)||6));totalTimeoutMs=Math.max(1000,Math.min(60000,Number(totalTimeoutMs)||45000));graphRecursionLimit=Math.max(4,Math.min(30,Number(graphRecursionLimit)||12));
  let sequence=0;const nextSequence=()=>++sequence,deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),totalTimeoutMs),combined=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  try{const {runWeatherAnswerGraph}=await loadWeatherGraph();return await runWeatherAnswerGraph(provider,input,{signal:combined,weatherTool,webpageTool,registry,taskId,onStatus,nextSequence,maxToolCalls,recursionLimit:graphRecursionLimit,now});}
  catch(error){if(signal?.aborted){onStatus?.({taskId,sequence:nextSequence(),stage:'task',status:'cancelled'});signal.throwIfAborted();}if(deadline.signal.aborted){onStatus?.({taskId,sequence:nextSequence(),stage:'task',status:'timeout',elapsedMs:totalTimeoutMs});const timeout=new Error('Agent执行超时，已停止后续步骤');timeout.status=504;throw timeout;}throw error;}
  finally{clearTimeout(timer);}
}
