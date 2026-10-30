export function stopChild(child,{graceMs=4000,forceMs=1000}={}) {
  return new Promise((resolve,reject)=>{
    if(child.exitCode!==null||child.signalCode!==null){resolve();return;}
    let forceTimer,settled=false;
    const graceTimer=setTimeout(force,graceMs);
    function cleanup(){settled=true;clearTimeout(graceTimer);clearTimeout(forceTimer);child.off('exit',exited);child.off('error',failed);}
    function exited(){cleanup();resolve();}
    function failed(){cleanup();reject(new Error('本地服务停止失败'));}
    function force(){if(settled)return;clearTimeout(graceTimer);if(forceTimer)return;forceTimer=setTimeout(()=>{cleanup();reject(new Error('本地服务未在限时内退出'));},forceMs);try{child.kill();}catch{failed();}}
    child.once('exit',exited);child.once('error',failed);
    try{if(child.connected)child.send({type:'talkcraft:shutdown'},error=>{if(error)force();});else force();}catch{force();}
  });
}
