import {useEffect, useState} from 'react';
import {getJson, postJson} from '../services/apiClient';

type CharacterVoice = {id:string;name:string;available:boolean;installed:boolean};

export function CharacterVoiceOptions({selected,onSelect,onPreview}: {
  selected:string;onSelect:(id:string)=>void;onPreview:()=>Promise<void>;
}) {
  const [voices,setVoices] = useState<CharacterVoice[]>([]);
  const [candidate,setCandidate] = useState('');
  const [pending,setPending] = useState(false);
  const [message,setMessage] = useState('');
  const refresh = async () => {
    try {setVoices(await getJson<CharacterVoice[]>('/api/character-voices'));}
    catch {setMessage('无法读取本机角色音色目录');}
  };
  useEffect(() => {void refresh();}, []);
  const voice = voices.find(item => item.id === (candidate || selected)) || voices[0];
  const install = async () => {
    if (!voice) return;
    setPending(true);
    try {
      await postJson('/api/character-voices/install', {id:voice.id});
      onSelect(voice.id);
      await refresh();
      setMessage('已启用 ' + voice.name + '。保存设置后用于问答播报。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '音色安装失败');
    } finally {setPending(false);}
  };
  return <div>
    <label>角色音色（本机试用）
      <select value={voice?.id || ''} onChange={event=>setCandidate(event.target.value)}>
        {!voice && <option value="">正在读取角色</option>}
        {voices.map(item=><option key={item.id} value={item.id}>{item.name}{item.installed ? ' · 已安装' : item.available ? '' : ' · 本机文件不全'}</option>)}
      </select>
    </label>
    <p className="muted">使用本机 GPT-SoVITS 官方 V2 权重和角色参考音频合成。安装会启用已下载的文件。</p>
    <div className="actions">
      <button type="button" disabled={pending || !voice?.available} onClick={()=>void install()}>{voice?.installed ? '使用此音色' : '安装音色'}</button>
      <button type="button" disabled={pending || !voice?.available || !voice.installed || selected !== voice.id} onClick={()=>void onPreview()}>试听角色</button>
      <button type="button" onClick={()=>void refresh()}>刷新角色</button>
    </div>
    {message && <p className="muted" role="status">{message}</p>}
  </div>;
}
