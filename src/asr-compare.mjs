import {evaluateAsrSamples,percentile} from './asr-benchmark.mjs';

const finiteNonnegative=value=>Number.isFinite(value)&&value>=0;

export function compareAsrRuns(manifest,runs){
  if(!Array.isArray(manifest)||manifest.length===0||!Array.isArray(runs)||runs.length===0)throw new TypeError('需要固定语料与至少一组识别结果');
  const manifestIds=new Set();
  for(const entry of manifest){
    if(typeof entry?.id!=='string'||!entry.id.trim()||manifestIds.has(entry.id)||typeof entry.reference!=='string'||!entry.reference.trim())throw new TypeError('语料编号或人工参考文本无效');
    manifestIds.add(entry.id);
  }
  const names=new Set(),reports=[];
  for(const run of runs){
    if(typeof run?.name!=='string'||!run.name.trim()||names.has(run.name)||!Array.isArray(run.results))throw new TypeError('识别配置名称或结果无效');
    names.add(run.name);
    if(run.results.length!==manifest.length)throw new TypeError(`${run.name} 的结果数量与固定语料不一致`);
    const byId=new Map();
    for(const item of run.results){
      if(!manifestIds.has(item?.id)||byId.has(item.id))throw new TypeError(`${run.name} 存在未知或重复样本编号`);
      byId.set(item.id,item);
    }
    const samples=manifest.map(entry=>{
      const item=byId.get(entry.id);
      if(!item||item.reference!==entry.reference)throw new TypeError(`${run.name} 的样本 ${entry.id} 与人工参考文本不一致`);
      return item;
    });
    const overall=evaluateAsrSamples(samples,{expectedCount:manifest.length});
    const groups={};
    for(const entry of manifest){const group=entry.id.split('-')[0];(groups[group]??=[]).push(byId.get(entry.id));}
    const byCategory=Object.fromEntries(Object.entries(groups).map(([name,items])=>{
      const score=evaluateAsrSamples(items,{expectedCount:items.length});
      return [name,{sampleCount:items.length,cer:score.cer,p50LatencyMs:score.p50LatencyMs,p95LatencyMs:score.p95LatencyMs,numbersPreserved:score.numbersPreserved,negationsPreserved:score.negationsPreserved}];
    }));
    const durations=samples.map(item=>item.audioDurationMs),rss=samples.map(item=>item.peakProcessRssBytes),stopToFinal=samples.map(item=>item.stopToFinalMs);
    const providerIds=[...new Set(samples.map(item=>item.providerId).filter(Boolean))];
    if(run.providerId!==undefined&&(typeof run.providerId!=='string'||providerIds.some(id=>id!==run.providerId)||samples.some(item=>!item.providerId)))throw new TypeError(`${run.name} 的提供器标识与结果不一致`);
    if(durations.some(value=>value!==undefined&&!finiteNonnegative(value))||rss.some(value=>value!==undefined&&!finiteNonnegative(value))||stopToFinal.some(value=>value!==undefined&&!finiteNonnegative(value)))throw new TypeError(`${run.name} 的时长或内存数据无效`);
    if(run.priceCnyPerMinute!==undefined&&(!finiteNonnegative(run.priceCnyPerMinute)||run.priceCnyPerMinute>10000))throw new TypeError(`${run.name} 的单价无效`);
    const completeDuration=durations.every(finiteNonnegative),completeRss=rss.every(finiteNonnegative);
    const audioMinutes=completeDuration?durations.reduce((sum,value)=>sum+value,0)/60000:null;
    reports.push({
      name:run.name,providerId:providerIds.length===1&&samples.every(item=>item.providerId)?providerIds[0]:null,runKind:run.runKind==='real'?'自报真实调用':run.runKind==='fixture'?'替身测试':'未说明',
      sampleCount:overall.sampleCount,datasetSha256:overall.datasetSha256,cer:overall.cer,p50LatencyMs:overall.p50LatencyMs,p95LatencyMs:overall.p95LatencyMs,
      p50StopToFinalMs:stopToFinal.every(finiteNonnegative)?percentile(stopToFinal,0.5):null,p95StopToFinalMs:stopToFinal.every(finiteNonnegative)?percentile(stopToFinal,0.95):null,
      numbersPreserved:overall.numbersPreserved,negationsPreserved:overall.negationsPreserved,
      numberFailureIds:overall.details.filter(item=>!item.numbersPreserved).map(item=>item.id),
      negationFailureIds:overall.details.filter(item=>!item.negationsPreserved).map(item=>item.id),
      byCategory,firstRequestMs:samples[0].latencyMs,
      audioMinutes,peakNodeProcessRssBytes:completeRss?Math.max(...rss):null,
      estimatedCostCny:audioMinutes!==null&&run.priceCnyPerMinute!==undefined?Math.round(audioMinutes*run.priceCnyPerMinute*10000)/10000:null,
      priceCnyPerMinute:run.priceCnyPerMinute??null,
    });
  }
  const hash=reports[0].datasetSha256;
  if(reports.some(report=>report.datasetSha256!==hash))throw new TypeError('识别结果并非同一份固定语料');
  return {schemaVersion:1,datasetSha256:hash,sampleCount:manifest.length,runs:reports,notes:[
    'latencyMs是逐段提交完整PCM到收到ASR最终文本的时间；仅在每条结果均有stopToFinalMs时另列实际停止录音到转写完成的P50/P95。',
    '首条请求时间不等于本地模型冷启动时间；模型冷启动和显卡显存均未由此工具测量。',
    '内存仅为执行识别的Node进程采样峰值，不能代表桌面程序、独立模型进程或GPU显存。',
    '费用仅在填写每音频分钟单价且每条音频时长齐全时按比例估算；未计最低计费单位、并发包、免费额度或供应商账单。',
    'runKind由采集者填写，比较器无法仅凭结果文件证明是否真实调用云端。',
  ]};
}
