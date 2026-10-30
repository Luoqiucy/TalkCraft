import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createArkProvider} from '../src/providers/ark.mjs';
import {loadProvider, providerStatus} from '../src/config.mjs';
import {createServer} from '../server.mjs';
const config = {apiKey:'test-not-a-real-key',model:'test-model'};
const messages = [{role:'user',content:'不要在9月15日前发布'}];
async function listen(t, server) {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  return `http://127.0.0.1:${server.address().port}`;
}
test('默认模拟、显式云端配置及缺失配置不静默降级', () => {
  assert.equal(loadProvider({}).simulated,true);
  assert.equal(loadProvider({TEXT_PROVIDER:'ark',ARK_API_KEY:config.apiKey,ARK_MODEL:config.model}).simulated,false);
  for (const env of [{TEXT_PROVIDER:'unknown'},{TEXT_PROVIDER:'ark'},{TEXT_PROVIDER:'ark',ARK_API_KEY:config.apiKey,ARK_MODEL:config.model,TEXT_TIMEOUT_MS:'bad'}]) assert.throws(() => loadProvider(env));
  const status = providerStatus(loadProvider({TEXT_PROVIDER:'ark',ARK_API_KEY:config.apiKey,ARK_MODEL:config.model}));
  assert.deepEqual(status,{provider:'ark',simulated:false,audioTranscription:false}); assert.ok(!JSON.stringify(status).includes(config.apiKey));
});
test('方舟请求经过真实本地HTTP传输，验证鉴权、模型、消息与响应读取（模拟上游）', async t => {
  let received;
  const url = await listen(t,http.createServer(async (req,res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = {headers:req.headers,body:JSON.parse(Buffer.concat(chunks).toString())};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'暂不发布。'}}]}));
  }));
  const provider = createArkProvider({...config,fetchImpl:(endpoint,options) => {
    assert.equal(endpoint,'https://ark.cn-beijing.volces.com/api/v3/chat/completions');assert.equal(options.redirect,'error');return fetch(url,options);
  }});
  assert.equal(await provider.complete(messages),'暂不发布。');
  assert.equal(received.headers.authorization,`Bearer ${config.apiKey}`);
  assert.deepEqual(received.body,{model:config.model,messages,stream:false});
});
test('鉴权、限流和服务失败不回显上游敏感内容', async () => {
  for (const status of [401,403,429,500]) {
    const provider = createArkProvider({...config,fetchImpl:async () => new Response(`secret ${config.apiKey}`,{status})});
    await assert.rejects(provider.complete(messages), error => !error.message.includes(config.apiKey) && error.status === (status === 429 ? 429 : 502));
  }
});
test('拒绝非法JSON、空文本和超大上游响应', async () => {
  for (const body of ['not json',JSON.stringify({choices:[]}),JSON.stringify({choices:[{message:{content:' '}}]}),'a'.repeat(1048577)]) {
    const provider = createArkProvider({...config,fetchImpl:async () => new Response(body)});
    await assert.rejects(provider.complete(messages),error => error.status === 502);
  }
});
test('网络异常信息不泄露给调用端', async () => {
  const provider = createArkProvider({...config,fetchImpl:async () => {throw new Error(config.apiKey);}});
  await assert.rejects(provider.complete(messages),/无法连接模型服务/);
});
const waitForAbort = (_url,{signal}) => new Promise((resolve,reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort',() => reject(signal.reason),{once:true});
});
test('网络等待超时返回504', async () => {
  const provider = createArkProvider({...config,timeoutMs:20,fetchImpl:waitForAbort});
  await assert.rejects(provider.complete(messages),error => error.status === 504 && /超时/.test(error.message));
});
test('用户取消传递到上游，不变成超时错误', async () => {
  const controller = new AbortController();
  const provider = createArkProvider({...config,fetchImpl:waitForAbort});
  const pending = provider.complete(messages,{signal:controller.signal}); controller.abort();
  await assert.rejects(pending,error => error.name === 'AbortError');
});
test('HTTP云端入口强制提交授权并返回安全状态', async t => {
  let calls = 0;
  const provider = {id:'ark',simulated:false,async complete(){calls++;return '云端测试替身';}};
  const url = await listen(t,createServer({provider}));
  const send = body => fetch(`${url}/api/process`,{method:'POST',body:JSON.stringify(body)});
  assert.deepEqual(await (await fetch(`${url}/api/status`)).json(),{provider:'ark',simulated:false,audioTranscription:false,weatherAvailable:true,webpageReadAvailable:true,agentEngine:'legacy',desktopService:false});
  assert.equal((await send({mode:'chat',text:'你好'})).status,400);assert.equal(calls,0);
  const response = await send({mode:'chat',text:'你好',cloudConsent:true}); assert.equal(response.status,200);assert.equal((await response.json()).simulated,false);assert.equal(calls,1);
  const badHostStatus = await new Promise((resolve,reject) => {
    const req = http.get(url,{headers:{Host:'evil.example'}},res => {res.resume();resolve(res.statusCode);});req.on('error',reject);
  });
  assert.equal(badHostStatus,403);
});
test('响应正文迟迟未结束时仍受超时限制', async t => {
  const url = await listen(t,http.createServer((req,res) => {
    res.writeHead(200,{'Content-Type':'application/json'});res.write('{"choices":');
  }));
  const provider = createArkProvider({...config,timeoutMs:100,fetchImpl:(_endpoint,options) => fetch(url,options)});
  await assert.rejects(provider.complete(messages),error => error.status === 504);
});
test('跨网络数据块的UTF8中文不被破坏', async t => {
  let received;
  const url = await listen(t,createServer({provider:{simulated:true,async complete(messages){received=messages.at(-1).content;return received;}}}));
  const body = Buffer.from(JSON.stringify({mode:'chat',text:'你好，预算1200元'}));
  const split = body.indexOf(Buffer.from('你')) + 1;
  await new Promise((resolve,reject) => {
    const req = http.request(`${url}/api/process`,{method:'POST'},res => {res.resume();res.on('end',resolve);}); req.on('error',reject);
    req.write(body.subarray(0,split));setTimeout(() => req.end(body.subarray(split)),10);
  });
  assert.equal(received,'你好，预算1200元');
});
test('浏览器断开后服务端取消在途上游请求', async t => {
  let startedResolve, cancelledResolve;
  const started = new Promise(resolve => {startedResolve=resolve;});
  const cancelled = new Promise(resolve => {cancelledResolve=resolve;});
  const url = await listen(t,createServer({provider:{simulated:true,complete(_messages,{signal}) {
    startedResolve();return new Promise((resolve,reject) => signal.addEventListener('abort',() => {cancelledResolve();reject(signal.reason);},{once:true}));
  }}}));
  const controller = new AbortController();
  const request = fetch(`${url}/api/process`,{method:'POST',body:JSON.stringify({mode:'chat',text:'你好'}),signal:controller.signal});
  await started;controller.abort();await assert.rejects(request,error => error.name === 'AbortError');
  await Promise.race([cancelled,new Promise((resolve,reject) => {const timer=setTimeout(() => reject(new Error('未取消上游')),1000);timer.unref();cancelled.then(() => clearTimeout(timer));})]);
});
