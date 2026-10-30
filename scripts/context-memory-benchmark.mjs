import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {createPersonalMemoryStore} from '../src/personal-memory.mjs';

const sizes=[100,1000,10000];
const queries=['我喜欢什么回答风格','我的回答偏好是什么','我偏好的表达风格','以后怎么回答','我的饮品偏好','我喜欢什么水果','我的默认地区','完全无关的查询'];
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
const results=[];
for(const size of sizes){
 const dir=await mkdtemp(join(tmpdir(),'talkcraft-memory-bench-')),path=join(dir,'memory.sqlite');let store;
 try{
  store=createPersonalMemoryStore(path);
  const db=new DatabaseSync(path);db.exec('BEGIN IMMEDIATE');
  const insert=db.prepare("INSERT INTO personal_memories(memory_id,owner_id,type,content,reason,source_record_id,independent,confirmed,status,version,created_at,updated_at,review_at,sync_selected,remote_version,sync_state) VALUES(?,?,?,?,?,NULL,0,1,'active',1,?,?,NULL,0,0,'local')"),owner='account:benchmark';
  const now=Date.now();insert.run('oldest-target',owner,'preference','我喜欢简短回答','合成样本：用户明确确认的表达风格',now-10_000_000,now-10_000_000);
  for(let i=1;i<size;i++){const at=now-size+i;insert.run(`synthetic-${i}`,owner,'fact',`测试合成事实编号 ${i}`,'合成的背景说明材料',at,at);}
  db.exec('COMMIT');db.close();
  const latencies=[];let correct=0,hits=0,misses=0,scanTotal=0;const rssBefore=process.memoryUsage().rss;
  for(let i=0;i<30;i++){const q=queries[i%queries.length],expected=/回答风格|回答偏好|表达风格|怎么回答/u.test(q),start=performance.now(),value=store.relevant(owner,q,{limit:5,maxChars:1600}),elapsed=performance.now()-start;latencies.push(elapsed);scanTotal+=value.scanned;if(expected?value.memoryIds.includes('oldest-target'):value.memoryIds.length===0)correct++;if(value.memoryIds.includes('oldest-target'))hits++;else misses++;}
  const rssAfter=process.memoryUsage().rss;results.push({entries:size,queries:30,correct,accuracy:correct/30,hitCount:hits,missCount:misses,scanPerQuery:scanTotal/30,p50Ms:Number(percentile(latencies,.50).toFixed(3)),p95Ms:Number(percentile(latencies,.95).toFixed(3)),rssDeltaBytes:rssAfter-rssBefore,oldestTargetFound:store.relevant(owner,'我喜欢什么回答风格').memoryIds.includes('oldest-target')});
 }finally{store?.close();await rm(dir,{recursive:true,force:true});}
}
console.log(JSON.stringify({machine:process.env.COMPUTERNAME||'unknown',node:process.version,results},null,2));
