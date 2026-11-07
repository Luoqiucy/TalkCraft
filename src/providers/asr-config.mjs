import {randomUUID} from 'node:crypto';

// Header names and resource are from the pinned official Arkitect client.
// This module does not connect or enable audio uploads.
export function readVolcengineAsrConfig(env=process.env) {
  const rawHotwords=env.ASR_HOTWORDS??'';
  if(typeof rawHotwords!=='string'||rawHotwords.length>500)throw new Error('ASR_HOTWORDS 格式无效');
  const hotwords=[...new Set(rawHotwords.split(/[,，]/).map(word=>word.trim()).filter(Boolean))];
  if(hotwords.length>20||hotwords.some(word=>[...word].length>10||/[\x00-\x1f\x7f]/.test(word)))throw new Error('ASR_HOTWORDS 最多20个词，每词不超过10字且不能含控制字符');
  function credential(name){
    const value=env[name];
    if(typeof value!=='string' || !value || value.length>2000 || /[^\x21-\x7e]/.test(value))throw new Error(`请配置有效的 ${name}`);
    return value;
  }
  // New console uses one API key. Never send legacy credentials alongside it.
  const auth=env.VOLC_ASR_API_KEY!==undefined
    ? {'X-Api-Key':credential('VOLC_ASR_API_KEY')}
    : {'X-Api-App-Key':credential('VOLC_ASR_APP_KEY'),'X-Api-Access-Key':credential('VOLC_ASR_ACCESS_KEY')};
  const resourceId=env.VOLC_ASR_RESOURCE_ID || (auth['X-Api-Key']?'volc.seedasr.sauc.duration':'volc.bigasr.sauc.duration');
  if(!['volc.bigasr.sauc.duration','volc.bigasr.sauc.concurrent','volc.seedasr.sauc.duration','volc.seedasr.sauc.concurrent'].includes(resourceId)) throw new Error('VOLC_ASR_RESOURCE_ID 不支持，请选择1.0或2.0小时版/并发版');
  const configured=env.ASR_TIMEOUT_MS;
  if(configured!==undefined && (typeof configured!=='string' || !/^[0-9]+$/.test(configured)))throw new Error('ASR_TIMEOUT_MS 必须为1—120000毫秒');
  const timeoutMs=configured===undefined?30000:Number(configured);
  if(!Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>120000)throw new Error('ASR_TIMEOUT_MS 必须为1—120000毫秒');
  // Secrets live only in the closure, not serializable status/config fields.
  const words=Object.freeze(hotwords);
  return Object.freeze({timeoutMs,getHotwords(){return words;},createHeaders(){return Object.freeze({
    ...auth,
    'X-Api-Resource-Id':resourceId,'X-Api-Request-Id':randomUUID()
  });}});
}
