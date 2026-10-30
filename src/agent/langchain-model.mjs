import {RunnableLambda} from '@langchain/core/runnables';

export function createLangChainModelAdapter(provider,{signal}={}){
  if(!provider||typeof provider.complete!=='function')throw new Error('文字模型提供器不可用');
  const runnable=RunnableLambda.from(async({messages,withMetadata,maxTokens,reasoningEffort},config)=>provider.complete(messages,{signal:config?.signal||signal,withMetadata,maxTokens,reasoningEffort}));
  return {...provider,adapter:'langchain-runnable',async complete(messages,{signal:callSignal,withMetadata=false,maxTokens,reasoningEffort}={}){return runnable.invoke({messages,withMetadata,maxTokens,reasoningEffort},{signal:callSignal||signal});}};
}
