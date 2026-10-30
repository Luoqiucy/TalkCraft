import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {gzipSync,deflateSync,brotliCompressSync} from 'node:zlib';
import {createWebpageTool,extractReadablePage,readResponseBody,validatePublicUrl} from '../src/tools/webpage.mjs';

const page='<!doctype html><html><head><title>参数表</title><meta name="datePublished" content="2026-09-01"></head><body><nav>导航链接应跳过</nav><main><h1>参数</h1><table><tr><th>容量</th><th>功率</th></tr><tr><td>20000mAh</td><td>210W</td></tr></table><p>这是足够长的可读取正文，用于验证动态内容压缩和表格单元格提取。</p></main><footer>页脚内容</footer></body></html>';
const response=(body,encoding='identity',type='text/html; charset=utf-8',statusCode=200,headers={})=>{const stream=Readable.from([body]);stream.statusCode=statusCode;stream.headers={'content-type':type,'content-encoding':encoding,...headers};return stream;};

test('HTML提取保留标题、发布时间和表格单元格，去掉导航页脚',()=>{
 const result=extractReadablePage(page,{url:'https://example.com/product'});assert.equal(result.title,'参数表');assert.equal(result.publishedAt,'2026-09-01');assert.match(result.text,/容量 \| 功率/);assert.match(result.text,/20000mAh \| 210W/);assert.doesNotMatch(result.text,/导航链接|页脚内容/);
});

test('网页读取支持 gzip、deflate、br 且限制解压后大小',async()=>{
 for(const [encoding,body] of [['gzip',gzipSync(Buffer.from(page))],['deflate',deflateSync(Buffer.from(page))],['br',brotliCompressSync(Buffer.from(page))]]){const result=await readResponseBody(response(body,encoding),{maxCompressedBytes:100000,maxDecompressedBytes:100000});assert.match(result.body,/<title>参数表/);assert.equal(result.encoding,encoding);}
 await assert.rejects(readResponseBody(response(gzipSync(Buffer.from('x'.repeat(5000))),'gzip'),{maxCompressedBytes:100000,maxDecompressedBytes:100}),/解压后超过读取上限/);
 await assert.rejects(readResponseBody(response(Buffer.from('x'.repeat(120)),'identity'),{maxCompressedBytes:100,maxDecompressedBytes:1000}),/压缩内容超过读取上限/);
 await assert.rejects(readResponseBody(response(Buffer.from('x'),'compress'),{maxCompressedBytes:100,maxDecompressedBytes:100}),/不支持的压缩编码/);
});

test('动态空壳和拦截页面如实标记读取失败',()=>{
 assert.throws(()=>extractReadablePage('<html><body><div id="app"></div></body></html>',{url:'https://example.com'}),/动态页面框架/);
 assert.throws(()=>extractReadablePage('<html><title>Verify</title><body>Captcha: verify you are human</body></html>',{url:'https://example.com'}),/要求验证/);
});

test('实际读取链路解压网页，并在重定向进入内网前拒绝',async()=>{
 const lookupImpl=async()=>[{address:'93.184.216.34',family:4}],compressed=gzipSync(Buffer.from(page));let calls=0;
 const reader=createWebpageTool({lookupImpl,requestImpl:async()=>{calls++;return response(compressed,'gzip');}});const result=await reader.read('https://example.com/spec');assert.match(result.text,/20000mAh/);assert.equal(result.encoding,'gzip');assert.equal(result.finalUrl,'https://example.com/spec');
 const redirect=createWebpageTool({lookupImpl,requestImpl:async()=>{calls++;return response(Buffer.alloc(0),'identity','text/html',302,{location:'http://127.0.0.1/admin'});}});await assert.rejects(redirect.read('https://example.com/go'),/只允许公开HTTP\/HTTPS/);assert.equal(calls,2);
});

test('绝对总时限覆盖等待网页正文的时间',async()=>{
 const slow=Readable.from((async function*(){await new Promise(resolve=>setTimeout(resolve,80));yield Buffer.from(page);})());slow.statusCode=200;slow.headers={'content-type':'text/html'};
 const reader=createWebpageTool({timeoutMs:20,lookupImpl:async()=>[{address:'93.184.216.34',family:4}],requestImpl:async()=>slow});await assert.rejects(reader.read('https://example.com/slow'),/绝对时限已到/);
});

test('URL安全检查仍拒绝本机与带凭据地址',()=>{assert.throws(()=>validatePublicUrl('http://127.0.0.1/'),/公开HTTP\/HTTPS/);assert.throws(()=>validatePublicUrl('https://user:pass@example.com/'),/公开HTTP\/HTTPS/);});
