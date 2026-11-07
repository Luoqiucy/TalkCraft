import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readVolcengineAsrConfig} from '../src/providers/asr-config.mjs';
import {loadAsr} from '../src/asr.mjs';
const env=()=>({VOLC_ASR_APP_KEY:'fake-app-key',VOLC_ASR_ACCESS_KEY:'fake-access-key'});

test('新版API Key独立鉴权，优先于旧凭据且不序列化',()=>{
 const config=readVolcengineAsrConfig({...env(),VOLC_ASR_API_KEY:'fake-new-key',VOLC_ASR_RESOURCE_ID:'volc.seedasr.sauc.duration'});
 const headers=config.createHeaders();
 assert.equal(headers['X-Api-Key'],'fake-new-key');
 assert.equal(headers['X-Api-App-Key'],undefined);assert.equal(headers['X-Api-Access-Key'],undefined);
 assert.equal(readVolcengineAsrConfig({VOLC_ASR_API_KEY:'only-new-key'}).createHeaders()['X-Api-Resource-Id'],'volc.seedasr.sauc.duration');
 assert.ok(!JSON.stringify(config).includes('fake-new-key'));
 for(const value of ['',null,5,'bad\r\nkey'])assert.throws(()=>readVolcengineAsrConfig({...env(),VOLC_ASR_API_KEY:value}),/VOLC_ASR_API_KEY/);
});
test('鉴权头映射官方字段，每次会话使用独立UUID',()=>{
 const config=readVolcengineAsrConfig(env()),a=config.createHeaders(),b=config.createHeaders();
 assert.equal(a['X-Api-App-Key'],'fake-app-key');assert.equal(a['X-Api-Access-Key'],'fake-access-key');
 assert.equal(a['X-Api-Resource-Id'],'volc.bigasr.sauc.duration');
 assert.match(a['X-Api-Request-Id'],/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.notEqual(a['X-Api-Request-Id'],b['X-Api-Request-Id']);assert.equal(config.timeoutMs,30000);assert.ok(Object.isFrozen(a));
});
test('凭据缺失、头注入及无效类型只返回变量名，不带原值',()=>{
 for(const key of ['VOLC_ASR_APP_KEY','VOLC_ASR_ACCESS_KEY'])for(const value of [undefined,'','bad\r\nSECRET','a b','中文SECRET',5,'x'.repeat(2001)]){
  assert.throws(()=>readVolcengineAsrConfig({...env(),[key]:value}),error=>error.message===`请配置有效的 ${key}`);
 }
});
test('配置快照与序列化不包含凭据，不自动开启ASR',()=>{
 const source=env(),config=readVolcengineAsrConfig(source);source.VOLC_ASR_ACCESS_KEY='changed';
 assert.equal(config.createHeaders()['X-Api-Access-Key'],'fake-access-key');assert.equal(JSON.stringify(config),'{"timeoutMs":30000}');
 assert.equal(loadAsr(source).enabled,false);
});
test('超时范围严格检查，非法配置不建立连接',()=>{
 for(const value of ['','1.5','-1','0','120001','Infinity','1e3',' 100 ',100,null])assert.throws(()=>readVolcengineAsrConfig({...env(),ASR_TIMEOUT_MS:value}),/ASR_TIMEOUT_MS/);
 for(const value of ['1','120000'])assert.equal(readVolcengineAsrConfig({...env(),ASR_TIMEOUT_MS:value}).timeoutMs,Number(value));
});


test('2.0小时版/并发版显式资源映射，未知或注入值拒绝',()=>{
 for(const resourceId of ['volc.seedasr.sauc.duration','volc.seedasr.sauc.concurrent'])assert.equal(readVolcengineAsrConfig({...env(),VOLC_ASR_RESOURCE_ID:resourceId}).createHeaders()['X-Api-Resource-Id'],resourceId);
 for(const resourceId of ['unknown','bad\r\nSECRET',5])assert.throws(()=>readVolcengineAsrConfig({...env(),VOLC_ASR_RESOURCE_ID:resourceId}),/VOLC_ASR_RESOURCE_ID/);
});
test('热词配置去重并严格限制数量和内容，配置序列化不暴露词条',()=>{
 const config=readVolcengineAsrConfig({...env(),ASR_HOTWORDS:'张家港，DeepSeek,张家港'});
 assert.deepEqual(config.getHotwords(),['张家港','DeepSeek']);
 assert.ok(!JSON.stringify(config).includes('张家港'));
 for(const value of ['词'.repeat(11),Array.from({length:21},(_,i)=>`词${i}`).join(','),'安全词,坏\n词',5])assert.throws(()=>readVolcengineAsrConfig({...env(),ASR_HOTWORDS:value}),/ASR_HOTWORDS/);
});
