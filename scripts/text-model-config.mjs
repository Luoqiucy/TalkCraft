import {parseEnv} from 'node:util';
import {loadProvider} from '../src/config.mjs';
export function configureTextModel(text,{provider,model,apiKey}) {
  if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw new Error('配置文件无效');
  if(!['deepseek','openai','ark','ollama'].includes(provider))throw new Error('文字提供器无效');
  for(const value of [model,...(provider==='ollama'?[]:[apiKey])])if(typeof value!=='string'||!value.trim()||/[\r\n"'\\]/.test(value))throw new Error('模型或密钥格式无效');
  const prefix=provider.toUpperCase();
  const updates={TEXT_PROVIDER:provider,[`${prefix}_MODEL`]:model.trim()};
  if(provider!=='ollama')updates[`${prefix}_API_KEY`]=apiKey;
  loadProvider({...parseEnv(text),...updates});
  const kept=text.split(/\r?\n/).filter(line=>!Object.keys(updates).some(key=>new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)));
  return kept.join('\n').replace(/\n*$/,'\n')+Object.entries(updates).map(([key,value])=>`${key}="${value}"`).join('\n')+'\n';
}
