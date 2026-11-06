import http from 'node:http';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { processText, validateRequest } from '../pipeline.mjs';
import { transcribeAudio, validatePcm } from '../asr.mjs';
import { answerDaisyQuestion } from '../agent/daisy-question.mjs';
import { resolveQuestionContext, validateContextEvidence, validateLocationCoordinates } from '../agent/question-context.mjs';
import { CommercialStoreError } from './sqlite-store.mjs';

const scrypt = promisify(scryptCallback);
const response = (res, code, value) => { if (res.writableEnded || res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
const month = () => { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(({ type, value }) => [type, value])); return `${parts.year}-${parts.month}`; };
const count = value => [...String(value).replace(/\s/gu, '')].length;
const taskKey = (accountId, taskId, metric) => `${accountId}:${taskId}:${metric}`;
const idValid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const fail = (code, message) => { throw new CommercialStoreError(code, message); };

async function readBody(req, maxBytes) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) fail('TOO_LARGE', '请求内容过大'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readJson(req, maxBytes = 16_384) {
  if (req.headers['content-type'] !== 'application/json') fail('INVALID_INPUT', '需要 JSON 请求');
  try {
    const body = JSON.parse((await readBody(req, maxBytes)).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_INPUT', '请求对象无效');
    return body;
  }
  catch (error) { if (error instanceof CommercialStoreError) throw error; fail('INVALID_INPUT', 'JSON 格式无效'); }
}
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) fail('INVALID_INPUT', '密码须为 12—256 个字符');
  const salt = randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${digest.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [salt, hex] = String(stored || '').split(':');
  if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const digest = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(digest, Buffer.from(hex, 'hex'));
}

export function createCommercialGateway({ store, provider, asr, limits, weatherTool, webpageTool, memorySyncEntitlement=async()=>false } = {}) {
  if (!store || !provider || provider.simulated === true || provider.local === true || !limits || !Number.isSafeInteger(limits.asr_seconds) || !Number.isSafeInteger(limits.ai_characters) || limits.asr_seconds < 0 || limits.ai_characters < 0) throw Error('商业网关需要真实云端提供器、数据库和显式额度配置');
  const inFlight = new Map(), attempts = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) fail('FORBIDDEN', '开发网关仅接受本机连接');
      if (req.headers.origin) fail('FORBIDDEN', '浏览器跨站请求不可调用账号网关');
      if (url.pathname === '/health' && req.method === 'GET') { response(res, 200, { ok: true, asrReady: asr?.enabled === true && asr.simulated !== true, webSearchAvailable: typeof provider.streamWithTools === 'function' }); return; }
      if (url.pathname === '/auth/register' && req.method === 'POST') {
        const body = await readJson(req);
        const account = store.createAccount(body.email, await passwordHash(body.password));
        response(res, 201, { account }); return;
      }
      if (url.pathname === '/auth/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown', now = Date.now(), recent = (attempts.get(ip) || []).filter(time => now - time < 600_000);
        if (recent.length >= 5) fail('RATE_LIMITED', '登录尝试过多，请稍后重试');
        recent.push(now); attempts.set(ip, recent);
        const body = await readJson(req);
        if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length > 256) fail('INVALID_INPUT', '登录参数无效');
        const account = store.accountByEmail(body.email);
        if (!account || account.status !== 'active' || !(await verifyPassword(body.password, account.password_hash))) fail('AUTH_FAILED', '账号或密码错误');
        attempts.delete(ip);
        const token = randomBytes(32).toString('hex');
        store.createSession(account.id, token, Date.now() + 86_400_000);
        response(res, 200, { token, expiresInSeconds: 86400, account: { id: account.id, email: account.email } }); return;
      }
      const auth = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
      const account = auth && store.accountForToken(auth[1]);
      if (!account) fail('UNAUTHORIZED', '请先登录');
      if (url.pathname === '/auth/logout' && req.method === 'POST') { store.revokeSession(auth[1]); response(res, 200, { loggedOut: true }); return; }
      if (url.pathname === '/me' && req.method === 'GET') { response(res, 200, { account: { id: account.id, email: account.email } }); return; }
      if (url.pathname === '/me/usage' && req.method === 'GET') {
        const periodId = month();
        response(res, 200, { periodId, scope: 'server', usage: { asr_seconds: store.usage(account.id, periodId, 'asr_seconds', limits.asr_seconds), ai_characters: store.usage(account.id, periodId, 'ai_characters', limits.ai_characters) } }); return;
      }
      if(url.pathname==='/me/memories/sync'&&req.method==='POST'){
        if(await memorySyncEntitlement(account)!==true)fail('FORBIDDEN','跨设备记忆同步尚未包含在已验证的账号权益中');
        const input=await readJson(req,300_000);const result=store.syncMemories(account.id,input);response(res,200,result);return;
      }
      if (url.pathname === '/tasks/cancel' && req.method === 'POST') {
        const body = await readJson(req);
        if (!idValid(body.taskId) || !['asr_seconds', 'ai_characters'].includes(body.metric)) fail('INVALID_INPUT', '任务参数无效');
        const key = taskKey(account.id, body.taskId, body.metric);
        inFlight.get(key)?.abort();
        const result = store.finish({ accountId: account.id, taskId: body.taskId, metric: body.metric, cancel: true });
        response(res, 200, result); return;
      }
      if (url.pathname === '/tasks/process' && req.method === 'POST') {
        const input = await readJson(req, 50_000);
        if (!idValid(input.taskId) || input.uploadConsent !== true || input.mode === 'dictation') fail('INVALID_INPUT', '任务 ID、上传确认或模式无效');
        try { validateRequest(input); } catch { fail('INVALID_INPUT', '文字任务参数无效'); }
        const locationCoordinates=validateLocationCoordinates(input.locationCoordinates,{consented:input.locationConsent===true}),contextual=input.mode==='chat'?resolveQuestionContext(input.text,input.history,{contextEvidence:validateContextEvidence(input.contextEvidence),sessionId:typeof input.sessionId==='string'?input.sessionId:'',taskId:input.taskId,locationCoordinates,locationConsent:input.locationConsent===true}):null;
        if(contextual?.request.needsClarification&&(contextual.request.action==='needs-clarification'||contextual.intent==='weather')){const text=contextual.clarificationQuestion||contextual.request.clarificationQuestion||'请补充一个必要信息后我再继续。';response(res,200,{taskId:input.taskId,result:{result:{taskId:input.taskId,tool:'none',performed:false,requested:false,status:'needs-input',sources:[],elapsedMs:0,attempts:0,toolCalls:0,toolTrace:[],quality:{intent:contextual.intent,sufficient:false,reason:'请求缺少必要字段，尚未调用模型、工具或扣减额度'},terminationReason:'awaiting-user-input',engine:'request-understanding',frameworks:{langchain:false,langgraph:false}},answer:{mode:'chat',text}}});return;}
        const memoryQuery=contextual?.intent==='personal-memory'?input.text:contextual?.request.resolvedQuestion||input.text;
        const personalMemories=input.mode==='chat'?store.relevantMemories(account.id,memoryQuery):[];
        const trustedInput={...input,personalMemories};delete trustedInput.ownerId;delete trustedInput.accountId;
        const metric = 'ai_characters', quantity = count(input.text);
        if (quantity < 1) fail('INVALID_INPUT', '文字为空');
        const key = taskKey(account.id, input.taskId, metric), periodId = month();
        const reservation = store.reserve({ accountId: account.id, taskId: input.taskId, metric, periodId, quantity, limit: limits.ai_characters });
        if (!reservation.created) fail('DUPLICATE_TASK', '任务已经提交，请勿重复调用供应商');
        const controller = new AbortController(); inFlight.set(key, controller);
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        try {
          if (res.destroyed) controller.abort();
          controller.signal.throwIfAborted();
          const questionInput = contextual ? { ...trustedInput, text: contextual.request.resolvedQuestion, originalText: contextual.original, request: contextual.request } : trustedInput;
          const canRunTools=input.webSearch===true||contextual?.intent==='personal-memory';
          const result = contextual && canRunTools && typeof provider.streamWithTools === 'function'
            ? await answerDaisyQuestion(provider, questionInput, { signal: controller.signal, weatherTool, webpageTool, taskId: input.taskId, prefetchPages: 4, prefetchTimeoutMs: 4000 })
            : await processText(contextual?{...questionInput,text:contextual.original}:input, provider, controller.signal);
          if(contextual?.request.sessionFacts?.length&&result&&typeof result==='object'&&!result.result)result.sessionFacts=contextual.request.sessionFacts;
          controller.signal.throwIfAborted();
          if (result.simulated === true || !String(result.answer?.text || result.text || '').trim()) fail('PROVIDER_UNAVAILABLE', '未取得真实有效的模型结果');
          store.finish({ accountId: account.id, taskId: input.taskId, metric, actualQuantity: quantity });
          response(res, 200, { taskId: input.taskId, result });
        } catch (error) { try { store.finish({ accountId: account.id, taskId: input.taskId, metric, cancel: true }); } catch {} throw error; }
        finally { inFlight.delete(key); }
        return;
      }
      if (url.pathname === '/tasks/transcribe' && req.method === 'POST') {
        if (!asr?.enabled || asr.simulated === true) fail('PROVIDER_UNAVAILABLE', '真实语音服务未配置');
        if (req.headers['content-type'] !== 'application/octet-stream' || req.headers['x-audio-cloud-consent'] !== 'true') fail('INVALID_INPUT', '需明确确认上传原始 PCM 音频');
        const taskId = req.headers['x-talkcraft-task-id'];
        if (!idValid(taskId)) fail('INVALID_INPUT', '任务 ID 无效');
        const pcm = await readBody(req, 3_840_000);
        const format = { sampleRate: Number(req.headers['x-audio-sample-rate']), channels: Number(req.headers['x-audio-channels']), bitDepth: Number(req.headers['x-audio-bit-depth']) };
        let duration;
        try { duration = validatePcm(pcm, format).duration; } catch { fail('INVALID_INPUT', '音频必须是有效的 16kHz 单声道 16bit PCM'); }
        const quantity = Math.ceil(duration), metric = 'asr_seconds';
        const key = taskKey(account.id, taskId, metric);
        const reservation = store.reserve({ accountId: account.id, taskId, metric, periodId: month(), quantity, limit: limits.asr_seconds });
        if (!reservation.created) fail('DUPLICATE_TASK', '任务已经提交，请勿重复调用供应商');
        const controller = new AbortController(); inFlight.set(key, controller);
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        try {
          if (res.destroyed) controller.abort();
          controller.signal.throwIfAborted();
          const result = await transcribeAudio(pcm, format, asr, controller.signal);
          controller.signal.throwIfAborted();
          if (result.simulated === true) fail('PROVIDER_UNAVAILABLE', '模拟识别不能产生正式用量');
          store.finish({ accountId: account.id, taskId, metric, actualQuantity: quantity });
          response(res, 200, { taskId, result });
        } catch (error) { try { store.finish({ accountId: account.id, taskId, metric, cancel: true }); } catch {} throw error; }
        finally { inFlight.delete(key); }
        return;
      }
      response(res, 404, { error: '接口不存在' });
    } catch (error) {
      const status = { UNAUTHORIZED: 401, AUTH_FAILED: 401, FORBIDDEN: 403, RATE_LIMITED: 429, ACCOUNT_EXISTS: 409, QUOTA_EXCEEDED: 402, DUPLICATE_TASK: 409, TASK_FINISHED: 409, TASK_NOT_FOUND: 404, TOO_LARGE: 413, PROVIDER_UNAVAILABLE: 503 }[error.code] || (error.name === 'AbortError' ? 499 : error instanceof CommercialStoreError || error.message?.includes('请选择') || error.message?.includes('请输入') ? 400 : 502);
      response(res, status, { error: status === 502 ? '服务暂时不可用' : error.message, code: error.code || (error.name === 'AbortError' ? 'CANCELLED' : 'REQUEST_FAILED') });
    }
  });
  return server;
}
