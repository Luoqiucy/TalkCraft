import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assembleMacBundle,macInfoPlist} from '../scripts/macos-bundle.mjs';

test('Mac development bundle includes backend and runtime but not private project directories',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'talkcraft-mac-bundle-'));
  try{
    const root=join(temp,'source'),output=join(temp,'output');
    const fixture={'package.json':'{"version":"0.1.0"}','package-lock.json':'{}','server.mjs':'export {};','src/module.mjs':'export {};','public/react/index.html':'<html>workbench</html>','public/assets/icon.svg':'<svg/>','src-tauri/icons/icon.icns':'fixture-icon','scripts/asr-file.mjs':'export {};','scripts/text-model-config.mjs':'export {};','.local/private.env':'TEST_ONLY=private','reports/private.md':'private','runtime-node':'fixture-node','runtime-app':'fixture-app'};
    for(const [path,value] of Object.entries(fixture)){const destination=join(root,path);await mkdir(join(destination,'..'),{recursive:true});await writeFile(destination,value);}
    const bundle=await assembleMacBundle({root,output,nodeBinary:join(root,'runtime-node'),rustBinary:join(root,'runtime-app')});
    assert.equal(await readFile(bundle.node,'utf8'),'fixture-node');
    assert.equal(await readFile(join(bundle.backend,'public/react/index.html'),'utf8'),'<html>workbench</html>');
    for(const path of ['.local/private.env','reports/private.md','scripts/build-windows.ps1'])await assert.rejects(access(join(bundle.backend,path)));
    const plist=await readFile(join(bundle.app,'Contents/Info.plist'),'utf8');assert.match(plist,/NSMicrophoneUsageDescription/);assert.match(plist,/LSMinimumSystemVersion/);
    assert.match(macInfoPlist('version<&'),/version&lt;&amp;/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
