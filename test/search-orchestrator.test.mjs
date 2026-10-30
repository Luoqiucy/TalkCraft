import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyQuestionIntent,evaluateSearchEvidence,orchestrateSearch} from '../src/search-orchestrator.mjs';
import {createOpenMeteoWeatherTool} from '../src/tools/weather.mjs';

const now=new Date('2026-09-19T04:00:00Z');
const source=(url='https://weather.example/nanjing')=>({url,title:'南京天气'});
test('意图选择区分天气、时效搜索、指定网址和一般知识',()=>{
 assert.deepEqual(classifyQuestionIntent('南京明天天气怎么样'),{intent:'weather',period:'tomorrow',location:'南京',timezone:'Asia/Shanghai',tool:'weather'});
 assert.equal(classifyQuestionIntent('DeepSeek最新版本').tool,'web-search');assert.equal(classifyQuestionIntent('解释蓝牙和Wi-Fi的区别').tool,'none');assert.equal(classifyQuestionIntent('总结 https://example.com/a').tool,'webpage');
 const car=classifyQuestionIntent('理想i9的汽车详细参数');assert.equal(car.intent,'product-research');assert.equal(car.subject,'理想i9');assert.equal(car.modelCode,'i9');assert.equal(car.detailed,true);assert.equal(car.category,'汽车');
});
test('搜索天气证据拒绝标题、旧日期和缺少具体值的数据',()=>{
 assert.match(evaluateSearchEvidence('南京天气怎么样',{performed:true,sources:[source()],synthesis:''},{now}).reason,/缺少可读取/);
 assert.match(evaluateSearchEvidence('南京天气怎么样',{performed:true,sources:[source()],synthesis:'2025年9月19日南京阴，28℃'},{now}).reason,/不是所需日期/);
 assert.match(evaluateSearchEvidence('南京天气怎么样',{performed:true,sources:[source()],synthesis:'2026年9月19日南京天气页面'},{now}).reason,/缺少具体温度/);
 assert.equal(evaluateSearchEvidence('南京天气怎么样',{performed:true,sources:[source()],synthesis:'2026年9月19日南京阴，最高28℃，最低22℃'},{now}).sufficient,true);
});

test('公司新闻证据按对象和发布时间窗口评估，不要求标题复述整句口语',()=>{
 const request={intent:'company-news',subject:'谷歌',news:{company:'谷歌',fromDate:'2026-09-23',toDate:'2026-09-30',lookbackDays:7}};
 const current=evaluateSearchEvidence('谷歌最近有什么新闻？',{performed:true,sources:[{title:'Google announces new AI features',url:'https://news.example/google',publishedAt:'2026-09-29',snippet:'Google announced new AI features on 2026-09-29, expanding Gemini tools for developers.'}]},{now,request});
 assert.equal(current.sufficient,true);assert.equal(current.matchedSources,1);assert.equal(current.subject,'谷歌');
 const old=evaluateSearchEvidence('谷歌最近有什么新闻？',{performed:true,sources:[{title:'Google announces new AI features',url:'https://news.example/old-google',publishedAt:'2026-08-01',snippet:'Google announced new AI features on 2026-08-01 for developers.'}]},{now,request});
 assert.equal(old.sufficient,false);assert.equal(old.staleRelevantSources,1);
 const unrelated=evaluateSearchEvidence('谷歌最近有什么新闻？',{performed:true,sources:[{title:'Microsoft quarterly news',url:'https://news.example/ms',publishedAt:'2026-09-29',snippet:'Microsoft announced a new Surface device on 2026-09-29.'}]},{now,request});
 assert.equal(unrelated.sufficient,false);assert.equal(unrelated.subjectMatched,false);
 const relative=evaluateSearchEvidence('小米汽车最近新闻',{performed:true,sources:[{title:'Xiaomi Auto update',url:'https://news.example/relative',snippet:'1 day ago · Xiaomi Auto announced a new update and delivery information for its vehicles.'}]},{now:new Date('2026-09-30T12:00:00+08:00'),request:{...request,subject:'小米汽车',news:{company:'小米汽车',fromDate:'2026-09-24',toDate:'2026-09-30',lookbackDays:7}}});
 assert.equal(relative.sufficient,true);assert.equal(relative.matchedSources,1);
 const monthDay=evaluateSearchEvidence('小米汽车最近新闻',{performed:true,sources:[{title:'小米汽车发布最新动态',url:'https://news.example/monthday',snippet:'9月29日，小米汽车公布新车型交付安排及服务升级信息。'}]},{now:new Date('2026-09-30T12:00:00+08:00'),request:{intent:'company-news',subject:'小米汽车',news:{company:'小米汽车',fromDate:'2026-09-24',toDate:'2026-09-30',lookbackDays:7}}});
 assert.equal(monthDay.sufficient,true);
});

test('天气多地点比较不会把两个城市拼成一个地点或静默只查其中一个',async()=>{
 const tool=createOpenMeteoWeatherTool({fetchImpl:async()=>{throw new Error('不应发起网络请求');}});
 const result=await tool.query({intent:'weather',locations:['南京','杭州'],location:'',period:'current-today'});
 assert.equal(result.status,'needs-location');assert.deepEqual(result.locations,['南京','杭州']);assert.match(result.question,/南京和杭州/);assert.match(result.question,/选择其中一个/);
});
test('结构化天气工具优先，已有完整数据时不调用网页搜索',async()=>{
 let searches=0;const weatherTool={enabled:true,async query(){return {status:'ok',provider:'open-meteo',period:'current-today',timezone:'Asia/Shanghai',location:{name:'南京',admin1:'江苏',country:'中国'},current:{observedAt:'2026-09-19T12:00',condition:'阴',temperature:26,apparentTemperature:28,humidity:80,precipitation:0,windSpeed:8},forecast:{date:'2026-09-19',condition:'阴',temperatureMax:28,temperatureMin:22,precipitationProbabilityMax:20,windSpeedMax:18},elapsedMs:50,sources:[source()]};}};
 const result=await orchestrateSearch({async search(){searches++;}},'南京天气怎么样',{weatherTool,now});assert.equal(searches,0);assert.equal(result.tool,'weather');assert.equal(result.status,'weather-data');assert.match(result.synthesis,/当前温度 26℃/);assert.match(result.synthesis,/最高 28℃/);assert.equal(result.quality.sufficient,true);
});
test('天气缺地点只追问，指定网址未读取时明确能力限制',async()=>{
 let queries=0;const weatherTool={enabled:true,async query(intent){queries++;assert.equal(intent.location,'');return {status:'needs-location',question:'请告诉我需要查询哪个城市或地区的天气。'};}};
 const missing=await orchestrateSearch({},'今天天气怎么样',{weatherTool,now});assert.equal(queries,1);assert.equal(missing.status,'needs-input');assert.match(missing.needsClarification,/哪个城市/);
 const webpage=await orchestrateSearch({},'总结 https://example.com',{weatherTool,now});assert.equal(webpage.status,'unsupported-url-read');assert.equal(webpage.capabilities.webpageRead,false);assert.equal(webpage.performed,false);
});
test('结构化天气不可用时搜索后备最多补充一次并合并用量',async()=>{
 const calls=[],weatherTool={enabled:true,async query(){throw Error('weather down');}},provider={async search(query){calls.push(query);return calls.length===1?{performed:true,requested:true,sources:[source()],synthesis:'2025年9月19日旧天气，阴，28℃',elapsedMs:100,usage:{webSearchRequests:1}}:{performed:true,requested:true,sources:[source(),source('https://nmc.example/nanjing')],synthesis:'2026年9月19日南京阴，最高28℃，最低22℃',elapsedMs:200,usage:{webSearchRequests:2}};}};
 const result=await orchestrateSearch(provider,'南京天气怎么样',{weatherTool,now});assert.equal(result.tool,'web-search-fallback');assert.equal(calls.length,2);assert.match(calls[1],/2026-09-19/);assert.equal(result.quality.sufficient,true);assert.equal(result.usage.webSearchRequests,3);assert.equal(result.elapsedMs>=300,true);assert.equal(result.toolTrace[0].tool,'get_weather');
});
test('一般知识即使开启联网模式也直接回答，未执行搜索',async()=>{let calls=0;const result=await orchestrateSearch({async search(){calls++;}},'解释蓝牙和Wi-Fi的区别',{now});assert.equal(calls,0);assert.equal(result.status,'not-needed');assert.equal(result.quality.sufficient,true);});
test('明确查询表达会进入联网路由，普通解释仍保持本地回答',()=>{
 for(const query of ['帮我查一下理想i9','请查一下苏州博物馆开放时间','帮我查找星海X7','了解一下星海X7'])assert.equal(classifyQuestionIntent(query).tool,'web-search',query);
 assert.equal(classifyQuestionIntent('帮我查一下理想i9的详细参数').subject,'理想i9');
 for(const query of ['解释蓝牙和Wi-Fi的区别','什么是光合作用','帮我检查一下这段话的语法'])assert.equal(classifyQuestionIntent(query).tool,'none',query);
});

test('口语搜索指令不进入产品名称，真实搜索摘要可确认原型号',()=>{
 const question='帮我上网搜一下理想 I9的详细参数。';
 assert.equal(classifyQuestionIntent(question).subject,'理想I9');
 const quality=evaluateSearchEvidence(question,{performed:true,sources:[{title:'理想 i9',url:'https://www.lixiang.com/i9',snippet:'理想 i9 纯电SUV，800V高压架构，续航及电池配置见产品页，2026年发布。'}],synthesis:'理想 i9 于2026年发布，产品页列出电池、续航和充电配置。'},{now});
 assert.equal(quality.subjectConfirmed,true);
 assert.equal(quality.officialSourceCount,1);
});
test('泛称产品保留对象而不把搜索动词或最新修饰语并入名称',()=>{
 const question='帮我搜一下最新的苹果手机的参数和价格。';
 assert.equal(classifyQuestionIntent(question).subject,'苹果手机');
 const quality=evaluateSearchEvidence(question,{performed:true,sources:[{title:'iPhone - Apple',url:'https://www.apple.com/iphone/',snippet:'Explore the latest iPhone lineup, current prices, models, and technical specifications. Updated September 2026.'}],synthesis:'Apple iPhone 官方页面列出 2026 年机型与价格。'},{now});
 assert.equal(quality.subjectConfirmed,true);
 assert.equal(quality.officialSourceCount,1);
});
test('跨句与口语产品问法拆分品牌、类别、型号、最新意图和需求',()=>{
 const oneplus=classifyQuestionIntent('一加手机呢？最新款的型号是什么？并且告诉我它的具体参数。');
 assert.equal(oneplus.intent,'product-research');assert.equal(oneplus.brand,'一加');assert.equal(oneplus.category,'手机');assert.equal(oneplus.subject,'一加手机');assert.equal(oneplus.latest,true);assert.equal(oneplus.explicitModel,'');assert.ok(oneplus.requestedAspects.includes('参数'));
 const car=classifyQuestionIntent('小米汽车最新款是哪一型号？然后帮我查一下它的所有的相关性性能，还有以及参数。');
 assert.equal(car.intent,'product-research');assert.equal(car.brand,'小米');assert.equal(car.category,'汽车');assert.equal(car.subject,'小米汽车');assert.equal(car.latest,true);assert.equal(car.explicitModel,'');assert.ok(car.requestedAspects.includes('参数'));
 const powerbank=classifyQuestionIntent('酷泰科15 Ultra 这个充电宝效果怎么样？帮我查一下它的相关配置呢？');
 assert.equal(powerbank.intent,'product-research');assert.equal(powerbank.brand,'酷泰科');assert.equal(powerbank.category,'充电宝');assert.equal(powerbank.subject,'酷泰科15 Ultra');assert.equal(powerbank.explicitModel,'15 Ultra');assert.ok(powerbank.requestedAspects.includes('评价'));assert.ok(powerbank.requestedAspects.includes('配置'));
 assert.equal(classifyQuestionIntent('解释蓝牙和Wi-Fi的区别').tool,'none');
});
test('明确型号保留数字和区分后缀，不能把相似型号合并',()=>{
 const expected=[['查看Xiaomi 15 Ultra手机参数','Xiaomi','15 Ultra','Xiaomi 15 Ultra'],['查看Xiaomi 15手机参数','Xiaomi','15','Xiaomi 15'],['查看CUKTECH 30 Ultra充电宝参数','CUKTECH','30 Ultra','CUKTECH 30 Ultra']];
 for(const [question,brand,model,subject] of expected){const parsed=classifyQuestionIntent(question);assert.equal(parsed.intent,'product-research',question);assert.equal(parsed.brand,brand,question);assert.equal(parsed.explicitModel,model,question);assert.equal(parsed.subject,subject,question);}
});
test('Pro Max、多品牌同数字与显式查询都按完整对象检查',()=>{
 const query='帮我查一下 Xiaomi 15 Pro Max 手机的参数';const parsed=classifyQuestionIntent(query);
 assert.equal(parsed.brand,'Xiaomi');assert.equal(parsed.category,'手机');assert.equal(parsed.explicitModel,'15 Pro Max');
 const source=(title,snippet)=>({title,url:'https://www.mi.com/product/test',snippet});
 const correct=evaluateSearchEvidence(query,{performed:true,sources:[source('Xiaomi 15 Pro Max smartphone','Xiaomi 15 Pro Max smartphone 屏幕和芯片参数。')]});assert.equal(correct.subjectConfirmed,true);
 const wrongSuffix=evaluateSearchEvidence(query,{performed:true,sources:[source('Xiaomi 15 Pro smartphone','Xiaomi 15 Pro smartphone 屏幕和芯片参数。')]});assert.equal(wrongSuffix.subjectConfirmed,false);
 const wrongBrand=evaluateSearchEvidence(query,{performed:true,sources:[{...source('Redmi 15 Pro Max smartphone','Redmi 15 Pro Max smartphone 参数。'),url:'https://www.mi.com/redmi'}]});assert.equal(wrongBrand.subjectConfirmed,false);
 const wrongCategory=evaluateSearchEvidence(query,{performed:true,sources:[source('Xiaomi 15 Pro Max tablet','Xiaomi 15 Pro Max tablet 参数。')]});assert.equal(wrongCategory.subjectConfirmed,false);
 const bare=classifyQuestionIntent('麻烦了解一下理想i9');assert.equal(bare.intent,'product-research');assert.equal(bare.brand,'理想');assert.equal(bare.explicitModel,'i9');
 const capacity=classifyQuestionIntent('看看酷泰科充电宝2025mAh容量和价格');assert.equal(capacity.requestedYear,undefined);
});
test('近期真实问法：最新手机按品牌产品检索，官网英文名称可确认对象',()=>{
 const cases=[
  {question:'苹果最新款的手机是哪一款？',subject:'苹果手机',url:'https://www.apple.com.cn/iphone/',title:'iPhone - Apple (中国大陆)',snippet:'探索 iPhone 18 Pro、iPhone Air 和 iPhone 17，查看当前在售 iPhone 机型。'},
  {question:'小米最新款的手机是什么？',subject:'小米手机',url:'https://www.mi.com/prod/xiaomi-17',title:'Xiaomi 17',snippet:'Xiaomi 17 搭载第五代骁龙 8 至尊版移动平台，7000mAh 电池；查看 Xiaomi 小米手机产品资料。'},
  {question:'我需要获取小米最新款手机的资料。',subject:'小米手机',url:'https://www.mi.com/prod/xiaomi-17',title:'Xiaomi 17',snippet:'Xiaomi 17 搭载第五代骁龙 8 至尊版移动平台，7000mAh 电池；查看 Xiaomi 小米手机产品资料。'}
 ];
 for(const item of cases){const intent=classifyQuestionIntent(item.question);assert.equal(intent.intent,'product-research',item.question);assert.equal(intent.subject,item.subject,item.question);const quality=evaluateSearchEvidence(item.question,{performed:true,sources:[{url:item.url,title:item.title,snippet:item.snippet}]},{now:new Date('2026-09-29T04:00:00Z')});assert.equal(quality.subjectConfirmed,true,item.question);assert.equal(quality.officialSourceCount,1,item.question);}
});
test('详细参数不能用媒体字段补足只有价格的官网摘要',()=>{
 const quality=evaluateSearchEvidence('帮我查一下理想i9详细参数',{performed:true,sources:[{title:'理想汽车官网',url:'https://www.lixiang.com/L9',snippet:'全新理想i9 36.98万元。具体配置请查看车型页面。'},{title:'媒体参数表',url:'https://cars.example/i9',snippet:'理想i9车长5225毫米，电池101千瓦时，续航705公里，双电机四驱。'}],synthesis:'媒体称理想i9尺寸、电池和续航均已公布。'},{now,requireOfficialFacetCoverage:true});
 assert.equal(quality.officialSourceCount,1);assert.equal(quality.officialCoverage,1);assert.equal(quality.sufficient,false);
});

test('无关长摘要不能仅凭长度被判为资料充分',()=>{
 const irrelevant='这是一篇很长的天文学科普文章，主要介绍星系、恒星形成、望远镜观测方法和宇宙演化历史。'.repeat(8);
 const quality=evaluateSearchEvidence('帮我查一下星海X7的续航和价格',{performed:true,sources:[{title:'天文学入门',url:'https://example.com/astronomy',snippet:irrelevant}],synthesis:irrelevant},{now});
 assert.equal(quality.sufficient,false);assert.match(quality.reason,/相关|对象|问题/);
});
test('最新款必须由厂商的最新/当前产品线证据支持，不能只凭型号页或年份',()=>{
 const question='一加手机呢？最新款的型号是什么？并且告诉我它的具体参数。';
 const onlyProduct=evaluateSearchEvidence(question,{performed:true,sources:[{title:'OnePlus 15 Specs',url:'https://www.oneplus.com/cn/15/specs',snippet:'OnePlus 15 smartphone采用新一代处理器，屏幕、相机、电池参数如下。'}]},{now});assert.equal(onlyProduct.subjectConfirmed,true);assert.equal(onlyProduct.latestConfirmed,false);assert.equal(onlyProduct.sufficient,false);assert.match(onlyProduct.reason,/没有可靠证据证明/);
 const latest=evaluateSearchEvidence(question,{performed:true,sources:[{title:'OnePlus 当前产品线',url:'https://www.oneplus.com/cn/phones',snippet:'OnePlus current lineup: OnePlus 15, released in September 2026; 6000mAh battery, 100W charging, 200MP camera. 本页说明当前手机产品线。'}]},{now});assert.equal(latest.latestConfirmed,true);assert.equal(latest.sufficient,true);
});
test('按产品类别与用户所问字段判断资料，误相关综合摘要不能补足缺失价格',()=>{
 const query='帮我查一下星海X7汽车的续航和价格';
 const quality=evaluateSearchEvidence(query,{performed:true,sources:[{title:'星海X7汽车',url:'https://cars.example/x7',snippet:'星海X7汽车的CLTC续航为610公里。'}],synthesis:'另一个型号Y9汽车售价18万元。'},{now});
 assert.equal(quality.subjectConfirmed,true);assert.deepEqual(quality.facets.requestedMissing,['价格']);assert.equal(quality.sufficient,false);assert.match(quality.reason,/价格/);
});
test('跨来源共同证据可提示疑似转录错词，但不改变原始品牌与型号',()=>{
 const question='酷泰科15 Ultra 这个充电宝效果怎么样？帮我查一下它的相关配置呢？';const intent=classifyQuestionIntent(question);
 const quality=evaluateSearchEvidence(question,{performed:true,sources:[{title:'CUKTECH 15 Ultra',url:'https://cuktech.com.cn/product/15-ultra',snippet:'CUKTECH 15 Ultra 充电宝，20000mAh，最高210W，多接口。'},{title:'酷态科15号超级电能柱Ultra评测',url:'https://review.example/powerbank',snippet:'酷态科15号超级电能柱Ultra充电宝，20000mAh、210W、多接口；评测实测体验良好。'},{title:'酷态科15 Ultra体验',url:'https://media.example/powerbank-15',snippet:'酷态科15号超级电能柱Ultra充电宝，20000mAh容量、210W总功率，多接口实测评测。'}]},{now});
 assert.equal(intent.originalQuestion,question);assert.equal(intent.brand,'酷泰科');assert.equal(intent.explicitModel,'15 Ultra');assert.equal(quality.subjectConfirmed,true);assert.equal(quality.sufficient,true);assert.ok(quality.facets.missing.includes('重量'));assert.ok(quality.facets.missing.includes('价格'));assert.equal(quality.suspectedCorrections[0].candidateBrand,'酷态科');assert.equal(quality.suspectedCorrections[0].confidence,'high');assert.equal(quality.suspectedCorrections[0].sourceIds.length,2);assert.equal(new Set(quality.suspectedCorrections[0].sourceIds).size,2);
 const oneSource=evaluateSearchEvidence(question,{performed:true,sources:[{title:'酷态科15 Ultra体验',url:'https://media.example/one',snippet:'酷态科15号超级电能柱Ultra充电宝，20000mAh。'}]},{now});assert.deepEqual(oneSource.suspectedCorrections,[]);
});
test('新产品先按原始型号搜索并以官方公告确认对象，不静默替换相似型号',async()=>{
 const calls=[],provider={model:'test-model',searchEndpoint:'https://search.example/messages',async search(query){calls.push(query);return {performed:true,requested:true,responseModel:'test-response-model',sources:[{title:'Li Auto Inc. Launches Li i9',url:'https://ir.lixiang.com/news-releases/li-i9',snippet:'Li Auto officially launched Li i9 on September 16, 2026. Six-seat battery electric SUV, priced at RMB369,800.'},{title:'旧文章称没有该车型',url:'https://old.example/i9',snippet:'2024年资料只介绍理想L9。'}],synthesis:'理想汽车于2026年9月16日正式发布Li i9，六座纯电SUV，标准配置售价人民币369,800元。',elapsedMs:20,usage:{webSearchRequests:1}};}};
 const result=await orchestrateSearch(provider,'理想i9的汽车详细参数',{now});assert.equal(calls[0],'理想i9的汽车详细参数');assert.equal(calls.length,1);assert.equal(result.quality.subject,'理想i9');assert.equal(result.quality.subjectConfirmed,true);assert.equal(result.quality.sufficient,true);assert.equal(result.sources[0].url.includes('ir.lixiang.com'),true);assert.deepEqual(result.diagnostics.queries,calls);assert.equal(result.diagnostics.requestModel,'test-model');assert.deepEqual(result.diagnostics.responseModels,['test-response-model']);
});
test('相似型号、部分参数、未上市与搜索失败都不能证明或替换原始产品',async()=>{
 const l9={performed:true,requested:true,sources:[{title:'理想L9参数',url:'https://example.com/l9',snippet:'2024款理想L9尺寸和续航参数'}],synthesis:'理想L9是一款大型SUV。'};
 const wrong=evaluateSearchEvidence('理想i9的汽车详细参数',l9,{now});assert.equal(wrong.subjectConfirmed,false);assert.equal(wrong.sufficient,false);assert.match(wrong.reason,/不能替换/);
 const partial=evaluateSearchEvidence('理想i9的汽车详细参数',{performed:true,sources:[{title:'Li Auto i9 electric SUV announcement',url:'https://example.com/i9'}],synthesis:'Li Auto i9是一款纯电SUV，将发布。'},{now});assert.equal(partial.subjectConfirmed,true);assert.equal(partial.sufficient,false);assert.match(partial.reason,/少量参数/);
 const mediaOnly=evaluateSearchEvidence('理想i9的汽车详细参数',{performed:true,sources:[{title:'Li Auto i9 electric SUV 完整参数',url:'https://media.example/i9'}],synthesis:'Li Auto i9纯电SUV于2026年发布，售价36.98万元，尺寸5225毫米，电池101kWh，续航705公里。'},{now});assert.equal(mediaOnly.subjectConfirmed,true);assert.equal(mediaOnly.coverage>=2,true);assert.equal(mediaOnly.sufficient,false);assert.match(mediaOnly.reason,/尚未取得厂商/);
 const officialTitleOnly=evaluateSearchEvidence('理想i9的汽车详细参数',{performed:true,sources:[{title:'Li Auto Inc. Launches Li Auto i9 electric SUV',url:'https://ir.lixiang.com/news-releases/i9'}],synthesis:'媒体资料称Li Auto i9纯电SUV已发布，价格与续航已经公布。'},{now});assert.equal(officialTitleOnly.officialSourceCount,1);assert.equal(officialTitleOnly.officialReadableCount,0);assert.equal(officialTitleOnly.sufficient,false);assert.match(officialTitleOnly.reason,/尚未读取到/);
 const unrelatedOfficial=evaluateSearchEvidence('理想i9的汽车详细参数',{performed:true,sources:[{title:'理想i9纯电SUV媒体参数',url:'https://media.example/i9',snippet:'理想i9纯电SUV于2026年发布，售价36.98万元，尺寸5225毫米，续航705公里。'},{title:'投资者常见问题',url:'https://ir.lixiang.com/faq',snippet:'这是很长的投资者关系导航、股票信息、公司治理和财务报告页面。'.repeat(8)}],synthesis:'理想i9已发布。'},{now});assert.equal(unrelatedOfficial.officialSourceCount,0);assert.equal(unrelatedOfficial.sufficient,false);assert.match(unrelatedOfficial.reason,/尚未取得厂商/);
 const absent=evaluateSearchEvidence('某品牌Z99汽车是否上市',{performed:true,sources:[],synthesis:''},{now});assert.equal(absent.sufficient,false);assert.doesNotMatch(absent.reason,/不存在/);
 const failed=evaluateSearchEvidence('理想i9的汽车详细参数',{performed:false,sources:[]},{now});assert.equal(failed.sufficient,false);assert.match(failed.reason,/没有返回执行结果/);
});
test('指定年款不能混入其他年份，来源冲突必须进入证据质量结果',()=>{
 const mismatch=evaluateSearchEvidence('2024款理想L9详细参数',{performed:true,sources:[{title:'2026款理想L9官方发布',url:'https://ir.example.com/l9',snippet:'2026款理想L9于2026年发布，售价与续航已公布。'}],synthesis:'2026款理想L9参数。'},{now});assert.equal(mismatch.yearMatched,false);assert.equal(mismatch.sufficient,false);assert.match(mismatch.reason,/不能混用2026年参数/);
 const conflicted=evaluateSearchEvidence('2026款理想L9详细参数',{performed:true,sources:[{title:'2026款理想L9官方发布',url:'https://ir.example.com/l9',snippet:'2026款理想L9于2026年正式发布，官方公告明确列出了销售价格、版本信息与续航参数。'}],synthesis:'2026款理想L9参数存在数据冲突，不同来源续航口径不同。'},{now});assert.equal(conflicted.subject,'理想L9');assert.equal(conflicted.yearMatched,true);assert.equal(conflicted.hasConflicts,true);assert.equal(conflicted.sufficient,true);
});
test('详细产品首轮只有媒体时从证据提取英文品牌别名，再限定补查官方来源',async()=>{
 const calls=[],provider={model:'configured',searchEndpoint:'https://search.example',async search(query){calls.push(query);if(calls.length===1)return {performed:true,requested:true,sources:[{title:'理想i9媒体参数',url:'https://media.example/i9'}],synthesis:'理想i9（Li Auto i9）于2026年发布，售价36.98万元，尺寸5225毫米，续航705公里。'};return {performed:true,requested:true,sources:[{title:'Li Auto Inc. Launches Li i9',url:'https://ir.lixiang.com/news-releases/li-i9',snippet:'Li Auto officially launched Li i9 on September 16, 2026. Six-seat battery electric SUV, RMB369,800.'}],synthesis:'Li Auto官方公告确认Li i9，六座纯电SUV，标准配置售价RMB369,800。'};}};
 const result=await orchestrateSearch(provider,'理想i9的汽车详细参数',{now,maxFollowups:1});assert.equal(calls.length,2);assert.match(calls[1],/Li Auto i9/);assert.equal(result.quality.officialSourceCount,1);assert.equal(result.quality.sufficient,true);assert.equal(result.sources[0].url.includes('ir.lixiang.com'),true);
});
test('首轮没有英文品牌名时先核实官方英文名，再用原型号补查官方公告',async()=>{
 const calls=[],provider={async search(query){calls.push(query);if(calls.length===1)return {performed:true,requested:true,sources:[{title:'理想i9媒体参数',url:'https://media.example/i9'}],synthesis:'理想i9在2026年发布，售价36.98万元，尺寸5225毫米。'};if(calls.length===2)return {performed:true,requested:true,sources:[{title:'品牌英文名资料',url:'https://media.example/brand'}],synthesis:'理想汽车的官方英文公司名为Li Auto；其产品英文名为Li Auto i9。'};return {performed:true,requested:true,sources:[{title:'Li Auto Inc. Launches Li i9',url:'https://ir.lixiang.com/news-releases/i9',snippet:'Li Auto officially launched Li i9 on September 16, 2026. Six-seat battery electric SUV, RMB369,800.'}],synthesis:'Li Auto官方IR公告确认Li i9。'};}};
  const result=await orchestrateSearch(provider,'理想i9的汽车详细参数',{now,maxFollowups:2});assert.equal(calls.length,3);assert.match(calls[1],/官方规格资料/);assert.match(calls[2],/Li Auto i9/);assert.doesNotMatch(calls[2],/another model|other product/i);assert.equal(result.quality.officialSourceCount,1);assert.equal(result.quality.sufficient,true);
});
test('从英文证据提取品牌别名时不把冠词带入补查对象',async()=>{
 const calls=[],provider={async search(query){calls.push(query);if(calls.length===1)return {performed:true,requested:true,sources:[{title:'理想i9媒体参数',url:'https://media.example/i9'}],synthesis:'The Li Auto i9 was launched in 2026，售价36.98万元，尺寸5225毫米，续航705公里。'};return {performed:true,requested:true,sources:[{title:'Li Auto Inc. Launches Li i9',url:'https://ir.lixiang.com/news-releases/i9',snippet:'Li Auto officially launched Li i9 in 2026 with price and range details.'}],synthesis:'Li Auto官方公告确认Li i9。'};}};
 await orchestrateSearch(provider,'帮我查一下理想i9的详细参数',{now,maxFollowups:1});assert.match(calls[1],/Li Auto i9/);assert.doesNotMatch(calls[1],/the Li Auto i9/i);
});
