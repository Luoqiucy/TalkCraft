import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listenForFetch} from '../test-support/http-listen.mjs';
import {EventEmitter} from 'node:events';
test('HTTP测试避开低端口、移除监听器并限制重试',async()=>{
 class FakeServer extends EventEmitter {
  constructor(ports){super();this.ports=ports;this.closes=0;this.listens=0;}
  listen(){this.port=this.ports[Math.min(this.listens++,this.ports.length-1)];queueMicrotask(()=>this.emit('listening'));}
  address(){return {port:this.port};}close(callback){this.closes++;callback();}
 }
 const server=new FakeServer([6000,10080,49152]);assert.equal(await listenForFetch(server),'http://127.0.0.1:49152');assert.equal(server.closes,2);assert.equal(server.listenerCount('error'),0);assert.equal(server.listenerCount('listening'),0);
 const unavailable=new FakeServer([6000]);await assert.rejects(listenForFetch(unavailable),/无法分配/);assert.equal(unavailable.listens,32);assert.equal(unavailable.closes,32);
});
