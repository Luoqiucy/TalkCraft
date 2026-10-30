// Explicit live test using synthetic text only; never part of npm test.
import {readFile,writeFile} from 'node:fs/promises';
import {providersFromEnvFile} from '../src/file-config.mjs';
import {processText} from '../src/pipeline.mjs';
const {provider}=providersFromEnvFile(await readFile(new URL('../.local/asr-test.env',import.meta.url),'utf8'));
if(provider.simulated)throw new Error('需要真实文字提供器');
const samples=[
  '帮我写一个无线麦克风测试计划，预算1200元，不要购买硬件，只输出三个步骤。',
  '帮我写一个会议纪要提示词，明确要求不补充未知事实，只输出三个要点。'
];
const results=[];
for(const text of samples){const start=Date.now();try{const result=await processText({mode:'prompt',text},provider,AbortSignal.timeout(120000));results.push({input:text,...result,elapsedMs:Date.now()-start});}catch{results.push({input:text,error:'真实请求失败',elapsedMs:Date.now()-start});break;}}
await writeFile(new URL('../reports/2026-09-15-phase1-040-live.json',import.meta.url),JSON.stringify({time:new Date().toISOString(),provider:provider.id,results},null,2));
console.log(JSON.stringify(results));if(results.length!==2||results.some(r=>r.error))process.exitCode=1;
