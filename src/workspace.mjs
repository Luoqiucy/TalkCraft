import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
export const defaultWorkspace=()=>({version:1,revision:0,preferences:{theme:'light',saveHistory:false},history:[]});
export function validateWorkspace(input) {
  if(!input || !input.preferences || !['light','dark','system'].includes(input.preferences.theme) || typeof input.preferences.saveHistory!=='boolean') throw new Error('偏好设置无效');
  if(!Array.isArray(input.history) || input.history.length>100) throw new Error('历史最多保留100条');
  const ids=new Set();
  const history=input.history.map(item=>{
    if(!item || typeof item.id!=='string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || !['dictation','prompt','translate','chat'].includes(item.mode) || typeof item.input!=='string' || item.input.length>12000 || typeof item.output!=='string' || item.output.length>32000 || typeof item.simulated!=='boolean' || typeof item.createdAt!=='string' || !Number.isFinite(Date.parse(item.createdAt))) throw new Error('历史记录无效');
    ids.add(item.id);return {id:item.id,mode:item.mode,input:item.input,output:item.output,simulated:item.simulated,createdAt:item.createdAt};
  });
  if(!input.preferences.saveHistory && history.length) throw new Error('关闭历史保存时必须清空记录');
  return {version:1,preferences:{theme:input.preferences.theme,saveHistory:input.preferences.saveHistory},history};
}
export function createWorkspaceStore(path) {
  let queue=Promise.resolve();
  async function read() {
    try {const raw=JSON.parse(await readFile(path,'utf8'));return {...validateWorkspace(raw),revision:Number.isSafeInteger(raw.revision)?raw.revision:0};}
    catch(error) {if(error.code==='ENOENT') return defaultWorkspace();throw new Error('本地设置无法读取，请保留文件并检查，不会自动覆盖');}
  }
  function update(input) {
    const run=queue.then(async()=>{
      const state=validateWorkspace(input),current=await read();
      if(input.revision!==current.revision) {const error=new Error('设置已被其他窗口修改，请重新读取后再保存');error.status=409;throw error;}
      state.revision=current.revision+1;
      await mkdir(dirname(path),{recursive:true});await writeFile(`${path}.tmp`,JSON.stringify(state,null,2),'utf8');await rename(`${path}.tmp`,path);return state;
    });queue=run.catch(()=>{});return run;
  }
  return {read,update};
}
