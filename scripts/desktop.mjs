import {spawn} from 'node:child_process';
import {probeDesktop} from './desktop-doctor.mjs';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {toolingEnvironment} from './tooling-env.mjs';
import {desktopExitCode} from './desktop-exit.mjs';
import {runDesktopSession} from './desktop-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const report=await probeDesktop();
if(!report.ready) {console.error(report.nextAction||`桌面构建条件不足：${report.missing.join(', ')}。详见 docs/DESKTOP.md。`);process.exitCode=1;}
else {
  const env=toolingEnvironment(root,process.env,existsSync(resolve(root,'.tools/cargo/bin/cargo.exe')));
  try {
    process.exitCode=await runDesktopSession(new URL('./asr-file.mjs',import.meta.url),{args:['--port','4317'],cwd:root,env},signal=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js',import.meta.url)),'dev'],{stdio:'inherit',windowsHide:true,cwd:root,env});
      child.once('error',()=>reject(new Error('无法启动Tauri CLI，请安装项目依赖。')));
      const stop=()=>child.kill();signal.addEventListener('abort',stop,{once:true});
      child.once('exit',(code,exitSignal)=>{signal.removeEventListener('abort',stop);resolve(desktopExitCode(code,exitSignal));});
    }));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
