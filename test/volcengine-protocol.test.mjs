import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {encodeAsrInit,encodeAsrAudio,parseAsrResponse} from '../src/providers/volcengine-protocol.mjs';
function response({flags=0,type=9,data={result:{text:'数字15，不要删除。'}},compressed=true,sequence=-3,code=45000000}={}){
 const payload=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data)),bytes=compressed?gzipSync(payload):payload;
 const seq=flags&1?4:0,extra=type===15?4:0;const result=Buffer.alloc(8+seq+extra+bytes.length);result.set([0x11,type<<4|flags,0x10|(compressed?1:0),0]);let offset=4;if(seq){result.writeInt32BE(sequence,offset);offset+=4;}if(extra){result.writeUInt32BE(code,offset);offset+=4;}result.writeUInt32BE(bytes.length,offset);bytes.copy(result,offset+4);return result;
}
test('官方格式初始化帧：固定16kHz单声道PCM、序号1和gzip JSON',()=>{
 const frame=encodeAsrInit();assert.deepEqual([...frame.subarray(0,4)],[0x11,0x11,0x11,0]);assert.equal(frame.readInt32BE(4),1);assert.equal(frame.readUInt32BE(8),frame.length-12);const payload=JSON.parse(gunzipSync(frame.subarray(12)));assert.equal(payload.audio.sample_rate,16000);assert.equal(payload.audio.channel,1);assert.equal(payload.request.model_name,'bigmodel');
});
test('火山初始化帧把热词放进request.corpus.context的JSON字符串',()=>{
 const frame=encodeAsrInit(['张家港','DeepSeek']);
 const payload=JSON.parse(gunzipSync(frame.subarray(12)));
 assert.deepEqual(JSON.parse(payload.request.corpus.context),{hotwords:[{word:'张家港'},{word:'DeepSeek'}]});
 assert.equal(JSON.parse(gunzipSync(encodeAsrInit().subarray(12))).request.corpus,undefined);
 assert.throws(()=>encodeAsrInit(['词'.repeat(11)]),/热词无效/);
});
test('音频帧gzip负载与原始PCM一致，无WAV头或静默终止标记',()=>{
 const pcm=Buffer.from([1,0,255,127]);const frame=encodeAsrAudio(pcm);assert.equal(frame[1],0x20);assert.deepEqual(gunzipSync(frame.subarray(8)),pcm);assert.throws(()=>encodeAsrAudio(Buffer.alloc(3)),/无效/);
});
test('官方最后音频包flags2、原始字节序列化0、gzip且无序号',()=>{
 const pcm=Buffer.from([1,0,255,127]),frame=encodeAsrAudio(pcm,{final:true});
 assert.deepEqual([...frame.subarray(0,4)],[0x11,0x22,0x01,0]);
 assert.equal(frame.readUInt32BE(4),frame.length-8);assert.deepEqual(gunzipSync(frame.subarray(8)),pcm);
 assert.equal(encodeAsrAudio(pcm)[2],0x01);assert.throws(()=>encodeAsrAudio(pcm,{final:'true'}),/无效/);
});
test('响应解析保留中文数字否定，识别负序号与最终标记',()=>{
 const parsed=parseAsrResponse(response({flags:3}));assert.equal(parsed.sequence,-3);assert.equal(parsed.final,true);assert.equal(parsed.payload.result.text,'数字15，不要删除。');assert.equal(parseAsrResponse(response({compressed:false})).final,false);
});
test('错误帧与无负载ACK可解析，不直接抛出上游原文',()=>{
 const result=parseAsrResponse(response({type:15,data:{message:'secret upstream'}}));assert.equal(result.code,45000000);const ack=Buffer.from([0x11,0xb0,0,0,0,0,0,8]);assert.equal(parseAsrResponse(ack).ackSequence,8);
});
test('拒绝截断、错误长度/版本/类型/编码/压缩与无效JSON',()=>{
 const frame=response();for(const n of [0,3,6,frame.length-1])assert.throws(()=>parseAsrResponse(frame.subarray(0,n)),/协议响应无效/);
 for(const [index,value] of [[0,0x21],[0,0x10],[1,0x80],[1,0x94],[2,0x21],[2,0x12]]){const corrupt=Buffer.from(frame);corrupt[index]=value;assert.throws(()=>parseAsrResponse(corrupt),/协议响应无效/);}
 assert.throws(()=>parseAsrResponse(response({data:Buffer.from('broken')})),/协议响应无效/);
 const corrupt=response();corrupt.writeUInt32BE(999,4);assert.throws(()=>parseAsrResponse(corrupt),/协议响应无效/);
});
test('gzip扩张超过1MiB被阻止，错误反馈不带原始负载',()=>{
 const bomb=response({data:Buffer.alloc(1048577,65)});assert.ok(bomb.length<1048576);assert.throws(()=>parseAsrResponse(bomb),error=>error.message==='ASR协议响应无效');
});
