import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {runtimeStatePath} from '../src/runtime-paths.mjs';

test('source launch keeps existing config while bundled launch isolates writable state',()=>{
  const source=resolve('project'),data=resolve('isolated-user-data');
  assert.equal(runtimeStatePath('asr-test.env',{env:{},projectRoot:source}),join(source,'.local','asr-test.env'));
  for(const name of ['asr-test.env','workspace.json','desktop-service.json'])assert.equal(runtimeStatePath(name,{env:{TALKCRAFT_DATA_DIR:data},projectRoot:source}),join(data,name));
  assert.throws(()=>runtimeStatePath('../private.env',{env:{},projectRoot:source}));
  assert.throws(()=>runtimeStatePath('asr-test.env',{env:{TALKCRAFT_DATA_DIR:'relative-path'},projectRoot:source}));
});
