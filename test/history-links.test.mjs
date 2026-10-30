import test from 'node:test';
import assert from 'node:assert/strict';
import { historyAnswerEntries } from '../src-ui/src/services/historyConversation.ts';
import { citedSourceNumbers, sourceHref, sourcePreview } from '../src-ui/src/services/sourceLinks.ts';
import { createServer } from '../server.mjs';

test('每次问答只关联自己的回答与资料，重试不覆盖上一次来源', () => {
  const record = { id: 'record-1', mode: 'chat', aiResult: '第二次回答[1]', attempts: [
    { stage: 'ai', status: 'completed', result: '第一次回答[1]', search: { sources: [{ title: '旧资料', url: 'https://old.example/a' }] } },
    { stage: 'requery', status: 'completed', result: '第二次回答[1]', search: { sources: [{ title: '新资料', url: 'https://new.example/b' }] } },
  ] };
  const answers = historyAnswerEntries(record);
  assert.equal(answers.length, 2);
  assert.equal(answers[0].answer, '第二次回答[1]');
  assert.equal(answers[0].search.sources[0].url, 'https://new.example/b');
  assert.equal(answers[1].answer, '第一次回答[1]');
  assert.equal(answers[1].search.sources[0].url, 'https://old.example/a');
});

test('旧记录无来源时不借用另一次搜索，也不要求 sourceId 才能打开网页', () => {
  const record = { id: 'old', mode: 'chat', aiResult: '旧回答[1]', attempts: [{ stage: 'ai', status: 'completed', result: '旧回答[1]' }] };
  assert.equal(historyAnswerEntries(record)[0].search, undefined);
  assert.deepEqual(citedSourceNumbers('旧回答[1]', []), []);
  assert.deepEqual(citedSourceNumbers('回答[1]与[3]，重复[1]', [{ url: 'https://example.com/a' }, { url: 'javascript:alert(1)' }, { url: 'https://example.com/c' }]), [1, 3]);
});

test('外部资料链接只允许无凭据的 HTTP(S)，清除敏感查询参数', () => {
  assert.equal(sourceHref('https://example.com/a?token=secret&lang=zh#part'), 'https://example.com/a?lang=zh');
  for (const url of ['javascript:alert(1)', 'file:///private', 'https://user:pass@example.com/a', '']) assert.equal(sourceHref(url), '');
});

test('来源预览使用保存的完整标题与安全链接，缺标题时显示域名', () => {
  assert.deepEqual(sourcePreview({ title: '  理想汽车官方公告  ', domain: '错误域名', url: 'https://ir.lixiang.com/news?api_key=private&id=1' }), {
    title: '理想汽车官方公告', domain: 'ir.lixiang.com', href: 'https://ir.lixiang.com/news?id=1',
  });
  assert.deepEqual(sourcePreview({ url: 'https://example.com/path' }), { title: 'example.com', domain: 'example.com', href: 'https://example.com/path' });
  assert.equal(sourcePreview({ title: '不可打开', url: 'file:///private' }).href, '');
});

test('本地图标经应用服务以 SVG 提供，不依赖外站图标请求', async () => {
  const server = createServer({ history: { cleanup: async () => {} }, provider: { simulated: true }, asr: { enabled: false } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/assets/source-page.svg`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await response.text(), /<svg/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
