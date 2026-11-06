import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile,stat,symlink} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {spawnSync,execFileSync} from 'node:child_process'
const ROOT=resolve(import.meta.dirname,'..'),CLI=join(ROOT,'scripts/integration-migrate-profile.mjs'),PRODUCT='@ljwei-stak/dsh-model-route-bot'
await mkdir(resolve('tmp/integration/migration-preview-cli'),{recursive:true})
const json=value=>JSON.stringify(value,null,2)+'\n'
async function fixture(){
  const dir=await mkdtemp(resolve('tmp/integration/migration-preview-cli/case-')),home=join(dir,'home'),profile=join(home,'profiles','selected'),bot=join(home,'bot'),workspace=join(dir,'workspace')
  await mkdir(profile,{recursive:true});await mkdir(bot);await mkdir(workspace)
  async function bundle(folder,name,patch){const packageDir=join(dir,folder);await mkdir(packageDir);await writeFile(join(packageDir,'package.json'),json({name,version:'0.25.6-preview.1',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(join(packageDir,'cordis.patch.yml'),typeof patch==='string'?patch:json(patch));return{packageName:name,packageDir}}
  const base=await bundle('base','@fixture/base',[{insert:[{id:'web',name:'cordis:web-fixture',config:{searchProvider:'auto',fetchProvider:'http'}}]}])
  const ds=await bundle('ds','ds-bot',await readFile(join(ROOT,'modules/bot-runtime/vendor/ds-bot/cordis.patch.yml'),'utf8'))
  const mr=await bundle('mr',PRODUCT,[{insert:[{id:'model-router-galgame',name:PRODUCT}]}])
  const target=await bundle('target',PRODUCT,await readFile(join(ROOT,'cordis.patch.yml'),'utf8'))
  await writeFile(join(profile,'package.json'),json({private:true,dsh:{profile:{bundles:[base.packageName,ds.packageName,mr.packageName]}}}))
  await writeFile(join(profile,'cordis.patch.yml'),json([{id:'bot',name:'ds-bot',config:{home:bot,workspace,memory:false,browser:false}},{id:'model-router-galgame',name:PRODUCT,config:{dailyBudgetUsd:23,privateOption:'mock-PRIVATE-CONFIG'}}]))
  await writeFile(join(bot,'state.json'),'{"botId":"stable","secret":"mock-PRIVATE-DATA"}\n')
  const request={profile:{profileDir:profile,dshHome:home,launchCwd:workspace,orderedBundleLayers:[base,ds,mr],targetBundleLayer:target,launcherLayers:[]},dataSources:[{id:'PRIVATE_DATA_LABEL',kind:'bot-data',root:bot}]},file=join(dir,'request.private.json');await writeFile(file,json(request))
  return{dir,home,profile,bot,workspace,target,request,file}
}
function run(args){const result=spawnSync(process.execPath,[CLI,...args],{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});assert.equal(result.error,undefined);assert.equal(result.stderr,'');return{...result,summary:JSON.parse(result.stdout)}}
function redacted(f,result){for(const value of [f.dir,'mock-PRIVATE','PRIVATE_DATA_LABEL','state.json','request.private.json'])assert.ok(!result.stdout.includes(value),value)}

test('migration CLI: explicit offline preview emits only redacted summaries and keeps source bytes',async()=>{
  const f=await fixture(),before=await readFile(join(f.profile,'cordis.patch.yml')),data=await readFile(join(f.bot,'state.json')),result=run(['--request',f.file])
  assert.equal(result.status,0,result.stdout);assert.equal(result.summary.status,'preview-ready');assert.equal(result.summary.data.files,1)
  assert.equal(result.summary.applySupported,false);assert.equal(result.summary.consistentSnapshot,false);assert.equal(result.summary.requiresStopProof,true);assert.equal(result.summary.savedPrivatePlan,false)
  assert.deepEqual(await readFile(join(f.profile,'cordis.patch.yml')),before);assert.deepEqual(await readFile(join(f.bot,'state.json')),data);redacted(f,result)
})
test('migration CLI: configuration-only readiness remains needs-data-selection',async()=>{
  const f=await fixture();delete f.request.dataSources;await writeFile(f.file,json(f.request));const result=run(['--request',f.file])
  assert.equal(result.status,2);assert.equal(result.summary.status,'needs-data-selection');assert.equal(result.summary.configuration.status,'ready');assert.equal(result.summary.data,null);redacted(f,result)
})
test('migration CLI: private output uses a new restricted directory and preserves full private plan',async()=>{
  const f=await fixture(),output=join(f.dir,'private-output'),result=run(['--request',f.file,'--private-output',output])
  assert.equal(result.status,0,result.stdout);assert.equal(result.summary.savedPrivatePlan,true);redacted(f,result)
  const saved=await readFile(join(output,'plan.private.json'),'utf8');assert.ok(saved.includes('mock-PRIVATE-CONFIG'));assert.ok(saved.includes(f.home.replaceAll('\\','\\\\')))
  const artifact=JSON.parse(saved);assert.equal(artifact.kind,'migration-preview');assert.equal(artifact.consistentSnapshot,false);assert.equal(artifact.requiresStopProof,true);assert.equal(artifact.applySupported,false)
  if(process.platform==='win32'){
    const probe=join(f.dir,'acl-probe.ps1');await writeFile(probe,'param([string]$Target)\n$ErrorActionPreference="Stop"\n$acl=[IO.Directory]::GetAccessControl($Target)\n$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))\n[PSCustomObject]@{isProtected=$acl.AreAccessRulesProtected;allowsCurrent=@($rules | Where-Object {$_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq "Allow"}).Count;otherAllows=@($rules | Where-Object {$_.IdentityReference.Value -ne $sid -and $_.AccessControlType -eq "Allow"}).Count} | ConvertTo-Json -Compress\n')
    const acl=JSON.parse(execFileSync('powershell.exe',['-NoLogo','-NoProfile','-File',probe,output],{encoding:'utf8',windowsHide:true}));assert.equal(acl.isProtected,true);assert.equal(acl.allowsCurrent,1);assert.equal(acl.otherAllows,0)
  }else{assert.equal((await stat(output)).mode&0o077,0);assert.equal((await stat(join(output,'plan.private.json'))).mode&0o077,0)}
  const again=run(['--request',f.file,'--private-output',output]);assert.equal(again.status,1);assert.equal(again.summary.code,'MIGRATION_IO_EEXIST');assert.equal(await readFile(join(output,'plan.private.json'),'utf8'),saved)
})
test('migration CLI: refusing output inside data/profile/bundle sources makes no source changes',async()=>{
  for(const where of ['bot','profile','target']){
    const f=await fixture(),parent=where==='target'?f.target.packageDir:f[where],output=join(parent,'must-not-exist'),result=run(['--request',f.file,'--private-output',output])
    assert.equal(result.status,1);assert.equal(result.summary.code,'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE');await assert.rejects(stat(output),{code:'ENOENT'});redacted(f,result)
  }
})
test('migration CLI: output through a junction into a selected tree is refused',async()=>{
  const f=await fixture(),alias=join(f.dir,'alias');await symlink(f.bot,alias,process.platform==='win32'?'junction':'dir')
  const result=run(['--request',f.file,'--private-output',join(alias,'new-private')]);assert.equal(result.status,1);assert.equal(result.summary.code,'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE');await assert.rejects(stat(join(f.bot,'new-private')),{code:'ENOENT'})
})
test('migration CLI: malformed and oversized requests fail without disclosing content or paths',async()=>{
  const f=await fixture()
  for(const text of ['{"private":"mock-PRIVATE','x'.repeat(1048577),json({...f.request,secret:'mock-PRIVATE'})]){
    await writeFile(f.file,text);const result=run(['--request',f.file]);assert.equal(result.status,1);assert.equal(result.summary.status,'failed');assert.ok(/^MIGRATION_REQUEST_/.test(result.summary.code));redacted(f,result)
  }
})
test('migration CLI: apply and unknown flags are refused, never interpreted as actions',async()=>{
  const f=await fixture()
  for(const args of [[],['--apply',f.file],['--request',f.file,'--request',f.file],['--request',f.file,'--private-output','relative']]){
    const result=run(args);assert.equal(result.status,1);assert.equal(result.summary.applySupported,false);redacted(f,result)
  }
})
test('migration CLI: a missing launch context is actionable and never silently guessed',async()=>{
  const f=await fixture();delete f.request.profile.launcherLayers;await writeFile(f.file,json(f.request));const result=run(['--request',f.file])
  assert.equal(result.status,2);assert.equal(result.summary.status,'needs-launch-context');assert.ok(result.summary.configuration.diagnostics.some(d=>d.code==='NEEDS_LAUNCH_CONTEXT'));redacted(f,result)
})
