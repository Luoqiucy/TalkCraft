import {AsrDiagnosticError} from './asr-diagnostic.mjs';
import {readVolcengineAsrConfig} from './asr-config.mjs';
import {createAsrTransport} from './asr-transport.mjs';
import {runAsrSession} from './asr-session.mjs';
export function createVolcengineAsrProvider({env=process.env,transportFactory=createAsrTransport}={}) {
  const config=readVolcengineAsrConfig(env);
  return Object.freeze({id:'volcengine',enabled:true,simulated:false,
    async transcribe(pcm,{signal}={}) {
      if(!(pcm instanceof Uint8Array) || pcm.length<3200 || pcm.length>3840000 || pcm.length%2) throw new Error('ASR会话PCM无效');
      signal?.throwIfAborted();
      try {
        const headers=config.createHeaders();
        const transport=transportFactory({headers,handshakeTimeoutMs:Math.min(config.timeoutMs,10000)});
        return await runAsrSession({transport,pcm,signal,hotwords:config.getHotwords(),timeoutMs:config.timeoutMs,waitForInitAck:!headers['X-Api-Resource-Id'].startsWith('volc.seedasr.')});
      } catch(error) {
        if(error?.name==='AbortError')throw error;
        const timeout=error?.message==='ASR会话超时';
        const safe=new Error(error instanceof AsrDiagnosticError ? error.message : timeout?'语音识别超时，请保留音频后重试':'语音识别失败，请检查网络、凭据和模型服务');
        safe.status=error instanceof AsrDiagnosticError && error.status===422?422:timeout?504:502;throw safe;
      }
    }
  });
}
