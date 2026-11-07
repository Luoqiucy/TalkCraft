import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {access, mkdir, mkdtemp, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import bunzip from 'unbzip2-stream';
import {extract} from 'tar';
import {runtimeStatePath} from './runtime-paths.mjs';

const name = 'kokoro-int8-multi-lang-v1_1';
const bytes = 147052523;
const sha256 = '259c9c8bc906d6078e4e0570421885dabb68b539c2f970fcbb890a58eeaf3e9c';
const official = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${name}.tar.bz2`;
const required = ['model.int8.onnx','voices.bin','tokens.txt','lexicon-zh.txt',
  'lexicon-us-en.txt','espeak-ng-data','dict','date-zh.fst','number-zh.fst','phone-zh.fst'];

function wav({samples, sampleRate}) {
  if (!samples?.length || samples.length > sampleRate * 300) throw new Error('本机语音合成结果为空或过长');
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24); out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return out;
}

export function createKokoroVoice({root = runtimeStatePath('voice-packs'), fetchImpl = fetch} = {}) {
  const modelDir = join(root, name);
  const mirror = process.env.TALKCRAFT_KOKORO_MIRROR_URL || 'https://gh-proxy.com/' + official;
  let installing = false, received = 0, synthesizing = false, engine;
  const available = () => Promise.all(required.map(file => access(join(modelDir, file)))).then(() => true, () => false);
  async function install(source, signal) {
    if (source !== 'official' && source !== 'mirror') throw new Error('请选择有效的语音包下载源');
    if (installing) throw new Error('语音包正在安装');
    installing = true;
    received = 0;
    let temp;
    try {
      if (await available()) return;
      const url = new URL(source === 'mirror' ? mirror : official);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('语音包镜像须使用无凭据的 HTTPS 地址');
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
      await mkdir(root, {recursive: true});
      temp = await mkdtemp(join(root, 'kokoro-download-'));
      const archive = join(temp, 'model.tar.bz2');
      const response = await fetchImpl(url, {signal: deadline});
      if (!response.ok || !response.body) throw new Error(`语音包下载失败（HTTP ${response.status}）`);
      const hash = createHash('sha256');
      await pipeline(response.body, new Transform({
        transform(chunk, _encoding, done) {
          received += chunk.length;
          if (received > bytes) { done(new Error('语音包大小与官方发布不符')); return; }
          hash.update(chunk);
          done(null, chunk);
        }
      }), createWriteStream(archive, {flags: 'wx'}), {signal: deadline});
      if (received !== bytes || hash.digest('hex') !== sha256) throw new Error('语音包校验失败，请更换下载来源');
      await pipeline(createReadStream(archive), bunzip(), extract({cwd: temp, strict: true}), {signal: deadline});
      const extracted = join(temp, name);
      await Promise.all(required.map(file => access(join(extracted, file))));
      await rename(extracted, modelDir);
    } finally {
      try { if (temp) await rm(temp, {recursive: true, force: true}); }
      finally { installing = false; }
    }
  }

  async function synthesize({text, sid, speed}, signal) {
    if (typeof text !== 'string' || !text.trim() || text.length > 5000 ||
      !Number.isInteger(sid) || sid < 0 || sid > 102 || !Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      throw new Error('本机朗读参数无效，单次最多 5000 字符');
    }
    if (synthesizing) throw new Error('本机语音正在合成，请稍后重试');
    synthesizing = true;
    try {
      if (!await available()) throw new Error('请先安装 Kokoro 语音包');
      if (!engine) {
        const {default: sherpa} = await import('sherpa-onnx-node');
        const file = name => join(modelDir, name);
        engine = await sherpa.OfflineTts.createAsync({
          model: {numThreads: 2, provider: 'cpu', kokoro: {
            model: file('model.int8.onnx'), voices: file('voices.bin'), tokens: file('tokens.txt'),
            dataDir: file('espeak-ng-data'), dictDir: file('dict'),
            lexicon: [file('lexicon-us-en.txt'), file('lexicon-zh.txt')].join(',')
          }},
          ruleFsts: ['date-zh.fst','number-zh.fst','phone-zh.fst'].map(file).join(','),
          maxNumSentences: 1
        });
      }
      signal.throwIfAborted();
      const audio = await engine.generateAsync({text, sid, speed, onProgress: () => !signal.aborted});
      signal.throwIfAborted();
      return wav(audio);
    } finally {
      synthesizing = false;
    }
  }

  return async (req, res, signal) => {
    const path = req.url;
    if (!['/api/local-voice','/api/local-voice/install','/api/local-voice/speak'].includes(path)) return false;
    if (req.method === 'GET' && path === '/api/local-voice') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({installed: await available(), installing, received, bytes, mirror: true}));
      return true;
    }
    if (req.method !== 'POST' || path === '/api/local-voice' ||
      req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') {
      res.writeHead(403); res.end(); return true;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413); res.end(); return true; }
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (path.endsWith('/install')) {
      await install(input.source, signal);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({installed:true}));
    } else {
      const audio = await synthesize(input, signal);
      res.writeHead(200, {'Content-Type':'audio/wav', 'Content-Length':audio.length});
      res.end(audio);
    }
    return true;
  };
}
