import type { HistoryRecord } from '../services/historyClient';
import { historyAnswerEntries } from '../services/historyConversation';
import { AnswerText } from './AnswerText';
import { AnswerSources } from './AnswerSources';

const statusLabel: Record<string, string> = { completed: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时', processing: '处理中' };

function AnswerEntry({ record, entry, label, onCopy }: { record: HistoryRecord; entry: ReturnType<typeof historyAnswerEntries>[number]; label: string; onCopy: (text: string) => void }) {
  return <article className="history-answer-entry" key={`${record.id}-${entry.attemptIndex}`}>
    <div className="history-answer-heading"><b>{label}{entry.stage === 'requery' ? ' · 重新查询' : ''}</b><small>{entry.at ? new Date(entry.at).toLocaleString('zh-CN') : '时间未记录'} · {statusLabel[entry.status || ''] || (entry.status ? '状态未知' : '状态未记录')}</small></div>
    {entry.answer ? <><AnswerText result={{ text: entry.answer, search: entry.search }} /><button onClick={() => onCopy(entry.answer)}>复制这次回答</button></> : <p className="muted">这次尝试没有保存回答文字。</p>}
    <AnswerSources answer={entry.answer} search={entry.search} />
  </article>;
}

export function HistoryAnswerSources({ record, onCopy }: { record: HistoryRecord; onCopy: (text: string) => void }) {
  const entries = historyAnswerEntries(record);
  const [latest, ...older] = entries;
  return <section className="history-answer-sources" id={`history-sources-${record.id}`} aria-label="历史问答与资料来源">
    <h3>AI 回答</h3>
    <p className="muted">这里显示当时保存的回答和资料；查看历史不会重新联网。</p>
    {!latest && <p className="muted">此记录尚未保存 AI 回答。</p>}
    {latest && <AnswerEntry record={record} entry={latest} label={entries.length > 1 ? '最近一次回答' : '回答'} onCopy={onCopy} />}
    {older.length > 0 && <details className="history-older-attempts"><summary>查看较早的回答尝试 · {older.length}次</summary>{older.map((entry, index) => <AnswerEntry key={`${record.id}-${entry.attemptIndex}`} record={record} entry={entry} label={`较早尝试 ${older.length - index}`} onCopy={onCopy} />)}</details>}
  </section>;
}
