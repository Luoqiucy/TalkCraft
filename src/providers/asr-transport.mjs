import {AsrDiagnosticError,handshakeFailure} from './asr-diagnostic.mjs';
import WebSocket from 'ws';
import {EventEmitter} from 'node:events';
const endpoint='wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
export function createAsrTransport({headers={},testUrl,handshakeTimeoutMs=10000}={}) {
  let url=endpoint;
  if(testUrl!==undefined){const parsed=new URL(testUrl);if(parsed.protocol!=='ws:' || !['127.0.0.1','localhost'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash)throw new Error('测试地址仅允许本机WebSocket');url=parsed.href;}
  if(!Number.isInteger(handshakeTimeoutMs) || handshakeTimeoutMs<1 || handshakeTimeoutMs>120000)throw new Error('握手超时无效');
  // Validate and send the same detached values; callers may edit their object
  // while the connection is waiting to start.
  if(!headers || typeof headers!=='object' || Array.isArray(headers))throw new Error('ASR握手参数无效');
  const handshakeHeaders=Object.freeze({...headers});
  const allowed=['X-Api-Resource-Id','X-Api-Access-Key','X-Api-App-Key','X-Api-Request-Id'];
  for(const [name,value]of Object.entries(handshakeHeaders)){if(!allowed.includes(name) || typeof value!=='string' || !value.trim() || value.length>2000 || /[\r\n]/.test(value))throw new Error('ASR握手参数无效');}
  if(testUrl===undefined && handshakeHeaders['X-Api-Resource-Id']?.startsWith('volc.seedasr.')) url='wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
  const bus=new EventEmitter();let socket,connecting,closing,disposed=false,rejectConnect;
  let diagnostic;
  function error(){const e=diagnostic || new AsrDiagnosticError('语音服务连接失败：请检查网络、代理或TLS连接');rejectConnect?.(e);if(!disposed && bus.listenerCount('error'))bus.emit('error',e);}
  function connect(){
    if(disposed)return Promise.reject(new Error('ASR传输已关闭'));if(connecting)return connecting;
    connecting=new Promise((resolve,reject)=>{
      rejectConnect=reject;
      socket=new WebSocket(url,{headers:{...handshakeHeaders},followRedirects:false,perMessageDeflate:false,maxPayload:1048576,maxFragments:64,maxBufferedChunks:1024,handshakeTimeout:handshakeTimeoutMs});
      socket.on('unexpected-response',(_request,response)=>{diagnostic=handshakeFailure(response.statusCode);response.resume();error();socket.terminate();});
      socket.on('error',error);
      socket.on('open',()=>{rejectConnect=undefined;if(disposed)socket.terminate();else resolve();});
      socket.on('message',(data,binary)=>{if(disposed)return;if(!binary){error();socket.terminate();return;}bus.emit('message',data);});
      socket.on('close',()=>{rejectConnect?.(new Error('ASR连接提前关闭'));rejectConnect=undefined;if(!disposed)bus.emit('close');});
    });return connecting;
  }
  function send(frame){if(disposed || socket?.readyState!==WebSocket.OPEN)return Promise.reject(new Error('ASR连接不可发送'));if(!(frame instanceof Uint8Array) || !frame.length || frame.length>1048576)return Promise.reject(new Error('ASR发送帧无效'));return new Promise((resolve,reject)=>socket.send(frame,{binary:true,compress:false},e=>e?reject(new Error('ASR发送失败')):resolve()));}
  function close(){if(closing)return closing;disposed=true;rejectConnect?.(new Error('ASR传输已关闭'));rejectConnect=undefined;closing=new Promise(resolve=>{if(!socket || socket.readyState===WebSocket.CLOSED){resolve();return;}socket.once('close',resolve);socket.terminate();});return closing;}
  return {on:bus.on.bind(bus),off:bus.off.bind(bus),connect,send,close};
}
