export const TARGET_RATE = 16000;
const MAX_SECONDS = 120;
export function validateAudio(buffer) {
  if (!buffer || !Number.isInteger(buffer.sampleRate) || buffer.sampleRate < 8000 || buffer.sampleRate > 192000 || !Number.isInteger(buffer.length) || buffer.length < 1 || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 || buffer.numberOfChannels > 8 || typeof buffer.getChannelData !== 'function') throw new Error('音频格式不支持');
  if (buffer.length / buffer.sampleRate > MAX_SECONDS) throw new Error('音频不能超过 120 秒');
  if (buffer.length * buffer.numberOfChannels > 32 * 1024 * 1024) throw new Error('解码音频过大');
}
export function mixMono(buffer) {
  validateAudio(buffer);const mono = new Float32Array(buffer.length);
  for (let channel=0;channel<buffer.numberOfChannels;channel++) {
    const samples=buffer.getChannelData(channel);
    if (!(samples instanceof Float32Array) || samples.length !== buffer.length) throw new Error('音频采样数据不完整');
    for (let i=0;i<samples.length;i++) {
      if (!Number.isFinite(samples[i])) throw new Error('音频包含无效采样');
      mono[i] += samples[i] / buffer.numberOfChannels;
    }
  }
  return mono;
}
export function encodePcm16(samples) {
  if (!(samples instanceof Float32Array) || !samples.length || samples.length > TARGET_RATE*MAX_SECONDS) throw new Error('目标音频长度无效');
  const bytes=new ArrayBuffer(samples.length*2), view=new DataView(bytes);
  for (let i=0;i<samples.length;i++) {
    if (!Number.isFinite(samples[i])) throw new Error('音频包含无效采样');
    const value=Math.max(-1,Math.min(1,samples[i]));
    view.setInt16(i*2,Math.round(value*(value<0 ? 32768 : 32767)),true);
  }
  return bytes;
}
export function pcmToWav(pcm) {
  if (!(pcm instanceof ArrayBuffer) || !pcm.byteLength || pcm.byteLength%2 || pcm.byteLength>TARGET_RATE*MAX_SECONDS*2) throw new Error('PCM数据无效');
  const bytes=new ArrayBuffer(44+pcm.byteLength), view=new DataView(bytes);
  const write=(offset,text) => {for(let i=0;i<text.length;i++) view.setUint8(offset+i,text.charCodeAt(i));};
  write(0,'RIFF');view.setUint32(4,36+pcm.byteLength,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,TARGET_RATE,true);view.setUint32(28,TARGET_RATE*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,pcm.byteLength,true);
  new Uint8Array(bytes,44).set(new Uint8Array(pcm));return bytes;
}
async function renderMono(samples, sampleRate, frames) {
  if (!globalThis.OfflineAudioContext) throw new Error('此浏览器不支持音频采样率转换');
  const context=new OfflineAudioContext(1,frames,TARGET_RATE);
  const buffer=context.createBuffer(1,samples.length,sampleRate);buffer.copyToChannel(samples,0);
  const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start();
  const rendered=await context.startRendering();return rendered.getChannelData(0);
}
export async function convertAudio(buffer, {resample=renderMono, signal} = {}) {
  signal?.throwIfAborted();const mono=mixMono(buffer);const frames=Math.max(1,Math.round(buffer.length*TARGET_RATE/buffer.sampleRate));
  const samples=buffer.sampleRate===TARGET_RATE ? mono : await resample(mono,buffer.sampleRate,frames);
  signal?.throwIfAborted();
  if (!(samples instanceof Float32Array) || samples.length!==frames) throw new Error('音频转换结果长度错误');
  const pcm=encodePcm16(samples);
  return {pcm,wav:pcmToWav(pcm),sampleRate:TARGET_RATE,channels:1,bitDepth:16,duration:frames/TARGET_RATE};
}
export async function decodeRecording(blob, {createDecoder=() => {
  if (!globalThis.AudioContext) throw new Error('此浏览器不支持音频解码');
  return new AudioContext();
}, resample, signal, cleanupTimeoutMs=1000} = {}) {
  if(!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs<1 || cleanupTimeoutMs>5000) throw new Error('音频清理超时无效');
  if (!(blob instanceof Blob) || !blob.size || blob.size>24*1024*1024) throw new Error('录音为空或过大');
  signal?.throwIfAborted();const decoder=createDecoder();
  try {
    const bytes=await blob.arrayBuffer();signal?.throwIfAborted();
    let decoded;
    try {decoded=await decoder.decodeAudioData(bytes);} catch {throw new Error('无法解码录音，请更换浏览器或重新录音');}
    signal?.throwIfAborted();return await convertAudio(decoded,{resample,signal});
  } finally {
    // Disposal cannot replace the conversion outcome or hang it indefinitely.
    let cleanupTimer;
    try {await Promise.race([
      Promise.resolve().then(()=>decoder.close()).catch(()=>{}),
      new Promise(resolve=>{cleanupTimer=setTimeout(resolve,cleanupTimeoutMs);})
    ]);} finally {clearTimeout(cleanupTimer);}
  }
}


export function importPcmWav(bytes) {
  if(!(bytes instanceof ArrayBuffer) || bytes.byteLength<44 || bytes.byteLength>3840000+65536)throw new Error('WAV文件无效或过大');
  const view=new DataView(bytes),tag=offset=>String.fromCharCode(...new Uint8Array(bytes,offset,4));
  if(tag(0)!=='RIFF' || tag(8)!=='WAVE' || view.getUint32(4,true)!==bytes.byteLength-8)throw new Error('WAV文件头或长度无效');
  let formatSeen=false,pcm;
  for(let offset=12;offset<bytes.byteLength;) {
    if(offset+8>bytes.byteLength)throw new Error('WAV数据块不完整');
    const kind=tag(offset),size=view.getUint32(offset+4,true),start=offset+8,end=start+size;
    if(end>bytes.byteLength || end+(size%2)>bytes.byteLength)throw new Error('WAV数据块长度无效');
    if(kind==='fmt ') {
      if(formatSeen || size<16)throw new Error('WAV格式块无效');formatSeen=true;
      if(view.getUint16(start,true)!==1 || view.getUint16(start+2,true)!==1 || view.getUint32(start+4,true)!==16000 || view.getUint32(start+8,true)!==32000 || view.getUint16(start+12,true)!==2 || view.getUint16(start+14,true)!==16)throw new Error('只支持16kHz单声道16bit PCM WAV，请导入项目下载的识别音频');
    } else if(kind==='data') {if(pcm)throw new Error('WAV音频块重复');pcm=bytes.slice(start,end);}
    offset=end+(size%2);
  }
  if(!formatSeen || !pcm || pcm.byteLength<3200 || pcm.byteLength>3840000 || pcm.byteLength%2)throw new Error('WAV音频长度无效，支持0.1—120秒');
  return {pcm,wav:pcmToWav(pcm),sampleRate:16000,channels:1,bitDepth:16,duration:pcm.byteLength/32000};
}
