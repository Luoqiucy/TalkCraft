import test from 'node:test';
import assert from 'node:assert/strict';
import {isStructuredTool} from '@langchain/core/tools';
import {createLangChainTools,createToolBudget} from '../src/agent/langchain-tools.mjs';
import {orchestrateQuestion,resolveAgentEngine} from '../src/agent/router.mjs';
import {createServer} from '../server.mjs';

const weatherData={status:'ok',provider:'open-meteo',period:'current-today',timezone:'Asia/Shanghai',location:{name:'南京',admin1:'江苏',country:'中国'},current:{observedAt:'2026-09-20T10:00',condition:'晴',temperature:25,apparentTemperature:26,humidity:60,precipitation:0,windSpeed:5},forecast:{date:'2026-09-20',condition:'多云',temperatureMax:28,temperatureMin:20,precipitationProbabilityMax:20,windSpeedMax:12},sources:[{title:'天气API',url:'https://api.open-meteo.com/v1/forecast?latitude=32&longitude=118'}],elapsedMs:12};
const weatherTool={enabled:true,async query(){return weatherData;}};

test('LangGraph保留七天证据并向回答传入全部日期',async()=>{
 const forecasts=Array.from({length:7},(_,i)=>({...weatherData.forecast,date:`2026-09-${20+i}`}));
 const result=await orchestrateQuestion({},'张家港这一周的天气怎么样？',{agentEngine:'langgraph',weatherTool:{enabled:true,async query(intent){assert.equal(intent.location,'张家港');assert.equal(intent.period,'next-seven-days');return {...weatherData,current:undefined,period:intent.period,location:{name:'张家港'},forecasts};}},taskId:'week-weather'});
 assert.equal(result.weather.forecasts.length,7);for(const day of forecasts)assert.ok(result.synthesis.includes(day.date));
});

test('LangGraph将含糊时间转为澄清状态，不标记已取得天气数据',async()=>{
 const result=await orchestrateQuestion({},'张家港最近一周天气',{agentEngine:'langgraph',weatherTool:{enabled:true,async query(intent){assert.equal(intent.period,'ambiguous-week');return {status:'needs-period',question:'过去还是未来七天？'};}},taskId:'clarify-week'});
 assert.equal(result.status,'needs-input');assert.equal(result.performed,false);assert.equal(result.quality.sufficient,false);assert.equal(result.needsClarification,'过去还是未来七天？');
});

test('LangChain标准工具复用现有执行器并由程序预算限制调用',async()=>{
 let calls=0;const registry={get:name=>({description:name}),async execute(name,args){calls++;return {tool:name,callId:'call-'+calls,success:true,status:'completed',data:{performed:true,sources:[],args},elapsedMs:1};}},budget=createToolBudget(1),adapted=createLangChainTools({registry,budget});
 assert.equal(isStructuredTool(adapted.tools.search_web),true);const result=await adapted.tools.search_web.invoke({query:'南京',maxResults:3});assert.equal(result.tool,'search_web');await assert.rejects(adapted.tools.search_web.invoke({query:'第二次',maxResults:3}),/达到本次上限/);assert.equal(calls,1);
});

test('LangGraph天气闭环真实经过理解、LangChain工具和证据节点，递归与工具预算分开',async()=>{
 const events=[],result=await orchestrateQuestion({},'南京天气怎么样',{agentEngine:'langgraph',weatherTool,webpageTool:{enabled:false},now:new Date('2026-09-20T02:00:00Z'),taskId:'task-weather',onStatus:e=>events.push(e),maxToolCalls:6,graphRecursionLimit:12});
 assert.equal(result.engine,'langgraph');assert.deepEqual(result.frameworks,{langchain:true,langgraph:true});assert.deepEqual(result.graph.steps,['understand','execute_weather','check_evidence']);assert.equal(result.graph.recursionLimit,12);assert.equal(result.graph.toolCalls,1);assert.equal(result.weather.current.temperature,25);assert.equal(result.toolTrace[0].tool,'get_weather');assert.deepEqual(events.map(e=>[e.tool,e.status]),[['get_weather','running'],['get_weather','completed'],[undefined,'running']]);
});

test('迁移开关对未迁移意图明确回退旧编排，不同时执行两套工具',async()=>{
 let searches=0;const provider={async search(){searches++;throw Error('不应调用');}};const result=await orchestrateQuestion(provider,'解释Wi-Fi和蓝牙的区别',{agentEngine:'langgraph',weatherTool,taskId:'task-general'});assert.equal(result.engine,'legacy');assert.equal(result.migrationFallback,'intent-not-migrated');assert.equal(result.status,'not-needed');assert.equal(searches,0);assert.equal(resolveAgentEngine('unknown'),'legacy');
});

test('HTTP端到端天气搜索与回答记录LangGraph和LangChain执行证据',async t=>{
 const provider={id:'fake',simulated:true,model:'fake-model',async complete(){return {text:'南京当前25℃，晴。[1]',simulated:true};}};const server=createServer({provider,agentEngine:'langgraph',weatherTool,webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const evidence=await (await fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',query:'南京天气怎么样',cloudConsent:true})})).json();assert.equal(evidence.engine,'langgraph');assert.equal(evidence.frameworks.langchain,true);assert.equal(evidence.graph.toolCalls,1);
 const answer=await (await fetch(base+'/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',text:'南京天气怎么样',webSearch:true,searchId:evidence.searchId,cloudConsent:true})})).json();assert.equal(answer.search.engine,'langgraph');assert.equal(answer.search.frameworks.langgraph,true);assert.equal(answer.search.usedSourceIds.length,1);
});

test('Agent端点由单一LangGraph完成天气工具、证据和LangChain模型回答',async t=>{
 let calls=0,metadata=false;const provider={id:'fake',simulated:true,model:'fake-model',async complete(messages,options){calls++;metadata=options.withMetadata===true;assert.match(messages.map(v=>v.content).join('\n'),/结构化天气工具/);return {text:'南京当前25℃，晴。[1]',usage:{inputTokens:12},responseModel:'fake-model'};}};
 const server=createServer({provider,agentEngine:'langgraph',weatherTool,webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',text:'南京天气怎么样',cloudConsent:true,webSearch:true,history:[]})}),answer=await response.json();
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(metadata,true);assert.equal(answer.text,'南京当前25℃，晴。[1]');assert.deepEqual(answer.search.graph.steps,['understand','execute_weather','check_evidence','generate_answer']);assert.equal(answer.search.frameworks.langchain,true);assert.equal(answer.search.usedSourceIds.length,1);assert.equal(answer.usage.inputTokens,12);
});
test('Agent端点用历史地点解析天气追问，搜索词与原话分别记录',async t=>{
 let actual;
 const provider={id:'fake',simulated:true,async complete(){return {text:'明日预报已查到'};}};
 const tool={enabled:true,async query(intent){actual=intent;return {...weatherData,current:undefined,period:'tomorrow',forecast:{...weatherData.forecast,date:'2026-09-26'}};}};
 const server=createServer({provider,agentEngine:'langgraph',weatherTool:tool,webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',text:'那明天呢？',webSearch:true,cloudConsent:true,history:[{role:'user',content:'苏州张家港市天气怎么样？'},{role:'assistant',content:'今天的天气已查到'}]})});
 const answer=await response.json();assert.equal(response.status,200,answer.error);assert.equal(actual.location,'苏州张家港市');assert.equal(actual.period,'tomorrow');assert.equal(answer.search.originalQuestion,'那明天呢？');assert.match(answer.search.query,/苏州张家港市/);
});
test('账号/备用LangGraph天气路由接收显式授权的位置，但不把坐标传给回答模型',async t=>{
 let actual,modelText='';const coordinates={latitude:31.23,longitude:121.47,source:'device-geolocation',capturedAt:new Date().toISOString()};
 const provider={id:'fake',simulated:true,async complete(messages){modelText=messages.map(item=>item.content).join('\n');return {text:'当前位置附近当前天气已查到。'};}};
 const weatherTool={enabled:true,async query(intent){actual=intent;return {...weatherData,location:{name:'当前位置附近',latitude:31.23,longitude:121.47},current:{...weatherData.current,temperatureC:24}};}};
 const server=createServer({provider,agentEngine:'langgraph',weatherTool,webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',text:'这里天气怎么样？',webSearch:true,cloudConsent:true,locationConsent:true,locationCoordinates:coordinates,history:[]})}),answer=await response.json();
 assert.equal(response.status,200,answer.error);assert.ok(actual,JSON.stringify(answer));assert.equal(actual.coordinates?.latitude,31.23,JSON.stringify(actual));assert.equal(actual.coordinates?.longitude,121.47);assert.doesNotMatch(modelText,/31\.23|121\.47/);assert.equal(answer.search.engine,'langgraph');
});
test('产品联网问答在单次请求中搜索并回答，保留原型号与真实工具事件',async t=>{
 let searches=0,answers=0;
 const provider={id:'fake',simulated:true,model:'fake-model',async search(query){searches++;assert.match(query,/理想i9/);return {performed:true,requested:true,status:'searched',sources:[{title:'Li Auto Inc. Launches Li i9',url:'https://ir.lixiang.com/news-releases/li-i9',snippet:'Li Auto officially launched Li i9 on September 16, 2026. Six-seat battery electric SUV.'}],synthesis:'官方发布公告确认理想i9于2026年9月16日上市，未提供完整参数表。',elapsedMs:5};},async complete(messages){answers++;assert.match(messages.map(item=>item.content).join('\n'),/理想i9/);return {text:'官方公告确认理想i9上市；完整参数尚未查到可靠数据。[1]',modelElapsedMs:8};}};
 const server=createServer({provider,agentEngine:'langgraph',webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({mode:'chat',text:'帮我查一下理想i9的参数',webSearch:true,cloudConsent:true})});
 const lines=(await response.text()).trim().split('\n').map(line=>JSON.parse(line)),answer=lines.find(line=>line.type==='result')?.data,events=lines.filter(line=>line.type==='progress').map(line=>line.event);
 assert.equal(response.status,200);assert.equal(searches,1);assert.equal(answers,1);assert.match(answer.text,/理想i9/);assert.equal(answer.search.engine,'legacy');assert.equal(answer.search.originalQuestion,'帮我查一下理想i9的参数');assert.equal(answer.search.performed,true);assert.equal(answer.search.usedSourceIds.length,1);assert.ok(Number.isFinite(answer.search.firstProgressMs));assert.ok(answer.search.totalElapsedMs>=answer.search.firstProgressMs);assert.ok(events.some(event=>event.tool==='search_web'&&event.status==='completed'));assert.ok(events.some(event=>event.stage==='answering'&&event.status==='completed'));
});
test('通用Agent模型阶段超时停止交付结果并报告真实终止状态',async t=>{
 const provider={id:'fake',simulated:true,async search(){return {performed:true,requested:true,status:'searched',sources:[{title:'星海X7官方配置',url:'https://official.public.example/x7',snippet:'星海X7官方售价24.98万元，CLTC续航680公里，2026年发布。'}],synthesis:'星海X7售价24.98万元，续航680公里。'};},complete(_messages,{signal}){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
 const server=createServer({provider,agentEngine:'langgraph',webpageTool:{enabled:false},searchLimits:{maxFollowups:0,maxToolCalls:6,totalTimeoutMs:100,maxResults:8}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({mode:'chat',text:'帮我查一下星海X7的续航和价格',webSearch:true,cloudConsent:true})});
 const lines=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));assert.equal(lines.at(-1).type,'error');assert.equal(lines.at(-1).status,504);assert.ok(lines.some(line=>line.type==='progress'&&line.event.status==='timeout'));assert.equal(lines.some(line=>line.type==='result'),false);
});
test('明显ASR疑似错词在天气搜索前要求确认且不调用天气或模型',async t=>{
 let weatherCalls=0,modelCalls=0;
 const provider={id:'fake',simulated:true,async complete(){modelCalls++;return {text:'不应执行'};}};
 const weatherTool={enabled:true,async query(){weatherCalls++;return weatherData;}};
 const server=createServer({provider,agentEngine:'langgraph',weatherTool,webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',text:'接下来7天是按长天气怎么样呢？',webSearch:true,cloudConsent:true,history:[]})});
 const answer=await response.json();assert.equal(response.status,200);assert.equal(answer.search.status,'needs-confirmation');assert.equal(answer.search.performed,false);assert.match(answer.text,/确认/);assert.equal(weatherCalls,0);assert.equal(modelCalls,0);
});
