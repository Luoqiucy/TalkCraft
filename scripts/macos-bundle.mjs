import {cp,copyFile,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';

const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
export function macInfoPlist(version){
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>TalkCraft</string>
<key>CFBundleDisplayName</key><string>TalkCraft 开发版</string>
<key>CFBundleExecutable</key><string>TalkCraft</string>
<key>CFBundleIdentifier</key><string>dev.wirelessaimic.prototype</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${xml(version)}</string>
<key>CFBundleVersion</key><string>${xml(version)}</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>TalkCraft 仅在你主动录音时使用麦克风，将语音转换为文字。</string>
<key>NSLocationWhenInUseUsageDescription</key><string>仅在你允许后使用近似位置查询当地天气，也可手动输入城市。</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>\n`;
}

// An explicit source allowlist prevents .local, reports, tests and credentials
// from accidentally becoming resources in the downloaded app.
export async function assembleMacBundle({root,output,nodeBinary,rustBinary}){
  const app=join(output,'TalkCraft.app'),contents=join(app,'Contents');
  await access(rustBinary);await access(nodeBinary);
  await access(join(root,'public/react/index.html'));
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  for(const dir of ['MacOS','Resources/backend','Resources/node/bin'])await mkdir(join(contents,dir),{recursive:true});
  await copyFile(rustBinary,join(contents,'MacOS/TalkCraft'));
  await copyFile(nodeBinary,join(contents,'Resources/node/bin/node'));
  await copyFile(join(root,'src-tauri/icons/icon.icns'),join(contents,'Resources/icon.icns'));
  await writeFile(join(contents,'Info.plist'),macInfoPlist(manifest.version));
  await writeFile(join(contents,'PkgInfo'),'APPL????');
  const backend=join(contents,'Resources/backend');
  for(const name of ['server.mjs','package.json','package-lock.json'])await copyFile(join(root,name),join(backend,name));
  for(const name of ['src','public'])await cp(join(root,name),join(backend,name),{recursive:true});
  await mkdir(join(backend,'scripts'),{recursive:true});
  for(const name of ['asr-file.mjs','text-model-config.mjs'])await copyFile(join(root,'scripts',name),join(backend,'scripts',name));
  return {app,backend,executable:join(contents,'MacOS/TalkCraft'),node:join(contents,'Resources/node/bin/node')};
}
