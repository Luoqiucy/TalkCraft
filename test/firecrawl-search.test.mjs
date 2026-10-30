import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirecrawlSearch} from '../src/providers/firecrawl-search.mjs';

test('Firecrawl 结果保留摘要并过滤无效与敏感链接',async()=>{
  const request=[];const search=createFirecrawlSearch({apiKey:'secret-test',fetchImpl:async(url,options)=>{request.push({url,body:JSON.parse(options.body)});return Response.json({creditsUsed:2,data:{web:[{url:'https://example.com/a?token=secret&lang=zh',title:'公告',description:'有用的资料'},{url:'http://localhost/private',title:'不可展示'},{url:'https://example.com/a?token=secret&lang=zh',title:'重复'}]}});}});
  const result=await search('测试查询',{maxResults:5});
  assert.equal(request[0].url,'https://api.firecrawl.dev/v2/search');assert.equal(result.sources.length,1);assert.match(result.sources[0].url,/lang=zh/);assert.doesNotMatch(result.sources[0].url,/secret/);assert.equal(result.sources[0].snippet,'有用的资料');assert.equal(result.backend,'firecrawl');assert.equal(result.usage.firecrawlCredits,2);
});
