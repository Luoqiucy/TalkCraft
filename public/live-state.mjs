export function shortcutFromKeyEvent(event,{rightAlt=false,rightShift=false}={}){
 const code=event.code;
 if(code==='AltRight')return rightShift?'RightAlt+RightShift':'RightAlt';
 if(rightAlt&&code==='ShiftRight')return 'RightAlt+RightShift';
 if(rightAlt&&code==='Space')return 'RightAlt+Space';
 const key=/^Key[A-Z]$/.test(code)?code.slice(3):/^Digit[0-9]$/.test(code)?code.slice(5):/^(F([1-9]|1[0-9]|2[0-4])|Enter|Space)$/.test(code)?code:undefined;
 if(!key)return null;
 return [event.ctrlKey?'Ctrl':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null,key].filter(Boolean).join('+');
}
export function initializeCloseUi({dialog,remember,message,invoke,storage,hasUnsaved=()=>false,beforeExit=async()=>{},afterExitFailure=async()=>{}}){
 const key='talkcraft-close-choice-v1';let busy=false;
 const read=()=>{try{return storage?.getItem(key);}catch{return null;}};
 const request=({force=false}={})=>{if(busy||dialog.open)return;const saved=read();if(!force&&['exit','minimize'].includes(saved)&&!(saved==='exit'&&hasUnsaved()))return choose(saved,false);remember.checked=false;message.textContent=hasUnsaved()?'退出将中断任务并丢失未保存录音，请先保存。最小化会继续在后台运行。':'请选择退出程序或最小化到右下角托盘。';dialog.showModal();};
 async function choose(action,persist){
  if(busy||!['exit','minimize'].includes(action))return;busy=true;const old=read();
  try{try{if(persist)storage?.setItem(key,action);}catch{}
   if(action==='exit')await beforeExit();
   await invoke(action==='exit'?'desktop_exit':'desktop_minimize');if(dialog.open)dialog.close();
  }catch(error){if(action==='exit'){try{await afterExitFailure();}catch{}}try{if(old===null)storage?.removeItem(key);else storage?.setItem(key,old);}catch{}message.textContent='操作失败：'+String(error)+'；程序仍在运行，请重试';if(!dialog.open)dialog.showModal();}
  finally{busy=false;}
 }
 return {request,choose:(action)=>choose(action,remember.checked),reset(){try{storage?.removeItem(key);}catch{}}};
}
export function deviceVisual(value){
 const connection=['connected','connecting','disconnected'].includes(value?.connection)?value.connection:'disconnected';
 const connected=connection==='connected';
 const rssi=connected && typeof value.rssi==='number' && Number.isFinite(value.rssi) && value.rssi>=-120 && value.rssi<=0?value.rssi:null;
 const battery=connected && typeof value.battery==='number' && Number.isFinite(value.battery) && value.battery>=0 && value.battery<=100?value.battery:null;
 const bars=rssi===null?0:rssi>=-55?4:rssi>=-67?3:rssi>=-80?2:1;
 return {connection,battery,bars,signalLabel:rssi===null?'信号未知':`${bars>=3?'信号良好':bars===2?'信号较弱':'信号很弱'} · ${Math.round(rssi)} dBm`,name:typeof value?.name==='string'?value.name.slice(0,80):'无线麦克风未连接'};
}
export function elapsedLabel(ms){const seconds=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}

export function recordingTiming(ms,maxMs){
 if(!Number.isFinite(maxMs)||maxMs<=0)throw new TypeError('录音上限无效');
 const elapsed=Math.min(maxMs,Math.max(0,Number.isFinite(ms)?ms:0));
 const remaining=Math.max(0,maxMs-elapsed),limit=elapsedLabel(maxMs);
 return {elapsed:elapsedLabel(elapsed),remaining:elapsedLabel(Math.ceil(remaining/1000)*1000),limit,nearLimit:remaining<=20000,reached:remaining===0};
}
export function initializeOutputUi({element,invoke,setTimer=setTimeout,clearTimer=clearTimeout}){
 const button=element('sendOutput'),cancel=element('cancelOutput'),status=element('outputSendStatus');
 let busy=false,submitting=false,timer,submissionTimer,pendingRead,disposed=false,generation=0;
 function boundedRead(command,args){
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(error,value)=>{if(settled)return;settled=true;clearTimer(wait.timer);if(pendingRead===wait)pendingRead=undefined;error?reject(error):resolve(value);};
   const wait={timer:undefined,cancel:()=>finish(new Error('已取消输出准备'))};pendingRead=wait;
   wait.timer=setTimer(()=>finish(new Error('输出准备超过10秒，请检查桌面程序后重试')),10000);
   Promise.resolve().then(()=>invoke(command,args)).then(value=>finish(undefined,value),error=>finish(error));
  });
 }
 const ready=()=>!element('copy').disabled&&element('result').textContent.trim();
 function sync(){button.disabled=!invoke||busy||!ready();cancel.hidden=!busy;cancel.disabled=submitting;}
 function stop(){if(submitting)return;generation++;pendingRead?.cancel();clearTimer(timer);timer=undefined;busy=false;status.textContent='已取消输出，文字保留在工作台';sync();}
 async function start(){
  if(disposed||busy||!invoke||!ready())return;
  busy=true;sync();const token=++generation,text=element('result').textContent;
  status.textContent='正在检查输出目标…';
  try{
   const target=await boundedRead('output_target');if(disposed||token!==generation)return;
   if(!target.available||!target.targetRevision)throw new Error(target.reason||'请先在目标应用中触发全局快捷键，再回来输出');
   await boundedRead('output_preflight',{text,targetRevision:target.targetRevision});if(disposed||token!==generation)return;
   let remaining=3;
   const tick=async()=>{
    if(disposed||token!==generation)return;
    if(remaining>0){status.textContent=`${remaining--}秒后输入到「${target.title||'未命名窗口'}」，请切回目标窗口；可取消`;timer=setTimer(tick,1000);return;}
    submitting=true;sync();status.textContent='正在提交输入…';
    submissionTimer=setTimer(()=>{
     if(!disposed&&token===generation&&submitting)status.textContent='输入结果未知：已等待超过10秒，请检查目标文字；为避免重复输入，暂不允许再次提交，可复制工作台文本';
    },10000);
    try{const result=await invoke('output_send',{text,targetRevision:target.targetRevision});if(!disposed&&token===generation)status.textContent=result.status==='submitted'?'Windows已接受输入，请检查目标文字；工作台内容已保留':'输入返回状态异常，请检查目标文字；不会自动重试';}
    catch(error){if(!disposed&&token===generation)status.textContent=`输入失败：${String(error)}；文字已保留，不自动重试`;}
    finally{clearTimer(submissionTimer);submissionTimer=undefined;if(!disposed&&token===generation){busy=false;submitting=false;sync();}}
   };tick();
  }catch(error){if(!disposed&&token===generation){busy=false;status.textContent=`输出准备失败：${String(error)}；请使用新版Windows桌面程序或复制文本`;sync();}}
 }
 button.addEventListener('click',start);cancel.addEventListener('click',()=>{if(!cancel.disabled)stop();});
 status.textContent=invoke?'点击输入后有3秒切回目标窗口；不会自动抢占焦点':'浏览器预览请使用复制文本';sync();
 return {sync,dispose(){disposed=true;generation++;pendingRead?.cancel();clearTimer(timer);clearTimer(submissionTimer);busy=false;button.disabled=true;cancel.hidden=true;}};
}


