import {createServer} from 'node:http';
import {installServerShutdown} from '../src/server-shutdown.mjs';
if(process.argv[2]==='fail')process.exit(1);
const server=createServer();installServerShutdown(server);
server.listen(0,'127.0.0.1',()=>{if(process.argv[2]!=='hang')process.send({type:'talkcraft:ready'});});
if(process.argv[2]==='crash')setTimeout(()=>process.exit(2),200);
