import { randomUUID } from 'node:crypto';

const gatewayUrl = value => {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('开发账号网关地址只能是本机 HTTP 根地址');
  return url.origin;
};
const send = (res, status, value) => { if (res.writableEnded || res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

export function createDesktopCommercialBridge(baseUrl = process.env.TALKCRAFT_COMMERCIAL_URL || 'http://127.0.0.1:4330/') {
  const base = gatewayUrl(baseUrl);
  let token = '',identityBlocked=false;
  async function upstream(path, { method = 'GET', body, signal, headers = {}, authToken = token } = {}) {
    if (!base) return { status: 503, data: { error: '账号网关未配置；本机模式仍可使用' } };
    try {
      const reply = await fetch(`${base}${path}`, { method, body, signal: signal || AbortSignal.timeout(50_000), redirect: 'error', headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...headers } });
      const data = await reply.json().catch(() => ({}));
      return { status: reply.status, data };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { status: 503, data: { error: '账号网关暂不可连接；本次任务未切换到本机服务' } };
    }
  }
  async function status() {
    const health = await upstream('/health');
    if (health.status !== 200) return { available: false, signedIn: false, error: health.data.error };
    if (!token) return { available: true, signedIn: false, asrReady: health.data.asrReady === true, webSearchAvailable: health.data.webSearchAvailable === true };
    const account = await upstream('/me');
    if (account.status === 401) { token = '';identityBlocked=true; return { available: true, signedIn: false, sessionExpired: true }; }
    if (account.status !== 200) return { available: false, signedIn: false, error: account.data.error };
    return { available: true, signedIn: true, account: account.data.account, asrReady: health.data.asrReady === true, webSearchAvailable: health.data.webSearchAvailable === true };
  }
  async function identity(){if(!token)return identityBlocked?null:{kind:'guest'};const account=await upstream('/me');if(account.status===401){token='';identityBlocked=true;return null;}if(account.status!==200||typeof account.data.account?.id!=='string')return null;return {kind:'account',accountId:account.data.account.id,ownerId:`account:${account.data.account.id}`};}
  async function register(input) { return upstream('/auth/register', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } }); }
  async function login(input) {
    const reply = await upstream('/auth/login', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } });
    if (reply.status !== 200 || typeof reply.data.token !== 'string') return reply;
    token = reply.data.token;
    identityBlocked=false;
    return { status: 200, data: { account: reply.data.account, expiresInSeconds: reply.data.expiresInSeconds } };
  }
  async function logout() { const reply = token ? await upstream('/auth/logout', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }) : { status: 200, data: { loggedOut: true } }; token = '';identityBlocked=false; return reply; }
  async function syncMemories(input){if(!token)return {status:401,data:{error:'请先登录账号服务'}};return upstream('/me/memories/sync',{method:'POST',body:JSON.stringify(input),headers:{'Content-Type':'application/json'}});}
  async function usage() { if (!token) return { status: 401, data: { error: '请先登录账号服务' } }; return upstream('/me/usage'); }
  async function taskRequest(path, { body, headers, taskId, metric, signal }) {
    const authToken = token;
    const cancel = () => {
      if (!authToken) return;
      void upstream('/tasks/cancel', { method: 'POST', body: JSON.stringify({ taskId, metric }), headers: { 'Content-Type': 'application/json' }, authToken, signal: AbortSignal.timeout(5_000) }).catch(() => {});
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      signal?.throwIfAborted();
      return await upstream(path, { method: 'POST', body, headers, signal, authToken });
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  async function process(input, signal) {
    if (!token) return { status: 401, data: { error: '请先登录账号服务' } };
    const taskId = input.taskId || randomUUID();
    const reply = await taskRequest('/tasks/process', { body: JSON.stringify({ ...input, taskId, uploadConsent: input.cloudConsent === true }), headers: { 'Content-Type': 'application/json' }, taskId, metric: 'ai_characters', signal });
    if (reply.status !== 200) return reply;
    const value = reply.data.result;
    if (value?.answer?.text) {
      const search = value.result || {};
      const usedSourceIds = [...String(value.answer.text).matchAll(/\[(\d{1,2})\]/g)].map(match => search.sources?.[Number(match[1]) - 1]?.sourceId).filter(Boolean);
      return { status: 200, data: { ...value.answer, taskId, historyContext: { provider: 'TalkCraft 账号服务', model: '服务端模型' }, search: { ...search, allowed: true, usedSourceIds, totalElapsedMs: search.elapsedMs, progress: [] } } };
    }
    return { status: 200, data: { ...value, taskId, historyContext: { provider: 'TalkCraft 账号服务', model: '服务端模型' } } };
  }
  async function transcribe(pcm, headers, signal) {
    if (!token) return { status: 401, data: { error: '请先登录账号服务' } };
    const taskId = headers['x-talkcraft-task-id'] || randomUUID();
    const reply = await taskRequest('/tasks/transcribe', { body: pcm, signal, taskId, metric: 'asr_seconds', headers: { 'Content-Type': 'application/octet-stream', 'X-TalkCraft-Task-Id': taskId, 'X-Audio-Cloud-Consent': headers['x-audio-cloud-consent'] || '', 'X-Audio-Sample-Rate': headers['x-audio-sample-rate'] || '', 'X-Audio-Channels': headers['x-audio-channels'] || '', 'X-Audio-Bit-Depth': headers['x-audio-bit-depth'] || '' } });
    return reply.status === 200 ? { status: 200, data: { ...reply.data.result, taskId, historyContext: { provider: 'TalkCraft 账号服务', model: '服务端语音模型' } } } : reply;
  }
  return { status, identity, register, login, logout, usage, syncMemories, process, transcribe };
}

export function createDesktopCommercialHandler(bridge) {
  return async function handle(req, res) {
    if (!req.url?.startsWith('/api/commercial/')) return false;
    const expectedOrigin = `http://${req.headers.host}`;
    if (req.method === 'GET' ? req.headers.origin && req.headers.origin !== expectedOrigin : req.headers.origin !== expectedOrigin) { send(res, 403, { error: '仅允许工作台同源操作账号' }); return true; }
    const route = req.url.slice('/api/commercial/'.length);
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (req.method === 'GET' && route === 'status') { send(res, 200, await bridge.status()); return true; }
      if (req.method === 'GET' && route === 'usage') { const reply = await bridge.usage(); send(res, reply.status, reply.data); return true; }
      if (req.method === 'POST' && route === 'logout') { const reply = await bridge.logout(); send(res, reply.status, reply.data); return true; }
      if (req.method === 'POST' && ['register', 'login', 'process','memories-sync'].includes(route)) {
        if (req.headers['content-type'] !== 'application/json') { send(res, 400, { error: '需要 JSON 请求' }); return true; }
        let chunks = [], size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > (route === 'process'||route==='memories-sync' ? 300_000 : 16_384)) { send(res, 413, { error: '请求过大' }); return true; } chunks.push(chunk); }
        let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(res, 400, { error: 'JSON 格式无效' }); return true; }
        if (!input || typeof input !== 'object' || Array.isArray(input)) { send(res, 400, { error: '请求对象无效' }); return true; }
        const reply = route === 'register' ? await bridge.register(input) : route === 'login' ? await bridge.login(input) : route==='memories-sync'?await bridge.syncMemories(input):await bridge.process(input, controller.signal);
        send(res, reply.status, reply.data); return true;
      }
      if (req.method === 'POST' && route === 'transcribe') {
        if (req.headers['content-type'] !== 'application/octet-stream') { send(res, 400, { error: '需要 PCM 音频' }); return true; }
        let chunks = [], size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 3_840_000) { send(res, 413, { error: '音频过大' }); return true; } chunks.push(chunk); }
        const reply = await bridge.transcribe(Buffer.concat(chunks), req.headers, controller.signal);
        send(res, reply.status, reply.data); return true;
      }
      send(res, 404, { error: '账号接口不存在' }); return true;
    } catch (error) { if (!controller.signal.aborted) send(res, 502, { error: '账号服务请求失败' }); return true; }
  };
}
