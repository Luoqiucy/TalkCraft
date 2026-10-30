import {createVolcengineAsrProvider} from './providers/volcengine-asr.mjs';
export const disabledAsr = {id:'disabled',enabled:false,simulated:false};
export const mockAsr = {
  id:'mock',enabled:true,simulated:true,
  async transcribe() {return '【模拟转写：未识别音频】请先验证真实语音识别，当前仅用于流程测试。';}
};
export function loadAsr(env=process.env) {
  const selected=env.ASR_PROVIDER || 'disabled';
  if(selected==='disabled') return disabledAsr;
  if(selected==='mock') return mockAsr;
  if(selected==='volcengine') return createVolcengineAsrProvider({env});
  throw new Error('ASR_PROVIDER 仅支持 disabled、mock 或 volcengine');
}
export function validatePcm(pcm,format) {
  if(format?.sampleRate!==16000 || format?.channels!==1 || format?.bitDepth!==16) throw new Error('识别输入必须是16kHz单声道16bit PCM');
  if(!(pcm instanceof Uint8Array) || pcm.byteLength<3200 || pcm.byteLength>3840000 || pcm.byteLength%2) throw new Error('PCM长度无效，支持0.1—120秒音频');
  return {sampleRate:16000,channels:1,bitDepth:16,duration:pcm.byteLength/32000};
}
export async function transcribeAudio(pcm,format,provider,signal) {
  if(!provider.enabled) {const error=new Error('语音识别未启用，请显式配置提供器');error.status=503;throw error;}
  const metadata=validatePcm(pcm,format);signal?.throwIfAborted();
  const text=await provider.transcribe(pcm,{...metadata,signal});signal?.throwIfAborted();
  if(typeof text!=='string' || !text.trim() || text.length>12000) throw new Error('识别服务返回文本无效');
  return {text:text.trim(),simulated:provider.simulated===true,duration:metadata.duration};
}
