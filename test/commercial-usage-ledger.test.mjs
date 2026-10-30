import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsageLedger } from '../src/commercial/usage-ledger.mjs';

async function withLedger(run) {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-ledger-'));
  const path = join(directory, 'ledger.json');
  try { await run(createUsageLedger(path, { now: () => Date.parse('2026-09-29T12:00:00Z') }), path); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

const task = (taskId, quantity, accountId = 'account-a', periodId = '2026-09') => ({ accountId, taskId, metric: 'asr_seconds', periodId, quantity, limit: 10 });
const query = (accountId = 'account-a', periodId = '2026-09', limit = 10) => ({ accountId, periodId, metric: 'asr_seconds', limit });

test('并发预留只允许一笔占用最后额度；重复请求与重启不重复计量', async () => withLedger(async (ledger, path) => {
  const outcomes = await Promise.allSettled([ledger.reserve(task('a', 7)), ledger.reserve(task('b', 7))]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected' && item.reason.code === 'QUOTA_EXCEEDED').length, 1);
  const winner = outcomes[0].status === 'fulfilled' ? 'a' : 'b';
  assert.deepEqual(await ledger.reserve(task(winner, 7)), { created: false, status: 'reserved', taskId: winner });
  assert.deepEqual(await ledger.snapshot(query()), { ...query(), used: 0, reserved: 7, remaining: 3 });
  await assert.rejects(ledger.reserve(task(winner, 6)), { code: 'IDEMPOTENCY_CONFLICT' });
  const restarted = createUsageLedger(path);
  assert.equal((await restarted.snapshot(query())).reserved, 7);
  assert.equal((await restarted.reserve(task(winner, 7))).created, false);
  const raw = await readFile(path, 'utf8');
  assert.doesNotMatch(raw, /音频|转录正文|api[_-]?key|authorization/i);
}));

test('结算释放多余预留；重复结算、取消和迟到结果按任务状态处理', async () => withLedger(async ledger => {
  await ledger.reserve(task('complete', 8));
  assert.deepEqual(await ledger.settle({ accountId: 'account-a', taskId: 'complete', metric: 'asr_seconds', actualQuantity: 5 }), { settled: true, actual: 5, released: 3 });
  assert.equal((await ledger.snapshot(query())).remaining, 5);
  assert.equal((await ledger.settle({ accountId: 'account-a', taskId: 'complete', metric: 'asr_seconds', actualQuantity: 5 })).duplicate, true);
  await assert.rejects(ledger.settle({ accountId: 'account-a', taskId: 'complete', metric: 'asr_seconds', actualQuantity: 6 }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(ledger.cancel({ accountId: 'account-a', taskId: 'complete', metric: 'asr_seconds' }), { code: 'ALREADY_SETTLED' });
  await ledger.reserve(task('cancelled', 5));
  assert.deepEqual(await ledger.cancel({ accountId: 'account-a', taskId: 'cancelled', metric: 'asr_seconds' }), { cancelled: true, released: 5 });
  assert.equal((await ledger.cancel({ accountId: 'account-a', taskId: 'cancelled', metric: 'asr_seconds' })).duplicate, true);
  assert.equal((await ledger.snapshot(query())).remaining, 5);
  await assert.rejects(ledger.settle({ accountId: 'account-a', taskId: 'cancelled', metric: 'asr_seconds', actualQuantity: 3 }), { code: 'TASK_CANCELLED' });
  assert.equal((await ledger.reserve(task('cancelled', 5))).status, 'cancelled');
}));

test('账号与周期隔离，周期归属在预留时固定；降档不产生负余额', async () => withLedger(async ledger => {
  await ledger.reserve(task('same-id', 8));
  await ledger.reserve(task('same-id', 8, 'account-b'));
  await ledger.reserve(task('october-task', 8, 'account-a', '2026-10'));
  await ledger.settle({ accountId: 'account-a', taskId: 'same-id', metric: 'asr_seconds', actualQuantity: 8 });
  assert.deepEqual(await ledger.snapshot(query('account-a', '2026-09', 5)), { ...query('account-a', '2026-09', 5), used: 8, reserved: 0, remaining: 0 });
  assert.equal((await ledger.snapshot(query('account-b'))).reserved, 8);
  assert.equal((await ledger.snapshot(query('account-a', '2026-10'))).reserved, 8);
  await assert.rejects(ledger.reserve(task('same-id', 8, 'account-a', '2026-10')), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(ledger.settle({ accountId: 'account-a', taskId: 'same-id', metric: 'asr_seconds', actualQuantity: 9 }), { code: 'IDEMPOTENCY_CONFLICT' });
}));

test('超额结算与损坏账本均拒绝，避免未经确认的扣费', async () => withLedger(async (ledger, path) => {
  await ledger.reserve(task('task-1', 3));
  await assert.rejects(ledger.settle({ accountId: 'account-a', taskId: 'task-1', metric: 'asr_seconds', actualQuantity: 4 }), { code: 'RESERVATION_EXCEEDED' });
  assert.equal((await ledger.snapshot(query())).reserved, 3);
  await writeFile(path, '{bad-json', 'utf8');
  const reloaded = createUsageLedger(path);
  await assert.rejects(reloaded.reserve(task('task-2', 2)), { code: 'CORRUPT_DATA' });
  assert.equal(await readFile(path, 'utf8'), '{bad-json');
}));
