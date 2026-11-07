import { useEffect, useRef, useState } from 'react';
// @ts-expect-error The existing recording state machine is framework-independent JavaScript.
import { createRecordingSession } from '../../../public/recording.mjs';
// @ts-expect-error Shared sound playback has no declaration file.
import { createCaptureSounds } from '../../../public/living-fluid.mjs';
import { getJson, postStream } from '../services/apiClient';
import { askQuestion, isWeatherQuestion } from '../services/agentClient';
// @ts-expect-error Shared request parser is framework-independent JavaScript.
import { parseExplicitMemoryCommand } from '../../../src/agent/memory-command.mjs';
import { processText, recordingToPcm, transcribePcm } from '../services/audioClient';
import { saveHistory, saveHistoryAudio } from '../services/historyClient';
import { appendConversation, loadSavedConversation, type ConversationTurn } from '../services/conversationMemory';
import { clipboardWrite, desktopAvailable, desktopInvoke, exportFile } from '../services/tauriBridge';
import type { AgentEvent, AgentResult, AgentTaskState, ServiceStatus, WorkMode } from '../types';
import { ExecutionTracePanel } from './ExecutionTracePanel';
import { HistoryPanel } from './HistoryPanel';
import { SettingsPanel } from './SettingsPanel';
import { DesktopChrome } from './DesktopChrome';
import { AnswerText } from './AnswerText';
import { AnswerSources } from './AnswerSources';
import { OutputPanel } from './OutputPanel';
import { UsageCard } from './UsageCard';
import { MemoryPanel } from './MemoryPanel';
import { createMemory } from '../services/memoryClient';
import { defaultUserPreferences, readUserPreferences, saveUserPreferences, type UserPreferences } from '../services/userPreferences';
import { conciseSpeechCandidate, setSpeechPreferences, shouldAutoSpeakCompletedAnswer, speechController } from '../services/speech';
// @ts-expect-error Shared shortcut routing has no declaration file.
import { routeRecordingShortcut } from '../services/shortcutRouter.mjs';
import type { CommercialStatus } from '../services/commercialClient';

const names: Record<WorkMode, string> = { dictation: '听写', prompt: '提示词预设', translate: '翻译', chat: '问答' };
const states: Record<AgentTaskState, string> = { idle: '就绪', understanding: '正在准备', searching: '正在搜索', reading: '正在读取资料', weather: '正在查询天气', answering: '正在整理回答', transcribing: '正在转写', completed: '已完成', 'needs-confirmation': '等待确认', failed: '失败', cancelled: '已取消', timeout: '超时' };
const languages = { en: '英语', zh: '简体中文', 'zh-CN':'简体中文（中国大陆）','zh-TW': '繁体中文（台湾）', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', it: '意大利语', pt: '葡萄牙语','pt-BR':'巴西葡萄牙语','pt-PT':'葡萄牙葡萄牙语','en-US':'美式英语','en-GB':'英式英语', ru: '俄语', ar: '阿拉伯语', hi: '印地语', th: '泰语', vi: '越南语', id: '印度尼西亚语', ms: '马来语', tr: '土耳其语', nl: '荷兰语', pl: '波兰语', uk: '乌克兰语' };
type Session = { state: string; start(input: { deviceId?: string }): Promise<boolean>; stop(): boolean; cancel(): boolean; dispose(): void };
type WeatherLocation = { latitude: number; longitude: number; source: 'device-geolocation'; capturedAt: string };
function recordShortcutDiagnostic(event: string, capture: string, busy: boolean, sessionState = capture) {
  if (!desktopAvailable()) return;
  const safeCapture = ['idle', 'acquiring', 'recording', 'stopping', 'ready', 'error'].includes(capture) ? capture : 'idle';
  const safeSessionState = ['idle', 'acquiring', 'recording', 'stopping', 'ready', 'error', 'disposed'].includes(sessionState) ? sessionState : safeCapture;
  void desktopInvoke('shortcuts_diagnostic_frontend', { event, capture: safeCapture, sessionState: safeSessionState, busy }).catch(() => undefined);
}
function readApproximateLocation(): Promise<WeatherLocation> { return new Promise((resolve, reject) => { if (!navigator.geolocation) { reject(new Error('此桌面环境不支持系统定位；可直接输入城市查询天气。')); return; } navigator.geolocation.getCurrentPosition(position => resolve({ latitude: Math.round(position.coords.latitude * 100) / 100, longitude: Math.round(position.coords.longitude * 100) / 100, source: 'device-geolocation', capturedAt: new Date(position.timestamp || Date.now()).toISOString() }), cause => reject(new Error(cause.code === 1 ? '系统定位权限已拒绝；可在系统设置中允许，或直接输入城市。' : cause.code === 2 ? '系统定位服务已关闭或暂不可用；可检查Windows位置服务，或直接输入城市。' : '定位等待超时；可重试或直接输入城市。')), { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 }); }); }

export function WorkbenchApp() {
  const [mode, setMode] = useState<WorkMode>('dictation');
  const [draft, setDraft] = useState('');
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<AgentResult | null>(null);
  const [partialAnswer, setPartialAnswer] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [state, setState] = useState<AgentTaskState>('idle');
  const [capture, setCapture] = useState('idle');
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [agreement, setAgreement] = useState(() => localStorage.getItem('talkcraft-agreement-v1') === 'accepted');
  const [webSearch, setWebSearch] = useState(true);
  const searchTouched = useRef(false);
  const [tone, setTone] = useState('business');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'workbench' | 'history' | 'memories' | 'settings'>('workbench');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [preferences,setPreferences]=useState<UserPreferences>(defaultUserPreferences);
  const preferenceRevision=useRef('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [wave, setWave] = useState<string[]>([]);
  const [level, setLevel] = useState('音量未知');
  const [saveError, setSaveError] = useState('');
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [rememberConversation, setRememberConversation] = useState(() => localStorage.getItem('talkcraft-remember-chat-v1') === 'true');
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryAvailable, setMemoryAvailable] = useState(true);
  const [weatherLocationAllowed, setWeatherLocationAllowed] = useState(() => localStorage.getItem('talkcraft-weather-location-v1') === 'allowed');
  const [weatherLocationStatus, setWeatherLocationStatus] = useState(() => localStorage.getItem('talkcraft-weather-location-v1') === 'allowed' ? '已开启；下次天气查询会尝试获取近似位置' : '未授权');
  const [weatherLocation, setWeatherLocation] = useState<WeatherLocation | null>(null);
  const [memorySuggestions, setMemorySuggestions] = useState<NonNullable<AgentResult['sessionFacts']>>([]);
  const [keymapBindings, setKeymapBindings] = useState<Record<string, string>>({});
  const [usageRefresh, setUsageRefresh] = useState(0);
  const [commercialMode, setCommercialMode] = useState(false);
  const [commercialStatus, setCommercialStatus] = useState<CommercialStatus | null>(null);
  const knownAccountId = useRef<string | null | undefined>(undefined);
  const captureSounds=useRef<ReturnType<typeof createCaptureSounds>|null>(null);
  const controller = useRef<AbortController | null>(null);
  const conversationId = useRef(crypto.randomUUID());
  const session = useRef<Session | null>(null);
  const task = useRef<{ id: string; mode: WorkMode; started: number } | null>(null);
  const generation = useRef(0);
  const recordingBlob = useRef<Blob | null>(null);
  const stoppedAt = useRef<number | null>(null);
  const meter = useRef<{ context: AudioContext; frame: number; source: MediaStreamAudioSourceNode } | null>(null);
  const captureOrigin = useRef<'workbench' | 'external'>('workbench');
  const activeTaskId = useRef('');
  const historyQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingQuestion = useRef('');
  // Recording whose transcription is in flight; cancel() must close its history record.
  const transcribingTask = useRef<{ id: string; mode: WorkMode } | null>(null);
  const timer = useRef<number | null>(null);
  const hudPacket = useRef<Record<string, unknown>>({});
  const latest = useRef({ mode, agreement, status, draft, webSearch, tone, targetLanguage, conversation, memoryLoading, commercialMode, commercialStatus, weatherLocationAllowed, weatherLocation,preferences });
  latest.current = { mode, agreement, status, draft, webSearch, tone, targetLanguage, conversation, memoryLoading, commercialMode, commercialStatus, weatherLocationAllowed, weatherLocation,preferences };
  const busy = ['understanding', 'searching', 'reading', 'weather', 'answering', 'transcribing'].includes(state);
  const uiEnglish=preferences.interfaceLanguage==='en-US';
  const visibleNames:Record<WorkMode,string>=uiEnglish?{dictation:'Dictation',prompt:'Prompt presets',translate:'Translate',chat:'Ask'}:names;
  const liveCaptureState = useRef({ busy, capture });
  liveCaptureState.current = { busy, capture };
  const capturing = ['acquiring', 'recording', 'stopping'].includes(capture);
  const handleCommercialStatus = (next: CommercialStatus) => {
    const nextAccountId = next.signedIn ? next.account?.id || null : null;
    if (knownAccountId.current === undefined && nextAccountId || knownAccountId.current !== undefined && knownAccountId.current !== nextAccountId) {
      setConversation([]);conversationId.current=crypto.randomUUID();setMemorySuggestions([]);setRememberConversation(false);localStorage.removeItem('talkcraft-remember-chat-v1');setEvents([]);setResult(null);setPartialAnswer('');
      setWeatherLocation(null);setWeatherLocationAllowed(false);setWeatherLocationStatus('账号已切换，请重新选择是否允许使用当前位置');localStorage.removeItem('talkcraft-weather-location-v1');speechController.stop();
    }
    knownAccountId.current = nextAccountId;setCommercialStatus(next);
  };

  const [historyRevision, setHistoryRevision] = useState(0);
  const queueHistory = (operation: () => Promise<unknown>) => {
    const pending = historyQueue.current.then(async () => {
      await operation();
      setHistoryRevision(revision => revision + 1);
    });
    historyQueue.current = pending.catch(cause => { setSaveError(`历史保存失败，当前内容仍保留：${cause instanceof Error ? cause.message : '未知错误'}`); });
    return pending.catch(() => undefined);
  };
  const patch = (input: Record<string, unknown>) => queueHistory(() => saveHistory(input));
  const refreshStatus = () => getJson<ServiceStatus>('/api/status').then(value => { setStatus(value); if (!searchTouched.current || !value.webSearchAvailable && !value.weatherAvailable) setWebSearch(value.webSearchAvailable === true || value.weatherAvailable === true); }).catch(() => setStatus(null));
  const savePreferences=async(value:UserPreferences)=>{const result=await saveUserPreferences(preferenceRevision.current,value);preferenceRevision.current=result.revision;setPreferences(result.preferences);setTargetLanguage(result.preferences.targetLanguage);setDeviceId(result.preferences.inputDeviceId);setSpeechPreferences({voiceURI:result.preferences.speechVoiceURI,rate:result.preferences.speechRate,volume:result.preferences.speechVolume});const themePref=result.preferences.theme;const systemDark=window.matchMedia?.('(prefers-color-scheme: dark)').matches??true;setTheme(themePref==='system'?(systemDark?'dark':'light'):themePref);try{localStorage.removeItem('talkcraft-react-theme');}catch{}try{const channel=new BroadcastChannel('talkcraft-user-preferences-v1');channel.postMessage({preferences:result.preferences,revision:result.revision});channel.close();}catch{} };
  const allowWeatherLocation = async () => { setWeatherLocationStatus('正在请求系统定位…');try{const location=await readApproximateLocation();setWeatherLocation(location);setWeatherLocationAllowed(true);localStorage.setItem('talkcraft-weather-location-v1','allowed');setWeatherLocationStatus('已允许；仅在天气缺少城市时向TalkCraft天气服务及天气提供方发送约1公里精度的位置，不发送给文字模型');}catch(cause){setWeatherLocation(null);setWeatherLocationAllowed(false);localStorage.removeItem('talkcraft-weather-location-v1');setWeatherLocationStatus(cause instanceof Error?cause.message:'定位不可用，可手动输入城市');} };
  const revokeWeatherLocation = () => { setWeatherLocation(null);setWeatherLocationAllowed(false);localStorage.removeItem('talkcraft-weather-location-v1');setWeatherLocationStatus('已关闭；需要时仍可手动输入城市'); };
  const refreshDevices = () => navigator.mediaDevices?.enumerateDevices?.().then(items => setDevices(items.filter(item => item.kind === 'audioinput' && item.deviceId !== 'default'))).catch(() => setNotice('麦克风列表读取失败，可使用默认麦克风'));
  useEffect(()=>{if(deviceId&&devices.length&&!devices.some(device=>device.deviceId===deviceId))setNotice('已保存的麦克风当前不可用；请在设置中重新选择设备，录音不会自动切换。');},[deviceId,devices]);
  const attachMeter = (stream: MediaStream | null) => {
    if (meter.current) { cancelAnimationFrame(meter.current.frame); meter.current.source.disconnect(); void meter.current.context.close().catch(() => {}); meter.current = null; }
    if (!stream) { setWave([]); setLevel('音量未知'); return; }
    try {
      const context = new AudioContext(); const source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize); let last = 0;
      const state = { context, source, frame: 0 }; meter.current = state;
      const tick = (at: number) => { if (meter.current !== state) return; state.frame = requestAnimationFrame(tick); if (at - last < 50) return; last = at; analyser.getFloatTimeDomainData(samples); let sum = 0; for (const value of samples) sum += value * value; const rms = Math.sqrt(sum / samples.length); const db = rms ? Math.max(-60, 20 * Math.log10(rms)) : -60; setLevel(`${db.toFixed(0)} dBFS`); setWave(Array.from({ length: 12 }, (_, i) => `${Math.round(3 + Math.min(19, rms * 180 * (0.6 + .4 * Math.sin(i * 1.7) ** 2)))}px`)); };
      state.frame = requestAnimationFrame(tick);
    } catch { setLevel('音量无法读取'); }
  };

  const processCurrent = async (input: string, activeMode: WorkMode, id: string = crypto.randomUUID(), automatic = false) => {
    speechController.stop();
    const config = latest.current;
    const value = activeMode === 'dictation' ? input : input.trim();
    if (!value.trim() || value.length > (activeMode === 'chat' ? 4000 : 12000)) { setError('请输入有效文字，问答最多4000字，其他模式最多12000字'); return; }
    let questionHistory=config.conversation;
    if(activeMode==='chat'&&controller.current){const previousQuestion=pendingQuestion.current,previousTaskId=activeTaskId.current;controller.current.abort();controller.current=null;activeTaskId.current='';
      // Keep the interrupted question as context, but as a complete user/assistant
      // pair: an unpaired turn makes every later request fail history validation.
      if(previousQuestion.trim()){questionHistory=appendConversation(config.conversation,previousQuestion,'（上一问被新问题打断，未生成回答）');setConversation(questionHistory);}
      // The aborted request returns early, so mark its history record here; a record
      // left as "processing" cannot be deleted until the app restarts.
      if(previousTaskId&&previousTaskId!==id)void patch({id:previousTaskId,mode:'chat',status:'cancelled',error:'被新问题打断',attempt:{stage:'ai',status:'cancelled'}});}
    const explicitMemory=activeMode==='chat'?parseExplicitMemoryCommand(value):null;
    if(explicitMemory){const {content,query:followup,type}=explicitMemory;try{await createMemory({type,content,reason:`用户明确提出“记住”：${value.slice(0,300)}`,sourceRecordId:null,independent:true,syncSelected:false});setNotice('已保存为本机个人记忆；未发送给搜索服务');setError('');if(followup){setDraft(followup);return processCurrent(followup,activeMode,id,automatic);}setResult({text:'已保存为本机个人记忆。你可以在“个人记忆”中查看、修改或删除；默认不会同步到云端。'});setDraft('');setState('completed');return;}catch(cause){setError(cause instanceof Error?cause.message:'记忆保存失败');return;}}
    if (activeMode === 'chat' && config.memoryLoading) { setError('正在恢复本机问答上下文，请稍后重试'); return; }
    if (activeMode === 'chat' && isWeatherQuestion(value, config.conversation) && !config.webSearch) { setError('天气问题需要开启联网问答；未向普通模型请求实时天气'); return; }
    if (config.commercialMode ? !config.commercialStatus?.signedIn || !config.commercialStatus.available : !config.status) { setError(config.commercialMode ? '账号服务不可用，请重新登录或切换本机模式；草稿已保留' : '服务状态不可用，草稿已保留'); return; }
    if (!config.agreement && (config.commercialMode || !config.status?.local && !config.status?.simulated)) { setError('请先阅读并同意使用说明'); return; }
    const active = new AbortController(); controller.current = active; activeTaskId.current = id;if(activeMode==='chat')pendingQuestion.current=value;
    const started = Date.now(); setError(''); setNotice(''); setEvents([]); setPartialAnswer(''); setState('understanding');
    void patch({ id, mode: activeMode, status: 'processing', revisedText: value, ...(activeMode === 'translate' ? { targetLanguage: config.targetLanguage } : {}), webSearchAllowed: activeMode === 'chat' && config.webSearch });
    try {
      let answer: AgentResult;
      if (activeMode === 'dictation') answer = { text: value, simulated: false };
      else if (activeMode === 'chat') {
        let locationCoordinates: WeatherLocation | undefined;
        if (config.weatherLocationAllowed && isWeatherQuestion(value, questionHistory)) {
          const captured = config.weatherLocation;
          const fresh = captured && Date.now() - Date.parse(captured.capturedAt) < 10 * 60 * 1000;
          if (fresh) locationCoordinates = captured;
          else {
            try { locationCoordinates = await readApproximateLocation(); active.signal.throwIfAborted(); setWeatherLocation(locationCoordinates); setWeatherLocationStatus('定位可用；本次仅向天气服务提供近似位置'); }
            catch (cause) { active.signal.throwIfAborted(); setWeatherLocation(null); setWeatherLocationStatus(cause instanceof Error ? cause.message : '定位不可用，可手动输入城市'); }
          }
        }
        answer = await askQuestion(value, { cloudConsent: config.agreement, webSearch: config.webSearch, status: config.status || {}, taskId: id, sessionId: conversationId.current, history: questionHistory, commercial: config.commercialMode, ...(config.weatherLocationAllowed && locationCoordinates ? { locationConsent: true, locationCoordinates } : {}) }, active.signal, (event, next) => {
        if (controller.current !== active || active.signal.aborted) return;
        setEvents(old => old.some(item => item.eventId && item.eventId === event.eventId) ? old : [...old, event].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999)));
        setState(next);
        }, chunk => { if (controller.current === active && !active.signal.aborted) setPartialAnswer(old => old + chunk); }, () => { if (controller.current === active && !active.signal.aborted) setPartialAnswer(''); });
      }
      else if (!config.commercialMode && config.status?.provider === 'deepseek' && (activeMode === 'prompt' || activeMode === 'translate')) {
        setState('answering');
        setNotice('正在生成预览；完成后才会写入外部输入框');
        answer = await postStream<AgentResult>('/api/process-stream', { mode: activeMode, text: value, taskId: id, cloudConsent: config.agreement, tone: config.tone, targetLanguage: config.targetLanguage }, active.signal, () => {}, chunk => {
          if (controller.current === active && !active.signal.aborted) setPartialAnswer(old => old + chunk);
        });
      } else answer = await processText({ mode: activeMode, text: value, taskId: id, cloudConsent: config.agreement, tone: config.tone, targetLanguage: config.targetLanguage }, active.signal, config.commercialMode) as AgentResult;
      active.signal.throwIfAborted();
      if (controller.current !== active || !answer.text?.trim()) throw new Error('文字服务没有返回有效结果');
      if (config.commercialMode && answer.search?.toolTrace?.length) setEvents(answer.search.toolTrace);
      if (activeMode === 'chat' && answer.search?.status === 'needs-confirmation') {
        setResult(answer); setState('needs-confirmation'); setNotice(answer.search.needsClarification || answer.text); setError('');
        void patch({ id, mode: activeMode, status: 'needs-confirmation', error: answer.search.needsClarification || '等待确认' });
        return;
      }
      setResult(answer); setPartialAnswer(''); setNotice(''); setState('completed');
      if(shouldAutoSpeakCompletedAnswer({mode:activeMode,webSearchEnabled:config.webSearch,searchPerformed:answer.search?.performed===true,autoSpeakEnabled:preferences.autoSpeakAnswers})){const candidate=conciseSpeechCandidate(answer.text);if(candidate.eligible)void speechController.play(candidate.text).catch(cause=>setNotice(cause instanceof Error?cause.message:'本机语音播放失败'));else setNotice('回答较长，为避免遗漏条件未自动朗读；可点击“播放回答”完整收听');}
      const facts=answer.search?.memory?.sessionFacts||answer.sessionFacts||[];setMemorySuggestions(facts.filter(item=>item.confirmedByUser===true));
      if ((activeMode === 'chat' || config.commercialMode) && !answer.simulated) setUsageRefresh(old => old + 1);
      if (activeMode === 'chat') setConversation(old => appendConversation(old, value, answer.text, answer.search?.sources));
      void patch({ id, mode: activeMode, status: 'completed', aiResult: activeMode === 'dictation' ? '' : answer.text, simulated: answer.simulated === true, attempt: { stage: activeMode === 'dictation' ? 'dictation' : 'ai', status: 'completed', result: answer.text, elapsedMs: Date.now() - started, provider: answer.historyContext?.provider, model: answer.historyContext?.model, search: answer.search } });
      if (automatic && desktopAvailable()) {
        if (activeMode === 'chat') void desktopInvoke('panel_window', { panel: 'chat', action: 'show' }).catch(() => {});
        try { active.signal.throwIfAborted(); await desktopInvoke('output_send_current', { text: answer.text }); setNotice('结果已提交到当前输入位置'); }
        catch (cause) { setNotice(`外部输入失败，结果仍保留：${String(cause)}`); }
      }
    } catch (cause) {
      if (controller.current !== active) return;
      const cancelled = active.signal.aborted;
      setPartialAnswer(''); setState(cancelled ? 'cancelled' : 'failed');
      if (!cancelled) setError(cause instanceof Error ? cause.message : '处理失败');
      void patch({ id, mode: activeMode, status: cancelled ? 'cancelled' : 'ai-failed', error: cancelled ? '用户取消' : cause instanceof Error ? cause.message : '处理失败', attempt: { stage: 'ai', status: cancelled ? 'cancelled' : 'failed', elapsedMs: Date.now() - started } });
    } finally { if (controller.current === active) { controller.current = null; activeTaskId.current = ''; pendingQuestion.current=''; } }
  };

  const handleCapture = async (blob: Blob) => {
    const current = task.current;
    if (!current) return;
    const ticket = generation.current;
    recordingBlob.current = blob;
    setAudioUrl(previous => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(blob); });
    const duration = (Date.now() - current.started) / 1000;
    void patch({ id: current.id, mode: current.mode, status: 'recorded', duration });
    void queueHistory(() => saveHistoryAudio(current.id, blob));
    if (latest.current.commercialMode ? !latest.current.commercialStatus?.signedIn || !latest.current.commercialStatus?.asrReady : !latest.current.status?.audioTranscription) { setState('completed'); setNotice(latest.current.commercialMode ? '账号语音服务不可用；录音仍可回放和导出' : '录音可回放和导出；语音识别未配置，未提交转写'); return; }
    const active = new AbortController(); controller.current = active; transcribingTask.current = { id: current.id, mode: current.mode }; setState('transcribing'); setNotice('正在准备录音数据…');
    const started = Date.now();
    try {
      const audio = await recordingToPcm(blob, active.signal);
      active.signal.throwIfAborted();
      if (ticket !== generation.current) return;
      const preparedAt = Date.now(); setNotice('音频已准备，正在等待语音识别…');
      // History writes remain ordered in historyQueue; disk persistence must not hold up ASR.
      void patch({ id: current.id, mode: current.mode, status: 'transcribing', duration: audio.duration });
      const asr = await transcribePcm(audio.pcm, latest.current.agreement, active.signal, current.id, latest.current.commercialMode);
      active.signal.throwIfAborted();
      if (ticket !== generation.current) return;
      setTranscript(asr.text); transcribingTask.current = null;
      if (!asr.simulated) setUsageRefresh(old => old + 1);
      setState('completed');
      setNotice(asr.simulated ? '模拟转写，未识别真实音频' : '转写完成；检查原文后可使用或继续处理');
      void patch({ id: current.id, mode: current.mode, status: 'transcribed', originalTranscript: asr.text, simulated: asr.simulated, attempt: { stage: 'asr', status: 'completed', transcript: asr.text, elapsedMs: Date.now() - started, audioPreparationMs: preparedAt - started, asrRequestMs: Date.now() - preparedAt, stopToFinalMs: stoppedAt.current === null ? undefined : Math.round(performance.now() - stoppedAt.current), provider: asr.historyContext?.provider, model: asr.historyContext?.model } });
      if (captureOrigin.current === 'external' && !asr.simulated) await processCurrent(asr.text, current.mode, current.id, true);
    } catch (cause) {
      if (ticket !== generation.current) return;
      const cancelled = active.signal.aborted;
      setState(cancelled ? 'cancelled' : 'failed');
      if (!cancelled) setError(cause instanceof Error ? cause.message : '转写失败');
      void patch({ id: current.id, mode: current.mode, status: cancelled ? 'cancelled' : 'asr-failed', error: cancelled ? '用户取消' : cause instanceof Error ? cause.message : '转写失败', attempt: { stage: 'asr', status: cancelled ? 'cancelled' : 'failed', elapsedMs: Date.now() - started } });
    } finally { if (controller.current === active) controller.current = null; if (transcribingTask.current?.id === current.id) transcribingTask.current = null; }
  };

  useEffect(() => {
    void refreshStatus(); void refreshDevices();
    const current = createRecordingSession({ getUserMedia: navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices), Recorder: window.MediaRecorder, onState: (next: string) => { if (next === 'acquiring') stoppedAt.current = null; if (next === 'stopping') stoppedAt.current = performance.now(); setCapture(next); recordShortcutDiagnostic('capture_state', next, liveCaptureState.current.busy, next); }, onStream: attachMeter, onComplete: (blob: Blob) => void handleCapture(blob), onError: (cause: Error) => { const unavailable=['NotFoundError','OverconstrainedError'].includes((cause as Error & {name?:string}).name||'');const message=unavailable?(latest.current.preferences.interfaceLanguage==='en-US'?'The saved microphone is unavailable. Choose another device in Settings; recording will not switch automatically.':'已保存的麦克风不可用；请在设置中重新选择，录音不会自动切换。'):cause.message;setError(message); setState('failed'); if (task.current) void patch({ id: task.current.id, mode: task.current.mode, status: 'asr-failed', error: message }); } }) as Session;
    session.current = current;
    return () => { generation.current++; controller.current?.abort(); current.dispose(); attachMeter(null); if (timer.current) window.clearInterval(timer.current); };
  }, []);
  useEffect(() => {
    if (!rememberConversation) { setMemoryLoading(false); return; }
    const active = new AbortController();
    setMemoryLoading(true);
    void loadSavedConversation(active.signal).then(saved => {
      if (active.signal.aborted) return;
      setMemoryAvailable(saved.savingEnabled);
      if (!saved.savingEnabled) {
        setRememberConversation(false);
        localStorage.removeItem('talkcraft-remember-chat-v1');
        setNotice('文字历史未开启，无法恢复以往问答');
      } else setConversation(old => old.length ? old : saved.conversation);
    }).catch(cause => { if (!active.signal.aborted) setSaveError(`问答上下文恢复失败：${cause instanceof Error ? cause.message : '未知错误'}`); })
      .finally(() => { if (!active.signal.aborted) setMemoryLoading(false); });
    return () => active.abort();
  }, [rememberConversation]);
  useEffect(()=>{let active=true;void readUserPreferences().then(async snapshot=>{if(!active)return;preferenceRevision.current=snapshot.revision;let value=snapshot.preferences;if(!snapshot.exists){const legacy=localStorage.getItem('talkcraft-react-theme');if(legacy==='light'||legacy==='dark'){value={...value,theme:legacy};try{const migrated=await saveUserPreferences(snapshot.revision,value);if(!active)return;preferenceRevision.current=migrated.revision;value=migrated.preferences;localStorage.removeItem('talkcraft-react-theme');}catch{/* retain the legacy value until a later successful save */}}}setPreferences(value);setTargetLanguage(value.targetLanguage);setDeviceId(value.inputDeviceId);setSpeechPreferences({voiceURI:value.speechVoiceURI,rate:value.speechRate,volume:value.speechVolume});}).catch(cause=>setSaveError(`常用设置读取失败：${cause instanceof Error?cause.message:'未知错误'}`));return()=>{active=false;}},[]);
  useEffect(()=>{const apply=()=>{const selected=preferences.theme;const dark=selected==='system'?(window.matchMedia?.('(prefers-color-scheme: dark)').matches??true):selected==='dark';setTheme(dark?'dark':'light');document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.dataset.uiLanguage=preferences.interfaceLanguage;};apply();const media=window.matchMedia?.('(prefers-color-scheme: dark)');media?.addEventListener?.('change',apply);return()=>media?.removeEventListener?.('change',apply);},[preferences.theme,preferences.interfaceLanguage]);
  useEffect(()=>{captureSounds.current=createCaptureSounds({enabled:preferences.captureSounds,volume:preferences.soundVolume});return()=>{captureSounds.current?.dispose();captureSounds.current=null;}},[]);
  useEffect(()=>{captureSounds.current?.setOptions({enabled:preferences.captureSounds,volume:preferences.soundVolume});},[preferences.captureSounds,preferences.soundVolume]);
  useEffect(()=>{if(typeof BroadcastChannel==='undefined')return;const channel=new BroadcastChannel('talkcraft-user-preferences-v1');const onChange=(event:MessageEvent<{preferences:UserPreferences;revision:string}>)=>{try{const value=event.data?.preferences;if(!value||value.schemaVersion!==1)return;preferenceRevision.current=event.data.revision;setPreferences(value);setTargetLanguage(value.targetLanguage);setDeviceId(value.inputDeviceId);setSpeechPreferences({voiceURI:value.speechVoiceURI,rate:value.speechRate,volume:value.speechVolume});}catch{}};channel.addEventListener('message',onChange);return()=>{channel.removeEventListener('message',onChange);channel.close();};},[]);
  useEffect(() => {
    const onCapture = (event: Event) => captureSounds.current?.update((event as CustomEvent<{ state: string }>).detail?.state);
    window.addEventListener('talkcraft-react-capture', onCapture);
    return () => { window.removeEventListener('talkcraft-react-capture', onCapture); };
  }, []);
  useEffect(() => { window.dispatchEvent(new CustomEvent('talkcraft-react-capture', { detail: { state: capture } })); }, [capture]);
  useEffect(() => {
    if (!desktopAvailable()) return;
    let active = true;
    void desktopInvoke<{ bindings: Record<string, string> }>('shortcuts_read').then(value => { if (active) setKeymapBindings(value.bindings); }).catch(() => {});
    const updated = (event: Event) => setKeymapBindings((event as CustomEvent<Record<string, string>>).detail);
    window.addEventListener('talkcraft-shortcuts-updated', updated);
    return () => { active = false; window.removeEventListener('talkcraft-shortcuts-updated', updated); };
  }, []);
  useEffect(() => { if (capture !== 'recording') { if (timer.current) window.clearInterval(timer.current); return; } timer.current = window.setInterval(() => setSeconds(Math.min(120, Math.floor((Date.now() - (task.current?.started || Date.now())) / 1000))), 250); return () => { if (timer.current) window.clearInterval(timer.current); }; }, [capture]);

  const startRecording = async (origin: 'workbench' | 'external' = 'workbench', requestedMode: WorkMode = mode) => {
    speechController.stop();
    if (busy || capture !== 'idle' && capture !== 'ready' && capture !== 'error') return false;
    if (!agreement) { setError('请先阅读并同意使用说明'); return false; }
    generation.current++; setError(''); setNotice(''); setSeconds(0); captureOrigin.current = origin;
    const current = { id: crypto.randomUUID(), mode: requestedMode, started: Date.now() }; task.current = current;
    void patch({ id: current.id, mode: requestedMode, status: 'acquiring' });
    if (origin === 'external') recordShortcutDiagnostic('start_requested', capture, busy, session.current?.state || capture);
    const started = await session.current?.start({ ...(deviceId ? { deviceId } : {}) }) ?? false;
    if (origin === 'external') recordShortcutDiagnostic(started ? 'start_result_true' : 'start_result_false', capture, busy, session.current?.state || capture);
    void refreshDevices();
    return started;
  };
  const cancel = () => {
    speechController.stop();
    const processingCancelled = Boolean(controller.current); controller.current?.abort(); const captureCancelled = session.current?.cancel() ?? false;
    generation.current++;
    if (task.current && capturing) void patch({ id: task.current.id, mode: task.current.mode, status: 'cancelled', error: '用户取消' });
    // The transcription catch block returns early after this generation bump, so close
    // the record here; a record left as transcribing cannot be deleted until restart.
    else if (transcribingTask.current) { const stuck = transcribingTask.current; transcribingTask.current = null; void patch({ id: stuck.id, mode: stuck.mode, status: 'cancelled', error: '用户取消', attempt: { stage: 'asr', status: 'cancelled' } }); }
    setPartialAnswer(''); setNotice(''); setState('cancelled'); setCapture('idle');
    return processingCancelled || captureCancelled;
  };
  const applyTranscript = () => { if (!transcript) return; if (draft.trim() && draft !== transcript && !window.confirm('使用转录将替换当前输入文字，继续吗？')) return; setDraft(transcript); setNotice('已将原始转录放入输入框；原始版本仍单独保留'); };
  const exportCurrent = async () => { if (!recordingBlob.current) return; try { const bytes = await recordingBlob.current.arrayBuffer(); const format = recordingBlob.current.type.includes('webm') ? 'webm' : recordingBlob.current.type.includes('mp4') ? 'm4a' : recordingBlob.current.type.includes('wav') ? 'wav' : ''; if (!format) throw new Error('当前录音格式未知，无法安全导出'); const name = `TalkCraft_${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}_${mode}.${format}`; if (desktopAvailable()) { const outcome = await exportFile(name, bytes); setNotice(outcome === 'saved' ? '录音已导出' : '已取消导出'); } else { const link = document.createElement('a'); const url = URL.createObjectURL(recordingBlob.current); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('录音下载已开始'); } } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败'); } };
  const run = () => void processCurrent(draft, mode, task.current?.mode === mode && transcript && draft === transcript ? task.current.id : crypto.randomUUID());
  const copy = async (value: string) => { try { await clipboardWrite(value); setNotice('已复制全文'); } catch { setError('复制失败，请手动选择文字'); } };
  const selectMode = (next: WorkMode) => { if (busy || capturing) return; setMode(next); setResult(null); setError(''); task.current = null; };
  const changeMemory = (enabled: boolean) => {
    setRememberConversation(enabled);
    if (enabled) localStorage.setItem('talkcraft-remember-chat-v1', 'true');
    else localStorage.removeItem('talkcraft-remember-chat-v1');
  };

  const desktopActions = useRef({ startRecording, cancel, mode, capture, busy, result });
  desktopActions.current = { startRecording, cancel, mode, capture, busy, result };
  useEffect(() => {
    if (!desktopAvailable() || typeof BroadcastChannel === 'undefined') return;
    const desktop = window as Window & { __TALKCRAFT_SESSION__?: string };
    const channel = new BroadcastChannel(`talkcraft-desktop-hud-v1-${desktop.__TALKCRAFT_SESSION__ || 'legacy'}`);
    const onMessage = (event: MessageEvent) => {
      const action = event.data?.type;
      if (action === 'sync') { channel.postMessage(hudPacket.current); return; }
      if (action === 'cancel') { desktopActions.current.cancel(); return; }
      if (action === 'copy' && desktopActions.current.result?.text) void copy(desktopActions.current.result.text);
      if (action === 'language' && Object.hasOwn(languages, event.data.language)) setTargetLanguage(event.data.language);
      if (action === 'record') {
        const current = desktopActions.current;
        if (current.busy) current.cancel();
        else if (current.capture === 'recording') session.current?.stop();
        else if (current.capture === 'acquiring' || current.capture === 'stopping') current.cancel();
        else void current.startRecording('external', current.mode);
      }
    };
    const onShortcut = (event: Event) => {
      const action = (event as CustomEvent<{ action: string }>).detail?.action;
      const current = desktopActions.current;
      if (['dictation', 'prompt', 'translate', 'chat'].includes(action)) {
        recordShortcutDiagnostic('action_received', current.capture, current.busy, session.current?.state || current.capture);
        void routeRecordingShortcut(action, {
          capture: current.capture,
          busy: current.busy,
          session: { get state() { return session.current?.state || current.capture; }, stop: () => { recordShortcutDiagnostic('stop_requested', current.capture, current.busy, session.current?.state || current.capture); const stopped = session.current?.stop() ?? false; recordShortcutDiagnostic(stopped ? 'stop_result_true' : 'stop_result_false', liveCaptureState.current.capture, liveCaptureState.current.busy, session.current?.state || liveCaptureState.current.capture); return stopped; } },
          cancel: () => { recordShortcutDiagnostic('cancel_requested', current.capture, current.busy, session.current?.state || current.capture); const cancelled = current.cancel(); recordShortcutDiagnostic(cancelled ? 'cancel_result_true' : 'cancel_result_false', liveCaptureState.current.capture, liveCaptureState.current.busy, session.current?.state || liveCaptureState.current.capture); return cancelled; },
          start: (requestedMode: WorkMode) => { setMode(requestedMode); return current.startRecording('external', requestedMode); },
        });
      } else if (action === 'process' && !current.busy && !['recording', 'acquiring', 'stopping'].includes(current.capture)) {
        void processCurrent(latest.current.draft, latest.current.mode);
      }
    };
    channel.addEventListener('message', onMessage);
    window.addEventListener('talkcraft-shortcut', onShortcut);
    return () => { channel.removeEventListener('message', onMessage); window.removeEventListener('talkcraft-shortcut', onShortcut); channel.close(); };
  }, []);
  useEffect(() => {
    if (!desktopAvailable() || typeof BroadcastChannel === 'undefined') return;
    const desktop = window as Window & { __TALKCRAFT_SESSION__?: string };
    const channel = new BroadcastChannel(`talkcraft-desktop-hud-v1-${desktop.__TALKCRAFT_SESSION__ || 'legacy'}`);
    channel.postMessage(hudPacket.current);
    channel.close();
  }, [capture, busy, state, result, partialAnswer, mode, seconds, error, notice, conversation, theme, targetLanguage, wave, level, keymapBindings]);
  hudPacket.current = { type: 'state', status: error || (busy && partialAnswer ? `预览：${partialAnswer.slice(-24)}` : notice || states[state]), capture, processing: busy, ready: Boolean(result?.text), output: result?.text || '', chatHistory: conversation.map(item => `${item.role === 'user' ? '你' : 'AI'}：${item.content}`).join('\n\n'), chatTurns: conversation, mode: names[mode], time: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`, level, wave, dark: theme === 'dark', disabled: busy || capture === 'acquiring' || capture === 'stopping', recordLabel: capture === 'recording' ? '完成' : '录音', language: targetLanguage, limitLabel: '上限 02:00', limitStatus: '单次录音最多2分钟', keymapBindings };

  return <main className="react-shell">
    {!agreement && <div className="agreement-backdrop"><section className="agreement-dialog" role="dialog" aria-modal="true" aria-labelledby="agreement-title"><h2 id="agreement-title">欢迎使用 TalkCraft</h2><p>主动转写时，录音会发送到所配置的语音识别服务；若配置了识别热词，热词会随每次转写请求发送。主动处理文字时，文字及问答上下文会发送到所配置的文字服务，可能产生费用。本机 Ollama 请求仅发送至本机，失败不会自动上传云端。</p><p>录音仅在启动后进行，音频默认不持久保存。历史保存遵循本机设置。成功任务的字数、时长和任务 ID 会作为本机统计单独保存，不含正文，可在首页清空。系统麦克风权限仍由系统单独请求。</p><button className="primary" onClick={() => { localStorage.setItem('talkcraft-agreement-v1', 'accepted'); setAgreement(true); }}>同意并继续</button></section></div>}
    <header><div><strong>TalkCraft</strong></div><nav><button className={view === 'workbench' ? 'active' : ''} onClick={() => setView('workbench')}>{uiEnglish?'Workbench':'工作台'}</button><button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>{uiEnglish?'History':'历史记录'}</button><button className={view === 'memories' ? 'active' : ''} onClick={() => setView('memories')}>{uiEnglish?'Memory':'个人记忆'}</button><button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>{uiEnglish?'Settings':'设置'}</button></nav><span className={commercialMode && commercialStatus?.signedIn || status ? 'status online' : 'status'}>{commercialMode ? commercialStatus?.signedIn ? `账号服务 · ${commercialStatus.asrReady ? '语音可用' : '语音未配置'}` : '账号服务未连接' : status ? `${status.simulated ? '模拟文字服务' : status.local ? '本机文字服务' : status.provider || '文字服务'} · ${status.audioTranscription ? status.asrSimulated ? '模拟语音' : '语音可用' : '语音未配置'}` : '服务未连接'}</span><DesktopChrome hasUnsaved={capturing || busy || Boolean(audioUrl)} waitForHistory={() => historyQueue.current} /></header>
    {view === 'history' ? <HistoryPanel revision={historyRevision} /> : view==='memories'?<MemoryPanel key={commercialStatus?.account?.id||'guest'}/> : view === 'settings' ? <SettingsPanel preferences={preferences} onSavePreferences={savePreferences} devices={devices} onRefreshDevices={refreshDevices} onPreviewSound={volume=>{captureSounds.current?.setOptions({enabled:true,volume});captureSounds.current?.PlayStartSound?.();}} onServiceChanged={refreshStatus} agreement={agreement} onRevoke={() => { cancel(); localStorage.removeItem('talkcraft-agreement-v1'); setAgreement(false); }} /> : <div className="workbench-layout"><div className="workbench-content">
      <section className="react-card mode-card"><div className="mode-tabs">{(Object.keys(names) as WorkMode[]).map(item => <button key={item} aria-pressed={mode === item} className={mode === item ? 'active' : ''} onClick={() => selectMode(item)}>{visibleNames[item]}</button>)}</div></section>
      <section className="react-card device-strip"><label>{uiEnglish?'Microphone':'录音设备'} <select value={deviceId} disabled={capturing || busy} onChange={event => setDeviceId(event.target.value)}><option value="">{uiEnglish?'System default microphone':'电脑默认麦克风'}</option>{deviceId&&!devices.some(device=>device.deviceId===deviceId)&&<option value={deviceId} disabled>{uiEnglish?'Saved microphone unavailable':'已保存麦克风不可用'}</option>}{devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || '麦克风设备'}</option>)}</select></label><button onClick={refreshDevices} disabled={capturing}>{uiEnglish?'Refresh devices':'刷新设备'}</button><span className="muted">{uiEnglish?'Recording limit 02:00':'单次上限 02:00'}</span></section>
      <section className="react-grid"><article className="react-card input-card"><div className="eyebrow">{names[mode]}</div><h1>{capture === 'recording' ? '正在录音' : '输入内容'}</h1><p className="muted">{capture === 'recording' ? `已录音 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} / 02:00` : '录音结束后自动转写；文字处理由你启动。'}</p>
        <div className="actions"><button className="primary" disabled={busy || capturing} onClick={() => void startRecording()}>开始录音</button><button disabled={capture !== 'recording'} onClick={() => session.current?.stop()}>结束录音</button><button disabled={!busy && !capturing} onClick={cancel}>取消当前任务</button></div>
        {audioUrl && <><audio controls src={audioUrl} aria-label={uiEnglish?'Current recording playback':'当前录音回放'} /><button onClick={() => void exportCurrent()}>{uiEnglish?'Export recording…':'导出当前录音…'}</button></>}
        {transcript && <div className="transcript-preview"><b>原始转录</b><pre>{transcript}</pre><button onClick={applyTranscript}>使用转录</button><button onClick={() => void copy(transcript)}>复制原始转录</button></div>}
        {mode === 'prompt' && <label>文字预设 <select value={tone} onChange={event => setTone(event.target.value)}><option value="business">商务严谨</option><option value="natural">口语精简</option><option value="email">邮件排版</option><option value="points">结构化</option></select></label>}
        {mode === 'translate' && <label>{uiEnglish?'Target language':'目标语言'} <select value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)}>{Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{uiEnglish?code:name}</option>)}</select></label>}
        {mode === 'chat' && <div className="chat-options"><label className="consent"><input type="checkbox" checked={webSearch} disabled={commercialMode ? !commercialStatus?.webSearchAvailable : !status?.webSearchAvailable && !status?.weatherAvailable} onChange={event => { searchTouched.current = true; setWebSearch(event.target.checked); }} /> 联网问答</label><label className="consent"><input type="checkbox" checked={rememberConversation} disabled={busy || memoryLoading} onChange={event => changeMemory(event.target.checked)} /> 跨重启继续问答</label><button type="button" disabled={!conversation.length || busy} onClick={() => { speechController.stop();setConversation([]);conversationId.current=crypto.randomUUID(); changeMemory(false); setNotice('已清空当前会话；已保存的历史可在历史记录中删除'); }}>清空会话</button><span className="muted">{memoryLoading ? '正在读取本机历史…' : `${conversation.length / 2} 轮上下文${rememberConversation && memoryAvailable ? ' · 来自本机已保存历史' : ''}`}</span><div className="weather-location-control"><span className="muted">天气位置（可选）</span>{weatherLocationAllowed ? <button type="button" onClick={revokeWeatherLocation}>关闭当前位置</button> : <button type="button" onClick={() => void allowWeatherLocation()}>允许使用当前位置</button>}<span className="muted" role="status">{weatherLocationStatus}</span><small>仅在天气问题没有明确城市时使用；系统只保存授权开关，近似坐标仅保存在内存，不写入历史或个人记忆；坐标会经 TalkCraft 天气服务发送给天气提供方，不发给文字模型。定位不可用时可直接输入城市。联网问答开关仍单独控制天气查询。</small></div></div>}
        <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder={uiEnglish?'Type here, or record and use the transcript':'输入内容，或录音转写后选择使用转录'} /><div className="actions"><button className="primary" disabled={capturing || busy && mode !== 'chat' || !draft.trim()} onClick={run}>{mode === 'dictation' ? uiEnglish?'Use text':'使用文字' : mode === 'chat' ? busy ? uiEnglish?'Stop and ask a new question':'停止当前查询并按新问题继续' : uiEnglish?'Ask':'开始问答' : uiEnglish?'Process text':'AI 智能处理'}</button><button onClick={refreshStatus} disabled={busy}>{uiEnglish?'Check services':'检查服务'}</button></div><p className="live-status" role="status">{error || notice || (capture === 'recording' ? uiEnglish?'Recording':'录音中' : states[state])}</p>{saveError && <p className="error-text">{saveError}</p>}</article>
        <article className="react-card output-card"><div className="eyebrow">{uiEnglish?'Result':'处理结果'}</div><h2>{result ? visibleNames[mode] : partialAnswer ? uiEnglish?'Generating response':'正在生成结果' : uiEnglish?'Waiting for response':'等待结果'}</h2><AnswerText result={partialAnswer ? { text: partialAnswer } : result} enableSpeech={!!result?.text&&state==='completed'} />{result?.text && <button onClick={() => void copy(result.text)}>{uiEnglish?'Copy answer':'复制结果'}</button>}{memorySuggestions.length>0&&<aside className="memory-suggestions" aria-label="本次对话中的个人信息"><strong>本次对话提到的信息</strong><p>这些内容目前只在本次会话中；确认后才会保存到个人记忆。</p>{memorySuggestions.map((fact,index)=><div className="memory-suggestion" key={`${fact.predicate}:${fact.object}:${index}`}><span>{fact.predicate==='likes-eating'?`喜欢吃：${fact.object}`:fact.predicate==='eats'?`${fact.frequency==='occasional'?'偶尔吃':'提到吃'}：${fact.object}`:`提到：${fact.object}`}</span><button type="button" onClick={async()=>{try{const content=fact.provenance?.text||`${fact.predicate}：${fact.object}${fact.frequency==='occasional'?'（偶尔）':''}`;await createMemory({type:fact.predicate==='likes-eating'?'preference':'fact',content,reason:`用户确认保存：${content}`,sourceRecordId:task.current?.id||null,independent:false,syncSelected:false});setMemorySuggestions(old=>old.filter((_,i)=>i!==index));setNotice('已保存为个人记忆；默认仅保存在当前设备');}catch(cause){setError(cause instanceof Error?cause.message:'个人记忆保存失败');}}}>保存为个人记忆</button></div>)}</aside>}<AnswerSources answer={result?.text || ''} search={result?.search} /><ExecutionTracePanel state={state} events={events} sources={result?.search?.sources || []} search={result?.search} showSources={false} /><OutputPanel text={result?.text || ''} /></article></section>
    </div><UsageCard refreshKey={usageRefresh} commercialMode={commercialMode} onCommercialMode={setCommercialMode} onCommercialStatus={handleCommercialStatus} busy={busy || capturing} /></div>}
  </main>;
}
