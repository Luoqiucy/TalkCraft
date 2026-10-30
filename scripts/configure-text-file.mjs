import {readFile,writeFile} from 'node:fs/promises';
import {configureTextModel} from './text-model-config.mjs';
try {
  let input='';
  for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw new Error('输入过大');}
  const path=new URL('../.local/asr-test.env',import.meta.url);
  const text=await readFile(path,'utf8');
  await writeFile(path,configureTextModel(text,JSON.parse(input)),'utf8');
  console.log('文字配置已保存，语音配置保留；重启服务后才生效。');
} catch {console.error('配置失败，请检查提供器、模型与密钥格式。未输出密钥。');process.exitCode=1;}
