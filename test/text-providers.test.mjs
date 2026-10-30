import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createOpenAIProvider,createDeepSeekProvider,createOllamaProvider} from '../src/providers/text.mjs';
import {loadProvider,providerStatus} from '../src/config.mjs';
import {createServer} from '../server.mjs';
async function listen(t,server){await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));return `http://127.0.0.1:${server.address().port}`;}
for(const [id,create,endpoint] of [['openai',createOpenAIProvider,'https://api.openai.com/v1/chat/completions'],['deepseek',createDeepSeekProvider,'https://api.deepseek.com/chat/completions'],['ollama',createOllamaProvider,'http://127.0.0.1:11434/api/chat']]){
 test(`${id} 本地 HTTP 上游替身验证消息、鉴权、固定端点和结果`,async t=>{
  let request;const url=await listen(t,http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);request={headers:req.headers,body:JSON.parse(Buffer.concat(chunks))};res.end(JSON.stringify(id==='ollama'?{message:{content:'预算1200元，不提前发布。'}}:{choices:[{message:{content:'预算1200元，不提前发布。'}}]}));}));
  const p=create({apiKey:'fake-key',model:'test-model',fetchImpl:(address,options)=>{assert.equal(address,endpoint);assert.equal(options.redirect,'error');return fetch(url,options);}});
  const messages=[{role:'user',content:'预算1200元，不提前发布'}];assert.equal(await p.complete(messages),'预算1200元，不提前发布。');assert.deepEqual(request.body,{model:'test-model',messages,stream:false});assert.equal(request.headers.authorization,id==='ollama'?undefined:'Bearer fake-key');assert.equal(p.id,id);
 });
 test(`${id} 安全错误、超时与用户取消无静默降级`,async()=>{
  const options={apiKey:'fake-key',model:'test-model'};
  for(const body of ['secret fake-key','{}','x'.repeat(1048577)]) await assert.rejects(create({...options,fetchImpl:async()=>new Response(body)}).complete([]),e=>e.status===502 && !e.message.includes('fake-key'));
  const wait=(_url,{signal})=>new Promise((r,j)=>{if(signal.aborted)j(signal.reason);else signal.addEventListener('abort',()=>j(signal.reason),{once:true});});
  await assert.rejects(create({...options,timeoutMs:20,fetchImpl:wait}).complete([]),e=>e.status===504);
  const controller=new AbortController();const pending=create({...options,fetchImpl:wait}).complete([],{signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');
 });
}
test('提供器环境配置、缺失凭据和本机地址校验',()=>{
 for(const id of ['openai','deepseek']){const prefix=id.toUpperCase();assert.equal(loadProvider({TEXT_PROVIDER:id,[`${prefix}_API_KEY`]:'fake',[`${prefix}_MODEL`]:'test'}).id,id);assert.throws(()=>loadProvider({TEXT_PROVIDER:id}));}
 const p=loadProvider({TEXT_PROVIDER:'ollama',OLLAMA_MODEL:'test'});assert.deepEqual(providerStatus(p),{provider:'ollama',simulated:false,audioTranscription:false,local:true});assert.throws(()=>loadProvider({TEXT_PROVIDER:'ollama'}));
 for(const baseUrl of ['https://localhost','http://evil.example','http://user:pass@localhost','http://localhost/api','http://localhost/?secret=1','http://localhost/#x','bad'])assert.throws(()=>createOllamaProvider({baseUrl,model:'test'}));
 assert.equal(createOllamaProvider({baseUrl:'http://localhost:12345',model:'test'}).local,true);
});
test('文字提供器元数据记录固定直连地址、请求模型与上游返回模型，不含密钥',async()=>{
 const provider=createDeepSeekProvider({apiKey:'fake-secret',model:'requested-model',fetchImpl:async()=>new Response(JSON.stringify({model:'returned-model',choices:[{message:{content:'回答'}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}}))});
 const result=await provider.complete([{role:'user',content:'问题'}],{withMetadata:true});assert.equal(provider.endpoint,'https://api.deepseek.com/chat/completions');assert.equal(provider.transport,'direct');assert.equal(result.responseModel,'returned-model');assert.equal(result.text,'回答');assert.ok(!JSON.stringify({provider,result}).includes('fake-secret'));
});
test('云端与Ollama使用各自协议传递输出预算并记录真实模型耗时',async()=>{
 for(const [id,create] of [['deepseek',createDeepSeekProvider],['ollama',createOllamaProvider]]){let body;const provider=create({apiKey:'fake',model:'test',fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return Response.json(id==='ollama'?{message:{content:'结果'}}:{choices:[{message:{content:'结果'}}]});}});const result=await provider.complete([{role:'user',content:'短问题'}],{withMetadata:true,maxTokens:321});assert.deepEqual(id==='ollama'?body.options:{max_tokens:body.max_tokens},id==='ollama'?{num_predict:321}:{max_tokens:321});assert.ok(Number.isFinite(result.elapsedMs));}
});
test('只有DeepSeek接收已验证的思考开关，其他提供器不被注入厂商参数',async()=>{
 for(const [id,create] of [['deepseek',createDeepSeekProvider],['openai',createOpenAIProvider],['ollama',createOllamaProvider]]){let body;const p=create({apiKey:'fake',model:'test',fetchImpl:async(_u,o)=>{body=JSON.parse(o.body);return Response.json(id==='ollama'?{message:{content:'结果'}}:{choices:[{message:{content:'结果'}}]});}});await p.complete([{role:'user',content:'整理'}],{reasoningEffort:'none'});assert.equal(body.thinking?.type,id==='deepseek'?'disabled':undefined);assert.equal(body.reasoning_effort,id==='deepseek'?'none':undefined);}
});
test('本机 Ollama 不要求云端授权；新云端提供器均强制授权',async t=>{
 for(const id of ['ollama','openai','deepseek']){let calls=0;const provider={id,simulated:false,...(id==='ollama'?{local:true}:{}),complete:async()=>{calls++;return '上游测试替身';}};const url=await listen(t,createServer({provider}));const send=cloudConsent=>fetch(`${url}/api/process`,{method:'POST',body:JSON.stringify({mode:'chat',text:'你好',cloudConsent})});assert.equal((await send(false)).status,id==='ollama'?200:400);assert.equal(calls,id==='ollama'?1:0);assert.equal((await send(true)).status,200);}
});
