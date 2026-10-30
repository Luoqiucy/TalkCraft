import {StateGraph,START,END} from '@langchain/langgraph';
import {z} from 'zod';
import {classifyQuestionIntent,presentSource,weatherSynthesis} from '../search-orchestrator.mjs';
import {createAgentToolRegistry} from '../tools/registry.mjs';
import {createLangChainTools,createToolBudget} from './langchain-tools.mjs';
import {createLangChainModelAdapter} from './langchain-model.mjs';
import {processText} from '../pipeline.mjs';

const GraphState=z.object({query:z.string(),taskId:z.string(),input:z.any().optional(),intent:z.any().optional(),outcome:z.any().optional(),result:z.any().optional(),answer:z.any().optional()});
const shanghaiDate=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);

function normalizeWeatherResult({query,taskId,intent,outcome,now,capabilities}){
  const trace=[{callId:outcome.callId,sequence:1,tool:'get_weather',status:outcome.status,startedAt:outcome.startedAt,completedAt:outcome.completedAt,elapsedMs:outcome.elapsedMs,input:{location:intent.location||'',period:intent.period||''}}];
  const weather=outcome.data;
  if(['needs-location','ambiguous-location','needs-period'].includes(weather.status))return {taskId,tool:'weather',performed:false,requested:false,status:'needs-input',sources:[],elapsedMs:outcome.elapsedMs,attempts:1,toolCalls:1,toolTrace:trace,quality:{intent:'weather',sufficient:false,reason:weather.question},needsClarification:weather.question,capabilities};
  if(weather.status!=='ok')throw new Error('结构化天气工具没有返回可用数据');
  const synthesis=weatherSynthesis(weather),sources=(weather.sources||[]).map(presentSource).filter(Boolean);
  return {taskId,tool:'weather',performed:true,requested:true,status:'weather-data',sources,synthesis,elapsedMs:outcome.elapsedMs,attempts:1,toolCalls:1,toolTrace:trace,quality:{intent:'weather',sufficient:true,reason:'结构化天气数据包含地点、所需日期、天气状况和温度',expectedDate:weather.forecast.date},weather:{provider:weather.provider,period:weather.period,timezone:weather.timezone,location:[weather.location.name,weather.location.admin2,weather.location.admin1,weather.location.country].filter(Boolean).join('，'),observedAt:weather.current?.observedAt,forecastDate:weather.forecast.date,current:weather.current,forecast:weather.forecast,forecasts:weather.forecasts},currentDate:shanghaiDate(now),timezone:'Asia/Shanghai',diagnostics:{queries:[query],requestEndpoint:'https://api.open-meteo.com/v1/forecast',requestModel:'structured-weather',responseModels:[],transport:'direct',context:{sourceCount:sources.length,synthesisChars:synthesis.length}},usage:{},capabilities};
}

async function invokeWeatherGraph(provider,query,{signal,weatherTool,webpageTool,registry,taskId,onStatus,nextSequence,maxToolCalls=6,recursionLimit=12,now=new Date(),answerInput,weatherRequest}={}){
  const toolsRegistry=registry||createAgentToolRegistry({provider,weatherTool,webpageTool}),budget=createToolBudget(maxToolCalls),langchain=createLangChainTools({registry:toolsRegistry,taskId,onStatus,nextSequence,signal,budget}),capabilities={structuredWeather:weatherTool?.enabled===true,webpageRead:toolsRegistry.get('read_webpage')?.enabled===true};
  let builder=new StateGraph(GraphState)
    .addNode('understand',state=>{const request=state.input?.request,weather=request?.intent==='weather'?request.weather:weatherRequest,intent=weather?{...classifyQuestionIntent(state.query),...weather,intent:'weather',location:weather.location||'',period:weather.period||'current-today',timezone:weather.timezone||'Asia/Shanghai'}:classifyQuestionIntent(state.query);if(intent.intent!=='weather')throw new Error('当前LangGraph闭环仅接管天气问答');return {intent};})
    .addNode('execute_weather',async state=>({outcome:await langchain.tools.get_weather.invoke({intent:state.intent},{signal})}))
    .addNode('check_evidence',state=>({result:normalizeWeatherResult({query:state.query,taskId:state.taskId,intent:state.intent,outcome:state.outcome,now,capabilities})}))
    .addEdge(START,'understand').addEdge('understand','execute_weather').addEdge('execute_weather','check_evidence');
  const steps=['understand','execute_weather','check_evidence'];
  if(answerInput){const adapted=createLangChainModelAdapter(provider,{signal});builder=builder.addNode('generate_answer',async state=>{onStatus?.({taskId,sequence:nextSequence(),stage:'answering',status:'running',toolCalls:budget.used});const answer=await processText({...state.input,mode:'chat',text:state.query,webSearch:true,webSearchResult:state.result},adapted,signal);onStatus?.({taskId,sequence:nextSequence(),stage:'answering',status:'completed',toolCalls:budget.used});return {answer};}).addEdge('check_evidence','generate_answer').addEdge('generate_answer',END);steps.push('generate_answer');}else builder=builder.addEdge('check_evidence',END);
  const state=await builder.compile().invoke({query,taskId,input:answerInput},{signal,recursionLimit}),result={...state.result,engine:'langgraph',frameworks:{langchain:true,langgraph:true},graph:{recursionLimit,steps,toolCalls:budget.used}};return {result,answer:state.answer};
}

export async function runWeatherGraph(provider,query,options={}){return (await invokeWeatherGraph(provider,query,options)).result;}
export async function runWeatherAnswerGraph(provider,input,options={}){if(input?.mode!=='chat'||typeof input?.text!=='string')throw new Error('LangGraph问答输入无效');return invokeWeatherGraph(provider,input.text.trim(),{...options,answerInput:input,weatherRequest:input.request?.intent==='weather'?input.request.weather:undefined});}
