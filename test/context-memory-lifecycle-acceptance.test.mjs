import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersonalMemoryStore} from '../src/personal-memory.mjs';

const cases=[
  {
    "name": "直接问偏好的水果",
    "content": "我明确说喜欢香蕉",
    "query": "我平时吃哪些水果",
    "domain": "food.fruit"
  },
  {
    "name": "含“吃的水果”表达",
    "content": "我喜欢吃的水果是苹果",
    "query": "我平时喜欢什么水果",
    "domain": "food.fruit"
  },
  {
    "name": "偏好与类别问法",
    "content": "我喜欢草莓",
    "query": "我平时爱吃什么水果",
    "domain": "food.fruit"
  },
  {
    "name": "偶尔行为保留频率",
    "content": "我偶尔也吃葡萄",
    "query": "我平时吃哪些水果",
    "domain": "food.fruit"
  },
  {
    "name": "经常行为保留频率",
    "content": "我经常吃橙子",
    "query": "我通常吃什么水果",
    "domain": "food.fruit"
  },
  {
    "name": "否定偏好单独分类",
    "content": "我不喜欢榴莲",
    "query": "我喜欢什么水果",
    "domain": "food.fruit"
  },
  {
    "name": "偏好复数事实",
    "content": "我喜欢芒果和蓝莓",
    "query": "我喜欢什么水果",
    "domain": "food.fruit"
  },
  {
    "name": "晚些复述",
    "content": "我喜欢西瓜",
    "query": "我爱吃的水果是什么",
    "domain": "food.fruit"
  },
  {
    "name": "季节性提及",
    "content": "我有时吃桃子",
    "query": "我平时吃哪些水果",
    "domain": "food.fruit"
  },
  {
    "name": "不从偶尔推偏好",
    "content": "我偶尔吃梨",
    "query": "我平时吃哪些水果",
    "domain": "food.fruit"
  },
  {
    "name": "咖啡偏好",
    "content": "我喜欢喝咖啡",
    "query": "我平时喝什么饮品",
    "domain": "food.beverage"
  },
  {
    "name": "日常茶行为",
    "content": "我每天喝绿茶",
    "query": "我通常喝什么饮料",
    "domain": "food.beverage"
  },
  {
    "name": "奶茶偶尔行为",
    "content": "我偶尔喝奶茶",
    "query": "我平时喝哪些饮品",
    "domain": "food.beverage"
  },
  {
    "name": "牛奶偏好",
    "content": "我喜欢牛奶",
    "query": "我喜欢喝什么饮品",
    "domain": "food.beverage"
  },
  {
    "name": "豆浆频率",
    "content": "我通常喝豆浆",
    "query": "我经常喝什么饮料",
    "domain": "food.beverage"
  },
  {
    "name": "乌龙茶偏好",
    "content": "我喜欢乌龙茶",
    "query": "我的饮品偏好是什么",
    "domain": "food.beverage"
  },
  {
    "name": "果汁行为",
    "content": "我有时喝果汁",
    "query": "我平时喝哪些饮料",
    "domain": "food.beverage"
  },
  {
    "name": "饮料偏好复合句",
    "content": "我偏好气泡水",
    "query": "我喜欢喝什么饮品",
    "domain": "food.beverage"
  },
  {
    "name": "红茶频率",
    "content": "我经常喝红茶",
    "query": "我通常喝哪些饮品",
    "domain": "food.beverage"
  },
  {
    "name": "饮品限定",
    "content": "我偶尔喝可乐",
    "query": "我平时喝什么饮料",
    "domain": "food.beverage"
  },
  {
    "name": "简短回答",
    "content": "记住我喜欢简短回答",
    "query": "我喜欢什么回答风格",
    "domain": "communication.style"
  },
  {
    "name": "简洁回复",
    "content": "我希望回复简洁",
    "query": "我的回复偏好是什么",
    "domain": "communication.style"
  },
  {
    "name": "精简表达",
    "content": "以后回答尽量精简",
    "query": "我偏好的表达风格",
    "domain": "communication.style"
  },
  {
    "name": "详细回答",
    "content": "我喜欢详细回答",
    "query": "我喜欢什么回答风格",
    "domain": "communication.style"
  },
  {
    "name": "解释展开",
    "content": "请详细展开解释",
    "query": "我的回答风格偏好",
    "domain": "communication.style"
  },
  {
    "name": "简洁说明",
    "content": "回答请简洁一些",
    "query": "我喜欢怎么回答",
    "domain": "communication.style"
  },
  {
    "name": "短答案",
    "content": "我喜欢简短回复",
    "query": "我的回复风格",
    "domain": "communication.style"
  },
  {
    "name": "避免过度简化",
    "content": "我希望详细说明步骤",
    "query": "我的回答偏好",
    "domain": "communication.style"
  },
  {
    "name": "默认城市",
    "content": "默认城市是南京",
    "query": "我的默认地区是什么",
    "domain": "location.default"
  },
  {
    "name": "常住城市",
    "content": "我常住在苏州",
    "query": "我住在哪里",
    "domain": "location.default"
  },
  {
    "name": "默认区域",
    "content": "默认地区为张家港",
    "query": "我常用的地区",
    "domain": "location.default"
  },
  {
    "name": "所在地",
    "content": "我来自杭州",
    "query": "我的所在地是什么",
    "domain": "location.default"
  },
  {
    "name": "默认地点",
    "content": "默认地点是上海",
    "query": "我的默认城市",
    "domain": "location.default"
  },
  {
    "name": "城市偏好",
    "content": "默认城市设为成都",
    "query": "我设置的默认地区",
    "domain": "location.default"
  },
  {
    "name": "开发项目",
    "content": "我正在开发的项目是TalkCraft",
    "query": "我目前做什么项目",
    "domain": "work.project"
  },
  {
    "name": "项目名称",
    "content": "项目名称是TalkCraft",
    "query": "我的项目名称是什么",
    "domain": "work.project"
  },
  {
    "name": "负责项目",
    "content": "我负责的项目叫TalkCraft",
    "query": "我负责什么项目",
    "domain": "work.project"
  },
  {
    "name": "参与项目",
    "content": "我参与的项目为TalkCraft",
    "query": "我参与的项目背景",
    "domain": "work.project"
  },
  {
    "name": "目前项目",
    "content": "我目前开发的项目叫TalkCraft",
    "query": "我在做什么项目",
    "domain": "work.project"
  },
  {
    "name": "项目背景",
    "content": "我正在做的项目是TalkCraft",
    "query": "我的项目是什么",
    "domain": "work.project"
  },
  {
    "name": "专有词",
    "content": "专有词是TalkCraft",
    "query": "我的专有词是什么",
    "domain": "language.term"
  },
  {
    "name": "项目术语",
    "content": "术语叫TalkCraft",
    "query": "我的术语是什么",
    "domain": "language.term"
  },
  {
    "name": "个人词典条目",
    "content": "产品名为TalkCraft",
    "query": "个人词典里的产品名",
    "domain": "language.term"
  },
  {
    "name": "命名词条",
    "content": "项目名是TalkCraft",
    "query": "记住过的项目名是什么",
    "domain": "language.term"
  }
];
test('44条不同语义的记忆检索覆盖食物、饮品、表达风格、地区、项目与词条',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'talkcraft-memory-semantics-'));const store=createPersonalMemoryStore(join(dir,'memory.sqlite'));
 try{for(let index=0;index<cases.length;index++){const item=cases[index],owner=`account:semantic-${index}`,saved=store.add(owner,{type:item.domain==='work.project'?'project':item.domain==='language.term'?'term':item.domain==='communication.style'?'preference':'fact',content:item.content,reason:'用户明确确认并选择保存，仅用于测试检索相关性',confirmed:true});const resolved=store.relevant(owner,item.query);assert.equal(resolved.memoryIds[0],saved.memoryId,`${item.name}: 应命中该用户确认记忆`);assert.equal(resolved.scanned,1);assert.equal(resolved.memories[0].fact?.domain,item.domain,`${item.name}: 记忆类别应正确`);}}finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('类别问题只检索对应类别；无答案不泄漏其他领域记忆，也不把偶尔行为当偏好',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'talkcraft-memory-domain-'));const store=createPersonalMemoryStore(join(dir,'memory.sqlite'));
 try{const owner='guest:domain-test';store.add(owner,{type:'preference',content:'我喜欢喝咖啡',reason:'用户明确选择保存的饮品偏好',confirmed:true});store.add(owner,{type:'preference',content:'我喜欢简短回答',reason:'用户明确选择保存的表达偏好',confirmed:true});assert.deepEqual(store.relevant(owner,'我喜欢什么水果').memoryIds,[]);assert.deepEqual(store.relevant(owner,'我的项目背景').memoryIds,[]);assert.equal(store.relevant(owner,'我通常喝什么饮品').memories[0].fact.domain,'food.beverage');assert.equal(store.relevant(owner,'我偏好怎样回答').memories[0].fact.domain,'communication.style');const occasional='guest:occasional-only';store.add(occasional,{type:'fact',content:'我偶尔吃梨',reason:'用户明确确认偶尔行为',confirmed:true});assert.deepEqual(store.relevant(occasional,'我喜欢什么水果').memoryIds,[]);}finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('真正关闭数据库进程后，记忆和未完成同步操作可恢复且操作ID幂等',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'talkcraft-memory-process-restart-'));
 const path=join(dir,'memory.sqlite'),owner='account:restart-test';
 let store=createPersonalMemoryStore(path);
 try{
  const saved=store.add(owner,{type:'preference',content:'我喜欢简短回答',reason:'用户在隔离验收中明确确认',confirmed:true,syncSelected:true});
  store.settings(owner,{syncEnabled:true});
  const first=store.pending(owner)[0];
  assert.ok(first?.operationId);
  store.close();store=null;
  const script=`import {createPersonalMemoryStore} from ${JSON.stringify(new URL('../src/personal-memory.mjs',import.meta.url).href)};const s=createPersonalMemoryStore(process.argv[1]);const owner=process.argv[2];const r=s.relevant(owner,'我的回答风格偏好');const p=s.pending(owner);console.log(JSON.stringify({memoryIds:r.memoryIds,scanned:r.scanned,operationId:p[0]?.operationId,content:r.memories[0]?.content}));s.close();`;
  const child=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script,path,owner],{encoding:'utf8'}));
  assert.deepEqual(child.memoryIds,[saved.memoryId]);
  assert.equal(child.scanned,1);
  assert.equal(child.content,'我喜欢简短回答');
  assert.equal(child.operationId,first.operationId,'远端暂时不可用后重试必须复用原操作ID');
  store=createPersonalMemoryStore(path);
  assert.equal(store.acknowledge(owner,child.operationId,1),true);
  assert.deepEqual(store.pending(owner),[]);
 }finally{store?.close();await rm(dir,{recursive:true,force:true});}
});
