import {createRecordingSession} from './recording.mjs';
import {decodeRecording} from './audio.mjs';
import {createConversation} from './conversation.mjs';
const $ = id => document.getElementById(id);
let mode = 'dictation', recordingUrl, recordingBlob, preparedUrl, preparedAudio, audioController, asrController, asrPreview, controller, output = '', service;
const status = text => {$('status').textContent = text;};
const conversation=createConversation();let chatGeneration=0;
function updateConversation() {
  $('chatHistory').textContent=conversation.history.map(message => `${message.role==='user' ? '你' : 'AI'}：${message.content}`).join('\n\n');
  $('chatCount').textContent=`已保留 ${conversation.history.length/2} 轮，仅保存在当前页面`;
}
updateConversation();
$('process').disabled = true;
async function refreshService() {
  try {
    const response = await fetch('/api/status'); if (!response.ok) throw new Error('无法读取服务配置');
    service = await response.json();
    const audioState=!service.audioTranscription ? '语音识别关闭。' : service.asrSimulated ? '语音识别为模拟，主动提交仅发送到本机服务，不上传云端，也不会真正识别音频。' : '语音识别将调用云端，提交前需单独确认音频上传。';
    $('providerNotice').textContent = `${service.simulated ? '文字处理为模拟，未调用真实 AI。' : '文字处理已配置火山方舟，提交文本后将发送至云端。'} ${audioState}`;
    $('asrNotice').textContent=audioState;
    $('audioConsentLabel').hidden=!service.audioTranscription || service.asrSimulated;
    $('consentLabel').hidden = service.simulated;
    status(service.simulated ? '就绪 · 模拟模式' : '就绪 · 云端文本模式'); $('process').disabled = false;
    syncAsrButtons();
  } catch (error) {status(`服务配置读取失败：${error.message}，请刷新页面重试`);}
}
refreshService();
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  $('languageLabel').hidden = mode !== 'translate';
  $('chatPanel').hidden=mode!=='chat';
}));
$('process').addEventListener('click', async () => {
  if (!service) return;
  if (!service.simulated && !$('cloudConsent').checked) {status('请先确认将文本发送至云端'); return;}
  if(controller) return;
  const active=new AbortController();controller=active;
  const requestMode=mode,question=$('transcript').value,generation=chatGeneration;
  $('process').disabled = true; $('cancel').disabled = false;
  status(service.simulated ? '正在处理 · 模拟模式' : '正在处理 · 云端文本模式');
  try {
    const response = await fetch('/api/process', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode:requestMode, text:question,history:requestMode==='chat' ? conversation.history : [], targetLanguage: $('language').value, cloudConsent: $('cloudConsent').checked}), signal: active.signal});
    const data = await response.json();active.signal.throwIfAborted(); if (!response.ok) throw new Error(data.error);
    if(typeof data.text!=='string' || !data.text.trim() || typeof data.simulated!=='boolean') throw new Error('文字处理结果无效');
    if(requestMode==='chat' && generation!==chatGeneration) return;
    output = data.text; $('result').textContent = output; $('copy').disabled = false;
    let retained=true;
    if(requestMode==='chat') {retained=conversation.addTurn(question,output);updateConversation();}
    status(`${data.simulated ? '处理完成 · 模拟结果，未调用 AI' : '处理完成'}${retained ? '' : '；回答过长，已清空上下文'}`);
  } catch (error) {status(error.name === 'AbortError' ? '已取消处理' : `处理失败：${error.message}`);}
  finally {$('process').disabled = false; $('cancel').disabled = true; if(controller===active)controller = undefined;}
});
$('clearChat').addEventListener('click',() => {
  chatGeneration++;conversation.clear();controller?.abort();updateConversation();
  if(mode==='chat') {output='';$('result').textContent='会话已清空';$('copy').disabled=true;}
  status('问答上下文已清空');
});
$('cancel').addEventListener('click', () => controller?.abort());
$('copy').addEventListener('click', async () => {try {await navigator.clipboard.writeText(output); status('已复制结果');} catch {status('复制失败，请选中结果手动复制');}});
const recording = createRecordingSession({
  getUserMedia: navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices),
  Recorder: window.MediaRecorder,
  onState(state) {
    $('record').disabled = ['acquiring','stopping','disposed'].includes(state) || !!asrController;
    $('record').textContent = state === 'recording' ? '停止录音' : state === 'stopping' ? '正在结束录音…' : state === 'acquiring' ? '等待麦克风权限…' : '开始录音';
    $('discard').disabled = ['acquiring','recording','stopping','disposed'].includes(state) || !recordingUrl;
    $('prepareAudio').disabled = ['acquiring','recording','stopping','disposed'].includes(state) || !recordingBlob || !!audioController || !!asrController;
    syncAsrButtons(state);
    if (state === 'recording') status('正在本地录音 · 尚未提交识别，最多 2 分钟');
  },
  onComplete(blob) {
    clearPreparedAudio();recordingBlob=blob;
    $('playback').pause();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = URL.createObjectURL(blob);
    $('playback').src = recordingUrl; $('playback').hidden = false; $('discard').disabled = false;
    $('prepareAudio').disabled=false;
    status('录音已停止，仅保存在当前页面，尚未转写');
  },
  onError(error) {status(`无法录音：${error.message}`);}
});
function clearPreparedAudio() {
  audioController?.abort();
  asrController?.abort();preparedAudio=undefined;clearAsrPreview();syncAsrButtons();
  if (preparedUrl) URL.revokeObjectURL(preparedUrl);preparedUrl=undefined;
  $('downloadAudio').hidden=true;$('downloadAudio').removeAttribute('href');
  $('audioInfo').textContent='音频仅在本地转换，尚未接入自动转写。';
}
$('prepareAudio').addEventListener('click',async () => {
  if (!recordingBlob || audioController || asrController) return;
  clearAsrPreview();
  const active=new AbortController();audioController=active;
  $('prepareAudio').disabled=true;$('record').disabled=true;syncAsrButtons();status('正在本地转换音频，不上传');
  try {
    const audio=await decodeRecording(recordingBlob,{signal:active.signal});active.signal.throwIfAborted();preparedAudio=audio;
    if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    preparedUrl=URL.createObjectURL(new Blob([audio.wav],{type:'audio/wav'}));
    $('downloadAudio').href=preparedUrl;$('downloadAudio').hidden=false;
    $('audioInfo').textContent=`识别音频已准备：${audio.sampleRate} Hz · 单声道 · ${audio.bitDepth} bit · ${audio.duration.toFixed(2)} 秒`;
    status('本地音频转换完成，尚未上传或转写');
  } catch(error) {status(error.name==='AbortError' ? '已取消音频转换' : `音频转换失败：${error.message}`);}
  finally {
    if (audioController===active) audioController=undefined;
    $('record').disabled=recording.state==='disposed';$('prepareAudio').disabled=!recordingBlob || recording.state==='disposed';
    syncAsrButtons();
  }
});
function syncAsrButtons(state=recording.state) {
  const busy=['acquiring','recording','stopping','disposed'].includes(state);
  $('transcribeAudio').disabled=!service?.audioTranscription || !preparedAudio || !!audioController || !!asrController || busy;
  $('cancelAsr').disabled=!asrController;
}
function clearAsrPreview() {
  asrPreview=undefined;$('asrPreview').textContent='';$('asrPreviewPanel').hidden=true;$('applyAsr').disabled=true;
  $('replaceTranscript').checked=false;
}
$('transcribeAudio').addEventListener('click',async () => {
  if ($('transcribeAudio').disabled) return;
  if (!service.asrSimulated && !$('audioConsent').checked) {status('请确认将音频发送至云端识别');return;}
  clearAsrPreview();const active=new AbortController();asrController=active;
  const audio=preparedAudio;syncAsrButtons();$('record').disabled=true;$('prepareAudio').disabled=true;
  status(service.asrSimulated ? '正在模拟转写，未调用真实识别' : '正在云端识别音频');
  try {
    const response=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Audio-Sample-Rate':String(audio.sampleRate),'X-Audio-Channels':String(audio.channels),'X-Audio-Bit-Depth':String(audio.bitDepth),'X-Audio-Cloud-Consent':String($('audioConsent').checked)},body:audio.pcm,signal:active.signal});
    const data=await response.json();active.signal.throwIfAborted();if(!response.ok) throw new Error(data.error || '识别请求失败');
    if(typeof data.text!=='string' || !data.text.trim() || data.text.length>12000 || typeof data.simulated!=='boolean') throw new Error('识别结果无效');
    asrPreview=data.text;$('asrPreview').textContent=asrPreview;$('asrPreviewPanel').hidden=false;$('applyAsr').disabled=false;
    status(service.asrSimulated || data.simulated ? '模拟转写完成，未识别音频；可预览并手动使用' : '识别完成，请预览后使用');
  } catch(error) {status(error.name==='AbortError' ? '已取消转写' : `转写失败：${error.message}`);}
  finally {
    if(asrController===active) asrController=undefined;
    $('record').disabled=recording.state==='disposed';$('prepareAudio').disabled=!recordingBlob || recording.state==='disposed';syncAsrButtons();
  }
});
$('cancelAsr').addEventListener('click',() => asrController?.abort());
$('transcript').addEventListener('input',() => {$('replaceTranscript').checked=false;});
$('applyAsr').addEventListener('click',() => {
  if(!asrPreview) return;
  if($('transcript').value.trim() && !$('replaceTranscript').checked) {status('转写框已有内容，请勾选确认替换，或先清空文本');return;}
  $('transcript').value=asrPreview;$('replaceTranscript').checked=false;status('已使用转写预览，尚未提交文字处理');
});
$('record').addEventListener('click', async () => {
  if (audioController || asrController) return;
  if (recording.state === 'recording') recording.stop(); else await recording.start();
});
$('discard').addEventListener('click', () => {
  clearPreparedAudio();recordingBlob=undefined;$('prepareAudio').disabled=true;
  $('playback').pause(); $('playback').removeAttribute('src'); $('playback').load(); $('playback').hidden = true;
  if (recordingUrl) URL.revokeObjectURL(recordingUrl); recordingUrl = undefined;
  $('discard').disabled = true; status('已丢弃录音');
});
window.addEventListener('beforeunload', () => {recording.dispose(); controller?.abort();clearPreparedAudio();recordingBlob=undefined;if (recordingUrl) URL.revokeObjectURL(recordingUrl);});
