import {fork} from 'node:child_process';
import {stopChild} from './stop-child.mjs';
export function startManagedService(modulePath,{args=[],cwd,env=process.env,execPath=process.execPath,timeoutMs=10000,signal}={}) {
  return new Promise((resolve,reject)=>{
    const child=fork(modulePath,args,{cwd,env,execPath,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
    let finished=false;
    const timer=setTimeout(()=>fail('本地服务启动超时'),timeoutMs);
    function cleanup(){clearTimeout(timer);child.off('message',ready);child.off('error',error);child.off('exit',exit);signal?.removeEventListener('abort',abort);}
    function fail(message){if(finished)return;finished=true;cleanup();stopChild(child,{graceMs:100,forceMs:500}).catch(()=>{}).finally(()=>reject(new Error(message)));}
    function abort(){fail('本地服务启动已取消');}
    function error(){fail('本地服务无法启动');}
    function exit(){fail('本地服务在就绪前退出，请检查端口及配置');}
    function ready(message){if(message?.type!=='talkcraft:ready')return;if(finished)return;finished=true;cleanup();
      let stopping;
      resolve({child,stop(){if(!stopping)stopping=stopChild(child);return stopping;}});
    }
    child.on('message',ready);child.once('error',error);child.once('exit',exit);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
}
