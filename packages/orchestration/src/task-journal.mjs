import { randomUUID } from 'node:crypto'
import { PolicyError } from '../../capability-broker/src/authority.mjs'
import { canonicalTaskJson, taskRef, taskHash, parseTaskPlan, validateTaskPlan, planInitiator } from './task-contract.mjs'
import {createTaskAdmission} from './task-admission.mjs'
import {taskStage, taskAttribution} from './task-stage.mjs'
import {readDatabaseClock, writeTransaction} from './write-retry.mjs'
import {requiresStopProof, stopProofEvidence} from './stop-proof.mjs'

const fail = code => { throw new PolicyError(code) }
const makeId = kind => `${kind}-${randomUUID()}`
const terminalRetry = new Set(['failed','cancelled','blocked','waiting-budget'])

/** SQLite journal for managed tasks and dependency plans. */
export function openTaskJournal(Database, path, {database=null,financialEpoch=null,leaseClock='app',writeDeadlineMs=10_000,onClose=()=>{}}={}) {
  const db = database??new Database(path),borrowed=database!==null
  const priorTimeout=db.pragma('busy_timeout',{simple:true})
  try {
    // Contention is the normal case, not an error: several Hosts share this
    // file. Keep the built-in wait on for this journal's whole life and let
    // writeTransaction bound it; restoring a borrowed handle to 0 here is what
    // made a second Host fail at start-up instead of queueing.
    db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000')
    if(db.pragma('journal_mode = WAL',{simple:true})!=='wal')fail('TASK_WAL_REQUIRED')
    db.pragma('synchronous = FULL')
    const version = db.pragma('user_version',{simple:true})
    if (![0,1,2,3,4,5].includes(version)) fail('TASK_SCHEMA_UNSUPPORTED')
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
        CREATE TABLE IF NOT EXISTS task_plans(id TEXT PRIMARY KEY,owner_bot TEXT NOT NULL,request_key TEXT NOT NULL,plan_hash TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,cancel_requested INTEGER NOT NULL DEFAULT 0,deadline_ms INTEGER NOT NULL,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,UNIQUE(owner_bot,request_key));
        CREATE TABLE IF NOT EXISTS task_plan_packages(plan_id TEXT NOT NULL REFERENCES task_plans(id),logical_id TEXT NOT NULL,task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),package_id TEXT NOT NULL UNIQUE REFERENCES packages(id),PRIMARY KEY(plan_id,logical_id));
        CREATE TABLE IF NOT EXISTS task_package_deps(package_id TEXT NOT NULL REFERENCES packages(id),depends_on TEXT NOT NULL REFERENCES packages(id),PRIMARY KEY(package_id,depends_on),CHECK(package_id!=depends_on));
        CREATE INDEX IF NOT EXISTS task_dep_parent ON task_package_deps(depends_on);
        CREATE TABLE IF NOT EXISTS task_workspace_locks(machine_id TEXT NOT NULL,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),PRIMARY KEY(machine_id,workspace_id));
        CREATE TABLE IF NOT EXISTS task_admission_intents(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),epoch TEXT NOT NULL,state TEXT NOT NULL,reference TEXT,reference_hash TEXT);
        CREATE TABLE IF NOT EXISTS task_dispatch_fences(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),state TEXT NOT NULL);
        PRAGMA user_version = 5;
      `)
    }).immediate()
  } catch(error) { db.pragma(`busy_timeout=${priorTimeout}`);if(!borrowed)db.close();throw error }
  let closed = false
  const stmt = sql => {if(closed)fail('TASK_JOURNAL_CLOSED');return db.prepare(sql)}
  // Every write retries a locked file within a bound; a policy refusal inside
  // `work` still surfaces on the first attempt.
  const transact = work => writeTransaction(db,()=>{const result=work();refreshPlans();return result},{deadlineMs:writeDeadlineMs})
  // `leaseClock:'db'` makes lease expiry and every fence read the database's
  // clock, so a Host whose wall clock drifted cannot hand its own lease to
  // another runner. Fixtures keep the injected clock ('app') to simulate time.
  const leaseNow = leaseClock==='db' ? now => {time(now);return readDatabaseClock(db)} : now => now
  const time = now => { if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_TASK_TIME');return now }
  const event = (taskId,attemptId,kind,now,detail={}) => stmt('INSERT INTO task_events(task_id,attempt_id,kind,at_ms,detail) VALUES(?,?,?,?,?)').run(taskId,attemptId,kind,now,canonicalTaskJson(detail))
  const fence = (identity,now) => {
    const at=leaseNow(now)
    const current=stmt('SELECT * FROM task_runner WHERE scope=?').get('execution')
    if (!current || current.owner!==identity?.owner || current.generation!==identity.generation || current.until_ms<=at) fail('STALE_TASK_RUNNER')
  }
  const owned = (owner,id) => {
    const task=stmt('SELECT * FROM tasks WHERE id=? AND owner_bot=?').get(taskRef(id),taskRef(owner))
    if (!task) fail('TASK_NOT_FOUND')
    return task
  }
  const latest = taskId => stmt('SELECT a.*,p.id AS package_id,o.id AS operation_id FROM packages p JOIN attempts a ON a.id=p.current_attempt JOIN operations o ON o.attempt_id=a.id WHERE p.task_id=?').get(taskId)
  // An execution reference records intent before dispatch, not proof that
  // dispatch did or did not happen. Older rows may lack a reference entirely.
  /** The three rows a stop-proof verdict reads, for one attempt. */
  const stopProofContext = attemptId => ({
    operation:stmt('SELECT o.*,b.delivered_ms FROM operations o JOIN task_outbox b ON b.operation_id=o.id WHERE o.attempt_id=?').get(attemptId),
    ref:stmt('SELECT reference,reference_hash FROM task_execution_refs WHERE attempt_id=?').get(attemptId),
    dispatch:stmt('SELECT * FROM task_dispatch_fences WHERE attempt_id=?').get(attemptId),
  })
  // Pure: every row it needs arrives in `context`, so a list read can supply them
  // for a whole page at once instead of paying three queries per task.
  const needsStopProofWith = (task,attempt,result,context) => {
    const backend=JSON.parse(task.payload).backend
    if(!requiresStopProof(backend))return false
    const {operation,ref,dispatch}=context
    const queued=attempt.started_ms===null&&operation?.started_ms===null&&operation.delivered_ms===null&&!ref
    if(queued)return false
    // Only the Host's durable closed dispatch fence (not a result flag) proves
    // a callback never entered. beginDispatch and assertDispatch reject it later.
    if(operation&&dispatch?.operation_id===operation.id&&dispatch.state==='closed'&&!ref)return false
    const proof=result?.summary?.stopProof
    const evidence=stopProofEvidence(backend)??[]
    if(!operation||!ref||!proof||proof.schemaVersion!==1||proof.taskId!==task.id||proof.attemptId!==attempt.id||proof.operationId!==operation.id||proof.targetHash!==JSON.parse(task.payload).targetHash||proof.referenceHash!==ref.reference_hash||!evidence.includes(proof.source)||proof.source!==result?.summary?.stopEvidence||!/^[a-f0-9]{64}$/.test(proof.evidenceHash??'')||result?.summary?.stopConfirmed!==true)return true
    try{const reference=JSON.parse(ref.reference);validateReference(task,{...attempt,operation_id:operation.id},reference);return taskHash(reference)!==proof.referenceHash}catch{return true}
  }
  const needsStopProof = (task,attempt,result) => needsStopProofWith(task,attempt,result,stopProofContext(attempt.id))
  // One page of task rows becomes one view object each, from a fixed number of
  // queries rather than nine per task. A 512-row product list used to cost about
  // 4,600 statements; that is long enough to starve the runner lease it reads for.
  const viewsOf = (taskRows,command=null) => {
    if(!taskRows.length)return []
    const ids=taskRows.map(row=>row.id),json=JSON.stringify(ids)
    const current=new Map(stmt(`SELECT p.task_id,a.*,p.id AS package_id,o.id AS operation_id,o.state AS operation_state,
        b.delivered_ms,f.state AS dispatch_state
      FROM packages p JOIN attempts a ON a.id=p.current_attempt JOIN operations o ON o.attempt_id=a.id
      LEFT JOIN task_outbox b ON b.operation_id=o.id LEFT JOIN task_dispatch_fences f ON f.attempt_id=a.id
      WHERE p.task_id IN (SELECT value FROM json_each(?))`).all(json).map(row=>[row.task_id,row]))
    const membership=new Map(stmt('SELECT task_id,plan_id,logical_id FROM task_plan_packages WHERE task_id IN (SELECT value FROM json_each(?))').all(json).map(row=>[row.task_id,row]))
    const refs=new Map(stmt('SELECT attempt_id,reference,reference_hash FROM task_execution_refs WHERE attempt_id IN (SELECT value FROM json_each(?))').all(JSON.stringify([...current.values()].map(row=>row.id))).map(row=>[row.attempt_id,row]))
    const dispatches=new Map(stmt('SELECT attempt_id,operation_id,state FROM task_dispatch_fences WHERE attempt_id IN (SELECT value FROM json_each(?))').all(JSON.stringify([...current.values()].map(row=>row.id))).map(row=>[row.attempt_id,row]))
    const reconciliations=new Map()
    for(const row of stmt('SELECT * FROM task_reconciliations WHERE attempt_id IN (SELECT value FROM json_each(?)) ORDER BY id').all(JSON.stringify([...current.values()].map(row=>row.id))))reconciliations.set(row.attempt_id,row)
    const legacy=new Map()
    for(const row of stmt('SELECT task_id,run_id FROM legacy_task_runs WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY rowid').all(json)){
      const list=legacy.get(row.task_id)??[];list.push(row.run_id);legacy.set(row.task_id,list)
    }
    const attemptRows=new Map()
    for(const row of stmt(`SELECT a.package_id,a.id,a.number,a.parent_id,a.state,a.started_ms,a.finished_ms,o.id AS operation_id
      FROM attempts a JOIN operations o ON o.attempt_id=a.id WHERE a.package_id IN (SELECT value FROM json_each(?)) ORDER BY a.number`).all(JSON.stringify([...current.values()].map(row=>row.package_id)))){
      const list=attemptRows.get(row.package_id)??[];list.push(row);attemptRows.set(row.package_id,list)
    }
    return taskRows.map(task=>{
      const currentAttempt=current.get(task.id)
      if(!currentAttempt)fail('TASK_NOT_FOUND')
      const membershipRow=membership.get(task.id),ref=refs.get(currentAttempt.id),reconciliation=reconciliations.get(currentAttempt.id)
      const result=currentAttempt.result?JSON.parse(currentAttempt.result):null
      const confirmed=result?.summary?needsStopProofWith(task,currentAttempt,result,{
        operation:{...currentAttempt,id:currentAttempt.operation_id,state:currentAttempt.operation_state},
        ref,dispatch:dispatches.get(currentAttempt.id),
      }):false
      const base={taskId:task.id,ownerBotId:task.owner_bot,state:task.state,stage:taskStage(task),packageId:currentAttempt.package_id,attemptId:currentAttempt.id,operationId:currentAttempt.operation_id,
        ...(membershipRow?{planId:membershipRow.plan_id,logicalPackageId:membershipRow.logical_id}:{}),
        attemptNumber:currentAttempt.number,deadlineAt:task.deadline_ms,createdAt:task.created_ms,updatedAt:task.updated_ms,
        input:JSON.parse(task.payload),
        result:result?.summary&&confirmed?{...result,summary:{...result.summary,stopConfirmed:false}}:result,
        executionRef:ref?JSON.parse(ref.reference):null,
        reconciliation:reconciliation?{at:reconciliation.at_ms,outcome:reconciliation.outcome,evidence:JSON.parse(reconciliation.evidence)}:null,
        legacyRunIds:legacy.get(task.id)??[],
        attempts:attemptRows.get(currentAttempt.package_id)??[],
        ...(command?{replayed:true,acceptedAttemptId:command.attempt_id}:{replayed:false})}
      // What the row says is not the whole answer: "failed" alone cannot tell a
      // refusal from a run that broke, and those need different next steps.
      return {...base,attribution:taskAttribution(base)}
    })
  }
  const view = (owner,id,command=null) => viewsOf([owned(owner,id)],command)[0]
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
    if(['succeeded','failed','cancelled','blocked','skipped','waiting-budget'].includes(state))stmt('DELETE FROM task_workspace_locks WHERE task_id=? AND attempt_id=?').run(taskId,attempt.id)
  }
  const dependenciesReady=packageId=>!stmt("SELECT 1 FROM task_package_deps d JOIN packages p ON p.id=d.depends_on WHERE d.package_id=? AND p.state!='succeeded' LIMIT 1").get(packageId)
  const epoch=()=>{
    if(!borrowed||typeof financialEpoch!=='function')fail('TASK_ATOMIC_CONNECTION_REQUIRED')
    return financialEpoch()
  }
  const validateReference=(task,current,reference)=>{
    const marker=reference?.marker,payload=JSON.parse(task.payload)
    if(!['mr-run','cli-run','remote-operation','bot-turn'].includes(reference?.kind)||marker?.schemaVersion!==1||marker.taskId!==task.id||marker.attemptId!==current.id||marker.operationId!==current.operation_id||marker.targetHash!==payload.targetHash)fail('INVALID_TASK_EXECUTION_REFERENCE')
    if(reference.kind==='remote-operation'){
      const expected=Object.freeze({'remote-write':'fs_write','remote-command':'container_command_v1'})
      if(!(payload.backend in expected)||payload.target.effect!=='workspace-write'||payload.target.location!=='remote'||reference.operationId!==current.operation_id||reference.machineId!==payload.target.machineId||reference.tool!==expected[payload.backend]||typeof reference.rootId!=='string'||reference.rootId!==payload.input?.rootId)fail('INVALID_TASK_EXECUTION_REFERENCE')
    }else {
      taskRef(reference.runId)
      if(reference.kind==='bot-turn') {
        if(!['bot-turn-read','bot-turn-write'].includes(payload.backend))fail('INVALID_TASK_EXECUTION_REFERENCE')
        taskRef(reference.sessionId)
      }
    }
    canonicalTaskJson(reference)
  }
  const operationHasMoney=current=>Boolean(
    stmt("SELECT 1 FROM router_model_calls WHERE json_extract(payload,'$.operationId')=? LIMIT 1").get(current.operation_id)||
    stmt("SELECT 1 FROM router_runs WHERE json_extract(payload,'$.managedExecution.operationId')=? LIMIT 1").get(current.operation_id))
  const notDispatched=(taskId,current)=>{
    if(!borrowed||typeof financialEpoch!=='function')return false
    const intent=stmt('SELECT * FROM task_admission_intents WHERE attempt_id=?').get(current.id)
    const outbox=stmt('SELECT delivered_ms FROM task_outbox WHERE operation_id=?').get(current.operation_id)
    return Boolean(intent&&intent.state==='preparing'&&intent.epoch===epoch()&&outbox&&outbox.delivered_ms===null&&!stmt('SELECT 1 FROM task_execution_refs WHERE attempt_id=?').get(current.id)&&!operationHasMoney(current))
  }
  const assertPreparing=(identity,owner,id,attemptId,now)=>{
    fence(identity,now);const task=owned(owner,id),current=latest(id)
    if(current.id!==attemptId||current.generation!==identity.generation||task.state!=='admitting')fail('STALE_TASK_ATTEMPT')
    if(task.deadline_ms<=now)fail('TASK_DEADLINE')
    if(!dependenciesReady(current.package_id)||cancelledPlan(id))fail('TASK_DEPENDENCIES_NOT_READY')
    const intent=stmt('SELECT * FROM task_admission_intents WHERE attempt_id=?').get(current.id)
    if(!intent||intent.state!=='preparing'||intent.epoch!==epoch())fail('TASK_ADMISSION_CONFLICT')
    return{task,current,intent}
  }
  const refreshPlans=()=>{
    let blocked
    do{
      blocked=stmt("SELECT t.id,MAX(parent_task.updated_ms) AS updated_ms FROM tasks t JOIN packages p ON p.task_id=t.id JOIN attempts a ON a.id=p.current_attempt JOIN task_package_deps d ON d.package_id=p.id JOIN packages parent ON parent.id=d.depends_on JOIN tasks parent_task ON parent_task.id=parent.task_id WHERE t.state='ready' AND a.started_ms IS NULL AND parent.state IN ('failed','cancelled','blocked','skipped') GROUP BY t.id").all()
      for(const row of blocked){const a=latest(row.id);updateAll(row.id,a,'blocked',row.updated_ms,{code:'DEPENDENCY_FAILED',notStarted:true});event(row.id,a.id,'dependency-blocked',row.updated_ms,{code:'DEPENDENCY_FAILED'})}
    }while(blocked.length)
    // A plan that is at rest cannot change on this write: its state is derived
    // from its members' states and from its own cancel flag, and every member
    // write bumps `updated_ms`. Selecting the candidates once keeps a Host with
    // many finished plans from paying for all of them on every journal write.
    const candidates=stmt(`SELECT p.id,p.state,p.cancel_requested,p.updated_ms FROM task_plans p
      WHERE p.state NOT IN ('succeeded','cancelled','failed')
        OR (p.cancel_requested=1 AND p.state NOT IN ('cancelling','cancelled'))
        OR EXISTS(SELECT 1 FROM task_plan_packages m JOIN tasks t ON t.id=m.task_id WHERE m.plan_id=p.id AND t.updated_ms>p.updated_ms)`).all()
    for(const plan of candidates){
      const rows=stmt('SELECT t.state,t.updated_ms FROM task_plan_packages m JOIN tasks t ON t.id=m.task_id WHERE m.plan_id=?').all(plan.id)
      const states=rows.map(row=>row.state),pending=states.some(state=>['ready','admitting','running','cancelling','waiting-budget','needs-reconciliation'].includes(state))
      const state=plan.cancel_requested?(pending?'cancelling':'cancelled'):
        states.includes('needs-reconciliation')?'needs-reconciliation':states.includes('cancelling')?'cancelling':states.includes('running')?'running':
        states.includes('admitting')?'admitting':states.includes('ready')?'ready':states.includes('waiting-budget')?'waiting-budget':states.every(value=>value==='succeeded')?'succeeded':'failed'
      stmt('UPDATE task_plans SET state=?,updated_ms=? WHERE id=?').run(state,Math.max(plan.updated_ms,...rows.map(row=>row.updated_ms)),plan.id)
    }
  }
  const planView=(owner,id,replayed=false)=>{
    const plan=stmt('SELECT * FROM task_plans WHERE id=? AND owner_bot=?').get(taskRef(id),taskRef(owner))
    if(!plan)fail('TASK_PLAN_NOT_FOUND')
    const rows=stmt('SELECT m.logical_id,t.id,t.owner_bot,t.state,p.id AS package_id FROM task_plan_packages m JOIN tasks t ON t.id=m.task_id JOIN packages p ON p.task_id=t.id WHERE m.plan_id=? ORDER BY m.rowid').all(id)
    const packages=rows.map(row=>{const current=latest(row.id);return{id:row.logical_id,taskId:row.id,packageId:row.package_id,targetBotId:row.owner_bot,state:row.state,attemptId:current.id,operationId:current.operation_id,attemptNumber:current.number,
        result:view(row.owner_bot,row.id).result,dependsOn:stmt('SELECT parent.logical_id FROM task_package_deps d JOIN task_plan_packages parent ON parent.package_id=d.depends_on WHERE d.package_id=? ORDER BY parent.rowid').all(row.package_id).map(value=>value.logical_id)}})
    const result={planId:plan.id,ownerBotId:plan.owner_bot,state:plan.state,cancelRequested:Boolean(plan.cancel_requested),needsReconciliation:packages.some(row=>row.state==='needs-reconciliation'),
      createdAt:plan.created_ms,updatedAt:plan.updated_ms,deadlineAt:plan.deadline_ms,plan:JSON.parse(plan.payload),
      // What started it, beside whose authority it carries: a schedule or a
      // delegation runs as a person while nobody is watching.
      initiator:(()=>{try{return planInitiator(JSON.parse(plan.payload))}catch{return {kind:'person'}}})(),
      packages,replayed}
    return{...result,stage:taskStage(result)}
  }
  const cancelledPlan=taskId=>Boolean(stmt('SELECT 1 FROM task_plan_packages m JOIN task_plans p ON p.id=m.plan_id WHERE m.task_id=? AND p.cancel_requested=1').get(taskId))
  const cancelNode=(taskId,now)=>{
    const task=stmt('SELECT * FROM tasks WHERE id=?').get(taskId),current=latest(taskId)
    const member=stmt('SELECT 1 FROM task_plan_packages WHERE task_id=?').get(taskId)
    if(task.state==='ready'||member&&task.state==='blocked'&&current.started_ms===null){
      updateAll(taskId,current,member?'skipped':'cancelled',now,{code:'TASK_CANCEL_REQUESTED',notStarted:true})
      stmt('UPDATE packages SET state=? WHERE id=?').run('skipped',current.package_id)
      stmt('UPDATE attempts SET state=? WHERE id=?').run('skipped',current.id)
      event(taskId,current.id,'cancelled-before-dispatch',now)
    }else if(['running','admitting'].includes(task.state)){
      for(const [table,key,value] of [['tasks','id',taskId],['packages','id',current.package_id],['attempts','id',current.id],['operations','id',current.operation_id]])stmt(`UPDATE ${table} SET state=? WHERE ${key}=?`).run('cancelling',value)
      stmt('UPDATE tasks SET updated_ms=? WHERE id=?').run(now,taskId);event(taskId,current.id,'cancel-requested',now)
    }else if(task.state==='waiting-budget'){
      updateAll(taskId,current,'cancelled',now,{code:'BUDGET_WAIT_CANCELLED',notStarted:true});event(taskId,current.id,'cancelled-while-waiting-budget',now)
    }else if(task.state==='needs-reconciliation'){
      stmt('UPDATE attempts SET result=? WHERE id=?').run(canonicalTaskJson({...JSON.parse(current.result??'{}'),cancelRequested:true}),current.id)
      stmt('UPDATE tasks SET updated_ms=? WHERE id=?').run(now,taskId)
      event(taskId,current.id,'cancel-requested-unconfirmed',now)
    }
  }
  return Object.freeze({
    supportsAtomicAdmission:borrowed&&typeof financialEpoch==='function',
    claimRunner(owner,ttlMs,now) {
      taskRef(owner);time(now)
      if (!Number.isSafeInteger(ttlMs)||ttlMs<50||ttlMs>60_000) fail('INVALID_RUNNER_TTL')
      return transact(()=>{
        const at=leaseNow(now)
        const old=stmt('SELECT * FROM task_runner WHERE scope=?').get('execution')
        if(old&&old.until_ms>at)fail('TASK_RUNNER_BUSY')
        const generation=(old?.generation??0)+1
        stmt('INSERT INTO task_runner VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET owner=excluded.owner,generation=excluded.generation,until_ms=excluded.until_ms').run('execution',owner,generation,at+ttlMs)
        return Object.freeze({owner,generation})
      })
    },
    renew(identity,ttlMs,now) {
      if (!Number.isSafeInteger(ttlMs)||ttlMs<50||ttlMs>60_000) fail('INVALID_RUNNER_TTL')
      return transact(()=>{fence(identity,now);stmt('UPDATE task_runner SET until_ms=? WHERE scope=?').run(leaseNow(now)+ttlMs,'execution')})
    },
    release(identity,now) {
      return transact(()=>{const at=leaseNow(now);stmt('UPDATE task_runner SET until_ms=? WHERE scope=? AND owner=? AND generation=?').run(at,'execution',identity.owner,identity.generation)})
    },
    recover(identity,now) {
      return transact(()=>{
        fence(identity,now)
        const rows=stmt("SELECT t.id AS task_id,a.*,p.id AS package_id,o.id AS operation_id FROM tasks t JOIN packages p ON p.task_id=t.id JOIN attempts a ON a.id=p.current_attempt JOIN operations o ON o.attempt_id=a.id WHERE o.state IN ('admitting','running','cancelling') AND (o.generation IS NULL OR o.generation<>?)").all(identity.generation)
        for(const row of rows) {
          if(['admitting','cancelling'].includes(row.state)&&notDispatched(row.task_id,row)){
            if(row.state==='cancelling'){
              updateAll(row.task_id,row,'cancelled',now,{code:'ADMISSION_CANCELLED_NOT_DISPATCHED',notStarted:true})
              stmt('UPDATE packages SET state=? WHERE id=?').run('skipped',row.package_id)
              stmt('UPDATE attempts SET state=? WHERE id=?').run('skipped',row.id)
              event(row.task_id,row.id,'admission-recovered-cancelled',now,{operationId:row.operation_id});continue
            }
            stmt('UPDATE tasks SET state=?,updated_ms=? WHERE id=?').run('ready',now,row.task_id)
            stmt('UPDATE packages SET state=? WHERE id=?').run('ready',row.package_id)
            stmt('UPDATE attempts SET state=?,generation=NULL,started_ms=NULL,finished_ms=NULL,result=NULL WHERE id=?').run('ready',row.id)
            stmt('UPDATE operations SET state=?,generation=NULL,started_ms=NULL,finished_ms=NULL WHERE id=?').run('queued',row.operation_id)
            stmt('UPDATE task_admission_intents SET state=? WHERE attempt_id=?').run('not-dispatched',row.id)
            stmt('DELETE FROM task_workspace_locks WHERE attempt_id=?').run(row.id)
            event(row.task_id,row.id,'admission-recovered-not-dispatched',now,{operationId:row.operation_id,previousGeneration:row.generation})
            continue
          }
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
        if(stmt("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('ready','admitting','running','cancelling','waiting-budget')").get().n>=128)fail('TASK_QUEUE_LIMIT')
        if(!Number.isSafeInteger(deadline)||deadline<=now||deadline-now>7_200_000)fail('INVALID_TASK_DEADLINE')
        const taskId=makeId('task'),packageId=makeId('package')
        stmt('INSERT INTO tasks VALUES(?,?,?,?,?,?,?)').run(taskId,owner,canonicalTaskJson(payload),'ready',deadline,now,now)
        stmt('INSERT INTO packages(id,task_id,state) VALUES(?,?,?)').run(packageId,taskId,'ready')
        const attemptId=makeAttempt(taskId,packageId,1,null,now)
        stmt('INSERT INTO task_commands VALUES(?,?,?,?,?,?)').run(owner,key,'submit',hash,taskId,attemptId)
        return view(owner,taskId)
      })
    },
    submitPlan(identity,owner,key,input,now,{payloads,deadline=now+120_000}={}) {
      const plan=parseTaskPlan(input);validateTaskPlan(plan)
      if(plan.origin.botId!==owner)fail('TASK_PLAN_ORIGIN_MISMATCH')
      const hash=taskHash({kind:'submit-plan',plan}),prepared=new Map((payloads??[]).map(item=>[item.id,item.payload]))
      if(prepared.size!==plan.packages.length||payloads?.length!==prepared.size||plan.packages.some(item=>!prepared.has(item.id)))fail('TASK_PLAN_TARGETS_REQUIRED')
      return transact(()=>{
        fence(identity,now);taskRef(owner);taskRef(key)
        const old=replay(owner,key,'submit-plan',hash)
        if(old){const member=stmt('SELECT plan_id FROM task_plan_packages WHERE task_id=?').get(old.task_id);if(!member)fail('TASK_PLAN_CORRUPT');return planView(owner,member.plan_id,true)}
        if(stmt('SELECT 1 FROM task_plans WHERE id=?').get(plan.taskId))fail('TASK_PLAN_CONFLICT')
        if(stmt("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('ready','admitting','running','cancelling','waiting-budget')").get().n+plan.packages.length>128)fail('TASK_QUEUE_LIMIT')
        if(!Number.isSafeInteger(deadline)||deadline<=now||deadline-now>7_200_000)fail('INVALID_TASK_DEADLINE')
        stmt('INSERT INTO task_plans(id,owner_bot,request_key,plan_hash,payload,state,deadline_ms,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(plan.taskId,owner,key,hash,canonicalTaskJson(plan),'ready',deadline,now,now)
        const created=new Map()
        for(const item of plan.packages){
          const payload=prepared.get(item.id)
          if(payload?.target?.effect!==item.effectClass)fail('TASK_PLAN_EFFECT_MISMATCH')
          if(stmt("SELECT 1 FROM tasks WHERE owner_bot=? AND state='needs-reconciliation'").get(item.targetBotId))fail('TASK_RECONCILIATION_REQUIRED')
          const taskId=makeId('task'),packageId=makeId('package')
          stmt('INSERT INTO tasks VALUES(?,?,?,?,?,?,?)').run(taskId,item.targetBotId,canonicalTaskJson(payload),'ready',deadline,now,now)
          stmt('INSERT INTO packages(id,task_id,state) VALUES(?,?,?)').run(packageId,taskId,'ready')
          const attemptId=makeAttempt(taskId,packageId,1,null,now)
          stmt('INSERT INTO task_plan_packages VALUES(?,?,?,?)').run(plan.taskId,item.id,taskId,packageId)
          created.set(item.id,{taskId,packageId,attemptId})
        }
        for(const item of plan.packages)for(const dependency of item.dependsOn)stmt('INSERT INTO task_package_deps VALUES(?,?)').run(created.get(item.id).packageId,created.get(dependency).packageId)
        const first=created.get(plan.packages[0].id)
        stmt('INSERT INTO task_commands VALUES(?,?,?,?,?,?)').run(owner,key,'submit-plan',hash,first.taskId,first.attemptId)
        return planView(owner,plan.taskId)
      })
    },
    getPlan:planView,
    replayPlan(identity,owner,key,input,now){
      fence(identity,now);taskRef(owner);taskRef(key)
      const plan=parseTaskPlan(input),old=replay(owner,key,'submit-plan',taskHash({kind:'submit-plan',plan}))
      if(!old)return null
      const member=stmt('SELECT plan_id FROM task_plan_packages WHERE task_id=?').get(old.task_id)
      if(!member)fail('TASK_PLAN_CORRUPT')
      return planView(owner,member.plan_id,true)
    },
    listPlans(owner){taskRef(owner);return stmt('SELECT id FROM task_plans WHERE owner_bot=? ORDER BY created_ms,id LIMIT 128').all(owner).map(row=>planView(owner,row.id))},
    get: view,
    fromLegacy(owner,runId) {
      const row=stmt('SELECT task_id FROM legacy_task_runs WHERE owner_bot=? AND run_id=?').get(taskRef(owner),taskRef(runId))
      if(!row)fail('TASK_NOT_FOUND')
      return view(owner,row.task_id)
    },
    ready() { return stmt("SELECT t.id,t.owner_bot,t.payload,t.deadline_ms FROM tasks t JOIN packages p ON p.task_id=t.id WHERE t.state='ready' AND NOT EXISTS(SELECT 1 FROM task_package_deps d JOIN packages parent ON parent.id=d.depends_on WHERE d.package_id=p.id AND parent.state!='succeeded') AND NOT EXISTS(SELECT 1 FROM task_plan_packages m JOIN task_plans plan ON plan.id=m.plan_id WHERE m.task_id=t.id AND plan.cancel_requested=1) ORDER BY t.created_ms,t.id LIMIT 128").all().map(row=>({...row,payload:JSON.parse(row.payload)})) },
    ownerBlocked(owner) {return !!stmt("SELECT 1 FROM tasks WHERE owner_bot=? AND state='needs-reconciliation'").get(taskRef(owner))},
    assertDispatch(identity,owner,id,attemptId,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId||current.generation!==identity.generation||task.state!=='running')fail('STALE_TASK_ATTEMPT')
        if(stmt("SELECT 1 FROM task_dispatch_fences WHERE attempt_id=? AND state='closed'").get(attemptId))fail('TASK_DISPATCH_CLOSED')
        if(!dependenciesReady(current.package_id)||cancelledPlan(id))fail('TASK_DEPENDENCIES_NOT_READY')
        if(task.deadline_ms<=now)fail('TASK_DEADLINE')
      })
    },
    /**
     * Record one decision about a running attempt. A gate row says what was
     * checked and what it decided; it never changes the task's state, so a
     * refusal that ends the attempt still lands through `finish`/`block`.
     */
    note(identity,owner,id,attemptId,kind,now,detail={}) {
      taskRef(kind)
      return transact(()=>{fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId)fail('STALE_TASK_ATTEMPT')
        event(id,attemptId,kind,now,detail)
        return detail
      })
    },
    beginDispatch(identity,owner,id,attemptId,now){
      return transact(()=>{fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId||current.generation!==identity.generation||!['running','admitting'].includes(task.state))fail('STALE_TASK_ATTEMPT')
        if(!stmt("UPDATE task_dispatch_fences SET state='entered' WHERE attempt_id=? AND operation_id=? AND state='claimed'").run(attemptId,current.operation_id).changes)fail('TASK_DISPATCH_CLOSED')
      })
    },
    closeDispatch(identity,owner,id,attemptId,now){
      return transact(()=>{fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId||current.generation!==identity.generation||!['running','admitting','cancelling'].includes(task.state))fail('STALE_TASK_ATTEMPT')
        if(stmt('SELECT 1 FROM task_execution_refs WHERE attempt_id=?').get(attemptId))return false
        const closed=stmt("UPDATE task_dispatch_fences SET state='closed' WHERE attempt_id=? AND operation_id=? AND state='claimed'").run(attemptId,current.operation_id).changes===1
        if(closed)event(id,attemptId,'dispatch-closed-before-entry',now,{operationId:current.operation_id,generation:identity.generation})
        return closed
      })
    },
    claim(identity,owner,id,now,{atomic=false}={}) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(task.state!=='ready')return null
        if(!dependenciesReady(current.package_id)||cancelledPlan(id))return null
        // A retry queued by an older Host must not dispatch after upgrade when
        // its parent attempt lacked evidence that the original stopped.
        if(current.parent_id){
          const parent=stmt('SELECT * FROM attempts WHERE id=?').get(current.parent_id)
          if(!parent||needsStopProof(task,parent,parent.result?JSON.parse(parent.result):null)){
            updateAll(id,current,'needs-reconciliation',now,{code:'PREVIOUS_ATTEMPT_STOP_UNCONFIRMED',previousAttemptId:current.parent_id})
            event(id,current.id,'retry-fenced',now,{previousAttemptId:current.parent_id});return null
          }
        }
        if(task.deadline_ms<=now){updateAll(id,current,'failed',now,{code:'TASK_DEADLINE',notStarted:true});event(id,current.id,'deadline',now);return null}
        if(atomic){
          epoch()
          if(operationHasMoney(current)||stmt('SELECT 1 FROM task_execution_refs WHERE attempt_id=?').get(current.id)){
            updateAll(id,current,'needs-reconciliation',now,{code:'TASK_ADMISSION_CONFLICT',outcome:'unknown'});event(id,current.id,'admission-conflict',now);return null
          }
        }
        const target=JSON.parse(task.payload).target
        if(target?.effect==='workspace-write'){
          taskRef(target.machineId);taskRef(target.workspaceId)
          const taken=stmt('INSERT OR IGNORE INTO task_workspace_locks VALUES(?,?,?,?)').run(target.machineId,target.workspaceId,id,current.id)
          if(!taken.changes)return null
        }
        const state=atomic?'admitting':'running'
        stmt('UPDATE tasks SET state=?,updated_ms=? WHERE id=?').run(state,now,id)
        stmt('UPDATE packages SET state=? WHERE id=?').run(state,current.package_id)
        stmt('UPDATE attempts SET state=?,generation=?,started_ms=? WHERE id=?').run(state,identity.generation,atomic?null:now,current.id)
        stmt('UPDATE operations SET state=?,generation=?,started_ms=? WHERE id=? AND state=?').run(state,identity.generation,atomic?null:now,current.operation_id,'queued')
        if(atomic)stmt("INSERT INTO task_admission_intents VALUES(?,?,'preparing',NULL,NULL) ON CONFLICT(attempt_id) DO UPDATE SET epoch=excluded.epoch,state='preparing',reference=NULL,reference_hash=NULL").run(current.id,epoch())
        else stmt('UPDATE task_outbox SET delivered_ms=? WHERE operation_id=? AND delivered_ms IS NULL').run(now,current.operation_id)
        stmt("INSERT INTO task_dispatch_fences VALUES(?,?,'claimed') ON CONFLICT(attempt_id) DO UPDATE SET state='claimed'").run(current.id,current.operation_id)
        event(id,current.id,atomic?'admission-prepared':'dispatched',now,{generation:identity.generation,operationId:current.operation_id})
        return view(owner,id)
      })
    },
    assertPreparing(identity,owner,id,attemptId,now){return transact(()=>{assertPreparing(identity,owner,id,attemptId,now)})},
    createAdmission(identity,owner,id,attemptId,now,assertAuthority=()=>{}){
      assertPreparing(identity,owner,id,attemptId,now())
      return createTaskAdmission({database:db,
        capture:reference=>transact(()=>{
          assertAuthority()
          const {task,current,intent}=assertPreparing(identity,owner,id,attemptId,now());validateReference(task,current,reference)
          const hash=taskHash(reference)
          if(intent.reference_hash&&intent.reference_hash!==hash)fail('TASK_EXECUTION_REFERENCE_CONFLICT')
          stmt('UPDATE task_admission_intents SET reference=?,reference_hash=? WHERE attempt_id=?').run(canonicalTaskJson(reference),hash,attemptId)
          event(id,attemptId,'admission-reference-prepared',now(),{referenceHash:hash})
        }),
        commit:reference=>transact(()=>{
          assertAuthority()
          const at=now(),{task,current,intent}=assertPreparing(identity,owner,id,attemptId,at);validateReference(task,current,reference)
          if(intent.reference_hash!==taskHash(reference))fail('TASK_ADMISSION_CONFLICT')
          stmt('UPDATE tasks SET state=?,updated_ms=? WHERE id=?').run('running',at,id)
          stmt('UPDATE packages SET state=? WHERE id=?').run('running',current.package_id)
          stmt('UPDATE attempts SET state=?,started_ms=? WHERE id=?').run('running',at,attemptId)
          stmt('UPDATE operations SET state=?,started_ms=? WHERE id=?').run('running',at,current.operation_id)
          stmt('UPDATE task_outbox SET delivered_ms=? WHERE operation_id=? AND delivered_ms IS NULL').run(at,current.operation_id)
          stmt('INSERT INTO task_execution_refs VALUES(?,?,?)').run(attemptId,canonicalTaskJson(reference),taskHash(reference))
          const old=stmt('SELECT * FROM legacy_task_runs WHERE run_id=?').get(reference.runId)
          if(old&&(old.task_id!==id||old.owner_bot!==owner))fail('LEGACY_RUN_OWNER_CONFLICT')
          stmt('INSERT OR IGNORE INTO legacy_task_runs VALUES(?,?,?)').run(reference.runId,id,owner)
          stmt('UPDATE task_admission_intents SET state=? WHERE attempt_id=?').run('committed',attemptId)
          event(id,attemptId,'financial-admission-committed',at,{operationId:current.operation_id,runId:reference.runId,referenceHash:taskHash(reference)})
        }),
        proveNotDispatched:()=>{const task=owned(owner,id),current=latest(id);return current.id===attemptId&&['admitting','cancelling'].includes(task.state)&&notDispatched(id,current)},
      })
    },
    block(identity,owner,id,code,now,detail={}) {
      return transact(()=>{fence(identity,now);const task=owned(owner,id),current=latest(id);if(task.state!=='ready')return
        // The gate and the rule travel with the state, so the record answers
        // "which check refused this" without a second lookup.
        const facts={code,...(typeof detail?.gate==='string'&&detail.gate?{gate:detail.gate}:{}),...(typeof detail?.rule==='string'&&detail.rule?{rule:detail.rule}:{})}
        updateAll(id,current,'blocked',now,{...facts,notStarted:true});event(id,current.id,'blocked',now,facts)})
    },
    // A plan has a total deadline: unattended budget waiting ends at it instead of parking forever.
    expire(identity,now) {
      return transact(()=>{
        fence(identity,now)
        const rows=stmt("SELECT t.id AS task_id,t.state AS task_state,a.*,p.id AS package_id,o.id AS operation_id FROM tasks t JOIN packages p ON p.task_id=t.id JOIN attempts a ON a.id=p.current_attempt JOIN operations o ON o.attempt_id=a.id WHERE t.state IN ('waiting-budget','ready') AND t.deadline_ms<=?").all(now)
        for(const row of rows) {
          const waiting=row.task_state==='waiting-budget'
          updateAll(row.task_id,row,'failed',now,{code:waiting?'BUDGET_WAIT_EXPIRED':'TASK_DEADLINE',notStarted:true})
          event(row.task_id,row.id,waiting?'budget-wait-expired':'deadline',now)
        }
        return rows.length
      })
    },
    cancel(identity,owner,id,now) {
      return transact(()=>{
        fence(identity,now);const current=owned(owner,id)
        const planOwner=stmt('SELECT p.owner_bot FROM task_plan_packages m JOIN task_plans p ON p.id=m.plan_id WHERE m.task_id=?').get(id)
        // A target Bot cannot use its already-finished package as authority to
        // cancel the planner's subsequently running packages on other Bots.
        if(planOwner&&planOwner.owner_bot!==owner&&['succeeded','failed','cancelled','blocked','skipped'].includes(current.state))return {...view(owner,id),cancelledTaskIds:[]}
        const rows=stmt('WITH RECURSIVE descendants(id) AS (SELECT id FROM packages WHERE task_id=? UNION SELECT d.package_id FROM task_package_deps d JOIN descendants p ON d.depends_on=p.id) SELECT p.task_id FROM descendants d JOIN packages p ON p.id=d.id').all(id)
        for(const row of rows)cancelNode(row.task_id,now)
        return {...view(owner,id),cancelledTaskIds:rows.map(row=>row.task_id)}
      })
    },
    cancelPlan(identity,owner,id,now){
      return transact(()=>{
        fence(identity,now);const previous=planView(owner,id)
        if(['succeeded','cancelled'].includes(previous.state))return{...previous,cancelledTaskIds:[]}
        stmt('UPDATE task_plans SET cancel_requested=1,updated_ms=? WHERE id=?').run(now,id)
        const rows=stmt('SELECT task_id FROM task_plan_packages WHERE plan_id=? ORDER BY rowid').all(id)
        if(rows.length)event(rows[0].task_id,null,'plan-cancel-requested',now,{planId:id})
        for(const row of rows)cancelNode(row.task_id,now)
        refreshPlans()
        return {...planView(owner,id),cancelledTaskIds:rows.map(row=>row.task_id)}
      })
    },
    finish(identity,owner,id,attemptId,outcome,result,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId||current.generation!==identity.generation||!['running','admitting','cancelling'].includes(task.state))fail('STALE_TASK_ATTEMPT')
        if(task.state==='admitting'&&outcome==='succeeded')fail('TASK_ADMISSION_REQUIRED')
        if(!['succeeded','failed','cancelled','unknown','waiting-budget'].includes(outcome))fail('INVALID_TASK_OUTCOME')
        // Seal preparing admission before considering a result: its outbox and
        // financial state, not notDispatched=true, establish this fact.
        if(['admitting','cancelling'].includes(task.state)&&notDispatched(id,current)){
          stmt("UPDATE task_admission_intents SET state='not-dispatched' WHERE attempt_id=?").run(attemptId)
          stmt("UPDATE task_dispatch_fences SET state='closed' WHERE attempt_id=? AND operation_id=?").run(attemptId,current.operation_id)
          event(id,attemptId,'admission-closed-not-dispatched',now,{operationId:current.operation_id})
        }
        if(['succeeded','failed','cancelled','waiting-budget'].includes(outcome)&&needsStopProof(task,current,result))outcome='unknown'
        const final=outcome==='unknown'?'needs-reconciliation':task.state==='cancelling'?'cancelled':outcome
        if(result?.legacyRunId) {
          const runId=taskRef(result.legacyRunId),old=stmt('SELECT * FROM legacy_task_runs WHERE run_id=?').get(runId)
          if(old&&(old.task_id!==id||old.owner_bot!==owner))fail('LEGACY_RUN_OWNER_CONFLICT')
          stmt('INSERT OR IGNORE INTO legacy_task_runs VALUES(?,?,?)').run(runId,id,owner)
        }
        updateAll(id,current,final,now,{...result,...(outcome==='unknown'?{cancelRequested:task.state==='cancelling'}:{})});event(id,current.id,'settled',now,{outcome:final})
        if(final==='cancelled'&&current.started_ms===null){
          stmt('UPDATE packages SET state=? WHERE id=?').run('skipped',current.package_id)
          stmt('UPDATE attempts SET state=? WHERE id=?').run('skipped',current.id)
        }
        return view(owner,id)
      })
    },
    linkExecution(identity,owner,id,attemptId,reference,now) {
      return transact(()=>{
        fence(identity,now);const task=owned(owner,id),current=latest(id)
        if(current.id!==attemptId||current.generation!==identity.generation||!['running','cancelling'].includes(task.state))fail('STALE_TASK_ATTEMPT')
        if(stmt("SELECT 1 FROM task_dispatch_fences WHERE attempt_id=? AND state='closed'").get(attemptId))fail('TASK_DISPATCH_CLOSED')
        validateReference(task,current,reference)
        const runId=reference.kind==='remote-operation'?null:taskRef(reference.runId),hash=taskHash(reference)
        const old=stmt('SELECT * FROM task_execution_refs WHERE attempt_id=?').get(attemptId)
        if(old&&old.reference_hash!==hash)fail('TASK_EXECUTION_REFERENCE_CONFLICT')
        const link=runId===null?null:stmt('SELECT * FROM legacy_task_runs WHERE run_id=?').get(runId)
        if(link&&(link.task_id!==id||link.owner_bot!==owner))fail('LEGACY_RUN_OWNER_CONFLICT')
        if(!old){
          stmt('INSERT INTO task_execution_refs VALUES(?,?,?)').run(attemptId,canonicalTaskJson(reference),hash)
          if(runId!==null)stmt('INSERT OR IGNORE INTO legacy_task_runs VALUES(?,?,?)').run(runId,id,owner)
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
        if(verdict.outcome!=='unknown'&&needsStopProof(task,current,{summary:verdict.summary}))verdict={...verdict,outcome:'unknown',reason:'TASK_STOP_UNCONFIRMED'}
        if(verdict.outcome!=='unknown'){
          const cancelled=JSON.parse(current.result??'{}').cancelRequested===true
          updateAll(id,current,cancelled?'cancelled':verdict.outcome,now,{code:'RECONCILED_FROM_EXECUTION_RECORD',evidenceHash:verdict.evidenceHash,...(verdict.summary?{summary:verdict.summary}:{})})
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
        if(cancelledPlan(id))fail('TASK_PLAN_CANCELLED')
        if(!dependenciesReady(latest(id).package_id))fail('TASK_DEPENDENCIES_NOT_READY')
        if(!terminalRetry.has(task.state))fail(task.state==='needs-reconciliation'?'TASK_RECONCILIATION_REQUIRED':'TASK_RETRY_NOT_ALLOWED')
        const previous=latest(id)
        if(needsStopProof(task,previous,previous.result?JSON.parse(previous.result):null))fail('TASK_RECONCILIATION_REQUIRED')
        if(stmt("SELECT 1 FROM tasks WHERE owner_bot=? AND state='needs-reconciliation'").get(owner))fail('TASK_RECONCILIATION_REQUIRED')
        if(stmt("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('ready','admitting','running','cancelling','waiting-budget') AND id<>?").get(id).n>=128)fail('TASK_QUEUE_LIMIT')
        if(task.deadline_ms<=now)fail('TASK_DEADLINE')
        if(previous.number>=3)fail('TASK_RETRY_LIMIT')
        const attemptId=makeAttempt(id,previous.package_id,previous.number+1,previous.id,now)
        stmt('INSERT INTO task_commands VALUES(?,?,?,?,?,?)').run(owner,key,'retry',hash,id,attemptId)
        return view(owner,id)
      })
    },
    events(owner,id) {owned(owner,id);return stmt('SELECT * FROM task_events WHERE task_id=? ORDER BY seq').all(id)},
    timeline(owner,id,{limit=80}={}) {
      owned(owner,id)
      if(!Number.isSafeInteger(limit)||limit<1||limit>200)fail('INVALID_TASK_HISTORY_LIMIT')
      const total=stmt('SELECT COUNT(*) AS n FROM task_events WHERE task_id=?').get(id).n
      const items=stmt('SELECT * FROM task_events WHERE task_id=? ORDER BY seq DESC LIMIT ?').all(id,limit).reverse()
      return {items,total,truncated:total>items.length}
    },
    // Product lists must not permanently hide new tasks behind a Bot's first 128 records.
    // This read is global across the Host's known Bots; it never changes runner queue ordering.
    productList(owners,{limit=512}={}) {
      if(!Array.isArray(owners)||!Number.isSafeInteger(limit)||limit<1||limit>512)fail('INVALID_TASK_LIST')
      const ids=[...new Set(owners.map(taskRef))]
      if(!ids.length)return {items:[],total:0,truncated:false}
      const visible=new Set(ids)
      const total=stmt('SELECT owner_bot,COUNT(*) AS n FROM tasks GROUP BY owner_bot').all()
        .reduce((sum,row)=>sum+(visible.has(row.owner_bot)?row.n:0),0)
      // Filter owners before the limit, including when old/deleted Bots still have records.
      const items=viewsOf(stmt(`SELECT * FROM tasks WHERE owner_bot IN (SELECT value FROM json_each(?))
        ORDER BY CASE WHEN state IN ('needs-reconciliation','waiting-approval','waiting-budget','blocked') THEN 0
          WHEN state IN ('ready','queued','running','cancelling','admitting') THEN 1 WHEN state='failed' THEN 2 ELSE 3 END,
          updated_ms DESC,id LIMIT ?`).all(JSON.stringify(ids),limit))
      return {items,total,truncated:total>items.length}
    },
    // A sanitized cross-task event feed for the notification center: it names the
    // safe structured fields only (seq/task/attempt/kind/at plus a validated
    // outcome and code). Raw event detail — run ids, reference/evidence hashes,
    // operation ids, gates — never leaves the journal, so a person-facing
    // notification is built from structured state instead of a leak. Keyset
    // pagination walks the monotonic seq; `maxSeq` is the feed watermark.
    notificationEvents(owners,kinds,{before=null,after=0,limit=64}={}) {
      const ids=[...new Set((Array.isArray(owners)?owners:[]).map(taskRef))]
      const wanted=[...new Set((Array.isArray(kinds)?kinds:[]).filter(kind=>typeof kind==='string'))]
      if(!ids.length||!wanted.length||!Number.isSafeInteger(limit)||limit<1||limit>512)return {items:[],maxSeq:0}
      const bound=value=>Number.isSafeInteger(value)&&value>=0?value:0
      const floor=bound(after),ceil=before===null?null:bound(before)
      const range=ceil===null?'e.seq>?':'e.seq>? AND e.seq<?',params=ceil===null?[floor]:[floor,ceil]
      const ownerJson=JSON.stringify(ids),kindJson=JSON.stringify(wanted)
      const items=stmt(`SELECT e.seq,e.task_id,e.attempt_id,e.kind,e.at_ms,e.detail,t.owner_bot
        FROM task_events e JOIN tasks t ON t.id=e.task_id
        WHERE t.owner_bot IN (SELECT value FROM json_each(?)) AND e.kind IN (SELECT value FROM json_each(?)) AND ${range}
        ORDER BY e.seq DESC LIMIT ?`).all(ownerJson,kindJson,...params,limit).map(row=>{
          let outcome=null,notifyCode=null
          try{const detail=JSON.parse(row.detail)
            outcome=['succeeded','failed','cancelled','skipped','blocked','unknown','waiting-budget','needs-reconciliation','ready','running','admitting','cancelling'].includes(detail?.outcome)?detail.outcome:null
            notifyCode=typeof detail?.code==='string'&&/^[A-Z0-9_:-]{1,128}$/.test(detail.code)?detail.code:null
          }catch{}
          return {seq:row.seq,taskId:row.task_id,ownerBotId:row.owner_bot,attemptId:row.attempt_id,kind:row.kind,at:row.at_ms,outcome,code:notifyCode}
        })
      const maxSeq=stmt(`SELECT COALESCE(MAX(e.seq),0) AS m FROM task_events e JOIN tasks t ON t.id=e.task_id
        WHERE t.owner_bot IN (SELECT value FROM json_each(?)) AND e.kind IN (SELECT value FROM json_each(?))`).get(ownerJson,kindJson).m
      return {items,maxSeq}
    },
    // One Bot's durable tasks, oldest first; the read model never invents a task.
    list(owner) {taskRef(owner);return viewsOf(stmt('SELECT * FROM tasks WHERE owner_bot=? ORDER BY created_ms,id LIMIT 128').all(owner))},
    close() {if(!closed){closed=true;if(borrowed){try{db.pragma(`busy_timeout=${priorTimeout}`)}catch{}}else db.close();onClose()}},
  })
}
