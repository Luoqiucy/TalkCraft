import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { historyDirectory } from './local-history.mjs';

const validTaskId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
export const visibleCharacters = value => [...String(value || '').replace(/\s/gu, '')].length;
const monthKey = date => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}`;
};
const emptyTotals = () => ({ transcriptionCharacters: 0, chatInputCharacters: 0, chatOutputCharacters: 0, speechSeconds: 0, transcriptionTasks: 0, chatTasks: 0 });

export function createLocalUsageStore(path = join(dirname(historyDirectory()), 'usage', 'events.json'), { now = () => Date.now() } = {}) {
  let queue = Promise.resolve();
  let cached;
  let saveFailure = false;
  async function load() {
    if (cached) return cached;
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.events) || value.events.some(event => !validTaskId(event.taskId) || !['transcription', 'chat'].includes(event.kind) || !Number.isFinite(event.characters) || !Number.isFinite(event.speechSeconds))) throw Error('统计数据格式无效');
      cached = value;
    } catch (error) {
      if (error.code !== 'ENOENT') throw Error('本机统计文件无法读取；不会覆盖已有数据');
      cached = { version: 1, events: [] };
    }
    return cached;
  }
  function serial(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  async function record({ taskId, kind, text, answer = '', speechSeconds = 0 }) {
    if (!validTaskId(taskId) || !['transcription', 'chat'].includes(kind)) return { recorded: false };
    const characters = visibleCharacters(text);
    if (!characters) return { recorded: false };
    return serial(async () => {
      const value = await load();
      if (value.events.some(event => event.taskId === taskId && event.kind === kind)) return { recorded: false, duplicate: true };
      const event = { taskId, kind, at: new Date(now()).toISOString(), characters, answerCharacters: kind === 'chat' ? visibleCharacters(answer) : 0, speechSeconds: kind === 'transcription' && Number.isFinite(speechSeconds) ? Math.max(0, Math.min(120, speechSeconds)) : 0 };
      const next = { version: 1, events: [...value.events, event] };
      try {
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        await writeFile(temporary, JSON.stringify(next), 'utf8');
        await rename(temporary, path);
        cached = next;
        saveFailure = false;
      } catch (error) {
        saveFailure = true;
        throw error;
      }
      return { recorded: true };
    });
  }
  async function read() {
    return serial(async () => {
      if (saveFailure) throw Error('本机统计保存失败，暂不能确认累计数字');
      const value = await load();
      const allTime = emptyTotals();
      const thisMonth = emptyTotals();
      const month = monthKey(new Date(now()));
      for (const event of value.events) {
        const targets = monthKey(new Date(event.at)) === month ? [allTime, thisMonth] : [allTime];
        for (const totals of targets) {
          if (event.kind === 'transcription') { totals.transcriptionCharacters += event.characters; totals.speechSeconds += event.speechSeconds; totals.transcriptionTasks++; }
          else { totals.chatInputCharacters += event.characters; totals.chatOutputCharacters += event.answerCharacters; totals.chatTasks++; }
        }
      }
      return { scope: 'local', billable: false, month, allTime, thisMonth };
    });
  }
  async function clear() {
    return serial(async () => {
      await load();
      const next = { version: 1, events: [] };
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(next), 'utf8');
      await rename(temporary, path);
      cached = next;
      saveFailure = false;
      return { cleared: true };
    });
  }
  return { record, read, clear };
}
