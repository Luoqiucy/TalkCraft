import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {stopChild} from '../scripts/stop-child.mjs';
function fake(){return Object.assign(new EventEmitter(),{exitCode:null,signalCode:null,connected:true,send(){},kill(){return false;}});}
test('退出后的迟到IPC错误不再次终止或安装超時計时器',async()=>{
 const child=fake();let callback,kills=0;child.send=(_,done)=>{callback=done;};child.kill=()=>{kills++;return true;};
 const stopped=stopChild(child,{graceMs:100,forceMs:5});child.emit('exit',0);await stopped;callback(new Error('迟到错误'));assert.equal(kills,0);assert.equal(child.listenerCount('exit'),0);
});
test('无法结束的子进程有界失败并移除监听',async()=>{const child=fake();await assert.rejects(stopChild(child,{graceMs:5,forceMs:5}),/限时/);assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);});
test('IPC发送失败仍尝试终止，正常退出清理计时器',async()=>{const child=fake();child.send=()=>{throw new Error('closed');};child.kill=()=>{queueMicrotask(()=>child.emit('exit',0));return true;};await stopChild(child,{graceMs:5,forceMs:50});assert.equal(child.listenerCount('exit'),0);});
