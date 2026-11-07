import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkbenchApp } from './components/WorkbenchApp';
import { AuxPanel } from './components/AuxPanel';
import { desktopAvailable, desktopInvoke } from './services/tauriBridge';
import { sourceHref } from './services/sourceLinks';
import './styles.css';
import './history.css';
import './source-preview.css';
import './settings.css';
import './theme.css';

const panel = new URLSearchParams(location.search).get('panel');
if (desktopAvailable()) {
  const openExternal = (event: MouseEvent) => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    let parsed: URL;
    try { parsed = new URL(anchor.href); } catch { return; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === location.origin) return;
    event.preventDefault();
    const safeUrl = sourceHref(anchor.href);
    if (!safeUrl) { window.alert('来源链接不安全，无法打开'); return; }
    void desktopInvoke('open_external_url', { url: safeUrl }).catch(() => window.alert('无法使用系统默认浏览器打开来源链接，请重试'));
  };
  document.addEventListener('click', openExternal, true);
  document.addEventListener('auxclick', event => { if (event.button === 1) openExternal(event); }, true);
}
createRoot(document.getElementById('root')!).render(<StrictMode>{panel === 'keymap' || panel === 'chat' ? <AuxPanel panel={panel} /> : <WorkbenchApp />}</StrictMode>);
