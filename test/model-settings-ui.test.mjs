import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=(await readFile(new URL('../public/model-settings.mjs',import.meta.url),'utf8')).replace('export function','function')+'\ninitializeModelSettings();';
async function harness(failRead=false){
  const elements=new Map(),requests=[],events=[];
  const get=id=>{if(!elements.has(id))elements.set(id,{dataset:{},value:id==='modelProvider'?'deepseek':'',events:{},disabled:false,reportValidity(){return true;},click(){},addEventListener(name,handler){this.events[name]=handler;}});return elements.get(id);};
  const fetch=async(url,options)=>{requests.push({url,options});if(!options?.method&&failRead)throw new Error('离线');return {ok:true,json:async()=>({provider:options?.method?'deepseek':'mock',model:'test-model',hasApiKey:!!options?.method,revision:'test-revision'})};};
  vm.runInNewContext(code,{document:{getElementById:get},fetch,AbortSignal,Event,window:{dispatchEvent(event){events.push(event.type);}}});
  await new Promise(resolve=>setImmediate(resolve));return {get,requests,events,setReadFailure(value){failRead=value;}};
}
test('保存使用按钮请求而不是原生表单导航，成功清空密钥并通知服务切换',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/<section id="textModelForm"/);assert.match(html,/<button id="saveTextModel" type="button" disabled/);
  const h=await harness();h.get('modelApiKey').value='test-key';await h.get('saveTextModel').events.click();
  assert.equal(h.requests[1].url,'/api/text-settings');assert.equal(h.requests[1].options.method,'POST');assert.equal(h.get('modelApiKey').value,'');assert.deepEqual(h.events,['text-service-changed']);assert.match(h.get('textModelStatus').textContent,/已保存并启用/);
});
test('状态未读成功保持保存禁用，不发送密钥请求',async()=>{
  const h=await harness(true);assert.equal(h.get('saveTextModel').disabled,true);await h.get('saveTextModel').events.click();assert.equal(h.requests.length,1);assert.match(h.get('textModelStatus').textContent,/读取失败/);
});
test('已有配置重读失败禁用旧版本保存，保留草稿，网络恢复可重新保存',async()=>{
  const h=await harness();h.get('modelName').value='draft-model';h.get('modelApiKey').value='draft-test-key';h.setReadFailure(true);
  await h.get('reloadTextModel').events.click();assert.equal(h.get('saveTextModel').disabled,true);assert.equal(h.get('modelName').value,'draft-model');assert.equal(h.get('modelApiKey').value,'draft-test-key');
  await h.get('saveTextModel').events.click();assert.equal(h.requests.some(r=>r.options?.method==='POST'),false);
  h.setReadFailure(false);await h.get('reloadTextModel').events.click();assert.equal(h.get('saveTextModel').disabled,false);assert.equal(h.get('modelApiKey').value,'');
});
