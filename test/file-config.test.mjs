import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providersFromEnvFile} from '../src/file-config.mjs';
import {providerStatus} from '../src/config.mjs';
test('文件配置独立加载、本机默认与秘密不回显',()=>{
 const loaded=providersFromEnvFile('TEXT_PROVIDER=mock\nASR_PROVIDER=volcengine\nVOLC_ASR_APP_KEY=fake\nVOLC_ASR_ACCESS_KEY=-fake-token\nVOLC_ASR_RESOURCE_ID=volc.seedasr.sauc.duration');
 assert.deepEqual(providerStatus(loaded.provider,loaded.asr),{provider:'mock',simulated:true,audioTranscription:true,asrProvider:'volcengine',asrSimulated:false});assert.ok(!JSON.stringify(loaded).includes('-fake-token'));
 const saved=process.env.ASR_PROVIDER;process.env.ASR_PROVIDER='unknown-inherited';
 try {assert.equal(providersFromEnvFile('').asr.enabled,false);}finally {if(saved===undefined)delete process.env.ASR_PROVIDER;else process.env.ASR_PROVIDER=saved;}
});
test('文件缺凭据或非法提供器不降级，配置大小有限',()=>{
 for(const text of ['ASR_PROVIDER=volcengine','TEXT_PROVIDER=unknown','TEXT_PROVIDER=openai','x'.repeat(65537),null])assert.throws(()=>providersFromEnvFile(text));
});
