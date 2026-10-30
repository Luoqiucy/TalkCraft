import {open,readFile,stat,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {providersFromConfigPath} from '../src/file-config.mjs';
import {importAsrWav,preflightAsrAudio,runAsrBatch,validateAsrManifest} from '../src/asr-batch.mjs';

const args=process.argv.slice(2),options={};let manifestName;
for(let index=0;index<args.length;index++){
  const arg=args[index];
  if(['--config','--id','--out'].includes(arg)){if(!args[index+1])throw new Error(`${arg} 缺少值`);options[arg]=args[++index];}
  else if(arg==='--confirm-upload')options.confirmUpload=true;
  else if(arg.startsWith('--')||manifestName)throw new Error(`无效参数：${arg}`);
  else manifestName=arg;
}
if(!manifestName||!options['--config']||!options['--id']||!options['--out']||!options.confirmUpload)throw new Error('用法：node scripts/asr-one.mjs --config provider.env --id sample-id --out result.jsonl --confirm-upload <manifest.jsonl>');
const manifestPath=resolve(manifestName),lines=(await readFile(manifestPath,'utf8')).split(/\r?\n/).filter(Boolean);
const manifest=validateAsrManifest(lines.map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`清单第${index+1}行无效`);}}));
const entry=manifest.find(item=>item.id===options['--id']);
if(!entry)throw new Error('样本编号不在固定语料中');
const {asr}=await providersFromConfigPath(resolve(options['--config']));
if(!asr.enabled||asr.simulated===true)throw new Error('单段测速只允许已启用的真实ASR提供器');
const readAudio=async item=>{
  const path=resolve(dirname(manifestPath),item.audio),info=await stat(path);
  if(!info.isFile()||info.size>3905536)throw new Error('音频文件无效或过大');
  const wav=await readFile(path);
  return importAsrWav(wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength));
};
await preflightAsrAudio([entry],{readAudio});
const outputPath=resolve(options['--out']),output=await open(outputPath,'wx');
let completed=false;
try{
  const [result]=await runAsrBatch([entry],{provider:asr,expectedCount:1,profileMemory:true,readAudio});
  await output.writeFile(JSON.stringify(result)+'\n');
  await output.sync();completed=true;
}finally{await output.close();if(!completed)await unlink(outputPath).catch(()=>{});}
process.stdout.write(`已保存样本 ${entry.id} 的原始转写与耗时；未调用文字模型。\n`);
