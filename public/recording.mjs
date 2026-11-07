export const RECORDING_MAX_MS=120000;
// Each capture owns its stream and callbacks; a late event cannot stop a later capture.
export function createRecordingSession({getUserMedia, Recorder, onState = () => {}, onStream = () => {}, onComplete = () => {}, onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, maxMs = RECORDING_MAX_MS, maxBytes = 24 * 1024 * 1024, stopTimeoutMs = 5000}) {
  if(!Number.isInteger(stopTimeoutMs)||stopTimeoutMs<1||stopTimeoutMs>30000)throw new TypeError('停止录音超时无效');
  let state = 'idle', active, disposed = false;
  const update = next => {state = next; onState(next);};
  const release = capture => {
    clearTimer(capture.timer);
    clearTimer(capture.stopTimer);
    for(const track of capture.watchedTracks??[])track.removeEventListener?.('ended',capture.trackEnded);
    capture.watchedTracks=[];
    if (capture.stream && !capture.released) {
      capture.released = true; capture.stream.getTracks().forEach(track => track.stop());
      if(capture.meterAttached)onStream(null);
    }
  };
  const fail = (capture, error) => {
    if (active !== capture || disposed) return;
    active = undefined; release(capture);
    if (capture.recorder?.state === 'recording') {
      try {capture.recorder.stop();} catch { /* resources already released */ }
    }
    update('error'); onError(error);
  };
  const session = {
    get state() {return state;},
    async start({deviceId,speakerSuppression=false}={}) {
      if (disposed || active) return false;
      const capture = {chunks: [], size: 0}; active = capture; update('acquiring');
      try {
        if (!getUserMedia || !Recorder) throw new Error('此环境不支持录音，请使用系统浏览器打开本地地址');
        if(deviceId!==undefined&&(typeof deviceId!=='string'||!deviceId.trim()||deviceId.length>512||deviceId.includes('\0')))throw new Error('麦克风设备编号无效');
        const audio = deviceId === undefined ? {} : {deviceId:{exact:deviceId}};
        if (speakerSuppression === true) {
          audio.echoCancellation = true;
          audio.noiseSuppression = true;
        }
        capture.stream = await getUserMedia({audio: Object.keys(audio).length ? audio : true});
        if (disposed || active !== capture) {release(capture); return false;}
        capture.trackEnded=()=>fail(capture,new Error('麦克风已断开或停止提供音频，请重新选择麦克风后录音'));
        capture.watchedTracks=capture.stream.getTracks().filter(track=>track.kind==='audio'&&typeof track.addEventListener==='function');
        for(const track of capture.watchedTracks){
          if(track.readyState==='ended')throw new Error('麦克风已断开，请重新选择麦克风后录音');
          track.addEventListener('ended',capture.trackEnded);
        }
        const recorder = new Recorder(capture.stream); capture.recorder = recorder;
        recorder.ondataavailable = event => {
          if (active !== capture || disposed || !event.data.size) return;
          capture.size += event.data.size;
          if (capture.size > maxBytes) {fail(capture, new Error('录音内容过大，请缩短录音')); return;}
          capture.chunks.push(event.data);
        };
        recorder.onerror = () => fail(capture, new Error('录音设备发生错误，请重试'));
        recorder.onstop = () => {
          if (active !== capture || disposed) return;
          release(capture); active = undefined;
          if (!capture.size) {update('error');onError(new Error('录音没有有效音频，请重试'));return;}
          const blob = new Blob(capture.chunks, {type: recorder.mimeType});
          update('ready'); onComplete(blob);
        };
        recorder.start(1000); update('recording');capture.meterAttached=true;onStream(capture.stream);
        capture.timer = setTimer(() => session.stop(), maxMs);
        return true;
      } catch (error) {fail(capture, error);return false;}
    },
    stop() {
      const capture = active;
      if (!capture || state !== 'recording') return false;
      update('stopping');clearTimer(capture.timer);
      try {
        capture.recorder.stop();release(capture);
        if(active===capture&&state==='stopping')capture.stopTimer=setTimer(()=>fail(capture,new Error('停止录音超时，请重试；本次录音未完成保存')),stopTimeoutMs);
        return true;
      }
      catch (error) {fail(capture,error);return false;}
    },
    cancel() {
      const capture = active;
      if (!capture || !['acquiring','recording','stopping'].includes(state)) return false;
      active = undefined;
      release(capture);
      if (capture.recorder?.state === 'recording') {
        try {capture.recorder.stop();} catch { /* cancelled capture is already detached */ }
      }
      update('idle');
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true; const capture = active; active = undefined;
      if (capture) {
        release(capture);
        if (capture.recorder?.state === 'recording') {try {capture.recorder.stop();} catch {}}
      }
      update('disposed');
    }
  };
  return session;
}
export function createMicrophonePicker({mediaDevices,select,refreshButton,notice,document:doc,timeoutMs=4000,setTimer=setTimeout,clearTimer=clearTimeout}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new TypeError('设备枚举超时无效');
  let selected='',devices=[],loading=false,locked=false,disposed=false,generation=0,cancelRefresh;
  const supported=typeof mediaDevices?.enumerateDevices==='function';
  const sync=()=>{select.disabled=disposed||locked||loading||!supported;refreshButton.disabled=disposed||locked||loading||!supported;};
  const render=()=>{
    const options=[{id:'',label:'电脑默认麦克风'},...devices];
    if(selected&&!devices.some(item=>item.id===selected))options.push({id:selected,label:'所选麦克风已断开 · 请重新选择'});
    select.replaceChildren(...options.map(item=>{const option=doc.createElement('option');option.value=item.id;option.textContent=item.label;return option;}));select.value=selected;
  };
  async function refresh(){
    if(disposed||locked||loading||!supported)return;
    loading=true;const current=++generation;sync();notice.textContent='正在读取电脑麦克风…';
    let timer;
    try{
      const deadline=new Promise((_,reject)=>{
        cancelRefresh=()=>reject(Object.assign(new Error('已关闭设备选择'),{name:'AbortError'}));
        timer=setTimer(()=>reject(Object.assign(new Error('读取设备列表超时'),{name:'TimeoutError'})),timeoutMs);
      });
      const found=await Promise.race([mediaDevices.enumerateDevices(),deadline]);if(disposed||current!==generation)return;
      const ids=new Set();devices=found.filter(item=>item.kind==='audioinput'&&item.deviceId&&item.deviceId!=='default'&&!ids.has(item.deviceId)&&ids.add(item.deviceId)).map((item,index)=>({id:item.deviceId,label:item.label||`麦克风 ${index+1}（录音授权后显示名称）`}));
      render();notice.textContent=selected&&!devices.some(item=>item.id===selected)?'所选麦克风已断开，请重新选择；录音和文字已保留。':devices.length?'设备列表已更新；选择仅影响下一次录音。':'未读取到具体设备，可使用默认输入并在录音授权后刷新。';
    }catch(error){if(!disposed&&current===generation)notice.textContent=error?.name==='TimeoutError'?'读取设备列表超时，可刷新重试或使用当前输入；录音和文字已保留。':'无法读取设备列表，可重试；原选择、录音和文字已保留。';}
    finally{clearTimer(timer);if(current===generation)cancelRefresh=undefined;if(!disposed&&current===generation){loading=false;sync();}}
  }
  const change=()=>{if(locked||loading){select.value=selected;return;}selected=select.value;notice.textContent='输入来源已选择，仅影响下一次录音；尚未申请权限或上传。';};
  const deviceChange=()=>refresh();
  select.addEventListener('change',change);refreshButton.addEventListener('click',refresh);mediaDevices?.addEventListener?.('devicechange',deviceChange);
  if(!supported)notice.textContent='当前环境不支持列出设备，继续使用电脑默认麦克风。';sync();
  return {refresh,setLocked(value){const wasLocked=locked;locked=value;sync();if(wasLocked&&!locked)refresh();},getStartOptions(){
    if(loading)return {error:'正在读取麦克风列表，请稍后录音'};
    if(selected&&!devices.some(item=>item.id===selected))return {error:'所选麦克风不可用，请刷新或选择电脑默认麦克风'};
    return selected?{deviceId:selected}:{};
  },dispose(){if(disposed)return;disposed=true;cancelRefresh?.();cancelRefresh=undefined;generation++;sync();mediaDevices?.removeEventListener?.('devicechange',deviceChange);}};
}

