import type { AgentEvent, AgentSource } from '../types';

export function citationSourceEntries(answer: string, sources?: AgentSource[]): Array<{ source: AgentSource; number: number; cited: boolean }>;
export function groupToolEvents(events?: AgentEvent[]): Array<AgentEvent & { key: string; events: AgentEvent[]; input?: Record<string, unknown>; status: string; resultCount?: number; error?: string }>;
export function taskStatusLabel(state: string, searchStatus?: string, historical?: boolean): string;
