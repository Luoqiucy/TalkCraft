// Keeps the app version identical everywhere it is declared and reads release notes
// from CHANGELOG.md, so a tag, the desktop build and the release page always agree.
//   node scripts/release-version.mjs check [vX.Y.Z]   verify all files (and the tag)
//   node scripts/release-version.mjs set X.Y.Z        update every version field
//   node scripts/release-version.mjs notes X.Y.Z      print that CHANGELOG section
import {readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const semver=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const read=(root,path)=>readFileSync(join(root,path),'utf8');
// Rewrite with the file's own line endings so a version bump is a one-line diff.
const write=(root,path,text,original)=>writeFileSync(join(root,path),/\r\n/.test(original)?text.replace(/\r?\n/g,'\r\n'):text);
const tomlPackageVersion=text=>text.match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms)?.[1];
const lockPackageVersion=(text,name)=>text.match(new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`))?.[1];
const CARGO_PACKAGES=[['src-tauri/Cargo.toml','wireless-ai-mic'],['src-tauri/keyboard-hook/Cargo.toml','talkcraft-keyboard-hook']];

export function readVersions(root){
  const lock=JSON.parse(read(root,'package-lock.json')),cargoLock=read(root,'src-tauri/Cargo.lock');
  const versions={
    'package.json':JSON.parse(read(root,'package.json')).version,
    'package-lock.json':lock.version,
    'package-lock.json packages[""]':lock.packages?.['']?.version,
    'src-tauri/tauri.conf.json':JSON.parse(read(root,'src-tauri/tauri.conf.json')).version,
  };
  for(const [path,name] of CARGO_PACKAGES){versions[path]=tomlPackageVersion(read(root,path));versions[`src-tauri/Cargo.lock ${name}`]=lockPackageVersion(cargoLock,name);}
  return versions;
}

export function checkVersions(root,tag){
  const versions=readVersions(root),values=[...new Set(Object.values(versions))],problems=[];
  if(values.length!==1)problems.push(`版本号不一致：${JSON.stringify(versions)}`);
  const version=values[0];
  if(values.length===1&&!semver.test(version||''))problems.push(`版本号不是 SemVer：${version}`);
  if(tag&&tag!==`v${version}`)problems.push(`标签 ${tag} 与文件版本 v${version} 不一致`);
  if(tag&&!changelogSection(read(root,'CHANGELOG.md'),version))problems.push(`CHANGELOG.md 缺少 [${version}] 小节`);
  return {version,versions,problems};
}

export function setVersion(root,version){
  if(!semver.test(version))throw new Error(`版本号必须是 X.Y.Z：${version}`);
  // Each pattern must match; matching the current value again is fine, so the
  // command can be re-run safely.
  const update=(path,patterns)=>{const original=read(root,path);let text=original.replace(/\r\n/g,'\n');for(const pattern of patterns){if(!pattern.test(text))throw new Error(`${path} 未找到版本字段`);text=text.replace(pattern,`$1${version}$2`);}write(root,path,text,original);};
  update('package.json',[/^(\s*"version":\s*")[^"]+(")/m]);
  // Only the two root entries; dependency versions further down stay untouched.
  update('package-lock.json',[/^(\{\s*"name":\s*"[^"]+",\s*"version":\s*")[^"]+(")/,/("packages":\s*\{\s*"":\s*\{\s*"name":\s*"[^"]+",\s*"version":\s*")[^"]+(")/]);
  update('src-tauri/tauri.conf.json',[/^(\s*"version":\s*")[^"]+(")/m]);
  for(const [path,name] of CARGO_PACKAGES){
    update(path,[/^(\[package\][^[]*?^version\s*=\s*")[^"]+(")/ms]);
    update('src-tauri/Cargo.lock',[new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")[^"]+(")`)]);
  }
  return readVersions(root);
}

export function changelogSection(changelog,version){
  const lines=String(changelog||'').replace(/\r\n/g,'\n').split('\n'),escaped=version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const start=lines.findIndex(line=>new RegExp(`^## \\[${escaped}\\]`).test(line));if(start<0)return '';
  const end=lines.findIndex((line,index)=>index>start&&/^## \[|^\[[^\]]+\]:\s/.test(line));
  return lines.slice(start+1,end<0?undefined:end).join('\n').trim();
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const root=join(dirname(fileURLToPath(import.meta.url)),'..'),[command,value]=process.argv.slice(2);
  if(command==='check'){const {version,problems}=checkVersions(root,value);if(problems.length){for(const problem of problems)console.error(problem);process.exit(1);}console.log(`版本一致：${version}`);}
  else if(command==='set'){const versions=setVersion(root,value);console.log(JSON.stringify(versions,null,2));}
  else if(command==='notes'){const notes=changelogSection(read(root,'CHANGELOG.md'),String(value||'').replace(/^v/,''));if(!notes){console.error(`CHANGELOG.md 缺少 [${value}] 小节`);process.exit(1);}console.log(notes);}
  else{console.error('用法：node scripts/release-version.mjs check [vX.Y.Z] | set X.Y.Z | notes X.Y.Z');process.exit(2);}
}
