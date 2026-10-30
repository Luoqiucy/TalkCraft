import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessDesktop,hasWindowsSdkRuntime,visualStudioNeedsReboot} from '../scripts/desktop-doctor.mjs';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {toolingEnvironment} from '../scripts/tooling-env.mjs';
import {resolve} from 'node:path';
import {desktopExitCode} from '../scripts/desktop-exit.mjs';
test('桌面进程信号退出或缺退出码不得误报成功',()=>{
  assert.equal(desktopExitCode(0,null),0);assert.equal(desktopExitCode(7,null),7);
  assert.equal(desktopExitCode(null,'SIGTERM'),1);assert.equal(desktopExitCode(null,'SIGINT'),1);
  assert.equal(desktopExitCode(null,null),1);assert.equal(desktopExitCode(undefined,undefined),1);
});
test('Windows完整开发环境仍不能宣称生产可用',() => {
  const report=assessDesktop('win32',{cargo:true,rustc:true,msvc:true,msvcRuntime:true,windowsSdkRuntime:true,webview2:true});assert.equal(report.ready,true);assert.equal(report.productionReady,false);
});

test('Visual Studio待重启不误报组件缺失或允许原生启动',()=>{
  assert.equal(visualStudioNeedsReboot('[{"isRebootRequired":true}]'),true);
  for(const json of ['bad JSON','{}','[{"isRebootRequired":"true"}]','[{"isRebootRequired":false}]'])assert.equal(visualStudioNeedsReboot(json),false);
  const report=assessDesktop('win32',{cargo:true,rustc:true,msvc:false,msvcRuntime:false,windowsSdkRuntime:true,webview2:true},{visualStudioRebootRequired:true});
  assert.equal(report.ready,false);assert.deepEqual(report.missing,[]);assert.deepEqual(report.blockedBy,['visualStudioRebootRequired']);assert.match(report.nextAction,/手动重启/);
});
test('项目Rust环境传递到子进程，不修改原环境或产生重复Path键',() => {
  const original={Path:'existing-bin',OTHER:'keep'};const env=toolingEnvironment(process.cwd(),original,true);
  assert.equal(original.Path,'existing-bin');assert.equal(original.CARGO_HOME,undefined);
  assert.equal(env.CARGO_HOME,resolve(process.cwd(),'.tools/cargo'));assert.equal(env.RUSTUP_HOME,resolve(process.cwd(),'.tools/rustup'));
  assert.ok(env.Path.endsWith('existing-bin'));assert.equal(env.PATH,undefined);assert.equal(env.OTHER,'keep');
  assert.deepEqual(toolingEnvironment(process.cwd(),original,false),original);
});
test('缺Rust/MSVC或WebView时明确指出，Mac单独要求Xcode',() => {
  assert.deepEqual(assessDesktop('win32',{msvc:true,msvcRuntime:true,windowsSdkRuntime:true,webview2:true}).missing,['cargo','rustc']);
  assert.deepEqual(assessDesktop('win32',{cargo:true,rustc:true,msvc:true,webview2:true}).missing,['msvcRuntime','windowsSdkRuntime']);
  assert.equal(assessDesktop('win32',{cargo:true,rustc:true,msvc:true}).ready,false);
  assert.deepEqual(assessDesktop('darwin',{cargo:true,rustc:true}).missing,['xcode']);
  assert.equal(assessDesktop('linux',{}).ready,false);
});
test('Windows SDK运行库检查支持版本目录并安全处理缺失路径',async()=>{
  const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const dir=await mkdtemp(resolve(tmpdir(),'talkcraft-sdk-'));
  try{assert.equal(hasWindowsSdkRuntime(resolve(dir,'missing')),false);await mkdir(resolve(dir,'10.0.1/ucrt/x64'),{recursive:true});assert.equal(hasWindowsSdkRuntime(dir),false);await writeFile(resolve(dir,'10.0.1/ucrt/x64/ucrt.lib'),'fixture');assert.equal(hasWindowsSdkRuntime(dir),false);await mkdir(resolve(dir,'10.0.1/um/x64'),{recursive:true});await writeFile(resolve(dir,'10.0.1/um/x64/kernel32.lib'),'fixture');assert.equal(hasWindowsSdkRuntime(dir),true);}finally{await rm(dir,{recursive:true,force:true});}
});

test('旧SDK补装脚本改为明确的手动MSVC修复指引',async()=>{
  const repair=await readFile(new URL('../scripts/repair-desktop.ps1',import.meta.url),'utf8');
  assert.match(repair,/msvcrt\.lib/);
  assert.doesNotMatch(repair,/Start-Process|--add/);
});
test('生产构建实际失败，不能误产出仅有界面的安装包',async () => {
  const config=JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
  assert.equal(config.bundle.active,false);assert.equal(config.build.beforeBuildCommand,'node scripts/block-production.mjs');
  const result=spawnSync(process.execPath,['scripts/block-production.mjs'],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/正式构建已阻止/);
});
