import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {shortcutFromKeyEvent} from '../public/live-state.mjs';
const full=await readFile(new URL('../public/shell.mjs',import.meta.url),'utf8');
const code=full.slice(full.indexOf('const shortcutActions='),full.indexOf('const defaultCustom='));
async function setup({native=true,failSave=false}={}){
 const elements=new Map(),calls=[],buttons=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',events:{},disabled:false,addEventListener(name,fn){this.events[name]=fn;}});return elements.get(id);};
 for(const action of ['dictation','chat','translate','prompt','process','hud'])buttons.push({dataset:{clearShortcut:action},addEventListener(name,fn){this[name]=fn;}});
 const config={revision:1,bindings:Object.fromEntries(buttons.map(b=>[b.dataset.clearShortcut,'Alt+Shift+1'])),status:'全局快捷键已启用'};
 const core={async invoke(command,input){calls.push({command,input});if(command==='shortcuts_save'){if(failSave)throw '组合键被占用';return {...config,...input,revision:2,status:'已保存'};}return config;}};
 vm.runInNewContext(code,{shortcutFromKeyEvent,$:element,window:native?{__TAURI__:{core}}:{},document:{querySelectorAll:()=>buttons}});
 await new Promise(resolve=>setImmediate(resolve));return {element,calls,buttons};
}
test('自定义快捷键录入、禁用和带版本保存到桌面接口',async()=>{
 const h=await setup();let prevented=false;
 h.element('shortcut-chat').events.keydown({code:'KeyQ',ctrlKey:true,altKey:true,shiftKey:false,preventDefault(){prevented=true;},stopPropagation(){}});
 assert.equal(prevented,true);assert.equal(h.element('shortcut-chat').value,'Ctrl+Alt+Q');h.buttons.find(b=>b.dataset.clearShortcut==='prompt').click();
 await h.element('saveShortcuts').events.click();const call=h.calls.at(-1);assert.equal(call.command,'shortcuts_save');assert.equal(call.input.revision,1);assert.equal(call.input.bindings.prompt,'');assert.equal(call.input.bindings.chat,'Ctrl+Alt+Q');assert.equal(h.element('shortcutStatus').textContent,'已保存');
});
test('快捷键占用失败保留用户输入并允许重新保存',async()=>{
 const h=await setup({failSave:true});h.element('shortcut-chat').value='Ctrl+Alt+Q';await h.element('saveShortcuts').events.click();
 assert.match(h.element('shortcutStatus').textContent,/组合键被占用/);assert.equal(h.element('shortcut-chat').value,'Ctrl+Alt+Q');assert.equal(h.element('saveShortcuts').disabled,false);
});
test('浏览器不伪装全局快捷键，桌面支持裸字母且Tab可正常切换',async()=>{
 const preview=await setup({native:false});assert.equal(preview.element('saveShortcuts').disabled,true);assert.match(preview.element('shortcutStatus').textContent,/浏览器预览不支持/);
 const h=await setup();const input=h.element('shortcut-chat');input.events.keydown({code:'KeyA',preventDefault(){},stopPropagation(){}});assert.equal(input.value,'A');assert.match(h.element('shortcutStatus').textContent,/全局占用/);
 input.events.keydown({code:'Tab',preventDefault(){throw new Error('Tab被阻止');}});
});
test('两键组合和功能键组合均可录入',async()=>{
 const h=await setup();const input=h.element('shortcut-chat');
 input.events.keydown({code:'KeyA',shiftKey:true,preventDefault(){},stopPropagation(){}});assert.equal(input.value,'Shift+A');
 input.events.keydown({code:'Space',shiftKey:true,preventDefault(){},stopPropagation(){}});assert.equal(input.value,'Shift+Space');
 input.events.keydown({code:'F8',shiftKey:true,preventDefault(){},stopPropagation(){}});assert.equal(input.value,'Shift+F8');
});
test('右侧键可修改及保存，松开/失焦后左Alt组合保持普通Alt（DOM替身）',async()=>{
 const h=await setup(),input=h.element('shortcut-chat');const event=code=>({code,altKey:true,preventDefault(){},stopPropagation(){}});
 input.events.keydown(event('AltRight'));input.events.keydown(event('Space'));assert.equal(input.value,'RightAlt+Space');
 input.events.keyup(event('AltRight'));input.events.keydown(event('Space'));assert.equal(input.value,'Alt+Space');
 input.events.blur();
 input.events.keydown(event('AltRight'));input.events.keydown(event('ShiftRight'));assert.equal(input.value,'RightAlt+RightShift');
 input.events.blur();input.events.keydown(event('Space'));assert.equal(input.value,'Alt+Space');
 await h.element('saveShortcuts').events.click();assert.equal(h.calls.at(-1).input.bindings.chat,'Alt+Space');
 const hud=h.element('shortcut-hud'),old=hud.value;hud.events.keydown(event('AltRight'));assert.equal(hud.value,old);assert.match(h.element('shortcutStatus').textContent,/录音模式/);
});
test('快捷键编辑器可录入右Alt快速双击',async()=>{
 const h=await setup(),input=h.element('shortcut-prompt'),event=()=>({code:'AltRight',altKey:true,preventDefault(){},stopPropagation(){}});
 input.events.keydown(event());input.events.keyup(event());input.events.keydown(event());assert.equal(input.value,'RightAltDouble');
});
