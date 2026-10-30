import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mixMono,encodePcm16,pcmToWav,convertAudio,decodeRecording,importPcmWav} from '../public/audio.mjs';
const audioBuffer=(channels, sampleRate=16000) => ({sampleRate,length:channels[0].length,numberOfChannels:channels.length,getChannelData:i => channels[i]});
test('多声道平均混合，不改变原始样本',() => {
  const left=new Float32Array([1,.5,-1]),right=new Float32Array([-1,.5,1]);
  assert.deepEqual([...mixMono(audioBuffer([left,right]))],[0,.5,0]);assert.deepEqual([...left],[1,.5,-1]);
});
test('PCM16小端、正负幅度、削波与零值编码',() => {
  const bytes=encodePcm16(new Float32Array([-2,-1,-.5,0,.5,1,2]));const view=new DataView(bytes);
  assert.deepEqual(Array.from({length:7},(_,i) => view.getInt16(i*2,true)),[-32768,-32768,-16384,0,16384,32767,32767]);
  assert.equal(new Uint8Array(bytes)[1],128);
});
test('WAV头声道/采样率/字节率/位深/长度与PCM负载',() => {
  const pcm=encodePcm16(new Float32Array([.5,-.5]));const wav=pcmToWav(pcm),view=new DataView(wav),text=(i,n) => String.fromCharCode(...new Uint8Array(wav,i,n));
  assert.equal(text(0,4),'RIFF');assert.equal(text(8,4),'WAVE');assert.equal(view.getUint32(4,true),40);assert.equal(view.getUint16(20,true),1);assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint32(28,true),32000);assert.equal(view.getUint16(34,true),16);assert.equal(view.getUint32(40,true),4);assert.deepEqual(new Uint8Array(wav,44),new Uint8Array(pcm));
});
test('16kHz直接转换保持样本数与时长',async () => {
  const audio=await convertAudio(audioBuffer([new Float32Array(16000).fill(.25)]));assert.equal(audio.duration,1);assert.equal(audio.pcm.byteLength,32000);assert.equal(audio.channels,1);assert.equal(audio.bitDepth,16);
});
test('48k与44.1k正确请求目标帧数，真实重采样仍待浏览器验证',async () => {
  for(const rate of [48000,44100]) {
    let called=false;
    const audio=await convertAudio(audioBuffer([new Float32Array(rate)],rate),{resample:async (samples,inputRate,frames) => {called=true;assert.equal(samples.length,rate);assert.equal(inputRate,rate);assert.equal(frames,16000);return new Float32Array(frames);}});
    assert.ok(called);assert.equal(audio.duration,1);
  }
});
test('拒绝坏格式、无效采样、超时长和过大解码音频',async () => {
  for(const buffer of [null,audioBuffer([new Float32Array()],16000),audioBuffer([new Float32Array([NaN])]),{sampleRate:16000,length:1920001,numberOfChannels:1,getChannelData(){}},{sampleRate:192000,length:5000000,numberOfChannels:8,getChannelData(){}}]) await assert.rejects(convertAudio(buffer));
  assert.throws(() => encodePcm16(new Float32Array([Infinity])));assert.throws(() => pcmToWav(new ArrayBuffer(3)));
});
test('拒绝错误重采样长度并防止取消后交付',async () => {
  const buffer=audioBuffer([new Float32Array(48000)],48000);
  await assert.rejects(convertAudio(buffer,{resample:async () => new Float32Array(1)}),/长度错误/);
  const controller=new AbortController();
  await assert.rejects(convertAudio(buffer,{signal:controller.signal,resample:async (_samples,_rate,frames) => {controller.abort();return new Float32Array(frames);}}),error => error.name==='AbortError');
});
test('解码成功和失败均关闭AudioContext（模拟解码器）',async () => {
  for (const failure of [false,true]) {
    let closes=0;
    const request=decodeRecording(new Blob(['test-container']),{createDecoder:() => ({async decodeAudioData(){if(failure) throw new Error('bad codec');return audioBuffer([new Float32Array(16000)]);},async close(){closes++;}})});
    if(failure) await assert.rejects(request,/无法解码/);else assert.equal((await request).duration,1);
    assert.equal(closes,1);
  }
});
test('取消解码后仍关闭上下文，空Blob不启动解码器',async () => {
  let closes=0;const controller=new AbortController();
  await assert.rejects(decodeRecording(new Blob(['test']),{signal:controller.signal,createDecoder:() => ({async decodeAudioData(){controller.abort();return audioBuffer([new Float32Array(1)]);},async close(){closes++;}})}),error => error.name==='AbortError');assert.equal(closes,1);
  await assert.rejects(decodeRecording(new Blob([]),{createDecoder:() => {throw new Error('should not start');}}),/为空/);
});

test('解码器关闭失败不覆盖成功、原始错误或取消（故障模拟）',async()=>{
 for(const close of [()=>{throw new Error('cleanup failure');},()=>Promise.reject(new Error('cleanup failure')),()=>new Promise(()=>{})]){
  for(const outcome of ['success','failure','cancel']){
   const controller=new AbortController();let closes=0;
   const pending=decodeRecording(new Blob(['audio']),{cleanupTimeoutMs:10,signal:controller.signal,createDecoder:()=>({async decodeAudioData(){if(outcome==='failure')throw new Error('bad codec');if(outcome==='cancel')controller.abort();return audioBuffer([new Float32Array(16000)]);},close(){closes++;return close();}})});
   if(outcome==='success')assert.equal((await pending).duration,1);else await assert.rejects(pending,outcome==='cancel'?e=>e.name==='AbortError':/无法解码/);assert.equal(closes,1);
  }
 }
});


test('导入项目WAV保留PCM、格式和时长；拒绝坏头、截断与非目标格式',()=>{
 const pcm=encodePcm16(new Float32Array(16000).fill(.25)),wav=pcmToWav(pcm),audio=importPcmWav(wav);
 assert.deepEqual(new Uint8Array(audio.pcm),new Uint8Array(pcm));assert.equal(audio.duration,1);
 const bad=[];const header=wav.slice(0);new DataView(header).setUint8(0,0);bad.push(header,wav.slice(0,-1),pcmToWav(new ArrayBuffer(2)));
 for(const [offset,value,wide]of [[20,3,false],[22,2,false],[24,48000,true],[28,100,true],[32,4,false],[34,24,false],[40,9999999,true]]){const bytes=wav.slice(0);const v=new DataView(bytes);if(wide)v.setUint32(offset,value,true);else v.setUint16(offset,value,true);bad.push(bytes);}
 for(const bytes of bad)assert.throws(()=>importPcmWav(bytes));
});
