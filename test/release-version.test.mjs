import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {changelogSection,checkVersions,readVersions,setVersion} from '../scripts/release-version.mjs';

const FILES=['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/keyboard-hook/Cargo.toml','src-tauri/Cargo.lock','CHANGELOG.md'];
async function copyProject(t){
 const root=await mkdtemp(join(tmpdir(),'talkcraft-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'src-tauri/keyboard-hook'),{recursive:true});
 for(const file of FILES)await cp(new URL(`../${file}`,import.meta.url),join(root,file));
 return root;
}

test('仓库内所有版本字段一致，且当前版本在 CHANGELOG 中有小节',async()=>{
 const {fileURLToPath}=await import('node:url');const root=fileURLToPath(new URL('..',import.meta.url));
 const {version,problems}=checkVersions(root,`v${readVersions(root)['package.json']}`);assert.deepEqual(problems,[]);
 assert.ok(changelogSection(await readFile(join(root,'CHANGELOG.md'),'utf8'),version).length>0);
});

test('set 只改各文件的本项目版本，不动依赖版本，可重复执行',async t=>{
 const root=await copyProject(t);
 const lockBefore=await readFile(join(root,'package-lock.json'),'utf8'),cargoBefore=await readFile(join(root,'src-tauri/Cargo.lock'),'utf8');
 const versions=setVersion(root,'9.8.7');assert.deepEqual([...new Set(Object.values(versions))],['9.8.7']);
 setVersion(root,'9.8.7');
 const lockAfter=await readFile(join(root,'package-lock.json'),'utf8'),cargoAfter=await readFile(join(root,'src-tauri/Cargo.lock'),'utf8');
 const changed=(a,b)=>a.split('\n').filter((line,index)=>line!==b.split('\n')[index]).length;
 assert.equal(changed(lockBefore,lockAfter),2);assert.equal(changed(cargoBefore,cargoAfter),2);
 assert.throws(()=>setVersion(root,'v1.0'),/X\.Y\.Z/);
});

test('标签与文件版本或 CHANGELOG 不符时 check 报错',async t=>{
 const root=await copyProject(t);setVersion(root,'3.0.0');
 await writeFile(join(root,'CHANGELOG.md'),'# 更新日志\n\n## [Unreleased]\n\n## [3.0.0] - 2026-11-06\n\n### 修复\n- 示例修复\n\n## [2.0.0] - 2026-10-01\n\n- 旧版本\n\n[3.0.0]: https://example.com\n');
 assert.deepEqual(checkVersions(root,'v3.0.0').problems,[]);
 assert.match(checkVersions(root,'v3.0.1').problems.join(),/不一致/);
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));pkg.version='3.0.1';await writeFile(join(root,'package.json'),JSON.stringify(pkg,null,2));
 assert.match(checkVersions(root).problems.join(),/版本号不一致/);
 assert.equal(readVersions(root)['package.json'],'3.0.1');
});

test('notes 只取指定版本的小节，不带下一版本或链接定义',()=>{
 const changelog='# 更新日志\r\n\r\n## [Unreleased]\r\n\r\n## [0.2.0] - 2026-11-06\r\n\r\n### 新增\r\n- 实时流式\r\n\r\n## [0.1.0] - 2026-10-31\r\n\r\n- 基线\r\n\r\n[0.2.0]: https://github.com/x/y/compare/v0.1.0...v0.2.0\r\n';
 assert.equal(changelogSection(changelog,'0.2.0'),'### 新增\n- 实时流式');assert.equal(changelogSection(changelog,'0.1.0'),'- 基线');assert.equal(changelogSection(changelog,'9.9.9'),'');
});
