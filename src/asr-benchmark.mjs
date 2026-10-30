import {createHash} from 'node:crypto';

const NEGATIONS=['不能','不要','不会','没有','不是','未','无','否','不','没','别','勿','莫'];

export function normalizeTranscript(value) {
  if(typeof value!=='string')throw new TypeError('转写文本必须是字符串');
  return [...value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}\s]/gu,'')];
}

export function editDistance(reference,hypothesis) {
  const previous=Array.from({length:hypothesis.length+1},(_,index)=>index);
  for(let row=1;row<=reference.length;row++){
    let diagonal=previous[0];previous[0]=row;
    for(let column=1;column<=hypothesis.length;column++){
      const above=previous[column],cost=reference[row-1]===hypothesis[column-1]?0:1;
      previous[column]=Math.min(previous[column]+1,previous[column-1]+1,diagonal+cost);diagonal=above;
    }
  }
  return previous[hypothesis.length];
}

function semanticTokens(value) {
  const normalized=value.normalize('NFKC').toLocaleLowerCase('zh-CN').replaceAll('−','-');
  const numbers=normalized.match(/(?<![a-z0-9])[+-]\d+(?:\.\d+)?|\d+(?:\.\d+)?/g)??[];
  const negations=[];let cursor=0;
  while(cursor<normalized.length){const token=NEGATIONS.find(item=>normalized.startsWith(item,cursor));if(token){negations.push(token);cursor+=token.length;}else cursor++;}
  return {numbers,negations};
}

function sameTokens(left,right){return left.length===right.length&&left.every((value,index)=>value===right[index]);}
export function percentile(values,quantile){
  if(!Array.isArray(values)||!values.length||values.some(value=>!Number.isFinite(value)||value<0)||!Number.isFinite(quantile)||quantile<=0||quantile>1)throw new TypeError('百分位输入无效');
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.ceil(sorted.length*quantile)-1];
}

export function evaluateAsrSamples(samples,{expectedCount=100,maxCer=0.08,maxP95LatencyMs=5000}={}) {
  if(!Array.isArray(samples)||samples.length===0)throw new TypeError('至少需要一条ASR样本');
  if(!Number.isInteger(expectedCount)||expectedCount<1)throw new TypeError('expectedCount必须是正整数');
  let edits=0,referenceCharacters=0;const ids=new Set(),dataset=[];
  const details=samples.map((sample,index)=>{
    if(!sample||typeof sample!=='object')throw new TypeError(`第${index+1}条样本无效`);
    if(typeof sample.id!=='string'||!sample.id.trim()||sample.id.length>128)throw new TypeError(`第${index+1}条样本的id无效`);
    const id=sample.id.trim();if(ids.has(id))throw new TypeError(`样本id重复：${id}`);ids.add(id);
    const reference=normalizeTranscript(sample.reference),hypothesis=normalizeTranscript(sample.hypothesis);
    if(reference.length===0)throw new TypeError(`样本${id}的参考文本为空`);
    if(!Number.isFinite(sample.latencyMs)||sample.latencyMs<0)throw new TypeError(`样本${id}的latencyMs无效`);
    const distance=editDistance(reference,hypothesis),expected=semanticTokens(sample.reference),actual=semanticTokens(sample.hypothesis);
    edits+=distance;referenceCharacters+=reference.length;dataset.push([id,reference.join(''),expected.numbers]);
    return {id,characters:reference.length,edits:distance,cer:distance/reference.length,latencyMs:sample.latencyMs,numbersPreserved:sameTokens(expected.numbers,actual.numbers),negationsPreserved:sameTokens(expected.negations,actual.negations)};
  });
  const cer=edits/referenceCharacters,p50LatencyMs=percentile(details.map(item=>item.latencyMs),0.5),p95LatencyMs=percentile(details.map(item=>item.latencyMs),0.95);
  const numbersPreserved=details.every(item=>item.numbersPreserved),negationsPreserved=details.every(item=>item.negationsPreserved);
  const gates={sampleCount:samples.length===expectedCount,cer:cer<=maxCer,p95Latency:p95LatencyMs<=maxP95LatencyMs,numbersPreserved,negationsPreserved};
  const datasetSha256=createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
  return {sampleCount:samples.length,expectedCount,datasetSchemaVersion:2,datasetSha256,edits,referenceCharacters,cer,p50LatencyMs,p95LatencyMs,numbersPreserved,negationsPreserved,passed:Object.values(gates).every(Boolean),gates,details};
}
