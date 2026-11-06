import {randomUUID} from 'node:crypto';
const safeText=(value,max)=>typeof value==='string'?value.slice(0,max):'';

export class ToolRegistry {
  #tools=new Map();
  register(definition){
    if(!definition||typeof definition.name!=='string'||!/^[a-z][a-z0-9_]{1,63}$/.test(definition.name)||typeof definition.description!=='string'||typeof definition.execute!=='function')throw new Error('工具定义无效');
    if(this.#tools.has(definition.name))throw new Error(`工具已注册：${definition.name}`);
    this.#tools.set(definition.name,Object.freeze({...definition,readOnly:definition.readOnly!==false}));return this;
  }
  get(name){return this.#tools.get(name);}
  list(){return [...this.#tools.values()].map(({execute,validate,...definition})=>structuredClone(definition));}
  async execute(name,args,context={}){
    const tool=this.get(name);if(!tool)throw new Error(`未知工具：${safeText(name,80)}`);
    context.signal?.throwIfAborted();const validated=tool.validate?tool.validate(args):args,started=Date.now(),callId=context.callId||randomUUID(),stage=name==='search_web'?'searching':name==='read_webpage'||name==='scrape_webpage'?'reading':name==='get_weather'?'weather':'tool';
    const input=name==='search_web'?{query:safeText(validated.query,4000)}:name==='read_webpage'||name==='scrape_webpage'?{url:safeText(validated.url,2000),method:name==='scrape_webpage'?'firecrawl':'local'}:name==='get_weather'?{location:safeText(validated.intent?.location||(validated.intent?.coordinates?'当前位置附近':''),200),...(Array.isArray(validated.intent?.locations)?{locations:validated.intent.locations.slice(0,2).map(value=>safeText(value,40))}:{}),period:safeText(validated.intent?.period,40)}:{};
    const emit=event=>context.onStatus?.({taskId:context.taskId,callId,sequence:context.nextSequence?.(),stage,tool:name,...(context.prefetch?{prefetch:true}:{}),...event});
    // An optional per-call limit (used for automatic page pre-reads) reports a plain
    // failure, so a slow site is never shown to the user as a cancelled task.
    const callTimeout=Number.isFinite(context.timeoutMs)&&context.timeoutMs>0?AbortSignal.timeout(context.timeoutMs):null;
    const signal=callTimeout?(context.signal?AbortSignal.any([context.signal,callTimeout]):callTimeout):context.signal;
    emit({status:'running',at:new Date(started).toISOString(),input});
    try{const data=await tool.execute(validated,{...context,signal});signal?.throwIfAborted();const result={tool:name,callId,success:true,status:'completed',data,elapsedMs:Number.isFinite(data?.elapsedMs)?Math.max(0,data.elapsedMs):Date.now()-started,startedAt:new Date(started).toISOString(),completedAt:new Date().toISOString()};emit({status:'completed',elapsedMs:result.elapsedMs,completedAt:result.completedAt,resultCount:name==='search_web'&&Array.isArray(data?.sources)?data.sources.length:undefined});return result;}
    catch(error){const elapsedMs=Date.now()-started,completedAt=new Date().toISOString();const ownTimeout=!!callTimeout?.aborted&&!context.signal?.aborted;if(!ownTimeout&&(context.signal?.aborted||error?.name==='AbortError')){emit({status:'cancelled',elapsedMs,completedAt});context.signal?.throwIfAborted();throw error;}const result={tool:name,callId,success:false,status:'failed',error:ownTimeout?'读取超时，已跳过该网页':safeText(error?.message||'工具执行失败',500),elapsedMs,startedAt:new Date(started).toISOString(),completedAt};emit({status:'failed',error:result.error,elapsedMs,completedAt});return result;}
  }
}

const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const stringArg=(args,key,max)=>{const value=object(args)[key];if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${key} 参数无效`);return value.trim();};

export function createAgentToolRegistry({provider,weatherTool,webpageTool}={}){
  const registry=new ToolRegistry();
  registry.register({name:'search_web',description:'查询公开网页资料并返回真实搜索来源与可用摘要',readOnly:true,parameters:{type:'object',properties:{query:{type:'string'},maxResults:{type:'integer',minimum:1,maximum:12}},required:['query'],additionalProperties:false},validate(args){return {query:stringArg(args,'query',4000),maxResults:Math.max(1,Math.min(12,Number(object(args).maxResults)||8))};},async execute(args,{signal}){if(typeof provider?.search!=='function')throw new Error('当前文字提供器不支持联网搜索');return provider.search(args.query,{signal,maxUses:1,maxResults:args.maxResults});}});
  registry.register({name:'read_webpage',description:'直接读取公开网页；适用于可读取的静态网页',readOnly:true,enabled:webpageTool?.enabled===true,parameters:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false},validate(args){return {url:stringArg(args,'url',2000)};},async execute(args,{signal}){if(!webpageTool?.enabled)throw new Error('安全网页读取工具未启用');return webpageTool.read(args.url,{signal});}});
  registry.register({name:'scrape_webpage',description:'使用 Firecrawl 抓取公开网页 Markdown 正文；适用于动态页面，或本地网页读取失败后的下一次独立尝试。每次调用会使用 Firecrawl 服务额度。',readOnly:true,enabled:typeof provider?.scrape==='function',parameters:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false},validate(args){return {url:stringArg(args,'url',2000)};},async execute(args,{signal}){if(typeof provider?.scrape!=='function')throw new Error('Firecrawl 正文抓取未配置');return provider.scrape(args.url,{signal});}});
  registry.register({name:'get_weather',description:'获取地点在当前或指定日期的真实结构化天气观测与预报',readOnly:true,enabled:weatherTool?.enabled===true,parameters:{type:'object',properties:{intent:{type:'object'}},required:['intent'],additionalProperties:false},validate(args){const intent=object(args).intent;if(!intent||intent.intent!=='weather')throw new Error('天气参数无效');return {intent};},async execute(args,{signal}){if(!weatherTool?.enabled)throw new Error('结构化天气工具未启用');return weatherTool.query(args.intent,{signal});}});
  return registry;
}
