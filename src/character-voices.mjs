import {execFile} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join} from 'node:path';
import {promisify} from 'node:util';
import {runtimeStatePath} from './runtime-paths.mjs';

const execute = promisify(execFile);
const catalog = [
  ['原神（已更新4.8）', ['云堇','五郎','八重神子','凝光','凯亚','凯瑟琳','刻晴','可莉','夏洛蒂','宵宫','派蒙','珊瑚宫心海','申鹤']],
  ['崩坏：星穹铁道（已更新2.4）', ['三月七','云璃']],
].flatMap(([folder, names]) => names.map(name => ({name, folder, id: 'gpt-sovits:' + name})));

const synthesize = String.raw`
import io, os, sys, contextlib
os.environ.update(version="v2", GRADIO_ANALYTICS_ENABLED="False")
sys.path[:0] = [os.getcwd(), os.path.join(os.getcwd(), "GPT_SoVITS")]
with contextlib.redirect_stdout(sys.stderr):
    from scipy.io.wavfile import write
    from GPT_SoVITS import inference_webui as tts
    from pathlib import Path
    ref, text, rate = sys.argv[1:]
    lang = tts.i18n("中文")
    hz, pcm = next(tts.get_tts_wav(ref, Path(ref).stem, lang, text, lang, speed=float(rate), inp_refs=[]))
    if len(pcm) < hz // 3 or not pcm.any():
        raise ValueError("Empty synthesis")
    audio = io.BytesIO()
    write(audio, hz, pcm)
sys.stdout.buffer.write(audio.getvalue())
`;

export function createCharacterVoiceHandler() {
  const root = process.env.TALKCRAFT_GPT_SOVITS_DIR || (process.platform === 'win32' ? 'G:/GPT-SoVITS' : '');
  const cwd = join(root, 'runtime', 'GPT-SoVITS-v2-240821');
  const python = join(cwd, 'runtime', 'python.exe');
  let activeSynthesis;
  const marker = voice => runtimeStatePath('gpt-sovits-' + (catalog.indexOf(voice) + 1) + '.installed');
  function reference(voice) {
    if (!isAbsolute(root) || !existsSync(python)) return '';
    const directory = join(root, 'voices', voice.folder, voice.name);
    if (!existsSync(directory)) return '';
    const files = readdirSync(directory, {withFileTypes: true}).filter(file => file.isFile()).map(file => file.name);
    if (!files.some(file => file.endsWith('.pth')) || !files.some(file => file.endsWith('.ckpt'))) return '';
    const sample = files.filter(file => file.endsWith('.wav')).sort()[0];
    return sample ? join(directory, sample) : '';
  }
  return async (req, res, signal) => {
    const route = req.url;
    if (route === '/api/character-voices' && req.method === 'GET') {
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(catalog.map(voice => ({
        id: voice.id, name: voice.name, available: !!reference(voice), installed: existsSync(marker(voice)),
      }))));
      return true;
    }
    if (!['/api/character-voices/install', '/api/character-voices/preview', '/api/character-voices/speak'].includes(route) || req.method !== 'POST') return false;
    if (req.headers.origin !== 'http://' + req.headers.host || req.headers['content-type'] !== 'application/json') {
      res.writeHead(403); res.end(); return true;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) { res.writeHead(413); res.end(); return true; }
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const voice = catalog.find(item => item.id === input?.id);
    const ref = voice && reference(voice);
    if (!ref) throw new Error('角色音色文件不可用，请检查本机 GPT-SoVITS 目录');
    if (route.endsWith('/install')) {
      const file = marker(voice);
      await mkdir(dirname(file), {recursive:true});
      await writeFile(file, '');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({installed:true}));
      return true;
    }
    if (!existsSync(marker(voice))) throw new Error('请先安装这个角色音色');
    if (route.endsWith('/preview')) {
      const sample = join(root, 'talkcraft-previews', voice.name + '.wav');
      const audio = await readFile(sample).catch(() => null);
      if (!audio || audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF') {
        throw new Error('本机缺少该角色的试听文件');
      }
      res.writeHead(200, {'Content-Type':'audio/wav'});
      res.end(audio);
      return true;
    }
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > 600) throw new Error('角色音色每次可朗读 1–600 字');
    activeSynthesis?.abort();
    const job = new AbortController();
    activeSynthesis = job;
    const deadline = AbortSignal.timeout(90000);
    const jobSignal = AbortSignal.any([job.signal, deadline, ...(signal ? [signal] : [])]);
    try {
      jobSignal.throwIfAborted();
      const rate = Number.isFinite(input.rate) ? Math.min(2, Math.max(.5, input.rate)) : 1;
      const {stdout} = await execute(python, ['-c', synthesize, ref, text, String(rate)], {
        cwd, encoding:'buffer', maxBuffer:24 * 1024 * 1024, windowsHide:true, signal:jobSignal,
        env: {...process.env, PYTHONIOENCODING:'utf-8', version:'v2'},
      });
      jobSignal.throwIfAborted();
      if (stdout.length < 44 || stdout.toString('ascii', 0, 4) !== 'RIFF') throw new Error('无有效音频');
      res.writeHead(200, {'Content-Type':'audio/wav'}); res.end(stdout);
    } catch {
      throw new Error(deadline.aborted ? '角色语音合成超时，请重试' : job.signal.aborted ? '已切换到新的语音请求' : '本机角色语音合成失败');
    } finally {
      if (activeSynthesis === job) activeSynthesis = undefined;
    }
    return true;
  };
}
