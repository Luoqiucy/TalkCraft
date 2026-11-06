import test from 'node:test';
import assert from 'node:assert/strict';
import {answerDaisyQuestion} from '../src/agent/daisy-question.mjs';
import {resolveQuestionContext} from '../src/agent/question-context.mjs';
import {createServer} from '../server.mjs';
import {createJsonTextProvider} from '../src/providers/ark.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHistoryStore} from '../src/local-history.mjs';

const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const now=new Date('2026-11-06T10:00:00+08:00');
const ask=(provider,question,options={})=>{const context=resolveQuestionContext(question,[],{now});return answerDaisyQuestion(provider,{text:context.query,originalText:question,request:context.request,webSearch:true},{now,...options});};
const searchThenAnswer=(answerText,sources)=>{const state={turns:0};state.provider={id:'deepseek',async streamWithTools(){state.turns++;if(state.turns===1)return {content:'',toolCalls:[call('s1','search_web',{query:'q'})]};return {content:answerText,toolCalls:[]};},async search(){return {performed:true,sources};}};return state;};

test('实时问题的有引用回答被保留，不再被替换成“资料不足”，也不多跑一轮',async()=>{
 const cases=[
  ['OpenAI最近发布了什么新模型？',{title:'OpenAI 发布 GPT-5.5',url:'https://openai.com/index/gpt-5-5/',snippet:'OpenAI 于 2026 年 10 月 20 日发布 GPT-5.5。',publishedAt:'2026-10-20'},'OpenAI 最近发布了 GPT-5.5（2026年10月20日）[1]。'],
  ['今天美元兑人民币汇率是多少',{title:'美元兑人民币汇率',url:'https://www.boc.cn/sourcedb/whpj/',snippet:'中国银行外汇牌价 2026-11-06 美元 现汇买入价 712.35'},'今天美元现汇买入价约 712.35/100 美元[1]。'],
  // English page for a Chinese question: word overlap is zero, the model reads it correctly.
  ['英伟达股价现在多少',{title:'NVIDIA (NVDA) Stock Price',url:'https://finance.yahoo.com/quote/NVDA/',snippet:'NVIDIA Corporation (NVDA) 182.50 +1.2% At close: November 5 2026'},'英伟达最新收盘价约 182.50 美元[1]。'],
 ];
 for(const [question,source,text] of cases){const state=searchThenAnswer(text,[source]);const {answer}=await ask(state.provider,question);assert.equal(answer.text,text,question);assert.equal(state.turns,2,question);}
});

test('没有引用来源的肯定回答会被提示或替换，已说明查不到的回答原样保留',async()=>{
 const nvidia={title:'NVIDIA (NVDA) Stock Price',url:'https://finance.yahoo.com/quote/NVDA/',snippet:'NVIDIA Corporation (NVDA) 182.50 At close: November 5 2026'};
 const flagged=await ask(searchThenAnswer('英伟达股价是182.5美元。',[nvidia]).provider,'英伟达股价现在多少');
 assert.match(flagged.answer.text,/^英伟达股价是182\.5美元。/);assert.match(flagged.answer.text,/没有引用本次查到的来源/);
 const empty=await ask(searchThenAnswer('英伟达股价是182.5美元。',[]).provider,'英伟达股价现在多少');
 assert.doesNotMatch(empty.answer.text,/182\.5/);assert.match(empty.answer.text,/没有取得可以引用的相关资料/);
 const honest=await ask(searchThenAnswer('暂时没有找到英伟达今天的实时股价。',[]).provider,'英伟达股价现在多少');
 assert.equal(honest.answer.text,'暂时没有找到英伟达今天的实时股价。');
});

test('泛新闻问法不把时间词或话题当公司名，今天只查当天',()=>{
 for(const [question,days,topic] of [['帮我查一下今日新闻',1,undefined],['今天有什么新闻',1,undefined],['给我讲讲最新的国际新闻',7,'国际'],['最近AI圈有什么大新闻',7,'AI'],['体育新闻',7,'体育'],['昨天有什么财经新闻',2,'财经']]){
  const {request}=resolveQuestionContext(question,[],{now});
  assert.equal(request.intent,'news-search',question);assert.equal(request.news.company,'',question);assert.equal(request.news.lookbackDays,days,question);assert.equal(request.news.topic,topic,question);
 }
 for(const [question,company] of [['特斯拉最近有什么消息','特斯拉'],['华为最近有什么新闻','华为'],['国内新闻热点，比如百度公司。','百度']])assert.equal(resolveQuestionContext(question,[],{now}).request.news.company,company,question);
});

test('新闻来源不在时间范围内时保留有引用的回答并加日期提示，不再套用“型号”话术',async()=>{
 let turns=0;const provider={id:'deepseek',async streamWithTools(){turns++;if(turns===1)return {content:'',toolCalls:[call('n1','search_web',{query:'华为 新闻'})]};return {content:'华为发布了新款折叠屏手机[1]。',toolCalls:[]};},async search(){return {performed:true,sources:[{title:'华为发布新款折叠屏',url:'https://news.example/huawei',publishedAt:'2026-08-01',snippet:'华为于2026年8月1日发布新款折叠屏手机，并公布了上市计划。'}]};}};
 const {answer}=await ask(provider,'华为最近有什么新闻');
 assert.match(answer.text,/^华为发布了新款折叠屏手机\[1\]。/);assert.match(answer.text,/以来源标注的发布日期为准/);assert.doesNotMatch(answer.text,/型号/);
});

test('一轮并行调用超出剩余预算时执行能放下的部分，并用已得资料作答',async()=>{
 let turns=0,searches=0;
 const provider={id:'deepseek',async streamWithTools(_messages,options){turns++;if(turns===1)return {content:'',toolCalls:[call('a','search_web',{query:'特斯拉 股价'}),call('b','search_web',{query:'比亚迪 股价'}),call('c','search_web',{query:'蔚来 股价'})]};assert.deepEqual(options.tools,[]);return {content:'特斯拉收于250美元[1]，比亚迪收于98港元[2]；蔚来本次未查询。',toolCalls:[]};},async search(query){searches++;return {performed:true,sources:[{title:`${query} 2026-11-05`,url:`https://quote.example/${searches}`,snippet:`${query}：2026-11-05 收盘价公布。`}]};}};
 const {result,answer}=await ask(provider,'帮我查一下特斯拉、比亚迪和蔚来今天的股价',{maxToolCalls:2});
 assert.equal(searches,2);assert.equal(result.toolCalls,2);assert.equal(result.diagnostics.rejectedToolCalls,1);assert.equal(result.terminationReason,'call-limit');
 assert.match(answer.text,/特斯拉收于250美元\[1\]/);
});

test('提议次数超限时追加一次不带工具的整理回合，而不是返回“未取得足够信息”',async()=>{
 let turns=0,searches=0;
 const provider={id:'deepseek',async streamWithTools(messages,options){turns++;if(/已达本次上限/.test(messages.at(-1).content||'')){assert.deepEqual(options.tools,[]);return {content:'根据已查资料，A 公司今天发布了财报[1]。',toolCalls:[]};}return {content:'',toolCalls:[1,2,3].map(n=>call(`c${turns}-${n}`,'search_web',{query:`A公司 财报 ${turns}-${n}`}))};},async search(query){searches++;return {performed:true,sources:[{title:query,url:`https://ir.example/${searches}`,snippet:'A 公司 2026-11-06 发布第三季度财报。'}]};}};
 const {result,answer}=await ask(provider,'帮我查一下A公司今天发布的财报',{maxToolCalls:2});
 assert.equal(searches,2);assert.equal(result.terminationReason,'proposal-limit');assert.equal(result.diagnostics.finalSynthesis,true);
 assert.equal(answer.text,'根据已查资料，A 公司今天发布了财报[1]。');
});

test('搜索后并行预读摘要过短的网页，把正文深处的相关段落交给模型，重复读取走缓存',async()=>{
 const urls=['https://museum.example/a','https://museum.example/b','https://museum.example/c'];let reads=0,turns=0,searchPayload='';
 const filler='首页 导航 关于我们 新闻动态 展览 教育 文创 联系我们 版权所有。'.repeat(60);
 const webpageTool={enabled:true,async read(url){reads++;return {finalUrl:url,title:'苏州博物馆参观须知',text:`${filler}\n\n参观须知：开放时间为周二至周日 9:00—17:00，16:00 停止入馆，周一闭馆。\n\n${filler}`,fetchedAt:'2026-11-06T02:00:00.000Z'};}};
 const provider={id:'deepseek',async streamWithTools(messages){turns++;if(turns===1)return {content:'',toolCalls:[call('s','search_web',{query:'苏州博物馆 开放时间'})]};if(turns===2){searchPayload=messages.at(-1).content;return {content:'',toolCalls:[call('r','read_webpage',{url:urls[0]})]};}return {content:'苏州博物馆周二至周日 9:00—17:00 开放，周一闭馆[1]。',toolCalls:[]};},async search(){return {performed:true,sources:urls.map((url,i)=>({url,title:`苏州博物馆 ${i}`,snippet:'苏州博物馆官方网站'}))};}};
 const {result,answer}=await ask(provider,'苏州博物馆的开放时间是什么',{webpageTool,prefetchPages:2});
 assert.match(searchPayload,/周一闭馆/);assert.equal(reads,2);assert.equal(result.diagnostics.prefetchedPages,2);
 assert.equal(result.toolCalls,2);assert.equal(result.toolTrace.filter(item=>item.prefetch).length,2);assert.ok(result.toolTrace.some(item=>item.cached));
 assert.equal(result.sources[0].evidenceState,'read');assert.match(answer.text,/周一闭馆\[1\]/);
});

test('预读网页超时记为失败并跳过，不把整个任务标成取消',async()=>{
 const webpageTool={enabled:true,read(_url,{signal}){return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}};
 const events=[];const state=searchThenAnswer('苏州博物馆周一闭馆[1]。',[{url:'https://slow.example/page',title:'苏州博物馆',snippet:'苏州博物馆官方网站'}]);
 const {result,answer}=await ask(state.provider,'苏州博物馆的开放时间是什么',{webpageTool,prefetchPages:1,prefetchTimeoutMs:50,onStatus:event=>events.push(event)});
 const prefetch=result.toolTrace.find(item=>item.prefetch);assert.equal(prefetch.status,'failed');assert.match(prefetch.error,/读取超时/);
 assert.ok(!events.some(event=>event.status==='cancelled'));assert.equal(result.sources[0].evidenceState,'read-failed');assert.match(answer.text,/周一闭馆/);
});

test('回答边生成边推送；工具调用前的开场白会被撤回',async()=>{
 let release,turns=0;const hold=new Promise(resolve=>{release=resolve;});const deltas=[];let resets=0,firstDelta;const gotFirst=new Promise(resolve=>{firstDelta=resolve;});
 const provider={id:'deepseek',async streamWithTools(_messages,{onDelta}){turns++;if(turns===1){onDelta('我先查一下。');return {content:'我先查一下。',toolCalls:[call('s','search_web',{query:'苏州博物馆 开放时间'})]};}onDelta('苏州博物馆');await hold;onDelta('周一闭馆[1]。');return {content:'苏州博物馆周一闭馆[1]。',toolCalls:[]};},async search(){return {performed:true,sources:[{url:'https://museum.example/a',title:'苏州博物馆',snippet:'苏州博物馆周一闭馆，周二至周日开放。'}]};}};
 const running=ask(provider,'苏州博物馆的开放时间是什么',{onDelta:text=>{deltas.push(text);if(text==='苏州博物馆')firstDelta();},onReset:()=>{resets++;deltas.length=0;}});
 const early=await Promise.race([gotFirst.then(()=>'streamed'),new Promise(resolve=>setTimeout(()=>resolve('buffered'),1000))]);
 assert.equal(early,'streamed');assert.deepEqual(deltas,['苏州博物馆']);release();
 const {answer,result}=await running;
 assert.equal(resets,1);assert.equal(deltas.join(''),answer.text);assert.equal(result.diagnostics.streamedLive,true);
});

test('天气工具没有数据时，模型编造的温度不会被实时推送到界面',async()=>{
 let turns=0;const deltas=[];
 const provider={id:'deepseek',async streamWithTools(_messages,{onDelta}){turns++;if(turns===1)return {content:'',toolCalls:[call('w','get_weather',{intent:{intent:'weather'}})]};onDelta('杭州当前23.5℃');return {content:'杭州当前23.5℃',toolCalls:[]};}};
 const weatherTool={enabled:true,async query(){return {status:'needs-location',question:'天气服务没有取得杭州对应数据'};}};
 const {answer}=await ask(provider,'杭州今天天气怎么样',{weatherTool,onDelta:text=>deltas.push(text)});
 assert.ok(!deltas.join('').includes('23.5'));assert.doesNotMatch(answer.text,/23\.5/);
});

test('超出来源数量的引用序号被删除，不留下点不开的引用',async()=>{
 const state=searchThenAnswer('苏州博物馆周一闭馆[1]，门票免费[7]。',[{url:'https://museum.example/a',title:'苏州博物馆',snippet:'苏州博物馆周一闭馆，免费参观。'}]);
 const {answer}=await ask(state.provider,'苏州博物馆的开放时间是什么');
 assert.equal(answer.text,'苏州博物馆周一闭馆[1]，门票免费。');
});

test('/api/agent 在撤回开场白时向界面发送 answer_reset',async t=>{
 let turns=0;const provider={id:'deepseek',model:'test',simulated:true,async streamWithTools(_messages,{onDelta}){turns++;if(turns===1){onDelta('我先查一下。');return {content:'我先查一下。',toolCalls:[call('s','search_web',{query:'苏州博物馆 开放时间'})]};}onDelta('苏州博物馆周一闭馆[1]。');return {content:'苏州博物馆周一闭馆[1]。',toolCalls:[]};},async search(){return {performed:true,sources:[{url:'https://museum.example/a',title:'苏州博物馆',snippet:'苏州博物馆周一闭馆。'}]};}};
 // Temp history so the test never opens the user's real data directory.
 const dir=await mkdtemp(join(tmpdir(),'talkcraft-agent-reset-'));const server=createServer({history:createHistoryStore(join(dir,'history')),provider,weatherTool:{enabled:false},webpageTool:{enabled:false},usageStore:{record:async()=>{}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({mode:'chat',text:'苏州博物馆的开放时间是什么',webSearch:true,cloudConsent:true})});
 const lines=(await response.text()).trim().split('\n').map(JSON.parse),answerLines=lines.filter(item=>item.type.startsWith('answer_'));
 assert.deepEqual(answerLines.map(item=>item.type),['answer_delta','answer_reset','answer_delta']);assert.equal(answerLines.at(-1).text,'苏州博物馆周一闭馆[1]。');assert.equal(lines.at(-1).data.text,'苏州博物馆周一闭馆[1]。');
});

test('流式调用请求用量统计，并记录缓存命中的输入词元',async()=>{
 const encoder=new TextEncoder();let body;
 const events=[{choices:[{delta:{content:'好'}}]},{usage:{prompt_tokens:20,completion_tokens:1,total_tokens:21,prompt_cache_hit_tokens:7},choices:[]}];
 const fetchImpl=async(_url,options)=>{body=JSON.parse(options.body);return new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode(events.map(item=>`data: ${JSON.stringify(item)}\n\n`).join('')+'data: [DONE]\n'));controller.close();}}),{status:200});};
 const provider=createJsonTextProvider({id:'deepseek',endpoint:'https://api.deepseek.com/chat/completions',apiKey:'test-key',model:'m',fetchImpl});
 const result=await provider.streamWithTools([{role:'user',content:'你好'}],{});
 assert.deepEqual(body.stream_options,{include_usage:true});assert.equal(result.usage.inputTokens,20);assert.equal(result.usage.cacheReadInputTokens,7);
});
