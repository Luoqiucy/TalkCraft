import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekProvider} from '../src/providers/text.mjs';
import {deepSeekSearchEndpoint,parseDeepSeekSearchResponse} from '../src/providers/deepseek-search.mjs';
import {buildMessages} from '../src/pipeline.mjs';
import {createServer} from '../server.mjs';

async function listen(t,server){await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));return `http://127.0.0.1:${server.address().port}`;}

const searchPayload={content:[
  {type:'server_tool_use',id:'tool-1',name:'web_search',input:{query:'DeepSeek 最新模型'}},
  {type:'web_search_tool_result',tool_use_id:'tool-1',content:[{type:'web_search_result',url:'https://api-docs.deepseek.com/news/news260910/',title:'DeepSeek-V4.1 Release',page_age:'2026-09-10'}]},
  {type:'text',text:'结果',citations:[{type:'web_search_result_location',url:'https://api-docs.deepseek.com/news/news260910/',title:'DeepSeek-V4.1 Release',cited_text:'官方发布'}]}
],model:'deepseek-v4.1-flash',usage:{input_tokens:120,output_tokens:30,server_tool_use:{web_search_requests:1}}};

test('DeepSeek 原生搜索使用 Anthropic 协议并以工具结果作为执行证据',async()=>{
 let captured;
 const provider=createDeepSeekProvider({apiKey:'fake-key',model:'deepseek-v4-flash',fetchImpl:async(url,options)=>{captured={url,options,body:JSON.parse(options.body)};return new Response(JSON.stringify(searchPayload));}});
 const result=await provider.search('DeepSeek 最新模型');
 assert.equal(captured.url,deepSeekSearchEndpoint);assert.equal(captured.options.headers['anthropic-version'],'2023-06-01');assert.equal(captured.body.tools[0].type,'web_search_20250305');assert.equal(captured.body.model,'deepseek-v4-flash');
 assert.equal(result.performed,true);assert.equal(result.status,'searched');assert.equal(result.sources[0].url,'https://api-docs.deepseek.com/news/news260910/');assert.equal(result.sources[0].snippet,'官方发布');assert.equal(result.synthesis,'结果');assert.equal(result.usage.webSearchRequests,1);assert.equal(result.responseModel,'deepseek-v4.1-flash');assert.match(captured.body.messages[0].content[0].text,/Current date and timezone: \d{4}-\d{2}-\d{2}, Asia\/Shanghai/);assert.match(captured.body.messages[0].content[0].text,/Do not silently replace/);
});

test('上游未返回 citations 时仍把真实搜索轮的可读摘要交给回答阶段',()=>{
 const url='https://weather.example/nanjing';const result=parseDeepSeekSearchResponse({content:[{type:'web_search_tool_result',content:[{type:'web_search_result',url,title:'南京天气'}]},{type:'text',text:'南京今天阴，最高28℃，最低22℃，数据更新于12:00。'}]});
 assert.equal(result.sources[0].snippet,undefined);assert.match(result.synthesis,/最高28℃/);
 const messages=buildMessages({mode:'chat',text:'南京天气怎么样？',webSearchResult:result});assert.match(messages[1].content,/工具资料[\s\S]*最高28℃/);assert.match(messages[1].content,/注明日期或更新时间/);
});

test('搜索结果按 URL 合并 citations.cited_text，供天气等实时回答读取具体值',()=>{
 const url='https://weather.example/nanjing';const result=parseDeepSeekSearchResponse({content:[{type:'web_search_tool_result',content:[{type:'web_search_result',url,title:'南京天气'}]},{type:'text',text:'南京天气',citations:[{url,cited_text:'南京今天晴，最高温度29℃，最低温度21℃。'},{url,cited_text:'重复内容不覆盖首条'}]}]});
 assert.equal(result.performed,true);assert.deepEqual(result.sources,[{url,title:'南京天气',snippet:'南京今天晴，最高温度29℃，最低温度21℃。'}]);
 const messages=buildMessages({mode:'chat',text:'南京天气怎么样？',webSearchResult:result});assert.match(messages[1].content,/最高温度29℃/);
});

test('请求搜索不等于已搜索；没有 web_search_tool_result 时不标记联网',()=>{
 const result=parseDeepSeekSearchResponse({content:[{type:'server_tool_use',name:'web_search'}],usage:{server_tool_use:{web_search_requests:0}}});
 assert.equal(result.requested,true);assert.equal(result.performed,false);assert.equal(result.status,'not-invoked');assert.deepEqual(result.sources,[]);
});

test('搜索材料只进入问答提示，听写和翻译保持离线语义',()=>{
 const search={performed:true,sources:[{title:'官方资料',url:'https://example.com',snippet:'资料摘要'}]};
 assert.match(buildMessages({mode:'chat',text:'问题',webSearchResult:search})[1].content,/不可信资料/);
 assert.equal(buildMessages({mode:'dictation',text:'问题',webSearchResult:search})[1].content,'问题');
});

test('HTTP 搜索证据令牌绑定问题且一次性使用，普通问答不会调用搜索',async t=>{
 let searches=0,completions=0;
 const provider={id:'deepseek',model:'test',simulated:false,search:async()=>{searches++;return {...parseDeepSeekSearchResponse(searchPayload),elapsedMs:12};},complete:async()=>{completions++;return {text:'带来源回答',usage:{inputTokens:10,outputTokens:5}};}};
 const url=await listen(t,createServer({provider,webpageTool:{enabled:false}}));
 const ordinary=await fetch(url+'/api/process',{method:'POST',body:JSON.stringify({mode:'chat',text:'普通问题',cloudConsent:true})});assert.equal(ordinary.status,200);assert.equal(searches,0);
 const searched=await fetch(url+'/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',query:'实时问题',cloudConsent:true})});const evidence=await searched.json();assert.equal(evidence.performed,true);assert.equal(searches,evidence.attempts);assert.ok(searches>=1&&searches<=3);
 const mismatch=await fetch(url+'/api/process',{method:'POST',body:JSON.stringify({mode:'chat',text:'篡改问题',cloudConsent:true,webSearch:true,searchId:evidence.searchId})});assert.equal(mismatch.status,400);
 const fresh=await fetch(url+'/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'chat',query:'实时问题',cloudConsent:true})});const validEvidence=await fresh.json();
 const answer=await fetch(url+'/api/process',{method:'POST',body:JSON.stringify({mode:'chat',text:'实时问题',cloudConsent:true,webSearch:true,searchId:validEvidence.searchId})});const result=await answer.json();assert.equal(answer.status,200);assert.equal(result.search.performed,true);assert.equal(result.search.sources.length,1);assert.equal(result.usage.inputTokens,10);
 const reused=await fetch(url+'/api/process',{method:'POST',body:JSON.stringify({mode:'chat',text:'实时问题',cloudConsent:true,webSearch:true,searchId:validEvidence.searchId})});assert.equal(reused.status,400);assert.equal(completions,2);
});
