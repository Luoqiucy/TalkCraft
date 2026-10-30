import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalUsageStore, visibleCharacters } from '../src/local-usage.mjs';
import { createServer } from '../server.mjs';

test('本机统计只保存数量和任务ID，重启后仍可读取且同类任务不重复计算', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-usage-'));
  const path = join(directory, 'events.json');
  try {
    const store = createLocalUsageStore(path, { now: () => Date.parse('2026-09-28T12:00:00Z') });
    assert.equal(visibleCharacters('张家港 7 天\n天气'), 7);
    assert.deepEqual(await store.record({ taskId: 'task-1', kind: 'transcription', text: '张家港 7 天\n天气', speechSeconds: 5 }), { recorded: true });
    assert.deepEqual(await store.record({ taskId: 'task-1', kind: 'transcription', text: '重复识别', speechSeconds: 5 }), { recorded: false, duplicate: true });
    assert.deepEqual(await store.record({ taskId: 'task-1', kind: 'chat', text: '张家港天气？', answer: '今天有雨。' }), { recorded: true });
    const reloaded = createLocalUsageStore(path, { now: () => Date.parse('2026-09-28T12:00:00Z') });
    const usage = await reloaded.read();
    assert.equal(usage.billable, false);
    assert.equal(usage.month, '2026-09');
    assert.deepEqual(usage.thisMonth, { transcriptionCharacters: 7, chatInputCharacters: 6, chatOutputCharacters: 5, speechSeconds: 5, transcriptionTasks: 1, chatTasks: 1 });
    const raw = await readFile(path, 'utf8');
    assert.doesNotMatch(raw, /张家港|今天有雨/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('本机统计按上海时区分月，损坏文件不会被覆盖', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-usage-'));
  const path = join(directory, 'events.json');
  try {
    const store = createLocalUsageStore(path, { now: () => Date.parse('2026-09-30T16:30:00Z') });
    await store.record({ taskId: 'task-2', kind: 'transcription', text: '十月', speechSeconds: 2 });
    assert.equal((await store.read()).month, '2026-10');
    const september = createLocalUsageStore(path, { now: () => Date.parse('2026-09-30T15:30:00Z') });
    assert.equal((await september.read()).thisMonth.transcriptionCharacters, 0);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, '{bad-json', 'utf8');
    const damaged = createLocalUsageStore(path);
    await assert.rejects(damaged.record({ taskId: 'task-3', kind: 'chat', text: '测试', answer: '回答' }), /不会覆盖/);
    assert.equal(await readFile(path, 'utf8'), '{bad-json');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('真实接口成功后才累计，模拟识别与重复请求不增加本机统计', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-usage-http-'));
  const usageStore = createLocalUsageStore(join(directory, 'events.json'));
  const asr = { id: 'test-asr', enabled: true, simulated: false, async transcribe() { return '张家港天气'; } };
  const provider = { id: 'test-model', simulated: false, async complete() { return '今天有雨。'; } };
  const server = createServer({ usageStore, asr, provider, weatherTool: { enabled: false }, webpageTool: { enabled: false } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const pcm = Buffer.alloc(32000);
    const transcribe = () => fetch(`${base}/api/transcribe`, { method: 'POST', body: pcm, headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Sample-Rate': '16000', 'X-Audio-Channels': '1', 'X-Audio-Bit-Depth': '16', 'X-Audio-Cloud-Consent': 'true', 'X-TalkCraft-Task-Id': 'same-task' } });
    assert.equal((await transcribe()).status, 200);
    assert.equal((await transcribe()).status, 200);
    const ask = () => fetch(`${base}/api/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'chat', text: '张家港天气？', taskId: 'same-task', cloudConsent: true }) });
    assert.equal((await ask()).status, 200);
    assert.equal((await ask()).status, 200);
    asr.simulated = true;
    assert.equal((await fetch(`${base}/api/transcribe`, { method: 'POST', body: pcm, headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Sample-Rate': '16000', 'X-Audio-Channels': '1', 'X-Audio-Bit-Depth': '16', 'X-TalkCraft-Task-Id': 'mock-task' } })).status, 200);
    provider.simulated = true;
    assert.equal((await fetch(`${base}/api/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'chat', text: '模拟问题', taskId: 'mock-task', cloudConsent: true }) })).status, 200);
    const usage = await (await fetch(`${base}/api/local-usage`)).json();
    assert.equal(usage.allTime.transcriptionTasks, 1);
    assert.equal(usage.allTime.chatTasks, 1);
    assert.equal(usage.allTime.speechSeconds, 1);
    assert.equal(usage.allTime.chatInputCharacters, 6);
    assert.equal(usage.allTime.chatOutputCharacters, 5);
    assert.equal((await readFile(join(directory, 'events.json'), 'utf8')).includes('张家港'), false);
    assert.equal((await fetch(`${base}/api/local-usage/clear`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${base}/api/local-usage`)).status, 200);
    assert.equal((await fetch(`${base}/api/local-usage/clear`, { method: 'POST', headers: { Origin: base } })).status, 200);
    assert.equal((await (await fetch(`${base}/api/local-usage`)).json()).allTime.transcriptionTasks, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
