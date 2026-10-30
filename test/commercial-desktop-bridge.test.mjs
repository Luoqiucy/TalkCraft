import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommercialStore } from '../src/commercial/sqlite-store.mjs';
import { createCommercialGateway } from '../src/commercial/gateway.mjs';
import { createDesktopCommercialBridge } from '../src/commercial/desktop-bridge.mjs';
import { createServer } from '../server.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };

test('桌面同源桥接登录、真实路径任务与服务端额度；令牌不回到页面，断线不回退本机', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-desktop-account-'));
  const store = createCommercialStore(join(directory, 'accounts.sqlite'));
  const cloud = createCommercialGateway({ store, provider: { id: 'test-cloud', simulated: false, async complete() { return '服务端已处理'; } }, asr: { enabled: true, simulated: false, async transcribe() { return '服务端已转写'; } }, limits: { asr_seconds: 30, ai_characters: 30 } });
  await listen(cloud);
  const bridge = createDesktopCommercialBridge(`http://127.0.0.1:${cloud.address().port}/`);
  const desktop = createServer({ commercialBridge: bridge, provider: { id: 'local-fixture', simulated: true, async complete() { return '本机模拟结果'; } }, asr: { enabled: false } });
  await listen(desktop);
  const base = `http://127.0.0.1:${desktop.address().port}`;
  const post = async (path, input, origin = base) => fetch(`${base}/api/commercial/${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  try {
    assert.equal((await (await fetch(`${base}/api/commercial/status`)).json()).signedIn, false);
    assert.equal((await post('register', { email: 'desktop@example.com', password: 'desktop-test-password' }, 'https://evil.example')).status, 403);
    assert.equal((await post('register', { email: 'desktop@example.com', password: 'desktop-test-password' })).status, 201);
    const login = await (await post('login', { email: 'desktop@example.com', password: 'desktop-test-password' })).json();
    assert.equal(login.account.email, 'desktop@example.com');
    assert.equal(Object.hasOwn(login, 'token'), false);
    assert.equal((await (await fetch(`${base}/api/commercial/status`)).json()).signedIn, true);
    const answer = await (await post('process', { taskId: 'desktop-task', mode: 'chat', text: '南京今天天气', cloudConsent: true, webSearch: false })).json();
    assert.equal(answer.text, '服务端已处理');
    assert.equal(answer.historyContext.provider, 'TalkCraft 账号服务');
    assert.equal(JSON.stringify(answer).includes('本机模拟结果'), false);
    const pcm = Buffer.alloc(32_000);
    const audio = await fetch(`${base}/api/commercial/transcribe`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/octet-stream', 'X-TalkCraft-Task-Id': 'desktop-audio', 'X-Audio-Cloud-Consent': 'true', 'X-Audio-Sample-Rate': '16000', 'X-Audio-Channels': '1', 'X-Audio-Bit-Depth': '16' }, body: pcm });
    assert.equal((await audio.json()).text, '服务端已转写');
    const usage = await (await fetch(`${base}/api/commercial/usage`)).json();
    assert.equal(usage.scope, 'server');
    assert.equal(usage.usage.ai_characters.used, 6);
    assert.equal(usage.usage.asr_seconds.used, 1);
    await close(cloud);
    const failed = await post('process', { taskId: 'no-fallback', mode: 'chat', text: '不要回退', cloudConsent: true });
    assert.equal(failed.status, 503);
    assert.match((await failed.json()).error, /未切换到本机服务/);
    assert.equal((await post('logout', {})).status, 503);
    assert.equal((await (await fetch(`${base}/api/commercial/status`)).json()).signedIn, false);
  } finally { await close(desktop); if (cloud.listening) await close(cloud); store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('桌面任务中断会通知网关，释放预留额度且迟到结果不入账', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'talkcraft-desktop-cancel-'));
  const store = createCommercialStore(join(directory, 'accounts.sqlite'));
  let started;
  const providerStarted = new Promise(resolve => { started = resolve; });
  const cloud = createCommercialGateway({ store, provider: { id: 'test-cloud', simulated: false, async complete(_messages, { signal }) {
    started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    return '不应返回的答案';
  } }, limits: { asr_seconds: 30, ai_characters: 30 } });
  await listen(cloud);
  const bridge = createDesktopCommercialBridge(`http://127.0.0.1:${cloud.address().port}/`);
  try {
    assert.equal((await bridge.register({ email: 'cancel@example.com', password: 'desktop-test-password' })).status, 201);
    assert.equal((await bridge.login({ email: 'cancel@example.com', password: 'desktop-test-password' })).status, 200);
    const controller = new AbortController();
    const pending = bridge.process({ taskId: 'desktop-cancel', mode: 'chat', text: '查询天气', cloudConsent: true }, controller.signal).catch(error => error);
    await providerStarted;
    assert.equal((await bridge.usage()).data.usage.ai_characters.reserved, 4);
    controller.abort();
    await pending;
    let usage;
    for (let i = 0; i < 20; i++) {
      usage = (await bridge.usage()).data.usage.ai_characters;
      if (usage.reserved === 0) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(usage.reserved, 0);
    assert.equal(usage.used, 0);
    assert.equal(store.task(store.accountByEmail('cancel@example.com').id, 'desktop-cancel', 'ai_characters').state, 'cancelled');
  } finally { await close(cloud); store.close(); await rm(directory, { recursive: true, force: true }); }
});
