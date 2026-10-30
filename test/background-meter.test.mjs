import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const full=await readFile(new URL('../public/live-ui.mjs',import.meta.url),'utf8');
const code=full.slice(full.indexOf('function stopMeter()'),full.indexOf("window.addEventListener('capture-stream'"));
function setup(){
 const timers=new Map(),bars=Array.from({length:24},()=>({style:{}}));let next=0,amplitude=.001,closed=0;
 const level={textContent:''},wave={setAttribute(){},querySelectorAll(){return bars;}};
 class AudioContext{createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:256,getFloatTimeDomainData(samples){samples.fill(amplitude);}};}resume(){return Promise.resolve();}close(){closed++;return Promise.resolve();}}
 const ctx=vm.createContext({window:{AudioContext},$:id=>id==='captureLevel'?level:wave,Float32Array,Math,setTimeout(fn,ms){assert.equal(ms,66);timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(){throw Error('Hidden workbench must not require animation frames');}});
 vm.runInContext('let disposed=false,context,source,analyser,meterTimer,meterEpoch=0;'+code,ctx);
 return {ctx,timers,bars,level,get closed(){return closed;},set amplitude(value){amplitude=value;},start(){vm.runInContext('meter({})',ctx);},stop(){vm.runInContext('stopMeter()',ctx);}};
}
test('隐藏工作台无animation frame时音量仍更新，波形随真实采样变化（DSP替身）',()=>{const s=setup();s.start();const quiet=parseFloat(s.bars[0].style.height);assert.equal(s.timers.size,1);s.amplitude=.01;const [id,draw]=s.timers.entries().next().value;s.timers.delete(id);draw();assert.ok(parseFloat(s.bars[0].style.height)>quiet);assert.equal(s.level.textContent,'-40 dBFS');assert.equal(s.timers.size,1);s.stop();assert.equal(s.timers.size,0);assert.equal(s.closed,1);});
test('停止/重开后迟到旧计时器不重绘或重复创建循环',()=>{const s=setup();s.start();const old=s.timers.values().next().value;s.stop();s.start();const before=s.level.textContent;old();assert.equal(s.timers.size,1);assert.equal(s.level.textContent,before);s.stop();});
