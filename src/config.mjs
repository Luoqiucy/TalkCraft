import {mockProvider} from './pipeline.mjs';
import {createArkProvider} from './providers/ark.mjs';
import {createOpenAIProvider,createDeepSeekProvider,createOllamaProvider} from './providers/text.mjs';
export function requiresTextCloudConsent(provider) {return !provider.simulated && provider.local !== true;}
export function loadProvider(env = process.env) {
  const selected = env.TEXT_PROVIDER || 'mock';
  if (selected === 'mock') return {...mockProvider, id: 'mock'};
  const common={timeoutMs:env.TEXT_TIMEOUT_MS===undefined ? 30000 : Number(env.TEXT_TIMEOUT_MS)};
  if(selected==='openai') return createOpenAIProvider({...common,apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL});
  if(selected==='deepseek') return createDeepSeekProvider({...common,apiKey:env.DEEPSEEK_API_KEY,model:env.DEEPSEEK_MODEL,firecrawlApiKey:env.FIRECRAWL_API_KEY});
  if(selected==='ollama') return createOllamaProvider({...common,baseUrl:env.OLLAMA_BASE_URL,model:env.OLLAMA_MODEL});
  if (selected !== 'ark') throw new Error('TEXT_PROVIDER 仅支持 mock、ark、openai、deepseek 或 ollama');
  return createArkProvider({apiKey: env.ARK_API_KEY, model: env.ARK_MODEL, timeoutMs: env.TEXT_TIMEOUT_MS === undefined ? 30000 : Number(env.TEXT_TIMEOUT_MS)});
}
export function providerStatus(provider,asr) {
  const status={provider: provider.id || (provider.simulated ? 'mock' : 'custom'), simulated: provider.simulated === true, audioTranscription: !!asr?.enabled};
  if(typeof provider.search==='function')status.webSearchAvailable=true;
  if(typeof provider.scrape==='function')status.webScrapeAvailable=true;
  if(provider.local===true) status.local=true;
  if(asr?.enabled) Object.assign(status,{asrProvider:asr.id,asrSimulated:asr.simulated===true});
  return status;
}
