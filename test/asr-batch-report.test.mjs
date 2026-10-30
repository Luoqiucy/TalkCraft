import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeAsrAcceptanceReport} from '../src/asr-batch.mjs';

const samples=()=>Array.from({length:100},(_,index)=>({id:`sample-${index}`,reference:'今天3点不要发布',hypothesis:'今天3点不要发布',latencyMs:100}));
function output(){const events=[];return {events,async writeFile(json){events.push(JSON.parse(json));},async sync(){events.push('synced');}};}

test('批量验收全部达标，报告同步保存后返回成功',async()=>{
  const target=output();assert.equal(await writeAsrAcceptanceReport(target,samples()),0);
  assert.equal(target.events[0].passed,true);assert.equal(target.events[1],'synced');
});

test('采集完成但任一质量门槛失败，保留报告并返回退出码2',async()=>{
  for(const modify of [rows=>rows.pop(),rows=>rows.forEach(row=>row.hypothesis='错误内容'),rows=>rows.forEach(row=>row.latencyMs=5100),rows=>rows[0].hypothesis='今天4点不要发布',rows=>rows[0].hypothesis='今天3点发布']){
    const rows=samples();modify(rows);const target=output();
    assert.equal(await writeAsrAcceptanceReport(target,rows),2);
    assert.equal(target.events[0].passed,false);assert.equal(target.events[1],'synced');
  }
});

test('报告写入或同步失败，传播操作错误而不返回质量成功',async()=>{
  for(const operation of ['writeFile','sync']){
    const target=output();target[operation]=async()=>{throw new Error('disk failure');};
    await assert.rejects(writeAsrAcceptanceReport(target,samples()),/disk failure/);
  }
});
