import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecordingSession} from '../public/recording.mjs';
function fixture(options = {}) {
  const instances = [], states = [], completed = [], errors = [], streams = [], timers = new Map();let nextTimer = 0;
  class Recorder {
    constructor(stream) {this.stream=stream;this.state='inactive';this.mimeType='audio/webm';instances.push(this);}
    start(interval) {this.interval=interval;this.state='recording';}
    stop() {this.state='inactive';}
    data(text='audio') {this.ondataavailable({data:new Blob([text])});}
    finish() {this.onstop();}
  }
  const getUserMedia = async () => {const stream={stops:0,getTracks(){return [{stop:() => stream.stops++}];}};streams.push(stream);return stream;};
  const session = createRecordingSession({getUserMedia,Recorder,onState:s => states.push(s),onComplete:b => completed.push(b),onError:e => errors.push(e),setTimer:fn => {timers.set(++nextTimer,fn);return nextTimer;},clearTimer:id => timers.delete(id),...options});
  return {session,instances,states,completed,errors,streams,timers};
}
test('正常停止释放麦克风、保留编码与音频并清理计时器', async () => {
  const f=fixture();await f.session.start();const recorder=f.instances[0];recorder.data();
  assert.equal(recorder.interval,1000);assert.equal(f.session.stop(),true);assert.equal(f.session.state,'stopping');
  recorder.finish();assert.equal(f.session.state,'ready');assert.equal(f.streams[0].stops,1);assert.equal(f.timers.size,0);
  assert.equal(f.completed[0].type,'audio/webm');assert.equal(await f.completed[0].text(),'audio');
});

test('录音或权限等待可立即取消，迟到事件不交付音频且会话可重用',async()=>{
 const active=fixture();await active.session.start();const old=active.instances[0];old.data();
 assert.equal(active.session.cancel(),true);assert.equal(active.session.state,'idle');assert.equal(active.streams[0].stops,1);old.finish();assert.equal(active.completed.length,0);
 assert.equal(await active.session.start(),true);active.session.dispose();
 let allow;const stream={stops:0,getTracks(){return [{stop:()=>stream.stops++}];}};
 const waiting=fixture({getUserMedia:()=>new Promise(resolve=>allow=resolve)});const pending=waiting.session.start();
 assert.equal(waiting.session.cancel(),true);assert.equal(waiting.session.state,'idle');allow(stream);assert.equal(await pending,false);assert.equal(stream.stops,1);assert.equal(waiting.completed.length,0);
});

test('指定麦克风以exact约束采集，失败不静默改用默认设备且可重试',async()=>{
  const requests=[],stream={getTracks:()=>[{stop(){}}]};let rejectSelected=true;
  const f=fixture({async getUserMedia(constraints){requests.push(constraints);if(rejectSelected)throw new Error('所选麦克风已断开');return stream;}});
  assert.equal(await f.session.start({deviceId:'usb-mic-1'}),false);
  assert.deepEqual(requests,[{audio:{deviceId:{exact:'usb-mic-1'}}}]);assert.equal(f.session.state,'error');assert.equal(f.completed.length,0);
  rejectSelected=false;assert.equal(await f.session.start(),true);assert.deepEqual(requests[1],{audio:true});f.session.dispose();
});

test('无效麦克风编号不申请权限或启动采集',async()=>{
  let calls=0;const f=fixture({getUserMedia:async()=>{calls++;throw new Error('不应调用');}});
  for(const deviceId of ['',null,7,'bad\0id','x'.repeat(513)])assert.equal(await f.session.start({deviceId}),false);
  assert.equal(calls,0);assert.equal(f.instances.length,0);assert.equal(f.errors.length,5);
});

test('录音轨道断开立即结束会话，清理监听且旧事件不影响重试',async()=>{
  const tracks=[];let stops=0;
  const f=fixture({async getUserMedia(){const track=new EventTarget();track.kind='audio';track.readyState='live';track.stop=()=>stops++;tracks.push(track);return {getTracks:()=>[track]};}});
  await f.session.start();const old=f.instances[0];old.data();tracks[0].dispatchEvent(new Event('ended'));
  assert.equal(f.session.state,'error');assert.equal(stops,1);assert.equal(f.timers.size,0);assert.match(f.errors[0].message,/麦克风已断开/);
  old.finish();assert.equal(f.completed.length,0);
  await f.session.start();tracks[0].dispatchEvent(new Event('ended'));
  assert.equal(f.session.state,'recording');assert.equal(f.errors.length,1);
  f.instances[1].data();f.session.stop();f.instances[1].finish();tracks[1].dispatchEvent(new Event('ended'));
  assert.equal(f.session.state,'ready');assert.equal(f.errors.length,1);assert.equal(f.completed.length,1);assert.equal(stops,2);
});

test('授权返回已结束的音轨不启动录音，立即释放资源',async()=>{
  const track=new EventTarget();track.kind='audio';track.readyState='ended';let stops=0;track.stop=()=>stops++;
  const f=fixture({getUserMedia:async()=>({getTracks:()=>[track]})});
  assert.equal(await f.session.start(),false);assert.equal(f.instances.length,0);assert.equal(stops,1);assert.equal(f.timers.size,0);assert.match(f.errors[0].message,/麦克风已断开/);
});
test('音量观察器复用当前录音流，停止与关闭释放一次，迟到权限不接入',async()=>{
 const observed=[];const f=fixture({onStream:stream=>observed.push(stream)});await f.session.start();assert.equal(observed[0],f.streams[0]);f.instances[0].data();f.session.stop();f.instances[0].finish();f.session.dispose();assert.deepEqual(observed,[f.streams[0],null]);
 let resolve;const late=[];const stream={getTracks:()=>[{stop(){}}]};const waiting=fixture({getUserMedia:()=>new Promise(r=>resolve=r),onStream:s=>late.push(s)});const pending=waiting.session.start();waiting.session.dispose();resolve(stream);await pending;assert.deepEqual(late,[]);
});
test('异步停止尚未结束时拒绝新录音，旧事件不能关闭后来麦克风', async () => {
  const f=fixture();await f.session.start();const old=f.instances[0];old.data();f.session.stop();
  assert.equal(await f.session.start(),false);assert.equal(f.instances.length,1);old.finish();
  await f.session.start();old.finish();old.data('late');assert.equal(f.session.state,'recording');assert.equal(f.streams[1].stops,0);
  f.instances[1].data('new');f.session.stop();f.instances[1].finish();assert.equal(await f.completed[1].text(),'new');
});
test('权限等待中拒绝重复启动，页面关闭后迟来的权限结果立即释放', async () => {
  let resolve;const stream={stops:0,getTracks(){return [{stop:() => stream.stops++}];}};
  const f=fixture({getUserMedia:() => new Promise(r => {resolve=r;})});const pending=f.session.start();
  assert.equal(f.session.state,'acquiring');assert.equal(await f.session.start(),false);
  f.session.dispose();resolve(stream);assert.equal(await pending,false);assert.equal(stream.stops,1);assert.equal(f.instances.length,0);assert.equal(f.session.state,'disposed');
});
test('权限拒绝可重试，构造失败也释放流', async () => {
  const denied=fixture({getUserMedia:async () => {throw new Error('permission denied');}});await denied.session.start();assert.equal(denied.session.state,'error');assert.match(denied.errors[0].message,/permission/);
  const stream={stops:0,getTracks(){return [{stop:() => stream.stops++}];}};
  const failed=fixture({getUserMedia:async () => stream,Recorder:class {constructor(){throw new Error('unsupported');}}});await failed.session.start();assert.equal(stream.stops,1);assert.equal(failed.session.state,'error');
});
test('时长上限自动停止，不能留下计时器', async () => {
  const f=fixture();await f.session.start();f.instances[0].data();[...f.timers.values()][0]();assert.equal(f.session.state,'stopping');f.instances[0].finish();assert.equal(f.timers.size,0);assert.equal(f.streams[0].stops,1);
});

test('停止录音未收到完成事件时有界失败，可重试且迟到结果不覆盖新会话',async()=>{
  const f=fixture();await f.session.start();const old=f.instances[0];old.data();f.session.stop();
  assert.equal(f.session.state,'stopping');assert.equal(f.timers.size,1);
  [...f.timers.values()][0]();assert.equal(f.session.state,'error');assert.match(f.errors[0].message,/停止录音超时/);
  assert.equal(f.timers.size,0);assert.equal(f.streams[0].stops,1);assert.equal(f.completed.length,0);
  await f.session.start();old.finish();assert.equal(f.session.state,'recording');assert.equal(f.completed.length,0);f.session.dispose();assert.equal(f.timers.size,0);
});

test('同步完成停止不留下看门狗，停止等待中关闭清理期限',async()=>{
  const sync=fixture();await sync.session.start();const recorder=sync.instances[0];recorder.data();
  recorder.stop=()=>{recorder.state='inactive';recorder.finish();};sync.session.stop();
  assert.equal(sync.session.state,'ready');assert.equal(sync.timers.size,0);assert.equal(sync.completed.length,1);
  const waiting=fixture();await waiting.session.start();waiting.instances[0].data();waiting.session.stop();assert.equal(waiting.timers.size,1);
  waiting.session.dispose();assert.equal(waiting.timers.size,0);waiting.instances[0].finish();assert.equal(waiting.completed.length,0);assert.equal(waiting.session.state,'disposed');
});
test('设备错误后迟来stop事件不能交付错误音频，后续仍可重试', async () => {
  const f=fixture();await f.session.start();const old=f.instances[0];old.data();old.onerror();old.finish();
  assert.equal(f.session.state,'error');assert.equal(f.completed.length,0);assert.equal(f.errors.length,1);assert.equal(f.streams[0].stops,1);
  await f.session.start();old.finish();assert.equal(f.session.state,'recording');f.session.dispose();
});
test('空录音与过大音频明确失败', async () => {
  const empty=fixture();await empty.session.start();empty.session.stop();empty.instances[0].finish();assert.equal(empty.session.state,'error');assert.equal(empty.completed.length,0);
  const large=fixture({maxBytes:3});await large.session.start();large.instances[0].data('1234');assert.equal(large.session.state,'error');assert.match(large.errors[0].message,/过大/);assert.equal(large.streams[0].stops,1);
});
test('重复dispose不会重复释放，关闭后不能再启动', async () => {
  const f=fixture();await f.session.start();f.session.dispose();f.session.dispose();assert.equal(f.streams[0].stops,1);assert.equal(await f.session.start(),false);assert.equal(f.timers.size,0);
});

test('外放抑制保留指定麦克风并请求回声消除与降噪', async () => {
  const requests = [];
  const f = fixture({getUserMedia: async options => {
    requests.push(options);
    return {getTracks: () => [{stop() {}}]};
  }});
  assert.equal(await f.session.start({deviceId: 'usb-mic', speakerSuppression: true}), true);
  assert.deepEqual(requests, [{audio: {
    deviceId: {exact: 'usb-mic'}, echoCancellation: true, noiseSuppression: true
  }}]);
  f.session.dispose();
});
