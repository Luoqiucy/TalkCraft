import {execFileSync,spawn} from 'node:child_process';
import {mkdir,mkdtemp,chmod,copyFile,readFile,writeFile,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {assembleMacBundle} from './macos-bundle.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const run=(command,args,options={})=>execFileSync(command,args,{cwd:root,stdio:'inherit',...options});

async function waitForService(child,port){
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
    if(child.exitCode!==null||child.signalCode)throw new Error('开发版启动测试进程已退出');
    try{const response=await fetch(`http://127.0.0.1:${port}/api/status`,{signal:AbortSignal.timeout(500)});if(response.ok&&(await response.json()).desktopService===true)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw new Error('开发版后台启动测试超时');
}

async function smokeBundle(bundle,stage){
  // The GUI smoke run owns an isolated HOME. It never uses the runner's account
  // data, calls suppliers or records audio. Only this spawned test app is stopped.
  const home=join(stage,'smoke-home');await mkdir(home,{recursive:true});
  const child=spawn(bundle.executable,[],{cwd:stage,env:{...process.env,HOME:home},stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4000);});
  let spawnError;child.on('error',error=>{spawnError=error;});
  const closed=new Promise(resolve=>child.once('close',resolve));
  try{
    await waitForService(child,4317);
    if(spawnError)throw spawnError;
    const page=await fetch('http://127.0.0.1:4317/react/',{signal:AbortSignal.timeout(2000)});
    if(!page.ok||!(await page.text()).includes('id="root"'))throw new Error('工作台资源未正常加载');
    const preferences=await fetch('http://127.0.0.1:4317/api/user-preferences',{signal:AbortSignal.timeout(2000)});
    if(!preferences.ok)throw new Error('本机设置接口无法读取');
    await access(join(home,'Library/Application Support/TalkCraft/runtime/desktop-service.json'));
    console.log('Native Mac development app stayed running; backend, React page and preferences HTTP smoke passed. No microphone or external provider was used.');
  }catch(error){
    console.error('Native smoke test failed:',error.message);
    // Only log code/runtime errors in this isolated configuration, never secrets.
    if(stderr)console.error(stderr);
    throw error;
  }finally{
    try{
      const control=JSON.parse(await readFile(join(home,'Library/Application Support/TalkCraft/runtime/desktop-service.json'),'utf8'));
      await fetch('http://127.0.0.1:4317/api/desktop-exit',{method:'POST',headers:{'X-TalkCraft-Control':control.token},signal:AbortSignal.timeout(1000)});
    }catch{}
    if(child.exitCode===null&&!child.signalCode)child.kill('SIGTERM');
    await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,3000))]);
  }
}

async function main(){
  if(process.platform!=='darwin')throw new Error('Mac开发版必须在macOS或GitHub macOS runner中构建，不能在Windows假打包。');
  if(!['arm64','x64'].includes(process.arch))throw new Error('不支持的Mac架构');
  const env={...process.env,TAURI_CONFIG:await readFile(join(root,'src-tauri/tauri.macos.conf.json'),'utf8'),MACOSX_DEPLOYMENT_TARGET:'14.0'};
  run('npm',['run','react:check']);run('npm',['run','react:build']);
  run('cargo',['test','--locked','--manifest-path','src-tauri/Cargo.toml','--profile','mac-dev','--bin','talkcraft-desktop'],{env});
  run('cargo',['build','--locked','--manifest-path','src-tauri/Cargo.toml','--profile','mac-dev','--bin','talkcraft-desktop'],{env});
  await mkdir(join(root,'dist'),{recursive:true});
  const stage=await mkdtemp(join(root,'dist','mac-dev-stage-'));
  const bundle=await assembleMacBundle({root,output:stage,nodeBinary:process.execPath,rustBinary:join(root,'src-tauri/target/mac-dev/talkcraft-desktop')});
  await copyFile(join(dirname(process.execPath),'../LICENSE'),join(bundle.app,'Contents/Resources/node/LICENSE'));
  await copyFile(join(root,'docs/MACOS-DEVELOPMENT.md'),join(bundle.app,'Contents/Resources/README-macOS.md'));
  await chmod(bundle.node,0o755);await chmod(bundle.executable,0o755);
  run('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:bundle.backend,env:{...process.env,ELECTRON_SKIP_BINARY_DOWNLOAD:'1'}});
  run('/usr/bin/plutil',['-lint',join(bundle.app,'Contents/Info.plist')]);
  run('/usr/bin/codesign',['--force','--sign','-',bundle.node]);
  run('/usr/bin/codesign',['--force','--deep','--sign','-',bundle.app]);
  run('/usr/bin/codesign',['--verify','--deep','--strict',bundle.app]);
  // Detect the architecture of both Mach-O binaries, not just the archive name.
  const expected=process.arch==='arm64'?'arm64':'x86_64';
  for(const binary of [bundle.executable,bundle.node]){
    const architecture=execFileSync('/usr/bin/lipo',['-archs',binary],{encoding:'utf8'}).trim();
    if(architecture!==expected)throw new Error('应用与Node运行时的架构不一致');
  }
  await smokeBundle(bundle,stage);
  const label=process.arch==='arm64'?'AppleSilicon':'Intel';
  const archive=join(root,'dist',`TalkCraft-macOS-${label}-dev.zip`);
  run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',bundle.app,archive]);
  const digest=createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`,`${digest}  TalkCraft-macOS-${label}-dev.zip\n`);
  console.log(`Mac开发版：${archive}`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
