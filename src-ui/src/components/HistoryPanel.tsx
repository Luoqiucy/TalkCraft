import { useEffect, useRef, useState } from 'react';
// @ts-expect-error The established WAV conversion is shared with the native page.
import { decodeRecording } from '../../../public/audio.mjs';
import { getJson, postJson } from '../services/apiClient';
import { deleteHistory, listHistory, lockHistory, setHistorySettings, type HistoryPage, type HistoryRecord, type HistorySettings } from '../services/historyClient';
import { saveHistory } from '../services/historyClient';
import { askQuestion } from '../services/agentClient';
import { processText, recordingToPcm, transcribePcm } from '../services/audioClient';
import type { AgentTaskState, ServiceStatus, WorkMode } from '../types';
import { clipboardWrite, exportFile } from '../services/tauriBridge';
import { ExecutionTracePanel } from './ExecutionTracePanel';
import { HistoryAnswerSources } from './HistoryAnswerSources';
import { createMemory } from '../services/memoryClient';
import { AnswerText } from './AnswerText';

const modes: Record<string, string> = { dictation: '听写', prompt: '提示词预设', translate: '翻译', chat: '问答' };
const historyStatus: Record<string, string> = { completed: '已完成', success: '已完成', processing: '处理中', failed: '失败', 'ai-failed': 'AI处理失败', 'asr-failed': '转写失败', 'no-speech': '没有识别到语音', 'conversion-failed': '音频处理失败', cancelled: '已取消', timeout: '超时' };
const retention: Record<string, string> = { forever: '永远', year: '1年', month: '1个月', week: '1周', day: '24小时', none: '不保存' };
const rank: Record<string, number> = { forever: Infinity, year: 365, month: 30, week: 7, day: 1, none: 0 };
const dateGroup = (value?: string) => { const date = new Date(value || ''); const today = new Date(); today.setHours(0, 0, 0, 0); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1); return date >= today ? '今天' : date >= yesterday ? '昨天' : Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '日期未记录'; };
const exportName = (record: HistoryRecord, ext: string) => { const date = new Date(record.createdAt || ''); const stamp = Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}` : '未记录'; return `TalkCraft_${stamp}_${record.mode || 'unknown'}_${record.id.slice(0, 8)}.${ext}`; };
type Feedback = { type: string; description: string; expectedText: string; attachText: boolean; attachAudio: boolean; attachDiagnostic: boolean };
const emptyFeedback: Feedback = { type: 'recognition', description: '', expectedText: '', attachText: false, attachAudio: false, attachDiagnostic: false };

export function HistoryPanel({ revision = 0 }: { revision?: number }) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [selected, setSelected] = useState<HistoryRecord | null>(null);
  const [jumpToSources, setJumpToSources] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletedId, setDeletedId] = useState('');
  const [settings, setSettings] = useState<HistorySettings | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [feedbackRecord, setFeedbackRecord] = useState<HistoryRecord | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(emptyFeedback);
  const [diagnostic, setDiagnostic] = useState('');
  const [feedbackId, setFeedbackId] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [memoryDraft,setMemoryDraft]=useState<{record:HistoryRecord;content:string;reason:string;type:'preference'|'fact'|'project'|'term'}|null>(null);
  const sequence = useRef(0);
  const appliedQuery = useRef('');
  const diagnosticController = useRef<AbortController | null>(null);
  const retryController = useRef<AbortController | null>(null);
  const [retrying, setRetrying] = useState(false);
  const undoTimer = useRef<number | null>(null);

  const load = async (append = false, search = query, filter = mode) => {
    if (!append) appliedQuery.current = search;
    const ticket = ++sequence.current;
    setLoading(true); setError('');
    try {
      const result = await listHistory(search.trim(), filter, append ? records.length : 0);
      if (ticket !== sequence.current) return;
      setPage(result); setRecords(previous => append ? [...previous, ...result.records] : result.records);
      setSelected(previous => result.records.find(item => item.id === previous?.id) || (append ? previous : null));
      if (!settingsDirty) setSettings(result.settings);
    } catch (cause) { if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : '历史读取失败'); }
    finally { if (ticket === sequence.current) setLoading(false); }
  };
  useEffect(() => { void load(false, appliedQuery.current, mode); return () => { sequence.current++; }; }, [mode, revision]);
  useEffect(() => { if (jumpToSources && selected?.id === jumpToSources) { document.getElementById(`history-sources-${jumpToSources}`)?.scrollIntoView({ block: 'start' }); setJumpToSources(''); } }, [jumpToSources, selected?.id]);
  useEffect(() => () => { diagnosticController.current?.abort(); retryController.current?.abort(); if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);
  const copy = async (value?: string | null) => { if (!value) return; try { await clipboardWrite(value); setNotice('已复制全文'); } catch { setError('复制失败，请手动选择文字'); } };
  const remove = async () => { if (!selected) return; try { await deleteHistory(selected.id); setDeletedId(selected.id); setSelected(null); setNotice('记录已删除，5秒内可撤销'); await load(); if (undoTimer.current) window.clearTimeout(undoTimer.current); undoTimer.current = window.setTimeout(() => setDeletedId(''), 5000); } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败'); } };
  const undo = async () => { if (!deletedId) return; try { await deleteHistory(deletedId, true); setDeletedId(''); setNotice('已撤销删除'); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : '撤销失败'); } };
  const exportAudio = async (record: HistoryRecord, wav = false) => {
    if (!record.audio) return;
    setNotice('正在导出录音…');
    await lockHistory(record.id, true);
    try {
      const response = await fetch(`/api/history/audio?id=${encodeURIComponent(record.id)}`);
      if (!response.ok) throw new Error((await response.json()).error || '录音读取失败');
      const blob = await response.blob();
      const bytes = wav ? (await decodeRecording(blob)).wav as ArrayBuffer : await blob.arrayBuffer();
      const outcome = await exportFile(exportName(record, wav ? 'wav' : record.audio.ext || 'audio'), bytes);
      setNotice(outcome === 'saved' ? '导出完成' : '已取消导出');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败'); }
    finally { await lockHistory(record.id, false).catch(() => setError('录音导出锁释放失败，请重试')); }
  };
  const saveSettings = async () => {
    if (!settings || !page) return;
    const shorter = ['textRetention', 'audioRetention'].some(key => rank[settings[key as keyof HistorySettings] as string] < rank[page.settings[key as keyof HistorySettings] as string]);
    if (shorter && !window.confirm(`缩短保留期限可能清理最多 ${page.total} 条记录中的相应文字或音频。是否继续？`)) return;
    try { await setHistorySettings({ ...settings, confirmed: shorter }); setSettingsDirty(false); setNotice('设置已保存。关闭今后保存不会删除已有历史'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '设置保存失败'); }
  };
  const clear = async () => { if (!window.confirm('清空全部本机历史文字及关联录音？此操作无法撤销，主动导出的副本不受影响。')) return; try { await postJson('/api/history/clear', { confirmed: true }); setSelected(null); setNotice('本机历史已清空'); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : '清空失败'); } };
  const saveMemoryFromHistory=async()=>{if(!memoryDraft)return;if(!memoryDraft.content.trim()||!memoryDraft.reason.trim()){setError('记忆内容和“为什么记住”都需要填写');return;}try{await createMemory({type:memoryDraft.type,content:memoryDraft.content.trim(),reason:memoryDraft.reason.trim(),sourceRecordId:memoryDraft.record.id,independent:false,syncSelected:false});setMemoryDraft(null);setNotice('已从这条历史明确保存个人记忆；删除来源历史时会联动删除');setError('');}catch(cause){setError(cause instanceof Error?cause.message:'保存记忆失败');}};
  const openFeedback = (record: HistoryRecord) => { setFeedbackRecord(record); setFeedback(emptyFeedback); setFeedbackId(''); setDiagnostic(''); };
  const closeFeedback = () => { diagnosticController.current?.abort(); setFeedbackRecord(null); };
  const runDiagnostic = async () => {
    if (!feedbackRecord) return;
    diagnosticController.current?.abort(); const active = new AbortController(); diagnosticController.current = active; setDiagnostic('正在本地检查…');
    try {
      const result = await getJson<Record<string, unknown>>(`/api/history/diagnostic?id=${encodeURIComponent(feedbackRecord.id)}`, active.signal);
      active.signal.throwIfAborted();
      if (result.audioExists && result.decodable === null) {
        const response = await fetch(`/api/history/audio?id=${encodeURIComponent(feedbackRecord.id)}`, { signal: active.signal });
        if (!response.ok) throw new Error('录音无法读取');
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(await response.arrayBuffer()); active.signal.throwIfAborted();
          let sum = 0, peak = 0, clipped = 0;
          for (let channel = 0; channel < decoded.numberOfChannels; channel++) for (const value of decoded.getChannelData(channel)) { sum += value * value; peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) >= .999) clipped++; }
          const count = decoded.length * decoded.numberOfChannels; const rms = Math.sqrt(sum / count);
          const extra = { id: feedbackRecord.id, decodable: true, decodedSampleRate: decoded.sampleRate, decodedChannels: decoded.numberOfChannels, decodedDuration: decoded.duration, rms, peak, clippedRatio: clipped / count, nearSilence: rms < .005 };
          active.signal.throwIfAborted(); await postJson('/api/history/diagnostic-store', extra, active.signal); Object.assign(result, extra);
        } finally { await context.close().catch(() => {}); }
      }
      active.signal.throwIfAborted(); setDiagnostic(JSON.stringify(result, null, 2));
    } catch (cause) { if (diagnosticController.current === active) setDiagnostic(active.signal.aborted ? '诊断已取消，可以继续保存反馈' : `诊断失败，可以继续保存反馈：${cause instanceof Error ? cause.message : '未知错误'}`); }
  };
  const saveFeedback = async () => {
    if (!feedbackRecord || !feedback.description.trim() || feedbackBusy) return;
    const summary = `将保存问题类型、描述、期望文字、记录ID${feedback.attachText ? '、完整文字' : ''}${feedback.attachAudio ? '、录音' : ''}${feedback.attachDiagnostic ? '、本地诊断' : ''}。仅保存在本机，尚未发送。`;
    if (!window.confirm(summary)) return;
    setFeedbackBusy(true);
    try { const id = feedbackId || crypto.randomUUID(); const result = await postJson<{ id: string; saved: boolean; sent: boolean }>('/api/history/feedback', { feedbackId: id, recordId: feedbackRecord.id, ...feedback }); setFeedbackId(result.id); setNotice('反馈已保存在本机，尚未发送'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '反馈保存失败'); }
    finally { setFeedbackBusy(false); }
  };
  const exportFeedback = async () => { if (!feedbackId) return; try { const response = await fetch(`/api/history/feedback-package?id=${encodeURIComponent(feedbackId)}`); if (!response.ok) throw new Error((await response.json()).error || '反馈包读取失败'); await exportFile(`TalkCraft_feedback_${feedbackId.slice(0, 8)}.zip`, await response.arrayBuffer()); } catch (cause) { setError(cause instanceof Error ? cause.message : '反馈包导出失败'); } };
  const retry = async (record: HistoryRecord, kind: 'asr' | 'ai' | 'requery') => {
    if (retrying) return;
    if (!window.confirm(kind === 'asr' ? '重新识别此录音？可能调用已配置的云端语音服务。' : kind === 'requery' ? '重新联网查询？可能调用云端搜索和文字服务。' : '使用已有文字重试 AI 处理？可能调用云端文字服务。')) return;
    const active = new AbortController(); retryController.current = active; setRetrying(true); setError(''); setNotice('正在重试；已有文字和录音不会被清除');
    const started = Date.now();
    try {
      const status = await getJson<ServiceStatus>('/api/status', active.signal);
      const consent = localStorage.getItem('talkcraft-agreement-v1') === 'accepted';
      if (!consent) throw new Error('请先在工作台阅读并同意使用说明');
      if (kind === 'asr') {
        if (!record.audio || !status.audioTranscription) throw new Error('没有可用录音或语音识别服务');
        await saveHistory({ id: record.id, mode: record.mode, status: 'transcribing' });
        const response = await fetch(`/api/history/audio?id=${encodeURIComponent(record.id)}`, { signal: active.signal });
        if (!response.ok) throw new Error((await response.json()).error || '录音读取失败');
        const audio = await recordingToPcm(await response.blob(), active.signal);
        const result = await transcribePcm(audio.pcm, consent, active.signal);
        active.signal.throwIfAborted();
        await saveHistory({ id: record.id, mode: record.mode, status: 'transcribed', originalTranscript: result.text, error: '', attempt: { stage: 'asr', status: 'completed', transcript: result.text, elapsedMs: Date.now() - started, provider: result.historyContext?.provider, model: result.historyContext?.model } });
      } else {
        const text = record.revisedText || record.originalTranscript;
        if (!text) throw new Error('没有可重试的文字');
        if (kind === 'requery' && (!status.webSearchAvailable && !status.weatherAvailable)) throw new Error('当前服务没有联网工具');
        await saveHistory({ id: record.id, mode: record.mode, status: 'processing' });
        const result = record.mode === 'chat' ? await askQuestion(text, { cloudConsent: consent, webSearch: kind === 'requery' || record.webSearchAllowed === true, status }, active.signal, () => {}) : await processText({ mode: record.mode, text, targetLanguage: record.targetLanguage || 'en', tone: 'business', cloudConsent: consent }, active.signal);
        active.signal.throwIfAborted();
        await saveHistory({ id: record.id, mode: record.mode, status: 'completed', aiResult: result.text, error: '', simulated: result.simulated === true, attempt: { stage: kind, status: 'completed', result: result.text, elapsedMs: Date.now() - started, provider: result.historyContext?.provider, model: result.historyContext?.model, search: 'search' in result ? result.search : undefined } });
      }
      setNotice('重试已完成，旧结果与尝试记录仍保留'); await load();
    } catch (cause) {
      const cancelled = active.signal.aborted;
      await saveHistory({ id: record.id, mode: record.mode, status: cancelled ? 'cancelled' : kind === 'asr' ? 'asr-failed' : 'ai-failed', error: cancelled ? '用户取消重试' : cause instanceof Error ? cause.message : '重试失败', attempt: { stage: kind, status: cancelled ? 'cancelled' : 'failed', elapsedMs: Date.now() - started } }).catch(() => {});
      if (!cancelled) setError(cause instanceof Error ? cause.message : '重试失败'); else setNotice('重试已取消');
      await load();
    } finally { if (retryController.current === active) retryController.current = null; setRetrying(false); }
  };

  let lastGroup = '';
  const trace = [...(selected?.attempts || [])].reverse().find(item => item.search)?.search;
  const traceState: AgentTaskState = trace?.status === 'cancelled' ? 'cancelled' : trace?.status === 'timeout' ? 'timeout' : trace?.status === 'failed' || trace?.status === 'read-failed' ? 'failed' : trace?.status === 'needs-input' ? 'needs-confirmation' : trace ? 'completed' : 'idle';
  return <section className="history-react"><div className="history-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(); }} placeholder="搜索历史" /><select value={mode} onChange={event => setMode(event.target.value)}><option value="all">全部模式</option>{Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button onClick={() => void load()}>搜索</button></div>
    <p className="muted">历史保存在本机，未加密。云端识别会上传音频，云端文字服务会上传文字。{page?.directory && `保存位置：${page.directory}`}</p>
    {notice && <p className="live-status" role="status">{notice}</p>}{deletedId && <button onClick={() => void undo()}>撤销删除</button>}{error && <p className="error-text" role="alert">{error}</p>}
    {loading && <p className="muted">正在读取本机历史…</p>}{!loading && !records.length && <p className="muted">{query || mode !== 'all' ? '没有符合条件的记录' : '暂无历史记录'}</p>}
    {!!records.length && <div className="history-columns"><div className="history-list">{records.map(record => { const group = dateGroup(record.createdAt); const heading = group !== lastGroup; lastGroup = group; return <div key={record.id}>{heading && <h3>{group}</h3>}<article className={selected?.id === record.id ? 'history-item selected' : 'history-item'}><button className="history-open" onClick={() => setSelected(record)}><b>{modes[record.mode || ''] || '未知模式'} · {historyStatus[record.status || ''] || (record.status ? '状态未知' : '状态未记录')}</b><span>{record.createdAt ? new Date(record.createdAt).toLocaleTimeString('zh-CN') : '时间未记录'}</span><p>{(record.originalTranscript || record.revisedText || record.aiResult || record.error || '没有文字结果').slice(0, 130)}</p></button><div className="history-row-actions">{record.mode === 'chat' && record.attempts?.some(attempt => attempt.search?.sources?.length) && <button onClick={() => { setSelected(record); setJumpToSources(record.id); }}>查看资料来源</button>}<button disabled={!record.originalTranscript && !record.revisedText} onClick={() => void copy(record.originalTranscript || record.revisedText)}>复制转录</button><button onClick={() => openFeedback(record)}>反馈</button><details><summary>更多</summary><button disabled={!record.audio} title={record.audioReason || ''} onClick={() => void exportAudio(record)}>导出音频…</button><button onClick={() => setSelected(record)}>查看详情</button></details></div></article></div>; })}{page && records.length < page.total && <button onClick={() => void load(true, appliedQuery.current)} disabled={loading}>加载更多</button>}</div>
      <article className="react-card history-detail"><h2>{selected ? `${modes[selected.mode || ''] || '历史记录'} · ${historyStatus[selected.status || ''] || (selected.status ? '状态未知' : '状态未记录')}` : '选择一条记录'}</h2>{selected && <>
        {selected.status && !['completed','success','ai-completed'].includes(selected.status) && selected.error && <p className="history-record-error" role="alert">{selected.error}</p>}
        {selected.mode === 'chat' ? <>
          <section className="history-question"><b>你的问题</b><p>{selected.revisedText || selected.originalTranscript || '问题文字未记录'}</p></section>
          <HistoryAnswerSources record={selected} onCopy={text => void copy(text)} />
          <ExecutionTracePanel state={traceState} events={trace?.progress?.length ? trace.progress : trace?.toolTrace || []} sources={[]} search={trace} showSources={false} historical />
          <details className="history-record-details"><summary>转录、录音与记录信息</summary>
            <section className="history-transcript-detail"><b>原始转录</b><pre>{selected.originalTranscript ?? '未记录'}</pre><button disabled={!selected.originalTranscript} onClick={() => void copy(selected.originalTranscript)}>复制原始转录</button></section>
            {selected.revisedText && selected.revisedText !== selected.originalTranscript && <section className="history-transcript-detail"><b>用户修订</b><pre>{selected.revisedText}</pre><button onClick={() => void copy(selected.revisedText)}>复制修订文本</button></section>}
            <p className="muted">录音时长：{selected.duration === undefined ? '未记录' : `${selected.duration.toFixed(2)}秒`} · 音频：{selected.audio ? `${selected.audio.ext} · ${selected.audio.size}字节` : selected.audioReason || '未保存'} · 记录时间：{selected.createdAt ? new Date(selected.createdAt).toLocaleString('zh-CN') : '未记录'}</p>
            {selected.audio && <><audio controls src={`/api/history/audio?id=${encodeURIComponent(selected.id)}`} /><div className="actions"><button onClick={() => void exportAudio(selected)}>导出原始音频…</button><button onClick={() => void exportAudio(selected, true)}>转换并导出 WAV…</button></div></>}
          </details>
        </> : <>
          <section className="history-question"><b>本次输入</b><p>{selected.originalTranscript || selected.revisedText || '输入文字未记录'}</p></section>
          <section className="history-result"><h3>处理结果{selected.simulated ? '（模拟）' : ''}</h3><AnswerText result={selected.aiResult ? { text: selected.aiResult } : null} enableSpeech={selected.status==='completed'} />{selected.aiResult && <button onClick={() => void copy(selected.aiResult)}>复制 AI 结果</button>}</section>
          {selected.error && <p className="history-record-error" role="alert">{selected.error}</p>}
          <details className="history-record-details"><summary>转录与录音详情</summary>
            <section className="history-transcript-detail"><b>原始转录</b><pre>{selected.originalTranscript ?? '未记录'}</pre><button disabled={!selected.originalTranscript} onClick={() => void copy(selected.originalTranscript)}>复制原始转录</button></section>
            {selected.revisedText && selected.revisedText !== selected.originalTranscript && <section className="history-transcript-detail"><b>用户修订</b><pre>{selected.revisedText}</pre><button onClick={() => void copy(selected.revisedText)}>复制修订文本</button></section>}
            <p className="muted">录音时长：{selected.duration === undefined ? '未记录' : `${selected.duration.toFixed(2)}秒`} · 翻译目标：{selected.targetLanguage || '未记录'} · 音频：{selected.audio ? `${selected.audio.ext} · ${selected.audio.size}字节` : selected.audioReason || '未保存'} · 记录时间：{selected.createdAt ? new Date(selected.createdAt).toLocaleString('zh-CN') : '未记录'}</p>
            {selected.audio && <><audio controls src={`/api/history/audio?id=${encodeURIComponent(selected.id)}`} /><div className="actions"><button onClick={() => void exportAudio(selected)}>导出原始音频…</button><button onClick={() => void exportAudio(selected, true)}>转换并导出 WAV…</button></div></>}
          </details>
        </>}
        <div className="actions history-detail-actions"><button disabled={!(selected.revisedText||selected.originalTranscript)} onClick={() => setMemoryDraft({record:selected,content:selected.revisedText||selected.originalTranscript||'',reason:'用户从历史记录中明确选择保存',type:'fact'})}>保存为个人记忆…</button><button onClick={() => openFeedback(selected)}>反馈</button><button onClick={() => void remove()}>删除此记录</button>{selected.audio && ['asr-failed','no-speech','conversion-failed'].includes(selected.status || '') && <button disabled={retrying} onClick={() => void retry(selected,'asr')}>重试转写</button>}{selected.status==='ai-failed' && (selected.revisedText||selected.originalTranscript) && <button disabled={retrying} onClick={() => void retry(selected,'ai')}>重试 AI</button>}{selected.mode==='chat' && (selected.revisedText||selected.originalTranscript) && <button disabled={retrying} onClick={() => void retry(selected,'requery')}>重新查询</button>}{retrying && <button onClick={() => retryController.current?.abort()}>取消重试</button>}</div>
      </>}</article></div>}
    <section className="history-preferences"><h2>本机保留</h2><p className="muted">关闭今后保存不会删除已有历史。开启前未保存的音频无法恢复。</p>{settings && <div className="history-settings-grid"><label><input type="checkbox" checked={settings.saveText} onChange={event => { setSettings({ ...settings, saveText: event.target.checked }); setSettingsDirty(true); }} /> 保存今后的文字历史</label><label><input type="checkbox" checked={settings.saveAudio} onChange={event => { setSettings({ ...settings, saveAudio: event.target.checked }); setSettingsDirty(true); }} /> 保存今后的录音音频</label>{(['textRetention', 'audioRetention'] as const).map(key => <label key={key}>{key === 'textRetention' ? '文字保留期限' : '音频保留期限'}<select value={settings[key]} onChange={event => { setSettings({ ...settings, [key]: event.target.value }); setSettingsDirty(true); }}>{Object.entries(retention).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}<button disabled={!settingsDirty} onClick={() => void saveSettings()}>保存设置</button><button onClick={() => void clear()}>清空已有历史…</button></div>}</section>
    {memoryDraft && <div className="agreement-backdrop"><section className="agreement-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-history-title"><h2 id="memory-history-title">保存为个人记忆</h2><p>只保存你确认的内容，不会把AI结果直接当作个人事实。删除来源历史时会联动清除此记忆。</p><label>类别<select value={memoryDraft.type} onChange={event=>setMemoryDraft({...memoryDraft,type:event.target.value as typeof memoryDraft.type})}><option value="preference">偏好</option><option value="fact">个人信息</option><option value="project">持续项目</option><option value="term">专有词</option></select></label><label>记住什么<textarea maxLength={2000} value={memoryDraft.content} onChange={event=>setMemoryDraft({...memoryDraft,content:event.target.value})}/></label><label>为什么记住<textarea maxLength={1000} value={memoryDraft.reason} onChange={event=>setMemoryDraft({...memoryDraft,reason:event.target.value})}/></label><div className="actions"><button onClick={()=>setMemoryDraft(null)}>取消</button><button className="primary" disabled={!memoryDraft.content.trim()||!memoryDraft.reason.trim()} onClick={()=>void saveMemoryFromHistory()}>确认保存到本机</button></div></section></div>}{feedbackRecord && <div className="agreement-backdrop"><section className="agreement-dialog feedback-react" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><h2 id="feedback-title">此记录的问题反馈</h2><p>{(feedbackRecord.originalTranscript || feedbackRecord.revisedText || feedbackRecord.aiResult || '无转录').slice(0, 160)}</p><label>问题类型<select value={feedback.type} onChange={event => { setFeedback({ ...feedback, type: event.target.value }); setFeedbackId(''); }}>{[['recognition', '漏字或识别错误'], ['numbers-language', '数字、标点或语言识别错误'], ['ai-result', '翻译或 AI 结果不符合预期'], ['audio', '录音无声、截断或异常'], ['ui', '界面或操作问题'], ['other', '其他']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>问题描述<textarea maxLength={8000} value={feedback.description} onChange={event => { setFeedback({ ...feedback, description: event.target.value }); setFeedbackId(''); }} /></label><label>期望文字 / 正确转录<textarea maxLength={8000} value={feedback.expectedText} onChange={event => { setFeedback({ ...feedback, expectedText: event.target.value }); setFeedbackId(''); }} /></label><div className="actions"><button onClick={() => void runDiagnostic()}>运行本地诊断</button><button onClick={() => diagnosticController.current?.abort()}>取消诊断</button></div><pre>{diagnostic || '诊断未运行；不会上传音频或调用模型'}</pre>{(['attachDiagnostic', 'attachText', 'attachAudio'] as const).map(key => <label key={key}><input type="checkbox" disabled={key === 'attachAudio' && !feedbackRecord.audio} checked={feedback[key]} onChange={event => { setFeedback({ ...feedback, [key]: event.target.checked }); setFeedbackId(''); }} />{key === 'attachDiagnostic' ? '附带诊断结果' : key === 'attachText' ? '附带完整文字' : '附带录音文件'}</label>)}<p className="muted">将包含问题类型、描述、期望文字和记录 ID{feedback.attachText ? '、完整文字' : ''}{feedback.attachAudio ? '、录音' : ''}{feedback.attachDiagnostic ? '、本地诊断' : ''}。仅保存本机，尚未发送。</p><div className="actions"><button className="primary" disabled={!feedback.description.trim() || feedbackBusy} onClick={() => void saveFeedback()}>保存本地反馈</button><button disabled={!feedbackId} onClick={() => void exportFeedback()}>导出反馈包…</button><button onClick={closeFeedback}>关闭</button></div></section></div>}
  </section>;
}
