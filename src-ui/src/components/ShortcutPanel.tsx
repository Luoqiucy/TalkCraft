import { useEffect, useRef, useState } from 'react';
// @ts-expect-error Shared shortcut parsing has no declaration file.
import { shortcutFromKeyEvent } from '../../../public/live-state.mjs';
import { clipboardWrite, desktopAvailable, desktopInvoke } from '../services/tauriBridge';

type Shortcuts = { bindings: Record<string, string>; revision: number; status: string };
const names: Record<string, string> = { dictation: '听写', prompt: '提示词预设', translate: '翻译', chat: '问答', process: '处理当前文字', hud: '显示 / 隐藏悬浮条' };
const label = (value: string) => value === 'RightAltDouble' ? '右 Alt 快速双击' : value.replaceAll('RightAlt', '右 Alt').replaceAll('RightShift', '右 Shift').replaceAll('+', ' + ') || '已禁用';

export function ShortcutPanel() {
  const [saved, setSaved] = useState<Shortcuts | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(desktopAvailable() ? '正在读取快捷键…' : '全局快捷键需要桌面应用');
  const [busy, setBusy] = useState(false);
  const held = useRef<Record<string, { rightAlt: boolean; rightShift: boolean; lastRightAltUp: number }>>({});
  const focusedAction = useRef<string | null>(null);
  const publish = (value: Shortcuts) => window.dispatchEvent(new CustomEvent('talkcraft-shortcuts-updated', { detail: value.bindings }));
  const setEditorFocused = (focused: boolean) => { if (desktopAvailable()) void desktopInvoke('shortcuts_editor_focus', { focused }).catch(() => undefined); };
  const read = async () => { if (!desktopAvailable()) return; setBusy(true); try { const value = await desktopInvoke<Shortcuts>('shortcuts_read'); setSaved(value); setBindings(value.bindings); publish(value); setMessage(value.status); } catch (cause) { setMessage(String(cause)); } finally { setBusy(false); } };
  useEffect(() => { void read(); }, []);
  useEffect(() => () => setEditorFocused(false), []);
  useEffect(() => {
    const capture = (event: Event) => {
      const action = focusedAction.current;
      const binding = (event as CustomEvent<{ binding?: string }>).detail?.binding;
      if (!action || binding !== 'Alt+Space') return;
      setBindings(old => ({ ...old, [action]: binding }));
      setMessage('快捷键尚未保存');
    };
    window.addEventListener('talkcraft-shortcut-capture', capture);
    return () => window.removeEventListener('talkcraft-shortcut-capture', capture);
  }, []);
  useEffect(() => {
    const status = (event: Event) => setMessage((event as CustomEvent<string>).detail || '键盘监听状态未知');
    window.addEventListener('talkcraft-shortcuts-status', status);
    return () => window.removeEventListener('talkcraft-shortcuts-status', status);
  }, []);
  const save = async () => { if (!saved) return; setBusy(true); try { const value = await desktopInvoke<Shortcuts>('shortcuts_save', { bindings, revision: saved.revision }); setSaved(value); setBindings(value.bindings); publish(value); setMessage(value.status); } catch (cause) { setMessage(`保存失败：${String(cause)}`); } finally { setBusy(false); } };
  const copyDiagnostics = async () => { if (!desktopAvailable()) return; setBusy(true); try { const value = await desktopInvoke<Record<string, unknown>>('shortcuts_diagnostics'); await clipboardWrite(JSON.stringify(value, null, 2)); setMessage('快捷键诊断已复制，可粘贴给开发者查看'); } catch (cause) { setMessage(`读取诊断失败：${String(cause)}`); } finally { setBusy(false); } };
  const keyDown = (action: string, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.code === 'Tab') return;
    event.preventDefault(); event.stopPropagation(); if (event.repeat || busy) return;
    const state = held.current[action] ||= { rightAlt: false, rightShift: false, lastRightAltUp: 0 };
    let key: string | null;
    if (event.code === 'AltRight' && state.lastRightAltUp && Date.now() - state.lastRightAltUp <= 320) { key = 'RightAltDouble'; state.lastRightAltUp = 0; }
    else { if (event.code === 'AltRight') state.rightAlt = true; if (event.code === 'ShiftRight') state.rightShift = true; key = shortcutFromKeyEvent(event, state); }
    if (!key) { setMessage('请按功能键，或同时按下组合键'); return; }
    if (key.startsWith('RightAlt') && ['process', 'hud'].includes(action)) { setMessage('右侧 Alt 保留给录音模式'); return; }
    setBindings(old => ({ ...old, [action]: key })); setMessage('快捷键尚未保存');
  };
  return <section className="shortcut-settings"><h2>全局快捷键</h2><p className="muted">单键会占用正常输入；右 Alt 单击听写、双击提示词预设，长按打开独立中文指南。Windows 中 `Alt+Space` 在 TalkCraft 窗口获得焦点时优先由 TalkCraft 接管（窗口是否置顶不影响）；编辑快捷键时也可录入此组合，其他应用仍保留系统窗口菜单。</p><div className="shortcut-grid">{Object.entries(names).map(([action, name]) => <label key={action}>{name}<span><input value={label(bindings[action] || '')} readOnly disabled={!saved || busy} onFocus={() => { focusedAction.current = action; setEditorFocused(true); }} onKeyDown={event => keyDown(action, event)} onKeyUp={event => { const state = held.current[action]; if (!state) return; if (event.code === 'AltRight') { state.rightAlt = false; state.lastRightAltUp = Date.now(); } if (event.code === 'ShiftRight') state.rightShift = false; }} onBlur={() => { if (focusedAction.current === action) focusedAction.current = null; delete held.current[action]; setEditorFocused(false); }} /><button disabled={!saved || busy} onClick={() => setBindings(old => ({ ...old, [action]: '' }))} aria-label={`禁用${name}快捷键`}>清除</button></span></label>)}</div><div className="actions"><button className="primary" disabled={!saved || busy} onClick={() => void save()}>保存并启用</button><button disabled={busy} onClick={() => void read()}>重新读取</button><button disabled={busy} onClick={() => void copyDiagnostics()}>复制快捷键诊断</button></div><p className="muted">如果快捷键失效，请保持应用打开，在这里点击“复制快捷键诊断”并把复制结果发回；它只包含按键事件与录音状态，不包含录音和普通输入内容。</p><p className="live-status" role="status">{message}</p></section>;
}
