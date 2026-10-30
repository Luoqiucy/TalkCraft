import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src-ui/src/services/agentClient.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { askQuestion } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const status = { agentEngine: 'langgraph', weatherAvailable: true, webSearchAvailable: true };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const stream = value => new Response(`${JSON.stringify({ type: 'progress', event: { eventId: 'one', taskId: 'task-1', sequence: 1, stage: 'weather', status: 'completed' } })}\n${JSON.stringify({ type: 'result', data: value })}`, { headers: { 'Content-Type': 'application/x-ndjson' } });

test('天气使用单次 LangGraph 请求，末尾无换行仍交付结果', async () => {
  const old = globalThis.fetch, calls = [], events = [];
  globalThis.fetch = async (url, input) => { calls.push([url, JSON.parse(input.body)]); return stream({ text: '结构化天气结果', simulated: true, search: { engine: 'langgraph', sources: [] } }); };
  try { const answer = await askQuestion('南京天气怎么样', { cloudConsent: true, webSearch: true, status }, new AbortController().signal, event => events.push(event)); assert.equal(answer.text, '结构化天气结果'); assert.deepEqual(calls.map(call => call[0]), ['/api/agent']); assert.equal(events.length, 1); }
  finally { globalThis.fetch = old; }
});
test('天气追问沿用上轮地点并仍只发一次Agent请求',async()=>{
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,input)=>{calls.push([url,JSON.parse(input.body)]);return stream({text:'明日预报',search:{query:'苏州张家港市明天天气'}});};
 try{
  await askQuestion('那明天呢？',{cloudConsent:true,webSearch:true,status,history:[{role:'user',content:'苏州张家港市天气怎么样？'},{role:'assistant',content:'今日天气已查到'}]},new AbortController().signal,()=>{});
  assert.deepEqual(calls.map(call=>call[0]),['/api/agent']);assert.equal(calls[0][1].text,'那明天呢？');assert.equal(calls[0][1].history.length,2);
 }finally{globalThis.fetch=old;}
});

test('独立窗口展示用来源不会随上下文再次上传给模型', async () => {
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,input)=>{calls.push([url,JSON.parse(input.body)]);return stream({text:'新回答'});};
 try {
  await askQuestion('继续',{cloudConsent:true,webSearch:true,status,history:[{role:'user',content:'原问题'},{role:'assistant',content:'旧回答[1]',sources:[{url:'https://example.com/private?token=secret'}]}]},new AbortController().signal,()=>{});
  assert.deepEqual(calls[0][1].history,[{role:'user',content:'原问题'},{role:'assistant',content:'旧回答[1]'}]);
 } finally { globalThis.fetch=old; }
});

test('产品查询使用单次 Agent 请求，保留原问题', async () => {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, input) => { calls.push([url, JSON.parse(input.body)]); return stream({ text: '基于来源的回答', simulated: true }); };
  try { const answer = await askQuestion('帮我查一下理想i9', { cloudConsent: true, webSearch: true, status }, new AbortController().signal, () => {}); assert.equal(answer.text, '基于来源的回答'); assert.deepEqual(calls.map(call => call[0]), ['/api/agent']); assert.equal(calls[0][1].text, '帮我查一下理想i9'); }
  finally { globalThis.fetch = old; }
});

test('关闭联网时普通问答只请求文字模型', async () => {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, input) => { calls.push([url, JSON.parse(input.body)]); return json({ text: '普通回答', simulated: true }); };
  try { await askQuestion('解释单元测试', { cloudConsent: false, webSearch: false, status }, new AbortController().signal, () => {}); assert.deepEqual(calls.map(call => call[0]), ['/api/process']); assert.equal(calls[0][1].webSearch, undefined); }
  finally { globalThis.fetch = old; }
});

test('取消后不交付已到达的工具事件或回答', async () => {
  const old = globalThis.fetch, active = new AbortController(), events = [];
  globalThis.fetch = async () => { active.abort(); return stream({ text: '迟到结果' }); };
  try { await assert.rejects(askQuestion('南京天气怎么样', { cloudConsent: true, webSearch: true, status }, active.signal, event => events.push(event)), { name: 'AbortError' }); assert.equal(events.length, 0); }
  finally { globalThis.fetch = old; }
});
