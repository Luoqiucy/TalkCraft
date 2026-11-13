import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src-ui/src/services/conversationMemory.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { appendConversation, restoreConversation, loadSavedConversation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const record = (id, text, answer, status = 'completed') => ({ id, mode: 'chat', status, revisedText: text, aiResult: answer });

test('仅恢复完成且同时有原问题和回答的本机问答，按时间正序发送', () => {
 const messages = restoreConversation([record('new', '那明天呢？', '明天预报'), record('failed', '失败问题', '', 'ai-failed'), record('old', '张家港天气', '今日天气')]);
 assert.deepEqual(messages.map(item => item.content), ['张家港天气', '今日天气', '那明天呢？', '明天预报']);
});

test('恢复与新增对话遵守12条和8000字的服务端边界', () => {
 let messages = [];
 for (let i = 0; i < 10; i++) messages = appendConversation(messages, `问题${i}`, '答'.repeat(1000));
 assert.equal(messages.length, 12);
 assert.ok(messages.reduce((sum, item) => sum + item.content.length, 0) <= 8000);
});

test('关闭文字历史或不保存时不恢复，且不会创建另一个正文副本', async () => {
 const original = globalThis.fetch;
 globalThis.fetch = async () => Response.json({ settings: { saveText: false, textRetention: 'forever' }, records: [record('one', '私密问题', '回答')], total: 1 });
 try { assert.deepEqual(await loadSavedConversation(), { conversation: [], savingEnabled: false }); }
 finally { globalThis.fetch = original; }
});

test('每轮回答保留各自来源，恢复历史后引用不串轮，敏感链接不进入独立窗口', () => {
 const earlier = record('earlier', '南京天气', '今天有雨[1]');
 earlier.attempts = [{ stage: 'ai', status: 'completed', result: earlier.aiResult, search: { sources: [{ title: '南京天气', url: 'https://weather.example/today?token=private&id=1' }] } }];
 const later = record('later', '那明天呢', '明天转晴[1]');
 later.attempts = [{ stage: 'ai', status: 'completed', result: later.aiResult, search: { sources: [{ title: '明日预报', url: 'https://forecast.example/tomorrow' }] } }];
 const turns = restoreConversation([later, earlier]);
 assert.equal(turns[1].sources[0].url, 'https://weather.example/today?id=1');
 assert.equal(turns[3].sources[0].url, 'https://forecast.example/tomorrow');
 assert.equal(turns[0].sources, undefined);
 const withMissing = appendConversation([], '问题', '回答[2]', [{ title: '无链接来源' }, { title: '有链接来源', url: 'https://valid.example/second' }]);
 assert.equal(withMissing[1].sources[0].url, '');
 assert.equal(withMissing[1].sources[1].url, 'https://valid.example/second');
});

test('被新问题打断的问答以完整一问一答保留，后续请求仍能通过历史校验', async () => {
  const { validateHistory } = await import('../public/conversation.mjs');
  const before = appendConversation([], '南京天气怎么样', '南京今天晴。');
  // Old behaviour: an unpaired user turn made every later request fail.
  assert.throws(() => validateHistory([...before, { role: 'user', content: '那杭州呢' }]), /问答历史/);
  const interrupted = appendConversation(before, '那杭州呢', '（上一问被新问题打断，未生成回答）');
  assert.equal(interrupted.length, 4);
  assert.doesNotThrow(() => validateHistory(interrupted.map(({ role, content }) => ({ role, content }))));
  const next = appendConversation(interrupted, '明天呢', '杭州明天多云。');
  assert.doesNotThrow(() => validateHistory(next.map(({ role, content }) => ({ role, content }))));
});

test('语音问题只存原始转写时，重启后也恢复为上下文', () => {
 const spoken = { id: 'voice', mode: 'chat', status: 'completed', originalTranscript: '帮我查一下荥阳的天气如何？', revisedText: '', aiResult: '荥阳今天有毛毛雨。' };
 const edited = { id: 'edited', mode: 'chat', status: 'completed', originalTranscript: '荥阳天汽', revisedText: '荥阳美食', aiResult: '烧饼夹卤肉。' };
 assert.deepEqual(restoreConversation([edited, spoken]).map(item => item.content), ['帮我查一下荥阳的天气如何？', '荥阳今天有毛毛雨。', '荥阳美食', '烧饼夹卤肉。']);
});
