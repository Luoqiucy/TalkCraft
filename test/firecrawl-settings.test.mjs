import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTextSettings} from '../src/text-settings.mjs';

test('搜索凭据可单独保存与移除，接口不回显密钥且保留模型和ASR配置',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'talkcraft-search-settings-')),file=join(dir,'settings.env');t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(file,'TEXT_PROVIDER="deepseek"\nDEEPSEEK_MODEL="deepseek-flash"\nDEEPSEEK_API_KEY="model-secret"\nASR_PROVIDER="volcengine"\n');
  const settings=createTextSettings(file),before=await settings.read();assert.equal(before.hasFirecrawlApiKey,false);
  const saved=await settings.update({revision:before.revision,provider:'deepseek',model:'deepseek-flash',apiKey:'',firecrawlApiKey:'firecrawl-secret'});
  assert.equal(saved.state.hasFirecrawlApiKey,true);assert.doesNotMatch(JSON.stringify(saved.state),/firecrawl-secret|model-secret/);assert.match(await readFile(file,'utf8'),/ASR_PROVIDER="volcengine"/);
  const cleared=await settings.update({revision:saved.state.revision,provider:'deepseek',model:'deepseek-flash',apiKey:'',clearFirecrawl:true});
  assert.equal(cleared.state.hasFirecrawlApiKey,false);assert.doesNotMatch(await readFile(file,'utf8'),/FIRECRAWL_API_KEY/);
});
