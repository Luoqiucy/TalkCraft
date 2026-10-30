import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeCloseUi} from '../public/live-state.mjs';
import {createServer} from '../server.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('隔离Node后台收到认证退出请求后进程结束（无模型调用）',async()=>{
 const serverUrl=new URL('../server.mjs',import.meta.url).href,shutdownUrl=new URL('../src/server-shutdown.mjs',import.meta.url).href;
 const source=`import {createServer} from ${JSON.stringify(serverUrl)};import {installServerShutdown} from ${JSON.stringify(shutdownUrl)};let shutdown;const server=createServer({shutdownToken:'isolated-private-token',onDesktopExit:()=>shutdown.stop().then(()=>process.exit(0))});shutdown=installServerShutdown(server);server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 try{const [{port}]=await once(child,'message');const exited=once(child,'exit');assert.equal((await fetch(`http://127.0.0.1:${port}/api/desktop-exit`,{method:'POST',headers:{'x-talkcraft-control':'isolated-private-token'}})).status,200);const [code]=await exited;assert.equal(code,0);}finally{if(child.exitCode===null)child.kill();}
});
function setup({saved,unsaved=false,fail=false,beforeExit,afterExitFailure}={}){
 const store=new Map(saved?[['talkcraft-close-choice-v1',saved]]:[]),calls=[];
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},remember={checked:false},message={textContent:''};
 const ui=initializeCloseUi({dialog,remember,message,beforeExit,afterExitFailure,storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},hasUnsaved:()=>unsaved,invoke:async c=>{calls.push(c);if(fail)throw Error('后台未关闭');}});return {ui,dialog,remember,message,calls,store};
}

test('正常退出先等待已排队历史保存，最小化不等待保存',async()=>{
 let release;const pending=new Promise(r=>release=r);const s=setup({beforeExit:()=>pending});
 const exiting=s.ui.choose('exit');await Promise.resolve();assert.equal(s.calls.length,0);
 release();await exiting;assert.deepEqual(s.calls,['desktop_exit']);
 const minimized=setup({beforeExit:()=>{throw Error('不应调用');}});await minimized.ui.choose('minimize');assert.deepEqual(minimized.calls,['desktop_minimize']);
});
test('退出准备先隐藏窗口再等待保存，准备失败恢复窗口',async()=>{
 let release;const order=[],pending=new Promise(resolve=>release=resolve);const ready=setup({beforeExit:async()=>{order.push('hide');await pending;order.push('saved');}});const exiting=ready.ui.choose('exit');await Promise.resolve();assert.deepEqual(order,['hide']);assert.deepEqual(ready.calls,[]);release();await exiting;assert.deepEqual(order,['hide','saved']);assert.deepEqual(ready.calls,['desktop_exit']);
 const failed=setup({fail:true,beforeExit:async()=>{},afterExitFailure:async()=>failed.calls.push('restore')});failed.dialog.showModal();await failed.ui.choose('exit');assert.deepEqual(failed.calls,['desktop_exit','restore']);assert.equal(failed.dialog.open,true);
});
test('首次询问，重复关闭不重复弹窗，记住最小化及重置',async()=>{const s=setup();s.ui.request();s.ui.request();assert.equal(s.dialog.open,true);assert.equal(s.calls.length,0);s.remember.checked=true;await s.ui.choose('minimize');assert.equal(s.calls[0],'desktop_minimize');await s.ui.request();assert.equal(s.calls.length,2);s.ui.reset();s.ui.request();assert.equal(s.dialog.open,true);});
test('记住退出仍保护未保存录音，失败回滚偏好不关闭弹窗',async()=>{const s=setup({saved:'exit',unsaved:true,fail:true});s.ui.request();assert.equal(s.calls.length,0);assert.match(s.message.textContent,/未保存录音/);s.remember.checked=true;await s.ui.choose('exit');assert.equal(s.dialog.open,true);assert.match(s.message.textContent,/操作失败/);assert.equal(s.store.get('talkcraft-close-choice-v1'),'exit');});
test('无未保存任务记住退出，重复请求防止重复提交',async()=>{const s=setup({saved:'exit'});const pending=s.ui.request();s.ui.request();await pending;assert.deepEqual(s.calls,['desktop_exit']);});
test('点X请求打开确认，选择退出调用退出而不是最小化（UI替身）',async()=>{const s=setup();s.ui.request();assert.equal(s.dialog.open,true);await s.ui.choose('exit');assert.deepEqual(s.calls,['desktop_exit']);assert.equal(s.dialog.open,false);});
test('托盘退出强制询问，不被记住最小化拦截（UI替身）',async()=>{const s=setup({saved:'minimize'});s.ui.request({force:true});assert.equal(s.dialog.open,true);assert.equal(s.calls.length,0);assert.match(s.message.textContent,/托盘/);await s.ui.choose('exit');assert.deepEqual(s.calls,['desktop_exit']);assert.equal(s.store.get('talkcraft-close-choice-v1'),'minimize');});
test('后台关闭接口拒绝无令牌/跨源，仅允许匹配令牌（真实临时HTTP，不退出进程）',async()=>{let stops=0;const server=createServer({shutdownToken:'test-private-token',onDesktopExit:()=>stops++});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const url=`http://127.0.0.1:${server.address().port}/api/desktop-exit`;for(const headers of [{},{'x-talkcraft-control':'wrong'},{'x-talkcraft-control':'test-private-token',origin:'http://evil.invalid'}])assert.equal((await fetch(url,{method:'POST',headers})).status,403);assert.equal(stops,0);assert.equal((await fetch(url,{method:'POST',headers:{'x-talkcraft-control':'test-private-token'}})).status,200);await new Promise(r=>setImmediate(r));assert.equal(stops,1);}finally{await new Promise(r=>server.close(r));}});
