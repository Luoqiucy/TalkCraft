// Explicit manual smoke test: sends only these synthetic samples to the configured model.
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:4317';
const service=await (await fetch(base+'/api/status',{signal:AbortSignal.timeout(5000)})).json();
if(service.simulated || !service.provider)throw new Error('真实文字服务未启用');
const samples=[
  {mode:'dictation',text:'嗯，今天的评审改到下午3点，不要改到4点，请大家提前阅读方案。'},
  {mode:'prompt',text:'帮我写一个无线麦克风测试计划，预算1200元，不要购买硬件，只输出三个步骤。'},
  {mode:'translate',text:'评审改到下午3点，不要改到4点。',targetLanguage:'en'},
  {mode:'chat',text:'用一句话说明为什么软件测试需要覆盖取消操作。'}
];
const results=[];
for(const sample of samples){const start=Date.now();try{
  const response=await fetch(base+'/api/process',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({...sample,cloudConsent:true}),signal:AbortSignal.timeout(125000)});
  const data=await response.json();const pass=response.ok&&data.simulated===false&&typeof data.text==='string'&&!!data.text.trim();
  results.push({mode:sample.mode,input:sample.text,httpStatus:response.status,elapsedMs:Date.now()-start,pass,...(pass?{output:data.text}:{error:data.error||'结果格式无效'})});
}catch{results.push({mode:sample.mode,pass:false,elapsedMs:Date.now()-start,error:'测试请求未完成'});}
console.log(JSON.stringify(results.at(-1)));if(!results.at(-1).pass)break;
}
await writeFile(new URL('../reports/2026-09-15-phase1-039-live.json',import.meta.url),JSON.stringify({provider:service.provider,time:new Date().toISOString(),results},null,2));
if(results.length!==4||results.some(result=>!result.pass))process.exitCode=1;
