import {tool} from 'langchain';
import {z} from 'zod';

const schemas={
  search_web:z.object({query:z.string().min(1).max(4000),maxResults:z.number().int().min(1).max(12).default(8)}),
  read_webpage:z.object({url:z.string().url().max(2000)}),
  get_weather:z.object({intent:z.object({intent:z.literal('weather'),location:z.string().max(200).optional(),period:z.string().max(40),question:z.string().max(500).optional()}).passthrough()})
};

export function createToolBudget(maxCalls=6){
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>8)throw new Error('工具调用预算无效');
  let used=0;return {get used(){return used;},get max(){return maxCalls;},take(){if(used>=maxCalls){const error=new Error('联网工具调用已达到本次上限');error.status=429;throw error;}used++;return used;}};
}

export function createLangChainTools({registry,taskId,onStatus,nextSequence,signal,budget=createToolBudget()}={}){
  if(!registry||typeof registry.execute!=='function')throw new Error('工具注册表不可用');
  const tools={};
  for(const name of ['search_web','read_webpage','get_weather']){
    const definition=registry.get(name);if(!definition)continue;
    tools[name]=tool(async input=>{signal?.throwIfAborted();budget.take();const outcome=await registry.execute(name,input,{signal,taskId,onStatus,nextSequence});if(!outcome.success){const error=new Error(outcome.error||`${name} 执行失败`);error.toolOutcome=outcome;throw error;}return outcome;},{name,description:definition.description,schema:schemas[name]});
  }
  return {tools,list:Object.values(tools),budget};
}
