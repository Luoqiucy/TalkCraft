import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {derivePersonalFact,memoryTerms,scorePersonalMemory} from '../agent/personal-facts.mjs';

const metrics = new Set(['asr_seconds', 'ai_characters']);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validNumber = value => Number.isSafeInteger(value) && value >= 0;
const sha256 = value => createHash('sha256').update(value).digest('hex');

export class CommercialStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'CommercialStoreError'; this.code = code; }
}
function requireValue(ok, code, message) { if (!ok) throw new CommercialStoreError(code, message); }

export function createCommercialStore(path) {
  requireValue(typeof path === 'string' && path.length > 0 && path !== ':memory:', 'INVALID_INPUT', '必须指定独立的服务端 SQLite 文件');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      expires_at INTEGER NOT NULL, revoked_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS usage_tasks (
      account_id TEXT NOT NULL REFERENCES accounts(id), task_id TEXT NOT NULL,
      metric TEXT NOT NULL, period_id TEXT NOT NULL, reserved INTEGER NOT NULL,
      actual INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
      created_at TEXT NOT NULL, finished_at TEXT,
      PRIMARY KEY(account_id, task_id, metric)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      task_id TEXT NOT NULL, metric TEXT NOT NULL, period_id TEXT NOT NULL,
      kind TEXT NOT NULL, quantity INTEGER NOT NULL, at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS usage_period_lookup ON usage_tasks(account_id,period_id,metric,state);
    CREATE TABLE IF NOT EXISTS server_memories(account_id TEXT NOT NULL REFERENCES accounts(id),memory_id TEXT NOT NULL,version INTEGER NOT NULL,type TEXT NOT NULL,content TEXT NOT NULL,reason TEXT NOT NULL,source_record_id TEXT,independent INTEGER NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,PRIMARY KEY(account_id,memory_id)) STRICT;
    CREATE TABLE IF NOT EXISTS memory_sync_ops(account_id TEXT NOT NULL REFERENCES accounts(id),operation_id TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(account_id,operation_id)) STRICT;
    CREATE TABLE IF NOT EXISTS memory_sync_cursors(account_id TEXT PRIMARY KEY REFERENCES accounts(id),next_sequence INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS memory_sync_changes(account_id TEXT NOT NULL REFERENCES accounts(id),sequence INTEGER NOT NULL,memory_id TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(account_id,sequence)) STRICT;
  `);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const at = () => new Date().toISOString();
  function createAccount(email, passwordHash) {
    requireValue(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 'INVALID_INPUT', '邮箱格式无效');
    const normalized = email.trim().toLowerCase();
    try {
      const id = randomUUID();
      db.prepare('INSERT INTO accounts(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(id, normalized, passwordHash, at());
      return { id, email: normalized };
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message)) throw new CommercialStoreError('ACCOUNT_EXISTS', '账号已存在');
      throw error;
    }
  }
  const accountByEmail = email => db.prepare('SELECT id,email,password_hash,status FROM accounts WHERE email=?').get(String(email).trim().toLowerCase());
  function createSession(accountId, token, expiresAt) {
    db.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').run(sha256(token), accountId, expiresAt);
  }
  function accountForToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare(`SELECT a.id,a.email,a.status FROM sessions s JOIN accounts a ON a.id=s.account_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.status='active'`).get(sha256(token), Date.now()) || null;
  }
  function revokeSession(token) { db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(Date.now(), sha256(token)); }
  function usage(accountId, periodId, metric, limit) {
    requireValue(validId(periodId) && metrics.has(metric) && validNumber(limit), 'INVALID_INPUT', '用量周期或限额无效');
    const row = db.prepare(`SELECT COALESCE(SUM(CASE WHEN state='settled' THEN actual ELSE 0 END),0) AS used,
      COALESCE(SUM(CASE WHEN state='reserved' THEN reserved ELSE 0 END),0) AS reserved
      FROM usage_tasks WHERE account_id=? AND period_id=? AND metric=?`).get(accountId, periodId, metric);
    return { periodId, metric, limit, used: row.used, reserved: row.reserved, remaining: Math.max(0, limit - row.used - row.reserved) };
  }
  const task = (accountId, taskId, metric) => db.prepare('SELECT * FROM usage_tasks WHERE account_id=? AND task_id=? AND metric=?').get(accountId, taskId, metric);
  function reserve({ accountId, taskId, metric, periodId, quantity, limit }) {
    requireValue(validId(taskId) && validId(periodId) && metrics.has(metric) && validNumber(quantity) && quantity > 0 && validNumber(limit), 'INVALID_INPUT', '预留参数无效');
    return transaction(() => {
      const previous = task(accountId, taskId, metric);
      // A cancelled task was refunded in full, so the user's retry may reserve it
      // again; reserved and settled tasks stay idempotent to avoid a second
      // provider call or a second charge.
      if (previous?.state === 'cancelled') {
        requireValue(usage(accountId, periodId, metric, limit).remaining >= quantity, 'QUOTA_EXCEEDED', '本期额度不足');
        const time = at();
        db.prepare("UPDATE usage_tasks SET period_id=?,reserved=?,actual=0,state='reserved',finished_at=NULL WHERE account_id=? AND task_id=? AND metric=?").run(periodId, quantity, accountId, taskId, metric);
        db.prepare('INSERT INTO usage_events(id,account_id,task_id,metric,period_id,kind,quantity,at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), accountId, taskId, metric, periodId, 'reserve', quantity, time);
        return { created: true, state: 'reserved', retried: true };
      }
      if (previous) {
        requireValue(previous.period_id === periodId && previous.reserved === quantity, 'IDEMPOTENCY_CONFLICT', '同一任务参数冲突');
        return { created: false, state: previous.state };
      }
      requireValue(usage(accountId, periodId, metric, limit).remaining >= quantity, 'QUOTA_EXCEEDED', '本期额度不足');
      const time = at();
      db.prepare('INSERT INTO usage_tasks(account_id,task_id,metric,period_id,reserved,state,created_at) VALUES(?,?,?,?,?,?,?)').run(accountId, taskId, metric, periodId, quantity, 'reserved', time);
      db.prepare('INSERT INTO usage_events(id,account_id,task_id,metric,period_id,kind,quantity,at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), accountId, taskId, metric, periodId, 'reserve', quantity, time);
      return { created: true, state: 'reserved' };
    });
  }
  function finish({ accountId, taskId, metric, actualQuantity, cancel = false }) {
    requireValue(validId(taskId) && metrics.has(metric) && (cancel || validNumber(actualQuantity)), 'INVALID_INPUT', '结算参数无效');
    return transaction(() => {
      const previous = task(accountId, taskId, metric);
      requireValue(previous, 'TASK_NOT_FOUND', '任务不存在');
      if (previous.state !== 'reserved') {
        if (previous.state === (cancel ? 'cancelled' : 'settled') && (cancel || previous.actual === actualQuantity)) return { changed: false, state: previous.state };
        throw new CommercialStoreError('TASK_FINISHED', '任务已结束，不能再次结算或退回');
      }
      requireValue(cancel || actualQuantity <= previous.reserved, 'RESERVATION_EXCEEDED', '实际用量超过预留');
      const time = at(), state = cancel ? 'cancelled' : 'settled', actual = cancel ? 0 : actualQuantity;
      db.prepare('UPDATE usage_tasks SET state=?,actual=?,finished_at=? WHERE account_id=? AND task_id=? AND metric=?').run(state, actual, time, accountId, taskId, metric);
      db.prepare('INSERT INTO usage_events(id,account_id,task_id,metric,period_id,kind,quantity,at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), accountId, taskId, metric, previous.period_id, state, actual, time);
      return { changed: true, state, actual, released: previous.reserved - actual };
    });
  }
  function syncMemories(accountId,{cursor=0,operations=[]}={}){
    requireValue(validId(accountId)&&validNumber(cursor)&&Array.isArray(operations)&&operations.length<=50,'INVALID_INPUT','记忆同步参数无效');
    const allowedTypes=new Set(['preference','fact','project','term']);
    return transaction(()=>{
      const accepted=[],conflicts=[];db.prepare('INSERT OR IGNORE INTO memory_sync_cursors(account_id,next_sequence) VALUES(?,1)').run(accountId);
      for(const op of operations){
        requireValue(op&&typeof op==='object'&&validId(op.memoryId)&&validId(op.operationId)&&Number.isSafeInteger(op.baseVersion)&&op.baseVersion>=0,'INVALID_INPUT','记忆同步操作无效');
        const previous=db.prepare('SELECT result_json FROM memory_sync_ops WHERE account_id=? AND operation_id=?').get(accountId,op.operationId);if(previous){accepted.push({...JSON.parse(previous.result_json),duplicate:true});continue;}
        const current=db.prepare('SELECT * FROM server_memories WHERE account_id=? AND memory_id=?').get(accountId,op.memoryId);
        const incomingDeleted=op.deleted===true;
        if(current&&(current.version!==op.baseVersion||current.status==='deleted'&&!incomingDeleted)||!current&&op.baseVersion!==0){conflicts.push({memoryId:op.memoryId,reason:current?.status==='deleted'?'server-deleted':'version-conflict',server:current?{memoryId:current.memory_id,version:current.version,type:current.type,content:current.content,reason:current.reason,sourceRecordId:current.source_record_id,independent:current.independent===1,status:current.status,updatedAt:current.updated_at,deletedAt:current.deleted_at}:null});continue;}
        requireValue(incomingDeleted||allowedTypes.has(op.type)&&typeof op.content==='string'&&op.content.trim().length>0&&op.content.length<=2000&&typeof op.reason==='string'&&op.reason.trim().length>0&&op.reason.length<=1000,'INVALID_INPUT','记忆内容或类型无效');
        const version=(current?.version||0)+1,at=new Date().toISOString(),status=incomingDeleted?'deleted':op.status==='paused'?'paused':'active',deletedAt=incomingDeleted?at:null;
        const row={memoryId:op.memoryId,version,type:incomingDeleted?current?.type||'fact':op.type,content:incomingDeleted?current?.content||'':op.content.trim(),reason:incomingDeleted?current?.reason||'':op.reason.trim(),sourceRecordId:incomingDeleted?current?.source_record_id||null:typeof op.sourceRecordId==='string'?op.sourceRecordId.slice(0,100):null,independent:incomingDeleted?current?.independent===1:op.independent===true,status,updatedAt:at,deletedAt};
        db.prepare(`INSERT INTO server_memories(account_id,memory_id,version,type,content,reason,source_record_id,independent,status,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,memory_id) DO UPDATE SET version=excluded.version,type=excluded.type,content=excluded.content,reason=excluded.reason,source_record_id=excluded.source_record_id,independent=excluded.independent,status=excluded.status,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`).run(accountId,op.memoryId,version,row.type,row.content,row.reason,row.sourceRecordId,row.independent?1:0,status,at,deletedAt);
        const sequence=db.prepare('SELECT next_sequence FROM memory_sync_cursors WHERE account_id=?').get(accountId).next_sequence;db.prepare('UPDATE memory_sync_cursors SET next_sequence=? WHERE account_id=?').run(sequence+1,accountId);db.prepare('INSERT INTO memory_sync_changes(account_id,sequence,memory_id,payload_json,created_at) VALUES(?,?,?,?,?)').run(accountId,sequence,op.memoryId,JSON.stringify(row),at);
        const result={memoryId:op.memoryId,operationId:op.operationId,version,sequence,status};accepted.push(result);db.prepare('INSERT INTO memory_sync_ops(account_id,operation_id,result_json,created_at) VALUES(?,?,?,?)').run(accountId,op.operationId,JSON.stringify(result),at);
      }
      const changes=db.prepare('SELECT sequence,payload_json FROM memory_sync_changes WHERE account_id=? AND sequence>? ORDER BY sequence LIMIT 500').all(accountId,cursor),hasMore=changes.length===500,nextCursor=changes.length?changes.at(-1).sequence:cursor;
      return {accepted,conflicts,changes:changes.map(item=>JSON.parse(item.payload_json)),cursor:nextCursor,hasMore};
    });
  }
  function relevantMemories(accountId,query,{limit=5,maxChars=1600}={}){if(!memoryTerms(query).length&&!/水果|吃什么|吃哪些|果物/u.test(query))return [];const rows=db.prepare("SELECT memory_id,version,type,content,reason,source_record_id,independent,status,updated_at FROM server_memories WHERE account_id=? AND status='active' ORDER BY updated_at DESC").all(accountId).map(row=>({...row,...scorePersonalMemory(row.content,row.reason,query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.updated_at-a.updated_at);const found=[];let chars=0;for(const row of rows){const item={memoryId:row.memory_id,version:row.version,type:row.type,content:row.content,reason:row.reason,fact:derivePersonalFact(row.content),confirmed:true,sourceRecordId:row.source_record_id,independent:row.independent===1,status:row.status,updatedAt:row.updated_at};if(found.length>=limit||chars+item.content.length+item.reason.length>maxChars)continue;found.push(item);chars+=item.content.length+item.reason.length;}return found;}
  return { createAccount, accountByEmail, createSession, accountForToken, revokeSession, usage, task, reserve, finish, syncMemories, relevantMemories, close: () => db.close() };
}
