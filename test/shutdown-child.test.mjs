import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
for(const kind of ['message','disconnect'])test(`真实Node子进程通过${kind}关闭服务并正常退出`,{timeout:5000},async()=>{
 const child=fork(new URL('../test-support/shutdown-child.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 try{const [ready]=await once(child,'message');assert.equal(ready.type,'ready');const exit=once(child,'exit');
 if(kind==='message')child.send({type:'talkcraft:shutdown'});else child.disconnect();
 const [code,signal]=await exit;assert.equal(code,0);assert.equal(signal,null);
 }finally{if(child.exitCode===null && child.signalCode===null)child.kill();}
});
