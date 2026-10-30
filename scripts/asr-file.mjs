import {createServer} from '../server.mjs';
import {providersFromConfigPath} from '../src/file-config.mjs';
import {installServerShutdown} from '../src/server-shutdown.mjs';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
try {
  const port=process.argv.length===2 ? 4318 : process.argv.length===4 && process.argv[2]==='--port' && ['4317','4318'].includes(process.argv[3]) ? Number(process.argv[3]) : undefined;
  if(!port)throw new Error('启动端口无效');
  const token=randomUUID();let shutdown;
  const server=createServer({...await providersFromConfigPath(new URL('../.local/asr-test.env',import.meta.url)),shutdownToken:token,onDesktopExit:()=>shutdown.stop().then(()=>{if(process.connected)process.disconnect();process.exit(0);})});
  shutdown=installServerShutdown(server);
  server.once('listening',async()=>{if(port===4317){try{await mkdir(new URL('../.local/',import.meta.url),{recursive:true});await writeFile(new URL('../.local/desktop-service.json',import.meta.url),JSON.stringify({port,token}),{mode:0o600});}catch{console.error('后台退出控制信息写入失败');}}});
  server.on('error',()=>{console.error(`测试服务启动失败，请检查${port}端口是否已占用`);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{console.log(`TalkCraft：http://127.0.0.1:${port}；可在系统设置中配置文字模型`);if(process.connected)process.send({type:'talkcraft:ready'});});
} catch {
  console.error('读取服务配置失败，请检查 .local/asr-test.env 的提供器、凭据与模型配置');process.exitCode=1;
}
