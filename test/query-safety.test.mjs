import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSearchEntity } from '../src/agent/query-safety.mjs';

test('明显语音残片在搜索前要求确认，不猜测正确地名', () => {
  const result = assessSearchEntity({ intent: 'weather', location: '是按长' });
  assert.equal(result.safe, false);
  assert.match(result.reason, /确认/);
});

test('正常地点和非天气问题不增加确认步骤', () => {
  assert.deepEqual(assessSearchEntity({ intent: 'weather', location: '张家港' }), { safe: true });
  assert.deepEqual(assessSearchEntity({ intent: 'general', location: '是按长' }), { safe: true });
});
