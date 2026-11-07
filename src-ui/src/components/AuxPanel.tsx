import { useEffect, useState } from 'react';
import { clipboardWrite, desktopAvailable, desktopInvoke } from '../services/tauriBridge';
import type { ConversationTurn } from '../services/conversationMemory';
import { AnswerText } from './AnswerText';
import { AnswerSources } from './AnswerSources';
import { readUserPreferences } from '../services/userPreferences';
import { setSpeechPreferences, speechController } from '../services/speech';
import './aux-panel.css';

type Panel = 'keymap' | 'chat';
type HudState = { type: 'state'; dark?: boolean; keymapBindings?: Record<string, string>; chatTurns?: ConversationTurn[]; mode?: string; output?: string; processing?: boolean };
const names: Record<string, string> = { dictation: '听写', prompt: '提示词预设', translate: '翻译', chat: '问答', process: '处理当前文字', hud: '显示 / 隐藏悬浮条' };
const formatKey = (key: string) => key === 'RightAltDouble' ? '右 Alt 快速双击' : key.replaceAll('RightAlt', '右 Alt').replaceAll('RightShift', '右 Shift').replaceAll('+', ' + ') || '已禁用';

export function AuxPanel({ panel }: { panel: Panel }) {
  const [state, setState] = useState<HudState | null>(null);
  const [connected, setConnected] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const session = (window as Window & { __TALKCRAFT_SESSION__?: string }).__TALKCRAFT_SESSION__ || 'legacy';
    const channel = new BroadcastChannel(`talkcraft-desktop-hud-v1-${session}`);
    let received = 0;
    const sync = () => channel.postMessage({ type: 'sync' });
    const onMessage = (event: MessageEvent<HudState>) => {
      if (event.data?.type !== 'state') return;
      received = Date.now(); setState(event.data); setConnected(true);
    };
    channel.addEventListener('message', onMessage);
    sync();
    const heartbeat = window.setInterval(() => { if (received && Date.now() - received > 5000) setConnected(false); sync(); }, 2000);
    return () => { window.clearInterval(heartbeat); channel.removeEventListener('message', onMessage); channel.close(); };
  }, []);
  useEffect(()=>{let active=true;const apply=(preferences:{interfaceLanguage:'zh-CN'|'en-US';speechVoiceURI:string;speechRate:number;speechVolume:number})=>{document.documentElement.dataset.uiLanguage=preferences.interfaceLanguage;setSpeechPreferences({voiceURI:preferences.speechVoiceURI,rate:preferences.speechRate,volume:preferences.speechVolume});};void readUserPreferences().then(({preferences})=>{if(active)apply(preferences);}).catch(()=>{});const channel=typeof BroadcastChannel==='undefined'?undefined:new BroadcastChannel('talkcraft-user-preferences-v1');const changed=(event:MessageEvent)=>{if(event.data?.preferences)apply(event.data.preferences);};channel?.addEventListener('message',changed);return()=>{active=false;channel?.removeEventListener('message',changed);channel?.close();speechController.stop();}},[]);
  useEffect(() => { document.documentElement.dataset.theme = state?.dark === false ? 'light' : 'dark'; }, [state?.dark]);
  const action = (name: 'hide' | 'drag') => { if (desktopAvailable()) void desktopInvoke('panel_window', { panel, action: name }).catch(() => {}); };
  const turns = state?.chatTurns ?? [];
  const text = turns.map(turn => (turn.role === 'user' ? '你问：' : '回答：') + turn.content).join('\n\n');
  const bindings = state?.keymapBindings || {};
  const copy = async () => { try { await clipboardWrite(text); setCopyStatus('已复制本次问答'); } catch { setCopyStatus('复制失败，请重试'); } };
  const copyAnswer = async (value: string) => { try { await clipboardWrite(value); setCopyStatus('已复制这次回答'); } catch { setCopyStatus('复制失败，请重试'); } };
  const openWorkbench = async () => { try { await desktopInvoke('panel_window', { panel: 'chat', action: 'main' }); setCopyStatus(''); } catch (cause) { setCopyStatus(`打开工作台失败：${cause instanceof Error ? cause.message : String(cause)}`); } };
  return <main className="aux-shell"><section className="aux-panel">
    <header onPointerDown={event => { if (!(event.target as HTMLElement).closest('button')) action('drag'); }}><div><strong>{panel === 'keymap' ? '快捷键提示' : '问答对话'}</strong><small>{panel === 'keymap' ? '按一次开始，再按一次结束' : '独立窗口'}</small></div><button aria-label="关闭窗口" title="关闭窗口" onClick={() => action('hide')}>×</button></header>
    {!connected && <p className="aux-connection" role="status">正在连接工作台…</p>}
    {panel === 'keymap' ? <><p className="aux-note">长按右 Alt 可再次打开</p><dl>{Object.entries(names).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Object.hasOwn(bindings, key) ? formatKey(bindings[key]) : '读取中…'}</dd></div>)}</dl></> : <><p className="aux-connection" role="status">{state?.processing && state.mode === '问答' ? '正在生成回答…' : text ? '本次问答' : '暂无问答内容'}</p><div className="aux-conversation" tabIndex={0} aria-label="本次问答">{turns.length ? turns.map((turn, index) => <section className={`aux-turn aux-turn-${turn.role}`} key={index === 0 ? turn.content : index}><b>{turn.role === 'user' ? '你问' : '回答'}</b>{turn.role === 'assistant' ? <><AnswerText result={{ text: turn.content, search: { sources: turn.sources || [] } }} /><AnswerSources answer={turn.content} search={{ sources: turn.sources || [] }} /><button className="aux-copy-answer" onClick={() => void copyAnswer(turn.content)}>复制这次回答</button></> : <p>{turn.content}</p>}</section>) : <AnswerText result={null} />}</div><footer><button disabled={!text} onClick={() => void copy()}>复制本次问答</button><button onClick={() => void openWorkbench()} disabled={!desktopAvailable()}>打开工作台</button></footer>{copyStatus && <p role="status" className="aux-connection">{copyStatus}</p>}</>}
  </section></main>;
}
