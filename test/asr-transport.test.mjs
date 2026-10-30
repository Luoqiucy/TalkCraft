import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {createServer as httpServer} from 'node:http';
import {createAsrTransport} from '../src/providers/asr-transport.mjs';
import {runAsrSession} from '../src/providers/asr-session.mjs';
import {gunzipSync} from 'node:zlib';
function response(final=false){const payload=Buffer.from(JSON.stringify({result:{text:'本地协议测试15'}}));const frame=Buffer.alloc(8+payload.length);frame.set([0x11,final?0x92:0x90,0x10,0]);frame.writeUInt32BE(payload.length,4);payload.copy(frame,8);return frame;}
async function local(t,onConnection){const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));server.on('connection',onConnection);t.after(async()=>{for(const client of server.clients)client.terminate();await new Promise(resolve=>server.close(resolve));});return `ws://127.0.0.1:${server.address().port}/asr`;}
test('默认官方结束格式经本机WebSocket发送，PCM完整且只传一次',async t=>{
 const chunks=[];const pcm=Buffer.alloc(15000,31);
 const url=await local(t,socket=>socket.on('message',frame=>{
  if(frame[1]>>4===1){socket.send(response());return;}
  assert.equal(frame[2],0x01);chunks.push(gunzipSync(frame.subarray(8)));
  if(frame[1]===0x22)socket.send(response(true));
 }));
 const transport=createAsrTransport({testUrl:url});
 assert.equal(await runAsrSession({transport,pcm,timeoutMs:1000}),'本地协议测试15');
 assert.deepEqual(Buffer.concat(chunks),pcm);assert.equal(chunks.length,3);
});

test('握手只使用创建时已校验的头快照，后续修改不泄漏新增凭据',async t=>{
 let received;const observed=new Promise(resolve=>received=resolve);
 const url=await local(t,(socket,req)=>received(req.headers));
 const headers={'X-Api-App-Key':'original-app'};
 const transport=createAsrTransport({testUrl:url,headers});t.after(()=>transport.close());
 headers['X-Api-App-Key']='changed-app';headers.Authorization='SHOULD-NOT-BE-SENT';
 await transport.connect();const actual=await observed;await transport.close();
 assert.equal(actual['x-api-app-key'],'original-app');assert.equal(actual.authorization,undefined);
});
test('本机真实WebSocket握手与二进制PCM会话往返',async t=>{let requestHeaders,count=0;const terminal=Buffer.from('TEST-ONLY-TERMINAL');const url=await local(t,(socket,req)=>{requestHeaders=req.headers;socket.on('message',(frame,binary)=>{assert.equal(binary,true);count++;if(count===1)socket.send(response());else if(frame.equals(terminal))socket.send(response(true));});});const transport=createAsrTransport({testUrl:url,headers:{'X-Api-App-Key':'test-app','X-Api-Request-Id':'test-request'}});assert.equal(await runAsrSession({transport,pcm:Buffer.alloc(12800),terminalFrame:terminal,timeoutMs:1000}),'本地协议测试15');await transport.close();assert.equal(count,4);assert.equal(requestHeaders['x-api-app-key'],'test-app');});
test('取消等待响应会关闭本机真实连接',async t=>{let connected;const opened=new Promise(resolve=>connected=resolve);const url=await local(t,socket=>{connected();socket.on('message',()=>{});});const transport=createAsrTransport({testUrl:url}),abort=new AbortController();const pending=runAsrSession({transport,pcm:Buffer.alloc(3200),terminalFrame:Buffer.from('TEST-END'),signal:abort.signal,timeoutMs:1000});await opened;abort.abort();await assert.rejects(pending,error=>error.name==='AbortError');await transport.close();});
test('超过1MiB及文本消息拒绝，错误反馈脱敏',async t=>{for(const payload of ['SECRET-UPSTREAM',Buffer.alloc(1048577)]){const url=await local(t,socket=>socket.send(payload));const transport=createAsrTransport({testUrl:url});await assert.rejects(runAsrSession({transport,pcm:Buffer.alloc(3200),terminalFrame:Buffer.from('TEST-END'),timeoutMs:1000}),error=>!error.message.includes('SECRET'));await transport.close();}});
test('拒绝远程测试地址、凭据URL、注入头与未知头',()=>{for(const url of ['ws://example.com','wss://127.0.0.1','ws://user:secret@127.0.0.1','ws://127.0.0.1/?secret=x'])assert.throws(()=>createAsrTransport({testUrl:url}),/仅允许/);assert.throws(()=>createAsrTransport({headers:{'X-Api-App-Key':'x\r\nInjected'}}),/无效/);assert.throws(()=>createAsrTransport({headers:{Authorization:'secret'}}),/无效/);});
test('握手HTTP拒绝及关闭中的错误不产生未处理error事件',async t=>{const server=httpServer((req,res)=>{res.writeHead(401);res.end('SECRET-DETAIL');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const transport=createAsrTransport({testUrl:`ws://127.0.0.1:${server.address().port}`});await assert.rejects(transport.connect(),error=>!error.message.includes('SECRET'));await transport.close();await assert.rejects(transport.send(Buffer.alloc(2)),/不可发送/);});
