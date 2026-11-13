import { mkdir, mkdtemp, writeFile, readFile, symlink, appendFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
// Uses a real installed Harness with a new, isolated home. No UI or API mocks.
const repo=resolve(import.meta.dirname,'..'),passed=process.argv.slice(2)
const option=name=>{const at=passed.indexOf(name);if(at<0)return null;if(!passed[at+1])throw Error('Missing '+name);return passed[at+1]}
const source=resolve(option('--source')??repo)
const desktopRoot=option('--desktop-root')??(process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness'):null)
if(process.platform!=='win32'||!desktopRoot)throw Error('Provide an existing Windows Harness installation with --desktop-root')
const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'))
if(pkg.name!=='@ljwei-stak/dsh-model-route-bot')throw Error('A complete Bot package is required')
const base=join(repo,'tmp/integration/actual-harness-ui');await mkdir(base,{recursive:true})
const run=await mkdtemp(join(base,'case-')),home=join(run,'home'),profile=join(home,'profiles/verification')
await mkdir(join(profile,'node_modules/@ljwei-stak'),{recursive:true})
await symlink(source,join(profile,'node_modules/@ljwei-stak/dsh-model-route-bot'),'junction')
await writeFile(join(profile,'package.json'),JSON.stringify({private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@ljwei-stak/dsh-model-route-bot']}}},null,2))
await writeFile(join(profile,'cordis.patch.yml'),'[]\n')
const env={ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_STATE_HOME:home,DSH_TELEMETRY:'0'}
for(const key of ['PATH','Path','PATHEXT','SystemRoot','windir','ComSpec','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','LANG'])if(process.env[key])env[key]=process.env[key]
for(const key of ['USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR']){env[key]=join(run,'isolated-user',key.toLowerCase());await mkdir(env[key],{recursive:true})}
const executable=join(desktopRoot,'DeepSeek Harness.exe')
const cli=join(desktopRoot,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
const versionScript=`process.stdout.write(JSON.parse(require('node:fs').readFileSync(${JSON.stringify(join(desktopRoot,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/package.json'))},'utf8')).version)`
const harnessVersion=(await promisify(execFile)(executable,['--expose-internals','-e',versionScript],{env,windowsHide:true,timeout:10000,maxBuffer:16000})).stdout.trim()
if(!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(harnessVersion))throw Error('Cannot identify the installed Harness runtime')
const args=['--expose-internals',cli,'--profile','verification','--host','127.0.0.1','--port','0','--no-open']
const child=spawn(executable,args,{cwd:run,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
const chunks=[];let ready=false
const consume=b=>{
 chunks.push(b);void appendFile(join(run,'launcher.log'),b)
 if(!ready){const match=Buffer.concat(chunks).toString().replace(/\x1b\[[0-9;]*m/g,'').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s\x1b]+/)
  if(match){ready=true;void writeFile(join(run,'connection.private.json'),JSON.stringify({ownerUrl:match[0],origin:new URL(match[0]).origin}));console.log(JSON.stringify({state:'ready',run,origin:new URL(match[0]).origin}))}}
}
child.stdout.on('data',consume);child.stderr.on('data',consume)
const stopTimer=setInterval(async()=>{try{await readFile(join(run,'stop.flag'));child.kill()}catch{}},500)
await writeFile(join(base,'current.json'),JSON.stringify({run,home,profile,source,packageVersion:pkg.version,harnessVersion,launcherPid:child.pid},null,2))
process.once('SIGINT',()=>child.kill());process.once('SIGTERM',()=>child.kill())
const code=await new Promise(r=>child.once('close',r));clearInterval(stopTimer);await writeFile(join(run,'launcher.log'),Buffer.concat(chunks))
console.log(JSON.stringify({code,run}));console.log(Buffer.concat(chunks).toString().replace(/([?&]token=)[^\s&]+/g,'$1[REDACTED]').slice(-8000));process.exitCode=code??1
