import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeError} from './local-history.mjs';
const types=['recognition','numbers-language','ai-result','audio','ui','other'];
const json=(res,value)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
async function body(req,max=24*1024*1024){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw Error('请求过大');chunks.push(c);}return Buffer.concat(chunks);}
// Store-only ZIP: real files and CRC, no renamed JSON or fictitious codec.
export function zipFiles(files){let offset=0;const parts=[],central=[];for(const [name,bytes] of files){const n=Buffer.from(name);let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(crc,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);parts.push(h,n,bytes);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=30+n.length+bytes.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);}
export function createHistoryHandler(store,{onDelete,onClear}={}){
 return async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');if(!url.pathname.startsWith('/api/history'))return false;
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw Error('不允许跨站访问历史');
  if(req.method!=='GET'&&req.headers.origin!==`http://${req.headers.host}`)throw Error('历史修改需要同源请求');
  const action=url.pathname.slice('/api/history'.length),id=url.searchParams.get('id');
  if(req.method==='GET'&&action===''){json(res,await store.list({query:url.searchParams.get('q')||'',mode:url.searchParams.get('mode')||'all',offset:Number(url.searchParams.get('offset'))||0}));return true;}
  if(req.method==='GET'&&action==='/audio'){const a=await store.audioBytes(id);res.writeHead(200,{'Content-Type':a.format.mime});res.end(a.bytes);return true;}
  if(req.method==='POST'&&action==='/audio'){json(res,await store.audio(id,await body(req)));return true;}
  if(req.method==='GET'&&action==='/diagnostic'){json(res,await store.diagnostic(id));return true;}
  if(req.method==='GET'&&action==='/feedback-package'){
   if(!/^[\w-]{1,80}$/.test(id||''))throw Error('反馈ID无效');const dir=join(store.directory,'feedback'),f=JSON.parse(await readFile(join(dir,id+'.json'),'utf8'));const files=[['feedback.json',Buffer.from(JSON.stringify(f,null,2))]];if(f.audioFile){if(!/^[\w-]+\.(wav|webm|m4a)$/.test(f.audioFile))throw Error('附件路径无效');files.push(['recording.'+f.audioFile.split('.').at(-1),await readFile(join(dir,f.audioFile))]);}res.writeHead(200,{'Content-Type':'application/zip'});res.end(zipFiles(files));return true;
  }
  if(req.method!=='POST')throw Error('不支持的历史操作');const input=JSON.parse((await body(req,300000)).toString('utf8'));
  if(action==='/record')json(res,await store.record(input));
  else if(action==='/settings')json(res,await store.settings(input));
  else if(action==='/delete'){const result=await store.deletion(input.id,input.undo===true);if(!input.undo&&result.undoUntil&&onDelete){try{result.derivedMemoriesRemoved=await onDelete(input.id);}catch(error){result.derivedMemoryCleanupError=safeError(error.message);}}json(res,result);}
  else if(action==='/clear'){const before=input.confirmed===true?await store.list({offset:0,limit:100}):null;const ids=[];if(before){ids.push(...before.records.map(record=>record.id));for(let offset=100;offset<before.allTotal;offset+=100)ids.push(...(await store.list({offset,limit:100})).records.map(record=>record.id));}const result=await store.clear(input.confirmed===true);if(result.cleared&&onClear){try{result.derivedMemoriesRemoved=await onClear(ids);}catch(error){result.derivedMemoryCleanupError=safeError(error.message);}}json(res,result);}
  else if(action==='/lock')json(res,await store.lock(input.id,input.locked===true));
  else if(action==='/diagnostic-store')json(res,await store.decodedDiagnostic(input.id,input));
  else if(action==='/feedback'){
   if(!types.includes(input.type)||typeof input.description!=='string'||!input.description.trim()||input.description.length>8000)throw Error('请填写有效的问题类型和描述');
   const all=await store.list({limit:100});let record=all.records.find(r=>r.id===input.recordId);
   // Paginate rather than incorrectly restricting feedback to the newest 100.
   for(let offset=100;!record&&offset<all.total;offset+=100)record=(await store.list({offset,limit:100})).records.find(r=>r.id===input.recordId);
   if(!record)throw Error('记录不存在');
   const feedbackId=String(input.feedbackId||randomUUID());if(!/^[\w-]{1,80}$/.test(feedbackId))throw Error('反馈ID无效');const dir=join(store.directory,'feedback');await mkdir(dir,{recursive:true});
   const existing=await readFile(join(dir,feedbackId+'.json'),'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(existing){json(res,{saved:true,sent:false,id:feedbackId});return true;}
   const f={id:feedbackId,recordId:record.id,at:new Date().toISOString(),type:input.type,description:safeError(input.description,8000),expectedText:safeError(input.expectedText||'',8000),sent:false};
   if(input.attachText===true)f.text={originalTranscript:record.originalTranscript===null?null:safeError(record.originalTranscript,64000),revisedText:safeError(record.revisedText,64000),aiResult:safeError(record.aiResult,64000)};
   if(input.attachDiagnostic===true){try{f.diagnostic=await store.diagnostic(record.id);}catch(e){f.diagnostic={error:safeError(e.message)};}}
   if(input.attachAudio===true){const a=await store.audioBytes(record.id);f.audioFile=feedbackId+'.'+a.format.ext;await writeFile(join(dir,f.audioFile),a.bytes);}
   await writeFile(join(dir,feedbackId+'.json'),JSON.stringify(f,null,2),'utf8');json(res,{saved:true,sent:false,id:feedbackId});
  }else throw Error('历史接口不存在');return true;
 };
}
