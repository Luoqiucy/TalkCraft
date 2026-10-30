export function citationSourceEntries(answer = '', sources = []) {
  const cited = new Set([...String(answer).matchAll(/\[(\d{1,2})\]/g)].map(match => Number(match[1])).filter(number => number > 0 && number <= sources.length));
  return sources.map((source, index) => ({ source, number: index + 1, cited: cited.has(index + 1) }));
}

export function groupToolEvents(events = []) {
  const unique = [];
  const seen = new Set();
  for (const event of events) {
    if (event?.eventId && seen.has(event.eventId)) continue;
    if (event?.eventId) seen.add(event.eventId);
    unique.push(event);
  }
  const groups = new Map();
  for (const [index, event] of unique.entries()) {
    if (!event?.tool) continue;
    const key = event.callId ? `${event.taskId || ''}\u0000${event.callId}` : `event:${event.eventId || index}`;
    const group = groups.get(key) || { key, taskId: event.taskId, callId: event.callId, tool: event.tool, events: [], sequence: event.sequence ?? Number.MAX_SAFE_INTEGER };
    group.events.push(event);
    group.sequence = Math.min(group.sequence, event.sequence ?? Number.MAX_SAFE_INTEGER);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const ordered = [...group.events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const terminal = [...ordered].reverse().find(event => event.status && event.status !== 'running');
    const start = ordered.find(event => event.status === 'running') || ordered[0];
    const elapsed = terminal?.elapsedMs ?? [...ordered].reverse().find(event => Number.isFinite(event.elapsedMs))?.elapsedMs;
    return { ...group, events: ordered, input: start?.input || ordered.find(event => event.input)?.input, status: terminal?.status || ordered.at(-1)?.status || '未记录', elapsedMs: elapsed, resultCount: [...ordered].reverse().find(event => Number.isFinite(event.resultCount))?.resultCount, error: terminal?.error, sequence: Number.isFinite(group.sequence) ? group.sequence : 0 };
  }).sort((a, b) => a.sequence - b.sequence);
}

export function taskStatusLabel(state, searchStatus, historical = false) {
  const known = { understanding: '正在准备查询', searching: '正在搜索资料…', reading: '正在读取资料…', weather: '正在查询天气…', answering: '正在整理回答…', completed: '已完成', failed: '查询失败', cancelled: '已取消', timeout: '查询超时', 'needs-confirmation': '等待你确认' };
  if (known[state] && state !== 'completed') return known[state];
  const labels = { searched: '搜索完成', 'no-results': '没有找到结果', 'read-failed': '网页读取失败', 'weather-data': '天气资料已获取', 'needs-input': '需要补充信息', timeout: '查询超时', cancelled: '已取消', failed: '查询失败', 'call-limit': '已达到查询次数上限' };
  if (searchStatus && labels[searchStatus]) return labels[searchStatus];
  if (state === 'completed') return '已完成';
  if (historical) return '此记录未保存执行过程';
  if (state === 'idle') return '尚未执行联网查询';
  return '处理中';
}
