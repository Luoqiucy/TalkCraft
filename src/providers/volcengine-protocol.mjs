// Protocol adapted from volcengine/ai-app-lab arkitect/utils/binary_protocol.py.
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates. Apache-2.0.
// Modified: JavaScript implementation, strict framing, bounded decompression,
// explicit 16kHz mono PCM, and sanitized validation errors. See docs/reference.
import {gzipSync,gunzipSync} from 'node:zlib';
const limit=1048576;
function packet(type,flags,payload,sequence,serialization=1) {
  const compressed=gzipSync(payload),prefix=sequence===undefined?8:12;
  const frame=Buffer.alloc(prefix+compressed.length);frame.set([0x11,(type<<4)|flags,(serialization<<4)|1,0]);
  let offset=4;if(sequence!==undefined){frame.writeInt32BE(sequence,offset);offset+=4;}
  frame.writeUInt32BE(compressed.length,offset);compressed.copy(frame,offset+4);return frame;
}
export function encodeAsrInit(hotwords=[]) {
  if(!Array.isArray(hotwords)||hotwords.length>20||hotwords.some(word=>typeof word!=='string'||![...word].length||[...word].length>10||/[\x00-\x1f\x7f]/.test(word)))throw new Error('ASR热词无效');
  const request={model_name:'bigmodel',...(hotwords.length?{corpus:{context:JSON.stringify({hotwords:hotwords.map(word=>({word}))})}}:{})};
  return packet(1,1,Buffer.from(JSON.stringify({audio:{format:'pcm',codec:'raw',sample_rate:16000,channel:1},request})),1);
}
export function encodeAsrAudio(pcm,{final=false}={}) {
  if(!(pcm instanceof Uint8Array) || !pcm.byteLength || pcm.byteLength>3840000 || pcm.byteLength%2)throw new Error('ASR音频帧无效');
  if(typeof final!=='boolean')throw new Error('ASR音频帧无效');
  // Official API: no sequence; flags 2 mark the last audio chunk. Audio is
  // raw bytes (serialization 0), gzip compressed, not a JSON payload.
  return packet(2,final?2:0,Buffer.from(pcm),undefined,0);
}
export function parseAsrResponse(value) {
  function invalid(){throw new Error('ASR协议响应无效');}
  if(!(value instanceof Uint8Array) || value.byteLength<4 || value.byteLength>limit)invalid();
  const frame=Buffer.from(value),version=frame[0]>>4,headerSize=(frame[0]&15)*4,type=frame[1]>>4,flags=frame[1]&15,serialization=frame[2]>>4,compression=frame[2]&15;
  if(version!==1 || headerSize<4 || headerSize>frame.length || flags>3 || ![9,11,15].includes(type) || ![0,1].includes(serialization) || ![0,1].includes(compression))invalid();
  let offset=headerSize,sequence,code;
  function number(signed=false){if(offset+4>frame.length)invalid();const n=signed?frame.readInt32BE(offset):frame.readUInt32BE(offset);offset+=4;return n;}
  if(flags&1)sequence=number(true);
  const result={type,final:!!(flags&2),sequence};
  if(type===11){result.ackSequence=number(true);if(offset===frame.length)return result;}
  if(type===15)code=number();
  const size=number();if(size!==frame.length-offset)invalid();
  let payload=frame.subarray(offset);
  try{if(compression===1)payload=gunzipSync(payload,{maxOutputLength:limit});}catch{invalid();}
  if(payload.length>limit)invalid();
  if(serialization===1){try{result.payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));}catch{invalid();}}
  else result.payload=Buffer.from(payload);
  if(type===15)result.code=code;
  return result;
}
