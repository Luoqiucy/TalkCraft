import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {answerDaisyQuestion} from '../src/agent/daisy-question.mjs';
import {createServer} from '../server.mjs';
import {createHistoryStore} from '../src/local-history.mjs';

const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const source={title:'理想 i9 官方公告',url:'https://ir.lixiang.com/news-releases/li-i9',snippet:'理想 i9 于2026年9月16日上市，官方公告明确车型名称；售价36.98万元，车长5225毫米，续航705公里。'};

test('Daisy 式循环把真实搜索结果交回模型，并保留原始对象与来源',async()=>{
  const requests=[],events=[];let searches=0;
 const provider={id:'deepseek',model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions',async streamWithTools(messages,options){requests.push({messages:structuredClone(messages),options});if(requests.length===1)return {content:'',toolCalls:[call('c1','search_web',{query:'理想i9 官方参数'})],usage:{inputTokens:10},responseModel:'deepseek-flash'};return {content:'理想 i9 已上市[1]；其他参数尚未查到可靠数据。',toolCalls:[],usage:{outputTokens:20},responseModel:'deepseek-flash'};},async search(query){searches++;assert.match(query,/i9/i);return {performed:true,sources:[source],synthesis:source.snippet};}};
  const {result,answer}=await answerDaisyQuestion(provider,{text:'帮我查一下理想i9的参数'},{taskId:'daisy-1',onStatus:event=>events.push(event)});
 assert.equal(searches,1);assert.equal(requests.length,2);assert.equal(requests[0].options.toolChoice.function.name,'search_web');assert.equal(requests[1].messages.at(-1).role,'tool');assert.doesNotThrow(()=>JSON.parse(requests[1].messages.at(-1).content));assert.match(requests[1].messages.at(-1).content,/理想 i9/);assert.match(answer.text,/理想 i9/);assert.equal(result.engine,'daisy-tools');assert.equal(result.sources[0].sourceId?.startsWith('source-'),true);assert.equal(result.toolCalls,1);assert.equal(result.usage.inputTokens,10);assert.equal(result.usage.outputTokens,20);assert.ok(result.diagnostics.context.sourceCount>=1);assert.ok(result.diagnostics.evidenceDecisions.length>=2);assert.ok(events.some(event=>event.tool==='search_web'&&event.status==='completed'));
});

test('Daisy天气实际工具调用使用已授权近似位置，轨迹与模型上下文不泄露坐标',async()=>{
 const coordinates={latitude:31.23,longitude:121.47,source:'device-geolocation',capturedAt:'2026-09-30T12:00:00.000Z'};
 const request={originalText:'这里天气怎么样？',resolvedQuestion:'这里天气怎么样？',intent:'weather',subject:'',location:'',weather:{intent:'weather',location:'',period:'current-today',timezone:'Asia/Shanghai',coordinates},provenance:{location:'device-geolocation'}};
 const modelRequests=[];let received;
 const weatherTool={enabled:true,async query(intent){received=structuredClone(intent);return {status:'needs-location',question:'天气服务需要一个城市',provider:'open-meteo'};}};
 const provider={id:'deepseek',model:'test',async streamWithTools(messages){modelRequests.push(structuredClone(messages));if(modelRequests.length===1)return {content:'',toolCalls:[call('w1','get_weather',{intent:{intent:'weather'}})]};return {content:'请提供城市名称，或允许使用当前位置。',toolCalls:[]};}};
 const {result}=await answerDaisyQuestion(provider,{text:request.resolvedQuestion,request,webSearch:true},{weatherTool,now:new Date('2026-09-30T12:00:00.000Z')});
 assert.equal(received.coordinates.latitude,31.23);assert.equal(received.coordinates.longitude,121.47);assert.equal(result.toolTrace[0].input.location,'当前位置附近');
 const serialized=JSON.stringify(modelRequests);assert.doesNotMatch(serialized,/31\.23|121\.47/);
});

test('含歧义的设备类别在Daisy生产循环入口先澄清，不调用模型或工具',async()=>{
 const {resolveQuestionContext}=await import('../src/agent/question-context.mjs');
 const history=[{role:'user',content:'请帮我查MacBook Pro电脑参数'},{role:'assistant',content:'已开始查询'}];
 const contextual=resolveQuestionContext('那手机呢',history);let modelCalls=0,toolCalls=0;
 const provider={async streamWithTools(){modelCalls++;return {content:'不应调用',toolCalls:[]};}};
 const registry={list:()=>[{name:'search_web',enabled:true}],execute:async()=>{toolCalls++;throw Error('不应执行工具');}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:contextual.query,request:contextual.request},{registry});
 assert.equal(result.status,'needs-input');assert.equal(result.terminationReason,'awaiting-user-input');assert.match(answer.text,/哪一款手机/);assert.equal(modelCalls,0);assert.equal(toolCalls,0);
});

test('本机 /api/agent 连续天气对话把每一轮最终地点与范围传给真实工具接口',async t=>{
 const received=[];let requestNumber=0;
 const provider={id:'offline-fixture',model:'fixture-only',simulated:true,async streamWithTools(messages){requestNumber++;if(messages.at(-1).role!=='tool')return {content:'',toolCalls:[call(`weather-${requestNumber}`,'get_weather',{intent:{intent:'weather'}})]};return {content:'已取得该地点天气数据。',toolCalls:[]};}};
 const weatherTool={enabled:true,async query(intent){received.push(structuredClone(intent));return {status:'ok',provider:'fixture-weather',period:intent.period,timezone:'Asia/Shanghai',location:{name:intent.location},forecast:{date:'2026-10-02',condition:'晴',temperatureMax:24,temperatureMin:16,precipitationProbabilityMax:10,windSpeedMax:8},current:{temperature:20,condition:'晴'},sources:[{title:'fixture weather',url:'https://weather.example/data'}]};}};
 const server=createServer({provider,weatherTool,webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const history=[];
 for(const text of ['查找江苏省苏州市的天气如何？','张家港天气怎么样','南京呢','杭州','明天呢','明天请帮我搜一下西藏自治区那曲市天气']){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',text,history,webSearch:true,cloudConsent:true})});assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.search.status,'weather-data');history.push({role:'user',content:text},{role:'assistant',content:payload.text});}
 assert.deepEqual(received.map(item=>[item.location,item.period]),[['江苏省苏州市','current-today'],['张家港','current-today'],['南京','current-today'],['杭州','current-today'],['杭州','tomorrow'],['西藏自治区那曲市','tomorrow']]);
});

test('Daisy公司新闻实际循环用结构化公司和日期评估来源，不用整句口语做对象',async()=>{
 const {resolveQuestionContext}=await import('../src/agent/question-context.mjs');
 const contextual=resolveQuestionContext('帮我搜一下小米汽车最近新闻热点。',[],{now:new Date('2026-09-30T12:00:00+08:00')});let turns=0,searchQuery='';
 const provider={id:'deepseek',model:'test-news',async streamWithTools(messages){turns++;if(turns===1){assert.match(messages[0].content,/\"company\":\"小米汽车\"/);return {content:'',toolCalls:[call('n1','search_web',{query:'Xiaomi Auto recent news September 2026'})]};}return {content:'小米汽车近期有一项新动态，来源发表于2026年9月29日[1]。',toolCalls:[]};},async search(query){searchQuery=query;return {performed:true,sources:[{title:'Xiaomi Auto announces new model',url:'https://news.example/xiaomi-auto',publishedAt:'2026-09-29',snippet:'Xiaomi Auto announced a new model on 2026-09-29, with delivery plans and product updates.'}],synthesis:'Xiaomi Auto announced a new model on 2026-09-29.'};}};
 const {result}=await answerDaisyQuestion(provider,{text:contextual.query,originalText:contextual.original,request:contextual.request,webSearch:true});
 assert.match(searchQuery,/Xiaomi Auto/);assert.equal(result.quality.intent,'company-news');assert.equal(result.quality.sufficient,true);assert.equal(result.quality.subject,'小米汽车');assert.equal(result.quality.matchedSources,1);assert.equal(turns,2);
});

test('超长工具内容按字段收缩后仍是合法JSON，来源ID保留且敏感URL参数剔除',async()=>{
 const requests=[];let turn=0;const provider={id:'deepseek',async streamWithTools(messages){requests.push(structuredClone(messages));if(++turn===1)return {content:'',toolCalls:[call('s1','search_web',{query:'理想 i9'})]};return {content:'已核实部分参数[1]；续航尚未查到可靠数据。',toolCalls:[]};},async search(){return {performed:true,backend:'firecrawl',synthesis:'理想 i9 参数摘要。'.repeat(5000),sources:[{title:'理想 i9',url:'https://www.lixiang.com/i9?access_token=never-save&ref=spec',snippet:'理想 i9 配置说明。'.repeat(500)}]};}};
 const {result}=await answerDaisyQuestion(provider,{text:'理想i9的汽车详细参数'});const payload=requests[1].at(-1).content,data=JSON.parse(payload);assert.ok(payload.length<14000);assert.equal(data.sources[0].sourceId,result.sources[0].sourceId);assert.doesNotMatch(payload,/access_token|never-save/);assert.match(payload,/字段限长/);assert.equal(result.diagnostics.context.truncated,true);
});

test('近期手机问答不会把已有官网搜索结果误判为对象不相关',async()=>{
 const question='小米最新款的手机是什么？';let turns=0;
 const provider={id:'deepseek',async streamWithTools(messages){turns++;if(turns===1)return {content:'',toolCalls:[call('s1','search_web',{query:'小米最新款手机 2026'})]};if(turns===2){assert.match(messages.at(-1).content,/Xiaomi 17/);return {content:'小米官网列有 Xiaomi 17 [1]；是否为所有地区最新上市机型仍需核对发布时间。',toolCalls:[]};}if(turns===3){assert.match(messages.at(-1).content,/证据检查仍未通过/);return {content:'',toolCalls:[call('s2','search_web',{query:'Xiaomi 17 发布日期 小米官网 最新型号'})]};}return {content:'Xiaomi 17 官方产品页列有芯片和电池参数[1]；来源未证明它是最新型号。',toolCalls:[]};},async search(query){return {performed:true,backend:'firecrawl',sources:[{title:'Xiaomi 17',url:'https://www.mi.com/prod/xiaomi-17',snippet:'Xiaomi 17 手机搭载第五代骁龙 8 至尊版移动平台和 7000mAh 电池；小米官网手机产品页。'}]};}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:question});
 assert.equal(turns,5);assert.equal(result.diagnostics.evidenceNudges,2);assert.equal(result.quality.subject,'小米手机');assert.equal(result.quality.subjectConfirmed,true);assert.equal(result.quality.officialSourceCount,1);assert.doesNotMatch(answer.text,/对象.*不相关|缩小问题范围/);assert.match(answer.text,/尚未查到|无法确认|Xiaomi 17/);
});

test('最新款没有明确产品线证据时，最终回答不能把候选型号说成已确认结论',async()=>{
 let turn=0;const provider={id:'deepseek',async streamWithTools(){turn++;if(turn===1)return {content:'',toolCalls:[call('s1','search_web',{query:'一加手机呢？最新款的型号是什么？并且告诉我它的具体参数。'})]};return {content:'一加15是当前最新款[1]，它有7300mAh电池。',toolCalls:[]};},async search(){return {performed:true,backend:'firecrawl',sources:[{title:'OnePlus 15 Specs',url:'https://www.oneplus.com/cn/15/specs',snippet:'OnePlus 15 smartphone参数页面：7300mAh电池、120W充电。'}]};}};
 const question='一加手机呢？最新款的型号是什么？并且告诉我它的具体参数。';const {result,answer}=await answerDaisyQuestion(provider,{text:question});assert.equal(result.quality.subjectConfirmed,true);assert.equal(result.quality.latestConfirmed,false);assert.doesNotMatch(answer.text,/一加15是当前最新款/);assert.match(answer.text,/7300mAh/);assert.match(answer.text,/最新状态尚未从来源核实/);
});

test('模型正文误返 DSML 工具协议时不泄漏标记、不把正文当成工具执行',async()=>{
 let turns=0,searches=0;const provider={id:'deepseek',async streamWithTools(){turns++;if(turns===1)return {content:'',toolCalls:[call('s1','search_web',{query:'理想i9 官方信息'})]};return {content:'<｜DSML｜function_calls>assistant to=search_web\n{"query":"泄露凭据"}</｜DSML｜function_calls>',toolCalls:[]};},async search(){searches++;return {performed:true,sources:[source],synthesis:source.snippet};}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:'理想i9有什么官方信息'});
 assert.equal(searches,1);assert.equal(result.toolCalls,1);assert.equal(result.terminationReason,'unsupported-tool-protocol');assert.doesNotMatch(answer.text,/DSML|assistant to=|泄露凭据/);assert.match(answer.text,/协议|无法可靠回答|暂时/);
});

test('来源目录已达展示上限时读取的新页面仍登记稳定来源，不产生 [0]',async()=>{
 let turn=0,reads=0;const urls=Array.from({length:8},(_,i)=>`https://cars.example/${i}`),provider={id:'deepseek',async streamWithTools(){turn++;if(turn===1)return {content:'',toolCalls:[call('search','search_web',{query:'理想 i9 参数'})]};if(turn===2)return {content:'',toolCalls:[call('read','read_webpage',{url:'https://ir.lixiang.com/i9'})]};return {content:'理想 i9 官方车长5225毫米[9]。',toolCalls:[]};},async search(){return {performed:true,sources:urls.map((url,i)=>({url,title:`理想i9资料${i}`,snippet:'理想 i9 汽车相关资料。'}))};}};
 const webpageTool={enabled:true,async read(){reads++;return {finalUrl:'https://ir.lixiang.com/i9',title:'理想 i9 官方公告',text:'理想 i9 官方车长5225毫米。',readMethod:'local'};}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:'理想 i9 车长是多少？'},{webpageTool});
 assert.equal(reads,1);assert.equal(result.sources.length,9);assert.match(answer.text,/\[9\]/);assert.doesNotMatch(answer.text,/\[0\]/);assert.equal(result.sources[8].url,'https://ir.lixiang.com/i9');
});

test('最新状态不确定时移除肯定断言，已确认时移除相反免责声明',async()=>{
 for(const latestConfirmed of [false,true]){
  let turn=0;const provider={id:'deepseek',async streamWithTools(){turn++;if(turn===1)return {content:'',toolCalls:[call('s','search_web',{query:'小米最新手机'})]};return {content:latestConfirmed?'小米官方已确认 Xiaomi 17 是最新机型[1]，但我无法确认它是否最新。':'小米17是最新机型[1]，但来源无法确认是否最新。',toolCalls:[]};},async search(){return {performed:true,sources:[{title:'Xiaomi 17 产品页',url:'https://www.mi.com/phone/xiaomi-17',snippet:latestConfirmed?'Xiaomi current lineup: Xiaomi 17, latest phone model. 小米当前手机产品线。':'Xiaomi 17 smartphone参数页面。'}]};}};
  const {answer}=await answerDaisyQuestion(provider,{text:'小米最新手机是什么？'});
  if(latestConfirmed){assert.match(answer.text,/已确认|最新/);assert.doesNotMatch(answer.text,/无法确认.*最新|不能确认.*最新/);}else{assert.doesNotMatch(answer.text,/小米17是最新机型/);assert.match(answer.text,/最新状态尚未从来源核实|没有可靠证据证明/);}
 }
});

test('只把用户确认记忆用于回答，不将记忆内容送入公开搜索词',async()=>{
 let turn=0,executed='';const memory={memoryId:'12345678-1234-4234-8234-123456789abc',type:'preference',content:'我的默认地区是苏州张家港',reason:'用户明确确认默认地区',confirmed:true};const provider={id:'deepseek',async streamWithTools(messages){turn++;if(turn===1){assert.match(messages[0].content,/默认地区是苏州张家港/);return {content:'',toolCalls:[call('search','search_web',{query:'张家港默认地区 小米手机张家港参数'})]};}return {content:'已查到用户询问的小米手机资料[1]。',toolCalls:[]};},async search(query){executed=query;return {performed:true,sources:[{title:'小米手机资料',url:'https://www.mi.com/phone',snippet:'小米手机产品资料。'}]};}};
 const {result}=await answerDaisyQuestion(provider,{text:'小米手机最近有什么消息？',personalMemories:[memory]});assert.doesNotMatch(executed,/我的默认地区是苏州张家港/);assert.equal(result.memory.memoryIds[0],memory.memoryId);
});

test('最终来源列表若被模型重新编号，按同一行真实URL对齐稳定引用',async()=>{
 let turns=0;
 const provider={id:'deepseek',async streamWithTools(){turns++;if(turns===1)return {content:'',toolCalls:[call('s1','search_web',{query:'Apple 最新 iPhone'})]};return {content:'官网列出 iPhone 18 [2]。\n来源：\n- [1] Apple 新闻稿 — https://www.apple.com.cn/newsroom/2026/09/iphone-18/\n- [3] iPhone - Apple — https://www.apple.com/iphone/',toolCalls:[]};},async search(){return {performed:true,backend:'firecrawl',sources:[{title:'Apple 新闻稿',url:'https://www.apple.com.cn/newsroom/2026/09/iphone-18/',snippet:'Apple 于2026年9月发布 iPhone 18，新品资料见官网。'},{title:'新闻转载',url:'https://news.example/iphone',snippet:'转载 Apple 2026 年发布消息。'},{title:'iPhone - Apple',url:'https://www.apple.com/iphone/',snippet:'Current iPhone lineup includes iPhone 18. Apple official product page.'}]};}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:'苹果最新款的手机是哪一款？'});
 assert.equal(result.sources[1].url,'https://www.apple.com/iphone/');
 assert.match(answer.text,/\[2\] iPhone - Apple — https:\/\/www\.apple\.com\/iphone\//);
 assert.doesNotMatch(answer.text,/\[3\] iPhone - Apple/);
});

test('首轮搜索占满来源时仍保留后续官方补查来源，引用序号不复用',async()=>{
 let turns=0,searches=0;
 const provider={id:'deepseek',async streamWithTools(messages){turns++;if(turns<=2)return {content:'',toolCalls:[call(`c${turns}`,'search_web',{query:turns===1?'理想 I9 参数':'理想汽车 i9 官方发布'})]};assert.match(messages.at(-1).content,/"sourceType":"manufacturer-domain"/);assert.match(JSON.stringify(messages),/cars\.example/);assert.match(messages.at(-1).content,/5225毫米/);return {content:'理想 i9 官方发布资料见[11]；其余字段尚未查到可靠数据。',toolCalls:[]};},async search(){searches++;return searches===1?{performed:true,backend:'firecrawl',sources:Array.from({length:8},(_,i)=>({url:`https://cars.example/${i}`,title:`理想 i9 媒体资料 ${i}`,snippet:'理想 i9 汽车参数与价格介绍。'}))}:{performed:true,backend:'firecrawl',sources:[{url:'https://www.lixiang.com/configuration.html',title:'理想参数配置',snippet:'很多型号的配置表，请查看对应车型。'},{url:'https://www.lixiang.com/L9',title:'理想 L9',snippet:'理想 L9 续航和电池。'},{url:'https://www.lixiang.com/news/188.html',title:'全新理想i9正式发布 - 理想汽车',snippet:'全新理想i9车长5225毫米、车宽1970毫米、车高1752毫米，轴距3168毫米，标配101千瓦时电池，续航705公里。'}]};}};
 const {result}=await answerDaisyQuestion(provider,{text:'帮我上网搜一下理想 I9的详细参数。'});
 assert.equal(searches,2);assert.equal(result.sources.length,11);assert.ok(result.sources.some(source=>source.url==='https://www.lixiang.com/news/188.html'));assert.equal(result.quality.officialSourceCount,1);
});

test('没有执行搜索时不能把模型旧知识标为联网答案',async()=>{
  const provider={id:'deepseek',async streamWithTools(){return {content:'这款车不存在。',toolCalls:[]};},async search(){throw Error('不能调用');}};
  const {result,answer}=await answerDaisyQuestion(provider,{text:'帮我查一下新车的价格'});
  assert.equal(result.performed,false);assert.doesNotMatch(answer.text,/不存在/);assert.match(answer.text,/没有取得可核实/);
});

test('重复工具调用不会重发请求，也受同一调用预算限制',async()=>{
  let count=0,searches=0;
  const provider={id:'deepseek',async streamWithTools(){count++;return count<3?{content:'',toolCalls:[call(`c${count}`,'search_web',{query:'今日新闻'})]}:{content:'资料不足',toolCalls:[]};},async search(){searches++;return {performed:true,sources:[],synthesis:''};}};
 const {result}=await answerDaisyQuestion(provider,{text:'帮我查一下今日新闻'},{maxToolCalls:2});
 assert.equal(searches,1);assert.equal(result.toolCalls,1);assert.equal(result.diagnostics.proposedToolCalls,2);assert.equal(result.diagnostics.rejectedToolCalls,1);assert.equal(result.toolTrace[1].status,'rejected');
});

test('Daisy 收到原始问题和同一份结构化请求，首轮搜索不污染对象',async()=>{
 const requests=[];let searches=0;
 const request={originalText:'根据小米最新发布的手机报道，我要这个新的手机的型号。',resolvedQuestion:'根据小米最新发布的手机报道，我要这个新的手机的型号。',brand:'小米',category:'手机',explicitModel:'',requestedFields:['型号'],timeScope:'latest',region:'',entityCandidates:[],ambiguities:[],provenance:{brand:'user',category:'user'}};
 const provider={id:'deepseek',async streamWithTools(messages){requests.push(structuredClone(messages));if(requests.length===1)return {content:'',toolCalls:[call('s1','search_web',{query:'latest phone'})]};return {content:'小米官方手机页面列出型号[1]。',toolCalls:[]};},async search(query){searches++;assert.match(query,/latest phone/);assert.match(query,/小米/);assert.match(query,/手机/);return {performed:true,sources:[{title:'Xiaomi phone lineup',url:'https://www.mi.com/global/product-list/phone/',snippet:'Xiaomi 手机型号列表。'}],synthesis:'Xiaomi 手机型号列表。'};}};
 await answerDaisyQuestion(provider,{text:request.resolvedQuestion,originalText:request.originalText,request});
 assert.equal(searches,1);
 assert.match(requests[0][0].content,/"brand":"小米"/);
 assert.match(requests[0].at(-1).content,/根据小米最新发布的手机报道/);
 assert.doesNotMatch(requests[0][0].content,/"brand":"根据小米最新发布"/);
});

test('模型首轮规划出的关键词保留在真实查询里，不被口语原句覆盖',async()=>{
 let turns=0,actualQuery='';
 const provider={id:'deepseek',async streamWithTools(){turns++;if(turns===1)return {content:'',toolCalls:[call('planned','search_web',{query:'小米 手机 最新发布 型号 官方'})]};return {content:'小米手机官方产品线资料[1]。',toolCalls:[]};},async search(query){actualQuery=query;return {performed:true,sources:[{title:'小米手机产品线',url:'https://www.mi.com/phone',snippet:'小米手机产品线型号列表。'}],synthesis:'小米手机产品线型号列表。'};}};
 const {result}=await answerDaisyQuestion(provider,{text:'帮我看一下小米最近发布的手机型号到底叫什么？'});
 assert.match(actualQuery,/小米/);assert.match(actualQuery,/手机/);assert.match(actualQuery,/型号/);assert.match(actualQuery,/最新/);assert.doesNotMatch(actualQuery,/帮我看一下|到底叫什么/);
 assert.equal(result.diagnostics.originalQuestion,'帮我看一下小米最近发布的手机型号到底叫什么？');
 assert.equal(result.diagnostics.resolvedQuestion,'帮我看一下小米最近发布的手机型号到底叫什么？');
 assert.equal(result.diagnostics.queries[0],actualQuery);
});

test('已有足够摘要后仍把工具交给模型，由模型决定是否需要读正文',async()=>{
 let turns=0,reads=0;const calls=[];
 const provider={id:'deepseek',async streamWithTools(_messages,options){turns++;calls.push(options);if(turns===1)return {content:'',toolCalls:[call('search','search_web',{query:'理想 i9 价格'})]};assert.equal(options.tools.some(item=>item.function.name==='read_webpage'),true);assert.equal(options.toolChoice,'auto');if(turns===2)return {content:'',toolCalls:[call('read','read_webpage',{url:'https://ir.lixiang.com/news-releases/li-i9'})]};return {content:'理想 i9 售价为36.98万元。[1]',toolCalls:[]};},async search(){return {performed:true,sources:[{title:'理想i9售价36.98万元',url:'https://ir.lixiang.com/news-releases/li-i9',snippet:'理想 i9 官方售价36.98万元。'}],synthesis:'理想 i9 官方售价36.98万元。'};}};
 const webpageTool={enabled:true,async read(){reads++;return {finalUrl:'https://ir.lixiang.com/news-releases/li-i9',title:'理想i9公告',text:'理想 i9 官方售价36.98万元。',fetchedAt:new Date().toISOString()};}};
 await answerDaisyQuestion(provider,{text:'理想 i9 多少钱？'},{webpageTool});
 assert.equal(turns,3);assert.equal(reads,1);
});

test('/api/agent 实际调用链把产品追问解析传入 Daisy，品牌和型号取自用户历史原话',async t=>{
 const captured=[];let turns=0;
 const provider={id:'deepseek',model:'test-model',simulated:true,async streamWithTools(messages){captured.push(structuredClone(messages));turns++;if(turns===1)return {content:'',toolCalls:[call('ctx-search','search_web',{query:'ignore'})]};if(turns===2)return {content:'',toolCalls:[call('ctx-search-more','search_web',{query:'理想i9官方续航'})]};return {content:'理想 i9 纯电SUV的续航，官方资料列为705公里[1]。',toolCalls:[]};},async search(){return {performed:true,sources:[{title:'Li Auto i9 electric SUV specifications',url:'https://www.lixiang.com/news/i9',snippet:'Li Auto i9是一款纯电SUV。理想 i9 CLTC续航705公里，标注为同一车型的数据。'}],synthesis:'Li Auto i9纯电SUV，CLTC续航705公里。'};}};
 const server=createServer({provider,weatherTool:{enabled:false},webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const history=[{role:'user',content:'帮我查一下理想i9汽车的参数'},{role:'assistant',content:'上一条模型说续航可能是900公里。'}];
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',text:'它的续航呢？',history,contextEvidence:[{sourceId:'source-123456789abc',title:'理想 i9 官方资料',url:'https://www.lixiang.com/i9?api_key=do-not-store',snippet:'官方资料确认理想 i9 为纯电 SUV。',evidenceState:'read'}],webSearch:true,cloudConsent:true})});
 const payload=await response.json();
 assert.equal(response.status,200);assert.equal(turns,3);
 const request=JSON.parse(captured[0][0].content.match(/结构化请求.*?：(\{.*?\})。模型之前/s)[1]);
 assert.equal(request.originalText,'它的续航呢？');assert.match(request.resolvedQuestion,/理想\s*i9/);assert.equal(request.brand,'理想');assert.equal(request.explicitModel,'i9');assert.equal(request.provenance.explicitModel,'context');
 assert.match(captured[0].at(-1).content,/它的续航呢/);assert.match(payload.text,/705公里/,JSON.stringify({quality:payload.search.quality,sources:payload.search.sources}));
 assert.match(JSON.stringify(request.contextEvidence),/官方资料确认理想 i9/);assert.doesNotMatch(JSON.stringify(request.contextEvidence),/api_key|do-not-store/);
});

test('模型过早给出文字时，证据仍缺关键字段且预算充足会有界补查',async()=>{
 let turns=0,searches=0;const requests=[];
 const provider={id:'deepseek',async streamWithTools(messages){turns++;requests.push(structuredClone(messages));if(turns===1)return {content:'',toolCalls:[call('s1','search_web',{query:'小米最新手机 价格 配置'})]};if(turns===2)return {content:'小米17是最新手机，价格为5999元，其他配置见[1]。',toolCalls:[]};if(turns===3)return {content:'',toolCalls:[call('s2','search_web',{query:'小米最新手机 官方 发布时间'})]};return {content:'小米17页面列出部分参数[1]。',toolCalls:[]};},async search(query){searches++;return searches===1?{performed:true,sources:[{title:'Xiaomi 17 specs',url:'https://www.mi.com/global/product/xiaomi-17/',snippet:'Xiaomi 17 芯片与电池参数。'}],synthesis:'Xiaomi 17 芯片与电池参数。'}:{performed:true,sources:[{title:'Xiaomi phone releases',url:'https://www.mi.com/global/discover/news/',snippet:'Xiaomi 于2026年发布新款手机。'}],synthesis:'小米手机发布时间资料。'};}};
 const request={originalText:'小米最新手机的价格和配置',resolvedQuestion:'小米最新手机的价格和配置',brand:'小米',category:'手机',explicitModel:'',requestedFields:['价格','配置'],timeScope:'latest',entityCandidates:[],ambiguities:[],provenance:{brand:'user',category:'user'}};
 const {result}=await answerDaisyQuestion(provider,{text:request.resolvedQuestion,originalText:request.originalText,request},{maxToolCalls:3});
 assert.equal(turns,5);assert.equal(searches,2);
 assert.match(requests[2].map(item=>item.content||'').join('\n'),/仍缺|缺少|尚未确认|证据缺口/);
 assert.equal(result.diagnostics.proposedToolCalls,2);
 assert.equal(result.diagnostics.executedToolCalls,2);
 assert.equal(result.toolCalls,2);
});

test('疑似ASR型号会先查有限候选；有多个结果时程序阻止先报候选价格',async()=>{
 const {resolveQuestionContext}=await import('../src/agent/question-context.mjs');let turns=0,searchQuery='';
 const original='帮我查一下小米18放的这个用型号的价格以及所有的相关配置。',context=resolveQuestionContext(original,[]);
 const provider={id:'deepseek',async streamWithTools(){turns++;if(turns===1)return {content:'',toolCalls:[call('ambiguous','search_web',{query:original})]};return {content:'小米18 Pro售价5999元，小米18 Ultra售价6999元。',toolCalls:[]};},async search(query){searchQuery=query;return {performed:true,sources:[{title:'小米18 Pro手机参数',url:'https://www.mi.com/phone/18-pro',snippet:'小米18 Pro手机售价5999元，配置详情。'},{title:'Xiaomi 18 Ultra smartphone',url:'https://www.mi.com/global/phone/18-ultra',snippet:'Xiaomi 18 Ultra 手机售价6999元，配置详情。'}],synthesis:'小米18 Pro售价5999元；Xiaomi 18 Ultra售价6999元。'};}};
 const {answer}=await answerDaisyQuestion(provider,{text:context.request.resolvedQuestion,originalText:original,request:context.request});
 assert.match(searchQuery,/小米\s+18/);assert.doesNotMatch(searchQuery,/放的这个用/);
 assert.match(answer.text,/小米18 Pro/);assert.match(answer.text,/Xiaomi 18 Ultra/);assert.match(answer.text,/请告诉我要查的型号/);assert.doesNotMatch(answer.text,/5999|6999/);
});

test('来源只支持一个型号候选时，将候选按证据确认并停止无谓追问',async()=>{
 const {resolveQuestionContext}=await import('../src/agent/question-context.mjs');const original='帮我查一下小米18放的型号参数。',context=resolveQuestionContext(original,[]);let turns=0;const prompts=[];
 const provider={id:'deepseek',async streamWithTools(messages){turns++;prompts.push(structuredClone(messages[0].content));if(turns===1)return {content:'',toolCalls:[call('candidate-search','search_web',{query:original})]};return {content:'小米 18 Ultra 是该来源中唯一匹配的候选机型。[1]',toolCalls:[]};},async search(){return {performed:true,sources:[{title:'小米 18 Ultra 产品页',url:'https://www.mi.com/phone/18-ultra',snippet:'Xiaomi 18 Ultra smartphone 官方产品页面。'}],synthesis:'Xiaomi 18 Ultra smartphone 官方产品页面。'};}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:context.query,originalText:original,request:context.request});
 assert.equal(result.toolCalls,1);assert.match(prompts[1],/search-evidence/);assert.match(answer.text,/18 Ultra/);assert.doesNotMatch(answer.text,/请补充或重说型号/);assert.equal(result.diagnostics.evidenceDecisions[1].resolvedCandidates.length,1);
});

test('取消时停止后续模型与工具调用',async()=>{
  const controller=new AbortController();let searches=0;
  const provider={id:'deepseek',async streamWithTools(){return {content:'',toolCalls:[call('c1','search_web',{query:'天气'})]};},async search(){searches++;controller.abort();throw new DOMException('Aborted','AbortError');}};
  await assert.rejects(answerDaisyQuestion(provider,{text:'帮我查一下天气'},{signal:controller.signal}),{name:'AbortError'});
  assert.equal(searches,1);
});

test('真实 HTTP Agent 路由向 React 推送工具进度和回答片段，最后只交付一次结果',async t=>{
  let calls=0;const provider={id:'deepseek',model:'deepseek-flash',simulated:true,endpoint:'https://api.deepseek.com/chat/completions',async streamWithTools(_messages,{onDelta}){calls++;if(calls===1)return {content:'',toolCalls:[call('c1','get_weather',{intent:{intent:'weather'}})]};onDelta?.('张家港');onDelta?.('明天有雨[1]');return {content:'张家港明天有雨[1]',toolCalls:[]};}};
  const weatherTool={enabled:true,async query(){return {status:'ok',provider:'test-weather',period:'tomorrow',timezone:'Asia/Shanghai',location:{name:'张家港',country:'中国'},forecast:{date:'2026-09-29',condition:'雨',temperatureMax:25,temperatureMin:19,precipitationProbabilityMax:80,windSpeedMax:10},sources:[{title:'天气数据',url:'https://weather.example/forecast'}]};}};
  const server=createServer({provider,weatherTool,webpageTool:{enabled:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({mode:'chat',text:'张家港明天天气怎么样',webSearch:true,cloudConsent:true})});
  const lines=(await response.text()).trim().split('\n').map(JSON.parse),deltas=lines.filter(item=>item.type==='answer_delta').map(item=>item.text),result=lines.filter(item=>item.type==='result');
  assert.deepEqual(deltas,['张家港','明天有雨[1]']);assert.equal(result.length,1);assert.equal(result[0].data.search.engine,'daisy-tools');assert.equal(result[0].data.search.usedSourceIds.length,1);assert.equal(calls,2);
});

test('“南京呢”由结构化请求强制带地点调用天气工具，不接受模型猜测',async()=>{
 let turns=0,seen;const registry={list:()=>[{name:'get_weather',description:'查询天气',parameters:{type:'object',properties:{intent:{type:'object'}}}}],async execute(name,args){seen={name,args};return {success:true,callId:'weather-1',status:'needs-location',data:{status:'needs-location',question:'天气服务没有取得南京对应数据'}};}};
 const provider={id:'test',async streamWithTools(_messages,options){turns++;if(!turns){throw Error('unreachable');}if(turns===1){assert.equal(options.toolChoice.function.name,'get_weather');return {content:'',toolCalls:[call('w','get_weather',{intent:{location:'杭州'}})]};}return {content:'南京现在23.5℃[1]',toolCalls:[]};}};
 const request={intent:'weather',originalText:'南京呢？',resolvedQuestion:'南京天气',location:'南京',weather:{location:'南京',period:'current-today',timezone:'Asia/Shanghai'},queryConstraints:{publicSearch:true}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:'南京天气',originalText:'南京呢？',request,webSearch:true},{registry});
 assert.equal(seen.name,'get_weather');assert.equal(seen.args.intent.location,'南京');assert.equal(result.performed,false);assert.match(answer.text,/没有取得南京对应数据/);assert.doesNotMatch(answer.text,/23\.5/);
});

test('本机生产HTTP链路：那杭州呢、跨轮改口都把完整规范参数交给天气工具',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'talkcraft-weather-context-http-')),historyStore=createHistoryStore(join(dir,'history'));
 let providerStep=0;const actual=[];
 const provider={id:'mock',simulated:true,async streamWithTools(){if(providerStep++%2===0)return {content:'',toolCalls:[call(`w${providerStep}`,'get_weather',{intent:{intent:'weather',location:'无效模型猜测'}})]};return {content:'已按指定地点和范围查询。',toolCalls:[]};}};
 const weatherTool={enabled:true,async query(intent){actual.push({location:intent.location,period:intent.period});return {status:'ok',provider:'test-weather',period:intent.period,timezone:'Asia/Shanghai',location:{name:intent.location},forecast:{date:'2026-10-01',condition:'晴',temperatureMax:25,temperatureMin:18},...(intent.period==='next-seven-days'?{forecasts:[{date:'2026-10-01',condition:'晴'}]}:{}),sources:[{title:'隔离天气测试资料',url:'https://weather.example/forecast'}]};}};
 const server=createServer({history:historyStore,provider,weatherTool,webpageTool:{enabled:false},usageStore:{record:async()=>{}},workspace:{read:async()=>({preferences:{theme:'light',saveHistory:false},history:[]}),update:async()=>{}},textSettings:{read:async()=>({}),update:async()=>{}},commercialBridge:{identity:async()=>({kind:'guest'})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,sessionId='weather-followup-http';
 async function ask(text,history){const response=await fetch(`${base}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({mode:'chat',webSearch:true,text,history,sessionId})});assert.equal(response.status,200);return response.json();}
 const first=await ask('南京今天的天气怎么样？',[]);
 const second=await ask('那杭州呢？',[{role:'user',content:'南京今天的天气怎么样？'},{role:'assistant',content:first.text}]);
 const third=await ask('哦不对，未来一周。',[{role:'user',content:'南京今天的天气怎么样？'},{role:'assistant',content:first.text},{role:'user',content:'那杭州呢？'},{role:'assistant',content:second.text}]);
 assert.deepEqual(actual,[{location:'南京',period:'current-today'},{location:'杭州',period:'current-today'},{location:'杭州',period:'next-seven-days'}]);
 assert.equal(first.search.status,'weather-data');assert.equal(second.search.status,'weather-data');assert.equal(third.search.status,'weather-data');
});

test('天气工具未配置或没有数据时，模型正文不能制造实时温度',async()=>{
 const provider={id:'test',async streamWithTools(){return {content:'杭州当前晴天，气温23.5℃。',toolCalls:[]};}};const request={intent:'weather',originalText:'杭州呢',resolvedQuestion:'杭州天气',location:'杭州',weather:{location:'杭州',period:'current-today'}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:'杭州天气',request,webSearch:true},{registry:{list:()=>[],execute:async()=>{throw Error('must not execute');}}});
 assert.equal(result.performed,false);assert.match(answer.text,/没有取得|无法提供|没有提供/);assert.doesNotMatch(answer.text,/23\.5|当前晴天/);
});

test('个人偏好查询不注册或调用公开搜索工具',async()=>{
 let searched=0;const provider={id:'test',async streamWithTools(messages,options){assert.deepEqual(options.tools,[]);assert.equal(options.toolChoice,'none');assert.match(messages[0].content,/本次会话事实|个人记忆|私有/);return {content:'你本次对话说喜欢香蕉；偶尔吃苹果。',toolCalls:[]};},async search(){searched++;throw Error('private query leaked');}};
 const request={intent:'personal-memory',originalText:'你记得我喜欢什么水果吗？',resolvedQuestion:'用户事实',sessionFacts:[{predicate:'likes-eating',object:'香蕉',frequency:'unspecified',confirmedByUser:true}],queryConstraints:{publicSearch:false}};
 const {result,answer}=await answerDaisyQuestion(provider,{text:'用户事实',originalText:request.originalText,request,webSearch:true});assert.equal(searched,0);assert.equal(result.tool,'none');assert.equal(result.status,'memory-only');assert.equal(result.memory.sessionFacts[0].object,'香蕉');assert.match(answer.text,/香蕉/);
});
