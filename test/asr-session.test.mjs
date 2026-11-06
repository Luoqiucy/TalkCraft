import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {gunzipSync} from 'node:zlib';
import {runAsrSession} from '../src/providers/asr-session.mjs';
function response(final=false,text='识别15，不要删除。'){
 const payload=Buffer.from(JSON.stringify({result:{text}}));const frame=Buffer.alloc(8+payload.length);frame.set([0x11,final?0x92:0x90,0x10,0]);frame.writeUInt32BE(payload.length,4);payload.copy(frame,8);return frame;
}
function transport({connect=async()=>{},send}={}){const t=new EventEmitter();t.frames=[];t.closes=0;t.connect=connect;t.close=()=>{t.closes++;};t.send=async frame=>{t.frames.push(frame);if(send)return send(t,frame);if(t.frames.length===1)t.emit('message',response());else if(frame===terminal)t.emit('message',response(true));};return t;}
const terminal=Buffer.from('TEST-ONLY-TERMINATOR');
const args=t=>({transport:t,pcm:Buffer.alloc(12800),terminalFrame:terminal,timeoutMs:1000,sendIntervalMs:0});
test('默认结束发送最后PCM块一次，短包/整包/余包均无丢失或重复',async()=>{
 for(const length of [3200,6400,6402,12800,15000]){
  const pcm=Buffer.alloc(length);for(let i=0;i<length;i++)pcm[i]=i%251;
  const t=transport({send(t,frame){if(t.frames.length===1)t.emit('message',response());else if(frame[1]===0x22)t.emit('message',response(true));}});
  assert.equal(await runAsrSession({...args(t),pcm,terminalFrame:undefined}),'识别15，不要删除。');
  const audio=t.frames.slice(1);assert.equal(audio.length,Math.ceil(length/6400));
  assert.equal(audio.filter(frame=>frame[1]===0x22).length,1);assert.equal(audio.at(-1)[1],0x22);
  assert.deepEqual(Buffer.concat(audio.map(frame=>gunzipSync(frame.subarray(8)))),pcm);
 }
});

test('成功及取消均等待异步连接释放后才结束',async()=>{
 for(const cancel of [false,true]){
  let release,settled=false;const abort=new AbortController();
  const t=transport(cancel?{send(){}}:{});
  t.close=()=>{t.closes++;return new Promise(resolve=>release=resolve);};
  const pending=runAsrSession({...args(t),signal:abort.signal}).then(value=>{settled=true;return value;},error=>{settled=true;throw error;});
  pending.catch(()=>{});
  await new Promise(resolve=>setImmediate(resolve));if(cancel)abort.abort();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');assert.equal(settled,false);
  release();if(cancel)await assert.rejects(pending,error=>error.name==='AbortError');else assert.equal(await pending,'识别15，不要删除。');
  assert.equal(t.closes,1);
 }
});
test('清理抛错、异步失败或永久挂起不会覆盖结果或取消',async()=>{
 for(const close of [()=>{throw new Error('SECRET');},()=>Promise.reject(new Error('SECRET')),()=>new Promise(()=>{})]){
  const t=transport();t.close=close;assert.equal(await runAsrSession({...args(t),cleanupTimeoutMs:10}),'识别15，不要删除。');
  const abort=new AbortController(),cancelled=transport({send(){}});cancelled.close=close;
  const pending=runAsrSession({...args(cancelled),signal:abort.signal,cleanupTimeoutMs:10});
  await new Promise(resolve=>setImmediate(resolve));abort.abort();await assert.rejects(pending,error=>error.name==='AbortError');
 }
});
test('无效清理预算在连接前拒绝',async()=>{const t=transport();await assert.rejects(runAsrSession({...args(t),cleanupTimeoutMs:0}),/清理超时无效/);assert.equal(t.frames.length,0);assert.equal(t.closes,0);});
test('会话等待初始化、分块发送PCM，只有终止后最终文本才交付',async()=>{const t=transport();assert.equal(await runAsrSession(args(t)),'识别15，不要删除。');assert.equal(t.frames.length,4);assert.equal(t.frames[0][1],0x11);assert.equal(t.frames[1][1],0x20);assert.equal(t.frames.at(-1),terminal);assert.equal(t.closes,1);assert.equal(t.listenerCount('message'),0);});
test('会话实际发送热词，收到最终响应仍只交付原始识别文字',async()=>{
 const t=transport();const text=await runAsrSession({...args(t),hotwords:['张家港']});
 assert.equal(text,'识别15，不要删除。');
 const init=JSON.parse(gunzipSync(t.frames[0].subarray(12)));
 assert.deepEqual(JSON.parse(init.request.corpus.context).hotwords,[{word:'张家港'}]);
});
test('初始化迟到时不提前发送音频',async()=>{let release;const t=transport({send(t){if(t.frames.length===1)release=()=>t.emit('message',response());else if(t.frames.at(-1)===terminal)t.emit('message',response(true));}});const pending=runAsrSession(args(t));await new Promise(resolve=>setImmediate(resolve));assert.equal(t.frames.length,1);release();await pending;assert.equal(t.closes,1);});
test('最终响应先于终止发送回调，仍完成并释放，不永久挂起',async()=>{const t=transport({send(t,frame){if(t.frames.length===1)t.emit('message',response());if(frame===terminal){t.emit('message',response(true));return new Promise(()=>{});}}});assert.equal(await runAsrSession({...args(t),timeoutMs:20}),'识别15，不要删除。');assert.equal(t.closes,1);});
test('连接挂起仍受整体超时约束并释放连接',async()=>{const t=transport({connect:()=>new Promise(()=>{})});await assert.rejects(runAsrSession({...args(t),timeoutMs:10}),/超时/);assert.equal(t.closes,1);assert.equal(t.frames.length,0);});
test('取消等待初始化，不发送迟到音频或结果',async()=>{const abort=new AbortController(),t=transport({send(){}});const pending=runAsrSession({...args(t),signal:abort.signal});await new Promise(resolve=>setImmediate(resolve));abort.abort();await assert.rejects(pending,error=>error.name==='AbortError');const count=t.frames.length;t.emit('message',response());assert.equal(t.frames.length,count);assert.equal(t.closes,1);});
test('提前最终包、坏帧、提前断线及发送错误均失败且脱敏',async()=>{for(const action of [t=>t.emit('message',response(true)),t=>t.emit('message',Buffer.alloc(2)),t=>t.emit('close'),()=>{throw new Error('SECRET upstream credential');}]){const t=transport({send:action});await assert.rejects(runAsrSession(args(t)),error=>!error.message.includes('SECRET'));assert.equal(t.closes,1);}});
test('空最终文本拒绝；无效终止帧及预先取消不建立连接',async()=>{const t=transport({send(t,frame){t.emit('message',response(frame===terminal,''));}});await assert.rejects(runAsrSession(args(t)),error=>error.name==='AsrDiagnosticError' && error.status===422 && /未识别到清晰语音/.test(error.message));const unopened=transport();await assert.rejects(runAsrSession({...args(unopened),terminalFrame:Buffer.alloc(0)}),/终止帧无效/);const abort=new AbortController();abort.abort();await assert.rejects(runAsrSession({...args(unopened),signal:abort.signal}),error=>error.name==='AbortError');assert.equal(unopened.frames.length,0);});


test('默认100ms节奏：首次音频立即发送，后续音频与最后包均等待',async()=>{
 const times=[];const t=transport({send(t,frame){if(t.frames.length===1)t.emit('message',response());else {times.push(performance.now());if(frame[1]===0x22)t.emit('message',response(true));}}});
 assert.equal(await runAsrSession({transport:t,pcm:Buffer.alloc(19200),timeoutMs:2000}),'识别15，不要删除。');
 assert.equal(times.length,3);for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=85,`发送间隔过短 ${times[i]-times[i-1]}`);
 assert.equal(t.closes,1);
});
test('发送间隔中取消或整体超时，不发送后续包并释放监听器',async()=>{
 for(const cancel of [true,false]){
  const abort=new AbortController();let firstAudio;const sent=new Promise(r=>firstAudio=r);
  const t=transport({send(t,frame){if(t.frames.length===1)t.emit('message',response());else firstAudio();}});
  const pending=runAsrSession({transport:t,pcm:Buffer.alloc(19200),signal:abort.signal,timeoutMs:cancel?1000:60});
  await sent;if(cancel)abort.abort();await assert.rejects(pending,cancel?e=>e.name==='AbortError':/超时/);
  assert.equal(t.frames.length,2);assert.equal(t.closes,1);assert.equal(t.listenerCount('message'),0);
  await new Promise(r=>setTimeout(r,220));assert.equal(t.frames.length,2);
 }
});
test('非法发送间隔在建立连接前拒绝',async()=>{
 for(const sendIntervalMs of [-1,1,99,201,NaN,'200',100.5]){const t=transport();await assert.rejects(runAsrSession({...args(t),sendIntervalMs}),/发送间隔无效/);assert.equal(t.frames.length,0);assert.equal(t.closes,0);}
});


test('JSON识别响应携带失败码时不交付文本；成功码正常识别',async()=>{
 for(const code of [45000001,45000002,0,20000000]){
  const t=transport({send(t,frame){if(t.frames.length===1)t.emit('message',response());else if(frame===terminal){const payload=Buffer.from(JSON.stringify({code,result:{text:'不能误当成功的文字'}}));const message=Buffer.alloc(8+payload.length);message.set([0x11,0x92,0x10,0]);message.writeUInt32BE(payload.length,4);payload.copy(message,8);t.emit('message',message);}}});
  const pending=runAsrSession(args(t));if(code===0 || code===20000000)assert.equal(await pending,'不能误当成功的文字');else await assert.rejects(pending,e=>e.message.includes(String(code)));assert.equal(t.closes,1);
 }
});
