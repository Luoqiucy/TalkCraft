import {listenForFetch} from '../test-support/http-listen.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadAsr,mockAsr,disabledAsr,validatePcm,transcribeAudio} from '../src/asr.mjs';
import {createServer} from '../server.mjs';
import {processText,mockProvider} from '../src/pipeline.mjs';
const format={sampleRate:16000,channels:1,bitDepth:16},pcm=new Uint8Array(32000);
test('识别默认关闭，显式配置真实提供器需凭据，不静默降级',() => {
  assert.equal(loadAsr({}),disabledAsr);assert.equal(loadAsr({ASR_PROVIDER:'mock'}),mockAsr);assert.throws(() => loadAsr({ASR_PROVIDER:'volcengine'}),/VOLC_ASR_APP_KEY/);
});
test('PCM校验采样率/声道/位深/长度和时长',() => {
  assert.equal(validatePcm(pcm,format).duration,1);
  for(const bytes of [new Uint8Array(0),new Uint8Array(3201),new Uint8Array(3840002)]) assert.throws(() => validatePcm(bytes,format));
  for(const wrong of [{...format,sampleRate:48000},{...format,channels:2},{...format,bitDepth:32}]) assert.throws(() => validatePcm(pcm,wrong));
});
test('模拟转写明确标记，能串联文本处理但不代表识别效果',async () => {
  const transcript=await transcribeAudio(pcm,format,mockAsr);assert.equal(transcript.simulated,true);assert.match(transcript.text,/未识别音频/);
  const result=await processText({mode:'prompt',text:transcript.text},mockProvider);assert.equal(result.simulated,true);assert.match(result.text,/模拟/);
});
test('关闭、空响应、取消不能交付识别结果',async () => {
  await assert.rejects(transcribeAudio(pcm,format,disabledAsr),error => error.status===503);
  await assert.rejects(transcribeAudio(pcm,format,{enabled:true,async transcribe(){return '';}}),/文本无效/);
  const controller=new AbortController();
  await assert.rejects(transcribeAudio(pcm,format,{enabled:true,async transcribe(){controller.abort();return '迟到结果';}},controller.signal),error => error.name==='AbortError');
});
async function fixture(t,asr) {
  const server=createServer({asr,provider:mockProvider});const safeUrl=await listenForFetch(server);t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
  const url=safeUrl;
  const headers={'Content-Type':'application/octet-stream','X-Audio-Sample-Rate':'16000','X-Audio-Channels':'1','X-Audio-Bit-Depth':'16'};
  return {url,send:(body=pcm,extra={}) => fetch(`${url}/api/transcribe`,{method:'POST',headers:{...headers,...extra},body})};
}
test('HTTP模拟识别及状态，格式/大小/跨来源错误',async t => {
  const f=await fixture(t,mockAsr);const status=await (await fetch(`${f.url}/api/status`)).json();assert.equal(status.audioTranscription,true);assert.equal(status.asrSimulated,true);
  const response=await f.send();assert.equal(response.status,200);assert.equal((await response.json()).simulated,true);
  assert.equal((await f.send(pcm,{'X-Audio-Sample-Rate':'48000'})).status,400);
  assert.equal((await f.send(pcm,{'Content-Type':'audio/wav'})).status,400);
  assert.equal((await f.send(new Uint8Array(3201))).status,400);
  assert.equal((await f.send(new Uint8Array(3840002))).status,413);
  assert.equal((await f.send(pcm,{Origin:'https://example.com'})).status,403);
});
test('HTTP默认关闭返回503；真实服务替身必须音频授权',async t => {
  const off=await fixture(t,disabledAsr);assert.equal((await off.send()).status,503);
  let calls=0;const live=await fixture(t,{enabled:true,simulated:false,id:'test-only',async transcribe(){calls++;return '测试替身';}});
  assert.equal((await live.send()).status,400);assert.equal(calls,0);
  const response=await live.send(pcm,{'X-Audio-Cloud-Consent':'true'});assert.equal(response.status,200);assert.equal(calls,1);
});
test('音频请求断开会取消在途识别（模拟上游）',{timeout:2000},async t => {
  let startResolve,cancelResolve;
  const started=new Promise(resolve => {startResolve=resolve;});const cancelled=new Promise(resolve => {cancelResolve=resolve;});
  const f=await fixture(t,{enabled:true,simulated:true,id:'test',transcribe(_pcm,{signal}) {
    startResolve();return new Promise((resolve,reject) => signal.addEventListener('abort',() => {cancelResolve();reject(signal.reason);},{once:true}));
  }});
  const controller=new AbortController();
  const request=fetch(`${f.url}/api/transcribe`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Audio-Sample-Rate':'16000','X-Audio-Channels':'1','X-Audio-Bit-Depth':'16'},body:pcm,signal:controller.signal});
  await started;controller.abort();await assert.rejects(request,error => error.name==='AbortError');await cancelled;
});
