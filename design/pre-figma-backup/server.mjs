import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {processText} from './src/pipeline.mjs';
import {loadProvider, providerStatus} from './src/config.mjs';
import {loadAsr,transcribeAudio} from './src/asr.mjs';
import {createWorkspaceStore} from './src/workspace.mjs';
const assets = {'/': ['index.html', 'text/html; charset=utf-8'], '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'], '/recording.mjs': ['recording.mjs', 'text/javascript; charset=utf-8'], '/audio.mjs': ['audio.mjs', 'text/javascript; charset=utf-8'], '/conversation.mjs': ['conversation.mjs', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8']};
export function createServer({provider = loadProvider(),asr = loadAsr(),workspace=createWorkspaceStore(fileURLToPath(new URL('./.local/workspace.json',import.meta.url)))} = {}) {
  assets['/shell.mjs']=['shell.mjs','text/javascript; charset=utf-8'];
  assets['/translation.mjs']=['translation.mjs','text/javascript; charset=utf-8'];
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const controller = new AbortController();
    res.on('close', () => {if (!res.writableEnded) controller.abort();});
    try {
      if (!/^((127\.0\.0\.1)|(localhost))(:\d+)?$/.test(req.headers.host || '')) {res.writeHead(403); res.end(); return;}
      if (req.method === 'GET' && req.url === '/api/status') {
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify(providerStatus(provider,asr))); return;
      }
      if(req.method==='GET' && req.url==='/api/workspace') {
        const state=await workspace.read();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));return;
      }
      if(req.method==='POST' && req.url==='/api/workspace') {
        if(req.headers.origin!==`http://${req.headers.host}`) {res.writeHead(403);res.end();return;}
        if(req.headers['content-type']!=='application/json') throw new Error('请发送JSON配置');
        const chunks=[];let size=0;for await(const chunk of req) {size+=chunk.length;if(size>8000000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('配置格式错误');}
        const state=await workspace.update(input);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));return;
      }
      if(req.method==='POST' && req.url==='/api/transcribe') {
        if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) {res.writeHead(403);res.end();return;}
        if(!asr.enabled) {res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'语音识别未启用，当前仅支持显式模拟模式'}));return;}
        if(req.headers['content-type']!=='application/octet-stream') throw new Error('请发送原始PCM二进制音频');
        if(!asr.simulated && req.headers['x-audio-cloud-consent']!=='true') throw new Error('请确认将音频发送到云端识别');
        const format={sampleRate:Number(req.headers['x-audio-sample-rate']),channels:Number(req.headers['x-audio-channels']),bitDepth:Number(req.headers['x-audio-bit-depth'])};
        if(format.sampleRate!==16000 || format.channels!==1 || format.bitDepth!==16) throw new Error('识别输入必须是16kHz单声道16bit PCM');
        const chunks=[];let size=0;
        for await(const chunk of req) {
          size+=chunk.length;if(size>3840000) {res.writeHead(413);res.end();return;}chunks.push(chunk);
        }
        const result=await transcribeAudio(Buffer.concat(chunks),format,asr,controller.signal);
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));return;
      }
      if (req.method === 'POST' && req.url === '/api/process') {
        const expectedOrigin = `http://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== expectedOrigin) { res.writeHead(403); res.end(); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) {res.writeHead(413); res.end(); return;}
          chunks.push(chunk);
        }
        let input;
        try {input = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new Error('请求格式错误');}
        if (!provider.simulated && input?.cloudConsent !== true) {res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'请确认将文本发送到云端处理'})); return;}
        const result = await processText(input, provider, controller.signal);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(result)); return;
      }
      const asset = assets[req.url];
      if (req.method !== 'GET' || !asset) {res.writeHead(404); res.end('Not found'); return;}
      const content = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, {'Content-Type': asset[1]}); res.end(content);
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) return;
      res.writeHead(error.status || 400, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({error: error.message}));
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer().listen(4317, '127.0.0.1', () => console.log('打开 http://127.0.0.1:4317'));
}
