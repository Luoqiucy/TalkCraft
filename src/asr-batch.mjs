import {transcribeAudio,validatePcm} from './asr.mjs';
import {importPcmWav} from '../public/audio.mjs';
import {evaluateAsrSamples} from './asr-benchmark.mjs';

export async function writeAsrAcceptanceReport(output,results) {
  const report=evaluateAsrSamples(results);
  await output.writeFile(JSON.stringify(report,null,2)+'\n');
  await output.sync();
  return report.passed?0:2;
}

export function importAsrWav(bytes) {
  const audio=importPcmWav(bytes);
  return {...audio,pcm:new Uint8Array(audio.pcm)};
}

export function validateAsrManifest(entries,{expectedCount=100}={}) {
  if(!Array.isArray(entries)||entries.length!==expectedCount)throw new TypeError(`ASR清单必须恰好包含${expectedCount}条样本`);
  const ids=new Set();
  return entries.map((entry,index)=>{
    if(!entry||typeof entry!=='object')throw new TypeError(`第${index+1}条清单无效`);
    if(typeof entry.id!=='string'||!entry.id.trim()||entry.id.length>128)throw new TypeError(`第${index+1}条清单的id无效`);
    const id=entry.id.trim();if(ids.has(id))throw new TypeError(`清单id重复：${id}`);ids.add(id);
    if(typeof entry.reference!=='string'||!entry.reference.trim())throw new TypeError(`样本${id}的参考文本为空`);
    if(typeof entry.audio!=='string'||!entry.audio.trim()||entry.audio.includes('\0'))throw new TypeError(`样本${id}的音频路径无效`);
    return {id,reference:entry.reference,audio:entry.audio};
  });
}

export function validateAsrResume(manifest,results=[]) {
  if(!Array.isArray(results)||results.length>manifest.length)throw new TypeError('续跑结果数量无效');
  return results.map((result,index)=>{
    const expected=manifest[index];
    if(!result||typeof result!=='object'||result.id!==expected.id||result.reference!==expected.reference)throw new TypeError(`续跑结果第${index+1}条与清单不一致`);
    if(typeof result.hypothesis!=='string'||!result.hypothesis.trim()||result.hypothesis.length>12000)throw new TypeError(`续跑结果${result.id}的转写无效`);
    if(!Number.isFinite(result.latencyMs)||result.latencyMs<0)throw new TypeError(`续跑结果${result.id}的延迟无效`);
    for(const key of ['audioDurationMs','peakProcessRssBytes','stopToFinalMs'])if(result[key]!==undefined&&(!Number.isFinite(result[key])||result[key]<0))throw new TypeError(`续跑结果${result.id}的${key}无效`);
    if(result.providerId!==undefined&&(typeof result.providerId!=='string'||!result.providerId.trim()))throw new TypeError(`续跑结果${result.id}的providerId无效`);
    return {id:result.id,reference:result.reference,hypothesis:result.hypothesis,latencyMs:result.latencyMs,...(result.audioDurationMs===undefined?{}:{audioDurationMs:result.audioDurationMs}),...(result.peakProcessRssBytes===undefined?{}:{peakProcessRssBytes:result.peakProcessRssBytes}),...(result.stopToFinalMs===undefined?{}:{stopToFinalMs:result.stopToFinalMs}),...(result.providerId===undefined?{}:{providerId:result.providerId})};
  });
}

export function formatAsrResultJsonl(result,{prependNewline=false}={}) {
  if(typeof prependNewline!=='boolean')throw new TypeError('JSONL换行选项无效');
  return `${prependNewline?'\n':''}${JSON.stringify(result)}\n`;
}

export function installBatchCancellation(target=process) {
  if(typeof target?.once!=='function'||typeof target?.removeListener!=='function')throw new TypeError('信号目标无效');
  const controller=new AbortController(),abort=()=>controller.abort();
  target.once('SIGINT',abort);target.once('SIGTERM',abort);
  return {signal:controller.signal,dispose(){target.removeListener('SIGINT',abort);target.removeListener('SIGTERM',abort);}};
}

export async function preflightAsrAudio(entries,{readAudio,signal}={}) {
  if(!Array.isArray(entries))throw new TypeError('待检查音频清单无效');
  if(typeof readAudio!=='function')throw new TypeError('缺少音频读取器');
  for(const entry of entries){
    signal?.throwIfAborted();
    try{
      const audio=await readAudio(entry);signal?.throwIfAborted();
      validatePcm(audio?.pcm,{sampleRate:audio?.sampleRate,channels:audio?.channels,bitDepth:audio?.bitDepth});
    }catch(error){
      if(error?.name==='AbortError')throw error;
      throw new Error(`样本${entry?.id??'?'}的音频预检失败：${error.message}`);
    }
  }
  return entries.length;
}

export async function auditAsrAudio(entries,{readAudio,signal}={}) {
  if(!Array.isArray(entries))throw new TypeError('待检查音频清单无效');
  if(typeof readAudio!=='function')throw new TypeError('缺少音频读取器');
  const readyIds=[],missingIds=[],invalid=[];
  for(const entry of entries){
    signal?.throwIfAborted();
    try{
      const audio=await readAudio(entry);signal?.throwIfAborted();
      validatePcm(audio?.pcm,{sampleRate:audio?.sampleRate,channels:audio?.channels,bitDepth:audio?.bitDepth});readyIds.push(entry.id);
    }catch(error){
      if(error?.name==='AbortError')throw error;
      if(error?.code==='ENOENT')missingIds.push(entry.id);
      else invalid.push({id:entry?.id??'?',reason:error?.message||'音频无效'});
    }
  }
  return {sampleCount:entries.length,readyCount:readyIds.length,missingCount:missingIds.length,invalidCount:invalid.length,complete:readyIds.length===entries.length,readyIds,missingIds,invalid};
}

export async function runAsrBatch(entries,{provider,readAudio,now=()=>performance.now(),signal,onResult=()=>{},initialResults=[],expectedCount=100,profileMemory=false,rss=()=>process.memoryUsage().rss}={}) {
  const manifest=validateAsrManifest(entries,{expectedCount});
  const results=validateAsrResume(manifest,initialResults);
  if(!provider?.enabled||provider.simulated===true)throw new Error('批量验收只允许已启用的真实ASR提供器');
  if(typeof readAudio!=='function')throw new TypeError('缺少音频读取器');
  for(const entry of manifest.slice(results.length)){
    signal?.throwIfAborted();const audio=await readAudio(entry);signal?.throwIfAborted();
    let peakProcessRssBytes=profileMemory?rss():undefined;
    const timer=profileMemory?setInterval(()=>{peakProcessRssBytes=Math.max(peakProcessRssBytes,rss());},25):null;
    timer?.unref?.();
    let answer,latencyMs;
    try{
      const started=now();answer=await transcribeAudio(audio.pcm,{sampleRate:audio.sampleRate,channels:audio.channels,bitDepth:audio.bitDepth},provider,signal);
      latencyMs=Math.max(0,Math.round(now()-started));
    }finally{if(timer)clearInterval(timer);if(profileMemory)peakProcessRssBytes=Math.max(peakProcessRssBytes,rss());}
    const result={id:entry.id,reference:entry.reference,hypothesis:answer.text,latencyMs,audioDurationMs:Math.round(audio.pcm.byteLength/32),...(typeof provider.id==='string'?{providerId:provider.id}:{}),...(profileMemory?{peakProcessRssBytes}:{})};
    await onResult(result);results.push(result);
  }
  return results;
}
