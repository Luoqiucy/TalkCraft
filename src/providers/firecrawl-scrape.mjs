import {safeSourceUrl} from '../search-orchestrator.mjs';
import {validatePublicUrlDns} from '../tools/webpage.mjs';

const endpoint='https://api.firecrawl.dev/v2/scrape';
const limitText=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
async function readBoundedJson(response,maxBytes,signal){
 const reader=response.body?.getReader?.();if(!reader){const buffer=await response.arrayBuffer();if(buffer.byteLength>maxBytes)throw new Error('limit');return new TextDecoder().decode(buffer);}
 const chunks=[];let size=0;try{while(true){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('limit');}chunks.push(value);}}finally{reader.releaseLock?.();}
 const merged=new Uint8Array(size);let offset=0;for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(merged);
}

export function createFirecrawlScrape({apiKey,fetchImpl=fetch,lookupImpl,timeoutMs=15000,maxResponseBytes=2*1024*1024,maxTextChars=24000}={}){
  if(typeof apiKey!=='string'||!apiKey.trim()||/[\r\n]/.test(apiKey))throw new Error('Firecrawl API Key 无效');
 return async function scrape(value,{signal}={}){
  const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout,started=Date.now();
  const url=await validatePublicUrlDns(value,{signal:combined,...(lookupImpl?{lookupImpl}:{})});
  const safeUrl=safeSourceUrl(url.href);if(!safeUrl)throw new Error('网页地址包含不可保留的敏感信息');
  let response;
  try{response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:combined,headers:{Authorization:`Bearer ${apiKey.trim()}`,'Content-Type':'application/json'},body:JSON.stringify({url:safeUrl,formats:['markdown'],onlyMainContent:true})});}
  catch(error){if(signal?.aborted)signal.throwIfAborted();throw new Error(timeout.aborted?'Firecrawl 正文抓取超时':'Firecrawl 正文抓取网络失败');}
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===401||response.status===403?'Firecrawl 凭据或权限无效':`Firecrawl 正文抓取失败（HTTP ${response.status}）`);}
  let raw;try{raw=await readBoundedJson(response,maxResponseBytes,combined);}catch(error){if(signal?.aborted)signal.throwIfAborted();if(timeout.aborted)throw new Error('Firecrawl 正文抓取超时');throw new Error(error.message==='limit'?'Firecrawl 正文响应超过读取上限':'Firecrawl 正文响应无法读取');}
  let body;try{body=JSON.parse(raw);}catch{throw new Error('Firecrawl 正文响应格式错误');}
  if(body?.success===false)throw new Error('Firecrawl 未能读取该网页正文');
  const data=body?.data||body,metadata=data?.metadata||{},text=limitText(data?.markdown||data?.content||'',maxTextChars);
  if(text.length<40)throw new Error('Firecrawl 返回的网页正文为空或过短');
  const finalCandidate=safeSourceUrl(metadata.sourceURL||metadata.url||safeUrl)||safeUrl;
  const finalUrl=safeSourceUrl((await validatePublicUrlDns(finalCandidate,{signal:combined,...(lookupImpl?{lookupImpl}:{})})).href);
  if(!finalUrl)throw new Error('Firecrawl 返回的最终网页地址无效');
  const title=limitText(metadata.title||metadata.ogTitle||finalUrl,300);
  const credits=Number(body?.creditsUsed??data?.creditsUsed??metadata?.creditsUsed);
  return {url:safeUrl,finalUrl,title,text,publishedAt:limitText(metadata.publishedTime||metadata.publishedAt||metadata.datePublished,100)||null,fetchedAt:new Date().toISOString(),contentType:'text/markdown',readMethod:'firecrawl',elapsedMs:Date.now()-started,usage:{scrapeRequests:1,...(Number.isFinite(credits)?{firecrawlCredits:credits}:{})}};
 };
}

export const firecrawlScrapeEndpoint=endpoint;
