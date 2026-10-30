import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {auditAsrAudio,formatAsrResultJsonl,installBatchCancellation,preflightAsrAudio,runAsrBatch,validateAsrManifest} from '../src/asr-batch.mjs';

const entries=()=>[{id:'a',reference:'今天3点不发布',audio:'a.wav'},{id:'b',reference:'预算1200元',audio:'b.wav'}];
const audio={pcm:new Uint8Array(3200),sampleRate:16000,channels:1,bitDepth:16};

test('真实ASR批量采集保持清单顺序并逐条落结果',async()=>{
  const written=[];let time=100,active=0,maxActive=0;
  const provider={enabled:true,simulated:false,async transcribe(){active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return written.length?'预算1200元':'今天3点不发布';}};
  const result=await runAsrBatch(entries(),{provider,expectedCount:2,readAudio:async()=>audio,now:()=>{time+=250;return time;},onResult:async value=>written.push(value)});
  assert.equal(maxActive,1);assert.deepEqual(result.map(item=>item.id),['a','b']);assert.deepEqual(result.map(item=>item.latencyMs),[250,250]);assert.deepEqual(written,result);
});

test('批量采集可记录音频时长、提供器与Node进程内存峰值',async()=>{
  const provider={id:'volcengine',enabled:true,simulated:false,async transcribe(){return '今天3点不发布';}};
  const result=await runAsrBatch([entries()[0]],{provider,expectedCount:1,readAudio:async()=>audio,profileMemory:true,rss:()=>2048});
  assert.equal(result[0].audioDurationMs,100);
  assert.equal(result[0].providerId,'volcengine');
  assert.equal(result[0].peakProcessRssBytes,2048);
});

test('模拟或关闭ASR不能生成阶段验收数据',async()=>{
  for(const provider of [{enabled:true,simulated:true},{enabled:false,simulated:false}])await assert.rejects(runAsrBatch(entries(),{provider,expectedCount:2,readAudio:async()=>audio}),/真实ASR/);
});

test('清单在任何ASR调用前拒绝数量、重复ID和无效路径',async()=>{
  let calls=0;const provider={enabled:true,simulated:false,async transcribe(){calls++;return '不应调用';}};
  await assert.rejects(runAsrBatch([{id:'same',reference:'甲',audio:'a.wav'},{id:'same',reference:'乙',audio:'b.wav'}],{provider,expectedCount:2,readAudio:async()=>audio}),/id重复/);assert.equal(calls,0);
  assert.throws(()=>validateAsrManifest(entries(),{expectedCount:100}),/恰好包含100条/);
  assert.throws(()=>validateAsrManifest([{id:'x',reference:'文本',audio:'bad\0.wav'}],{expectedCount:1}),/音频路径无效/);
});

test('音频预检在云端调用前发现后续坏文件且续跑只检查剩余后缀',async()=>{
  const manifest=validateAsrManifest(entries(),{expectedCount:2}),read=[];
  await assert.rejects(preflightAsrAudio(manifest,{async readAudio(entry){read.push(entry.id);return entry.id==='b'?{...audio,sampleRate:48000}:audio;}}),/样本b的音频预检失败/);
  assert.deepEqual(read,['a','b']);
  read.length=0;
  assert.equal(await preflightAsrAudio(manifest.slice(1),{async readAudio(entry){read.push(entry.id);return audio;}}),1);
  assert.deepEqual(read,['b']);
});

test('语料审计一次列出全部缺失和无效音频而不调用ASR',async()=>{
  const manifest=[...entries(),{id:'c',reference:'保持否定',audio:'c.wav'}],missing=Object.assign(new Error('不应回显路径'),{code:'ENOENT'});
  const report=await auditAsrAudio(manifest,{async readAudio(entry){if(entry.id==='b')throw missing;if(entry.id==='c')return {...audio,channels:2};return audio;}});
  assert.equal(report.complete,false);assert.equal(report.readyCount,1);assert.deepEqual(report.missingIds,['b']);
  assert.deepEqual(report.invalid.map(item=>item.id),['c']);assert.doesNotMatch(JSON.stringify(report),/不应回显路径/);
});

test('续跑只调用未完成后缀并返回完整有序结果',async()=>{
  const initial={id:'a',reference:'今天3点不发布',hypothesis:'今天3点不发布',latencyMs:800},written=[];let calls=0,time=0;
  const provider={enabled:true,simulated:false,async transcribe(){calls++;return '预算1200元';}};
  const result=await runAsrBatch(entries(),{provider,expectedCount:2,initialResults:[initial],readAudio:async entry=>{assert.equal(entry.id,'b');return audio;},now:()=>{time+=100;return time;},onResult:async value=>written.push(value)});
  assert.equal(calls,1);assert.deepEqual(result.map(item=>item.id),['a','b']);assert.deepEqual(written.map(item=>item.id),['b']);assert.notEqual(result[0],initial);
});

test('续跑结果文件缺少末尾换行时追加内容仍保持独立JSONL行',()=>{
  const first=JSON.stringify({id:'a'}),second={id:'b'};
  const combined=first+formatAsrResultJsonl(second,{prependNewline:true});
  assert.deepEqual(combined.trimEnd().split(/\r?\n/).map(line=>JSON.parse(line)),[{id:'a'},{id:'b'}]);
  assert.equal(formatAsrResultJsonl(second),`${JSON.stringify(second)}\n`);
  assert.throws(()=>formatAsrResultJsonl(second,{prependNewline:'yes'}),/换行选项无效/);
});

test('续跑前缀损坏时不调用ASR',async()=>{
  let calls=0;const provider={enabled:true,simulated:false,async transcribe(){calls++;return '不应调用';}};
  for(const initialResults of [[{id:'b',reference:'预算1200元',hypothesis:'文本',latencyMs:1}],[{id:'a',reference:'被修改',hypothesis:'文本',latencyMs:1}],[{id:'a',reference:'今天3点不发布',hypothesis:'',latencyMs:1}]])
    await assert.rejects(runAsrBatch(entries(),{provider,expectedCount:2,initialResults,readAudio:async()=>audio}),/续跑结果/);
  assert.equal(calls,0);
});

test('SIGINT取消在途ASR并清理两个信号监听',async()=>{
  const target=new EventEmitter(),cancellation=installBatchCancellation(target);let calls=0;
  const provider={enabled:true,simulated:false,transcribe(_pcm,{signal}){calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
  const pending=runAsrBatch(entries(),{provider,expectedCount:2,signal:cancellation.signal,readAudio:async()=>audio});
  await new Promise(resolve=>setImmediate(resolve));target.emit('SIGINT');await assert.rejects(pending,error=>error?.name==='AbortError');cancellation.dispose();
  assert.equal(calls,1);assert.equal(target.listenerCount('SIGINT'),0);assert.equal(target.listenerCount('SIGTERM'),0);
});
