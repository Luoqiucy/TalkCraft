import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirecrawlScrape} from '../src/providers/firecrawl-scrape.mjs';
import {createDeepSeekProvider} from '../src/providers/text.mjs';
import {createAgentToolRegistry} from '../src/tools/registry.mjs';

test('Firecrawl 正文抓取请求使用官方 Markdown 格式并返回内容、时间与用量',async()=>{
 const calls=[];
 const scrape=createFirecrawlScrape({apiKey:'test-secret',lookupImpl:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return new Response(JSON.stringify({success:true,data:{markdown:'理想 i9 官方售价 36.98 万元。'.repeat(5),metadata:{title:'理想 i9 发布公告',sourceURL:'https://ir.lixiang.com/news-releases/li-i9',publishedTime:'2026-09-16'}}}));}});
 const result=await scrape('https://ir.lixiang.com/news-releases/li-i9?token=do-not-log');
 assert.equal(calls[0].url,'https://api.firecrawl.dev/v2/scrape');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].body.formats[0],'markdown');
 assert.equal(result.title,'理想 i9 发布公告');assert.equal(result.publishedAt,'2026-09-16');assert.match(result.text,/36.98/);assert.equal(result.readMethod,'firecrawl');assert.equal(result.usage.scrapeRequests,1);
 assert.doesNotMatch(JSON.stringify(result),/do-not-log|test-secret/);
});

test('Firecrawl 抓取拒绝私网域名且不向 API 发请求',async()=>{
 let calls=0;const scrape=createFirecrawlScrape({apiKey:'test-secret',fetchImpl:async()=>{calls++;return new Response('{}');}});
 await assert.rejects(scrape('http://127.0.0.1/admin'),/公开HTTP\/HTTPS/);assert.equal(calls,0);
});

test('Firecrawl 正文抓取可取消且不把授权密钥写入错误',async()=>{
 const controller=new AbortController();let requestSignal;
 const scrape=createFirecrawlScrape({apiKey:'test-secret',lookupImpl:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async(_url,options)=>{requestSignal=options.signal;controller.abort();if(requestSignal.aborted)throw new DOMException('Aborted','AbortError');return await new Promise((_,reject)=>requestSignal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});
 await assert.rejects(scrape('https://example.com/article',{signal:controller.signal}),{name:'AbortError'});
});

test('DeepSeek 配置的同一个 Firecrawl Key 暴露独立正文工具且工具调用计入注册表',async()=>{
 const calls=[];const provider=createDeepSeekProvider({apiKey:'model-test',model:'deepseek-flash',firecrawlApiKey:'firecrawl-test',lookupImpl:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({success:true,data:{markdown:'这是 Firecrawl 抓取回来的足够长度正文。'.repeat(4),metadata:{title:'正文页',sourceURL:'https://example.com/article'}}}));}});
 const registry=createAgentToolRegistry({provider,webpageTool:{enabled:true,async read(){return {text:'本地静态读取内容'.repeat(10),finalUrl:'https://example.com/article'};}}});
 const definition=registry.list().find(tool=>tool.name==='scrape_webpage');assert.equal(definition.enabled,true);
 const outcome=await registry.execute('scrape_webpage',{url:'https://example.com/article'},{taskId:'scrape-task'});
 assert.equal(outcome.success,true);assert.equal(outcome.data.readMethod,'firecrawl');assert.equal(calls[0].url,'https://api.firecrawl.dev/v2/scrape');assert.equal(calls[0].body.onlyMainContent,true);
});
