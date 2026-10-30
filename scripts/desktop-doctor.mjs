import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolingEnvironment} from './tooling-env.mjs';
const exec=promisify(execFile);
export function assessDesktop(platform, checks,{visualStudioRebootRequired=false}={}) {
  const required=platform==='win32' ? ['cargo','rustc','msvc','msvcRuntime','windowsSdkRuntime','webview2'] : platform==='darwin' ? ['cargo','rustc','xcode'] : ['supportedPlatform'];
  const rebootRequired=platform==='win32'&&visualStudioRebootRequired===true;
  const missing=required.filter(key=>!checks[key]&&!(rebootRequired&&['msvc','msvcRuntime'].includes(key)));
  return {platform,ready:required.every(key => checks[key])&&!rebootRequired,checks,missing,rebootRequired,blockedBy:[...missing,...(rebootRequired?['visualStudioRebootRequired']:[])],nextAction:rebootRequired?'Visual Studio修复需要重启电脑；保存工作并手动重启后重新检查，无需重复安装组件。':null,productionReady:false};
}
export function visualStudioNeedsReboot(json) {
  try{const instances=JSON.parse(json);return Array.isArray(instances)&&instances.some(instance=>instance?.isRebootRequired===true);}catch{return false;}
}
export function hasWindowsSdkRuntime(kitsLibRoot) {
  try{return readdirSync(kitsLibRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()).some(entry=>existsSync(resolve(kitsLibRoot,entry.name,'ucrt/x64/ucrt.lib'))&&existsSync(resolve(kitsLibRoot,entry.name,'um/x64/kernel32.lib')));}catch{return false;}
}
async function command(binary,args=[],env=process.env) {
  try {const {stdout}=await exec(binary,args,{timeout:10000,windowsHide:true,env});return stdout.trim();} catch {return '';}
}
export async function probeDesktop() {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const localCargo=resolve(root,'.tools/cargo/bin/cargo.exe'),localRust=resolve(root,'.tools/cargo/bin/rustc.exe');
  const env=toolingEnvironment(root,process.env,existsSync(localCargo));
  const checks={cargo:!!await command(existsSync(localCargo) ? localCargo : 'cargo',['--version'],env),rustc:!!await command(existsSync(localRust) ? localRust : 'rustc',['--version'],env)};
  let visualStudioRebootRequired=false;
  if(process.platform==='win32') {
    const installation=await command('C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath']);
    checks.msvc=!!installation;
    if(!installation)visualStudioRebootRequired=visualStudioNeedsReboot(await command('C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',['-all','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-format','json']));
    const version=installation ? await command('powershell.exe',['-NoProfile','-Command',`Get-Content -LiteralPath '${installation.replaceAll("'","''")}\\VC\\Auxiliary\\Build\\Microsoft.VCToolsVersion.default.txt' -ErrorAction SilentlyContinue`]) : '';
    checks.msvcRuntime=!!version && ['libcmt.lib','msvcrt.lib'].every(name=>existsSync(resolve(installation,'VC/Tools/MSVC',version,'lib/x64',name)));
    checks.windowsSdkRuntime=hasWindowsSdkRuntime('C:/Program Files (x86)/Windows Kits/10/Lib');
    checks.webview2=!!await command('powershell.exe',['-NoProfile','-Command',"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\*','HKCU:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\*' -ErrorAction SilentlyContinue | Where-Object { $_.name -match 'WebView2' } | Select-Object -ExpandProperty pv"]);
  } else if(process.platform==='darwin') checks.xcode=!!await command('xcode-select',['-p']);
  return assessDesktop(process.platform,checks,{visualStudioRebootRequired});
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  const report=await probeDesktop();console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=1;
}
