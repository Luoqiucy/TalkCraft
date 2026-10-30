import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {compareAsrRuns} from '../src/asr-compare.mjs';

const [manifestName,configName,reportName]=process.argv.slice(2);
if(!manifestName||!configName||!reportName)throw new Error('用法：node scripts/asr-compare.mjs <manifest.jsonl> <runs.json> <report.json>');
const jsonl=async path=>(await readFile(path,'utf8')).split(/\r?\n/).filter(Boolean).map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`${path} 第${index+1}行不是有效JSON`);}});
const manifest=await jsonl(resolve(manifestName));
const config=JSON.parse(await readFile(resolve(configName),'utf8'));
if(!Array.isArray(config?.runs)||config.runs.some(item=>typeof item?.results!=='string'||!item.results.trim()))throw new TypeError('比较配置需包含 runs 和结果文件路径');
const runs=[];
for(const item of config.runs){
  const path=resolve(dirname(resolve(configName)),item.results);
  runs.push({...item,results:await jsonl(path)});
}
const report=compareAsrRuns(manifest,runs);
await writeFile(resolve(reportName),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(`已比较 ${report.runs.length} 组配置，样本 ${report.sampleCount} 条。报告：${resolve(reportName)}\n`);
