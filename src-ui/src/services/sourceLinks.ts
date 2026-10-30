import type { AgentSource } from '../types';

const sensitiveParam = /(?:^|[_-])(api[_-]?key|access[_-]?(?:token|key)|token|auth(?:orization)?|bearer|secret|signature|sig|credential|password|session|cookie)(?:$|[_-])/i;

export function sourceHref(value?: string): string {
  try {
    const url = new URL(value || '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    for (const key of [...url.searchParams.keys()]) if (sensitiveParam.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function sourcePreview(source?: Pick<AgentSource, 'title' | 'domain' | 'url'>): { title: string; domain: string; href: string } {
  const href = sourceHref(source?.url);
  const domain = (href ? new URL(href).hostname : source?.domain?.trim()) || '网站未记录';
  const title = source?.title?.trim() || (domain !== '网站未记录' ? domain : '参考资料');
  return { title, domain, href };
}

export function citedSourceNumbers(answer: string, sources: AgentSource[] = []): number[] {
  const used = new Set<number>();
  for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const number = Number(match[1]);
    if (number > 0 && sources[number - 1] && sourceHref(sources[number - 1].url)) used.add(number);
  }
  return [...used];
}
