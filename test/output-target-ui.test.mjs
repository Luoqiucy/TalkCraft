import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const full=await readFile(new URL('../public/shell.mjs',import.meta.url),'utf8');const code=full.slice(full.indexOf('let outputTargetBusy='),full.indexOf('const shortcutActions='));
function setup(invoke){const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{disabled:id==='checkOutputTarget',textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn;}});return elements.get(id);};vm.runInNewContext(code,{$:element,window:invoke?{__TAURI__:{core:{invoke}}}:{}});return element;}
test('检查目标显示原生有效窗口标题，按纯文本渲染且不触发输入',async()=>{
 const commands=[];const el=setup(async command=>{commands.push(command);return {available:true,title:'<script>不执行</script>'};});await el('checkOutputTarget').events.click();assert.match(el('outputTargetStatus').textContent,/<script>不执行<\/script>/);assert.match(el('outputTargetStatus').textContent,/切回目标窗口/);assert.deepEqual(commands,['output_target']);
});
test('目标关闭及接口失败清除旧目标提示并允许重试',async()=>{
 let counter=0;const el=setup(async()=>{if(++counter===1)return {available:true,title:'记事本'};if(counter===2)return {available:false,reason:'目标应用已关闭'};throw '接口不存在';});
 await el('checkOutputTarget').events.click();await el('checkOutputTarget').events.click();assert.match(el('outputTargetStatus').textContent,/目标应用已关闭/);assert.doesNotMatch(el('outputTargetStatus').textContent,/记事本/);
 await el('checkOutputTarget').events.click();assert.match(el('outputTargetStatus').textContent,/检查失败/);assert.equal(el('checkOutputTarget').disabled,false);
});
test('目标检查合并重复点击，浏览器不伪装目标记录',async()=>{
 let finish,count=0;const el=setup(()=>{count++;return new Promise(resolve=>{finish=resolve;});});const pending=el('checkOutputTarget').events.click();assert.equal(el('checkOutputTarget').disabled,true);await el('checkOutputTarget').events.click();assert.equal(count,1);finish({available:false});await pending;assert.equal(el('checkOutputTarget').disabled,false);
 const preview=setup();assert.equal(preview('checkOutputTarget').disabled,true);assert.match(preview('outputTargetStatus').textContent,/浏览器预览仅支持复制/);
});

