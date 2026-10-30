const TARGET_RATE = 16000;
const MAX_SECONDS = 120;

function encodePcm16(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(samples.length * 2); const view = new DataView(bytes);
  for (let i = 0; i < samples.length; i++) { const value = Math.max(-1, Math.min(1, samples[i])); view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
  return bytes;
}

export async function recordingToPcm(blob: Blob, signal?: AbortSignal): Promise<{ pcm: ArrayBuffer; duration: number }> {
  if (!blob.size || blob.size > 24 * 1024 * 1024) throw new Error('录音为空或过大');
  signal?.throwIfAborted();
  if (!globalThis.AudioContext || !globalThis.OfflineAudioContext) throw new Error('当前环境不支持录音转换');
  const decoder = new AudioContext();
  try {
    const source = await decoder.decodeAudioData(await blob.arrayBuffer());
    signal?.throwIfAborted();
    const frames = Math.max(1, Math.round(source.length * TARGET_RATE / source.sampleRate));
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
    const buffer = offline.createBuffer(1, source.length, source.sampleRate);
    const mono = new Float32Array(source.length);
    for (let channel = 0; channel < source.numberOfChannels; channel++) { const samples = source.getChannelData(channel); for (let i = 0; i < samples.length; i++) mono[i] += samples[i] / source.numberOfChannels; }
    buffer.copyToChannel(mono, 0);
    const node = offline.createBufferSource(); node.buffer = buffer; node.connect(offline.destination); node.start();
    const rendered = await offline.startRendering(); signal?.throwIfAborted();
    if (rendered.length > TARGET_RATE * MAX_SECONDS) throw new Error('录音不能超过 120 秒');
    return { pcm: encodePcm16(rendered.getChannelData(0)), duration: rendered.length / TARGET_RATE };
  } catch (error) { signal?.throwIfAborted(); throw new Error(error instanceof Error ? `无法解码录音：${error.message}` : '无法解码录音'); } finally { await decoder.close().catch(() => {}); }
}

export async function transcribePcm(pcm: ArrayBuffer, audioConsent: boolean, signal?: AbortSignal, taskId?: string, commercial = false): Promise<{ text: string; simulated: boolean; historyContext?: { provider?: string; model?: string } }> {
  const response = await fetch(commercial ? '/api/commercial/transcribe' : '/api/transcribe', { method: 'POST', body: pcm, signal, headers: { 'Content-Type': 'application/octet-stream', 'X-TalkCraft-History-Metadata': 'true', ...(taskId ? { 'X-TalkCraft-Task-Id': taskId } : {}), 'X-Audio-Sample-Rate': '16000', 'X-Audio-Channels': '1', 'X-Audio-Bit-Depth': '16', 'X-Audio-Cloud-Consent': String(audioConsent) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `转写失败（${response.status}）`);
  if (typeof body.text !== 'string' || !body.text.trim()) throw new Error('识别没有返回文字');
  return body;
}

export async function processText(input: Record<string, unknown>, signal?: AbortSignal, commercial = false) {
  const response = await fetch(commercial ? '/api/commercial/process' : '/api/process', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-TalkCraft-History-Metadata': 'true' }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `文字处理失败（${response.status}）`);
  if (typeof body.text !== 'string') throw new Error('文字服务没有返回结果');
  return body;
}
