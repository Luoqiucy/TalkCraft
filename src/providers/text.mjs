import {createJsonTextProvider} from './ark.mjs';
import {createDeepSeekSearchProvider,deepSeekSearchEndpoint} from './deepseek-search.mjs';
import {createFirecrawlSearch} from './firecrawl-search.mjs';
import {createFirecrawlScrape} from './firecrawl-scrape.mjs';
export function createOpenAIProvider(options={}) {
  return createJsonTextProvider({...options,id:'openai',local:false,endpoint:'https://api.openai.com/v1/chat/completions'});
}
export function createDeepSeekProvider(options={}) {
  const provider=createJsonTextProvider({...options,id:'deepseek',local:false,endpoint:'https://api.deepseek.com/chat/completions'});
  const nativeSearch=createDeepSeekSearchProvider(options);
  if(options.firecrawlApiKey){const firecrawl=createFirecrawlSearch({apiKey:options.firecrawlApiKey,fetchImpl:options.fetchImpl}),scrape=createFirecrawlScrape({apiKey:options.firecrawlApiKey,fetchImpl:options.fetchImpl,lookupImpl:options.lookupImpl});provider.search=async(query,input)=>{try{return await firecrawl(query,input);}catch(error){input?.signal?.throwIfAborted();const fallback=await nativeSearch(query,input);return {...fallback,backend:'deepseek-native-fallback',fallbackReason:error.message};}};provider.scrape=scrape;provider.searchEndpoint='https://api.firecrawl.dev/v2/search';provider.scrapeEndpoint='https://api.firecrawl.dev/v2/scrape';}
  else{provider.search=nativeSearch;provider.searchEndpoint=deepSeekSearchEndpoint;}
  return provider;
}
export function createOllamaProvider({baseUrl='http://127.0.0.1:11434',...options}={}) {
  let url;try {url=new URL(baseUrl);}catch {throw new Error('Ollama 地址格式错误');}
  if(url.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw new Error('Ollama 地址仅支持本机 HTTP 根地址');
  return createJsonTextProvider({...options,id:'ollama',local:true,endpoint:new URL('/api/chat',url).href});
}
