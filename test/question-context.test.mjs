import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveQuestionContext,validateLocationCoordinates} from '../src/agent/question-context.mjs';

const turn=(question,answer='已回答')=>[{role:'user',content:question},{role:'assistant',content:answer}];
test('天气追问继承最近明确地点，不改写用户原话',()=>{
 const result=resolveQuestionContext('那明天呢？',turn('苏州张家港市天气怎么样？'));
 assert.equal(result.original,'那明天呢？');assert.equal(result.intent,'weather');
 assert.match(result.query,/苏州张家港市/);assert.match(result.query,/明天/);
});
test('换话题后不借用更早天气地点，缺地点应澄清',()=>{
 const history=[...turn('南京天气怎么样？'),...turn('解释一下蓝牙协议')];
 const result=resolveQuestionContext('那明天呢？',history);
 assert.equal(result.intent,'weather');assert.equal(result.query.includes('南京'),false);
});
test('明确新地点优先于旧上下文，普通问题不强制联网',()=>{
 assert.equal(resolveQuestionContext('苏州天气怎么样？',turn('南京天气怎么样？')).query,'苏州天气怎么样？');
 assert.equal(resolveQuestionContext('解释一下蓝牙协议',turn('南京天气怎么样？')).intent,'general');
});
test('产品指代续问保留上轮原对象，不猜测新型号',()=>{
 const result=resolveQuestionContext('它的续航呢？',turn('帮我查一下理想i9的参数'));
 assert.equal(result.original,'它的续航呢？');assert.match(result.query,/理想\s*i9/);assert.match(result.query,/续航/);
 assert.equal(resolveQuestionContext('它的续航呢？',turn('南京天气怎么样？')).contextUsed,false);
});
test('天气追问带出明确地点时仍保持干净地点',()=>{
 const result=resolveQuestionContext('那后天呢？后天张家港天气会怎么样？',turn('最近张家港天气如何？'));
 assert.equal(result.intent,'weather');assert.equal(result.location,'张家港');assert.match(result.query,/张家港/);
});

test('口语车型表达生成统一结构化请求并保留原话',()=>{
 const original='小米最新的车子发售的车是什么车？';
 const result=resolveQuestionContext(original,[]);
 assert.equal(result.request.originalText,original);
 assert.equal(result.request.resolvedQuestion,original);
 assert.equal(result.request.category,'汽车');
 assert.equal(result.request.brand,'小米');
 assert.equal(result.request.timeScope,'latest');
 assert.equal(result.request.provenance.brand,'user');
 assert.deepEqual(result.request.ambiguities,[]);
});

test('跨句手机问题识别品牌与类别，不把句首连接词并入品牌',()=>{
 const original='根据小米最新发布的手机报道，我要这个新的手机的型号。';
 const result=resolveQuestionContext(original,[]);
 assert.equal(result.request.brand,'小米');
 assert.equal(result.request.category,'手机');
 assert.equal(result.request.timeScope,'latest');
 assert.equal(result.request.provenance.brand,'user');
 assert.doesNotMatch(result.request.brand,/根据|最新发布/);
});

test('ASR型号有尾随噪声时标为候选和歧义，不把18当确认型号',()=>{
 const original='帮我查一下小米18放的这个用型号的价格以及所有的相关配置。';
 const result=resolveQuestionContext(original,[]);
 assert.equal(result.request.brand,'小米');
 assert.equal(result.request.explicitModel,'');
 assert.ok(result.request.entityCandidates.some(item=>item.model==='18'&&item.confirmed===false));
 assert.ok(result.request.ambiguities.length>0);
 assert.ok(result.request.requestedFields.includes('价格'));
});

test('产品追问继承会话中确认的对象，不把整句历史拼进新查询；切换对象后更新',()=>{
 const history=[
  {role:'user',content:'帮我查理想i9汽车参数'},
  {role:'assistant',content:'我查到官方公告提到理想i9。'},
  {role:'user',content:'它的续航呢？'},
  {role:'assistant',content:'尚未查到续航参数。'}
 ];
 const followup=resolveQuestionContext('它多少钱？',history);
 assert.equal(followup.request.category,'汽车');
 assert.equal(followup.request.explicitModel,'i9');
 assert.match(followup.request.resolvedQuestion,/理想\s*i9/);
 assert.doesNotMatch(followup.request.resolvedQuestion,/帮我查|它的续航/);
 const switched=resolveQuestionContext('比亚迪汽车的价格呢？',history);
 assert.equal(switched.request.brand,'比亚迪');
 assert.equal(switched.request.provenance.brand,'user');
});

test('产品连续追问只带安全的短来源线索，旧回答本身不作为证据',()=>{
 const history=[{role:'user',content:'帮我查理想i9汽车参数'},{role:'assistant',content:'上一条模型声称续航900公里。'}];
 const result=resolveQuestionContext('它的续航呢？',history,{contextEvidence:[{sourceId:'source-123456789abc',title:'理想i9公告',url:'https://ir.lixiang.com/i9?token=secret',snippet:'官方公告提到理想i9汽车。'.repeat(30),evidenceState:'read',publishedAt:'2026-09-16'}]});
 assert.equal(result.request.contextEvidence[0].source,'user-history');
 const prior=result.request.contextEvidence.find(item=>item.provenance==='prior-tool-result');assert.ok(prior);assert.equal(prior.sourceId,'source-123456789abc');assert.doesNotMatch(prior.url,/token|secret/);assert.ok(prior.snippet.length<=360);assert.equal(prior.publishedAt,'2026-09-16');
 assert.doesNotMatch(JSON.stringify(result.request.contextEvidence),/900公里/);
});

test('品牌替换继承上轮查询任务和字段，但不继承旧品牌型号或事实',()=>{
 const history=[{role:'user',content:'最新的 vivo 手机是哪一款？型号、价格和详细配置是什么？'},{role:'assistant',content:'旧回答中的型号和价格未核实。'}];
 const result=resolveQuestionContext('OPPO 手机呢？',history);
 assert.equal(result.intent,'product-research');assert.equal(result.request.brand,'OPPO');assert.equal(result.request.category,'手机');
 assert.deepEqual(result.request.requestedFields,['价格']);assert.ok(result.request.requestedAspects.includes('配置'));assert.ok(result.request.requestedAspects.includes('最新型号/发布时间'));assert.equal(result.request.timeScope,'latest');
 assert.match(result.request.resolvedQuestion,/OPPO/);assert.doesNotMatch(result.request.resolvedQuestion,/vivo|X\d{2,}/i);
 assert.equal(result.request.provenance.brand,'user');assert.equal(result.request.provenance.requestedFields,'context');
});

test('日期从张家港天气地点中分离并保留具体目标日',()=>{
 const result=resolveQuestionContext('张家港市10月3号的天气怎么样？',[],{now:new Date('2026-09-30T02:00:00Z')});
 assert.equal(result.location,'张家港市');assert.equal(result.request.weather.targetDate,'2026-10-03');assert.equal(result.request.weather.period,'specific-date');
});

test('口语一周天气加指定日期保留地点、周范围和目标日期',()=>{
 const result=resolveQuestionContext('帮我查询一下张家港，张家港这周的天气，并且帮我显示一下10月3号的天气是什么样的。',[],{now:new Date('2026-09-30T02:00:00Z')});
 assert.equal(result.location,'张家港');assert.equal(result.request.weather.period,'next-seven-days');assert.equal(result.request.weather.targetDate,'2026-10-03');
 assert.equal(result.request.provenance.region,'unknown');assert.equal(result.request.originalText.startsWith('帮我查询'),true);
});

test('天气会话中的新城市名替换地点并继续强制走天气工具',()=>{
 const history=[...turn('最近张家港的天气如何？'),...turn('张家港今天的天气怎么样？')];
 const result=resolveQuestionContext('南京呢？',history);
 assert.equal(result.intent,'weather');assert.equal(result.location,'南京');assert.equal(result.request.weather.period,'current-today');
 assert.match(result.request.resolvedQuestion,/南京/);assert.doesNotMatch(result.request.resolvedQuestion,/张家港/);
 const tomorrow=resolveQuestionContext('明天呢？',[...history,{role:'user',content:'南京呢？'}]);assert.equal(tomorrow.request.location,'南京');assert.equal(tomorrow.request.weather.period,'tomorrow');
});

test('天气追问可用独立城市词切换地点，后续日期沿用新城市但普通聊天不联网',()=>{
 let history=[{role:'user',content:'张家港天气怎么样？'}];
 const nanjing=resolveQuestionContext('南京呢？',history);history.push({role:'user',content:'南京呢？'});
 const hangzhou=resolveQuestionContext('杭州',history);assert.equal(hangzhou.intent,'weather');assert.equal(hangzhou.request.location,'杭州');assert.equal(hangzhou.request.action,'replace-location');history.push({role:'user',content:'杭州'});
 const tomorrow=resolveQuestionContext('明天呢？',history);assert.equal(tomorrow.request.location,'杭州');assert.equal(tomorrow.request.weather.period,'tomorrow');
 assert.equal(nanjing.request.location,'南京');assert.equal(resolveQuestionContext('杭州',[]).intent,'general');
});

test('当前明确的新产品对象优先于那字开头的旧话题，不继承旧设备配置',()=>{
 const history=[
  {role:'user',content:'我最近买了一个 MacBook Pro 2021款，16英寸，M1 Pro，32GB内存加512GB存储，买入价6700元。帮我查闲鱼近期成交价格。'},
  {role:'assistant',content:'旧回答内容不作为事实。'},
  {role:'user',content:'主要看闲鱼近期成交价格。'},
  {role:'assistant',content:'旧回答内容不作为事实。'}
 ];
 const result=resolveQuestionContext('那你帮我查一下苹果13 Pro Max在闲鱼的近期成交价格。',history);
 assert.equal(result.request.brand,'苹果');assert.match(result.request.explicitModel,/13\s*Pro\s*Max/i);
 assert.equal(result.request.category,'手机');assert.equal(result.request.action,'replace-object');
 assert.equal(result.request.queryConstraints.marketplace,'闲鱼');assert.equal(result.request.queryConstraints.priceType,'transaction');
 assert.equal(result.request.attributes.year,undefined);assert.equal(result.request.attributes.chip,undefined);assert.equal(result.request.attributes.memoryGB,undefined);assert.equal(result.request.attributes.storageGB,undefined);
});

test('MacBook多轮补充按字段来源合并配置，但不采信助手旧回答',()=>{
 const history=[
  {role:'user',content:'我最近买了一个 MacBook Pro 2021款，16英寸，M1 Pro芯片，32GB内存加512GB存储，买入价6700元。'},
  {role:'assistant',content:'模型旧回答声称它是2023款M2 Max，不可作为事实。'},
  {role:'user',content:'我说的是2021款16寸，芯片是M1 Pro。'},
  {role:'assistant',content:'已收到补充。'}
 ];
 const result=resolveQuestionContext('按这个配置帮我查闲鱼近期成交价。',history);
 assert.equal(result.request.attributes.year.value,'2021');assert.equal(result.request.attributes.screenSize.value,'16英寸');
 assert.equal(result.request.attributes.chip.value,'M1 Pro');assert.equal(result.request.attributes.memoryGB.value,'32');assert.equal(result.request.attributes.storageGB.value,'512');
 assert.equal(result.request.userFacts.purchasePrice.value,'6700');assert.equal(result.request.queryConstraints.priceType,'transaction');
 assert.equal(result.request.attributes.year.provenance.source,'user-history');assert.doesNotMatch(JSON.stringify(result.request.attributes),/2023款M2 Max/);
});

test('MacBook配置字段保留逐轮来源，闲鱼成交价续问继承查询任务但排除助手旧答案',()=>{
 const history=[
  {role:'user',content:'我最近买了一个 MacBook Pro 2021款，买入价6700元。帮我查价格和配置。'},
  {role:'assistant',content:'它的配置应该是16GB，不作为用户事实。'},
  {role:'user',content:'补充一下，是16英寸、M1 Pro、32GB内存、512GB存储。'},
  {role:'assistant',content:'旧回答提到的二手价格未核实。'}
 ];
 const result=resolveQuestionContext('那闲鱼近期成交价呢？',history);
 assert.equal(result.request.action,'follow-up');
 assert.equal(result.request.attributes.year.value,'2021');
 assert.equal(result.request.attributes.screenSize.value,'16英寸');
 assert.equal(result.request.attributes.chip.value,'M1 Pro');
 assert.equal(result.request.attributes.memoryGB.value,'32');
 assert.equal(result.request.attributes.storageGB.value,'512');
 assert.equal(result.request.attributes.purchasePrice.value,'6700');
 assert.equal(result.request.queryConstraints.marketplace,'闲鱼');
 assert.equal(result.request.queryConstraints.priceType,'transaction');
 assert.equal(result.request.attributes.memoryGB.provenance.turnIndex,2);
 assert.doesNotMatch(JSON.stringify(result.request.attributes),/16GB/);
});

test('询问自己的偏好走私有记忆意图，不作为公开网页搜索',()=>{
 const result=resolveQuestionContext('你记得我平时喜欢吃什么水果吗？',[]);
 assert.equal(result.intent,'personal-memory');assert.equal(result.request.intent,'personal-memory');
 assert.equal(result.request.queryConstraints.publicSearch,false);
});

test('同一轮的喜欢与偶尔行为拆成不同会话事实，问题仍保留为当前任务',()=>{
 const original='我喜欢吃的水果是香蕉，偶尔也会吃苹果；苹果有什么好处？';const result=resolveQuestionContext(original,[]);
 assert.equal(result.request.intent,'general');assert.equal(result.request.sessionFacts.find(item=>item.object==='香蕉').predicate,'likes-eating');
 const apple=result.request.sessionFacts.find(item=>item.object==='苹果');assert.equal(apple.predicate,'eats');assert.equal(apple.frequency,'occasional');
 assert.equal(result.request.sessionFacts.some(item=>item.object==='苹果'&&item.predicate==='likes-eating'),false);
});

test('天气请求中途改口只执行最终范围并保留撤销依据',()=>{
 const same=resolveQuestionContext('南京未来一个月，不对，未来一一一周。',[],{now:new Date('2026-09-30T12:00:00Z')});
 assert.equal(same.request.weather.location,'南京');assert.equal(same.request.weather.period,'next-seven-days');assert.equal(same.request.corrections?.[0]?.retracted,'未来一个月');
 const across=resolveQuestionContext('哦不对，未来一周。',[{role:'user',content:'南京未来一个月天气怎么样？'}],{now:new Date('2026-09-30T12:00:00Z')});
 assert.equal(across.request.weather.location,'南京');assert.equal(across.request.weather.period,'next-seven-days');assert.equal(across.request.action,'correction');
});

test('天气缺地点后用户只回答“南京的”会补地点并沿用原请求范围',()=>{
 const history=[{role:'user',content:'帮我查未来一周天气怎么样？'}];
 const result=resolveQuestionContext('南京的',history,{now:new Date('2026-09-30T12:00:00Z')});
 assert.equal(result.request.intent,'weather');assert.equal(result.request.weather.location,'南京');assert.equal(result.request.weather.period,'next-seven-days');
});

test('公司新闻请求对象不包含新闻查询口语',()=>{
 for(const [text,company] of [['帮我搜一下小米汽车最近的新闻热点。','小米汽车'],['谷歌最近有什么新闻吗？谷歌公司。','谷歌'],['OpenAI最近有什么新闻吗？','OpenAI'],['国内新闻热点，比如百度公司。','百度']]){
  const result=resolveQuestionContext(text,[],{now:new Date('2026-09-30T12:00:00Z')});
  assert.equal(result.request.intent,'company-news');assert.equal(result.request.news.company,company);assert.equal(result.request.news.lookbackDays,7);
 }
});

test('天气范围改口完整替换旧范围；同句与跨轮都不留下已撤销月份',()=>{
 const now=new Date('2026-09-30T00:00:00+08:00');
 const same=resolveQuestionContext('南京未来一个月，不对，未来一一一周。',[],{now});
 assert.equal(same.intent,'weather');assert.equal(same.request.weather.location,'南京');assert.equal(same.request.weather.period,'next-seven-days');assert.equal(same.request.corrections[0].retracted,'未来一个月');assert.doesNotMatch(same.query,/一个月/);
 const cross=resolveQuestionContext('哦不对，未来一周。',turn('南京未来一个月天气怎么样？'),{now});
 assert.equal(cross.intent,'weather');assert.equal(cross.request.weather.location,'南京');assert.equal(cross.request.weather.period,'next-seven-days');assert.equal(cross.request.action,'correction');
});

test('天气缺地点的补充只补城市，保留之前明确日期范围',()=>{
 const first=resolveQuestionContext('未来一周天气怎么样？',[]);assert.equal(first.needsClarification,true);assert.equal(first.request.weather.period,'next-seven-days');
 const second=resolveQuestionContext('南京的',turn('未来一周天气怎么样？'));assert.equal(second.intent,'weather');assert.equal(second.request.weather.location,'南京');assert.equal(second.request.weather.period,'next-seven-days');
});

test('设备位置需要单独有效授权，且明确城市优先于设备坐标',()=>{
 const now=Date.parse('2026-09-30T00:00:00Z'),coordinates={latitude:31.23,longitude:121.47,source:'device-geolocation',capturedAt:new Date(now).toISOString()};
 assert.equal(validateLocationCoordinates(coordinates,{consented:false,now}),null);
 assert.equal(validateLocationCoordinates({...coordinates,latitude:91},{consented:true,now}),null);
 assert.equal(validateLocationCoordinates({...coordinates,capturedAt:new Date(now-16*60*1000).toISOString()},{consented:true,now}),null);
 const query=resolveQuestionContext('这里天气怎么样？',[],{locationCoordinates:coordinates,locationConsent:false,now:new Date(now)});assert.equal(query.needsClarification,true);assert.equal(query.request.weather.coordinates,undefined);
 const allowed=resolveQuestionContext('这里天气怎么样？',[],{locationCoordinates:coordinates,locationConsent:true,now:new Date(now)});assert.equal(allowed.request.weather.coordinates.latitude,31.23);assert.equal(allowed.request.provenance.fieldSources.location.source,'device-geolocation');
 const explicit=resolveQuestionContext('杭州天气怎么样？',[],{locationCoordinates:coordinates,locationConsent:true,now:new Date(now)});assert.equal(explicit.request.weather.location,'杭州');assert.equal(explicit.request.weather.coordinates,undefined);
});

test('天气的否定改口只替换地点，地点比较则保留两个对象并明确要求单地点选择',()=>{
 const correction=resolveQuestionContext('不是南京，是杭州天气怎么样？');assert.equal(correction.request.weather.location,'杭州');assert.equal(correction.request.corrections[0].retracted,'南京');
 const comparison=resolveQuestionContext('南京和杭州天气比较一下');assert.deepEqual(comparison.request.weather.locations,['南京','杭州']);assert.equal(comparison.request.weather.location,'');assert.equal(comparison.needsClarification,true);
});

// Cases from saved chat history (2026-11-07 to 2026-11-12), wording kept as spoken.
test('“当地/那里”续问带上最近问过的地点，不借用更早的产品',()=>{
 const history=[...turn('红米手机最新款的是哪个型号？具体多少钱？'),...turn('北京的天气如何？'),...turn('帮我查一下荥阳的天气如何？'),...turn('当地有什么特色名吃吗？')];
 const food=resolveQuestionContext('当地有什么特色名吃吗？',history.slice(0,6));
 assert.equal(food.contextUsed,true);assert.match(food.query,/荥阳/);assert.notEqual(food.intent,'weather');
 const fun=resolveQuestionContext('那，那里的话有什么好玩的地方吗？',history);
 assert.equal(fun.contextUsed,true);assert.match(fun.query,/^荥阳 /);assert.equal(fun.intent==='product-research',false);assert.equal(/红米|小米/.test(fun.query),false);
});
test('地点只看最近三问；中间换了话题就不再补地点',()=>{
 const stale=resolveQuestionContext('那里有什么好玩的？',[...turn('荥阳天气怎么样？'),...turn('解释一下蓝牙协议'),...turn('写一封请假邮件'),...turn('翻译一下这段话')]);
 assert.equal(stale.contextUsed,false);assert.equal(stale.query.includes('荥阳'),false);
 const changed=resolveQuestionContext('那里有什么好玩的？',[...turn('荥阳天气怎么样？'),...turn('解释一下蓝牙协议')]);
 assert.equal(changed.query.includes('荥阳'),false);
});
test('“这个天气”追问沿用上轮天气地点，不把整句当地名',()=>{
 const result=resolveQuestionContext('这个天气我适合穿什么衣服？',turn('张家港市的天气如何？'));
 assert.equal(result.intent,'weather');assert.equal(result.request.weather.location,'张家港市');assert.equal(result.contextUsed,true);
});
test('“那X呢”是换对象，不把新品牌拼到上一款产品后面',()=>{
 const result=resolveQuestionContext('那比亚迪汽车呢？',turn('小米最新的汽车是什么样的？'));
 assert.equal(result.request.brand,'比亚迪');assert.equal(result.query.includes('小米'),false);
});
test('“最新款的苹果手机”识别品牌为苹果，续问不带入“款的苹果”',()=>{
 const result=resolveQuestionContext('他在闲鱼上的价格是多少钱呢？',turn('最新款的苹果手机是哪一个？告诉我详细参数。'));
 assert.equal(result.contextUsed,true);assert.equal(result.request.brand,'苹果');assert.equal(result.query.includes('款的苹果'),false);
});
test('“目前国内畅销”不是品牌，不作为后续问题的对象',()=>{
 const result=resolveQuestionContext('它在闲鱼上目前挂牌价多少？',turn('目前国内畅销的汽车是哪一款？价格多少？'));
 assert.equal(/目前|畅销/.test(result.request.subject||''),false);assert.equal(result.query.includes('畅销'),false);
});
test('换过话题后，单个“那…”不再接回旧产品；“它/价格呢”仍可接回',()=>{
 const history=[...turn('小米最新的汽车是哪一款？'),...turn('北京的天气如何？')];
 assert.equal(resolveQuestionContext('那有什么推荐的电影？',history).query.includes('小米'),false);
 assert.match(resolveQuestionContext('它多少钱？',history).query,/小米/);
 assert.match(resolveQuestionContext('那续航呢？',history).query,/小米/);
 assert.match(resolveQuestionContext('那续航呢？',turn('小米最新的汽车是哪一款？')).query,/小米/);
});
test('续问自己点名了别的型号时，不把上一款产品拼进去；“本地位置”不是地点指代',()=>{
 const tesla=resolveQuestionContext('特斯拉这款，呃，最新款的 model 3，它在闲鱼上目前挂牌价多少？',[...turn('小米最新的汽车是什么样的？'),...turn('那比亚迪汽车呢？')]);
 assert.equal(/小米|比亚迪/.test(tesla.query),false);
 const permission=resolveQuestionContext('我现在允许你获取本地位置。',turn('张家港天气怎么样？'));
 assert.equal(permission.query.includes('张家港'),false);
});
test('“那个”仍可指上一款产品；“那个地方”在天气之后指地点，不当作城市名',()=>{
 assert.match(resolveQuestionContext('那个多少钱？',turn('小米最新的汽车是哪一款？')).query,/小米/);
 const place=resolveQuestionContext('那个地方好玩吗？',turn('荥阳天气怎么样？'));
 assert.notEqual(place.intent,'weather');assert.match(place.query,/^荥阳 /);
});
