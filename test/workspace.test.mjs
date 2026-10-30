import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkspaceStore,defaultWorkspace,validateWorkspace} from '../src/workspace.mjs';
import {createServer} from '../server.mjs';
import {buildMessages,validateRequest} from '../src/pipeline.mjs';
test('本地偏好持久化，默认关闭历史，拒绝陈旧窗口覆盖',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mic-workspace-'));try{const store=createWorkspaceStore(join(dir,'state.json'));const initial=await store.read();assert.equal(initial.preferences.saveHistory,false);const next=await store.update({...initial,preferences:{theme:'dark',saveHistory:false}});assert.equal(next.revision,1);assert.equal((await createWorkspaceStore(join(dir,'state.json')).read()).preferences.theme,'dark');await assert.rejects(store.update({...initial,preferences:{theme:'light',saveHistory:false}}),error=>error.status===409);assert.equal((await store.read()).preferences.theme,'dark');}finally{await rm(dir,{recursive:true,force:true});}
});
test('历史只保存允许字段，不存凭据音频，关闭保存必须清空',()=>{
  const input={...defaultWorkspace(),preferences:{theme:'light',saveHistory:true},history:[{id:'test-1',mode:'chat',input:'问题',output:'回答',createdAt:new Date().toISOString(),simulated:true,apiKey:'must-not-save',audio:'must-not-save'}]};assert.equal(validateWorkspace(input).history[0].apiKey,undefined);assert.equal(validateWorkspace(input).history[0].audio,undefined);assert.throws(()=>validateWorkspace({...input,preferences:{theme:'light',saveHistory:false}}),/清空/);assert.throws(()=>validateWorkspace({...input,history:[input.history[0],input.history[0]]}),/无效/);
});
test('文字历史保存、删除、撤销及关闭清空的实际磁盘往返',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mic-history-'));try{const store=createWorkspaceStore(join(dir,'state.json'));let state=await store.read();const item={id:'history-1',mode:'translate',input:'你好',output:'Hello',simulated:true,createdAt:new Date().toISOString()};state=await store.update({...state,preferences:{theme:'light',saveHistory:true},history:[item]});assert.equal((await store.read()).history[0].output,'Hello');state=await store.update({...state,history:[]});assert.equal((await store.read()).history.length,0);state=await store.update({...state,history:[item]});assert.equal((await store.read()).history.length,1);await store.update({...state,preferences:{theme:'light',saveHistory:false},history:[]});assert.equal((await store.read()).history.length,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test('损坏本地文件不被静默重置或覆盖',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mic-corrupt-'));try{const path=join(dir,'state.json');await writeFile(path,'broken');const store=createWorkspaceStore(path);await assert.rejects(store.read(),/不会自动覆盖/);await assert.rejects(store.update(defaultWorkspace()),/不会自动覆盖/);assert.equal(await readFile(path,'utf8'),'broken');}finally{await rm(dir,{recursive:true,force:true});}
});
test('新HTTP偏好接口要求同源，实际保存、读取及冲突校验',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mic-http-'));const server=createServer({workspace:createWorkspaceStore(join(dir,'state.json'))});try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;const state=await(await fetch(base+'/api/workspace')).json();const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)};assert.equal((await fetch(base+'/api/workspace',options)).status,403);options.headers.Origin=base;assert.equal((await fetch(base+'/api/workspace',options)).status,200);assert.equal((await fetch(base+'/api/workspace',options)).status,409);assert.equal((await fetch(base+'/shell.mjs')).status,200);assert.equal((await fetch(base+'/.local/workspace.json')).status,404);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('商务、口语、邮件与要点风格只进入提示词预设，听写保持原样语义',()=>{
 assert.match(buildMessages({mode:'prompt',text:'内容',tone:'email'})[0].content,/邮件格式/);assert.match(buildMessages({mode:'prompt',text:'内容',tone:'points'})[0].content,/简明要点/);assert.doesNotMatch(buildMessages({mode:'dictation',text:'内容',tone:'email'})[0].content,/邮件格式/);assert.doesNotMatch(buildMessages({mode:'chat',text:'问题',tone:'email'})[0].content,/邮件格式/);assert.throws(()=>validateRequest({mode:'prompt',text:'内容',tone:'arbitrary'}),/风格/);
});
