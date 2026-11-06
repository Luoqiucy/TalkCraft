import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommercialStore } from '../src/commercial/sqlite-store.mjs';
import { createCommercialGateway } from '../src/commercial/gateway.mjs';

async function fixture(run, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-commercial-'));
  const store = createCommercialStore(join(directory, 'commercial.sqlite'));
  const provider = overrides.provider || { id: 'test-provider', simulated: false, async complete() { return { text: '模型实际回答', usage: { inputTokens: 12, outputTokens: 8 } }; } };
  const asr = overrides.asr || { enabled: true, simulated: false, async transcribe() { return '真实转写'; } };
  const server = createCommercialGateway({ store, provider, asr, weatherTool:overrides.weatherTool, limits: overrides.limits||{ asr_seconds: 10, ai_characters: 20 }, memorySyncEntitlement:overrides.memorySyncEntitlement });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, token, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
  try { await run({ store, base, post, directory }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); await rm(directory, { recursive: true, force: true }); }
}

test('账号注册、登录、撤销会话与隔离；数据库不存原始密码或会话令牌', async () => fixture(async ({ store, base, post, directory }) => {
  const one = await post('/auth/register', { email: 'One@Example.com', password: 'long-secret-passphrase' });
  assert.equal(one.status, 201);
  const two = await post('/auth/register', { email: 'two@example.com', password: 'long-secret-passphrase-2' });
  assert.equal(two.status, 201);
  assert.equal((await post('/auth/register', { email: 'one@example.com', password: 'long-secret-passphrase' })).status, 409);
  assert.equal((await post('/auth/login', { email: 'one@example.com', password: 'wrong-password' })).status, 401);
  const login = await post('/auth/login', { email: 'ONE@example.com', password: 'long-secret-passphrase' });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.equal((await fetch(`${base}/me`)).status, 401);
  assert.equal((await (await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).json()).account.email, 'one@example.com');
  const database = await readFile(join(directory, 'commercial.sqlite'));
  assert.equal(database.includes(Buffer.from('long-secret-passphrase')), false);
  assert.equal(database.includes(Buffer.from(token)), false);
  assert.equal((await post('/auth/logout', {}, token)).status, 200);
  assert.equal((await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal(store.accountByEmail('two@example.com').email, 'two@example.com');
}));

test('账号网关遇到缺地点天气先澄清，不调用模型且不预留额度',async()=>{
 let modelCalls=0;
 const provider={id:'test-tools',simulated:false,async streamWithTools(){modelCalls++;return {content:'不应调用模型',toolCalls:[]};},async complete(){modelCalls++;return {text:'不应调用模型'};}};
 await fixture(async({base,post})=>{
  await post('/auth/register',{email:'clarify@example.com',password:'long-secret-passphrase'});
  const token=(await(await post('/auth/login',{email:'clarify@example.com',password:'long-secret-passphrase'})).json()).token;
  const response=await post('/tasks/process',{taskId:'missing-weather-location',mode:'chat',webSearch:true,uploadConsent:true,text:'未来一周天气怎么样？'},token);
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.result.result.status,'needs-input');assert.match(body.result.answer.text,/哪个城市/);assert.equal(modelCalls,0);
  const usage=await(await fetch(`${base}/me/usage`,{headers:{Authorization:`Bearer ${token}`}})).json();assert.equal(usage.usage.ai_characters.used,0);assert.equal(usage.usage.ai_characters.reserved,0);
 },{provider});
});

test('账号网关多轮天气上下文和本机入口共用地点、日期参数',async()=>{
 const received=[];let calls=0;
 const provider={id:'offline-fixture',simulated:false,async streamWithTools(messages){calls++;if(messages.at(-1).role!=='tool')return {content:'',toolCalls:[{id:`weather-${calls}`,type:'function',function:{name:'get_weather',arguments:JSON.stringify({intent:{intent:'weather'}})}}]};return {content:'已取得该地点天气数据。',toolCalls:[]};},async complete(){throw Error('不应该退回普通模型接口');}};
 const weatherTool={enabled:true,async query(intent){received.push([intent.location,intent.period]);return {status:'ok',provider:'fixture-weather',period:intent.period,timezone:'Asia/Shanghai',location:{name:intent.location},forecast:{date:'2026-10-02',condition:'晴',temperatureMax:24,temperatureMin:16,precipitationProbabilityMax:10,windSpeedMax:8},current:{temperature:20,condition:'晴'},sources:[{title:'fixture weather',url:'https://weather.example/data'}]};}};
 await fixture(async({post})=>{
  await post('/auth/register',{email:'weather-context@example.com',password:'long-secret-passphrase'});const token=(await(await post('/auth/login',{email:'weather-context@example.com',password:'long-secret-passphrase'})).json()).token,history=[];
  for(const text of ['张家港天气怎么样','南京呢','杭州','明天呢']){const response=await post('/tasks/process',{taskId:`weather-context-${history.length}`,mode:'chat',webSearch:true,uploadConsent:true,text,history},token);assert.equal(response.status,200);const body=await response.json();assert.equal(body.result.result.status,'weather-data');history.push({role:'user',content:text},{role:'assistant',content:body.result.answer.text});}
  assert.deepEqual(received,[['张家港','current-today'],['南京','current-today'],['杭州','current-today'],['杭州','tomorrow']]);
 },{provider,weatherTool,limits:{asr_seconds:100,ai_characters:1000}});
});

test('受控模型调用只对成功的真实结果结算；重复、超额和另一账号分开处理', async () => fixture(async ({ base, post }) => {
  const account = async email => { await post('/auth/register', { email, password: 'long-secret-passphrase' }); return (await (await post('/auth/login', { email, password: 'long-secret-passphrase' })).json()).token; };
  const tokenA = await account('a@example.com'), tokenB = await account('b@example.com');
  const headersA = { Authorization: `Bearer ${tokenA}` };
  const submit = (taskId, text, token = tokenA) => post('/tasks/process', { taskId, mode: 'chat', text, uploadConsent: true }, token);
  assert.equal((await submit('first', '五个字提问')).status, 200);
  const usageA = await (await fetch(`${base}/me/usage`, { headers: headersA })).json();
  assert.equal(usageA.scope, 'server');
  assert.equal(usageA.usage.ai_characters.used, 5);
  assert.equal(usageA.usage.ai_characters.reserved, 0);
  assert.equal((await submit('first', '五个字提问')).status, 409);
  assert.equal((await submit('too-much', '一'.repeat(21))).status, 402);
  assert.equal((await submit('first', '另一问题', tokenB)).status, 200);
  assert.equal((await (await fetch(`${base}/me/usage`, { headers: { Authorization: `Bearer ${tokenB}` } })).json()).usage.ai_characters.used, 4);
  assert.equal((await post('/tasks/process', { taskId: 'no-consent', mode: 'chat', text: '问题' }, tokenA)).status, 400);
  assert.equal((await post('/tasks/process', { taskId: 'cross-origin', mode: 'chat', text: '问题', uploadConsent: true }, tokenA, { Origin: 'https://evil.example' })).status, 403);
}));

test('账号问答入口使用与桌面本机相同的品牌替换上下文解析', async () => {
  let systemMessage = '';
  let turn = 0;
  const provider = { id: 'deepseek', simulated: false, async streamWithTools(messages) {
    systemMessage = messages[0].content;
    turn++;
    if(turn===1)return {content:'',toolCalls:[{id:'search-oppo',type:'function',function:{name:'search_web',arguments:JSON.stringify({query:'OPPO 最新手机 型号 价格 配置'})}}],responseModel:'deepseek-flash',usage:{inputTokens:2}};
    return { content: 'OPPO最新手机的型号、价格和配置如下。[1]', toolCalls: [], responseModel: 'deepseek-flash', usage: { outputTokens: 4 } };
  },async search(){return {performed:true,sources:[{title:'OPPO Smartphone lineup',url:'https://www.oppo.com/cn/smartphones/',snippet:'OPPO smartphone product line and models.'}]};} };
  await fixture(async ({ post }) => {
    await post('/auth/register', { email: 'context@example.com', password: 'long-secret-passphrase' });
    const token = (await (await post('/auth/login', { email: 'context@example.com', password: 'long-secret-passphrase' })).json()).token;
    const input = { taskId: 'brand-switch-context', mode: 'chat', webSearch: true, uploadConsent: true, text: 'OPPO 手机呢？', history: [{ role: 'user', content: '最新的 vivo 手机是哪一款？型号、价格和详细配置是什么？' }, { role: 'assistant', content: '旧回答型号和价格未核实。' }] };
    const response = await post('/tasks/process', input, token);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.result.answer.text, /OPPO/);
    assert.match(systemMessage, /"brand":"OPPO"/);assert.match(systemMessage, /"category":"手机"/);assert.doesNotMatch(systemMessage, /vivo X/);
  }, { provider });
});

test('真实音频长度由服务端验证并按秒计量；失败释放额度', async () => fixture(async ({ base, post }) => {
  await post('/auth/register', { email: 'audio@example.com', password: 'long-secret-passphrase' });
  const token = (await (await post('/auth/login', { email: 'audio@example.com', password: 'long-secret-passphrase' })).json()).token;
  const pcm = Buffer.alloc(32_000);
  const upload = (taskId, length = pcm) => fetch(`${base}/tasks/transcribe`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Audio-Cloud-Consent': 'true', 'X-Audio-Sample-Rate': '16000', 'X-Audio-Channels': '1', 'X-Audio-Bit-Depth': '16', 'X-TalkCraft-Task-Id': taskId }, body: length });
  assert.equal((await upload('audio-1')).status, 200);
  assert.equal((await upload('audio-1')).status, 409);
  assert.equal((await upload('audio-2', Buffer.alloc(3201))).status, 400);
  const usage = await (await fetch(`${base}/me/usage`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(usage.usage.asr_seconds.used, 1);
  assert.equal(usage.usage.asr_seconds.reserved, 0);
}));

test('供应商失败退回预留；用户取消中断调用且迟到结果不入账', async () => {
  let begin; const started = new Promise(resolve => { begin = resolve; });
  const provider = { id: 'test-provider', simulated: false, async complete(_messages, { signal }) {
    begin();
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    return '迟到结果';
  } };
  await fixture(async ({ base, post }) => {
    await post('/auth/register', { email: 'cancel@example.com', password: 'long-secret-passphrase' });
    const token = (await (await post('/auth/login', { email: 'cancel@example.com', password: 'long-secret-passphrase' })).json()).token;
    const pending = post('/tasks/process', { taskId: 'cancel-me', mode: 'chat', text: '天气问题', uploadConsent: true }, token);
    await started;
    const before = await (await fetch(`${base}/me/usage`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(before.usage.ai_characters.reserved, 4);
    assert.equal((await post('/tasks/cancel', { taskId: 'cancel-me', metric: 'ai_characters' }, token)).status, 200);
    assert.equal((await pending).status, 499);
    const after = await (await fetch(`${base}/me/usage`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(after.usage.ai_characters.used, 0);
    assert.equal(after.usage.ai_characters.reserved, 0);
  }, { provider });
  await fixture(async ({ base, post }) => {
    await post('/auth/register', { email: 'failure@example.com', password: 'long-secret-passphrase' });
    const token = (await (await post('/auth/login', { email: 'failure@example.com', password: 'long-secret-passphrase' })).json()).token;
    assert.equal((await post('/tasks/process', { taskId: 'fail-me', mode: 'chat', text: '失败问题', uploadConsent: true }, token)).status, 502);
    const usage = await (await fetch(`${base}/me/usage`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(usage.usage.ai_characters.used, 0);
    assert.equal(usage.usage.ai_characters.reserved, 0);
  }, { provider: { id: 'failure', simulated: false, async complete() { throw Error('upstream failed'); } } });
});

test('SQLite BEGIN IMMEDIATE 跨连接串行预留，不超卖；取消后迟到结算被拒', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-sqlite-tx-'));
  const path = join(directory, 'quota.sqlite');
  const one = createCommercialStore(path), two = createCommercialStore(path);
  try {
    const account = one.createAccount('tx@example.com', 'test-hash');
    const input = taskId => ({ accountId: account.id, taskId, metric: 'asr_seconds', periodId: '2026-09', quantity: 7, limit: 10 });
    const outcomes = await Promise.allSettled([Promise.resolve().then(() => one.reserve(input('a'))), Promise.resolve().then(() => two.reserve(input('b')))]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(item => item.status === 'rejected' && item.reason.code === 'QUOTA_EXCEEDED').length, 1);
    const winner = outcomes[0].status === 'fulfilled' ? 'a' : 'b';
    assert.equal(two.usage(account.id, '2026-09', 'asr_seconds', 10).reserved, 7);
    one.finish({ accountId: account.id, taskId: winner, metric: 'asr_seconds', cancel: true });
    assert.equal(two.usage(account.id, '2026-09', 'asr_seconds', 10).remaining, 10);
    assert.throws(() => two.finish({ accountId: account.id, taskId: winner, metric: 'asr_seconds', actualQuantity: 7 }), { code: 'TASK_FINISHED' });
  } finally { one.close(); two.close(); await rm(directory, { recursive: true, force: true }); }
});

test('SQLite 重启保留已结算事件，任务 ID 跨周期重放不能再次扣费', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-sqlite-restart-'));
  const path = join(directory, 'quota.sqlite');
  let store = createCommercialStore(path);
  try {
    const account = store.createAccount('restart@example.com', 'test-hash');
    store.reserve({ accountId: account.id, taskId: 'once', metric: 'ai_characters', periodId: '2026-09', quantity: 6, limit: 10 });
    store.finish({ accountId: account.id, taskId: 'once', metric: 'ai_characters', actualQuantity: 6 });
    store.close();
    store = createCommercialStore(path);
    assert.equal(store.usage(account.id, '2026-09', 'ai_characters', 10).used, 6);
    assert.equal(store.usage(account.id, '2026-10', 'ai_characters', 10).used, 0);
    assert.throws(() => store.reserve({ accountId: account.id, taskId: 'once', metric: 'ai_characters', periodId: '2026-10', quantity: 6, limit: 10 }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.deepEqual(store.reserve({ accountId: account.id, taskId: 'once', metric: 'ai_characters', periodId: '2026-09', quantity: 6, limit: 10 }), { created: false, state: 'settled' });
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('长期记忆同步按已验证账号隔离，操作重放幂等、冲突可见、删除墓碑阻止复活',async()=>fixture(async({post,store})=>{
 const login=async(email)=>{await post('/auth/register',{email,password:'long-secret-passphrase'});return(await(await post('/auth/login',{email,password:'long-secret-passphrase'})).json()).token;};const a=await login('mem-a@example.com'),b=await login('mem-b@example.com');
 const memoryId='memory-123456',op1='operation-create-123';const create={cursor:0,operations:[{memoryId,operationId:op1,baseVersion:0,type:'preference',content:'喜欢简短回答',reason:'用户明确确认',independent:false}]};
 const first=await(await post('/me/memories/sync',create,a)).json();assert.equal(first.accepted[0].version,1);assert.equal(first.changes[0].memoryId,memoryId);
 const replay=await(await post('/me/memories/sync',create,a)).json();assert.equal(replay.accepted[0].duplicate,true);assert.equal(replay.changes.length,1);
 const stale=await(await post('/me/memories/sync',{cursor:1,operations:[{memoryId,operationId:'operation-stale-123',baseVersion:0,type:'preference',content:'旧值',reason:'冲突'}]},a)).json();assert.equal(stale.conflicts[0].reason,'version-conflict');assert.equal(stale.conflicts[0].server.content,'喜欢简短回答');
 const update=await(await post('/me/memories/sync',{cursor:1,operations:[{memoryId,operationId:'operation-update-123',baseVersion:1,type:'preference',content:'喜欢更短的回答',reason:'用户再次确认'}]},a)).json();assert.equal(update.accepted[0].version,2);assert.equal(update.changes[0].content,'喜欢更短的回答');
 const deleted=await(await post('/me/memories/sync',{cursor:update.cursor,operations:[{memoryId,operationId:'operation-delete-123',baseVersion:2,deleted:true}]},a)).json();assert.equal(deleted.accepted[0].status,'deleted');
 const resurrect=await(await post('/me/memories/sync',{cursor:deleted.cursor,operations:[{memoryId,operationId:'operation-resurrect-123',baseVersion:3,type:'preference',content:'旧设备旧值',reason:'旧离线修改'}]},a)).json();assert.equal(resurrect.conflicts[0].reason,'server-deleted');
 const isolated=await(await post('/me/memories/sync',{cursor:0,operations:[]},b)).json();assert.deepEqual(isolated.changes,[]);assert.equal(store.relevantMemories(store.accountByEmail('mem-a@example.com').id,'简短回答').length,0,'墓碑删除后不得继续检索');
 const emptyDeleteResponse=await post('/me/memories/sync',{cursor:deleted.cursor,operations:[{memoryId:'memory-never-synced',operationId:'operation-delete-never-synced',baseVersion:0,deleted:true}]},a),emptyDeleteBody=await emptyDeleteResponse.json();assert.equal(emptyDeleteResponse.status,200,JSON.stringify(emptyDeleteBody));assert.equal(emptyDeleteBody.accepted[0].status,'deleted');assert.equal(store.relevantMemories(store.accountByEmail('mem-a@example.com').id,'never-synced').length,0);
} ,{memorySyncEntitlement:async()=>true}));

test('跨设备同步未有服务端验证权益时明确拒绝，不假装上传成功',async()=>fixture(async({post})=>{
 await post('/auth/register',{email:'no-entitlement@example.com',password:'long-secret-passphrase'});const token=(await(await post('/auth/login',{email:'no-entitlement@example.com',password:'long-secret-passphrase'})).json()).token;
 const response=await post('/me/memories/sync',{cursor:0,operations:[]},token);assert.equal(response.status,403);assert.match((await response.json()).error,/权益/);
}));

test('账号记忆与本机记忆使用同一水果关系检索，不把偶尔吃苹果升级成偏好',async()=>fixture(async({store})=>{
 const account=store.createAccount('fruit-memory@example.com','test-hash');
 store.syncMemories(account.id,{cursor:0,operations:[
  {memoryId:'fruit-banana',operationId:'fruit-banana-op',baseVersion:0,type:'preference',content:'我喜欢吃香蕉',reason:'用户明确确认'},
  {memoryId:'fruit-apple',operationId:'fruit-apple-op',baseVersion:0,type:'fact',content:'我偶尔吃苹果',reason:'用户确认保存的行为'}
 ]});
 const favorites=store.relevantMemories(account.id,'我喜欢什么水果');
 assert.equal(favorites[0].memoryId,'fruit-banana');
 assert.equal(favorites.some(item=>item.memoryId==='fruit-apple'),false);
 const behavior=store.relevantMemories(account.id,'我平时吃哪些水果');
 assert.deepEqual(new Set(behavior.map(item=>item.memoryId)),new Set(['fruit-banana','fruit-apple']));
 assert.equal(behavior.find(item=>item.memoryId==='fruit-apple').fact.frequency,'occasional');
}));

test('供应商失败退回预留后，用户用同一任务重试可以再次预留；已结算任务仍拒绝重复', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-commercial-retry-'));
  const store = createCommercialStore(join(directory, 'commercial.sqlite'));
  try {
    const account = store.createAccount('retry@example.com', 'hash');
    const task = { accountId: account.id, taskId: '11111111-1111-4111-8111-111111111111', metric: 'ai_characters', periodId: '2026-11', quantity: 5, limit: 20 };
    assert.equal(store.reserve(task).created, true);
    store.finish({ ...task, cancel: true });
    assert.equal(store.usage(account.id, '2026-11', 'ai_characters', 20).remaining, 20);
    const retry = store.reserve(task);
    assert.equal(retry.created, true); assert.equal(retry.retried, true);
    assert.equal(store.usage(account.id, '2026-11', 'ai_characters', 20).reserved, 5);
    assert.equal(store.reserve(task).created, false);
    store.finish({ ...task, actualQuantity: 5 });
    assert.equal(store.reserve(task).created, false);
    assert.equal(store.usage(account.id, '2026-11', 'ai_characters', 20).used, 5);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
