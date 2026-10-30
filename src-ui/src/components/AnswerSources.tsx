import type { AgentResult, AgentSource } from '../types';
import { citationSourceEntries } from '../services/presentation.mjs';
import { sourceHref } from '../services/sourceLinks';
import { SourcePreviewLink } from './SourcePreviewLink';

const evidenceLabels: Record<string, string> = { hit: '搜索命中', summary: '已取得摘要', read: '已读取正文', 'read-failed': '读取失败' };

function SourceRow({ source, number, cited }: { source: AgentSource; number: number; cited: boolean }) {
  const label = evidenceLabels[source.evidenceState || ''] || '搜索命中';
  const href = sourceHref(source.url);
  return <li className="answer-source-row" id={source.sourceId || undefined} key={source.sourceId || `${source.url || source.title}-${number}`}>
    <div className="answer-source-main"><b>[{number}]</b><SourcePreviewLink source={source} compact /><span className="answer-source-state">{label}{cited ? ' · 回答中引用' : ''}</span></div>
    {(source.snippet || source.publishedAt || source.fetchedAt || href) && <details className="answer-source-detail"><summary>查看资料摘要与时间</summary>{source.snippet && <p>{source.snippet}</p>}<small>发布时间：{source.publishedAt || '未提供'} · 获取时间：{source.fetchedAt || '未提供'}</small>{href && <a href={href} target="_blank" rel="noopener noreferrer">打开原文</a>}</details>}
  </li>;
}

export function AnswerSources({ answer, search }: { answer: string; search?: AgentResult['search'] }) {
  const sources = search?.sources || [];
  const entries = citationSourceEntries(answer, sources).map(entry => ({ ...entry, cited: entry.cited || Boolean(entry.source.sourceId && search?.usedSourceIds?.includes(entry.source.sourceId)) }));
  const cited = entries.filter(entry => entry.cited);
  const other = entries.filter(entry => !entry.cited);
  const weather = search?.weather;
  if (!sources.length && !weather) return null;
  return <section className="answer-sources" aria-label="参考来源">
    <h3>参考来源 <small>· {sources.length + (weather ? 1 : 0)}</small></h3>
    {weather && <div className="answer-weather-source"><b>天气数据 · {weather.provider || '提供方未记录'}</b><span>{weather.location || '地点未记录'} · 数据时间：{weather.observedAt || weather.forecastDate || '未记录'}</span></div>}
    {cited.length > 0 ? <>
      <ul className="answer-source-list">{cited.slice(0, 3).map(entry => <SourceRow key={entry.source.sourceId || entry.number} {...entry} />)}</ul>
      {cited.length > 3 && <details><summary>查看其他已引用来源 · {cited.length - 3}条</summary><ul className="answer-source-list">{cited.slice(3).map(entry => <SourceRow key={entry.source.sourceId || entry.number} {...entry} />)}</ul></details>}
    </> : <p className="muted">回答未标注网页引用；以下资料仅为搜索命中，不代表回答已引用。</p>}
    {other.length > 0 && <details className="answer-other-sources"><summary>其他检索资料 · {other.length}条</summary><ul className="answer-source-list">{other.map(entry => <SourceRow key={entry.source.sourceId || entry.number} {...entry} />)}</ul></details>}
  </section>;
}
