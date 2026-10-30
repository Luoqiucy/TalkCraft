import {safeSourceUrl} from '../search-orchestrator.mjs';
import {validatePublicUrl} from '../tools/webpage.mjs';

const endpoint='https://api.firecrawl.dev/v2/search';
const limited=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function createFirecrawlSearch({apiKey,fetchImpl=fetch,timeoutMs=12000}={}){
  if(typeof apiKey!=='string'||!apiKey.trim()||/[\r\n]/.test(apiKey))throw new Error('Firecrawl API Key 无效');
  return async function search(query,{signal,maxResults=5}={}){
    if(typeof query!=='string'||!query.trim()||query.length>4000)throw new Error('搜索词无效');
    const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout,started=Date.now();
    let response;try{response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:combined,headers:{Authorization:`Bearer ${apiKey.trim()}`,'Content-Type':'application/json'},body:JSON.stringify({query:query.trim(),limit:Math.min(8,Math.max(1,maxResults)),sources:[{type:'web'}]})});}catch(error){if(signal?.aborted)signal.throwIfAborted();throw new Error(timeout.aborted?'Firecrawl 搜索超时':'Firecrawl 搜索网络失败');}
    if(!response.ok){await response.body?.cancel();throw new Error(response.status===401||response.status===403?'Firecrawl 凭据或权限无效':`Firecrawl 搜索失败（HTTP ${response.status}）`);}
    let data;try{const body=await response.text();if(body.length>1024*1024)throw Error();data=JSON.parse(body);}catch{throw new Error('Firecrawl 搜索响应格式错误');}
    const list=[...(Array.isArray(data?.data?.web)?data.data.web:[]),...(Array.isArray(data?.web)?data.web:[]),...(Array.isArray(data?.data)?data.data:[])];
    const seen=new Set(),sources=[];for(const item of list){const url=safeSourceUrl(item?.url||item?.metadata?.sourceURL);if(!url||seen.has(url))continue;try{validatePublicUrl(url);}catch{continue;}seen.add(url);sources.push({url,title:limited(item.title||item.metadata?.title||url,300),snippet:limited(item.description||item.markdown||item.metadata?.description,1200),publishedAt:limited(item.publishedAt||item.metadata?.publishedTime,100)||null,fetchedAt:new Date().toISOString()});if(sources.length>=maxResults)break;}
    const credits=Number(data?.creditsUsed??data?.metadata?.creditsUsed);
    return {performed:true,requested:true,status:sources.length?'searched':'no-results',backend:'firecrawl',sources,elapsedMs:Date.now()-started,usage:{webSearchRequests:1,...(Number.isFinite(credits)?{firecrawlCredits:credits}:{})}};
  };
}
