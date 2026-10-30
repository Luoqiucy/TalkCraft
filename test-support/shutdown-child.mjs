import {createServer} from 'node:http';
import {installServerShutdown} from '../src/server-shutdown.mjs';
const server=createServer((req,res)=>res.end('ready'));
installServerShutdown(server);
server.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
