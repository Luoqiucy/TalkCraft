import { postStream } from './apiClient';
import { processText } from './audioClient';
import type { AgentEvent, AgentResult, AgentTaskState, ServiceStatus } from '../types';

// This is only a local UI guard when the user has disabled web search. The
// server remains the sole authority for full intent and context resolution.
export const isWeatherQuestion = (text: string, history: { role: string; content: string }[] = []) => {
  const weatherTerms = /天气|气温|温度|下雨|降雨|降雪|风力|湿度|空气质量|紫外线|穿衣指数/;
  if (weatherTerms.test(text)) return true;
  const followup = /^(?:那|那么|当地|这里|那边)?\s*(?:今天|今日|明天|明日|后天|未来|接下来|本周|这一周|最近|[2-7]天)/.test(text.trim());
  if (!followup) return false;
  const lastUserMessage = [...history].reverse().find(item => item.role === 'user')?.content || '';
  return weatherTerms.test(lastUserMessage);
};

const stateForEvent = (event: AgentEvent): AgentTaskState => {
  if (event.status === 'failed') return 'failed';
  if (event.status === 'cancelled') return 'cancelled';
  if (event.status === 'timeout') return 'timeout';
  if (event.stage === 'searching') return 'searching';
  if (event.stage === 'reading') return 'reading';
  if (event.stage === 'weather') return 'weather';
  if (event.stage === 'answering') return 'answering';
  return 'understanding';
};

type WeatherCoordinates = { latitude: number; longitude: number; source: 'device-geolocation'; capturedAt: string };
type QuestionOptions = { cloudConsent: boolean; webSearch: boolean; status: ServiceStatus; taskId?: string; sessionId?: string; history?: { role: string; content: string; sources?: { sourceId?: string; title?: string; url?: string; snippet?: string; evidenceState?: string; publishedAt?: string; fetchedAt?: string }[] }[]; commercial?: boolean; locationConsent?: boolean; locationCoordinates?: WeatherCoordinates };

export async function askQuestion(text: string, options: QuestionOptions, signal: AbortSignal, onProgress: (event: AgentEvent, state: AgentTaskState) => void, onDelta?: (text: string) => void, onReset?: () => void): Promise<AgentResult> {
  const { cloudConsent, webSearch, taskId, sessionId, history = [], locationConsent = false, locationCoordinates } = options;
  const modelHistory = history.map(({ role, content }) => ({ role, content }));
  const contextEvidence = history.filter(item => item.role === 'assistant').flatMap(item => (item.sources || []).filter(source => source.snippet?.trim()).map(source => ({ sourceId: source.sourceId, title: source.title?.slice(0, 240), url: source.url, snippet: source.snippet?.slice(0, 360), evidenceState: source.evidenceState, publishedAt: source.publishedAt, fetchedAt: source.fetchedAt }))).slice(-8);
  if (options.commercial) {
    const answer = await processText({ mode: 'chat', text, taskId, sessionId, history: modelHistory, cloudConsent, webSearch, ...(locationConsent && locationCoordinates ? { locationConsent: true, locationCoordinates } : {}) }, signal, true) as AgentResult;
    signal.throwIfAborted();
    return answer;
  }
  const onEvent = (raw: Record<string, unknown>) => {
    signal.throwIfAborted();
    const event = raw as AgentEvent;
    onProgress(event, stateForEvent(event));
  };
  if (webSearch) {
    return postStream<AgentResult>('/api/agent', { mode: 'chat', text, webSearch: true, cloudConsent, taskId, sessionId, history: modelHistory, contextEvidence, ...(locationConsent && locationCoordinates ? { locationConsent: true, locationCoordinates } : {}) }, signal, onEvent, onDelta, onReset);
  }
  const answer = await processText({ mode: 'chat', text, taskId, sessionId, history: modelHistory, cloudConsent }, signal) as AgentResult;
  signal.throwIfAborted();
  return answer;
}
