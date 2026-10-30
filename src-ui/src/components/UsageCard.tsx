import { useEffect, useState } from 'react';
import { clearLocalUsage, loadLocalUsage, type LocalUsage } from '../services/localUsageClient';
import { commercialLogin, commercialLogout, commercialRegister, commercialStatus, commercialUsage, type CommercialStatus, type CommercialUsage } from '../services/commercialClient';

export function UsageCard({ refreshKey, commercialMode, onCommercialMode, onCommercialStatus, busy }: { refreshKey: number; commercialMode: boolean; onCommercialMode: (value: boolean) => void; onCommercialStatus: (value: CommercialStatus) => void; busy: boolean }) {
  const [usage, setUsage] = useState<LocalUsage | null>(null);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState('');
  const [account, setAccount] = useState<CommercialStatus | null>(null);
  const [serverUsage, setServerUsage] = useState<CommercialUsage | null>(null);
  const [accountError, setAccountError] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void loadLocalUsage(controller.signal).then(value => { if (!controller.signal.aborted) { setUsage(value); setError(''); } }).catch(() => { if (!controller.signal.aborted) setError('本机统计暂不可读取'); });
    return () => controller.abort();
  }, [refreshKey]);
  useEffect(() => {
    let mounted = true;
    void commercialStatus().then(value => {
      if (!mounted) return;
      setAccount(value); onCommercialStatus(value);
      if (value.signedIn) void commercialUsage().then(data => { if (mounted) setServerUsage(data); }).catch(() => { if (mounted) setAccountError('服务端额度暂不可读取'); });
      else setServerUsage(null);
    }).catch(() => { if (mounted) { setAccount({ available: false, signedIn: false }); setAccountError('账号服务暂不可连接'); } });
    return () => { mounted = false; };
  }, [refreshKey]);
  const month = usage?.thisMonth;
  const clear = async () => {
    if (!window.confirm('清空本机使用统计？这不会删除历史记录，也不会影响今后的统计。')) return;
    setClearing(true); setNotice('');
    try { await clearLocalUsage(); setUsage(await loadLocalUsage()); setError(''); setNotice('本机统计已清空'); }
    catch { setError('清空统计失败，原有数据仍保留'); }
    finally { setClearing(false); }
  };
  const submitAccount = async () => {
    setAccountBusy(true); setAccountError('');
    try {
      if (registering) { await commercialRegister(email.trim(), password); setRegistering(false); setNotice('账号已创建，请登录'); }
      else { await commercialLogin(email.trim(), password); const next = await commercialStatus(); setAccount(next); onCommercialStatus(next); setServerUsage(await commercialUsage()); setNotice('已登录账号服务；可自行选择是否使用账号额度'); }
    } catch (cause) { setAccountError(cause instanceof Error ? cause.message : '账号操作失败'); }
    finally { setPassword(''); setAccountBusy(false); }
  };
  const logout = async () => {
    setAccountBusy(true); setAccountError('');
    try { await commercialLogout(); const next = await commercialStatus(); setAccount(next); onCommercialStatus(next); setServerUsage(null); onCommercialMode(false); setNotice('已退出账号服务'); }
    catch (cause) { setAccountError(cause instanceof Error ? cause.message : '退出失败'); }
    finally { setAccountBusy(false); }
  };
  return <aside className="usage-sidebar" aria-label="使用统计">
    <section className="react-card usage-card"><div className="eyebrow">本机统计 · {usage?.month || '本月'}</div><h2>你的使用情况</h2>
      {error ? <p className="muted" role="status">{error}</p> : !month ? <p className="muted" role="status">正在读取统计…</p> : <dl>
        <div><dt title="成功识别的原始转录，排除空白；从本版开始统计">转写字数</dt><dd>{month.transcriptionCharacters.toLocaleString('zh-CN')} 字</dd></div>
        <div><dt title="成功完成的问答中，用户提问的字符数；排除空白">问答提问</dt><dd>{month.chatInputCharacters.toLocaleString('zh-CN')} 字</dd></div>
        <div><dt title="成功完成的问答中，AI回答的字符数；排除空白">AI 回答</dt><dd>{month.chatOutputCharacters.toLocaleString('zh-CN')} 字</dd></div>
        <div><dt title="成功转写的有效音频时长">口述时长</dt><dd>{(month.speechSeconds / 60).toFixed(1)} 分钟</dd></div>
      </dl>}
      <p className="muted">从本版起按成功任务统计；删除历史不会清空这些数量。此处不是会员额度或账单。</p>
      <button type="button" className="secondary" disabled={clearing || !usage} onClick={() => void clear()}>清空本机统计</button>{notice && <p className="muted" role="status">{notice}</p>}
    </section>
    <section className="react-card usage-card"><div className="eyebrow">账号服务 · 开发预览</div>
      {!account ? <p className="muted">正在检查账号服务…</p> : !account.available ? <><p className="muted">账号网关未连接。{commercialMode ? '本次任务会报错，不会自动切回本机配置。' : '当前仍可使用本机模式。'}账号、额度和购买尚未正式上线。</p>{commercialMode && <button type="button" className="secondary" disabled={busy} onClick={() => onCommercialMode(false)}>手动切回本机模式</button>}</> : account.signedIn ? <>
        <p className="account-email">{account.account?.email}</p>
        {serverUsage ? <><p className="muted">服务端记录 · {serverUsage.periodId}，仅用于开发测试</p><dl><div><dt>语音秒数</dt><dd>{serverUsage.usage.asr_seconds.used} / {serverUsage.usage.asr_seconds.limit}</dd></div><div><dt>AI 输入字符</dt><dd>{serverUsage.usage.ai_characters.used} / {serverUsage.usage.ai_characters.limit}</dd></div></dl></> : <p className="muted">服务端额度暂不可核对</p>}
        <label className="commercial-choice"><input type="checkbox" checked={commercialMode} disabled={busy || accountBusy || !serverUsage} onChange={event => onCommercialMode(event.target.checked)} /> 使用账号服务处理后续任务</label>
        <p className="muted">开启后，录音/文字发往账号网关及其供应商；失败不会改走本机 API。关闭则继续使用本机配置。登录仅在本次运行有效。</p>
        <button type="button" className="secondary" disabled={busy || accountBusy} onClick={() => void logout()}>退出账号</button>
      </> : <><p className="muted">登录后可测试服务端额度。当前无邮件验证或支付，勿使用常用密码。</p>{commercialMode && <button type="button" className="secondary" disabled={busy} onClick={() => onCommercialMode(false)}>手动切回本机模式</button>}
        <form className="account-form" onSubmit={event => { event.preventDefault(); void submitAccount(); }}><label>邮箱<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required /></label><label>密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={registering ? 'new-password' : 'current-password'} minLength={12} required /></label><button type="submit" disabled={accountBusy}>{registering ? '创建测试账号' : '登录'}</button></form>
        <button type="button" className="secondary" disabled={accountBusy} onClick={() => { setRegistering(!registering); setAccountError(''); }}>{registering ? '返回登录' : '创建账号'}</button>
      </>}
      {accountError && <p className="error-text" role="alert">{accountError}</p>}
    </section>
  </aside>;
}
