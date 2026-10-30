import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { useEffect, useState } from 'react';
import remarkGfm from 'remark-gfm';
import type { AgentResult, AgentSource } from '../types';
import { sourceHref } from '../services/sourceLinks';
import { cleanSpeechText, speechController } from '../services/speech';

type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };
const sanitizeSchema = { ...defaultSchema, protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href || []), 'talkcraft-source'] } };

function citationPlugin(sources: AgentSource[]) {
  return () => (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || ['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference'].includes(node.type)) return;
      const next: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type !== 'text' || !child.value) { visit(child); next.push(child); continue; }
        const parts = child.value.split(/(\[\d{1,2}\])/g);
        for (const part of parts) {
          const match = /^\[(\d{1,2})\]$/.exec(part);
          const number = match ? Number(match[1]) : 0;
          const source = number ? sources[number - 1] : undefined;
          if (source && sourceHref(source.url)) next.push({ type: 'link', url: `talkcraft-source:${encodeURIComponent(source.sourceId || `index:${number}`)}`, children: [{ type: 'text', value: part }] });
          else if (part) next.push({ type: 'text', value: part });
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}

export function AnswerText({ result, className = '', enableSpeech = true }: { result: AgentResult | null; className?: string; enableSpeech?:boolean }) {
  const [speechState,setSpeechState]=useState<'idle'|'playing'|'error'>('idle');
  const en=typeof document!=='undefined'&&document.documentElement.dataset.uiLanguage==='en-US';
  useEffect(()=>{const stopped=()=>setSpeechState('idle');window.addEventListener('talkcraft-speech-stopped',stopped);return()=>window.removeEventListener('talkcraft-speech-stopped',stopped);},[]);
  const text = result?.text || '';
  const sources = result?.search?.sources || [];
  const components: Components = {
    a({ href, children, ...props }) {
      const value = href || '';
      if (value.startsWith('talkcraft-source:')) {
        let token = '';
        try { token = decodeURIComponent(value.slice('talkcraft-source:'.length)); } catch { /* malformed citation stays plain text */ }
        const source = token.startsWith('index:') ? sources[Number(token.slice(6)) - 1] : sources.find(item => item.sourceId === token);
        const safeHref = sourceHref(source?.url);
        if (!safeHref) return <span className="answer-citation-text">{children}</span>;
        const title = source?.title || source?.domain || '参考来源';
        const preview = [title, source?.domain || '', source?.snippet?.slice(0, 180) || '', safeHref].filter(Boolean).join('\n');
        return <a className="answer-citation" href={safeHref} target="_blank" rel="noopener noreferrer" title={preview} aria-label={`打开来源：${title}`} {...props}>{children}</a>;
      }
      const safeHref = sourceHref(value);
      return safeHref ? <a href={safeHref} target="_blank" rel="noopener noreferrer" {...props}>{children}</a> : <span>{children}</span>;
    },
    img: () => null,
    table({ children }) { return <div className="answer-table-scroll"><table>{children}</table></div>; },
  };
  if (!text) return <div className={`answer-markdown ${className}`.trim()} role="status">{result ? '回答内容为空。' : '结果会显示在这里。'}</div>;
  const play=async()=>{setSpeechState('playing');try{await speechController.play(text);setSpeechState('idle');}catch{setSpeechState('error');}};
  return <div className={`answer-reader ${className}`.trim()}>
    {enableSpeech&&<div className="answer-speech-controls"><button type="button" onClick={()=>void play()} disabled={speechState==='playing'}>{en?'Play answer':'播放回答'}</button><button type="button" onClick={()=>{speechController.stop();setSpeechState('idle');}} disabled={speechState!=='playing'}>{en?'Stop':'停止'}</button><details><summary>{en?'View speech text':'查看朗读文字'}</summary><p>{cleanSpeechText(text)}</p></details>{speechState==='playing'&&<span role="status">{en?'Speaking with a local voice':'正在使用本机语音朗读'}</span>}{speechState==='error'&&<span role="status">{en?'Local speech is unavailable. Check Windows installed voices.':'本机语音不可用，请检查已安装的Windows语音'}</span>}</div>}
    <div className="answer-markdown">
    <ReactMarkdown remarkPlugins={[citationPlugin(sources), remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]} components={components} urlTransform={url => url.startsWith('talkcraft-source:') ? url : sourceHref(url)}>{text}</ReactMarkdown>
    </div>
  </div>;
}
