import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {loadProvider} from '../src/config.mjs';
import {answerDaisyQuestion} from '../src/agent/daisy-question.mjs';
import {createOpenMeteoWeatherTool} from '../src/tools/weather.mjs';
import {createWebpageTool} from '../src/tools/webpage.mjs';
import {resolveQuestionContext} from '../src/agent/question-context.mjs';

const env=parseEnv(await readFile(new URL('../.local/asr-test.env',import.meta.url),'utf8'));
const provider=loadProvider(env),question=process.argv.slice(2).join(' ')||'帮我查一下理想i9';
const maxToolCalls=Math.max(1,Math.min(6,Number(process.env.TALKCRAFT_PROBE_MAX_TOOL_CALLS)||6));
const started=Date.now(),events=[];
try{
  const contextual=resolveQuestionContext(question,[]);
  const completed=await answerDaisyQuestion(provider,{text:contextual.query,originalText:contextual.original,request:contextual.request,webSearch:true},{maxToolCalls,weatherTool:createOpenMeteoWeatherTool(),webpageTool:createWebpageTool(),onStatus:event=>events.push({stage:event.stage,tool:event.tool,status:event.status,elapsedMs:event.elapsedMs,resultCount:event.resultCount})});
  const {result,answer}=completed;
  console.log(JSON.stringify({provider:provider.id,configuredModel:provider.model,responseModel:answer.responseModel,originalQuestion:contextual.original,resolvedQuestion:contextual.query,maxToolCalls,request:{intent:contextual.request.intent,subject:contextual.request.subject,timeScope:contextual.request.timeScope,news:contextual.request.news,weather:contextual.request.weather?{location:contextual.request.weather.location,period:contextual.request.weather.period,coordinates:contextual.request.weather.coordinates?'经授权位置':'无'}:undefined},answer:answer.text.slice(0,1200),elapsedMs:Date.now()-started,toolCalls:result.toolCalls,modelCalls:result.diagnostics.modelCalls,queries:result.diagnostics.queries,searchBackends:result.diagnostics.searchBackends,sources:result.sources.slice(0,10).map(item=>({title:item.title,url:item.url,evidenceState:item.evidenceState,snippet:item.snippet?.slice(0,200),publishedAt:item.publishedAt})),usage:result.usage,quality:result.quality,events},null,2));
}catch(error){console.log(JSON.stringify({provider:provider.id,question,error:error.message,elapsedMs:Date.now()-started,events},null,2));process.exitCode=1;}
