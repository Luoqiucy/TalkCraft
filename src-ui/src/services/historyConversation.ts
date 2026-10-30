import type { AgentResult } from '../types';
import type { HistoryRecord } from './historyClient';

export type HistoryAnswerEntry = {
  attemptIndex: number;
  stage?: string;
  at?: string;
  status?: string;
  answer: string;
  search?: AgentResult['search'];
};

export function historyAnswerEntries(record: HistoryRecord): HistoryAnswerEntry[] {
  const entries: HistoryAnswerEntry[] = (record.attempts || []).flatMap((attempt, index): HistoryAnswerEntry[] => {
    if (!['ai', 'requery'].includes(attempt.stage || '') || (!attempt.result && !attempt.search)) return [];
    return [{ attemptIndex: index, stage: attempt.stage, at: attempt.at, status: attempt.status, answer: attempt.result || '', search: attempt.search }];
  });
  const current = record.aiResult || '';
  if (current && !entries.some(entry => entry.answer === current)) {
    const lastCompleted = [...entries].reverse().find(entry => entry.status === 'completed' && !entry.answer);
    if (lastCompleted) lastCompleted.answer = current;
    else entries.push({ attemptIndex: record.attempts?.length || 0, stage: 'ai', status: 'completed', answer: current });
  }
  return entries.reverse();
}
