import { useEffect, useRef, useState } from 'react';
import { desktopAvailable, desktopInvoke } from '../services/tauriBridge';

type Target = { available: boolean; targetRevision?: number; title?: string; reason?: string };
export function OutputPanel({ text }: { text: string }) {
  const [message, setMessage] = useState('点击输入后有3秒切回目标窗口');
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const generation = useRef(0);
  const timer = useRef<number | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const clear = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; wake.current?.(); wake.current = null; };
  useEffect(() => () => { generation.current++; clear(); }, []);
  const cancel = () => { if (submitting) return; generation.current++; clear(); setBusy(false); setMessage('已取消输出，结果仍保留'); };
  const delay = (ms: number) => new Promise<void>(resolve => { wake.current = resolve; timer.current = window.setTimeout(() => { wake.current = null; timer.current = null; resolve(); }, ms); });
  const send = async () => {
    if (busy || !text.trim()) return;
    const ticket = ++generation.current; setBusy(true); setMessage('正在检查目标应用…');
    try {
      const target = await desktopInvoke<Target>('output_target');
      if (ticket !== generation.current) return;
      if (!target.available || !target.targetRevision) throw new Error(target.reason || '请先在目标应用中触发全局快捷键');
      await desktopInvoke('output_preflight', { text, targetRevision: target.targetRevision });
      if (ticket !== generation.current) return;
      for (let remaining = 3; remaining > 0; remaining--) { setMessage(`${remaining}秒后输入到「${target.title || '未命名窗口'}」，请切回目标窗口`); await delay(1000); if (ticket !== generation.current) return; }
      setSubmitting(true); setMessage('正在提交输入…');
      const outcome = await desktopInvoke<{ status?: string }>('output_send', { text, targetRevision: target.targetRevision });
      if (ticket === generation.current) setMessage(outcome.status === 'submitted' ? 'Windows已接受输入，请检查目标文字' : '输入结果异常，可能已部分写入；请先检查目标文字');
    } catch (cause) { if (ticket === generation.current) setMessage(`输入失败：${String(cause)}；结果已保留，不自动重试`); }
    finally { if (ticket === generation.current) { setBusy(false); setSubmitting(false); clear(); } }
  };
  if (!desktopAvailable()) return null;
  return <div className="output-send"><div className="actions"><button disabled={!text.trim() || busy} onClick={() => void send()}>输入到目标应用</button>{busy && <button disabled={submitting} onClick={cancel}>取消输出</button>}</div><p className="muted" role="status">{message}</p></div>;
}
