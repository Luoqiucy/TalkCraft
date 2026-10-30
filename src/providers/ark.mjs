export class ProviderError extends Error {
  constructor(message, status = 502) {super(message); this.status = status;}
}
export function createJsonTextProvider({id, endpoint, local = false, apiKey, model, timeoutMs = 30000, fetchImpl = fetch} = {}) {
  if (!local && (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey))) throw new Error('请配置有效的模型 API Key');
  if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('请配置模型名称或接入点');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('模型超时必须在 1—120000 毫秒之间');
  return {
    id, model, endpoint, transport:'direct', simulated: false, ...(local ? {local:true} : {}),
    async streamWithTools(messages,{tools=[],toolChoice='auto',signal,onDelta,maxTokens=2048}={}){
      if(local)throw new ProviderError('当前本地模型尚未验证流式工具调用');
      signal?.throwIfAborted();
      const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
      const started=Date.now();
      try{
        const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:combined,headers:{Authorization:`Bearer ${apiKey.trim()}`,'Content-Type':'application/json'},body:JSON.stringify({model:model.trim(),messages,stream:true,max_tokens:maxTokens,tools,tool_choice:tools.length?toolChoice:'none',...(id==='deepseek'?{thinking:{type:'disabled'}}:{})})});
        if(!response.ok){await response.body?.cancel();throw new ProviderError(response.status===401||response.status===403?'模型鉴权失败，请检查凭据和模型权限':response.status===429?'模型调用受限，请稍后重试':'模型服务暂时不可用，请稍后重试',response.status===429?429:502);}
        if(!response.body)throw new ProviderError('模型没有返回流式内容');
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,content='',responseModel='',usage={},firstTokenMs;const calls=new Map();
        const consume=line=>{if(!line.startsWith('data:'))return;const payload=line.slice(5).trim();if(!payload||payload==='[DONE]')return;let data;try{data=JSON.parse(payload);}catch{throw new ProviderError('模型流式数据格式错误');}if(typeof data.model==='string')responseModel=data.model.slice(0,200);if(data.usage)usage={inputTokens:data.usage.prompt_tokens,outputTokens:data.usage.completion_tokens,totalTokens:data.usage.total_tokens};const delta=data.choices?.[0]?.delta;if(!delta)return;if(typeof delta.content==='string'&&delta.content){content+=delta.content;if(firstTokenMs===undefined)firstTokenMs=Date.now()-started;onDelta?.(delta.content);}for(const part of delta.tool_calls||[]){const index=Number.isInteger(part.index)?part.index:calls.size;if(!calls.has(index))calls.set(index,{id:'',type:'function',function:{name:'',arguments:''}});const call=calls.get(index);if(part.id)call.id=part.id;if(part.function?.name)call.function.name+=part.function.name;if(part.function?.arguments)call.function.arguments+=part.function.arguments;}};
        try{while(true){combined.throwIfAborted();const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2*1024*1024){await reader.cancel();throw new ProviderError('模型流式响应过大');}buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trimEnd();buffer=buffer.slice(end+1);consume(line);}}buffer+=decoder.decode();if(buffer.trim())consume(buffer.trim());}finally{reader.releaseLock();}
        combined.throwIfAborted();return {content,toolCalls:[...calls.values()].filter(call=>call.id&&call.function.name),usage,responseModel,firstTokenMs,elapsedMs:Date.now()-started};
      }catch(error){if(signal?.aborted)signal.throwIfAborted();if(timeout.aborted)throw new ProviderError('模型处理超时，请重试',504);if(error instanceof ProviderError)throw error;throw new ProviderError('无法连接模型服务，请检查网络');}
    },
    async complete(messages, {signal, withMetadata = false, maxTokens, reasoningEffort} = {}) {
      signal?.throwIfAborted();
      if(maxTokens!==undefined&&(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>8192))throw new Error('模型输出上限无效');
      if(reasoningEffort!==undefined&&!['none','low'].includes(reasoningEffort))throw new Error('模型思考强度无效');
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
      const started=Date.now();
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST', redirect: 'error', signal: combined,
          headers: {...(!local ? {'Authorization': `Bearer ${apiKey.trim()}`} : {}), 'Content-Type': 'application/json'},
          body: JSON.stringify({model: model.trim(), messages, stream: false,...(maxTokens===undefined?{}:local?{options:{num_predict:maxTokens}}:{max_tokens:maxTokens}),...(id==='deepseek'&&reasoningEffort?{thinking:{type:reasoningEffort==='none'?'disabled':'enabled'},reasoning_effort:reasoningEffort}: {})})
        });
        if (!response.ok) {
          await response.body?.cancel();
          const message = response.status === 401 || response.status === 403 ? '模型鉴权失败，请检查凭据和模型权限'
            : response.status === 429 ? '模型调用受限，请稍后重试' : '模型服务暂时不可用，请稍后重试';
          throw new ProviderError(message, response.status === 429 ? 429 : 502);
        }
        // Bound output size and keep the timeout active while reading the body.
        const reader = response.body?.getReader();
        if (!reader) throw new ProviderError('模型返回格式错误');
        const chunks = []; let size = 0;
        try {
          while (true) {
            combined.throwIfAborted();
            const {done, value} = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 1048576) {await reader.cancel(); throw new ProviderError('模型返回内容过大');}
            chunks.push(value);
          }
        } finally {reader.releaseLock();}
        let data;
        try {data = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new ProviderError('模型返回格式错误');}
        const text = local ? data?.message?.content : data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) throw new ProviderError('模型未返回有效文本');
        combined.throwIfAborted();
        if (!withMetadata) return text;
        const usage = {};
        for (const [target, source] of [['inputTokens','prompt_tokens'],['outputTokens','completion_tokens'],['totalTokens','total_tokens']]) {
          if (Number.isFinite(data?.usage?.[source])) usage[target] = data.usage[source];
        }
        const responseModel=typeof data?.model==='string'&&data.model.trim()?data.model.trim().slice(0,200):undefined;
        return {text, usage,...(responseModel?{responseModel}:{}),elapsedMs:Date.now()-started};
      } catch (error) {
        if (signal?.aborted) signal.throwIfAborted();
        if (timeout.signal.aborted) throw new ProviderError('模型处理超时，请重试', 504);
        if (error instanceof ProviderError) throw error;
        // Do not expose upstream payloads, endpoint exceptions or credentials.
        throw new ProviderError('无法连接模型服务，请检查网络');
      } finally {clearTimeout(timer);}
    }
  };
}

export function createArkProvider(options = {}) {
  return createJsonTextProvider({...options,id:"ark",local:false,endpoint:"https://ark.cn-beijing.volces.com/api/v3/chat/completions"});
}
