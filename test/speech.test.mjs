import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanSpeechText,conciseSpeechCandidate,createSpeechController,listLocalSpeechVoices,shouldAutoSpeakCompletedAnswer} from '../src-ui/src/services/speech.ts';

const voice=(localService=true)=>({voiceURI:'local-zh',name:'Local Chinese',lang:'zh-CN',localService,default:true});
test('speech cleanup removes markup and citations while preserving model, units, caveats and table values',()=>{const value=cleanSpeechText('**Xiaomi 15 Pro Max**：价格约 5,999 元。[1] 续航 5,000 mAh。\n\n| 型号 | 价格 |\n| --- | --- |\n| Pro Max | 5,999元 |\n\n资料暂未确认。https://example.com/page');assert.match(value,/Xiaomi 15 Pro Max/);assert.match(value,/5,999 元/);assert.match(value,/5,000 mAh/);assert.match(value,/资料暂未确认/);assert.match(value,/Pro Max/);assert.doesNotMatch(value,/\[1\]|https:|---/);});
test('automatic speech accepts complete short answers and skips long answers rather than truncating',()=>{assert.equal(conciseSpeechCandidate('南京今天有雨。最高温度23℃。').eligible,true);const long=conciseSpeechCandidate('第一句。第二句。第三句。第四句。第五句包含重要限制。');assert.equal(long.eligible,false);assert.match(long.reason,/避免截去条件/);assert.equal(long.text,'');});
test('automatic speech only starts for enabled web-search answers',()=>{assert.equal(shouldAutoSpeakCompletedAnswer({mode:'chat',webSearchEnabled:true,autoSpeakEnabled:true,searchPerformed:true}),true);for(const input of [{mode:'dictation',webSearchEnabled:true,autoSpeakEnabled:true,searchPerformed:true},{mode:'chat',webSearchEnabled:false,autoSpeakEnabled:true,searchPerformed:true},{mode:'chat',webSearchEnabled:true,autoSpeakEnabled:false,searchPerformed:true},{mode:'chat',webSearchEnabled:true,autoSpeakEnabled:true,searchPerformed:false}])assert.equal(shouldAutoSpeakCompletedAnswer(input),false);});
test('only local voices are selectable and speech can stop/replay through the provider boundary',async()=>{const voices=[voice(),{...voice(false),voiceURI:'online'}];assert.deepEqual(listLocalSpeechVoices({getVoices:()=>voices}).map(item=>item.voiceURI),['local-zh']);let spoken=[],cancelled=0;const synth={getVoices:()=>voices,cancel(){cancelled++;},speak(item){spoken.push(item);}};const events=[];const broadcast={postMessage:value=>events.push(value)};const controller=createSpeechController({synthesis:synth,utteranceFactory:(text)=>({text}),broadcast});const promise=controller.play('正在朗读答案。',{voiceURI:'local-zh',rate:1.2,volume:.7});assert.strictEqual(spoken[0].voice, voices[0]);assert.equal(spoken[0].rate,1.2);assert.equal(spoken[0].volume,.7);spoken[0].onend();await promise;controller.stop();assert.ok(cancelled>=2);assert.deepEqual(events.map(event=>event.type),['start','stop']);});
test('speech does not claim success when no local voice exists',async()=>{const controller=createSpeechController({synthesis:{getVoices:()=>[],cancel(){},speak(){throw Error('must not run');}},utteranceFactory:text=>({text}),broadcast:{postMessage(){}}});await assert.rejects(controller.play('答案。'),/没有可用的本机语音/);});

test('spoken answer uses a dedicated summary instruction and bounded model output', async () => {
  const {processText} = await import('../src/pipeline.mjs');
  const question = '需要带伞吗？';
  const answer = '下午降雨概率为 70%，但预报仍可能变化。';
  const result = await processText({mode:'prompt',purpose:'spoken-answer',question,text:answer}, {
    async complete(messages, options) {
      assert.match(messages[0].content, /不确定性/);
      assert.deepEqual(JSON.parse(messages[1].content), {question,answer});
      assert.equal(options.maxTokens, 320);
      return {text:'建议带伞。下午降雨概率为 70%，预报仍可能变化。'};
    }
  });
  assert.equal(result.spokenAnswer, true);
  assert.match(result.text, /70%.*仍可能变化/);
});

test('a speech engine that never starts reports a playback error and cancels the pending utterance', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let cancelled=0;
  const controller=createSpeechController({
    synthesis:{getVoices:()=>[voice()],cancel(){cancelled++;},speak(){}},
    utteranceFactory:text=>({text}),broadcast:{postMessage(){}}
  });
  const pending=controller.play('测试朗读。');
  const rejection=assert.rejects(pending,/未开始播放/);
  t.mock.timers.tick(5000);
  await rejection;
  assert.equal(cancelled,2);
});
