import { getJson, postJson } from './apiClient';

export type HistoryRecord = { id: string; createdAt?: string; mode?: string; status?: string; originalTranscript?: string | null; revisedText?: string; aiResult?: string; duration?: number; targetLanguage?: string; webSearchAllowed?: boolean; simulated?: boolean; attempts?: { at?: string; stage?: string; status?: string; result?: string; search?: import('../types').AgentResult['search'] }[]; audio?: { ext?: string; size?: number }; audioReason?: string; error?: string };
export type HistorySettings = { saveText: boolean; saveAudio: boolean; textRetention: string; audioRetention: string };
export type HistoryPage = { records: HistoryRecord[]; total: number; offset?: number; limit?: number; settings: HistorySettings; directory: string };

export function listHistory(query = '', mode = 'all', offset = 0, signal?: AbortSignal) { return getJson<HistoryPage>(`/api/history?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}&offset=${offset}`, signal); }
export function deleteHistory(id: string, undo = false) { return postJson<{ deleted?: boolean; restored?: boolean }>('/api/history/delete', { id, undo }); }
export function saveHistory(input: Record<string, unknown>) { return postJson<{ saved: boolean }>('/api/history/record', input); }
export async function saveHistoryAudio(id: string, blob: Blob) {
  const response = await fetch(`/api/history/audio?id=${encodeURIComponent(id)}`, { method: 'POST', body: blob });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '录音保存失败');
  return body as { saved: boolean };
}
export function setHistorySettings(input: HistorySettings & { confirmed?: boolean }) { return postJson('/api/history/settings', input); }
export function lockHistory(id: string, locked: boolean) { return postJson('/api/history/lock', { id, locked }); }
