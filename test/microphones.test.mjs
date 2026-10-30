import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMicrophonePicker} from '../public/recording.mjs';

function fixture(enumerateDevices,options={}){
  const element=()=>({value:'',events:{},addEventListener(name,fn){this.events[name]=fn;},replaceChildren(...options){this.options=options;}});
  const select=element(),refreshButton=element(),notice={},listeners=new Map();
  const mediaDevices={enumerateDevices,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
  const picker=createMicrophonePicker({mediaDevices,select,refreshButton,notice,document:{createElement:()=>({})},...options});
  return {picker,select,refreshButton,notice,listeners};
}

test('电脑麦克风枚举去重、匿名标签、选择及断开不自动换源',async()=>{
  let devices=[{kind:'audioinput',deviceId:'usb',label:'USB麦克风'},{kind:'audioinput',deviceId:'usb',label:'重复'},{kind:'audioinput',deviceId:'anon',label:''},{kind:'videoinput',deviceId:'camera'},{kind:'audioinput',deviceId:'default'}];
  const f=fixture(async()=>devices);await f.picker.refresh();assert.equal(f.select.options.length,3);assert.match(f.select.options[2].textContent,/授权后显示名称/);
  f.select.value='usb';f.select.events.change();assert.deepEqual(f.picker.getStartOptions(),{deviceId:'usb'});
  devices=[];await f.picker.refresh();assert.equal(f.select.value,'usb');assert.match(f.picker.getStartOptions().error,/不可用/);
  f.select.value='';f.select.events.change();assert.deepEqual(f.picker.getStartOptions(),{});
  f.picker.dispose();assert.equal(f.listeners.size,0);
});

test('录音锁定阻止改源，刷新失败保留原选择',async()=>{
  let fail=false;const f=fixture(async()=>{if(fail)throw new Error('权限');return [{kind:'audioinput',deviceId:'usb',label:'麦克风'}];});
  await f.picker.refresh();f.select.value='usb';f.select.events.change();f.picker.setLocked(true);f.select.value='';f.select.events.change();assert.equal(f.select.value,'usb');assert.equal(f.refreshButton.disabled,true);
  fail=true;f.picker.setLocked(false);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.picker.getStartOptions(),{deviceId:'usb'});assert.match(f.notice.textContent,/可重试/);
});

test('关闭后迟到枚举不更新界面，枚举期间阻止新录音',async()=>{
  let resolve;const f=fixture(()=>new Promise(done=>resolve=done));const pending=f.picker.refresh();assert.match(f.picker.getStartOptions().error,/稍后录音/);
  f.picker.dispose();resolve([{kind:'audioinput',deviceId:'late'}]);await pending;assert.equal(f.select.options,undefined);
});

test('枚举永久挂起时超时恢复操作且迟到结果不覆盖重试',async()=>{
  const timers=new Map();let next=0,firstResolve,calls=0;
  const f=fixture(()=>++calls===1?new Promise(resolve=>firstResolve=resolve):Promise.resolve([{kind:'audioinput',deviceId:'fresh',label:'新设备'}]),{setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
  const pending=f.picker.refresh();assert.equal(f.refreshButton.disabled,true);[...timers.values()][0]();await pending;
  assert.equal(f.refreshButton.disabled,false);assert.deepEqual(f.picker.getStartOptions(),{});assert.match(f.notice.textContent,/超时/);assert.equal(timers.size,0);
  await f.picker.refresh();firstResolve([{kind:'audioinput',deviceId:'late'}]);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.select.options.map(item=>item.value),['','fresh']);assert.equal(timers.size,0);f.picker.dispose();
});

test('关闭挂起枚举立即结束等待并清理期限计时器',async()=>{
  const timers=new Map();const f=fixture(()=>new Promise(()=>{}),{setTimer:fn=>{timers.set(1,fn);return 1;},clearTimer:id=>timers.delete(id)});
  const pending=f.picker.refresh(),before=f.notice.textContent;f.picker.dispose();await pending;
  assert.equal(timers.size,0);assert.equal(f.notice.textContent,before);assert.equal(f.select.disabled,true);
});
