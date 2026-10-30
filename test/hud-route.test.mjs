import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {listenForFetch} from '../test-support/http-listen.mjs';
test('HUD查询参数及带版本静态资源均可读取，未知页面和API查询不扩权',async t=>{
 const server=createServer({provider:{simulated:true,async complete(){throw new Error('不应调用模型');}},asr:{enabled:false}});
 t.after(()=>new Promise(resolve=>server.close(resolve)));const root=await listenForFetch(server);
 for(const path of ['/?hud=1','/?hud=1&v=97','/shell.mjs?v=97','/assets/figma/imgContainer90.svg?v=97']){const response=await fetch(root+path);assert.equal(response.status,200,path);assert.notEqual(await response.text(),'Not found');}
 for(const path of ['/missing?hud=1','/api/status?hud=1','/assets/figma/unknown.svg'])assert.equal((await fetch(root+path)).status,404,path);
});
