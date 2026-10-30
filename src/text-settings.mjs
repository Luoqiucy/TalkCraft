import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {configureTextModel} from '../scripts/text-model-config.mjs';
import {loadProvider} from './config.mjs';
export function createTextSettings(path) {
  let queue=Promise.resolve();
  const revision=text=>createHash('sha256').update(text).digest('hex');
  async function raw(){try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return '';throw new Error('文字配置读取失败');}}
  async function read(){const text=await raw(),env=parseEnv(text),provider=env.TEXT_PROVIDER||'mock',prefix=provider.toUpperCase();return {provider,model:env[`${prefix}_MODEL`]||'',hasApiKey:!!env[`${prefix}_API_KEY`],hasFirecrawlApiKey:!!env.FIRECRAWL_API_KEY,searchBackend:env.FIRECRAWL_API_KEY?'firecrawl-with-deepseek-fallback':'deepseek-native',revision:revision(text)};}
  function update(input){const run=queue.then(async()=>{
    const text=await raw();if(!input||input.revision!==revision(text)){const error=new Error('配置已变化，请重新读取后保存');error.status=409;throw error;}
    const env=parseEnv(text),provider=input.provider;
    const apiKey=input.apiKey===''&&provider===env.TEXT_PROVIDER?env[`${provider.toUpperCase()}_API_KEY`]:input.apiKey;
    let next,active;try{next=configureTextModel(text,{provider,model:input.model,apiKey});if(input.firecrawlApiKey!==undefined||input.clearFirecrawl===true){const key=input.firecrawlApiKey;if(key!==undefined&&key!==''&&(typeof key!=='string'||key.length>500||/[\r\n"'\\]/.test(key)))throw new Error('Firecrawl API Key 无效');next=next.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?FIRECRAWL_API_KEY\s*=/.test(line)).join('\n').replace(/\n*$/,'\n');if(input.clearFirecrawl!==true){const saved=key||env.FIRECRAWL_API_KEY;if(saved)next+=`FIRECRAWL_API_KEY="${saved}"\n`;}}active=loadProvider(parseEnv(next));}catch{throw new Error('请检查提供商、模型名称和 API Key');}
    try{await mkdir(dirname(path),{recursive:true});await writeFile(`${path}.tmp`,next,{encoding:'utf8',mode:0o600});await rename(`${path}.tmp`,path);}catch{throw new Error('文字配置保存失败');}
    return {provider:active,state:await read()};
  });queue=run.catch(()=>{});return run;}
  return {read,update};
}
