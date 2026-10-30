import { getJson, postJson } from './apiClient';
export type TextSettings = { provider: string; model: string; hasApiKey: boolean; hasFirecrawlApiKey?: boolean; searchBackend?: string; revision: string };
export function readTextSettings(signal?: AbortSignal) { return getJson<TextSettings>('/api/text-settings', signal); }
export function saveTextSettings(input: { revision: string; provider: string; model: string; apiKey: string; firecrawlApiKey?: string; clearFirecrawl?: boolean }, signal?: AbortSignal) { return postJson<TextSettings>('/api/text-settings', input, signal); }
