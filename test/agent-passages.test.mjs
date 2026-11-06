import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPassages,splitPassages} from '../src/agent/passages.mjs';
import {relevanceTerms,subjectCoverage} from '../src/search-orchestrator.mjs';
import {ToolRegistry} from '../src/tools/registry.mjs';

test('相关性词项按中文双字和英文词切分，不跨越被删除的疑问词',()=>{
 const terms=relevanceTerms('OpenAI最近发布了什么新模型GPT-5.5');
 assert.ok(terms.latin.includes('openai'));assert.ok(terms.latin.includes('gpt-5.5'));assert.ok(terms.han.includes('模型'));assert.ok(!terms.han.includes('最近'));
 assert.ok(subjectCoverage('美元兑人民币汇率','中国银行美元兑人民币汇率牌价')>=0.9);
 assert.ok(subjectCoverage('苏州博物馆开放时间','南京博物院门票预约')<0.5);
 // "ai" must not match inside an unrelated English word.
 assert.equal(subjectCoverage('AI','He said nothing'),0);
});

test('从长网页中选出与问题相关的段落，保持原文顺序',()=>{
 const filler='首页 导航 关于我们 新闻动态 展览 教育 文创 联系我们。'.repeat(40);
 const text=`${filler}\n\n门票：免费参观，需提前预约。\n\n${filler}\n\n开放时间：周二至周日 9:00—17:00，周一闭馆。`;
 const picked=selectPassages(text,'苏州博物馆 开放时间 门票');
 assert.match(picked,/周一闭馆/);assert.match(picked,/免费参观/);assert.ok(picked.indexOf('免费参观')<picked.indexOf('周一闭馆'));assert.doesNotMatch(picked,/联系我们/);
 assert.equal(selectPassages(text,'特斯拉 股价'),'');
 assert.ok(splitPassages('甲'.repeat(2000)).every(chunk=>chunk.length<=540));
});

test('工具单次限时到期记为失败，不当作用户取消',async()=>{
 const registry=new ToolRegistry();const events=[];
 registry.register({name:'read_webpage',description:'test',execute:(_args,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))});
 const outcome=await registry.execute('read_webpage',{url:'https://slow.example'},{timeoutMs:30,onStatus:event=>events.push(event),prefetch:true});
 assert.equal(outcome.status,'failed');assert.match(outcome.error,/读取超时/);assert.deepEqual(events.map(event=>event.status),['running','failed']);assert.ok(events.every(event=>event.prefetch===true));
 const controller=new AbortController();const pending=registry.execute('read_webpage',{url:'https://slow.example'},{signal:controller.signal,timeoutMs:5000});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
});
