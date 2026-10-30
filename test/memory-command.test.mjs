import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExplicitMemoryCommand} from '../src/agent/memory-command.mjs';

test('明确记忆与后续查询无标点连写时先分开保存和执行',()=>{
  assert.deepEqual(parseExplicitMemoryCommand('记住我偶尔吃苹果并查一下苹果有什么好处'),{content:'我偶尔吃苹果',query:'苹果有什么好处',type:'preference'});
  assert.deepEqual(parseExplicitMemoryCommand('请记住：我喜欢香蕉，并且帮我查询苹果有什么好处'),{content:'我喜欢香蕉',query:'苹果有什么好处',type:'preference'});
  assert.equal(parseExplicitMemoryCommand('我喜欢香蕉'),null);
});
