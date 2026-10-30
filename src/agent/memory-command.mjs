export function parseExplicitMemoryCommand(input) {
  const match = String(input || '').trim().match(/^(?:请)?记住(?:一下)?[：:，,\s]*(.+)$/su);
  if (!match) return null;
  const body = match[1].trim();
  const combined = body.match(/^(.+?)[，,；;。\s]*并(?:且)?(?:帮我)?(?:查询|查(?:一下)?|搜索|搜(?:一下)?)\s*(.+)$/u);
  const content = (combined?.[1] || body).trim(), query = combined?.[2]?.trim() || '';
  if (!content) return null;
  const type = /项目|长期在做|正在开发/u.test(content) ? 'project' : /专有词|词典|术语/u.test(content) ? 'term' : /喜欢|偏好|希望|默认|偶尔|有时/u.test(content) ? 'preference' : 'fact';
  return { content, query, type };
}
