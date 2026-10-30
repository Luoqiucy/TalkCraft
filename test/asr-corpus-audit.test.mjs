import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pcmToWav} from '../public/audio.mjs';

test('语料审计CLI实际文件往返、完整性退出码及报告覆盖保护',async()=>{
  const dir=await mkdtemp(resolve(tmpdir(),'talkcraft-corpus-audit-'));
  try{
    const manifest=resolve(dir,'manifest.jsonl'),report=resolve(dir,'report.json');
    const entries=Array.from({length:100},(_,index)=>({id:`sample-${index}`,reference:'今天3点不要发布',audio:'valid.wav'}));
    entries[98].audio='missing.wav';entries[99].audio='invalid.wav';
    await writeFile(resolve(dir,'valid.wav'),new Uint8Array(pcmToWav(new ArrayBuffer(3200))));
    await writeFile(resolve(dir,'invalid.wav'),'bad WAV');
    await writeFile(manifest,entries.map(item=>JSON.stringify(item)).join('\n'));
    const run=()=>spawnSync(process.execPath,['scripts/asr-corpus-audit.mjs',manifest,report],{encoding:'utf8',timeout:10000});
    assert.equal(run().status,2);
    const partial=JSON.parse(await readFile(report,'utf8'));
    assert.equal(partial.readyCount,98);assert.deepEqual(partial.missingIds,['sample-98']);assert.equal(partial.invalid[0].id,'sample-99');
    const original=await readFile(report,'utf8');assert.equal(run().status,1);assert.equal(await readFile(report,'utf8'),original);
    await rm(report);entries[98].audio='valid.wav';entries[99].audio='valid.wav';
    await writeFile(manifest,entries.map(item=>JSON.stringify(item)).join('\n'));
    assert.equal(run().status,0);assert.equal(JSON.parse(await readFile(report,'utf8')).complete,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});
