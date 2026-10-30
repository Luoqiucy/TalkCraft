import {fileURLToPath} from 'node:url';
import {isAbsolute,join} from 'node:path';

// Bundled desktop apps keep mutable state outside their read-only resources.
// Existing source/Windows launches retain the established .local location.
export function runtimeStatePath(name,{env=process.env,projectRoot=fileURLToPath(new URL('../',import.meta.url))}={}){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))throw new Error('运行配置文件名无效');
  const directory=env.TALKCRAFT_DATA_DIR;
  if(directory!==undefined&&(!directory||!isAbsolute(directory)))throw new Error('运行数据目录必须为绝对路径');
  return join(directory||join(projectRoot,'.local'),name);
}
