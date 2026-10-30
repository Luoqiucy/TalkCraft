import test from 'node:test';
import assert from 'node:assert/strict';
import { citationSourceEntries, groupToolEvents, taskStatusLabel } from '../src-ui/src/services/presentation.mjs';

test('citation display keeps the source number and stable source identity after prioritizing cited entries', () => {
  const sources = [
    { sourceId: 'source-a', url: 'https://a.example' },
    { sourceId: 'source-b', url: 'https://b.example' },
    { sourceId: 'source-c', url: 'https://c.example' },
  ];
  const entries = citationSourceEntries('答案引用[3]，也引用[1]。', sources);
  assert.deepEqual(entries.filter(item => item.cited).map(item => [item.number, item.source.sourceId]), [[1, 'source-a'], [3, 'source-c']]);
  assert.equal(entries[1].cited, false);
});

test('tool events group by task and call, deduplicate replayed events, and preserve parallel calls', () => {
  const events = [
    { eventId: 'e1', taskId: 'task-a', callId: 'call-1', sequence: 1, tool: 'search_web', status: 'running', input: { query: '南京天气' } },
    { eventId: 'e2', taskId: 'task-a', callId: 'call-2', sequence: 2, tool: 'search_web', status: 'running', input: { query: '南京今日天气' } },
    { eventId: 'e3', taskId: 'task-a', callId: 'call-1', sequence: 3, tool: 'search_web', status: 'completed', resultCount: 4, elapsedMs: 1200 },
    { eventId: 'e3', taskId: 'task-a', callId: 'call-1', sequence: 3, tool: 'search_web', status: 'completed', resultCount: 4, elapsedMs: 1200 },
    { eventId: 'e4', taskId: 'task-b', callId: 'call-1', sequence: 1, tool: 'read_webpage', status: 'failed', error: '读取失败' },
  ];
  const groups = groupToolEvents(events);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].status, 'completed');
  assert.equal(groups[0].resultCount, 4);
  assert.equal(groups[0].elapsedMs, 1200);
  assert.equal(groups[0].input.query, '南京天气');
  const otherTask = groups.find(group => group.taskId === 'task-b');
  assert.equal(otherTask.status, 'failed');
});

test('task summaries distinguish cancellation, timeout, failure, and old histories without traces', () => {
  assert.equal(taskStatusLabel('cancelled'), '已取消');
  assert.equal(taskStatusLabel('timeout'), '查询超时');
  assert.equal(taskStatusLabel('failed'), '查询失败');
  assert.equal(taskStatusLabel('idle', undefined, true), '此记录未保存执行过程');
});
