import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateAsrManifest} from '../src/asr-batch.mjs';

test('Phase 1固定普通话语料为100条且覆盖关键风险',async()=>{
  const text=await readFile(new URL('../samples/phase1-mandarin-100.jsonl',import.meta.url),'utf8');
  const entries=text.trim().split(/\r?\n/).map(line=>JSON.parse(line)),validated=validateAsrManifest(entries);
  assert.equal(validated.length,100);assert.equal(new Set(validated.map(item=>item.reference)).size,100);
  assert.ok(validated.filter(item=>/\d/.test(item.reference)).length>=50);
  assert.ok(validated.filter(item=>/(不|没|无|未|否|别|勿|禁止)/.test(item.reference)).length>=35);
  assert.ok(validated.filter(item=>/[A-Za-z]/.test(item.reference)).length>=25);
  for(const item of validated)assert.equal(item.audio,`audio/${item.id}.wav`);
});
