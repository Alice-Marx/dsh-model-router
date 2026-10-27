import { randomUUID } from 'node:crypto'
import { PolicyError } from '../../capability-broker/src/authority.mjs'
import { canonicalTaskJson, taskRef, taskHash } from './task-contract.mjs'

const fail = code => { throw new PolicyError(code) }
const makeId = kind => `${kind}-${randomUUID()}`
const terminalRetry = new Set(['failed','cancelled','blocked','waiting-budget'])

/** SQLite journal for one-package managed tasks. Database is the verified native constructor. */
export function openTaskJournal(Database, path) {
  const db = new Database(path)
  try {
    db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000')
    if(db.pragma('journal_mode = WAL',{simple:true})!=='wal')fail('TASK_WAL_REQUIRED')
    db.pragma('synchronous = FULL')
    const version = db.pragma('user_version',{simple:true})
    if (![0,1,2].includes(version)) fail('TASK_SCHEMA_UNSUPPORTED')
    db.transaction(()=>{
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_runner(scope TEXT PRIMARY KEY, owner TEXT NOT NULL, generation INTEGER NOT NULL, until_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, owner_bot TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, deadline_ms INTEGER NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS packages(id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id), current_attempt TEXT, state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES packages(id), number INTEGER NOT NULL, parent_id TEXT REFERENCES attempts(id), state TEXT NOT NULL, generation INTEGER, started_ms INTEGER, finished_ms INTEGER, result TEXT, UNIQUE(package_id,number));
        CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id), state TEXT NOT NULL, generation INTEGER, started_ms INTEGER, finished_ms INTEGER);
        CREATE TABLE IF NOT EXISTS task_outbox(operation_id TEXT PRIMARY KEY REFERENCES operations(id), delivered_ms INTEGER);
        CREATE TABLE IF NOT EXISTS task_commands(owner_bot TEXT NOT NULL, request_key TEXT NOT NULL, kind TEXT NOT NULL, request_hash TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id), attempt_id TEXT NOT NULL REFERENCES attempts(id), PRIMARY KEY(owner_bot,request_key));
        CREATE TABLE IF NOT EXISTS legacy_task_runs(run_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), owner_bot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_execution_refs(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), reference TEXT NOT NULL, reference_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_reconciliations(id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL REFERENCES attempts(id), at_ms INTEGER NOT NULL, outcome TEXT NOT NULL, evidence TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), attempt_id TEXT REFERENCES attempts(id), kind TEXT NOT NULL, at_ms INTEGER NOT NULL, detail TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS task_ready ON tasks(state,created_ms);
        PRAGMA user_version = 2;
      `)
    }).immediate()
  } catch(error) { db.close();throw error }
  let closed = false
  const stmt = sql => db.prepare(sql)
  const transact = work => db.transaction(work).immediate()
  const time = now => { if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_TASK_TIME');return now }
  const event = (taskId,attemptId,kind,now,detail={}) => stmt('INSERT INTO task_events(task_id,attempt_id,kind,at_ms,detail) VALUES(?,?,?,?,?)').run(taskId,attemptId,kind,now,canonicalTaskJson(detail))
  const fence = (identity,now) => {
    time(now)
    const current=stmt('SELECT * FROM task_runner WHERE scope=?').get('execution')
    if (!current || current.owner!==identity?.owner || current.generation!==identity.generation || current.until_ms<=now) fail('STALE_TASK_RUNNER')
  }
  const owned = (owner,id) => {
    const task=stmt('SELECT * FROM tasks WHERE id=? AND owner_bot=?').get(taskRef(id),taskRef(owner))
    if (!task) fail('TASK_NOT_FOUND')
    return task
  }
  const latest = taskId => stmt('SELECT a.*,p.id AS package_id,o.id AS operation_id FROM packages p JOIN attempts a ON a.id=p.current_attempt JOIN operations o ON o.attempt_id=a.id WHERE p.task_id=?').get(taskId)
  const view = (owner,id,command=null) => {
    const task=owned(owner,id),current=latest(id)
    return {taskId:task.id,ownerBotId:task.owner_bot,state:task.state,packageId:current.package_id,attemptId:current.id,operationId:current.operation_id,
      attemptNumber:current.number,deadlineAt:task.deadline_ms,createdAt:task.created_ms,updatedAt:task.updated_ms,
      input:JSON.parse(task.payload),result:current.result?JSON.parse(current.result):null,
      executionRef:(()=>{const row=stmt('SELECT reference FROM task_execution_refs WHERE attempt_id=?').get(current.id);return row?JSON.parse(row.reference):null})(),
      reconciliation:(()=>{const row=stmt('SELECT * FROM task_reconciliations WHERE attempt_id=? ORDER BY id DESC LIMIT 1').get(current.id);return row?{at:row.at_ms,outcome:row.outcome,evidence:JSON.parse(row.evidence)}:null})(),
      legacyRunIds:stmt('SELECT run_id FROM legacy_task_runs WHERE task_id=? ORDER BY rowid').all(id).map(row=>row.run_id),
      attempts:stmt('SELECT a.id,a.number,a.parent_id,a.state,a.started_ms,a.finished_ms,o.id AS operation_id FROM attempts a JOIN operations o ON o.attempt_id=a.id WHERE a.package_id=? ORDER BY a.number').all(current.package_id),
      ...(command?{replayed:true,acceptedAttemptId:command.attempt_id}:{replayed:false})}
  }
  const replay = (owner,key,kind,hash) => {
    const previous=stmt('SELECT * FROM task_commands WHERE owner_bot=? AND request_key=?').get(owner,key)
    if (previous && (previous.kind!==kind || previous.request_hash!==hash)) fail('TASK_REQUEST_CONFLICT')
    return previous
  }
  const makeAttempt = (taskId,packageId,number,parent,now) => {
    const attemptId=makeId('attempt'),operationId=makeId('operation')
    stmt('INSERT INTO attempts(id,package_id,number,parent_id,state) VALUES(?,?,?,?,?)').run(attemptId,packageId,number,parent,'ready')
    stmt('INSERT INTO operations(id,attempt_id,state) VALUES(?,?,?)').run(operationId,attemptId,'queued')
    stmt('INSERT INTO task_outbox(operation_id) VALUES(?)').run(operationId)
    stmt('UPDATE packages SET current_attempt=?,state=? WHERE id=?').run(attemptId,'ready',packageId)
    stmt('UPDATE tasks SET state=?,updated_ms=? WHERE id=?').run('ready',now,taskId)
    event(taskId,attemptId,'queued',now,{operationId})
    return attemptId
  }
  const updateAll = (taskId,attempt,state,now,result=null) => {
    stmt('UPDATE tasks SET state=?,updated_ms=? WHERE id=?').run(state,now,taskId)
    stmt('UPDATE packages SET state=? WHERE id=?').run(state,attempt.package_id)
    stmt('UPDATE attempts SET state=?,finished_ms=?,result=? WHERE id=?').run(state,now,result===null?null:canonicalTaskJson(result),attempt.id)
    stmt('UPDATE operations SET state=?,finished_ms=? WHERE id=?').run(state,now,attempt.operation_id)
  }
  return Object.freeze({
    claimRunner(owner,ttlMs,now) {
      taskRef(owner);time(now)
      if (!Number.isSafeInteger(ttlMs)||ttlMs<50||ttlMs>60_000) fail('INVALID_RUNNER_TTL')
      return transact(()=>{
        const old=stmt('SELECT * FROM task_runner WHERE scope=?').get('execution')
        if(old&&old.until_ms>now)fail('TASK_RUNNER_BUSY')
        const generation=(old?.generation??0)+1
        stmt('INSERT INTO task_runner VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET owner=excluded.owner,generation=excluded.generation,until_ms=excluded.until_ms').run('execution',owner,generation,now+ttlMs)
        return Object.freeze({owner,generation})
      })
    },
    renew(identity,ttlMs,now) {
      if (!Number.isSafeInteger(ttlMs)||ttlMs<50||ttlMs>60_000) fail('INVALID_RUNNER_TTL')
      return transact(()=>{fence(identity,now);stmt('UPDATE task_runner SET until_ms=? WHERE scope=?').run(now+ttlMs,'execution')})
    },
    release(identity,now) {
      time(now)
      stmt('UPDATE task_runner SET until_ms=? WHERE scope=? AND owner=? AND generation=?').run(now,'execution',identity.owner,identity.generation)
    },
    recover(identity,now) {
      return transact(()=>{
        fence(identity,now)
        const rows=stmt("SELECT t.id AS task_id,a.*,p.id AS package_id,o.id AS operation_id FROM tasks t JOIN packages p ON p.task_id=t.id JOIN attempts a ON a.id=p.current_attempt JOIN operations o ON o.attempt_id=a.id WHERE o.state IN ('running','cancelling') AND (o.generation IS NULL OR o.generation<>?)").all(identity.generation)
        for(const row of rows) {
          updateAll(row.task_id,row,'needs-reconciliation',now,{code:'HOST_INTERRUPTED',outcome:'unknown',cancelRequested:row.state==='cancelling'})
          event(row.task_id,row.id,'interrupted',now,{previousGeneration:row.generation,operationId:row.operation_id})
        }
        return rows.length
      })
    },
    submit(identity,owner,key,hash,payload,deadline,now) {
      return transact(()=>{
        fence(identity,now);taskRef(owner);taskRef(key)
        const old=replay(owner,key,'submit',hash)
        if(old)return view(owner,old.task_id,old)
        if(stmt("SELECT 1 FROM tasks WHERE owner_bot=? AND state='needs-reconciliation'").get(owner))fail('TASK_RECONCILIATION_REQUIRED')
        if(stmt("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('ready','running','cancelling','waiting-budget')").get().n>=128)fail('TASK_QUEUE_LIMIT')
        if(!Number.isSafeInteger(deadline)||deadline<=now||deadline-now>300_000)fail('INVALID_TASK_DEADLINE')
        const taskId=makeId('task'),packageId=makeId('package')
        stmt('INSERT INTO tasks VALUES(?,?,?,?,?,?,?)').run(taskId,owner,canonicalTaskJson(payload),'ready',deadline,now,now)
        stmt('INSERT INTO packages(id,task_id,state) VALUES(?,?,?)').run(packageId,taskId,'ready')
        const attemptId=makeAttempt(taskId,packageId,1,null,now)
        stmt('INSERT INTO task_commands VALUES(?,?,?,?,?,?)').run(owner,key,'submit',hash,taskId,attemptId)
        return view(owner,taskId)
      })
    },
    get: view,
    fromLegacy(owner,runId) {
      const row=stmt('SELECT task_id FROM legacy_task_runs WHERE owner_bot=? AND run_id=?').get(taskRef(owner),taskRef(runId))
      if(!row)fail('TASK_NOT_FOUND')
      return view(owner,row.task_id)
    },
    ready() { return stmt("SELECT id,owner_bot,payload,deadline_ms FROM tasks WHERE state='ready' ORDER BY created_ms,id LIMIT 128").all().map(row=>({...row,payload:JSON.parse(row.payload)})) },
    ownerBlocked(owner) {return !!stmt("SELECT 1 FROM tasks WHERE owner_bot=? AND state='needs-reconciliation'").get(taskRef(owner))},
    assertDispatch(identity,owner,id,attemptId,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId||current.generation!==identity.generation||task.state!=='running')fail('STALE_TASK_ATTEMPT')
        if(task.deadline_ms<=now)fail('TASK_DEADLINE')
      })
    },
    claim(identity,owner,id,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(task.state!=='ready')return null
        if(task.deadline_ms<=now){updateAll(id,current,'failed',now,{code:'TASK_DEADLINE',notStarted:true});event(id,current.id,'deadline',now);return null}
        stmt('UPDATE tasks SET state=?,updated_ms=? WHERE id=?').run('running',now,id)
        stmt('UPDATE packages SET state=? WHERE id=?').run('running',current.package_id)
        stmt('UPDATE attempts SET state=?,generation=?,started_ms=? WHERE id=?').run('running',identity.generation,now,current.id)
        stmt('UPDATE operations SET state=?,generation=?,started_ms=? WHERE id=? AND state=?').run('running',identity.generation,now,current.operation_id,'queued')
        stmt('UPDATE task_outbox SET delivered_ms=? WHERE operation_id=? AND delivered_ms IS NULL').run(now,current.operation_id)
        event(id,current.id,'dispatched',now,{generation:identity.generation,operationId:current.operation_id})
        return view(owner,id)
      })
    },
    block(identity,owner,id,code,now) {
      return transact(()=>{fence(identity,now);const task=owned(owner,id),current=latest(id);if(task.state!=='ready')return
        updateAll(id,current,'blocked',now,{code,notStarted:true});event(id,current.id,'blocked',now,{code})})
    },
    cancel(identity,owner,id,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(task.state==='ready') {
          updateAll(id,current,'cancelled',now,{notStarted:true})
          stmt('UPDATE packages SET state=? WHERE id=?').run('skipped',current.package_id)
          stmt('UPDATE attempts SET state=? WHERE id=?').run('skipped',current.id)
          event(id,current.id,'cancelled-before-dispatch',now)
        }
        else if(task.state==='running') {
          for(const [table,key,value] of [['tasks','id',id],['packages','id',current.package_id],['attempts','id',current.id],['operations','id',current.operation_id]])stmt(`UPDATE ${table} SET state=? WHERE ${key}=?`).run('cancelling',value)
          stmt('UPDATE tasks SET updated_ms=? WHERE id=?').run(now,id)
          event(id,current.id,'cancel-requested',now)
        }
        else if(task.state==='waiting-budget'){
          updateAll(id,current,'cancelled',now,{code:'BUDGET_WAIT_CANCELLED',notStarted:true})
          event(id,current.id,'cancelled-while-waiting-budget',now)
        }
        return view(owner,id)
      })
    },
    finish(identity,owner,id,attemptId,outcome,result,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId||current.generation!==identity.generation||!['running','cancelling'].includes(task.state))fail('STALE_TASK_ATTEMPT')
        if(!['succeeded','failed','cancelled','unknown','waiting-budget'].includes(outcome))fail('INVALID_TASK_OUTCOME')
        const final=outcome==='unknown'?'needs-reconciliation':task.state==='cancelling'?'cancelled':outcome
        if(result?.legacyRunId) {
          const runId=taskRef(result.legacyRunId),old=stmt('SELECT * FROM legacy_task_runs WHERE run_id=?').get(runId)
          if(old&&(old.task_id!==id||old.owner_bot!==owner))fail('LEGACY_RUN_OWNER_CONFLICT')
          stmt('INSERT OR IGNORE INTO legacy_task_runs VALUES(?,?,?)').run(runId,id,owner)
        }
        updateAll(id,current,final,now,{...result,...(outcome==='unknown'?{cancelRequested:task.state==='cancelling'}:{})});event(id,current.id,'settled',now,{outcome:final})
        return view(owner,id)
      })
    },
    linkExecution(identity,owner,id,attemptId,reference,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId||current.generation!==identity.generation||!['running','cancelling'].includes(task.state))fail('STALE_TASK_ATTEMPT')
        const marker=reference?.marker,payload=JSON.parse(task.payload)
        if(reference?.kind!=='mr-run'||marker?.schemaVersion!==1||marker.taskId!==id||marker.attemptId!==attemptId||marker.operationId!==current.operation_id||marker.targetHash!==payload.targetHash)fail('INVALID_TASK_EXECUTION_REFERENCE')
        const runId=taskRef(reference.runId),hash=taskHash(reference)
        const old=stmt('SELECT * FROM task_execution_refs WHERE attempt_id=?').get(attemptId)
        if(old&&old.reference_hash!==hash)fail('TASK_EXECUTION_REFERENCE_CONFLICT')
        const link=stmt('SELECT * FROM legacy_task_runs WHERE run_id=?').get(runId)
        if(link&&(link.task_id!==id||link.owner_bot!==owner))fail('LEGACY_RUN_OWNER_CONFLICT')
        if(!old){
          stmt('INSERT INTO task_execution_refs VALUES(?,?,?)').run(attemptId,canonicalTaskJson(reference),hash)
          stmt('INSERT OR IGNORE INTO legacy_task_runs VALUES(?,?,?)').run(runId,id,owner)
          event(id,attemptId,'execution-linked-before-admission',now,{runId,referenceHash:hash})
        }
        return view(owner,id)
      })
    },
    reconciliationReplay(identity,owner,id,key,hash,now) {
      fence(identity,now);owned(owner,id)
      const old=replay(owner,key,'reconcile',hash)
      if(old)return view(owner,old.task_id,old)
      const current=latest(id)
      if(stmt('SELECT COUNT(*) AS n FROM task_reconciliations WHERE attempt_id=? AND at_ms>?').get(current.id,now-60_000).n>=64)fail('TASK_RECONCILIATION_RATE_LIMIT')
      return null
    },
    reconcile(identity,owner,id,attemptId,key,hash,verdict,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),old=replay(owner,key,'reconcile',hash)
        if(old)return view(owner,old.task_id,old)
        const current=latest(id)
        if(current.id!==attemptId||task.state!=='needs-reconciliation')fail('TASK_RECONCILE_NOT_ALLOWED')
        if(!['unknown','succeeded','failed','cancelled'].includes(verdict?.outcome))fail('INVALID_TASK_RECONCILIATION')
        if(stmt('SELECT COUNT(*) AS n FROM task_reconciliations WHERE attempt_id=? AND at_ms>?').get(current.id,now-60_000).n>=64)fail('TASK_RECONCILIATION_RATE_LIMIT')
        const ref=stmt('SELECT reference_hash FROM task_execution_refs WHERE attempt_id=?').get(attemptId)
        if(verdict.outcome!=='unknown'&&(!ref||ref.reference_hash!==verdict.referenceHash||!/^[a-f0-9]{64}$/.test(verdict.evidenceHash??'')))fail('INVALID_TASK_RECONCILIATION_PROOF')
        canonicalTaskJson(verdict)
        if(verdict.outcome!=='unknown'){
          const cancelled=JSON.parse(current.result??'{}').cancelRequested===true
          updateAll(id,current,cancelled?'cancelled':verdict.outcome,now,{code:'RECONCILED_FROM_EXECUTION_RECORD',evidenceHash:verdict.evidenceHash})
        }
        stmt('INSERT INTO task_reconciliations(attempt_id,at_ms,outcome,evidence) VALUES(?,?,?,?)').run(attemptId,now,verdict.outcome,canonicalTaskJson(verdict))
        stmt('INSERT INTO task_commands VALUES(?,?,?,?,?,?)').run(owner,key,'reconcile',hash,id,attemptId)
        event(id,attemptId,'reconciled',now,verdict)
        return view(owner,id)
      })
    },
    retry(identity,owner,id,key,hash,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id)
        const old=replay(owner,key,'retry',hash)
        if(old)return view(owner,old.task_id,old)
        if(!terminalRetry.has(task.state))fail(task.state==='needs-reconciliation'?'TASK_RECONCILIATION_REQUIRED':'TASK_RETRY_NOT_ALLOWED')
        if(stmt("SELECT 1 FROM tasks WHERE owner_bot=? AND state='needs-reconciliation'").get(owner))fail('TASK_RECONCILIATION_REQUIRED')
        if(stmt("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('ready','running','cancelling','waiting-budget') AND id<>?").get(id).n>=128)fail('TASK_QUEUE_LIMIT')
        if(task.deadline_ms<=now)fail('TASK_DEADLINE')
        const previous=latest(id)
        if(previous.number>=3)fail('TASK_RETRY_LIMIT')
        const attemptId=makeAttempt(id,previous.package_id,previous.number+1,previous.id,now)
        stmt('INSERT INTO task_commands VALUES(?,?,?,?,?,?)').run(owner,key,'retry',hash,id,attemptId)
        return view(owner,id)
      })
    },
    events(owner,id) {owned(owner,id);return stmt('SELECT * FROM task_events WHERE task_id=? ORDER BY seq').all(id)},
    close() {if(!closed){closed=true;db.close()}},
  })
}
