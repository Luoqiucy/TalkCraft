import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editDistance,evaluateAsrSamples,normalizeTranscript} from '../src/asr-benchmark.mjs';

test('CER规范化忽略空格标点并保留中文数字和否定',()=>{
  assert.deepEqual(normalizeTranscript('今天 3 点，不改。'),[...'今天3点不改']);
  assert.equal(editDistance([...'你好'],[...'你号']),1);
  const report=evaluateAsrSamples([{id:'a',reference:'预算1200元，不提前发布。',hypothesis:'预算1200元不提前发布',latencyMs:850}],{expectedCount:1});
  assert.equal(report.cer,0);assert.equal(report.numbersPreserved,true);assert.equal(report.negationsPreserved,true);assert.equal(report.passed,true);
});

test('按总字符计算CER并使用nearest-rank P95',()=>{
  const samples=Array.from({length:20},(_,index)=>({id:`sample-${index}`,reference:'无线麦克风',hypothesis:index===0?'无线麦风':'无线麦克风',latencyMs:(index+1)*100}));
  const report=evaluateAsrSamples(samples,{expectedCount:20,maxCer:0.02,maxP95LatencyMs:1900});
  assert.equal(report.edits,1);assert.equal(report.referenceCharacters,100);assert.equal(report.cer,0.01);assert.equal(report.p95LatencyMs,1900);assert.equal(report.passed,true);
});

test('数字语义门槛保留正负号，不能被CER标点规范化掩盖',()=>{
  const make=(reference,hypothesis)=>evaluateAsrSamples([{id:'signed',reference,hypothesis,latencyMs:1}],{expectedCount:1});
  for(const [reference,hypothesis] of [['温度-5度','温度5度'],['偏差+0.5毫米','偏差-0.5毫米']]){
    const report=make(reference,hypothesis);assert.equal(report.cer,0);assert.equal(report.numbersPreserved,false);assert.equal(report.passed,false);
  }
  assert.equal(make('温度−5度','温度-5度').passed,true);
  assert.notEqual(make('温度-5度','温度-5度').datasetSha256,make('温度5度','温度5度').datasetSha256);
  assert.equal(make('ESP32-S3版本1到2','ESP32-S3版本1到2').passed,true);
});

test('样本数、阈值、数字和否定分别形成验收门槛',()=>{
  const report=evaluateAsrSamples([{id:'bad',reference:'今天3点不要发布',hypothesis:'今天4点发布',latencyMs:5100}],{expectedCount:100});
  assert.deepEqual(report.gates,{sampleCount:false,cer:false,p95Latency:false,numbersPreserved:false,negationsPreserved:false});assert.equal(report.passed,false);
  assert.throws(()=>evaluateAsrSamples([{id:'empty',reference:'',hypothesis:'',latencyMs:0}],{expectedCount:1}),/参考文本为空/);
  assert.throws(()=>evaluateAsrSamples([{id:'negative',reference:'测试',hypothesis:'测试',latencyMs:-1}],{expectedCount:1}),/latencyMs无效/);
});

test('固定数据集要求显式唯一ID并生成稳定参考摘要',()=>{
  const first=evaluateAsrSamples([{id:' sample-001 ',reference:'今天三点。',hypothesis:'今天三点',latencyMs:1000}],{expectedCount:1});
  const second=evaluateAsrSamples([{id:'sample-001',reference:'今天三点',hypothesis:'完全不同',latencyMs:4999}],{expectedCount:1});
  assert.match(first.datasetSha256,/^[a-f0-9]{64}$/);assert.equal(first.datasetSha256,second.datasetSha256);
  assert.throws(()=>evaluateAsrSamples([{id:'same',reference:'甲',hypothesis:'甲',latencyMs:1},{id:'same',reference:'乙',hypothesis:'乙',latencyMs:1}],{expectedCount:2}),/id重复/);
  assert.throws(()=>evaluateAsrSamples([{id:' ',reference:'甲',hypothesis:'甲',latencyMs:1}],{expectedCount:1}),/id无效/);
});
