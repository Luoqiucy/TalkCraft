import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {providersFromConfigPath} from '../src/file-config.mjs';
test('首次启动无配置可使用模拟文字与关闭ASR，不写配置文件',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'talkcraft-first-'));
 try{const path=join(dir,'missing.env'),providers=await providersFromConfigPath(path);assert.equal(providers.provider.simulated,true);assert.equal(providers.asr.enabled,false);assert.equal(providers.agentEngine,'legacy');await assert.rejects(access(path));}
 finally{await rm(dir,{recursive:true,force:true});}
});
test('已有无效配置拒绝启动，不静默降级；有效本机模型正常读取',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'talkcraft-config-'));
 try{const path=join(dir,'config.env');await writeFile(path,'TEXT_PROVIDER=deepseek\n');await assert.rejects(providersFromConfigPath(path));await writeFile(path,'TEXT_PROVIDER=ollama\nOLLAMA_MODEL=test-model\nTALKCRAFT_AGENT_ENGINE=langgraph\n');const result=await providersFromConfigPath(path);assert.equal(result.provider.local,true);assert.equal(result.provider.simulated,false);assert.equal(result.agentEngine,'langgraph');await assert.rejects(providersFromConfigPath(dir));}
 finally{await rm(dir,{recursive:true,force:true});}
});
