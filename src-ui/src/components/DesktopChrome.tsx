import { useEffect, useRef, useState } from 'react';
import { desktopAvailable, desktopInvoke } from '../services/tauriBridge';

const choiceKey = 'talkcraft-close-choice-v1';
export function DesktopChrome({ hasUnsaved, waitForHistory }: { hasUnsaved: boolean; waitForHistory: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef({ hasUnsaved, waitForHistory, busy });
  current.current = { hasUnsaved, waitForHistory, busy };
  const choose = async (action: 'exit' | 'minimize', persist = remember) => {
    if (current.current.busy) return;
    setBusy(true);
    const previous = localStorage.getItem(choiceKey);
    try {
      if (persist) localStorage.setItem(choiceKey, action);
      if (action === 'exit') {
        await desktopInvoke('desktop_prepare_exit');
        await current.current.waitForHistory();
        await desktopInvoke('desktop_exit');
      } else await desktopInvoke('desktop_minimize');
      setOpen(false);
    } catch (cause) {
      if (action === 'exit') await desktopInvoke('desktop_restore_after_exit_failure').catch(() => {});
      if (previous === null) localStorage.removeItem(choiceKey); else localStorage.setItem(choiceKey, previous);
      setMessage(`操作失败：${String(cause)}；程序仍在运行，请重试`); setOpen(true);
    } finally { setBusy(false); }
  };
  const request = (force = false) => {
    if (current.current.busy) return;
    const saved = localStorage.getItem(choiceKey);
    if (!force && (saved === 'exit' || saved === 'minimize') && !(saved === 'exit' && current.current.hasUnsaved)) { void choose(saved, false); return; }
    setRemember(false);
    setMessage(current.current.hasUnsaved ? '退出将中断任务并丢失未保存录音，请先保存。最小化会继续在后台运行。' : '请选择退出程序或最小化到右下角托盘。');
    setOpen(true);
  };
  const requestRef = useRef(request); requestRef.current = request;
  useEffect(() => { const handler = (event: Event) => requestRef.current(Boolean((event as CustomEvent<{ force?: boolean }>).detail?.force)); window.addEventListener('talkcraft-close-request', handler); return () => window.removeEventListener('talkcraft-close-request', handler); }, []);
  if (!desktopAvailable()) return null;
  return <><div className="desktop-actions"><button onClick={() => void desktopInvoke('hud_window', { action: 'toggle' }).catch(cause => setMessage(String(cause)))}>悬浮条</button><button onClick={() => request(true)}>退出</button></div>{open && <div className="agreement-backdrop"><section className="agreement-dialog" role="dialog" aria-modal="true" aria-labelledby="close-title"><h2 id="close-title">关闭 TalkCraft？</h2><p>{message}</p><label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> 记住我的选择</label><div className="actions"><button disabled={busy} onClick={() => setOpen(false)}>取消</button><button disabled={busy} onClick={() => void choose('minimize')}>最小化窗口</button><button className="primary" disabled={busy} onClick={() => void choose('exit')}>退出程序</button></div></section></div>}</>;
}
