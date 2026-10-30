import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('shared answer renderer formats GFM tables and citations while ignoring unsafe HTML and links', async () => {
  const vite = await createServer({ root: 'src-ui', configFile: 'vite.config.ts', logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const { AnswerText } = await vite.ssrLoadModule('/src/components/AnswerText.tsx');
    const html = renderToStaticMarkup(React.createElement(AnswerText, { result: {
      text: '## 参数\n\n|版本|价格|\n|---|---:|\n|Pro|12万元|\n\n**结论** [1]\n\n<script>alert(1)</script> ![远程图](https://tracker.invalid/image.png) [危险链接](javascript:alert(1))',
      search: { sources: [{ sourceId: 'official-1', title: '官方页面', url: 'https://example.com/spec', snippet: '参数摘要' }] },
    } }));
    assert.match(html, /<table>/);
    assert.match(html, /<strong>结论<\/strong>/);
    assert.match(html, /class="answer-citation" href="https:\/\/example\.com\/spec"/);
    assert.doesNotMatch(html, /<script|onerror|tracker\.invalid|javascript:/i);
  } finally {
    await vite.close();
  }
});
