import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTextSettings} from '../src/text-settings.mjs';
import {createServer} from '../server.mjs';
import {listenForFetch} from '../test-support/http-listen.mjs';
test('HTTP配置保存要求同源，立即切换提供器且云端调用仍要求授权',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'talkcraft-http-model-'));const server=createServer({textSettings:createTextSettings(join(dir,'config.env'))});
  try{const url=await listenForFetch(server),initial=await (await fetch(url+'/api/text-settings')).json();const body=JSON.stringify({revision:initial.revision,provider:'deepseek',model:'test-model',apiKey:'test-key'});
    assert.equal((await fetch(url+'/api/text-settings',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
    const response=await fetch(url+'/api/text-settings',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body});assert.equal(response.status,200);assert.equal((await response.text()).includes('test-key'),false);
    const status=await (await fetch(url+'/api/status')).json();assert.equal(status.provider,'deepseek');assert.equal(status.simulated,false);
    const denied=await fetch(url+'/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'dictation',text:'测试'})});assert.equal(denied.status,400);assert.match(await denied.text(),/确认/);
    assert.equal((await fetch(url+'/model-settings.mjs')).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('界面保存不回传密钥，保留语音配置且支持留空保留和冲突拒绝',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'talkcraft-model-'));try{
    const path=join(dir,'config.env');await writeFile(path,'TEXT_PROVIDER=mock\nVOLC_ASR_ACCESS_KEY=-test-audio-key\n');const store=createTextSettings(path),initial=await store.read();
    const first=await store.update({revision:initial.revision,provider:'deepseek',model:'test-model',apiKey:'test-text-key'});
    assert.equal(first.provider.simulated,false);assert.equal(first.state.hasApiKey,true);assert.equal(JSON.stringify(first.state).includes('test-text-key'),false);
    const second=await store.update({revision:first.state.revision,provider:'deepseek',model:'test-model-2',apiKey:''});
    const file=await readFile(path,'utf8');assert.match(file,/VOLC_ASR_ACCESS_KEY=-test-audio-key/);assert.match(file,/test-text-key/);assert.equal(second.state.model,'test-model-2');
    await assert.rejects(store.update({revision:initial.revision,provider:'ollama',model:'x'}),error=>error.status===409);
    await assert.rejects(store.update({revision:second.state.revision,provider:'openai',model:'x',apiKey:''}),/检查/);
    assert.equal(await readFile(path,'utf8'),file);
  }finally{await rm(dir,{recursive:true,force:true});}
});
