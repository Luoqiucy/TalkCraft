import {open,readFile,stat,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {providersFromConfigPath} from '../src/file-config.mjs';
import {formatAsrResultJsonl,importAsrWav,installBatchCancellation,preflightAsrAudio,runAsrBatch,validateAsrManifest,validateAsrResume} from '../src/asr-batch.mjs';
import {writeAsrAcceptanceReport} from '../src/asr-batch.mjs';

const args=process.argv.slice(2),names=[];let resume=false,profileMemory=false,configPath=new URL('../.local/asr-test.env',import.meta.url);
for(let index=0;index<args.length;index++){
  if(args[index]==='--resume')resume=true;
  else if(args[index]==='--profile-memory')profileMemory=true;
  else if(args[index]==='--config'){if(!args[++index])throw new Error('--config 缺少配置文件');configPath=resolve(args[index]);}
  else if(args[index].startsWith('--'))throw new Error(`未知选项：${args[index]}`);
  else names.push(args[index]);
}
if(names.length!==3)throw new Error('用法：node scripts/asr-batch.mjs [--resume] [--profile-memory] [--config provider.env] <manifest.jsonl> <results.jsonl> <report.json>');
const [manifestName,resultsName,reportName]=names.map(value=>resolve(value));
const lines=(await readFile(manifestName,'utf8')).split(/\r?\n/).filter(line=>line.trim());
const entries=lines.map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`清单第${index+1}行不是有效JSON`);}});
const manifest=validateAsrManifest(entries);
let initialResults=[];
let resumeNeedsSeparator=false;
if(resume){
  let previous='';try{previous=await readFile(resultsName,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  initialResults=previous.split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`已有结果第${index+1}行不是有效JSON`);}});
  validateAsrResume(manifest,initialResults);
  resumeNeedsSeparator=previous.length>0&&!previous.endsWith('\n')&&!previous.endsWith('\r');
}
const {asr}=await providersFromConfigPath(configPath);
if(!asr.enabled||asr.simulated===true)throw new Error('批量验收只允许已启用的真实ASR提供器');
const readAudio=async entry=>{
  const path=resolve(dirname(manifestName),entry.audio),info=await stat(path);if(!info.isFile()||info.size>3905536)throw new Error(`音频文件无效或过大`);
  const wav=await readFile(path);return importAsrWav(wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength));
};
await preflightAsrAudio(manifest.slice(initialResults.length),{readAudio});
const reportOutput=await open(reportName,'wx');let output;
try{output=await open(resultsName,resume?'a':'wx');}catch(error){await reportOutput.close();await unlink(reportName);throw error;}
let completed=false;const cancellation=installBatchCancellation();
try{
  const results=await runAsrBatch(entries,{provider:asr,initialResults,profileMemory,signal:cancellation.signal,readAudio,async onResult(result){
    await output.write(formatAsrResultJsonl(result,{prependNewline:resumeNeedsSeparator}));await output.sync();resumeNeedsSeparator=false;
  }});
  process.exitCode=await writeAsrAcceptanceReport(reportOutput,results);completed=true;
}finally{cancellation.dispose();await Promise.allSettled([output.close(),reportOutput.close()]);if(!completed)await unlink(reportName).catch(()=>{});}
