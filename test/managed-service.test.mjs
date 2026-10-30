import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startManagedService} from '../scripts/managed-service.mjs';
import {runDesktopSession} from '../scripts/desktop-session.mjs';
import {EventEmitter} from 'node:events';
const modulePath=new URL('../test-support/managed-child.mjs',import.meta.url);

test('桌面启动失败仍取消启动任务持有的资源并清理监听',{timeout:5000},async()=>{
 const signals=new EventEmitter();let released=false,launchSignal;
 await assert.rejects(runDesktopSession(modulePath,{},async signal=>{
  launchSignal=signal;
  signal.addEventListener('abort',()=>{released=true;},{once:true});
  throw new Error('桌面初始化失败');
 },{signals}),/桌面初始化失败/);
 assert.equal(released,true);assert.equal(launchSignal.aborted,true);
 assert.equal(signals.listenerCount('SIGINT'),0);assert.equal(signals.listenerCount('SIGTERM'),0);
});
test('服务就绪前主动中断清理子进程且不启动CLI',{timeout:5000},async()=>{
 const signals=new EventEmitter();let started=false;
 const pending=runDesktopSession(modulePath,{args:['hang'],timeoutMs:4000},async()=>{started=true;},{signals});
 setImmediate(()=>signals.emit('SIGINT'));
 await assert.rejects(pending,/桌面会话已中断/);assert.equal(started,false);assert.equal(signals.listenerCount('SIGINT'),0);assert.equal(signals.listenerCount('SIGTERM'),0);
});
test('桌面主动中断取消CLI并移除信号监听',{timeout:5000},async()=>{
 const signals=new EventEmitter();let aborted=false;
 await assert.rejects(runDesktopSession(modulePath,{},signal=>new Promise(resolve=>{
  signal.addEventListener('abort',()=>{aborted=true;resolve(1);},{once:true});
  signals.emit('SIGINT');signals.emit('SIGTERM');
 }),{signals}),/已中断/);
 assert.equal(aborted,true);assert.equal(signals.listenerCount('SIGINT'),0);assert.equal(signals.listenerCount('SIGTERM'),0);
});
test('服务就绪后意外退出中止桌面等待并发送取消',{timeout:5000},async()=>{
  let aborted=false;
  await assert.rejects(runDesktopSession(modulePath,{args:['crash']},signal=>new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve(1);},{once:true});})),/意外退出/);
  assert.equal(aborted,true);
});
test('桌面会话等待服务成功才启动CLI，保留退出状态并清理服务',{timeout:5000},async()=>{
  let started=0;assert.equal(await runDesktopSession(modulePath,{},async()=>{started++;return 7;}),7);assert.equal(started,1);
  await assert.rejects(runDesktopSession(modulePath,{},async()=>{throw new Error('CLI失败');}),/CLI失败/);
  await assert.rejects(runDesktopSession(modulePath,{args:['fail']},async()=>{started++;}),/就绪前退出/);assert.equal(started,1);
});
test('受管服务等待就绪后返回，停止幂等并正常退出',{timeout:5000},async()=>{
  const service=await startManagedService(modulePath);const first=service.stop();assert.equal(service.stop(),first);await first;assert.equal(service.child.exitCode,0);
});
test('受管服务提前失败与就绪超时明确拒绝',{timeout:5000},async()=>{
  await assert.rejects(startManagedService(modulePath,{args:['fail']}),/就绪前退出/);
  await assert.rejects(startManagedService(modulePath,{args:['hang'],timeoutMs:100}),/超时/);
});
