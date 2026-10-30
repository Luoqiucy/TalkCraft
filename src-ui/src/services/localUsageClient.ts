import { getJson, postJson } from './apiClient';

export type UsageTotals = { transcriptionCharacters: number; chatInputCharacters: number; chatOutputCharacters: number; speechSeconds: number; transcriptionTasks: number; chatTasks: number };
export type LocalUsage = { scope: 'local'; billable: false; month: string; allTime: UsageTotals; thisMonth: UsageTotals };

export function loadLocalUsage(signal?: AbortSignal) { return getJson<LocalUsage>('/api/local-usage', signal); }
export function clearLocalUsage() { return postJson<{ cleared: true }>('/api/local-usage/clear', {}); }
