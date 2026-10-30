import {resolve,delimiter} from 'node:path';
export function toolingEnvironment(root,base=process.env,useLocal=false) {
  const env={...base};
  if(useLocal) {
    env.CARGO_HOME=resolve(root,'.tools/cargo');env.RUSTUP_HOME=resolve(root,'.tools/rustup');
    const pathKey=Object.keys(env).find(key => key.toLowerCase()==='path') || 'PATH';
    env[pathKey]=resolve(root,'.tools/cargo/bin')+(env[pathKey] ? delimiter+env[pathKey] : '');
  }
  return env;
}
