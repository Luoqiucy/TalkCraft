import {RECORDING_MAX_MS} from './recording.mjs';
import {deviceVisual,elapsedLabel,recordingTiming} from './live-state.mjs';
if (!/[?&](?:hud=1|panel=)(?:[^&]*)/.test(globalThis.location?.search || '')) {
const $=id=>document.getElementById(id),all=selector=>document.querySelectorAll(selector);
document.body.dataset.mode='dictation';
let disposed=false,request,timer,captureStart,tick,context,source,analyser,meterTimer,meterEpoch=0;
function device(data){const v=deviceVisual(data);all('[data-device-name]').forEach(el=>el.textContent=v.name);all('[data-device-dot]').forEach(el=>el.dataset.state=v.connection==='connected'?'online':v.connection==='connecting'?'checking':'offline');all('[data-battery]').forEach(el=>el.textContent=v.battery===null?'—':`${Math.round(v.battery)}%`);all('[data-battery-fill]').forEach(el=>el.style.width=`${v.battery??0}%`);all('[data-signal-label]').forEach(el=>el.textContent=v.signalLabel);all('[data-signal-bars]').forEach(el=>{el.setAttribute('aria-label',v.signalLabel);el.querySelectorAll('i').forEach((bar,index)=>bar.dataset.lit=String(index<v.bars));});}
async function poll(){
 if(disposed || request)return;request=new AbortController();const current=request,started=performance.now();
 all('[data-service-dot]').forEach(el=>el.dataset.state='checking');
 const timeout=setTimeout(()=>current.abort(),4000);
 try{const response=await fetch('/api/telemetry',{signal:current.signal});if(!response.ok)throw new Error('不可用');const data=await response.json();if(disposed)return;
  device(data.device);$('engineLabel').textContent='本地服务在线';$('engineRtt').textContent=`${Math.round(performance.now()-started)} ms`;$('serviceBadge').textContent=data.service?.simulated?'模拟文字服务':data.service?.local ? '本机 Ollama 已配置' : `${data.service?.provider || '文字云端'} 已配置`;all('[data-service-dot]').forEach(el=>el.dataset.state='online');
 }catch{if(!disposed){device({connection:'disconnected',name:'设备状态不可用'});$('engineLabel').textContent='本地服务离线';$('engineRtt').textContent='— ms';$('serviceBadge').textContent='本地连接中断';all('[data-service-dot]').forEach(el=>el.dataset.state='offline');}}
 finally{clearTimeout(timeout);request=undefined;if(!disposed)timer=setTimeout(poll,10000);}
}
function stopMeter(){meterEpoch++;clearTimeout(meterTimer);meterTimer=undefined;source?.disconnect();source=undefined;analyser=undefined;context?.close().catch(()=>{});context=undefined;}
function meter(stream){stopMeter();if(!stream)return;
 try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;context=new Audio();source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);context.resume().catch(()=>{});
  const samples=new Float32Array(analyser.fftSize),epoch=meterEpoch;function draw(){if(!analyser || disposed || epoch!==meterEpoch)return;analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);const db=rms>0?Math.max(-96,20*Math.log10(rms)):-96;$('captureLevel').textContent=`${Math.round(db)} dBFS`;$('audioWave').setAttribute('aria-label',`实时音量 ${Math.round(db)} dBFS`);
   $('audioWave').querySelectorAll('i').forEach((el,i)=>{const segment=samples.slice(i*8,i*8+8);const energy=Math.sqrt(segment.reduce((sum,x)=>sum+x*x,0)/segment.length);el.style.height=`${Math.min(22,3+energy*1800)}px`;el.style.opacity='.9';});meterTimer=setTimeout(draw,66);}
  draw();
 }catch{stopMeter();$('captureLevel').textContent='音量不可用';}
}
window.addEventListener('capture-stream',event=>meter(event.detail.stream));
function renderRecordingTime(final=false){
 const value=recordingTiming(performance.now()-captureStart,RECORDING_MAX_MS);
 $('captureTime').textContent=value.elapsed;
 const limit=$('captureLimit');limit.dataset.warning=String(value.nearLimit&&!final);
 limit.dataset.compact=value.reached?'已达上限':`剩余 ${value.remaining} / ${value.limit}`;
 limit.textContent=final?(value.reached?`已达上限 ${value.limit} · 自动停止`:`已录 ${value.elapsed} · 上限 ${value.limit}`):`上限 ${value.limit} · 剩余 ${value.remaining} · 到时自动停止`;
}
window.addEventListener('capture-state',event=>{
 const state=event.detail.state;document.body.dataset.capture=state;clearInterval(tick);
 if(state==='recording'){captureStart=performance.now();renderRecordingTime();tick=setInterval(()=>renderRecordingTime(),200);}
 else{
  stopMeter();if(state==='stopping'&&captureStart!==undefined)renderRecordingTime(true);
  if(['idle','error','acquiring','disposed'].includes(state)){
   captureStart=undefined;$('captureTime').textContent='00:00';$('captureLimit').dataset.warning='false';$('captureLimit').dataset.compact='上限 02:00';$('captureLimit').textContent=`单次上限 ${elapsedLabel(RECORDING_MAX_MS)} · 到时自动停止`;
   $('captureLevel').textContent='音量未知';$('audioWave').querySelectorAll('i').forEach(el=>{el.style.height='4px';el.style.opacity='.35';});
  }
 }
});
window.addEventListener('processing-state',event=>{document.body.dataset.processing=String(event.detail.busy);$('processingTime').textContent=event.detail.busy?'正在处理…':event.detail.elapsedMs!==undefined?`${(event.detail.elapsedMs/1000).toFixed(2)}s · 本次请求`:'尚未处理';});
document.querySelectorAll('[data-tone]').forEach(el=>el.addEventListener('click',()=>{$('tone').value=el.dataset.tone;$('tone').dispatchEvent(new Event('change'));}));
function tone(){const active=$('tone').value;all('[data-tone]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.tone===active)));}
$('tone').addEventListener('change',tone);tone();
all('[data-mode]').forEach(el=>el.addEventListener('click',()=>{document.body.dataset.mode=el.dataset.mode;all('[data-tone]').forEach(button=>button.disabled=el.dataset.mode!=='prompt');const img=document.createElement('img');img.className='figma-icon';img.alt='';img.src='/assets/figma/'+({dictation:'imgContainer',prompt:'imgContainer1',translate:'imgContainer2',chat:'imgContainer3'}[el.dataset.mode])+'.svg';$('process').textContent=$('process').textContent.replace(/^[✧文▢]\s*/,'');$('process').prepend(img);}));
$('playAudio').addEventListener('click',()=>{if($('playback').paused)$('playback').play().catch(()=>{});else $('playback').pause();});
new MutationObserver(()=>$('playAudio').disabled=$('playback').hidden).observe($('playback'),{attributes:true,attributeFilter:['hidden','src']});
$('playback').addEventListener('timeupdate',()=>{if(document.body.dataset.capture!=='recording')$('captureTime').textContent=elapsedLabel($('playback').currentTime*1000);});
$('checkService').addEventListener('click',()=>{clearTimeout(timer);poll();});
window.addEventListener('beforeunload',()=>{disposed=true;request?.abort();clearTimeout(timer);clearInterval(tick);stopMeter();});
device();poll();

}


