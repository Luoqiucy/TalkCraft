export async function playCharacterSpeech(id: string, text: string, options: {rate?:number;volume?:number}, signal: AbortSignal) {
  const response = await fetch('/api/character-voices/speak', {
    method: 'POST', signal, headers: {'Content-Type':'application/json'},
    body: JSON.stringify({id,text,rate:options.rate}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '角色语音合成失败');
  }
  const blob = await response.blob();
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = Math.min(1, Math.max(0, options.volume ?? 1));
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => {audio.pause(); resolve();};
      signal.addEventListener('abort', stop, {once:true});
      audio.onended = () => {signal.removeEventListener('abort', stop); resolve();};
      audio.onerror = () => {signal.removeEventListener('abort', stop); reject(new Error('角色音频播放失败'));};
      void audio.play().catch(error => {signal.removeEventListener('abort', stop); reject(error);});
    });
  } finally {
    audio.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
