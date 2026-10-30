import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modes, buildMessages, processText, streamTextPreview, mockProvider} from '../src/pipeline.mjs';
import {createServer} from '../server.mjs';
import {listenForFetch} from '../test-support/http-listen.mjs';
test('四种模式保留数字、否定和口述文本，并区分问答', () => {
  for (const mode of modes) {
    const messages = buildMessages({mode, text:'不要在9月15日之前发布，预算1200元。', targetLanguage:'en'});
    assert.equal(messages[1].content, '不要在9月15日之前发布，预算1200元。');
    if (mode !== 'chat') assert.match(messages[0].content, /不.*回答/);
  }
});
test('拒绝空文本、未知模式、超长文本和无效目标语言', async () => {
  for (const input of [{mode:'chat',text:' '},{mode:'bad',text:'a'},{mode:'chat',text:'a'.repeat(12001)},{mode:'translate',text:'a',targetLanguage:'bad'}]) await assert.rejects(processText(input,mockProvider));
});
test('模拟响应必须明确标记，不能伪装真实 AI', async () => {
  const result = await processText({mode:'prompt',text:' 帮我写计划 '},mockProvider);
  assert.equal(result.simulated,true); assert.match(result.text,/模拟结果/); assert.match(result.text,/帮我写计划/);
});
test('取消前不调用服务，取消后不交付结果', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(processText({mode:'chat',text:'你好'}, {complete(){calls++;}}, controller.signal)); assert.equal(calls,0);
  const after = new AbortController();
  await assert.rejects(processText({mode:'chat',text:'你好'}, {async complete(){after.abort();return '结果';}},after.signal));
});
test('空服务响应被识别为错误', async () => {await assert.rejects(processText({mode:'chat',text:'你好'},{async complete(){return ' ';}}),/有效文本/);});
test('短语音类任务限制无意义长输出，DeepSeek可关闭不必要思考，长手动文本不静默截断',async()=>{
 const seen=[];const provider={async complete(_messages,options){seen.push([options.maxTokens,options.reasoningEffort]);return '结果';}};
 await processText({mode:'chat',text:'一句话回答'},provider);
 await processText({mode:'prompt',text:'生成提示词'},provider);
 await processText({mode:'dictation',text:'长'.repeat(2001)},provider);
 assert.deepEqual(seen,[[1600,'low'],[2400,'none']]);
});
test('听写只原样返回转写文字且不调用文字模型',async()=>{
 let calls=0;const text=' 嗯，今天3点，不要改成4点。\n';const result=await processText({mode:'dictation',text},{async complete(){calls++;return '不应调用';}});
 assert.equal(calls,0);assert.equal(result.text,text);assert.equal(result.localPassThrough,true);assert.equal(result.simulated,false);
});
test('仅提示词预设和翻译可流式预览；取消后丢弃已显示的半段且无最终结果',async()=>{
 const fragments=[];const controller=new AbortController();
 const provider={id:'deepseek',async streamWithTools(messages,options){assert.equal(options.toolChoice,'none');assert.deepEqual(options.tools,[]);assert.match(messages[0].content,/提示词编辑器/);options.onDelta('半段');controller.abort();return {content:'半段错误结果'};}};
 await assert.rejects(streamTextPreview({mode:'prompt',text:'请整理这段话'},provider,controller.signal,chunk=>fragments.push(chunk)),error=>error.name==='AbortError');
 assert.deepEqual(fragments,['半段']);
 for(const mode of ['dictation','chat'])await assert.rejects(streamTextPreview({mode,text:'不要改写'},provider),/不能流式/);
 const completed=await streamTextPreview({mode:'translate',text:'不要删除',targetLanguage:'en'},{id:'deepseek',async streamWithTools(_messages,options){options.onDelta('Do not ');options.onDelta('delete');return {content:'Do not delete'};}},undefined,chunk=>fragments.push(chunk));
 assert.equal(completed.text,'Do not delete');assert.equal(completed.simulated,false);
});
test('文字流HTTP只交付模型真实片段和最终结果，拒绝听写和未授权请求',async t=>{
 let calls=0;const provider={id:'deepseek',model:'fixture-model',simulated:false,async streamWithTools(_messages,options){calls++;options.onDelta('第一段');options.onDelta('第二段');return {content:'第一段第二段',toolCalls:[],elapsedMs:12};}};
 const server=createServer({provider});const url=await listenForFetch(server);t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const post=(input,consent=true)=>fetch(`${url}/api/process-stream`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,cloudConsent:consent})});
 assert.equal((await post({mode:'dictation',text:'原始文字'})).status,400);
 assert.equal((await post({mode:'prompt',text:'文字'},false)).status,400);
 assert.equal(calls,0);
 const response=await post({mode:'prompt',text:'不要改数字'});assert.equal(response.status,200);
 const lines=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(lines.map(line=>line.type),['answer_delta','answer_delta','result']);
 assert.equal(lines[2].data.text,'第一段第二段');assert.equal(calls,1);
});
test('客户端读到半段后取消，会中止后端模型任务且不产生最终提交',async t=>{
 let backendAborted=false;let started;
 const finished=new Promise(resolve=>started=resolve);
 const provider={id:'deepseek',simulated:false,async streamWithTools(_messages,options){
   options.onDelta('尚未完成');
   await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));
   backendAborted=true;started();return {content:'不可提交的迟到结果'};
 }};
 const server=createServer({provider});const url=await listenForFetch(server);t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const controller=new AbortController();const response=await fetch(`${url}/api/process-stream`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'prompt',text:'测试取消',cloudConsent:true})});
 const reader=response.body.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/尚未完成/);
 controller.abort();await Promise.race([finished,new Promise((_,reject)=>setTimeout(()=>reject(new Error('后端没有收到取消')),1000))]);
 assert.equal(backendAborted,true);
});
test('提示词预设使用文风，翻译支持常见目标语言',()=>{
 const prompt=buildMessages({mode:'prompt',text:'写一封延期邮件',tone:'email'});assert.match(prompt[0].content,/邮件格式/);
 const japanese=buildMessages({mode:'translate',text:'你好',targetLanguage:'ja'});assert.match(japanese[0].content,/日语/);
 const arabic=buildMessages({mode:'translate',text:'你好',targetLanguage:'ar'});assert.match(arabic[0].content,/阿拉伯语/);
 for(const [target,label] of [['en-GB','英式英语'],['en-US','美式英语'],['pt-BR','巴西葡萄牙语'],['pt-PT','葡萄牙葡萄牙语'],['zh-CN','中国大陆简体中文']])assert.match(buildMessages({mode:'translate',text:'测试',targetLanguage:target})[0].content,new RegExp(label));
});
test('联网回答只保留实际来源范围内的引用编号',async()=>{
  const provider={async complete(){return {text:'南京当前多云[1]，错误来源[9]。'};}};
  const result=await processText({mode:'chat',text:'南京天气怎么样',webSearchResult:{performed:true,status:'weather-data',tool:'weather',sources:[{title:'天气数据',url:'https://example.com/weather'}],synthesis:'当前多云，26℃'}},provider);
  assert.equal(result.text,'南京当前多云[1]，错误来源。');assert.match(result.citationWarning,/已移除/);
});
test('产品搜索提示保护原始型号、版本日期与缺失参数，冲突回答停止展示',async()=>{
 const search={performed:true,status:'searched',tool:'web-search',currentDate:'2026-09-19',timezone:'Asia/Shanghai',quality:{intent:'product-research',sufficient:true,subject:'理想i9',subjectConfirmed:true},sources:[{title:'理想官方i9公告',url:'https://ir.lixiang.com/i9',snippet:'2026年9月16日发布Li i9，售价369800元。'}],synthesis:'官方公告确认Li i9上市。'};
 const prompt=buildMessages({mode:'chat',text:'理想i9详细参数',webSearchResult:search})[1].content;assert.match(prompt,/原始对象是“理想i9”/);assert.match(prompt,/不得静默替换/);assert.match(prompt,/尚未查到可靠数据/);assert.match(prompt,/2026-09-19/);
 const guarded=await processText({mode:'chat',text:'理想i9详细参数',webSearchResult:search},{async complete(){return {text:'截至旧知识没有官方i9车型，你可能想问理想L9。',responseModel:'upstream-model'};}});assert.equal(guarded.answerGuard,'product-evidence-conflict');assert.match(guarded.text,/已从可靠来源确认“理想i9”/);assert.doesNotMatch(guarded.text,/理想L9/);assert.equal(guarded.responseModel,'upstream-model');
});
test('产品搜索未执行时不得把未查到写成不存在或改答相似产品',async()=>{
 const search={performed:false,status:'not-invoked',tool:'web-search',currentDate:'2026-09-19',timezone:'Asia/Shanghai',quality:{intent:'product-research',sufficient:false,subject:'某品牌Z99',subjectConfirmed:false},sources:[]};
 const prompt=buildMessages({mode:'chat',text:'某品牌Z99上市了吗',webSearchResult:search})[1].content;assert.match(prompt,/这不证明用户查询对象不存在/);assert.match(prompt,/不得改答相似产品/);
 const guarded=await processText({mode:'chat',text:'某品牌Z99上市了吗',webSearchResult:search},{async complete(){return 'Z99不存在，你应该问Z9。';}});assert.equal(guarded.answerGuard,'product-search-unverified');assert.match(guarded.text,/不能判断/);assert.doesNotMatch(guarded.text,/应该问/);
});
test('说明尚未取得官方配置表不被误判成产品不存在',async()=>{
 const search={performed:true,status:'searched',tool:'web-search',quality:{intent:'product-research',sufficient:false,subject:'理想i9',subjectConfirmed:true},sources:[{title:'媒体资料',url:'https://example.com/i9'}]};const text='已确认理想i9上市，但本次没有取得官方配置表，因此部分参数尚未查到可靠数据。';const result=await processText({mode:'chat',text:'理想i9详细参数',webSearchResult:search},{async complete(){return text;}});assert.equal(result.text,text);assert.equal(result.answerGuard,undefined);
});
test('HTTP流程、错误请求及跨来源请求', async t => {
  const server = createServer(); const url=await listenForFetch(server); t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
  assert.equal((await fetch(url)).status,200);
  assert.equal((await fetch(`${url}/recording.mjs`)).status,200);
  assert.equal((await fetch(`${url}/audio.mjs`)).status,200);
  assert.equal((await fetch(`${url}/conversation.mjs`)).status,200);
  const valid = await fetch(`${url}/api/process`,{method:'POST',body:JSON.stringify({mode:'chat',text:'你好'})}); assert.equal(valid.status,200); assert.equal((await valid.json()).simulated,true);
  assert.equal((await fetch(`${url}/api/process`,{method:'POST',body:'not json'})).status,400);
  assert.equal((await fetch(`${url}/api/process`,{method:'POST',headers:{Origin:'https://example.com'},body:'{}'})).status,403);
  assert.equal((await fetch(`${url}/api/process`,{method:'POST',body:'a'.repeat(65537)})).status,413);
  assert.equal((await fetch(`${url}/unknown`)).status,404);
});
