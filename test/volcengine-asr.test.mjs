import {listenForFetch} from '../test-support/http-listen.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {gunzipSync} from 'node:zlib';
import {createVolcengineAsrProvider} from '../src/providers/volcengine-asr.mjs';
import {createAsrTransport} from '../src/providers/asr-transport.mjs';
import {loadAsr} from '../src/asr.mjs';
import {createServer} from '../server.mjs';
const env={VOLC_ASR_RESOURCE_ID:'volc.seedasr.sauc.duration',VOLC_ASR_APP_KEY:'fake-app',VOLC_ASR_ACCESS_KEY:'fake-access',ASR_TIMEOUT_MS:'2000'};
test('新版Key经过真实WebSocket传输和生产提供器，不发送旧鉴权头',async t=>{
 let observed;
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 server.on('connection',(socket,request)=>{observed=request.headers;socket.on('message',frame=>{if(frame[1]===0x22)socket.send(response(true));});});
 const p=createVolcengineAsrProvider({env:{...env,VOLC_ASR_API_KEY:'fake-new-key'},transportFactory:options=>createAsrTransport({...options,testUrl:`ws://127.0.0.1:${server.address().port}`})});
 assert.equal(await p.transcribe(Buffer.alloc(3200)),'预算1200元，不提前发布。');
 assert.equal(observed['x-api-key'],'fake-new-key');assert.equal(observed['x-api-app-key'],undefined);assert.equal(observed['x-api-access-key'],undefined);
});
function response(final=false){const payload=Buffer.from(JSON.stringify({result:{text:'预算1200元，不提前发布。'}}));const frame=Buffer.alloc(8+payload.length);frame.set([0x11,final?0x92:0x90,0x10,0]);frame.writeUInt32BE(payload.length,4);payload.copy(frame,8);return frame;}
test('服务正常结束但无文字时提示检查麦克风，不误报网络或凭据',async t=>{
 for(const result of [undefined,{}, {text:''}, {text:'   '}]){
  const testUrl=await local(t,socket=>socket.on('message',frame=>{if(frame[1]!==0x22)return;const payload=Buffer.from(JSON.stringify({result}));const output=Buffer.alloc(8+payload.length);output.set([0x11,0x92,0x10,0]);output.writeUInt32BE(payload.length,4);payload.copy(output,8);socket.send(output);}));
  const p=createVolcengineAsrProvider({env,transportFactory:options=>createAsrTransport({...options,testUrl})});
  await assert.rejects(p.transcribe(Buffer.alloc(3200)),error=>error.status===422 && /未识别到.*语音/.test(error.message) && /麦克风/.test(error.message) && !/网络|凭据/.test(error.message));
 }
});
async function local(t,handler){const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));server.on('connection',handler);t.after(()=>new Promise(r=>{for(const c of server.clients)c.terminate();server.close(r);}));return `ws://127.0.0.1:${server.address().port}`;}
async function api(t,asr){const server=createServer({asr,provider:{simulated:true,complete:async()=> 'mock'}});const safeUrl=await listenForFetch(server);t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));const url=safeUrl;const headers={'Content-Type':'application/octet-stream','X-Audio-Sample-Rate':'16000','X-Audio-Channels':'1','X-Audio-Bit-Depth':'16'};return {url,headers};}
test('显式火山配置可加载，缺凭据失败且状态不含秘密',()=>{
 const p=loadAsr({...env,ASR_PROVIDER:'volcengine'});assert.deepEqual(JSON.parse(JSON.stringify(p)),{id:'volcengine',enabled:true,simulated:false});for(const invalid of [{ASR_PROVIDER:'volcengine'},{...env,ASR_PROVIDER:'volcengine',ASR_TIMEOUT_MS:'bad'},{ASR_PROVIDER:'unknown'}])assert.throws(()=>loadAsr(invalid));
});
test('HTTP音频授权到真实本机WebSocket完整往返，逐次新请求ID和准确PCM',async t=>{
 const ids=[],audio=[];let connections=0;
 const testUrl=await local(t,(socket,req)=>{assert.equal(req.headers['x-api-resource-id'],'volc.seedasr.sauc.duration');connections++;ids.push(req.headers['x-api-request-id']);assert.equal(req.headers['x-api-access-key'],'fake-access');let count=0;socket.on('message',frame=>{if(count++===0)socket.send(response());else {audio.push(gunzipSync(frame.subarray(8)));if(frame[1]===0x22)socket.send(response(true));}});});
 const asr=createVolcengineAsrProvider({env,transportFactory:options=>createAsrTransport({...options,testUrl})});const f=await api(t,asr);const pcm=Buffer.alloc(12800,17);const send=consent=>fetch(`${f.url}/api/transcribe`,{method:'POST',headers:{...f.headers,'X-Audio-Cloud-Consent':consent},body:pcm});
 assert.equal((await send('false')).status,400);assert.equal(connections,0);
 for(let i=0;i<2;i++){const res=await send('true');assert.equal(res.status,200);assert.deepEqual(await res.json(),{text:'预算1200元，不提前发布。',simulated:false,duration:0.4});}
 assert.equal(connections,2);assert.notEqual(ids[0],ids[1]);assert.deepEqual(Buffer.concat(audio),Buffer.concat([pcm,pcm]));const status=await (await fetch(`${f.url}/api/status`)).json();assert.equal(status.asrProvider,'volcengine');assert.equal(status.asrSimulated,false);assert.ok(!JSON.stringify(status).includes('fake-access'));
});
test('本机上游超时返回504、工厂异常安全返回502，不回显秘密',async t=>{
 const testUrl=await local(t,socket=>socket.on('message',()=>{}));const p=createVolcengineAsrProvider({env:{...env,ASR_TIMEOUT_MS:'40'},transportFactory:options=>createAsrTransport({...options,testUrl})});const f=await api(t,p);const res=await fetch(`${f.url}/api/transcribe`,{method:'POST',headers:{...f.headers,'X-Audio-Cloud-Consent':'true'},body:Buffer.alloc(3200)});assert.equal(res.status,504);
 const bad=createVolcengineAsrProvider({env,transportFactory(){throw new Error('fake-access');}});await assert.rejects(bad.transcribe(Buffer.alloc(3200)),e=>e.status===502 && !e.message.includes('fake-access'));
});
test('HTTP客户端取消传递至真实本机WebSocket关闭，预取消不创建传输',async t=>{
 let received,closed;const sent=new Promise(r=>received=r),disposed=new Promise(r=>closed=r);const testUrl=await local(t,socket=>{socket.on('message',()=>received());socket.once('close',closed);});let calls=0;
 const p=createVolcengineAsrProvider({env,transportFactory:options=>{calls++;return createAsrTransport({...options,testUrl});}});const abort=new AbortController();abort.abort();await assert.rejects(p.transcribe(Buffer.alloc(3200),{signal:abort.signal}),e=>e.name==='AbortError');assert.equal(calls,0);
 const f=await api(t,p),controller=new AbortController();const pending=fetch(`${f.url}/api/transcribe`,{method:'POST',headers:{...f.headers,'X-Audio-Cloud-Consent':'true'},body:Buffer.alloc(3200),signal:controller.signal});await sent;controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');await Promise.race([disposed,new Promise((r,j)=>{const timer=setTimeout(()=>j(new Error('连接未关闭')),1000);timer.unref();disposed.then(()=>clearTimeout(timer));})]);assert.equal(calls,1);
});

test('真实本机握手403与协议错误码被安全保留到HTTP错误（上游替身）',async t=>{
 const {default:http}=await import('node:http');
 const reject=http.createServer((req,res)=>{res.writeHead(403);res.end('SECRET upstream');});await new Promise(r=>reject.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{reject.closeAllConnections();reject.close(r);}));
 const targets=[{testUrl:`ws://127.0.0.1:${reject.address().port}`,expected:/HTTP 403/}];
 const testUrl=await local(t,socket=>socket.once('message',()=>{const payload=Buffer.from('SECRET upstream');const frame=Buffer.alloc(12+payload.length);frame.set([0x11,0xf0,0,0]);frame.writeUInt32BE(45000001,4);frame.writeUInt32BE(payload.length,8);payload.copy(frame,12);socket.send(frame);}));targets.push({testUrl,expected:/45000001.*请求参数无效/});
 for(const target of targets){const p=createVolcengineAsrProvider({env,transportFactory:options=>createAsrTransport({...options,testUrl:target.testUrl})});await assert.rejects(p.transcribe(Buffer.alloc(3200)),e=>e.status===502 && target.expected.test(e.message) && !e.message.includes('SECRET'));}
});


test('2.0优化版初始化无ACK，仅最终音频后返回结果仍成功（本机上游）',async t=>{
 let initSeen=false,audioSeen=false;
 const testUrl=await local(t,socket=>socket.on('message',frame=>{if(frame[1]===0x11){initSeen=true;return;}audioSeen=true;if(frame[1]===0x22)socket.send(response(true));}));
 const p=createVolcengineAsrProvider({env,transportFactory:options=>createAsrTransport({...options,testUrl})});
 assert.equal(await p.transcribe(Buffer.alloc(3200)),'预算1200元，不提前发布。');assert.equal(initSeen,true);assert.equal(audioSeen,true);
});
