import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {configureTextModel} from '../scripts/text-model-config.mjs';
test('文字配置切换保留语音密钥和其他用户配置，替换旧值',()=>{
  const original='# user\nTEXT_PROVIDER=mock\nVOLC_ASR_ACCESS_KEY=-test-token\nOTHER=keep\nDEEPSEEK_MODEL=old\n';
  const result=configureTextModel(original,{provider:'deepseek',model:'test-model',apiKey:'test-key'});
  const env=parseEnv(result);assert.equal(env.VOLC_ASR_ACCESS_KEY,'-test-token');assert.equal(env.OTHER,'keep');assert.equal(env.DEEPSEEK_MODEL,'test-model');assert.equal(env.DEEPSEEK_API_KEY,'test-key');assert.equal(env.TEXT_PROVIDER,'deepseek');assert.equal(result.match(/DEEPSEEK_MODEL=/g).length,1);
});
test('本地模型不需要密钥，拒绝换行注入与未知提供器',()=>{
  assert.equal(parseEnv(configureTextModel('ASR_PROVIDER=disabled',{provider:'ollama',model:'local-model'})).OLLAMA_MODEL,'local-model');
  for(const options of [{provider:'unknown',model:'x'},{provider:'deepseek',model:'x',apiKey:'key\nASR_PROVIDER=mock'},{provider:'openai',model:'',apiKey:'key'}])assert.throws(()=>configureTextModel('',options));
});
