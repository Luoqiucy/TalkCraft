import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// This store is a single-process development implementation. Only an authenticated
// server may supply accountId and measured quantities; never expose it to clients.
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const metrics = new Set(['asr_seconds', 'ai_characters', 'search_calls']);
const validId = value => typeof value === 'string' && idPattern.test(value);
const validQuantity = value => Number.isSafeInteger(value) && value >= 0;
const keyFor = (accountId, taskId, metric) => `${accountId}:${taskId}:${metric}`;

export class UsageLedgerError extends Error {
  constructor(code, message) { super(message); this.name = 'UsageLedgerError'; this.code = code; }
}

function assert(value, code, message) {
  if (!value) throw new UsageLedgerError(code, message);
}

function validateIdentity({ accountId, taskId, metric }) {
  assert(validId(accountId) && validId(taskId) && metrics.has(metric), 'INVALID_INPUT', '无效的账号、任务或计量类型');
}

function validateState(state) {
  assert(state?.version === 1 && state.tasks && typeof state.tasks === 'object' && !Array.isArray(state.tasks) && Array.isArray(state.events), 'CORRUPT_DATA', '额度账本格式无效；不会覆盖已有数据');
  for (const [key, task] of Object.entries(state.tasks)) {
    assert(task && key === keyFor(task.accountId, task.taskId, task.metric) && validId(task.accountId) && validId(task.taskId) && metrics.has(task.metric) && validId(task.periodId) && validQuantity(task.reserved) && validQuantity(task.actual) && task.actual <= task.reserved && ['reserved', 'settled', 'cancelled'].includes(task.status), 'CORRUPT_DATA', '额度账本记录无效；不会覆盖已有数据');
  }
}

export function createUsageLedger(path, { now = () => Date.now() } = {}) {
  assert(typeof path === 'string' && path.length > 0, 'INVALID_INPUT', '必须显式指定服务端账本路径');
  let queue = Promise.resolve();
  let cached;
  let saveFailure = false;

  function serial(operation) {
    const current = queue.then(operation);
    queue = current.catch(() => {});
    return current;
  }

  async function load() {
    if (cached) return cached;
    try {
      const state = JSON.parse(await readFile(path, 'utf8'));
      validateState(state);
      cached = state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new UsageLedgerError('CORRUPT_DATA', '额度账本无法读取；不会覆盖已有数据');
      cached = { version: 1, tasks: {}, events: [] };
    }
    return cached;
  }

  async function commit(state) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
      cached = state;
      saveFailure = false;
    } catch (error) {
      saveFailure = true;
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  function totals(state, accountId, periodId, metric) {
    let used = 0;
    let reserved = 0;
    for (const task of Object.values(state.tasks)) {
      if (task.accountId !== accountId || task.periodId !== periodId || task.metric !== metric) continue;
      if (task.status === 'settled') used += task.actual;
      else if (task.status === 'reserved') reserved += task.reserved;
    }
    assert(Number.isSafeInteger(used + reserved), 'CORRUPT_DATA', '额度总数超出安全范围');
    return { used, reserved };
  }

  async function reserve({ accountId, taskId, metric, periodId, quantity, limit }) {
    validateIdentity({ accountId, taskId, metric });
    assert(validId(periodId) && validQuantity(quantity) && quantity > 0 && validQuantity(limit), 'INVALID_INPUT', '周期、预留数量或限额无效');
    return serial(async () => {
      const state = await load();
      const key = keyFor(accountId, taskId, metric);
      const previous = state.tasks[key];
      if (previous) {
        assert(previous.periodId === periodId && previous.reserved === quantity, 'IDEMPOTENCY_CONFLICT', '相同任务的预留参数发生冲突');
        return { created: false, status: previous.status, taskId };
      }
      const { used, reserved } = totals(state, accountId, periodId, metric);
      assert(quantity <= Math.max(0, limit - used - reserved), 'QUOTA_EXCEEDED', '本期额度不足');
      const at = new Date(now()).toISOString();
      const next = { ...state, tasks: { ...state.tasks, [key]: { accountId, taskId, metric, periodId, reserved: quantity, actual: 0, status: 'reserved', at } }, events: [...state.events, { eventId: randomUUID(), type: 'reserve', accountId, taskId, metric, periodId, quantity, at }] };
      await commit(next);
      return { created: true, status: 'reserved', taskId };
    });
  }

  async function settle({ accountId, taskId, metric, actualQuantity }) {
    validateIdentity({ accountId, taskId, metric });
    assert(validQuantity(actualQuantity), 'INVALID_INPUT', '实际数量无效');
    return serial(async () => {
      const state = await load();
      const key = keyFor(accountId, taskId, metric);
      const previous = state.tasks[key];
      assert(previous, 'TASK_NOT_FOUND', '未找到已预留的任务');
      if (previous.status === 'settled') {
        assert(previous.actual === actualQuantity, 'IDEMPOTENCY_CONFLICT', '相同任务的结算数量发生冲突');
        return { settled: false, duplicate: true, actual: previous.actual };
      }
      assert(previous.status === 'reserved', 'TASK_CANCELLED', '任务已取消，迟到结果不得结算');
      assert(actualQuantity <= previous.reserved, 'RESERVATION_EXCEEDED', '实际数量超过预留；需创建受控追加预留');
      const at = new Date(now()).toISOString();
      await commit({ ...state, tasks: { ...state.tasks, [key]: { ...previous, status: 'settled', actual: actualQuantity, finishedAt: at } }, events: [...state.events, { eventId: randomUUID(), type: 'settle', accountId, taskId, metric, periodId: previous.periodId, quantity: actualQuantity, released: previous.reserved - actualQuantity, at }] });
      return { settled: true, actual: actualQuantity, released: previous.reserved - actualQuantity };
    });
  }

  async function cancel({ accountId, taskId, metric }) {
    validateIdentity({ accountId, taskId, metric });
    return serial(async () => {
      const state = await load();
      const key = keyFor(accountId, taskId, metric);
      const previous = state.tasks[key];
      assert(previous, 'TASK_NOT_FOUND', '未找到已预留的任务');
      if (previous.status === 'cancelled') return { cancelled: false, duplicate: true, released: previous.reserved };
      assert(previous.status === 'reserved', 'ALREADY_SETTLED', '已结算任务不能通过取消退费');
      const at = new Date(now()).toISOString();
      await commit({ ...state, tasks: { ...state.tasks, [key]: { ...previous, status: 'cancelled', finishedAt: at } }, events: [...state.events, { eventId: randomUUID(), type: 'cancel', accountId, taskId, metric, periodId: previous.periodId, quantity: previous.reserved, at }] });
      return { cancelled: true, released: previous.reserved };
    });
  }

  async function snapshot({ accountId, periodId, metric, limit }) {
    assert(validId(accountId) && validId(periodId) && metrics.has(metric) && validQuantity(limit), 'INVALID_INPUT', '快照参数无效');
    return serial(async () => {
      if (saveFailure) throw new UsageLedgerError('SAVE_FAILED', '上次账本保存失败，无法确认余额');
      const { used, reserved } = totals(await load(), accountId, periodId, metric);
      return { accountId, periodId, metric, limit, used, reserved, remaining: Math.max(0, limit - used - reserved) };
    });
  }

  return { reserve, settle, cancel, snapshot };
}
