import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTelemetryStore} from '../src/telemetry.mjs';
import {deviceVisual,elapsedLabel} from '../public/live-state.mjs';
import {createServer} from '../server.mjs';
test('默认未连接无测量，过期后清除信号电量，重连恢复',()=>{
 let time=0;const store=createTelemetryStore({now:()=>time});
 assert.deepEqual(store.read().device,{connection:'disconnected',name:'无线麦克风未连接',battery:null,rssi:null,stale:false});
 const data={connection:'connected',name:'测试设备',battery:84,rssi:-42,secret:'NO-LEAK'};store.update(data);data.battery=12;
 assert.equal(store.read().device.battery,84);assert.equal(store.read().device.secret,undefined);
 time=15001;assert.equal(store.read().device.stale,true);assert.equal(store.read().device.battery,null);assert.equal(store.read().device.rssi,null);
 store.update({connection:'connected',rssi:-85});assert.equal(store.read().device.connection,'connected');
});
test('非法设备测量拒绝，保持先前快照',()=>{
 const store=createTelemetryStore();store.update({connection:'connected',battery:80});
 for(const value of [{connection:'fake'},{connection:'connected',battery:101},{connection:'connected',rssi:NaN},{connection:'connected',rssi:1},{connection:'connected',name:'x'.repeat(81)}])assert.throws(()=>store.update(value),/无效/);
 assert.equal(store.read().device.battery,80);
});
test('信号分档仅来自有效连接测量，离线/缺失不显示已连接数值',()=>{
 for(const [rssi,bars]of [[-42,4],[-60,3],[-72,2],[-90,1]])assert.equal(deviceVisual({connection:'connected',rssi}).bars,bars);
 for(const connection of ['disconnected','connecting']){const state=deviceVisual({connection,rssi:-42,battery:84});assert.equal(state.bars,0);assert.equal(state.battery,null);}
 assert.equal(deviceVisual().signalLabel,'信号未知');assert.equal(elapsedLabel(61000),'01:01');
});
test('本机遥测只读接口与Figma本地图标资源，无浏览器伪造入口',async t=>{
 const telemetry=createTelemetryStore();const server=createServer({telemetry});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
 let response=await fetch(base+'/api/telemetry');assert.equal(response.status,200);assert.equal((await response.json()).device.connection,'disconnected');
 telemetry.update({connection:'connected',battery:80,rssi:-62});assert.equal((await (await fetch(base+'/api/telemetry')).json()).device.rssi,-62);
 assert.equal((await fetch(base+'/api/telemetry',{method:'POST'})).status,404);
 response=await fetch(base+'/assets/figma/imgContainer24.svg');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/svg/);assert.match(await response.text(),/<svg/);
 assert.equal((await fetch(base+'/live-ui.mjs')).status,200);assert.equal((await fetch(base+'/figma.css')).status,200);
});
