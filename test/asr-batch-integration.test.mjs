import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pcmToWav} from '../public/audio.mjs';
import {formatAsrResultJsonl,importAsrWav,runAsrBatch,writeAsrAcceptanceReport} from '../src/asr-batch.mjs';

test('本机WAV→替身批量转写→磁盘结果→CLI重算保持100条报告与质量状态一致',async()=>{
  const dir=await mkdtemp(resolve(tmpdir(),'talkcraft-batch-integration-'));
  try{
    const audioPath=resolve(dir,'silent.wav');
    await writeFile(audioPath,new Uint8Array(pcmToWav(new ArrayBuffer(3200))));
    const entries=Array.from({length:100},(_,index)=>({id:`sample-${index}`,reference:'今天3点不要发布',audio:audioPath}));
    for(const bad of [false,true]){
      const name=bad?'failed':'passed',resultsPath=resolve(dir,`${name}.jsonl`),reportPath=resolve(dir,`${name}.json`),recomputedPath=resolve(dir,`${name}-recomputed.json`);
      const resultsOutput=await open(resultsPath,'wx');let calls=0,time=0,results;
      // 明确为测试替身；没有网络、真实ASR凭据或质量验收。
      const provider={enabled:true,simulated:false,async transcribe(){calls++;return bad&&calls===100?'今天4点发布':'今天3点不要发布';}};
      try{
        results=await runAsrBatch(entries,{provider,now:()=>time+=100,async readAudio(entry){const wav=await readFile(entry.audio);return importAsrWav(wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength));},async onResult(result){await resultsOutput.write(formatAsrResultJsonl(result));await resultsOutput.sync();}});
      }finally{await resultsOutput.close();}
      assert.equal(calls,100);
      const saved=(await readFile(resultsPath,'utf8')).trim().split('\n').map(JSON.parse);
      assert.deepEqual(saved,results);
      const reportOutput=await open(reportPath,'wx');
      try{assert.equal(await writeAsrAcceptanceReport(reportOutput,results),bad?2:0);}finally{await reportOutput.close();}
      const cli=spawnSync(process.execPath,['scripts/asr-benchmark.mjs',resultsPath,recomputedPath],{encoding:'utf8',timeout:10000});
      assert.equal(cli.status,bad?2:0,cli.stderr);
      const report=JSON.parse(await readFile(reportPath,'utf8'));
      assert.deepEqual(JSON.parse(await readFile(recomputedPath,'utf8')),report);
      assert.equal(report.passed,!bad);assert.equal(report.sampleCount,100);
      if(bad){assert.equal(report.gates.numbersPreserved,false);assert.equal(report.gates.negationsPreserved,false);assert.equal(report.gates.cer,true);}
      const original=await readFile(recomputedPath,'utf8');
      assert.equal(spawnSync(process.execPath,['scripts/asr-benchmark.mjs',resultsPath,recomputedPath],{encoding:'utf8',timeout:10000}).status,1);
      assert.equal(await readFile(recomputedPath,'utf8'),original);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
