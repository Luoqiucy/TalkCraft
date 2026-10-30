import test from 'node:test';
import assert from 'node:assert/strict';
import {createJsonTextProvider} from '../src/providers/ark.mjs';

test('流式适配器按索引拼接跨块工具参数并累计正文',async()=>{
  const writes=[],encoder=new TextEncoder();
  const events=[
    {model:'deepseek-flash',choices:[{delta:{tool_calls:[{index:0,id:'call-one',type:'function',function:{name:'search_web',arguments:'{"query":"理想'}}]}}]},
    {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'i9"}'}}]}}]},
    {choices:[{delta:{content:'已找到'}}]},
    {choices:[{delta:{content:'资料'}}]},
    {usage:{prompt_tokens:11,completion_tokens:6,total_tokens:17},choices:[]},
  ];
  const payload=events.map(item=>`data: ${JSON.stringify(item)}\n\n`).join('')+'data: [DONE]\n';
  const parts=[payload.slice(0,23),payload.slice(23,121),payload.slice(121)];
  const fetchImpl=async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.stream,true);assert.equal(body.tool_choice,'auto');assert.deepEqual(body.thinking,{type:'disabled'});return new Response(new ReadableStream({start(controller){for(const part of parts)controller.enqueue(encoder.encode(part));controller.close();}}),{status:200});};
  const provider=createJsonTextProvider({id:'deepseek',endpoint:'https://api.deepseek.com/chat/completions',apiKey:'secret-test',model:'deepseek-flash',fetchImpl});
  const result=await provider.streamWithTools([{role:'user',content:'测试'}],{tools:[{type:'function',function:{name:'search_web',parameters:{type:'object'}}}],onDelta:part=>writes.push(part)});
  assert.equal(result.content,'已找到资料');assert.deepEqual(writes,['已找到','资料']);assert.equal(result.toolCalls[0].function.arguments,'{"query":"理想i9"}');assert.equal(result.responseModel,'deepseek-flash');assert.equal(result.usage.totalTokens,17);
});
