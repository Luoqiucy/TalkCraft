import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuestionContext } from '../src/agent/question-context.mjs';

const now = new Date('2026-10-01T00:00:00+08:00');
const flows = [
  { name: 'MacBook逐轮补齐配置和购买价后查询闲鱼成交价', turns: ['帮我查2021款MacBook Pro电脑详细参数', '16英寸，M1 Pro', '32GB内存，512GB存储', '我买成6700元', '查闲鱼近期成交价'], check: r => { for (const key of ['year','screenSize','chip','memoryGB','storageGB','purchasePrice']) assert.ok(r.request.attributes[key], `缺少${key}`); assert.equal(r.request.queryConstraints.marketplace,'闲鱼'); assert.equal(r.request.queryConstraints.priceType,'transaction'); assert.equal(r.request.userFacts.purchasePrice.value,'6700'); } },
  { name: '笔记本切换为明确手机型号后清除电脑配置', turns: ['MacBook Pro电脑详细参数', '2021款16英寸M1 Pro，32GB内存512GB存储', '查询闲鱼成交价', '那iPhone 13 Pro Max呢'], check: r => { assert.equal(r.request.object.category,'手机'); assert.equal(r.request.explicitModel,'13 Pro Max'); assert.equal(r.request.attributes.chip,undefined); assert.equal(r.request.attributes.memoryGB,undefined); assert.equal(r.request.queryConstraints.marketplace,'闲鱼'); } },
  { name: '手机类别不明确时只追问缺少型号', turns: ['帮我查MacBook Pro电脑参数', '另外查闲鱼近期成交价', '电脑是2021年款', '那手机呢'], check: r => { assert.equal(r.request.needsClarification,true); assert.match(r.request.ambiguities.join(' '),/型号|手机/); assert.notEqual(r.request.brand,'手机呢'); } },
  { name: '品牌替换后继承查询字段而不继承旧型号', turns: ['vivo最新款手机价格和配置', '还要发布时间', 'OPPO手机呢', '发布时间呢'], check: r => { assert.equal(r.request.brand,'OPPO'); assert.equal(r.request.category,'手机'); assert.ok(r.request.requestedAspects.includes('最新型号/发布时间')||r.request.requestedFields.some(x=>/发布时间/.test(x))); assert.equal(r.request.object.brand,'OPPO'); } },
  { name: '比较多个设备后指代无法唯一确定时澄清', turns: ['请比较iPhone 17 Pro Max和小米17 Pro Max', '两个都看价格和配置', '我想知道它的续航', '它的续航呢'], check: r => { assert.equal(r.request.needsClarification,true); assert.ok(r.request.ambiguities.length); } },
  { name: '天气连续换地点后明天继承最新地点', turns: ['张家港天气怎么样', '南京呢', '杭州', '明天呢'], check: r => { assert.equal(r.request.intent,'weather'); assert.equal(r.request.weather.location,'杭州'); assert.equal(r.request.weather.period,'tomorrow'); } },
  { name: '缺地点天气在用户补城市后恢复预报范围', turns: ['未来一周天气怎么样', '南京的', '我要逐日预报', '按未来七天查'], check: r => { assert.equal(r.request.intent,'weather'); assert.equal(r.request.weather.location,'南京'); assert.equal(r.request.weather.period,'next-seven-days'); } },
  { name: '同句改口只保留最终天气范围', turns: ['南京天气怎么样', '未来一个月，不对，未来一周', '未来一周呢', '未来一周天气呢'], check: r => { assert.equal(r.request.weather.location,'南京'); assert.equal(r.request.weather.period,'next-seven-days'); } },
  { name: '跨轮改口继承地点并撤销旧天气范围', turns: ['南京未来一个月天气怎么样', '哦不对，未来一周', '那就看未来七天', '未来一周呢'], check: r => { assert.equal(r.request.weather.location,'南京'); assert.equal(r.request.weather.period,'next-seven-days'); } },
  { name: '公司新闻可替换公司并修正时间范围', turns: ['小米汽车最近新闻热点', '主要看官方与媒体报道', '谷歌呢', '只看最近三天'], check: r => { assert.ok(['company-news','news-search'].includes(r.request.intent)); assert.match(r.request.news?.company||r.request.object?.name||'',/谷歌|Google/); assert.equal(r.request.news?.lookbackDays,3); } },
  { name: '换成天气和一般知识后不继承旧产品任务', turns: ['查询MacBook Pro的闲鱼成交价', '南京天气怎么样', '解释一下蓝牙协议', '蓝牙和Wi-Fi有什么区别'], check: r => { assert.equal(r.request.intent,'general'); assert.notEqual(r.request.queryConstraints.marketplace,'闲鱼'); assert.equal(r.request.object?.category,undefined); } },
  { name: '私人水果事实与外部问题分开路由', turns: ['我喜欢吃香蕉，偶尔也吃苹果', '苹果有什么好处？', '我平时吃哪些水果？', '你记得我偶尔吃什么吗？'], check: r => { assert.equal(r.request.intent,'personal-memory'); assert.deepEqual(new Set(r.request.sessionFacts.map(x=>x.object)),new Set(['香蕉','苹果'])); assert.equal(r.request.sessionFacts.find(x=>x.object==='苹果')?.frequency,'occasional'); } },
];

function play(turns) {
  const history = []; let current;
  for (const [turnIndex, utterance] of turns.entries()) {
    const taskId = `00000000-0000-4000-8000-${String(turnIndex + 1).padStart(12, '0')}`;
    current = resolveQuestionContext(utterance, history, { now, sessionId: 'acceptance-session', taskId });
    assert.equal(current.request.originalText, utterance, `第${turnIndex + 1}轮必须保留原话`);
    assert.ok(current.request.resolvedQuestion, `第${turnIndex + 1}轮必须生成有效请求`);
    assert.equal(current.request.sessionId, 'acceptance-session');
    assert.equal(current.request.taskId, taskId);
    assert.equal(current.request.provenance.originalText, 'user');
    assert.ok(current.request.action, `第${turnIndex + 1}轮必须标明请求行为`);
    history.push({ role: 'user', content: utterance }, { role: 'assistant', content: '测试助手已回应本轮。' });
  }
  return current;
}

test('上下文验收语料由12组真实连续会话组成，每组至少4轮', () => {
  assert.equal(flows.length, 12);
  for (const flow of flows) assert.ok(flow.turns.length >= 4 && flow.turns.length <= 8, flow.name);
});

for (const flow of flows) test(`连续对话：${flow.name}`, () => flow.check(play(flow.turns)));

test('清空会话后，不从旧对话继承产品平台或天气地点', () => {
  const reset = resolveQuestionContext('明天呢？', [], { now });
  assert.notEqual(reset.request.intent, 'weather');
  assert.equal(reset.request.weather, undefined);
  assert.equal(reset.request.queryConstraints.marketplace, undefined);
});

test('跨轮纠正将一月撤销为一周；规范范围只传给当前天气工具', () => {
  const first=resolveQuestionContext('南京未来一个月天气怎么样',[],{now});
  const corrected=resolveQuestionContext('哦不对，未来一周',[{role:'user',content:'南京未来一个月天气怎么样'}],{now});
  assert.equal(first.request.weather.period,'next-month');
  assert.equal(corrected.request.weather.location,'南京');
  assert.equal(corrected.request.weather.period,'next-seven-days');
  assert.deepEqual(corrected.request.corrections,[{type:'replaced',retracted:'上一轮对应范围或地点',replacement:'未来一周',source:'follow-up-correction'}]);
});

test('单独城市追问解析后不会把城市重复拼进搜索问题', () => {
  const previous = [{ role: 'user', content: '南京天气怎么样' }, { role: 'assistant', content: '已查询天气' }];
  const result = resolveQuestionContext('杭州', previous, { now, sessionId: 'city-session', taskId: '00000000-0000-4000-8000-000000000001' });
  assert.equal(result.request.weather.location, '杭州');
  assert.equal(result.request.weather.period, 'current-today');
  assert.doesNotMatch(result.request.resolvedQuestion, /杭州\s+杭州/u);
  assert.match(result.request.resolvedQuestion, /杭州.*天气/u);
});

test('带“那”的新城市追问仍继承天气任务，后续日期改口继承最新地点', () => {
  const history = [{ role: 'user', content: '南京今天的天气怎么样？' }, { role: 'assistant', content: '模拟的南京天气结果' }];
  const city = resolveQuestionContext('那杭州呢？', history, { now });
  assert.equal(city.request.intent, 'weather');
  assert.equal(city.request.weather.location, '杭州');
  assert.equal(city.request.weather.period, 'current-today');
  assert.equal(city.request.action, 'replace-location');
  assert.doesNotMatch(city.request.resolvedQuestion, /那杭州|杭州\s+杭州/u);
  const corrected = resolveQuestionContext('哦不对，未来一周。', [...history, { role: 'user', content: '那杭州呢？' }, { role: 'assistant', content: '之前结果不可作为新日期证据' }], { now });
  assert.equal(corrected.request.weather.location, '杭州');
  assert.equal(corrected.request.weather.period, 'next-seven-days');
});
