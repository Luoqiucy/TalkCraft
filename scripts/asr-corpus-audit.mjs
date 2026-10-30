import {readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {auditAsrAudio,importAsrWav,validateAsrManifest} from '../src/asr-batch.mjs';

const source=process.argv[2];
if(!source)throw new Error('用法：node scripts/asr-corpus-audit.mjs <manifest.jsonl> [report.json]');
const manifestName=resolve(source),lines=(await readFile(manifestName,'utf8')).split(/\r?\n/).filter(line=>line.trim());
const entries=lines.map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`清单第${index+1}行不是有效JSON`);}});
const manifest=validateAsrManifest(entries);
const report=await auditAsrAudio(manifest,{async readAudio(entry){
  const path=resolve(dirname(manifestName),entry.audio),info=await stat(path);
  if(!info.isFile())throw new Error('不是普通文件');
  if(info.size>3905536)throw new Error('音频文件过大');
  const wav=await readFile(path);return importAsrWav(wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength));
}});
const json=JSON.stringify(report,null,2)+'\n';
if(process.argv[3])await writeFile(resolve(process.argv[3]),json,{flag:'wx'});else process.stdout.write(json);
if(!report.complete)process.exitCode=2;
