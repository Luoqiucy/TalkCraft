import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {EventEmitter} from 'node:events';
import {installServerShutdown} from '../src/server-shutdown.mjs';
test('服务关闭超时中断挂起请求，重复关闭共用结果并清理监听',async()=>{
 const signals=new EventEmitter();let arrived;
 const received=new Promise(resolve=>{arrived=resolve;});
 const server=createServer(()=>arrived());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const control=installServerShutdown(server,{signals,graceMs:20});
 const client=request({host:'127.0.0.1',port:server.address().port,path:'/'});client.on('error',()=>{});client.end();
 await received;const first=control.stop();assert.equal(control.stop(),first);await first;
 assert.equal(server.listening,false);assert.equal(signals.listenerCount('SIGINT'),0);assert.equal(signals.listenerCount('SIGTERM'),0);client.destroy();
});
test('空闲服务收到停止信号后关闭',async()=>{
 const signals=new EventEmitter(),server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const control=installServerShutdown(server,{signals});signals.emit('SIGTERM');await control.stop();assert.equal(server.listening,false);assert.equal(signals.listenerCount('SIGTERM'),0);
});

test('退出立即取消挂起推理，同时等待历史写入完成，无需三秒宽限期',async()=>{
 const signals=new EventEmitter();let count=0,arrive,release,finished=false;
 const ready=new Promise(r=>arrive=r),saved=new Promise(r=>release=r);
 const server=createServer(async(req,res)=>{if(++count===2)arrive();if(req.url==='/api/history/record'){await saved;finished=true;res.end('saved');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const control=installServerShutdown(server,{signals});
 const clients=['/api/search','/api/history/record'].map(path=>{const c=request({host:'127.0.0.1',port:server.address().port,path,method:'POST'},res=>res.resume());c.on('error',()=>{});c.end();return c;});
 try{
  await ready;const start=performance.now();let stopped=false;const pending=control.stop().then(()=>stopped=true);
  await new Promise(r=>setTimeout(r,30));assert.equal(stopped,false);assert.equal(finished,false);
  release();await pending;assert.equal(finished,true);assert.ok(performance.now()-start<1000,'本地退出应在一秒内完成');
 }finally{release();clients.forEach(c=>c.destroy());await control.stop();}
});
