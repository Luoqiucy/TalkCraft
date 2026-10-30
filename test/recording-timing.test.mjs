import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {recordingTiming} from '../public/live-state.mjs';
import {RECORDING_MAX_MS,createRecordingSession} from '../public/recording.mjs';
test('录音计时上限与剩余一致，尾段告警、迟到计时封顶且从不为负',()=>{
 assert.equal(RECORDING_MAX_MS,120000);const start=recordingTiming(0,RECORDING_MAX_MS);assert.equal(start.elapsed,'00:00');assert.equal(start.remaining,'02:00');assert.equal(start.nearLimit,false);
 assert.equal(recordingTiming(100001,RECORDING_MAX_MS).remaining,'00:20');assert.equal(recordingTiming(100001,RECORDING_MAX_MS).nearLimit,true);
 const end=recordingTiming(150000,RECORDING_MAX_MS);assert.equal(end.elapsed,'02:00');assert.equal(end.remaining,'00:00');assert.equal(end.reached,true);
 assert.equal(recordingTiming(-1000,RECORDING_MAX_MS).elapsed,'00:00');
});
test('UI正计时、上限告警、自动停止提示和重试状态随录音更新',async()=>{
 const source=await readFile(new URL('../public/live-ui.mjs',import.meta.url),'utf8');const section=source.slice(source.indexOf('function renderRecordingTime'),source.indexOf("window.addEventListener('processing-state'"));
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{dataset:{},querySelectorAll:()=>[]});return elements.get(id);};
 let clock=1000,callback,tick,cleared=0;
 vm.runInNewContext('let captureStart,tick;'+section,{$:element,recordingTiming,RECORDING_MAX_MS,elapsedLabel:ms=>recordingTiming(ms,RECORDING_MAX_MS).elapsed,performance:{now:()=>clock},stopMeter(){},document:{body:{dataset:{}}},clearInterval(){cleared++;},setInterval(fn){tick=fn;return 1;},window:{addEventListener(name,fn){callback=fn;}}});
 callback({detail:{state:'recording'}});assert.equal(element('captureTime').textContent,'00:00');assert.match(element('captureLimit').textContent,/上限 02:00/);
 clock=102000;tick();assert.equal(element('captureTime').textContent,'01:41');assert.equal(element('captureLimit').dataset.warning,'true');
 clock=121050;callback({detail:{state:'stopping'}});assert.equal(element('captureTime').textContent,'02:00');assert.match(element('captureLimit').textContent,/自动停止/);assert.equal(element('captureLimit').dataset.warning,'false');
 callback({detail:{state:'acquiring'}});assert.equal(element('captureTime').textContent,'00:00');assert.equal(element('captureLimit').dataset.compact,'上限 02:00');assert.ok(cleared>=3);
});
test('实际录音会话用相同2分钟上限调度自动停止',async()=>{
 const timers=[];let recorder;const stream={getTracks:()=>[{stop(){}}]};
 class Recorder{constructor(){recorder=this;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';}}
 const session=createRecordingSession({getUserMedia:async()=>stream,Recorder,setTimer(fn,ms){timers.push({fn,ms});return timers.length;},clearTimer(){}});
 await session.start();assert.equal(timers[0].ms,RECORDING_MAX_MS);timers[0].fn();assert.equal(session.state,'stopping');assert.equal(recorder.state,'inactive');session.dispose();
});
