import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compareAsrRuns} from '../src/asr-compare.mjs';
import {validateAsrManifest} from '../src/asr-batch.mjs';

const manifest=[
  {id:'terms-001',reference:'张家港市天气',audio:'a.wav'},
  {id:'finance-001',reference:'预算-5万元',audio:'b.wav'},
  {id:'negative-001',reference:'今天不要发布',audio:'c.wav'},
  {id:'speech-001',reference:'这是比较长的一段口述',audio:'d.wav'},
];
const results=(providerId,latencies=[100,200,300,400])=>manifest.map((entry,index)=>({id:entry.id,reference:entry.reference,hypothesis:entry.reference,latencyMs:latencies[index],audioDurationMs:1000,peakProcessRssBytes:1024+index,providerId}));

test('固定对比语料保留数字否定并单列地名与长口述',async()=>{
  const rows=(await readFile(resolve('samples/asr-comparison-100.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  validateAsrManifest(rows);
  const groups=Object.groupBy(rows,row=>row.id.split('-')[0]);
  assert.equal(groups.places.length,10);
  assert.equal(groups.long.length,10);
  assert.equal(groups.negative.length,10);
  assert.equal(groups.finance.length,10);
  assert.ok(groups.places.some(row=>row.reference.includes('张家港')));
  assert.ok(groups.long.every(row=>row.reference.length>60));
});

test('相同音频的配置比较给出CER、P50/P95、分组、内存及明确估算费用',()=>{
  const second=results('volcengine',[80,90,110,120]);
  second[1].hypothesis='预算5万元';second[2].hypothesis='今天发布';
  const report=compareAsrRuns(manifest,[{name:'配置A',providerId:'volcengine',runKind:'fixture',results:results('volcengine'),priceCnyPerMinute:1.5},{name:'配置B',providerId:'volcengine',runKind:'fixture',results:second}]);
  assert.equal(report.runs[0].p50LatencyMs,200);
  assert.equal(report.runs[0].p95LatencyMs,400);
  assert.equal(report.runs[0].p50StopToFinalMs,null);
  assert.equal(report.runs[0].estimatedCostCny,0.1);
  assert.equal(report.runs[0].peakNodeProcessRssBytes,1027);
  assert.equal(report.runs[0].byCategory.terms.sampleCount,1);
  assert.deepEqual(report.runs[1].numberFailureIds,['finance-001']);
  assert.deepEqual(report.runs[1].negationFailureIds,['negative-001']);
  assert.equal(report.runs[1].estimatedCostCny,null);
  assert.equal(report.runs[1].runKind,'替身测试');
  assert.equal(report.runs[0].datasetSha256,report.runs[1].datasetSha256);
  assert.equal(JSON.stringify(report).includes('张家港市天气'),false);
});

test('只有每条真实停录耗时齐全时才给出端到端P50/P95',()=>{
  const measured=results('volcengine').map((item,index)=>({...item,stopToFinalMs:[400,500,600,700][index]}));
  const report=compareAsrRuns(manifest,[{name:'真实停录计时',results:measured}]);
  assert.equal(report.runs[0].p50StopToFinalMs,500);
  assert.equal(report.runs[0].p95StopToFinalMs,700);
  delete measured[0].stopToFinalMs;
  assert.equal(compareAsrRuns(manifest,[{name:'缺一条',results:measured}]).runs[0].p50StopToFinalMs,null);
});

test('拒绝缺项、错参考、冒名提供器和不完整计价；缺内存不补造',()=>{
  assert.throws(()=>compareAsrRuns(manifest,[{name:'少一条',results:results('volcengine').slice(1)}]),/数量/);
  const altered=results('volcengine');altered[0].reference='另一段话';
  assert.throws(()=>compareAsrRuns(manifest,[{name:'错参考',results:altered}]),/不一致/);
  assert.throws(()=>compareAsrRuns(manifest,[{name:'冒名',providerId:'other',results:results('volcengine')}]),/提供器标识/);
  const old=results('volcengine').map(({audioDurationMs,peakProcessRssBytes,...item})=>item);
  const report=compareAsrRuns(manifest,[{name:'旧结果',results:old,priceCnyPerMinute:1}]);
  assert.equal(report.runs[0].estimatedCostCny,null);
  assert.equal(report.runs[0].peakNodeProcessRssBytes,null);
});

test('比较CLI读取磁盘结果并独占生成报告，不覆盖现有结果',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'talkcraft-asr-compare-'));
  try{
    const paths={manifest:join(directory,'manifest.jsonl'),results:join(directory,'results.jsonl'),config:join(directory,'runs.json'),report:join(directory,'report.json')};
    await writeFile(paths.manifest,manifest.map(JSON.stringify).join('\n')+'\n');
    await writeFile(paths.results,results('volcengine').map(JSON.stringify).join('\n')+'\n');
    await writeFile(paths.config,JSON.stringify({runs:[{name:'豆包',providerId:'volcengine',runKind:'fixture',results:'results.jsonl'}]}));
    const run=()=>spawnSync(process.execPath,['scripts/asr-compare.mjs',paths.manifest,paths.config,paths.report],{encoding:'utf8',timeout:10000});
    assert.equal(run().status,0);
    assert.equal(JSON.parse(await readFile(paths.report,'utf8')).runs[0].sampleCount,4);
    assert.notEqual(run().status,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});
