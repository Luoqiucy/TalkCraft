import {AsrDiagnosticError,serviceFailure} from './asr-diagnostic.mjs';
import {encodeAsrInit,encodeAsrAudio,parseAsrResponse} from './volcengine-protocol.mjs';
// Transport contract: on/off, connect(), send(frame), close(). Operations may
// return promises. Default termination marks the last PCM chunk. An explicit
// terminalFrame is retained only for programmatic transport test fixtures.
export async function runAsrSession({transport,pcm,terminalFrame,signal,timeoutMs=30000,cleanupTimeoutMs=1000,sendIntervalMs=100,waitForInitAck=true,hotwords=[]}={}) {
  if(!transport || !['on','off','connect','send','close'].every(key=>typeof transport[key]==='function'))throw new Error('ASR传输接口无效');
  if(!(pcm instanceof Uint8Array) || pcm.length<3200 || pcm.length>3840000 || pcm.length%2)throw new Error('ASR会话PCM无效');
  if(terminalFrame!==undefined && (!(terminalFrame instanceof Uint8Array) || !terminalFrame.length || terminalFrame.length>1048576))throw new Error('ASR终止帧无效');
  if(!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>120000)throw new Error('ASR会话超时无效');
  if(!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs<1 || cleanupTimeoutMs>5000)throw new Error('ASR清理超时无效');
  // Zero is reserved for in-process protocol fixtures, never an environment setting.
  if(!Number.isInteger(sendIntervalMs) || (sendIntervalMs!==0 && (sendIntervalMs<100 || sendIntervalMs>200)))throw new Error('ASR发送间隔无效');
  if(typeof waitForInitAck!=='boolean')throw new Error('ASR初始化等待配置无效');
  signal?.throwIfAborted();
  let initialized=false,terminalSent=false,finished=false,resolveInit,resolveFinal,rejectFailure;
  const init=new Promise(resolve=>resolveInit=resolve),final=new Promise(resolve=>resolveFinal=resolve);
  const failure=new Promise((_,reject)=>rejectFailure=reject);
  // A failure may arrive before connect() starts. Always attach a rejection
  // handler immediately; awaited races still preserve the original rejection.
  failure.catch(()=>{});
  function fail(error){if(!finished){finished=true;rejectFailure(error);}}
  function message(frame){
    if(finished)return;
    try{
      const parsed=parseAsrResponse(frame);
      if(parsed.type===15)throw serviceFailure(parsed.code);
      if(parsed.type!==9)return;
      const responseCode=parsed.payload?.code;
      if(responseCode!==undefined){
        if(!Number.isSafeInteger(responseCode) || responseCode<0 || responseCode>4294967295)throw new Error('ASR协议响应无效');
        if(responseCode!==0 && responseCode!==20000000)throw serviceFailure(responseCode);
      }
      if(parsed.final && !terminalSent)throw new Error('ASR会话提前结束');
      if(!initialized){initialized=true;resolveInit();}
      if(parsed.final){const text=parsed.payload?.result?.text;if(typeof text!=='string' || !text.trim() || text.length>12000)throw new Error('ASR最终文本无效');finished=true;resolveFinal(text.trim());}
    }catch(error){if(error instanceof AsrDiagnosticError){fail(error);return;}fail(new Error(error.message==='ASR协议响应无效'?error.message:error.message==='ASR最终文本无效'?error.message:error.message==='ASR会话提前结束'?error.message:'ASR服务返回错误，请检查凭据和服务权限'));}
  }
  const closed=()=>fail(new Error('ASR连接提前断开'));
  const errored=error=>fail(error instanceof AsrDiagnosticError ? error : new Error('ASR连接失败，请检查网络与服务配置'));
  const aborted=()=>fail(new DOMException('已取消ASR会话','AbortError'));
  const timer=setTimeout(()=>fail(new Error('ASR会话超时')),timeoutMs);
  transport.on('message',message);transport.on('close',closed);transport.on('error',errored);signal?.addEventListener('abort',aborted,{once:true});
  let pacingTimer;
  let audioSent=false;
  async function sendAudio(frame,{ending=false}={}) {
    if(audioSent && sendIntervalMs) await step(()=>new Promise(resolve=>{pacingTimer=setTimeout(resolve,sendIntervalMs);}));
    return step(()=>{audioSent=true;if(ending)terminalSent=true;return transport.send(frame);});
  }
  const step=operation=>Promise.race([Promise.resolve().then(()=>{if(finished) return failure;signal?.throwIfAborted();return operation();}),failure]);
  try{
    await step(()=>transport.connect());
    await step(()=>transport.send(encodeAsrInit(hotwords)));if(waitForInitAck)await Promise.race([init,failure]);
    const lastOffset=Math.floor((pcm.length-1)/6400)*6400;
    const audioEnd=terminalFrame===undefined?lastOffset:pcm.length;
    for(let offset=0;offset<audioEnd;offset+=6400)await sendAudio(encodeAsrAudio(pcm.subarray(offset,Math.min(offset+6400,pcm.length))));
    const ending=terminalFrame===undefined?encodeAsrAudio(pcm.subarray(lastOffset),{final:true}):terminalFrame;
    await Promise.race([sendAudio(ending,{ending:true}),final]);
    return await Promise.race([final,failure]);
  }catch(error){if(error?.name==='AbortError' || error instanceof AsrDiagnosticError)throw error;throw new Error(['ASR会话超时','ASR协议响应无效','ASR最终文本无效','ASR会话提前结束','ASR连接提前断开'].includes(error?.message)?error.message:'ASR会话失败，请检查网络、凭据与服务权限');}
  finally{
    finished=true;clearTimeout(timer);clearTimeout(pacingTimer);signal?.removeEventListener('abort',aborted);
    transport.off('message',message);transport.off('close',closed);transport.off('error',errored);
    // Await actual socket disposal before returning, but a broken adapter must
    // not hang a successful response or cancellation indefinitely.
    let cleanupTimer;
    try{
      await Promise.race([
        Promise.resolve().then(()=>transport.close()).catch(()=>{}),
        new Promise(resolve=>{cleanupTimer=setTimeout(resolve,cleanupTimeoutMs);})
      ]);
    }finally{clearTimeout(cleanupTimer);}
  }
}
