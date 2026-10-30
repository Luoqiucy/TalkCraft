import { useEffect, useMemo, useState } from 'react';
import type { AgentEvent, AgentSource, AgentTaskState, AgentResult } from '../types';
import { groupToolEvents, taskStatusLabel } from '../services/presentation.mjs';
import { sourceHref } from '../services/sourceLinks';
import { SourcePreviewLink } from './SourcePreviewLink';

const toolNames: Record<string, string> = { get_weather: '查询天气', search_web: '搜索网页', read_webpage: '读取网页', scrape_webpage: '读取网页正文' };
const statusNames: Record<string, string> = { running: '进行中', completed: '完成', failed: '失败', cancelled: '已取消', timeout: '超时', limit: '达到上限' };

export function ExecutionTracePanel({ state, events, sources, search, showSources = true, historical = false }: { state: AgentTaskState; events: AgentEvent[]; sources: AgentSource[]; search?: AgentResult['search']; showSources?: boolean; historical?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [touched, setTouched] = useState(false);
  const grouped = useMemo(() => groupToolEvents(events), [events]);
  useEffect(() => { if (!touched) setExpanded(!['idle', 'completed', 'failed', 'cancelled', 'timeout', 'needs-confirmation'].includes(state)); }, [state, touched]);
  const taskLabel = taskStatusLabel(state, search?.status, historical);
  const summary = state === 'idle' && !historical ? taskLabel : `${taskLabel}${grouped.length ? ` · ${grouped.length}次工具调用` : ''}${Number.isFinite(search?.totalElapsedMs) ? ` · ${(search!.totalElapsedMs! / 1000).toFixed(1)}秒` : ''}`;
  return <details className="trace-panel" open={expanded} onToggle={event => { if (event.currentTarget.open !== expanded) { setTouched(true); setExpanded(event.currentTarget.open); } }}>
    <summary><span>执行过程</span><small>{summary}</small></summary>
    <div className="trace-body">
      {Number.isFinite(search?.firstProgressMs) && <p className="muted">首次工具进度：{(search!.firstProgressMs! / 1000).toFixed(1)}秒</p>}
      {!grouped.length ? <p className="muted">{historical ? '此记录未保存执行过程。' : state === 'idle' ? '尚未执行联网查询。' : '没有保存可展示的工具调用。'}</p> : <ol className="trace-calls">{grouped.map(call => {
        const href = typeof call.input?.url === 'string' ? sourceHref(call.input.url) : '';
        const query = typeof call.input?.query === 'string' ? call.input.query : '';
        const location = typeof call.input?.location === 'string' ? call.input.location : '';
        const target = query || href || location;
        const status = statusNames[call.status] || call.status || '未记录';
        return <li key={call.key} className={`trace-call trace-call-${call.status}`}>
          <div className="trace-call-main"><b>{toolNames[call.tool || ''] || call.tool || '工具'}</b>{target && <span className="trace-call-target" title={target}>{target}</span>}<span className="trace-call-status">{status}</span>{call.resultCount !== undefined && <span>{call.resultCount}条</span>}{call.elapsedMs !== undefined ? <span>{(call.elapsedMs / 1000).toFixed(1)}秒</span> : <span>耗时未记录</span>}</div>
          {(call.error || call.input || href) && <details className="trace-call-detail"><summary>详情</summary>{query && <p>搜索词：<code>{query}</code><button onClick={() => void navigator.clipboard.writeText(query)}>复制</button></p>}{href && <p>读取页面：<a href={href} target="_blank" rel="noopener noreferrer">{href}</a></p>}{location && <p>地点：{location}</p>}{call.error && <p className="error-text">{call.error}</p>}</details>}
        </li>;
      })}</ol>}
      {search?.weather && <section className="structured-source"><b>天气数据</b><p>{search.weather.provider || '提供方未记录'} · {search.weather.location || '地点未记录'} · 数据时间：{search.weather.observedAt || search.weather.forecastDate || '未记录'}</p></section>}
      {showSources && <><h3>参考来源</h3>{sources.length === 0 ? <p className="muted">当前没有可展示的来源。</p> : <ul className="sources">{sources.map((source, index) => {
        const href = sourceHref(source.url);
        return <li id={source.sourceId} key={source.sourceId || source.url || index}><b className="source-heading">[{index + 1}] {href ? <SourcePreviewLink source={source} compact /> : source.title || source.domain || '来源'}</b><small>{source.domain || ''} · {({ hit: '仅搜索命中', summary: '已取得摘要', read: '已读取正文', 'read-failed': '正文读取失败' } as Record<string, string>)[source.evidenceState || ''] || '仅搜索命中'} · 发布时间：{source.publishedAt || '未提供'} · 获取时间：{source.fetchedAt || '未提供'}{search?.usedSourceIds?.includes(source.sourceId || '') ? ' · 回答已引用' : ''}</small>{source.snippet && <details><summary>查看已保存的{source.evidenceState === 'read' ? '正文片段' : '搜索摘要'}</summary><p>{source.snippet}</p></details>}{href && <a href={href} target="_blank" rel="noopener noreferrer">打开原文</a>}</li>;
      })}</ul>}</>}
    </div>
  </details>;
}
