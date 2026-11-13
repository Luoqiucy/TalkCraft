import { listHistory, type HistoryRecord } from './historyClient';
import type { AgentSource } from '../types';
import { sourceHref } from './sourceLinks';
import { historyAnswerEntries } from './historyConversation';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string; sources?: AgentSource[] };

function safeSources(sources?: AgentSource[]): AgentSource[] | undefined {
  const selected = sources?.slice(0, 12).map(source => {
    const url = sourceHref(source.url);
    return { sourceId: source.sourceId, title: source.title?.slice(0, 300), domain: url ? new URL(url).hostname : source.domain?.slice(0, 150), url, evidenceState: source.evidenceState, snippet: source.snippet?.slice(0, 360), publishedAt: source.publishedAt?.slice(0, 100), fetchedAt: source.fetchedAt?.slice(0, 100) };
  });
  return selected?.length ? selected : undefined;
}

export function appendConversation(history: ConversationTurn[], question: string, answer: string, sources?: AgentSource[]): ConversationTurn[] {
  if (!question.trim() || !answer.trim() || question.length > 4000 || answer.length > 4000) return history;
  const next = [...history, { role: 'user' as const, content: question }, { role: 'assistant' as const, content: answer, sources: safeSources(sources) }];
  while (next.length > 12 || next.reduce((sum, message) => sum + message.content.length, 0) > 8000) next.splice(0, 2);
  return next;
}

export function restoreConversation(records: HistoryRecord[]): ConversationTurn[] {
  let conversation: ConversationTurn[] = [];
  for (const record of [...records].reverse()) {
    // Local history stores a spoken question only in originalTranscript; revisedText is
    // kept empty unless the user edited it. Without this fallback no voice question
    // came back as context after a restart.
    const question = record.revisedText?.trim() ? record.revisedText : record.originalTranscript || '';
    if (record.mode !== 'chat' || record.status !== 'completed' || !question.trim() || !record.aiResult?.trim()) continue;
    const answer = historyAnswerEntries(record).find(entry => entry.answer === record.aiResult);
    conversation = appendConversation(conversation, question, record.aiResult, answer?.search?.sources);
  }
  return conversation;
}

export async function loadSavedConversation(signal?: AbortSignal): Promise<{ conversation: ConversationTurn[]; savingEnabled: boolean }> {
  const first = await listHistory('', 'chat', 0, signal);
  if (!first.settings.saveText || first.settings.textRetention === 'none') return { conversation: [], savingEnabled: false };
  const records = [...first.records];
  for (let offset = records.length; offset < Math.min(first.total, 100) && records.length < 60; offset = records.length) {
    const page = await listHistory('', 'chat', offset, signal);
    if (!page.records.length) break;
    records.push(...page.records);
  }
  return { conversation: restoreConversation(records.slice(0, 60)), savingEnabled: true };
}
