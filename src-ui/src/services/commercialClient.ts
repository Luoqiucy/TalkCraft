import { getJson, postJson } from './apiClient';

export type CommercialStatus = { available: boolean; signedIn: boolean; asrReady?: boolean; webSearchAvailable?: boolean; sessionExpired?: boolean; error?: string; account?: { id: string; email: string } };
export type CommercialUsage = { periodId: string; scope: 'server'; usage: Record<'asr_seconds' | 'ai_characters', { limit: number; used: number; reserved: number; remaining: number }> };
export const commercialStatus = () => getJson<CommercialStatus>('/api/commercial/status');
export const commercialUsage = () => getJson<CommercialUsage>('/api/commercial/usage');
export const commercialRegister = (email: string, password: string) => postJson<{ account: { id: string; email: string } }>('/api/commercial/register', { email, password });
export const commercialLogin = (email: string, password: string) => postJson<{ account: { id: string; email: string } }>('/api/commercial/login', { email, password });
export const commercialLogout = () => postJson<{ loggedOut: boolean }>('/api/commercial/logout', {});
