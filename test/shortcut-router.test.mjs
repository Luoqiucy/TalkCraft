import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRecordingShortcut } from '../src-ui/src/services/shortcutRouter.mjs';

test('记录中的问答收到单独的听写快捷键时只停止当前session并保留原模式', () => {
  const calls = [];
  const session = { state: 'recording', stop() { calls.push('stop'); this.state = 'stopping'; return true; } };
  const result = routeRecordingShortcut('dictation', {
    capture: 'recording', busy: false, session,
    start: mode => calls.push(`start:${mode}`),
    cancel: () => calls.push('cancel'),
  });
  assert.deepEqual(result, { kind: 'stop', result: true });
  assert.deepEqual(calls, ['stop']);
  assert.equal(session.state, 'stopping');
});

test('session状态优先于过期React快照，stopping时取消而不重复停止', () => {
  const calls = [];
  const result = routeRecordingShortcut('dictation', {
    capture: 'recording', busy: false,
    session: { state: 'stopping', stop() { calls.push('stop'); return false; } },
    cancel: () => { calls.push('cancel'); return true; },
  });
  assert.deepEqual(result, { kind: 'cancel', result: true });
  assert.deepEqual(calls, ['cancel']);
});

test('录音session已经开始但React尚未更新时，单Alt仍结束原session而不切换模式', () => {
  const calls = [];
  const result = routeRecordingShortcut('dictation', {
    capture: 'acquiring', busy: false,
    session: { state: 'recording', stop() { calls.push('stop'); return true; } },
    start: mode => calls.push(`start:${mode}`),
  });
  assert.deepEqual(result, { kind: 'stop', result: true });
  assert.deepEqual(calls, ['stop']);
});

test('空闲时调用用户绑定的模式；处理中取消；权限等待与停止中取消', () => {
  const calls = [];
  const session = { stop: () => { calls.push('stop'); return true; } };
  assert.equal(routeRecordingShortcut('translate', { capture: 'idle', busy: false, session, start: mode => { calls.push(`start:${mode}`); return true; } }).kind, 'start');
  assert.deepEqual(routeRecordingShortcut('chat', { capture: 'idle', busy: true, session, cancel: () => { calls.push('cancel:busy'); return true; } }), { kind: 'cancel', result: true });
  assert.deepEqual(routeRecordingShortcut('prompt', { capture: 'acquiring', busy: false, session, cancel: () => { calls.push('cancel:acquiring'); return true; } }), { kind: 'cancel', result: true });
  assert.deepEqual(routeRecordingShortcut('dictation', { capture: 'stopping', busy: false, session, cancel: () => { calls.push('cancel:stopping'); return true; } }), { kind: 'cancel', result: true });
  assert.deepEqual(calls, ['start:translate', 'cancel:busy', 'cancel:acquiring', 'cancel:stopping']);
});

test('插件管理快捷键以外的动作不会被当作录音模式执行', () => {
  let started = false;
  const result = routeRecordingShortcut('process', { capture: 'idle', busy: false, start: () => { started = true; } });
  assert.deepEqual(result, { kind: 'ignored', result: false });
  assert.equal(started, false);
});
