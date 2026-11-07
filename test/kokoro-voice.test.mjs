import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createKokoroVoice} from '../src/kokoro-voice.mjs';

test('voice pack installation requires same-origin consent and discards a mismatched download', async t => {
  const root = await mkdtemp(join(tmpdir(), 'talkcraft-kokoro-'));
  let downloads = 0;
  const handle = createKokoroVoice({root, fetchImpl: async () => {
    downloads++;
    return new Response('not the official archive');
  }});
  const server = createServer(async (req, res) => {
    try { await handle(req, res, new AbortController().signal); }
    catch (error) { res.writeHead(400); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const install = origin => fetch(base + '/api/local-voice/install', {
    method: 'POST', headers: {origin, 'Content-Type': 'application/json'},
    body: JSON.stringify({source: 'official'})
  });
  assert.equal((await install('https://example.com')).status, 403);
  assert.equal(downloads, 0);
  const invalid = await install(base);
  assert.equal(invalid.status, 400);
  assert.match(await invalid.text(), /校验失败/);
  assert.equal(downloads, 1);
  assert.deepEqual(await readdir(root), []);
  const status = await (await fetch(base + '/api/local-voice')).json();
  assert.equal(status.installed, false);
  assert.equal(status.installing, false);
});
