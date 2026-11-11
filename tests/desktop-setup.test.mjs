import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile,readdir,access} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {Store} from '../remote-computer-agent/dist/index.mjs'
let Database;try{Database=(await import(process.env.DSH_REMOTE_AGENT_DRIVER??pathToFileURL(resolve('tmp/integration/probes/sqlite/node_modules/better-sqlite3/lib/index.js')).href)).default}catch{Database=createRequire(new URL('../remote-computer-agent/package.json',import.meta.url))('better-sqlite3')}
const parent=resolve('tmp/integration/desktop-setup');await mkdir(parent,{recursive:true})
const code=expected=>e=>e.code===expected
const grantRequest=(botId,changes={})=>({botId,taskId:'task',attemptId:'attempt',roots:['project'],tools:['desktop_screenshot'],...changes})

test('desktop setup authority: hostManagedBots requires local admin opt-in, keeps roots/tools/revision and fixed Bot ceilings',async()=>{
  const dir=await mkdtemp(join(parent,'authority-')),store=new Store(dir,Database),admin=new Store(dir,Database,{admin:true})
  try{
    assert.throws(()=>store.pair('forged',{hostManagedBots:true,roots:['project'],tools:['desktop_screenshot']}),code('ADMIN_REQUIRED'))
    assert.throws(()=>admin.pair('truthy',{hostManagedBots:'true',roots:['project'],tools:['desktop_screenshot']}),code('INVALID_CEILING'))
    const fixed=store.pair('fixed',{botIds:['bot-a'],roots:['project'],tools:['desktop_screenshot']}),fixedClient=store.client(fixed.token)
    assert.equal(fixed.hostManagedBots,false);assert.throws(()=>store.issue(fixedClient,grantRequest('bot-new',{hostManagedBots:true})),code('SCOPE_DENIED'))
    const paired=admin.pair('trusted-host',{hostManagedBots:true,roots:['project'],tools:['desktop_screenshot']}),client=store.client(paired.token)
    assert.equal(paired.hostManagedBots,true);const first=store.issue(client,grantRequest('bot-created-after-pairing'));assert.equal(first.botId,'bot-created-after-pairing')
    assert.throws(()=>store.issue(client,grantRequest('*')),code('INVALID_ID'))
    assert.throws(()=>store.issue(client,grantRequest('bot-a',{roots:['outside']})),code('SCOPE_DENIED'))
    assert.throws(()=>store.issue(client,grantRequest('bot-a',{tools:['shell_exec']})),code('SCOPE_DENIED'))
    const other=admin.pair('other-host',{hostManagedBots:true,roots:['project'],tools:['desktop_screenshot']}),otherGrant=store.issue(store.client(other.token),grantRequest(first.botId))
    assert.equal(store.revokeGrants(client,{botId:first.botId}).revoked,1);assert.throws(()=>store.grant(first.grantToken),code('AUTH_INVALID'));assert.equal(store.grant(otherGrant.grantToken).clientId,'other-host')
    admin.rotate('trusted-host');assert.throws(()=>store.issue(client,grantRequest('bot-after-rotation')),code('AUTH_INVALID'))
    assert.throws(()=>store.revokeGrants(fixedClient,{botId:'unlisted-bot'}),code('SCOPE_DENIED'))
  }finally{admin.close();store.close()}
})

function runSetup(dir,install,answers,registry){
  const argumentsList=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('remote-computer-agent/setup.ps1'),'-InstallRoot',install,'-PackageRoot',resolve('remote-computer-agent'),'-NodePath',process.execPath,'-HelperPath',resolve('tmp/integration/agent-helper-build/dsh-desktop-helper.exe'),'-AnswersFile',answers,'-MockTaskRegistry',registry,'-NoStart']
  return execFileSync('powershell.exe',argumentsList,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:30000,env:{...process.env,DSH_AGENT_SETUP_TEST_MODE:'1'}})
}
test('desktop setup wizard: isolated config, private secrets/pair export, interactive tasks and safe repeat backup',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(parent,'wizard-')),install=join(dir,'new install with spaces'),answers=join(dir,'answers.json'),registry=join(dir,'mock-tasks.json'),workspace=join(dir,'workspace')
  await writeFile(answers,JSON.stringify({pairingMode:'legacy',workspace,bindAddress:'127.0.0.1',port:19701,endpoint:'http://127.0.0.1:19701',hostManagedBots:true,clientId:'test-host',allowCommands:false,existingAction:'keep'}))
  const output=runSetup(dir,install,answers,registry),config=JSON.parse(await readFile(join(install,'config.json'),'utf8')),pairFile=join(install,'private/pairing.private.json'),paired=JSON.parse(await readFile(pairFile,'utf8')),nativeSecret=await readFile(join(install,'private/native.secret'),'utf8')
  assert.equal(config.network.host,'127.0.0.1');assert.deepEqual(config.network.allowedHosts,['127.0.0.1:19701']);assert.equal(config.roots.project,workspace);assert.match(config.desktop.pipeName,/^dsh-desktop-[a-f0-9]{12}$/);assert.equal(config.shell,undefined);assert.deepEqual(config.executables,{})
  assert.equal(paired.hostManagedBots,true);assert.equal(paired.endpoint,'http://127.0.0.1:19701');assert.deepEqual(paired.rootIds,['project']);assert.match(paired.token,/^[A-Za-z0-9_-]{43}$/);assert.match(nativeSecret,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(nativeSecret,paired.token)
  assert.deepEqual(paired.botIds,[]);assert.ok(paired.tools.includes('desktop_screenshot'));assert.ok(!paired.tools.includes('shell_exec'))
  assert.ok(!output.includes(paired.token));assert.ok(!output.includes(nativeSecret));assert.ok(!JSON.stringify(JSON.parse(await readFile(join(install,'connection.json'),'utf8'))).includes(paired.token))
  const tasks=JSON.parse(await readFile(registry,'utf8'));assert.equal(tasks.length,2)
  for(const task of tasks){assert.ok(task.xml.includes('<LogonType>InteractiveToken</LogonType>'));assert.ok(task.xml.includes('<RunLevel>LeastPrivilege</RunLevel>'));assert.equal(task.status,'Ready');assert.ok(!task.xml.includes(paired.token));assert.ok(!task.xml.includes(nativeSecret))}
  assert.ok(tasks.find(t=>t.role==='desktop').xml.includes('--desktop-mode full'));assert.ok(tasks.find(t=>t.role==='agent').xml.includes('-WindowStyle Hidden'))
  assert.ok(tasks.every(task=>!task.xml.includes('encoding=')), 'Task Scheduler receives a UTF-16 BSTR, so XML must not declare UTF-8')
  const acl=JSON.parse(execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`$a=[IO.File]::GetAccessControl('${pairFile.replaceAll("'","''")}'); @{protected=$a.AreAccessRulesProtected;sids=@($a.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value });owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}))
  assert.equal(acl.protected,true);assert.deepEqual(new Set(acl.sids),new Set([acl.owner,'S-1-5-18','S-1-5-32-544']))
  const originalConfig=await readFile(join(install,'config.json'),'utf8'),originalPair=await readFile(pairFile,'utf8'),originalTasks=await readFile(registry,'utf8')
  const repeated=runSetup(dir,install,answers,registry);assert.ok(repeated.includes('preserved'));assert.equal(await readFile(join(install,'config.json'),'utf8'),originalConfig);assert.equal(await readFile(pairFile,'utf8'),originalPair);assert.equal(await readFile(registry,'utf8'),originalTasks)
  const backups=(await readdir(join(install,'private'))).filter(name=>name.startsWith('backup-'));assert.equal(backups.length,1);assert.equal(await readFile(join(install,'private',backups[0],'private-pairing.private.json'),'utf8'),originalPair)
  const admin=new Store(config.dataDir,Database,{admin:true});try{const issued=admin.issue(admin.client(paired.token),grantRequest('new-bot-after-wizard'));assert.equal(issued.botId,'new-bot-after-wizard')}finally{admin.close()}
})
test('desktop setup wizard: secure default creates a private expiring invitation and QR page without a device credential',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(parent,'secure-wizard-')),install=join(dir,'secure install'),answers=join(dir,'answers.json'),registry=join(dir,'tasks.json')
  await writeFile(answers,JSON.stringify({workspace:join(dir,'workspace'),hostManagedBots:true,clientId:'secure-host'}))
  const output=runSetup(dir,install,answers,registry)
  const config=JSON.parse(await readFile(join(install,'config.json'),'utf8')),connection=JSON.parse(await readFile(join(install,'connection.json'),'utf8'))
  const invitation=JSON.parse(await readFile(connection.pairingFile,'utf8')),page=await readFile(join(install,'private/pairing.html'),'utf8')
  assert.equal(config.network.mode,'e2e');assert.equal(connection.pairingMode,'secure');assert.equal(invitation.version,2)
  assert.match(invitation.token,/^dsh_pair_[A-Za-z0-9_-]{43}$/);assert.equal(Object.hasOwn(invitation,'code'),false);assert.equal(invitation.ceiling.hostManagedBots,true)
  assert.match(page,/<svg/);assert.match(page,/Content-Security-Policy/);assert.equal(output.includes(invitation.token),false)
  assert.equal(JSON.stringify(connection).includes(invitation.token),false)
  const local=new Store(config.dataDir,Database,{admin:true})
  try{assert.equal(local.db.prepare('SELECT count(*) n FROM clients').get().n,0);assert.equal(local.db.prepare('SELECT count(*) n FROM pairing_invites WHERE attempts_left>0').get().n,1)}finally{local.close()}
  const refreshed=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(install,'pair-device.ps1')],{encoding:'utf8',windowsHide:true})
  const next=JSON.parse(await readFile(connection.pairingFile,'utf8'));assert.notEqual(next.inviteId,invitation.inviteId);assert.notEqual(next.token,invitation.token);assert.equal(refreshed.includes(next.token),false)
  assert.equal((await readFile(join(install,'pair-device.cmd'),'utf8')).includes('-OpenPage'),true)
  const beforeConnection=await readFile(join(install,'connection.json'),'utf8'),beforeTasks=await readFile(registry,'utf8')
  const admin=new Store(config.dataDir,Database,{admin:true});let prior
  try{prior=admin.pair(connection.clientId,{hostManagedBots:true,roots:connection.rootIds,tools:connection.tools})}finally{admin.close()}
  const refreshArgs=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(install,'pair-device.ps1')]
  assert.throws(()=>execFileSync('powershell.exe',refreshArgs,{stdio:'pipe',windowsHide:true}),error=>error.status===1)
  execFileSync('powershell.exe',[...refreshArgs,'-ResetPairing'],{stdio:'pipe',windowsHide:true})
  assert.equal(await readFile(join(install,'connection.json'),'utf8'),beforeConnection);assert.equal(await readFile(registry,'utf8'),beforeTasks)
  const reset=JSON.parse(await readFile(connection.pairingFile,'utf8'));assert.notEqual(reset.inviteId,next.inviteId);assert.equal(Object.hasOwn(reset,'code'),false)
  const checked=new Store(config.dataDir,Database,{admin:true})
  try{assert.throws(()=>checked.client(prior.token),/AUTH_INVALID/);assert.equal(checked.db.prepare('SELECT count(*) n FROM clients WHERE revoked=0').get().n,0)}finally{checked.close()}
})
test('desktop setup wizard: an existing scheduled-task name is refused without replacing files/tasks',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(parent,'collision-')),install=join(dir,'new-install'),answers=join(dir,'answers.json'),registry=join(dir,'mock-tasks.json'),installationId=createHash('sha256').update(install.toLowerCase()).digest('hex').slice(0,12)
  const original=JSON.stringify([{name:`DSH-RemoteAgent-${installationId}`,xml:'existing operator task',status:'Running'}]);await writeFile(registry,original);await writeFile(answers,JSON.stringify({workspace:join(dir,'workspace'),hostManagedBots:true}))
  assert.throws(()=>runSetup(dir,install,answers,registry),e=>e.status===1);assert.equal(await readFile(registry,'utf8'),original);await assert.rejects(access(join(install,'config.json')))
})
