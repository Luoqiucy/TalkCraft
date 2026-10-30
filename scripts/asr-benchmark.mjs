import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {evaluateAsrSamples} from '../src/asr-benchmark.mjs';

function usage(){throw new Error('用法：node scripts/asr-benchmark.mjs <samples.jsonl> [report.json]');}
const source=process.argv[2];if(!source)usage();
const lines=(await readFile(resolve(source),'utf8')).split(/\r?\n/).filter(line=>line.trim());
let samples;
try{samples=lines.map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`第${index+1}行不是有效JSON`);}});}catch(error){console.error(error.message);process.exit(1);}
let report;
try{report=evaluateAsrSamples(samples);}catch(error){console.error(error.message);process.exit(1);}
const json=JSON.stringify(report,null,2)+'\n';
if(process.argv[3])await writeFile(resolve(process.argv[3]),json,{flag:'wx'});else process.stdout.write(json);
if(!report.passed)process.exitCode=2;
