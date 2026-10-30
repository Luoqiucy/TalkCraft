export type AgentTaskState =
  | 'idle'
  | 'understanding'
  | 'searching'
  | 'reading'
  | 'weather'
  | 'answering'
  | 'transcribing'
  | 'completed'
  | 'needs-confirmation'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type AgentEvent = {
  eventId?: string;
  taskId?: string;
  callId?: string;
  sequence?: number;
  stage?: string;
  tool?: string;
  status?: string;
  elapsedMs?: number;
  resultCount?: number;
  error?: string;
  at?: string;
  startedAt?: string;
  completedAt?: string;
  input?: Record<string, unknown>;
};

export type AgentSource = {
  sourceId?: string;
  title?: string;
  url?: string;
  domain?: string;
  snippet?: string;
  evidenceState?: string;
  publishedAt?: string;
  fetchedAt?: string;
};

export type AgentResult = {
  text: string;
  sessionFacts?: { predicate: string; object: string; frequency?: string; confirmedByUser?: boolean; provenance?: { source?: string; turnIndex?: number; text?: string } }[];
  simulated?: boolean;
  taskId?: string;
  search?: {
    query?: string;
    allowed?: boolean;
    performed?: boolean;
    engine?: string;
    status?: string;
    progress?: AgentEvent[];
    toolTrace?: AgentEvent[];
    sources?: AgentSource[];
    usedSourceIds?: string[];
    totalElapsedMs?: number;
    firstProgressMs?: number;
    toolCalls?: number;
    needsClarification?: string;
    weather?: { provider?: string; location?: string; observedAt?: string; forecastDate?: string; current?: Record<string, unknown>; forecasts?: Record<string, unknown>[] };
    memory?: { memoryIds?: string[]; chars?: number; elapsedMs?: number; sessionFacts?: AgentResult['sessionFacts'] };
  };
  historyContext?: { provider?: string; model?: string };
};

export type ServiceStatus = {
  agentEngine?: 'legacy' | 'langgraph';
  provider?: string;
  model?: string;
  ready?: boolean;
  weatherAvailable?: boolean;
  webpageReadAvailable?: boolean;
  webSearchAvailable?: boolean;
  webScrapeAvailable?: boolean;
  audioTranscription?: boolean;
  asrSimulated?: boolean;
  asrProvider?: string;
  simulated?: boolean;
  local?: boolean;
};

export type WorkMode = 'dictation' | 'prompt' | 'translate' | 'chat';
