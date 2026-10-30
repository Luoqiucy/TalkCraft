import {startManagedService} from './managed-service.mjs';
export async function runDesktopSession(servicePath,serviceOptions,launch,{signals=process}={}) {
  const controller=new AbortController();
  let rejectInterrupt;
  const interrupted=new Promise((_,reject)=>{rejectInterrupt=reject;});
  const onInterrupt=()=>{controller.abort();rejectInterrupt(new Error('桌面会话已中断'));};
  let service,onExit;
  signals.on('SIGINT',onInterrupt);signals.on('SIGTERM',onInterrupt);
  try {
    service=await Promise.race([startManagedService(servicePath,{...serviceOptions,signal:controller.signal}),interrupted]);
    controller.signal.throwIfAborted();
    const failed=new Promise((_,reject)=>{
      onExit=()=>{reject(new Error('本地服务意外退出，桌面会话已中止'));controller.abort();};
      service.child.once('exit',onExit);
      if(service.child.exitCode!==null||service.child.signalCode!==null)onExit();
    });
    return await Promise.race([failed,interrupted,Promise.resolve().then(()=>{
      controller.signal.throwIfAborted();
      return launch(controller.signal);
    })]);
  } catch(error) {
    if(!service && controller.signal.aborted)throw new Error('桌面会话已中断');
    throw error;
  } finally {
    controller.abort();
    if(service && onExit)service.child.off('exit',onExit);
    try{if(service)await service.stop();}finally{signals.off('SIGINT',onInterrupt);signals.off('SIGTERM',onInterrupt);}
  }
}
