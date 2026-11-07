async function playKokoro(text: string, sid: number, speed: number, volume: number, signal: AbortSignal) {
  const response = await fetch('/api/local-voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sid, speed }),
    signal
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Kokoro 本机合成失败');
  }
  const blob = await response.blob();
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = volume;
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => { audio.pause(); resolve(); };
      signal.addEventListener('abort', stop, { once: true });
      audio.onended = () => { signal.removeEventListener('abort', stop); resolve(); };
      audio.onerror = () => reject(new Error('本机音频播放失败'));
      void audio.play().catch(reject);
    });
  } finally {
    audio.pause();
    URL.revokeObjectURL(url);
  }
}

export type SpeechVoice={voiceURI:string;name:string;lang:string;localService:boolean;default:boolean};
type SynthesisLike={cancel:()=>void;speak:(utterance:SpeechSynthesisUtterance)=>void;getVoices:()=>SpeechSynthesisVoice[];addEventListener?:(type:string,listener:()=>void)=>void};
const instanceId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;
let channel:BroadcastChannel|undefined;let active:SynthesisLike|undefined;let activeUtterance:SpeechSynthesisUtterance|undefined;let generation=0;
let localPlayback: AbortController | undefined;
let savedOptions:{voiceURI?:string;rate?:number;volume?:number}={};
function getChannel(){if(typeof BroadcastChannel==='undefined')return undefined;if(!channel){channel=new BroadcastChannel('talkcraft-tts-playback-v1');channel.addEventListener('message',event=>{const data=event.data;if(data?.type==='start'&&data.sender!==instanceId){generation++;localPlayback?.abort();active?.cancel();active=undefined;activeUtterance=undefined;notifyStopped();}});}return channel;}
function notifyStopped(){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('talkcraft-speech-stopped'));}
export function listLocalSpeechVoices(synthesis:Pick<SynthesisLike,'getVoices'>|undefined=typeof speechSynthesis==='undefined'?undefined:speechSynthesis){return (synthesis?.getVoices()||[]).filter(voice=>voice.localService).map(({voiceURI,name,lang,localService,default:defaultVoice})=>({voiceURI,name,lang,localService,default:defaultVoice}));}
export function cleanSpeechText(value:string){const lines=String(value||'').replace(/```[\s\S]*?```/g,' ').split(/\r?\n/).map(line=>{if(/^\s*\|?\s*:?-{3,}/.test(line)&&/\|/.test(line))return' ';if(/^\s*\|.*\|\s*$/.test(line))return line.replace(/^\s*\|\s*|\s*\|\s*$/g,'').replace(/\s*\|\s*/g,'，');return line;});return lines.join(' ').replace(/`([^`]*)`/g,'$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,' ').replace(/\[(\d{1,2})\]/g,' ').replace(/^\s{0,3}#{1,6}\s*/gm,'').replace(/^\s*[-*_]{3,}\s*$/gm,' ').replace(/^\s*[-*+]\s+/gm,'').replace(/<[^>]*>/g,' ').replace(/[*_~>#]/g,'').replace(/\s+/g,' ').trim();}
export function conciseSpeechCandidate(value:string){const text=cleanSpeechText(value);if(!text)return {text:'',eligible:false,reason:'回答为空'};const sentences=text.match(/[^。！？.!?]+[。！？.!?]?/g)?.map(item=>item.trim()).filter(Boolean)||[];if(sentences.length>4||text.length>600)return {text:'',eligible:false,reason:'回答较长，避免截去条件或资料缺口'};return {text,eligible:true,reason:''};}
export function shouldAutoSpeakCompletedAnswer(input:{mode:string;webSearchEnabled:boolean;autoSpeakEnabled:boolean;searchPerformed:boolean}){return input.mode==='chat'&&input.webSearchEnabled&&input.autoSpeakEnabled&&input.searchPerformed;}
export function setSpeechPreferences(options:{voiceURI?:string;rate?:number;volume?:number}){savedOptions={...options};}
export function createSpeechController({synthesis=typeof speechSynthesis==='undefined'?undefined:speechSynthesis,utteranceFactory=(text:string)=>new SpeechSynthesisUtterance(text),broadcast}:{synthesis?:SynthesisLike;utteranceFactory?:(text:string)=>SpeechSynthesisUtterance;broadcast?:BroadcastChannel}={}){
 const bus=()=>broadcast||getChannel();
 return {available:()=>savedOptions.voiceURI?.startsWith('kokoro:')===true || (!!synthesis&&listLocalSpeechVoices(synthesis).length>0),voices:()=>listLocalSpeechVoices(synthesis),stop(){generation++;localPlayback?.abort();synthesis?.cancel();active=undefined;activeUtterance=undefined;notifyStopped();bus()?.postMessage({type:'stop',sender:instanceId});},async play(text:string,options:{voiceURI?:string;rate?:number;volume?:number}={}){
   const effective={...savedOptions,...options};
   localPlayback?.abort();
   if (effective.voiceURI?.startsWith('kokoro:')) {
     const cleaned = cleanSpeechText(text);
     if (!cleaned) throw new Error('没有可朗读的文字');
     const request = new AbortController();
     localPlayback = request;
     generation++;
     synthesis?.cancel();
     bus()?.postMessage({type:'start',sender:instanceId});
     try {
       await playKokoro(cleaned, Number(effective.voiceURI.slice(7)), effective.rate??1, effective.volume??1, request.signal);
     } catch (error) {
       if (!request.signal.aborted) throw error;
     } finally {
       if (localPlayback === request) { localPlayback = undefined; notifyStopped(); }
     }
     return;
   }
   if(!synthesis)throw new Error('当前桌面语音服务不可用');const voices=synthesis.getVoices().filter(voice=>voice.localService);if(!voices.length)throw new Error('没有可用的本机语音；请在Windows语音设置中安装语音');const cleaned=cleanSpeechText(text);if(!cleaned)throw new Error('没有可朗读的文字');const voice=voices.find(item=>item.voiceURI===effective.voiceURI)||voices.find(item=>item.default)||voices[0];const ticket=++generation;synthesis.cancel();active=synthesis;bus()?.postMessage({type:'start',sender:instanceId});return new Promise<void>((resolve,reject)=>{const utterance=utteranceFactory(cleaned);activeUtterance=utterance;utterance.voice=voice;utterance.lang=voice.lang||'zh-CN';utterance.rate=Math.min(2,Math.max(.5,effective.rate||1));utterance.volume=Math.min(1,Math.max(0,effective.volume??1));const startTimer=setTimeout(()=>{
    if(ticket!==generation){resolve();return;}
    generation++;active=undefined;activeUtterance=undefined;
    reject(new Error('本机语音未开始播放，请点击播放摘要重试'));
    synthesis.cancel();notifyStopped();
  },5000);
  utterance.onstart=()=>clearTimeout(startTimer);
  utterance.onend=()=>{clearTimeout(startTimer);if(ticket===generation){active=undefined;activeUtterance=undefined;notifyStopped();}resolve();};utterance.onerror=event=>{clearTimeout(startTimer);if(ticket!==generation||event.error==='canceled'||event.error==='interrupted'){notifyStopped();resolve();return;}active=undefined;activeUtterance=undefined;notifyStopped();reject(new Error(event.error==='not-allowed'?'自动播放受限，请点击播放摘要':'本机语音播放失败（'+event.error+'）'));};try{synthesis.speak(utterance);}catch(error){clearTimeout(startTimer);if(ticket===generation){active=undefined;activeUtterance=undefined;notifyStopped();}reject(error instanceof Error?error:new Error('本机语音播放失败'));}});}};
}
export const speechController=createSpeechController();
