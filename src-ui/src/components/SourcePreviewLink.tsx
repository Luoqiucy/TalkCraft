import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentSource } from '../types';
import { sourcePreview } from '../services/sourceLinks';

export function SourcePreviewLink({ source, label, compact = false }: { source: AgentSource; label?: string; compact?: boolean }) {
  const { title, domain, href } = sourcePreview(source);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(340, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + 130 < window.innerHeight ? rect.bottom + 7 : Math.max(12, rect.top - 125);
    setPosition({ left, top });
  }, []);
  useLayoutEffect(() => {
    if (!visible) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); };
  }, [visible, updatePosition]);
  if (!href) return <span>{label || title}</span>;
  const openPreview = () => setVisible(true);
  const closePreview = () => setVisible(false);
  return <>
    <span ref={anchorRef} className={`source-preview ${compact ? 'source-preview-compact' : ''}`} onMouseEnter={openPreview} onMouseLeave={closePreview} onFocusCapture={openPreview} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closePreview(); }}>
      <a className="source-preview-anchor" href={href} target="_blank" rel="noopener noreferrer" title={`${title}\n${domain}\n${href}`} aria-label={`${label || title}；${title}；${domain}；打开原文`}>
        <img src="/assets/source-page.svg" width="18" height="18" alt="" aria-hidden="true" />
        <span className="source-preview-label">{label || title}</span>
      </a>
    </span>
    {visible && position && createPortal(<span className={`source-preview-card source-preview-card-portal${compact ? ' compact' : ''}`} role="tooltip" style={position}>
      <strong>{title}</strong><small>{domain}</small>{source.snippet && <span className="source-preview-snippet">资料摘录：{source.snippet.slice(0, 220)}</span>}<span>{href}</span>
    </span>, document.body)}
  </>;
}
