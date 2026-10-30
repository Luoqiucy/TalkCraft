import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shortcutFromKeyEvent} from '../public/live-state.mjs';
test('左Alt组合不会误存成RightAlt，右侧组合准确录入',()=>{
 assert.equal(shortcutFromKeyEvent({code:'Space',altKey:true}),'Alt+Space');
 assert.equal(shortcutFromKeyEvent({code:'ShiftRight',altKey:true}),null);
 assert.equal(shortcutFromKeyEvent({code:'AltRight'}),'RightAlt');
 assert.equal(shortcutFromKeyEvent({code:'Space',altKey:true},{rightAlt:true}),'RightAlt+Space');
 assert.equal(shortcutFromKeyEvent({code:'ShiftRight',altKey:true},{rightAlt:true}),'RightAlt+RightShift');
 assert.equal(shortcutFromKeyEvent({code:'AltRight',shiftKey:true},{rightShift:true}),'RightAlt+RightShift');
});
test('自定义快捷键支持单键及多键组合',()=>{
 assert.equal(shortcutFromKeyEvent({code:'KeyK',ctrlKey:true,shiftKey:true}),'Ctrl+Shift+K');
 assert.equal(shortcutFromKeyEvent({code:'Digit5',altKey:true}),'Alt+5');
 assert.equal(shortcutFromKeyEvent({code:'KeyA'}),'A');
 assert.equal(shortcutFromKeyEvent({code:'Space'}),'Space');
 assert.equal(shortcutFromKeyEvent({code:'Space',shiftKey:true}),'Shift+Space');
 assert.equal(shortcutFromKeyEvent({code:'F8',shiftKey:true}),'Shift+F8');
});
