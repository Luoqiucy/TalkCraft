export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `请求失败（${response.status}）`);
  return body as T;
}

export async function postJson<T>(url: string, input: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `请求失败（${response.status}）`);
  return body as T;
}

export async function postStream<T>(url: string, input: unknown, signal: AbortSignal, onEvent: (event: Record<string, unknown>) => void, onDelta?: (text: string) => void): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === 'string' ? body.error : `Agent请求失败（${response.status}）`);
  }
  if (!response.body) return (await response.json()) as T;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  const consume = (line: string) => {
    if (!line.trim() || signal.aborted) return;
    const message = JSON.parse(line) as { type?: string; event?: Record<string, unknown>; data?: T; error?: string; text?: string };
    if (message.type === 'progress' && message.event) onEvent(message.event);
    if (message.type === 'answer_delta' && typeof message.text === 'string') onDelta?.(message.text);
    if (message.type === 'error') throw new Error(message.error || '请求失败');
    if (message.type === 'result') result = message.data;
  };
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) consume(line);
    if (chunk.done) break;
  }
  if (buffer.trim()) consume(buffer);
  signal.throwIfAborted();
  if (!result) throw new Error('请求没有返回结果');
  return result;
}
