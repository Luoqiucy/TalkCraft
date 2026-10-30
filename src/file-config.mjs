import {parseEnv} from 'node:util';
import {loadProvider} from './config.mjs';
import {loadAsr} from './asr.mjs';
import {resolveAgentEngine} from './agent/router.mjs';
import {readFile} from 'node:fs/promises';
export async function providersFromConfigPath(path) {
  let text;
  try {text=await readFile(path,'utf8');}
  catch(error){if(error.code==='ENOENT')text='';else throw new Error('配置文件无法读取');}
  return providersFromEnvFile(text);
}
export function providersFromEnvFile(text) {
  if(typeof text!=='string' || Buffer.byteLength(text,'utf8')>65536)throw new Error('服务配置文件无效或过大');
  const env=parseEnv(text);
  return {provider:loadProvider(env),asr:loadAsr(env),agentEngine:resolveAgentEngine(env.TALKCRAFT_AGENT_ENGINE)};
}
